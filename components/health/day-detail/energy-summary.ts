// Q-247 — the display model behind the day screen's Energy section.
//
// Split out from the component so the two rules that are easy to get wrong are testable without a
// DOM: when the section should stay hidden, and how a net figure is labelled. The numbers
// themselves are not computed here — they come from `/api/nutrition/energy-balance`, the same route
// Nutrition's Energy Balance card reads, because the day screen disagreeing with Nutrition about
// how much was burned is worse than either being slightly off.
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

export interface EnergyDaySummary {
  intakeKcal: number
  expenditureKcal: number
  netKcal: number
  /** "Surplus" or "Deficit" — the sign is spelled out rather than left to colour alone. */
  netLabel: string
  breakdown: { label: string; kcal: number }[]
}

export function energyDaySummary(energy: EnergyBalanceResponse | null): EnergyDaySummary | null {
  const balance = energy?.balance
  if (!balance || !energy) return null
  const { workoutKcal, activityKcal, stepsKcal } = energy.activeBreakdown
  // Resting burn is computed for every day the profile supports, including days with nothing on
  // them — rendering "Eaten 0 / Burned 1,800 / Deficit −1,800" under a day the user never logged
  // would turn the empty state into a number. Only show once the day has something real in it.
  if (balance.intakeKcal <= 0 && workoutKcal + activityKcal + stepsKcal <= 0) return null
  const netKcal = Math.round(balance.netKcal)
  return {
    intakeKcal: Math.round(balance.intakeKcal),
    expenditureKcal: Math.round(balance.expenditureKcal),
    netKcal,
    netLabel: netKcal > 0 ? 'Surplus' : 'Deficit',
    breakdown: [
      { label: 'Workouts', kcal: Math.round(workoutKcal) },
      { label: 'Activity', kcal: Math.round(activityKcal) },
      { label: 'Steps', kcal: Math.round(stepsKcal) },
      { label: 'Resting', kcal: Math.round(balance.restingBaseKcal) },
    ],
  }
}
