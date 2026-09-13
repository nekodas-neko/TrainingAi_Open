/**
 * BF-151 — the reps behind the previous session's 1RM, carried rather than reconstructed.
 *
 * For a bodyweight exercise the rep max IS the reps performed, and `exercise_logs.avg_reps` stores
 * that exactly. The exercise summary was inverting the stored 1RM estimate to recover it, which is
 * lossy — and at 5 vs 6 reps impossible, because the rep-factor gain from the extra rep is exactly
 * cancelled by `amrapScaleFactor`'s 1.0 → 0.97 step and both store the same figure.
 */
import { describe, it, expect } from 'vitest'
import { buildWorkoutExercises, type BuildWorkoutExercisesCtx } from '../session-data'
import { calcAmrap1RM, bodyweightRepMax, repMaxFromAmrapOneRm } from '../../1rm'
import type { ProgramSession } from '../../types/program'

const EX_ID = 'sess-ex-1'
const SESSION: ProgramSession = {
  id: 'sess-1', programId: 'prog-1', name: 'Lower', position: 0, timeBudgetMinutes: 60,
  exercises: [{
    id: EX_ID, sessionId: 'sess-1', exerciseName: 'Hanging Leg Raise',
    muscleGroups: ['abs'], position: 0, exerciseRole: 'primary',
  }],
}

// Mirrors `session-data-manual-deload.test.ts`'s baseCtx — the established shape, with the AI
// prescription off so nothing but the basis decides `estimated1rm`.
const ctx = (over: Partial<BuildWorkoutExercisesCtx> = {}): BuildWorkoutExercisesCtx => ({
  lastLogs: new Map(),
  lastRealOneRm: new Map(),
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
  aiDrivesLoad: false,
  aiPrescription: null,
  aiPhaseLabel: '',
  isAiDynamic: false,
  aiDeload: false,
  droppedThisCycle: new Set(),
  loggedTodayInThisSession: new Set(),
  trainingGoal: 'strength',
  ...over,
})

const build = (over: Partial<BuildWorkoutExercisesCtx> = {}) => buildWorkoutExercises(SESSION, ctx(over))[0]

describe('prevRepMaxReps carries the reps behind the basis', () => {
  it('reports the logged reps when the basis came from a real log', () => {
    const ex = build({
      lastRealOneRm: new Map([['Hanging Leg Raise', { estimated1rm: 114.5, target80: 90, avgReps: 11 }]]),
    })
    expect(ex.estimated1rm).toBe(114.5)
    expect(ex.prevRepMaxReps).toBe(11)
  })

  // The whole reason the field exists rather than an inverse: these two are indistinguishable
  // downstream of the stored number, so only the stored reps can separate them.
  it('separates 5 reps from 6, which store the identical 1RM', () => {
    const five = calcAmrap1RM(70, 5)
    const six = calcAmrap1RM(70, 6)
    expect(five).toBe(six)
    for (const reps of [5, 6]) {
      const ex = build({
        lastRealOneRm: new Map([['Hanging Leg Raise', { estimated1rm: five, target80: null, avgReps: reps }]]),
      })
      expect(ex.prevRepMaxReps).toBe(reps)
    }
  })

  // A seed or a PR is not a logged set, so there are no reps to report — attaching some would pair
  // two numbers from different places and read as one measurement.
  it('is null when the basis is a user-entered seed', () => {
    const ex = build({ estimateMap: new Map([['Hanging Leg Raise', 100]]) })
    expect(ex.estimated1rm).toBe(100)
    expect(ex.prevRepMaxReps).toBeNull()
  })

  // The case that makes the source guard load-bearing rather than decorative: a log EXISTS and
  // carries reps, but its 1RM is not usable (a deload stores 0), so the seed wins the basis. Without
  // the guard those reps would be printed beside a number they have nothing to do with.
  it('is null when a log exists but its 1RM is unusable, so the seed won the basis', () => {
    const ex = build({
      lastRealOneRm: new Map([['Hanging Leg Raise', { estimated1rm: 0, target80: 0, avgReps: 8 }]]),
      estimateMap: new Map([['Hanging Leg Raise', 100]]),
    })
    expect(ex.estimated1rm).toBe(100)
    expect(ex.prevRepMaxReps).toBeNull()
  })

  it('is null when the basis falls back to the all-time PR', () => {
    const ex = build({ prMap: new Map([['Hanging Leg Raise', 120]]) })
    expect(ex.estimated1rm).toBe(120)
    expect(ex.prevRepMaxReps).toBeNull()
  })

  it('is null when there is no basis at all', () => {
    const ex = build()
    expect(ex.estimated1rm).toBeNull()
    expect(ex.prevRepMaxReps).toBeNull()
  })

  // `lastLogs` is the genuinely most recent log and can be a DIFFERENT session from the one the
  // basis came from — a deload one. Reading reps from there would describe two sessions as one.
  it('does not read reps from the most recent log when that is not the basis', () => {
    const ex = build({
      lastLogs: new Map([['Hanging Leg Raise', {
        sets: [{ reps: 3, weightKg: 0 }], loggedAt: new Date(), target80: 0,
      }]]) as unknown as BuildWorkoutExercisesCtx['lastLogs'],
      estimateMap: new Map([['Hanging Leg Raise', 100]]),
    })
    expect(ex.lastReps).toEqual([3])
    expect(ex.prevRepMaxReps).toBeNull()
  })
})

describe('bodyweightRepMax prefers the stored reps over the inverse', () => {
  it('returns the logged reps when they are known', () => {
    expect(bodyweightRepMax({ storedReps: 11, oneRm: 114.5 })).toBe(11)
  })

  // The collision, at the level the card actually reads: both rep counts store the same 1RM, so the
  // inverse returns one answer for two different sessions and only the stored reps separate them.
  it('separates 5 from 6 where the inverse cannot', () => {
    const tied = calcAmrap1RM(70, 5)
    expect(tied).toBe(calcAmrap1RM(70, 6))
    expect(bodyweightRepMax({ storedReps: 5, oneRm: tied })).toBe(5)
    expect(bodyweightRepMax({ storedReps: 6, oneRm: tied })).toBe(6)
    // Without the reps both collapse to the same recovered number — the defect being fixed.
    expect(bodyweightRepMax({ storedReps: null, oneRm: tied, addedKg: 70 }))
      .toBe(bodyweightRepMax({ storedReps: null, oneRm: tied, addedKg: 70 }))
  })

  it('falls back to the inverse when no reps are known', () => {
    const withReps = bodyweightRepMax({ storedReps: null, oneRm: 114.5, addedKg: 70 })
    expect(withReps).not.toBeNull()
    expect(withReps).toBe(repMaxFromAmrapOneRm(114.5, 70))
  })

  it.each([null, undefined, 0, -3, NaN, Infinity, -Infinity])('ignores an unusable rep count (%s)', (bad) => {
    expect(bodyweightRepMax({ storedReps: bad as number, oneRm: 114.5, addedKg: 70 }))
      .toBe(repMaxFromAmrapOneRm(114.5, 70))
  })

  it.each([null, undefined, 0, NaN])('is null when neither reps nor a usable 1RM exist (%s)', (bad) => {
    expect(bodyweightRepMax({ storedReps: null, oneRm: bad as number })).toBeNull()
  })
})
