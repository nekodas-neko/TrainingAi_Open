import { describe, it, expect } from 'vitest'
import { replayCollection, LADDERS } from '@trainingai/shared/collection/ladder'
import { restlessLine, lostLine } from '../collection-summary'

const workout = (days: string[], today: string) =>
  replayCollection({ days, ladder: LADDERS.workout, maxRestGap: 1, today })

describe('the named lines on the Home card', () => {
  it('names the cat that would leave when skipping today costs one', () => {
    const s = workout(['2026-09-01', '2026-09-02'], '2026-09-04')
    const line = restlessLine({ workout: s })!
    // The newest loose cat is the one the fold takes first.
    expect(line).toContain(s.cats!.at(-1)!.name)
    expect(line).toContain('train today')
  })

  it('says nothing when there is still a rest day in hand', () => {
    expect(restlessLine({ workout: workout(['2026-09-01'], '2026-09-02') })).toBeNull()
  })

  it('names the last cat lost, with the day it left, read straight from the day string', () => {
    const s = workout(['2026-09-01', '2026-09-02'], '2026-09-06')
    expect(lostLine(s)).toMatch(new RegExp(`^${s.lastLost!.name} wandered off on 5 Sep`))
  })
})
