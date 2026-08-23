// Calories in vs calories out, banded against the user's goal.
//
// One place decides what "on target" means, so the Nutrition tab, the Health tab and the AI
// coach can never disagree about whether a day was on track. The three inputs are deliberately
// separated:
//
//   maintenance  — kcal/day that holds weight steady (calibrated from data when available,
//                  Mifflin-St Jeor × sedentary + measured movement otherwise)
//   intake       — kcal eaten
//   goalDelta    — the intentional daily offset for the user's goal (−500 to lose, +300 to gain)
//
// The target net is `goalDelta`, not zero: a day at exactly maintenance is *off* target for
// someone cutting. Bands are expressed as deviation from that target so the same thresholds
// work for loss, gain, recomp and maintenance without branching.

/** Intentional daily calorie offset per goal. Re-exported from the goal recommender so the
 *  deficit the bar bands against is the same one the target was built from. */
export { CALORIE_ADJUSTMENT_BY_GOAL as GOAL_DAILY_DELTA } from './goal-recommendation'

/** kcal per kg of body mass — the standard 7700 used across the app (see tdee-adaptation). */
export { KCAL_PER_KG } from './tdee-adaptation'

export type BalanceZone = 'far_under' | 'under' | 'on_target' | 'over' | 'far_over'

/**
 * Half-width of each band, in kcal of deviation from the goal's target net.
 *
 * ±150 is roughly the noise floor of self-reported intake for a single day, so a day inside it
 * is genuinely indistinguishable from on-target and must not be shown as a miss. ±400 is about
 * 0.36 kg/week of drift if sustained — enough to matter over a fortnight, which is where the
 * outer red band starts.
 */
export const ON_TARGET_KCAL = 150
export const OUTER_KCAL = 400

export interface ZoneMeta {
  zone: BalanceZone
  /** Paired text label — never render the colour alone (colour-only state is a repo rule). */
  label: string
  color: string
}

const ZONE_META: Record<BalanceZone, Omit<ZoneMeta, 'zone'>> = {
  far_under: { label: 'Well under', color: '#ef4444' },
  under:     { label: 'Under',      color: '#f97316' },
  on_target: { label: 'On target',  color: '#22c55e' },
  over:      { label: 'Over',       color: '#f97316' },
  far_over:  { label: 'Well over',  color: '#ef4444' },
}

/** Band a deviation-from-target (kcal; negative = ate less than the goal calls for). */
export function balanceZone(deviationKcal: number): ZoneMeta {
  const zone: BalanceZone =
    deviationKcal < -OUTER_KCAL ? 'far_under'
    : deviationKcal < -ON_TARGET_KCAL ? 'under'
    : deviationKcal <= ON_TARGET_KCAL ? 'on_target'
    : deviationKcal <= OUTER_KCAL ? 'over'
    : 'far_over'
  return { zone, ...ZONE_META[zone] }
}

export interface CalorieBalanceInput {
  /** kcal/day that holds weight steady, excluding today's measured movement. */
  restingBaseKcal: number
  /** Measured active energy today (workouts + activities + steps above baseline), net of rest. */
  activeKcal: number
  /** kcal eaten today. */
  intakeKcal: number
  /** Intentional daily offset for the goal — negative to lose, positive to gain. */
  goalDeltaKcal: number
}

export interface CalorieBalanceResult {
  /** Total calories out today = resting base + measured movement. */
  expenditureKcal: number
  /** Calories in − calories out. Negative = deficit. */
  netKcal: number
  /** What net the goal calls for (= goalDeltaKcal). */
  targetNetKcal: number
  /** netKcal − targetNetKcal. Negative = eating below what the goal calls for. */
  deviationKcal: number
  /** kcal still available to eat today and land on target. Negative = already past it. */
  remainingKcal: number
  /** Weekly weight change implied by sustaining today's net. */
  projectedWeeklyKg: number
  zone: BalanceZone
  zoneLabel: string
  zoneColor: string
}

const KCAL_PER_KG_LOCAL = 7700

