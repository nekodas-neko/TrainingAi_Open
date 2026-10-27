// Planning the merge of look-alike `food_items` rows (#2417).
//
// PURE: no I/O, no clock, no DB. `lib/nutrition/merge-look-alike-foods.ts` loads the rows, asks this
// file what to do, and does it.
//
// ## What a look-alike is
//
// Two rows with the same name and brand, compared for case and whitespace only (the same
// normalisation as `food-item-identity.ts`, which stops NEW exact duplicates). Serving size and
// macros are NOT part of the key: the point of this file is the rows `foodItemIdentityKey` leaves
// alone because their numbers differ.
//
// ## What moves, and why the quantity is rescaled
//
// A log stores `quantityMultiplier` against ITS food's serving size, so the grams eaten are
// `servingSizeG x quantityMultiplier`. Pointing the log at a keeper with another serving size would
// change what it means unless the multiplier is rescaled by `extra.servingSizeG / keeper.servingSizeG`.
// With that factor the grams are the same by construction, and so are the calories and macros
// whenever the two foods agree per 100 g. When they do NOT agree (the groups the owner reviews) the
// grams still hold and the numbers become the keeper's: that is the owner's choice, not an error.
//
// ## What "automatic" means
//
// The owner made a group automatic because the merge leaves calories and macros exactly unchanged
// (#2417, 2026-10-09). "Same per 100 g" within rounding does NOT guarantee that: a 30 g / 16 kcal
// keeper and a 100 g / 52 kcal extra agree within rounding, yet a 1x log of the extra moves from 52
// to 53 kcal. So each extra's worst per-log change is computed from the quantities actually logged,
// at the precision the numbers are stored in (kcal whole, macros 0.1 g), and a group is automatic
// only when every one of those changes is zero.

import { text as norm } from './food-item-identity'

/** The columns the plan reads. A superset is fine. */
export interface MergeFood {
  id: string
  name: string
  brand?: string | null
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number | null
  sugarG?: number | null
  sodiumMg?: number | null
  satFatG?: number | null
  /** Epoch ms. Breaks a tie in log count: the newest row wins. */
  createdAtMs: number
  /** Already merged away. Only kept in the input so a log still pointing at it can be moved. */
  tombstoned: boolean
  /**
   * Live (not deleted) food logs that point at this row: what "most-logged" counts, and what moves.
   * A deleted log stays where it is (see `merge-look-alike-foods.ts`).
   */
  liveLogs: number
  /** Saved-meal ingredients that point at this row. These all move. */
  mealItems: number
  /**
   * The distinct `quantity_multiplier` values of every log (live ones) and saved-meal
   * ingredient pointing at this row. Used to measure what the merge does to each. Omitted means none.
   */
  quantities?: number[]
}

