import { describe, it, expect } from 'vitest'
import { buildWorkoutExercises, type BuildWorkoutExercisesCtx } from '@trainingai/shared/workout/session-data'
import type { ProgramSession } from '@trainingai/shared/types/program'
import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'

const EX_ID = 'sess-ex-1'

const session: ProgramSession = {
  id: 'sess-1',
  programId: 'prog-1',
  name: 'Push',
  position: 0,
  timeBudgetMinutes: 60,
  exercises: [
    { id: EX_ID, sessionId: 'sess-1', exerciseName: 'Bench Press', muscleGroups: ['chest'], position: 0, exerciseRole: 'primary' },
  ],
}

function prescriptionExercise(overrides: Partial<AiPrescriptionExercise> = {}): AiPrescriptionExercise {
  return {
    sessionExerciseId: EX_ID,
    name: 'Bench Press',
    sets: 4,
    reps: 5,
    pct: 82.5,
    restSec: 150,
    ...overrides,
  }
}

function prescription(exercises: AiPrescriptionExercise[]): AiPrescription {
  return {
    phase: 'intensification',
    phaseAction: 'stay',
    exercises,
    estimatedSessionDurationMin: 60,
    weeklyVolumeContribution: {},
    deload: false,
    reasoning: '',
    confidence: 1,
  }
}

function baseCtx(overrides: Partial<BuildWorkoutExercisesCtx> = {}): BuildWorkoutExercisesCtx {
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
    aiPrescription: prescription([prescriptionExercise()]),
    aiPhaseLabel: 'Intensification',
    isAiDynamic: true,
    aiDeload: false,
    droppedThisCycle: new Set(),
    loggedTodayInThisSession: new Set(),
    trainingGoal: 'strength',
    ...overrides,
  }
}

describe('buildWorkoutExercises — manual Home "Deload" wiring into AI-driven load (Q-109)', () => {
  it('a normal AI-driven session (aiDeload false) is untouched', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: false }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(82.5)
    expect(ex.defaultSets).toBe(4)
    expect(ex.deloaded).toBeUndefined()
  })

  it('manual Home Deload reduces the actual prescribed load, not just cosmetic metadata', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: true }))
    // strength goal: DELOAD_LOWER_PCT=50, DELOAD_REPS=6, DELOAD_SETS=2, DELOAD_REST=120
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.progressionStyle?.[0]?.reps).toBe(6)
    expect(ex.progressionStyle?.[0]?.restSec).toBe(120)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloaded).toBe(true)
  })

  it('lets the existing revert-to-full-weights UI work: preDeloadStyle/preDeloadSets carry the real prescription', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: true }))
    expect(ex.preDeloadStyle?.[0]?.pct).toBe(82.5)
    expect(ex.preDeloadSets).toBe(4)
  })

  it('does not compound with an exercise the automatic per-exercise engine already deloaded', () => {
    const alreadyDeloaded = prescriptionExercise({
      deloaded: true,
      deloadNote: 'Deload — chest still sore',
      sets: 2, reps: 8, pct: 55, restSec: 120,
      preDeload: { sets: 4, reps: 5, pct: 82.5, restSec: 150 },
    })
    const [ex] = buildWorkoutExercises(session, baseCtx({
      aiDeload: true,
      aiPrescription: prescription([alreadyDeloaded]),
    }))
    // The automatic per-exercise numbers stand — not re-reduced by the manual toggle on top.
    expect(ex.progressionStyle?.[0]?.pct).toBe(55)
    expect(ex.progressionStyle?.[0]?.reps).toBe(8)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloadNote).toBe('Deload — chest still sore')
  })

  it('uses the goal-specific override (hypertrophy differs from strength)', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: true, trainingGoal: 'hypertrophy' }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.progressionStyle?.[0]?.reps).toBe(10)
  })
})

