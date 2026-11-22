// #3890: the week in three lines, from the logged sets (no model), and decision 9's missed rep.
// Every sentence states what the logs show; the shadow read's verdict is a field, never a claim.
// Fake lift names, made-up loads.
import { describe, it, expect } from 'vitest'
import { directionOf, sessionsLine, summarizeLift, summarizeWeek, type WeekLiftInput } from '../summary'
import { classifySet, readLog, unexcusedMissAtPlan, type SessionReadLog, type SessionReadSet } from '../../ai-periodization/session-read'

const set = (setNumber: number, over: Partial<SessionReadSet> = {}): SessionReadSet => ({
  setNumber, reps: 5, weightKg: 80, plannedReps: 5, plannedWeightKg: 80, plannedPct: 75,
  restTimeSec: 150, plannedRestSec: 150, rpe: null, rpeSource: null, hr: null, ...over,
})
const log = (sets: SessionReadSet[], over: Partial<SessionReadLog> = {}, session: Partial<SessionReadLog['session']> = {}): SessionReadLog => ({
  exerciseLogId: 'el', workoutSessionId: 'ws', programSessionId: 'ps', exerciseName: 'Lift A', loggedAt: new Date('2026-11-18T02:00:00Z'),
  estimated1rm: 100, exerciseDeloaded: false, exerciseType: 'weighted', effortVsPlan: null, effortSource: null, sets,
  ...over,
  session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null, ...session },
})
const lift = (name: string, logs: { day: string; log: SessionReadLog }[]): WeekLiftInput =>
  ({ exerciseName: name, exerciseId: null, weightStepKg: 2.5, repCeiling: 8, logs })

const MET = [set(1), set(2), set(3)]
const SHORT_AT_PLAN = [set(1), set(2, { reps: 3 }), set(3)]

describe('decision 9: a missed rep is a set short at the planned weight or lighter, not excused, not an override', () => {
  it('included: short at the planned weight after a full rest', () => {
    expect(unexcusedMissAtPlan(SHORT_AT_PLAN, 2.5, false)).toBe(true)
    expect(unexcusedMissAtPlan([set(1), set(2, { reps: 3, weightKg: 77.5 }), set(3)], 2.5, false)).toBe(true) // lighter
    expect(unexcusedMissAtPlan([set(1, { reps: 3 }), set(2), set(3)], 2.5, false)).toBe(true) // the first set: no rest to excuse it
  })
  it('excluded: loaded heavier than planned, by any amount (one step is within the read\'s own tolerance, still excluded)', () => {
    expect(unexcusedMissAtPlan([set(1), set(2, { reps: 3, weightKg: 82.5 }), set(3)], 2.5, false)).toBe(false)
    expect(unexcusedMissAtPlan([set(1), set(2, { reps: 3, weightKg: 90 }), set(3)], 2.5, false)).toBe(false)
  })
  it('excluded: the rest before it was short enough to excuse the reps it lost', () => {
    const shortRest = [set(1, { restTimeSec: 40 }), set(2, { reps: 3 }), set(3)]
    expect(classifySet(shortRest[1], shortRest[0], false, false, 2.5)).toMatchObject({ cls: 'miss', missReps: 2, excusedReps: 2 })
    expect(unexcusedMissAtPlan(shortRest, 2.5, false)).toBe(false)
    // Partly excused: the reps the rest does not explain still count.
    const partial = [set(1, { restTimeSec: 100 }), set(2, { reps: 1 }), set(3)]
    expect(unexcusedMissAtPlan(partial, 2.5, false)).toBe(true)
  })
  it('excluded: an unknown rest (the read excuses it), no planned weight, an overridden session', () => {
    expect(unexcusedMissAtPlan([set(1, { restTimeSec: null }), set(2, { reps: 3 }), set(3)], 2.5, false)).toBe(false)
    expect(unexcusedMissAtPlan([set(1), set(2, { reps: 3, plannedWeightKg: null }), set(3)], 2.5, false)).toBe(false)
    expect(unexcusedMissAtPlan(SHORT_AT_PLAN, 2.5, true)).toBe(false)
  })
  it('the read agrees on what a miss is: the shared per-set rule', () => {
    const r = readLog(log(SHORT_AT_PLAN), 2.5)
    expect(r.sets.map(s => s.cls)).toEqual(['met', 'miss', 'met'])
  })
})

