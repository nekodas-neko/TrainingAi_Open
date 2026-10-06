// PS-49 — collection rules v2: a draining bank feeding the same named-cat fold, and the Tank's
// 5·4·5·3·3 ladder. The owner's own worked examples are the cases.
import { describe, it, expect } from 'vitest'
import {
  replayBankCollection, replayCollection, V2_LADDERS,
  STEPS_UNITS_PER_T1, STEPS_DRAIN_PER_DAY, HEALTH_POINTS_PER_T1, HEALTH_DRAIN_PER_DAY,
  CARDIO_UNITS_PER_SESSION, CARDIO_UNITS_PER_T1, CARDIO_DRAIN_PER_DAY,
} from '../ladder'
import { shiftDateStr } from '../../date-utils'

const START = '2026-01-01'
const days = (n: number) => Array.from({ length: n }, (_, i) => shiftDateStr(START, i))
const steps = (perDay: number[], today = shiftDateStr(START, perDay.length - 1)) =>
  replayBankCollection({
    gains: new Map(perDay.map((v, i) => [shiftDateStr(START, i), v])), ladder: V2_LADDERS.steps,
    unitsPerT1: STEPS_UNITS_PER_T1, drainPerDay: STEPS_DRAIN_PER_DAY, today,
  })

describe('the Ranger bank (PS-49)', () => {
  it('is the owner\'s numbers: 5,000 steps per T1, 1,000 drained a day', () => {
    expect([STEPS_UNITS_PER_T1, STEPS_DRAIN_PER_DAY]).toEqual([5000, 1000])
  })

  it('"5000 steps in the day is an effective 4000 profit"', () => {
    expect(steps([5000, 5000, 5000]).bank! - steps([5000, 5000]).bank!).toBe(4000)
  })

  it("takes the drain from what was carried in, so a day's own steps land whole (#2085)", () => {
    // Draining after the gain banked 4,000 here and showed no cat for a 5,000-step first day.
    const s = steps([5000])
    expect(s.bank).toBe(5000)
    expect(s.stock[0]).toBe(1)
  })

  it('holds the base-3 digits of the T1 count: 3 → 1 at every tier', () => {
    // 20 days at 6,000 steps: 6,000 then +5,000 net a day = 101,000, so 20 T1 = 2·9 + 0·3 + 2.
    const s = steps(new Array(20).fill(6000))
    expect(s.stock.slice(0, 3)).toEqual([2, 0, 2])
  })

  it('always drains, so an idle stretch breaks cats back down, smallest first', () => {
    const grown = steps(new Array(9).fill(6000))                         // 46,000: 9 T1 → one T3
    expect(grown.stock.slice(0, 3)).toEqual([0, 0, 1])
    const idle = steps([...new Array(9).fill(6000), 0, 0, 0, 0, 0, 0, 0]) // −7,000 over seven idle days
    expect(idle.stock.slice(0, 3)).toEqual([1, 2, 0])                     // 7 T1 left: a T3 split
    expect(idle.decayEvents).toBe(2)
    expect(idle.lastLost?.name).toBeTruthy()
  })

  it('never goes below zero, and the drain runs on to today after the last step day', () => {
    const s = steps([6000], shiftDateStr(START, 30))
    expect(s.bank).toBe(0)
    expect(s.stock.every(n => n === 0)).toBe(true)
  })

  it('keeps each cat\'s name and lineage through a merge', () => {
    const s = steps(new Array(3).fill(6000))
    const [top] = s.cats!
    expect(top.tier).toBe(1)
    expect(top.from).toHaveLength(3)
  })

  it('says a day without steps tomorrow would cost a cat', () => {
    expect(steps([4500]).restless).toBe(false) // bank 4,500 holds no cat yet: nothing to lose
    expect(steps([5000, 5000]).restless).toBe(false) // bank 9,000 → 8,000 tomorrow, still 1
    expect(steps([5000]).restless).toBe(true) // bank 5,000 → 4,000 tomorrow drops the one T1
  })
})

