# RPE Recording UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RPE (5–10 whole numbers) recording to every logged set — displayed as a vertical color-coded tap strip on the active set card, persisted to `set_logs.rpe`, and shown as a coloured badge on completed set cards.

**Architecture:** The change touches all layers — DB migration → Postgres schema + types → adapter → two API routes → SQLite outbox → workout store → new RpeStrip component → SetCard UI redesign → wiring in active-workout-screen and workout-screen. Each task is independently committable.

**Tech Stack:** PostgreSQL (Drizzle ORM), Next.js API routes (Zod), Zustand persisted store, React 19, Tailwind CSS v4.

---

## File Map

| File | Action |
|------|--------|
| `lib/data/postgres/migrations/077_rpe_set_logs.sql` | **Create** — `ALTER TABLE set_logs ADD COLUMN rpe integer` |
| `lib/data/postgres/schema.ts` | **Modify** — add `rpe` field to `setLogs` table |
| `lib/types/log.ts` | **Modify** — add `rpe?: number` to `SetLog` |
| `lib/sqlite/migrations.ts` | **Modify** — add toVersion 3 to add `rpe` column to local SQLite set_logs |
| `lib/sqlite/outbox.ts` | **Modify** — add `rpe` to `OutboxPayload.setLogs`; save it in `writeLocalWorkout` |
| `lib/data/postgres/adapter.ts` | **Modify** — pass `rpe` in `logSets` + `logExerciseAndSets` insert + upsert |
| `app/api/log-exercise/route.ts` | **Modify** — accept `rpeValues` array, thread into `setData` |
| `app/api/sync-workout/route.ts` | **Modify** — add `rpe` to `SyncSetLogSchema`; pass to `logSets` |
| `lib/stores/workout-store.ts` | **Modify** — add `rpeValues`, `initRpeValues`, `setRpeValue` |
| `components/workout/utils.ts` | **Modify** — add `defaultRpeFromPct` helper |
| `components/workout/rpe-strip.tsx` | **Create** — vertical tap-strip component |
| `components/workout/set-card.tsx` | **Modify** — 3-zone layout; pct under reps; RPE strip; RPE badge on done cards |
| `components/workout/active-workout-screen.tsx` | **Modify** — add `rpeValues` + `onRpeChange` props; pass to SetCard |
| `components/workout-screen.tsx` | **Modify** — init RPE defaults; snapshot + send in log call; pass props down |

---

## Task 1: Postgres DB migration + schema + SetLog type

**Files:**
- Create: `lib/data/postgres/migrations/077_rpe_set_logs.sql`
- Modify: `lib/data/postgres/schema.ts` (line ~167)
- Modify: `lib/types/log.ts` (line ~14)

- [ ] **Step 1: Create the migration file**

```sql
-- lib/data/postgres/migrations/077_rpe_set_logs.sql
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS rpe integer;
```

- [ ] **Step 2: Apply migration to local dev DB**

```bash
node scripts/local-db/migrate.js
```

Expected output: `Applying 077_rpe_set_logs.sql...` (or `already applied` if idempotent).

Verify:
```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" -c "\d set_logs"
```
Expected: `rpe` column appears in the output as `integer`.

- [ ] **Step 3: Add `rpe` to the Drizzle schema**

In `lib/data/postgres/schema.ts`, find the `setLogs` table definition (around line 167). After the `setEndMs` line add:

```ts
  setEndMs:      bigint('set_end_ms', { mode: 'number' }),
  rpe:           integer('rpe'),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 4: Add `rpe` to the `SetLog` type**

In `lib/types/log.ts`, add `rpe?: number` after `setEndMs`:

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
  rpe?: number
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/077_rpe_set_logs.sql lib/data/postgres/schema.ts lib/types/log.ts
git commit -m "Add rpe column to set_logs (migration + schema + type)"
```

---

## Task 2: SQLite local schema migration

**Files:**
- Modify: `lib/sqlite/migrations.ts`

- [ ] **Step 1: Add migration version 3**

In `lib/sqlite/migrations.ts`, append after the closing brace of `toVersion: 2`:

