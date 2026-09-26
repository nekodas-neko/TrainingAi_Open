import { describe, expect, it } from 'vitest'
import { initialsOf } from '../initials'

describe('initialsOf', () => {
  it.each([
    ['Test User', 'TU'],
    ['Zero Data', 'ZD'],
    ['ada lovelace', 'AL'],
    // A middle name is skipped, the way a person reading the name would skip it.
    ['John Ronald Reuel Tolkien', 'JT'],
    ['  Grace   Hopper  ', 'GH'],
  ])('%s → %s', (name, want) => {
    expect(initialsOf(name)).toBe(want)
  })

  // The one case the old `slice(0, 2)` got right, and it is still the best answer.
  it('falls back to two letters for a single word', () => {
    expect(initialsOf('Cher')).toBe('CH')
  })

  it('handles a one-letter word without reading past the end', () => {
    expect(initialsOf('X')).toBe('X')
    expect(initialsOf('X Y')).toBe('XY')
  })

  it.each([[null], [undefined], [''], ['   ']])('is ? for %s', name => {
    expect(initialsOf(name as string | null | undefined)).toBe('?')
  })

  // An email is what two of the three call sites fall back to, so it must not crash or read oddly.
  it('takes the first two letters of an email, which has no words to split', () => {
    expect(initialsOf('ada@example.com')).toBe('AD')
  })
})
