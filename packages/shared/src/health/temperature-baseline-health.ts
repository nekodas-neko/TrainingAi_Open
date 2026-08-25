/**
 * TN-6a: is the temperature baseline centred enough for its deviation to mean anything?
 *
 * `computeBlendedScore`'s absolute-°C ladder penalises readiness at |dev| > 0.3 / 0.5 / 1.0. That
 * only works if the deviation is centred on zero. It was not: BF-13's zero-seeded baseline sat
 * 0.363 °C low, so the deviation was positive on **34 of 34 nights** and the ladder fired on
 * **91.2%** of them, costing **−16.3 readiness points per day** for being healthy.
 *
 * The owner chose to suspend the penalty until the baseline is centred (2026-08-24: *"Fix baseline
 * + suspend penalty now."*). This is the condition that decides it.
 *
 * **Self-clearing on purpose.** The entry is explicit that a `TODO: remove after` comment can be
 * forgotten and a computed condition cannot. Once BF-13's seed fix plus a Redecode re-derivation
 * centre the stored deviations, this returns true on its own and the ladder comes back with no
 * deploy — which is also what makes it safe to ship ahead of that re-derivation.
 *
 * **What the suspension costs, stated rather than buried:** fever detection through this one path,
 * until TN-6 replaces the ladder. That cost is near zero while the condition holds — a deviation
 * that is positive every single night cannot distinguish illness from baseline error in either
 * direction, which is the argument the owner accepted.
 */

/** A trailing mean deviation inside ±this is centred enough to trust the ladder. */
export const TEMP_CENTRED_MAX_ABS_MEAN_C = 0.15

/**
 * Nights of deviation needed before the suspension can lift. Below this there is no evidence the
 * baseline is centred, and absence of evidence is not evidence of centredness — so it stays
 * suspended. Costs nothing: a baseline this young was never trustworthy through the ladder anyway.
 */
export const TEMP_CENTRED_MIN_NIGHTS = 10

/**
 * True when the trailing deviations are centred on zero and the ladder can be trusted.
 *
 * The mean is the whole test. A *fraction-negative* check was the entry's other suggestion and is
 * deliberately not ANDed in: a mean inside ±0.15 °C already implies both sides are represented,
 * and a second condition would make the suspension harder to clear without measuring anything the
 * first does not.
 */
export function isTemperatureBaselineCentred(deviations: readonly (number | null | undefined)[]): boolean {
  const devs = deviations.filter((d): d is number => d != null && Number.isFinite(d))
  if (devs.length < TEMP_CENTRED_MIN_NIGHTS) return false
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length
  return Math.abs(mean) <= TEMP_CENTRED_MAX_ABS_MEAN_C
}
