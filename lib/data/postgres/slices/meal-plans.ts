// Meal Plan persistence (Q-186). Plan: docs/superpowers/plans/2026-08-11-meal-plan.md
//
// Ownership is the thing to be careful about here. `meal_plan_variants` and `meal_plan_meals`
// carry no `user_id`, so a write keyed on a client-supplied id must join back to `meal_plans` to
// prove ownership — and for meals that join is TWO levels deep. That extra level is exactly where
// the check gets skipped, so every write in this file goes through `assertPlanOwned` or a
// user-scoped predicate; none of them trust an id from the request.

import { eq, and, asc, desc, inArray, isNull, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type {
  MealPlan, MealPlanVariant, MealPlanMeal, MealPlanDayType, NutritionIngredient,
  DietaryRestriction, UserDietaryRestriction, DietaryCategory, DietarySeverity,
} from '@trainingai/shared/types/nutrition'

type Db = ReturnType<typeof getDb>

export interface MealPlanMealInput {
  mealTypeId?: string | null
  savedMealId?: string | null
  position: number
  name: string
  notes?: string | null
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  ingredients?: NutritionIngredient[]
  suggestedTime?: string | null
}

export interface MealPlanVariantInput {
  dayType: MealPlanDayType
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  meals: MealPlanMealInput[]
}

export interface CreateMealPlanInput {
  name: string
  mealsPerDay: number
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  trainingTime?: string | null
  stores?: string[]
  excludedFoods?: string[]
  restrictionsSnapshot?: { code: string; label: string; severity: DietarySeverity }[]
  avoidNote?: string | null
  variants: MealPlanVariantInput[]
  /** Activate on create, deactivating any other plan in the same transaction. */
  activate?: boolean
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function rowToMeal(r: typeof s.mealPlanMeals.$inferSelect): MealPlanMeal {
  return {
    id: r.id, variantId: r.variantId, mealTypeId: r.mealTypeId, savedMealId: r.savedMealId,
    position: r.position, name: r.name, notes: r.notes,
    targetCalories: r.targetCalories, targetProteinG: r.targetProteinG,
    targetCarbsG: r.targetCarbsG, targetFatG: r.targetFatG,
    // Plans saved before Q-192 have no snapshot; an empty list is the honest answer, and every
    // read site treats it as "this plan predates ingredients" rather than "this meal is empty".
    ingredients: (r.ingredients as NutritionIngredient[] | null) ?? [],
    suggestedTime: r.suggestedTime,
  }
}

function rowToPlan(
  r: typeof s.mealPlans.$inferSelect,
  variants: MealPlanVariant[],
): MealPlan {
  return {
    id: r.id, userId: r.userId, name: r.name, isActive: r.isActive,
    mealsPerDay: r.mealsPerDay,
    targetCalories: r.targetCalories, targetProteinG: r.targetProteinG,
    targetCarbsG: r.targetCarbsG, targetFatG: r.targetFatG,
    trainingTime: r.trainingTime,
    stores: (r.stores as string[] | null) ?? [],
    excludedFoods: (r.excludedFoods as string[] | null) ?? [],
    restrictionsSnapshot: (r.restrictionsSnapshot as MealPlan['restrictionsSnapshot'] | null) ?? [],
    avoidNote: r.avoidNote,
    generatedAt: r.generatedAt, lastReviewedAt: r.lastReviewedAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    variants,
  }
}

// ── Ownership ──────────────────────────────────────────────────────────────────

/**
 * Resolve a plan id to its row only if this user owns it and it is live.
 *
 * Returns null rather than throwing so callers can turn it into a 404 without leaking whether the
 * id exists for someone else.
 */
async function ownedPlan(db: Db, planId: string, userId: string) {
  const [row] = await db.select().from(s.mealPlans)
    .where(and(
      eq(s.mealPlans.id, planId),
      eq(s.mealPlans.userId, userId),
      isNull(s.mealPlans.deletedAt),
    ))
    .limit(1)
  return row ?? null
}

/** The plan id owning a variant, or null when the variant is missing or owned by someone else. */
async function ownedVariantPlanId(db: Db, variantId: string, userId: string): Promise<string | null> {
  const [row] = await db.select({ planId: s.mealPlanVariants.mealPlanId })
    .from(s.mealPlanVariants)
    .innerJoin(s.mealPlans, eq(s.mealPlans.id, s.mealPlanVariants.mealPlanId))
    .where(and(
      eq(s.mealPlanVariants.id, variantId),
      eq(s.mealPlans.userId, userId),
      isNull(s.mealPlans.deletedAt),
    ))
    .limit(1)
  return row?.planId ?? null
}

// ── Reads ──────────────────────────────────────────────────────────────────────

async function loadVariants(db: Db, planIds: string[]): Promise<Map<string, MealPlanVariant[]>> {
  const out = new Map<string, MealPlanVariant[]>()
  if (planIds.length === 0) return out

  const variants = await db.select().from(s.mealPlanVariants)
    .where(inArray(s.mealPlanVariants.mealPlanId, planIds))
    .orderBy(asc(s.mealPlanVariants.dayType))
  if (variants.length === 0) return out

  const meals = await db.select().from(s.mealPlanMeals)
    .where(inArray(s.mealPlanMeals.variantId, variants.map(v => v.id)))
    .orderBy(asc(s.mealPlanMeals.position))

  const mealsByVariant = new Map<string, MealPlanMeal[]>()
  for (const m of meals) {
    const list = mealsByVariant.get(m.variantId) ?? []
    list.push(rowToMeal(m))
    mealsByVariant.set(m.variantId, list)
  }
  for (const v of variants) {
    const list = out.get(v.mealPlanId) ?? []
    list.push({
      id: v.id, mealPlanId: v.mealPlanId, dayType: v.dayType as MealPlanDayType,
      targetCalories: v.targetCalories, targetProteinG: v.targetProteinG,
      targetCarbsG: v.targetCarbsG, targetFatG: v.targetFatG,
      meals: mealsByVariant.get(v.id) ?? [],
    })
    out.set(v.mealPlanId, list)
  }
  return out
}

export async function listMealPlans(db: Db, userId: string): Promise<MealPlan[]> {
  const rows = await db.select().from(s.mealPlans)
    .where(and(eq(s.mealPlans.userId, userId), isNull(s.mealPlans.deletedAt)))
    .orderBy(desc(s.mealPlans.generatedAt))
  const byPlan = await loadVariants(db, rows.map(r => r.id))
  return rows.map(r => rowToPlan(r, byPlan.get(r.id) ?? []))
}

export async function getMealPlan(db: Db, id: string, userId: string): Promise<MealPlan | null> {
  const row = await ownedPlan(db, id, userId)
  if (!row) return null
  const byPlan = await loadVariants(db, [row.id])
  return rowToPlan(row, byPlan.get(row.id) ?? [])
}

export async function getActiveMealPlan(db: Db, userId: string): Promise<MealPlan | null> {
  const [row] = await db.select().from(s.mealPlans)
    .where(and(
      eq(s.mealPlans.userId, userId),
      eq(s.mealPlans.isActive, true),
      isNull(s.mealPlans.deletedAt),
    ))
    .limit(1)
  if (!row) return null
  const byPlan = await loadVariants(db, [row.id])
  return rowToPlan(row, byPlan.get(row.id) ?? [])
}

// ── Writes ─────────────────────────────────────────────────────────────────────

export async function createMealPlan(db: Db, userId: string, input: CreateMealPlanInput): Promise<MealPlan> {
  const planId = await db.transaction(async tx => {
    // The partial unique index makes two active plans impossible; clearing the old one inside the
    // same transaction is what stops that index turning a normal activation into an error.
    if (input.activate) {
      await tx.update(s.mealPlans)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(s.mealPlans.userId, userId), eq(s.mealPlans.isActive, true)))
    }
    const [plan] = await tx.insert(s.mealPlans).values({
      userId,
      name: input.name,
      isActive: input.activate ?? false,
      mealsPerDay: input.mealsPerDay,
      targetCalories: input.targetCalories,
      targetProteinG: input.targetProteinG,
      targetCarbsG: input.targetCarbsG,
      targetFatG: input.targetFatG,
      trainingTime: input.trainingTime ?? null,
      stores: input.stores ?? [],
      excludedFoods: input.excludedFoods ?? [],
      restrictionsSnapshot: input.restrictionsSnapshot ?? [],
      avoidNote: input.avoidNote ?? null,
    }).returning({ id: s.mealPlans.id })

    for (const v of input.variants) {
      const [variant] = await tx.insert(s.mealPlanVariants).values({
        mealPlanId: plan.id,
        dayType: v.dayType,
        targetCalories: v.targetCalories,
        targetProteinG: v.targetProteinG,
        targetCarbsG: v.targetCarbsG,
        targetFatG: v.targetFatG,
      }).returning({ id: s.mealPlanVariants.id })

      if (v.meals.length > 0) {
        await tx.insert(s.mealPlanMeals).values(v.meals.map(m => ({
          variantId: variant.id,
          mealTypeId: m.mealTypeId ?? null,
          savedMealId: m.savedMealId ?? null,
          position: m.position,
          name: m.name,
          notes: m.notes ?? null,
          targetCalories: m.targetCalories,
          targetProteinG: m.targetProteinG,
          targetCarbsG: m.targetCarbsG,
          targetFatG: m.targetFatG,
          ingredients: m.ingredients ?? [],
          suggestedTime: m.suggestedTime ?? null,
        })))
      }
    }
    return plan.id
  })
  return (await getMealPlan(db, planId, userId))!
}

