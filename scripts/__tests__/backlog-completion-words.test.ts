// The queue's "an entry that says it is finished should not still be in it" check reads a word list,
// and the list is the fragile part. It missed `CLOSED` until 2026-08-25, when two entries were found
// sitting in the queue because of it: **Q-304b, closed that same morning and still handed to an
// implementer as READY #4 by `next-item.js`**, and Q-27, closed three weeks earlier.
//
// Widening a word list like this has an obvious failure mode in the other direction — the same words
// appear as ordinary prose in live entries — so the two properties that keep the false-positive rate
// at zero are pinned here against the real headings that would break them.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { announcesCompletion } = require('../lib/completion-words.js') as {
  announcesCompletion: (heading: string) => boolean
}

describe('backlog completion words', () => {
  it('flags the stamp this check was widened for', () => {
    expect(announcesCompletion(
      '### [workouts] Q-304b — CLOSED 2026-08-25: the historical 1RM estimates stay as they are',
    )).toBe(true)
  })

  it('flags the pre-existing stamps', () => {
    for (const h of ['✅ FIXED 2026-08-23', 'LA-21 — SHIPPED 2026-08-24', 'Q-27 — SUPERSEDED']) {
      expect(announcesCompletion(h), h).toBe(true)
    }
  })

  // Both of these are real, OPEN entries. A case-insensitive match flags both, which is the check
  // crying wolf on its second day — the words are prose here, not status stamps.
  it('does not flag the same words used as lowercase prose', () => {
    expect(announcesCompletion(
      '### [readiness][heart-rate] TN-2 — the Body Battery charge window has closed, so the tank only drains',
    )).toBe(false)
    expect(announcesCompletion(
      '### [workouts] BF-16b — the retired all-primary program, and the one live session with no Primary',
    )).toBe(false)
  })

  // The distinction worth preserving: an investigation can conclude while its action is still owed.
  // LA-27 answered *why* 76 estimates cannot be re-derived and still owes the fix; Q-547 answered the
  // deploy-churn half and still owes a quiet-window baseline. Both belong in the queue.
  it('does not treat ANSWERED as finished', () => {
    expect(announcesCompletion(
      '### [workouts][platform] LA-27 — ANSWERED: the un-re-derivable estimates predate `set_logs.planned_pct`',
    )).toBe(false)
    expect(announcesCompletion(
      '### [platform] Q-547 — ANSWERED 2026-08-18: the app CPU is spiky, and much of it is deploy churn',
    )).toBe(false)
  })

  it('respects word boundaries', () => {
    expect(announcesCompletion('### [platform] Q-1 — the DISCLOSED fields the export omits')).toBe(false)
    expect(announcesCompletion('### [platform] Q-2 — UNDONE by the next deploy')).toBe(false)
  })
})
