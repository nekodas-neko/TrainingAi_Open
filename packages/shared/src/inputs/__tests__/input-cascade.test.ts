import { describe, it, expect } from 'vitest'
import {
  INPUTS, MINUTE_MS, resolveMinutes, resolveSlots, coverage, sumFilled, baselineValues, provenanceLabel,
  type Candidate, type InputName,
} from '../cascade'
import {
  stepCandidates, metGridCandidates, minuteMeanCandidates, hrReserveMetCandidates, compendiumMetCandidates,
  hrr60Candidates, nightlyCandidates,
} from '../adapters'
import { excludeLowWearDays, toOuraByDate } from '@trainingai/shared/health/wear-confidence'

// A fixed instant, not "now": nothing here depends on the current day. Anchored to a minute boundary.
const T0 = Date.UTC(2026, 9, 6, 2, 0, 0)
const min = (i: number) => T0 + i * MINUTE_MS

describe('the registry', () => {
  it('names a rung-2 or rung-3 route for every input, or says it is device-limited', () => {
    for (const def of Object.values(INPUTS)) {
      const hasFallback = def.routes.some((r) => r.rung !== 'provided')
      expect(hasFallback || def.deviceLimited === true, def.name).toBe(true)
    }
  })

  it('lists routes rung-first, so listed order is never asked to override a better rung', () => {
    const order = { provided: 1, derived: 2, estimated: 3 }
    for (const def of Object.values(INPUTS)) {
      const rungs = def.routes.map((r) => order[r.rung])
      expect(rungs, def.name).toEqual([...rungs].sort((a, b) => a - b))
    }
  })
})

describe('per-minute cascade', () => {
  it('takes the best rung each minute, so one day mixes sources', () => {
    const candidates: Candidate[] = [
      // Ring MET for minutes 0-1, a logged activity covering 1-3, an HR estimate for 2-4.
      ...metGridCandidates({ startTimestampMs: min(0), metsPerMinute: [1.2, 1.4] }, 'oura_ble'),
      ...compendiumMetCandidates([{ startMs: min(1), endMs: min(4), met: 6 }]),
      { slot: min(2), value: 7.5, route: 'hr_reserve_met', source: 'chest_strap' },
      { slot: min(3), value: 8, route: 'hr_reserve_met', source: 'chest_strap' },
      { slot: min(4), value: 3, route: 'hr_reserve_met', source: 'ring_hr' },
    ]
    const series = resolveMinutes('MET/min', candidates, min(0), min(6))
    expect(series.map((r) => r.value)).toEqual([1.2, 1.4, 7.5, 8, 3, null])
    expect(series.map((r) => r.provenance?.route ?? null)).toEqual(
      ['device_met', 'device_met', 'hr_reserve_met', 'hr_reserve_met', 'hr_reserve_met', null],
    )
    expect(series[0].provenance).toEqual({ route: 'device_met', rung: 'provided', source: 'oura_ble' })
    expect(provenanceLabel('MET/min', series[2].provenance!)).toBe('estimated from heart rate')
  })

  it('falls through to the compendium only where nothing better exists', () => {
    const candidates = compendiumMetCandidates([{ startMs: min(0), endMs: min(2), met: 6, source: 'manual' }])
    const series = resolveMinutes('MET/min', candidates, min(0), min(2))
    expect(series.map((r) => r.provenance?.rung)).toEqual(['estimated', 'estimated'])
    expect(series.every((r) => r.provenance?.route === 'compendium_met')).toBe(true)
  })

  it('reports an unfilled minute as missing with a null value, never 0', () => {
    const series = resolveMinutes('steps/min', [], min(0), min(3))
    expect(series).toHaveLength(3)
    expect(series.every((r) => r.missing && r.value === null)).toBe(true)
    expect(sumFilled(series)).toBeNull()
    expect(coverage(series)).toMatchObject({ total: 3, filled: 0, missing: 3 })
  })

  it('drops an implausible value instead of clamping it, leaving the minute to a lower rung', () => {
    const candidates: Candidate[] = [
      { slot: min(0), value: 400, route: 'device_met', source: 'oura_ble' },
      { slot: min(0), value: 2, route: 'compendium_met', source: 'manual' },
      { slot: min(1), value: Number.NaN, route: 'device_met', source: 'oura_ble' },
    ]
    const series = resolveMinutes('MET/min', candidates, min(0), min(2))
    expect(series[0]).toMatchObject({ value: 2, provenance: { route: 'compendium_met' } })
    expect(series[1].missing).toBe(true)
  })

  it('ignores a route not registered for the input', () => {
    const r = resolveSlots('MET/min', [{ slot: min(0), value: 3, route: 'device_steps', source: 'x' }])
    expect(r.size).toBe(0)
  })
})

describe('steps/min', () => {
  it('prefers device steps, then live accel counts, then the step model, minute by minute', () => {
    const model = stepCandidates([{ startMs: min(0), endMs: min(3), steps: 300 }], 'ring_step_model', 'oura_ble')
    const live = stepCandidates([{ startMs: min(1), endMs: min(2), steps: 110 }], 'accel_live_count', 'oura_ble')
    const device = stepCandidates([{ startMs: min(2), endMs: min(3), steps: 90 }], 'device_steps', 'health_connect')
    const series = resolveMinutes('steps/min', [...model, ...live, ...device], min(0), min(4))
    expect(series.map((r) => r.value)).toEqual([100, 110, 90, null])
    expect(series.map((r) => r.provenance?.route ?? null)).toEqual(['ring_step_model', 'accel_live_count', 'device_steps', null])
    expect(sumFilled(series)).toBe(300)
  })

  it('spreads a window across minutes by overlap', () => {
    const c = stepCandidates([{ startMs: min(0) + 30_000, endMs: min(1) + 30_000, steps: 100 }], 'device_steps', 'hc')
    expect(c.map((x) => [x.slot, x.value])).toEqual([[min(0), 50], [min(1), 50]])
  })

  it('drops a physically impossible window whole, as the daily merge does', () => {
    // 3,605 steps in 13 minutes — the 2026-07-28 window `isPlausibleStepWindow` exists for.
    const c = stepCandidates([{ startMs: min(0), endMs: min(13), steps: 3605 }], 'accel_live_count', 'oura_ble')
    expect(c).toEqual([])
  })
})

