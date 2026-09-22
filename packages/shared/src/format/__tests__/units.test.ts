/**
 * RV-90 — one rendering per quantity, and the unit spacing decided once.
 *
 * Each of these was a per-site decision, so one stored number read differently depending on the
 * screen. The weigh-in in the entry is the reference case: **82.45 kg** showed as `82.45 kg` on
 * Home, `82.5 kg` on day detail and `82.45kg` — raw and without the space — in the week-day sheet.
 */
import { describe, it, expect } from 'vitest'
import { formatKg, formatMinutes, formatHoursMinutes } from '@trainingai/shared/format/units'
import { formatPace, formatPaceValue } from '@trainingai/shared/health/vdot'

describe('formatKg', () => {
  it('settles the entry\'s reference weigh-in on one rendering', () => {
    expect(formatKg(82.45)).toBe('82.5 kg')
  })

  /** The space is the decision nobody made deliberately — `${kg}kg` and `${kg} kg` look alike. */
  it('always puts a space before the unit', () => {
    expect(formatKg(80)).toBe('80.0 kg')
    expect(formatKg(80)).not.toContain('0kg')
  })

  it('pads to the decimal so a whole number does not jump width in a tabular column', () => {
    expect(formatKg(80)).toBe('80.0 kg')
    expect(formatKg(80.5)).toBe('80.5 kg')
  })

  /** Day detail renders the number and the unit as separate elements at different sizes. */
  it('can give the bare value for a caller that renders the unit itself', () => {
    expect(formatKg(82.45, { unit: false })).toBe('82.5')
  })

  /** The stats grid's whole-number summary is a deliberate choice, so it asks rather than diverges. */
  it('takes a decimal count for the surfaces that want one', () => {
    expect(formatKg(82.45, { decimals: 0 })).toBe('82 kg')
    expect(formatKg(82.45, { decimals: 2 })).toBe('82.45 kg')
  })

  /** Half away from zero, so the .x5 case does not land on the binary-representation side. */
  it('rounds .45 up rather than down', () => {
    expect(formatKg(82.45, { decimals: 1 })).toBe('82.5 kg')
    expect(formatKg(1.005, { decimals: 2 })).toBe('1.01 kg')
  })
})

describe('formatMinutes', () => {
  /**
   * The done screen showed `.toFixed(1)` while every other surface rounded, so a 42.4-minute run
   * read 42.4 once and 42 on every reopen. A tenth of a minute is six seconds.
   */
  it('agrees with the surfaces that round, on the entry\'s example', () => {
    expect(formatMinutes(42.4)).toBe('42 min')
    expect(formatMinutes(42.6)).toBe('43 min')
  })

  it('can give the bare value for a caller with its own unit label', () => {
    expect(formatMinutes(42.4, { unit: false })).toBe('42')
  })
})

describe('formatHoursMinutes', () => {
  /** The shape `day-sections.tsx`'s own comment already described, now held for every caller. */
  it('pads the minutes past the hour and drops the hour below it', () => {
    expect(formatHoursMinutes(65)).toBe('1h 05m')
    expect(formatHoursMinutes(47)).toBe('47m')
  })

  it('is exact on the hour boundary', () => {
    expect(formatHoursMinutes(59)).toBe('59m')
    expect(formatHoursMinutes(60)).toBe('1h 00m')
  })

  it('rounds a fractional minute rather than truncating it', () => {
    expect(formatHoursMinutes(59.6)).toBe('1h 00m')
  })

  it('handles zero and long durations', () => {
    expect(formatHoursMinutes(0)).toBe('0m')
    expect(formatHoursMinutes(605)).toBe('10h 05m')
  })
})

describe('pace — one name, one meaning', () => {
  /**
   * Three functions called `formatPace` existed with three contracts: `5:12/km` in vdot, `5:12` in
   * pace-bar-chart, and `5:12 /km` in activity-detail-sheet. Same name, three meanings, and two
   * different renderings on screen. Splitting value from unit is what makes one of them enough.
   */
  it('gives the bare value for an axis tick and the united one for a stat', () => {
    expect(formatPaceValue(312)).toBe('5:12')
    expect(formatPace(312)).toBe('5:12/km')
  })

  it('pads the seconds', () => {
    expect(formatPaceValue(305)).toBe('5:05')
    expect(formatPace(305)).toBe('5:05/km')
  })

  it('rounds to the second and carries into the minute', () => {
    expect(formatPaceValue(359.6)).toBe('6:00')
  })

  /**
   * A live bug, in the shared function AND in both copies of it: they split the minute with
   * `Math.floor` and then rounded the remainder, so any pace in [5:59.5, 6:00) printed the literal
   * **"5:60"** — Math.floor took the minute before Math.round carried into it. Rounding the total
   * first is the fix, and this is the case that proves it.
   */
  it('never prints a 60 in the seconds slot', () => {
    for (const sec of [59.5, 59.9, 119.6, 359.5, 359.99, 3599.7]) {
      expect(formatPaceValue(sec), `${sec} sec/km`).not.toMatch(/:60$/)
    }
    expect(formatPaceValue(359.5)).toBe('6:00')
    expect(formatPaceValue(59.9)).toBe('1:00')
    expect(formatPaceValue(3599.7)).toBe('60:00')
  })

  /** The united form is built from the bare one, so they can never drift apart. */
  it('builds the united form from the bare one', () => {
    for (const sec of [0, 61, 312, 599.5, 3600]) {
      expect(formatPace(sec)).toBe(`${formatPaceValue(sec)}/km`)
    }
  })
})