```ts
  {
    toVersion: 3,
    statements: [
      `ALTER TABLE set_logs ADD COLUMN rpe INTEGER`,
    ],
  },
```

Full file after change:
```ts
import type { UpgradeStatement } from './sqlite-service';

export const MIGRATIONS: UpgradeStatement[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS workout_sessions (
        id TEXT PRIMARY KEY,
        session_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS exercise_logs (
        id TEXT PRIMARY KEY,
        workout_session_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        style_id TEXT,
        style_name TEXT,
        estimated_1rm REAL,
        target_80 REAL,
        volume REAL,
        avg_reps REAL,
        time_to_complete INTEGER,
        logged_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS set_logs (
        id TEXT PRIMARY KEY,
        exercise_log_id TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        reps INTEGER NOT NULL,
        set_time_sec INTEGER,
        rest_time_sec INTEGER,
        intensity_pct REAL,
        use_for_1rm INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    toVersion: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    ],
  },
  {
    toVersion: 3,
    statements: [
      `ALTER TABLE set_logs ADD COLUMN rpe INTEGER`,
    ],
  },
];
```

- [ ] **Step 2: Update `OutboxPayload.setLogs` to include `rpe`**

In `lib/sqlite/outbox.ts`, update the `setLogs` field in `OutboxPayload`:

```ts
export interface OutboxPayload {
  workoutSessionId: string;
  sessionName: string;
  startedAt: string;
  exerciseLogId: string;
  exercise: string;
  loggedAt: string;
  weights: number[];
  reps: number[];
  sets: number;
  timeToCompleteSet?: number;
  setTimes?: number[];
  restTimes?: number[];
  styleName?: string;
  styleId?: string;
  estimated1rm: number;
  target80: number;
  volume: number;
  avgReps: number;
  setLogs: {
    id: string;
    setNumber: number;
    weightKg: number;
    reps: number;
    setTimeSec?: number;
    restTimeSec?: number;
    intensityPct?: number;
    useFor1rm: boolean;
    rpe?: number;
  }[];
}
```

- [ ] **Step 3: Update `writeLocalWorkout` to save `rpe` in local SQLite**

In `lib/sqlite/outbox.ts`, find the `INSERT OR REPLACE INTO set_logs` statement inside `writeLocalWorkout` (around line 68). Update it to include `rpe`:

```ts
  for (const s of payload.setLogs) {
    await runSQL(
      `INSERT OR REPLACE INTO set_logs
       (id, exercise_log_id, set_number, weight_kg, reps,
        set_time_sec, rest_time_sec, intensity_pct, use_for_1rm, rpe, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        payload.exerciseLogId,
        s.setNumber,
        s.weightKg,
        s.reps,
        s.setTimeSec ?? null,
        s.restTimeSec ?? null,
        s.intensityPct ?? null,
        s.useFor1rm ? 1 : 0,
        s.rpe ?? null,
        synced ? 1 : 0,
      ],
    );
  }
