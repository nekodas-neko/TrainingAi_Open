import { describe, it, expect } from 'vitest'
import { sleepWindowLabel } from '../sleep-window-label'

describe('sleepWindowLabel', () => {
  it('prints bed and wake in the user timezone, not UTC', () => {
    // 13:12Z is 11:12 pm in Brisbane (UTC+10, no DST); 20:03Z the same night is 6:03 am the next day.
    expect(sleepWindowLabel('2026-10-06T13:12:00.000Z', '2026-10-06T20:03:00.000Z', 'Australia/Brisbane'))
      .toBe('11:12 pm → 6:03 am')
  })

  it('follows the timezone it is given', () => {
    expect(sleepWindowLabel('2026-10-06T13:12:00.000Z', '2026-10-06T20:03:00.000Z', 'UTC'))
      .toBe('1:12 pm → 8:03 pm')
  })

  it('is null when either end is missing, so a half window never renders', () => {
    expect(sleepWindowLabel(null, '2026-10-06T20:03:00.000Z', 'Australia/Brisbane')).toBeNull()
    expect(sleepWindowLabel('2026-10-06T13:12:00.000Z', undefined, 'Australia/Brisbane')).toBeNull()
    expect(sleepWindowLabel('', '', 'Australia/Brisbane')).toBeNull()
  })

  it('is null for an unreadable instant', () => {
    expect(sleepWindowLabel('not a date', '2026-10-06T20:03:00.000Z', 'Australia/Brisbane')).toBeNull()
  })
})
