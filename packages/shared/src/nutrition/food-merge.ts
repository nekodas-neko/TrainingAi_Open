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
  /** Live (not deleted) food logs that point at this row: what "most-logged" counts. */
  liveLogs: number
  /** Every food log that points at this row, deleted ones included. These all move. */
  allLogs: number
  /** Saved-meal ingredients that point at this row. These all move. */
  mealItems: number
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
  /** Food logs (deleted ones too) that move to the keeper. */
  logsToMove: number
  mealItemsToMove: number
  /** False for a row already tombstoned that only has stragglers left to move. */
  tombstone: boolean
}

export interface PlannedGroup {
  groupKey: string
  kind: GroupKind
  /** `identical` and `same-per-100g` merge with no one's say-so; `differs` is the owner's review. */
  automatic: boolean
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

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

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
      .filter(r => !r.tombstoned || r.allLogs > 0 || r.mealItems > 0)
    if (extras.length === 0) continue

    if (!usableServing(keeper.servingSizeG) || extras.some(e => !usableServing(e.servingSizeG))) {
      skipped.push({ groupKey, reason: 'a serving size is zero or not a number, so a quantity cannot be rescaled' })
      continue
    }

    const kind = groupKind(rows)
    groups.push({
      groupKey,
      kind,
      automatic: kind !== 'differs',
      keeperId: keeper.id,
      keeperChosenBy: named ? 'owner' : 'most-logged',
      extras: extras
        .sort(byKeeperRank)
        .map(e => ({
          id: e.id,
          factor: e.servingSizeG === keeper.servingSizeG ? 1 : e.servingSizeG / keeper.servingSizeG,
          logsToMove: e.allLogs,
          mealItemsToMove: e.mealItems,
          tombstone: !e.tombstoned,
        })),
    })
  }

  return { groups, skipped, invalidKeepers }
}
