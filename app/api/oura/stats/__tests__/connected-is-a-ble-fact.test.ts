// `connected` used to mean "a row in `oura_tokens` holds a Cloud credential". That stopped
// describing the ring at the 2026-07-07 direct-BLE re-key and only kept describing the dead row left
// behind — so when the Cloud integration was removed (Q-224) and the token storage went with it,
// this flag would have gone permanently false and silently taken the Health tab's entire Ring
// section with it (`components/health/oura-section.tsx` returns null on `!data.connected`).
//
// Nothing would have failed. The section would just have stopped rendering, on a screen no sandbox
// test opens. So the flag is a BLE fact now, and this pins that: a user with raw BLE samples and no
// token is connected, and a user with neither is not.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const RING_USER = '00000000-0000-4000-8000-000000000224'
const BARE_USER = '00000000-0000-4000-8000-000000000225'
const TZ = 'Australia/Brisbane'

let currentUser = RING_USER
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: currentUser, timezone: TZ } })),
}))

describe.skipIf(!canRun)('/api/oura/stats — connected reflects the ring, not a stored credential', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [RING_USER, BARE_USER]) {
      await pool.query(
        `INSERT INTO users (id, email, name) VALUES ($1, $2, 'Q224')
         ON CONFLICT (id) DO NOTHING`,
        [id, `q224-${id.slice(-3)}@local.dev`],
      )
      await pool.query('DELETE FROM oura_raw_samples WHERE user_id = $1', [id])
    }
    // One BLE sample for the ring user, none for the bare user. No `oura_tokens` row for either —
    // that table is exactly what this route no longer consults.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, measured_at)
       VALUES ($1, 1, 1, 'q224-fixture', 'q224', now())
       ON CONFLICT DO NOTHING`,
      [RING_USER],
    )
  })

  afterAll(async () => {
    for (const id of [RING_USER, BARE_USER]) {
      await pool.query('DELETE FROM oura_raw_samples WHERE user_id = $1', [id])
      await pool.query('DELETE FROM users WHERE id = $1', [id])
    }
  })

  it('a ring that has produced BLE samples is connected, with no token anywhere', async () => {
    currentUser = RING_USER
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.connected).toBe(true)
  })

  it('a user whose ring has never reported is not connected', async () => {
    currentUser = BARE_USER
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.connected).toBe(false)
    expect(body.daily).toBeNull()
  })
})
