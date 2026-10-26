import { describe, it, expect } from 'vitest'
import {
  V2_LADDERS, STEPS_UNITS_PER_T1, replayCollection, replayBankCollection,
  STEPS_DRAIN_PER_DAY, type CollectionState,
} from '../ladder'
import {
  ROSTER_SHOWN, cardDecayLine, decayLine, heldLabel, madeFrom, mergeLine, nextMerge, restlessLine,
  rosterDetail, shortDay, totalHeld,
} from '../summary'
import {
  BAND, FLYING_FROM_TIER, SIZE, penCatMotion, penCats, shownForWidth, slotOf, tagsForWidth,
} from '../pen'
import { collectionRowName, collectionRuleCaptions, collectionRules } from '../rules'
import { shiftDateStr } from '../../date-utils'

const today = '2026-10-20'
const run = (count: number, end = today) => Array.from({ length: count }, (_, i) => shiftDateStr(end, -(count - 1 - i)))

describe('roster and card lines', () => {
  it('reads a day string as the calendar day it already is', () => {
    expect(shortDay('2026-09-05')).toBe('5 Sep')
    expect(shortDay('2026-12-31')).toBe('31 Dec')
  })
  it('names up to three parents and counts the rest', () => {
    expect(madeFrom([])).toBe('')
    expect(madeFrom(['Pip', 'Mo'])).toBe('from Pip, Mo')
    expect(madeFrom(['A', 'B', 'C', 'D', 'E'])).toBe('from A, B, C +2')
  })
  it('puts the arrival day first and the parents after it', () => {
    expect(rosterDetail({ born: '2026-09-05', from: [] })).toBe('5 Sep')
    expect(rosterDetail({ born: '2026-09-05', from: ['Pip', 'Mo'] })).toBe('5 Sep · from Pip, Mo')
  })
  it('says nothing about decay until something has wandered off, and counts them once it has', () => {
    expect(decayLine(0)).toBeNull()
    expect(cardDecayLine(0)).toBeNull()
    expect(decayLine(1)).toBe('One has wandered off during long gaps.')
    expect(decayLine(4)).toBe('4 have wandered off during long gaps.')
    expect(cardDecayLine(1)).toBe('One has wandered off over long gaps — the days underneath them still count.')
    expect(cardDecayLine(2)).toBe('2 have wandered off over long gaps — the days underneath them still count.')
  })
  it('says 1 held, then N held', () => {
    expect([0, 1, 2].map(heldLabel)).toEqual(['0 held', '1 held', '2 held'])
    expect(ROSTER_SHOWN).toBe(20)
  })
})

describe('decay and merging, replayed from history', () => {
  const ladder = V2_LADDERS.workout
  it('merges when enough of a tier are held, and the held cats are exactly the named ones', () => {
    const state = replayCollection({ days: run(12), ladder, maxRestGap: 2, pausedDays: [], today })
    expect(state.cats?.length).toBe(totalHeld(state))
    const bottomMerge = ladder.tiers[1].mergeCost
    expect(state.stock[0]).toBeLessThan(bottomMerge)
    expect(state.stock.slice(1).some(n => n > 0)).toBe(true)
  })
  it('loses the smallest cat first after a gap longer than the allowance, and breaks a big one down', () => {
    const trained = run(20, shiftDateStr(today, -30))
    const kept = replayCollection({ days: trained, ladder, maxRestGap: 2, pausedDays: [], today: trained.at(-1)! })
    const gap = replayCollection({ days: trained, ladder, maxRestGap: 2, pausedDays: [], today })
    expect(gap.decayEvents).toBeGreaterThan(0)
    expect(totalHeld(gap)).toBeLessThan(totalHeld(kept))
    expect(gap.lastLost?.name).toBeTruthy()
  })
  it('does not decay on days the schedule or the app asked for rest', () => {
    const trained = run(10, shiftDateStr(today, -6))
    const gapDays = run(6, today)
    const unpaused = replayCollection({ days: trained, ladder, maxRestGap: 1, pausedDays: [], today })
    const paused = replayCollection({ days: trained, ladder, maxRestGap: 1, pausedDays: gapDays, today })
    expect(paused.decayEvents).toBeLessThanOrEqual(unpaused.decayEvents)
  })
  it('flags the day before a cat would leave, and names the one that would', () => {
    const trained = run(15, shiftDateStr(today, -3))
    const state = replayCollection({ days: trained, ladder, maxRestGap: 2, pausedDays: [], today })
    const line = restlessLine({ workout: { ...state, restless: true } })
    expect(line).toMatch(/ is getting restless — train today to keep everyone\.$/)
  })
  it('turns a bank into tier I cats at the unit cost and drains it daily', () => {
    const gains = new Map(run(10).map(d => [d, STEPS_UNITS_PER_T1 + STEPS_DRAIN_PER_DAY]))
    const state = replayBankCollection({
      gains, ladder: V2_LADDERS.steps, unitsPerT1: STEPS_UNITS_PER_T1, drainPerDay: STEPS_DRAIN_PER_DAY, today,
    })
    expect(totalHeld(state)).toBeGreaterThan(0)
    const idle = replayBankCollection({
      gains: new Map(), ladder: V2_LADDERS.steps, unitsPerT1: STEPS_UNITS_PER_T1, drainPerDay: STEPS_DRAIN_PER_DAY, today,
    })
    expect(totalHeld(idle)).toBe(0)
  })
  it('counts a merge in the faucet days that still have to be earned, and stops at a rung at its cost', () => {
    const empty: CollectionState = { stock: [0, 0, 0, 0, 0, 0], duplicateDays: 0, decayEvents: 0 }
    const first = nextMerge(empty, ladder)!
    expect(first.fromTier).toBe(0)
    expect(mergeLine(first)).toMatch(/^\d+ more workouts? for a /)
    const atCost = { ...empty, stock: ladder.tiers.map((_, i) => ladder.tiers[i + 1]?.mergeCost ?? 0) }
    expect(nextMerge(atCost, ladder)).toBeNull()
  })
})

