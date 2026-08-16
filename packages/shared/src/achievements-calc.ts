/**
 * Pure, dependency-free calculations used by the achievements engine.
 * Kept separate from `lib/achievements.ts` so they can be unit-tested without
 * pulling in the database client.
 */

/**
 * Whether a day's calorie intake counts as "hit the goal", respecting the user's
 * weight-goal direction:
 *  - cutting (target weight < current): a hit means staying at or under the target
 *  - bulking (target weight > current): a hit means meeting or exceeding the target
 *  - maintaining (no/equal target): a hit means within ±10% of the target either way
 * The 0.5 kg dead-band avoids treating tiny target/current differences as a cut/bulk.
 */
export function calorieDayHitsGoal(
  totalCals: number,
  target: number,
  targetWeight: number | null,
  currentWeight: number | null,
): boolean {
  if (target <= 0) return false
  if (targetWeight != null && currentWeight != null) {
    const diff = targetWeight - currentWeight
    if (diff < -0.5) return totalCals <= target          // cutting
    if (diff > 0.5) return totalCals >= target           // bulking
  }
  return Math.abs(totalCals - target) <= target * 0.1    // maintaining / unknown
}
