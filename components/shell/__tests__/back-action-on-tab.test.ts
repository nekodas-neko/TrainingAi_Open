import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { backActionForPath, TABS } from '../tabs'

/**
 * LB-107 — the owner asked for this by name: *"when you press back on a tab and there is no
 * where to go it should go to the home screen."*
 *
 * It was not absent handling. `mobile-auth-handler.tsx` registers a Capacitor `backButton`
 * listener, which SUPPRESSES the Android default, and then called `window.history.back()` for
 * every path but `/`. The shell flips tabs with `history.replaceState` — tabs are peers, not a
 * trail — so a tab route has nothing to pop and that call was a silent no-op. Back was dead on
 * four of the five tabs.
 *
 * The pass test is the S25 hardware gesture, which the harness cannot send. What IS pinnable is
 * the decision the listener makes from a path, which is where the bug lived.
 */

const ROOT = join(__dirname, '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Comments stripped: both files describe this fix in prose. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

describe('LB-107 — back from a tab lands on Home', () => {
  it('sends every non-home tab to Home', () => {
    const nonHome = TABS.filter((t) => t.href !== '/')
    expect(nonHome).toHaveLength(4)
    for (const tab of nonHome) {
      expect(backActionForPath(tab.href), tab.href).toBe('home')
    }
  })

  it('still minimizes from Home, which is the one tab with nowhere above it', () => {
    expect(backActionForPath('/')).toBe('minimize')
  })

  it('leaves a real push alone — sub-routes pop, they do not jump to Home', () => {
    for (const path of ['/nutrition/meal/123', '/health/day', '/more/settings', '/activity']) {
      expect(backActionForPath(path), path).toBe('pop')
    }
  })

  it('treats the full-screen workout route as a push, not a tab flip', () => {
    // tabKeyForHref deliberately returns null for "/workout?session=…" — a real navigation.
    expect(backActionForPath('/workout?session=abc')).toBe('pop')
    expect(backActionForPath('/workout')).toBe('home')
  })

  it('the listener asks backActionForPath rather than branching on the path itself', () => {
    const handler = code('components/mobile-auth-handler.tsx')
    expect(handler).toContain('backActionForPath')
    // The regression is a bare history.back() reached from a tab route. It survives only
    // inside the "pop" branch now.
    expect(handler).not.toMatch(/pathname === "\/"\s*\)\s*\{\s*App\.minimizeApp/)
  })

  it('going Home keeps the shell — no location assignment in the back path', () => {
    const handler = code('components/mobile-auth-handler.tsx')
    expect(handler).toContain('navigateToTab')
  })

  it('the shell still replaces rather than pushes, which is what makes the tab case empty', () => {
    expect(code('components/shell/tab-shell.tsx')).toContain('window.history.replaceState')
  })
})
