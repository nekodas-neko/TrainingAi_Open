// Issue 2189. Scene titles are derived from each ladder's high-water mark, never stored:
//   · `reached` records the first day each tier was held, and decay never lowers it;
//   · the owner's mapping (forest ← first Ranger T4, house ← first Health-cat T3, castle ← first
//     Tank T4) reads that mark;
//   · a title names its tier by number, so a ladder without that tier earns nothing rather than
//     throwing — the mapping survives a tier-count change.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '../../date-utils'
import {
  replayBankCollection, replayCollection, V2_LADDERS,
  HEALTH_POINTS_PER_T1, HEALTH_DRAIN_PER_DAY,
} from '../ladder'
import { collectionTitles, unlockedScenes, SCENE_TITLE_RULES } from '../titles'

const START = '2026-01-01'
const day = (n: number) => shiftDateStr(START, n)

describe('the replay\'s high-water mark', () => {
  it('records the first day each tier was held and keeps it after decay', () => {
    // 40 fully logged health days (3 points against a drain of 1, so the bank nets 2 a day), then 80
    // empty days that drain everything back to nothing.
    const gains = new Map(Array.from({ length: 40 }, (_, i) => [day(i), HEALTH_POINTS_PER_T1] as [string, number]))
    const s = replayBankCollection({
      gains, ladder: V2_LADDERS.health, unitsPerT1: HEALTH_POINTS_PER_T1,
      drainPerDay: HEALTH_DRAIN_PER_DAY, today: day(120),
    })
    expect(s.stock.every(n => n === 0)).toBe(true)
    expect(s.reached?.slice(0, 4)).toEqual([day(0), day(3), day(12), day(39)])
    expect(s.reached?.[4]).toBeNull()
  })

  it('is reported by the workout ladder too', () => {
    const s = replayCollection({
      days: Array.from({ length: 5 }, (_, i) => day(i)), ladder: V2_LADDERS.workout, maxRestGap: 2, today: day(5),
    })
    expect(s.reached?.slice(0, 3)).toEqual([day(0), day(4), null])
  })
})

describe('collectionTitles', () => {
  const none = { reached: [null, null, null, null, null, null] }

  it('maps the owner\'s three scenes to their ladders and tiers', () => {
    expect(SCENE_TITLE_RULES.map(r => `${r.scene}:${r.faucet}:T${r.tier}`))
      .toEqual(['forest:steps:T4', 'house:health:T3', 'castle:workout:T4'])
  })

  it('earns a title from the high-water mark, named by the ladder\'s own tier', () => {
    const titles = collectionTitles({
      steps: none,
      health: { reached: ['2026-01-01', '2026-01-03', '2026-01-09', null, null, null] },
      workout: none,
    })
    const house = titles.find(t => t.scene === 'house')!
    expect(house).toMatchObject({ earned: true, earnedOn: '2026-01-09', title: 'First Health cat III' })
    expect(titles.find(t => t.scene === 'forest')).toMatchObject({ earned: false, earnedOn: null, title: 'First Ranger IV' })
    expect(unlockedScenes(titles)).toEqual(['meadow', 'house'])
  })

  it('earns nothing for a tier the ladder no longer has, without throwing', () => {
    const short = { ...V2_LADDERS, workout: { faucet: 'workout' as const, tiers: V2_LADDERS.workout.tiers.slice(0, 3) } }
    const titles = collectionTitles({ workout: { reached: ['a', 'b', 'c'] } }, short)
    expect(titles.find(t => t.scene === 'castle')).toMatchObject({ earned: false, earnedOn: null })
  })

  it('earns nothing from a collection with no replay at all', () => {
    expect(unlockedScenes(collectionTitles({}))).toEqual(['meadow'])
  })
})
