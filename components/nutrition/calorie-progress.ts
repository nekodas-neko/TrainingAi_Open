import {
  ON_TARGET_KCAL, OUTER_KCAL, balanceZone, type BalanceZone,
} from '@trainingai/shared/nutrition/calorie-balance'

/**
 * Q-323 — the calorie bar as something you finish, not a gauge you sit somewhere on.
 *
 * The owner's words: *"more like Red/Orange/green; all the way like a progress bar with the green
 * towards the end, and then a little orange/red bar after to depict going over. So it still looks
 * like a progress bar where you want to go to the end."* The bar it replaces drew a fixed ±550 kcal
 * deviation scale with a marker on it — the marker sat mid-track at 8am and mid-track again at 8pm,
 * so it read as a dial rather than as progress through a day.
 *
 * **Nothing here re-decides what "on target" means.** The bands are laid out from `ON_TARGET_KCAL`
 * and `OUTER_KCAL`, and the fill's colour comes from `balanceZone()` — the same call the Energy
 * Balance card's headline uses. That matters more than it looks: Q-401 and Q-415 are both one
 * surface re-deriving a calorie figure the app had already computed, and this bar is drawn on two
 * screens at once.
 *
 * A `.ts` beside the component rather than inside it: both vitest projects are `environment: 'node'`
 * and cannot parse JSX, so arithmetic living in a `.tsx` cannot be asserted at all.
 */

export interface ProgressBand {
  zone: BalanceZone
  color: string
  /** Share of the whole track, left to right. */
  widthPct: number
}

/**
 * How far past the goal the track runs.
 *
 * The over-side bands mirror the under-side ones in kcal — amber for the first `OUTER − ON_TARGET`
 * beyond the on-target band, then red for the same again. The under side looks longer only because
 * a day can be arbitrarily under and its red band therefore runs all the way back to zero eaten.
 *
 * So the tail is not a tuned length; it is the same two thresholds reflected. On a ~2,200 kcal
 * budget the goal notch lands around 77% of the track, which is what keeps the tail from reading as
 * a second target to walk toward — and it turns red before it ends.
 */
export const OVERSHOOT_TAIL_KCAL = OUTER_KCAL + (OUTER_KCAL - ON_TARGET_KCAL)

/** Where the track ends, in kcal eaten. */
export function trackEndKcal(budgetKcal: number): number {
  return Math.max(1, budgetKcal) + OVERSHOOT_TAIL_KCAL
}

/**
 * The five bands as shares of the track width, for a given day's budget.
 *
 * Budget-dependent by necessity: the bands are fixed *kcal* offsets from the goal, and the goal
 * moves during the day as movement is earned — so a fixed set of percentages would drift away from
 * the thresholds the colour of the fill is decided by.
 */
export function progressBands(budgetKcal: number): ProgressBand[] {
  const end = trackEndKcal(budgetKcal)
  const goal = Math.max(1, budgetKcal)
  // Boundaries in kcal eaten, clamped so a tiny budget cannot produce negative widths.
  const bounds = [
    Math.max(0, goal - OUTER_KCAL),
    Math.max(0, goal - ON_TARGET_KCAL),
    Math.min(end, goal + ON_TARGET_KCAL),
    Math.min(end, goal + OUTER_KCAL),
    end,
  ]
  const zones: BalanceZone[] = ['far_under', 'under', 'on_target', 'over', 'far_over']
  let prev = 0
  return zones.map((zone, i) => {
    const width = Math.max(0, bounds[i] - prev)
    prev = bounds[i]
    return { zone, color: zoneColor(zone), widthPct: (width / end) * 100 }
  })
}

/** The band colours, taken from `balanceZone` so there is no second palette to drift. */
function zoneColor(zone: BalanceZone): string {
  // `balanceZone` maps a deviation to a zone; these deviations are the middle of each band.
  const probe: Record<BalanceZone, number> = {
    far_under: -OUTER_KCAL - 1,
    under: -OUTER_KCAL + 1,
    on_target: 0,
    over: OUTER_KCAL - 1,
    far_over: OUTER_KCAL + 1,
  }
  return balanceZone(probe[zone]).color
}

export interface ProgressFill {
  /** Width of the fill, 0..100, as a share of the whole track. */
  fillPct: number
  /** Where the goal sits on the track, 0..100 — the notch the fill is walking toward. */
  goalPct: number
  zone: BalanceZone
  /** Paired text, because colour is never the only signal here. */
  label: string
  color: string
  /** kcal still to eat to land on the goal. Negative once past it. */
  remainingKcal: number
}

/**
 * Fill state for one day.
 *
 * Takes `deviationKcal` rather than an intake figure on purpose. `deviation = intake − budget`
 * exactly (expand `budgetProvenance` and `computeCalorieBalance` and the terms cancel), so reading
 * the deviation the route already returned makes it impossible for this bar to disagree with the
 * headline above it — which is the defect Q-415 and Q-417 both are.
 */
export function progressFill(deviationKcal: number, budgetKcal: number): ProgressFill {
  const end = trackEndKcal(budgetKcal)
  const goal = Math.max(1, budgetKcal)
  const intake = goal + deviationKcal
  const { zone, label, color } = balanceZone(deviationKcal)
  return {
    fillPct: Math.max(0, Math.min(1, intake / end)) * 100,
    goalPct: (goal / end) * 100,
    zone,
    label,
    color,
    // `-0` is a legal result of negating 0 and leaks into equality checks; normalise it away.
    remainingKcal: deviationKcal === 0 ? 0 : -deviationKcal,
  }
}