```

- [ ] **Step 4: Commit**

```bash
git add lib/sqlite/migrations.ts lib/sqlite/outbox.ts
git commit -m "Add rpe to SQLite local schema and outbox payload"
```

---

## Task 3: Postgres adapter — include rpe in set inserts

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (lines ~1419–1477)

- [ ] **Step 1: Update `logSets` to include `rpe`**

Find the `async logSets` method (around line 1419). Update the `.values` map and `onConflictDoUpdate` set:

```ts
async logSets(exerciseLogId: string, sets: Omit<SetLog, 'id' | 'exerciseLogId'>[]): Promise<SetLog[]> {
  if (sets.length === 0) return []
  const rows = await this.db.insert(s.setLogs)
    .values(sets.map(set => ({
      exerciseLogId, setNumber: set.setNumber, weightKg: set.weightKg,
      reps: set.reps, setTimeSec: set.setTimeSec ?? null,
      restTimeSec: set.restTimeSec ?? null, intensityPct: set.intensityPct ?? null,
      useFor1rm: set.useFor1rm,
      setStartMs: set.setStartMs ?? null,
      setEndMs: set.setEndMs ?? null,
      rpe: set.rpe ?? null,
    })))
    .onConflictDoUpdate({
      target: [s.setLogs.exerciseLogId, s.setLogs.setNumber],
      set: {
        weightKg: sql`EXCLUDED.weight_kg`, reps: sql`EXCLUDED.reps`,
        setTimeSec: sql`EXCLUDED.set_time_sec`, restTimeSec: sql`EXCLUDED.rest_time_sec`,
        intensityPct: sql`EXCLUDED.intensity_pct`, useFor1rm: sql`EXCLUDED.use_for_1rm`,
        setStartMs: sql`EXCLUDED.set_start_ms`, setEndMs: sql`EXCLUDED.set_end_ms`,
        rpe: sql`EXCLUDED.rpe`,
      },
    })
    .returning()
  return rows.map((r, i) => ({ ...sets[i], id: r.id, exerciseLogId }))
}
```

- [ ] **Step 2: Update `logExerciseAndSets` inner set insert to include `rpe`**

Find the inner `tx.insert(s.setLogs)` call inside `logExerciseAndSets` (around line 1467). Update the `.values` map:

```ts
const setRows = await tx.insert(s.setLogs)
  .values(sets.map(set => ({
    exerciseLogId, setNumber: set.setNumber, weightKg: set.weightKg,
    reps: set.reps, setTimeSec: set.setTimeSec ?? null,
    restTimeSec: set.restTimeSec ?? null, intensityPct: set.intensityPct ?? null,
    useFor1rm: set.useFor1rm,
    setStartMs: set.setStartMs ?? null,
    setEndMs: set.setEndMs ?? null,
    rpe: set.rpe ?? null,
  })))
  .returning()
```

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Pass rpe through set log inserts in Postgres adapter"
```

---

## Task 4: API routes — log-exercise and sync-workout

**Files:**
- Modify: `app/api/log-exercise/route.ts`
- Modify: `app/api/sync-workout/route.ts`

- [ ] **Step 1: Add `rpeValues` to `LogExerciseSchema`**

In `app/api/log-exercise/route.ts`, add to the Zod schema (after `workoutStartedAt`):

```ts
const LogExerciseSchema = z.object({
  // ... all existing fields ...
  workoutStartedAt: z.number().optional(),
  rpeValues: z.array(z.number().int().min(5).max(10)).optional(),
});
```

- [ ] **Step 2: Destructure `rpeValues` from parsed data**

Find the destructuring block (around line 57):

```ts
const {
  sessionName, sessionId, workoutSessionId,
  exercise, weights, sets, reps,
  localDate, timeToCompleteSet, setTimes, restTimes,
  setStartTimes, setEndTimes, interExerciseRestSec,
  progressionStyle, styleName, styleId, muscleGroups, workoutStartedAt,
  rpeValues,
} = parsed.data;
```

- [ ] **Step 3: Add `rpe` to each entry in `setData`**

Find the `setData` building block (around line 161):

```ts
const setData = weights.map((w, i) => {
  const r = reps[i] ?? reps[reps.length - 1];
  const defaultUseFor1rm = allRepsEqual ? true : r === minReps
  return {
    setNumber: i + 1,
    weightKg: w,
    reps: r,
    setTimeSec: setTimes?.[i],
    restTimeSec: restTimes?.[i],
    intensityPct: estimated1rm > 0 ? Math.round(effectiveWeights[i] / estimated1rm * 1000) / 10 : undefined,
    useFor1rm: progressionStyle?.[i]?.useFor1rm ?? defaultUseFor1rm,
    setStartMs: setStartTimes?.[i],
    setEndMs: setEndTimes?.[i],
    rpe: rpeValues?.[i],
  };
});
```

- [ ] **Step 4: Add `rpe` to `SyncSetLogSchema` in sync-workout**

In `app/api/sync-workout/route.ts`, update `SyncSetLogSchema`:

```ts
const SyncSetLogSchema = z.object({
  id: z.string().uuid(),
  setNumber: z.number().int().min(1).max(100),
  weightKg: z.number().finite().min(0).max(1000),
  reps: z.number().int().min(0).max(200),
  setTimeSec: z.number().int().min(0).max(3600).optional(),
  restTimeSec: z.number().int().min(0).max(3600).optional(),
  intensityPct: z.number().finite().min(0).max(100).optional(),
  useFor1rm: z.boolean(),
  rpe: z.number().int().min(5).max(10).optional(),
})
```

- [ ] **Step 5: Pass `rpe` through in the `logSets` call in sync-workout**

Find the `pgRepo.logSets` call (around line 146). Update the map:

```ts
await pgRepo.logSets(
  item.exerciseLogId,
  item.setLogs.map(s => ({
    setNumber: s.setNumber,
    weightKg: s.weightKg,
    reps: s.reps,
    setTimeSec: s.setTimeSec,
    restTimeSec: s.restTimeSec,
    intensityPct: s.intensityPct,
    useFor1rm: s.useFor1rm,
    rpe: s.rpe,
  })),
);
```

- [ ] **Step 6: Commit**

```bash
git add app/api/log-exercise/route.ts app/api/sync-workout/route.ts
git commit -m "Accept and persist rpe in log-exercise and sync-workout API routes"
```

---

## Task 5: Workout store — rpeValues state + actions

**Files:**
- Modify: `lib/stores/workout-store.ts`

- [ ] **Step 1: Add `rpeValues` to `WorkoutState`**

In the `interface WorkoutState` block, add after `workoutPhase`:

```ts
rpeValues: number[]        // one per set, initialized with RTS defaults on exercise load
```

- [ ] **Step 2: Add `initRpeValues` and `setRpeValue` to `WorkoutActions`**

In the `interface WorkoutActions` block, add:

```ts
initRpeValues: (values: number[]) => void
setRpeValue: (setIdx: number, value: number) => void
```

- [ ] **Step 3: Add `rpeValues` to `INITIAL_STATE`**

```ts
const INITIAL_STATE: WorkoutState = {
  // ... existing fields ...
  rpeValues: [],
}
```

- [ ] **Step 4: Add `rpeValues: []` to `startWorkout`**

In the `startWorkout` action (around line 116), add `rpeValues: [],` alongside the other resets:

```ts
startWorkout: (sessionType) => set((s) => ({
  // ... existing fields ...
  rpeValues: [],
  todayLogged: s.todayLogged,
  sessionLog: s.sessionLog,
  storedDate: todayInTz(),
})),
```

- [ ] **Step 5: Subscribe and implement the two new actions**

In the `create` callback, add after `clearRestTimes`:

```ts
initRpeValues: (values) => set({ rpeValues: values }),
setRpeValue: (setIdx, value) => set((s) => {
  const next = [...s.rpeValues]
  next[setIdx] = value
  return { rpeValues: next }
}),
```

- [ ] **Step 6: Add `rpeValues` to the shallow selector in `workout-screen.tsx`**

_(This step is here as a reminder — it will be done in Task 8 when wiring workout-screen. Skip for now.)_

- [ ] **Step 7: Commit**

```bash
git add lib/stores/workout-store.ts
git commit -m "Add rpeValues state and initRpeValues/setRpeValue actions to workout store"
```

---

## Task 6: RPE utility + RpeStrip component

**Files:**
- Modify: `components/workout/utils.ts`
- Create: `components/workout/rpe-strip.tsx`

- [ ] **Step 1: Add `defaultRpeFromPct` to utils**

In `components/workout/utils.ts`, append at the end of the file:

```ts
export function defaultRpeFromPct(pct: number | undefined): number {
  if (pct === undefined) return 7
  if (pct >= 100) return 10
  if (pct >= 94) return 9
  if (pct >= 88) return 8
  if (pct >= 82) return 7
  if (pct >= 76) return 6
  return 5
}
```

- [ ] **Step 2: Create the RpeStrip component**

Create `components/workout/rpe-strip.tsx`:

```tsx
"use client";

const RPE_VALUES = [10, 9, 8, 7, 6, 5] as const; // top to bottom in the UI

const RPE_COLORS: Record<number, string> = {
  5:  '#22c55e',
  6:  '#84cc16',
  7:  '#eab308',
  8:  '#f59e0b',
  9:  '#f97316',
  10: '#ef4444',
};

interface RpeStripProps {
  value: number;
  onChange: (value: number) => void;
}

export function RpeStrip({ value, onChange }: RpeStripProps) {
  return (
    <div className="flex flex-col items-center h-full w-full">
      <p className="text-[9px] text-muted-foreground font-medium mb-1 leading-none">RPE</p>
      <div className="flex flex-col flex-1 w-full gap-px">
        {RPE_VALUES.map((rpe) => {
          const color = RPE_COLORS[rpe];
          const selected = rpe === value;
          return (
            <button
              key={rpe}
              onClick={() => onChange(rpe)}
              className="flex-1 rounded-sm flex items-center justify-center text-[10px] font-bold transition-all active:scale-95 min-h-0"
              style={{
                background: selected ? color : `${color}28`,
                color: selected ? '#000' : `${color}cc`,
                boxShadow: selected ? `0 0 6px ${color}66` : 'none',
              }}
            >
              {rpe}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/utils.ts components/workout/rpe-strip.tsx
git commit -m "Add defaultRpeFromPct helper and RpeStrip component"
```

---

## Task 7: SetCard UI redesign

**Files:**
- Modify: `components/workout/set-card.tsx`

This task restructures the active set card from 2 zones to 3, moves `intensityPct` inline below the rep count, and adds the RPE strip. It also adds an RPE badge to done (logged) set cards.

- [ ] **Step 1: Add new props to `SetCardProps`**

Update the interface — add `rpeValue`, `onRpeChange`, `loggedRpe`:

```ts
interface SetCardProps {
  index: number;
  currentSet: number;
  workoutPhase: "rest" | "set";
  repValue: number;
  weight: number;
  lapTime: number | undefined;
  restTime: number | undefined;
  intensityPct?: number;
  onRepChange: (index: number, value: number) => void;
  onWeightChange?: (index: number, value: number) => void;
  isAmrap?: boolean;
  exerciseType?: ExerciseType;
  rpeValue?: number;
  onRpeChange?: (value: number) => void;
  loggedRpe?: number;
}
```

- [ ] **Step 2: Add new imports**

At the top of `components/workout/set-card.tsx`, add the new imports:

```ts
import { RpeStrip } from "./rpe-strip";
import { RPE_COLORS } from "./rpe-strip";
```

Wait — `RPE_COLORS` is not exported from `rpe-strip.tsx`. Add an export to `rpe-strip.tsx`:

```ts
export const RPE_COLORS: Record<number, string> = {
```

Change the `const RPE_COLORS` line in `rpe-strip.tsx` to `export const RPE_COLORS`.

Then in `set-card.tsx`:

```ts
import { RpeStrip, RPE_COLORS } from "./rpe-strip";
```

- [ ] **Step 3: Update the done card to show RPE badge**

Find the `isDone` branch (around line 43). In the `<div className="text-right flex-none">` block, add the RPE badge after `restTime`:

```tsx
<div className="text-right flex-none">
  {lapTime !== undefined && <p className="text-[10px] text-muted-foreground">{formatTime(lapTime)} set</p>}
  {restTime !== undefined && <p className="text-[10px] text-muted-foreground">{restTime}s rest</p>}
  {loggedRpe !== undefined && (
    <p
      className="text-[10px] font-bold leading-none mt-0.5"
      style={{ color: RPE_COLORS[loggedRpe] }}
    >
      RPE {loggedRpe}
    </p>
  )}
</div>
```

Also destructure the new props in `SetCardComponent`:

```ts
function SetCardComponent({
  index,
  currentSet,
  workoutPhase,
  repValue,
  weight,
  lapTime,
  restTime,
  intensityPct,
  onRepChange,
  onWeightChange,
  isAmrap,
  exerciseType,
  rpeValue,
  onRpeChange,
  loggedRpe,
}: SetCardProps) {
```

- [ ] **Step 4: Redesign the active weighted card layout**

