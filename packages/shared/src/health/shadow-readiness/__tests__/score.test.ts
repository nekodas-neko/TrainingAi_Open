// #2377 — the shadow readiness scorer. One test per edge case in docs/architecture/readiness-tree.md
// (named "edge case #N"), then the structural rules: settled days, drop-out + renormalise, maturity
// stages, the three shapes, the minimum-meaningful-change floor, weights, and null = not scored.
import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import {
  gradeOnYardstick,
  rangeScore,
  robustSpread,
  scoreFuel,
  scoreShadowReadiness,
  scoreUnit,
  stageFor,
  type ShadowScoreInput,
  type UnitInput,
  type UnitObservation,
} from '../score'
import {
  PILLAR_WEIGHTS,
  SHADOW_MODEL_VERSION,
  SHADOW_PILLARS,
  SHADOW_UNIT_IDS,
  UNIT_DEFS,
  type ShadowUnitId,
} from '../model'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '../assemble'

const D = '2026-09-30'
const NONE = new Map<string, string>()

/** `n` prior days ending the day before `end`, oldest first. */
function history(n: number, value: (i: number) => number, end = D, extra: Partial<UnitObservation> = {}): UnitObservation[] {
  return Array.from({ length: n }, (_, i) => ({ date: shiftDateStr(end, -(n - i)), value: value(i), source: 'ring', ...extra }))
}
const night = (value: number, extra: Partial<UnitObservation> = {}): UnitObservation => ({ date: D, value, source: 'ring', ...extra })
const yesterday = (value: number): UnitObservation => ({ date: shiftDateStr(D, -1), value, source: 'ring' })
const unit = (id: ShadowUnitId, input: UnitInput, excluded: ReadonlyMap<string, string> = NONE, context?: ShadowScoreInput['context']) =>
  scoreUnit(UNIT_DEFS[id], input, D, excluded, context)
/** A gentle wobble so the window has a real (small) spread. */
const wobble = (base: number, amp: number) => (i: number) => base + (i % 2 === 0 ? amp : -amp)

