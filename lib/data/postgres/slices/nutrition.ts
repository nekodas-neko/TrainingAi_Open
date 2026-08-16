import { eq, and, inArray, gte, lte, asc, desc, sql, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { getDb } from '../client'
import * as s from '../schema'
import type {
  MealType, FoodItem, FoodLog, FoodLogWithItem,
  SavedMeal, SavedMealItem, NutritionTargets,
} from '@trainingai/shared/types/nutrition'

type Db = ReturnType<typeof getDb>

// ── Row Mappers ────────────────────────────────────────────────────────────────

export function rowToMealType(r: typeof s.mealTypes.$inferSelect): MealType {
  return {
    id: r.id, userId: r.userId, name: r.name, emoji: r.emoji,
    sortOrder: r.sortOrder, timeStartHour: r.timeStartHour,
    timeEndHour: r.timeEndHour, remindersEnabled: r.remindersEnabled,
    required: r.required,
    createdAt: r.createdAt,
  }
}

export function rowToFoodItem(r: typeof s.foodItems.$inferSelect): FoodItem {
  return {
    id: r.id, userId: r.userId, name: r.name,
    brand: r.brand ?? undefined,
    servingSizeG: r.servingSizeG, calories: r.calories,
    proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG,
    fiberG: r.fiberG ?? undefined, sugarG: r.sugarG ?? undefined,
    sodiumMg: r.sodiumMg ?? undefined, satFatG: r.satFatG ?? undefined,
    source: r.source as FoodItem['source'],
    barcode: r.barcode ?? undefined, region: r.region,
    createdAt: r.createdAt,
  }
}

export function rowToFoodLog(r: typeof s.foodLogs.$inferSelect): FoodLog {
  return {
    id: r.id, userId: r.userId, date: r.date,
    mealTypeId: r.mealTypeId, foodItemId: r.foodItemId,
    quantityMultiplier: r.quantityMultiplier, loggedAt: r.loggedAt,
  }
}

export function computeLogMacros(
  item: FoodItem, qty: number,
): Pick<FoodLogWithItem, 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG' | 'sodiumMg' | 'satFatG'> {
  const r = (n: number) => Math.round(n * 10) / 10
  return {
    calories: Math.round(item.calories * qty),
    proteinG: r(item.proteinG * qty),
    carbsG:   r(item.carbsG * qty),
    fatG:     r(item.fatG * qty),
    fiberG:   item.fiberG != null ? r(item.fiberG * qty) : undefined,
    sugarG:   item.sugarG != null ? r(item.sugarG * qty) : undefined,
    sodiumMg: item.sodiumMg != null ? r(item.sodiumMg * qty) : undefined,
    satFatG:  item.satFatG != null ? r(item.satFatG * qty) : undefined,
  }
}

// ── Meal Types ─────────────────────────────────────────────────────────────────

export async function listMealTypes(db: Db, userId: string): Promise<MealType[]> {
  const rows = await db.select().from(s.mealTypes)
    .where(and(eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt)))
    .orderBy(asc(s.mealTypes.sortOrder))
  return rows.map(rowToMealType)
}

export async function createMealType(db: Db, userId: string, data: Omit<MealType, 'id' | 'userId' | 'createdAt'>): Promise<MealType> {
  const [r] = await db.insert(s.mealTypes).values({ userId, ...data }).returning()
  return rowToMealType(r)
}

export async function updateMealType(db: Db, id: string, userId: string, data: Partial<Omit<MealType, 'id' | 'userId' | 'createdAt'>>): Promise<MealType> {
  const [r] = await db.update(s.mealTypes)
    .set(data)
    .where(and(eq(s.mealTypes.id, id), eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt)))
    .returning()
  if (!r) throw new Error('Meal type not found')
  return rowToMealType(r)
}

/**
 * Soft-delete. A meal type with **live** food logs still refuses to go — that guard is deliberate,
 * and unchanged.
 *
 * What changed (Q-179) is what happens once those logs are deleted. The probe counted soft-deleted
 * logs too, so deleting your last food log left the meal type citing a log you could no longer see
 * — undeletable from then on, permanently, with nothing the user could do about it. Filtering the
 * probe alone is not the fix either: `food_logs.meal_type_id` is ON DELETE RESTRICT, so the hard
 * DELETE then fails on the foreign key and the clean domain error becomes a 500. Both directions
 * are pinned by test, because the one-directional version passed.
 *
 * Soft-deleting sidesteps the RESTRICT entirely: the soft-deleted logs keep pointing at a row that
 * still exists, so their sync tombstones survive and no unsynced device can resurrect them.
 */