/** Whitelisted plan fields. Never spread a request body into `.set()` — `userId`/`deletedAt` are
 *  settable column keys and the TypeScript Omit<> is compile-time only. */
export interface UpdateMealPlanInput {
  name?: string
  trainingTime?: string | null
  avoidNote?: string | null
  stores?: string[]
  excludedFoods?: string[]
}

export async function updateMealPlan(
  db: Db, id: string, userId: string, input: UpdateMealPlanInput,
): Promise<MealPlan | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name
  if (input.trainingTime !== undefined) set.trainingTime = input.trainingTime
  if (input.avoidNote !== undefined) set.avoidNote = input.avoidNote
  if (input.stores !== undefined) set.stores = input.stores
  if (input.excludedFoods !== undefined) set.excludedFoods = input.excludedFoods

  const updated = await db.update(s.mealPlans).set(set)
    .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.userId, userId), isNull(s.mealPlans.deletedAt)))
    .returning({ id: s.mealPlans.id })
  // 0 rows means the id is not this user's. Returning null (→ 404) rather than continuing is the
  // difference between a no-op and a cross-user write.
  if (updated.length === 0) return null
  return getMealPlan(db, id, userId)
}

export async function setMealPlanActive(
  db: Db, id: string, userId: string, active: boolean,
): Promise<MealPlan | null> {
  const owned = await ownedPlan(db, id, userId)
  if (!owned) return null
  await db.transaction(async tx => {
    if (active) {
      await tx.update(s.mealPlans)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(s.mealPlans.userId, userId), eq(s.mealPlans.isActive, true)))
    }
    await tx.update(s.mealPlans)
      .set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.userId, userId)))
  })
  return getMealPlan(db, id, userId)
}

