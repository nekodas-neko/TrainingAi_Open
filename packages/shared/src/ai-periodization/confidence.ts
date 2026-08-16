// Confidence below this is treated as "low" — the UI surfaces the limiting factors and
// requires an explicit confirm before the prescription can be applied.
export const LOW_CONFIDENCE_THRESHOLD = 0.4

export interface ConfidenceInputs {
  // Number of recent sessions of this type that were logged (capped at 3 by the score).
  recentSessionCount: number
  has1rmHistory: boolean
  hasMoodOrSoreness: boolean
  hasAcwr: boolean
  hasSleepOrHrvTrend: boolean
}

// Plain-English factors that are holding the engine's confidence down. Mirrors the
// confidence scoring in aggregateSignals(): base grows with session history (+0.1/session
// up to 3), +0.1 for 1RM history paired with mood/soreness, +0.1 for ACWR paired with a
// sleep or HRV trend. Returns an empty array when the engine has full data.
export function confidenceFactors(i: ConfidenceInputs): string[] {
  const reasons: string[] = []
  if (i.recentSessionCount < 3) {
    reasons.push(
      i.recentSessionCount <= 0
        ? 'No recent sessions of this type logged yet'
        : `Only ${i.recentSessionCount} recent session${i.recentSessionCount === 1 ? '' : 's'} of this type logged`,
    )
  }
  if (!i.has1rmHistory) reasons.push('Not enough 1RM history to gauge your strength trend')
  if (!i.hasMoodOrSoreness) reasons.push('No recent mood / soreness check-in')
  if (!i.hasAcwr) reasons.push('Program too new for training-load (ACWR) data')
  if (!i.hasSleepOrHrvTrend) reasons.push('No recent sleep or HRV trend data')
  return reasons
}

export const COLD_START_CONFIDENCE_BASE = 0.3

export interface ConfidenceScore { confidence: number; tier: 1 | 2 | 3 }

// Deterministic engine confidence — the ONLY number that gates auto-apply and the card's
// low-confidence confirm. The LLM's self-reported confidence is never trusted for gating.
export function computeConfidence(i: ConfidenceInputs): ConfidenceScore {
  let confidence = COLD_START_CONFIDENCE_BASE + Math.min(i.recentSessionCount, 3) * 0.1
  let tier: 1 | 2 | 3 = 1
  if (i.has1rmHistory && i.hasMoodOrSoreness) { tier = 2; confidence += 0.1 }
  if (i.hasAcwr && i.hasSleepOrHrvTrend) { tier = 3; confidence += 0.1 }
  return { confidence: Math.min(0.95, confidence), tier }
}