export async function deleteMealType(db: Db, id: string, userId: string): Promise<void> {
  const logs = await db.select({ id: s.foodLogs.id }).from(s.foodLogs)
    .where(and(
      eq(s.foodLogs.mealTypeId, id),
      eq(s.foodLogs.userId, userId),
      isNull(s.foodLogs.deletedAt),
    )).limit(1)
  if (logs.length > 0) throw new Error('MEAL_TYPE_HAS_LOGS')
  await db.update(s.mealTypes)
    .set({ deletedAt: new Date() })
    .where(and(eq(s.mealTypes.id, id), eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt)))
}

export async function reorderMealTypes(db: Db, userId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async tx => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(s.mealTypes)
        .set({ sortOrder: i })
        .where(and(eq(s.mealTypes.id, orderedIds[i]), eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt)))
    }
  })
}

export async function seedDefaultMealTypes(db: Db, userId: string): Promise<void> {
  // Deliberately counts soft-deleted rows too: this asks "has this user ever been seeded", not
  // "does this user have any live meal types". Filtering on `deleted_at IS NULL` would re-create
  // the six defaults for anyone who had deliberately deleted all of them.
  const existing = await db.select({ id: s.mealTypes.id }).from(s.mealTypes)
    .where(eq(s.mealTypes.userId, userId)).limit(1)
  if (existing.length > 0) return
  const defaults = [
    { name: 'Breakfast',       emoji: '🍳', sortOrder: 0, timeStartHour: 6,  timeEndHour: 10 },
    { name: 'Morning Snack',   emoji: '🍎', sortOrder: 1, timeStartHour: 10, timeEndHour: 12 },
    { name: 'Lunch',           emoji: '🥗', sortOrder: 2, timeStartHour: 12, timeEndHour: 15 },
    { name: 'Afternoon Snack', emoji: '🍪', sortOrder: 3, timeStartHour: 15, timeEndHour: 17 },
    { name: 'Dinner',          emoji: '🍽️', sortOrder: 4, timeStartHour: 17, timeEndHour: 21 },
    { name: 'Evening Snack',   emoji: '🌙', sortOrder: 5, timeStartHour: 21, timeEndHour: 24 },
  ]
  await db.insert(s.mealTypes).values(defaults.map(d => ({ userId, ...d })))
}

// ── Food Items ─────────────────────────────────────────────────────────────────

