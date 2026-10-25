// "Why this session", written from the numbers the scorer already produced (#3286).
//
// The route used to hand these same signals to a model and ask for two or three sentences. Every
// figure in the prompt was already computed, so the model's only contribution was phrasing — paid
// for on every page open. Under the owner's 25 Sep prefer-logic decision this is a template.

import { capitalize } from '../format/capitalize'
import type { ExplainSignals, WeightedComponents } from './build-explain-data'

export interface SessionInsightParts {
  sessionName: string
  weightedComponents: WeightedComponents
  signals: Pick<ExplainSignals, 'ouraReadiness' | 'sleepTrend' | 'hrvTrend' | 'energyLevel' | 'soreMuscles'>
  consecutiveTrainingDays?: number | null
  deloadOrRestRecommended?: boolean
  deloadStrength?: 'soft' | 'recommended' | 'strong' | null
}

const COMPONENT_LABEL = {
  recovery: 'muscle recovery',
  balance: 'how overdue the session is',
  freshness: 'freshness',
} as const

const pct = (n: number) => `${Math.round(n)}%`

/** "a", "a and b", "a, b and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** A trend ratio (1 = on baseline) as how far off the user's usual it sits. */
function trendClause(noun: string, ratio: number): string {
  const diff = Math.round((ratio - 1) * 100)
  if (diff === 0) return `${noun} is at your usual`
  return `${noun} is ${Math.abs(diff)}% ${diff > 0 ? 'above' : 'below'} your usual`
}

export function buildSessionInsightText(p: SessionInsightParts): string {
  const wc = p.weightedComponents
  const keys = ['recovery', 'balance', 'freshness'] as const

  // The component that contributed most to the score is the one worth naming first. Ties keep the
  // declared order, so the sentence does not flip between two renders of the same inputs.
  const lead = keys.reduce((best, k) => (wc[k].score * wc[k].weight > wc[best].score * wc[best].weight ? k : best), keys[0])
  const parts = keys.map(k => `${COMPONENT_LABEL[k]} at ${pct(wc[k].score)} (weighted ${pct(wc[k].weight * 100)})`)

  const sentences: string[] = [
    `${p.sessionName} was chosen for today from ${joinList(parts)}; ${COMPONENT_LABEL[lead]} counted most.`,
  ]

  const s = p.signals
  const measured: string[] = []
  if (s.ouraReadiness != null) measured.push(`your readiness is ${Math.round(s.ouraReadiness)}`)
  if (s.sleepTrend != null) measured.push(trendClause('your sleep', s.sleepTrend))
  if (s.hrvTrend != null) measured.push(trendClause('your HRV', s.hrvTrend))
  if (s.energyLevel) measured.push(`you logged your energy as ${s.energyLevel}`)
  const missing: string[] = []
  if (s.ouraReadiness == null) missing.push('readiness')
  if (s.sleepTrend == null) missing.push('sleep')
  if (s.hrvTrend == null) missing.push('HRV')
  if (measured.length > 0) {
    measured[0] = capitalize(measured[0])
    sentences.push(`${joinList(measured)}${missing.length > 0 ? `; ${joinList(missing)} had no reading` : ''}.`)
  } else {
    sentences.push('No readiness, sleep or HRV reading was available, so the choice rests on training history alone.')
  }

  const context: string[] = []
  if (s.soreMuscles.length > 0) context.push(`${joinList(s.soreMuscles)} ${s.soreMuscles.length === 1 ? 'is' : 'are'} marked sore`)
  const days = p.consecutiveTrainingDays ?? 0
  if (days > 0) context.push(`you have trained ${days} day${days === 1 ? '' : 's'} in a row`)
  if (p.deloadOrRestRecommended) context.push(`a deload or rest is recommended${p.deloadStrength ? ` (${p.deloadStrength})` : ''}`)
  if (context.length > 0) {
    context[0] = capitalize(context[0])
    sentences.push(`${joinList(context)}.`)
  }

  return sentences.join(' ')
}
