import { describe, it, expect } from 'vitest'
import { V2_LADDERS as LADDERS, replayCollection, type CollectionState } from '@trainingai/shared/collection/ladder'
import { nextMerge, nearestMerge, mergeLine, mergeCountLine, totalHeld, FAUCET_NOUN, FAUCET_TITLE } from '../collection-summary'
import { tierGlyph, ladderGlyphs } from '../collection-sprites'

const state = (stock: number[]): CollectionState => ({ stock, duplicateDays: 0, decayEvents: 0 })

describe('which merge the card is working toward (BF-122b)', () => {
  it('measures the next merge in FAUCET DAYS, not in how full a rung looks', () => {
    // 3 slimes of the 5 a scout costs = 2 workouts. 1 scout of the 4 a Tank costs is 75% full and
    // 15 workouts away. Ranking on fraction picks the Tank and then has to say "3 more cat scouts",
    // which is not a unit anyone can spend a day earning.
    const p = nextMerge(state([3, 1, 0]), LADDERS.workout)
    expect(p).toMatchObject({ fromTier: 0, towardName: 'Tank II', have: 3, need: 5, daysNeeded: 2 })
  })

  it('prefers the higher tier when the effort is identical', () => {
    // 5 workouts either way: 5 slimes for a scout, or the 1 scout that completes a Tank. Same cost,
    // better prize — and it is the case the entry's own example line describes.
    const p = nextMerge(state([0, 3, 0]), LADDERS.workout)
    expect(p).toMatchObject({ fromTier: 1, towardName: 'Tank III', daysNeeded: 5 })
  })

  it('costs a higher rung through every merge below it', () => {
    // Two scouts short of a Tank is 10 workouts, not 2 — each scout is itself 5. The bottom rung is
    // cheaper here (5), so that is what the card offers; this pins the arithmetic, not the choice.
    const p = nextMerge(state([0, 2, 0]), LADDERS.workout)
    expect(p?.daysNeeded).toBe(5)
    expect(p?.fromTier).toBe(0)
  })

  it('a higher rung can only ever TIE the bottom one, so the tie rule is what surfaces a Tank at all', () => {
    // One more of tier N costs a full merge of tier N-1, which is never fewer days than finishing
    // the bottom rung outright. If that stops holding for a new ladder, the tie-break above is no
    // longer what surfaces the top tier and this test is where it shows.
    for (const ladder of Object.values(LADDERS)) {
      const bottomCost = ladder.tiers[1].mergeCost
      for (let i = 1; i < ladder.tiers.length - 1; i++) {
        let unit = 1
        for (let k = 1; k <= i; k++) unit *= ladder.tiers[k].mergeCost
        expect(unit, `${ladder.faucet} tier ${i}`).toBeGreaterThanOrEqual(bottomCost)
      }
    }
  })

  it('keeps offering a next merge after the top tier is reached, because the ladder never ends', () => {
    // Owning a Tank does not stop slimes spawning. A card that went blank here would read as broken.
    expect(nextMerge(state([0, 0, 0, 0, 0, 1]), LADDERS.workout)).toMatchObject({ fromTier: 0, towardName: 'Tank II' })
  })

  it('ranks the three ladders on that same number, not on which faucet it is', () => {
    const nearest = nearestMerge(
      { workout: state([1]), steps: state([2]), health: state([0]) },
      LADDERS,
    )
    // steps needs 1 tier I cat, workout 4, health 3.
    expect(nearest?.faucet).toBe('steps')
    expect(nearest?.daysNeeded).toBe(1)
  })

  it('breaks a tie on the given order, so the card does not swap ladders between refreshes', () => {
    // Workout is 3 workouts away and health 3 tier I cats: equal, to force the tie.
    const a = nearestMerge({ workout: state([2]), health: state([0]) }, LADDERS)
    const b = nearestMerge({ workout: state([2]), health: state([0]) }, LADDERS)
    expect(a?.daysNeeded).toBe(3)
    expect(a?.faucet).toBe('workout')
    expect(a?.faucet).toBe(b?.faucet)
  })

  it('is null only when it was given no collection at all', () => {
    expect(nearestMerge({}, LADDERS)).toBeNull()
  })
})

describe('the sentence under the sprite', () => {
  it('always counts faucet days, in the words of that faucet', () => {
    expect(mergeLine(nextMerge(state([3, 0, 0]), LADDERS.workout)!)).toBe('2 more workouts for a Tank II')
    expect(mergeLine(nextMerge(state([2]), LADDERS.health)!)).toBe('1 more tier I cat for a Health cat II')
  })

  it('stays in days above the bottom rung rather than naming a unit nobody earns directly', () => {
    expect(mergeLine(nextMerge(state([0, 3, 0]), LADDERS.workout)!)).toBe('5 more workouts for a Tank III')
  })

  it('drops the target for the card, which already names it on the line above', () => {
    const p = nextMerge(state([3, 0, 0]), LADDERS.workout)!
    expect(mergeCountLine(p)).toBe('2 more workouts')
    expect(mergeCountLine(p)).not.toContain('Tank II')
    // Still the same number as the long form, which is the only thing that must not drift.
    expect(mergeLine(p).startsWith(mergeCountLine(p))).toBe(true)
  })

  it('names every faucet, so a new ladder cannot render an undefined noun or heading', () => {
    for (const faucet of Object.keys(LADDERS) as (keyof typeof LADDERS)[]) {
      expect(FAUCET_NOUN[faucet]?.one, faucet).toBeTruthy()
      expect(FAUCET_NOUN[faucet]?.many, faucet).toBeTruthy()
      expect(FAUCET_TITLE[faucet], faucet).toBeTruthy()
    }
  })

  it('writes the headings in sentence case rather than leaving CSS to title-case them', () => {
    // `capitalize` on "days with steps" renders "Days With Steps".
    for (const title of Object.values(FAUCET_TITLE)) {
      expect(title[0], title).toBe(title[0].toUpperCase())
      expect(title.slice(1), title).toBe(title.slice(1).toLowerCase())
    }
  })
})

describe('the glyphs', () => {
  it('cover every tier of every ladder', () => {
    for (const [faucet, ladder] of Object.entries(LADDERS)) {
      const glyphs = ladderGlyphs(faucet as keyof typeof LADDERS)
      expect(glyphs, faucet).toHaveLength(ladder.tiers.length)
      ladder.tiers.forEach((_, i) => expect(tierGlyph(faucet as keyof typeof LADDERS, i), `${faucet}[${i}]`).toBeTruthy())
    }
  })

  it('show the shared bottom rung as one creature, because it IS one', () => {
    // All four ladders spawn `cat slime`. Four different glyphs would read as three species.
    const bottoms = new Set(Object.keys(LADDERS).map(f => tierGlyph(f as keyof typeof LADDERS, 0)))
    expect(bottoms.size).toBe(1)
  })
})

describe('against the real fold, not a hand-built stock', () => {
  it('a week of training reads as progress toward the first merge', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03']
    const s = replayCollection({ days, ladder: LADDERS.workout, maxRestGap: 1, today: '2026-09-03' })
    expect(totalHeld(s)).toBe(3)
    expect(mergeLine(nextMerge(s, LADDERS.workout)!)).toBe('2 more workouts for a Tank II')
  })
})
