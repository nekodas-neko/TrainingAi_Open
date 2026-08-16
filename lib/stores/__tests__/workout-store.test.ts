// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkoutStore, applyRehydrateFixups, effectiveRestSec, type WorkoutStore } from '../workout-store'

describe('ExerciseBuffer carries restStartMs through stash/restore (superset alternation)', () => {
  beforeEach(() => {
    useWorkoutStore.getState().resetSession()
  })

  it('restoreExercise returns the restStartMs that was in effect at stash time, not null', () => {
    const store = useWorkoutStore.getState()
    store.setTimestamps({ restStartMs: 123456 })
    store.stashExercise(0)
    const restored = store.restoreExercise(0)
    expect(restored).toBe(true)
    expect(useWorkoutStore.getState().restStartMs).toBe(123456)
  })

  it('a restored restStartMs produces a non-zero rest duration on the next Start Set tap', () => {
    const store = useWorkoutStore.getState()
    const restStart = Date.now() - 45_000 // rest began 45s ago
    store.setTimestamps({ restStartMs: restStart })
    store.stashExercise(1)
    store.restoreExercise(1)

    // Mirrors handleStartSet's computation (components/workout-screen.tsx:619)
    const now = Date.now()
    const finalRestStartMs = useWorkoutStore.getState().restStartMs
    const restMs = finalRestStartMs !== null ? now - finalRestStartMs : 0
    expect(restMs).toBeGreaterThan(40_000)
  })

  it('a first-visit exercise (no buffer) still initializes to null, not a stale value', () => {
    const store = useWorkoutStore.getState()
    const restored = store.restoreExercise(5) // never stashed
    expect(restored).toBe(false)
  })
})

describe('readyElapsedBaselineSec', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkoutStore.setState({ readyElapsedBaselineSec: null })
  })

  it('defaults to null', () => {
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('setReadyElapsedBaselineSec sets and clears the value', () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(42)
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBe(42)
    useWorkoutStore.getState().setReadyElapsedBaselineSec(null)
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('startWorkout resets it to null', () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(99)
    useWorkoutStore.getState().startWorkout('session-a')
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('survives being read from a fresh store instance (simulates remount) once persisted', async () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(15)
    // Zustand's persist middleware writes asynchronously; give it a tick.
    await new Promise(r => setTimeout(r, 0))
    const raw = localStorage.getItem('ta_workout_state')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.readyElapsedBaselineSec).toBe(15)
  })
})

describe('newPRs / xpEarned (WK-18: persisted so a mid-workout refresh does not empty the done screen)', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkoutStore.getState().resetSession()
  })

  it('default to empty/undefined', () => {
    expect(useWorkoutStore.getState().newPRs).toEqual([])
    expect(useWorkoutStore.getState().xpEarned).toBeUndefined()
  })

  it('addNewPR accumulates without duplicates', () => {
    const store = useWorkoutStore.getState()
    store.addNewPR('Barbell Bench Press')
    store.addNewPR('Barbell Squat')
    store.addNewPR('Barbell Bench Press') // duplicate, e.g. two sets of the same exercise both PR
    expect(useWorkoutStore.getState().newPRs).toEqual(['Barbell Bench Press', 'Barbell Squat'])
  })

  it('setXpEarned sets the value', () => {
    useWorkoutStore.getState().setXpEarned(42)
    expect(useWorkoutStore.getState().xpEarned).toBe(42)
  })

  it('startWorkout resets both, so a new session never inherits the previous one\'s results', () => {
    const store = useWorkoutStore.getState()
    store.addNewPR('Barbell Bench Press')
    store.setXpEarned(42)
    store.startWorkout('session-a')
    expect(useWorkoutStore.getState().newPRs).toEqual([])
    expect(useWorkoutStore.getState().xpEarned).toBeUndefined()
  })

  it('resetSession resets both', () => {
    const store = useWorkoutStore.getState()
    store.addNewPR('Barbell Bench Press')
    store.setXpEarned(42)
    store.resetSession()
    expect(useWorkoutStore.getState().newPRs).toEqual([])
    expect(useWorkoutStore.getState().xpEarned).toBeUndefined()
  })

  it('survives being read from a fresh store instance (simulates a mid-workout refresh) once persisted', async () => {
    const store = useWorkoutStore.getState()
    store.addNewPR('Barbell Bench Press')
    store.setXpEarned(25)
    // Zustand's persist middleware writes asynchronously; give it a tick.
    await new Promise(r => setTimeout(r, 0))
    const raw = localStorage.getItem('ta_workout_state')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.newPRs).toEqual(['Barbell Bench Press'])
    expect(parsed.state.xpEarned).toBe(25)
  })
})

