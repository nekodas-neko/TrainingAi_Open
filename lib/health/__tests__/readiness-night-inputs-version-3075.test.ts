// #3075 stage 5 — readiness's per-night normals are learned per (source, algorithm version), and a
// night its source recorded incompletely has no hours to balance. Generic sources only.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { resolveReadinessNightInputs, type NightInputSources } from '@/lib/health/readiness-night-inputs'

const TODAY = '2026-10-18'
const day = (back: number) => shiftDateStr(TODAY, -back)

/** `n` earlier nights and tonight from one source; the newest `newVersionNights` (tonight included) under v2. */
const sources = (n: number, newVersionNights: number, tonight: Record<string, unknown> = {}): NightInputSources => {
  const version = (back: number) => (back < newVersionNights ? 'v2' : 'v1')
  return {
    today: TODAY, summaries: [], ouraDaily: [], ouraCloudContributors: [],
    bodyMetrics: Array.from({ length: n + 1 }, (_, back) => ({
      date: day(back), hrvMs: 50 + (back % 5), restingHeartRate: 54 + (back % 3), hrvSource: 'source_a', restingHeartRateSource: 'source_a',
    })),
    nights: Array.from({ length: n + 1 }, (_, back) => ({
      date: day(back), durationHours: 7 + (back % 4) * 0.2, respiratoryRate: 14 + (back % 3) * 0.3,
      durationSource: 'source_a', respiratoryRateSource: 'source_a', sourceAlgorithmVersion: version(back),
      ...(back === 0 ? tonight : {}),
    })),
  }
}

describe('readiness night inputs under a source algorithm change (#3075 stage 5)', () => {
  it('one version throughout: every input is judged against all its nights', () => {
    const r = resolveReadinessNightInputs(sources(20, 21))
    for (const key of ['restingHeartRate', 'hrvBalance', 'sleepBalance', 'breathing'] as const) {
      expect(r.inputs[key]?.nights, key).toBe(20)
    }
  })

  it('after a change, the normals hold only the new version\'s nights', () => {
    const r = resolveReadinessNightInputs(sources(20, 3))
    for (const key of ['restingHeartRate', 'hrvBalance', 'sleepBalance', 'breathing'] as const) {
      expect(r.inputs[key]?.nights, key).toBe(2)
      expect(r.inputs[key]?.z, key).toBeNull() // too young to judge: awaiting baseline, not a fabricated z
    }
  })

  it('a night whose recording the source says is incomplete has no sleep balance; its physiology stays', () => {
    const r = resolveReadinessNightInputs(sources(20, 21, { recordingIncomplete: true }))
    expect(r.inputs.sleepBalance).toBeUndefined()
    expect(r.inputs.breathing?.z).not.toBeNull()
    expect(r.inputs.hrvBalance?.z).not.toBeNull()
  })
})
