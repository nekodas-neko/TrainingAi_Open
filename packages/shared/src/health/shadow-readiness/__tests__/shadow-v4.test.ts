// Shadow model version 4 (owner, 26 Oct): floating pillar totals, the HRV + resting HR budget,
// yesterday's activity as load, quality and reliability factors (#2826, #2833), and the graded
// readiness ceiling (#2832).
import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { reliabilityFactor, scoreShadowReadiness, scoreUnit, type ShadowScoreInput, type UnitInput, type UnitObservation } from '../score'
import { CEILING, PILLAR_POINTS, SHADOW_MODEL_VERSION, SHARED_BUDGETS, UNIT_DEFS, type ShadowUnitId } from '../model'

const D = '2026-09-30'

function history(n: number, value: (i: number) => number, end = D, extra: Partial<UnitObservation> = {}): UnitObservation[] {
  return Array.from({ length: n }, (_, i) => ({ date: shiftDateStr(end, -(n - i)), value: value(i), source: 'ring', ...extra }))
}
const night = (value: number, extra: Partial<UnitObservation> = {}): UnitObservation => ({ date: D, value, source: 'ring', ...extra })
const yesterday = (value: number): UnitObservation => ({ date: shiftDateStr(D, -1), value, source: 'ring' })
const wobble = (base: number, amp: number) => (i: number) => base + (i % 2 === 0 ? amp : -amp)
const unit = (id: ShadowUnitId, input: UnitInput) => scoreUnit(UNIT_DEFS[id], input, D, new Map())
const run = (units: ShadowScoreInput['units']) => scoreShadowReadiness({ date: D, units })

/** A strong night: sleep alone would read near 100. */
const strongSleep = (): ShadowScoreInput['units'] => ({
  'sleep.duration': { today: night(8), history: [] },
  'sleep.efficiency': { today: night(97), history: history(40, wobble(95, 0.5)) },
})
const hrv = (today: number): UnitInput => ({ today: night(today), history: history(40, wobble(60, 2)) })
const rhr = (today: number): UnitInput => ({ today: night(today), history: history(40, wobble(55, 0.5)) })
const temp = (excess: number): UnitInput => ({ today: night(excess), history: history(40, wobble(0, 0.05)) })

describe('version 4: points, the shared budget and yesterday as load', () => {
  it('is version 4', () => {
    expect(SHADOW_MODEL_VERSION).toBe(4)
  })

  it('HRV and resting HR share one 13-point budget (was 19.5)', () => {
    const both = run({ ...strongSleep(), 'heart.overnight_hrv': hrv(60), 'heart.overnight_rhr': rhr(55) })
    const w = (id: ShadowUnitId) => both.units[id].weight
    expect(w('heart.overnight_hrv') + w('heart.overnight_rhr')).toBeCloseTo(SHARED_BUDGETS['heart.overnight_pattern'], 6)
    expect(w('heart.overnight_hrv')).toBeCloseTo(7, 6)
    expect(w('heart.overnight_rhr')).toBeCloseTo(6, 6)
  })

  it('when only one of the pair scored, it carries the whole budget', () => {
    expect(run({ 'heart.overnight_hrv': hrv(60) }).units['heart.overnight_hrv'].weight).toBeCloseTo(13, 6)
    expect(run({ 'heart.overnight_rhr': rhr(55) }).units['heart.overnight_rhr'].weight).toBeCloseTo(13, 6)
  })

  it('pillar totals float: Heart is worth what its units sum to, and readiness weighs pillars by it', () => {
    expect(PILLAR_POINTS.heart).toBeCloseTo(23.5, 10)
    const r = run({ ...strongSleep(), 'heart.overnight_hrv': hrv(60) })
    // Sleep 30 points against Heart 23.5: 30 / 53.5.
    expect(r.pillarDetail.sleep.effectiveWeight).toBeCloseTo(30 / 53.5, 3)
    expect(r.pillarDetail.heart.effectiveWeight).toBeCloseTo(23.5 / 53.5, 3)
    expect(r.pillarDetail.heart.points).toBeCloseTo(23.5, 10)
  })

  describe('activity.yesterday_load', () => {
    const id = 'activity.yesterday_load' as const
    const steps = (i: number) => 9000 + (i % 2 === 0 ? 400 : -400)

    it('is steady around the person\'s own normal day: 100 at it, lower either side', () => {
      const h = history(40, steps, shiftDateStr(D, -1))
      const at = unit(id, { today: yesterday(9000), history: h }).score!
      const big = unit(id, { today: yesterday(18000), history: h }).score!
      const idle = unit(id, { today: yesterday(1000), history: h }).score!
      expect(at).toBeGreaterThanOrEqual(95)
      expect(big).toBeLessThan(at - 30)
      expect(idle).toBeLessThan(at - 30)
    })

    it('is not an achievement: 12,000 steps is not rewarded over a normal 9,000', () => {
      const h = history(40, steps, shiftDateStr(D, -1))
      expect(unit(id, { today: yesterday(12000), history: h }).score!).toBeLessThan(unit(id, { today: yesterday(9000), history: h }).score!)
    })

    it('learns first: with no normal yet it drops out rather than scoring against a step target', () => {
      const r = unit(id, { today: yesterday(9000), history: history(5, steps, shiftDateStr(D, -1)) })
      expect(r.score).toBeNull()
      expect(r.gap).toBe('learning')
    })

    it('the old achievement unit is retired but its id stays readable', () => {
      const r = run({ 'activity.yesterday_movement': { today: yesterday(9000), history: [] } })
      expect(r.units['activity.yesterday_movement'].gap).toBe('unavailable')
      expect(UNIT_DEFS['activity.yesterday_movement'].points).toBe(0)
    })
  })
})