describe('shadow readiness — the readiness-tree edge cases', () => {
  it('edge case #1: perfect and consistent reads ~95–100, not "average"', () => {
    const duration = unit('sleep.duration', { today: night(8), history: history(40, wobble(8, 0.1)) })
    expect(duration.level).toBeGreaterThanOrEqual(95)
    expect(duration.score).toBeGreaterThanOrEqual(95)
    const efficiency = unit('sleep.efficiency', { today: night(95), history: history(40, wobble(95, 0.5)) })
    expect(efficiency.level).toBeGreaterThanOrEqual(95)
    expect(efficiency.score).toBeGreaterThanOrEqual(95)
  })

  it('edge case #2: a consistent bad habit is graded against the research range, not excused', () => {
    const u = unit('sleep.duration', { today: night(5.5), history: history(40, wobble(5.5, 0.1)) })
    expect(u.level).toBeCloseTo(40, 0)
    expect(u.score).toBeCloseTo(40, 0)
    expect(u.day).toBeCloseTo(0, 5)
  })

  it('edge case #3: genetically low HRV is held inside a 60–90 Level, so it cannot pin the pillar', () => {
    expect(gradeOnYardstick(5, UNIT_DEFS['heart.overnight_hrv'].level!)).toBe(60)
    expect(gradeOnYardstick(200, UNIT_DEFS['heart.overnight_hrv'].level!)).toBe(90)
    expect(gradeOnYardstick(30, UNIT_DEFS['heart.overnight_rhr'].level!)).toBe(90)
    expect(gradeOnYardstick(100, UNIT_DEFS['heart.overnight_rhr'].level!)).toBe(60)

    const r = scoreShadowReadiness({
      date: D,
      units: {
        'heart.overnight_hrv': { today: night(18), history: history(40, wobble(18, 1)) },
        'heart.overnight_rhr': { today: night(46), history: history(40, wobble(46, 1)) },
        'heart.overnight_settling': { today: night(6), history: history(40, wobble(5, 0.3)) },
      },
    })
    expect(r.units['heart.overnight_hrv'].level).toBe(60)
    expect(r.units['heart.overnight_hrv'].score).toBeGreaterThanOrEqual(60)
    // Day and the other units decide: the pillar sits well above the HRV floor.
    expect(r.pillars.heart).toBeGreaterThan(70)
  })

  it('edge case #4: a tiny spread is floored at the minimum meaningful change, so a 2 ms wobble is no crisis', () => {
    const flat = history(40, wobble(50, 0.05))
    const u = unit('heart.overnight_hrv', { today: night(48), history: flat })
    expect(u.day).toBeGreaterThan(-15)
    expect(u.score).toBeGreaterThan(50)
    expect(robustSpread(flat.map(o => o.value), 3)).toBe(3)
    // Temperature and resting HR carry their own floors.
    expect(UNIT_DEFS['body.temperature'].minMeaningfulChange).toBe(0.15)
    expect(UNIT_DEFS['heart.overnight_rhr'].minMeaningfulChange).toBe(2)
  })

  it('edge case #5: too much of a good thing falls — 10 h sleep and a very high load', () => {
    const nine = unit('sleep.duration', { today: night(9), history: [] })
    const ten = unit('sleep.duration', { today: night(10), history: [] })
    expect(nine.score).toBe(100)
    expect(ten.score).toBeLessThan(100)
    const load = unit('activity.training_load', { today: yesterday(1.7), history: [] })
    expect(load.score).toBeLessThan(50)
    // The two sides fall at different rates: an hour short costs more than an hour over.
    expect(unit('sleep.duration', { today: night(6), history: [] }).score!).toBeLessThan(ten.score!)
  })

  it('edge case #6: chronic overload — the 28:90 trend waits on #2340, and Heart\'s Level drifts down with the normal', () => {
    const block = unit('activity.block_trend', { today: yesterday(1.4), history: [] })
    expect(block.gap).toBe('unavailable')
    expect(block.note).toMatch(/#2340/)

    const before = unit('heart.overnight_hrv', { today: night(60), history: history(40, wobble(60, 2)) })
    const after = unit('heart.overnight_hrv', { today: night(45), history: history(40, wobble(45, 2)) })
    expect(after.level!).toBeLessThan(before.level!)
  })

  it('edge case #7: sick days and low-wear days leave the window, so recovery does not read as "great"', () => {
    const days = history(30, i => (i >= 20 && i < 27 ? 35 : 59 + (i % 3)))
    const sick = new Map(days.slice(20, 27).map(o => [o.date, 'unwell']))
    const u = unit('heart.overnight_hrv', { today: night(60), history: days }, sick)
    expect(u.normal).toBe(60)
    expect(u.day).toBeCloseTo(0, 5)
    expect(u.validDays).toBe(23)
  })

  it('edge case #8: a step change that holds 7 days re-baselines as a new routine', () => {
    const days = history(30, i => (i < 23 ? 55 + (i % 2) : 62 + (i % 2)))
    const u = unit('heart.overnight_rhr', { today: night(62.5), history: days })
    expect(u.flags).toContain('regime_change')
    expect(Math.abs(u.day!)).toBeLessThan(10)
    expect(u.stage).toBe('provisional')
  })

  it('edge case #9: a tracked cycle gets a per-phase normal, so the luteal rise is not penalised', () => {
    const days = history(60, i => (i % 28 >= 14 ? 0.4 : 0), D).map((o, i) => ({ ...o, phase: i % 28 >= 14 ? 'luteal' : 'follicular' }))
    const withPhase = unit('body.temperature', { today: night(0.4, { phase: 'luteal' }), history: days })
    expect(withPhase.flags).toContain('cycle_phase:luteal')
    expect(withPhase.score).toBe(100)
    const without = unit('body.temperature', { today: night(0.4), history: days.map(({ phase: _p, ...o }) => o) })
    expect(without.score!).toBeLessThan(100)
  })

  it('edge case #10: a declared context moves the yardstick (beta-blockers for resting HR, altitude for SpO₂)', () => {
    const plain = unit('heart.overnight_rhr', { today: night(48), history: history(40, wobble(48, 1)) })
    const blocked = unit('heart.overnight_rhr', { today: night(48), history: history(40, wobble(48, 1)) }, NONE, { betaBlocker: true })
    expect(blocked.level!).toBeLessThan(plain.level!)

    const sea = unit('body.spo2', { today: yesterday(93), history: [] })
    const high = unit('body.spo2', { today: yesterday(93), history: [] }, NONE, { altitudeM: 2500 })
    expect(sea.score!).toBeLessThan(100)
    expect(high.score).toBe(100)
  })

  it('edge case #11: a sensor change keeps baselines per source and restarts the unit as provisional', () => {
    const ring = history(40, wobble(50, 2)).map(o => ({ ...o, source: 'ring' }))
    const strap = history(3, wobble(70, 2)).map(o => ({ ...o, source: 'strap' }))
    const u = unit('heart.overnight_hrv', { today: night(72, { source: 'strap' }), history: [...ring, ...strap] })
    expect(u.flags).toContain('source_changed')
    expect(u.stage).toBe('provisional')
    expect(u.validDays).toBe(3)
    // The ring's normal is never mixed in: no Day is scored against it.
    expect(u.day).toBeNull()
    expect(u.normal).toBeNull()
  })

  it('edge case #12: unlogged food is missing, not zero — fuel drops out and Body renormalises', () => {
    const r = scoreShadowReadiness({
      date: D,
      units: {
        'body.temperature': { today: night(0), history: history(40, wobble(0, 0.05)) },
        'body.fuel': { today: null, history: [] },
      },
    })
    expect(r.units['body.fuel'].score).toBeNull()
    expect(r.units['body.fuel'].gap).toBe('missing')
    expect(r.pillarDetail.body.dropped['body.fuel']).toBe('missing')
    expect(r.pillars.body).toBe(r.units['body.temperature'].score)
    // A logged part scores on its own; an unlogged one is not a zero dragging the mean down.
    expect(scoreFuel({ energyDeviationKcal: null, proteinRatio: null, hydrationRatio: 1 }).score).toBe(100)
    expect(scoreFuel({ energyDeviationKcal: null, proteinRatio: null, hydrationRatio: null }).score).toBeNull()
  })

  it('edge case #13: a daytime sleeper\'s main sleep is the longest of the 24 h, not a clock window', () => {
    const tz = 'Australia/Brisbane'
    const at = (iso: string) => new Date(iso)
    const raw = emptyRaw(tz)
    raw.sleepSessions = [
      // Night shift: asleep 08:00–15:30 local on the readiness day, plus a short evening nap.
      { date: D, sleepStart: at('2026-09-30T08:00:00+10:00'), sleepEnd: at('2026-09-30T15:30:00+10:00'), durationHours: 7.5 },
      { date: D, sleepStart: at('2026-09-29T19:00:00+10:00'), sleepEnd: at('2026-09-29T19:40:00+10:00'), durationHours: 0.67 },
    ]
    const input = assembleShadowInputs(prepareShadowHistory(raw), D)
    expect(input.units['sleep.duration']!.today!.value).toBeCloseTo(7.5, 5)
  })

  it('edge case #14: under 14 valid days — Level from population defaults, Day "learning"', () => {
    const hrv = unit('heart.overnight_hrv', { today: night(50), history: history(5, wobble(50, 2)) })
    expect(hrv.stage).toBe('learning')
    expect(hrv.day).toBeNull()
    expect(hrv.level).toBeCloseTo(gradeOnYardstick(50, UNIT_DEFS['heart.overnight_hrv'].level!), 1)
    expect(hrv.score).toBe(hrv.level)
    // No yardstick: nothing honest to score yet, so it drops out rather than inventing a number.
    const settling = unit('heart.overnight_settling', { today: night(5), history: history(5, wobble(5, 0.2)) })
    expect(settling.score).toBeNull()
    expect(settling.gap).toBe('learning')
  })

  it('edge case #15: a great normal and a great day clamp at 100 and keep the room to reach it', () => {
    const u = unit('sleep.efficiency', { today: night(99), history: history(40, wobble(95, 0.5)) })
    expect(u.level).toBe(100)
    expect(u.score).toBe(100)
    const all100 = scoreShadowReadiness({
      date: D,
      units: { 'sleep.efficiency': { today: night(99), history: history(40, wobble(95, 0.5)) } },
    })
    expect(all100.shadowReadiness).toBe(100)
  })
})

describe('shadow readiness — structural rules', () => {
  it('settled days: a daytime unit fed the current day is refused, and inputs_through stays before the date', () => {
    const r = scoreShadowReadiness({
      date: D,
      units: {
        'activity.yesterday_movement': { today: { date: D, value: 9000, source: 'ring' }, history: [] },
        'body.daytime_stress': { today: yesterday(30), history: history(40, wobble(30, 5), shiftDateStr(D, -1)) },
      },
    })
    expect(r.units['activity.yesterday_movement'].gap).toBe('unsettled')
    expect(r.units['activity.yesterday_movement'].score).toBeNull()
    expect(r.inputsThrough).toBe(shiftDateStr(D, -1))
    expect(r.inputsThrough! < D).toBe(true)
  })

  it('settled days: the assembler reads yesterday for daytime units and ignores data on the current day', () => {
    const raw = emptyRaw('Australia/Brisbane')
    raw.bodyMetrics = [
      { date: shiftDateStr(D, -1), steps: 7000, spo2Pct: 96 },
      { date: D, steps: 20000, spo2Pct: 80 },
    ]
    raw.derived = [{ day: D, stressHighMinutes: 300 }]
    const input = assembleShadowInputs(prepareShadowHistory(raw), D)
    expect(input.units['activity.yesterday_movement']!.today).toMatchObject({ date: shiftDateStr(D, -1), value: 7000 })
    expect(input.units['body.spo2']!.today).toMatchObject({ date: shiftDateStr(D, -1), value: 96 })
    expect(input.units['body.daytime_stress']!.today).toBeNull()
    const r = scoreShadowReadiness(input)
    expect(r.inputsThrough).toBe(shiftDateStr(D, -1))
  })

  it('training load follows the shared ACWR baselining rule: withheld in a program\'s first 28 days (OR-210)', () => {
    const tz = 'Australia/Brisbane'
    const raw = emptyRaw(tz)
    // Three sessions a week for six weeks before the readiness day.
    raw.workouts = Array.from({ length: 18 }, (_, i) => ({
      startedAt: new Date(`${shiftDateStr(D, -(2 + Math.floor(i * 7 / 3)))}T08:00:00+10:00`), volumeKg: 4000,
    }))
    raw.program = { createdAt: new Date(`${shiftDateStr(D, -90)}T00:00:00+10:00`) }
    expect(assembleShadowInputs(prepareShadowHistory(raw), D).units['activity.training_load']!.today).not.toBeNull()
    raw.program = { createdAt: new Date(`${shiftDateStr(D, -5)}T00:00:00+10:00`) }
    expect(assembleShadowInputs(prepareShadowHistory(raw), D).units['activity.training_load']!.today).toBeNull()
  })

  it('drop-out + renormalise: a pillar renormalises over the units that scored and says which dropped', () => {
    const r = scoreShadowReadiness({
      date: D,
      units: {
        'heart.overnight_hrv': { today: night(60), history: history(40, wobble(60, 2)) },
        'heart.overnight_rhr': { today: night(50), history: history(40, wobble(50, 1)) },
      },
    })
    const hrv = r.units['heart.overnight_hrv'].score!
    const rhr = r.units['heart.overnight_rhr'].score!
    expect(r.pillars.heart).toBeCloseTo((35 * hrv + 30 * rhr) / 65, 1)
    expect(r.pillarDetail.heart.scored).toEqual({ 'heart.overnight_hrv': 0.538, 'heart.overnight_rhr': 0.462 })
    expect(r.pillarDetail.heart.dropped).toMatchObject({
      'heart.overnight_settling': 'missing',
      'heart.daytime_rhr': 'unavailable',
      'heart.hr_recovery': 'missing',
    })
    // Only Heart scored, so readiness is Heart and Heart carries all the weight.
    expect(r.shadowReadiness).toBe(r.pillars.heart)
    expect(r.pillarDetail.heart.effectiveWeight).toBe(1)
    expect(r.pillars.sleep).toBeNull()
  })

  it('maturity stages: 13 learning, 14 provisional, 29 provisional, 30 settled', () => {
    expect(stageFor(13)).toBe('learning')
    expect(stageFor(14)).toBe('provisional')
    expect(stageFor(29)).toBe('provisional')
    expect(stageFor(30)).toBe('settled')
    const at = (n: number) => unit('heart.overnight_hrv', { today: night(60), history: history(n, wobble(60, 2)) }).stage
    expect([at(13), at(14), at(29), at(30)]).toEqual(['learning', 'provisional', 'provisional', 'settled'])
    // The row's stage is the least mature unit that scored.
    const r = scoreShadowReadiness({
      date: D,
      units: {
        'heart.overnight_hrv': { today: night(60), history: history(40, wobble(60, 2)) },
        'heart.overnight_rhr': { today: night(50), history: history(20, wobble(50, 1)) },
      },
    })
    expect(r.maturityStage).toBe('provisional')
  })

  it('the three shapes: sweet spot falls both ways, steady is 100 at normal, directional rewards the good way', () => {
    const band = { lo: 7, hi: 9, belowSpan: 2, aboveSpan: 4 }
    expect(rangeScore(8, band)).toBe(100)
    expect(rangeScore(6, band)).toBe(50)
    expect(rangeScore(11, band)).toBe(50)

    const temp = history(40, wobble(0, 0.05))
    expect(unit('body.temperature', { today: night(0), history: temp }).score).toBe(100)
    const hot = unit('body.temperature', { today: night(0.6), history: temp }).score!
    const cold = unit('body.temperature', { today: night(-0.6), history: temp }).score!
    expect(hot).toBeLessThan(100)
    expect(hot).toBeCloseTo(cold, 5)

    const hrvHist = history(40, wobble(60, 3))
    const up = unit('heart.overnight_hrv', { today: night(66), history: hrvHist }).score!
    const flat = unit('heart.overnight_hrv', { today: night(60), history: hrvHist }).score!
    const down = unit('heart.overnight_hrv', { today: night(54), history: hrvHist }).score!
    expect(up).toBeGreaterThan(flat)
    expect(down).toBeLessThan(flat)
    // Lower is better for resting HR.
    const rhrHist = history(40, wobble(55, 1))
    expect(unit('heart.overnight_rhr', { today: night(52), history: rhrHist }).score!)
      .toBeGreaterThan(unit('heart.overnight_rhr', { today: night(58), history: rhrHist }).score!)
  })

  it('minimum meaningful change: the floor applies only when the real spread is smaller', () => {
    expect(robustSpread([10, 10, 10, 10], 3)).toBe(3)
    expect(robustSpread([0, 10, 20, 30, 40], 3)).toBeCloseTo(20 / 1.349, 5)
  })

  it('weights: each pillar\'s units and the pillars sum to 100 as #2356 wrote them; renormalised shares sum to 1', () => {
    for (const p of SHADOW_PILLARS) {
      const sum = SHADOW_UNIT_IDS.filter(id => UNIT_DEFS[id].pillar === p).reduce((s, id) => s + UNIT_DEFS[id].weight, 0)
      expect(sum).toBe(100)
    }
    expect(Object.values(PILLAR_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)

    const r = scoreShadowReadiness({
      date: D,
      units: {
        'sleep.duration': { today: night(8), history: [] },
        'body.temperature': { today: night(0), history: history(40, wobble(0, 0.05)) },
      },
    })
    const eff = SHADOW_PILLARS.reduce((s, p) => s + r.pillarDetail[p].effectiveWeight, 0)
    expect(eff).toBeCloseTo(1, 3)
    expect(r.pillarDetail.sleep.effectiveWeight).toBeCloseTo(0.6, 3)
    expect(r.pillarDetail.body.effectiveWeight).toBeCloseTo(0.4, 3)
  })

  describe('sleep.deep_rem_share: steady around the person\'s own normal (issue 2635)', () => {
    const id = 'sleep.deep_rem_share' as const
    const pct = (i: number) => 40 + (i % 2 === 0 ? 2 : -2)
    const sleepUnits = (share: UnitInput): ShadowScoreInput['units'] => ({
      'sleep.duration': { today: night(8), history: [] },
      'sleep.efficiency': { today: night(90), history: history(40, wobble(90, 1)) },
      'sleep.latency': { today: night(15), history: [] },
      'sleep.timing': { today: night(0), history: history(40, wobble(0, 10)) },
      'sleep.balance': { today: night(8), history: [] },
      [id]: share,
    })

    it('is a learned steady unit with no fixed band and keeps its 10 Sleep points', () => {
      const def = UNIT_DEFS[id]
      expect(def).toMatchObject({ shape: 'steady', reference: 'learned', weight: 10 })
      expect(def.band).toBeUndefined()
      expect(def.unavailable).toBeUndefined()
      expect(SHADOW_MODEL_VERSION).toBeGreaterThanOrEqual(2)
    })

    it('a night at its normal scores near 100; a night far from it, either way, scores low', () => {
      const h = history(40, pct)
      const atNormal = unit(id, { today: night(40), history: h })
      expect(atNormal.score!).toBeGreaterThan(95)
      expect(atNormal.level).toBeNull()
      expect(atNormal.normal).toBeCloseTo(40, 0)
      expect(unit(id, { today: night(25), history: h }).score!).toBeLessThan(50)
      expect(unit(id, { today: night(55), history: h }).score!).toBeLessThan(50)
      // Nothing is fixed: the same share is fine for someone whose normal it is.
      expect(unit(id, { today: night(25), history: history(40, i => 25 + (i % 2 === 0 ? 2 : -2)) }).score!).toBeGreaterThan(95)
    })

    it('maturity: 13 days learning (no yardstick, so it drops out), 14 provisional, 29 provisional, 30 settled', () => {
      const at = (n: number) => unit(id, { today: night(40), history: history(n, pct) })
      expect(at(13)).toMatchObject({ stage: 'learning', score: null, gap: 'learning' })
      expect([at(14).stage, at(29).stage, at(30).stage]).toEqual(['provisional', 'provisional', 'settled'])
      expect(at(14).score).not.toBeNull()
    })

    it('the minimum-meaningful-change floor stops a very steady sleeper reading 1 point as a crisis', () => {
      expect(unit(id, { today: night(41), history: history(40, () => 40) }).score!).toBeGreaterThan(85)
    })

    it('a night with no staging yields no value (never 0)', () => {
      const raw = emptyRaw('Australia/Brisbane')
      const base = { date: D, sleepStart: new Date('2026-09-29T22:30:00+10:00'), sleepEnd: new Date('2026-09-30T06:30:00+10:00'), durationHours: 8 }
      const valueFor = (stages: { deepSleepHours?: number | null; remSleepHours?: number | null }) => {
        raw.sleepSessions = [{ ...base, ...stages }]
        return assembleShadowInputs(prepareShadowHistory(raw), D).units[id]!.today?.value ?? null
      }
      expect(valueFor({})).toBeNull()
      expect(valueFor({ deepSleepHours: null, remSleepHours: null })).toBeNull()
      expect(valueFor({ deepSleepHours: 0, remSleepHours: 0 })).toBeNull()
      expect(valueFor({ deepSleepHours: 1.2, remSleepHours: 2 })).toBeCloseTo(40, 5)
    })

    it('dropped, Sleep renormalises over the other five; scored, it carries 10 of 100', () => {
      const dropped = scoreShadowReadiness({ date: D, units: sleepUnits({ today: null, history: history(40, pct) }) })
      expect(dropped.pillarDetail.sleep.dropped[id]).toBe('missing')
      expect(Object.keys(dropped.pillarDetail.sleep.scored)).toHaveLength(5)
      expect(Object.values(dropped.pillarDetail.sleep.scored).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
      expect(dropped.units[id].weight).toBe(0)
      const scored = scoreShadowReadiness({ date: D, units: sleepUnits({ today: night(40), history: history(40, pct) }) })
      expect(scored.pillarDetail.sleep.scored[id]).toBeCloseTo(0.1, 3)
    })
  })

  it('a new unit counts half until it settles (#2356)', () => {
    const hrr = history(20, wobble(25, 2), shiftDateStr(D, -1))
    const r = scoreShadowReadiness({
      date: D,
      units: {
        'heart.hr_recovery': { today: yesterday(25), history: hrr },
        'heart.overnight_hrv': { today: night(60), history: history(40, wobble(60, 2)) },
      },
    })
    expect(r.units['heart.hr_recovery'].stage).toBe('provisional')
    expect(r.units['heart.hr_recovery'].weight).toBe(5)
    expect(r.units['heart.overnight_hrv'].weight).toBe(35)
  })

  it('null is "not scored", never 0: with no input at all nothing scores', () => {
    const r = scoreShadowReadiness({ date: D, units: {} })
    expect(r.shadowReadiness).toBeNull()
    for (const p of SHADOW_PILLARS) expect(r.pillars[p]).toBeNull()
    for (const id of SHADOW_UNIT_IDS) {
      expect(r.units[id].score).toBeNull()
      expect(r.units[id].gap).not.toBeNull()
    }
    expect(r.maturityStage).toBe('learning')
    expect(r.inputsThrough).toBeNull()
    expect(r.modelVersion).toBe(SHADOW_MODEL_VERSION)
  })

  it('every unit is stored under its id with the fixed shape', () => {
    const r = scoreShadowReadiness({ date: D, units: { 'sleep.duration': { today: night(8), history: [] } } })
    expect(Object.keys(r.units).sort()).toEqual([...SHADOW_UNIT_IDS].sort())
    expect(Object.keys(r.units['sleep.duration']).sort()).toEqual(
      ['day', 'daytimeThrough', 'flags', 'gap', 'level', 'normal', 'note', 'provenance', 'score', 'stage', 'validDays', 'value', 'weight'].sort(),
    )
  })
})

function emptyRaw(tz: string): ShadowRawHistory {
  return {
    tz, ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], wear: [], derived: [], workouts: [], program: null,
    setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
  }
}
