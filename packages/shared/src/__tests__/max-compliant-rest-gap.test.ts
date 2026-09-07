import { describe, it, expect } from 'vitest'
import { maxCompliantRestGap, getScheduledSessionsPerWeek } from '../schedule-utils'
import type { Program, Schedule } from '../types'

// BF-122a. The owner's objection, verbatim: "when you setup a workout it asks how many days you can
// train a week — it should consider that, cause if you choose 2 workouts a week that could have up
// to 5 days between workout 1 and 2 and you are still following."
//
// So the question is NOT how many sessions a week. It is where the hole is.
const prog = (schedule: Schedule | undefined): Program =>
  ({ schedule } as unknown as Program)

const weekly = (...days: number[]): Schedule =>
  ({ id: 's', programId: 'p', type: 'weekly', days: days.map(d => ({ dayOfWeek: d, sessionId: 'x' })) })

describe('maxCompliantRestGap (BF-122a)', () => {
  it('is one rest day for a rotation, whatever restAfterN is', () => {
    // N training days then ONE rest day. N changes how OFTEN a rest day falls, never how long one
    // lasts, so every rotation has the same compliant gap.
    for (const n of [1, 2, 3, 5]) {
      expect(maxCompliantRestGap(prog({ id: 's', programId: 'p', type: 'rotation', restAfterN: n }))).toBe(1)
    }
  })

  // THE case from the entry. Two days a week, adjacent, is a five-day hole.
  it('finds the five-day hole in Mon+Tue', () => {
    expect(maxCompliantRestGap(prog(weekly(1, 2)))).toBe(5)
  })

  // And the same COUNT spread out is a completely different allowance — which is exactly why the
  // count helper beside it is the wrong input, not merely a rougher one.
  it('gives a different answer to the same sessions-per-week count', () => {
    const clustered = prog(weekly(1, 2))
    const spread = prog(weekly(1, 4))
    expect(getScheduledSessionsPerWeek(clustered)).toBe(getScheduledSessionsPerWeek(spread))
    // Mon+Thu: Tue/Wed off is 2 rest days, but Fri/Sat/Sun off is 3 — and it is the WIDEST that
    // decides, so 3. Still far short of Mon+Tue's 5 on the same session count.
    expect(maxCompliantRestGap(clustered)).toBe(5)
    expect(maxCompliantRestGap(spread)).toBe(3)
  })

  it('wraps around the week end rather than scanning a sorted list pairwise', () => {
    // Sat+Sun: the gap inside the list is 1 day, the real hole is Sun→Sat, five days off.
    expect(maxCompliantRestGap(prog(weekly(6, 0)))).toBe(5)
  })

  it('is zero rest days when every day is a training day', () => {
    expect(maxCompliantRestGap(prog(weekly(0, 1, 2, 3, 4, 5, 6)))).toBe(0)
  })

  it('is six for a single weekly session', () => {
    expect(maxCompliantRestGap(prog(weekly(3)))).toBe(6)
  })

  // A ScheduleDay with no sessionId is a CONFIGURED rest day. Counting it as a training day would
  // shrink the allowance and decay someone who is following their schedule exactly.
  it('ignores scheduled days that carry no session', () => {
    const withRest: Schedule = {
      id: 's', programId: 'p', type: 'weekly',
      days: [{ dayOfWeek: 1, sessionId: 'x' }, { dayOfWeek: 4, sessionId: undefined }],
    }
    expect(maxCompliantRestGap(prog(withRest))).toBe(6)
  })

  // The fallback is 1 on purpose: it is what computeStreak's two call sites already hardcoded for
  // everyone, so an unscheduled user's streak does not move under this change.
  it('falls back to one rest day when there is no usable schedule', () => {
    expect(maxCompliantRestGap(prog(undefined))).toBe(1)
    expect(maxCompliantRestGap(null)).toBe(1)
    expect(maxCompliantRestGap(prog(weekly()))).toBe(1)
  })
})
