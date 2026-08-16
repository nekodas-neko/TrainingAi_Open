// Per-exercise-log volume/avgReps and per-set intensity-% — duplicated verbatim
// across the log path, the edit PATCH, and the lbs-to-kg unit fix before this
// extraction; any drift between the copies would desync save vs edit.
export function computeSetAggregates(weights: number[], reps: number[]): { volume: number; avgReps: number } {
  const volume = Math.round(
    reps.reduce((sum, r, i) => sum + (weights[i] ?? weights[weights.length - 1]) * r, 0) * 10,
  ) / 10
  const avgReps = Math.round(reps.reduce((a, b) => a + b, 0) / reps.length * 10) / 10
  return { volume, avgReps }
}

export function computeIntensityPct(weightKg: number, estimated1rm: number): number | null {
  return estimated1rm > 0 ? Math.round(weightKg / estimated1rm * 1000) / 10 : null
}
