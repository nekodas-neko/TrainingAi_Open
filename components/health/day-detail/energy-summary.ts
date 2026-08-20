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

/**
 * Per-session workout calories, keyed by `workout_sessions.id` (Q-391).
 *
 * **Keyed by id, never by name.** A session name is not identity — repeat the same session twice in
 * one day and two cards would collide on the key, each showing the other's figure or one showing
 * both. `/api/day-log` already carries `workoutSessionId` per exercise, so the join costs nothing.
 *
 * **Deliberately returns the UNROUNDED values.** Rounding each addend and rounding their sum are
 * different numbers: three sessions at 120.4 render as 120 each under a total of 361. Round at the
 * point of display, so the drift is at most half a kcal per card rather than compounding here.
 *
 * These are the terms `computeActiveEnergy` summed into the Energy section's "Workouts" row on this
 * same screen — not a second estimate of the same thing. That is the whole reason the field ships
 * from `/api/nutrition/energy-balance` rather than being recomputed in `/api/day-log`: the parts
 * cannot disagree with the total, because they *are* the total's addends.
 */
export function workoutKcalBySession(energy: EnergyBalanceResponse | null): Map<string, number> {
  const rows = energy?.activeBreakdown?.workoutKcalBySession ?? []
  return new Map(rows.map(r => [r.id, r.kcal]))
}
