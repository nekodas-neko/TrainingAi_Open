/**
 * RV-179 — `check-client-today-timezone` counted `todayInTz()` and `localDateString()` and nothing
 * else, while the other ways to ask "what day is it" without the user's zone were held at zero only
 * by a vitest scan of `.tsx` files that the Custom Rules gate never ran.
 *
 * These drive `countBare` (the one counting pass the working tree and the base branch share) and the
 * balanced-paren arity helper it uses, including the trap the helper exists for: the zone is
 * `todayMidnightUtc`'s FIRST argument and `toAestDay`'s SECOND.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { countBare } = require('../check-client-today-timezone.js') as { countBare: (src: string) => number }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callsUnderArity } = require('../lib/call-arity.js') as { callsUnderArity: (s: string, n: string, m: number) => string[] }

describe('countBare', () => {
  it('still counts the original two', () => {
    expect(countBare(`const t = todayInTz()`)).toBe(1)
    expect(countBare(`const t = localDateString()`)).toBe(1)
    expect(countBare(`const t = todayInTz(tz)`)).toBe(0)
  })

  it('counts the device clock and date together', () => {
    expect(countBare(`const t = localDatetimeString()`)).toBe(1)
  })

  it('counts the fallback spelled out, in either spelling, and not a user zone', () => {
    expect(countBare(`const t = todayInTz(DEFAULT_TZ)`)).toBe(1)
    expect(countBare(`const t = todayInTz( 'Australia/Brisbane' )`)).toBe(1)
    expect(countBare(`const t = todayInTz("Australia/Brisbane")`)).toBe(1)
    expect(countBare(`const t = todayInTz(user.timezone)`)).toBe(0)
    expect(countBare(`const t = todayInTz(tz ?? DEFAULT_TZ)`)).toBe(0)
  })

  it('counts a day window with no zone: todayMidnightUtc() bare, toAestDay(d) with one argument', () => {
    expect(countBare(`const m = todayMidnightUtc()`)).toBe(1)
    expect(countBare(`const d = toAestDay(new Date(x))`)).toBe(1)
    expect(countBare(`const d = toAestDay(row.at)`)).toBe(1)
  })

  it('passes the corrected forms — the arity trap', () => {
    expect(countBare(`const m = todayMidnightUtc(tz)`)).toBe(0)
    // A `[^,)]+` regex stops at the inner paren and flags this as one argument.
    expect(countBare(`const d = toAestDay(new Date(x), tz)`)).toBe(0)
    expect(countBare(`const d = toAestDay(new Date(todayMidnightUtc(tz).getTime() - 7 * 86_400_000), tz)`)).toBe(0)
  })

  it('ignores a comment that quotes the call', () => {
    expect(countBare(`// was todayInTz(DEFAULT_TZ), and toAestDay(d)\n/* todayMidnightUtc() */`)).toBe(0)
  })

  it('sums the kinds in one file, so a ratchet row is one number', () => {
    expect(countBare(`a = todayInTz(); b = todayInTz(DEFAULT_TZ); c = toAestDay(x); d = todayMidnightUtc()`)).toBe(4)
  })
})

describe('callsUnderArity', () => {
  it('counts only the commas at the call’s own depth', () => {
    expect(callsUnderArity(`f(a, g(b, c))`, 'f', 2)).toEqual([])
    expect(callsUnderArity(`f(g(b, c))`, 'f', 2)).toEqual(['f(g(b, c))'])
  })

  it('does not count the commas inside an array or object argument', () => {
    expect(callsUnderArity(`f(a, [1, 2, 3], c)`, 'f', 4)).toEqual(['f(a, [1, 2, 3], c)'])
    expect(callsUnderArity(`f(a, [1, 2, 3], c)`, 'f', 3)).toEqual([])
    expect(callsUnderArity(`f({ a: 1, b: 2 })`, 'f', 2)).toEqual(['f({ a: 1, b: 2 })'])
  })

  it('reads an empty argument list as zero arguments', () => {
    expect(callsUnderArity(`f()`, 'f', 1)).toEqual(['f()'])
    expect(callsUnderArity(`f( )`, 'f', 1)).toEqual(['f( )'])
  })

  it('does not match a longer name that ends the same way', () => {
    expect(callsUnderArity(`myToAestDay(x)`, 'toAestDay', 2)).toEqual([])
  })

  it('finds every call, not just the first', () => {
    expect(callsUnderArity(`f(a); f(b, c); f(d)`, 'f', 2)).toEqual(['f(a)', 'f(d)'])
  })
})
