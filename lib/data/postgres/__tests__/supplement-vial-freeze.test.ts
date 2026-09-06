import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { unitsForMg, frozenReconstitution } from '@trainingai/shared/health/vial-dose'

// OR-102a. The half that cannot be repaired afterwards: the reconstitution is stamped on the LOG,
// not only on the vial.
//
// Mix the next vial at a different water volume and the same milligram dose becomes a different
// number of syringe units. The stored mg stays correct, so nothing looks wrong — a historical
// "15 units" just quietly starts meaning something else. This is BF-3's dose freezing one layer up,
// and the test that matters is the one that re-mixes and checks the OLD log did not move.
const USER = '00000000-0000-4000-8000-000000102a01'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('a log freezes the reconstitution it was dosed from (OR-102a)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let supplementId: string

  const logRow = async () => (await pool.query<{
    taken_at: Date | null
    vial_strength_mg: number | null
    vial_water_ml: number | null
    vial_units_per_ml: number | null
  }>(
    `SELECT taken_at, vial_strength_mg, vial_water_ml, vial_units_per_ml
     FROM supplement_logs WHERE user_id = $1 AND deleted_at IS NULL ORDER BY log_date`, [USER])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    pool = getPool()
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `or102a-${USER}@example.com`])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM supplements WHERE user_id = $1', [USER])
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO supplements (user_id, name, reminder_enabled, sort_order, active)
       VALUES ($1, 'Reta', false, 0, true) RETURNING id`, [USER])
    supplementId = rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM supplements WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  it('stamps the current vial onto the log', async () => {
    await repo.createSupplementVial(USER, {
      supplementId, strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01',
    })
    await repo.logSupplement(supplementId, USER, '2026-09-02', { amount: 2.5, unit: 'mg' })

    const [row] = await logRow()
    expect(row.vial_strength_mg).toBe(10)
    expect(row.vial_water_ml).toBe(2)
    expect(row.vial_units_per_ml).toBe(100)
  })

  // THE test. Re-mixing must not move a dose already recorded.
  it('a vial mixed at a different volume does not rewrite an earlier dose', async () => {
    await repo.createSupplementVial(USER, {
      supplementId, strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01',
    })
    await repo.logSupplement(supplementId, USER, '2026-09-02', { amount: 2.5, unit: 'mg' })

    // Weeks later, the next vial goes in at half the water.
    await repo.createSupplementVial(USER, {
      supplementId, strengthMg: 10, waterMl: 1, syringeUnitsPerMl: 100, openedOn: '2026-09-20',
    })
    await repo.logSupplement(supplementId, USER, '2026-09-21', { amount: 2.5, unit: 'mg' })

    const [older, newer] = await logRow()
    expect(older.vial_water_ml).toBe(2)
    expect(newer.vial_water_ml).toBe(1)

    // The same 2.5 mg, read back through each log's own stamp: 50 units then, 25 units now.
    // Without the freeze both would render as 25 and the earlier entry would be a lie.
    expect(unitsForMg(2.5, frozenReconstitution({
      vialStrengthMg: older.vial_strength_mg, vialWaterMl: older.vial_water_ml,
      vialUnitsPerMl: older.vial_units_per_ml,
    })!)).toBe(50)
    expect(unitsForMg(2.5, frozenReconstitution({
      vialStrengthMg: newer.vial_strength_mg, vialWaterMl: newer.vial_water_ml,
      vialUnitsPerMl: newer.vial_units_per_ml,
    })!)).toBe(25)
  })

  it('records a time, so hours-since-dose exists at all', async () => {
    const before = Date.now()
    await repo.logSupplement(supplementId, USER, '2026-09-02')
    const [row] = await logRow()
    expect(row.taken_at).not.toBeNull()
    expect(row.taken_at!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('takes an explicit time over the moment of the tick', async () => {
    const at = '2026-09-02T07:30:00.000Z'
    await repo.logSupplement(supplementId, USER, '2026-09-02', { takenAt: at })
    const [row] = await logRow()
    expect(row.taken_at!.toISOString()).toBe(at)
  })

  // A substance with no vial is most of them. Stamping nulls is what makes
  // `frozenReconstitution()` answer "cannot be expressed in units" rather than reaching for
  // whatever vial happens to be current when the row is read.
  it('stamps nulls when the supplement has no vial, rather than guessing', async () => {
    await repo.logSupplement(supplementId, USER, '2026-09-02', { amount: 2.5, unit: 'mg' })
    const [row] = await logRow()
    expect(row.vial_strength_mg).toBeNull()
    expect(frozenReconstitution({
      vialStrengthMg: row.vial_strength_mg, vialWaterMl: row.vial_water_ml,
      vialUnitsPerMl: row.vial_units_per_ml,
    })).toBeNull()
  })

  describe('the sticky default', () => {
    it('is the newest vial by opened_on', async () => {
      await repo.createSupplementVial(USER, { supplementId, strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01' })
      await repo.createSupplementVial(USER, { supplementId, strengthMg: 10, waterMl: 1, syringeUnitsPerMl: 100, openedOn: '2026-09-20' })
      expect((await repo.currentSupplementVial(USER, supplementId))!.waterMl).toBe(1)
    })

    it('skips a deleted vial', async () => {
      await repo.createSupplementVial(USER, { supplementId, strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01' })
      const newer = await repo.createSupplementVial(USER, { supplementId, strengthMg: 10, waterMl: 1, syringeUnitsPerMl: 100, openedOn: '2026-09-20' })
      expect(await repo.deleteSupplementVial(newer.id, USER)).toBe(true)
      expect((await repo.currentSupplementVial(USER, supplementId))!.waterMl).toBe(2)
    })

    it('is null when nothing has been mixed', async () => {
      expect(await repo.currentSupplementVial(USER, supplementId)).toBeNull()
    })
  })

  it('refuses a vial against a supplement that is not yours', async () => {
    const OTHER = '00000000-0000-4000-8000-000000102a02'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [OTHER, `or102a-other@example.com`])
    await expect(repo.createSupplementVial(OTHER, {
      supplementId, strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01',
    })).rejects.toThrow(/not found/i)
    await pool.query('DELETE FROM users WHERE id = $1', [OTHER])
  })
})
