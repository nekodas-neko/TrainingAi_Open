import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * BF-190 / BF-191 — ending a guided walk early wrote a full session at the PLANNED duration.
 *
 * Measured in production on 2026-09-24: a walk 27 seconds old produced a 40-minute, 133 kcal row,
 * because both exits from `walk-active.tsx` were byte-for-byte the same two-argument callback and
 * the summary could not tell a completed walk from an abandoned one. Calories follow duration
 * alone (`deriveActivityKcal`), so a phantom duration is a phantom calorie count every time.
 *
 * These are source assertions because the flow needs a running walk, a clock and the local store —
 * `getLocalStore` returns null in the sandbox, so the branch that writes the row is the one a
 * browser here cannot reach. The device check is owed and is stated as owed.
 */
describe('BF-190 — the elapsed time reaches the summary', () => {
  const ACTIVE = 'components/guided-walk/walk-active.tsx'
  const SUMMARY = 'components/guided-walk/walk-summary.tsx'
  const CONTENT = 'components/guided-walk/guided-walk-content.tsx'

  it('onFinish carries the elapsed seconds, so the two exits are no longer indistinguishable', () => {
    expect(src(ACTIVE)).toMatch(/onFinish:\s*\([^)]*elapsedSec:\s*number\s*\)/)
    // Both call sites pass it: the natural finish its own `e`, the early exit the state value.
    // Not `[^)]*`: the arguments contain `summary()`, so a lazy stop at the first bracket truncates
    // the call and the assertion below passes on nothing.
    const calls = src(ACTIVE).match(/onFinishRef\.current\(.*\)$/gm) ?? []
    expect(calls).toHaveLength(2)
    // `elapsedRef.current` since LB-141: the early exit moved into a stable `endWalk` callback so
    // the finish-request effect does not re-run once a second, and a ref is what keeps it stable.
    for (const c of calls) expect(c).toMatch(/,\s*(e|elapsedSec|elapsedRef\.current)\)$/)
  })

  it('the container threads it through rather than dropping it at the boundary', () => {
    expect(src(CONTENT)).toMatch(/onFinish=\{\(s,\s*c,\s*e\)\s*=>/)
    expect(src(CONTENT)).toMatch(/elapsedSec=\{elapsedSec\}/)
  })

  it('every wall-clock field is derived from the clock, not the plan', () => {
    const s = src(SUMMARY)
    // The three fields BF-190 named: duration, end time, average pace.
    expect(s).toMatch(/const durationMin = Math\.round\(actualSec \/ 60\)/)
    expect(s).toMatch(/msToHHMMInTz\(startedAtMs \+ actualSec \* 1000\)/)
    expect(s).toMatch(/computeAvgPaceSecPerKm\(distanceKm!,\s*actualSec\)/)
    // …and none of them is still reading plan.totalSec.
    expect(s).not.toMatch(/Math\.round\(plan\.totalSec \/ 60\)/)
    expect(s).not.toMatch(/startedAtMs \+ plan\.totalSec \* 1000/)
  })

  it('the plan still drives the interval STRUCTURE — only wall-clock moved', () => {
    // A guard against over-correcting: the per-segment stats must keep using the plan.
    expect(src(SUMMARY)).toMatch(/buildIntervalPlan\(config\)/)
  })
})

const EXIT_PATHS = ['components/mobile-auth-handler.tsx', 'components/shell/bottom-nav.tsx']

