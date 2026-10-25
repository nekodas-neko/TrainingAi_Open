import { describe, expect, it } from 'vitest'
import { groupSignals } from '@trainingai/shared/session-explain/group-signals'
import type { SessionExplainData } from '@trainingai/shared/session-explain/build-explain-data'
import { buildWeeklyDigestText } from '@trainingai/shared/health/weekly-digest-metrics'
import type { WeekOverWeek, WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics'

// BF-178. The number these three surfaces render is the app's OWN ble-derived composite
// (`oura_daily_derived.readiness_score`, source 'ble-derived') — see the header of
// `live-readiness.ts`. Calling it "Oura readiness" is false, and the field is still named
// `ouraReadiness`, which is what taught all three call sites to write it that way. The two
// behavioural cases below pin the rendered strings; the source scan pins the AI prompt line,
// which produces PROSE the owner reads as fact and which no UI assertion can see.

const explain = (readiness: number | null): SessionExplainData => ({
  session: { id: 's1', name: 'Upper' },
  overallScore: 78,
  weightedComponents: {
    recovery: { score: 80, weight: 0.5 },
    balance: { score: 60, weight: 0.3 },
    freshness: { score: 90, weight: 0.2 },
  },
  signals: {
    muscleRecovery: [], ouraReadiness: readiness, sleepTrend: 1.05, hrvTrend: 0.9,
    energyLevel: 'good', soreMuscles: [],
  },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: false, deloadStrength: null, hrvWarning: false,
  alternatives: [],
})

describe('BF-178 — the readiness signal is ours, and must not be credited to Oura', () => {
  it('labels the explain row "Readiness", matching what Home calls the same number', () => {
    // The defect was internal inconsistency, not an ugly word: Home said "Readiness" and the
    // screen one tap away said "Oura readiness" for the identical value.
    const rows = groupSignals(explain(46)).flatMap(g => g.rows)
    expect(rows.map(r => r.label)).toContain('Readiness')
    expect(rows.map(r => r.label)).not.toContain('Oura readiness')
  })

  it('still renders the value and band beside that label', () => {
    // Guards the rename against being "fixed" by dropping the row.
    const row = groupSignals(explain(46)).flatMap(g => g.rows).find(r => r.label === 'Readiness')!
    expect(row.value).toMatch(/^46 · /)
  })

  it('writes "Readiness" into the weekly digest the model is fed', () => {
    const wow: WeekOverWeek = { week: null, priorWeek: null, byDay: [] }
    const metrics: WeeklyDigestMetrics = {
      weekStart: '2026-09-07', weekEnd: '2026-09-13', priorWeekStart: '2026-08-31',
      training: { sessions: 3, priorSessions: 3, volumeKg: 12000, priorVolumeKg: 11000,
        volumeChangePct: 9, byDay: [] },
      muscleSets: [], prs: [],
      hrv: { ...wow, source: null },
      readiness: { week: 62, priorWeek: 58, byDay: [] },
      sleepScore: wow, sleepHours: wow, stressHighMinutes: wow,
      illness: null, resilience: null, ots: null, weightChangeKg: null, friendCount: null,
    }
    // Was the model's context block until RV-201 removed that model. The guarantee moves with the
    // text: what the owner READS must not attribute our own readiness to Oura.
    const text = buildWeeklyDigestText(metrics)
    expect(text).toContain('readiness')
    expect(text).toContain('62')
    expect(text).not.toContain('Oura')
  })

  it('never calls it Oura in the session-explain text, and never says "not connected"', async () => {
    // Rendered rather than source-scanned since #3286: the text is a template now, so the check can
    // run it. "not connected" is out too — it implies a third-party device that could be
    // disconnected, when the value is ours and is simply absent.
    const { buildSessionInsightText } = await import('../../session-explain/insight-text')
    const wc = { recovery: { score: 70, weight: 0.5 }, balance: { score: 60, weight: 0.3 }, freshness: { score: 80, weight: 0.2 } }
    const base = { sessionName: 'Upper', weightedComponents: wc }
    const withData = buildSessionInsightText({ ...base, signals: { ouraReadiness: 46, sleepTrend: null, hrvTrend: null, energyLevel: null, soreMuscles: [] } })
    const without = buildSessionInsightText({ ...base, signals: { ouraReadiness: null, sleepTrend: null, hrvTrend: null, energyLevel: null, soreMuscles: [] } })
    for (const text of [withData, without]) {
      expect(text).not.toContain('Oura')
      expect(text).not.toContain('not connected')
    }
    expect(withData).toContain('Your readiness is 46')
  })
})
