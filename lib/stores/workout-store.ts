import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkoutMode, ExerciseSummaryData, SessionLogEntry } from '@/components/workout/types'
import { DEFAULT_SETS, DEFAULT_REPS } from '@/components/workout/utils'
import { todayInTz } from '@trainingai/shared/date-utils'

// A snapshot of everything superset alternation needs to preserve for an
// exercise that isn't currently loaded into the flat fields below — taken
// when the sequence hands control to another group member, restored when
// it comes back around.
interface ExerciseBuffer {
  sets: number
  reps: number[]
  perSetWeights: number[]
  setWeights: number[]
  currentSet: number
  lapTimes: number[]
  setStartMsArray: number[]
  setEndMsArray: number[]
  restTimes: number[]
  rpeValues: number[]
  accumulatedRestMs: number
  exerciseStartMs: number | null
  timerStarted: boolean
  restStartMs: number | null
}

interface WorkoutState {
  // Session identity
  workoutSessionId: string
  sessionType: string | null

  // Flow
  mode: WorkoutMode
  currentIdx: number
  soloMode: boolean

  // Exercise / set state
  sets: number
  reps: number[]
  perSetWeights: number[]
  setWeights: number[]       // weights logged in current exercise (accumulated)
  currentSet: number
  lapTimes: number[]         // elapsed seconds per completed set
  setStartMsArray: number[]  // epoch ms when each "Start Set" was pressed
  setEndMsArray: number[]    // epoch ms when each "Log Set" was pressed
  workoutPhase: 'rest' | 'set'
  rpeValues: number[]
  accumulatedRestMs: number
  restTimes: number[]        // rest seconds taken *after* each set (index i -> rest
                              // following set i+1's row server-side)
  timerStarted: boolean
  lastSetRestSec: number     // restSec of the set most recently logged — drives the rest countdown
                             // regardless of which exercise is currently active (superset alternation)
  exerciseBuffers: Record<number, ExerciseBuffer>  // stashed WIP for group members not currently active

  // Timestamps (ms since epoch; previously useRef)
  workoutStartMs: number | null
  workoutEndMs: number | null
  warmupEndedMs: number | null
  exerciseStartMs: number | null
  lapStartMs: number | null
  restStartMs: number | null
  // The live "since last logged set" rest anchor — set only in handleLogCurrentSet,
  // NEVER written by stashExercise/restoreExercise/switchToExercise. restStartMs above
  // is the per-exercise buffered physiological rest anchor (restored from
  // ExerciseBuffer on superset handoff); this field is what the beep/notification/ring/
  // PiP timers actually anchor to, so a handoff can't clobber the just-logged set's
  // rest countdown with the target exercise's unrelated buffered anchor (TMR-1).
  lastSetRestStartMs: number | null
  lastExerciseEndMs: number | null  // setEndMs of last set of previous exercise
  // Session-elapsed-seconds value captured the moment the ready screen (pre-set,
  // warm-up ramp-up) was entered — NOT a timestamp, so it lives outside setTimestamps.
  // Persisted (not a useRef) so it survives an app-backgrounding remount; see
  // active-workout-screen.tsx's readyElapsedSec derivation.
  readyElapsedBaselineSec: number | null

  // Results
  summaryData: ExerciseSummaryData | null
  todayLogged: Record<string, string[]>  // exercise names logged today, keyed by program session id (or sessionType)
  sessionLog: SessionLogEntry[]
  storedDate: string           // YYYY-MM-DD; reset todayLogged if this doesn't match today
  revertedDeloads: Record<string, string[]>  // exercise names the user opted back to full weights, keyed like todayLogged
  // Per-session results shown on the done screen — persisted so a mid-workout refresh
  // doesn't empty them (the store rehydrates, but plain useState in the orchestrator
  // doesn't). Cleared on startWorkout/resetSession like sessionLog, never leak across sessions.
  newPRs: string[]
  xpEarned: number | undefined
}

