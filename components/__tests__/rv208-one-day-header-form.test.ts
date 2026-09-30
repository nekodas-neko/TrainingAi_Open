import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatDateDisplay } from '@trainingai/shared/date-utils'
import { stripComments } from '../../scripts/lib/strip-comments.js'

/**
 * RV-208 ④ — one date form for a day-scoped header.
 *
 * Three surfaces head themselves with the day they are showing, and each picked a different style
 * from `formatDateDisplay`. Rendered rather than read, because `en-AU` does not behave the way any
 * of these names suggests:
 *
 *   | surface                | was                 | rendered                |
 *   |------------------------|---------------------|-------------------------|
 *   | Health → Day           | `long`              | `Saturday 26 September` |
 *   | Nutrition tab          | `weekday-date`      | `Sat, 26 Sept`          |
 *   | Week-day sheet         | `weekday-date-long` | `Saturday 26 Sept`      |
 *
 * `long` wins on two measured grounds, not on taste. It is the only one of the three that is
 * internally consistent — `weekday-date-long` pairs a LONG weekday with the SHORT month, and
 * `en-AU`'s short months are ragged-width (June, July, Sept are four characters, so a column of
 * them does not line up). And `weekday-date` is the only one carrying a comma, because `en-AU`
 * emits one after a short weekday and not after a long one: a quirk `formatDateDisplay`'s docstring
 * already records as the likeliest origin of a wrong string in a comment.
 *
 * `'short'` is NOT in scope and must not be swept in. `25 Sept` is a compact ROW label — the
 * activity history list, the goals list, the profile details list — which is a different job from a
 * screen heading, and RV-208 lists it under numbers, not dates.
 */

const ROOT = path.resolve(__dirname, '../..')

/** The three day-scoped headers, and the expression each must hold. */
const HEADERS = [
  'app/health/day/day-detail-content.tsx',
  'app/nutrition/nutrition-content.tsx',
  'app/session-select/components/week-day-sheet.tsx',
]

const OTHER_STYLES = ['weekday-date-long', 'weekday-date', 'weekday'] as const

describe('RV-208 ④ — one day-header date form', () => {
  it('renders the string the three headers now agree on', () => {
    // Pinned against the literal, not a re-derivation: a change to the shared option bag must fail
    // here rather than move three screens silently.
    expect(formatDateDisplay('2026-09-26', 'long')).toBe('Saturday 26 September')
    // And the two it replaced, so the table above cannot rot into a description of nothing.
    expect(formatDateDisplay('2026-09-26', 'weekday-date')).toBe('Sat, 26 Sept')
    expect(formatDateDisplay('2026-09-26', 'weekday-date-long')).toBe('Saturday 26 Sept')
  })

  it('every day-scoped header asks for `long`, and none asks for another style', () => {
    for (const f of HEADERS) {
      const src = stripComments(readFileSync(path.join(ROOT, f), 'utf8'))
      expect(src, `${f} no longer formats its header date through the shared formatter`)
        .toMatch(/formatDateDisplay\(\s*[^)]*?,\s*['"]long['"]\s*\)/)
      for (const style of OTHER_STYLES) {
        expect(src, `${f} heads itself with '${style}' again — RV-208 ④ settled on 'long'`)
          .not.toMatch(new RegExp(`formatDateDisplay\\([^)]*['"]${style}['"]`))
      }
    }
  })

  it('and the relative shortcut stays, because a header for TODAY is not a date', () => {
    // Nutrition answers `Today`/`Yesterday` before it reaches any style, and unifying the form must
    // not have deleted that — a heading reading `Tuesday 30 September` on the day you are looking at
    // is worse than the inconsistency this fixes. Health → Day has no such branch (it is reached
    // from a calendar tap, where the day is the thing you chose), which is why this is asserted on
    // the one site that has it rather than on all three.
    const src = stripComments(
      readFileSync(path.join(ROOT, 'app/nutrition/nutrition-content.tsx'), 'utf8'))
    expect(src).toMatch(/return 'Today'/)
    expect(src).toMatch(/return 'Yesterday'/)
  })
})