export function computeCalorieBalance(input: CalorieBalanceInput): CalorieBalanceResult {
  const expenditureKcal = Math.round(input.restingBaseKcal + input.activeKcal)
  const netKcal = Math.round(input.intakeKcal - expenditureKcal)
  const targetNetKcal = Math.round(input.goalDeltaKcal)
  const deviationKcal = netKcal - targetNetKcal
  const { zone, label, color } = balanceZone(deviationKcal)
  return {
    expenditureKcal,
    netKcal,
    targetNetKcal,
    deviationKcal,
    // `-0` is a legal result of negating 0 and leaks into equality checks; normalise it away.
    remainingKcal: deviationKcal === 0 ? 0 : -deviationKcal,
    projectedWeeklyKg: Math.round((netKcal * 7 / KCAL_PER_KG_LOCAL) * 100) / 100,
    zone,
    zoneLabel: label,
    zoneColor: color,
  }
}

export interface MacroTargets {
  proteinG: number
  carbsG: number
  fatG: number
}

/** kcal per gram. Not configurable — these are the Atwater factors the rest of the app uses. */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

/**
 * The day's macro targets once movement has grown the calorie budget (Q-323).
 *
 * `nutrition_targets` stores the **rest-day** macros, derived from the rest-day calorie floor. The
 * budget on screen is `floor + earned from movement`, so the calorie figure moves through the day
 * and the grams beneath it did not — the card told the user to eat 300 more kcal without saying of
 * what.
 *
 * **Protein holds, and the reason is arithmetic rather than taste** (owner decision, 2026-08-19).
 * It is dosed per kg of bodyweight, so 150 g is ~2 g/kg. Re-express that as a share of calories and
 * apply it to a bigger day and it becomes ~2.6 g/kg — a protein requirement that rises because the
 * user went for a walk. Movement burns carbohydrate and fat; it does not create protein demand.
 *
 * **Carbs and fat absorb the earned kcal in the proportion they already hold to each other.** What
 * that preserves precisely is the **carbs:fat energy ratio** — not each macro's share of the day's
 * total, which cannot stay fixed while protein is held constant and the total grows. Splitting into
 * carbs alone (Q-401's first answer) would instead drift fat's share downward as the day's movement
 * grows.
 *
 * Returns the input unchanged when nothing was earned. A budget only ever grows with movement, so a
 * negative `earnedKcal` is meaningless here rather than a shrink to model.
 */
export function scaleMacrosForEarnedKcal(base: MacroTargets, earnedKcal: number): MacroTargets {
  if (!Number.isFinite(earnedKcal) || earnedKcal <= 0) return base

  const carbKcal = base.carbsG * KCAL_PER_G.carbs
  const fatKcal = base.fatG * KCAL_PER_G.fat
  const splittable = carbKcal + fatKcal

  // A target with no carbs and no fat has no ratio to preserve. Everything goes to carbs, which is
  // the answer Q-401 reached before the ratio refinement, and the case is degenerate anyway.
  const carbShare = splittable > 0 ? carbKcal / splittable : 1

  return {
    proteinG: base.proteinG,
    carbsG: Math.round(base.carbsG + (earnedKcal * carbShare) / KCAL_PER_G.carbs),
    fatG: Math.round(base.fatG + (earnedKcal * (1 - carbShare)) / KCAL_PER_G.fat),
  }
}

/**
 * The calorie bar as a PROGRESS bar rather than a gauge (Q-323).
 *
 * The owner's words: *"more like Red/Orange/green; all the way like a progress bar with the green
 * towards the end, and then a little orange/red bar after to depict going over. So it still looks
 * like a progress bar where you want to go to the end."* That inverts what the old bar meant — it
 * drew fixed deviation bands with a marker showing where you sat, which reads as a dial. This has
 * an end you walk toward.
 *
 * The x-axis is INTAKE, from 0 to `budget + OUTER_KCAL`, so the notch sits at the budget and the
 * tail past it is exactly the far-over threshold — long enough to read, short enough that it does
 * not present itself as a second target.
 *
 * **The stops sit on the real thresholds, and that is what keeps the colour honest.** A literal
 * five-band reading would make the on-target stripe `ON_TARGET_KCAL / (budget + OUTER)` wide —
 * **under 6% of the bar** on a 2,180 kcal day, too thin to see. Returning colour *stops* instead of
 * band widths lets the gradient interpolate: green is exact at the notch and blends out across the
 * ±150 window, so the green region reads about as wide as it truly is while every boundary stays
 * where `balanceZone()` puts it. A caller that clips this same gradient to `fillPct` therefore gets
 * the owner's "fill takes the colour of the band it currently ends in" for free, and cannot drift
 * from the zone label printed beside it.
 */
