/**
 * #4157: an account deletion against an exercise rename, both touching the person's programs.
 *
 * The rename locks every program that holds the old name in ID order (#4096). The deletion's `DELETE FROM users`
 * cascade deletes the person's programs in whatever order the scan returns them (the heap order: the order they
 * were inserted in). With two programs of one person that both use the exercise, and the lower id inserted second,
 * the deletion held the higher one and wanted the lower while the rename held the lower and wanted the higher:
 * 40P01, one side rolled back whole (reproduced, gated, below). The deletion now takes the person's programs in id
 * order itself, right after its row lock, so both sides climb the same ladder and the one that comes second waits
 * at the first program holding nothing the other wants.
 *
 * Two connections, on a real Postgres. The deletion is held at the HIGHER program (a row trigger waits on an advisory
 * lock after Postgres has locked the row), the rename is started and queued behind it, then the gate opens. The
 * trigger's condition names one program id, so it never holds another test's writer.
 *
 * Real Postgres only (DATABASE_URL). Fresh ids, trigger, function and advisory keys per run; the one piece of DDL is
 * made once, with a lock_timeout and retries. Everything is removed in `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID, randomInt } from 'node:crypto'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const OWNER = randomUUID() // creates the library row, so may rename it
const U = randomUUID() // the account that is deleted; owns both programs
const TAG = OWNER.slice(0, 8)
const GATE_K1 = randomInt(1_000_000, 2_000_000_000)
const GATE_K2 = randomInt(1_000_000, 2_000_000_000)
const FN = `gate_4157_${TAG}`
const [LOW, HIGH] = [randomUUID(), randomUUID()].sort()

const code = (e: unknown): string | undefined =>
  [e, (e as { cause?: unknown } | null)?.cause].map(x => (x as { code?: unknown } | null)?.code).find((c): c is string => typeof c === 'string')

describe.skipIf(!canRun)('account deletion against an exercise rename (#4157)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let gate: import('pg').PoolClient | null = null
  let libId: string

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const until = async <T>(what: string, probe: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T> => {
    const end = Date.now() + ms
    for (;;) {
      const v = await probe()
      if (v) return v
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
      await sleep(20)
    }
  }
  const ddl = async (text: string) => {
    for (let i = 0; ; i++) {
      const c = await pool.connect()
      try {
        await c.query(`SET lock_timeout = '3s'`)
        await c.query(text)
        return
      } catch (e) {
        if (i >= 8 || !['55P03', '40P01'].includes(code(e) ?? '')) throw e
      } finally {
        c.release()
      }
      await sleep(150 + i * 100)
    }
  }
  const closeGate = async () => {
    if (!gate) return
    const g = gate
    gate = null
    await g.query('COMMIT').catch(() => undefined)
    g.release()
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    // A row trigger fires after Postgres has locked the row, so the deleting side holds HIGH while it waits here.
    await pool.query(`CREATE OR REPLACE FUNCTION ${FN}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF OLD.id = '${HIGH}' THEN PERFORM pg_advisory_xact_lock_shared(${GATE_K1}, ${GATE_K2}); END IF;
        RETURN OLD;
      END $f$`)
    await ddl(`CREATE TRIGGER ${FN} BEFORE DELETE ON programs FOR EACH ROW EXECUTE FUNCTION ${FN}()`)
    for (const u of [OWNER, U]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [u, `q4157-${u}@example.com`, TZ])
    }
  })
  afterAll(async () => {
    await closeGate()
    if (!pool) return
    await ddl(`DROP TRIGGER IF EXISTS ${FN} ON programs`).catch(() => undefined)
    await pool.query(`DROP FUNCTION IF EXISTS ${FN}()`).catch(() => undefined)
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [U]).catch(() => undefined)
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER, U]]).catch(() => undefined)
    if (libId) await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [libId]).catch(() => undefined)
  })

  it('does not end in a deadlock: the rename waits for the deletion, then finds nothing to rename', async () => {
    const oldName = `Q4157 Old ${TAG}`
    const newName = `Q4157 New ${TAG}`
    libId = (await pool.query(
      `INSERT INTO exercise_library (name, equipment, muscles, created_by) VALUES ($1, ARRAY['barbell'], '[{"muscle":"chest","role":"main"}]'::jsonb, $2) RETURNING id`, [oldName, OWNER])).rows[0].id as string
    // HIGH is inserted first, so the scan the deletion's cascade makes reaches it before LOW.
    for (const pid of [HIGH, LOW]) {
      const sid = randomUUID()
      await pool.query(`INSERT INTO programs (id, user_id, name, phase_mode, is_active, training_goal) VALUES ($1,$2,$3,'ai_dynamic',false,'strength')`, [pid, U, `P4157 ${pid}`])
      await pool.query(`INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1,$2,'Day',0)`, [sid, pid])
      await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, position, exercise_role, muscle_groups) VALUES ($1,$2,0,'primary','{chest}')`, [sid, oldName])
    }

    gate = await pool.connect()
    await gate.query('BEGIN')
    await gate.query(`SELECT pg_advisory_xact_lock($1, $2)`, [GATE_K1, GATE_K2])
    const del = repo.deleteAccount(U).then(r => r, e => e as Error)
    // The deletion is at the gate: it holds HIGH (or, with the fix, has already taken LOW and then HIGH, in id order).
    const pid = await until('the deletion at the gate', async () => {
      const r = await pool.query(`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = $2 AND NOT granted`, [GATE_K1, GATE_K2])
      return r.rows[0]?.pid as number | undefined
    })
    const ren = repo.renameExercise(OWNER, libId, newName).then(() => 'ok' as const, e => e as Error)
    // The rename is queued behind the deletion (on LOW with the fix, on HIGH after taking LOW without it).
    await until('the rename queued behind the deletion', async () => {
      const r = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])
      return r.rows.length > 0
    })
    await closeGate()
    const [d, r] = await Promise.all([del, ren])

    expect(code(d), `deletion: ${(d as Error)?.message}`).toBeUndefined()
    expect((d as { deleted?: boolean }).deleted).toBe(true)
    expect(code(r), `rename: ${(r as Error)?.message}`).not.toBe('40P01')
    // Either outcome of the rename is clean: it ran after the deletion (nothing left to rename) or it was told busy.
    expect(r === 'ok' || ['55P03', '57014'].includes(code(r) ?? '')).toBe(true)
    expect((await pool.query(`SELECT 1 FROM programs WHERE user_id = $1`, [U])).rowCount).toBe(0)
  }, 30_000)
})
