// #2471 — walks found after the fact in the ring's MET (owner direction 2026-10-06): 5 of any 6
// minutes above 2.0, merged across gaps up to 3 min, at least 7 min, never inside sleep, lifting or
// a logged activity.
import { describe, it, expect } from 'vitest'
import { detectWalksFromMet, WALK_MIN_DURATION_MIN } from '../walk-detection'

const T0 = Date.UTC(2026, 9, 6, 23, 0) // 09:00 Brisbane on 10-07
const MIN = 60_000
/** A grid from a string, one char per minute: '#' = 3.0 MET, '.' = 1.2, '_' = no reading. */
const grid = (pattern: string) => ({
  startTimestampMs: T0,
  metsPerMinute: [...pattern].map(c => (c === '#' ? 3.0 : c === '.' ? 1.2 : null)),
})
const at = (min: number) => T0 + min * MIN

describe('detectWalksFromMet', () => {
  it('finds a 22-minute walk and dates it to the minute', () => {
    const walks = detectWalksFromMet(grid('.'.repeat(10) + '#'.repeat(22) + '.'.repeat(10)))
    expect(walks).toEqual([{ startMs: at(10), endMs: at(32), durationMin: 22, meanMet: 3 }])
  })

  // The owner's sighting on 2026-10-07: a flight of stairs raised the GPS chip. A minute or two of
  // effort is not a walk, whatever its MET.
  it('ignores a flight of stairs', () => {
    expect(detectWalksFromMet(grid('....##....'))).toEqual([])
    expect(detectWalksFromMet(grid('....#.#.#....'))).toEqual([])
  })

  it('tolerates one quiet minute in six, not two', () => {
    expect(detectWalksFromMet(grid('.' + '#####.'.repeat(3) + '.'))).toHaveLength(1)
    expect(detectWalksFromMet(grid('.' + '####..'.repeat(3) + '.'))).toEqual([])
  })

  it('joins walks across a stop of up to 3 minutes and splits them after a longer one', () => {
    expect(detectWalksFromMet(grid('#'.repeat(8) + '...' + '#'.repeat(8)))).toHaveLength(1)
    expect(detectWalksFromMet(grid('#'.repeat(8) + '....' + '#'.repeat(8)))).toHaveLength(2)
  })

  it(`needs ${WALK_MIN_DURATION_MIN} minutes`, () => {
    expect(detectWalksFromMet(grid('.' + '#'.repeat(WALK_MIN_DURATION_MIN - 1) + '.'))).toEqual([])
    expect(detectWalksFromMet(grid('.' + '#'.repeat(WALK_MIN_DURATION_MIN) + '.'))).toHaveLength(1)
  })

  it('treats a minute with no reading as not active', () => {
    // Two of every six missing: never 5 active in 6. The same pattern with the gaps active is a walk.
    expect(detectWalksFromMet(grid('####__'.repeat(3)))).toEqual([])
    expect(detectWalksFromMet(grid('######'.repeat(3)))).toHaveLength(1)
  })

  it('never finds a walk inside sleep, lifting or a logged activity, and trims one that runs into it', () => {
    const g = grid('#'.repeat(20))
    expect(detectWalksFromMet(g, [{ startMs: at(0), endMs: at(20) }])).toEqual([])
    expect(detectWalksFromMet(g, [{ startMs: at(12), endMs: at(20) }])).toEqual([
      { startMs: at(0), endMs: at(12), durationMin: 12, meanMet: 3 },
    ])
  })
})
