> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Workout Flow Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the workout exercise flow to be one continuous session (timer visible across all screens), replace scattered useState/useRef with a Zustand persist store so page reloads don't lose state, add per-set epoch timestamps for HR correlation, and turn solo exercise pills into a read-only stats sheet.

**Architecture:** A single Zustand store (`lib/stores/workout-store.ts`) holds all workout state and is persisted to `localStorage` under `ta_workout_state`. `workout-screen.tsx` reads from/writes to the store instead of holding local state. Child screens receive a `sessionElapsedSec` prop driven by a single interval in the orchestrator. New DB columns capture absolute epoch ms for each set start/end.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand v5 (already installed), Drizzle ORM, PostgreSQL on Railway, Tailwind CSS v4.

**Branch:** `claude/exercise-flow-rework-CkP77`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/data/postgres/migrations/015_set_timing.sql` | Create | Adds `set_start_ms`, `set_end_ms` to `set_logs`; `inter_exercise_rest_sec` to `exercise_logs` |
| `lib/types/log.ts` | Modify | Add `setStartMs?`, `setEndMs?` to `SetLog`; `interExerciseRestSec?` to `ExerciseLog` |
| `lib/data/postgres/schema.ts` | Modify | Add bigint columns to match migration |
| `lib/data/postgres/adapter.ts` | Modify | `logSets` writes new timing fields; `logExercise` writes `interExerciseRestSec` |
| `app/api/log-exercise/route.ts` | Modify | Accept `setStartTimes`, `setEndTimes`, `interExerciseRestSec` in POST body |
| `lib/stores/workout-store.ts` | Create | Zustand store with persist — all workout state + typed actions |
| `components/workout-screen.tsx` | Modify | Replace useState/useRef with store; two intervals (session + exercise timer); pass `sessionElapsedSec` to children |
| `components/workout/exercise-stats-sheet.tsx` | Create | Read-only stats bottom sheet (1RM table, trendline, muscle map) |
| `components/workout/pre-workout-screen.tsx` | Modify | Pill tap → stats sheet; re-do button stays; remove solo launch from normal tap |
| `components/workout/active-workout-screen.tsx` | Modify | Move warmup strip to ready screen; accept `sessionElapsedSec`; replace `restStartRef` prop with `restStartMs: number \| null` |
| `components/workout/warmup-screen.tsx` | Modify | Remove own interval; accept `sessionElapsedSec` prop |
| `components/workout/exercise-summary-screen.tsx` | Modify | Accept `sessionElapsedSec`; show in header |
| `components/workout/done-screen.tsx` | Modify | Call `useWorkoutStore.resetSession()` on mount after confetti |

---

## Task 1: DB migration + types + schema + adapter

**Files:**
- Create: `lib/data/postgres/migrations/015_set_timing.sql`
- Modify: `lib/types/log.ts`
- Modify: `lib/data/postgres/schema.ts` (lines 107–117 `setLogs` table, lines 92–105 `exerciseLogs` table)
- Modify: `lib/data/postgres/adapter.ts` (lines 408–466 `logExercise` + `logSets`)

- [ ] **Step 1: Create migration**

```sql
-- lib/data/postgres/migrations/015_set_timing.sql
ALTER TABLE set_logs      ADD COLUMN IF NOT EXISTS set_start_ms BIGINT;
ALTER TABLE set_logs      ADD COLUMN IF NOT EXISTS set_end_ms   BIGINT;
ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS inter_exercise_rest_sec INTEGER;
```

- [ ] **Step 2: Update SetLog + ExerciseLog types in `lib/types/log.ts`**

Replace the existing `SetLog` and `ExerciseLog` interfaces:

```ts
export interface SetLog {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number
  reps: number
  setTimeSec?: number
  restTimeSec?: number
  intensityPct?: number
  useFor1rm: boolean
  setStartMs?: number
  setEndMs?: number
}

