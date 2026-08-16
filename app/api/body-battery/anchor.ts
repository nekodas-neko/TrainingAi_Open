export type AnchorSource = 'readiness' | 'sleep' | 'default'

export interface AnchorInputs {
  /** Today's already-persisted snapshot, if the route has run at least once today. */
  persisted: { anchor: number; anchorSource: AnchorSource } | null
  /** Our own composite readiness for today — exists only once /api/readiness-score has run. */
  derivedReadiness: number | null
  /** Our own sleep score for the night that ended today. */
  ownSleepScore: number | null
  /** Frozen Oura Cloud columns — null for every post-re-key day; legacy arms only. */
  cloud: { readinessScore: number | null; sleepScore: number | null } | null
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
 */
export function resolveAnchor(inputs: AnchorInputs): AnchorResult {
  const { persisted, derivedReadiness, ownSleepScore, cloud } = inputs

  if (persisted?.anchorSource === 'readiness') {
    return { anchor: clamp(persisted.anchor, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (derivedReadiness != null) {
    return { anchor: clamp(derivedReadiness, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (ownSleepScore != null) {
    return { anchor: clamp(ownSleepScore, 0, 100), anchorSource: 'sleep', provisional: true }
  }
  if (cloud?.readinessScore != null) {
    return { anchor: clamp(cloud.readinessScore, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (cloud?.sleepScore != null) {
    return { anchor: clamp(cloud.sleepScore, 0, 100), anchorSource: 'sleep', provisional: true }
  }
  return { anchor: 50, anchorSource: 'default', provisional: true }
}
