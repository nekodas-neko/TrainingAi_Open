import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

/**
 * BF-136's regression, read off the source: the POST body must carry the field the form collects,
 * not a constant. Nothing renders in a test runner, and the defect was a single argument.
 */
describe('the sheet sends the date the user chose', () => {
  const ROOT = path.resolve(__dirname, '../../../..')
  const raw = readFileSync(path.join(ROOT, 'components/nutrition/reta/vial-sheet.tsx'), 'utf8')
  /** Comments quote the old call while explaining the bug, so a raw match would pass on prose. */
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('does not hardcode openedOn to today in the request body', () => {
    expect(code).not.toMatch(/openedOn:\s*todayInTz\(/)
    expect(code).toMatch(/\.\.\.draft,\s*openedOn\s*\}/)
  })

  it('renders a control for it, bounded', () => {
    expect(code).toMatch(/id="vial-opened"/)
    expect(code).toMatch(/type="date"/)
    expect(code).toMatch(/min=\{openedBounds\.min\}/)
    expect(code).toMatch(/max=\{openedBounds\.max\}/)
  })

  it('defaults the new-vial date to today rather than inheriting the last vial\'s', () => {
    // Inheriting would reproduce the defect one vial along, and silently.
    expect(code).toMatch(/setOpenedOn\(today\)/)
    expect(code).not.toMatch(/setOpenedOn\(current/)
  })

  it('will not save an out-of-range date', () => {
    expect(code).toMatch(/openedProblem/)
    expect(code).toMatch(/disabled=\{saving \|\| concentration == null \|\| openedProblem != null\}/)
  })
})