describe('the pen', () => {
  const cat = (id: string, tier: number) => ({ id, faucet: 'workout' as const, tier })
  it('walks each cat the same way every time, from its identity alone', () => {
    expect(penCatMotion(cat('a', 2), 3, 8)).toEqual(penCatMotion(cat('a', 2), 3, 8))
    expect(penCatMotion(cat('a', 2), 3, 8)).not.toEqual(penCatMotion(cat('b', 2), 3, 8))
  })
  it('keeps every cat inside the pen, in its tier\'s band, with the top tiers in the air', () => {
    for (let tier = 0; tier < 6; tier++) {
      for (const id of ['x', 'yy', 'zzz', 'cat-9']) {
        const m = penCatMotion(cat(id, tier), 1, 5)
        expect(m.from).toBeGreaterThanOrEqual(0)
        expect(m.to).toBeLessThanOrEqual(1)
        expect(m.size).toBe(SIZE[tier])
        expect(m.y0).toBeGreaterThanOrEqual(BAND[tier][0])
        expect(m.y1).toBeLessThanOrEqual(BAND[tier][1])
        expect(m.flying).toBe(tier >= FLYING_FROM_TIER)
        expect(m.offset).toBeGreaterThanOrEqual(0)
        expect(m.offset).toBeLessThan(m.dur)
        expect(m.dur).toBeGreaterThanOrEqual(10)
        expect(m.dur).toBeLessThanOrEqual(19)
      }
    }
  })
  it('draws smaller tiers over the ones behind them', () => {
    expect(penCatMotion(cat('a', 0), 0, 1).zIndex).toBeGreaterThan(penCatMotion(cat('a', 5), 0, 1).zIndex)
  })
  it('hands every slot out once, so the pen fills edge to edge', () => {
    for (let n = 1; n <= 12; n++) {
      expect([...Array(n).keys()].map(i => slotOf(i, n)).sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    }
  })
  it('draws as many cats as the width fits, spread across tiers, rarest first', () => {
    expect(shownForWidth(100)).toBe(3)
    expect(shownForWidth(348)).toBe(6)
    expect(shownForWidth(2000)).toBe(12)
    expect(tagsForWidth(348)).toBe(3)
    expect(tagsForWidth(10)).toBe(1)
    const state: CollectionState = { stock: [8, 0, 0, 0, 0, 3], duplicateDays: 0, decayEvents: 0 }
    const { shown, total } = penCats({ workout: state }, 4)
    expect(total).toBe(11)
    expect(shown.map(c => c.tier)).toEqual([5, 0, 5, 0])
  })
})

describe('how this works', () => {
  const paragraphs = collectionRules()
  const text = paragraphs.map(p => p.map(s => s.text).join(''))
  it('has the seven paragraphs, each starting with its bold lead', () => {
    expect(paragraphs).toHaveLength(7)
    expect(paragraphs.every(p => p[0].style === 'lead')).toBe(true)
    expect(text[0]).toMatch(/^Four rows, 6 tiers each\. Every workout you do gives the Tank row a /)
  })
  it('reads its numbers from the engine\'s constants, not from typed-out copies', () => {
    expect(text[2]).toContain(`${STEPS_UNITS_PER_T1.toLocaleString('en-AU')} steps in a day`)
    expect(text[2]).toContain(`banks ${(STEPS_UNITS_PER_T1 - STEPS_DRAIN_PER_DAY).toLocaleString('en-AU')} net`)
    expect(text[1]).toContain(V2_LADDERS.workout.tiers.slice(1).map(t => t.mergeCost).join(' · '))
  })
  it('sets "your schedule" apart in the last paragraph and says the days underneath still count', () => {
    expect(paragraphs[6].find(s => s.style === 'em')?.text).toBe('your schedule')
    expect(text[5]).toMatch(/The days underneath still count\.$/)
    expect(text[4]).toMatch(/provisional and may be retuned\.$/)
  })
})

describe('the four rule captions under the diagrams', () => {
  const captions = collectionRuleCaptions()
  it('has four, each with a lead and a sentence', () => {
    expect(captions).toHaveLength(4)
    expect(captions.every(c => c.lead.length > 0 && c.text.startsWith(' '))).toBe(true)
  })
  it('reads its names and costs from the ladders', () => {
    const tank = collectionRowName('workout')
    expect(captions[0].text).toContain(`gives the ${tank} row a ${V2_LADDERS.workout.tiers[0].name}`)
    expect(captions[1].lead).toBe(`${V2_LADDERS.steps.tiers[1].mergeCost} make one.`)
    expect(captions[1].text).toContain(V2_LADDERS.workout.tiers.slice(1).map(t => t.mergeCost).join(' · '))
    expect(captions[3].text).toContain(`The ${tank} row's allowance`)
  })
  it('names the three bank rows once each', () => {
    const banks = (['steps', 'health', 'cardio'] as const).map(collectionRowName)
    for (const name of banks) expect(captions[0].text).toContain(name)
  })
})