describe('version 4: quality and reliability factors (#2833)', () => {
  it('an estimated value counts half as much as a measured one inside its pillar', () => {
    const base = { today: night(97), history: history(40, wobble(95, 0.5)) }
    const measured = run({ 'sleep.efficiency': { ...base, today: night(97, { rung: 'provided' }) }, 'sleep.deep_rem_share': { today: night(40), history: history(40, wobble(40, 2)) } })
    const estimated = run({ 'sleep.efficiency': { ...base, today: night(97, { rung: 'estimated' }) }, 'sleep.deep_rem_share': { today: night(40), history: history(40, wobble(40, 2)) } })
    expect(measured.units['sleep.efficiency'].quality).toBe(1)
    expect(estimated.units['sleep.efficiency'].quality).toBe(0.5)
    expect(estimated.units['sleep.efficiency'].weight).toBeCloseTo(measured.units['sleep.efficiency'].weight / 2, 6)
  })

  it('a pillar built from estimates is worth less in readiness than one built from measurements', () => {
    const both = (rung: 'provided' | 'estimated') => run({
      'sleep.efficiency': { today: night(90, { rung }), history: history(40, wobble(90, 1)) },
      'body.spo2': { today: yesterday(97), history: [] },
    })
    expect(both('estimated').pillarDetail.sleep.effectiveWeight).toBeLessThan(both('provided').pillarDetail.sleep.effectiveWeight)
    expect(both('estimated').pillarDetail.sleep.confidence).toBe(0.5)
    expect(both('provided').pillarDetail.sleep.confidence).toBe(1)
  })

  it('the phone\'s own sleep stager counts as an estimate, the ring\'s measured stages do not', async () => {
    const { assembleShadowInputs, prepareShadowHistory } = await import('../assemble')
    const night1 = (src: string) => ({
      date: D, sleepStart: new Date('2026-09-29T13:00:00Z'), sleepEnd: new Date('2026-09-29T21:00:00Z'),
      durationHours: 8, deepSleepHours: 1.2, remSleepHours: 1.8, durationSource: src,
    })
    const raw = (src: string) => ({
      tz: 'Australia/Brisbane', ageYears: null, sleepSessions: [night1(src)], bodyMetrics: [], dailySummaries: [], wear: [], derived: [],
      workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set<string>(), fuel: new Map(), weightVsPlan: new Map(),
    })
    const rung = (src: string) => assembleShadowInputs(prepareShadowHistory(raw(src)), D).units['sleep.deep_rem_share']!.today?.rung
    expect(rung('oura_ble')).toBe('estimated')
    expect(rung('oura_cloud')).toBeNull()
  })

  describe('reliability', () => {
    const def = UNIT_DEFS['sleep.efficiency']
    const days = (offsets: number[]): UnitObservation[] => offsets.map(o => ({ date: shiftDateStr(D, -o), value: 90, source: 'ring' }))

    it('is 1 when the unit showed up on most of the last two weeks', () => {
      // 11 of 14 days = 0.79
      expect(reliabilityFactor(def, days([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21]), D)).toBe(1)
    })

    it('scales with how often a patchy unit showed up, with a floor', () => {
      // 5 of 14 days = 0.357; 0.357 / 0.7 = 0.51
      expect(reliabilityFactor(def, days([1, 3, 5, 7, 9, 30]), D)).toBeCloseTo((5 / 14) / 0.7, 6)
      expect(reliabilityFactor(def, days([1, 30]), D)).toBe(0.25)
    })

    it('does not judge a unit with under a week behind it', () => {
      expect(reliabilityFactor(def, days([1, 4]), D)).toBe(1)
      expect(reliabilityFactor(def, [], D)).toBe(1)
    })

    it('does not apply to a unit that only has a value after an event', () => {
      expect(reliabilityFactor(UNIT_DEFS['heart.hr_recovery'], days([2, 30]), D)).toBe(1)
    })

    it('shows up on the unit and in its weight; a missing unit stays at zero weight', () => {
      const patchy = run({ 'sleep.efficiency': { today: night(90), history: days([1, 3, 5, 7, 9, 30, 31, 32, 33, 34, 35, 36]) } })
      expect(patchy.units['sleep.efficiency'].reliability).toBeLessThan(1)
      expect(patchy.units['sleep.efficiency'].weight).toBeCloseTo(6 * patchy.units['sleep.efficiency'].reliability, 2)
      expect(run({}).units['sleep.efficiency'].weight).toBe(0)
    })
  })
})