export function barProgress(
  { intakeKcal, budgetKcal }: { intakeKcal: number; budgetKcal: number },
): { fillPct: number; notchPct: number; stops: { color: string; pct: number }[] } {
  const scale = Math.max(1, budgetKcal + OUTER_KCAL)
  const at = (kcal: number) => Math.max(0, Math.min(1, kcal / scale))
  // Monotonic by construction after clamping, which matters for a tiny budget where
  // `budget - OUTER_KCAL` goes negative and several stops collapse onto 0.
  const stops = [
    { color: ZONE_META.far_under.color, pct: 0 },
    { color: ZONE_META.far_under.color, pct: at(budgetKcal - OUTER_KCAL) },
    { color: ZONE_META.under.color, pct: at(budgetKcal - ON_TARGET_KCAL) },
    { color: ZONE_META.on_target.color, pct: at(budgetKcal) },
    { color: ZONE_META.over.color, pct: at(budgetKcal + ON_TARGET_KCAL) },
    { color: ZONE_META.far_over.color, pct: 1 },
  ]
  return { fillPct: at(intakeKcal), notchPct: at(budgetKcal), stops }
}

/** The daily calorie target implied by a maintenance estimate and the goal's offset. */
export function targetFromMaintenance(maintenanceKcal: number, goalDelta: number): number {
  // Never recommend below a floor that would be unsafe regardless of goal.
  return Math.max(1200, Math.round(maintenanceKcal + goalDelta))
}

/**
 * `nutrition_targets.calories` is always a DAILY figure; `users.calorie_goal` may be daily or
 * weekly depending on `users.calorie_goal_type`. The two are mirrored on every write, so the
 * conversion lives here rather than in each route — mirroring a 13,650 kcal weekly goal straight
 * into the daily macro target once made the ring demand 13,650 kcal in a day.
 */
export function goalToDailyKcal(goalKcal: number, goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? Math.round(goalKcal / 7) : Math.round(goalKcal)
}

/** Inverse of `goalToDailyKcal` — preserves the user's chosen daily/weekly display preference. */
export function dailyKcalToGoal(dailyKcal: number, goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? Math.round(dailyKcal * 7) : Math.round(dailyKcal)
}

/**
 * Where today's calorie budget came from, split into the part that is always there and the part you
 * earned by moving.
 *
 * Q-401. The owner's model, in their words: *"i want the lowest number that assumes no
 * exercise/movement — and only has BMR essentially. then we adjust/increase that number [by]
 * activity."* So `base` is the budget on a zero-movement day — resting burn plus the goal's delta,
 * which is negative for a deficit and positive for a surplus — and `earned` is today's measured
 * movement. Their sum is the budget the zone bar judges you against.
 *
 *
 * **Lives here, beside `computeCalorieBalance` whose output it reads.** It spent a day in
 * `components/nutrition/` only to avoid colliding with the Lane A half of Q-401 in this directory;
 * that half has landed, so it has moved to its proper home.
 *
 * Kept as a `.ts` rather than folded into `calorie-zone-bar.tsx`, for one blunt reason: both vitest
 * projects are `environment: 'node'` and cannot parse JSX, so arithmetic that sits in a `.tsx`
 * cannot be asserted at all. Two surfaces render this number — the Nutrition tab and Home's
 * nutrition card — and a second, unasserted copy of a calorie figure is exactly what produced
 * Q-401: two budgets on one screen, 274 kcal apart, both labelled "left".
 */
export function budgetProvenance(
  { restingBaseKcal, activeKcal, targetNetKcal }:
  { restingBaseKcal: number; activeKcal: number; targetNetKcal: number },
): { base: number; earned: number; total: number } {
  const base = Math.round(restingBaseKcal + targetNetKcal)
  const earned = Math.round(activeKcal)
  return { base, earned, total: base + earned }
}
