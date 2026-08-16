import { describe, it, expect } from 'vitest'
import { suggestedSoreMuscles, SORENESS_EXPECTED_WITHIN_HOURS, RECOVERED_PCT } from '@trainingai/shared/checkin/suggested-soreness'

const PILLS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core']

describe('suggestedSoreMuscles', () => {
  it('marks muscles trained recently that are still under-recovered', () => {
    const out = suggestedSoreMuscles([
      { muscle: 'chest', hoursAgo: 20, pct: 55 },
      { muscle: 'triceps', hoursAgo: 20, pct: 55 },
    ], PILLS)
    expect(out).toEqual(['Chest', 'Triceps'])
  })

  it('ignores work older than the DOMS window', () => {
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 96, pct: 40 }], PILLS)).toEqual([])
  })

  it('includes work right at the window edge but not past it', () => {
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: SORENESS_EXPECTED_WITHIN_HOURS, pct: 60 }], PILLS))
      .toEqual(['Chest'])
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: SORENESS_EXPECTED_WITHIN_HOURS + 0.1, pct: 60 }], PILLS))
      .toEqual([])
  })

  it('maps canonical feed names onto the broader pill labels', () => {
    // The recovery feed speaks anatomy ("quadriceps", "gluteal"); the pills speak gym.
    const out = suggestedSoreMuscles([
      { muscle: 'quadriceps', hoursAgo: 10, pct: 50 },
      { muscle: 'gluteal', hoursAgo: 10, pct: 50 },
    ], PILLS)
    expect(out).toContain('Quads')
    expect(out).toContain('Glutes')
  })

  it('returns [] for no data rather than guessing', () => {
    expect(suggestedSoreMuscles(null, PILLS)).toEqual([])
    expect(suggestedSoreMuscles(undefined, PILLS)).toEqual([])
    expect(suggestedSoreMuscles([], PILLS)).toEqual([])
  })

  it('ignores nonsense hoursAgo rather than treating it as recent', () => {
    expect(suggestedSoreMuscles([
      { muscle: 'chest', hoursAgo: Number.NaN, pct: 50 },
      { muscle: 'back', hoursAgo: -5, pct: 50 },
    ], PILLS)).toEqual([])
  })

  it('preserves the pill order given, not the feed order', () => {
    const out = suggestedSoreMuscles([
      { muscle: 'calves', hoursAgo: 5, pct: 50 },
      { muscle: 'chest', hoursAgo: 5, pct: 50 },
    ], PILLS)
    expect(out).toEqual(['Chest', 'Calves'])
  })
})

describe('suggestedSoreMuscles — recovery, not just the clock', () => {
  it('does NOT mark a recently-trained muscle that has already recovered', () => {
    // The whole point of using pct over hoursAgo: 47h after a LIGHT session is ~95% recovered,
    // and flagging that as sore would deload an exercise for no reason.
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 47, pct: 95 }], PILLS)).toEqual([])
  })

  it('marks a recently-trained muscle that is still under-recovered', () => {
    // Same 47h after a HEAVY session is only ~63% recovered — the case worth flagging.
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 47, pct: 63 }], PILLS)).toEqual(['Chest'])
  })

  it('treats the recovered threshold as exclusive', () => {
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 10, pct: RECOVERED_PCT }], PILLS)).toEqual([])
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 10, pct: RECOVERED_PCT - 1 }], PILLS)).toEqual(['Chest'])
  })

  it('reproduces the real back-to-back leg day: glutes and hamstrings, nothing else', () => {
    // 07-19 and 07-26 in production — a 46-47h gap where legs repeat.
    const out = suggestedSoreMuscles([
      { muscle: 'gluteal', hoursAgo: 46, pct: 62 },
      { muscle: 'hamstring', hoursAgo: 46, pct: 64 },
      { muscle: 'quadriceps', hoursAgo: 46, pct: 90 },  // recovered — light that day
      { muscle: 'chest', hoursAgo: 120, pct: 99 },      // long since recovered
    ], PILLS)
    expect(out).toEqual(['Hamstrings', 'Glutes'])
  })

  it('ignores a malformed pct rather than treating it as unrecovered', () => {
    expect(suggestedSoreMuscles([{ muscle: 'chest', hoursAgo: 10, pct: Number.NaN }], PILLS)).toEqual([])
  })
})