describe('rolloverDay (WK-13: day rollover while the app stays foregrounded)', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkoutStore.getState().resetSession()
  })

  it('clears todayLogged + revertedDeloads and stamps the new date', () => {
    const store = useWorkoutStore.getState()
    store.addTodayLogged('session-a', 'Barbell Bench Press')
    store.toggleDeloadRevert('session-a', 'Barbell Squat')
    store.rolloverDay('2026-07-19')
    const next = useWorkoutStore.getState()
    expect(next.storedDate).toBe('2026-07-19')
    expect(next.todayLogged).toEqual({})
    expect(next.revertedDeloads).toEqual({})
  })
})

describe('effectiveRestSec (TMR-1/TMR-5)', () => {
  it('uses lastSetRestSec when configured', () => {
    expect(effectiveRestSec(120)).toBe(120)
  })

  it('falls back to 90 for a style-less set (lastSetRestSec === 0)', () => {
    expect(effectiveRestSec(0)).toBe(90)
  })
})

describe('applyRehydrateFixups (TMR-2: staleness guard on rehydrated timer anchors)', () => {
  const TODAY = '2026-07-13'

  function mockState(overrides: Partial<WorkoutStore>): WorkoutStore {
    return {
      ...useWorkoutStore.getState(),
      mode: 'active',
      storedDate: TODAY,
      lapStartMs: null,
      restStartMs: null,
      lastSetRestStartMs: null,
      workoutStartMs: null,
      workoutPhase: 'set',
      ...overrides,
    }
  }

  it('leaves a 30-minute-old anchor untouched', () => {
    const now = Date.now()
    const state = mockState({
      lapStartMs: now - 30 * 60 * 1000,
      workoutStartMs: now - 30 * 60 * 1000,
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('active')
    expect(state.lapStartMs).toBe(now - 30 * 60 * 1000)
  })

  it('clears anchors and resets mode to pre for a 20-hour-old anchor', () => {
    const now = Date.now()
    const state = mockState({
      lapStartMs: now - 20 * 60 * 60 * 1000,
      restStartMs: now - 20 * 60 * 60 * 1000,
      lastSetRestStartMs: now - 20 * 60 * 60 * 1000,
      workoutStartMs: now - 20 * 60 * 60 * 1000,
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.lapStartMs).toBeNull()
    expect(state.restStartMs).toBeNull()
    expect(state.lastSetRestStartMs).toBeNull()
    expect(state.workoutPhase).toBe('rest')
  })

  it('resets an active session across a date rollover even with fresh timestamps', () => {
    const now = Date.now()
    const state = mockState({
      storedDate: '2026-07-12',
      lapStartMs: now - 60_000,
      workoutStartMs: now - 60_000,
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.storedDate).toBe(TODAY)
  })

  it('does not touch timer anchors when mode is not active and no session anchor is set', () => {
    const now = Date.now()
    const state = mockState({
      mode: 'pre',
      lapStartMs: now - 20 * 60 * 60 * 1000,
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.lapStartMs).toBe(now - 20 * 60 * 60 * 1000)
  })

  // E1-4: a stale session anchor fully drops the workout identity, not just timers.
  it('fully clears workout identity for a stale (>4h) session anchor', () => {
    const now = Date.now()
    const state = mockState({
      mode: 'active',
      workoutStartMs: now - 20 * 60 * 60 * 1000,
      sessionLog: [{ name: 'Bench', setWeights: [100], reps: [5] }],
      workoutSessionId: 'old-session-id',
      exerciseBuffers: { 0: {} as never },
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.workoutStartMs).toBeNull()
    expect(state.workoutSessionId).toBe('')
    expect(state.sessionLog).toEqual([])
    expect(state.exerciseBuffers).toEqual({})
  })

  // E1-4 gap (a): a days-old session killed during warm-up also fully resets.
  it('fully resets a stale session in warmup mode (not just active)', () => {
    const now = Date.now()
    const state = mockState({
      mode: 'warmup',
      workoutStartMs: now - 30 * 60 * 60 * 1000,
      workoutSessionId: 'old-id',
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.workoutStartMs).toBeNull()
    expect(state.workoutSessionId).toBe('')
  })

  // A recent (<4h, same-day) session keeps its identity even if a timer anchor is
  // stale — only the timers reset, so "Continue" still works for a live workout.
  it('preserves a recent session identity while clearing only stale timer anchors', () => {
    const now = Date.now()
    const state = mockState({
      mode: 'active',
      workoutStartMs: now - 30 * 60 * 1000,
      workoutSessionId: 'live-id',
      restStartMs: now - 20 * 60 * 60 * 1000,
    })
    applyRehydrateFixups(state, TODAY, now)
    expect(state.mode).toBe('pre')
    expect(state.workoutStartMs).toBe(now - 30 * 60 * 1000) // session kept
    expect(state.workoutSessionId).toBe('live-id')
    expect(state.restStartMs).toBeNull() // timer cleared
  })
})
