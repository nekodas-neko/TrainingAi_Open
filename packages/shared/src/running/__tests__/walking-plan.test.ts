/**
 * #3779 — the walking plan's two targets, one test per row and column of the owner's signed tables
 * (proposal of 14 Nov 22:20Z, signed 15 Nov), plus the step back, left-out days, and what marks a
 * day done. Pure: every date is a fixed calendar string on both sides, so nothing here rolls.
 */
import { describe, it, expect } from 'vitest'
import { shiftDateStr, weekStartForDay } from '../../date-utils'
import {
  applyStepBack, dailyMinutesShare, firstJudgedWeek, initialWalkingState, judgeWeek, measureWeek,
  MINUTES_CEILING_PLUS, parseWalkingState, setMinutesCeiling, startingMinutesTarget, startingStepsTarget,
  stepBackOffers, stepsCeiling, walkingDayRationale, walkingDayVerdict, weeksToJudge,
  type WalkingDayMeasure, type WalkingPlanState,
} from '../walking-plan'

const MONDAY = '2026-11-02' // a Monday
const week = (monday: string, f: (i: number) => Partial<WalkingDayMeasure>): WalkingDayMeasure[] =>
  Array.from({ length: 7 }, (_, i) => ({ date: shiftDateStr(monday, i), steps: null, activeMinutes: 0, excluded: null, ...f(i) }))

const state = (over: Partial<WalkingPlanState> = {}): WalkingPlanState => ({
  ...initialWalkingState({
    startDate: MONDAY, ownStepsGoal: null, recentDailySteps: [8000], recentWeeklyMinutes: [90, 90, 90, 90], fallbackStepGoal: 8000,
  }),
  ...over,
})
const noGoal = { ownStepsGoal: null }

describe('steps per day — starts at', () => {
  it('the person\'s own steps goal when one is set, unrounded', () => {
    expect(startingStepsTarget({ ownStepsGoal: 7200, recentDailySteps: [3000, 4000], fallbackGoal: 8000 }))
      .toEqual({ target: 7200, basis: 'own_goal' })
  })
  it('otherwise the median of the last 28 days, rounded up to the next 500', () => {
    expect(startingStepsTarget({ ownStepsGoal: null, recentDailySteps: [6100, 7210, 9000], fallbackGoal: 8000 }))
      .toEqual({ target: 7500, basis: 'median' })
    // An even count takes the mean of the middle two: (6000 + 7001) / 2 = 6500.5 → 7000.
    expect(startingStepsTarget({ ownStepsGoal: null, recentDailySteps: [5000, 6000, 7001, 9000], fallbackGoal: 8000 }).target).toBe(7000)
  })
  it('an exact multiple of 500 stays where it is', () => {
    expect(startingStepsTarget({ ownStepsGoal: null, recentDailySteps: [8000, 8000, 8000], fallbackGoal: 6000 }).target).toBe(8000)
  })
  it('with no goal and no history, the app\'s step goal, rounded the same way', () => {
    expect(startingStepsTarget({ ownStepsGoal: null, recentDailySteps: [], fallbackGoal: 7300 }))
      .toEqual({ target: 7500, basis: 'default' })
  })
  it('never starts above the ceiling', () => {
    expect(startingStepsTarget({ ownStepsGoal: null, recentDailySteps: [15_000], fallbackGoal: 8000 }).target).toBe(12_000)
  })
})

describe('steps per day — ceiling', () => {
  it('is 12,000, or the person\'s own goal if higher', () => {
    expect(stepsCeiling(null)).toBe(12_000)
    expect(stepsCeiling(10_000)).toBe(12_000)
    expect(stepsCeiling(14_000)).toBe(14_000)
  })
})