/** Soft delete — a hard DELETE is invisible to devices that have not synced. */
export async function deleteMealPlan(db: Db, id: string, userId: string): Promise<boolean> {
  const rows = await db.update(s.mealPlans)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.userId, userId), isNull(s.mealPlans.deletedAt)))
    .returning({ id: s.mealPlans.id })
  return rows.length > 0
}

export interface UpdateMealInput {
  name?: string
  notes?: string | null
  targetCalories?: number
  targetProteinG?: number
  targetCarbsG?: number
  targetFatG?: number
  mealTypeId?: string | null
  savedMealId?: string | null
  ingredients?: NutritionIngredient[]
  suggestedTime?: string | null
}

/**
 * Edit one meal inside a plan. Ownership is proven by joining the meal's variant back to the plan
 * before the write — the meal id alone says nothing about who owns it.
 */
/**
 * One plan meal, ownership-verified.
 *
 * `meal_plan_meals` carries no `user_id`, so this joins back through its variant to the plan — the
 * meal id alone says nothing about who owns it. Exists so a route can scale ingredients against the
 * meal's *stored* targets rather than trusting targets sent by the client.
 */
export async function getMealPlanMeal(
  db: Db, mealId: string, userId: string,
): Promise<MealPlanMeal | null> {
  const [row] = await db.select().from(s.mealPlanMeals).where(eq(s.mealPlanMeals.id, mealId)).limit(1)
  if (!row) return null
  if (!(await ownedVariantPlanId(db, row.variantId, userId))) return null
  return rowToMeal(row)
}

