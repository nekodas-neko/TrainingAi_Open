/**
 * RV-63 — the `> 0` predicate that used to live in `/api/collection`, asserted where it now lives.
 *
 * The route read `listBodyMetrics` / `listSleepSessions` in FULL — 36 and 25 columns, 176 and 144
 * bytes a row, over all history, on every home paint — and immediately projected to `.map(x =>
 * x.date)`. The reads are one column wide now and carry the predicate in SQL.
 *
 * **Two route-level tests changed because of that, and this file is why that is not a loss.** They
 * asserted that a LOW day still spawns a cat (400 steps, 3.5 h) — "recorded, not above a bar", which
 * is a measured decision: only 35 of the owner's 130 step-days reach 8,000, so a threshold would
 * decay the steps ladder most weeks. The route can no longer prove it, because it no longer sees the
 * value. This does, against a real Postgres.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000630'

describe.skipIf(!canRun)('RV-63 — collection day keys', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepositoryAsync>>

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'rv63@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    repo = await (await import('@/lib/data')).getRepositoryAsync()
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
  })

  const steps = (date: string, n: number | null) =>
    pool.query(`INSERT INTO body_metrics (user_id, date, steps) VALUES ($1,$2,$3)`, [USER, date, n])
  // `sleep_start` and `sleep_end` are both NOT NULL, so a night fixture carries a window even when
  // the duration is the only field under test — and the window is deliberately NOT derived from `h`,
  // because the point of these cases is that the read keys on the stored `duration_hours` column
  // rather than on anything recomputed from the timestamps.
  const slept = (date: string, h: number | null) =>
    pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours)
       VALUES ($1,$2,$3,$4,$5)`,
      [USER, date, new Date(`${date}T12:00:00Z`), new Date(`${date}T19:00:00Z`), h])

  const ALL = ['2000-01-01', '2099-12-31'] as const

  /** THE case the route can no longer make: a low day is still a recorded day. */
  it('keeps a low step count — recorded, not above a bar', async () => {
    await steps('2026-09-10', 12_000)
    await steps('2026-09-11', 400)

    expect((await repo.listStepDayKeys(USER, ...ALL)).sort())
      .toEqual(['2026-09-10', '2026-09-11'])
  })

  it('keeps a short night for the same reason', async () => {
    await slept('2026-09-10', 8)
    await slept('2026-09-11', 3.5)

    expect((await repo.listSleepDayKeys(USER, ...ALL)).sort())
      .toEqual(['2026-09-10', '2026-09-11'])
  })

  /** The other half: zero and NULL are not recordings. NULL matters because `> 0` is not `!= 0` in
   *  SQL — a NULL comparison is UNKNOWN, which the WHERE drops, and that is the behaviour wanted
   *  here but it is worth pinning rather than inheriting by luck. */
  it.each([
    ['zero', 0],
    ['null', null],
  ])('drops a %s step day', async (_label, value) => {
    await steps('2026-09-10', 5_000)
    await steps('2026-09-11', value as number | null)

    expect(await repo.listStepDayKeys(USER, ...ALL)).toEqual(['2026-09-10'])
  })

  it.each([
    ['zero', 0],
    ['null', null],
  ])('drops a %s sleep night', async (_label, value) => {
    await slept('2026-09-10', 7)
    await slept('2026-09-11', value as number | null)

    expect(await repo.listSleepDayKeys(USER, ...ALL)).toEqual(['2026-09-10'])
  })

  /** The window still bounds, even though the caller passes all history — a floor that silently
   *  ignored `from`/`to` would pass every case above. */
  it('honours the from/to bounds', async () => {
    await steps('2026-09-01', 5_000)
    await steps('2026-09-10', 5_000)

    expect(await repo.listStepDayKeys(USER, '2026-09-05', '2026-09-30')).toEqual(['2026-09-10'])
  })

  /** Scoped to the caller: another user's recorded day is not this user's. */
  it('returns nothing for a user with no rows', async () => {
    await steps('2026-09-10', 5_000)

    expect(await repo.listStepDayKeys('00000000-0000-4000-8000-0000000006ff', ...ALL)).toEqual([])
  })
})