Find the `isActive` branch, non-bodyweight path (the `else` branch of `isBodyweight`). Replace the entire `<div className="flex items-stretch">` block:

```tsx
<div className="flex items-stretch">
  {/* Zone A: Weight — flex-1 fills leftover space */}
  <div className="flex items-center justify-center pt-8 pb-3 px-3 flex-1">
    {onWeightChange ? (
      <WeightDial
        value={weight}
        onChange={handleWeightChange}
        min={0}
        max={250}
        step={2.5}
        unit="kg"
        visible={3}
        pill
      />
    ) : (
      <p className="text-3xl font-black tabular-nums">
        {weight} <span className="text-sm font-normal text-muted-foreground">kg</span>
      </p>
    )}
  </div>

  {/* × separator */}
  <div className="flex items-center py-4">
    <span className="text-2xl text-muted-foreground/30 font-light">×</span>
  </div>

  {/* Zone B: Reps — pct shown inline below the rep number */}
  <div className="flex items-center justify-center py-3 pl-2" style={{ width: "33%" }}>
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={() => onRepChange(index, repValue + 1)}
        aria-label={`Increase reps to ${repValue + 1}`}
        className="w-14 h-14 rounded-xl text-xl font-bold flex items-center justify-center transition-transform active:scale-90"
        style={{
          background: "color-mix(in oklch, var(--color-brand) 18%, var(--color-muted))",
          color: "var(--color-brand)",
        }}
      >+</button>
      <div className="flex flex-col items-center w-14">
        <span
          className="text-center text-4xl font-black tabular-nums leading-none"
          style={{ color: "var(--color-brand)" }}
        >{repValue}</span>
        {intensityPct != null && (
          <span className="text-[9px] text-muted-foreground leading-none mt-0.5 tabular-nums">
            {intensityPct}%
          </span>
        )}
      </div>
      <button
        onClick={() => onRepChange(index, Math.max(1, repValue - 1))}
        aria-label={`Decrease reps to ${Math.max(1, repValue - 1)}`}
        className="w-14 h-14 rounded-xl text-xl font-bold flex items-center justify-center transition-transform active:scale-90"
        style={{
          background: "color-mix(in oklch, var(--color-brand) 18%, var(--color-muted))",
          color: "var(--color-brand)",
        }}
      >−</button>
    </div>
  </div>

  {/* Zone C: RPE strip */}
  <div className="flex items-stretch py-3 pr-2 pl-1" style={{ width: "22%" }}>
    <RpeStrip
      value={rpeValue ?? 7}
      onChange={onRpeChange ?? (() => {})}
    />
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to the changed files.

- [ ] **Step 6: Commit**

```bash
git add components/workout/set-card.tsx components/workout/rpe-strip.tsx
git commit -m "Redesign set card: 3-zone layout with RPE strip and pct below reps"
```

---

## Task 8: Wire up active-workout-screen

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`

- [ ] **Step 1: Add `rpeValues` and `onRpeChange` to `ActiveWorkoutScreenProps`**

In the interface (around line 16), add:

```ts
interface ActiveWorkoutScreenProps {
  // ... all existing props ...
  rpeValues?: number[];
  onRpeChange?: (setIdx: number, value: number) => void;
}
```

- [ ] **Step 2: Destructure the new props**

In the function signature (around line 48), add:

```ts
export function ActiveWorkoutScreen({
  // ... all existing props ...
  rpeValues,
  onRpeChange,
}: ActiveWorkoutScreenProps) {
```

- [ ] **Step 3: Pass `rpeValue` and `onRpeChange` to done-set SetCards**

Find the done set chips block (around line 396–413). Update the SetCard props:

```tsx
{reps.slice(0, currentSet).map((repVal, i) => (
  <SetCard
    key={i}
    index={i}
    currentSet={currentSet}
    workoutPhase={workoutPhase}
    repValue={repVal}
    weight={weightFor(i)}
    lapTime={lapTimes[i]}
    restTime={restTimes[i]}
    intensityPct={exercise?.progressionStyle?.[i]?.pct}
    onRepChange={onRepChange}
    onWeightChange={onWeightChange}
    isAmrap={isBaseline ?? false}
    exerciseType={exercise?.exerciseType}
    loggedRpe={rpeValues?.[i]}
  />
))}
```

