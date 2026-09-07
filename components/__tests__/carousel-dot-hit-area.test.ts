import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Q-160: the session carousel's dots were 7×7 px tap targets. `tap-dense` opts them out of the
 * global 48px floor and nothing put a touch area back.
 *
 * The entry prescribed padding the hit area to 48px. Measured in a browser, that is wrong: the row
 * ran on a 15px pitch, so 48px boxes would overlap by 33px on each side and the sibling painted
 * last would swallow taps meant for the ones before it. The fix is a 24px box on a 24px pitch —
 * WCAG 2.5.8 AA's minimum, and the widest that stays disjoint.
 *
 * This suite guards the invariant that makes it work (box width ≤ pitch) and the fact that no call
 * site hand-rolls the markup again.
 */

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// Both numbers are read from source rather than imported: this project's vitest runs
// `environment: 'node'` with no JSX transform, so importing a .tsx component fails outright.
function dotPitchPx(): number {
  const src = read('components/ui/carousel-dots.tsx')
  const m = src.match(/CAROUSEL_DOT_PITCH_PX = (\d+)/)
  if (!m) throw new Error('CAROUSEL_DOT_PITCH_PX not found')
  return Number(m[1])
}

function hitAreaWidthPx(): number {
  const css = read('app/globals.css')
  const block = css.slice(css.indexOf('.tap-target-dot::before'))
  const m = block.match(/width:\s*(\d+)px/)
  if (!m) throw new Error('.tap-target-dot::before has no width')
  return Number(m[1])
}

describe('carousel dot hit areas (Q-160)', () => {
  it('a dot hit area is never wider than the spacing between dots', () => {
    // The whole point. A box wider than the pitch overlaps its neighbour, and the later sibling
    // wins — which makes the left-hand dots harder to hit than they were at 7px.
    expect(hitAreaWidthPx()).toBeLessThanOrEqual(dotPitchPx())
  })

  it('and is at least the WCAG 2.5.8 AA minimum', () => {
    expect(hitAreaWidthPx()).toBeGreaterThanOrEqual(24)
  })

  it('every dot indicator opts back into a touch area after opting out of the floor', () => {
    // `tap-dense` alone is the defect. These are the standalone indicators — a control whose only
    // purpose is being tapped — as opposed to the inline text buttons the opt-out was written for.
    for (const file of [
      'components/ui/carousel-dots.tsx',        // session, guided-walk preset, run-type
      'components/health/strength-trend-card.tsx', // horizontal pill variant, same touch area
    ]) {
      const src = read(file)
      expect(src, file).toContain('tap-dense')
      expect(src, file).toContain('tap-target-dot')
    }
  })

  it('no call site hand-rolls the dot markup any more', () => {
    // Three copies were byte-identical before this. A fourth would have drifted, like the pill-tab
    // markup did across ~17 sites.
    for (const file of [
      'app/workout-select/workout-select-content.tsx',
      'components/guided-walk/walk-config.tsx',
      'components/running/run-type-carousel.tsx',
    ]) {
      const src = read(file)
      expect(src, file).toContain('CarouselDots')
      expect(src.replace(/\s/g, ''), file).not.toContain('height:i===')
    }
  })
})

/**
 * Q-176: the audit Q-160 asked for found two more `tap-dense` controls with no touch area. They are
 * fixed differently on purpose, and the difference is the whole point of the rule.
 */
describe('the remaining tap-dense controls (Q-176)', () => {
  it('the isolated avatar badge takes an invisible box; nothing sits close enough to overlap', () => {
    const src = read('components/more/profile-tab.tsx')
    expect(src).toContain('tap-target-44')
    // Measured in a browser: zero interactive elements intersect the 44px box, because the avatar
    // behind it is a plain div rather than a control.
  })

  it('the Deload pill grows its real ink instead, because it has an interactive neighbour', () => {
    const src = read('components/workout/pre-workout-screen.tsx')
    // A hit area reaching into the stats button 8px above would win the overlap (later in DOM
    // order) and swallow that button's taps — the exact failure Q-160 measured on the dots.
    // Scoped to the pill's own class string. A bare `py-0.5` search also matches two decorative
    // muscle-group <span>s in this file, which are not tap targets and correctly have no touch area.
    expect(src).toContain('"tap-dense mt-1.5 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium"')
    expect(src).not.toContain('"tap-dense mt-1 inline-flex')
    expect(src).not.toMatch(/tap-target-(44|dot)[^"]*inline-flex/)
  })

  it('the 44px box is still 44px', () => {
    expect(read('components/more/profile-tab.tsx')).toContain('tap-target-44')
    expect(read('app/globals.css')).toMatch(/\.tap-target-44::before[\s\S]*?width:\s*44px/)
  })

  it('the positioning context is layered, so a call site can still be absolute', () => {
    // Measured 2026-09-07: unlayered, this rule beat Tailwind's `absolute` utility outright —
    // unlayered CSS wins over every cascade layer regardless of specificity — and the avatar badge
    // above computed `position: relative`, flowing inline instead of pinning to the corner (x=162
    // rather than x=226 at 412dp). In `@layer components` the utilities layer wins.
    const css = read('app/globals.css')
    expect(css).toMatch(/@layer components \{\s*\.tap-target-44,\s*\.tap-target-dot \{\s*position: relative;/)
  })
})

/**
 * BF-123: the sweep the floor's own rule required and never got. `app/globals.css` sets
 * `button, [role="button"] { min-height: 48px; min-width: 48px }` under 640px, so any control that
 * declares a smaller box renders inflated — a `rounded-full` chip comes out as a circle, which is
 * how the owner reported it on the program editor sheet.
 *
 * The fix is per site and has two halves, and shipping only the first is the accessibility
 * regression the floor exists to prevent. This guard holds the second half: **no control opts out
 * of the floor without putting a touch area back.**
 *
 * `tap-dense` on an inline text button is the exception the opt-out was written for, and the two
 * that remain are listed with the reason. The list is shrink-only: remove a row when it is fixed,
 * never add one without the measurement that justifies it.
 */
describe('every tap-dense control restores a touch area (BF-123)', () => {
  const BARE_TAP_DENSE: Record<string, string> = {
    'components/workout/done-screen.tsx':
      'inline underlined text button in a sentence — the case `.tap-dense` was written for',
    'components/workout/next-workout-card.tsx':
      'same inline underlined text button, other surface',
    'components/workout/pre-workout-screen.tsx':
      'Deload pill — grows its real ink instead, because the stats button 8px above would lose the overlap (Q-176 above)',
  }

  it('holds across every screen and component', () => {
    const files = execSync(
      "grep -rl 'tap-dense' --include=*.tsx app components lib",
      { cwd: root, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)

    // Asserted, not assumed: a glob that matched nothing would report no violations and pass.
    expect(files.length, 'no tap-dense call sites found — this is not measuring anything')
      .toBeGreaterThan(10)

    const bare: string[] = []
    for (const file of files) {
      if (file in BARE_TAP_DENSE) continue
      // Line by line, and comment lines dropped first: `tap-dense` is named in prose in three
      // places, and a regex spanning newlines swallows whole components between two quotes.
      for (const line of read(file).split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
        for (const cls of line.match(/"[^"\n]*\btap-dense\b[^"\n]*"/g) ?? []) {
          if (!/tap-target-44|tap-target-dot|before:/.test(cls)) bare.push(`${file}: ${cls}`)
        }
      }
    }
    expect(bare, 'tap-dense with no touch area — add .tap-target-44 / .tap-target-dot, or grow the ink')
      .toEqual([])
  })
})
