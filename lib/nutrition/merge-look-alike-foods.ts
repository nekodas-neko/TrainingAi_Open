// Merging look-alike `food_items` rows into one keeper (#2417). The admin job `merge-look-alike-foods`
// (`lib/agent-actions/jobs.ts`) is the only caller.
//
// What decides who keeps and how a quantity is rescaled is `planLookAlikeMerge`
// (`packages/shared/src/nutrition/food-merge.ts`); this file reads the rows, asks it, and writes.
//
// A write, per group and in one transaction:
//   1. every LIVE food log of an extra points at the keeper, with `quantity_multiplier` rescaled by
//      the serving-size ratio. `trg_set_updated_at` bumps `updated_at` on any update, which is what
//      carries the change to devices on their next pull. A DELETED log is left where it is: the same
//      trigger would bump it too, and `isSkipped` (`slices/meal-logging-statuses.ts`) reads a deleted
//      log newer than a skip's `decided_at` as the skip being cancelled, so moving it would silently
//      un-skip a past meal and turn the day's `complete` false. The row it points at is only
//      tombstoned, never deleted, so the foreign key and a later read by id still hold;
//   2. every saved-meal ingredient of an extra likewise;
//   3. the keeper takes the barcode and picture of an extra when it has none of its own (add-only),
//      so a later scan of that product still resolves from the library;
//   4. each extra gets `deleted_at`. The row is never deleted: a device that has not synced may
//      still log against it, and that log must keep working.
//
// Only groups whose merge leaves every moved log's calories and macros unchanged are `automatic`
// (see `food-merge.ts`); `only: 'exact'` merges just those. The rest are the owner's review.
//
// A group where a rescaled quantity would leave the push range (0.01 to 100, `quantity-bounds.ts`) is
// reported as needing review and is not written, in any mode: the owner picks a keeper whose serving
// size keeps every quantity in range.
//
// A group that fails rolls back alone and is reported; the others still run. Run again, a merged
// group plans nothing. Run after a straggler (a log an unsynced device pushed against a retired row)
// and the straggler moves, which is why a tombstoned row with logs still pointing at it is planned.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { planLookAlikeMerge, type GroupKind, type MergeFood, type PlannedGroup, type WorstChange } from '@trainingai/shared/nutrition/food-merge'
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
  /** The worst change to any moved log's calories and macros (kcal whole, macros 0.1 g). All zero for an automatic group. */
  worstChange: WorstChange
  extras: (MergeReportFood & { factor: number; logsToMove: number; mealItemsToMove: number; tombstone: boolean; worstChange: WorstChange })[]
  /** A moved quantity would fall outside the range the push accepts, so the group needs review and a write skips it. */
  quantityOutOfRange: boolean
  /** Set after a write: what the transaction did, why it rolled back, or why it was left alone. */
  result?: { logsMoved: number; mealItemsMoved: number; tombstoned: number } | { failed: string } | { skipped: string }
}

export interface MergeReport {
  dryRun: boolean
  totals: {
    groups: number
    /** `identical` + `sameExact`: the groups `only: 'exact'` merges. */
    automatic: number
    /** Same serving, same numbers. */
    identical: number
    /** Same per 100 g, and every moved log's calories and macros come out exactly as before. */
    sameExact: number
    /** Everything else: a non-zero change in calories or macros, or the foods genuinely differ. */
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
      live: sql<number>`count(*) FILTER (WHERE ${s.foodLogs.deletedAt} IS NULL)::int`,
    })
    .from(s.foodLogs).where(eq(s.foodLogs.userId, userId)).groupBy(s.foodLogs.foodItemId)
  const mealCounts = await db
    .select({ id: s.savedMealItems.foodItemId, n: sql<number>`count(*)::int` })
    .from(s.savedMealItems)
    .innerJoin(s.savedMeals, eq(s.savedMealItems.savedMealId, s.savedMeals.id))
    .where(eq(s.savedMeals.userId, userId)).groupBy(s.savedMealItems.foodItemId)
  const logQty = await db
    .selectDistinct({ id: s.foodLogs.foodItemId, q: s.foodLogs.quantityMultiplier })
    .from(s.foodLogs).where(and(eq(s.foodLogs.userId, userId), isNull(s.foodLogs.deletedAt)))
  const mealQty = await db
    .selectDistinct({ id: s.savedMealItems.foodItemId, q: s.savedMealItems.quantityMultiplier })
    .from(s.savedMealItems)
    .innerJoin(s.savedMeals, eq(s.savedMealItems.savedMealId, s.savedMeals.id))
    .where(eq(s.savedMeals.userId, userId))
  const quantities = new Map<string, Set<number>>()
  for (const r of [...logQty, ...mealQty]) {
    const set = quantities.get(r.id) ?? new Set<number>()
    set.add(Number(r.q))
    quantities.set(r.id, set)
  }
  const logs = new Map(logCounts.map(r => [r.id, r]))
  const meals = new Map(mealCounts.map(r => [r.id, r.n]))
  return items.map(i => ({
    id: i.id, name: i.name, brand: i.brand ?? null,
    servingSizeG: i.servingSizeG, calories: i.calories, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG,
    fiberG: i.fiberG, sugarG: i.sugarG, sodiumMg: i.sodiumMg, satFatG: i.satFatG,
    createdAtMs: i.createdAt.getTime(),
    tombstoned: i.deletedAt != null,
    liveLogs: logs.get(i.id)?.live ?? 0,
    mealItems: meals.get(i.id) ?? 0,
    quantities: [...(quantities.get(i.id) ?? [])],
    barcode: i.barcode ?? null,
    image: i.imageDataUri ?? null,
  }))
}

