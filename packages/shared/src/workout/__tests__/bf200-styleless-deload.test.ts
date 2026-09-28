import { describe, it, expect } from 'vitest'
import { buildWorkoutExercises, type BuildWorkoutExercisesCtx } from '@trainingai/shared/workout/session-data'
import { deloadStyleForGoal } from '@trainingai/shared/ai-periodization/deload-constants'
import type { ProgramSession } from '@trainingai/shared/types/program'
import type { StyleSet } from '@trainingai/shared/types/progression'

// BF-200. A deload week lightened four of the owner's five Upper exercises and not the fifth:
// Barbell Skull Crusher was prescribed 3 × 30 kg, his ordinary working weight. Measured on
// production, it was the only one with no progression style (`session_exercises.style_id` NULL
// since 2026-09-10) and no styled last log to fall back to — so its `progressionStyle` was null,
// and the Q-185 deload override required a non-empty one. The deload style is built from the goal
// alone, so that requirement exempted a style-less exercise from a deload week and nothing else.

const STYLED = 'sess-ex-styled'
const STYLELESS = 'sess-ex-styleless'
const STYLE_ID = 'style-1'
const baseStyle: StyleSet[] = [1, 2, 3].map(setNumber => ({
  id: `set-${setNumber}`, styleId: STYLE_ID, setNumber, pct: 75, reps: 8, restSec: 90, useFor1rm: true,
}))

const session: ProgramSession = {
  id: 'sess-1',
  programId: 'prog-1',
  name: 'Upper',
  position: 0,
  timeBudgetMinutes: 60,
  exercises: [
    { id: STYLED, sessionId: 'sess-1', exerciseName: 'Incline Bench Press', muscleGroups: ['chest'], position: 0, exerciseRole: 'primary', styleId: STYLE_ID },
    { id: STYLELESS, sessionId: 'sess-1', exerciseName: 'Barbell Skull Crusher', muscleGroups: ['triceps'], position: 1, exerciseRole: 'accessory' },
  ],
}

function ctx(overrides: Partial<BuildWorkoutExercisesCtx> = {}): BuildWorkoutExercisesCtx {
  return {
    lastLogs: new Map(),
    prMap: new Map(),
    estimateMap: new Map(),
    styleById: new Map([[STYLE_ID, baseStyle]]),
    styleByName: new Map(),
    styles: [{ id: STYLE_ID, name: 'Powerbuilding' } as BuildWorkoutExercisesCtx['styles'][number]],
    libByName: new Map(),
    currentPhase: null,
    allPhases: [],
    isDeloadActive: true,
    isBaselinePhase: false,
    // The 09-25 shape: a deload week with no AI prescription driving the load.
    aiDrivesLoad: false,
    aiPrescription: null,
    aiPhaseLabel: '',
    isAiDynamic: true,
    aiDeload: false,
    droppedThisCycle: new Set(),
    loggedTodayInThisSession: new Set(),
    trainingGoal: 'strength',
    ...overrides,
  }
}

const byName = (exs: ReturnType<typeof buildWorkoutExercises>, name: string) => exs.find(e => e.name === name)!

describe('BF-200 — a deload week reaches an exercise with no progression style', () => {
  it('deloads the style-less exercise exactly as it deloads the styled one', () => {
    const exs = buildWorkoutExercises(session, ctx())
    const styled = byName(exs, 'Incline Bench Press')
    const styleless = byName(exs, 'Barbell Skull Crusher')
    expect(styled.deloaded).toBe(true)
    expect(styleless.deloaded).toBe(true)
    expect(styleless.progressionStyle).toEqual(deloadStyleForGoal('strength'))
    expect(styleless.progressionStyle).toEqual(styled.progressionStyle)
  })

  it('has nothing to revert to, so it keeps no pre-deload style', () => {
    const styleless = byName(buildWorkoutExercises(session, ctx()), 'Barbell Skull Crusher')
    expect(styleless.preDeloadStyle).toBeUndefined()
  })

  it('leaves a style-less exercise alone outside a deload week', () => {
    const styleless = byName(buildWorkoutExercises(session, ctx({ isDeloadActive: false })), 'Barbell Skull Crusher')
    expect(styleless.deloaded).toBeUndefined()
    expect(styleless.progressionStyle ?? null).toBeNull()
  })

  it('still never deloads a baseline session', () => {
    const exs = buildWorkoutExercises(session, ctx({ isBaselinePhase: true }))
    expect(byName(exs, 'Barbell Skull Crusher').deloaded).toBeUndefined()
    expect(byName(exs, 'Incline Bench Press').deloaded).toBeUndefined()
  })

  it('does not touch a static (non-AI) program, whose deload comes from its phase style', () => {
    const styleless = byName(buildWorkoutExercises(session, ctx({ isAiDynamic: false })), 'Barbell Skull Crusher')
    expect(styleless.deloaded).toBeUndefined()
  })
})
