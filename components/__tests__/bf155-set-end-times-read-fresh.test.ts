import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useWorkoutStore } from '@/lib/stores/workout-store'

/**
 * BF-155 (b) — the root cause, as opposed to the card that displayed it.
 *
 * Owner: *"my amrap week all has under 5mins workout time."* The symptom was a 38.3-minute session
 * printing as 3, but the cause is that the last set of EVERY exercise has been losing its
 * `set_end_ms` since the auto-advance-to-summary change (2026-07-28).
 *
 * `handleLogCurrentSet` appends the set's end time and then calls `handleCompleteSet`
 * **synchronously in the same tick**. That function snapshotted `store.setEndMsArray` from the
 * component's reactive pick — which has not re-rendered yet — so the value it copied was the one
 * from before the append. `currentSet` had already been fixed for exactly this reason, nine lines
 * above, by reading `useWorkoutStore.getState()` instead; the timing arrays were missed.
 *
 * **Measured in production, and the numbers are unambiguous.** `count(set_end_ms)` equals
 * `sets − exercises` on all 33 sessions from 2026-07-30 to 2026-09-13, and `sets` on the 42 before
 * it — one missing per exercise, every session, for six weeks. On a two-set exercise that costs one
 * of two and nothing visible happens. On a ONE-set exercise it costs the only one, which leaves
 * `logExerciseFromPayload` with no `lastSetEndMs`, collapses every exercise onto `workoutStartedAt`,
 * and is why the owner noticed in his AMRAP week rather than earlier.
 *
 * So the entry's dating — *"every session since 6 September"* — is the symptom's, not the defect's.
 * What changed in September was one set per exercise, not the bug.
 */

const root = join(__dirname, '..', '..')
const src = readFileSync(join(root, 'components/workout-screen.tsx'), 'utf8')
// Comments quote the broken form while explaining it, so a raw-source match would pass on prose.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the timing arrays are snapshotted from the live store', () => {
  it('reads setEndMsArray fresh, not from the reactive pick', () => {
    expect(code).toMatch(/snapSetEndTimes\s*=\s*\[\.\.\.hot\.setEndMsArray\]/)
    expect(code).not.toMatch(/snapSetEndTimes\s*=\s*\[\.\.\.store\.setEndMsArray\]/)
  })

  it('reads setStartMsArray the same way', () => {
    // Not currently reachable in the same tick — `appendSetStartMs` fires on "Start Set", a separate
    // interaction — but it sits on the same line as its broken sibling and would fail identically
    // the moment anything called it synchronously. Fixed together rather than left as the next one.
    expect(code).toMatch(/snapSetStartTimes\s*=\s*\[\.\.\.hot\.setStartMsArray\]/)
    expect(code).not.toMatch(/snapSetStartTimes\s*=\s*\[\.\.\.store\.setStartMsArray\]/)
  })

  it('does not list the arrays as reactive dependencies', () => {
    // Listing them would imply the body reads them reactively, which is the defect. The guard is on
    // the dependency array specifically — `store.setEndMsArray` must not appear anywhere in code.
    expect(code).not.toMatch(/store\.setEndMsArray/)
    expect(code).not.toMatch(/store\.setStartMsArray/)
  })
})

describe('the store semantics the fix depends on', () => {
  beforeEach(() => {
    useWorkoutStore.getState().clearSetTimingArrays()
  })

  it('getState() sees an append made in the same tick', () => {
    // This is the whole reason `hot` is correct: zustand's set is synchronous, so a read through
    // getState() immediately after the append includes it. If this ever stopped holding, the fix
    // above would be silently wrong.
    const s = useWorkoutStore.getState()
    s.appendSetEndMs(1_700_000_000_000)
    expect(useWorkoutStore.getState().setEndMsArray).toEqual([1_700_000_000_000])
  })

  it('a reference captured BEFORE the append does not see it — the bug, reproduced', () => {
    // The component's reactive pick is exactly such a captured reference: it is the array as of the
    // last render. Appending does not mutate it, it replaces it on the store.
    const captured = useWorkoutStore.getState().setEndMsArray
    useWorkoutStore.getState().appendSetEndMs(1_700_000_000_000)
    expect(captured).toEqual([])
    expect(useWorkoutStore.getState().setEndMsArray).toEqual([1_700_000_000_000])
  })

  it('a one-set exercise loses its ONLY end time under the old read, and none under the new', () => {
    // The two production shapes side by side. `sets − exercises` is 0 for a one-set exercise, which
    // is the case that reached `logExerciseFromPayload` with nothing to stamp.
    const stale = useWorkoutStore.getState().setEndMsArray   // pre-append: what `store.` gave
    useWorkoutStore.getState().appendSetEndMs(1_700_000_000_000)
    const fresh = useWorkoutStore.getState().setEndMsArray   // what `hot.` gives

    expect(stale).toHaveLength(0)
    expect(fresh).toHaveLength(1)
    // And what each hands the payload builder: `.at(-1)` of nothing is undefined, which is the
    // second rung of the `lastSetEndMs ?? workoutStartedAt ?? now` fallback.
    expect(stale.at(-1)).toBeUndefined()
    expect(fresh.at(-1)).toBe(1_700_000_000_000)
  })

  it('a two-set exercise loses the last of two, which is why it stayed invisible', () => {
    const s = useWorkoutStore.getState()
    s.appendSetEndMs(1_700_000_000_000)   // set 1: a re-render happens before set 2 is logged
    const stale = useWorkoutStore.getState().setEndMsArray
    useWorkoutStore.getState().appendSetEndMs(1_700_000_060_000)  // set 2, same tick as complete
    const fresh = useWorkoutStore.getState().setEndMsArray

    expect(stale).toHaveLength(1)
    expect(fresh).toHaveLength(2)
    // The old read still produced a usable `lastSetEndMs`, just the wrong one — an exercise stamped
    // at its second-to-last set rather than its end. Five of ten rows, and no visible symptom.
    expect(stale.at(-1)).toBe(1_700_000_000_000)
    expect(fresh.at(-1)).toBe(1_700_000_060_000)
  })
})
