import { describe, it, expect } from 'vitest'
import { replayCollection, LADDERS } from '../ladder'
import { blendName, spawnName } from '../names'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const run = (start: string, n: number) => Array.from({ length: n }, (_, i) => shiftDateStr(start, i))
const workout = (days: string[], today: string, maxRestGap = 1) =>
  replayCollection({ days, ladder: LADDERS.workout, maxRestGap, today })

describe('cat names', () => {
  it('are a function of identity, so every replay names the same cat the same thing', () => {
    const a = workout(run('2026-09-01', 3), '2026-09-03').cats!.map(c => c.name)
    const b = workout(run('2026-09-01', 3), '2026-09-03').cats!.map(c => c.name)
    expect(a).toEqual(b)
    expect(spawnName('workout-2026-09-01')).toBe(spawnName('workout-2026-09-01'))
  })

  it('blend the oldest part\'s opening with the newest part\'s ending', () => {
    expect(blendName('Pudding', 'Waffle')).toBe('Puffle')
    expect(blendName('Mochi', 'Biscuit')).toBe('Moscuit')
  })

  it('never blend into one of the two parent names', () => {
    expect(blendName('Mochi', 'Mochi')).not.toBe('Mochi')
  })
})

describe('the lineage fold', () => {
  it('holds exactly the cats the counts say it does, across a long ragged history', () => {
    const days = [...run('2026-03-01', 40), ...run('2026-04-20', 12), ...run('2026-06-01', 70)]
    const s = workout(days, '2026-09-20', 2)
    s.stock.forEach((n, tier) => expect(s.cats!.filter(c => c.tier === tier)).toHaveLength(n))
  })

  it('names a merged cat from its parts and remembers who they were', () => {
    const s = workout(run('2026-09-01', 5), '2026-09-05')
    expect(s.stock).toEqual([0, 1, 0])
    const scout = s.cats![0]
    expect(scout.from).toHaveLength(5)
    expect(scout.name).toBe(blendName(scout.from[0], scout.from[4]))
    expect(scout.born).toBe('2026-09-05')
  })

  it('breaks a merged cat back into the SAME cats, names intact, and loses the newest', () => {
    const days = run('2026-09-01', 5)
    const before = workout(days, '2026-09-05').cats![0].from
    // Last workout 09-05, allowance 1: 09-06 is fine, 09-07 is one day past it.
    const after = workout(days, '2026-09-08')
    expect(after.stock).toEqual([4, 0, 0])
    expect(after.cats!.map(c => c.name)).toEqual(before.slice(0, 4))
    expect(after.lastLost).toEqual({ name: before[4], day: '2026-09-07' })
  })

  it('is restless only when skipping today would cost a cat', () => {
    // Trained 09-01. Allowance 1 rest day. Today 09-02: skipping it leaves one rest day, which is fine.
    expect(workout(['2026-09-01'], '2026-09-02').restless).toBe(false)
    // Today 09-03: 09-02 was the allowed rest day; skipping today makes two.
    expect(workout(['2026-09-01'], '2026-09-03').restless).toBe(true)
  })

  it('does not count a paused day against the allowance when naming the day a cat left', () => {
    const s = replayCollection({
      days: ['2026-09-01', '2026-09-02'], ladder: LADDERS.workout, maxRestGap: 1,
      pausedDays: ['2026-09-04'], today: '2026-09-07',
    })
    // Chargeable: 09-03 (allowed), 09-05 (first past it), 09-06 (second). The newest cat left first.
    expect(s.decayEvents).toBe(2)
    expect(s.lastLost?.day).toBe('2026-09-06')
  })
})
