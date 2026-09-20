import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

/**
 * TN-54 — the strap went dark on 2026-09-15 and nothing server-side recorded why.
 *
 * `PolarStrapService` already knew: battery in a `private var`, the give-up path logging "strap not
 * reachable" to `onLog`, and a `status()` object that went to the Capacitor event sink and no
 * table. So a strap that died, ran flat, or never connected was indistinguishable from one that was
 * not worn — from every surface except having the app open while it happened.
 *
 * The assertions below are about that distinction, not about storage. A test that only proved rows
 * round-trip would pass on a table that recorded `state` and dropped `last_sample_at`, which is the
 * one field that answers whether a night counted.
 *
 * Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
 */
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054001'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('TN-54 strap status', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const clientMod = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = clientMod.getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `tn54-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM strap_status WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM strap_status WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('records a give-up, which previously reached no table at all', async () => {
    await repo.insertStrapStatus(TEST_USER_ID, {
      state: 'stopped',
      batteryPercent: 12,
      lastSampleAt: new Date('2026-09-15T23:11:00Z'),
      consecutiveFailures: 6,
      worn: false,
    })
    const latest = await repo.getLatestStrapStatus(TEST_USER_ID)
    expect(latest).not.toBeNull()
    expect(latest!.state).toBe('stopped')
    expect(latest!.consecutiveFailures).toBe(6)
    expect(latest!.batteryPercent).toBe(12)
    // The field the whole entry turns on: the strap's own last good sample.
    expect(latest!.lastSampleAt?.toISOString()).toBe('2026-09-15T23:11:00.000Z')
    expect(latest!.worn).toBe(false)
  })

  it('distinguishes "never reported" from "reported unreachable"', async () => {
    // Null is the honest answer for every day before this shipped, and a caller must be able to
    // tell it from a strap that reported. Conflating them is the defect, one layer up.
    expect(await repo.getLatestStrapStatus(TEST_USER_ID)).toBeNull()
    await repo.insertStrapStatus(TEST_USER_ID, {
      state: 'disconnected', batteryPercent: null, lastSampleAt: null,
      consecutiveFailures: 3, worn: null,
    })
    const latest = await repo.getLatestStrapStatus(TEST_USER_ID)
    expect(latest).not.toBeNull()
    expect(latest!.state).toBe('disconnected')
    expect(latest!.batteryPercent).toBeNull()
    expect(latest!.lastSampleAt).toBeNull()
  })

  it('returns the newest row, not the first — a stale "connected" is the failure it must not show',
    async () => {
      await repo.insertStrapStatus(TEST_USER_ID, {
        state: 'ready', batteryPercent: 80, lastSampleAt: null, consecutiveFailures: 0, worn: true,
      })
      await new Promise(r => setTimeout(r, 15))
      await repo.insertStrapStatus(TEST_USER_ID, {
        state: 'stopped', batteryPercent: 4, lastSampleAt: null, consecutiveFailures: 6, worn: false,
      })
      const latest = await repo.getLatestStrapStatus(TEST_USER_ID)
      expect(latest!.state).toBe('stopped')
      expect(latest!.batteryPercent).toBe(4)
    })

  it('lists the recent series newest-first and honours the window', async () => {
    for (const state of ['ready', 'disconnected', 'stopped']) {
      await repo.insertStrapStatus(TEST_USER_ID, {
        state, batteryPercent: null, lastSampleAt: null, consecutiveFailures: 0, worn: null,
      })
      await new Promise(r => setTimeout(r, 10))
    }
    // Backdate one row outside the window to prove `since` is applied rather than decorative.
    await pool.query(
      `UPDATE strap_status SET recorded_at = now() - interval '30 days'
        WHERE user_id = $1 AND state = 'ready'`, [TEST_USER_ID])

    const recent = await repo.listStrapStatus(TEST_USER_ID, new Date(Date.now() - 7 * 86_400_000), 200)
    expect(recent.map(r => r.state)).toEqual(['stopped', 'disconnected'])
  })

  it('accepts a state the schema has never seen — an enum here would reject the novel fault', async () => {
    // The states belong to the service, and the one worth recording is the one nobody predicted.
    await repo.insertStrapStatus(TEST_USER_ID, {
      state: 'firmware-handshake-timeout', batteryPercent: null, lastSampleAt: null,
      consecutiveFailures: 1, worn: null,
    })
    expect((await repo.getLatestStrapStatus(TEST_USER_ID))!.state).toBe('firmware-handshake-timeout')
  })
})
