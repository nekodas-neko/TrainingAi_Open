import { describe, it, expect } from 'vitest'
import {
  aiDynamicFallbackPhaseStatus,
  buildWorkoutExercises,
  type BuildWorkoutExercisesCtx,
} from '@trainingai/shared/workout/session-data'
import { shouldCountTowardPr } from '@trainingai/shared/workout/log-exercise'
import { estimateOneRm } from '@trainingai/shared/1rm'
import type { ProgramSession } from '@trainingai/shared/types/program'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

// Q-310. The AI periodization engine can choose `phase: 'deload'` off accumulated fatigue, with
// nobody confirming anything — so it reaches /api/workout-data's catch-all branch rather than the
// two user-confirmed deload branches above it. Both copies of that branch hardcoded
// isDeloadActive:false while title-casing the same field into the label "Deload", which is how the
// owner got a session headed "Pull · Deload" that prescribed full weights and flashed a PR.

const EX_ID = 'sess-ex-1'

const session: ProgramSession = {
  id: 'sess-1',
  programId: 'prog-1',
  name: 'Pull',
  position: 0,
  timeBudgetMinutes: 60,
  exercises: [
    { id: EX_ID, sessionId: 'sess-1', exerciseName: 'Sumo Deadlift', muscleGroups: ['back'], position: 0, exerciseRole: 'primary' },
  ],
}

const prescription: AiPrescription = {
  phase: 'deload',
  phaseAction: 'stay',
  exercises: [{ sessionExerciseId: EX_ID, name: 'Sumo Deadlift', sets: 4, reps: 5, pct: 82.5, restSec: 150 }],
  estimatedSessionDurationMin: 60,
  weeklyVolumeContribution: {},
  deload: false,
  reasoning: '',
  confidence: 1,
}

function ctx(overrides: Partial<BuildWorkoutExercisesCtx> = {}): BuildWorkoutExercisesCtx {
  return {
    lastLogs: new Map(),
    prMap: new Map(),
    estimateMap: new Map(),
    styleById: new Map(),
    styleByName: new Map(),
    styles: [],
    libByName: new Map(),
    currentPhase: null,
    allPhases: [],
    isDeloadActive: false,
    isBaselinePhase: false,
    aiDrivesLoad: true,
    aiPrescription: prescription,
    aiPhaseLabel: 'Deload',
    isAiDynamic: true,
    aiDeload: false,
    droppedThisCycle: new Set(),
    loggedTodayInThisSession: new Set(),
    trainingGoal: 'strength',
    ...overrides,
  }
}

describe('aiDynamicFallbackPhaseStatus', () => {
  it('flags an engine-chosen deload phase as an active deload', () => {
    const status = aiDynamicFallbackPhaseStatus({ phase: 'deload', sessionsInPhase: 1 })
    expect(status.isDeloadActive).toBe(true)
    expect(status.phase.phaseType).toBe('deload')
  })

  it('does not flag any other phase', () => {
    for (const phase of ['accumulation', 'intensification', 'realization', 'baseline']) {
      const status = aiDynamicFallbackPhaseStatus({ phase, sessionsInPhase: 0 })
      expect(status.isDeloadActive).toBe(false)
      expect(status.phase.phaseType).toBe('normal')
    }
  })

  it('keeps the label and session counters it already produced', () => {
    const status = aiDynamicFallbackPhaseStatus({ phase: 'accumulation', sessionsInPhase: 3 })
    expect(status.phase.name).toBe('Accumulation')
    expect(status.completedCycles).toBe(3)
    expect(status.phaseSessionNumber).toBe(4)
    expect(status.isBaseline).toBe(false)
    expect(status.openEnded).toBe(true)
  })
})

// The three symptoms the owner reported, each traced back to this one flag. Every assertion here
// fails if isDeloadActive goes back to a hardcoded false.
describe('an engine-chosen deload behaves like a deload end to end (Q-310)', () => {
  const status = aiDynamicFallbackPhaseStatus({ phase: 'deload', sessionsInPhase: 1 })

  it('reduces the prescribed load instead of leaving it at full intensity', () => {
    const [ex] = buildWorkoutExercises(session, ctx({ isDeloadActive: status.isDeloadActive }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloaded).toBe(true)
    expect(ex.preDeloadStyle?.[0]?.pct).toBe(82.5)
  })

  it('marks the exercise deloaded, which is what reaches the log payload as exerciseDeloaded', () => {
    const [full] = buildWorkoutExercises(session, ctx({ isDeloadActive: false }))
    expect(full.deloaded).toBeUndefined()
    const [deloaded] = buildWorkoutExercises(session, ctx({ isDeloadActive: status.isDeloadActive }))
    expect(deloaded.deloaded).toBe(true)
  })

  it('closes the PR gate the client evaluates from this same flag', () => {
    const isAnyDeload = status.isDeloadActive
    expect(shouldCountTowardPr({
      estimated1rm: 150, isAnyDeload, isBaseline: false, exerciseDeloaded: false,
    })).toBe(false)
  })

  it('zeroes the client-side estimate, so the "New Personal Record!" badge cannot fire', () => {
    // exercise-summary-screen gates its badge on `newEst1rm > 0`, and this is where that 0 comes
    // from — the badge needs no deload check of its own once the flag is right.
    const sets = [{ weightKg: 140, reps: 5 }, { weightKg: 140, reps: 5 }]
    const opts = { exerciseType: 'weighted' as const, style: null, isBaseline: false }
    expect(estimateOneRm(sets, { ...opts, deloaded: false }).estimated1rm).toBeGreaterThan(0)
    expect(estimateOneRm(sets, { ...opts, deloaded: status.isDeloadActive }).estimated1rm).toBe(0)
  })
})
