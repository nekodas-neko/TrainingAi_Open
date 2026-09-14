// The activity a completed fitness test is worth. Pure — it decides WHAT to write, never writes
// it; the caller owns the local-store row and the outbox mutation (BF-160).
//
// Why this is a separate module rather than a few lines inside `test-result.tsx`: the mapping is
// the part with rules in it (which protocols count, what the duration is, when a distance is real),
// and a `.tsx` cannot be imported by this repo's node-environment vitest at all.
import type { FitnessTestProtocol } from '@trainingai/shared/fitness-tests/protocols'

export interface TestActivityInput {
  protocol: FitnessTestProtocol
  /** The capture window, epoch ms — the same two values the test's own `durationSec` comes from. */
  startMs: number
  endMs: number
  /** Metres the capture recorded; 0 when the protocol has no distance or GPS gave nothing. */
  distanceM: number
  avgHr: number | null
  maxHr: number | null
}

export interface TestActivityDraft {
  activityType: string
  title: string
  /** Minutes to 1dp, matching how `activity-store.ts` rounds a recorded activity. */
  durationMin: number
  distanceKm: number | null
  avgHr: number | null
  maxHr: number | null
}

/**
 * The activity to log beside a saved fitness test, or null when the test earns none.
 *
 * Null for a protocol that declares no `activityType`, and null for a capture with no positive
 * duration — a mis-tap that opened and closed the screen is not twelve minutes of running, and a
 * zero-duration row earns nothing from `computeActiveEnergy` while still filling cardio history.
 *
 * **Deliberately independent of whether the test scored a VO₂max.** BF-158 withholds the score when
 * the distance cannot be real (GPS unavailable, a protocol stopped early); the effort still
 * happened, so the calories are still owed. Gating one on the other would make a failed GPS fix
 * cost the day's budget as well as the score.
 */
export function buildTestActivity(input: TestActivityInput): TestActivityDraft | null {
  const { protocol } = input
  if (protocol.activityType == null) return null

  const durationMin = Math.round(((input.endMs - input.startMs) / 60_000) * 10) / 10
  if (!(durationMin > 0)) return null

  // `.positive()` on the wire, so a zero is omitted rather than sent: "no distance was recorded" is
  // the truth, and a 0 km run in cardio history reads as a broken row instead.
  const distanceKm = protocol.captureDistance && input.distanceM > 0
    ? Math.round((input.distanceM / 1000) * 100) / 100
    : null

  return {
    activityType: protocol.activityType,
    title: protocol.name,
    durationMin,
    distanceKm,
    avgHr: input.avgHr,
    maxHr: input.maxHr,
  }
}
