// #3077 — the vitals overlays and the readiness source label either side of the switch to the Oura API.
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { describe, it, expect } from 'vitest'
import { nightVitals, readinessSourceLabel, resolveReadinessNightInputs, type RingSummaryInput } from '@/lib/health/readiness-night-inputs'

const SWITCH = '2026-10-18'
const ring = { rhrBaseline: { meanX8: 423 }, hrvBaseline: { meanX8: 449 } }
const base = { from: '2026-10-01', to: '2026-10-20' }

describe('nightVitals', () => {
  const summaries = [
    { date: '2026-10-16', rhrLowBpm: 56.3, hrvAvgMs: 39, ...ring },
    { date: '2026-10-18', rhrLowBpm: null, hrvAvgMs: null, rhrBaseline: null, hrvBaseline: null },
  ]
  const bodyMetrics = [
    { date: '2026-10-16', restingHeartRate: 70, hrvMs: 30, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
    { date: '2026-10-19', restingHeartRate: 54, hrvMs: 61, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
    { date: '2026-10-20', restingHeartRate: 0, hrvMs: null },
  ]

  it('uses the ring summary, unchanged, before the switch day', () => {
    const n = nightVitals({ summaries, bodyMetrics, switchDay: SWITCH, ...base })
    expect(n[0]).toEqual({
      date: '2026-10-16', restingHr: 56.3, hrvMs: 39, restingHrSource: 'oura_ble', hrvSource: 'oura_ble',
      restingHrBaseline: ring.rhrBaseline, hrvBaseline: ring.hrvBaseline,
    })
  })

  it('takes the Oura-only night after the switch day with its device, and drops the empty ring row', () => {
    const n = nightVitals({ summaries, bodyMetrics, switchDay: SWITCH, ...base })
    expect(n.map(x => x.date)).toEqual(['2026-10-16', '2026-10-19'])
    expect(n[1]).toMatchObject({ restingHr: 54, hrvMs: 61, restingHrSource: 'oura_cloud', hrvSource: 'oura_cloud', restingHrBaseline: null })
  })

  it('is the ring alone when there was never a switch', () => {
    const n = nightVitals({ summaries, bodyMetrics, switchDay: null, ...base })
    expect(n.map(x => x.date)).toEqual(['2026-10-16', '2026-10-18'])
  })
})

describe('readinessSourceLabel', () => {
  const partial: RingSummaryInput = {
    date: '2026-10-19', nHistory: 61, rhrLowBpm: null, hrvAvgMs: null, tempMeanC: null, breathAvgRpm: null,
    sleepDurationHours: null, recoveryIndexHours: null, tempDevC: null,
    rhrBaseline: null, hrvBaseline: null, tempBaseline: null, breathBaseline: null, sleepBaseline: null,
  }
  const cloudNights = [
    ...Array.from({ length: 20 }, (_, i) => ({ date: shiftDateStr('2026-10-18', -i), hrvMs: 50 + (i % 4), restingHeartRate: 54, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' })),
    { date: '2026-10-19', hrvMs: 45, restingHeartRate: 57, hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud' },
  ]
  const night = () => resolveReadinessNightInputs({
    today: '2026-10-19', summaries: [partial], bodyMetrics: cloudNights, nights: [], ouraDaily: [], ouraCloudContributors: [],
  })

  it('says generic-derived once the switch day has passed and nothing came from the ring', () => {
    expect(readinessSourceLabel(night(), true, SWITCH)).toBe('generic-derived')
  })

  it('still says ble-derived on a night before the switch, and with no switch at all', () => {
    expect(readinessSourceLabel(night(), true, '2026-10-25')).toBe('ble-derived')
    expect(readinessSourceLabel(night(), true, null)).toBe('ble-derived')
    expect(readinessSourceLabel(night(), false, null)).toBe('generic-derived')
  })
})
