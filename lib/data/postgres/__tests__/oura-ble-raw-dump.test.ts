// getOuraRawSamplesByTags — the frame-dump diagnostic behind the tester's "Dump step
// frames" button (used to crack the undecoded 0x7e/0x7f step-feature layout). Verifies
// it returns rows for the requested tags only, newest-first by ring clock, carrying the
// archival body_hex. Uses the real captured step-frame hexes.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d00f'

describe.skipIf(!canRun)('getOuraRawSamplesByTags — frame dump', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-dump-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])

    // Real captured step-feature frames (before + after a 100-step walk) + an activity
    // frame + an off-target HR frame that the tag filter must exclude.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
         ($1, 100, 126, 'real_step_event_feature_1', '88824ca85557625864de41114b5f', NULL),
         ($1, 400, 126, 'real_step_event_feature_1', '69ee4423465b4b9a74a842873561', NULL),
         ($1, 100, 127, 'real_step_event_feature_2', '50675c0950165a353582af696b76', NULL),
         ($1, 400, 127, 'real_step_event_feature_2', '685b57dd5a3449525496a2388800', NULL),
         ($1, 400,  80, 'activity_information', '78130a0c0c0a0a0c0c0b0c2142', $2::jsonb),
         ($1, 400, 128, 'ibi_and_amplitude_event', 'aa', NULL)`,
      [TEST_USER_ID, JSON.stringify({ met: [1.9, 6.6], state: 120 })],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('returns only the requested tags, newest ring clock first', async () => {
    const rows = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [0x7e, 0x7f], 100)
    expect(rows).toHaveLength(4)
    // No off-target tags leaked in.
    expect(rows.every((r) => r.tag === 0x7e || r.tag === 0x7f)).toBe(true)
    // Newest ring clock first (ds=400 rows precede ds=100 rows).
    expect(rows.map((r) => r.ringTimestampDs)).toEqual([400, 400, 100, 100])
    // The archival hex round-trips for the decode work.
    const newest7e = rows.find((r) => r.tag === 0x7e && r.ringTimestampDs === 400)
    expect(newest7e?.bodyHex).toBe('69ee4423465b4b9a74a842873561')
  })

  it('honours the limit and includes the activity family + decoded payload', async () => {
    const rows = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [0x7e, 0x7f, 0x50], 3)
    expect(rows).toHaveLength(3)
    const activity = (await repo.getOuraRawSamplesByTags(TEST_USER_ID, [0x50], 10))[0]
    expect(activity.eventName).toBe('activity_information')
    expect((activity.decoded as { state?: number })?.state).toBe(120)
  })

  it('returns [] for no tags', async () => {
    expect(await repo.getOuraRawSamplesByTags(TEST_USER_ID, [], 100)).toEqual([])
  })
})
