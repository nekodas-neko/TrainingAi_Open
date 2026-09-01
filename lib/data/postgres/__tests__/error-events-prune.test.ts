/**
 * BF-93 — `error_events` prunes at 30 days, and this is the test that says so.
 *
 * **This file exists because the prune was reported missing while it was working.** A session
 * searched for a retention path on 2026-09-01, concluded *"no `DELETE FROM error_events` outside
 * tests, no `pg_cron`, no retention trigger"*, and wrote that into CLAUDE.md — the file every
 * session reads first — along with a Known-Issues row and a queue entry. The `DELETE` was in
 * `insertErrorEvent` the whole time, and has been since the initial public snapshot.
 *
 * **The evidence that convinced it was what a working prune looks like.** The prune fires from a
 * write path, not a scheduler (this app has no cron layer), so it only runs when a fault is
 * recorded — and faults are now rare. Between them the oldest row drifts past 30 days. Measured
 * against production the same day: last write **2026-08-30**, oldest row **2026-07-31**, span
 * exactly **30 days**, matching the cutoff computed from the last write to the day. Reading the age
 * against *today* rather than against the *last write* is the whole mistake.
 *
 * So the assertion is behavioural, not a grep: write a fault, and a row older than the window is
 * gone afterwards. A grep for the SQL is what failed the first time.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bf93'

describe.skipIf(!canRun)('error_events retention', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  const countOlderThan = async (days: number) => Number((await pool.query(
    `SELECT count(*)::int AS n FROM error_events
      WHERE user_id = $1 AND created_at < now() - make_interval(days => $2)`, [USER, days])).rows[0].n)

  const seedAged = async (daysAgo: number, message: string) => {
    await pool.query(
      `INSERT INTO error_events (user_id, source, message, created_at)
       VALUES ($1, 'server', $2, now() - make_interval(days => $3))`, [USER, message, daysAgo])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `bf93-prune-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM error_events WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM error_events WHERE user_id = $1', [USER])
  })

  /**
   * The prune is throttled to once a day by a module-level timestamp that starts at 0, so the first
   * write after a process start always prunes. That is the case asserted here, and it is also the
   * production case: the app restarts far more often than daily.
   */
  it('a recorded fault takes rows past the 30-day window with it', async () => {
    await seedAged(45, 'BF-93 well past the window')
    await seedAged(31, 'BF-93 just past the window')
    await seedAged(29, 'BF-93 just inside the window')
    expect(await countOlderThan(30)).toBe(2)

    await repo.insertErrorEvent({ userId: USER, source: 'server', message: 'BF-93 fresh fault' })

    // Fired from the write path, so it has run by the time the insert resolves — or shortly after;
    // the DELETE is deliberately not awaited so a slow prune cannot delay recording a fault.
    await new Promise(r => setTimeout(r, 250))

    expect(await countOlderThan(30), 'rows past the window survived a write').toBe(0)
    // And nothing inside the window was taken with them.
    const { rows } = await pool.query(
      `SELECT message FROM error_events WHERE user_id = $1 ORDER BY created_at`, [USER])
    expect(rows.map(r => r.message)).toEqual(['BF-93 just inside the window', 'BF-93 fresh fault'])
  })

  /**
   * The property that makes the table's age look wrong without being wrong. A prune fired from a
   * write path cannot run when nothing is written, so between faults the oldest row ages past the
   * window — which is exactly what production showed, and exactly what was mistaken for an absent
   * prune.
   */
  it('does nothing on its own while no fault is recorded', async () => {
    await seedAged(45, 'BF-93 aged, and nothing is writing')
    await new Promise(r => setTimeout(r, 100))
    expect(await countOlderThan(30), 'a row expired with no write to trigger the prune').toBe(1)
  })
})
