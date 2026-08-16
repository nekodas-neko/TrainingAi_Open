import { describe, it, expect } from 'vitest'
import { buildRecapFacts } from '@trainingai/shared/workout/session-recap'
import type { WorkoutSession, ExerciseLog, SetLog } from '@trainingai/shared/types/log'

function makeSet(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'set-1', exerciseLogId: 'ex-1', setNumber: 1,
    weightKg: 100, reps: 8, useFor1rm: true,
    ...overrides,
  }
}

function makeExercise(overrides: Partial<ExerciseLog> = {}): ExerciseLog {
  return {
    id: 'ex-1', workoutSessionId: 'ws-1', exerciseName: 'Bench Press',
    muscleGroups: ['chest'], loggedAt: new Date('2026-07-01T10:00:00Z'),
    sets: [makeSet()],
    ...overrides,
  }
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'ws-1', userId: 'user-1', sessionName: 'Push',
    startedAt: new Date('2026-07-01T09:00:00Z'),
    completedAt: new Date('2026-07-01T10:00:00Z'),
    exercises: [makeExercise()],
    isEarlyDeload: false, wasOverride: false,
    ...overrides,
  }
}

describe('buildRecapFacts', () => {
  it('computes duration, volume, and passes prCount through', () => {
    const facts = buildRecapFacts({
      session: makeSession(),
      recentDurationsMin: [],
      restSecByStyleSet: new Map(),
      prCount: 2,
    })
    expect(facts.durationMin).toBe(60)
    expect(facts.totalVolumeKg).toBe(800) // 100kg * 8 reps
    expect(facts.prCount).toBe(2)
  })

  it('computes durationVsMedianPct only with >= 3 recent sessions', () => {
    const withTwo = buildRecapFacts({
      session: makeSession(),
      recentDurationsMin: [50, 55],
      restSecByStyleSet: new Map(),
      prCount: 0,
    })
    expect(withTwo.durationVsMedianPct).toBeNull()

    const withThree = buildRecapFacts({
      session: makeSession(),
      recentDurationsMin: [50, 50, 50],
      restSecByStyleSet: new Map(),
      prCount: 0,
    })
    // durationMin=60, median=50 -> +20%
    expect(withThree.durationVsMedianPct).toBe(20)
  })

  it('returns null durationMin/durationVsMedianPct when the session has no completedAt', () => {
    const facts = buildRecapFacts({
      session: makeSession({ completedAt: undefined }),
      recentDurationsMin: [50, 50, 50],
      restSecByStyleSet: new Map(),
      prCount: 0,
    })
    expect(facts.durationMin).toBeNull()
    expect(facts.durationVsMedianPct).toBeNull()
  })

  it('averages first-vs-last set RPE delta across exercises with >= 2 rated sets', () => {
    const session = makeSession({
      exercises: [
        makeExercise({
          id: 'ex-1',
          sets: [
            makeSet({ setNumber: 1, rpe: 6 }),
            makeSet({ setNumber: 2, rpe: 8 }),
          ],
        }),
        makeExercise({
          id: 'ex-2',
          sets: [makeSet({ setNumber: 1, rpe: 7 })], // only one rated set — skipped
        }),
      ],
    })
    const facts = buildRecapFacts({ session, recentDurationsMin: [], restSecByStyleSet: new Map(), prCount: 0 })
    expect(facts.rpeDrift).toBe(2)
  })

  it('returns null rpeDrift when no exercise has 2+ rated sets', () => {
    const session = makeSession({
      exercises: [makeExercise({ sets: [makeSet({ rpe: undefined })] })],
    })
    const facts = buildRecapFacts({ session, recentDurationsMin: [], restSecByStyleSet: new Map(), prCount: 0 })
    expect(facts.rpeDrift).toBeNull()
  })

  it('computes restAdherencePct from actual vs prescribed rest, null when no prescriptions', () => {
    const restSecByStyleSet = new Map([['style-1:1', 90]])
    const withRest = buildRecapFacts({
      session: makeSession({
        exercises: [makeExercise({ styleId: 'style-1', sets: [makeSet({ setNumber: 1, restTimeSec: 90 })] })],
      }),
      recentDurationsMin: [], restSecByStyleSet, prCount: 0,
    })
    expect(withRest.restAdherencePct).toBe(100)

    const withoutStyle = buildRecapFacts({
      session: makeSession({
        exercises: [makeExercise({ sets: [makeSet({ setNumber: 1, restTimeSec: 90 })] })],
      }),
      recentDurationsMin: [], restSecByStyleSet, prCount: 0,
    })
    expect(withoutStyle.restAdherencePct).toBeNull()
  })

  it('carries through sessionRpe, defaulting to null when absent', () => {
    const withRpe = buildRecapFacts({ session: makeSession({ sessionRpe: 7 }), recentDurationsMin: [], restSecByStyleSet: new Map(), prCount: 0 })
    expect(withRpe.sessionRpe).toBe(7)
    const withoutRpe = buildRecapFacts({ session: makeSession(), recentDurationsMin: [], restSecByStyleSet: new Map(), prCount: 0 })
    expect(withoutRpe.sessionRpe).toBeNull()
  })
})