export interface ExerciseLog {
  id: string
  workoutSessionId: string
  exerciseName: string
  styleId?: string
  styleName?: string
  estimated1rm?: number
  target80?: number
  volume?: number
  avgReps?: number
  timeToComplete?: number
  muscleGroups: string[]
  loggedAt: Date
  sets: SetLog[]
  interExerciseRestSec?: number
}
```

- [ ] **Step 3: Update Drizzle schema in `lib/data/postgres/schema.ts`**

Add `bigint` to the imports at the top of the file (it is not currently imported):

```ts
import {
  pgTable, text, boolean, timestamp, uuid,
  integer, doublePrecision, date, time, primaryKey, unique, jsonb, bigint,
} from 'drizzle-orm/pg-core'
```

In the `setLogs` table definition, add two columns after `useFor1rm`:

```ts
export const setLogs = pgTable('set_logs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  exerciseLogId: uuid('exercise_log_id').notNull().references(() => exerciseLogs.id, { onDelete: 'cascade' }),
  setNumber:     integer('set_number').notNull(),
  weightKg:      doublePrecision('weight_kg').notNull(),
  reps:          integer('reps').notNull(),
  setTimeSec:    integer('set_time_sec'),
  restTimeSec:   integer('rest_time_sec'),
  intensityPct:  doublePrecision('intensity_pct'),
  useFor1rm:     boolean('use_for_1rm').notNull().default(false),
  setStartMs:    bigint('set_start_ms', { mode: 'number' }),
  setEndMs:      bigint('set_end_ms', { mode: 'number' }),
}, t => [unique().on(t.exerciseLogId, t.setNumber)])
```

In the `exerciseLogs` table definition, add `interExerciseRestSec` after `loggedAt`:

```ts
export const exerciseLogs = pgTable('exercise_logs', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  workoutSessionId:     uuid('workout_session_id').notNull().references(() => workoutSessions.id, { onDelete: 'cascade' }),
  exerciseName:         text('exercise_name').notNull(),
  styleId:              uuid('style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  styleName:            text('style_name'),
  estimated1rm:         doublePrecision('estimated_1rm'),
  target80:             doublePrecision('target_80'),
  volume:               doublePrecision('volume'),
  avgReps:              doublePrecision('avg_reps'),
  timeToComplete:       integer('time_to_complete'),
  muscleGroups:         text('muscle_groups').array().notNull().default([]),
  loggedAt:             timestamp('logged_at', { withTimezone: true }).notNull(),
  interExerciseRestSec: integer('inter_exercise_rest_sec'),
})
```

- [ ] **Step 4: Update `logExercise` in `lib/data/postgres/adapter.ts`** (around line 408)

Add `interExerciseRestSec` to the insert values:

```ts
async logExercise(log: Omit<ExerciseLog, 'id' | 'sets'>): Promise<ExerciseLog> {
  const [r] = await this.db.insert(s.exerciseLogs)
    .values({
      workoutSessionId: log.workoutSessionId,
      exerciseName: log.exerciseName,
      styleId: log.styleId ?? null,
      styleName: log.styleName ?? null,
      estimated1rm: log.estimated1rm ?? null,
      target80: log.target80 ?? null,
      volume: log.volume ?? null,
      avgReps: log.avgReps ?? null,
      timeToComplete: log.timeToComplete ?? null,
      muscleGroups: log.muscleGroups,
      loggedAt: log.loggedAt,
      interExerciseRestSec: log.interExerciseRestSec ?? null,
    })
    .returning()
  return { ...log, id: r.id, sets: [] }
}
```

- [ ] **Step 5: Update `logExerciseWithId` in `lib/data/postgres/adapter.ts`** (around line 427)

Add `interExerciseRestSec` to the insert values:

```ts
async logExerciseWithId(log: Omit<ExerciseLog, 'sets'> & { id: string }): Promise<void> {
  await this.db.insert(s.exerciseLogs)
    .values({
      id: log.id,
      workoutSessionId: log.workoutSessionId,
      exerciseName: log.exerciseName,
      styleId: log.styleId ?? null,
      styleName: log.styleName ?? null,
      estimated1rm: log.estimated1rm ?? null,
      target80: log.target80 ?? null,
      volume: log.volume ?? null,
      avgReps: log.avgReps ?? null,
      timeToComplete: log.timeToComplete ?? null,
      muscleGroups: log.muscleGroups,
      loggedAt: log.loggedAt,
      interExerciseRestSec: log.interExerciseRestSec ?? null,
    })
    .onConflictDoNothing()
}
```

- [ ] **Step 6: Update `logSets` in `lib/data/postgres/adapter.ts`** (around line 446)

Add `setStartMs` and `setEndMs` to the insert and upsert:

```ts
async logSets(exerciseLogId: string, sets: Omit<SetLog, 'id' | 'exerciseLogId'>[]): Promise<SetLog[]> {
  const saved: SetLog[] = []
  for (const set of sets) {
    const [r] = await this.db.insert(s.setLogs)
      .values({
        exerciseLogId, setNumber: set.setNumber, weightKg: set.weightKg,
        reps: set.reps, setTimeSec: set.setTimeSec ?? null,
        restTimeSec: set.restTimeSec ?? null, intensityPct: set.intensityPct ?? null,
        useFor1rm: set.useFor1rm,
        setStartMs: set.setStartMs ?? null,
        setEndMs: set.setEndMs ?? null,
      })
      .onConflictDoUpdate({
        target: [s.setLogs.exerciseLogId, s.setLogs.setNumber],
        set: {
          weightKg: sql`EXCLUDED.weight_kg`, reps: sql`EXCLUDED.reps`,
          setTimeSec: sql`EXCLUDED.set_time_sec`, restTimeSec: sql`EXCLUDED.rest_time_sec`,
          intensityPct: sql`EXCLUDED.intensity_pct`, useFor1rm: sql`EXCLUDED.use_for_1rm`,
          setStartMs: sql`EXCLUDED.set_start_ms`, setEndMs: sql`EXCLUDED.set_end_ms`,
        },
      })
      .returning()
    saved.push({ ...set, id: r.id, exerciseLogId })
  }
  return saved
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to the changed files.

- [ ] **Step 8: Commit**

```bash
git add lib/data/postgres/migrations/015_set_timing.sql \
        lib/types/log.ts \
        lib/data/postgres/schema.ts \
        lib/data/postgres/adapter.ts
git commit -m "Add set_start_ms, set_end_ms, inter_exercise_rest_sec columns for HR correlation"
```

---

## Task 2: Update log-exercise API route

**Files:**
- Modify: `app/api/log-exercise/route.ts`

- [ ] **Step 1: Add new fields to body type and destructuring** (around line 44)

Replace the `body` type block and destructuring to include the new fields:

```ts
let body: {
  sessionName: string;
  sessionId?: string;
  workoutSessionId?: string;
  exercise: string;
  weights: number[];
  sets: number;
  reps: number[];
  localDate?: string;
  timeToCompleteSet?: number;
  setTimes?: number[];
  restTimes?: number[];
  setStartTimes?: number[];   // epoch ms per set
  setEndTimes?: number[];     // epoch ms per set
  interExerciseRestSec?: number;
  progressionStyle?: StyleSet[];
  styleName?: string;
  styleId?: string;
  muscleGroups?: string[];
};
```

Add to the destructuring (around line 68):

```ts
const {
  sessionName, sessionId, workoutSessionId,
  exercise, weights, sets, reps,
  localDate, timeToCompleteSet, setTimes, restTimes,
  setStartTimes, setEndTimes, interExerciseRestSec,
  progressionStyle, styleName, styleId, muscleGroups,
} = body;
```

- [ ] **Step 2: Pass `interExerciseRestSec` to `logExercise`** (around line 109)

```ts
const exerciseLog = await repo.logExercise({
  workoutSessionId: wsId,
  exerciseName: exercise,
  styleId: styleId,
  styleName: styleName,
  estimated1rm,
  target80,
  volume,
  avgReps,
  timeToComplete: timeToCompleteSet,
  muscleGroups: muscleGroups ?? [],
  loggedAt: new Date(),
  interExerciseRestSec: interExerciseRestSec ?? undefined,
});
```

- [ ] **Step 3: Pass `setStartMs` and `setEndMs` to `logSets`** (around line 125)

```ts
const setData = weights.map((w, i) => {
  const r = reps[i] ?? reps[reps.length - 1];
  return {
    setNumber: i + 1,
    weightKg: w,
    reps: r,
    setTimeSec: setTimes?.[i],
    restTimeSec: restTimes?.[i],
    intensityPct: estimated1rm > 0 ? Math.round(w / estimated1rm * 1000) / 10 : undefined,
    useFor1rm: progressionStyle?.[i]?.useFor1rm ?? false,
    setStartMs: setStartTimes?.[i],
    setEndMs: setEndTimes?.[i],
  };
});
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "Pass set_start_ms, set_end_ms, inter_exercise_rest_sec through log-exercise API"
```

---

## Task 3: Zustand workout store

**Files:**
- Create: `lib/stores/workout-store.ts`

The store holds all state that previously lived in `workout-screen.tsx`. Timestamps are stored as `number | null` (ms since epoch) rather than refs.

- [ ] **Step 1: Create `lib/stores/workout-store.ts`**

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WorkoutMode, ExerciseSummaryData, SessionLogEntry } from '@/components/workout/types'
import { DEFAULT_SETS, DEFAULT_REPS } from '@/components/workout/utils'

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
  accumulatedRestMs: number
  restTimes: number[]        // rest seconds before each set
  timerStarted: boolean

  // Timestamps (ms since epoch; previously useRef)
  workoutStartMs: number | null
  workoutEndMs: number | null
  exerciseStartMs: number | null
  lapStartMs: number | null
  restStartMs: number | null
  lastExerciseEndMs: number | null  // setEndMs of last set of previous exercise

  // Results
  summaryData: ExerciseSummaryData | null
  todayLogged: string[]        // serialised Set<string>
  sessionLog: SessionLogEntry[]
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
    'workoutStartMs' | 'workoutEndMs' | 'exerciseStartMs' | 'lapStartMs' | 'restStartMs' | 'lastExerciseEndMs'
  >>) => void
  setSummaryData: (data: ExerciseSummaryData | null) => void
  addTodayLogged: (name: string) => void
  appendSessionLog: (entry: SessionLogEntry) => void
  setAccumulatedRestMs: (ms: number) => void
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
  accumulatedRestMs: 0,
  restTimes: [],
  timerStarted: false,
  workoutStartMs: null,
  workoutEndMs: null,
  exerciseStartMs: null,
  lapStartMs: null,
  restStartMs: null,
  lastExerciseEndMs: null,
  summaryData: null,
  todayLogged: [],
  sessionLog: [],
}