// `id` is only passed by the offline-sync push path (SYNC-O2), which mints the id
// client-side so it can log-reference it before the server confirms creation.
// ON CONFLICT DO NOTHING makes a re-push of the same mutation idempotent.
export async function createFoodItem(db: Db, userId: string, data: Omit<FoodItem, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<FoodItem> {
  const { id, ...rest } = data
  if (id) {
    const [inserted] = await db.insert(s.foodItems).values({ id, userId, ...rest })
      .onConflictDoNothing({ target: s.foodItems.id })
      .returning()
    if (inserted) return rowToFoodItem(inserted)
    const [existing] = await db.select().from(s.foodItems).where(eq(s.foodItems.id, id))
    return rowToFoodItem(existing)
  }
  const [r] = await db.insert(s.foodItems).values({ userId, ...rest }).returning()
  return rowToFoodItem(r)
}

export async function searchFoodItems(db: Db, userId: string, query: string): Promise<FoodItem[]> {
  const rows = await db.select().from(s.foodItems)
    .where(and(
      eq(s.foodItems.userId, userId),
      sql`lower(${s.foodItems.name}) like ${'%' + query.toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_') + '%'} escape '\\'`,
    ))
    .orderBy(desc(s.foodItems.createdAt))
    .limit(20)
  return rows.map(rowToFoodItem)
}

// ── Food Logs ──────────────────────────────────────────────────────────────────

export async function listFoodLogs(db: Db, userId: string, date: string): Promise<FoodLogWithItem[]> {
  const rows = await db.select({
    logId:         s.foodLogs.id,
    logUserId:     s.foodLogs.userId,
    logDate:       s.foodLogs.date,
    logMealTypeId: s.foodLogs.mealTypeId,
    logFoodItemId: s.foodLogs.foodItemId,
    logQty:        s.foodLogs.quantityMultiplier,
    loggedAt:      s.foodLogs.loggedAt,
    item:          s.foodItems,
  })
    .from(s.foodLogs)
    .innerJoin(s.foodItems, eq(s.foodLogs.foodItemId, s.foodItems.id))
    .where(and(eq(s.foodLogs.userId, userId), eq(s.foodLogs.date, date), isNull(s.foodLogs.deletedAt)))
    .orderBy(asc(s.foodLogs.loggedAt))

  return rows.map(({ item, logId, logUserId, logDate, logMealTypeId, logFoodItemId, logQty, loggedAt }) => {
    const foodItem = rowToFoodItem(item)
    return {
      id: logId, userId: logUserId, date: logDate,
      mealTypeId: logMealTypeId, foodItemId: logFoodItemId,
      quantityMultiplier: logQty, loggedAt,
      foodItem,
      ...computeLogMacros(foodItem, logQty),
    }
  })
}

// Latest food-log timestamp per day in range — used by the meal-timing trend
// (how close to bed was the last meal) without pulling every logged item.
export async function listLatestMealTimes(db: Db, userId: string, from: string, to: string): Promise<{ date: string; latestLoggedAt: Date }[]> {
  const rows = await db.select({
    date: s.foodLogs.date,
    latestLoggedAt: sql<Date>`max(${s.foodLogs.loggedAt})`,
  })
    .from(s.foodLogs)
    .where(and(eq(s.foodLogs.userId, userId), gte(s.foodLogs.date, from), lte(s.foodLogs.date, to), isNull(s.foodLogs.deletedAt)))
    .groupBy(s.foodLogs.date)
  return rows
}

export async function createFoodLog(
  db: Db,
  userId: string,
  data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'> & { id?: string; loggedAt?: Date },
): Promise<FoodLog> {
  const { id, loggedAt, ...rest } = data
  // Optional client id: offline-created logs keep their local UUID so an outbox
  // replay updates in place (idempotent) instead of duplicating the row.
  const [r] = await db.insert(s.foodLogs)
    .values({ ...(id ? { id } : {}), ...(loggedAt ? { loggedAt } : {}), userId, ...rest })
    .onConflictDoUpdate({
      target: s.foodLogs.id,
      set: { quantityMultiplier: rest.quantityMultiplier, updatedAt: new Date() },
      setWhere: eq(s.foodLogs.userId, userId),
    })
    .returning()
  return rowToFoodLog(r)
}

// Confirms the meal type and food item both exist and belong to the user — used to
// validate a food-log create request before writing.
export async function foodLogRefsValid(db: Db, userId: string, mealTypeId: string, foodItemId: string): Promise<boolean> {
  const [mt] = await db.select({ id: s.mealTypes.id }).from(s.mealTypes)
    .where(and(eq(s.mealTypes.id, mealTypeId), eq(s.mealTypes.userId, userId), isNull(s.mealTypes.deletedAt))).limit(1)
  if (!mt) return false
  const [fi] = await db.select({ id: s.foodItems.id }).from(s.foodItems)
    .where(and(eq(s.foodItems.id, foodItemId), eq(s.foodItems.userId, userId))).limit(1)
  return !!fi
}

export async function updateFoodLog(db: Db, id: string, userId: string, quantityMultiplier: number): Promise<FoodLog> {
  const [r] = await db.update(s.foodLogs)
    // updated_at bump: getSyncDelta cursors on it — without this, a web qm edit
    // never reaches other devices.
    .set({ quantityMultiplier, updatedAt: new Date() })
    .where(and(eq(s.foodLogs.id, id), eq(s.foodLogs.userId, userId)))
    .returning()
  if (!r) throw new Error('Food log not found')
  return rowToFoodLog(r)
}

export async function deleteFoodLog(db: Db, id: string, userId: string): Promise<void> {
  await db.update(s.foodLogs)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.foodLogs.id, id), eq(s.foodLogs.userId, userId)))
}

