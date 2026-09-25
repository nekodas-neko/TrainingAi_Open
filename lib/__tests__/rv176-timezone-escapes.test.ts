import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { calendarMonthInTz, previousCalendarMonth } from '../calendar-month'

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
  return readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
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


/**
 * Calls to `name` that pass fewer than `minArgs` arguments — the shape that omits the timezone.
 *
 * Arity is per-function and that matters: the tz is `todayMidnightUtc`'s FIRST argument but
 * `toAestDay`'s SECOND, so one rule cannot cover both. Nor can a regex: `toAestDay\([^,)]+\)`
 * matches the corrected `toAestDay(new Date(x), tz)` by stopping at the inner `)`. Balance the
 * parens and count the commas that sit at the call's own depth.
 */
function callsUnderArity(src: string, name: string, minArgs: number): string[] {
  const hits: string[] = []
  const re = new RegExp(`\\b${name}\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let commas = 0
    let body = ''
    let i = m.index + m[0].length
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) break }
      else if (c === ',' && depth === 1) commas++
      body += c
    }
    const args = body.trim() === '' ? 0 : commas + 1
    if (args < minArgs) hits.push(src.slice(m.index, i + 1))
  }
  return hits
}

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

  it('the tz-less day-window helpers have no client callers left', () => {
    const offenders = clientFiles().filter(f =>
      callsUnderArity(code(f), 'todayMidnightUtc', 1).length > 0 ||
      callsUnderArity(code(f), 'toAestDay', 2).length > 0)
    expect(offenders).toEqual([])
  })

  it('the readiness/activity detail screen no longer keys every user to Brisbane', () => {
    const src = code('components/health/health-score-detail.tsx')
    expect(src).not.toMatch(/todayInTz\(DEFAULT_TZ\)/)
    expect(src).toMatch(/todayInTz\(tz\)/)
  })

  it('the meal bucket is chosen by the one shared formula, not a re-implementation', () => {
    const src = code('components/nutrition/assign-step.tsx')
    expect(src).toMatch(/mealTypeForHour\(/)
    expect(src).not.toMatch(/timeStartHour && \w+ < \w+\.timeEndHour/)
  })
})