export const useWorkoutStore = create<WorkoutStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      startWorkout: (sessionType) => set({
        workoutSessionId: crypto.randomUUID(),
        sessionType,
        workoutStartMs: Date.now(),
        mode: 'warmup',
      }),

      resetSession: () => set({
        ...INITIAL_STATE,
        workoutSessionId: crypto.randomUUID(),
      }),

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
      setSummaryData: (summaryData) => set({ summaryData }),
      addTodayLogged: (name) => set((s) => ({ todayLogged: [...new Set([...s.todayLogged, name])] })),
      appendSessionLog: (entry) => set((s) => ({ sessionLog: [...s.sessionLog, entry] })),
    }),
    {
      name: 'ta_workout_state',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/stores/workout-store.ts
git commit -m "Add Zustand workout store with localStorage persist"
```

---

## Task 4: Migrate workout-screen.tsx to Zustand

**Files:**
- Modify: `components/workout-screen.tsx`

This is the largest change. The component stops holding its own state and instead reads from/writes to the store. Two derived values (`sessionElapsedSec`, `exerciseElapsedSec`) are computed locally via `useState` + `useEffect` intervals driven by store timestamps.

- [ ] **Step 1: Replace the entire `components/workout-screen.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { invalidateCalendarCache, localDatetimeString, localDateString } from "@/lib/utils";
import { PreWorkoutScreen } from "@/components/workout/pre-workout-screen";
import { WarmupScreen } from "@/components/workout/warmup-screen";
import { ActiveWorkoutScreen } from "@/components/workout/active-workout-screen";
import { ExerciseSummaryScreen } from "@/components/workout/exercise-summary-screen";
import { DoneScreen } from "@/components/workout/done-screen";
import {
  DEFAULT_SETS,
  DEFAULT_REPS,
  mround125,
  calc1RM,
} from "@/components/workout/utils";
import type { ExerciseSummaryData, SessionLogEntry } from "@/components/workout/types";
import { writeLocalWorkout, addToOutbox } from "@/lib/sqlite/outbox";
import { useWorkoutStore } from "@/lib/stores/workout-store";

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch { /* AudioContext unavailable */ }
}

interface WorkoutScreenProps {
  sessionType: string;
}

