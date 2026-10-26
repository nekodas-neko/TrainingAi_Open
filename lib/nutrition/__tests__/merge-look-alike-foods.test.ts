// #2417. Merging look-alike foods: what was eaten does not change, extras are tombstoned and never
// deleted, a dry run writes nothing, a second run finds nothing, and a device that has not synced
// can still log against a retired food.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job when there is no database.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000241701'
const OTHER = '00000000-0000-4000-8000-000000241702'

describe.skipIf(!canRun)('mergeLookAlikeFoods (#2417)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let merge: typeof import('../merge-look-alike-foods').mergeLookAlikeFoods
  let nutrition: typeof import('@/lib/data/postgres/slices/nutrition')
  let repo: import('@/lib/data/repository').WorkoutRepository
  let mealTypeId: string

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    merge = (await import('../merge-look-alike-foods')).mergeLookAlikeFoods
    nutrition = await import('@/lib/data/postgres/slices/nutrition')
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const u of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [u, `merge-foods-${u}@example.com`],
      )
    }
  })

  const wipe = async () => {
    for (const u of [USER, OTHER]) {
      await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [u])
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [u])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [u])
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [u])
    }
  }
  afterAll(async () => {
    if (!canRun) return
    await wipe()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })
  beforeEach(async () => {
    await wipe()
    const { rows } = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1, 'Lunch') RETURNING id`, [USER])
    mealTypeId = rows[0].id
  })

  // One food at 2 kcal, 0.1 g protein, 0.25 g carbs, 0.05 g fat per gram, at any serving size.
  const dense = (servingSizeG: number, name = 'Test Granola') => ({
    name, brand: 'Sunsol', servingSizeG,
    calories: Math.round(servingSizeG * 2), proteinG: servingSizeG * 0.1, carbsG: servingSizeG * 0.25, fatG: servingSizeG * 0.05,
    source: 'manual' as const, region: 'AU',
  })
  const addFood = async (over: Partial<ReturnType<typeof dense>> & { userId?: string; createdAt?: string } = {}) => {
    const { userId = USER, createdAt, ...f } = { ...dense(100), ...over }
    const { rows } = await pool.query(
      `INSERT INTO food_items (user_id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, source, region, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, now())) RETURNING id`,
      [userId, f.name, f.brand, f.servingSizeG, f.calories, f.proteinG, f.carbsG, f.fatG, f.source, f.region, createdAt ?? null],
    )
    return rows[0].id as string
  }
  const addLog = async (foodItemId: string, qty: number, date = '2026-10-01', userId = USER) => {
    const { rows } = await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [userId, date, mealTypeId, foodItemId, qty],
    )
    return rows[0].id as string
  }
  /** What each log amounts to, read through its CURRENT food: grams, calories and macros. */
  const eaten = async () => {
    const { rows } = await pool.query(
      `SELECT fl.id, fl.quantity_multiplier * fi.serving_size_g AS grams, fl.quantity_multiplier * fi.calories AS kcal,
              fl.quantity_multiplier * fi.protein_g AS protein, fl.quantity_multiplier * fi.carbs_g AS carbs,
              fl.quantity_multiplier * fi.fat_g AS fat
         FROM food_logs fl JOIN food_items fi ON fi.id = fl.food_item_id WHERE fl.user_id = $1 ORDER BY fl.id`, [USER])
    return rows.map(r => ({ id: r.id, grams: +r.grams, kcal: +r.kcal, protein: +r.protein, carbs: +r.carbs, fat: +r.fat }))
  }
  const snapshot = async () => (await pool.query(
    `SELECT (SELECT md5(string_agg(f::text, '|' ORDER BY f.id)) FROM food_items f WHERE user_id = $1) AS items,
            (SELECT md5(string_agg(l::text, '|' ORDER BY l.id)) FROM food_logs l WHERE user_id = $1) AS logs,
            (SELECT md5(string_agg(m::text, '|' ORDER BY m.id)) FROM saved_meal_items m
               JOIN saved_meals sm ON sm.id = m.saved_meal_id WHERE sm.user_id = $1) AS meals`, [USER])).rows[0]
  const write = (keepers?: Record<string, string>) => merge(db, USER, { dryRun: false, keepers })
  const dry = (keepers?: Record<string, string>) => merge(db, USER, { dryRun: true, keepers })

  it.each([
    [30, 100], [45, 250], [100, 45], [250, 30], [100, 100],
  ])('grams, calories and macros are unchanged when a %i g food merges into a %i g keeper', async (extraG, keeperG) => {
    const keeper = await addFood({ ...dense(keeperG) })
    const extra = await addFood({ ...dense(extraG) })
    for (const q of [0.5, 1, 1.5, 2, 3.25]) await addLog(extra, q)
    for (let i = 0; i < 6; i++) await addLog(keeper, 1 + i)   // six logs against the extra's five: the keeper is the most-logged
    const before = await eaten()

    const out = await write()
    expect(out.ok && out.report.failedGroups).toBe(0)
    const after = await eaten()

    expect(after).toHaveLength(before.length)
    for (const [i, b] of before.entries()) {
      expect(after[i].id).toBe(b.id)
      expect(after[i].grams).toBeCloseTo(b.grams, 9)
      expect(after[i].kcal).toBeCloseTo(b.kcal, 9)
      expect(after[i].protein).toBeCloseTo(b.protein, 9)
      expect(after[i].carbs).toBeCloseTo(b.carbs, 9)
      expect(after[i].fat).toBeCloseTo(b.fat, 9)
    }
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM food_logs WHERE food_item_id = $1`, [extra])
    expect(rows[0].n).toBe(0)
  })

  it('tombstones the extra and never deletes it', async () => {
    const keeper = await addFood(); const extra = await addFood()
    await addLog(keeper, 1); await addLog(keeper, 1); await addLog(extra, 1)
    await write()
    const { rows } = await pool.query(`SELECT id, deleted_at FROM food_items WHERE user_id = $1`, [USER])
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === extra).deleted_at).not.toBeNull()
    expect(rows.find(r => r.id === keeper).deleted_at).toBeNull()
  })

  it('bumps updated_at on a moved log, which is what carries it to devices', async () => {
    const keeper = await addFood(); const extra = await addFood()
    await addLog(keeper, 1); await addLog(keeper, 1)
    const moved = await addLog(extra, 1)
    await pool.query(`UPDATE food_logs SET updated_at = '2026-01-01' WHERE id = $1`, [moved])
    await write()
    const { rows } = await pool.query(`SELECT updated_at > '2026-06-01' AS bumped, food_item_id FROM food_logs WHERE id = $1`, [moved])
    expect(rows[0]).toEqual({ bumped: true, food_item_id: keeper })
  })

  it('a dry run writes nothing and reports every group', async () => {
    const a = await addFood({ ...dense(100) }); const b = await addFood({ ...dense(45) })
    await addLog(a, 1); await addLog(a, 1); await addLog(b, 2)
    const c = await addFood({ ...dense(100, 'Other'), calories: 10 }); const d = await addFood({ ...dense(100, 'Other'), calories: 99 })
    await addLog(c, 1)
    const before = await snapshot()

    const out = await dry()
    expect(await snapshot()).toEqual(before)
    if (!out.ok) throw new Error(out.error)
    expect(out.report.dryRun).toBe(true)
    expect(out.report.totals).toMatchObject({ groups: 2, automatic: 1, needsReview: 1, extras: 2, logsToMove: 1 })
    const same = out.report.groups.find(g => g.name === 'Test Granola')!
    expect(same).toMatchObject({ kind: 'same-per-100g', automatic: true, keeperChosenBy: 'most-logged' })
    expect(same.keeper.id).toBe(a)
    expect(same.extras[0]).toMatchObject({ id: b, logsToMove: 1, factor: 0.45 })
    expect(out.report.groups.find(g => g.name === 'Other')).toMatchObject({ kind: 'differs', automatic: false })
    void d
  })

  it('is idempotent: a second run finds nothing and changes nothing', async () => {
    const a = await addFood(); const b = await addFood({ ...dense(45) })
    await addLog(a, 1); await addLog(a, 1); await addLog(b, 2)
    const first = await write()
    expect(first.ok && first.report.totals.groups).toBe(1)
    const after = await snapshot()
    const second = await write()
    expect(second.ok && second.report.totals).toMatchObject({ groups: 0, extras: 0, logsToMove: 0 })
    expect(await snapshot()).toEqual(after)
  })

  it('re-points saved-meal ingredients with the same rescale', async () => {
    const keeper = await addFood({ ...dense(100) }); const extra = await addFood({ ...dense(250) })
    await addLog(keeper, 1); await addLog(keeper, 1)
    const { rows: [meal] } = await pool.query(`INSERT INTO saved_meals (user_id, name) VALUES ($1, 'Bowl') RETURNING id`, [USER])
    await pool.query(`INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, 0.5)`, [meal.id, extra])
    await write()
    const { rows } = await pool.query(`SELECT food_item_id, quantity_multiplier FROM saved_meal_items WHERE saved_meal_id = $1`, [meal.id])
    expect(rows[0].food_item_id).toBe(keeper)
    expect(rows[0].quantity_multiplier * 100).toBeCloseTo(0.5 * 250, 9)
    const listed = await nutrition.listSavedMeals(db, USER)
    expect(listed[0].items[0].foodItem.id).toBe(keeper)
  })

  it('an owner pick names the keeper; a bad pick refuses the whole run, dry or not, and writes nothing', async () => {
    const popular = await addFood({ calories: 100 }); const picked = await addFood({ calories: 300 })
    await addLog(popular, 1); await addLog(popular, 1); await addLog(picked, 1)
    const key = 'test granola | sunsol'
    const before = await snapshot()

    const bad = await write({ [key]: crypto.randomUUID() })
    expect(bad.ok).toBe(false)
    expect((await dry({ 'no such | group': picked })).ok).toBe(false)
    expect(await snapshot()).toEqual(before)

    const out = await write({ [key]: picked })
    if (!out.ok) throw new Error(out.error)
    expect(out.report.groups[0]).toMatchObject({ keeperChosenBy: 'owner', automatic: false })
    const { rows } = await pool.query(`SELECT food_item_id FROM food_logs WHERE user_id = $1`, [USER])
    expect(new Set(rows.map(r => r.food_item_id))).toEqual(new Set([picked]))
  })

  it('the keeper takes a barcode and picture it lacks, and keeps its own', async () => {
    const keeper = await addFood(); const extra = await addFood()
    await addLog(keeper, 1); await addLog(keeper, 1)
    await pool.query(`UPDATE food_items SET barcode = '9300675024235', image_data_uri = 'data:image/png;base64,AAAA' WHERE id = $1`, [extra])
    await write()
    const { rows } = await pool.query(`SELECT barcode, image_data_uri FROM food_items WHERE id = $1`, [keeper])
    expect(rows[0]).toEqual({ barcode: '9300675024235', image_data_uri: 'data:image/png;base64,AAAA' })
  })

  it('leaves another user\'s foods and logs alone', async () => {
    await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1, 'Lunch')`, [OTHER])
    const theirs1 = await addFood({ userId: OTHER }); const theirs2 = await addFood({ userId: OTHER })
    const a = await addFood(); const b = await addFood()
    await addLog(a, 1); await addLog(b, 1)
    await write()
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM food_items WHERE id = ANY($1) AND deleted_at IS NULL`, [[theirs1, theirs2]])
    expect(rows[0].n).toBe(2)
  })

  describe('after a merge', () => {
    let keeper: string, retired: string
    beforeEach(async () => {
      keeper = await addFood({ ...dense(100) }); retired = await addFood({ ...dense(45) })
      await addLog(keeper, 1); await addLog(keeper, 1); await addLog(retired, 2)
      await write()
    })

    it('the list reads hide the retired row', async () => {
      const found = await nutrition.searchFoodItems(db, USER, 'granola')
      expect(found.map(f => f.id)).toEqual([keeper])
      const recent = await nutrition.listRecentFoodItems(db, USER, 10)
      expect(recent.map(f => f.id)).toEqual([keeper])
    })

    it('a fresh scan of the same food resolves to the keeper, not the retired row', async () => {
      const again = await nutrition.createFoodItem(db, USER, dense(100), { reuseExisting: true })
      expect(again.id).toBe(keeper)
    })

    it('a stale device that still logs against the retired row is not refused, and the log still reads', async () => {
      expect(await nutrition.foodLogRefsValid(db, USER, mealTypeId, retired)).toBe(true)
      const log = await nutrition.createFoodLog(db, USER, { date: '2026-10-02', mealTypeId, foodItemId: retired, quantityMultiplier: 2 })
      const day = await nutrition.listFoodLogs(db, USER, '2026-10-02')
      expect(day).toHaveLength(1)
      expect(day[0].id).toBe(log.id)
      expect(day[0].foodItem.id).toBe(retired)
      expect(day[0].calories).toBe(Math.round(45 * 2 * 2))
      // The id still resolves for a client reading back what it uploaded.
      expect((await nutrition.getFoodItemById(db, USER, retired))?.id).toBe(retired)
    })

    it('a second write sweeps that straggler to the keeper without changing what it amounts to', async () => {
      await nutrition.createFoodLog(db, USER, { date: '2026-10-02', mealTypeId, foodItemId: retired, quantityMultiplier: 2 })
      const before = (await eaten()).map(e => e.grams).sort((x, y) => x - y)
      const out = await write()
      if (!out.ok) throw new Error(out.error)
      expect(out.report.totals).toMatchObject({ groups: 1, logsToMove: 1 })
      expect(out.report.groups[0].extras[0].tombstone).toBe(false)
      expect((await eaten()).map(e => e.grams).sort((x, y) => x - y).map(g => +g.toFixed(6))).toEqual(before.map(g => +g.toFixed(6)))
      expect((await write()).ok && (await write() as { report: { totals: { groups: number } } }).report.totals.groups).toBe(0)
    })

    it('the pull carries the tombstone to a device that has not seen it', async () => {
      const delta = await repo.getSyncDelta(USER, new Date(Date.now() - 60_000)) as
        { foodItems?: { id: string; deletedAt?: Date | null }[] }
      const row = delta.foodItems?.find(f => f.id === retired)
      expect(row).toBeDefined()
      expect(row!.deletedAt).toBeTruthy()
      expect(delta.foodItems?.find(f => f.id === keeper)?.deletedAt ?? null).toBeNull()
    })
  })
})
