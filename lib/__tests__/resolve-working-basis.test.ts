import { describe, it, expect } from 'vitest'
import { resolveWorkingBasis } from '@trainingai/shared/1rm'

describe('resolveWorkingBasis — one definition for every weight path', () => {
  it('uses the estimate when there is no log — the case the feature exists for', () => {
    expect(resolveWorkingBasis({ lastNonDeload1rm: null, seedEstimate: 100 })).toBe(100)
  })

  it('uses the log when there is no estimate', () => {
    expect(resolveWorkingBasis({ lastNonDeload1rm: 90 })).toBe(90)
  })

  it('returns null rather than any constant when there is nothing to go on', () => {
    // The whole point: a fabricated 60 kg is what this replaces.
    expect(resolveWorkingBasis({})).toBeNull()
    expect(resolveWorkingBasis({ lastNonDeload1rm: null, seedEstimate: null })).toBeNull()
  })

  it('ignores non-positive and non-finite values instead of propagating them', () => {
    expect(resolveWorkingBasis({ lastNonDeload1rm: 0, seedEstimate: 0 })).toBeNull()
    expect(resolveWorkingBasis({ lastNonDeload1rm: -5, seedEstimate: 80 })).toBe(80)
    expect(resolveWorkingBasis({ lastNonDeload1rm: NaN, seedEstimate: 80 })).toBe(80)
    expect(resolveWorkingBasis({ lastNonDeload1rm: Infinity, seedEstimate: 80 })).toBe(80)
  })
})

// Q-202. The owner lowered their weights deliberately to work on form, and the app kept
// prescribing from a lift months old, because `max(lastLog, seed, allTimePr)` meant the
// all-time PR always won and no number of lighter sessions could ever move it.
describe('resolveWorkingBasis — the last real session wins outright (Q-202)', () => {
  it('prescribes from the last non-deload session even when it is well BELOW the all-time PR', () => {
    // The reported case: a 16.25 kg all-time 1RM still driving the prescription after the
    // owner had deliberately dropped to sets that estimate ~10 kg.
    expect(resolveWorkingBasis({ lastNonDeload1rm: 10, allTimePr1rm: 16.25 })).toBe(10)
  })

  it('does not let a typed starting estimate outrank a real logged session either', () => {
    // The seed exists to get a brand-new exercise off the ground, not to hold a floor under
    // one the user has since actually trained.
    expect(resolveWorkingBasis({ lastNonDeload1rm: 90, seedEstimate: 140 })).toBe(90)
  })

  it('still rises immediately when the last session was a PR', () => {
    // The change is symmetric — it tracks the last session in both directions.
    expect(resolveWorkingBasis({ lastNonDeload1rm: 130, allTimePr1rm: 120 })).toBe(130)
  })

  it('accepts that ONE light session lowers the next prescription', () => {
    // Not an oversight. The owner was offered "best of the last ~3 non-deload sessions" to
    // absorb a single bad day, and chose the strict last session. Do not reintroduce the
    // smoothed variant without asking — this test is the record of that decision.
    expect(resolveWorkingBasis({ lastNonDeload1rm: 70, allTimePr1rm: 120, seedEstimate: 100 })).toBe(70)
  })

  it('falls back to the PR only when no real session exists at all', () => {
    // A deload-only history carries no usable estimate (estimateOneRm stores 0 for a
    // deliberately submaximal effort), so nothing reaches lastNonDeload1rm and the earned
    // PR is genuinely the best remaining information.
    expect(resolveWorkingBasis({ lastNonDeload1rm: null, allTimePr1rm: 120 })).toBe(120)
    expect(resolveWorkingBasis({ lastNonDeload1rm: 0, allTimePr1rm: 120 })).toBe(120)
  })

  it('takes the better of seed and PR when both fallbacks are present', () => {
    expect(resolveWorkingBasis({ seedEstimate: 100, allTimePr1rm: 120 })).toBe(120)
    expect(resolveWorkingBasis({ seedEstimate: 140, allTimePr1rm: 120 })).toBe(140)
  })
})
