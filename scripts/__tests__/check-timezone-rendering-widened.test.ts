/**
 * RV-179 — `check-timezone-rendering` matched `toLocale(Date|Time)String` and nothing else.
 *
 * The same bug has other spellings, and the widening is only worth having if it catches those without
 * flagging the 128 `.toLocaleString()` calls that format numbers. These drive the pure scan function
 * directly, one construct at a time, with the benign neighbour of each beside it. The real tree is
 * `pnpm check:rules`'s job, not this file's: running the script here would also scan the fixture
 * copies the comment-blindness suite writes beside it while the two run together.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findOffenderLines } = require('../check-timezone-rendering.js') as { findOffenderLines: (src: string) => number[] }

describe('findOffenderLines', () => {
  it('still catches the original pair, and honours an explicit timeZone', () => {
    expect(findOffenderLines(`const a = d.toLocaleTimeString('en-AU')`)).toEqual([1])
    expect(findOffenderLines(`const a = d.toLocaleDateString('en-AU', { timeZone: tz })`)).toEqual([])
    expect(findOffenderLines(`const a = d.toLocaleDateString('en-AU', {\n  day: 'numeric',\n  timeZone: tz,\n})`)).toEqual([])
  })

  describe('.toLocaleString on a date', () => {
    it('catches a `new Date(…)` receiver and a date-field option bag', () => {
      expect(findOffenderLines(`x = new Date(s.createdAt).toLocaleString('en-AU')`)).toEqual([1])
      expect(findOffenderLines(`x = when.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit' })`)).toEqual([1])
      expect(findOffenderLines(`x = when.toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })`)).toEqual([1])
      expect(findOffenderLines(`x = when.toLocaleString(undefined, { hour12: false })`)).toEqual([1])
      expect(findOffenderLines(`x = when.toLocaleString('en-AU', {\n  weekday: 'short',\n})`)).toEqual([1])
    })

    it('does not touch a number: bare, or with a numeric option bag', () => {
      expect(findOffenderLines(`x = total.toLocaleString()`)).toEqual([])
      expect(findOffenderLines(`x = grams.toLocaleString(undefined, { maximumFractionDigits: 2 })`)).toEqual([])
      expect(findOffenderLines(`x = price.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })`)).toEqual([])
    })

    it('is not fooled by the word "day:" in prose beside a number', () => {
      // The first draft matched `day\\s*:` anywhere in the window and flagged a JSX aria-label.
      expect(findOffenderLines('const l = `Energy across the day: ${eaten.toLocaleString()} kcal`')).toEqual([])
    })

    it('passes a date rendering that names its zone', () => {
      expect(findOffenderLines(`x = new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeZone: tz })`)).toEqual([])
    })
  })

  describe('Intl.DateTimeFormat', () => {
    it('catches a formatter built without a zone, and passes one built with it', () => {
      expect(findOffenderLines(`const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit' })`)).toEqual([1])
      expect(findOffenderLines(`const f = new Intl.DateTimeFormat('en-GB', {\n  hour: '2-digit',\n  timeZone: tz,\n})`)).toEqual([])
    })

    it('does not mistake reading the device zone for rendering in it', () => {
      expect(findOffenderLines(`const z = Intl.DateTimeFormat().resolvedOptions().timeZone`)).toEqual([])
    })
  })

  describe('device-clock getters', () => {
    it('catches getHours / getMinutes / getSeconds, which cannot take a zone at all', () => {
      expect(findOffenderLines(`const h = now.getHours()`)).toEqual([1])
      expect(findOffenderLines(`const m = d.getMinutes()`)).toEqual([1])
      expect(findOffenderLines(`const s = d.getSeconds()`)).toEqual([1])
    })

    it('leaves the calendar getters alone: a component-built Date carries a date, not an instant', () => {
      expect(findOffenderLines(`const y = d.getFullYear(), m = d.getMonth(), day = d.getDate()`)).toEqual([])
    })
  })

  it('ignores every one of them inside a comment', () => {
    const src = [
      `// never now.getHours() or d.toLocaleDateString('en-AU')`,
      `/* new Date(x).toLocaleString('en-AU') and new Intl.DateTimeFormat('en', { hour: 'numeric' }) */`,
    ].join('\n')
    expect(findOffenderLines(src)).toEqual([])
  })
})
