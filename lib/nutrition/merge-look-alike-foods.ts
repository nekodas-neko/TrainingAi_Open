// Merging look-alike `food_items` rows into one keeper (#2417). The admin job `merge-look-alike-foods`
// (`lib/agent-actions/jobs.ts`) is the only caller.
//
// What decides who keeps and how a quantity is rescaled is `planLookAlikeMerge`
// (`packages/shared/src/nutrition/food-merge.ts`); this file reads the rows, asks it, and writes.
//
// A write, per group and in one transaction:
//   1. every food log of an extra (deleted ones too) points at the keeper, with `quantity_multiplier`
//      rescaled by the serving-size ratio and `updated_at` bumped, which is what carries the change
//      to devices on their next pull;
//   2. every saved-meal ingredient of an extra likewise;
//   3. the keeper takes the barcode and picture of an extra when it has none of its own (add-only),
//      so a later scan of that product still resolves from the library;
//   4. each extra gets `deleted_at`. The row is never deleted: a device that has not synced may
//      still log against it, and that log must keep working.
//
// A group that fails rolls back alone and is reported; the others still run. Run again, a merged
// group plans nothing. Run after a straggler (a log an unsynced device pushed against a retired row)
// and the straggler moves, which is why a tombstoned row with logs still pointing at it is planned.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { planLookAlikeMerge, type GroupKind, type MergeFood, type PlannedGroup } from '@trainingai/shared/nutrition/food-merge'
import type { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'

type Db = ReturnType<typeof getDb>

export interface MergeReportFood {
  id: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  liveLogs: number
}

export interface MergeReportGroup {
  groupKey: string
  name: string
  brand: string | null
  kind: GroupKind
  automatic: boolean
  keeperChosenBy: 'most-logged' | 'owner'
  keeper: MergeReportFood
  extras: (MergeReportFood & { factor: number; logsToMove: number; mealItemsToMove: number; tombstone: boolean })[]
  /** Set after a write: what the transaction did, or why it rolled back. */
  result?: { logsMoved: number; mealItemsMoved: number; tombstoned: number } | { failed: string }
}

export interface MergeReport {
  dryRun: boolean
  totals: {
    groups: number
    automatic: number
    needsReview: number
    extras: number
    logsToMove: number
    mealItemsToMove: number
  }
  groups: MergeReportGroup[]
  skipped: { groupKey: string; reason: string }[]
  /** Dates (local, as stored) of the logs a write moved. */
  datesTouched: string[]
  failedGroups: number
}

export type MergeResult =
  | { ok: true; report: MergeReport }
  | { ok: false; error: string }

async function loadFoods(db: Db, userId: string): Promise<(MergeFood & { name: string; brand: string | null; barcode: string | null; image: string | null })[]> {
  const items = await db.select().from(s.foodItems).where(eq(s.foodItems.userId, userId)).orderBy(asc(s.foodItems.createdAt))
  const logCounts = await db
    .select({
      id: s.foodLogs.foodItemId,
      all: sql<number>`count(*)::int`,
      live: sql<number>`count(*) FILTER (WHERE ${s.foodLogs.deletedAt} IS NULL)::int`,
    })
    .from(s.foodLogs).where(eq(s.foodLogs.userId, userId)).groupBy(s.foodLogs.foodItemId)
  const mealCounts = await db
    .select({ id: s.savedMealItems.foodItemId, n: sql<number>`count(*)::int` })
    .from(s.savedMealItems)
    .innerJoin(s.savedMeals, eq(s.savedMealItems.savedMealId, s.savedMeals.id))
    .where(eq(s.savedMeals.userId, userId)).groupBy(s.savedMealItems.foodItemId)
  const logs = new Map(logCounts.map(r => [r.id, r]))
  const meals = new Map(mealCounts.map(r => [r.id, r.n]))
  return items.map(i => ({
    id: i.id, name: i.name, brand: i.brand ?? null,
    servingSizeG: i.servingSizeG, calories: i.calories, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG,
    fiberG: i.fiberG, sugarG: i.sugarG, sodiumMg: i.sodiumMg, satFatG: i.satFatG,
    createdAtMs: i.createdAt.getTime(),
    tombstoned: i.deletedAt != null,
    liveLogs: logs.get(i.id)?.live ?? 0,
    allLogs: logs.get(i.id)?.all ?? 0,
    mealItems: meals.get(i.id) ?? 0,
    barcode: i.barcode ?? null,
    image: i.imageDataUri ?? null,
  }))
}

export async function mergeLookAlikeFoods(
  db: Db, userId: string, opts: { dryRun: boolean; keepers?: Record<string, string> },
): Promise<MergeResult> {
  const foods = await loadFoods(db, userId)
  const plan = planLookAlikeMerge(foods, opts.keepers ?? {})
  if (plan.invalidKeepers.length > 0) {
    // Refused before anything is written, in a dry run too, so a typo shows up when it is cheap.
    return { ok: false, error: `keepers refused: ${plan.invalidKeepers.map(k => `"${k.groupKey}" (${k.reason})`).join('; ')}` }
  }

  const byId = new Map(foods.map(f => [f.id, f]))
  const describe = (f: MergeFood): MergeReportFood => ({
    id: f.id, servingSizeG: f.servingSizeG, calories: f.calories,
    proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, liveLogs: f.liveLogs,
  })
  const groups: MergeReportGroup[] = plan.groups.map(g => {
    const keeper = byId.get(g.keeperId)!
    return {
      groupKey: g.groupKey, name: keeper.name, brand: keeper.brand,
      kind: g.kind, automatic: g.automatic, keeperChosenBy: g.keeperChosenBy,
      keeper: describe(keeper),
      extras: g.extras.map(e => ({
        ...describe(byId.get(e.id)!),
        factor: e.factor, logsToMove: e.logsToMove, mealItemsToMove: e.mealItemsToMove, tombstone: e.tombstone,
      })),
    }
  })

  const report: MergeReport = {
    dryRun: opts.dryRun,
    totals: {
      groups: groups.length,
      automatic: groups.filter(g => g.automatic).length,
      needsReview: groups.filter(g => !g.automatic).length,
      extras: groups.reduce((n, g) => n + g.extras.length, 0),
      logsToMove: groups.reduce((n, g) => n + g.extras.reduce((m, e) => m + e.logsToMove, 0), 0),
      mealItemsToMove: groups.reduce((n, g) => n + g.extras.reduce((m, e) => m + e.mealItemsToMove, 0), 0),
    },
    groups,
    skipped: plan.skipped,
    datesTouched: [],
    failedGroups: 0,
  }
  if (opts.dryRun) return { ok: true, report }

  const dates = new Set<string>()
  for (const planned of plan.groups) {
    const out = groups.find(g => g.groupKey === planned.groupKey)!
    try {
      const done = await applyGroup(db, userId, planned, byId)
      for (const d of done.dates) dates.add(d)
      out.result = { logsMoved: done.logsMoved, mealItemsMoved: done.mealItemsMoved, tombstoned: done.tombstoned }
    } catch (err) {
      report.failedGroups++
      out.result = { failed: err instanceof Error ? err.message : String(err) }
    }
  }
  report.datesTouched = [...dates].sort()
  return { ok: true, report }
}

async function applyGroup(
  db: Db, userId: string, g: PlannedGroup,
  byId: Map<string, MergeFood & { barcode: string | null; image: string | null }>,
): Promise<{ logsMoved: number; mealItemsMoved: number; tombstoned: number; dates: string[] }> {
  return db.transaction(async tx => {
    let logsMoved = 0, mealItemsMoved = 0, tombstoned = 0
    const groupDates: string[] = []
    const now = new Date()

    for (const e of g.extras) {
      // Scoped on the user in the WHERE, so a row of someone else's can never be moved even if an id
      // were wrong. `quantity_multiplier * factor` is the whole of the rescale: grams eaten are
      // servingSizeG x multiplier, and factor is the ratio of the two serving sizes.
      const moved = await tx.update(s.foodLogs)
        .set({
          foodItemId: g.keeperId,
          quantityMultiplier: sql`${s.foodLogs.quantityMultiplier} * ${e.factor}`,
          updatedAt: now,
        })
        .where(and(eq(s.foodLogs.userId, userId), eq(s.foodLogs.foodItemId, e.id)))
        .returning({ date: s.foodLogs.date })
      logsMoved += moved.length
      for (const m of moved) groupDates.push(m.date)

      const mealMeals = tx.select({ id: s.savedMeals.id }).from(s.savedMeals).where(eq(s.savedMeals.userId, userId))
      const movedItems = await tx.update(s.savedMealItems)
        .set({
          foodItemId: g.keeperId,
          quantityMultiplier: sql`${s.savedMealItems.quantityMultiplier} * ${e.factor}`,
        })
        .where(and(eq(s.savedMealItems.foodItemId, e.id), inArray(s.savedMealItems.savedMealId, mealMeals)))
        .returning({ id: s.savedMealItems.id })
      mealItemsMoved += movedItems.length

      if (e.tombstone) {
        const done = await tx.update(s.foodItems)
          .set({ deletedAt: now })
          .where(and(eq(s.foodItems.id, e.id), eq(s.foodItems.userId, userId), isNull(s.foodItems.deletedAt)))
          .returning({ id: s.foodItems.id })
        tombstoned += done.length
      }
    }

    // Add-only, like `fillFoodItemGaps`: the keeper's own barcode or picture is never replaced, and
    // nothing is nulled. Taken from the most-used extra that has one.
    const keeper = byId.get(g.keeperId)!
    const barcode = keeper.barcode ? null : g.extras.map(e => byId.get(e.id)!.barcode).find(b => b) ?? null
    const image = keeper.image ? null : g.extras.map(e => byId.get(e.id)!.image).find(i => i) ?? null
    if (barcode || image) {
      await tx.update(s.foodItems)
        .set({
          ...(barcode ? { barcode: sql`COALESCE(${s.foodItems.barcode}, ${barcode}::text)` } : {}),
          ...(image ? { imageDataUri: sql`COALESCE(${s.foodItems.imageDataUri}, ${image}::text)` } : {}),
        })
        .where(and(eq(s.foodItems.id, g.keeperId), eq(s.foodItems.userId, userId)))
    }

    return { logsMoved, mealItemsMoved, tombstoned, dates: groupDates }
  })
}
