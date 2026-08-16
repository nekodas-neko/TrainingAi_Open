import { describe, it, expect } from 'vitest'
import { build1RmTargets, buildRecoverySummary, buildWeekSchedule } from '@/lib/ai-chat/context'
import type { WorkoutSession } from '@trainingai/shared/types'

function ws(startedAt: string, exercises: { name: string; orm: number | null }[]): WorkoutSession {
  return {
    id: 'x', sessionName: 'Push', startedAt: new Date(startedAt),
    exercises: exercises.map(e => ({
      exerciseName: e.name, estimated1rm: e.orm, sets: [], volume: null, loggedAt: new Date(startedAt),
    })),
  } as unknown as WorkoutSession
}

describe('build1RmTargets', () => {
  it('uses the most recent est 1RM per exercise and rounds targets to 0.25kg', () => {
    const out = build1RmTargets([
      ws('2026-06-01T10:00:00Z', [{ name: 'Bench Press', orm: 78 }]),
      ws('2026-06-20T10:00:00Z', [{ name: 'Bench Press', orm: 80 }]),
    ])
    expect(out).toContain('Bench Press: est 1RM 80kg → target working weight 64kg')
    expect(out).toContain('quote, never recompute')
  })
  it('skips null/zero estimates and handles empty history', () => {
    expect(build1RmTargets([ws('2026-06-01T10:00:00Z', [{ name: 'Plank', orm: null }])]))
      .toContain('(no 1RM estimates yet)')
  })
})

describe('buildWeekSchedule', () => {
  // '2026-07-05' is a Sunday. date-fns' 'e' token is locale-dependent (en-US
  // starts the week on Sunday), which made the week collapse to a single day
  // every Sunday. This locks in the 'i' (ISO, locale-independent) fix.
  it('shows the full Mon–Sun span on a Sunday, not just today', () => {
    const out = buildWeekSchedule(
      [ws('2026-07-05T10:00:00Z', [{ name: 'Barbell Deadlift', orm: 145 }])],
      'Australia/Brisbane', '2026-07-05',
    )
    const lines = out.split('\n')
    // header + Mon..Sun = 8 lines
    expect(lines).toHaveLength(8)
    expect(out).toContain('2026/06/29 Mon: rest (nothing logged)')
    expect(out).toContain('2026/07/05 Sun (today): Push — COMPLETED')
  })

  it('marks a day with a logged session as COMPLETED, including today', () => {
    const out = buildWeekSchedule(
      [ws('2026-07-01T10:00:00Z', [{ name: 'Barbell Deadlift', orm: 145 }])],
      'Australia/Brisbane', '2026-07-01',
    )
    expect(out).toContain('(today): Push — COMPLETED')
  })

  it('marks a day with no logged session as rest, not as unfinished', () => {
    const out = buildWeekSchedule([], 'Australia/Brisbane', '2026-07-01')
    expect(out).toContain('(today): rest (nothing logged)')
  })
})

describe('buildRecoverySummary', () => {
  it('renders today scores and last-night sleep, preferring BLE temp (pre-re-key Cloud readiness fallback)', () => {
    // 2026-07-01 is pre-re-key, so the Cloud readiness 78 is still a real reading (no derived row).
    const out = buildRecoverySummary(
      [{ date: '2026-07-01', readinessScore: 78, sleepScore: 82, activityScore: null, temperatureDeviation: 0.5, resilienceLevel: 'solid' } as never],
      [{ date: '2026-07-01', durationHours: 7.4, efficiency: 91, averageHrvMs: 68, lowestHeartRate: 47 } as never],
      null, null, '2026-07-01', null,
      0.7, // BLE tempDevC
    )
    expect(out).toContain('readiness 78/100')
    expect(out).toContain('+0.7°C')
    expect(out).toContain('ring baseline')
    expect(out).not.toContain('resilience')
    expect(out).not.toContain('pre-re-key')
    expect(out).toContain('7.4h sleep')
    expect(out).toContain('No check-ins logged.')
  })
  it('falls back to the Cloud temp deviation with a pre-re-key annotation', () => {
    const out = buildRecoverySummary(
      [{ date: '2026-07-01', readinessScore: 78, sleepScore: 82, activityScore: null, temperatureDeviation: 0.5, resilienceLevel: 'solid' } as never],
      [], null, null, '2026-07-01', null,
      null, // no BLE temp
    )
    expect(out).toContain('+0.5°C')
    expect(out).toContain('pre-re-key')
    expect(out).not.toContain('resilience')
  })
  it('degrades to explicit no-data lines', () => {
    const out = buildRecoverySummary([], [], null, null, '2026-07-01', null)
    expect(out).toContain('Today: no Oura data')
  })
  it('uses the BLE-derived composite over the frozen Cloud readiness on a post-re-key day (F8)', () => {
    // 2026-07-15 is post-re-key: the Cloud readinessScore (88) is frozen and must NOT be narrated;
    // the own composite (35) from the derived row wins.
    const out = buildRecoverySummary(
      [{ date: '2026-07-15', readinessScore: 88, sleepScore: 80, activityScore: null, temperatureDeviation: null } as never],
      [], null, null, '2026-07-15', null, null,
      [{ day: '2026-07-15', readinessScore: 35, readinessSource: 'ble-derived' } as never],
    )
    expect(out).toContain('readiness 35/100')
    expect(out).not.toContain('88/100')
  })
  it('shows no readiness on a post-re-key day with only a frozen Cloud row (no composite yet)', () => {
    const out = buildRecoverySummary(
      [{ date: '2026-07-15', readinessScore: 88, sleepScore: 80, activityScore: null, temperatureDeviation: null } as never],
      [], null, null, '2026-07-15', null, null, [],
    )
    expect(out).not.toContain('readiness 88/100')
    expect(out).toContain('sleep score 80/100') // sleep still shows; only frozen readiness is withheld
  })
})
