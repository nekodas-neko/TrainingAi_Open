import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatDateDisplay } from '@trainingai/shared/date-utils'

/** LB-126. `formatDateDisplay` gained `weekday`, `weekday-date` and `weekday-date-long` in LB-125
 *  (Lane A, #1404); these are the call sites that were spelling those option bags themselves.
 *
 *  RV-91 filed the original complaint and closed with four hand-rolled bags "noted, not filed" —
 *  so the value of this is that one place decides how a date reads, which is what stopped the
 *  activity screens printing a raw ISO string next to a formatted time in the first place. */

const ROOT = path.resolve(__dirname, '../..')

const CONVERTED = [
  'components/nutrition/weekly-nutrition-chart.tsx',
  'app/session-select/components/recommendation-card.tsx',
  'app/session-select/components/week-day-sheet.tsx',
  'app/nutrition/nutrition-content.tsx',
]

describe('LB-126 — the weekday labels come from the shared formatter', () => {
  it('reproduces exactly what the hand-rolled bags produced', () => {
    // The whole justification for the swap. Asserted against the literal strings rather than
    // against a re-derivation, so a change to the shared options cannot move these silently.
    expect(formatDateDisplay('2026-09-15', 'weekday')).toBe('Tue')
    expect(formatDateDisplay('2026-09-15', 'weekday-date')).toBe('Tue, 15 Sept')
    expect(formatDateDisplay('2026-09-15', 'weekday-date-long')).toBe('Tuesday 15 Sept')
    // Two of these sites hold `YYYY/MM/DD`, which `localDateString()` emits.
    expect(formatDateDisplay('2026/09/15', 'weekday-date-long')).toBe('Tuesday 15 Sept')
  })

  it('the converted sites no longer spell their own option bag', () => {
    for (const f of CONVERTED) {
      const src = readFileSync(path.join(ROOT, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(src, `${f} hand-rolls a weekday option bag again`).not.toMatch(/weekday:\s*['"]/)
      expect(src, `${f} does not use the shared formatter`).toMatch(/formatDateDisplay\(/)
    }
  })

  it('and no weekday option bag is left anywhere the formatter could take', () => {
    // `git ls-files a b -- '*.tsx'` does NOT filter — git unions the pathspecs — so the extension
    // is filtered here. `__tests__` is excluded because a test stating this rule must quote it.
    const files = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))

    const offenders = files.filter(f =>
      /weekday:\s*['"](short|long)['"]/.test(
        readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      ),
    )
    expect(offenders, 'a weekday label is being formatted at the call site again — use '
      + 'formatDateDisplay with one of the shared styles').toEqual([])
  })

  it('the calendar month label is deliberately NOT converted', () => {
    // LB-126 listed it as a fifth call site. It is not one: it renders a MONTH and YEAR from
    // `(viewYear, viewMonth - 1, 1)`, and `formatDateDisplay` takes a `YYYY-MM-DD` STRING and has
    // no month-year style. Converting it would need a new style, which is Lane A's.
    const src = readFileSync(path.join(ROOT, 'components/calendar-widget.tsx'), 'utf8')
    expect(src).toMatch(/month:\s*["']long["'],\s*\n?\s*year:\s*["']numeric["']/)
    expect(formatDateDisplay('2026-09-15', 'long')).not.toMatch(/2026/)
  })
})