describe('the lift\'s missed rep is its LAST session of the week', () => {
  it('missed early in the week, then met the reps the next time: no miss', () => {
    const l = summarizeLift(lift('Lift A', [{ day: 'd1', log: log(SHORT_AT_PLAN) }, { day: 'd3', log: log(MET) }]))
    expect(l).toMatchObject({ missedRep: false, lastSession: 'met', sessions: 2 })
  })
  it('met early, missed last: a miss', () => {
    expect(summarizeLift(lift('Lift A', [{ day: 'd1', log: log(MET) }, { day: 'd3', log: log(SHORT_AT_PLAN) }])).missedRep).toBe(true)
  })
  it('an overridden last session is not compared, so no miss, whatever came before', () => {
    const l = summarizeLift(lift('Lift A', [{ day: 'd1', log: log(SHORT_AT_PLAN) }, { day: 'd3', log: log(SHORT_AT_PLAN, {}, { wasOverride: true }) }]))
    expect(l).toMatchObject({ missedRep: false, lastSession: 'not_compared', notComparedWhy: 'override', shadow: null })
  })
  it('not logged: null, not "no miss"', () => {
    expect(summarizeLift(lift('Lift A', []))).toMatchObject({ missedRep: null, lastSession: null, sessions: 0 })
  })
})