/** The largest change a merge makes to any one log or ingredient, at stored precision. */
export interface WorstChange {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * How alike a group's rows are.
 * - `identical`: same serving size and every number equal.
 * - `same-per-100g`: calories, protein, carbs and fat agree per 100 g within the rounding the stored
 *   numbers already carry, at different serving sizes.
 * - `differs`: they disagree per 100 g. The owner may name the keeper.
 */
export type GroupKind = 'identical' | 'same-per-100g' | 'differs'

export interface PlannedExtra {
  id: string
  /** `extra.servingSizeG / keeper.servingSizeG`, exactly 1 when the serving sizes are equal. */
  factor: number
  /** Live food logs that move to the keeper. */
  logsToMove: number
  mealItemsToMove: number
  /** False for a row already tombstoned that only has stragglers left to move. */
  tombstone: boolean
  /** Worst change to a moved log's calories and macros once rescaled onto the keeper. All zero when exact. */
  worstChange: WorstChange
}

export interface PlannedGroup {
  groupKey: string
  kind: GroupKind
  /**
   * True only when no moved log changes in calories or macros (`worstChange` is zero for every
   * extra). Every `identical` group is; a `same-per-100g` group is only when the rounding happens to
   * cancel at the quantities logged. Anything else is the owner's review.
   */
  automatic: boolean
  /** The worst of the extras' `worstChange`, per field. */
  worstChange: WorstChange
  keeperId: string
  keeperChosenBy: 'most-logged' | 'owner'
  extras: PlannedExtra[]
}

export interface MergePlan {
  /** Groups with something to do, in a stable order. */
  groups: PlannedGroup[]
  /** Groups left alone and why (an unusable serving size). */
  skipped: { groupKey: string; reason: string }[]
  /** `keepers` entries that name nothing usable. Any entry here refuses the whole run. */
  invalidKeepers: { groupKey: string; reason: string }[]
}


/** The key two rows share when they are look-alikes. Shown to the owner, who passes it back in `keepers`. */
export function lookAlikeKey(f: { name: string; brand?: string | null }): string {
  return `${norm(f.name)} | ${norm(f.brand)}`
}

// Stored values carry their own rounding: calories are an integer, macros are kept to 0.1 g. Two
// rows describing one food at different serving sizes can therefore disagree per 100 g by up to the
// rounding of each, scaled to 100 g. That, and nothing wider, is "the same per 100 g".
const KCAL_HALF_UNIT = 0.5
const GRAM_HALF_UNIT = 0.05
const EPS = 1e-9

const usableServing = (g: number) => Number.isFinite(g) && g > 0

function samePer100g(a: MergeFood, b: MergeFood): boolean {
  const near = (x: number, y: number, half: number) =>
    Math.abs(x * 100 / a.servingSizeG - y * 100 / b.servingSizeG) <=
    half * 100 / a.servingSizeG + half * 100 / b.servingSizeG + EPS
  return near(a.calories, b.calories, KCAL_HALF_UNIT) &&
    near(a.proteinG, b.proteinG, GRAM_HALF_UNIT) &&
    near(a.carbsG, b.carbsG, GRAM_HALF_UNIT) &&
    near(a.fatG, b.fatG, GRAM_HALF_UNIT)
}

const ZERO: WorstChange = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
// The app's own per-log rounding (computeLogMacros): kcal whole, macros to 0.1 g, no epsilon.
const shownKcal = (v: number) => Math.round(v)
const shownG = (v: number) => Math.round(v * 10) / 10
const clean = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * What re-pointing `extra` at `keeper` does to the logs and ingredients it has, as the app would show
 * them: calories whole, macros to 0.1 g, from `food x quantity`. The quantity is rescaled by
 * `factor`, so the grams are the same and only the per-gram numbers can differ.
 */
export function worstChangeOf(extra: MergeFood, keeper: MergeFood, factor: number): WorstChange {
  const worst = { ...ZERO }
  for (const q of extra.quantities ?? []) {
    const moved = q * factor
    worst.kcal = Math.max(worst.kcal, Math.abs(shownKcal(keeper.calories * moved) - shownKcal(extra.calories * q)))
    worst.proteinG = Math.max(worst.proteinG, Math.abs(shownG(keeper.proteinG * moved) - shownG(extra.proteinG * q)))
    worst.carbsG = Math.max(worst.carbsG, Math.abs(shownG(keeper.carbsG * moved) - shownG(extra.carbsG * q)))
    worst.fatG = Math.max(worst.fatG, Math.abs(shownG(keeper.fatG * moved) - shownG(extra.fatG * q)))
  }
  return { kcal: clean(worst.kcal), proteinG: clean(worst.proteinG), carbsG: clean(worst.carbsG), fatG: clean(worst.fatG) }
}

const isZero = (w: WorstChange) => w.kcal === 0 && w.proteinG === 0 && w.carbsG === 0 && w.fatG === 0

const optionalEqual = (x: number | null | undefined, y: number | null | undefined) =>
  (x ?? null) === (y ?? null)

function identical(a: MergeFood, b: MergeFood): boolean {
  return a.servingSizeG === b.servingSizeG &&
    a.calories === b.calories && a.proteinG === b.proteinG && a.carbsG === b.carbsG && a.fatG === b.fatG &&
    optionalEqual(a.fiberG, b.fiberG) && optionalEqual(a.sugarG, b.sugarG) &&
    optionalEqual(a.sodiumMg, b.sodiumMg) && optionalEqual(a.satFatG, b.satFatG)
}

/** The group's kind is the least alike pair in it, so it does not depend on which row keeps. */
export function groupKind(rows: MergeFood[]): GroupKind {
  let kind: GroupKind = 'identical'
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (identical(rows[i], rows[j])) continue
      if (samePer100g(rows[i], rows[j])) { kind = 'same-per-100g'; continue }
      return 'differs'
    }
  }
  return kind
}