describe('version 4: the graded ceiling (#2832)', () => {
  const withTemp = (excess: number) => run({ ...strongSleep(), 'body.temperature': temp(excess) })

  it('every number is a named constant', () => {
    expect(CEILING.temperature).toEqual([[0.3, 80], [0.5, 60], [0.7, 40]])
    expect([CEILING.illness, CEILING.hrvScoreAtOrBelow, CEILING.hrvCap, CEILING.sleepHoursAtOrBelow, CEILING.sleepCap, CEILING.loadRatioAtOrAbove, CEILING.loadCap])
      .toEqual([60, 20, 60, 5.5, 60, 1.6, 65])
  })

  it('temperature: no cap under +0.3 °C; 80 / 60 / 40 at +0.3 / +0.5 / +0.7, sliding between, flat beyond', () => {
    const cap = (e: number) => withTemp(e).ceiling.caps.find(c => c.id === 'temperature')?.cap ?? null
    expect(cap(0.1)).toBeNull()
    expect(cap(0.29)).toBeNull()
    expect(cap(0.3)).toBe(80)
    expect(cap(0.4)).toBe(70)
    expect(cap(0.5)).toBe(60)
    expect(cap(0.6)).toBe(50)
    expect(cap(0.7)).toBe(40)
    expect(cap(1.5)).toBe(40)
  })

  it('37.9 and 38.0 °C land a few points apart, not twenty (no cliff between neighbouring values)', () => {
    const a = withTemp(0.55).ceiling.cap!
    const b = withTemp(0.6).ceiling.cap!
    expect(Math.abs(a - b)).toBeLessThanOrEqual(5)
  })

  it('the cap limits readiness and records what it would have been', () => {
    const r = withTemp(0.5)
    expect(r.ceiling.cap).toBe(60)
    expect(r.ceiling.applied).toBe(true)
    expect(r.shadowReadiness).toBe(60)
    expect(r.ceiling.uncapped!).toBeGreaterThan(60)
  })

  it('a cap never raises readiness: a score already under it is untouched', () => {
    const r = run({ 'sleep.duration': { today: night(4), history: [] }, 'sleep.efficiency': { today: night(70), history: history(40, wobble(95, 0.5)) } })
    expect(r.ceiling.cap).toBe(60)
    expect(r.ceiling.uncapped!).toBeLessThan(60)
    expect(r.ceiling.applied).toBe(false)
    expect(r.shadowReadiness).toBe(r.ceiling.uncapped)
  })

  it('sleep of 5.5 h or less caps at 60; 5.6 h does not', () => {
    expect(run({ ...strongSleep(), 'sleep.duration': { today: night(5.5), history: [] } }).ceiling.caps.map(c => c.id)).toContain('short_sleep')
    expect(run({ ...strongSleep(), 'sleep.duration': { today: night(5.6), history: [] } }).ceiling.caps.map(c => c.id)).not.toContain('short_sleep')
  })

  it('a training-load ratio of 1.6 or more caps at 65; 1.59 does not', () => {
    const load = (v: number) => run({ ...strongSleep(), 'activity.training_load': { today: yesterday(v), history: [] } }).ceiling
    expect(load(1.6).cap).toBe(65)
    expect(load(1.59).caps.map(c => c.id)).not.toContain('load_ratio')
  })

  it('an overnight HRV score of 20 or less caps at 60', () => {
    // A normal of 60 ms, a night at 25 ms: far below, score pinned at the bottom.
    const r = run({ ...strongSleep(), 'heart.overnight_hrv': { today: night(25), history: history(40, wobble(60, 2)) } })
    expect(r.units['heart.overnight_hrv'].score!).toBeLessThanOrEqual(CEILING.hrvScoreAtOrBelow)
    expect(r.ceiling.caps.map(c => c.id)).toContain('hrv_crash')
    expect(r.shadowReadiness!).toBeLessThanOrEqual(60)
  })

  it('illness signs cap at 60: breathing and the heart signal both well off normal', () => {
    const breath: UnitInput = { today: night(17), history: history(40, wobble(15, 0.2)) }
    const r = run({ ...strongSleep(), 'body.breathing_rate': breath, 'heart.overnight_rhr': rhr(63) })
    expect(r.ceiling.caps.map(c => c.id)).toContain('illness')
    expect(r.shadowReadiness!).toBeLessThanOrEqual(60)
  })

  it('illness needs two signals: resting HR far off alone does not raise it', () => {
    const r = run({ ...strongSleep(), 'heart.overnight_rhr': rhr(63) })
    expect(r.ceiling.caps.map(c => c.id)).not.toContain('illness')
  })

  it('HRV and resting HR count as ONE heart signal for illness, not two', () => {
    // Heart moderately off, nothing else: two heart biomarkers counted separately would clear the
    // two-signal rule on their own. One signal must not.
    const r = run({ ...strongSleep(), 'heart.overnight_rhr': rhr(63), 'heart.overnight_hrv': { today: night(45), history: history(40, wobble(60, 2)) } })
    expect(r.ceiling.caps.map(c => c.id)).not.toContain('illness')
  })

  it('when several fire, the lowest cap wins', () => {
    const r = run({
      ...strongSleep(),
      'sleep.duration': { today: night(5), history: [] },
      'body.temperature': temp(0.7),
      'activity.training_load': { today: yesterday(1.7), history: [] },
    })
    expect(r.ceiling.caps.map(c => c.id).sort()).toEqual(['load_ratio', 'short_sleep', 'temperature'])
    expect(r.ceiling.cap).toBe(40)
    expect(r.shadowReadiness!).toBeLessThanOrEqual(40)
  })

  it('no flag, no cap', () => {
    const r = run(strongSleep())
    expect(r.ceiling).toMatchObject({ cap: null, caps: [], applied: false })
    expect(r.shadowReadiness).toBe(r.ceiling.uncapped)
  })

  it('the temperature and illness caps wait for a cycle-aware normal when the cycle is tracked without one', () => {
    const tracked: UnitInput = { today: night(0.6, { phase: 'luteal' }), history: history(40, wobble(0, 0.05)) }
    const r = run({ ...strongSleep(), 'body.temperature': tracked })
    expect(r.ceiling.waitingOnCycle).toBe(true)
    expect(r.ceiling.caps.map(c => c.id)).not.toContain('temperature')
    // …and fires normally once the phase has its own normal (7 same-phase days).
    const covered: UnitInput = {
      today: night(0.6, { phase: 'luteal' }),
      history: history(40, wobble(0, 0.05), D, { phase: 'luteal' }),
    }
    expect(run({ ...strongSleep(), 'body.temperature': covered }).ceiling.waitingOnCycle).toBe(false)
  })
})