export default function WorkoutScreen({ sessionType }: WorkoutScreenProps) {
  const store = useWorkoutStore();

  // Non-persisted UI state
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [loggedCount, setLoggedCount] = useState(0);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarAdded, setCalendarAdded] = useState(false);

  // Session timer (ticks from workoutStartMs — survives screen transitions)
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  useEffect(() => {
    const ms = store.workoutStartMs;
    if (!ms) return;
    setSessionElapsedSec(Math.floor((Date.now() - ms) / 1000));
    const id = setInterval(
      () => setSessionElapsedSec(Math.floor((Date.now() - ms) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [store.workoutStartMs]);

  // Per-exercise timer (ticks from exerciseStartMs — only in "active" mode)
  const [exerciseElapsedSec, setExerciseElapsedSec] = useState(0);
  useEffect(() => {
    if (store.mode !== "active") return;
    const ms = store.exerciseStartMs;
    if (!ms) return;
    setExerciseElapsedSec(Math.floor((Date.now() - ms) / 1000));
    const id = setInterval(
      () => setExerciseElapsedSec(Math.floor((Date.now() - ms) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [store.mode, store.exerciseStartMs]);

  const beepFiredRef = useRef(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchExercises = useCallback(async () => {
    const tab = sessionType.toLowerCase();
    const cacheKey = `ta_wc_${tab}`;
    let hadCache = false;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        setExercises(data.exercises ?? []);
        setLoading(false);
        hadCache = true;
      }
    } catch { /* corrupt cache */ }
    if (!hadCache) setLoading(true);
    try {
      const res = await fetch(`/api/workout-data?tab=${encodeURIComponent(tab)}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
      setExercises(data.exercises ?? []);
    } catch {
      if (!hadCache) toast.error("Could not load workout data");
    } finally {
      setLoading(false);
    }
  }, [sessionType]);

  const refreshExercises = useCallback(() => {
    const tab = sessionType.toLowerCase();
    sessionStorage.removeItem(`ta_wc_${tab}`);
    fetchExercises();
  }, [sessionType, fetchExercises]);

  useEffect(() => { fetchExercises(); }, [fetchExercises]);

  // Reset store mode to "pre" if persisted done state is encountered on mount
  useEffect(() => {
    if (store.mode === "done") store.resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Rest timer beep ───────────────────────────────────────────────────────

  const currentRestSec = useMemo(() => {
    const ex = exercises[store.currentIdx];
    return ex?.progressionStyle?.[store.currentSet - 1]?.restSec ?? 0;
  }, [exercises, store.currentIdx, store.currentSet]);

  useEffect(() => {
    if (store.workoutPhase !== "rest" || currentRestSec <= 0 || store.restStartMs === null) {
      beepFiredRef.current = false;
      return;
    }
    const restElapsed = Math.floor((Date.now() - store.restStartMs) / 1000);
    if (restElapsed >= currentRestSec && !beepFiredRef.current) {
      beepFiredRef.current = true;
      playBeep();
    }
  }, [sessionElapsedSec, store.workoutPhase, currentRestSec, store.restStartMs]);

  // ── Initialise per-set weights when exercise changes ──────────────────────

  useEffect(() => {
    const ex = exercises[store.currentIdx];
    if (!ex) return;
    store.setPerSetWeights(Array.from({ length: store.sets }, (_, i) => {
      if (ex.progressionStyle && ex.estimated1rm) {
        const sc = ex.progressionStyle[i];
        if (sc) return mround125(ex.estimated1rm * sc.pct / 100);
      }
      return ex.target80 != null ? mround125(ex.target80) : 60;
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentIdx, exercises]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const launchExercise = useCallback(
    (idx: number, solo: boolean) => {
      const ex = exercises[idx];
      const style = ex?.progressionStyle;
      const ds = style ? style.length : (ex?.defaultSets ?? DEFAULT_SETS);
      store.setSets(ds);
      store.setReps(style ? style.map((s) => s.reps) : Array(ds).fill(DEFAULT_REPS));
      store.setCurrentIdx(idx);
      store.setSoloMode(solo);
      store.setTimerStarted(false);
      store.setCurrentSet(0);
      store.clearLapTimes();
      store.clearSetTimingArrays();
      store.clearSetWeights();
      store.clearRestTimes();
      store.setAccumulatedRestMs(0);
      store.setTimestamps({ exerciseStartMs: null, lapStartMs: null, restStartMs: null });
      store.setMode("active");
    },
    [exercises, store],
  );

  const advance = useCallback(() => {
    // Save the end timestamp of the last set for inter-exercise rest calculation
    const lastSetEndMs = store.setEndMsArray[store.setEndMsArray.length - 1] ?? null;

    if (store.soloMode) {
      store.setSoloMode(false);
      store.setTimestamps({ lastExerciseEndMs: lastSetEndMs });
      store.setMode("pre");
      return;
    }
    if (store.currentIdx < exercises.length - 1) {
      const nextIdx = store.currentIdx + 1;
      const nextEx = exercises[nextIdx];
      const nextStyle = nextEx?.progressionStyle;
      const ds = nextStyle ? nextStyle.length : (nextEx?.defaultSets ?? DEFAULT_SETS);
      store.setSets(ds);
      store.setReps(nextStyle ? nextStyle.map((s) => s.reps) : Array(ds).fill(DEFAULT_REPS));
      store.setCurrentIdx(nextIdx);
      store.setTimerStarted(false);
      store.setCurrentSet(0);
      store.clearLapTimes();
      store.clearSetTimingArrays();
      store.clearSetWeights();
      store.clearRestTimes();
      store.setAccumulatedRestMs(0);
      store.setSummaryData(null);
      store.setWorkoutPhase("rest");
      store.setTimestamps({
        exerciseStartMs: null,
        lapStartMs: null,
        restStartMs: null,
        lastExerciseEndMs: lastSetEndMs,
      });
      store.setMode("active");
    } else {
      completeWorkout();
      store.setTimestamps({ lastExerciseEndMs: lastSetEndMs });
      store.setMode("done");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentIdx, exercises, store.soloMode, store.setEndMsArray]);

  const handleRepChange = useCallback((setIndex: number, value: number) => {
    store.setReps(store.reps.map((r, i) => i === setIndex ? value : r));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.reps]);

  const handleWeightChange = useCallback((setIndex: number, value: number) => {
    store.updatePerSetWeight(setIndex, value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = useCallback(() => {
    const now = Date.now();
    store.setTimestamps({ exerciseStartMs: now, restStartMs: now });
    store.setAccumulatedRestMs(0);
    store.setTimerStarted(true);
    store.setWorkoutPhase("rest");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartSet = useCallback(() => {
    const now = Date.now();
    const restMs = store.restStartMs !== null ? now - store.restStartMs : 0;
    store.addAccumulatedRestMs(restMs);
    store.appendRestTime(Math.round(restMs / 1000));
    store.setTimestamps({ lapStartMs: now, restStartMs: null });
    store.appendSetStartMs(now);
    store.setWorkoutPhase("set");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.restStartMs]);

  const handleLogCurrentSet = useCallback(() => {
    if (store.currentSet >= store.sets) return;
    const now = Date.now();
    const lapTime =
      store.lapStartMs !== null
        ? Math.round((now - store.lapStartMs) / 1000)
        : undefined;
    store.appendSetWeight(store.perSetWeights[store.currentSet] ?? 60);
    if (lapTime !== undefined) store.appendLapTime(lapTime);
    store.appendSetEndMs(now);
    store.setTimestamps({ lapStartMs: null, restStartMs: now });
    store.setCurrentSet(store.currentSet + 1);
    store.setWorkoutPhase("rest");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentSet, store.sets, store.perSetWeights, store.lapStartMs]);

  const handleCompleteSet = useCallback(async () => {
    const ex = exercises[store.currentIdx];
    if (!ex || store.currentSet < store.sets) return;
    // Snapshot before any await
    const snapWeights = [...store.setWeights];
    const snapReps = [...store.reps];
    const snapLapTimes = [...store.lapTimes];
    const snapSetStartTimes = [...store.setStartMsArray];
    const snapSetEndTimes = [...store.setEndMsArray];
    const snapRestTimes = [...store.restTimes];
    const snapAccRestMs = store.accumulatedRestMs;
    const snapExerciseStartMs = store.exerciseStartMs;
    const snapLastExerciseEndMs = store.lastExerciseEndMs;

    store.clearSetWeights();

    const totalTime =
      snapLapTimes.length > 0
        ? snapLapTimes.reduce((a, b) => a + b, 0)
        : snapExerciseStartMs !== null
          ? Math.round((Date.now() - snapExerciseStartMs) / 1000)
          : undefined;

    const perSetEst1rm = snapWeights.map((w, i) => calc1RM(w, snapReps[i] ?? 0));
    const newEst1rm = Math.max(...perSetEst1rm);
    const target80 = Math.round(newEst1rm * 0.8 * 4) / 4;
    const volume = snapWeights.reduce((sum, w, i) => sum + w * (snapReps[i] ?? 0), 0);
    const avgReps = snapReps.reduce((sum, r) => sum + r, 0) / (snapReps.length || 1);
    const exerciseLogId = crypto.randomUUID();
    const loggedAt = localDatetimeString();

    // Inter-exercise rest: time from last set end of previous exercise to "Begin Exercise" tap
    const interExerciseRestSec =
      snapLastExerciseEndMs !== null && snapExerciseStartMs !== null
        ? Math.round((snapExerciseStartMs - snapLastExerciseEndMs) / 1000)
        : undefined;

    const offlinePayload = {
      workoutSessionId: store.workoutSessionId,
      sessionName: sessionType,
      startedAt: new Date(store.workoutStartMs ?? Date.now()).toISOString(),
      exerciseLogId,
      exercise: ex.name,
      loggedAt,
      weights: snapWeights,
      reps: snapReps,
      sets: store.sets,
      timeToCompleteSet: totalTime,
      setTimes: snapLapTimes.length > 0 ? snapLapTimes : undefined,
      restTimes: snapRestTimes.length > 0 ? snapRestTimes : undefined,
      setStartTimes: snapSetStartTimes.length > 0 ? snapSetStartTimes : undefined,
      setEndTimes: snapSetEndTimes.length > 0 ? snapSetEndTimes : undefined,
      interExerciseRestSec,
      styleName: ex.styleName ?? undefined,
      styleId: ex.styleId,
      estimated1rm: newEst1rm,
      target80,
      volume,
      avgReps,
      setLogs: snapWeights.map((w, i) => ({
        id: crypto.randomUUID(),
        setNumber: i + 1,
        weightKg: w,
        reps: snapReps[i] ?? 0,
        setTimeSec: snapLapTimes[i],
        restTimeSec: snapRestTimes[i],
        intensityPct: newEst1rm > 0 ? Math.round((w / newEst1rm) * 1000) / 10 : undefined,
        useFor1rm: ex.progressionStyle?.[i]?.useFor1rm ?? true,
        setStartMs: snapSetStartTimes[i],
        setEndMs: snapSetEndTimes[i],
      })),
    };

    await writeLocalWorkout(offlinePayload, false);

    setLogging(true);
    try {
      const res = await fetch("/api/log-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionName: sessionType,
          workoutSessionId: store.workoutSessionId,
          exerciseLogId,
          exercise: ex.name,
          weights: snapWeights,
          sets: store.sets,
          reps: snapReps,
          localDate: loggedAt,
          timeToCompleteSet: totalTime,
          setTimes: snapLapTimes.length > 0 ? snapLapTimes : undefined,
          restTimes: snapRestTimes.length > 0 ? snapRestTimes : undefined,
          setStartTimes: snapSetStartTimes.length > 0 ? snapSetStartTimes : undefined,
          setEndTimes: snapSetEndTimes.length > 0 ? snapSetEndTimes : undefined,
          interExerciseRestSec,
          progressionStyle: ex.progressionStyle ?? undefined,
          styleName: ex.styleName ?? undefined,
          styleId: ex.styleId,
          muscleGroups: ex.muscleGroups?.length ? ex.muscleGroups : undefined,
        }),
      });
      if (res.ok) {
        await writeLocalWorkout(offlinePayload, true);
      } else {
        await addToOutbox(offlinePayload);
      }
    } catch {
      await addToOutbox(offlinePayload);
    } finally {
      setLogging(false);
    }

    invalidateCalendarCache();
    sessionStorage.removeItem(`ta_wc_${sessionType.toLowerCase()}`);
    setLoggedCount((c) => c + 1);
    store.addTodayLogged(ex.name);
    store.appendSessionLog({ name: ex.name, setWeights: snapWeights, reps: snapReps });
    store.setSummaryData({
      exName: ex.name,
      setWeights: snapWeights,
      sets: store.sets,
      reps: snapReps,
      lapTimes: snapLapTimes,
      restSec: snapAccRestMs > 0 ? Math.round(snapAccRestMs / 1000) : 0,
      prevEst1rm: ex.estimated1rm ?? null,
      newEst1rm,
      target80,
      progressionStyle: ex.progressionStyle?.map((s) => ({ pct: s.pct, reps: s.reps })),
    });
    store.setCurrentSet(0);
    store.clearLapTimes();
    store.clearSetTimingArrays();
    store.clearRestTimes();
    store.setTimestamps({ lapStartMs: null, restStartMs: null });
    store.setAccumulatedRestMs(0);
    store.setMode("exercise-summary");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, store.currentIdx, store.currentSet, store.sets, store.lapTimes,
      store.reps, store.setWeights, sessionType, store.accumulatedRestMs, store.restTimes,
      store.setStartMsArray, store.setEndMsArray, store.exerciseStartMs,
      store.lastExerciseEndMs, store.workoutSessionId, store.workoutStartMs]);

  const handleAddToCalendar = useCallback(
    async (log: SessionLogEntry[]) => {
      if (!log.length) return;
      if (typeof window !== "undefined" && localStorage.getItem("ta_pref_calendar_sync") === "false") return;
      const endMs = store.workoutEndMs ?? Date.now();
      const startMs = Math.min(store.workoutStartMs ?? endMs, endMs - 60_000);
      setCalendarLoading(true);
      try {
        const res = await fetch("/api/log-calendar-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionType, startMs, endMs, exercises: log }),
        });
        const data = await res.json();
        if (data.code === "CALENDAR_SCOPE_MISSING") {
          toast.error("Calendar permission missing — sign out and reconnect to grant it.");
        } else if (data.success) {
          setCalendarAdded(true);
        } else {
          toast.error("Failed to add to calendar");
        }
      } catch {
        toast.error("Failed to add to calendar");
      } finally {
        setCalendarLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionType, store.workoutEndMs, store.workoutStartMs],
  );

  const completeWorkout = useCallback(() => {
    const endMs = Date.now();
    store.setTimestamps({ workoutEndMs: endMs });
    fetch("/api/complete-workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workoutSessionId: store.workoutSessionId }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.workoutSessionId]);

  const handleBack = useCallback(() => {
    store.setSoloMode(false);
    store.setCurrentSet(0);
    store.clearLapTimes();
    store.setTimestamps({ lapStartMs: null });
    store.setMode("pre");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive todayLogged as Set<string> for child components
  const todayLoggedSet = useMemo(() => new Set(store.todayLogged), [store.todayLogged]);

  // ── Route to the active screen ─────────────────────────────────────────────

  if (store.mode === "pre") {
    return (
      <PreWorkoutScreen
        sessionType={sessionType}
        exercises={exercises}
        loading={loading}
        todayLogged={todayLoggedSet}
        sessionLog={store.sessionLog}
        onLaunchExercise={launchExercise}
        onStartWorkout={() => store.startWorkout(sessionType)}
        onRefresh={refreshExercises}
        onCompleteWorkout={() => {
          localStorage.setItem(`ta_complete_${sessionType.toLowerCase()}_${localDateString()}`, "1");
          completeWorkout();
          store.setMode("done");
          handleAddToCalendar(store.sessionLog);
        }}
      />
    );
  }

  if (store.mode === "warmup") {
    return (
      <WarmupScreen
        sessionType={sessionType}
        exercises={exercises}
        sessionElapsedSec={sessionElapsedSec}
        onBeginExercises={() => launchExercise(0, false)}
        onBack={() => {
          store.setTimestamps({ workoutStartMs: null });
          store.setMode("pre");
        }}
      />
    );
  }

  if (store.mode === "exercise-summary" && store.summaryData) {
    return (
      <ExerciseSummaryScreen
        summaryData={store.summaryData}
        sessionElapsedSec={sessionElapsedSec}
        onNext={advance}
      />
    );
  }

  if (store.mode === "done") {
    const durationMinutes =
      store.workoutStartMs && store.workoutEndMs
        ? Math.round((store.workoutEndMs - store.workoutStartMs) / 60000)
        : null;
    return (
      <DoneScreen
        exercises={exercises}
        todayLogged={todayLoggedSet}
        workoutStartMs={store.workoutStartMs}
        calendarLoading={calendarLoading}
        calendarAdded={calendarAdded}
        durationMinutes={durationMinutes}
      />
    );
  }

  // mode === "active"
  return (
    <ActiveWorkoutScreen
      exercise={exercises[store.currentIdx]}
      exerciseIndex={store.currentIdx}
      totalExercises={exercises.length}
      soloMode={store.soloMode}
      timerStarted={store.timerStarted}
      sets={store.sets}
      reps={store.reps}
      perSetWeights={store.perSetWeights}
      onWeightChange={handleWeightChange}
      currentSet={store.currentSet}
      lapTimes={store.lapTimes}
      lapStartMs={store.lapStartMs}
      workoutPhase={store.workoutPhase}
      restTimes={store.restTimes}
      restStartMs={store.restStartMs}
      exerciseElapsedSec={exerciseElapsedSec}
      sessionElapsedSec={sessionElapsedSec}
      logging={logging}
      onRepChange={handleRepChange}
      onStartSet={handleStartSet}
      onLogCurrentSet={handleLogCurrentSet}
      onCompleteSet={handleCompleteSet}
      onStart={handleStart}
      onBack={handleBack}
      onSkip={advance}
      sessionName={sessionType}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -60
```

TypeScript will report errors for mismatched props on child components — that is expected and will be fixed in Tasks 5–8.

- [ ] **Step 3: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "Migrate workout-screen.tsx to Zustand store"
```

---

## Task 5: Update ActiveWorkoutScreen props

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`

Changes: replace `lapStartRef`/`restStartRef` `MutableRefObject` props with plain `number | null`; add `sessionElapsedSec` and `exerciseElapsedSec`; move warmup strip from `timerStarted=true` to `timerStarted=false`.

- [ ] **Step 1: Replace the interface and component signature**

Replace the entire `ActiveWorkoutScreenProps` interface (lines 14–40):

```ts
interface ActiveWorkoutScreenProps {
  exercise: WorkoutExercise | undefined;
  exerciseIndex: number;
  totalExercises: number;
  soloMode: boolean;
  timerStarted: boolean;
  sets: number;
  reps: number[];
  perSetWeights: number[];
  onWeightChange: (setIdx: number, value: number) => void;
  currentSet: number;
  lapTimes: number[];
  lapStartMs: number | null;
  workoutPhase: "rest" | "set";
  restTimes: number[];
  restStartMs: number | null;
  exerciseElapsedSec: number;
  sessionElapsedSec: number;
  logging: boolean;
  onRepChange: (setIndex: number, value: number) => void;
  onStartSet: () => void;
  onLogCurrentSet: () => void;
  onCompleteSet: () => void;
  onStart: () => void;
  onBack: () => void;
  onSkip: () => void;
  sessionName?: string;
}
```

Update the destructuring in the function signature to match:

```ts
export function ActiveWorkoutScreen({
  exercise,
  exerciseIndex,
  totalExercises,
  soloMode,
  timerStarted,
  sets,
  reps,
  perSetWeights,
  onWeightChange,
  currentSet,
  lapTimes,
  lapStartMs,
  workoutPhase,
  restTimes,
  restStartMs,
  exerciseElapsedSec,
  sessionElapsedSec,
  logging,
  onRepChange,
  onStartSet,
  onLogCurrentSet,
  onCompleteSet,
  onStart,
  onBack,
  onSkip,
  sessionName,
}: ActiveWorkoutScreenProps) {
```

- [ ] **Step 2: Remove the `MutableRefObject` import** (line 3)

Replace:
```ts
import { useRef, useState, useEffect, type MutableRefObject } from "react";
```
With:
```ts
import { useRef, useState, useEffect } from "react";
```

- [ ] **Step 3: Replace the two ref-based computed values**

The component currently computes `restElapsedSec` from `restStartRef.current`. Replace the two computed values (around lines 99–105) with:

```ts
const restElapsedSec =
  workoutPhase === "rest" && restStartMs != null
    ? Math.max(0, Math.floor((Date.now() - restStartMs) / 1000))
    : 0;
const currentRestSec = exercise?.progressionStyle?.[currentSet - 1]?.restSec ?? 90;
const restProgress = currentRestSec > 0 ? Math.min(1, restElapsedSec / currentRestSec) : 0;
const restRemaining = Math.max(0, currentRestSec - restElapsedSec);
```

Note: `restElapsedSec` previously read `restStartRef.current` — now it reads `restStartMs` directly.

- [ ] **Step 4: Update the header timer display**

In the header subtitle (around line 125), replace:
```tsx
{timerStarted && ` · ${formatTime(elapsedSeconds)}`}
```
With:
```tsx
{timerStarted && ` · ${formatTime(exerciseElapsedSec)}`}
```

And replace the overall session timer display in the header. Find the line that shows `1RM ~X kg` badge and add the session timer before it:

```tsx
<div className="flex-1 min-w-0 text-center">
  <p className="text-xs font-semibold text-muted-foreground truncate">
    {sessionName ?? (soloMode ? "Solo log" : "Workout")}
  </p>
  <p className="text-[10px] text-muted-foreground/60">
    {soloMode ? "Solo" : `Exercise ${exerciseIndex + 1} of ${totalExercises}`}
    {timerStarted && ` · ${formatTime(exerciseElapsedSec)}`}
  </p>
  {sessionElapsedSec > 0 && (
    <p
      className="text-sm font-bold tabular-nums"
      style={{ color: "var(--color-brand)" }}
    >
      {formatTime(sessionElapsedSec)}
    </p>
  )}
</div>
```

- [ ] **Step 5: Move warmup weights strip from timerStarted=true to timerStarted=false**

Find the warmup weights strip in the `timerStarted=true` section (around lines 267–277):

```tsx
{/* Warmup weights strip */}
{warmupWeights && (
  <div className="flex gap-2">
    {([50, 60, 70] as const).map((pct, i) => (
      <div key={pct} className="flex flex-1 flex-col items-center rounded-xl border border-border/60 bg-muted/40 px-2 py-2 text-center">
        <span className="text-[10px] font-medium text-muted-foreground">{pct}%</span>
        <span className="text-sm font-semibold tabular-nums">{warmupWeights[i]} kg</span>
      </div>
    ))}
  </div>
)}
```

**Remove** this block from the `timerStarted=true` section.

In the `timerStarted=false` (ready screen) section, add the warmup strip **below the set targets card and above the 1RM sparkline** (after the `exercise?.target80 != null` block, before the `rmHistory.length >= 2` block):

```tsx
{/* Warmup weights — only in start-workout flow (not solo re-do) */}
{!soloMode && warmupWeights && (
  <div className="w-full">
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 text-center">
      Warmup weights
    </p>
    <div className="flex gap-2">
      {([50, 60, 70] as const).map((pct, i) => (
        <div key={pct} className="flex flex-1 flex-col items-center rounded-xl border border-border/60 bg-muted/40 px-2 py-2 text-center">
          <span className="text-[10px] font-medium text-muted-foreground">{pct}%</span>
          <span className="text-sm font-semibold tabular-nums">{warmupWeights[i]} kg</span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "Update ActiveWorkoutScreen: session timer, warmup strip on ready screen, drop ref props"
```

---

## Task 6: Update WarmupScreen, ExerciseSummaryScreen

**Files:**
- Modify: `components/workout/warmup-screen.tsx`
- Modify: `components/workout/exercise-summary-screen.tsx`

- [ ] **Step 1: Update WarmupScreen**

Replace the entire `WarmupScreen` component. The existing component has its own `useState` + `setInterval` for the timer. Replace with a `sessionElapsedSec` prop driven by the orchestrator.

Replace `WarmupScreenProps`:
```ts
interface WarmupScreenProps {
  sessionType: string;
  exercises: WorkoutExercise[];
  sessionElapsedSec: number;
  onBeginExercises: () => void;
  onBack: () => void;
}
```

Replace the destructuring and remove the internal `elapsed` state and `useEffect`:

```ts
export function WarmupScreen({ sessionType, exercises, sessionElapsedSec, onBeginExercises, onBack }: WarmupScreenProps) {
  // Remove the internal elapsed state and useEffect — sessionElapsedSec comes from parent
```

Replace all uses of `elapsed` with `sessionElapsedSec`, and `formatElapsed(elapsed)` with `formatTime(sessionElapsedSec)`.

Add the `formatTime` import from `./utils` and remove the local `formatElapsed` function:

```ts
import { formatTime } from "./utils";
```

The header timer display changes from:
```tsx
{formatElapsed(elapsed)}
```
To:
```tsx
{formatTime(sessionElapsedSec)}
```

- [ ] **Step 2: Update ExerciseSummaryScreen**

In `components/workout/exercise-summary-screen.tsx`, add `sessionElapsedSec: number` to props and display it in the header:

Add to `ExerciseSummaryScreenProps`:
```ts
interface ExerciseSummaryScreenProps {
  summaryData: ExerciseSummaryData;
  sessionElapsedSec: number;
  onNext: () => void;
}
```

Update destructuring:
```ts
export function ExerciseSummaryScreen({ summaryData, sessionElapsedSec, onNext }: ExerciseSummaryScreenProps) {
```

In the header, add session timer next to the title:
```tsx
<header className="flex items-center gap-3 border-b px-4 py-4">
  <button onClick={onNext} className="rounded-lg p-2.5 hover:bg-muted transition">
    <ChevronLeftIcon className="h-5 w-5" />
  </button>
  <div className="flex-1">
    <h1 className="text-lg font-bold">{exName}</h1>
    <p className="text-sm text-muted-foreground">Set summary</p>
  </div>
  {sessionElapsedSec > 0 && (
    <span
      className="text-sm font-bold tabular-nums flex-none"
      style={{ color: "var(--color-brand)" }}
    >
      {formatTime(sessionElapsedSec)}
    </span>
  )}
</header>
```

Add `formatTime` import:
```ts
import { formatTime, mround125 } from "./utils";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/workout/warmup-screen.tsx components/workout/exercise-summary-screen.tsx
git commit -m "Pass sessionElapsedSec from orchestrator to warmup and summary screens"
```

---

## Task 7: ExerciseStatsSheet component

**Files:**
- Create: `components/workout/exercise-stats-sheet.tsx`

This is a bottom sheet showing read-only stats for a `WorkoutExercise`. It reuses the `/api/exercise-history` endpoint that `ExerciseHistorySheet` already uses, adds a 1RM rep targets table, and shows the muscle map from the exercise data directly.

- [ ] **Step 1: Create `components/workout/exercise-stats-sheet.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon } from "lucide-react";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import type { ExerciseHistoryEntry } from "@/app/api/exercise-history/route";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { formatSheetDate, mround125 } from "./utils";

interface ExerciseStatsSheetProps {
  exercise: WorkoutExercise | null;
  isDoneToday: boolean;
  onClose: () => void;
  onRedo: () => void;
}

/** Epley reps needed to hit a target 1RM at a given weight. */
function repsForTarget(weightKg: number, target1rm: number): number {
  if (weightKg <= 0 || target1rm <= weightKg) return 1;
  return Math.max(1, Math.round((target1rm / weightKg - 1) * 30));
}

/** Epley 1RM estimate. */
function epley(weightKg: number, reps: number): number {
  return Math.round((weightKg * (1 + reps / 30)) * 4) / 4;
}

export function ExerciseStatsSheet({ exercise, isDoneToday, onClose, onRedo }: ExerciseStatsSheetProps) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!exercise) { setEntries([]); return; }
    setLoading(true);
    fetch(`/api/exercise-history?name=${encodeURIComponent(exercise.name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setEntries(d?.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [exercise?.name]);

  if (!exercise) return null;

  // Working weight: highest % working set in progression style, or target80 fallback
  const workingWeight = (() => {
    const style = exercise.progressionStyle;
    if (style && exercise.estimated1rm) {
      const maxPct = Math.max(...style.map(s => s.pct));
      return mround125(exercise.estimated1rm * maxPct / 100);
    }
    return exercise.target80 != null ? mround125(exercise.target80) : null;
  })();

  // 1RM rep targets: below / match / beat
  const current1rm = exercise.estimated1rm;
  const rmTargets = (() => {
    if (!workingWeight || !current1rm) return null;
    const matchReps = repsForTarget(workingWeight, current1rm);
    const beatReps = matchReps + 1;
    const belowReps = Math.max(1, matchReps - 1);
    return [
      { label: "Below 1RM", reps: belowReps, est: epley(workingWeight, belowReps), highlight: false },
      { label: "Match 1RM", reps: matchReps, est: epley(workingWeight, matchReps), highlight: false },
      { label: "Beat 1RM ⚡", reps: beatReps, est: epley(workingWeight, beatReps), highlight: true },
    ];
  })();

  // Sparkline
  const rms = entries.map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0);
  const hasChart = rms.length >= 2;
  const maxRm = hasChart ? Math.max(...rms) : 0;
  const minRm = hasChart ? Math.min(...rms) : 0;
  const range = maxRm - minRm || 1;
  const W = 280; const H = 56; const PAD = 6;
  const reversed = [...rms].reverse();
  const sparkPoints = reversed.map((v, i, arr) => {
    const x = PAD + (i / Math.max(arr.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - minRm) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // Muscle assignments
  const muscleActivations: MuscleActivation[] = [
    ...(exercise.mainMuscles ?? []).map(m => ({ muscle: m, role: "main" as const })),
    ...(exercise.secondaryMuscles ?? []).map(m => ({ muscle: m, role: "secondary" as const })),
  ];

  return (
    <Sheet open={!!exercise} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none px-1">
          <SheetTitle>{exercise.name}</SheetTitle>
          {exercise.lastDate && (
            <p className="text-xs text-muted-foreground">
              Last: {exercise.lastSets != null ? `${exercise.lastSets} sets` : ""}
              {exercise.lastReps.length > 0
                ? exercise.lastReps.map((r, i) => {
                    const ws = exercise.lastSetWeights ?? [];
                    const w = ws[i] ?? ws[ws.length - 1];
                    return w != null ? ` · ${r}×${w}kg` : ` · ${r} reps`;
                  }).join("")
                : ""}
              {" · "}{formatSheetDate(exercise.lastDate)}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-2">

          {/* 1RM rep targets */}
          {rmTargets && workingWeight && (
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Rep targets at {workingWeight} kg
              </p>
              {rmTargets.map(t => (
                <div
                  key={t.label}
                  className="flex items-center justify-between py-2 border-b border-border/40 last:border-0"
                  style={t.highlight ? { color: "var(--color-brand)" } : {}}
                >
                  <span className="text-sm">{t.label}</span>
                  <span className="text-sm font-bold tabular-nums">
                    {t.reps} reps → ~{t.est} kg
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 1RM sparkline */}
          {hasChart && (
            <div className="rounded-xl border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                1RM trend ({rms.length} sessions)
              </p>
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
                <defs>
                  <linearGradient id="ess-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon
                  points={`${PAD},${H} ${sparkPoints} ${W - PAD},${H}`}
                  fill="url(#ess-grad)"
                />
                <polyline
                  points={sparkPoints}
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {rms[0] != null && (
                  <text
                    x={W - PAD}
                    y={H - PAD - ((rms[0] - minRm) / range) * (H - PAD * 2) - 4}
                    textAnchor="end"
                    fill="var(--color-brand)"
                    fontSize="9"
                    fontWeight="700"
                  >
                    {rms[0]} kg
                  </text>
                )}
              </svg>
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}

          {/* Muscle map */}
          {muscleActivations.length > 0 && (
            <MuscleHeatmap assignments={muscleActivations} className="w-full" />
          )}
        </div>

        {/* Re-do button — only shown for exercises already done today */}
        {isDoneToday && (
          <div className="flex-none pt-2 border-t">
            <Button
              variant="outline"
              className="w-full h-12"
              onClick={() => { onClose(); onRedo(); }}
            >
              <RotateCcwIcon className="h-4 w-4 mr-2" />
              Re-do this exercise
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/exercise-stats-sheet.tsx
git commit -m "Add ExerciseStatsSheet with 1RM rep targets, sparkline, muscle map"
```

---

## Task 8: Update pre-workout screen — pills open stats sheet

**Files:**
- Modify: `components/workout/pre-workout-screen.tsx`

The pill's left-side button tap currently calls `onLaunchExercise(idx, true)` for non-done exercises. Replace this with opening `ExerciseStatsSheet`. The `RotateCcwIcon` re-do button for done exercises already calls `onLaunchExercise` — keep that.

- [ ] **Step 1: Add imports and state**

Add to imports at top of file:
```ts
import { ExerciseStatsSheet } from "./exercise-stats-sheet";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
```

Add state inside the component body (after existing state declarations):
```ts
const [statsExercise, setStatsExercise] = useState<WorkoutExercise | null>(null);
```

- [ ] **Step 2: Replace the pill tap handler**

In the exercise list map (around line 155–160), the pill currently has:

```tsx
<button
  className={cn(
    "min-w-0 flex-1 text-left",
    !doneToday && "hover:opacity-80 active:scale-[0.99] transition-all",
  )}
  onClick={doneToday ? undefined : () => onLaunchExercise(idx, true)}
>
```

Replace with (tap always opens the stats sheet regardless of doneToday):

```tsx
<button
  className="min-w-0 flex-1 text-left hover:opacity-80 active:scale-[0.99] transition-all"
  onClick={() => setStatsExercise(ex)}
>
```

- [ ] **Step 3: Remove the old TrendingUpIcon history button**

The existing history button (TrendingUpIcon, around line 202–208) opens `ExerciseHistorySheet`. Since the new pill tap opens `ExerciseStatsSheet` (which includes all that info plus more), remove this separate button to avoid duplication.

Delete the block:
```tsx
<button
  onClick={() => setHistoryExercise(ex.name)}
  className="ml-2 flex-none rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
  title="View history"
>
  <TrendingUpIcon className="h-4 w-4" />
</button>
```

Also remove the `historyExercise` state, the `ExerciseHistorySheet` import and its render at the bottom, and the `TrendingUpIcon` import since they're no longer used.

- [ ] **Step 4: Add ExerciseStatsSheet at the bottom of the return**

Below the existing `MoodCheckInSheet`, add:

```tsx
<ExerciseStatsSheet
  exercise={statsExercise}
  isDoneToday={statsExercise ? (todayLogged.has(statsExercise.name) || (!!statsExercise.lastDate && statsExercise.lastDate.slice(0, 10).replace(/-/g, "/") === localDateString())) : false}
  onClose={() => setStatsExercise(null)}
  onRedo={() => {
    if (statsExercise) {
      const idx = exercises.findIndex(e => e.name === statsExercise.name);
      if (idx !== -1) onLaunchExercise(idx, true);
    }
  }}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/workout/pre-workout-screen.tsx
git commit -m "Replace solo pill launch with ExerciseStatsSheet; re-do button for done exercises"
```

---

## Task 9: Final build check and push

- [ ] **Step 1: Full TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 2: Check Next.js build compiles**

```bash
cd /home/user/TrainingAI && pnpm build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully` with no type errors.

- [ ] **Step 3: Push branch**

```bash
git push origin claude/exercise-flow-rework-CkP77
```

---

## Self-Review Checklist

### Spec coverage
| Spec requirement | Task covering it |
|---|---|
| Exercise pill → read-only stats sheet | Tasks 7, 8 |
| Re-do button for done exercises | Tasks 7, 8 |
| Warmup weights on ready screen (not solo) | Task 5 |
| Session timer visible across all active screens | Tasks 3, 4, 5, 6 |
| Zustand store + localStorage persist | Task 3 |
| Page reload restores session | Task 3 (persist), Task 4 (resetSession guard) |
| `setStartMs`, `setEndMs` per set | Tasks 1, 2, 4 |
| `interExerciseRestSec` | Tasks 1, 2, 4 |
| DB migration for new columns | Task 1 |
| `soloMode` path retained for re-do | Tasks 4, 8 |

### Checked: no placeholders, all code blocks complete
### Checked: type names consistent across tasks (`WorkoutStore`, `ExerciseStatsSheet`, `sessionElapsedSec`, `restStartMs`, `lapStartMs`)