interface WorkoutActions {
  startWorkout: (sessionType: string) => void
  resetSession: () => void
  setMode: (mode: WorkoutMode) => void
  setCurrentIdx: (idx: number) => void
  setSets: (n: number) => void
  setReps: (reps: number[]) => void
  setPerSetWeights: (weights: number[]) => void
  updatePerSetWeight: (idx: number, value: number) => void
  initRpeValues: (values: number[]) => void
  setRpeValue: (setIdx: number, value: number) => void
  setSoloMode: (b: boolean) => void
  setTimerStarted: (b: boolean) => void
  setWorkoutPhase: (phase: 'rest' | 'set') => void
  setCurrentSet: (n: number) => void
  appendSetWeight: (w: number) => void
  clearSetWeights: () => void
  appendLapTime: (t: number) => void
  clearLapTimes: () => void
  appendSetStartMs: (ms: number) => void
  appendSetEndMs: (ms: number) => void
  clearSetTimingArrays: () => void
  addAccumulatedRestMs: (ms: number) => void
  appendRestTime: (sec: number) => void
  clearRestTimes: () => void
  setTimestamps: (patch: Partial<Pick<WorkoutState,
    'workoutStartMs' | 'workoutEndMs' | 'warmupEndedMs' | 'exerciseStartMs' | 'lapStartMs' | 'restStartMs' | 'lastSetRestStartMs' | 'lastExerciseEndMs'
  >>) => void
  setReadyElapsedBaselineSec: (v: number | null) => void
  setSummaryData: (data: ExerciseSummaryData | null) => void
  addNewPR: (exerciseName: string) => void
  setNewPRs: (names: string[]) => void
  setXpEarned: (xp: number | undefined) => void
  setLastSetRestSec: (sec: number) => void
  // Moves the currently-loaded flat fields into exerciseBuffers[idx] — call before
  // switching the active exercise so an in-progress superset partner isn't lost.
  stashExercise: (idx: number) => void
  // Pulls exerciseBuffers[idx] (if any) back into the flat fields and removes it
  // from the stash. Returns whether a buffer existed (false ⇒ caller must init fresh).
  restoreExercise: (idx: number) => boolean
  clearExerciseBuffers: () => void
  addTodayLogged: (sessionKey: string, name: string) => void
  clearTodayLogged: () => void
  // Applies the same day-rollover reset onRehydrateStorage does (clear todayLogged +
  // revertedDeloads, stamp the new date) but callable while the app stays foregrounded
  // across local midnight — the rehydrate guard only fires at app reopen (WK-13).
  rolloverDay: (today: string) => void
  toggleDeloadRevert: (sessionKey: string, name: string) => void
  appendSessionLog: (entry: SessionLogEntry) => void
  setAccumulatedRestMs: (ms: number) => void
  // Atomically transitions to exercise-summary mode — replaces the 8 separate
  // set() calls that previously triggered 8 intermediate re-renders via
  // useSyncExternalStore, one of which rendered with inconsistent state.
  commitExerciseSummary: (data: ExerciseSummaryData) => void
}

export type WorkoutStore = WorkoutState & WorkoutActions

const INITIAL_STATE: WorkoutState = {
  workoutSessionId: '',
  sessionType: null,
  mode: 'pre',
  currentIdx: 0,
  soloMode: false,
  sets: DEFAULT_SETS,
  reps: Array(DEFAULT_SETS).fill(DEFAULT_REPS),
  perSetWeights: [],
  setWeights: [],
  currentSet: 0,
  lapTimes: [],
  setStartMsArray: [],
  setEndMsArray: [],
  workoutPhase: 'rest',
  rpeValues: [],
  accumulatedRestMs: 0,
  restTimes: [],
  timerStarted: false,
  lastSetRestSec: 0,
  exerciseBuffers: {},
  workoutStartMs: null,
  workoutEndMs: null,
  warmupEndedMs: null,
  exerciseStartMs: null,
  lapStartMs: null,
  restStartMs: null,
  lastSetRestStartMs: null,
  lastExerciseEndMs: null,
  readyElapsedBaselineSec: null,
  summaryData: null,
  todayLogged: {},
  sessionLog: [],
  storedDate: todayInTz(),
  revertedDeloads: {},
  newPRs: [],
  xpEarned: undefined,
}

