// LA-139 — the daytime-signal read must resolve against the WHOLE anchor series, not the newest.
//
// An anchor is one `(ring_ds ↔ utc)` observation. Measured on production 2026-09-25 the table
// holds **12,545** of them, and **39 of the 40 most recent consecutive pairs disagree by more than
// 60 s** about the ring's clock rate — worst 3,359 s — because each is stamped per drained batch,
// so a backfill writes a pair describing history rather than now. Three consecutive anchors written
// within 4 real seconds carried ring times ~19 minutes apart.
//
// `getOuraClockAnchors`' own comment states the contract: reads that convert a ds "resolve it
// against the observation nearest *that frame*, not the newest". Six readers in the adapter already
// do, via `resolveDsToMs`/`resolveMsToDs`, which take a ROBUST offset across the epoch. Four did
// not — including `getOuraDaytimeSignals`, which feeds training stress and the temperature series.
//
// This pins the production one. With a deliberately skewed newest anchor, a frame must still land
// where the bulk of the series says it does.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000139'
const EPOCH = 1
// Truth: ds 1_000_000 is exactly this instant, per the bulk of the anchors.
const TRUE_MS = Date.parse('2026-09-23T02:00:00.000Z')
const TRUE_DS = 1_000_000

describe.skipIf(!canRun)('daytime signals resolve against the anchor series (LA-139)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `la139-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
  })

  const addAnchor = (ds: number, utcMs: number, createdMs: number) => pool.query(
    `INSERT INTO oura_ble_clock_anchors (user_id, epoch, anchor_ds, anchor_utc, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [USER, EPOCH, ds, new Date(utcMs), new Date(createdMs)])

  // One activity_information frame (0x50): state byte then one MET bin of 0x14 = 2.0 MET.
  const addMetFrame = (ds: number) => pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex)
     VALUES ($1, $2, $3, $4, $5)`, [USER, ds, 0x50, 'activity_information', '0014'])

  it('a skewed NEWEST anchor does not drag the timestamp with it', async () => {
    // Five honest observations agreeing that ds 1_000_000 == TRUE_MS, then a sixth written last
    // that is an hour out — the backfill shape. Taking the newest alone moves every frame an hour.
    for (let k = 0; k < 5; k++) {
      await addAnchor(TRUE_DS + k * 600, TRUE_MS + k * 60_000, TRUE_MS + k * 60_000)
    }
    await addAnchor(TRUE_DS + 5 * 600, TRUE_MS + 5 * 60_000 + 3_600_000, TRUE_MS + 5 * 60_000 + 10)

    await addMetFrame(TRUE_DS)
    const { met } = await repo.getOuraDaytimeSignals(
      USER, new Date(TRUE_MS - 6 * 3600_000), new Date(TRUE_MS + 6 * 3600_000))

    expect(met.length, 'the frame is inside the window').toBe(1)
    // Within two minutes of the truth. The single-newest reading lands ~an hour away.
    expect(Math.abs(met[0].tsMs - TRUE_MS)).toBeLessThan(120_000)
    expect(met[0].value).toBeCloseTo(2.0, 5)
  })

  it('with no anchors at all it returns empty rather than guessing', async () => {
    await addMetFrame(TRUE_DS)
    const out = await repo.getOuraDaytimeSignals(
      USER, new Date(TRUE_MS - 3600_000), new Date(TRUE_MS + 3600_000))
    expect(out).toEqual({ temp: [], met: [] })
  })
})
