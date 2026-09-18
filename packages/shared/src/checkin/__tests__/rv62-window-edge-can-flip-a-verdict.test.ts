/**
 * RV-62 asked whether a seven-day window boundary can actually flip a soreness suggestion, and said
 * it was *"worth constructing rather than assuming — it changes whether this is hygiene or a live
 * scoring defect."* This constructs it.
 *
 * **It cannot flip one directly.** `suggestedSoreMuscles` only considers muscles whose latest bout
 * is within `SORENESS_EXPECTED_WITHIN_HOURS` (48). A session at the seven-day edge is ~168 hours
 * old, so it is never itself eligible, and the obvious worry — "a workout drops out of the window
 * and its muscle stops being suggested" — is not reachable.
 *
 * **It can flip one indirectly, through the median.** `computeMuscleRecovery` takes the MEDIAN bout
 * volume per muscle as `typical`, and `tau = min(48, max(16, 24 × latest.volumeKg / typical))`. An
 * old, heavy bout entering the fetch window raises the median, which lowers the ratio, which lowers
 * `tau`, which RAISES the recovery percentage of a recent bout — possibly across the 85 line.
 *
 * So the answer is: real, narrow, and only for a muscle already sitting near the threshold. Worth a
 * deterministic test rather than arithmetic in a comment, because the next person to read the
 * ms-offset rule will want to know whether it was hygiene.
 */
import { describe, it, expect } from 'vitest'
import { computeMuscleRecovery } from '@trainingai/shared/ai-periodization/muscle-recovery'
import { suggestedSoreMuscles, RECOVERED_PCT } from '@trainingai/shared/checkin/suggested-soreness'
import type { WorkoutSession } from '@trainingai/shared/types/log'

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0)
const HOUR = 3_600_000

const LIBRARY = [{ name: 'Bench Press', muscles: [{ muscle: 'chest', role: 'main' as const }] }]

/**
 * One session, one exercise. The volume field is `ex.volume` — `computeMuscleRecovery` reads that
 * directly and never sums a `sets` array, so a fixture built from sets contributes ZERO volume, the
 * ratio falls back to 1 and every bout looks typical. That is how the first draft of this file
 * produced a flat tau of 24 and hid the very mechanism it was written to demonstrate.
 */
const session = (hoursAgo: number, volumeKg: number): WorkoutSession => ({
  id: `s-${hoursAgo}`,
  userId: 'u',
  startedAt: new Date(NOW - hoursAgo * HOUR),
  exercises: [{ exerciseName: 'Bench Press', volume: volumeKg }],
} as unknown as WorkoutSession)

// 40 hours puts the recent bout inside the 48-hour eligibility gate while leaving room for tau to
// move the percentage across 85: pct = 100(1 − e^(−40/tau)) is 81 at tau 24 and 92 at tau 16.
const RECENT_HOURS = 40
const RECENT_VOLUME = 1_000
// Heavier, so it becomes the median of the two and drags the ratio to 1/3 → tau floors at 16.
const OLD_VOLUME = 3_000

describe('RV-62 — a bout at the window edge can flip a verdict, but only through the median', () => {
  it('suggests the muscle when only the recent bout is in the window', () => {
    const recovery = computeMuscleRecovery([session(RECENT_HOURS, RECENT_VOLUME)], LIBRARY, { now: NOW })

    expect(recovery[0].pct).toBeLessThan(RECOVERED_PCT)
    expect(suggestedSoreMuscles(recovery, ['Chest'])).toEqual(['Chest'])
  })

  it('stops suggesting it once an older heavier bout is also in the window', () => {
    const recovery = computeMuscleRecovery(
      [session(RECENT_HOURS, RECENT_VOLUME), session(167, OLD_VOLUME)], LIBRARY, { now: NOW })

    expect(recovery[0].pct).toBeGreaterThanOrEqual(RECOVERED_PCT)
    expect(suggestedSoreMuscles(recovery, ['Chest'])).toEqual([])
  })

  /**
   * The half that is NOT reachable, asserted so the narrow claim above is not mistaken for a broad
   * one: the old bout alone suggests nothing, because 167 hours is far outside the 48-hour gate.
   * This is why dropping a workout out of the window cannot, by itself, remove a suggestion.
   */
  it('never suggests a muscle whose only bout is at the window edge', () => {
    const recovery = computeMuscleRecovery([session(167, OLD_VOLUME)], LIBRARY, { now: NOW })

    expect(recovery[0].hoursAgo).toBeGreaterThan(48)
    expect(suggestedSoreMuscles(recovery, ['Chest'])).toEqual([])
  })
})
