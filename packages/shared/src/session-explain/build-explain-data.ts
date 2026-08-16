import type { NextSessionRecommendation } from '@trainingai/shared/types/program'

export interface WeightedComponents {
  recovery:  { score: number; weight: number }
  balance:   { score: number; weight: number }
  freshness: { score: number; weight: number }
}

export interface ExplainSignals {
  muscleRecovery: Array<{ muscle: string; pct: number; hoursAgo: number }>
  ouraReadiness: number | null
  sleepTrend: number | null
  hrvTrend: number | null
  energyLevel: string | null
  soreMuscles: string[]
}

export interface ExplainAlternative {
  session: { id: string; name: string }
  overallScore: number
  primaryReason: string
}

export interface SessionExplainData {
  session: { id: string; name: string }
  overallScore: number
  weightedComponents: WeightedComponents
  signals: ExplainSignals
  consecutiveTrainingDays: number
  deloadOrRestRecommended: boolean
  deloadStrength: 'soft' | 'recommended' | 'strong' | null
  hrvWarning: boolean
  alternatives: ExplainAlternative[]
}

function primaryReason(deficits: { recovery: number; balance: number; freshness: number }): string {
  const labels: Record<string, string> = {
    recovery:  'muscles not fully recovered',
    balance:   'not yet overdue',
    freshness: 'trained too recently',
  }
  const key = Object.entries(deficits).sort(([, a], [, b]) => b - a)[0][0]
  return labels[key] ?? 'lower overall score'
}

/**
 * Maps a cached NextSessionRecommendation into the render data for the
 * "Why this?" page. `sessionId` (from the ?sessionId= param the Home card
 * passes) selects which scored session is the subject; when absent/unknown we
 * fall back to the top-scored session. Returns null when the recommendation
 * carries no ai_dynamic scoring fields (weekly/rotation programs have no
 * explanation to show).
 */
export function buildSessionExplainData(
  recommendation: NextSessionRecommendation | null | undefined,
  sessionId: string | undefined,
): SessionExplainData | null {
  if (
    !recommendation ||
    !recommendation.scoredSessions?.length ||
    !recommendation.signals ||
    !recommendation.weightedComponents
  ) {
    return null
  }

  const scored = recommendation.scoredSessions
  const subject = (sessionId && scored.find(s => s.session.id === sessionId)) || scored[0]

  const alternatives: ExplainAlternative[] = scored
    .filter(s => s.session.id !== subject.session.id)
    .map(s => ({
      session: { id: s.session.id, name: s.session.name },
      overallScore: s.overallScore,
      primaryReason: primaryReason({
        recovery:  subject.recoveryScore  - s.recoveryScore,
        balance:   subject.balanceScore   - s.balanceScore,
        freshness: subject.freshnessScore - s.freshnessScore,
      }),
    }))

  return {
    session: { id: subject.session.id, name: subject.session.name },
    overallScore: subject.overallScore,
    weightedComponents: recommendation.weightedComponents,
    signals: recommendation.signals,
    consecutiveTrainingDays: recommendation.consecutiveTrainingDays ?? 0,
    deloadOrRestRecommended: recommendation.deloadOrRestRecommended ?? false,
    deloadStrength: recommendation.deloadStrength ?? null,
    hrvWarning: recommendation.hrvWarning ?? false,
    alternatives,
  }
}
