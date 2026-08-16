import { describe, it, expect } from 'vitest'
import {
  MIN_PROFILE_SAMPLES, PCT_BANDS, pctBand,
  buildTimeProfiles, resolveMeasuredRestSec,
  type TimingRow,
} from '@trainingai/shared/workout/time-profile'
import { SET_SETUP_SEC } from '@trainingai/shared/workout/duration-model'

const row = (over: Partial<TimingRow> = {}): TimingRow => ({
  exerciseName: 'Bench Press', reps: 10, setTimeSec: 40, restTimeSec: 120, intensityPct: 75, ...over,
})
const rows = (n: number, over: Partial<TimingRow> = {}): TimingRow[] =>
  Array.from({ length: n }, () => row(over))

describe('pctBand', () => {
  it('maps pct to the four effort bands', () => {
    expect(pctBand(60)).toBe('light')
    expect(pctBand(69.9)).toBe('light')
    expect(pctBand(70)).toBe('moderate')
    expect(pctBand(79.9)).toBe('moderate')
    expect(pctBand(80)).toBe('heavy')
    expect(pctBand(89.9)).toBe('heavy')
    expect(pctBand(90)).toBe('max')
    expect(pctBand(102)).toBe('max')
  })
  it('band keys are exported in order', () => {
    expect(PCT_BANDS).toEqual(['light', 'moderate', 'heavy', 'max'])
  })
})

describe('buildTimeProfiles — secPerRep', () => {
  it('derives sec/rep as (setTime − setup) ÷ reps once ≥ MIN_PROFILE_SAMPLES good sets exist', () => {
    // 40s for 10 reps → (40 − 10) / 10 = 3 s/rep
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES))['Bench Press']
    expect(p.secPerRep).toBe((40 - SET_SETUP_SEC) / 10)
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('returns null below the sample gate but still reports the count', () => {
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES - 1))['Bench Press']
    expect(p.secPerRep).toBeNull()
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES - 1)
  })

  it('excludes runaway-timer outliers via the robustStats policy', () => {
    // 10 clean sets + one 400s "set" (40 s/rep vs median 3 — outside median×4)
    const p = buildTimeProfiles([...rows(MIN_PROFILE_SAMPLES), row({ setTimeSec: 400 })])['Bench Press']
    expect(p.secPerRep).toBe(3)
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('ignores rows with missing or non-positive setTimeSec / reps (never zero-fills)', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES),
      row({ setTimeSec: null }), row({ setTimeSec: 0 }), row({ reps: 0 }),
    ])['Bench Press']
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('floors a sub-setup set time at 1 s/rep instead of going negative', () => {
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES, { setTimeSec: 5, reps: 5 }))['Bench Press']
    expect(p.secPerRep).toBe(1)
  })
})

describe('buildTimeProfiles — rest by band', () => {
  it('buckets rest medians by intensity band, gated per band', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 75, restTimeSec: 120 }),
      ...rows(4, { intensityPct: 85, restTimeSec: 200 }), // heavy: under the gate
    ])['Bench Press']
    expect(p.restSecByBand.moderate).toBe(120)
    expect(p.restSecByBand.heavy).toBeNull()
    expect(p.restSamplesByBand.heavy).toBe(4)
    expect(p.restSecByBand.light).toBeNull()
  })

  it('overall rest pools every band AND null-pct rows', () => {
    const p = buildTimeProfiles([
      ...rows(6, { intensityPct: 75, restTimeSec: 100 }),
      ...rows(6, { intensityPct: null, restTimeSec: 100 }),
    ])['Bench Press']
    expect(p.restSecByBand.moderate).toBeNull()   // 6 < gate
    expect(p.restSecOverall).toBe(100)            // 12 ≥ gate
    expect(p.restSamplesOverall).toBe(12)
  })

  it('drops rows with missing/non-positive rest', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES, { restTimeSec: 120 }),
      row({ restTimeSec: null }), row({ restTimeSec: 0 }),
    ])['Bench Press']
    expect(p.restSamplesOverall).toBe(MIN_PROFILE_SAMPLES)
  })

  it('profiles are per exercise', () => {
    const out = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES),
      ...rows(MIN_PROFILE_SAMPLES, { exerciseName: 'Squat', reps: 5, setTimeSec: 35 }),
    ])
    expect(out['Bench Press'].secPerRep).toBe(3)
    expect(out['Squat'].secPerRep).toBe((35 - SET_SETUP_SEC) / 5)
  })
})

describe('resolveMeasuredRestSec — fallback ladder', () => {
  const profile = buildTimeProfiles([
    ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 75, restTimeSec: 120 }),
    ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 85, restTimeSec: 200 }),
  ])['Bench Press']

  it('band median when the prescribed pct lands in a populated band', () => {
    expect(resolveMeasuredRestSec(profile, 72)).toBe(120)
    expect(resolveMeasuredRestSec(profile, 85)).toBe(200)
  })

  it('falls back to the overall median for an unpopulated band', () => {
    // light band empty; overall = median of 10×120 + 10×200 = 160
    expect(resolveMeasuredRestSec(profile, 60)).toBe(160)
  })

  it('null when there is no profile or no data at all', () => {
    expect(resolveMeasuredRestSec(null, 75)).toBeNull()
    const thin = buildTimeProfiles(rows(3))['Bench Press']
    expect(resolveMeasuredRestSec(thin, 75)).toBeNull()
  })
})