describe('BF-191 — a sub-minute walk is offered as a discard, in ONE dialog', () => {
  const ACTIVE = 'components/guided-walk/walk-active.tsx'
  const DIALOG = 'components/guided-walk/leave-walk-dialog.tsx'
  const STORE = 'lib/stores/guided-walk-store.ts'

  it('below the floor the early exit discards instead of finishing', () => {
    // The constant moved to the store in LB-141 — the tab bar needs the same floor, and importing
    // the walk screen into the shell would pull the whole screen in for one integer.
    expect(src(STORE)).toMatch(/export const MIN_WALK_SEC = 60/)
    expect(src(ACTIVE)).toMatch(
      /if \((?:elapsedSec|elapsedRef\.current) < MIN_WALK_SEC\) \{\s*\n\s*onDiscardRef\.current\(\)/,
    )
  })

  it('is ONE dialog — the existing confirm becomes the discard, not a second prompt', () => {
    // The two-prompt path is the objection the confirm-on-exit alternative lost on, so a second
    // ConfirmDialog in this component is the specific regression to catch.
    const dialogs = src(ACTIVE).match(/<LeaveWalkDialog|<ConfirmDialog/g) ?? []
    expect(dialogs).toHaveLength(1)
  })

  it('every caller states what ending does, because the three genuinely differ', () => {
    // `git ls-files app components -- '*.tsx'` UNIONS its pathspecs, so it also returns every
    // `.test.ts` under those directories — including this file, whose own regex literal contains
    // `<LeaveWalkDialog`. It passed locally only because the file was still untracked. Filter here.
    const callers = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))
      .filter(f => f !== DIALOG && src(f).includes('<LeaveWalkDialog'))
    // Three today: the End-walk button, the back gesture, the tab bar.
    expect(callers.length).toBeGreaterThanOrEqual(3)
    for (const f of callers) {
      const tag = src(f).slice(src(f).indexOf('<LeaveWalkDialog'))
      expect(tag.slice(0, tag.indexOf('/>')), `${f} must name its outcome`).toMatch(/outcome=/)
    }
  })

  /**
   * ⚠ This assertion used to read `outcome="discard"` at both paths, pinning the policy LB-141
   * changed: the owner decided on 2026-09-26 that the back gesture and the tab bar ASK rather than
   * discarding silently. What BF-191 actually guarantees — one prompt, and no offer to save a walk
   * too short to record — is what is asserted now, and it still holds.
   */
  it('the two reset-and-leave paths ask above the floor and discard below it (LB-141)', () => {
    for (const f of EXIT_PATHS) {
      const body = src(f)
      expect(body, `${f} must offer the choice`).toMatch(/outcome="choose"/)
      expect(body, `${f} must keep the short-walk discard`).toMatch(/outcome="discard"/)
      // Guarded against both prompts firing on one exit: the two elements are the arms of a single
      // ternary on the floor, so exactly one can be mounted.
      expect(body.match(/<LeaveWalkDialog/g) ?? []).toHaveLength(2)
      expect(body).toMatch(/>= MIN_WALK_SEC \?/)
    }
  })

  it('saving from an exit runs the walk screen\'s own finish, and does not navigate away', () => {
    // The samples and cadence live in `WalkActive`'s refs and the row is written by
    // `WalkSummary`'s mount, so a save that left the screen would write nothing. These paths must
    // therefore REQUEST the finish rather than reach for `finish()` or a navigation.
    for (const f of EXIT_PATHS) {
      const onSave = src(f).slice(src(f).indexOf('onSave='))
      const body = onSave.slice(0, onSave.indexOf('onStay='))
      // `requestWalkFinish` in the shell, which holds three stores' actions and aliases each.
      expect(body, `${f}'s save must request the finish`).toMatch(/request(?:Walk)?Finish\(\)/)
      expect(body, `${f}'s save must not navigate or leave`).not.toMatch(/navigateWithTransition|leaveScreen/)
    }
  })

  it('the request flag never survives a reload, or it ends the next walk on launch', () => {
    const store = src(STORE)
    expect(store).toMatch(/state\.finishRequested = false/)
    // Cleared before the finish runs, since the finish unmounts the screen that would clear it.
    expect(src(ACTIVE)).toMatch(/clearFinishRequest\(\)\s*\n\s*endWalk\(\)/)
  })

  it('no dialog still promises the old sentence the app did not keep', () => {
    // Comments stripped first: this file's own docblock quotes the retired copy to explain why the
    // `outcome` prop exists, and asserting over it would fail on the explanation rather than a use.
    const body = stripComments(src(DIALOG))
    expect(body).not.toMatch(/will stop it early/)
  })
})