export async function listFoodLogsSummary(db: Db, userId: string, from: string, to: string): Promise<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]> {
  const rows = await db
    .select({
      date:     s.foodLogs.date,
      calories: sql<number>`COALESCE(SUM(${s.foodItems.calories} * ${s.foodLogs.quantityMultiplier}), 0)`,
      proteinG: sql<number>`COALESCE(SUM(${s.foodItems.proteinG} * ${s.foodLogs.quantityMultiplier}), 0)`,
      carbsG:   sql<number>`COALESCE(SUM(${s.foodItems.carbsG}   * ${s.foodLogs.quantityMultiplier}), 0)`,
      fatG:     sql<number>`COALESCE(SUM(${s.foodItems.fatG}     * ${s.foodLogs.quantityMultiplier}), 0)`,
    })
    .from(s.foodLogs)
    .innerJoin(s.foodItems, eq(s.foodLogs.foodItemId, s.foodItems.id))
    .where(and(eq(s.foodLogs.userId, userId), gte(s.foodLogs.date, from), lte(s.foodLogs.date, to), isNull(s.foodLogs.deletedAt)))
    .groupBy(s.foodLogs.date)
    .orderBy(asc(s.foodLogs.date))
  return rows.map(r => ({
    date:     r.date,
    calories: Math.round(Number(r.calories)),
    proteinG: Math.round(Number(r.proteinG) * 10) / 10,
    carbsG:   Math.round(Number(r.carbsG)   * 10) / 10,
    fatG:     Math.round(Number(r.fatG)      * 10) / 10,
  }))
}

export async function getRequiredMealTypeLogDays(db: Db, userId: string, from: string, to: string): Promise<{ requiredMealTypeCount: number; loggedByDay: { date: string; requiredMealTypesLogged: number }[] }> {
  const [requiredCountRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(s.mealTypes)
    .where(and(eq(s.mealTypes.userId, userId), eq(s.mealTypes.required, true), isNull(s.mealTypes.deletedAt)))

  const rows = await db
    .select({
      date: s.foodLogs.date,
      requiredMealTypesLogged: sql<number>`COUNT(DISTINCT CASE WHEN ${s.mealTypes.required} THEN ${s.foodLogs.mealTypeId} END)`,
    })
    .from(s.foodLogs)
    .innerJoin(s.mealTypes, eq(s.foodLogs.mealTypeId, s.mealTypes.id))
    .where(and(eq(s.foodLogs.userId, userId), gte(s.foodLogs.date, from), lte(s.foodLogs.date, to), isNull(s.foodLogs.deletedAt)))
    .groupBy(s.foodLogs.date)

  return {
    requiredMealTypeCount: Number(requiredCountRow?.count ?? 0),
    loggedByDay: rows.map(r => ({ date: r.date, requiredMealTypesLogged: Number(r.requiredMealTypesLogged) })),
  }
}

export async function listRecentFoodItemsForMealType(db: Db, userId: string, mealTypeId: string, limit: number): Promise<FoodItem[]> {
  const rows = await db
    .select({ item: s.foodItems, loggedAt: s.foodLogs.loggedAt })
    .from(s.foodLogs)
    .innerJoin(s.foodItems, eq(s.foodLogs.foodItemId, s.foodItems.id))
    .where(and(eq(s.foodLogs.userId, userId), eq(s.foodLogs.mealTypeId, mealTypeId), isNull(s.foodLogs.deletedAt)))
    .orderBy(desc(s.foodLogs.loggedAt))
    .limit(100)
  const seen = new Set<string>()
  const items: FoodItem[] = []
  for (const row of rows) {
    if (!seen.has(row.item.id)) {
      seen.add(row.item.id)
      items.push(rowToFoodItem(row.item))
      if (items.length >= limit) break
    }
  }
  return items
}

// ── Saved Meals ────────────────────────────────────────────────────────────────

export async function listSavedMeals(db: Db, userId: string): Promise<SavedMeal[]> {
  const meals = await db.select().from(s.savedMeals)
    .where(eq(s.savedMeals.userId, userId))
    .orderBy(desc(s.savedMeals.createdAt))

  if (meals.length === 0) return []

  const mealIds = meals.map(m => m.id)
  const itemRows = await db.select({
    smiId:     s.savedMealItems.id,
    smiMealId: s.savedMealItems.savedMealId,
    smiQty:    s.savedMealItems.quantityMultiplier,
    item:      s.foodItems,
  })
    .from(s.savedMealItems)
    .innerJoin(s.foodItems, eq(s.savedMealItems.foodItemId, s.foodItems.id))
    .where(inArray(s.savedMealItems.savedMealId, mealIds))
    .orderBy(asc(s.savedMealItems.id))

  return meals.map(m => {
    const items: SavedMealItem[] = itemRows
      .filter(r => r.smiMealId === m.id)
      .map(r => ({
        id: r.smiId, savedMealId: r.smiMealId,
        foodItemId: r.item.id, quantityMultiplier: r.smiQty,
        foodItem: rowToFoodItem(r.item),
      }))
    const totals = items.reduce(
      (acc, i) => {
        const macros = computeLogMacros(i.foodItem, i.quantityMultiplier)
        return {
          calories: acc.calories + macros.calories,
          proteinG: acc.proteinG + macros.proteinG,
          carbsG:   acc.carbsG   + macros.carbsG,
          fatG:     acc.fatG     + macros.fatG,
        }
      },
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    )
    // `totals` stays the WHOLE recipe — dividing here would make every existing caller
    // silently change meaning. Callers that want one portion divide by `servings` themselves.
    return { id: m.id, userId: m.userId, name: m.name, servings: m.servings, createdAt: m.createdAt, items, totals }
  })
}

// Single idempotent, user-scoped write for a saved meal. Both the create (POST) and
// update (PUT) web routes and the offline outbox replay funnel through here, so an
// offline create that replays — or a create+edit that replays out of order — lands
// in place instead of duplicating or throwing. The meal id is client-minted (offline)
// or generated here (online without one), and the junction rows are replaced wholesale.
async function writeSavedMeal(db: Db, userId: string, id: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], servings: number): Promise<SavedMeal> {
  await db.transaction(async tx => {
    const [meal] = await tx.insert(s.savedMeals)
      .values({ id, userId, name, servings })
      .onConflictDoUpdate({
        target: s.savedMeals.id,
        set: { name, servings },
        setWhere: eq(s.savedMeals.userId, userId),   // never touch another user's row
      })
      .returning({ id: s.savedMeals.id })
    // A conflict on an id owned by another user updates 0 rows → refuse.
    if (!meal) throw new Error('Saved meal not found')

    // Ownership-verify every referenced food item belongs to this user before
    // re-inserting — a saved meal must not embed another user's food_items rows.
    if (items.length > 0) {
      const ids = [...new Set(items.map(i => i.foodItemId))]
      const owned = await tx.select({ id: s.foodItems.id }).from(s.foodItems)
        .where(and(eq(s.foodItems.userId, userId), inArray(s.foodItems.id, ids)))
      if (owned.length !== ids.length) throw new Error('Unknown food item')
    }

    await tx.delete(s.savedMealItems).where(eq(s.savedMealItems.savedMealId, id))
    if (items.length > 0) {
      await tx.insert(s.savedMealItems).values(items.map(i => ({ savedMealId: id, ...i })))
    }
  })
  const all = await listSavedMeals(db, userId)
  return all.find(m => m.id === id)!
}

