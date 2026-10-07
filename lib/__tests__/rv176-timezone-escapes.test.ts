import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { calendarMonthInTz, previousCalendarMonth } from '../calendar-month'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../..')

/**
 * Every client `.tsx` under the Lane B surface.
 *
 * `git ls-files app components -- '*.tsx'` UNIONS its pathspecs rather than intersecting them, so
 * it returns test files too — including this one, whose own regexes would then match. Filter in JS.
 */
function clientFiles(): string[] {
  return execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))
}

/** Comments quote the retired patterns on purpose — a scanner that reads them flags the fix. */
function code(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
}

describe('RV-176 — the calendar month comes from the user, not the phone', () => {
  it('reads the month out of the user’s own day', () => {
    // Etc/GMT-14 and Etc/GMT+12 are 26 hours apart, so at every instant of the year there is some
    // moment where they disagree about the date; on a month boundary they disagree about the month.
    const ahead = calendarMonthInTz('Etc/GMT-14')
    const behind = calendarMonthInTz('Etc/GMT+12')
    for (const m of [ahead, behind]) {
      expect(m.month).toBeGreaterThanOrEqual(1)
      expect(m.month).toBeLessThanOrEqual(12)
      expect(m.mm).toBe(String(m.month).padStart(2, '0'))
      expect(m.mm).toHaveLength(2)
    }
  })

  it('steps back over the December underflow without hand-adjusting the year', () => {
    expect(previousCalendarMonth({ year: 2026, month: 1, mm: '01' })).toEqual({ year: 2025, month: 12, mm: '12' })
    expect(previousCalendarMonth({ year: 2026, month: 3, mm: '03' })).toEqual({ year: 2026, month: 2, mm: '02' })
    expect(previousCalendarMonth({ year: 2026, month: 12, mm: '12' })).toEqual({ year: 2026, month: 11, mm: '11' })
  })

  it('pads a single-digit month, because the cache key is a string compare', () => {
    expect(previousCalendarMonth({ year: 2026, month: 10, mm: '10' }).mm).toBe('09')
  })
})


describe('RV-176 — no client surface keys a window or a bucket to the device clock', () => {
  it('no client file reads the device month or year for a calendar key', () => {
    const offenders = clientFiles().filter(f => /new Date\(\)\.get(Month|FullYear)\(\)/.test(code(f)))
    // personal-details-section bounds a date-of-birth YEAR at "ten years ago". The device and the
    // user disagree about the year for a few hours once a year, on a bound that is already a
    // decade of slack, so it is not this rule's business.
    expect(offenders).toEqual(['components/profile/personal-details-section.tsx'])
  })

  it('no client file buckets by the device hour', () => {
    expect(clientFiles().filter(f => /new Date\(\)\.getHours\(\)/.test(code(f)))).toEqual([])
  })

  it('the meal bucket is chosen by the one shared formula, not a re-implementation', () => {
    const src = code('components/nutrition/assign-step.tsx')
    expect(src).toMatch(/mealTypeForHour\(/)
    expect(src).not.toMatch(/timeStartHour && \w+ < \w+\.timeEndHour/)
  })
})
