// Issue 2399 — migration 202610170604 marks four logs of the 2026-08-13 "Upper" session as the deload
// they were, and re-derives the two bests they were holding.
//
// Unlike 163, this migration names production row ids, so the fixture uses them: the session, the
// four flagged logs and the two 2026-08-21 logs the bests fall back to. Everything else is made up.
//
// Runs only against a real Postgres. NOTE: CI's "Tests" job DOES set DATABASE_URL, so these run
// there; reproduce CI locally by setting it too, or vitest silently skips them.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-000000002399'
const OTHER = '00000000-0000-4000-8000-000000012399'

const SESSION = '812fffde-0be9-408e-8612-cd56f4ef9ca2'
const PULLDOWN = '07115bca-c74f-4b22-9de9-af9575cb16af'
const OHP = '5c001cac-cc87-4b50-aacd-524a55ee5938'
const SKULL = '6bcb61ba-0adc-423a-af07-6403658219c8'
const PREACHER = '2685de45-7952-4245-929f-8a70576e68a6'
const INCLINE = 'e3022b01-0000-4000-8000-000000002399'
const SKULL_NEXT = '795e3c10-8a2b-400a-9bba-ddb2db5431f9'
const PREACHER_NEXT = '3a1c6f8e-6352-48c7-9763-0826ea22b83a'
const FLAGGED = [PULLDOWN, OHP, SKULL, PREACHER]

const migrationSql = () =>
  readFileSync(
    join(process.cwd(), 'lib/data/postgres/migrations/202610170604_deload_correction_2026_08_13.sql'),
    'utf8',
  )

