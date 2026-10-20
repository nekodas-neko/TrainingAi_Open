// #3086: a stored readiness is the served one, the composite less the illness suppression for the flag
// stored beside it. Rows written before #3086 hold the composite itself. Both must read as "this
// composite", or the day audit reports a suppressed day as a model that moved.
import { describe, it, expect } from 'vitest'
import { applyIllnessSuppression, READINESS_SUPPRESSION, storedReadinessMatches } from '../illness-radar'
import { READINESS_WEIGHTS } from '../readiness-composite'
import { buildReadinessAudit } from '../score-audit/readiness'
import type { OuraDailyDerivedRow } from '@/lib/data/repository'

describe('applyIllnessSuppression', () => {
  it('subtracts the suppression and never goes below 0', () => {
    expect(applyIllnessSuppression(64, READINESS_SUPPRESSION.elevated)).toBe(54)
    expect(applyIllnessSuppression(64, READINESS_SUPPRESSION.fever)).toBe(39)
    expect(applyIllnessSuppression(20, READINESS_SUPPRESSION.fever)).toBe(0)
    expect(applyIllnessSuppression(64, 0)).toBe(64)
  })
})

describe('storedReadinessMatches', () => {
  it('matches the served score for the stored flag, and the composite itself (a pre-#3086 row)', () => {
    expect(storedReadinessMatches(54, 64, 'elevated')).toBe(true)
    expect(storedReadinessMatches(39, 64, 'fever')).toBe(true)
    expect(storedReadinessMatches(64, 64, 'fever')).toBe(true)
    expect(storedReadinessMatches(0, 20, 'fever')).toBe(true)
  })

  it('does not excuse a difference the stored flag does not account for', () => {
    expect(storedReadinessMatches(54, 64, null)).toBe(false)
    expect(storedReadinessMatches(54, 64, 'watch')).toBe(false)
    expect(storedReadinessMatches(54, 64, 'fever')).toBe(false)
    expect(storedReadinessMatches(60, 64, 'elevated')).toBe(false)
    expect(storedReadinessMatches(54, 64, 'not_a_flag')).toBe(false)
  })
})

// A complete stored map whose every input is null re-derives to the model's neutral 50.
const contributors = Object.fromEntries(Object.keys(READINESS_WEIGHTS).map(k => [k, { score: 50, provisional: false, input: null, gap: null }]))
const audit = (readinessScore: number, illnessFlag: string | null) => buildReadinessAudit({
  date: '2026-10-19', summary: null, priorSummary: null, sleepScore: null, activityScore: null, prevDayActivityScore: null, ouraDaily: null,
  derived: { day: '2026-10-19', readinessScore, readinessContributors: contributors, illnessFlag, modelVersions: { readiness: 'v8' } } as unknown as OuraDailyDerivedRow,
})
const weightsMoved = (notes: readonly string[]) => notes.some(n => n.includes('the WEIGHTS moved'))

describe('the day audit on a suppressed day (#3086)', () => {
  it('reads a served score as reproducible, before and after #3086', () => {
    expect(weightsMoved(audit(50 - READINESS_SUPPRESSION.elevated, 'elevated').notes)).toBe(false)
    expect(weightsMoved(audit(50, 'elevated').notes)).toBe(false)
  })

  it('still reports a difference no stored flag explains', () => {
    expect(weightsMoved(audit(40, null).notes)).toBe(true)
  })
})
