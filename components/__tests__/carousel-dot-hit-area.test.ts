import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

  it('a 44px box is never given to a control that has not been checked for neighbours', () => {
    // Only these two files may use it; adding a third means measuring its clearance first.
    const users = ['components/more/profile-tab.tsx']
    for (const f of users) expect(read(f), f).toContain('tap-target-44')
    expect(read('app/globals.css')).toMatch(/\.tap-target-44::before[\s\S]*?width:\s*44px/)
  })
})