/** Most-logged wins; the newest row on a tie; the id last so the answer never depends on input order. */
function byKeeperRank(a: MergeFood, b: MergeFood): number {
  return b.liveLogs - a.liveLogs || b.createdAtMs - a.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Decides every group: who keeps, who is retired, and how many logs and saved-meal ingredients move.
 *
 * `keepers` maps a group key to the id of the row the owner wants kept. Idempotent by construction:
 * a group with one live row and nothing still pointing at a tombstoned sibling plans nothing, so a
 * second run after a merge finds no work.
 */
export function planLookAlikeMerge(foods: MergeFood[], keepers: Record<string, string> = {}): MergePlan {
  const byKey = new Map<string, MergeFood[]>()
  for (const f of foods) {
    const k = lookAlikeKey(f)
    const g = byKey.get(k)
    if (g) g.push(f); else byKey.set(k, [f])
  }

  const groups: PlannedGroup[] = []
  const skipped: MergePlan['skipped'] = []
  const invalidKeepers: MergePlan['invalidKeepers'] = []

  for (const k of Object.keys(keepers)) {
    const rows = byKey.get(k)
    if (!rows || rows.length < 2) {
      invalidKeepers.push({ groupKey: k, reason: 'no group of look-alike foods has this key' })
      continue
    }
    const named = rows.find(r => r.id === keepers[k])
    if (!named) invalidKeepers.push({ groupKey: k, reason: 'the food named is not in this group' })
    else if (named.tombstoned) invalidKeepers.push({ groupKey: k, reason: 'the food named has already been merged away' })
  }

  for (const [groupKey, rows] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (rows.length < 2) continue
    const live = rows.filter(r => !r.tombstoned).sort(byKeeperRank)
    if (live.length === 0) continue
    const named = keepers[groupKey] !== undefined ? live.find(r => r.id === keepers[groupKey]) : undefined
    const keeper = named ?? live[0]

    const extras = rows
      .filter(r => r.id !== keeper.id)
      // A tombstoned row with nothing left pointing at it is finished business.
      .filter(r => !r.tombstoned || r.liveLogs > 0 || r.mealItems > 0)
    if (extras.length === 0) continue

    if (!usableServing(keeper.servingSizeG) || extras.some(e => !usableServing(e.servingSizeG))) {
      skipped.push({ groupKey, reason: 'a serving size is zero or not a number, so a quantity cannot be rescaled' })
      continue
    }

    const kind = groupKind(rows)
    const planned = extras
      .sort(byKeeperRank)
      .map(e => {
        const factor = e.servingSizeG === keeper.servingSizeG ? 1 : e.servingSizeG / keeper.servingSizeG
        return {
          id: e.id,
          factor,
          logsToMove: e.liveLogs,
          mealItemsToMove: e.mealItems,
          tombstone: !e.tombstoned,
          worstChange: kind === 'identical' ? { ...ZERO } : worstChangeOf(e, keeper, factor),
        }
      })
    const worst = planned.reduce<WorstChange>((w, e) => ({
      kcal: Math.max(w.kcal, e.worstChange.kcal), proteinG: Math.max(w.proteinG, e.worstChange.proteinG),
      carbsG: Math.max(w.carbsG, e.worstChange.carbsG), fatG: Math.max(w.fatG, e.worstChange.fatG),
    }), { ...ZERO })
    groups.push({
      groupKey,
      kind,
      // A `differs` group changes numbers by definition, even if the quantities logged hide it.
      automatic: kind !== 'differs' && isZero(worst),
      worstChange: worst,
      keeperId: keeper.id,
      keeperChosenBy: named ? 'owner' : 'most-logged',
      extras: planned,
    })
  }

  return { groups, skipped, invalidKeepers }
}
