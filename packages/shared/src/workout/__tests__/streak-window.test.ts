import { describe, it, expect } from 'vitest'
import { STREAK_LOOKBACK_DAYS } from '@trainingai/shared/workout/streak-window'

// BF-176. The owner's streak read 90, then 89 on a day he trained. His real streak is 102 days.
//
// The route sent 90 days of `trainedDays`; the consuming loop walks back 365. Past day 90 every
// lookup returns `undefined`, which the loop reads as a REST day rather than as missing data — so
// after three of them it breaks and the count is pinned to the window edge.
//
// The test that matters is not "the number is bigger". It is that the number stops being a
// property of the window: slide the edge by a day and the count must not move.

const MAX_REST_GAP = 2

/**
 * The loop from `session-select-content.tsx:1008-1030`, transcribed.
 *
 * Transcribed deliberately rather than imported: it lives in a component this lane does not own,
 * and the defect being pinned is the DISAGREEMENT between that loop and the route's window. A test
 * that imported the real loop would still need the window modelled separately, and the copy is
 * what makes the mismatch visible.
 */
function streakFromPayload(trainedDays: Record<string, string[]>, dayKey: (ago: number) => string): number {
  let count = 0
  let consecutiveRest = 0
  if ((trainedDays[dayKey(0)] ?? []).length > 0) count = 1
  for (let ago = 1; ago < 365; ago++) {
    const trained = (trainedDays[dayKey(ago)] ?? []).length > 0
    if (trained) {
      count += 1 + consecutiveRest
      consecutiveRest = 0
    } else {
      consecutiveRest++
      if (consecutiveRest > MAX_REST_GAP) break
    }
  }
  return count
}

/** A history where every day from `startAgo` days ago until today was trained. */
function unbrokenHistory(startAgo: number, windowDays: number): {
  payload: Record<string, string[]>
  dayKey: (ago: number) => string
} {
  const dayKey = (ago: number) => `d-${ago}`
  const payload: Record<string, string[]> = {}
  // Only days INSIDE the window reach the client — that is the whole defect.
  for (let ago = 0; ago <= Math.min(startAgo, windowDays - 1); ago++) payload[dayKey(ago)] = ['Push']
  return { payload, dayKey }
}

describe('BF-176 — the streak must not be a property of the window', () => {
  it('the shared lookback is at least the loop horizon, or the bug returns', () => {
    // The loop's `ago < 365` is the consumer; a supplier sending less is the defect.
    expect(STREAK_LOOKBACK_DAYS).toBeGreaterThanOrEqual(365)
  })

  it('reproduces the clipping at the old 90-day window', () => {
    // 102 real days, 90 sent: the count cannot exceed what arrived.
    const { payload, dayKey } = unbrokenHistory(101, 90)
    expect(streakFromPayload(payload, dayKey)).toBe(90)
  })

  it('reports the real streak once the window matches the loop', () => {
    const { payload, dayKey } = unbrokenHistory(101, STREAK_LOOKBACK_DAYS)
    expect(streakFromPayload(payload, dayKey)).toBe(102)
  })

  it.each([90, 120, 200])('at a %i-day window the count tracks the WINDOW, not the training', (w) => {
    // Same 300-day unbroken history, three different windows, three different answers. That is the
    // defect stated as an experiment: the lifter did not change.
    const { payload, dayKey } = unbrokenHistory(299, w)
    expect(streakFromPayload(payload, dayKey)).toBe(w)
  })

  it('the count does not move when the window slides a day — the entry\'s pass test', () => {
    // The owner's 90 → 89 happened on a day he TRAINED, because the edge slid off a rest day onto
    // a trained one. With the window past the streak, sliding it changes nothing.
    const today = unbrokenHistory(101, STREAK_LOOKBACK_DAYS)
    const tomorrow = unbrokenHistory(102, STREAK_LOOKBACK_DAYS)
    expect(streakFromPayload(tomorrow.payload, tomorrow.dayKey))
      .toBe(streakFromPayload(today.payload, today.dayKey) + 1)
  })

  it('a genuine break still breaks it — widening the window is not the same as never breaking', () => {
    const dayKey = (ago: number) => `d-${ago}`
    const payload: Record<string, string[]> = {}
    for (let ago = 0; ago <= 9; ago++) payload[dayKey(ago)] = ['Push']
    // days 10, 11, 12 are rest — the third breaks
    for (let ago = 13; ago <= 200; ago++) payload[dayKey(ago)] = ['Push']
    expect(streakFromPayload(payload, dayKey)).toBe(10)
  })

  it('two rest days keep the streak and are counted inside it', () => {
    // The home loop counts CALENDAR days spanned (`1 + consecutiveRest`), which is a different
    // quantity from `computeStreak`'s training-day count. Pinned so a later "unification" cannot
    // change what the owner's number means without failing here.
    const dayKey = (ago: number) => `d-${ago}`
    const payload: Record<string, string[]> = {}
    for (let ago = 0; ago <= 4; ago++) payload[dayKey(ago)] = ['Push']
    // 5 and 6 rest
    for (let ago = 7; ago <= 9; ago++) payload[dayKey(ago)] = ['Push']
    expect(streakFromPayload(payload, dayKey)).toBe(10)
  })
})