// The second entry point. Home's "Take deload week now" writes programs.earlyDeloadWeekStart and
// passes no query param, so it arrives here as isDeloadActive with aiDeload false — and until
// Q-175 that combination produced byte-identical full-intensity numbers for the whole week.
describe('buildWorkoutExercises — a confirmed early-deload WEEK reduces AI-driven load (Q-175)', () => {
  it('reduces the prescribed load with aiDeload false, exactly as the toggle does', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: false, isDeloadActive: true }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.progressionStyle?.[0]?.reps).toBe(6)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloaded).toBe(true)
  })

  it('carries preDeloadStyle/preDeloadSets so revert-to-full-weights works here too', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({ aiDeload: false, isDeloadActive: true }))
    expect(ex.preDeloadStyle?.[0]?.pct).toBe(82.5)
    expect(ex.preDeloadSets).toBe(4)
  })

  it('does not compound with the automatic per-exercise engine, same as the toggle', () => {
    const alreadyDeloaded = prescriptionExercise({
      deloaded: true,
      deloadNote: 'Deload — chest still sore',
      sets: 2, reps: 8, pct: 55, restSec: 120,
      preDeload: { sets: 4, reps: 5, pct: 82.5, restSec: 150 },
    })
    const [ex] = buildWorkoutExercises(session, baseCtx({
      aiDeload: false,
      isDeloadActive: true,
      aiPrescription: prescription([alreadyDeloaded]),
    }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(55)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloadNote).toBe('Deload — chest still sore')
  })

  it('does not raise a base-style accessory to its target RPE mid-deload', () => {
    // Original intent (Q-175): the accessory-intensity path must not push an un-prescribed
    // accessory UP during a deload. Still true, and now stronger — Q-185 brings it down instead
    // of leaving it at its base 60%. The assertion below is the deload value, not the base one;
    // what matters for this test's own purpose is that it is not ABOVE 60.
    const accessorySession: ProgramSession = {
      ...session,
      exercises: [{ ...session.exercises[0], id: 'other-ex', exerciseRole: 'accessory', styleId: 's1' }],
    }
    const ctx = baseCtx({ aiDeload: false, isDeloadActive: true })
    const style = [{ pct: 60, reps: 10, restSec: 90, useFor1rm: false }]
    const [ex] = buildWorkoutExercises(accessorySession, {
      ...ctx,
      styleById: new Map([['s1', style]]),
      styles: [{ id: 's1', name: 'Base', userId: 'u', sets: style } as never],
    })
    expect(ex.progressionStyle![0].pct).toBeLessThanOrEqual(60)
    expect(ex.progressionStyle![0].pct).toBe(50)
  })
})

