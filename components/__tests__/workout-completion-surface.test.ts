import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/**
 * All three fixes are explained in prose at their call sites, and each of those comments names the
 * shape it replaced — so a raw-source match would pass on the comment describing the bug. Strip
 * comments first, then collapse whitespace so an assertion survives a reformat.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')

describe('BF-169 — the COMPLETED stamp is not gated on the exercise library', () => {
  const src = code('app/workout-select/workout-select-content.tsx')

  it('renders on trainedToday alone, like every other completion signal on the card', () => {
    // The green ring, the screen-reader text and the Start Again label are all driven by
    // trainedToday by itself. The stamp used to additionally require muscleActivations, which is a
    // SEPARATE fetch (the exercise library) — so on a slow or failed load the card said "complete"
    // three ways with no stamp, which is the owner's screenshot.
    expect(src).toContain('{trainedToday && <CompletedStamp />}')
    expect(src, 'the library-gated form must be gone')
      .not.toContain('trainedToday && muscleActivations.length > 0 && <CompletedStamp />')
  })

  it('leaves the DIAGRAM gated, because a silhouette with no assignments is nothing', () => {
    // The entanglement came from a guard that is correct for the heatmap and wrong for the stamp.
    // Fixing the stamp must not take the heatmap's own guard with it.
    expect(src).toContain('muscleActivations.length > 0 ? ( <MuscleHeatmap')
  })

  it('gives the stamp a ground to sit on when there is no diagram behind it', () => {
    // CompletedStamp is `absolute inset-0`, so it needs a parent with height. With the library
    // absent the container holds either the h-24 placeholder or nothing at all — the latter
    // collapses to zero and the stamp would have no box. Only applied when the diagram is absent,
    // so the working case keeps exactly the height the heatmap gives it.
    expect(src).toContain('trainedToday && muscleActivations.length === 0 && "min-h-24"')
  })
})

describe('BF-168 — "Leave workout?" must not fire on the session-select tab', () => {
  const src = code('components/mobile-auth-handler.tsx')

  it('identifies the workout SCREEN by its session param, not by the path prefix', () => {
    // `/workout` is both routes: app/workout/page.tsx renders WorkoutScreen when `?session=` is
    // present and the tab shell otherwise. `pathname` drops the query, so the old prefix test
    // could not tell them apart — and matched `/workout-select` as well.
    expect(src).toContain('window.location.pathname === "/workout" && new URLSearchParams(window.location.search).has("session")')
    expect(src, 'the prefix test is what raised the dialog on the tab')
      .not.toContain('window.location.pathname.startsWith("/workout")')
  })

  it('leaves isWorkoutActive alone — both of its terms are load-bearing elsewhere', () => {
    // The same predicate guards the beforeunload warning in workout-screen.tsx, and its own
    // comment records that 'pre' must NOT be excluded because it is also the mid-workout hub.
    const store = read('lib/stores/workout-store.ts')
    expect(store).toContain("return !!state.workoutStartMs && state.mode !== 'done'")
  })

  it('dismisses a raised prompt when its subject ends, so it cannot ride a navigation', () => {
    // The flags were cleared ONLY by Stay/Leave. Back pressed on the last exercise's summary
    // raises the prompt correctly; the session then reaches `done` and navigates to the tab with
    // the prompt still up. Keyed on the subject, not the URL: `/workout?session=x` -> `/workout`
    // is the SAME pathname, so a usePathname effect would not fire for the reported case.
    expect(src).toContain('const workoutActive = useWorkoutStore(isWorkoutActive)')
    expect(src).toContain('if (!workoutActive) setConfirmLeaveOpen(false)')
    // All three guards can outlive their screen, not just the workout one.
    expect(src).toContain('if (!walkActive) setConfirmLeaveWalkOpen(false)')
    expect(src).toContain('if (!activityActive) setConfirmLeaveActivityOpen(false)')
  })
})

describe('BF-167 — the deload toggle reads the exercises, not the phase flag', () => {
  const src = code('components/workout/pre-workout-screen.tsx')

  it('also asks whether any exercise was cut, which is the question the label puts', () => {
    // prescription.deload means "this is a deload PRESCRIPTION" (a phase decision). The illness
    // radar and the soreness quadrant cut individual loads AFTER the model has planned, setting
    // exercises[].deloaded without touching the phase flag — so the toggle read
    // "Full - as prescribed" over a session prescribed at 52% of 1RM.
    expect(src).toContain('!!periodization?.state.prescription?.exercises.some(e => e.deloaded)')
  })

  it('keeps the phase flag as the other half of the union, not replaced by it', () => {
    // BF-167 proposed replacing the flag. That would regress BF-8's guard, which seeds
    // `deload: true` with an empty exercises array — a `.some()` alone reads that as Full. The
    // defect is a false NEGATIVE and the flag is never a false positive, so both are kept.
    expect(src).toContain('!!periodization?.state.prescription?.deload')
    expect(src, 'either source must satisfy the label')
      .toMatch(/\|\|\s*!!periodization\?\.state\.prescription\?\.exercises\.some/)
  })

  it('keeps the consumed guard, which describes a session that has already run', () => {
    expect(src).toContain("periodization?.state.prescriptionStatus !== 'consumed'")
  })

  it('does not touch deload-toggle.tsx, which was already correct', () => {
    // BF-8 made this component label correctly; it does the right thing when told the truth, and
    // "fixing" it here is how the screen came to contradict the card below it in the first place.
    expect(read('components/workout/deload-toggle.tsx')).toContain('As prescribed')
  })
})
