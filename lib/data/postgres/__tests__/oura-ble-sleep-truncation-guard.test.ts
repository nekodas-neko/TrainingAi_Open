// Q-225: the owner reported a bedtime of 1:15am for a night the ring's own data puts at 22:40.
// The mechanism, confirmed by local reproduction at the time: `aggregateOuraRawSamples` reads an
// incremental window (`rollupCutoffDs`), and a night whose early frames fall *before* that cutoff
// comes back TRUNCATED rather than absent. The clusterer then derives a window starting at the
// cutoff instead of at real sleep onset, and the sleep write — which deletes by wake-day before
// inserting — replaces the previously-correct row with the clipped one. Deterministic on re-run,
// and repaired only by a `fullHistory` Redecode.
//
// `run.ts` guards it by dropping any night whose start is not clear of the cutoff by MAX_SLEEP_DS.
// That guard had NO test: neutralising it left all 23 rollup files and 68 tests green (measured
// 2026-08-30), so a refactor could delete it and nothing would say so.
//
// The entry records three synthetic fixtures that failed to discriminate. This one differs in the
// two ways that matter:
//   1. **No `bedtime_period` (0x76) event.** That event carries an explicit `bedtime_start_ds` and
//      is stamped at the night's END, so it survives any narrowing — a night carrying one cannot
//      exhibit the bug at all. The owner's night had none, so clustering is what gets cut.
//   2. **The cutoff is placed INSIDE the night, deliberately.** `rollupCutoffDs` is
//      `sinceDs - 3 days` (the margin `summaryFloorDate` needs), so a `sinceDs` near the night
//      leaves the cutoff days clear of it and nothing clips. `sinceDs` here is set to
//      `nightStart + 3 days + 4 h`, which lands the cutoff four hours into the night.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000225001'
const TZ = 'Australia/Brisbane'

const DS_PER_DAY = 24 * 3600 * 10
const DS_PER_HOUR = 3600 * 10
const NOW_DS = 60_000_000
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'

// Five days back, so the 35-day window floor is nowhere near it and only `sinceDs` can clip.
const NIGHT_START = NOW_DS - 5 * DS_PER_DAY
const NIGHT_END = NIGHT_START + 8 * DS_PER_HOUR
// Four hours into the night, once the 3-day margin is subtracted.
const CUT_INTO_NIGHT_DS = 4 * DS_PER_HOUR
const NARROW_SINCE_DS = NIGHT_START + 3 * DS_PER_DAY + CUT_INTO_NIGHT_DS

// A second night, NEWER than the cutoff by more than MAX_SLEEP_DS, so the guard keeps it. It is the
// control: whatever happens to the straddling night, this one must still be written, otherwise a
// test that "passes" might just be observing a run that wrote nothing at all. It has to be newer
// rather than older — a night before the cutoff is not read at all, so it would prove nothing.
const CLEAR_NIGHT_START = NOW_DS - 3 * DS_PER_DAY
const CLEAR_NIGHT_END = CLEAR_NIGHT_START + 8 * DS_PER_HOUR

// sleep_acm_period (0x72) and sleep_temp (0x75) fire only while asleep and are the clusterer's
// primary window source; IBI (0x80) supplies the HR density that `clampToDenseSensing` reads, so a
// uniform spread over the window keeps the clamp a no-op and the seeded span is the derived span.
async function seedNight(pool: import('pg').Pool, startDs: number, endDs: number, hrBase: number) {
  const values: string[] = []
  const params: unknown[] = []
  const push = (ds: number, tag: number, name: string, decoded: string) => {
    const b = params.length
    values.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
    params.push(ds, tag, name, decoded)
  }
  // Every 5 minutes, so no gap approaches the clusterer's 2 h night split.
  for (let ds = startDs; ds <= endDs; ds += 5 * 60 * 10) {
    push(ds, 0x72, 'sleep_acm_period', '{}')
    push(ds, 0x75, 'sleep_temp', '{}')
  }
  const hr = JSON.stringify({ hr_bpm: Array.from({ length: 60 }, (_, i) => hrBase + (i % 10)) })
  for (let r = 0; r < 40; r++) push(startDs + Math.floor((r / 40) * (endDs - startDs)), 0x80, 'ibi_and_amplitude_event', hr)

  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — a night straddling the read cutoff is not rewritten narrow', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const TABLES = ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-truncation-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedNight(pool, NIGHT_START, NIGHT_END, 50)
    await seedNight(pool, CLEAR_NIGHT_START, CLEAR_NIGHT_END, 54)
  })

  beforeEach(async () => {
    // Each case starts from the state a healthy full run leaves behind: both nights correct, and
    // no watermark, so `effectiveSinceDs` is the case's own `sinceDs` rather than a leftover.
    //
    // Deleting the watermark is not a cheat, but it IS what makes the straddle constructible: in
    // normal operation the persisted watermark is the older of the two spans and pulls the cutoff
    // back clear of the night, which is the 3-day margin's whole job. The guard is the backstop for
    // when it does not — a watermark read as null because the ring's clock epoch changed, or a cold
    // run with no `sinceDs` at all, where the cutoff falls back to the 35-day window floor. Every
    // night crosses that floor exactly once, so this is reachable rather than hypothetical.
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  // The assertion is on the WINDOW (sleep_start → sleep_end), which is what Q-225 is about — the
  // owner saw a bedtime of 1:15am. `duration_hours` is time-ASLEEP from the stager and reads 0 here
  // because the sleepnet model is not present in the sandbox, so it cannot carry this test.
  async function nights() {
    const { rows } = await pool.query<{ date: string; sleep_start: Date; sleep_end: Date }>(
      `SELECT date::text AS date, sleep_start, sleep_end FROM sleep_sessions
       WHERE user_id = $1 ORDER BY sleep_start`,
      [TEST_USER_ID],
    )
    return rows.map(r => ({
      date: r.date,
      start: r.sleep_start.toISOString(),
      spanHours: (r.sleep_end.getTime() - r.sleep_start.getTime()) / 3_600_000,
    }))
  }

  it('the full run derives both nights at their real length', async () => {
    const rows = await nights()
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.spanHours).toBeGreaterThan(7.5)
  })

  it('a narrowed run whose cutoff lands mid-night leaves the correct row in place', async () => {
    const before = await nights()
    expect(before).toHaveLength(2)

    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { sinceDs: NARROW_SINCE_DS })

    // Unguarded, the straddling night re-derives from its surviving frames only — a window opening
    // at the cutoff, roughly four hours short — and the wake-day delete replaces the good row with
    // it. The clear night is the control: it must survive either way, so an assertion that passes
    // here is not just observing a run that wrote nothing.
    expect(await nights()).toEqual(before)
  })

  it('the truncated night is skipped rather than written short', async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])

    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { sinceDs: NARROW_SINCE_DS })

    // With no prior row to protect, the guard's effect is visible directly: the straddling night
    // produces nothing rather than a short row. The clear night still must be written — asserting
    // only "no short row exists" would pass just as well on an empty table.
    const rows = await nights()
    expect(rows).toHaveLength(1)
    expect(rows[0].spanHours).toBeGreaterThan(7.5)
  })
})
