// PS-49 — collection rules v2: a draining bank feeding the same named-cat fold, and the Tank's
// 5·4·5·3·3 ladder. The owner's own worked examples are the cases.
import { describe, it, expect } from 'vitest'
import {
  replayBankCollection, replayCollection, V2_LADDERS,
  STEPS_UNITS_PER_T1, STEPS_DRAIN_PER_DAY, HEALTH_POINTS_PER_T1, HEALTH_DRAIN_PER_DAY,
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
    const s = steps([5000, 5000])
    expect(s.bank).toBe(8000)
    expect(s.stock[0]).toBe(1)
  })

  it('holds the base-3 digits of the T1 count: 3 → 1 at every tier', () => {
    // 20 days at 6,000 steps: +5,000 net a day, so 20 T1 = 2·9 + 0·3 + 2 → T3:2, T2:0, T1:2.
    const s = steps(new Array(20).fill(6000))
    expect(s.stock.slice(0, 3)).toEqual([2, 0, 2])
  })

  it('always drains, so an idle stretch breaks cats back down, smallest first', () => {
    const grown = steps(new Array(9).fill(6000))                      // 9 T1 → one T3
    expect(grown.stock.slice(0, 3)).toEqual([0, 0, 1])
    const idle = steps([...new Array(9).fill(6000), 0, 0, 0, 0, 0, 0]) // −6,000 over six idle days
    expect(idle.stock.slice(0, 3)).toEqual([1, 2, 0])                  // 7 T1 left: a T3 split
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
    expect(steps([5500]).restless).toBe(false) // bank 4,500 holds no cat yet: nothing to lose
    expect(steps([5000, 5000]).restless).toBe(false) // bank 8,000 → 7,000 tomorrow, still 1
    expect(steps([6000]).restless).toBe(true) // bank 5,000 → 4,000 tomorrow drops the one T1
  })
})

describe('the Health cat bank (PS-49)', () => {
  it('a fully logged day is one T1, and two of three a day holds level', () => {
    const run = (points: number[]) => replayBankCollection({
      gains: new Map(points.map((p, i) => [shiftDateStr(START, i), p])), ladder: V2_LADDERS.health,
      unitsPerT1: HEALTH_POINTS_PER_T1, drainPerDay: HEALTH_DRAIN_PER_DAY, today: shiftDateStr(START, points.length - 1),
    })
    expect(run([3, 3, 3]).bank).toBe(6)
    expect(run([3, 2, 2, 2]).bank).toBe(run([3]).bank! + 3)
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