describe('the Health cat bank (PS-49)', () => {
  const run = (points: number[]) => replayBankCollection({
    gains: new Map(points.map((p, i) => [shiftDateStr(START, i), p])), ladder: V2_LADDERS.health,
    unitsPerT1: HEALTH_POINTS_PER_T1, drainPerDay: HEALTH_DRAIN_PER_DAY, today: shiftDateStr(START, points.length - 1),
  })

  it('a fully logged day is one T1, from the first day', () => {
    expect(run([3]).stock[0]).toBe(1)
    expect(run([3, 3, 3]).bank).toBe(7)
  })

  it('two of three a day gains a point a day', () => {
    expect(run([3, 2, 2, 2]).bank).toBe(run([3]).bank! + 3)
  })
})

describe('the Rogue bank (#2085)', () => {
  /** Sessions per day, starting `START`; the replay runs to the last listed day unless told otherwise. */
  const rogue = (sessions: number[], today = shiftDateStr(START, sessions.length - 1)) =>
    replayBankCollection({
      gains: new Map(sessions.flatMap((n, i) => n > 0 ? [[shiftDateStr(START, i), n * CARDIO_UNITS_PER_SESSION] as const] : [])),
      ladder: V2_LADDERS.cardio, unitsPerT1: CARDIO_UNITS_PER_T1, drainPerDay: CARDIO_DRAIN_PER_DAY, today,
    })
  /** `weeks` weeks of `perWeek` sessions, spread from the start of each week. */
  const weekly = (perWeek: number, weeks: number) =>
    Array.from({ length: weeks * 7 }, (_, d) => ([0, 3, 5].slice(0, perWeek).includes(d % 7) ? 1 : 0))

  it("is the owner's provisional numbers: 1 session = 1 T1, ⅕ of a session drained a day", () => {
    expect(CARDIO_UNITS_PER_T1 / CARDIO_UNITS_PER_SESSION).toBe(1)
    expect(CARDIO_DRAIN_PER_DAY / CARDIO_UNITS_PER_SESSION).toBe(0.2)
  })

  it('pays a first session its cat on the day', () => {
    const s = rogue([1])
    expect(s.stock[0]).toBe(1)
    expect(s.cats?.[0].name).toBeTruthy()
  })

  it('counts sessions, not days: three in a day merge into a T2', () => {
    expect(rogue([2]).stock[0]).toBe(2)
    expect(rogue([3]).stock.slice(0, 2)).toEqual([0, 1])
  })

  it("drains ⅕ a day, so a lone session's cat leaves the next day and its fifths run out after five", () => {
    const next = rogue([1, 0])
    expect(next.bank).toBe(4)
    expect(next.stock[0]).toBe(0)
    expect(next.decayEvents).toBe(1)
    expect(rogue([1], shiftDateStr(START, 5)).bank).toBe(0)
  })

  it('grows at two sessions a week, and faster at three', () => {
    // 7 fifths drained a week against 10 or 15 earned: +3 or +8 a week.
    const two = rogue(weekly(2, 8))
    const three = rogue(weekly(3, 8))
    expect(two.bank).toBeGreaterThan(0)
    expect(three.bank!).toBeGreaterThan(two.bank!)
  })
})

describe('the Tank ladder (PS-49)', () => {
  it('costs 5 · 4 · 5 · 3 · 3: 100 sessions is the big tier', () => {
    const cost = V2_LADDERS.workout.tiers.slice(1).map(t => t.mergeCost)
    expect(cost).toEqual([5, 4, 5, 3, 3])
    const s = replayCollection({ days: days(100), ladder: V2_LADDERS.workout, maxRestGap: 2, today: shiftDateStr(START, 99) })
    expect(s.stock).toEqual([0, 0, 0, 1, 0, 0])
  })

  it('110 unbroken sessions is one T4 and two T2 (the owner\'s streak, counted in sessions)', () => {
    const s = replayCollection({ days: days(110), ladder: V2_LADDERS.workout, maxRestGap: 2, today: shiftDateStr(START, 109) })
    expect(s.stock).toEqual([0, 2, 0, 1, 0, 0])
  })
})
