// #2813 — the two native-client readbacks, against a real Postgres: one food item by id, and one
// supplement's log for one local date with the manual tick kept apart from food-derived doses.
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000002813'
const OTHER = '00000000-0000-4000-8000-000000012813'
const FOOD_ID = '00000000-0000-4000-8000-00000000f813'
const DAY = '2026-10-15'

describe.skipIf(!canRun)('read food item and supplement day (#2813)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const cleanup = async () => {
    await pool.query(`DELETE FROM supplements WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[OWNER, OTHER]])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, tz] of [[OWNER, 'Pacific/Auckland'], [OTHER, 'Australia/Brisbane']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
        [id, `r2813-${id}@example.com`, tz])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
  })

  beforeEach(cleanup)

  describe('getFoodItemById', () => {
    const create = () => repo.createFoodItem(OWNER, {
      id: FOOD_ID, name: 'Oats', brand: null, servingSizeG: 40, calories: 150,
      proteinG: 5, carbsG: 27, fatG: 3, source: 'manual', region: 'AU',
    } as never)

    it('returns the owner their item with the same shape the list route returns', async () => {
      await create()
      const got = await repo.getFoodItemById(OWNER, FOOD_ID)
      expect(got).toMatchObject({ id: FOOD_ID, userId: OWNER, name: 'Oats', calories: 150 })
      const [listed] = await repo.searchFoodItems(OWNER, 'oats')
      expect(got).toEqual(listed)
    })

    it('returns null for another user\'s id, exactly as for an unknown id', async () => {
      await create()
      expect(await repo.getFoodItemById(OTHER, FOOD_ID)).toBeNull()
      expect(await repo.getFoodItemById(OWNER, '00000000-0000-4000-8000-0000000fffff')).toBeNull()
    })

    it('finds an item the name search would cut off at 20', async () => {
      for (let i = 0; i < 25; i++) {
        await repo.createFoodItem(OWNER, {
          name: `Bulk ${i}`, brand: null, servingSizeG: 100, calories: 100 + i,
          proteinG: 0, carbsG: 0, fatG: 0, source: 'manual', region: 'AU',
        } as never)
      }
      await create()
      expect((await repo.searchFoodItems(OWNER, '')).length).toBe(20)
      expect((await repo.getFoodItemById(OWNER, FOOD_ID))?.id).toBe(FOOD_ID)
    })
  })

  describe('getSupplementDayLog', () => {
    const makeSup = (userId = OWNER) => repo.createSupplement(userId, {
      name: 'Creatine', dose: '5 g', defaultAmount: 5, unit: 'g',
      reminderEnabled: false, reminderTime: null, sortOrder: 0, active: true,
    } as never)
    const addMeal = (supId: string, amount: number, ref: string, date = DAY) => pool.query(
      `INSERT INTO supplement_logs (supplement_id, user_id, log_date, amount, unit, source, source_ref)
       VALUES ($1, $2, $3, $4, 'g', 'meal', $5)`, [supId, OWNER, date, amount, ref])

    it('splits the manual tick from food-derived doses and totals them', async () => {
      const sup = await makeSup()
      await repo.logSupplement(sup.id, OWNER, DAY)
      await addMeal(sup.id, 3, '00000000-0000-4000-8000-0000000f0001')
      await addMeal(sup.id, 2, '00000000-0000-4000-8000-0000000f0002')

      const day = await repo.getSupplementDayLog(OWNER, sup.id, DAY)
      expect(day.date).toBe(DAY)
      expect(day.manual).toMatchObject({ amount: 5, unit: 'g', sourceRef: null })
      expect(day.foodDerived.map(f => f.amount).sort()).toEqual([2, 3])
      expect(day.foodDerived.every(f => f.sourceRef != null)).toBe(true)
      expect(day.total).toMatchObject({ amount: 10, unit: 'g', contributions: 3 })
    })

    it('after the tick is removed, manual is null while the food-derived dose remains', async () => {
      const sup = await makeSup()
      await repo.logSupplement(sup.id, OWNER, DAY)
      await addMeal(sup.id, 3, '00000000-0000-4000-8000-0000000f0001')
      await repo.unlogSupplement(sup.id, OWNER, DAY)

      const day = await repo.getSupplementDayLog(OWNER, sup.id, DAY)
      expect(day.manual).toBeNull()
      expect(day.foodDerived).toHaveLength(1)
      expect(day.total).toMatchObject({ amount: 3, contributions: 1 })
    })

    it('reads only the date asked for, for a log made at local midnight in a non-UTC zone', async () => {
      // 2026-10-15 00:30 in Auckland (UTC+13) is 2026-10-14 11:30 UTC. The log_date is the local
      // day, so the read must find it under the 15th and not the 14th.
      const sup = await makeSup()
      await repo.logSupplement(sup.id, OWNER, DAY)
      await pool.query(`UPDATE supplement_logs SET taken_at = '2026-10-14T11:30:00Z' WHERE supplement_id = $1`, [sup.id])

      expect((await repo.getSupplementDayLog(OWNER, sup.id, '2026-10-15')).manual).not.toBeNull()
      expect((await repo.getSupplementDayLog(OWNER, sup.id, '2026-10-14')).manual).toBeNull()
      expect((await repo.getSupplementDayLog(OWNER, sup.id, '2026-10-14')).total).toBeNull()
    })

    it('refuses another user\'s supplement and an unknown id the same way', async () => {
      const sup = await makeSup()
      await expect(repo.getSupplementDayLog(OTHER, sup.id, DAY)).rejects.toThrow('Supplement not found')
      await expect(repo.getSupplementDayLog(OWNER, '00000000-0000-4000-8000-0000000fffff', DAY))
        .rejects.toThrow('Supplement not found')
    })

    it('flags a deleted definition rather than hiding its logs', async () => {
      const sup = await makeSup()
      await repo.logSupplement(sup.id, OWNER, DAY)
      await repo.deleteSupplement(sup.id, OWNER)
      const day = await repo.getSupplementDayLog(OWNER, sup.id, DAY)
      expect(day.supplementDeleted).toBe(true)
    })
  })
})