export async function createSavedMeal(db: Db, userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], id?: string, servings = 1): Promise<SavedMeal> {
  return writeSavedMeal(db, userId, id ?? randomUUID(), name, items, servings)
}

export async function updateSavedMeal(db: Db, id: string, userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], servings = 1): Promise<SavedMeal> {
  return writeSavedMeal(db, userId, id, name, items, servings)
}

export async function deleteSavedMeal(db: Db, id: string, userId: string): Promise<void> {
  await db.delete(s.savedMeals).where(and(eq(s.savedMeals.id, id), eq(s.savedMeals.userId, userId)))
}

// ── Nutrition Targets ──────────────────────────────────────────────────────────

export async function getNutritionTargets(db: Db, userId: string): Promise<NutritionTargets | null> {
  const [r] = await db.select().from(s.nutritionTargets)
    .where(eq(s.nutritionTargets.userId, userId)).limit(1)
  if (!r) return null
  return {
    id: r.id, userId: r.userId,
    calories: r.calories ?? undefined, proteinG: r.proteinG ?? undefined,
    carbsG: r.carbsG ?? undefined, fatG: r.fatG ?? undefined,
    fiberG: r.fiberG ?? undefined, updatedAt: r.updatedAt,
  }
}

export async function upsertNutritionTargets(db: Db, userId: string, data: Omit<NutritionTargets, 'id' | 'userId' | 'updatedAt'>): Promise<NutritionTargets> {
  const [r] = await db.insert(s.nutritionTargets)
    .values({ userId, ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: s.nutritionTargets.userId,
      set: { ...data, updatedAt: new Date() },
    })
    .returning()
  return {
    id: r.id, userId: r.userId,
    calories: r.calories ?? undefined, proteinG: r.proteinG ?? undefined,
    carbsG: r.carbsG ?? undefined, fatG: r.fatG ?? undefined,
    fiberG: r.fiberG ?? undefined, updatedAt: r.updatedAt,
  }
}