- [ ] **Step 4: Pass `rpeValue` and `onRpeChange` to the active/upcoming SetCards**

Find the set-phase SetCard render block (around line 488–503). Update:

```tsx
{reps.slice(currentSet).map((repVal, i) => (
  <SetCard
    key={i + currentSet}
    index={i + currentSet}
    currentSet={currentSet}
    workoutPhase={workoutPhase}
    repValue={repVal}
    weight={weightFor(i + currentSet)}
    lapTime={lapTimes[i + currentSet]}
    restTime={restTimes[i + currentSet]}
    intensityPct={exercise?.progressionStyle?.[i + currentSet]?.pct}
    onRepChange={onRepChange}
    onWeightChange={onWeightChange}
    isAmrap={isBaseline ?? false}
    exerciseType={exercise?.exerciseType}
    rpeValue={rpeValues?.[i + currentSet]}
    onRpeChange={onRpeChange ? (value) => onRpeChange(i + currentSet, value) : undefined}
  />
))}
```

- [ ] **Step 5: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "Wire rpeValues and onRpeChange through active-workout-screen to SetCard"
```

---

## Task 9: Wire up workout-screen — init, snapshot, send

**Files:**
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Add `rpeValues`, `initRpeValues`, `setRpeValue` to the store selector**

In the `useShallow` selector (around line 58), add:

```ts
const store = useWorkoutStore(
  useShallow((s) => ({
    // ... all existing state ...
    rpeValues: s.rpeValues,
    // ... all existing actions ...
    initRpeValues: s.initRpeValues,
    setRpeValue: s.setRpeValue,
  }))
);
```

- [ ] **Step 2: Add `defaultRpeFromPct` import**

At the top of `components/workout-screen.tsx`, add to the utils import:

```ts
import {
  DEFAULT_SETS,
  DEFAULT_REPS,
  mround125,
  defaultRpeFromPct,
} from "@/components/workout/utils";
```

- [ ] **Step 3: Initialize RPE defaults when exercise loads**

Find the `useEffect` that calls `store.setPerSetWeights` (around line 305). Append the RPE initialization inside the same effect, after the `setPerSetWeights` call:

```ts
useEffect(() => {
  const ex = exercises[store.currentIdx];
  if (!ex) return;
  if (ex.exerciseType === "bodyweight") {
    store.setPerSetWeights(Array.from({ length: store.sets }, () => 0));
  } else {
    store.setPerSetWeights(Array.from({ length: store.sets }, (_, i) => {
      if (ex.progressionStyle && ex.estimated1rm) {
        const sc = ex.progressionStyle[i];
        if (sc) return mround125(ex.estimated1rm * sc.pct / 100);
      }
      return ex.target80 != null ? mround125(ex.target80) : 60;
    }));
  }
  // Initialize RPE defaults from the RTS chart
  store.initRpeValues(
    Array.from({ length: store.sets }, (_, i) =>
      defaultRpeFromPct(ex.progressionStyle?.[i]?.pct)
    )
  );
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [store.currentIdx, exercises]);
```

- [ ] **Step 4: Snapshot `rpeValues` in `handleCompleteSet`**

Find `handleCompleteSet` (around line 445). After the other snapshot lines, add:

```ts
const snapRpeValues = [...store.rpeValues];
```

- [ ] **Step 5: Include `rpe` in the offline payload's `setLogs`**

Find the `offlinePayload.setLogs` map (around line 507). Add `rpe`:

```ts
setLogs: snapWeights.map((w, i) => ({
  id: crypto.randomUUID(),
  setNumber: i + 1,
  weightKg: w,
  reps: snapReps[i] ?? 0,
  setTimeSec: snapLapTimes[i],
  restTimeSec: snapRestTimes[i],
  intensityPct: newEst1rm > 0 ? Math.round((w / newEst1rm) * 1000) / 10 : undefined,
  useFor1rm: ex.progressionStyle?.[i]?.useFor1rm ?? (offlineAllRepsEqual ? true : (snapReps[i] ?? 0) === offlineMinReps),
  setStartMs: snapSetStartTimes[i],
  setEndMs: snapSetEndTimes[i],
  rpe: snapRpeValues[i],
})),
```

- [ ] **Step 6: Include `rpeValues` in the API fetch body**

Find the `fetch("/api/log-exercise"` call body (around line 535). Add `rpeValues`:

```ts
body: JSON.stringify({
  sessionName: sessionDisplayName || sessionType,
  sessionId: programSessionId,
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
  workoutStartedAt: useWorkoutStore.getState().workoutStartMs ?? undefined,
  rpeValues: snapRpeValues.length > 0 ? snapRpeValues : undefined,
}),
```

- [ ] **Step 7: Add `store.rpeValues` to the `handleCompleteSet` dependency array**

Find the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment before the dependency array of `handleCompleteSet` (around line 609). Add `store.rpeValues`:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [exercises, store.currentIdx, store.currentSet, store.sets, store.lapTimes,
    store.reps, store.setWeights, sessionType, sessionDisplayName, programSessionId,
    store.accumulatedRestMs, store.restTimes, store.setStartMsArray, store.setEndMsArray,
    store.exerciseStartMs, store.lastExerciseEndMs, store.workoutSessionId,
    store.workoutStartMs, store.rpeValues]);
```

- [ ] **Step 8: Pass `rpeValues` and `onRpeChange` to `<ActiveWorkoutScreen>`**

Find the `<ActiveWorkoutScreen>` JSX (around line 872). Add the two new props at the end:

```tsx
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
  sessionName={sessionDisplayName || sessionType}
  phaseStatus={phaseStatus}
  isBaseline={phaseStatus?.isBaseline ?? false}
  activeInjuries={activeInjuries}
  rpeValues={store.rpeValues}
  onRpeChange={store.setRpeValue}
/>
```

- [ ] **Step 9: Verify TypeScript compiles clean**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "Wire rpeValues through workout-screen: init, snapshot, API call, props"
```

---

## Task 10: Local dev server test

- [ ] **Step 1: Start the dev server**

```bash
cd /home/user/TrainingAI && pnpm dev
```

- [ ] **Step 2: Navigate to a workout tab (e.g. Push)**

Open: `http://localhost:3000` → select a session tab → tap "Start Workout" → tap "Begin Exercise".

- [ ] **Step 3: Verify the active set card layout**

Expected:
- Left: weight dial (WeightDial scroll wheel)
- Centre: × separator, then the rep +/number/− column with intensity % below the rep count
- Right: RPE strip showing 6 coloured segments (10 at top in red, 5 at bottom in green), with one segment highlighted in its colour

- [ ] **Step 4: Verify RPE default is correct**

For a set at 80% intensity, the RPE strip should default to segment **8** (amber) highlighted.  
For a set at 65% intensity (below 76%), default should be **5** (green).  
For bodyweight exercises (no pct), default should be **7** (yellow).

- [ ] **Step 5: Tap RPE values to change selection**

Tap the red "10" segment — it should fill with red and the previous selection should dim.  
Tap back to "8" — it should re-select amber.

- [ ] **Step 6: Log a set and verify done card shows RPE badge**

Tap "Log Set 1". The completed set card should show `RPE 8` (or whatever value was selected) in amber text in the right column.

- [ ] **Step 7: Verify RPE is saved to DB**

After logging a set, query the local dev DB:

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -c "SELECT set_number, weight_kg, reps, rpe FROM set_logs ORDER BY updated_at DESC LIMIT 5;"
```

Expected: the `rpe` column shows the value you selected (e.g. `8`).

- [ ] **Step 8: Fix any visual issues**

If the card looks cramped or any zone is too narrow, adjust `width` percentages in `set-card.tsx` Zone B and Zone C until it looks right on the page. The target device is Samsung Galaxy S25 Ultra (414px CSS width) — if testing on desktop, simulate a narrow viewport.

- [ ] **Step 9: Final TypeScript + lint check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit && pnpm lint 2>&1 | tail -20
```

Expected: no errors.
