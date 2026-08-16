// Per-EXERCISE heart-rate recovery, aggregated from the per-set readings.
//
// Set-level recovery is too noisy to read straight: `set_hr_stats` carries
// `coverage_ok = false` on ~79% of rows and a null `peak_bpm` on ~67% (prod audit #2), so a
// single set's number swings on sampling luck rather than on fitness. Reading six of them in
// a row is also just hard to interpret. One figure per exercise, from the sets that actually
// have data, is both steadier and what a lifter can act on.
//
// Shared so the done screen and the day-overlay sheet — which render this identically —
// cannot drift (One Formula, One Place).

export interface SetRecoveryInput {
  exerciseName: string
  hrr1: number | null
  adequate: boolean | null
}

export interface ExerciseRecovery {
  exerciseName: string
  /** Median bpm/min recovery across this exercise's sets that reported one. */
  medianHrr1: number
  /** How many sets contributed — a 1-of-4 figure deserves less trust than 4-of-4. */
  sampleCount: number
  /** Total sets seen for the exercise, including those with no reading. */
  totalSets: number
  /** True only when the median is a genuine DROP and every contributing set was adequate.
   *  A negative median means heart rate rose across the rest window, which is never "ok" —
   *  the per-set UI rendered exactly that as a green ✓ next to a down-arrow. */
  adequate: boolean | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Groups sets by exercise, preserving first-seen order (which is workout order).
 *  Exercises with no set reporting an hrr1 are omitted — there is nothing to show. */
export function aggregateHrRecoveryByExercise(sets: SetRecoveryInput[]): ExerciseRecovery[] {
  const byExercise = new Map<string, SetRecoveryInput[]>()
  for (const s of sets) {
    const arr = byExercise.get(s.exerciseName)
    if (arr) arr.push(s)
    else byExercise.set(s.exerciseName, [s])
  }

  const out: ExerciseRecovery[] = []
  for (const [exerciseName, group] of byExercise) {
    const withReading = group.filter(s => s.hrr1 != null)
    if (withReading.length === 0) continue
    const medianHrr1 = median(withReading.map(s => s.hrr1!))
    // Unknown (null) rather than false when no set reported an adequacy verdict — absence of
    // evidence is not a failed recovery, and the UI renders no mark for null.
    const verdicts = withReading.filter(s => s.adequate != null)
    const adequate = medianHrr1 <= 0
      ? false
      : verdicts.length === 0 ? null : verdicts.every(s => s.adequate === true)
    out.push({
      exerciseName,
      medianHrr1: Math.round(medianHrr1),
      sampleCount: withReading.length,
      totalSets: group.length,
      adequate,
    })
  }
  return out
}

/** Arrow + magnitude for a recovery rate. A negative rate means heart rate CLIMBED during
 *  the rest window, so it must not render under a down-arrow (it shipped as "↓-9 bpm/min ✓"). */
export function formatRecoveryRate(hrr1: number): string {
  return `${hrr1 < 0 ? '↑' : '↓'}${Math.abs(hrr1)} bpm/min`
}
