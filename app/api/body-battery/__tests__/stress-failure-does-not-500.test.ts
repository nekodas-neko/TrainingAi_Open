// TN-4: `/api/body-battery` threw 31 × HTTP 500 between 10:37 and 20:59 UTC on 2026-08-23 with
// `daytime-stress: constants not set`, then stopped on its own. Nothing fixed it — per CLAUDE.md,
// something that stopped is not something that was fixed, so the root cause is still open.
//
// What is closed is the blast radius. `buildDaytimeStressSeriesFromModel` was called outside any
// try, so its throw reached the route's outer catch and took the WHOLE Body Battery card down when
// only the stress strip was unavailable. This test is the one that fails if that guard is removed:
// the stress builder is mocked to throw exactly what the production rows recorded, and the route
// must still answer 200 with a real battery reading.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005d1'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

// The production failure verbatim. Mocked at the module the route imports it from, so the guard is
// what is under test rather than the constants-loading machinery behind it.
vi.mock('@/lib/health/daytime-stress', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/health/daytime-stress')>()
  return {
    ...actual,
    buildDaytimeStressSeriesFromModel: () => {
      throw new Error(
        'daytime-stress: constants not set — call setDaytimeStressConstants() first ' +
          '(server: ensureServerOuraConstants() from lib/oura-models/constants/server-inject)',
      )
    },
  }
})

// The stress branch is gated on `dhrvModel && dhrvBaseline != null && tempBaseline != null &&
// tempBaseline > 0`. `tempBaseline` is averaged from `getOuraDaytimeSignals`, which decodes raw BLE
// frames — seeding real ones needs a ring-clock anchor and valid `body_hex`, which is far more
// machinery than a try/catch warrants. Overriding that ONE repository method is what makes the
// branch reachable.
//
// This override is load-bearing and was added after the fact: the first version of this test seeded
// only the dHRV model row, left `tempBaseline` null, and so never entered the branch at all — it
// passed identically with the guard removed. A vacuous regression test is worse than none, because
// it reads as coverage.
vi.mock('@/lib/data', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/data')>()
  return {
    ...actual,
    getRepository: async () => {
      const real = await actual.getRepository()
      const base = Date.now() - 3 * 3_600_000
      return new Proxy(real as object, {
        get(target, prop, recv) {
          if (prop === 'getOuraDaytimeSignals') {
            return async () => ({
              temp: Array.from({ length: 12 }, (_, i) => ({ tsMs: base + i * 900_000, valueC: 36.4 })),
              met: Array.from({ length: 12 }, (_, i) => ({ tsMs: base + i * 900_000, value: 1.2 })),
            })
          }
          const v = Reflect.get(target, prop, recv)
          return typeof v === 'function' ? v.bind(target) : v
        },
      }) as typeof real
    },
  }
})

describe.skipIf(!canRun)('body-battery — a stress-model failure must not 500 the card (TN-4)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz(TZ)
    mid = todayMidnightUtc(TZ)

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bb-stressfail-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_battery_daily WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM error_events WHERE user_id = $1`, [TEST_USER_ID])

    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
    for (let i = 0; i < 14; i++) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, hrv_ms, resting_heart_rate)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, date) DO UPDATE SET hrv_ms = EXCLUDED.hrv_ms,
           resting_heart_rate = EXCLUDED.resting_heart_rate`,
        [TEST_USER_ID, shiftDateStr(today, -i), 60 + (i % 3), 52 + (i % 2)],
      )
    }

    // Waking heart rate, so the walk has something to integrate and the response carries a real
    // reading rather than an empty-data placeholder that would pass this test vacuously.
    for (let m = 0; m < 180; m += 5) {
      await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
         VALUES ($1, $2, $3, 'ble') ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, new Date(mid.getTime() + (7 * 60 + m) * 60_000), 70 + (m % 20)],
      )
    }

    // The stress branch is gated on a fitted dHRV model existing. Without this row the route skips
    // the call entirely and the guard under test is never reached — the test would pass without
    // proving anything.
    await pool.query(
      `INSERT INTO oura_daytime_hrv_model (user_id, intercept, hr_coef, temp_coef, residual_std, n_samples)
       VALUES ($1, 40, -0.3, 1.2, 5, 500)
       ON CONFLICT (user_id) DO UPDATE SET intercept = EXCLUDED.intercept`,
      [TEST_USER_ID],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('answers 200 with a battery reading when the stress series throws', async () => {
    const { GET } = await import('../route')
    const res = await GET()

    // Before the guard this was a 500 and the card rendered nothing at all.
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(typeof body.current).toBe('number')
    expect(body.current).toBeGreaterThanOrEqual(0)
    expect(body.current).toBeLessThanOrEqual(100)
    // The stress strip degrades rather than the card failing: with no series the STRESS_DRAIN_RATE
    // term is simply never applied, which is what `stressAt` returning null already meant.
    expect(body.stressDrained ?? 0).toBe(0)
  })

  // TN-7. The guard above is right and stays, but its catch only called `console.error`, which
  // reaches no table — so from TN-4's deploy onward a recurrence of the fault that fired 31 times
  // produced no row anywhere. LA-20's Known-Issues row is waiting on an `error_events` count over a
  // window where this route was called; with the guard and without the report that count is zero
  // whether or not the root cause is fixed, so the condition could no longer fail and no longer
  // distinguished anything. This asserts the trace, not just the 200.
  it('leaves a row in error_events, so a recurrence is still visible', async () => {
    const { GET } = await import('../route')
    expect((await GET()).status).toBe(200)

    // `reportServerError` is fire-and-forget by design — it must never delay or mask the response —
    // so the row lands after GET resolves and the assertion has to poll for it rather than read once.
    // (BF-18 is the same lesson from the other direction: asserting an async phase with no wait
    // passes on an idle machine and fails on a loaded runner.)
    //
    // The COUNT is deliberately not asserted. The sibling test above calls `GET()` too and therefore
    // reports too, and its write is fire-and-forget — so whether one row or two are visible here is
    // a statement about which write won a race, not about the route. The first version of this test
    // asserted exactly one: it passed locally and failed in CI with `expected […, …] to have a
    // length of 1 but got 2`, which is BF-18's defect one file over and written by the same session
    // that had just fixed it.
    const STRESS_URL = '/api/body-battery#stress'
    const deadline = Date.now() + 5_000
    let rows: { url: string; message: string }[] = []
    while (Date.now() < deadline) {
      rows = (await pool.query(
        `SELECT url, message FROM error_events WHERE user_id = $1 AND source = 'server'`,
        [TEST_USER_ID])).rows
      if (rows.some(r => r.url === STRESS_URL)) break
      await new Promise(r => setTimeout(r, 50))
    }

    // The fragment is what makes the row attributable to the stress strip rather than to the outer
    // catch, which reports the same route without it.
    const stress = rows.filter(r => r.url === STRESS_URL)
    expect(stress.length).toBeGreaterThan(0)
    expect(stress[0].message).toContain('daytime-stress: constants not set')
    // And nothing may have reached the OUTER catch — that is the 500 this guard exists to remove.
    // Order-independent, so this stays meaningful however the two writes interleave.
    expect(rows.filter(r => r.url === '/api/body-battery')).toEqual([])
  })
})
