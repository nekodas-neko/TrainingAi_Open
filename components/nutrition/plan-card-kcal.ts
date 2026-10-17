import {
  countedIntakeKcal, countedEstimateTotal, type CountedEstimateRow,
} from '@trainingai/shared/nutrition/counted-intake'

/**
 * #2921. The calories the Active Plan card prints as eaten: logged food plus the counted estimates,
 * the figure the Nutrition ring reads. The arithmetic stays in `countedIntakeKcal`.
 *
 * Undefined only when nothing is logged and no estimate counts, so a day with just an estimate shows
 * the counted figure rather than the "no logs" state. An estimate whose meal type has food logged is
 * superseded and dropped.
 */
export function planCardEatenKcal(input: {
  loggedKcal: number | undefined
  estimates: readonly CountedEstimateRow[]
  loggedMealTypeIds: readonly string[]
}): number | undefined {
  const { loggedKcal, estimates, loggedMealTypeIds } = input
  if (loggedKcal == null && countedEstimateTotal(estimates, loggedMealTypeIds) <= 0) return undefined
  return countedIntakeKcal({ loggedKcal: loggedKcal ?? 0, estimates, loggedMealTypeIds })
}
