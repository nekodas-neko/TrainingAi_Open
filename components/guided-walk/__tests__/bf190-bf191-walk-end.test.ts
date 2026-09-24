import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

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
    for (const c of calls) expect(c).toMatch(/,\s*(e|elapsedSec)\)$/)
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

  it('below the floor the early exit discards instead of finishing', () => {
    const s = src(ACTIVE)
    expect(s).toMatch(/export const MIN_WALK_SEC = 60/)
    expect(s).toMatch(/if \(elapsedSec < MIN_WALK_SEC\) \{\s*\n\s*onDiscardRef\.current\(\)/)
  })

  it('is ONE dialog — the existing confirm becomes the discard, not a second prompt', () => {
    // The two-prompt path is the objection the confirm-on-exit alternative lost on, so a second
    // ConfirmDialog in this component is the specific regression to catch.
    const dialogs = src(ACTIVE).match(/<LeaveWalkDialog|<ConfirmDialog/g) ?? []
    expect(dialogs).toHaveLength(1)
  })

  it('every caller states what ending does, because the three genuinely differ', () => {
    const callers = execFileSync('git', ['ls-files', 'app', 'components', '--', '*.tsx'], {
      cwd: ROOT, encoding: 'utf8',
    }).split('\n').filter(Boolean).filter(f => f !== DIALOG && src(f).includes('<LeaveWalkDialog'))
    // Three today: the End-walk button, the back gesture, the tab bar.
    expect(callers.length).toBeGreaterThanOrEqual(3)
    for (const f of callers) {
      const tag = src(f).slice(src(f).indexOf('<LeaveWalkDialog'))
      expect(tag.slice(0, tag.indexOf('/>')), `${f} must name its outcome`).toMatch(/outcome=/)
    }
  })

  it('the reset-and-leave paths say discard, since they keep nothing at any duration', () => {
    for (const f of ['components/mobile-auth-handler.tsx', 'components/shell/bottom-nav.tsx']) {
      const tag = src(f).slice(src(f).indexOf('<LeaveWalkDialog'))
      expect(tag.slice(0, tag.indexOf('/>'))).toMatch(/outcome="discard"/)
    }
  })

  it('no dialog still promises the old sentence the app did not keep', () => {
    // Comments stripped first: this file's own docblock quotes the retired copy to explain why the
    // `outcome` prop exists, and asserting over it would fail on the explanation rather than a use.
    const body = src(DIALOG).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(body).not.toMatch(/will stop it early/)
  })
})
