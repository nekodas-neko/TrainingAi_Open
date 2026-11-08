// #3610: the Oura connector maps its own readiness fields into the generic shapes readiness reads.
// Each shape carries the connector's source, so every normal it joins stays Oura's own.
import { describe, it, expect } from 'vitest'
import {
  ouraDailyWear, ouraDaytimeHighStress, ouraOvernightRecoveryHours, ouraRecoveryContributors, ouraTemperatureDeviations,
} from '@/lib/oura/cloud/readiness-signals-map'
import { OURA_CLOUD_REKEY_DATE } from '@/lib/oura/cloud-freshness'

describe('the Oura connector\'s readiness mapping', () => {
  it('maps the temperature deviation, marking the old account\'s values superseded and dropping empty days', () => {
    expect(ouraTemperatureDeviations([
      { date: OURA_CLOUD_REKEY_DATE, temperatureDeviation: 0.2 },
      { date: '2026-10-20', temperatureDeviation: -0.1 },
      { date: '2026-10-21', temperatureDeviation: null },
      { date: '2026-10-22' },
    ])).toEqual([
      { date: OURA_CLOUD_REKEY_DATE, deviationC: 0.2, source: 'oura_cloud', superseded: true },
      { date: '2026-10-20', deviationC: -0.1, source: 'oura_cloud', superseded: false },
    ])
  })

  it('turns stress_high seconds into minutes', () => {
    expect(ouraDaytimeHighStress([{ date: '2026-10-20', stressHigh: 5_400 }, { date: '2026-10-21', stressHigh: null }]))
      .toEqual([{ date: '2026-10-20', minutes: 90, source: 'oura_cloud' }])
  })

  it('takes the recovery_index contributor only where it is a number', () => {
    const out = ouraRecoveryContributors([
      { date: '2026-10-20', readinessContributors: { recovery_index: 71, hrv_balance: 60 } },
      { date: '2026-10-21', readinessContributors: { recovery_index: null } },
      { date: '2026-10-22', readinessContributors: null },
    ])
    expect(out).toEqual([{ date: '2026-10-20', score: 71, source: 'oura_cloud', provenance: 'oura_cloud readiness contributor recovery_index' }])
  })

  it('labels our series hours with the device whose series they came from', () => {
    expect(ouraOvernightRecoveryHours([{ date: '2026-10-20', hours: 4.25 }])).toEqual([{
      date: '2026-10-20', hours: 4.25, source: 'oura_cloud',
      provenance: 'oura_cloud_sleep_periods.heart_rate (our hours from Oura\'s 5-minute series)',
    }])
  })

  // #3668: readiness's low-wear rule reads wear in this shape, never the column.
  it('maps the stored non-wear seconds, dropping days with none stored', () => {
    expect(ouraDailyWear([
      { date: '2026-10-20', nonWearTimeSec: 0 },
      { date: '2026-10-21', nonWearTimeSec: 50_000 },
      { date: '2026-10-22', nonWearTimeSec: null },
      { date: '2026-10-23' },
    ])).toEqual([
      { date: '2026-10-20', nonWearSec: 0, source: 'oura_cloud' },
      { date: '2026-10-21', nonWearSec: 50_000, source: 'oura_cloud' },
    ])
  })
})
