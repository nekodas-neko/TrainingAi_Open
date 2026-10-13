import { describe, it, expect } from 'vitest'
import {
  INPUTS, MINUTE_MS, resolveMinutes, resolveSlots, coverage, sumFilled, baselineValues, provenanceLabel,
  type Candidate, type InputName,
} from '../cascade'
import {
  stepCandidates, metGridCandidates, minuteMeanCandidates, compendiumMetCandidates,
  activeKcalMetCandidates, cadenceMetCandidates, ringStillMetCandidates, sleepSessionMetCandidates, SLEEP_MET,
  ringMotionMetCandidates, ringMotionMet, RING_MOTION_MET_MAP_V1,
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
  it('takes the best rung each minute, so one day mixes sources (#2115 v4 order)', () => {
    const candidates: Candidate[] = [
      // Ring MET for minutes 0-1; a sleep record over 0-5; the ring's still marker at 2; a watch's
      // active calories at 3 (70 kg); a logged activity over 1-5.
      ...metGridCandidates({ startTimestampMs: min(0), metsPerMinute: [1.2, 1.4] }, 'oura_ble'),
      ...sleepSessionMetCandidates([{ startMs: min(0), endMs: min(5), source: 'health_connect' }]),
      ...ringStillMetCandidates([min(2) + 10_000], 'oura_ble'),
      ...activeKcalMetCandidates([{ startMs: min(3), endMs: min(4), kcal: 2.45, source: 'health_connect' }], 70),
      ...compendiumMetCandidates([{ startMs: min(1), endMs: min(5), met: 6 }]),
    ]
    const series = resolveMinutes('MET/min', candidates, min(0), min(6))
    expect(series.map((r) => r.provenance?.route ?? null)).toEqual(
      ['device_met', 'device_met', 'ring_still_met', 'active_kcal_met', 'sleep_session_met', null],
    )
    // 2.45 kcal in a minute at 70 kg: 1 + 2.45 / (0.0175 × 70) = 3.
    expect(series.map((r) => r.value)).toEqual([1.2, 1.4, SLEEP_MET, 3, SLEEP_MET, null])
    expect(series[0].provenance).toEqual({ route: 'device_met', rung: 'provided', source: 'oura_ble' })
    expect(provenanceLabel('MET/min', series[4].provenance!)).toBe('asleep, from a sleep record')
  })

  it('has no heart-rate route: HR→MET was dropped (#2115 v4)', () => {
    expect(INPUTS['MET/min'].routes.map((r) => r.id)).not.toContain('hr_reserve_met')
    expect(resolveSlots('MET/min', [{ slot: min(0), value: 4, route: 'hr_reserve_met', source: 'chest_strap' }]).size).toBe(0)
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

describe('HR/min from a faster-than-minute series', () => {
  it('averages each minute, strap first, and leaves an unread minute missing', () => {
    const hr = resolveMinutes('HR/min', [
      ...minuteMeanCandidates([{ tsMs: min(0), value: 140 }, { tsMs: min(0) + 30_000, value: 150 }], 'chest_strap', 'chest_strap'),
      ...minuteMeanCandidates([{ tsMs: min(0), value: 120 }, { tsMs: min(1), value: 135 }], 'ring_hr', 'oura_ble'),
    ], min(0), min(3))
    expect(hr.map((r) => r.value)).toEqual([145, 135, null])
    expect(hr.map((r) => r.provenance?.source ?? null)).toEqual(['chest_strap', 'oura_ble', null])
  })
})

describe('MET from active calories (#2115 v4, rung 1b)', () => {
  it('scores a resting minute at 1 MET, not 0: the record excludes BMR', () => {
    const c = activeKcalMetCandidates([{ startMs: min(0), endMs: min(1), kcal: 0, source: 'hc' }], 70)
    expect(c).toEqual([{ slot: min(0), value: 1, route: 'active_kcal_met', source: 'hc' }])
  })
  it('spreads a short record evenly over its minutes', () => {
    // 4.9 kcal over 2 minutes at 70 kg: 2.45 a minute → 3 MET each.
    const c = activeKcalMetCandidates([{ startMs: min(0), endMs: min(2), kcal: 4.9, source: 'hc' }], 70)
    expect(c.map((x) => x.value)).toEqual([3, 3])
  })
  it('leaves the minutes of a record longer than 15 minutes empty', () => {
    expect(activeKcalMetCandidates([{ startMs: min(0), endMs: min(20), kcal: 40, source: 'hc' }], 70)).toEqual([])
    expect(activeKcalMetCandidates([{ startMs: min(0), endMs: min(15), kcal: 30, source: 'hc' }], 70)).toHaveLength(15)
  })
  it('fills nothing without a weight', () => {
    expect(activeKcalMetCandidates([{ startMs: min(0), endMs: min(1), kcal: 2, source: 'hc' }], null)).toEqual([])
  })
})

describe('MET from step cadence (#2115 v4, rung 2c)', () => {
  const steps = (spm: number) => resolveMinutes('steps/min', [{ slot: min(0), value: spm, route: 'device_steps', source: 'hc' }], min(0), min(1))
  it('leaves a minute under 45 steps/min empty', () => {
    expect(cadenceMetCandidates(steps(44))).toEqual([])
  })
  it('reads about 3.1 MET at 100 steps/min', () => {
    expect(cadenceMetCandidates(steps(100))[0].value).toBeCloseTo(3.1, 1)
  })
  it('holds 160 steps/min at the table top, 6.2, and marks it capped', () => {
    const [c] = cadenceMetCandidates(steps(160))
    expect(c).toMatchObject({ value: 6.2, capped: true, route: 'cadence_met', source: 'hc' })
    const series = resolveMinutes('MET/min', [c], min(0), min(1))
    expect(series[0].provenance).toMatchObject({ route: 'cadence_met', rung: 'derived', capped: true })
  })
})

describe('MET from the ring\'s motion (#2781, rung 2a)', () => {
  it('looks up the last bin whose edge is at or under the summed low intensity', () => {
    expect(ringMotionMet(0)).toBe(0.9)
    expect(ringMotionMet(1)).toBe(1.0)
    expect(ringMotionMet(77)).toBe(2.8)
    expect(ringMotionMet(78)).toBe(2.8) // between edges 77 and 79
    expect(ringMotionMet(79)).toBe(2.9)
    expect(ringMotionMet(500)).toBe(5.3)
    expect(ringMotionMet(-3)).toBe(0.9)
  })

  it('ships the evaluated table as is: 92 bins, edges rising, cut 1.5', () => {
    const { edges, met, cut } = RING_MOTION_MET_MAP_V1
    expect(edges).toHaveLength(92)
    expect(met).toHaveLength(92)
    edges.slice(1).forEach((e, i) => expect(e).toBeGreaterThan(edges[i]))
    expect(cut).toBe(1.5)
  })

  it('sums the events of minute m − 1 and m, and an event on a boundary closes the minute before it', () => {
    // 4 at 0:30 and 6 exactly at 1:00 both belong to minute 0; 10 at 1:30 belongs to minute 1.
    const c = ringMotionMetCandidates([
      { tsMs: min(0) + 30_000, lowIntensity: 4 },
      { tsMs: min(1), lowIntensity: 6 },
      { tsMs: min(1) + 30_000, lowIntensity: 10 },
    ], 'oura_ble')
    const byMinute = new Map(c.map((x) => [x.slot, x.value]))
    expect([...byMinute.keys()].sort((a, b) => Number(a) - Number(b))).toEqual([min(0), min(1), min(2)])
    expect(byMinute.get(min(0))).toBe(ringMotionMet(10)) // minute -1 empty + minute 0's 10
    expect(byMinute.get(min(1))).toBe(ringMotionMet(20)) // 10 + 10
    expect(byMinute.get(min(2))).toBe(ringMotionMet(10)) // minute 1's 10, nothing in minute 2
    expect(c.every((x) => x.route === 'accel_met' && x.source === 'oura_ble')).toBe(true)
  })

  it('sits under the ring\'s own MET and above its still marker', () => {
    const series = resolveMinutes('MET/min', [
      ...metGridCandidates({ startTimestampMs: min(0), metsPerMinute: [2.2] }, 'oura_ble'),
      ...ringMotionMetCandidates([{ tsMs: min(0) + 30_000, lowIntensity: 30 }], 'oura_ble'),
      ...ringStillMetCandidates([min(0) + 1_000, min(1) + 1_000], 'oura_ble'),
    ], min(0), min(2))
    expect(series.map((r) => r.provenance?.route)).toEqual(['device_met', 'accel_met'])
    expect(series[1].value).toBe(ringMotionMet(30))
  })
})

describe('MET while asleep (#2115 v4, rungs 2b and 2d)', () => {
  it('marks each minute holding a 0x72 frame still, once', () => {
    const c = ringStillMetCandidates([min(0) + 5_000, min(0) + 40_000, min(2)], 'oura_ble')
    expect(c.map((x) => [x.slot, x.value])).toEqual([[min(0), SLEEP_MET], [min(2), SLEEP_MET]])
  })
  it('fills only the session minutes no better route has', () => {
    const series = resolveMinutes('MET/min', [
      ...metGridCandidates({ startTimestampMs: min(1), metsPerMinute: [2.5] }, 'oura_ble'),
      ...sleepSessionMetCandidates([{ startMs: min(0), endMs: min(3), source: 'oura_ble' }]),
    ], min(0), min(4))
    expect(series.map((r) => r.provenance?.route ?? null)).toEqual(['sleep_session_met', 'device_met', 'sleep_session_met', null])
  })
  it('sleeping MET is the 2024 Compendium value, 1.0', () => {
    expect(SLEEP_MET).toBe(1.0)
  })
})

describe('HRR60', () => {
  it('is per set, from dense HR, and missing when the set could not support it', () => {
    // #2299 step 2: the input is `hrr1Bpm` (dense HRR60), not `drop60s` gated on coverage, which a
    // ring set could pass with a noise drop. 'c' is that ring set: no HRR60, so missing.
    const rows = [
      { setLogId: 'a', hrr1Bpm: 24, source: 'chest_strap' },
      { setLogId: 'b', hrr1Bpm: null, source: 'chest_strap' },
      { setLogId: 'c', hrr1Bpm: null, source: 'oura_ble' },
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