// Q-185. Every reduction above lives inside `if (aiDrivesLoad)` and keys off a prescription
// entry, so an exercise the AI does not name never reached one. Measured on the running dev
// server before the fix: during a confirmed deload week, two prescribed lifts came back at
// 50% / 2 sets beside an accessory unchanged at 75% / 3. Owner decision 2026-08-12: lighten
// every exercise, so a deload week means what it says.
describe('buildWorkoutExercises — a deload reduces exercises the AI does not prescribe (Q-185)', () => {
  const accessoryStyle = [{ pct: 75, reps: 10, restSec: 90, useFor1rm: false }, { pct: 75, reps: 10, restSec: 90, useFor1rm: false }, { pct: 75, reps: 10, restSec: 90, useFor1rm: false }]
  const accessorySession: ProgramSession = {
    ...session,
    exercises: [{ ...session.exercises[0], id: 'unprescribed-ex', exerciseRole: 'accessory', styleId: 's1' }],
  }
  const withStyle = (over: Partial<BuildWorkoutExercisesCtx>) => ({
    ...baseCtx(over),
    styleById: new Map([['s1', accessoryStyle]]),
    styles: [{ id: 's1', name: 'Base', userId: 'u', sets: accessoryStyle } as never],
  })

  it('reduces an accessory the prescription does not name, during a deload WEEK', () => {
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({ isDeloadActive: true }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.defaultSets).toBe(2)
    expect(ex.deloaded).toBe(true)
  })

  it('reduces it for the manual Home toggle too, not just the week', () => {
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({ aiDeload: true }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.deloaded).toBe(true)
  })

  it('reduces a whole session whose prescription is missing or expired', () => {
    // The worse case in the report: aiDrivesLoad false, so nothing reached the AI branch at all
    // and every exercise came back at full base-style load with isDeloadActive true.
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({
      isDeloadActive: true, aiDrivesLoad: false, aiPrescription: null,
    }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(50)
    expect(ex.defaultSets).toBe(2)
  })

  it('carries preDeloadStyle/preDeloadSets so revert-to-full-weights works here too', () => {
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({ isDeloadActive: true }))
    expect(ex.preDeloadStyle?.[0]?.pct).toBe(75)
    expect(ex.preDeloadSets).toBe(3)
  })

  it('leaves it alone when no deload is active', () => {
    // 70.5, not the 75 base: with no deload running, the accessory-intensity path owns this
    // exercise's % and trims it to the goal's target RPE. That is pre-existing behaviour and
    // exactly what the Q-175 test above guards against being applied DURING a deload. What
    // matters here is that it is not the deload style.
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({}))
    expect(ex.progressionStyle?.[0]?.pct).toBe(70.5)
    expect(ex.defaultSets).toBe(3)
    expect(ex.deloaded).toBeUndefined()
  })

  it('does NOT reduce a static program — deloadAwareStylePhase already swapped its style', () => {
    // The exclusion that stops the two reductions compounding. A static program has
    // ProgramPhase rows and a deload phase to swap to; an ai_dynamic program has neither,
    // which is the whole reason this branch exists.
    const [ex] = buildWorkoutExercises(accessorySession, withStyle({
      isDeloadActive: true, isAiDynamic: false, aiDrivesLoad: false, aiPrescription: null,
    }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(75)
    expect(ex.deloaded).toBeUndefined()
  })

  /**
   * Q-211 — a baseline lift is exempt from a SESSION deload, because the logging side already
   * treats it as a genuine max test.
   *
   * The app used to prescribe half weight and then record the result as a real max:
   * `estimateOneRm` is called with `deloaded: exerciseDeloaded === true || (isAnyDeload &&
   * !isBaseline)` and `shouldCountTowardPr` returns `!args.isAnyDeload || args.isBaseline`, both
   * commented as "a genuine max-effort attempt even during an otherwise-active deload window".
   * A baseline taken during a deload week therefore understated the athlete permanently, in
   * `personal_records`.
   *
   * **This one case pins BOTH guards, and that is not an accident.** Two branches deload, and the
   * entry's stated one-line fix — exempting only the prescribed branch — left the behaviour
   * unchanged: measured, `deloaded` still came back `true`, because the un-prescribed branch
   * (Q-185) picked the exercise straight back up. That branch carried a comment saying a
   * `!isBaselinePhase` clause was unreachable, which was true against the code that proved it and
   * false the moment the first exemption landed. Verified by mutation: removing **either** guard
   * alone fails this test.
   *
   * A separate case for the un-prescribed branch was written and deleted — with no prescription a
   * baseline has `progressionStyle` null, so the length check stops it and the assertion could not
   * fail. This is the scenario that reaches both.
   */
  it('a baseline phase is exempt from a session deload (Q-211)', () => {
    const [ex] = buildWorkoutExercises(session, baseCtx({
      isDeloadActive: true, isBaselinePhase: true,
    }))
    expect(ex.deloaded).toBeUndefined()
    expect(ex.progressionStyle?.[0]?.pct).not.toBe(50)
  })

  /**
   * The audit Q-211 asked for, answered: the PER-EXERCISE engine (`p.deloaded`) needs no
   * exemption, and this pins why rather than leaving it to be re-derived.
   *
   * `shouldCountTowardPr` returns false on `exerciseDeloaded` with **no** baseline exception —
   * its own comment says so: *"unlike the session flag it has no baseline exception, since the
   * exercise itself was cut"* — and `estimateOneRm` takes `exerciseDeloaded === true` first. So
   * both sides already agree for this flag: reduce the load, and keep the result out of
   * `personal_records`. There is no contradiction to fix, and exempting it would create one —
   * the AI cuts a specific exercise for soreness or injury, and overriding that to make someone
   * max out on it is a safety decision, not bookkeeping.
   */
  it('but a per-exercise AI deload still applies during a baseline (Q-211 audit)', () => {
    const sore = prescriptionExercise({
      deloaded: true, deloadNote: 'Deload — chest still sore',
      sets: 2, reps: 8, pct: 55, restSec: 120,
    })
    const [ex] = buildWorkoutExercises(session, baseCtx({
      isDeloadActive: true, isBaselinePhase: true, aiPrescription: prescription([sore]),
    }))
    expect(ex.deloaded).toBe(true)
    expect(ex.progressionStyle?.[0]?.pct).toBe(55)
  })

  it('does not compound with an exercise the AI already deloaded', () => {
    const alreadyDeloaded = prescriptionExercise({
      deloaded: true, deloadNote: 'Deload — chest still sore',
      sets: 2, reps: 8, pct: 55, restSec: 120,
    })
    const [ex] = buildWorkoutExercises(session, baseCtx({
      isDeloadActive: true, aiPrescription: prescription([alreadyDeloaded]),
    }))
    expect(ex.progressionStyle?.[0]?.pct).toBe(55)
    expect(ex.deloadNote).toBe('Deload — chest still sore')
  })
})