export async function updateMealPlanMeal(
  db: Db, mealId: string, userId: string, input: UpdateMealInput,
): Promise<MealPlanMeal | null> {
  const [existing] = await db.select({ variantId: s.mealPlanMeals.variantId })
    .from(s.mealPlanMeals).where(eq(s.mealPlanMeals.id, mealId)).limit(1)
  if (!existing) return null
  if (!(await ownedVariantPlanId(db, existing.variantId, userId))) return null

  const set: Record<string, unknown> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.notes !== undefined) set.notes = input.notes
  if (input.targetCalories !== undefined) set.targetCalories = input.targetCalories
  if (input.targetProteinG !== undefined) set.targetProteinG = input.targetProteinG
  if (input.targetCarbsG !== undefined) set.targetCarbsG = input.targetCarbsG
  if (input.targetFatG !== undefined) set.targetFatG = input.targetFatG
  if (input.mealTypeId !== undefined) set.mealTypeId = input.mealTypeId
  if (input.savedMealId !== undefined) set.savedMealId = input.savedMealId
  if (input.ingredients !== undefined) set.ingredients = input.ingredients
  if (input.suggestedTime !== undefined) set.suggestedTime = input.suggestedTime
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(s.mealPlanMeals).where(eq(s.mealPlanMeals.id, mealId)).limit(1)
    return row ? rowToMeal(row) : null
  }

  const [row] = await db.update(s.mealPlanMeals).set(set)
    .where(eq(s.mealPlanMeals.id, mealId)).returning()
  return row ? rowToMeal(row) : null
}

export interface ReplaceStructureInput {
  mealsPerDay: number
  trainingTime: string | null
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  variants: MealPlanVariantInput[]
}

/**
 * Rebuild a plan's variants and meals in place, keeping the plan's identity.
 *
 * Changing meals-per-day or the training time reflows every meal, so there is nothing to patch —
 * the old rows no longer correspond to anything. They are deleted and rewritten inside one
 * transaction, which is what stops a device syncing a plan whose variants were removed but whose
 * meals had not yet been written.
 *
 * The plan row keeps its id, so `is_active` and `last_reviewed_at` survive and no device sees the
 * plan vanish and reappear. Callers pass meal names through from the existing plan — this function
 * decides nothing about content.
 */
export async function replaceMealPlanStructure(
  db: Db, id: string, userId: string, input: ReplaceStructureInput,
): Promise<MealPlan | null> {
  const owned = await ownedPlan(db, id, userId)
  if (!owned) return null

  await db.transaction(async tx => {
    await tx.update(s.mealPlans).set({
      mealsPerDay: input.mealsPerDay,
      trainingTime: input.trainingTime,
      targetCalories: input.targetCalories,
      targetProteinG: input.targetProteinG,
      targetCarbsG: input.targetCarbsG,
      targetFatG: input.targetFatG,
      updatedAt: new Date(),
    }).where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.userId, userId)))

    // Meals cascade from their variant, so deleting the variants clears both.
    await tx.delete(s.mealPlanVariants).where(eq(s.mealPlanVariants.mealPlanId, id))

    for (const v of input.variants) {
      const [variant] = await tx.insert(s.mealPlanVariants).values({
        mealPlanId: id,
        dayType: v.dayType,
        targetCalories: v.targetCalories,
        targetProteinG: v.targetProteinG,
        targetCarbsG: v.targetCarbsG,
        targetFatG: v.targetFatG,
      }).returning({ id: s.mealPlanVariants.id })

      if (v.meals.length > 0) {
        await tx.insert(s.mealPlanMeals).values(v.meals.map(m => ({
          variantId: variant.id,
          mealTypeId: m.mealTypeId ?? null,
          savedMealId: m.savedMealId ?? null,
          position: m.position,
          name: m.name,
          notes: m.notes ?? null,
          targetCalories: m.targetCalories,
          targetProteinG: m.targetProteinG,
          targetCarbsG: m.targetCarbsG,
          targetFatG: m.targetFatG,
          ingredients: m.ingredients ?? [],
          suggestedTime: m.suggestedTime ?? null,
        })))
      }
    }
  })
  return getMealPlan(db, id, userId)
}

