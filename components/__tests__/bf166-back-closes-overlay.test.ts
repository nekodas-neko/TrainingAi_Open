import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  openSurface, closeSurface, resetSheetBackStack, hasOpenSurface, type HistoryLike,
} from '@/lib/hooks/sheet-back-stack'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The handler explains this bug in prose, so a raw-source match would pass on the comment. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

const noopHistory: HistoryLike = { pushState() {}, back() {} }

/**
 * BF-166 — owner: *"If you have a nutrition meal creator menu open and you press the back button -
 * it makes the page behind it go back to main."*
 *
 * **The entry's premise was wrong and the correction is the point of this file.** It proposed
 * building a module-level overlay stack, on the grounds that none existed — its grep looked for
 * `openOverlay|overlayStack|topOverlay`. One exists under different names: `sheet-back-stack.ts`,
 * reached from `BackDismiss`, which `SheetContent` AND `DialogContent` already render. Building a
 * second registry would have left two stacks disagreeing about what is open.
 *
 * **The real defect is narrower.** `openSurface` pushes a history entry with `pushState(state, '')`
 * — no URL — so `window.location.pathname` never moves, and `backActionForPath` reads nothing but
 * the pathname. On a tab route it answers `"home"` and the listener calls `navigateToTab`; on `/` it
 * answers `"minimize"`. Neither touches history, so the pushed entry is never consumed and the page
 * moves out from under an open sheet. Only `"pop"` worked, because `history.back()` is coincidentally
 * the thing that consumes it.
 */
describe('BF-166 — the back listener consults the surface stack it already has', () => {
  beforeEach(() => resetSheetBackStack())

  it('the stack it queries is the one the primitives already push to', () => {
    // Not a new registry: this is the same module BackDismiss drives.
    expect(read('components/ui/sheet.tsx')).toContain('BackDismiss')
    expect(read('components/ui/dialog.tsx')).toContain('BackDismiss')
    expect(read('components/ui/back-dismiss.tsx')).toContain('useSheetBackDismiss')
    expect(read('lib/hooks/use-sheet-back-dismiss.ts')).toContain('sheet-back-stack')
  })

  it('reports an open surface between open and close, and nothing outside', () => {
    expect(hasOpenSurface()).toBe(false)
    const s = openSurface('a', () => {}, noopHistory)
    expect(hasOpenSurface()).toBe(true)
    closeSurface(s, noopHistory)
    expect(hasOpenSurface()).toBe(false)
  })

  it('stays true while an inner surface closes over an outer one', () => {
    // A dialog raised from inside a sheet: closing it must not tell the listener the page is clear.
    const sheet = openSurface('sheet', () => {}, noopHistory)
    const dialog = openSurface('dialog', () => {}, noopHistory)
    closeSurface(dialog, noopHistory)
    expect(hasOpenSurface(), 'the sheet underneath is still open').toBe(true)
    closeSurface(sheet, noopHistory)
    expect(hasOpenSurface()).toBe(false)
  })

  it('the listener pops instead of trusting backActionForPath when a surface is open', () => {
    const handler = code('components/mobile-auth-handler.tsx')
    // The CALL SITE, not the import — a first draft asserted on `indexOf('hasOpenSurface')` and
    // measured the import line, which sits before everything and made the ordering check below
    // pass or fail on nothing. Both assertions here anchor on `hasOpenSurface()` with parentheses.
    expect(handler).toContain('hasOpenSurface()')
    // The guard must sit BEFORE the switch, or "home" still wins on a tab route.
    expect(handler.indexOf('hasOpenSurface()'))
      .toBeLessThan(handler.indexOf('backActionForPath(window.location.pathname)'))
  })

  it('and it sits AFTER the three mode guards, which raise dialogs of their own', () => {
    // LeaveWorkoutDialog and its siblings are Dialogs, so they are ON this stack. Checking overlays
    // first would make a mid-workout back press close the confirmation instead of raising it —
    // the exact guard that listener was added for.
    const handler = code('components/mobile-auth-handler.tsx')
    const guard = handler.indexOf('hasOpenSurface()')
    for (const mode of ['setConfirmLeaveOpen', 'setConfirmLeaveWalkOpen', 'setConfirmLeaveActivityOpen']) {
      expect(handler.indexOf(mode), `${mode} must be checked before the overlay stack`).toBeLessThan(guard)
    }
  })
})
