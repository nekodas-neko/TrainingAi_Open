import { describe, expect, it } from 'vitest'
import { resilienceAsOfLine, resilienceShortfallLine } from '../resilience-copy'

/**
 * LA-158 — the resilience tile said nothing when it had nothing, and said nothing about WHEN when
 * what it had was five days old.
 *
 * The engine half shipped `ownResilienceAsOf` and `ownResilienceUnavailable`; these are the two
 * sentences the surface is allowed to build from them. The constraint that shapes both is the
 * entry's: the payload sees **7** days while the model gates on **14**, so what is observable here
 * is *consistent with* the coverage gate having closed and does not establish it.
 */

const coverage = (over: Partial<Parameters<typeof resilienceShortfallLine>[0]> = {}) => ({
  daysSeen: 7, daysMeetingCoverageGate: 2,
  coverageGateMinutes: 240, minValidDays: 5, modelWindowDays: 14,
  ...over,
})

describe('LA-158 — what the surface may say when there is no level', () => {
  it('⭐ states the two counts side by side, which is the sentence the entry asked for', () => {
    expect(resilienceShortfallLine(coverage()))
      .toBe('2 of the last 7 days had enough daytime coverage; the model needs 5 of 14.')
  })

  it('⛔ and draws no causal line between them — it is an observation, not a diagnosis', () => {
    // The payload's window is 7 days and the model's is 14, so "that is why nothing published"
    // would be a claim this data cannot support. `readiness-payload.ts` pins the absence of a
    // `reason` field for the same reason; this pins the absence of the words.
    const line = resilienceShortfallLine(coverage())!
    expect(line).not.toMatch(/because|that is why|so no|which is why|caused|due to/i)
  })

  it('degrades when the thresholds were not injected, rather than guessing them', () => {
    // Every threshold is null when the resilience constants were absent on the request — a
    // different thing from a threshold of zero, and the sentence must not imply one.
    expect(resilienceShortfallLine(coverage({ minValidDays: null })))
      .toBe('2 of the last 7 days had enough daytime coverage.')
    expect(resilienceShortfallLine(coverage({ modelWindowDays: null })))
      .toBe('2 of the last 7 days had enough daytime coverage.')
    expect(resilienceShortfallLine(coverage({ daysMeetingCoverageGate: null })))
      .toBe('Checked the last 7 days.')
  })

  it('says nothing at all when nothing was looked at', () => {
    // Zero days seen is not "0 of the last 0 days" — it is an absence of observation, and a
    // sentence about it would be furniture.
    expect(resilienceShortfallLine(coverage({ daysSeen: 0 }))).toBeNull()
  })

  it('counts a single day in the singular', () => {
    expect(resilienceShortfallLine(coverage({ daysSeen: 1, daysMeetingCoverageGate: 0 })))
      .toBe('0 of the last 1 day had enough daytime coverage; the model needs 5 of 14.')
  })
})

describe('LA-158 — naming the day a stale level came from', () => {
  it('⭐ names it, in the vocabulary RV-202 already uses for the same idea', () => {
    // `From 26 Sept` is the workout screen's amber source pill for a payload built on an earlier
    // day. One phrasing for one idea, which is RV-208's whole point.
    expect(resilienceAsOfLine('2026-09-22', '2026-09-27')).toBe('From 22 Sept, not today.')
  })

  it('⛔ says nothing when the level IS today’s — a permanent date line is furniture', () => {
    expect(resilienceAsOfLine('2026-09-27', '2026-09-27')).toBeNull()
  })

  it('⛔ and says nothing when there is no day, rather than implying the number is old', () => {
    // A payload written before `ownResilienceAsOf` shipped carries none. Absent is not stale.
    expect(resilienceAsOfLine(null, '2026-09-27')).toBeNull()
  })

  it('treats a future day as current, because a number from ahead of today is not STALE', () => {
    // Reachable across a timezone boundary rather than hypothetical: the payload's day comes from
    // the server's view of the user's zone.
    expect(resilienceAsOfLine('2026-09-28', '2026-09-27')).toBeNull()
  })

  it('compares date STRINGS, so it cannot drift on the device clock', () => {
    // Both sides are 'YYYY-MM-DD' in the user's timezone — `todayInTz(tz)` at the call site, and
    // the server's own day here. A `new Date()` comparison would reintroduce the UTC-vs-AEST bug
    // this repo has fixed more than once.
    expect(resilienceAsOfLine('2026-12-31', '2027-01-01')).toBe('From 31 Dec, not today.')
  })
})
