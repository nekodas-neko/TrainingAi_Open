import type { SessionExplainData } from './build-explain-data'
import { scoreBand } from '@trainingai/shared/health/score-band'

export type ChipTone = 'warn' | 'ok'
export interface SignalRow {
  label: string
  value: string
  chip?: { text: string; tone: ChipTone }
}
export interface SignalGroup {
  heading: string
  rows: SignalRow[]
}

const ENERGY_LABEL: Record<string, string> = {
  drained: 'Drained', low: 'Low energy', ok: 'OK', good: 'Good', pumped: 'Pumped',
}

function trendPhrase(ratio: number | null): string {
  if (ratio == null) return 'No data'
  if (ratio >= 1.1) return 'Well above your usual'
  if (ratio >= 1.02) return 'Slightly above your usual'
  if (ratio > 0.98) return 'About your usual'
  if (ratio >= 0.9) return 'A little below your usual'
  return 'Well below your usual'
}

// Softer display words for this demoted "the numbers" area — mapped from the canonical
// scoreBand() label so the 70/50 thresholds live in exactly one place (One Formula, One Place).
const READINESS_BAND_DISPLAY: Record<ReturnType<typeof scoreBand>['label'], string> = {
  High: 'Good', Moderate: 'Fair', Low: 'Low',
}
function readinessBand(score: number): string {
  return READINESS_BAND_DISPLAY[scoreBand(score).label]
}

/**
 * LB-117 — a sore tick that the app suggested did NOT lower the score, and one the lifter added did.
 *
 * Listing both under one "Sore muscles" line let the page show a muscle as sore beside a recovery
 * figure that ignored it (BF-173), which is the reads-as-broken shape Q-105 exists to prevent. So
 * the two are separated, and each says which it is.
 *
 * With `suggested` null the provenance was never recorded, and the honest answer is the old single
 * line: claiming every tick lowered the score would be a guess dressed as an explanation.
 */
export function soreRows(sore: string[], suggested: string[] | null | undefined): SignalRow[] {
  if (sore.length === 0) return [{ label: 'Sore muscles', value: 'None' }]
  if (suggested == null) return [{ label: 'Sore muscles', value: sore.join(', ') }]

  const suggestedSet = new Set(suggested)
  const chosen = sore.filter(m => !suggestedSet.has(m))
  const accepted = sore.filter(m => suggestedSet.has(m))

  const rows: SignalRow[] = []
  if (chosen.length > 0) {
    rows.push({
      label: 'Sore muscles',
      value: chosen.join(', '),
      chip: { text: 'lowered the score', tone: 'warn' },
    })
  }
  if (accepted.length > 0) {
    rows.push({
      label: chosen.length > 0 ? 'Also sore' : 'Sore muscles',
      value: accepted.join(', '),
      chip: { text: 'already counted', tone: 'ok' },
    })
  }
  return rows
}

/**
 * Groups the raw signals into a few plain-language sections for the demoted
 * "the numbers" area. The AI narrative up top is the primary "why"; this is the
 * evidence behind it, de-jargoned.
 */
export function groupSignals(data: SessionExplainData): SignalGroup[] {
  const { signals: s, consecutiveTrainingDays, hrvWarning, deloadOrRestRecommended, deloadStrength } = data

  const readiness: SignalRow[] = [
    {
      label: 'Readiness',
      value: s.ouraReadiness != null ? `${s.ouraReadiness} · ${readinessBand(s.ouraReadiness)}` : 'No data',
    },
    { label: 'Sleep', value: trendPhrase(s.sleepTrend) },
    {
      label: 'HRV',
      value: trendPhrase(s.hrvTrend),
      chip: hrvWarning ? { text: 'Below baseline', tone: 'warn' } : undefined,
    },
  ]

  const recovery: SignalRow[] = [
    {
      label: 'Training streak',
      value: `${consecutiveTrainingDays} day${consecutiveTrainingDays === 1 ? '' : 's'} in a row`,
      chip: consecutiveTrainingDays >= 4 ? { text: 'Consider a rest day', tone: 'warn' } : undefined,
    },
    ...soreRows(s.soreMuscles, s.suggestedSoreMuscles),
  ]

  // Preserves the previous "Deload recommendation" card that predated this
  // grouped rewrite — same condition (skip a merely 'soft' deload, which isn't
  // surfaced as its own signal).
  if (deloadOrRestRecommended && deloadStrength !== 'soft') {
    recovery.push({
      label: 'Deload',
      value: deloadStrength === 'strong' ? 'Strong deload advised' : 'Deload recommended',
      chip: { text: deloadStrength ?? 'recommended', tone: 'warn' },
    })
  }

  const body: SignalRow[] = [
    {
      label: 'Energy',
      value: s.energyLevel ? (ENERGY_LABEL[s.energyLevel] ?? s.energyLevel) : 'Not logged today',
    },
  ]

  return [
    { heading: 'Readiness', rows: readiness },
    { heading: 'Recovery', rows: recovery },
    { heading: 'Body', rows: body },
  ]
}