describe('summarizeWeek: what the logs show, never what the app did', () => {
  it('line 2 compares each lift\'s last session with the plan; line 3 counts days short rest cost reps; the read is a field', () => {
    const shortRest = [set(1, { restTimeSec: 40 }), set(2, { reps: 3 }), set(3)]
    const s = summarizeWeek({
      sessionsDone: 3, sessionsPlanned: 3,
      lifts: [
        lift('Lift A', [{ day: '2026-11-16', log: log([set(1), set(2), set(3, { reps: 8 })]) }]),
        lift('Lift B', [{ day: '2026-11-16', log: log(MET) }, { day: '2026-11-18', log: log(shortRest) }]),
        lift('Lift C', [{ day: '2026-11-18', log: log(MET) }]),
        lift('Lift D', []),
      ],
    })
    expect(s.lines).toEqual([
      '3 of 3 planned sessions done.',
      'Last session: Lift A beat the plan, Lift B fell short of the plan, Lift C met the plan.',
      'Short rest cost reps on 1 day.',
    ])
    // Nothing says the app held, raised or lowered a weight.
    expect(s.lines.join(' ')).not.toMatch(/\b(held|holding|going up|coming down|raised|lowered)\b/i)
    // Lines 2 and 3 agree for the same lift: Lift B fell short on the day short rest cost it reps.
    expect(s.lifts.map(l => [l.exerciseName, l.lastSession, l.missedRep])).toEqual([
      ['Lift A', 'beat', false], ['Lift B', 'short', false], ['Lift C', 'met', false], ['Lift D', null, null],
    ])
    expect(s.lifts[1].shadow).toEqual({ verdict: 'hold-rest-more', direction: 'held', why: 'short_rest' })
    expect(s.shortRestDays).toBe(1)
  })

  it('a lift loaded heavier than planned and short on reps went heavier, it did not fall short of the plan', () => {
    // More than one plate step over the planned 80 kg, with the reps short: the person's choice.
    const heavier = [set(1, { weightKg: 85, reps: 4 }), set(2, { weightKg: 85, reps: 3 }), set(3)]
    const s = summarizeWeek({
      sessionsDone: 1, sessionsPlanned: 3,
      lifts: [lift('Lift A', [{ day: '2026-11-18', log: log(heavier) }])],
    })
    expect(s.lines[1]).toBe('Last session: Lift A went heavier than planned.')
    expect(s.lifts[0]).toMatchObject({ lastSession: 'heavier', missedRep: false })
    // A real miss at the planned weight in the same session is still short.
    const both = summarizeLift(lift('Lift A', [{ day: 'd', log: log([set(1, { weightKg: 85, reps: 3 }), set(2, { reps: 3 }), set(3)]) }]))
    expect(both).toMatchObject({ lastSession: 'short', missedRep: true })
  })

  it('C2: lifts logged but not compared say so, with the reason, instead of "nothing logged"', () => {
    const s = summarizeWeek({
      sessionsDone: 2, sessionsPlanned: 3,
      lifts: [
        lift('Lift A', [{ day: 'd1', log: log(MET, {}, { phaseType: 'deload' }) }]),
        lift('Lift B', [{ day: 'd1', log: log(MET, {}, { intensityMode: 'deload' }) }]),
        lift('Lift C', [{ day: 'd1', log: log(MET, { exerciseType: 'bodyweight', estimated1rm: 0 }) }]),
        lift('Lift D', [{ day: 'd1', log: log(MET, {}, { completed: false }) }]),
        lift('Lift E', [{ day: 'd1', log: log(MET, {}, { phaseType: 'baseline' }) }]),
        lift('Lift F', [{ day: 'd1', log: log([set(1)]) }]),
      ],
    })
    expect(s.lines[1]).toBe('Logged, not compared this week: Lift A, Lift B (deload); Lift C (no bar weight to compare); Lift D (not finished); Lift E (baseline week); Lift F (too few planned sets).')
    expect(s.lines[2]).toBe('No set compared for rest this week.')
    expect(s.lifts.every(l => l.missedRep === false)).toBe(true)
  })

  it('compared and not compared together; and nothing logged at all', () => {
    const s = summarizeWeek({ sessionsDone: 1, sessionsPlanned: 1, lifts: [
      lift('Lift A', [{ day: 'd1', log: log(MET) }]),
      lift('Lift B', [{ day: 'd1', log: log(MET, {}, { wasOverride: true }) }]),
    ] })
    expect(s.lines.slice(1)).toEqual(['Last session: Lift A met the plan. Logged, not compared this week: Lift B (changed from the plan).', 'Short rest cost no reps.'])
    expect(summarizeWeek({ sessionsDone: 0, sessionsPlanned: 2, lifts: [lift('Lift A', [])] }).lines[1]).toBe('No main lift logged this week.')
  })

  it('C3: the sessions line never prints "4 of 3", and with no schedule prints no planned count', () => {
    expect(sessionsLine(4, 3)).toBe('4 sessions done, 3 planned.')
    expect(sessionsLine(3, 3)).toBe('3 of 3 planned sessions done.')
    expect(sessionsLine(1, 1)).toBe('1 of 1 planned session done.')
    expect(sessionsLine(2, null)).toBe('2 sessions done.')
    expect(sessionsLine(1, 0)).toBe('1 session done.')
    expect(summarizeWeek({ sessionsDone: 2, sessionsPlanned: null, lifts: [] })).toMatchObject({ sessionsPlanned: null, lines: ['2 sessions done.', 'No main lift logged this week.', 'No set compared for rest this week.'] })
  })
})

describe('directionOf (the shadow field)', () => {
  it.each([
    [[set(1), set(2), set(3, { reps: 8 })], 'up', 'more_load'],
    [[set(1, { restTimeSec: 40 }), set(2, { reps: 3 }), set(3)], 'held', 'short_rest'],
    [[set(1), set(2, { reps: 0 }), set(3, { reps: 0 })], 'down', 'missed_reps'],
    [MET, 'steady', null],
  ] as const)('%#', (sets, direction, why) => {
    expect(directionOf(readLog(log([...sets]), 2.5))).toEqual({ direction, why })
  })
})