// Extracted from onRehydrateStorage so it's unit-testable against a mocked persisted
// blob without driving zustand's actual persist/rehydrate machinery. Mutates `state`
// in place (matching zustand's own onRehydrateStorage contract) and also returns it.
export function applyRehydrateFixups(
  state: WorkoutState,
  today: string,
  now: number,
): WorkoutState {
  const dateRolledOver = state.storedDate !== today
  if (dateRolledOver) {
    state.storedDate = today
    state.todayLogged = {}
    state.revertedDeloads = {}
  }
  // Transient UI modes must not be restored on app reopen.
  // exercise-summary: stale summaryData crashes ExerciseSummaryScreen on render.
  // done: DoneScreen fires confetti in a useEffect on every mount — app reopen
  //   would show celebratory confetti from a previous session before the reset
  //   useEffect in WorkoutScreen can clear it.
  if (state.mode === 'exercise-summary' || state.mode === 'done') {
    state.mode = 'pre'
    state.summaryData = null
  }
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
  const isStale = (ms: number | null) => ms !== null && now - ms > FOUR_HOURS_MS

  // E1-4: a workout whose start anchor is >4h old or from a previous day is
  // abandoned. The old guard only reset `mode` + the timer anchors and ran ONLY for
  // `mode === 'active'`, leaving `workoutStartMs`/`sessionLog`/`exerciseBuffers`
  // intact — so "Continue Workout" resumed a days-old session, its duration
  // (`end − start`) spanned multiple days, and an app killed in `warmup` reopened
  // straight into a warm-up clock anchored days ago. Fully drop the workout identity
  // for ANY mode; the partially-logged server session is already safe in the DB.
  const sessionStale = state.workoutStartMs !== null && (isStale(state.workoutStartMs) || dateRolledOver)
  if (sessionStale) {
    state.mode = 'pre'
    state.workoutSessionId = ''
    state.workoutStartMs = null
    state.workoutEndMs = null
    state.warmupEndedMs = null
    state.sessionLog = []
    state.exerciseBuffers = {}
    state.currentIdx = 0
    state.currentSet = 0
    state.perSetWeights = []
    state.setWeights = []
    state.setStartMsArray = []
    state.setEndMsArray = []
    state.lapTimes = []
    state.restTimes = []
    state.rpeValues = []
    state.accumulatedRestMs = 0
    state.timerStarted = false
    state.exerciseStartMs = null
    state.lapStartMs = null
    state.restStartMs = null
    state.lastSetRestStartMs = null
    state.lastExerciseEndMs = null
    state.readyElapsedBaselineSec = null
    state.workoutPhase = 'rest'
    state.summaryData = null
  } else if (state.mode === 'active') {
    // A recent session (started <4h ago, same day) whose per-set/lap/rest timer
    // anchors went stale from a brief background — keep the session identity, just
    // clear the anchors and drop to the idle 'rest' phase so no countdown resumes
    // against a stale timestamp.
    const staleAnchor =
      isStale(state.lapStartMs) || isStale(state.restStartMs) || isStale(state.lastSetRestStartMs)
    if (staleAnchor) {
      state.mode = 'pre'
      state.lapStartMs = null
      state.restStartMs = null
      state.lastSetRestStartMs = null
      state.workoutPhase = 'rest'
    }
  }
  return state
}