/** Stamp the ~4-week review so the on-open card stops asking. */
export async function markMealPlanReviewed(db: Db, id: string, userId: string): Promise<boolean> {
  const rows = await db.update(s.mealPlans)
    .set({ lastReviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.mealPlans.id, id), eq(s.mealPlans.userId, userId), isNull(s.mealPlans.deletedAt)))
    .returning({ id: s.mealPlans.id })
  return rows.length > 0
}

// ── Dietary restrictions ───────────────────────────────────────────────────────

export async function listDietaryRestrictions(db: Db): Promise<DietaryRestriction[]> {
  const rows = await db.select().from(s.dietaryRestrictions)
    .orderBy(asc(s.dietaryRestrictions.category), asc(s.dietaryRestrictions.sortOrder))
  return rows.map(r => ({
    id: r.id, code: r.code, label: r.label,
    category: r.category as DietaryCategory,
    synonyms: (r.synonyms as string[] | null) ?? [],
    sortOrder: r.sortOrder,
  }))
}

export async function listUserDietaryRestrictions(db: Db, userId: string): Promise<UserDietaryRestriction[]> {
  const rows = await db.select({
    restrictionId: s.userDietaryRestrictions.restrictionId,
    severity: s.userDietaryRestrictions.severity,
    code: s.dietaryRestrictions.code,
    label: s.dietaryRestrictions.label,
    category: s.dietaryRestrictions.category,
  })
    .from(s.userDietaryRestrictions)
    .innerJoin(s.dietaryRestrictions, eq(s.dietaryRestrictions.id, s.userDietaryRestrictions.restrictionId))
    .where(eq(s.userDietaryRestrictions.userId, userId))
    .orderBy(asc(s.dietaryRestrictions.category), asc(s.dietaryRestrictions.sortOrder))
  return rows.map(r => ({
    restrictionId: r.restrictionId,
    code: r.code,
    label: r.label,
    category: r.category as DietaryCategory,
    severity: r.severity as DietarySeverity,
  }))
}

/**
 * Replace the user's whole restriction set. A full replace rather than per-row edits because the
 * picker is a multi-select: the client already knows the complete desired state, and diffing it
 * server-side would be a second place for the two to disagree.
 *
 * Unknown restriction ids are dropped rather than inserted — a bad id from the client must not
 * become a foreign-key 500.
 */
export async function replaceUserDietaryRestrictions(
  db: Db, userId: string, entries: { restrictionId: string; severity: DietarySeverity }[],
): Promise<UserDietaryRestriction[]> {
  await db.transaction(async tx => {
    await tx.delete(s.userDietaryRestrictions).where(eq(s.userDietaryRestrictions.userId, userId))
    if (entries.length === 0) return
    const known = await tx.select({ id: s.dietaryRestrictions.id }).from(s.dietaryRestrictions)
      .where(inArray(s.dietaryRestrictions.id, entries.map(e => e.restrictionId)))
    const knownIds = new Set(known.map(k => k.id))
    const valid = entries.filter(e => knownIds.has(e.restrictionId))
    if (valid.length === 0) return
    await tx.insert(s.userDietaryRestrictions).values(valid.map(e => ({
      userId, restrictionId: e.restrictionId, severity: e.severity,
    }))).onConflictDoNothing()
  })
  return listUserDietaryRestrictions(db, userId)
}

// ── Plan meal answers (Q-187 phase 2) ────────────────────────────────────────
//
// Only declines are stored; see the schema comment. The one function both the web route and the
// outbox's `pushMutations` branch call, so the two write paths cannot drift — the failure mode the
// sync rules exist to prevent, where web works and the APK mutation strands silently.

export interface PlanMealAnswer {
  id: string
  planMealId: string
  logDate: string
  answer: 'no'
  answeredAt: string
}

/**
 * Record "I did not eat this planned meal today".
 *
 * `planMealId` comes from the client and `meal_plan_meals` has no `user_id`, so ownership is proved
 * through the same two-level join every other write in this file uses. Returning null on a failed
 * check rather than throwing lets the caller answer 404 without leaking whether the id exists.
 */
