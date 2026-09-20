import { movementPattern, type MovementPattern } from '@trainingai/shared/muscles'

/**
 * OR-118 — fold per-muscle set counts into push / pull / legs / other.
 *
 * The finding this exists to show, measured over 60 days: legs 481 (33%) · push 433 (30%) ·
 * pull 333 (23%) · other 168 (11%). The pull deficit is the point, and the owner should not have to
 * run a query to see it.
 *
 * **The classification is `movementPattern`'s and must not be re-derived here.** Two of its calls
 * are counter-intuitive and both are argued in `packages/shared/src/muscles.ts`: `shoulders` counts
 * as **push**, and `lower back` as **other** rather than legs or pull, because counting it as legs
 * would inflate legs on pull days. Reaching for intuition on either changes the ratio the card
 * exists to report.
 *
 * **`other` is a real bucket, not a dumping ground for unmapped names** — the shared module asserts
 * that every muscle in the landmark table and the exercise catalogue resolves, so an unknown name
 * fails there rather than quietly padding this row.
 */

/** Fixed display order. Not sorted by size: the reader is comparing push against pull, and a row
 *  that moves between visits makes that comparison harder than it needs to be. */
export const PATTERN_ORDER: MovementPattern[] = ['push', 'pull', 'legs', 'other']

export const PATTERN_LABEL: Record<MovementPattern, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  other: 'Core & other',
}

export interface MovementBalanceRow {
  pattern: MovementPattern
  /** Weighted sets, as the route reports them — secondary muscles already count 0.5. */
  sets: number
  /** Share of the window's total, 0–100. Zero when nothing was logged. */
  pct: number
}

export interface MovementBalance {
  rows: MovementBalanceRow[]
  total: number
}

/**
 * Group the window's per-muscle rows by movement pattern.
 *
 * Returns every pattern, including ones with no sets: a **zero pull row is the finding**, and
 * dropping empty rows would hide exactly the case worth seeing.
 */
export function movementBalance(
  muscles: { muscle: string; sets: number }[],
): MovementBalance {
  const totals: Record<MovementPattern, number> = { push: 0, pull: 0, legs: 0, other: 0 }
  for (const { muscle, sets } of muscles) {
    // A negative or non-finite count is not a real reading; ignoring it keeps one bad row from
    // making every percentage on the card wrong.
    if (!Number.isFinite(sets) || sets <= 0) continue
    totals[movementPattern(muscle)] += sets
  }

  const total = PATTERN_ORDER.reduce((sum, p) => sum + totals[p], 0)
  return {
    total,
    rows: PATTERN_ORDER.map(pattern => ({
      pattern,
      sets: totals[pattern],
      pct: total > 0 ? (totals[pattern] / total) * 100 : 0,
    })),
  }
}