export const useWorkoutStore = create<WorkoutStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      startWorkout: (sessionType) => set((s) => ({
        workoutSessionId: crypto.randomUUID(),
        sessionType,
        workoutStartMs: Date.now(),
        workoutEndMs: null,
        warmupEndedMs: null,
        mode: 'warmup',
        currentIdx: 0,
        soloMode: false,
        sets: DEFAULT_SETS,
        reps: Array(DEFAULT_SETS).fill(DEFAULT_REPS),
        perSetWeights: [],
        setWeights: [],
        currentSet: 0,
        lapTimes: [],
        setStartMsArray: [],
        setEndMsArray: [],
        workoutPhase: 'rest',
        rpeValues: [],
        accumulatedRestMs: 0,
        restTimes: [],
        timerStarted: false,
        lastSetRestSec: 0,
        exerciseBuffers: {},
        exerciseStartMs: null,
        lapStartMs: null,
        restStartMs: null,
        lastSetRestStartMs: null,
        lastExerciseEndMs: null,
        readyElapsedBaselineSec: null,
        summaryData: null,
        todayLogged: s.todayLogged,
        sessionLog: s.sessionLog,
        storedDate: todayInTz(),
        revertedDeloads: s.revertedDeloads,
        newPRs: [],
        xpEarned: undefined,
      })),

      resetSession: () => set((s) => ({
        ...INITIAL_STATE,
        workoutSessionId: crypto.randomUUID(),
        // Keep todayLogged so the "Complete Workout" button appears immediately after reset
        todayLogged: s.todayLogged,
        revertedDeloads: s.revertedDeloads,
      })),

      setMode: (mode) => set({ mode }),
      setCurrentIdx: (currentIdx) => set({ currentIdx }),
      setSets: (sets) => set({ sets }),
      setReps: (reps) => set({ reps }),
      setPerSetWeights: (perSetWeights) => set({ perSetWeights }),
      updatePerSetWeight: (idx, value) => set((s) => {
        const next = [...s.perSetWeights]
        next[idx] = value
        return { perSetWeights: next }
      }),
      initRpeValues: (values) => set({ rpeValues: values }),
      setRpeValue: (setIdx, value) => set((s) => {
        const next = [...s.rpeValues]
        next[setIdx] = value
        return { rpeValues: next }
      }),
      setSoloMode: (soloMode) => set({ soloMode }),
      setTimerStarted: (timerStarted) => set({ timerStarted }),
      setWorkoutPhase: (workoutPhase) => set({ workoutPhase }),
      setCurrentSet: (currentSet) => set({ currentSet }),
      appendSetWeight: (w) => set((s) => ({ setWeights: [...s.setWeights, w] })),
      clearSetWeights: () => set({ setWeights: [] }),
      appendLapTime: (t) => set((s) => ({ lapTimes: [...s.lapTimes, t] })),
      clearLapTimes: () => set({ lapTimes: [] }),
      appendSetStartMs: (ms) => set((s) => ({ setStartMsArray: [...s.setStartMsArray, ms] })),
      appendSetEndMs: (ms) => set((s) => ({ setEndMsArray: [...s.setEndMsArray, ms] })),
      clearSetTimingArrays: () => set({ setStartMsArray: [], setEndMsArray: [] }),
      addAccumulatedRestMs: (ms) => set((s) => ({ accumulatedRestMs: s.accumulatedRestMs + ms })),
      setAccumulatedRestMs: (ms) => set({ accumulatedRestMs: ms }),
      appendRestTime: (sec) => set((s) => ({ restTimes: [...s.restTimes, sec] })),
      clearRestTimes: () => set({ restTimes: [] }),
      setTimestamps: (patch) => set(patch),
      setReadyElapsedBaselineSec: (readyElapsedBaselineSec) => set({ readyElapsedBaselineSec }),
      setSummaryData: (summaryData) => set({ summaryData }),
      setLastSetRestSec: (lastSetRestSec) => set({ lastSetRestSec }),
      addNewPR: (exerciseName) => set((s) => (
        s.newPRs.includes(exerciseName) ? s : { newPRs: [...s.newPRs, exerciseName] }
      )),
      setNewPRs: (newPRs) => set({ newPRs }),
      setXpEarned: (xpEarned) => set({ xpEarned }),
      stashExercise: (idx) => set((s) => ({
        exerciseBuffers: {
          ...s.exerciseBuffers,
          [idx]: {
            sets: s.sets, reps: s.reps, perSetWeights: s.perSetWeights,
            setWeights: s.setWeights, currentSet: s.currentSet, lapTimes: s.lapTimes,
            setStartMsArray: s.setStartMsArray, setEndMsArray: s.setEndMsArray,
            restTimes: s.restTimes, rpeValues: s.rpeValues,
            accumulatedRestMs: s.accumulatedRestMs, exerciseStartMs: s.exerciseStartMs,
            timerStarted: s.timerStarted, restStartMs: s.restStartMs,
          },
        },
      })),
      restoreExercise: (idx) => {
        const buf = get().exerciseBuffers[idx]
        if (!buf) return false
        set((s) => {
          const rest = { ...s.exerciseBuffers }
          delete rest[idx]
          return {
            exerciseBuffers: rest,
            sets: buf.sets, reps: buf.reps, perSetWeights: buf.perSetWeights,
            setWeights: buf.setWeights, currentSet: buf.currentSet, lapTimes: buf.lapTimes,
            setStartMsArray: buf.setStartMsArray, setEndMsArray: buf.setEndMsArray,
            restTimes: buf.restTimes, rpeValues: buf.rpeValues,
            accumulatedRestMs: buf.accumulatedRestMs, exerciseStartMs: buf.exerciseStartMs,
            timerStarted: buf.timerStarted,
            restStartMs: buf.restStartMs, lapStartMs: null, workoutPhase: 'rest',
          }
        })
        return true
      },
      clearExerciseBuffers: () => set({ exerciseBuffers: {} }),
      commitExerciseSummary: (summaryData) => set({
        summaryData,
        mode: 'exercise-summary',
        currentSet: 0,
        lapTimes: [],
        setStartMsArray: [],
        setEndMsArray: [],
        restTimes: [],
        lapStartMs: null,
        restStartMs: null,
        // Deliberately NOT cleared here (unlike restStartMs above) — the exercise-summary
        // screen shows a live rest countdown anchored on this (LastSetRestTimer), so it
        // must survive the transition. advance() clears it once the user actually leaves
        // the summary screen, whichever of its three exit paths they take.
        accumulatedRestMs: 0,
      }),
      addTodayLogged: (sessionKey, name) => set((s) => ({
        todayLogged: {
          ...s.todayLogged,
          [sessionKey]: [...new Set([...(s.todayLogged[sessionKey] ?? []), name])],
        },
      })),
      clearTodayLogged: () => set({ todayLogged: {} }),
      rolloverDay: (today) => set({ storedDate: today, todayLogged: {}, revertedDeloads: {} }),
      toggleDeloadRevert: (sessionKey, name) => set((s) => {
        const cur = s.revertedDeloads[sessionKey] ?? []
        const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
        return { revertedDeloads: { ...s.revertedDeloads, [sessionKey]: next } }
      }),
      appendSessionLog: (entry) => set((s) => ({ sessionLog: [...s.sessionLog, entry] })),
    }),
    {
      name: 'ta_workout_state',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        applyRehydrateFixups(state, todayInTz(), Date.now())
      },
    }
  )
)

// A workout is "in progress" — and leaving should be confirmed — whenever it has been
// started and not yet completed. "pre" is also the hub screen shown *during* a workout
// (between exercises, after a solo log, or after an app reopen mid-workout via
// onRehydrateStorage above), so it must NOT be excluded here — only exclude "done",
// which means the workout was already saved and leaving is safe.
export function isWorkoutActive(state: Pick<WorkoutState, 'workoutStartMs' | 'mode'>): boolean {
  return !!state.workoutStartMs && state.mode !== 'done'
}

// The single shared rest-target derivation (TMR-1/TMR-5) — a style-less set (no
// configured restSec, lastSetRestSec === 0) still gets a real countdown target instead
// of silently skipping the beep/notification (which gated on `> 0`) while the ring
// visually assumed a hardcoded 90s.
export function effectiveRestSec(lastSetRestSec: number): number {
  return lastSetRestSec > 0 ? lastSetRestSec : 90
}