export async function savePlanMealAnswer(
  db: Db, userId: string, input: { id?: string; planMealId: string; logDate: string },
): Promise<PlanMealAnswer | null> {
  const [meal] = await db.select({ variantId: s.mealPlanMeals.variantId })
    .from(s.mealPlanMeals).where(eq(s.mealPlanMeals.id, input.planMealId)).limit(1)
  if (!meal) return null
  if (!(await ownedVariantPlanId(db, meal.variantId, userId))) return null

  // Revive first, insert second — and that order is the whole subtlety.
  //
  // The unique index is partial on `deleted_at IS NULL`, so a soft-deleted row (declined, then
  // undone) is invisible to an INSERT's conflict target: the insert simply succeeds and the table
  // ends up holding two rows for the same meal and day. `listPlanMealAnswers` filters the deleted
  // one out, so the duplicate is invisible from the app and only shows up as row growth. Updating
  // first, unconditionally, collapses both cases — live row or tombstone — into one revive.
  const now = sql`now()`
  const [revived] = await db.update(s.planMealAnswers)
    .set({ deletedAt: null, answeredAt: now, updatedAt: now })
    .where(and(
      eq(s.planMealAnswers.userId, userId),
      eq(s.planMealAnswers.logDate, input.logDate),
      eq(s.planMealAnswers.planMealId, input.planMealId),
    ))
    .returning()
  if (revived) return rowToAnswer(revived)

  // No row yet. `onConflictDoUpdate` is the race guard, not the normal path: two devices replaying
  // the same outbox mutation can both reach this insert.
  const [row] = await db.insert(s.planMealAnswers)
    .values({
      ...(input.id ? { id: input.id } : {}),
      userId, planMealId: input.planMealId, logDate: input.logDate, answer: 'no',
    })
    .onConflictDoUpdate({
      target: [s.planMealAnswers.userId, s.planMealAnswers.logDate, s.planMealAnswers.planMealId],
      targetWhere: isNull(s.planMealAnswers.deletedAt),
      set: { deletedAt: null, answeredAt: now, updatedAt: now },
      setWhere: eq(s.planMealAnswers.userId, userId),
    })
    .returning()
  return row ? rowToAnswer(row) : null
}

/** Undo a decline. Soft, so the reversal reaches a device that has not synced. */
export async function deletePlanMealAnswer(
  db: Db, userId: string, planMealId: string, logDate: string,
): Promise<boolean> {
  const rows = await db.update(s.planMealAnswers)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(s.planMealAnswers.userId, userId),
      eq(s.planMealAnswers.planMealId, planMealId),
      eq(s.planMealAnswers.logDate, logDate),
      isNull(s.planMealAnswers.deletedAt),
    ))
    .returning({ id: s.planMealAnswers.id })
  return rows.length > 0
}

export async function listPlanMealAnswers(
  db: Db, userId: string, logDate: string,
): Promise<PlanMealAnswer[]> {
  const rows = await db.select().from(s.planMealAnswers)
    .where(and(
      eq(s.planMealAnswers.userId, userId),
      eq(s.planMealAnswers.logDate, logDate),
      isNull(s.planMealAnswers.deletedAt),
    ))
  return rows.map(rowToAnswer)
}

function rowToAnswer(r: typeof s.planMealAnswers.$inferSelect): PlanMealAnswer {
  return {
    id: r.id,
    planMealId: r.planMealId,
    logDate: r.logDate,
    answer: 'no',
    answeredAt: r.answeredAt.toISOString(),
  }
}

/** Plans older than `days` since their last review (or generation), for the on-open check-in. */
export async function mealPlanNeedsReview(db: Db, userId: string, days: number): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(s.mealPlans)
    .where(and(
      eq(s.mealPlans.userId, userId),
      eq(s.mealPlans.isActive, true),
      isNull(s.mealPlans.deletedAt),
      sql`COALESCE(${s.mealPlans.lastReviewedAt}, ${s.mealPlans.generatedAt}) < now() - make_interval(days => ${days})`,
    ))
  return (row?.n ?? 0) > 0
}
