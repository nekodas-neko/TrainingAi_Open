// BF-2 step 2. The pairing rule is unit-tested as a pure function; what this covers is the half a
// pure test cannot reach — that the two reads pull the right columns, that `source_map->>
// 'body_fat_pct'` is where provenance actually lives, and that both arms are scoped to one user.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000bfc01'
const USER_B = '00000000-0000-4000-8000-0000000bfc02'

describe.skipIf(!canRun)('getBodyFatCalibration', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `bf-cal-${tag}@example.com`])
      await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [id])
    }
    await pool.end()
  })

  async function seedScan(userId: string, scannedOn: string, pctFat: number) {
    await pool.query(
      `INSERT INTO dexa_scans (user_id, scanned_on, pct_fat, source) VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (user_id, scanned_on) DO UPDATE SET pct_fat = EXCLUDED.pct_fat`,
      [userId, scannedOn, pctFat])
  }

  async function seedReading(userId: string, date: string, bodyFatPct: number, source: string | null) {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, body_fat_pct, source_map)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, date) DO UPDATE SET body_fat_pct = EXCLUDED.body_fat_pct, source_map = EXCLUDED.source_map`,
      [userId, date, bodyFatPct, source == null ? null : JSON.stringify({ body_fat_pct: source })])
  }

  it('returns null with no scan, so a calibration is absent rather than zero', async () => {
    await seedReading(USER_A, '2026-08-27', 25.3, 'scale_ble')
    expect(await repo.getBodyFatCalibration(USER_A)).toBeNull()
  })

  it('derives the owner-shaped offset from a real same-day pair', async () => {
    await seedScan(USER_A, '2026-08-27', 28.5)
    const cal = await repo.getBodyFatCalibration(USER_A)
    expect(cal).not.toBeNull()
    expect(cal!.offsetPct).toBe(3.2)
    expect(cal!.source).toBe('scale_ble')
    expect(cal!.pairs).toEqual([
      { scannedOn: '2026-08-27', scaleDate: '2026-08-27', referencePct: 28.5, measuredPct: 25.3 },
    ])
  })

  // The provenance key is `source_map->>'body_fat_pct'`, not a column and not a row-level source.
  // If that path is ever read wrongly the calibration silently covers nothing.
  it('does not pair a reading whose body_fat_pct provenance is another instrument', async () => {
    await seedReading(USER_A, '2026-08-27', 25.3, 'health_connect')
    expect(await repo.getBodyFatCalibration(USER_A)).toBeNull()
    await seedReading(USER_A, '2026-08-27', 25.3, 'scale_ble')
  })

  it('does not pair a reading with no recorded provenance', async () => {
    await seedReading(USER_A, '2026-08-27', 25.3, null)
    expect(await repo.getBodyFatCalibration(USER_A)).toBeNull()
    await seedReading(USER_A, '2026-08-27', 25.3, 'scale_ble')
  })

  it('reads a non-default instrument when asked for one', async () => {
    await seedReading(USER_A, '2026-08-26', 22.8, 'health_connect')
    const cal = await repo.getBodyFatCalibration(USER_A, 'health_connect')
    expect(cal!.offsetPct).toBe(5.7)
    expect(cal!.pairs[0].scaleDate).toBe('2026-08-26')
  })

  // Both arms are user-scoped. One unscoped arm and B's scan calibrates A's scale.
  it("never reaches another user's scan or reading", async () => {
    await seedScan(USER_B, '2026-08-27', 40)
    await seedReading(USER_B, '2026-08-27', 20, 'scale_ble')
    const a = await repo.getBodyFatCalibration(USER_A)
    expect(a!.offsetPct).toBe(3.2)
    expect(a!.pairs).toHaveLength(1)
    const b = await repo.getBodyFatCalibration(USER_B)
    expect(b!.offsetPct).toBe(20)
  })
})
