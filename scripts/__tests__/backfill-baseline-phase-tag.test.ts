// #2460 — the dry-run-first backfill that tags pre-TN-75 baseline sessions. Two halves:
//
//   · the guard: it refuses any database that is not loopback on the local dev port, before it
//     connects — production is the Orchestrator's, under the verified-snapshot policy;
//   · the rule, against real rows: which NULL-tag sessions it tags, which it lists as near misses,
//     that nothing is written without `--write`, and that a second `--write` writes nothing.
//
// The DB half runs only against a real local Postgres and is always scoped with `--user`, so it can
// never tag another test's rows in a shared dev database.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { assertLocalDatabaseUrl, parseArgs, run, DEFAULT_CUTOFF } from '../backfill-baseline-phase-tag.mjs'

const SCRIPT = path.resolve(__dirname, '../backfill-baseline-phase-tag.mjs')

describe('backfill-baseline-phase-tag: local databases only', () => {
  it.each([
    ['a remote host', 'postgresql://u:p@db.example.com:5432/railway', '5433'],
    ['a loopback host on another port (a tunnel)', 'postgresql://u:p@localhost:6543/railway', '5433'],
    ['a loopback host on the default port', 'postgresql://u:p@127.0.0.1/railway', '5433'],
  ])('refuses %s', (_label, url, port) => {
    expect(() => assertLocalDatabaseUrl(url, port)).toThrow(/refusing/)
  })

  it('accepts loopback on the local port', () => {
    expect(() => assertLocalDatabaseUrl('postgresql://u:p@localhost:5434/x', '5434')).not.toThrow()
    expect(() => assertLocalDatabaseUrl('postgresql://u:p@127.0.0.1:5433/x', '5433')).not.toThrow()
  })

  it('requires a DATABASE_URL', () => {
    expect(() => assertLocalDatabaseUrl(undefined, '5433')).toThrow(/required/)
  })

  // The real process, so the refusal is proved to happen before any connection: the host does not
  // resolve, and a connect attempt would fail with a DNS error instead of the refusal.
  it('exits 2 from the command line with a production-shaped URL, even with --write', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--write'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://u:p@prod-db.invalid:5432/railway', LOCAL_DB_PORT: '5433' },
      encoding: 'utf8',
    })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/refusing prod-db\.invalid:5432/)
  })

  it('parses its arguments strictly', () => {
    expect(parseArgs([])).toEqual({ write: false, cutoff: DEFAULT_CUTOFF, user: null })
    expect(parseArgs(['--write']).write).toBe(true)
    expect(() => parseArgs(['--wrte'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--cutoff=yesterday'])).toThrow(/not an instant/)
    expect(() => parseArgs(['--user=me'])).toThrow(/not a uuid/)
  })
})

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000246011'
const OTHER = '00000000-0000-4000-8000-000000246012'
const AI_PROGRAM = '00000000-0000-4000-8000-000000246013'
const MANUAL_PROGRAM = '00000000-0000-4000-8000-000000246014'
const UPPER = '00000000-0000-4000-8000-000000246015'
const LOWER = '00000000-0000-4000-8000-000000246016'
const PUSH = '00000000-0000-4000-8000-000000246017'
const PULL = '00000000-0000-4000-8000-000000246018'
const MANUAL_DAY = '00000000-0000-4000-8000-000000246019'

describe.skipIf(!canRun)('backfill-baseline-phase-tag: the rule against real rows', () => {
  let pool: import('pg').Pool
  const env = () => {
    const url = process.env.DATABASE_URL!
    return { DATABASE_URL: url, LOCAL_DB_PORT: new URL(url).port || '5432' }
  }
  const quiet = () => {}

  /** A workout of `sets` per exercise; `planned` stamps a planned_pct on every set. */
  const workout = async (opts: {
    user?: string; programSession: string | null; at: string; exercises?: number; sets?: number
    planned?: boolean; phaseType?: string | null; deleted?: boolean
  }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, phase_type, deleted_at)
       VALUES ($1, $2, 'Issue2460', $3, $4, $5) RETURNING id`,
      [opts.user ?? USER, opts.programSession, opts.at, opts.phaseType ?? null, opts.deleted ? new Date() : null])
    for (let e = 0; e < (opts.exercises ?? 3); e++) {
      const { rows: [el] } = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
         VALUES ($1, $2, 80, $3) RETURNING id`, [ws.id, `Issue2460 Ex${e}`, opts.at])
      for (let s = 1; s <= (opts.sets ?? 1); s++) {
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_pct)
           VALUES ($1, $2, 60, 15, $3)`, [el.id, s, opts.planned ? 75 : null])
      }
    }
    return ws.id as string
  }
  const tagOf = async (id: string) =>
    (await pool.query(`SELECT phase_type FROM workout_sessions WHERE id = $1`, [id])).rows[0].phase_type

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `issue2460-bf-${id}@example.com`])
    }
    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active, phase_mode) VALUES
         ($1, $3, 'Issue2460 AI', true, 'ai_dynamic'), ($2, $3, 'Issue2460 Manual', false, 'manual')
       ON CONFLICT (id) DO NOTHING`, [AI_PROGRAM, MANUAL_PROGRAM, USER])
    await pool.query(
      `INSERT INTO program_sessions (id, program_id, name, position) VALUES
         ($1, $6, 'Upper', 0), ($2, $6, 'Lower', 1), ($3, $6, 'Push', 2), ($4, $6, 'Pull', 3), ($5, $7, 'Day', 0)
       ON CONFLICT (id) DO NOTHING`, [UPPER, LOWER, PUSH, PULL, MANUAL_DAY, AI_PROGRAM, MANUAL_PROGRAM])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM programs WHERE id = ANY($1)`, [[AI_PROGRAM, MANUAL_PROGRAM]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  let ids: Record<string, string>
  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    ids = {
      // Matches: the first run of a rebuilt session, one unplanned set per exercise.
      upperBaseline: await workout({ programSession: UPPER, at: '2026-09-08T08:00:00+10:00' }),
      // An aborted attempt deleted before it, so this one is the first LIVE run: still a match.
      lowerDeleted: await workout({ programSession: LOWER, at: '2026-09-07T08:00:00+10:00', deleted: true }),
      lowerBaseline: await workout({ programSession: LOWER, at: '2026-09-09T08:00:00+10:00', exercises: 4 }),
      // The prescribed runs after them: several planned sets. Not first, not one set: not listed.
      upperNext: await workout({ programSession: UPPER, at: '2026-09-15T08:00:00+10:00', sets: 4, planned: true }),
      // Baseline skipped with prior data: the first run is prescribed. A near miss, never tagged.
      pushSkipped: await workout({ programSession: PUSH, at: '2026-09-10T08:00:00+10:00', sets: 3, planned: true }),
      // A short prescribed day, one planned set each, not the first run: a near miss.
      pushShort: await workout({ programSession: PUSH, at: '2026-09-17T08:00:00+10:00', sets: 1, planned: true }),
      // A manual program has no baseline phase. A near miss.
      manualFirst: await workout({ programSession: MANUAL_DAY, at: '2026-08-01T08:00:00+10:00' }),
      // Already tagged by TN-75 after the cutoff: untouched, and not even listed (not NULL).
      pullTagged: await workout({ programSession: PULL, at: '2026-10-01T08:00:00+10:00', phaseType: 'baseline' }),
      // Another account's identical baseline-shaped session: out of scope under --user.
      otherBaseline: await workout({ user: OTHER, programSession: null, at: '2026-09-08T08:00:00+10:00' }),
    }
  })

  it('writes nothing without --write, and lists matches and near misses', async () => {
    const lines: string[] = []
    const res = await run([`--user=${USER}`], env(), (l: string) => lines.push(l))

    expect(res.written).toBe(0)
    expect(res.matches.map((r: { workout_session_id: string }) => r.workout_session_id))
      .toEqual([ids.upperBaseline, ids.lowerBaseline])
    expect(res.nearMisses.map((r: { workout_session_id: string }) => r.workout_session_id).sort())
      .toEqual([ids.manualFirst, ids.pushSkipped, ids.pushShort].sort())
    for (const id of Object.values(ids)) {
      expect(await tagOf(id)).toBe(id === ids.pullTagged ? 'baseline' : null)
    }
    expect(lines).toContain('affected dates: 2026-09-08, 2026-09-09')
    expect(lines.at(-1)).toMatch(/dry run: nothing written/)
  })

  it('tags exactly the matches with --write, and a second run writes nothing', async () => {
    const first = await run([`--user=${USER}`, '--write'], env(), quiet)
    expect(first).toMatchObject({ predicted: 2, written: 2 })
    expect(await tagOf(ids.upperBaseline)).toBe('baseline')
    expect(await tagOf(ids.lowerBaseline)).toBe('baseline')
    for (const k of ['lowerDeleted', 'upperNext', 'pushSkipped', 'pushShort', 'manualFirst', 'otherBaseline']) {
      expect(await tagOf(ids[k])).toBeNull()
    }

    const second = await run([`--user=${USER}`, '--write'], env(), quiet)
    expect(second).toMatchObject({ predicted: 0, written: 0 })
  })

  // Nothing at or after TN-75 is considered: from then on the server tags at write time, so a NULL
  // there is a session that was not a baseline.
  it('ignores sessions at or after the cutoff', async () => {
    const res = await run([`--user=${USER}`, '--cutoff=2026-09-09T00:00:00+10:00'], env(), quiet)
    expect(res.matches.map((r: { workout_session_id: string }) => r.workout_session_id)).toEqual([ids.upperBaseline])
  })
})
