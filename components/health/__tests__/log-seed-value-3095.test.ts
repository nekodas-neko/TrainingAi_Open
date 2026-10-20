// #3095: Home's Log value sheet seeded steps with today's combined figure (ring + treadmill). Saved
// unchanged, that wrote the treadmill's steps into body_metrics as a manual reading, and the next
// read added them again. Both log sheets now seed through `logSeedValue`.
import { describe, it, expect } from 'vitest'
import { logSeedValue } from '../log-seed-value'
import type { BodyMetaRow } from '@/app/api/body-metadata/route'

const row = (over: Partial<BodyMetaRow>): BodyMetaRow => ({
  date: '2026-10-14', weightKg: null, bodyFat: null, calories: null, protein: null, carb: null, fat: null,
  steps: null, distanceKm: null, restingHeartRate: null, hrvMs: null, spo2Pct: null, waterMl: null,
  waistCm: null, chestCm: null, armCm: null, thighCm: null, hipCm: null, neckCm: null,
  skeletalMusclePct: null, fatFreeMassKg: null, subcutaneousFatPct: null, visceralFatIndex: null,
  bodyWaterPct: null, muscleMassKg: null, boneMassKg: null, proteinPct: null, bmrKcal: null, metabolicAge: null,
  ...over,
})

describe('logSeedValue (#3095)', () => {
  it('seeds steps with the device count on a treadmill day, not the combined figure', () => {
    expect(logSeedValue('steps', row({ steps: 12_500, deviceSteps: 9_000 }), [])).toBe('9000')
  })

  it('seeds a blank when the treadmill was the only source of steps', () => {
    expect(logSeedValue('steps', row({ steps: 3_500, deviceSteps: null }), [])).toBe('')
  })

  it('seeds steps as stored when nothing indoor was added', () => {
    expect(logSeedValue('steps', row({ steps: 9_000 }), [])).toBe('9000')
  })

  it('still falls back to the latest weight for an unweighed day', () => {
    expect(logSeedValue('weightKg', row({}), [row({ date: '2026-10-12', weightKg: 81.4 })])).toBe('81.4')
  })

  // BF-2: the sheet POSTs at source `manual`, which outranks the scale; seeding the corrected figure
  // would overwrite the measurement on an untouched save.
  it('seeds body fat with the RAW reading, never the DEXA-corrected one', () => {
    expect(logSeedValue('bodyFat', row({ bodyFat: 25.3, bodyFatCorrected: 28.5 }), [])).toBe('25.3')
  })

  it('seeds a blank with no row at all', () => {
    expect(logSeedValue('steps', null, [])).toBe('')
  })
})
