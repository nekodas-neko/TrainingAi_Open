import { describe, it, expect } from 'vitest'
import { replayCollection, LADDERS, type Ladder } from '../ladder'
import { shiftDateStr } from '@trainingai/shared/date-utils'

// BF-122a. The owner's rules, in their words: "1 workout = 1 slime … if you collect x amount, they
// merge into a bigger one … a big item gets broken down into its smaller ones … if you had 1 big and
// 1 small when the decay happens it would take the small first".
//
// Every test below is one of those sentences.
const L: Ladder = { faucet: 'workout', tiers: [
  { name: 'slime', mergeCost: 0 },
  { name: 'scout', mergeCost: 5 },
  { name: 'tank',  mergeCost: 4 },
] }

/** Consecutive days from a start, so a run never decays whatever the allowance is. */
function run(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDateStr(from, i))
}
const replay = (days: string[], today: string, maxRestGap = 1, pausedDays?: string[]) =>
  replayCollection({ days, ladder: L, maxRestGap, today, pausedDays })

describe('spawning and merging', () => {
  it('one day is one slime', () => {
    expect(replay(['2026-09-01'], '2026-09-01').stock).toEqual([1, 0, 0])
  })

  it('five slimes become one scout', () => {
    expect(replay(run('2026-09-01', 5), '2026-09-05').stock).toEqual([0, 1, 0])
  })

  it('leaves the remainder loose', () => {
    expect(replay(run('2026-09-01', 7), '2026-09-07').stock).toEqual([2, 1, 0])
  })

  // The fixed-point loop. Twenty days is four scouts is one tank — and the tank must appear in the
  // same step, not wait for the next spawn to trigger a second pass.
  it('merges all the way up in one settle', () => {
    expect(replay(run('2026-09-01', 20), '2026-09-20').stock).toEqual([0, 0, 1])
  })

  it('counts a day once however many times it is listed', () => {
    const r = replay(['2026-09-01', '2026-09-01', '2026-09-01'], '2026-09-01')
    expect(r.stock).toEqual([1, 0, 0])
    expect(r.duplicateDays).toBe(2)
  })

  it('does not care what order the days arrive in', () => {
    const ordered = replay(run('2026-09-01', 5), '2026-09-05').stock
    const shuffled = replay([...run('2026-09-01', 5)].reverse(), '2026-09-05').stock
    expect(shuffled).toEqual(ordered)
  })
})

describe('decay', () => {
  it('does not fire inside the allowance', () => {
    // Two days apart is one rest day, which a maxRestGap of 1 permits.
    const r = replay(['2026-09-01', '2026-09-03'], '2026-09-03')
    expect(r.decayEvents).toBe(0)
    expect(r.stock).toEqual([2, 0, 0])
  })

  it('fires once per day beyond it', () => {
    // 01 → 05 is three rest days; one is allowed, so two decays.
    const r = replay([...run('2026-09-01', 4), '2026-09-08'], '2026-09-08')
    expect(r.decayEvents).toBe(2)
  })

  // THE rule, and the one that is easiest to write a test that does not actually check it.
  //
  // Six days is one scout plus one loose slime, and the gap must be TRAILING: a spawn after the
  // decay re-merges what was broken apart, so smallest-first and largest-first both land on
  // [1, 1, 0] and the assertion passes either way. Verified by mutation — with a following spawn,
  // reversing the rule failed nothing.
  it('takes the smallest item first, leaving the merged one intact', () => {
    const r = replay(run('2026-09-01', 6), '2026-09-09')
    // The loose slime went; the scout is untouched. Taking the scout instead would have broken it
    // into five slimes and left [5, 0, 0] — the same stock by a different route, and a lie about
    // what the user lost.
    expect(r.stock).toEqual([0, 1, 0])
    expect(r.decayEvents).toBe(1)
  })

  // The other rule. A big item breaks down; it is never deleted.
  it('breaks a bigger item down rather than deleting it', () => {
    // Exactly one scout and nothing loose, then a TRAILING gap costing one decay — trailing so no
    // spawn follows to re-merge what the decay just broke apart, which would hide the effect.
    const r = replay(run('2026-09-01', 5), '2026-09-08')
    // The scout became its five slimes and one was taken. Losing the scout cost the MERGE, not the
    // five workouts underneath it — four are still there to rebuild from.
    expect(r.stock).toEqual([4, 0, 0])
    expect(r.decayEvents).toBe(1)
  })

  it('stops counting events once there is nothing left to lose', () => {
    const r = replay(['2026-09-01'], '2026-09-30')
    expect(r.stock).toEqual([0, 0, 0])
    // 28 chargeable days over the allowance, but only one item ever existed.
    expect(r.decayEvents).toBe(1)
  })

  // The trailing gap counts. Otherwise the collection only shrinks when you come back, which is
  // the wrong moment to tell someone they lost something.
  it('charges the gap between the last faucet day and today', () => {
    const r = replay(run('2026-09-01', 5), '2026-09-10')
    expect(r.decayEvents).toBeGreaterThan(0)
  })
})

describe('a rest day the app itself recommended', () => {
  // Trap 1 from the entry: deload and recommended rest days are compliance, not neglect.
  it('does not decay a paused day', () => {
    // Five days of stock first, so the comparison is not floored by an empty collection — a decay
    // that cannot happen is not counted, and that would make both sides read 1 for the wrong reason.
    const days = [...run('2026-09-01', 5), '2026-09-09']
    const withPause = replay(days, '2026-09-09', 1, ['2026-09-06', '2026-09-07'])
    expect(withPause.decayEvents).toBe(0)

    // Same gap, nothing excused: 09-05 → 09-09 is three rest days, one allowed, two decays.
    expect(replay(days, '2026-09-09').decayEvents).toBe(2)
  })
})

describe('the shipped ladders', () => {
  it('all three start at a slime and top out at a named cat', () => {
    for (const l of Object.values(LADDERS)) {
      expect(l.tiers[0].mergeCost).toBe(0)
      expect(l.tiers.length).toBeGreaterThanOrEqual(2)
      expect(l.tiers.at(-1)!.name).toMatch(/^cat /)
    }
  })

  // Steps and sleep are the calm half by construction — a near-gapless faucet cannot decay.
  it('a gapless year on the steps ladder never decays', () => {
    const r = replayCollection({
      days: run('2026-01-01', 365), ladder: LADDERS.steps, maxRestGap: 2, today: '2026-12-31',
    })
    expect(r.decayEvents).toBe(0)
  })
})
