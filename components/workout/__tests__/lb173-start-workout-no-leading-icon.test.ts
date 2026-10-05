import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LB-173 — the pre-workout screen's primary action button carries no decorative leading icon.
 *
 * **The decision this pins, because the backlog entry holding it is removed when it ships.** Review
 * sweep 63 asked that the two "Start Workout" buttons "use the same variant" and did not say which.
 * The Orchestrator settled it on 2026-09-28 by measuring the app rather than by preference: of 43
 * full-width primary `<Button>`s across `components/**` and `app/**`, **33 are text-only and 10 carry
 * a decorative leading icon — 77%**. So the icon-less form is the house convention and this screen's
 * dumbbell was the outlier. (The 8 buttons rendering a `Loader2`/`RefreshCw` spinner while busy were
 * excluded as state indicators, not leading icons — counting them would have read 18 v 33.)
 *
 * **Two dumbbells, not one, and that is the part the entry missed.** `Start Workout` and
 * `Continue Workout` are adjacent states of ONE primary-action slot in this component, and both
 * carried `DumbbellIcon`. Stripping only the state the entry named would have made the icon appear
 * and vanish as the workout started — an inconsistency inside one button, which is worse than the
 * one between screens it was sent to fix.
 *
 * **What is deliberately still allowed**, and why this guard names the glyph rather than banning all
 * icons:
 *   - `RefreshCwIcon` on the `Preparing…` state — a spinner is a state indicator, on the entry's own
 *     reasoning for excluding the other 8.
 *   - `CheckIcon` on `Complete Workout` and `Done for today` — a completion mark carries meaning the
 *     text does not, and the entry never measured those. The resulting rule is coherent: the two
 *     ACTION states are text-only, the two COMPLETION states keep their check.
 *
 * A source-text guard rather than a render: what is being pinned is that a future sweep does not
 * re-add the glyph, and the two labels are in four mutually-exclusive JSX branches that no single
 * render reaches.
 */

const SRC = readFileSync(join(__dirname, '..', 'pre-workout-screen.tsx'), 'utf8')

const LINES = SRC.split('\n')

/**
 * The rendered content of the JSX branch whose label is `label`, back to the nearest `<Button`.
 *
 * Keyed on a line that IS the label — a JSX text node, or the bare string literal a branch collapses
 * to once its icon is gone — never on a substring. A plain `indexOf` matched the word "Complete
 * Workout" inside the comment above the block and walked backwards from there, reporting no `<Button>`
 * above it; the guard was wrong, not the component.
 */
function branchFor(label: string): string {
  const line = LINES.findIndex(l => l.trim() === label || l.trim() === `"${label}"`)
  expect(line, `no JSX line is exactly "${label}" any more — this guard has gone stale`)
    .toBeGreaterThan(-1)
  const at = LINES.slice(0, line).join('\n').length
  const from = SRC.lastIndexOf('<Button', at)
  expect(from, `no <Button> above "${label}"`).toBeGreaterThan(-1)
  return SRC.slice(from, at)
}

describe('LB-173 — the pre-workout primary action has no decorative leading icon', () => {
  // Both action states, because both carried one. Asserted separately so a failure names which.
  for (const label of ['Start Workout', 'Continue Workout']) {
    it(`${label} renders no DumbbellIcon`, () => {
      expect(branchFor(label), `${label} regained a decorative leading icon — see this file's header`)
        .not.toMatch(/<DumbbellIcon/)
    })
  }

  it('no DumbbellIcon survives anywhere in the file, import included', () => {
    // The import is the cheap tell that a re-add is coming, and an unused one would fail lint first.
    expect(SRC).not.toMatch(/DumbbellIcon/)
  })

  // The negative controls. Without these the test above passes just as well against a file that had
  // every icon stripped, or one where the labels moved — which is the RV-208 lesson: a guard that
  // cannot distinguish the fix from collateral damage is not checking what it claims.
  it('the Preparing… spinner is untouched', () => {
    expect(branchFor('Preparing…')).toMatch(/<RefreshCwIcon[^>]*animate-spin/)
  })

  it('the two completion states keep their check', () => {
    expect(branchFor('Complete Workout')).toMatch(/<CheckIcon/)
    expect(SRC).toMatch(/<CheckIcon[^>]*\/>\s*\n\s*Done for today/)
  })
})