describe.skipIf(!canRun)('migration 202610170604 — 2026-08-13 deload correction (issue 2399)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [OWNER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `i2399-${id}@example.com`],
      )
    }
  })

  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM exercise_logs WHERE workout_session_id IN (SELECT id FROM workout_sessions WHERE user_id = ANY($1))`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
  })

  async function session(userId: string, startedAt: string, opts: { id?: string; phaseType?: string | null; earlyDeload?: boolean } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, phase_type, is_early_deload)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, 'Upper', $3, $4, $5) RETURNING id`,
      [opts.id ?? null, userId, startedAt, opts.phaseType ?? null, opts.earlyDeload ?? false],
    )
    return rows[0].id as string
  }

  async function log(sessionId: string, name: string, oneRm: number, loggedAt: string, opts: { id?: string; deloaded?: boolean } = {}) {
    await pool.query(
      `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, estimated_1rm, logged_at, exercise_deloaded)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)`,
      [opts.id ?? null, sessionId, name, oneRm, loggedAt, opts.deloaded ?? false],
    )
  }

  const pr = (userId: string, name: string, oneRm: number, achievedAt: string) =>
    pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1,$2,$3,$4)`,
      [userId, name, oneRm, achievedAt],
    )

  beforeEach(async () => {
    await lock.acquire()
    for (const id of [OWNER, OTHER]) {
      await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM exercise_logs WHERE workout_session_id IN (SELECT id FROM workout_sessions WHERE user_id = $1)`, [id])
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
    }

    // Earlier history. A deload-phase Skull Crusher and a flagged Preacher Curl sit above the
    // fallback bests, so the re-derivation has to apply the gate, not just take the next number down.
    const july = await session(OWNER, '2026-07-03T00:30:00Z')
    await log(july, 'Cable Pulldown', 36, '2026-07-03T00:43:54Z')
    const deloadWeek = await session(OWNER, '2026-08-06T21:40:00Z', { phaseType: 'deload' })
    await log(deloadWeek, 'Barbell Skull Crusher', 60, '2026-08-06T22:00:00Z')
    const earlyDeload = await session(OWNER, '2026-08-08T21:40:00Z', { earlyDeload: true })
    await log(earlyDeload, 'Cable Preacher Curl', 21, '2026-08-08T22:00:00Z')
    const flaggedDay = await session(OWNER, '2026-08-10T21:40:00Z')
    await log(flaggedDay, 'Cable Preacher Curl', 20, '2026-08-10T22:00:00Z', { deloaded: true })

    // The 2026-08-13 session as production holds it.
    await session(OWNER, '2026-08-13T22:28:00Z', { id: SESSION })
    await log(SESSION, 'Incline Bench Press', 76.5, '2026-08-13T22:35:00Z', { id: INCLINE })
    await log(SESSION, 'Barbell Overhead Press', 57.75, '2026-08-13T22:45:00Z', { id: OHP })
    await log(SESSION, 'Barbell Skull Crusher', 57.75, '2026-08-13T22:55:00Z', { id: SKULL })
    await log(SESSION, 'Cable Preacher Curl', 19.25, '2026-08-13T23:05:00Z', { id: PREACHER })
    await log(SESSION, 'Cable Pulldown', 31.25, '2026-08-13T23:15:00Z', { id: PULLDOWN })

    // The later eligible logs.
    const aug21 = await session(OWNER, '2026-08-21T22:00:00Z')
    await log(aug21, 'Barbell Overhead Press', 58, '2026-08-21T22:10:00Z')
    await log(aug21, 'Barbell Skull Crusher', 49.75, '2026-08-21T22:20:00Z', { id: SKULL_NEXT })
    await log(aug21, 'Cable Preacher Curl', 18.75, '2026-08-21T22:30:00Z', { id: PREACHER_NEXT })
    const aug28 = await session(OWNER, '2026-08-28T22:00:00Z')
    await log(aug28, 'Barbell Skull Crusher', 49.75, '2026-08-28T22:20:00Z')

    await pr(OWNER, 'Barbell Skull Crusher', 57.75, '2026-08-13T22:55:00Z')
    await pr(OWNER, 'Cable Preacher Curl', 19.25, '2026-08-13T23:05:00Z')
    await pr(OWNER, 'Cable Pulldown', 36, '2026-07-03T00:43:54Z')
    await pr(OWNER, 'Barbell Overhead Press', 58, '2026-08-21T22:10:00Z')
    await pr(OWNER, 'Incline Bench Press', 76.5, '2026-08-13T22:35:00Z')

    // Another account with the same lift and the same value: it shares nothing with those ids.
    const other = await session(OTHER, '2026-08-13T22:00:00Z')
    await log(other, 'Barbell Skull Crusher', 57.75, '2026-08-13T22:10:00Z')
    await log(other, 'Barbell Skull Crusher', 40, '2026-08-20T22:10:00Z')
    await pr(OTHER, 'Barbell Skull Crusher', 57.75, '2026-08-13T22:10:00Z')
  })

  const run = () => runMigrationSql(pool, migrationSql())

  const logs = async () => (await pool.query(
    `SELECT el.id, el.exercise_deloaded, el.estimated_1rm, el.updated_at, el.client_edited_at
     FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE ws.user_id = ANY($1) ORDER BY el.id`,
    [[OWNER, OTHER]],
  )).rows

  const bests = async (userId: string) => Object.fromEntries((await pool.query(
    `SELECT exercise_name, estimated_1rm, achieved_at FROM personal_records WHERE user_id = $1`,
    [userId],
  )).rows.map(r => [r.exercise_name, { e1rm: Number(r.estimated_1rm), at: new Date(r.achieved_at).toISOString() }]))

  it('marks exactly the four logs as deloaded and leaves Incline Bench alone', async () => {
    const before = new Map((await logs()).map(r => [r.id, r]))

    await run()

    const after = await logs()
    for (const row of after) {
      const was = before.get(row.id)!
      if (FLAGGED.includes(row.id)) {
        expect(row.exercise_deloaded).toBe(true)
        // Moved so the pull delta carries it, and stamped so a stale offline copy cannot win.
        expect(new Date(row.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(was.updated_at).getTime())
        expect(row.client_edited_at).not.toBeNull()
      } else {
        expect(row).toEqual(was)
      }
      // The stored estimate is history and is not rewritten.
      expect(row.estimated_1rm).toBe(was.estimated_1rm)
    }
    expect(after.find(r => r.id === INCLINE)!.exercise_deloaded).toBe(false)
  })

  it('drops Skull Crusher to 49.75 and Preacher Curl to 18.75, dated by the earliest eligible log', async () => {
    await run()

    const b = await bests(OWNER)
    expect(b['Barbell Skull Crusher']).toEqual({ e1rm: 49.75, at: '2026-08-21T22:20:00.000Z' })
    expect(b['Cable Preacher Curl']).toEqual({ e1rm: 18.75, at: '2026-08-21T22:30:00.000Z' })
  })

  it('does not move the bests that come from other sessions, or another account\'s', async () => {
    const owner = await bests(OWNER)
    const other = await bests(OTHER)

    await run()

    const after = await bests(OWNER)
    expect(after['Cable Pulldown']).toEqual(owner['Cable Pulldown'])
    expect(after['Barbell Overhead Press']).toEqual(owner['Barbell Overhead Press'])
    expect(after['Incline Bench Press']).toEqual(owner['Incline Bench Press'])
    expect(await bests(OTHER)).toEqual(other)
  })

  it('changes nothing on a second run', async () => {
    await run()
    const logsOnce = await logs()
    const ownerOnce = await bests(OWNER)
    const otherOnce = await bests(OTHER)

    await run()

    expect(await logs()).toEqual(logsOnce)
    expect(await bests(OWNER)).toEqual(ownerOnce)
    expect(await bests(OTHER)).toEqual(otherOnce)
  })
})
