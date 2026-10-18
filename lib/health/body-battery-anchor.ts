export type AnchorSource = 'readiness' | 'sleep' | 'default'

export interface AnchorInputs {
  /** Today's already-persisted snapshot, if the route has run at least once today. */
  persisted: { anchor: number; anchorSource: AnchorSource } | null
  /** Our own composite readiness for today — exists only once /api/readiness-score has run. */
  derivedReadiness: number | null
  /** Our own sleep score for the night that ended today. */
  ownSleepScore: number | null
}

export interface AnchorResult {
  anchor: number
  anchorSource: AnchorSource
  /** True while the anchor may still be replaced today (sleep/default, pre-readiness). */
  provisional: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * The day's battery anchor.
 *
 * Recomputing this on every read let the source flip from `sleep` to `readiness` part-way through
 * the morning, which shifted the ENTIRE day's curve by the difference between the two scores — the
 * number visibly jumped and the two Home cards stopped agreeing (owner report, 2026-08-02). A
 * readiness anchor is therefore FROZEN for the rest of the day once it exists: a sleep-derived
 * anchor is explicitly provisional and may upgrade exactly once, never back.
 *
 * Only our own scores anchor it. Oura's readiness and sleep scores used to be the next two arms;
 * they are never an input (owner, 2026-10-18, #2860: Oura's readiness is not our readiness), so
 * without ours the anchor is the default (#2985).
 */
export function resolveAnchor(inputs: AnchorInputs): AnchorResult {
  const { persisted, derivedReadiness, ownSleepScore } = inputs

  if (persisted?.anchorSource === 'readiness') {
    return { anchor: clamp(persisted.anchor, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (derivedReadiness != null) {
    return { anchor: clamp(derivedReadiness, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (ownSleepScore != null) {
    return { anchor: clamp(ownSleepScore, 0, 100), anchorSource: 'sleep', provisional: true }
  }
  return { anchor: 50, anchorSource: 'default', provisional: true }
}
