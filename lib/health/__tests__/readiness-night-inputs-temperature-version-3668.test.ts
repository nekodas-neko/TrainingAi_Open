// #3668 item 1: the generic temperature normal is learned from one (source, algorithm version), like
// resting HR, HRV, sleep balance and breathing. When a source sends a new algorithm version, all five
// restart their normal together. Synthetic values only.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { resolveReadinessNightInputs, type NightInputSources } from '@/lib/health/readiness-night-inputs'

const TODAY = '2026-11-06'
const SRC = 'source_a'

/** 28 nights of one source; the newest `newNights` under version '2', the rest under '1'. */
function sources(newNights: number): NightInputSources {
  const bodyMetrics: NightInputSources['bodyMetrics'][number][] = []
  const nights: NightInputSources['nights'][number][] = []
  const temperatureDeviations: NightInputSources['temperatureDeviations'][number][] = []
  for (let back = 27; back >= 0; back--) {
    const date = shiftDateStr(TODAY, -back)
    const v = back < newNights ? '2' : '1'
    nights.push({ date, durationHours: 7 + (back % 3) * 0.3, respiratoryRate: 14 + (back % 4) * 0.2, durationSource: SRC, respiratoryRateSource: SRC, sourceAlgorithmVersion: v })
    bodyMetrics.push({ date, hrvMs: 50 + (back % 5), restingHeartRate: 55 + (back % 3), hrvSource: SRC, restingHeartRateSource: SRC })
    temperatureDeviations.push({ date, deviationC: ((back % 5) - 2) / 10, source: SRC })
  }
  return { today: TODAY, summaries: [], bodyMetrics, nights, temperatureDeviations, recoveryContributors: [], recoveryHours: [] }
}

describe('the temperature normal is keyed by algorithm version (#3668)', () => {
  it('restarts with the other four inputs when the version changes ten nights back', () => {
    const { inputs } = resolveReadinessNightInputs(sources(10))
    for (const key of ['restingHeartRate', 'hrvBalance', 'sleepBalance', 'breathing', 'temperature'] as const) {
      expect(inputs[key]?.nights, key).toBe(9)
      expect(inputs[key]?.source, key).toBe(SRC)
    }
  })

  it('a young normal under the new version yields no z, as the others do', () => {
    const { inputs } = resolveReadinessNightInputs(sources(3))
    expect(inputs.temperature).toMatchObject({ z: null, nights: 2 })
    expect(inputs.restingHeartRate).toMatchObject({ z: null, nights: 2 })
  })

  it('one version throughout: every earlier night stays in the normal', () => {
    const { inputs } = resolveReadinessNightInputs(sources(0))
    expect(inputs.temperature?.nights).toBe(27)
    expect(inputs.temperature?.z).not.toBeNull()
  })

  it('a deviation on a date with no night of its source keys to the source\'s newest version', () => {
    const src = sources(10)
    // Drop the source's night on two older dates: their deviations carry no version of their own.
    const dropped = new Set([shiftDateStr(TODAY, -2), shiftDateStr(TODAY, -15)])
    const { inputs } = resolveReadinessNightInputs({ ...src, nights: src.nights.filter(n => !dropped.has(n.date)) })
    // Nine nights under '2' (one of them now versionless, so newest = '2'), plus the versionless '1'-era date.
    expect(inputs.temperature?.nights).toBe(10)
  })
})