describe('MET from heart-rate reserve', () => {
  const hr = resolveMinutes('HR/min', [
    ...minuteMeanCandidates([{ tsMs: min(0), value: 140 }, { tsMs: min(0) + 30_000, value: 150 }], 'chest_strap', 'chest_strap'),
    ...minuteMeanCandidates([{ tsMs: min(1), value: 135 }], 'ring_hr', 'oura_ble'),
  ], min(0), min(3))

  it("uses each minute's own source's resting HR", () => {
    const c = hrReserveMetCandidates(hr, { vo2maxMlKgMin: 42, maxHr: 190, restingHrBySource: { chest_strap: 60, oura_ble: 50 } })
    // strap: (145−60)/(190−60) = 0.6538… → 1 + 0.6538 × (12 − 1)
    expect(c[0].value).toBeCloseTo(1 + (85 / 130) * 11, 6)
    expect(c[0].source).toBe('chest_strap')
    // ring: (135−50)/(190−50) — its own 50, not the strap's 60
    expect(c[1].value).toBeCloseTo(1 + (85 / 140) * 11, 6)
    expect(c).toHaveLength(2) // the unfilled HR minute stays unfilled
  })

  it('does not fill without a VO₂max or without that source\'s resting HR', () => {
    expect(hrReserveMetCandidates(hr, { vo2maxMlKgMin: null, maxHr: 190, restingHrBySource: { chest_strap: 60 } })).toEqual([])
    const c = hrReserveMetCandidates(hr, { vo2maxMlKgMin: 42, maxHr: 190, restingHrBySource: { chest_strap: 60 } })
    expect(c.map((x) => x.source)).toEqual(['chest_strap'])
  })
})

describe('HRR60', () => {
  it('is per set, from dense HR, and missing when the set could not support it', () => {
    const rows = [
      { setLogId: 'a', drop60s: 24, coverageOk: true, source: 'chest_strap' },
      { setLogId: 'b', drop60s: null, coverageOk: true, source: 'chest_strap' },
      { setLogId: 'c', drop60s: 30, coverageOk: false, source: 'oura_ble' },
    ]
    const r = resolveSlots('HRR60', hrr60Candidates(rows))
    expect(r.get('a')).toMatchObject({ value: 24, provenance: { rung: 'derived', source: 'chest_strap' } })
    expect(r.has('b')).toBe(false)
    expect(r.has('c')).toBe(false)
  })
})

describe('wear filtering survives the switch to named inputs (#2098 step 3)', () => {
  // Five nights; 10-03 the ring was worn 10 h (14 h off), 10-05 has no wear row at all.
  const metrics = [
    { date: '2026-10-01', hrvMs: 48 },
    { date: '2026-10-02', hrvMs: 52 },
    { date: '2026-10-03', hrvMs: 90 },
    { date: '2026-10-04', hrvMs: 50 },
    { date: '2026-10-05', hrvMs: 47 },
  ]
  const ouraRows = [
    { date: '2026-10-01', nonWearTimeSec: 3600 },
    { date: '2026-10-02', nonWearTimeSec: 0 },
    { date: '2026-10-03', nonWearTimeSec: 14 * 3600 },
    { date: '2026-10-04', nonWearTimeSec: 7200 },
  ]
  const wear = toOuraByDate(ouraRows)
  const resolved = resolveSlots('HRV/night', nightlyCandidates(
    metrics.map((m) => ({ date: m.date, value: m.hrvMs, source: 'oura_ble' })), 'night_hrv', wear,
  ))

  it('excludes a low-wear night from the HRV baseline', () => {
    expect(resolved.get('2026-10-03')?.provenance).toMatchObject({ lowWear: true })
    expect(baselineValues(resolved.values())).not.toContain(90)
  })

  it('excludes exactly what the readiness baseline excludes today', () => {
    const today = excludeLowWearDays(metrics, wear).map((m) => m.hrvMs)
    expect(baselineValues(resolved.values())).toEqual(today)
  })
})

describe('baselines stay per source', () => {
  it('never mixes ring and strap normals', () => {
    const r = resolveSlots('RHR/night', [
      { slot: '2026-10-01', value: 52, route: 'night_rhr', source: 'oura_ble' },
      { slot: '2026-10-02', value: 61, route: 'night_rhr', source: 'chest_strap' },
    ])
    expect(baselineValues(r.values(), { source: 'oura_ble' })).toEqual([52])
    expect(baselineValues(r.values(), { source: 'chest_strap' })).toEqual([61])
  })

  it('can restrict a baseline to measured rungs', () => {
    const series = resolveMinutes('MET/min', [
      { slot: min(0), value: 1.3, route: 'device_met', source: 'oura_ble' },
      { slot: min(1), value: 5, route: 'compendium_met', source: 'manual' },
    ], min(0), min(2))
    expect(baselineValues(series, { rungs: ['provided', 'derived'] })).toEqual([1.3])
  })
})

it('rejects a minute resolve on a non-minute input', () => {
  expect(() => resolveMinutes('HRR60' as InputName, [], min(0), min(1))).toThrow()
})
