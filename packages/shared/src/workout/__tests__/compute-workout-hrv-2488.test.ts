// #2488 — the workout's rest-window HRV is rMSSD over the beats OUTSIDE every working set. Taking
// those beats out leaves a gap, and the old arithmetic differenced the last beat before a set with
// the first beat after it, which are minutes apart and not successive. The beat times now reach
// `rmssdFromRr`, which only pairs beats that follow each other.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@trainingai/shared/health/hr-profile', () => ({
  resolveHrProfile: async () => ({ maxHr: 190, restingHr: 60, source: 'test' }),
}))

import { computeWorkoutHr } from '../compute-workout-hr'

const START = new Date('2026-03-02T02:00:00Z')
const END = new Date(START.getTime() + 40 * 60_000)

/** Beats laid end to end from `fromMs` (each beat's time is when it ended). */
function run(fromMs: number, count: number, base: number): { at: Date; rrMs: number }[] {
  let t = fromMs
  return Array.from({ length: count }, (_, i) => {
    const rrMs = base + (i % 2 ? 10 : -10)
    return { at: new Date((t += rrMs)), rrMs }
  })
}

function repoWith(rr: { at: Date; rrMs: number }[], sets: { setStartMs: number; setEndMs: number }[]) {
  return {
    getHrForWindow: async () => [],
    getSetTimestampsForSession: async () => sets.map(s => ({ ...s, loggedAt: new Date(s.setEndMs) })),
    getRrForWindow: async () => rr,
    getSetDetailsForSession: async () => [],
  } as unknown as Parameters<typeof computeWorkoutHr>[0]
}

describe('workout rest-window HRV counts only adjacent beats (#2488)', () => {
  // 40 beats of rest, a working set, then 40 beats at a different heart rate. Within each run the
  // successive difference is 20 ms; across the set it is the drift between 800 and 900 ms intervals,
  // which is deliberately INSIDE the 20% artifact gate: the old arithmetic kept that 100 ms hop, so
  // only adjacency, not the artifact filter, can remove it.
  const before = run(START.getTime() + 60_000, 40, 800)
  const setStart = before[before.length - 1].at.getTime() + 30_000
  const setEnd = setStart + 120_000
  const after = run(setEnd + 30_000, 40, 900)
  const sets = [{ setStartMs: setStart, setEndMs: setEnd }]

  it('reads the beat-to-beat variability on each side of the set, not the jump across it', async () => {
    const out = await computeWorkoutHr(repoWith([...before, ...after], sets), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.workoutHrvMs).toBeCloseTo(20, 5)
  })

  it('is null for a session with no strap RR', async () => {
    const out = await computeWorkoutHr(repoWith([], sets), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.workoutHrvMs).toBeNull()
  })

  it('leaves out beats inside a set, as before', async () => {
    const insideSet = run(setStart + 5_000, 30, 400)   // noisy beats during the set
    const out = await computeWorkoutHr(repoWith([...before, ...insideSet, ...after], sets), 'u1', { id: 's1', startedAt: START, completedAt: END })
    expect(out!.workoutHrvMs).toBeCloseTo(20, 5)
  })
})