describe('steps per day — grows by 500 after two weeks in which 5 or more days met it', () => {
  const met5 = (monday: string, target: number) => week(monday, (i) => ({ steps: i < 5 ? target : 1000 }))
  const met4 = (monday: string, target: number) => week(monday, (i) => ({ steps: i < 4 ? target : 1000 }))

  it('one qualifying week does not move it; the second does', () => {
    const s0 = state({ stepsTarget: 8000 })
    const s1 = judgeWeek(s0, MONDAY, met5(MONDAY, 8000), noGoal)
    expect(s1.stepsTarget).toBe(8000)
    expect(s1.stepsStreak).toBe(1)
    const w2 = shiftDateStr(MONDAY, 7)
    const s2 = judgeWeek(s1, w2, met5(w2, 8000), noGoal)
    expect(s2.stepsTarget).toBe(8500)
    expect(s2.stepsStreak).toBe(0)
  })
  it('four days is not a qualifying week, and it breaks the streak', () => {
    const s1 = judgeWeek(state({ stepsTarget: 8000 }), MONDAY, met5(MONDAY, 8000), noGoal)
    const w2 = shiftDateStr(MONDAY, 7)
    const s2 = judgeWeek(s1, w2, met4(w2, 8000), noGoal)
    expect(s2.weeks.at(-1)!.stepsMet).toBe(false)
    expect(s2.stepsTarget).toBe(8000)
    expect(s2.stepsStreak).toBe(0)
  })
  it('stops at 12,000', () => {
    let s = state({ stepsTarget: 11_800 })
    for (let w = 0; w < 4; w++) { const m = shiftDateStr(MONDAY, 7 * w); s = judgeWeek(s, m, met5(m, 12_000), noGoal) }
    expect(s.stepsTarget).toBe(12_000)
  })
  it('a higher own goal is the ceiling instead', () => {
    let s = state({ stepsTarget: 12_000 })
    for (let w = 0; w < 2; w++) { const m = shiftDateStr(MONDAY, 7 * w); s = judgeWeek(s, m, met5(m, 13_000), { ownStepsGoal: 13_000 }) }
    expect(s.stepsTarget).toBe(12_500)
  })
})

describe('active minutes per week — starts at', () => {
  it('the median of the last 4 weeks, rounded up to the next 10', () => {
    // (85 + 90) / 2 = 87.5 → 90
    expect(startingMinutesTarget([40, 85, 90, 120])).toEqual({ target: 90, basis: 'median' })
  })
  it('at least 60', () => {
    expect(startingMinutesTarget([0, 0, 30, 40])).toEqual({ target: 60, basis: 'floor' })
    expect(startingMinutesTarget([])).toEqual({ target: 60, basis: 'floor' })
    expect(startingMinutesTarget([60, 60, 60, 60]).target).toBe(60)
  })
  it('never above the ceiling', () => {
    expect(startingMinutesTarget([200, 210, 220, 230]).target).toBe(150)
    expect(startingMinutesTarget([200, 210, 220, 230], MINUTES_CEILING_PLUS).target).toBe(220)
  })
})

describe('active minutes per week — grows by 15 after any week that met it', () => {
  it('a met week raises it, a missed one does not', () => {
    const s1 = judgeWeek(state({ minutesTarget: 90 }), MONDAY, week(MONDAY, () => ({ activeMinutes: 13 })), noGoal) // 91
    expect(s1.minutesTarget).toBe(105)
    const w2 = shiftDateStr(MONDAY, 7)
    const s2 = judgeWeek(s1, w2, week(w2, () => ({ activeMinutes: 14 })), noGoal) // 98 < 105
    expect(s2.minutesTarget).toBe(105)
  })
  it('stops at 150', () => {
    const s = judgeWeek(state({ minutesTarget: 145 }), MONDAY, week(MONDAY, () => ({ activeMinutes: 30 })), noGoal)
    expect(s.minutesTarget).toBe(150)
    const w2 = shiftDateStr(MONDAY, 7)
    expect(judgeWeek(s, w2, week(w2, () => ({ activeMinutes: 30 })), noGoal).minutesTarget).toBe(150)
  })
  it('"heart health plus" lets it climb to 300', () => {
    const plus = setMinutesCeiling(state({ minutesTarget: 150 }), MINUTES_CEILING_PLUS)
    expect(judgeWeek(plus, MONDAY, week(MONDAY, () => ({ activeMinutes: 30 })), noGoal).minutesTarget).toBe(165)
    const nearTop = setMinutesCeiling(state({ minutesTarget: 295 }), MINUTES_CEILING_PLUS)
    expect(judgeWeek(nearTop, MONDAY, week(MONDAY, () => ({ activeMinutes: 60 })), noGoal).minutesTarget).toBe(300)
  })
  it('lowering the ceiling back to 150 is the person\'s choice and brings the target with it', () => {
    const plus = setMinutesCeiling(state({ minutesTarget: 150 }), MINUTES_CEILING_PLUS)
    expect(setMinutesCeiling({ ...plus, minutesTarget: 210 }, 150).minutesTarget).toBe(150)
  })
})