export async function mergeLookAlikeFoods(
  db: Db, userId: string, opts: { dryRun: boolean; keepers?: Record<string, string>; only?: 'exact' },
): Promise<MergeResult> {
  const foods = await loadFoods(db, userId)
  const plan = planLookAlikeMerge(foods, opts.keepers ?? {})
  if (plan.invalidKeepers.length > 0) {
    // Refused before anything is written, in a dry run too, so a typo shows up when it is cheap.
    return { ok: false, error: `keepers refused: ${plan.invalidKeepers.map(k => `"${k.groupKey}" (${k.reason})`).join('; ')}` }
  }

  // `only: 'exact'` leaves every group that is not automatic untouched, in the dry run too, so the
  // dry run shows what the write would do.
  const skipped = [...plan.skipped]
  if (opts.only === 'exact') {
    plan.groups = plan.groups.filter(g => {
      if (g.automatic) return true
      skipped.push({ groupKey: g.groupKey, reason: 'needs owner review (only: exact)' })
      return false
    })
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
      kind: g.kind, automatic: g.automatic, quantityOutOfRange: g.quantityOutOfRange, worstChange: g.worstChange, keeperChosenBy: g.keeperChosenBy,
      keeper: describe(keeper),
      extras: g.extras.map(e => ({
        ...describe(byId.get(e.id)!),
        factor: e.factor, logsToMove: e.logsToMove, mealItemsToMove: e.mealItemsToMove, tombstone: e.tombstone, worstChange: e.worstChange,
      })),
    }
  })

  const report: MergeReport = {
    dryRun: opts.dryRun,
    totals: {
      groups: groups.length,
      automatic: groups.filter(g => g.automatic).length,
      identical: groups.filter(g => g.automatic && g.kind === 'identical').length,
      sameExact: groups.filter(g => g.automatic && g.kind === 'same-per-100g').length,
      needsReview: groups.filter(g => !g.automatic).length,
      extras: groups.reduce((n, g) => n + g.extras.length, 0),
      logsToMove: groups.reduce((n, g) => n + g.extras.reduce((m, e) => m + e.logsToMove, 0), 0),
      mealItemsToMove: groups.reduce((n, g) => n + g.extras.reduce((m, e) => m + e.mealItemsToMove, 0), 0),
    },
    groups,
    skipped,
    datesTouched: [],
    failedGroups: 0,
  }
  if (opts.dryRun) return { ok: true, report }

  const dates = new Set<string>()
  for (const planned of plan.groups) {
    const out = groups.find(g => g.groupKey === planned.groupKey)!
    if (planned.quantityOutOfRange) {
      // A log stored past the push range is dead-lettered the next time a device edits it, so the
      // group is left whole for the owner rather than written.
      out.result = { skipped: 'a rescaled quantity would fall outside the range a device can push (0.01 to 100)' }
      continue
    }
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

/** A count that differs from the plan means the rows changed under us: throw, which rolls the group back. */
function expectCount(what: string, got: number, expected: number): void {
  if (got !== expected) throw new Error(`${what}: expected ${expected}, got ${got}`)
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
        .where(and(eq(s.foodLogs.userId, userId), eq(s.foodLogs.foodItemId, e.id), isNull(s.foodLogs.deletedAt)))
        .returning({ date: s.foodLogs.date })
      expectCount('food logs moved', moved.length, e.logsToMove)
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
      expectCount('saved-meal ingredients moved', movedItems.length, e.mealItemsToMove)
      mealItemsMoved += movedItems.length

      if (e.tombstone) {
        const done = await tx.update(s.foodItems)
          .set({ deletedAt: now })
          .where(and(eq(s.foodItems.id, e.id), eq(s.foodItems.userId, userId), isNull(s.foodItems.deletedAt)))
          .returning({ id: s.foodItems.id })
        expectCount('extras tombstoned', done.length, 1)
        tombstoned += done.length
      }
    }

    // Add-only, like `fillFoodItemGaps`: the keeper's own barcode or picture is never replaced, and
    // nothing is nulled. Taken from the most-used extra that has one.
    const keeper = byId.get(g.keeperId)!
    const barcode = keeper.barcode ? null : g.extras.map(e => byId.get(e.id)!.barcode).find(b => b) ?? null
    const image = keeper.image ? null : g.extras.map(e => byId.get(e.id)!.image).find(i => i) ?? null
    if (barcode || image) {
      const filled = await tx.update(s.foodItems)
        .set({
          ...(barcode ? { barcode: sql`COALESCE(${s.foodItems.barcode}, ${barcode}::text)` } : {}),
          ...(image ? { imageDataUri: sql`COALESCE(${s.foodItems.imageDataUri}, ${image}::text)` } : {}),
        })
        .where(and(eq(s.foodItems.id, g.keeperId), eq(s.foodItems.userId, userId)))
        .returning({ id: s.foodItems.id })
      expectCount('keeper rows filled', filled.length, 1)
    }

    return { logsMoved, mealItemsMoved, tombstoned, dates: groupDates }
  })
}
