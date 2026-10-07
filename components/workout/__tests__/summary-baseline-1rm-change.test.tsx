// @vitest-environment jsdom
/**
 * Issue 2649. After a program rebuild the exercise summary showed the baseline run as a large loss
 * (82.75 against 103.75, about −21 kg) and the next run as a gain (+8.5 kg). Neither happened: a
 * baseline estimate is AMRAP-scaled from one unprescribed set, so it is never one half of a
 * comparison (issue 2297 already holds the strength card to that). The screen still shows both
 * estimates; only the "+/− kg" and the arrow beside them go. Display only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/lib/sqlite/cache', () => ({ cachedFetch: async () => null }))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => null }))
vi.mock('@/lib/hooks/use-hr-profile', () => ({ useHrProfile: () => null }))
vi.mock('@/lib/haptics', () => ({ hapticSuccess: () => {} }))
vi.mock('@/components/workout/session-clock', () => ({ SessionClock: () => null }))
vi.mock('@/components/workout/last-set-rest-timer', () => ({ LastSetRestTimer: () => null }))
vi.mock('@/components/workout/live-hr-chart', () => ({ LiveHrChart: () => null }))

import { ExerciseSummaryScreen } from '../exercise-summary-screen'
import type { ExerciseSummaryData } from '../types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
async function render(data: Partial<ExerciseSummaryData>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const summaryData: ExerciseSummaryData = {
    exName: 'Barbell Bench Press', setWeights: [70, 70, 70], sets: 3, reps: [8, 8, 8], lapTimes: [], restSec: 0,
    prevEst1rm: 103.75, allTimePr1rm: 103.75, newEst1rm: 82.75, target80: 66, exerciseType: 'weighted',
    nextExercise: null, ...data,
  }
  await act(async () => {
    root!.render(createElement(ExerciseSummaryScreen, { summaryData, workoutStartMs: null, onNext: () => {} }))
  })
  return host.textContent ?? ''
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  root = null
  host = null
})

describe('the exercise summary leaves the change out around a baseline', () => {
  it('shows the change on an ordinary run (control: the branch under test is reachable)', async () => {
    const text = await render({ prevEst1rm: 100, newEst1rm: 105.5 })
    expect(text).toContain('+5.50 kg')
  })

  it('shows the loss it would have shown on a normal run, so the control means something', async () => {
    expect(await render({})).toContain('-21.00 kg')
  })

  it('drops the change on the baseline run, and keeps both estimates', async () => {
    const text = await render({ suppressRmChange: true })
    expect(text).not.toMatch(/[+-]\d+\.\d\d kg/)
    expect(text).toContain('Previous')
    expect(text).toContain('This session')
    expect(text).toContain('82.75')
    expect(text).toContain('103.75')
  })

  it('drops the change on the first run after a baseline too', async () => {
    const text = await render({ prevEst1rm: 82.75, newEst1rm: 91.25, suppressRmChange: true })
    expect(text).not.toContain('+8.50 kg')
    expect(text).toContain('91.25')
  })

  it('also drops the "consistent" line, which is the same comparison read the other way', async () => {
    expect(await render({ prevEst1rm: 100, newEst1rm: 100 })).toContain('Consistent')
    expect(await render({ prevEst1rm: 100, newEst1rm: 100, suppressRmChange: true })).not.toContain('Consistent')
  })

  it('drops the rep change for a bodyweight exercise as well', async () => {
    const bw = { exerciseType: 'bodyweight' as const, prevRepMaxReps: 6, sets: 3, reps: [10, 10, 10] }
    expect(await render({ ...bw, prevEst1rm: 90, newEst1rm: 110 })).toMatch(/\+\d+ reps?/)
    expect(await render({ ...bw, prevEst1rm: 90, newEst1rm: 110, suppressRmChange: true })).not.toMatch(/\+\d+ reps?/)
  })
})
