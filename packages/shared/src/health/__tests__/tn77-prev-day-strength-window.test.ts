import { describe, it, expect } from 'vitest'
import { strengthWindowEndingAt } from '../activity-score'

/**
 * TN-77(a) — readiness's `prevDayActivity` contributor scores YESTERDAY, and both call sites were
 * handing it TODAY's rolling strength window.
 *
 * Measured over 115 days it differs from yesterday's own window on **83 of them (72%)**, mean
 * |difference| 4.45 points, worst −15/+10. At the contributor's 0.09 weight that is ~1.4 readiness
 * points at worst, and the mean signed difference is −0.15 — noise rather than bias.
 *
 * The case that matters is a training day: today's window contains this morning's session and
 * yesterday's cannot, so the contributor describing *yesterday* reacted to a workout that had not
 * happened when yesterday ended. That is the property pinned here.
 */

const DAY = 86_400_000
const TODAY_MID = Date.parse('2026-09-24T14:00:00.000Z')   // Brisbane midnight
const YESTERDAY_MID = TODAY_MID - DAY

const session = (atMs: number, volumeKg: number) => ({
  startedAt: new Date(atMs).toISOString(),
  exercises: [{ volume: volumeKg }],
})

describe("yesterday's strength window excludes today (TN-77a)", () => {
  it("this morning's session does not reach yesterday's window", () => {
    // The defect in one case: a session logged after yesterday ended must not count toward it.
    const sessions = [session(TODAY_MID + 3 * 3600_000, 5000)]
    expect(strengthWindowEndingAt(sessions, YESTERDAY_MID)).toEqual({ sessions7d: 0, volume7dKg: 0 })
  })

  it("but it DOES count toward today's window", () => {
    // The control: the same session, asked about the right day. If this failed, the helper would be
    // excluding real work rather than fixing an off-by-one.
    const sessions = [session(TODAY_MID + 3 * 3600_000, 5000)]
    expect(strengthWindowEndingAt(sessions, TODAY_MID)).toEqual({ sessions7d: 1, volume7dKg: 5000 })
  })

  it('a session on the day itself counts, and volume sums across exercises', () => {
    const sessions = [{
      startedAt: new Date(YESTERDAY_MID + 9 * 3600_000).toISOString(),
      exercises: [{ volume: 1200 }, { volume: 800 }, { volume: null }],
    }]
    expect(strengthWindowEndingAt(sessions, YESTERDAY_MID)).toEqual({ sessions7d: 1, volume7dKg: 2000 })
  })

  it('the window reaches back seven days and no further', () => {
    const sessions = [
      session(YESTERDAY_MID - 7 * DAY, 100),          // oldest day still inside
      session(YESTERDAY_MID - 7 * DAY - 1, 999),      // one millisecond too old
    ]
    expect(strengthWindowEndingAt(sessions, YESTERDAY_MID)).toEqual({ sessions7d: 1, volume7dKg: 100 })
  })

  it('an empty history is zero, not null', () => {
    // The caller gates on `sessions7d > 0`, so a null here would change which days score at all.
    expect(strengthWindowEndingAt([], YESTERDAY_MID)).toEqual({ sessions7d: 0, volume7dKg: 0 })
  })
})
