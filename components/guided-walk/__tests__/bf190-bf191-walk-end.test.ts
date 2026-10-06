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
    // `elapsedRef.current` since LB-141: the early exit lives in a stable `endWalk` callback so the
    // back-gesture registration effect does not re-run once a second, and a ref is what keeps it
    // stable.
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

describe('BF-191 — a sub-minute walk is offered as a discard, in ONE dialog', () => {
  const ACTIVE = 'components/guided-walk/walk-active.tsx'
  const DIALOG = 'components/guided-walk/leave-walk-dialog.tsx'
  const STORE = 'lib/stores/guided-walk-store.ts'

  it('below the floor the early exit discards instead of finishing', () => {
    // The constant lives in the store because the dialog and the screen both read it, and neither
    // should import the other for one integer.
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

  it('the dialog offers a save only at or above the floor, and a discard confirm below it', () => {
    const body = stripComments(src(DIALOG))
    expect(body).toMatch(/elapsedSec >= MIN_WALK_SEC/)
    // The save lives inside the `>=` branch; the fall-through is the plain discard confirm.
    const above = body.slice(body.indexOf('elapsedSec >= MIN_WALK_SEC'), body.indexOf('<ConfirmDialog'))
    expect(above).toContain('Save walk')
    expect(body.slice(body.indexOf('<ConfirmDialog'))).not.toContain('Save walk')
  })

  it('no dialog still promises the old sentence the app did not keep', () => {
    // Comments stripped first: a docblock that quotes the retired copy to explain why the dialog
    // decides what exiting offers would otherwise fail this on the explanation rather than a use.
    const body = stripComments(src(DIALOG))
    expect(body).not.toMatch(/will stop it early/)
  })
})

/**
 * #2134 — the guided walk is immersive on purpose: no tab bar, and ONE Exit.
 *
 * LB-141 gave the walk three places that could raise the leave prompt — the End button, the back
 * gesture and the tab bar — and the tab bar's could never fire, because the walk route renders no
 * tab bar. The owner's answer was to keep the walk immersive with a single Exit and delete the dead
 * one. What these pin is that the three did not grow back as three: the button and the gesture are
 * the same prompt, mounted once, on the walk screen that holds what a save needs.
 */
describe('#2134 — one Exit for a walk in progress', () => {
  const ACTIVE = 'components/guided-walk/walk-active.tsx'
  const HANDLER = 'components/mobile-auth-handler.tsx'
  const NAV = 'components/shell/bottom-nav.tsx'

  it('the Exit prompt is mounted in exactly one place, the walk screen', () => {
    // `git ls-files app components -- '*.tsx'` UNIONS its pathspecs, so it also returns every
    // `.test.ts` under those directories — including this file, whose own regex literal contains
    // `<LeaveWalkDialog`. Filter to .tsx outside __tests__.
    const mounts = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter(f => f.endsWith('.tsx') && !f.includes('__tests__'))
      .filter(f => f !== 'components/guided-walk/leave-walk-dialog.tsx' && src(f).includes('<LeaveWalkDialog'))
    expect(mounts).toEqual([ACTIVE])
  })

  it('the Exit button and the back gesture open the same prompt', () => {
    const body = stripComments(src(ACTIVE))
    // The button calls the same function the registry hands the back gesture.
    expect(body).toMatch(/onClick=\{openExit\}/)
    expect(body).toMatch(/registerWalkExit\(openExit\)/)
    // …and the handler asks that screen rather than raising a dialog of its own.
    const handler = stripComments(src(HANDLER))
    expect(handler).toMatch(/if \(requestWalkExit\(\)\) return/)
    expect(handler).not.toContain('LeaveWalkDialog')
    expect(handler).not.toMatch(/guided-walk-store/)
  })

  it('the tab bar knows nothing about a walk — the walk route renders none', () => {
    const nav = stripComments(src(NAV))
    expect(nav).not.toContain('LeaveWalkDialog')
    expect(nav).not.toMatch(/guided-walk/)
  })

  it('discarding a walk above the floor is its own action, not the save path', () => {
    // `endWalk` saves (or discards below the floor); a Discard tapped on a 20-minute walk must
    // reach `onDiscard` whatever the clock says, and must not write a row.
    const body = stripComments(src(ACTIVE))
    expect(body).toMatch(/const discardWalk = useCallback\(\(\) => \{[\s\S]*?onDiscardRef\.current\(\)[\s\S]*?\}, \[\]\)/)
    expect(body).toMatch(/onDiscard=\{discardWalk\}/)
    expect(body).toMatch(/onSave=\{endWalk\}/)
  })

  it('the prompt reads one snapshot of the clock, so its choices cannot change while it is up', () => {
    const body = stripComments(src(ACTIVE))
    expect(body).toMatch(/setExitElapsedSec\(elapsedRef\.current\)/)
    expect(body).toMatch(/elapsedSec=\{exitElapsedSec\}/)
    // Not the ticking value: the 1 Hz state would flip the dialog's variant at the floor.
    expect(body).not.toMatch(/<LeaveWalkDialog[^>]*elapsedSec=\{elapsedSec\}/)
  })
})