describe('a target never drops on its own; a step back is offered, never forced', () => {
  const missMinutes = (s: WalkingPlanState, monday: string) => judgeWeek(s, monday, week(monday, () => ({ activeMinutes: 10, steps: 9000 })), noGoal)
  it('two weeks in a row more than 25% short offers the last level met', () => {
    let s = state({ minutesTarget: 120, minutesLastMet: 105 })
    s = missMinutes(s, MONDAY) // 70 < 90
    expect(s.minutesTarget).toBe(120)
    expect(stepBackOffers(s)).toEqual([])
    s = missMinutes(s, shiftDateStr(MONDAY, 7))
    expect(s.minutesTarget).toBe(120)
    expect(stepBackOffers(s)).toEqual([{ target: 'minutes', from: 120, to: 105 }])
    const back = applyStepBack(s, 'minutes')!
    expect(back.minutesTarget).toBe(105)
    expect(stepBackOffers(back)).toEqual([])
  })
  it('a miss of 25% or less is not counted', () => {
    let s = state({ minutesTarget: 120, minutesLastMet: 105 })
    for (let w = 0; w < 3; w++) { const m = shiftDateStr(MONDAY, 7 * w); s = judgeWeek(s, m, week(m, () => ({ activeMinutes: 13 })), noGoal) } // 91 ≥ 90
    expect(stepBackOffers(s)).toEqual([])
  })
  it('nothing is offered when no lower level was ever met', () => {
    let s = state({ minutesTarget: 60, minutesLastMet: null })
    s = missMinutes(missMinutes(s, MONDAY), shiftDateStr(MONDAY, 7))
    expect(stepBackOffers(s)).toEqual([])
    expect(applyStepBack(s, 'minutes')).toBeNull()
  })
  it('steps: a mean under 75% of the target two weeks running', () => {
    let s = state({ stepsTarget: 10_000, stepsLastMet: 9_500 })
    for (let w = 0; w < 2; w++) { const m = shiftDateStr(MONDAY, 7 * w); s = judgeWeek(s, m, week(m, () => ({ steps: 7000, activeMinutes: 30 })), noGoal) }
    expect(s.stepsTarget).toBe(10_000)
    expect(stepBackOffers(s)).toContainEqual({ target: 'steps', from: 10_000, to: 9_500 })
    expect(applyStepBack(s, 'steps')!.stepsTarget).toBe(9_500)
  })
  it('a week with no step reading is not evidence of a miss', () => {
    let s = state({ stepsTarget: 10_000, stepsLastMet: 9_500 })
    for (let w = 0; w < 2; w++) { const m = shiftDateStr(MONDAY, 7 * w); s = judgeWeek(s, m, week(m, () => ({ steps: null })), noGoal) }
    expect(stepBackOffers(s).some((o) => o.target === 'steps')).toBe(false)
  })
})

describe('a rest day or a sick check-in is left out of every count', () => {
  it('a left-out day is never done, and is not in the week\'s minutes or step days', () => {
    expect(walkingDayVerdict({ steps: 20_000, activeMinutes: 60, excluded: 'rest' }, { stepsTarget: 8000, minutesTarget: 150 }).done).toBe(false)
    const days = week(MONDAY, (i) => ({ steps: 9000, activeMinutes: 30, excluded: i === 6 ? 'sick' : null }))
    const r = measureWeek(MONDAY, days, { stepsTarget: 8000, minutesTarget: 150 })
    expect(r.countedDays).toBe(6)
    expect(r.stepDaysMet).toBe(6)
    expect(r.activeMinutes).toBe(180)
  })
  it('a week with every day left out moves nothing and breaks no streak', () => {
    const s1 = state({ stepsTarget: 8000, stepsStreak: 1, minutesTarget: 90, minutesMissStreak: 1 })
    const s2 = judgeWeek(s1, MONDAY, week(MONDAY, () => ({ excluded: 'sick' })), noGoal)
    expect(s2.weeks.at(-1)!.excluded).toBe(true)
    expect([s2.stepsTarget, s2.stepsStreak, s2.minutesTarget, s2.minutesMissStreak]).toEqual([8000, 1, 90, 1])
    expect(s2.nextWeekToJudge).toBe(shiftDateStr(MONDAY, 7))
  })
})

