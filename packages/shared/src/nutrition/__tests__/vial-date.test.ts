import { describe, expect, it } from 'vitest'
import { isOpenedOnValid, openedOnBounds, openedOnProblem, MAX_OPENED_DAYS_BACK } from '../vial-date'

/** The day the owner reported it, and the day his vial was wrongly stamped. */
const TODAY = '2026-09-10'

describe('openedOnBounds', () => {
  it('runs from six months back to today, inclusive', () => {
    expect(openedOnBounds(TODAY)).toEqual({ min: '2026-03-14', max: TODAY })
  })

  it('crosses a year boundary without arithmetic of its own', () => {
    expect(openedOnBounds('2026-01-05').min).toBe('2025-07-09')
  })
})

describe('isOpenedOnValid', () => {
  it('accepts the date the owner actually needed — five days back', () => {
    expect(isOpenedOnValid('2026-09-05', TODAY)).toBe(true)
  })

  it('accepts today, which is the default', () => {
    expect(isOpenedOnValid(TODAY, TODAY)).toBe(true)
  })

  it('accepts both ends of the window', () => {
    const { min, max } = openedOnBounds(TODAY)
    expect(isOpenedOnValid(min, TODAY)).toBe(true)
    expect(isOpenedOnValid(max, TODAY)).toBe(true)
  })

  it('rejects tomorrow — a vial cannot be opened in the future', () => {
    expect(isOpenedOnValid('2026-09-11', TODAY)).toBe(false)
  })

  it('rejects the mistyped year, which is the whole reason for a lower bound', () => {
    // It would not error, it would move the window — and the card would then report a true
    // statement that reads as a bug, which is how BF-136 was found.
    expect(isOpenedOnValid('2025-09-10', TODAY)).toBe(false)
    expect(isOpenedOnValid('0202-09-10', TODAY)).toBe(false)
  })

  it('rejects a day outside the window by one', () => {
    expect(isOpenedOnValid('2026-03-13', TODAY)).toBe(false)
  })

  it('rejects anything that is not a plain YYYY-MM-DD', () => {
    // The routes accept slashes because `localDateString()` emits them; `<input type="date">` does
    // not, so this guard has no reason to and stays the stricter of the two.
    expect(isOpenedOnValid('', TODAY)).toBe(false)
    expect(isOpenedOnValid('2026/09/05', TODAY)).toBe(false)
    expect(isOpenedOnValid('10-09-2026', TODAY)).toBe(false)
  })
})

describe('openedOnProblem', () => {
  it('says nothing when the date is fine', () => {
    expect(openedOnProblem('2026-09-05', TODAY)).toBeNull()
  })

  it('names the future case and the year case separately', () => {
    expect(openedOnProblem('2026-09-11', TODAY)).toMatch(/future/)
    expect(openedOnProblem('2025-09-10', TODAY)).toMatch(new RegExp(String(MAX_OPENED_DAYS_BACK)))
    expect(openedOnProblem('2025-09-10', TODAY)).toMatch(/year/)
  })

  it('asks for a date rather than complaining about a range when the field is empty', () => {
    expect(openedOnProblem('', TODAY)).toMatch(/Pick the day/)
  })
})

// #3041: the shape check now also refuses a day that does not exist.
describe('real days only', () => {
  it('refuses an impossible day that is the right shape and inside the window', () => {
    expect(isOpenedOnValid('2026-09-30', '2026-10-05')).toBe(true)
    expect(isOpenedOnValid('2026-09-31', '2026-10-05')).toBe(false)
    expect(openedOnProblem('2026-09-31', '2026-10-05')).toBe('Pick the day you mixed this vial.')
  })
})
