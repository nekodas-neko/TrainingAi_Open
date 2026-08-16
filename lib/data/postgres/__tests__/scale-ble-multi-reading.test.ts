// Multi-weigh-in-per-day gating (docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md
// follow-up, 2026-07-29): later same-day readings still archive to scale_raw_samples, and which one
// owns the body_metrics trend is decided here.
//
// **Q-69 (2026-08-04) changed the rule from first-wins to lowest-wins** — a first reading taken
// clothed used to be stuck as the day's value with no correction path. `weight_kg` is now read out
// rather than existence-checked, so `applyScaleReadingToBodyMetrics` can compare against it.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005ca'
/** The "other account" for the scoping case. Owned by this file so it cannot collide with seed data. */
const OTHER_USER_ID = '00000000-0000-4000-8000-0000000005cb'
const TZ = 'Australia/Brisbane' // UTC+10, no DST

describe.skipIf(!canRun)('scale-ble multi-reading gating', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `scale-multi-${TEST_USER_ID}@example.com`, TZ],
    )
    // The scoping case needs a *second* account, and it has to be one this file owns. It used to
    // borrow whatever `SELECT id FROM users WHERE id <> $1 LIMIT 1` returned, which failed both
    // ways: locally that picks the seeded dev user, who already has a body_metrics row on the
    // hardcoded date (the seed generates ~2 weeks relative to today), so the insert hit
    // body_metrics_user_id_date_key; in CI nothing is seeded, so the SELECT matched nothing, the
    // INSERT was a no-op, and the assertion passed because there was no other reading at all.
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_USER_ID, `scale-multi-other-${OTHER_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = ANY($1)`, [[TEST_USER_ID, OTHER_USER_ID]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[TEST_USER_ID, OTHER_USER_ID]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  describe('getConfirmedScaleTrendForDate', () => {
    it('is null when no body_metrics row exists for the date', async () => {
      expect(await repo.getConfirmedScaleTrendForDate(TEST_USER_ID, '2026-07-29')).toBeNull()
    })

    it('is null when the day\'s weight came from a different source', async () => {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
         VALUES ($1, '2026-07-29', 71.2, '{"weight_kg": "health_connect"}'::jsonb)`,
        [TEST_USER_ID],
      )
      expect(await repo.getConfirmedScaleTrendForDate(TEST_USER_ID, '2026-07-29')).toBeNull()
    })

    it('is null for a manual weight — the rank merge owns that case, not this comparison', async () => {
      // Regression guard: if this ever returned a value, a lower scale reading would compare
      // against a manual entry and try to replace it. manual(5) outranks scale_ble(4) and must win
      // regardless of value; reading as "no scale trend" is what keeps that true.
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
         VALUES ($1, '2026-07-29', 80.0, '{"weight_kg": "manual"}'::jsonb)`,
        [TEST_USER_ID],
      )
      expect(await repo.getConfirmedScaleTrendForDate(TEST_USER_ID, '2026-07-29')).toBeNull()
    })

    it('returns the weight once a scale_ble reading has set the day\'s value', async () => {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
         VALUES ($1, '2026-07-29', 72.55, '{"weight_kg": "scale_ble"}'::jsonb)`,
        [TEST_USER_ID],
      )
      expect(await repo.getConfirmedScaleTrendForDate(TEST_USER_ID, '2026-07-29'))
        .toEqual({ weightKg: 72.55 })
    })

    it('is scoped to the user — another account\'s reading is not this one\'s trend', async () => {
      const { rowCount } = await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
         VALUES ($1, '2026-07-29', 60.0, '{"weight_kg": "scale_ble"}'::jsonb)`,
        [OTHER_USER_ID],
      )
      // Assert the fixture actually landed. Without this the test passes just as happily when the
      // other account's reading was never written, which is the state it used to reach in CI.
      expect(rowCount).toBe(1)

      expect(await repo.getConfirmedScaleTrendForDate(TEST_USER_ID, '2026-07-29')).toBeNull()
      await pool.query(`DELETE FROM body_metrics WHERE user_id = $1 AND date = '2026-07-29'`, [OTHER_USER_ID])
    })
  })

  describe('lowest-wins trend, end to end through the repository (Q-69)', () => {
    async function apply(weightKg: number) {
      const { applyScaleReadingToBodyMetrics } = await import('@/lib/scale-ble/apply-reading')
      return applyScaleReadingToBodyMetrics(repo, TEST_USER_ID, {
        // 2026-07-28 22:00Z = 08:00 AEST on the 29th.
        measuredAt: new Date('2026-07-28T22:00:00Z'), tz: TZ, weightKg, composition: null,
      })
    }
    const storedWeight = async () => {
      const { rows } = await pool.query(
        `SELECT weight_kg FROM body_metrics WHERE user_id = $1 AND date = '2026-07-29'`, [TEST_USER_ID])
      return rows[0] ? Number(rows[0].weight_kg) : null
    }

    it('first reading sets the trend', async () => {
      expect((await apply(84.1)).trendUpdated).toBe(true)
      expect(await storedWeight()).toBe(84.1)
    })

    it('a higher second reading leaves it alone', async () => {
      await apply(84.1)
      expect((await apply(85.6)).trendUpdated).toBe(false)
      expect(await storedWeight()).toBe(84.1)
    })

    it('a lower second reading replaces it — the clothed-first case', async () => {
      await apply(84.1)
      expect((await apply(82.4)).trendUpdated).toBe(true)
      expect(await storedWeight()).toBe(82.4)
    })

    it('a third reading between the two does not raise it back', async () => {
      await apply(84.1)
      await apply(82.4)
      expect((await apply(83.0)).trendUpdated).toBe(false)
      expect(await storedWeight()).toBe(82.4)
    })

    it('never overwrites a manual weight, however low the reading', async () => {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
         VALUES ($1, '2026-07-29', 80.0, '{"weight_kg": "manual"}'::jsonb)`,
        [TEST_USER_ID],
      )
      await apply(70.0)
      expect(await storedWeight()).toBe(80.0)
    })
  })

  describe('listConfirmedScaleSamplesForDate', () => {
    it('returns only confirmed same-local-day readings, oldest first', async () => {
      await pool.query(
        `INSERT INTO scale_raw_samples (user_id, measured_at, raw_hex, decoded, status) VALUES
           ($1, '2026-07-28T21:15:00Z', 'aa', '{"weightKg": 72.6}'::jsonb, 'confirmed'), -- 07:15am AEST 07-29
           ($1, '2026-07-29T08:40:00Z', 'bb', '{"weightKg": 73.9}'::jsonb, 'confirmed'), -- 06:40pm AEST 07-29
           ($1, '2026-07-29T09:00:00Z', 'cc', '{"weightKg": 99}'::jsonb,   'pending'),   -- same day, not confirmed
           ($1, '2026-07-28T13:00:00Z', 'dd', '{"weightKg": 70}'::jsonb,   'confirmed')  -- 11pm AEST 07-28 (prior day)
         `,
        [TEST_USER_ID],
      )
      const rows = await repo.listConfirmedScaleSamplesForDate(TEST_USER_ID, '2026-07-29', TZ)
      expect(rows.map(r => (r.decoded as { weightKg: number }).weightKg)).toEqual([72.6, 73.9])
    })

    it('returns an empty list when nothing was confirmed that day', async () => {
      const rows = await repo.listConfirmedScaleSamplesForDate(TEST_USER_ID, '2026-07-29', TZ)
      expect(rows).toEqual([])
    })
  })
})