describe('a day is done when either target\'s daily share is met', () => {
  const t = { stepsTarget: 8000, minutesTarget: 150 }
  it('the day\'s share of the week is one-seventh, in whole minutes', () => {
    expect(dailyMinutesShare(150)).toBe(22)
    expect(dailyMinutesShare(60)).toBe(9)
    expect(dailyMinutesShare(140)).toBe(20)
  })
  it('steps alone', () => {
    expect(walkingDayVerdict({ steps: 8000, activeMinutes: 0, excluded: null }, t)).toEqual({ stepsMet: true, minutesMet: false, done: true })
  })
  it('minutes alone', () => {
    expect(walkingDayVerdict({ steps: 2000, activeMinutes: 22, excluded: null }, t)).toEqual({ stepsMet: false, minutesMet: true, done: true })
  })
  it('neither', () => {
    expect(walkingDayVerdict({ steps: 7999, activeMinutes: 21, excluded: null }, t).done).toBe(false)
    expect(walkingDayVerdict({ steps: null, activeMinutes: 0, excluded: null }, t).done).toBe(false)
  })
  it('the stored rationale says both ways, without a locale', () => {
    expect(walkingDayRationale(22, 12_500)).toBe('A brisk walk of 22 minutes, or 12,500 steps across the day. Either one marks the day done.')
  })
})

describe('when weeks are judged', () => {
  it('the first judged week is the plan\'s own Monday, or the next Monday after a mid-week start', () => {
    expect(firstJudgedWeek(MONDAY)).toBe(MONDAY)
    expect(firstJudgedWeek('2026-11-05')).toBe('2026-11-09') // a Thursday
    expect(firstJudgedWeek('2026-11-08')).toBe('2026-11-09') // a Sunday
  })
  it('only weeks that have ended, oldest first', () => {
    const s = state({ nextWeekToJudge: MONDAY })
    expect(weeksToJudge(s, shiftDateStr(MONDAY, 6))).toEqual([]) // still that Sunday
    expect(weeksToJudge(s, shiftDateStr(MONDAY, 7))).toEqual([MONDAY]) // the next Monday
    expect(weeksToJudge(s, shiftDateStr(MONDAY, 16))).toEqual([MONDAY, shiftDateStr(MONDAY, 7)])
  })
  it('weeks are Monday to Sunday', () => {
    expect(weekStartForDay('2026-11-08')).toBe('2026-11-02')
    expect(weekStartForDay('2026-11-09')).toBe('2026-11-09')
  })
  it('keeps the levels in force on each judged week\'s record', () => {
    const s = judgeWeek(state({ stepsTarget: 8000, minutesTarget: 90 }), MONDAY, week(MONDAY, () => ({ activeMinutes: 20 })), noGoal)
    expect(s.weeks.at(-1)).toMatchObject({ weekStart: MONDAY, stepsTarget: 8000, minutesTarget: 90, minutesMet: true })
    expect(s.minutesTarget).toBe(105)
  })
})

describe('stored state', () => {
  it('round-trips, and anything else is rebuilt rather than trusted', () => {
    const s = state()
    expect(parseWalkingState(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(parseWalkingState(null)).toBeNull()
    expect(parseWalkingState({ ...s, version: 2 })).toBeNull()
    expect(parseWalkingState({ ...s, minutesCeiling: 200 })).toBeNull()
    expect(parseWalkingState({ ...s, stepsTarget: '9000' })).toBeNull()
  })
})
