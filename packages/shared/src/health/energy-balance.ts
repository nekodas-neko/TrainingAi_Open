// Cross-domain "fuelling vs strength" correlation helpers. We use intake net of
// activity burn (calories - activeCalories) as an energy-balance PROXY and always
// compare it against the user's own window median, so the unmodelled BMR term
// cancels out — this is an association, never a calorie-accounting claim.

interface EnergyRow { date: string; calories?: number; activeCalories?: number }

/** date -> (calories - (activeCalories ?? 0)), only for days with food logged. */
export function energyBalanceByDay(rows: EnergyRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.calories == null) continue
    out.set(r.date, r.calories - (r.activeCalories ?? 0))
  }
  return out
}

/** Median of a numeric list, or null when empty. Does not mutate the input. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
