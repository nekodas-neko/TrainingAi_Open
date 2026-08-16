// Q-245 — owner report: "on a fresh day; if you swipe to previous day; then back to today it fills
// in food data with the previous day meal for today. it doesnt reset until app close and reopen."
//
// The reported sequence is the second test below. The rest pin the anti-flicker guard this fix must
// NOT break: an empty response for the day already on screen still keeps what is rendered, because
// that is what protects optimistic, not-yet-synced adds from a transient empty read.
import { describe, it, expect } from 'vitest'
import { decideLogsApplication } from '../food-log-application'

const TODAY = '2026-08-15'
const YESTERDAY = '2026-08-14'

describe('decideLogsApplication (Q-245)', () => {
  it("replaces today's empty result even though yesterday's food is still rendered", () => {
    // Swiped back to a fresh today: the fetch is for today, `logs` still holds yesterday's meals.
    // Length-only logic saw "empty result, non-empty prev" and kept yesterday's food.
    expect(decideLogsApplication({
      fetchDate: TODAY, selectedDate: TODAY, logsDate: YESTERDAY,
      nextIsEmpty: true, prevIsEmpty: false,
    })).toBe('replace')
  })

  it('keeps a rendered day when its own fetch comes back empty', () => {
    expect(decideLogsApplication({
      fetchDate: TODAY, selectedDate: TODAY, logsDate: TODAY,
      nextIsEmpty: true, prevIsEmpty: false,
    })).toBe('keep')
  })

  it('replaces when the fetch has data, whatever is rendered', () => {
    for (const logsDate of [TODAY, YESTERDAY, null]) {
      expect(decideLogsApplication({
        fetchDate: TODAY, selectedDate: TODAY, logsDate,
        nextIsEmpty: false, prevIsEmpty: false,
      })).toBe('replace')
    }
  })

  it('drops a response that resolved after the user swiped away', () => {
    // Yesterday's fetch landing while today is on screen would paint one day's food under
    // another's header — the same bug from the other direction.
    expect(decideLogsApplication({
      fetchDate: YESTERDAY, selectedDate: TODAY, logsDate: TODAY,
      nextIsEmpty: false, prevIsEmpty: false,
    })).toBe('drop')
  })

  it('replaces on the first render, when no date has been painted yet', () => {
    expect(decideLogsApplication({
      fetchDate: TODAY, selectedDate: TODAY, logsDate: null,
      nextIsEmpty: true, prevIsEmpty: true,
    })).toBe('replace')
  })

  it('has nothing to protect when the rendered day is already empty', () => {
    expect(decideLogsApplication({
      fetchDate: TODAY, selectedDate: TODAY, logsDate: TODAY,
      nextIsEmpty: true, prevIsEmpty: true,
    })).toBe('replace')
  })
})
