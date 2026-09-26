// LA-150 — a session that ENDED before the first heart-rate reading is not pending work.
//
// Both HR backfill work lists floored their scan at a flat 180-day retention window. But
// `oura_heartrate` is younger than its own window — production's first row is 2026-06-22 — so every
// session between the retention floor and that date matched the predicate forever. Measured in
// production 2026-09-26: the per-set list held 33 pending, **33 of them unfillable**; the
// whole-session list 36 pending, **34 unfillable and 2 real**. Every run reported the same count
// and filled nothing, which reads exactly like a broken backfill — the device agent hit that on
// 2026-09-24 and reasonably asked whether the raw samples had been pruned.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000a150'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('LA-150 — the HR backfill work lists exclude what they can never fill', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/oura')
  let since: Date

  /** A completed session with one logged set, at `daysAgo`. Returns its id. */
  async function session(daysAgo: number): Promise<string> {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'LA150', now() - ($2 || ' days')::interval,
               now() - ($2 || ' days')::interval + interval '1 hour') RETURNING id`,
      [USER, String(daysAgo)])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'LA150 Bench', 100, now()) RETURNING id`, [ws.id])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_start_ms, set_end_ms)
       VALUES ($1, 1, 50, 5, 1000, 2000)`, [el.id])
    return ws.id
  }

  const heartrateAt = (daysAgo: number) => pool.query(
    `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
     VALUES ($1, now() - ($2 || ' days')::interval, 60, 'test') ON CONFLICT DO NOTHING`,
    [USER, String(daysAgo)])

  const setList = () => slice.listSessionsMissingSetHrStats(db, USER, since, 50)
  const wholeList = () => slice.listSessionsMissingHrStats(db, USER, since, 50)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'la150@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    // Everything is derived from the clock, never a literal — a fixture pinned to a fixed date
    // passes until the day it falls outside the window (CLAUDE.md, Date Arithmetic).
    since = new Date(Date.now() - 180 * 86_400_000)
  })

  it('drops a session that finished before the first reading, and keeps one that finished after', async () => {
    const tooOld = await session(30)   // ended 30 days ago
    const recent = await session(5)    // ended 5 days ago
    // TWO readings, deliberately: the bound is the FIRST one. A single-row fixture cannot tell
    // MIN from MAX — a mutation swapping them survived the first draft of this file — and MAX
    // would exclude every session older than the latest reading, which in production is nearly
    // all of them.
    await heartrateAt(10)              // first reading, 10 days ago
    await heartrateAt(1)               // latest reading, yesterday

    expect((await setList()).map(r => r.id)).toEqual([recent])
    expect((await wholeList()).map(r => r.id)).toEqual([recent])
    expect((await setList()).map(r => r.id)).not.toContain(tooOld)
  })

  it('keeps a session that STARTED before the first reading but ran across it', async () => {
    // The reason the bound is on completed_at rather than started_at. This session began before
    // the reading existed and ended after, so part of its window is coverable — flooring on the
    // start would discard real work.
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'LA150 straddle', now() - interval '3 hours', now() - interval '1 hour')
       RETURNING id`, [USER])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'LA150 Row', 100, now()) RETURNING id`, [ws.id])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_start_ms, set_end_ms)
       VALUES ($1, 1, 50, 5, 1000, 2000)`, [el.id])
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
       VALUES ($1, now() - interval '2 hours', 60, 'test')`, [USER])

    expect((await setList()).map(r => r.id)).toContain(ws.id)
    expect((await wholeList()).map(r => r.id)).toContain(ws.id)
  })

  it('returns nothing at all when there are no readings, rather than every session forever', async () => {
    // The production shape before the fix, in miniature: sessions in the window, no heart-rate
    // data that could ever reach them. A NULL from the MIN() subquery excludes them, which is
    // why the empty case needs no special handling.
    await session(30)
    await session(5)

    expect(await setList()).toEqual([])
    expect(await wholeList()).toEqual([])
  })

  it('still honours the retention floor — the new bound narrows, never widens', async () => {
    await session(300)     // older than 180 days
    await heartrateAt(365) // a reading old enough that only the retention floor can exclude it

    expect(await setList()).toEqual([])
    expect(await wholeList()).toEqual([])
  })
})
