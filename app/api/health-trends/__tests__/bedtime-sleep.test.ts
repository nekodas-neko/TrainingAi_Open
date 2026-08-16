// Q-77 — bedtime vs sleep duration, and the coding trap that inverts it.
//
// Measured over production before the view was built: bedtime → sleep duration is the strongest
// relationship in the dataset (r|t = −0.534, p < 0.001, n = 52), a slope of −0.70 h per hour later
// to bed. The danger is not the statistics, it is the encoding: bedtimes wrap at midnight, so a raw
// clock hour puts 00:30 (0.5) BELOW 22:30 (22.5) and turns the latest nights into the earliest
// points. That coding produced r = +0.75 against efficiency in the review's own first pass and read
// as "later bedtime → better sleep" at high apparent significance.
//
// These drive the real route against Postgres, so they cover the encoding, the night filtering and
// the significance gate together.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000b7e77'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

const get = async () => {
  const { GET } = await import('../route')
  const res = await GET(new Request('http://localhost/api/health-trends?view=bedtime-sleep') as never)
  return res.json()
}

describe.skipIf(!canRun)('health-trends bedtime-sleep (Q-77)', () => {
  let pool: import('pg').Pool
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bedtime-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  /**
   * One night `daysAgo` back: asleep at `bedHour` local (fractional, may be ≥ 24 for after-midnight)
   * for `hours`. Every night is seeded relative to the real clock so nothing here is pinned to an
   * absolute date — the 90-day window this route reads is a rolling one.
   */
  async function night(daysAgo: number, bedHour: number, hours: number) {
    const start = new Date(mid.getTime() - daysAgo * 86_400_000 + bedHour * 3_600_000)
    const end = new Date(start.getTime() + hours * 3_600_000)
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency)
       VALUES ($1, $2, $3, $4, $5, 90) ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, formatInTimeZone(end, TZ, 'yyyy-MM-dd'), start, end, hours],
    )
  }

  /**
   * Seed the production shape: later to bed → less sleep, with a wake time that does not move much.
   * Bedtimes are spread across the midnight boundary on purpose — that is the whole point.
   * A little variation keeps the series non-constant without perturbing the direction.
   */
  async function seedRealisticSpread() {
    for (let i = 0; i < 30; i++) {
      // −3 h .. +2 h around 22:00, so roughly a third of the nights start after midnight.
      const bedHour = 21 + (i % 6) + (i % 3) * 0.25
      await night(i + 1, bedHour, 9.5 - (bedHour - 21) * 0.7)
    }
  }

  it('finds the real relationship and reports it as significant', async () => {
    await seedRealisticSpread()
    const data = await get()
    expect(data.hasSufficientData).toBe(true)
    expect(data.withheld).toBeUndefined()
    // Negative r: later to bed (higher minutes-from-noon) → fewer hours.
    expect(data.stats.r).toBeLessThan(-0.5)
    expect(data.stats.p).toBeLessThan(0.05)
    expect(data.stats.n).toBeGreaterThanOrEqual(20)
    expect(data.insight).toMatch(/You sleep .* on nights you're in bed/)
  })

  it('does not invert across the midnight boundary — the after-midnight nights bucket last', async () => {
    await seedRealisticSpread()
    const data = await get()
    const byLabel = new Map<string, { avg: number; count: number }>(
      data.buckets.map((b: { label: string; avg: number; count: number }) => [b.label, b]),
    )
    const early = byLabel.get('before 22:00')
    const late = byLabel.get('after 23:00')
    expect(early).toBeDefined()
    expect(late).toBeDefined()
    // Under raw-clock-hour coding a 01:00 bedtime scores 1 and lands in `before 22:00`, which is
    // what made the whole finding reverse. Minutes-from-noon puts it at 780 — firmly in the last
    // bucket, where it belongs.
    expect(late!.avg).toBeLessThan(early!.avg)
    expect(late!.count).toBeGreaterThan(0)
  })

  it('counts nights, not rows — an evening nap is not a bedtime', async () => {
    await seedRealisticSpread()
    const before = (await get()).stats.n
    // Ten 12-minute evening dozes at 19:20, each on a date that already has a night. Coded as
    // bedtimes they are ten spuriously "early" points with almost no sleep attached — the exact
    // shape that would manufacture a much steeper slope.
    for (let i = 0; i < 10; i++) await night(i + 1, 19.33, 0.2)
    const after = await get()
    expect(after.stats.n).toBe(before)
  })
})
