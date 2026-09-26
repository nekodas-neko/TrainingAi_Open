/**
 * RV-201 — the weekly recap's prose is rendered in code, so its edge cases are now testable.
 *
 * While a model wrote these sentences, a week with a missing metric produced whatever the model
 * made of a missing line, and there was nothing to assert. The template has the opposite
 * property: every absence takes a fixed branch, and the branches below are the ones that were
 * wrong when this file was written. Both were found by reading the rendered output of the route
 * fixture, not by reasoning about the code — which is the argument for pinning them.
 */
import { describe, expect, it } from 'vitest'
import { buildWeeklyDigestText } from '@trainingai/shared/health/weekly-digest-metrics'
import type { WeekOverWeek, WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics'

const wow = (week: number | null, priorWeek: number | null = null): WeekOverWeek =>
  ({ week, priorWeek, byDay: [] })

const metrics = (over: Partial<WeeklyDigestMetrics> = {}): WeeklyDigestMetrics => ({
  weekStart: '2026-08-31', weekEnd: '2026-09-06', priorWeekStart: '2026-08-24',
  training: {
    sessions: 2, priorSessions: 2, volumeKg: 7000, priorVolumeKg: 7000,
    volumeChangePct: 0, byDay: [],
  },
  muscleSets: [], prs: [],
  hrv: { ...wow(null), source: null },
  readiness: wow(null), sleepScore: wow(null), sleepHours: wow(null), stressHighMinutes: wow(null),
  illness: null, resilience: null, ots: null, weightChangeKg: null, friendCount: null,
  ...over,
})

const recoveryLine = (m: WeeklyDigestMetrics) =>
  buildWeeklyDigestText(m).split('\n').find(l => l.startsWith('• Recovery')) ?? null

describe('the recovery bullet labels each clause it prints', () => {
  it('does not hang "overnight HRV" off readiness on a week with no HRV', () => {
    // The defect: the label was a prefix on the joined list, so a week without HRV read
    // "Recovery — overnight HRV readiness down 5 to 66" — a wrong number under a wrong name.
    const line = recoveryLine(metrics({ readiness: wow(66, 71) }))

    expect(line).toBe('• Recovery — readiness down 5 to 66')
    expect(line).not.toContain('HRV')
  })

  it('still names HRV when it is the only metric present', () => {
    expect(recoveryLine(metrics({ hrv: { ...wow(60, 52), source: 'overnight' } })))
      .toBe('• Recovery — overnight HRV up 8 ms to 60 ms')
  })

  it('reports an HRV week with no prior week as a level, not as a change', () => {
    expect(recoveryLine(metrics({ hrv: { ...wow(60), source: 'overnight' } })))
      .toBe('• Recovery — overnight HRV 60 ms')
  })

  it('omits the whole bullet when nothing in it was measured', () => {
    expect(recoveryLine(metrics())).toBeNull()
  })
})

describe('a delta is printed only when it survives the printed precision', () => {
  it('omits a sleep change that rounds to +0.0 h', () => {
    // 7.32 − 7.29 is a real difference and an unreportable one: "+0.0 h" asserts a change that
    // the number beside it contradicts.
    const line = recoveryLine(metrics({ sleepHours: wow(7.32, 7.29) }))

    expect(line).toBe('• Recovery — sleep averaging 7.3 h a night')
    expect(line).not.toContain('0.0')
  })

  it('prints a sleep change once it reaches a tenth of an hour', () => {
    expect(recoveryLine(metrics({ sleepHours: wow(7.4, 7.3) })))
      .toBe('• Recovery — sleep averaging 7.4 h a night (+0.1 h)')
  })

  it('prints a drop with a minus sign rather than a hyphen', () => {
    expect(recoveryLine(metrics({ sleepHours: wow(6.9, 7.4) })))
      .toContain('(−0.5 h)')
  })
})

describe('the count of connected friends is not a fact about the week', () => {
  it('renders nothing for friendCount', () => {
    // The prompt this template replaced labelled it "Friends training that week: 3 friends
    // connected". The value is how many friends are connected — it says nothing about whether
    // any of them trained, and handing that line to a model invited the claim that they had.
    expect(buildWeeklyDigestText(metrics({ friendCount: 3 })))
      .toBe(buildWeeklyDigestText(metrics({ friendCount: null })))
  })
})

describe('a missing volume comparison is not automatically a missing history', () => {
  const training = (over: Partial<WeeklyDigestMetrics['training']>) => metrics({
    training: {
      sessions: 3, priorSessions: 0, volumeKg: 6000, priorVolumeKg: 0,
      volumeChangePct: null, byDay: [], ...over,
    },
  })
  const loadLine = (m: WeeklyDigestMetrics) => buildWeeklyDigestText(m).split('\n')[0]

  it('says "first week of data" only when the prior week logged nothing at all', () => {
    expect(loadLine(training({}))).toBe('• 3 sessions, 6,000 kg total — first week of data')
  })

  it('does not claim a first week when the prior week trained but lifted no tonnage', () => {
    // A pure-cardio or bodyweight week divides to nothing, exactly like no history — and the two
    // are not the same claim. This said "first week of data" to an account with years of it.
    const line = loadLine(training({ priorSessions: 4 }))

    expect(line).not.toContain('first week of data')
    expect(line).toContain('the week before logged 4 sessions and no tonnage')
  })

  it('singularises that fallback for a one-session prior week', () => {
    expect(loadLine(training({ priorSessions: 1 }))).toContain('logged 1 session and no tonnage')
  })
})
