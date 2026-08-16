import { describe, it, expect } from 'vitest'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { reevaluationKey } from '@trainingai/shared/ai-periodization/reevaluate'

describe('resolveSelfReportedSick (Q-113)', () => {
  it('true when the mood check-in bodyState includes sick', () => {
    expect(resolveSelfReportedSick(['sick'], null)).toBe(true)
    expect(resolveSelfReportedSick(['sick'], undefined)).toBe(true)
  })

  it('true when the Morning Check-in illness/context flag is sick, even with no mood log', () => {
    expect(resolveSelfReportedSick(undefined, 'sick')).toBe(true)
    expect(resolveSelfReportedSick([], 'sick')).toBe(true)
  })

  it('false when neither check-in reports sick', () => {
    expect(resolveSelfReportedSick([], null)).toBe(false)
    expect(resolveSelfReportedSick(['sore_muscles'], 'alcohol')).toBe(false)
    expect(resolveSelfReportedSick(undefined, undefined)).toBe(false)
  })

  it('either source alone is sufficient (OR, not AND)', () => {
    expect(resolveSelfReportedSick(['sick'], 'alcohol')).toBe(true)
    expect(resolveSelfReportedSick(['feeling_good'], 'sick')).toBe(true)
  })
})

describe('reevaluationKey — Morning Check-in illness flag included (Q-113)', () => {
  it('changes when the morning checkin illness context changes, mood log unchanged', () => {
    const moodLog = { soreMuscles: [], bodyState: [], updatedAt: '2026-08-07T00:00:00Z' }
    const before = reevaluationKey('2026-08-07', moodLog, { illnessContext: null, updatedAt: '2026-08-07T06:00:00Z' })
    const after = reevaluationKey('2026-08-07', moodLog, { illnessContext: 'sick', updatedAt: '2026-08-07T06:05:00Z' })
    expect(before).not.toBe(after)
  })

  it('is stable when nothing changed (repeat fetch skips the reevaluation work)', () => {
    const moodLog = { soreMuscles: [], bodyState: [], updatedAt: '2026-08-07T00:00:00Z' }
    const checkin = { illnessContext: 'sick' as const, updatedAt: '2026-08-07T06:00:00Z' }
    expect(reevaluationKey('2026-08-07', moodLog, checkin)).toBe(reevaluationKey('2026-08-07', moodLog, checkin))
  })

  it('handles a missing morning checkin the same as before this change (moodLog-only key)', () => {
    const key = reevaluationKey('2026-08-07', null, null)
    expect(key).toBe('2026-08-07|none|none|none')
  })
})

describe('reevaluationKey — injury fingerprint included (Q-117)', () => {
  it('changes when an injury is added, mood/checkin unchanged', () => {
    const before = reevaluationKey('2026-08-07', null, null, [])
    const after = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: null, updatedAt: '2026-08-07T06:00:00Z' },
    ])
    expect(before).not.toBe(after)
  })

  it('changes when an existing unresolved injury is edited (updatedAt bumps)', () => {
    const before = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: null, updatedAt: '2026-08-07T06:00:00Z' },
    ])
    const after = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: null, updatedAt: '2026-08-07T09:00:00Z' },
    ])
    expect(before).not.toBe(after)
  })

  it('changes when the only unresolved injury is resolved', () => {
    const before = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: null, updatedAt: '2026-08-07T06:00:00Z' },
    ])
    const after = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: '2026-08-07', updatedAt: '2026-08-07T09:00:00Z' },
    ])
    expect(before).not.toBe(after)
  })

  it('ignores already-resolved injuries entirely', () => {
    const withResolvedOnly = reevaluationKey('2026-08-07', null, null, [
      { resolvedDate: '2026-08-01', updatedAt: '2026-08-01T06:00:00Z' },
    ])
    const withNone = reevaluationKey('2026-08-07', null, null, [])
    expect(withResolvedOnly).toBe(withNone)
  })

  it('is stable when the unresolved-injury set is unchanged', () => {
    const injuries = [{ resolvedDate: null, updatedAt: '2026-08-07T06:00:00Z' }]
    expect(reevaluationKey('2026-08-07', null, null, injuries))
      .toBe(reevaluationKey('2026-08-07', null, null, injuries))
  })
})
