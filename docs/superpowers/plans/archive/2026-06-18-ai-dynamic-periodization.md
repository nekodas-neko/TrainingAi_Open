# AI Dynamic Periodization Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic AI-driven periodization engine that monitors RPE, 1RM trajectory, recovery signals, and consecutive training days to recommend when to shift phases (accumulation → intensification → realisation → deload) and adjust sets/reps — no fixed calendar, signals drive transitions.

**Architecture:** RPE is captured per-set after logging (pre-filled from intensity %, user adjusts if off), stored in `set_logs.rpe`. A signal aggregator reads RPE trends, 1RM trajectory, sleep, ACWR (when available), and consecutive days into a tiered confidence object. An `/api/periodization/evaluate` route feeds that to the AI, which returns a structured JSON recommendation (phase shift, deload, rest day, or parameter adjustment) stored in `periodization_recommendations` for user acceptance. The first 4–6 sessions per session type form a **baseline phase** where the AI calibrates before making prescription changes.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM + PostgreSQL, Zod validation, `@ai-sdk/google` (Gemini) for structured output, Zustand workout store, Tailwind CSS v4.

---

## Scope / Out of Scope

**In scope (base plan):**
- RPE capture on set card (pre-filled, optional override)
- Periodization state tracking (one phase per user, whole-program)
- Signal aggregation with confidence tiers
- AI evaluation → structured recommendation JSON
- Accept/reject recommendation UI
- Baseline phase logic (observe before prescribing)
- Rest-day and deload recommendations

**Out of scope (Phase 2):**
- Per-exercise phase overrides (each lift on its own cycle)
- Auto-applying progression style parameter changes to the DB on accept
- Push notifications for recommendations
- Phase history timeline UI

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/data/postgres/migrations/077_rpe_periodization.sql` | Create | Add `rpe` to `set_logs`; create `periodization_state` and `periodization_recommendations` tables |
| `lib/data/postgres/schema.ts` | Modify | Drizzle table definitions for the two new tables + `rpe` column |
| `lib/data/repository.ts` | Modify | Interface methods: `getPeriodizationState`, `upsertPeriodizationState`, `createRecommendation`, `listPendingRecommendations`, `updateRecommendationStatus`, `getRecentSetRpe` |
| `lib/data/postgres/adapter.ts` | Modify | Implement new repository methods |
| `lib/periodization/signals.ts` | Create | Pure function `aggregateSignals(userId, repo, tz)` → `SignalSummary` |
| `lib/periodization/prompt.ts` | Create | Build the AI system + user prompt for periodization evaluation |
| `app/api/log-exercise/route.ts` | Modify | Accept `rpeValues?: (number \| null)[]`, persist to `set_logs.rpe` |
| `lib/stores/workout-store.ts` | Modify | Add `rpeValues: number[]`, `setRpeValue(idx, rpe)`, `clearRpeValues()` |
| `components/workout/rpe-selector.tsx` | Create | Compact RPE strip (6–10) pre-selected, tap to override |
| `components/workout/set-card.tsx` | Modify | Render `<RpeSelector>` in the `isDone` state |
| `components/workout-screen.tsx` | Modify | Pass `rpeValues` from store through to `handleCompleteSet` → API payload |
| `app/api/periodization/status/route.ts` | Create | GET: current phase + pending recommendations + signal summary |
| `app/api/periodization/evaluate/route.ts` | Create | POST: run AI evaluation, store recommendation |
| `app/api/periodization/recommendations/[id]/route.ts` | Create | PATCH `{action: 'accept'|'reject'}` |
| `components/health/periodization-card.tsx` | Create | Phase badge, signal health row, pending recommendation with Accept/Reject |
| `app/health/health-content.tsx` | Modify | Add `<PeriodizationCard>` to Training tab |

---

## Task 1 — Database Migration

**Files:**
- Create: `lib/data/postgres/migrations/077_rpe_periodization.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- lib/data/postgres/migrations/077_rpe_periodization.sql

-- 1. RPE per set
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS rpe INTEGER CHECK (rpe >= 1 AND rpe <= 10);

-- 2. Current periodization state per user (one row per user)
CREATE TABLE IF NOT EXISTS periodization_state (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase              TEXT NOT NULL DEFAULT 'baseline',
  -- ^ 'baseline' | 'accumulation' | 'intensification' | 'realisation' | 'deload'
  phase_started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  sessions_in_phase  INTEGER NOT NULL DEFAULT 0,
  baseline_complete  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 3. AI-generated recommendations awaiting user action
CREATE TABLE IF NOT EXISTS periodization_recommendations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  type          TEXT NOT NULL,
  -- ^ 'phase_shift' | 'deload' | 'rest_day' | 'parameter_adjustment' | 'stay'
  title         TEXT NOT NULL,
  reasoning     TEXT NOT NULL,
  urgency       TEXT NOT NULL DEFAULT 'low',
  -- ^ 'low' | 'medium' | 'high'
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',
  -- ^ 'pending' | 'accepted' | 'rejected'
  responded_at  TIMESTAMP WITH TIME ZONE,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_periodization_recommendations_user_status
  ON periodization_recommendations(user_id, status);
```

- [ ] **Step 2: Add Drizzle table definitions to schema.ts**

Open `lib/data/postgres/schema.ts`. After the `setLogs` table definition (around line 180), add:

```ts
// add `rpe` to the setLogs table definition — replace the existing setLogs export:
export const setLogs = pgTable('set_logs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  exerciseLogId: uuid('exercise_log_id').notNull().references(() => exerciseLogs.id, { onDelete: 'cascade' }),
  setNumber:     integer('set_number').notNull(),
  weightKg:      doublePrecision('weight_kg').notNull(),
  reps:          integer('reps').notNull(),
  rpe:           integer('rpe'),
  setTimeSec:    integer('set_time_sec'),
  restTimeSec:   integer('rest_time_sec'),
  intensityPct:  doublePrecision('intensity_pct'),
  useFor1rm:     boolean('use_for_1rm').notNull().default(false),
  setStartMs:    bigint('set_start_ms', { mode: 'number' }),
  setEndMs:      bigint('set_end_ms', { mode: 'number' }),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.exerciseLogId, t.setNumber)])
```

Then at the end of the file, add the two new tables:

```ts
export const periodizationState = pgTable('periodization_state', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  phase:            text('phase').notNull().default('baseline'),
  phaseStartedAt:   timestamp('phase_started_at', { withTimezone: true }).notNull().defaultNow(),
  sessionsInPhase:  integer('sessions_in_phase').notNull().default(0),
  baselineComplete: boolean('baseline_complete').notNull().default(false),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId)])

export const periodizationRecommendations = pgTable('periodization_recommendations', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  type:        text('type').notNull(),
  title:       text('title').notNull(),
  reasoning:   text('reasoning').notNull(),
  urgency:     text('urgency').notNull().default('low'),
  payload:     jsonb('payload').notNull().default({}),
  status:      text('status').notNull().default('pending'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Also add `jsonb` to the Drizzle import at the top of the file if not present:
```ts
import { ..., jsonb } from 'drizzle-orm/pg-core'
```

- [ ] **Step 3: Apply the migration**

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -f lib/data/postgres/migrations/077_rpe_periodization.sql
```

Expected output:
```
ALTER TABLE
CREATE TABLE
CREATE TABLE
CREATE INDEX
```

- [ ] **Step 4: Verify columns exist**

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -c "\d set_logs" | grep rpe
```

Expected: `rpe | integer | ...`

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/077_rpe_periodization.sql lib/data/postgres/schema.ts
git commit -m "Add rpe column to set_logs and periodization tables"
```

---

## Task 2 — Repository Interface + Adapter

**Files:**
- Modify: `lib/data/repository.ts` (add new interface methods)
- Modify: `lib/data/postgres/adapter.ts` (implement them)

- [ ] **Step 1: Define types and add methods to the Repository interface**

In `lib/data/repository.ts`, add these types and method signatures. Find the existing type definitions section and add:

```ts
export type PeriodizationPhase =
  | 'baseline'
  | 'accumulation'
  | 'intensification'
  | 'realisation'
  | 'deload'

export interface PeriodizationState {
  id: string
  userId: string
  phase: PeriodizationPhase
  phaseStartedAt: Date
  sessionsInPhase: number
  baselineComplete: boolean
  updatedAt: Date
}

export type RecommendationType =
  | 'phase_shift'
  | 'deload'
  | 'rest_day'
  | 'parameter_adjustment'
  | 'stay'

export type RecommendationUrgency = 'low' | 'medium' | 'high'
export type RecommendationStatus = 'pending' | 'accepted' | 'rejected'

export interface PeriodizationRecommendation {
  id: string
  userId: string
  createdAt: Date
  type: RecommendationType
  title: string
  reasoning: string
  urgency: RecommendationUrgency
  payload: Record<string, unknown>
  status: RecommendationStatus
  respondedAt: Date | null
  updatedAt: Date
}

export interface RecentSetRpe {
  exerciseName: string
  setNumber: number
  rpe: number
  intensityPct: number | null
  loggedAt: Date
}
```

Then add to the `Repository` interface:

```ts
// Periodization
getPeriodizationState(userId: string): Promise<PeriodizationState | null>
upsertPeriodizationState(userId: string, patch: Partial<Omit<PeriodizationState, 'id' | 'userId' | 'updatedAt'>>): Promise<PeriodizationState>
createRecommendation(userId: string, rec: Omit<PeriodizationRecommendation, 'id' | 'userId' | 'createdAt' | 'respondedAt' | 'updatedAt'>): Promise<PeriodizationRecommendation>
listPendingRecommendations(userId: string): Promise<PeriodizationRecommendation[]>
updateRecommendationStatus(id: string, userId: string, status: RecommendationStatus): Promise<void>
getRecentSetRpe(userId: string, limitDays: number): Promise<RecentSetRpe[]>
```

- [ ] **Step 2: Implement in adapter.ts**

Open `lib/data/postgres/adapter.ts`. Add imports for the new tables at the top:

```ts
import {
  ...,
  periodizationState,
  periodizationRecommendations,
} from './schema'
import type {
  PeriodizationState,
  PeriodizationRecommendation,
  PeriodizationPhase,
  RecommendationType,
  RecommendationUrgency,
  RecommendationStatus,
  RecentSetRpe,
} from '../repository'
```

Then add these method implementations inside the adapter class (append before the closing `}`):

```ts
async getPeriodizationState(userId: string): Promise<PeriodizationState | null> {
  const rows = await this.db
    .select()
    .from(periodizationState)
    .where(eq(periodizationState.userId, userId))
    .limit(1)
  if (!rows[0]) return null
  return {
    id:               rows[0].id,
    userId:           rows[0].userId,
    phase:            rows[0].phase as PeriodizationPhase,
    phaseStartedAt:   new Date(rows[0].phaseStartedAt),
    sessionsInPhase:  rows[0].sessionsInPhase,
    baselineComplete: rows[0].baselineComplete,
    updatedAt:        new Date(rows[0].updatedAt),
  }
}

async upsertPeriodizationState(
  userId: string,
  patch: Partial<Omit<PeriodizationState, 'id' | 'userId' | 'updatedAt'>>,
): Promise<PeriodizationState> {
  const [row] = await this.db
    .insert(periodizationState)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: periodizationState.userId,
      set:    { ...patch, updatedAt: new Date() },
    })
    .returning()
  return {
    id:               row.id,
    userId:           row.userId,
    phase:            row.phase as PeriodizationPhase,
    phaseStartedAt:   new Date(row.phaseStartedAt),
    sessionsInPhase:  row.sessionsInPhase,
    baselineComplete: row.baselineComplete,
    updatedAt:        new Date(row.updatedAt),
  }
}

async createRecommendation(
  userId: string,
  rec: Omit<PeriodizationRecommendation, 'id' | 'userId' | 'createdAt' | 'respondedAt' | 'updatedAt'>,
): Promise<PeriodizationRecommendation> {
  const [row] = await this.db
    .insert(periodizationRecommendations)
    .values({ userId, ...rec })
    .returning()
  return {
    id:          row.id,
    userId:      row.userId,
    createdAt:   new Date(row.createdAt),
    type:        row.type as RecommendationType,
    title:       row.title,
    reasoning:   row.reasoning,
    urgency:     row.urgency as RecommendationUrgency,
    payload:     row.payload as Record<string, unknown>,
    status:      row.status as RecommendationStatus,
    respondedAt: row.respondedAt ? new Date(row.respondedAt) : null,
    updatedAt:   new Date(row.updatedAt),
  }
}

async listPendingRecommendations(userId: string): Promise<PeriodizationRecommendation[]> {
  const rows = await this.db
    .select()
    .from(periodizationRecommendations)
    .where(
      and(
        eq(periodizationRecommendations.userId, userId),
        eq(periodizationRecommendations.status, 'pending'),
      ),
    )
    .orderBy(desc(periodizationRecommendations.createdAt))
    .limit(5)
  return rows.map(r => ({
    id:          r.id,
    userId:      r.userId,
    createdAt:   new Date(r.createdAt),
    type:        r.type as RecommendationType,
    title:       r.title,
    reasoning:   r.reasoning,
    urgency:     r.urgency as RecommendationUrgency,
    payload:     r.payload as Record<string, unknown>,
    status:      r.status as RecommendationStatus,
    respondedAt: r.respondedAt ? new Date(r.respondedAt) : null,
    updatedAt:   new Date(r.updatedAt),
  }))
}

async updateRecommendationStatus(
  id: string,
  userId: string,
  status: RecommendationStatus,
): Promise<void> {
  await this.db
    .update(periodizationRecommendations)
    .set({ status, respondedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(periodizationRecommendations.id, id),
        eq(periodizationRecommendations.userId, userId),
      ),
    )
}

async getRecentSetRpe(userId: string, limitDays: number): Promise<RecentSetRpe[]> {
  const since = new Date(Date.now() - limitDays * 86_400_000)
  const rows = await this.db
    .select({
      exerciseName: exerciseLogs.exerciseName,
      setNumber:    setLogs.setNumber,
      rpe:          setLogs.rpe,
      intensityPct: setLogs.intensityPct,
      loggedAt:     exerciseLogs.loggedAt,
    })
    .from(setLogs)
    .innerJoin(exerciseLogs, eq(setLogs.exerciseLogId, exerciseLogs.id))
    .innerJoin(workoutSessions, eq(exerciseLogs.workoutSessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        isNotNull(setLogs.rpe),
        gte(exerciseLogs.loggedAt, since),
      ),
    )
    .orderBy(desc(exerciseLogs.loggedAt))
    .limit(200)
  return rows
    .filter(r => r.rpe != null)
    .map(r => ({
      exerciseName: r.exerciseName,
      setNumber:    r.setNumber,
      rpe:          r.rpe!,
      intensityPct: r.intensityPct,
      loggedAt:     new Date(r.loggedAt),
    }))
}
```

Make sure `isNotNull`, `gte`, `and`, `desc`, `eq` are imported from `drizzle-orm` at the top of the file.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "periodization|adapter|repository" | head -20
```

Expected: no errors mentioning those files.

- [ ] **Step 4: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add periodization repository methods and types"
```

---

## Task 3 — RPE in log-exercise API

**Files:**
- Modify: `app/api/log-exercise/route.ts` (lines ~10–38 for schema, ~161–175 for setData build)

- [ ] **Step 1: Add `rpeValues` to the Zod schema**

Find `LogExerciseSchema` in `app/api/log-exercise/route.ts`. Add `rpeValues` after `restTimes`:

```ts
rpeValues: z.array(z.number().int().min(1).max(10).nullable()).max(20).optional(),
```

- [ ] **Step 2: Pass `rpeValues` into the setData array**

Find the `setData` array build block (around line 161–175). It currently builds objects with `weightKg`, `reps`, `setTimeSec`, etc. Add `rpe`:

```ts
const setData = Array.from({ length: parsedBody.data.sets }, (_, i) => ({
  setNumber:   i + 1,
  weightKg:    parsedBody.data.weights[i] ?? parsedBody.data.weights[parsedBody.data.weights.length - 1] ?? 0,
  reps:        parsedBody.data.reps[i] ?? parsedBody.data.reps[parsedBody.data.reps.length - 1] ?? 0,
  rpe:         parsedBody.data.rpeValues?.[i] ?? null,
  setTimeSec:  parsedBody.data.setTimes?.[i] ?? null,
  restTimeSec: parsedBody.data.restTimes?.[i] ?? null,
  intensityPct: parsedBody.data.progressionStyle?.[i]?.pct ?? null,
  useFor1rm:   parsedBody.data.progressionStyle?.[i]?.useFor1rm ?? false,
  setStartMs:  parsedBody.data.setStartTimes?.[i] ?? null,
  setEndMs:    parsedBody.data.setEndTimes?.[i] ?? null,
}))
```

The exact shape depends on the current code — find the setData build and add `rpe: parsedBody.data.rpeValues?.[i] ?? null` to each object.

- [ ] **Step 3: Verify the DB write accepts `rpe`**

Open `lib/data/postgres/adapter.ts` and find `logExerciseAndSets`. The setData is inserted into `set_logs` via Drizzle. Confirm the insert includes the `rpe` field — Drizzle will include it automatically since the column is now in the schema. If the insert uses an explicit column list, add `rpe: s.rpe`.

- [ ] **Step 4: Start the dev server and do a manual smoke test**

```bash
pnpm dev
```

Complete a workout set. In the DB, verify:

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -c "SELECT set_number, weight_kg, reps, rpe, intensity_pct FROM set_logs ORDER BY updated_at DESC LIMIT 5;"
```

The `rpe` column should be `NULL` for now (UI not wired yet). Confirms the migration and schema are working.

- [ ] **Step 5: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "Accept rpeValues in log-exercise API, persist to set_logs.rpe"
```

---

## Task 4 — RPE Selector Component + Workout Store

**Files:**
- Create: `components/workout/rpe-selector.tsx`
- Modify: `lib/stores/workout-store.ts`
- Modify: `components/workout/set-card.tsx`
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Create the RPE selector component**

```tsx
// components/workout/rpe-selector.tsx
"use client";

import { memo } from "react";

const RPE_VALUES = [6, 7, 8, 9, 10] as const;

interface RpeSelectorProps {
  value: number;          // currently selected RPE
  onChange: (rpe: number) => void;
}

function RpeSelectorComponent({ value, onChange }: RpeSelectorProps) {
  return (
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
      <span className="text-[9px] text-muted-foreground flex-none">RPE</span>
      <div className="flex gap-1 flex-1">
        {RPE_VALUES.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className="flex-1 rounded-lg py-1 text-[11px] font-bold transition-colors"
            style={{
              background: r === value
                ? "var(--color-brand)"
                : "color-mix(in oklch, var(--color-brand) 10%, var(--color-muted))",
              color: r === value ? "#000" : "var(--color-muted-foreground)",
            }}
            aria-label={`RPE ${r}`}
            aria-pressed={r === value}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

export const RpeSelector = memo(RpeSelectorComponent);

/** Map intensity % → expected RPE (Prilepin-based approximation). */
export function expectedRpe(intensityPct: number | undefined): number {
  if (!intensityPct) return 7;
  if (intensityPct >= 92.5) return 10;
  if (intensityPct >= 87.5) return 9;
  if (intensityPct >= 80)   return 8;
  if (intensityPct >= 70)   return 7;
  return 6;
}
```

- [ ] **Step 2: Add rpeValues to the workout store**

Open `lib/stores/workout-store.ts`. In the state interface, add after `setWeights`:

```ts
rpeValues: number[]       // per-set RPE, index matches setWeights
```

In the initial state (`DEFAULT_STATE` or inline), add:

```ts
rpeValues: [],
```

In the reset block (inside `clearCurrentExercise` or wherever `setWeights: []` is reset), add:

```ts
rpeValues: [],
```

Add these actions to the interface and implementation:

```ts
// Interface
setRpeValue: (idx: number, rpe: number) => void
clearRpeValues: () => void

// Implementation
setRpeValue: (idx, rpe) => set(s => {
  const next = [...s.rpeValues]
  next[idx] = rpe
  return { rpeValues: next }
}),
clearRpeValues: () => set({ rpeValues: [] }),
```

- [ ] **Step 3: Wire RPE selector into the done state of set-card.tsx**

The `SetCardProps` interface needs two new optional props:

```ts
rpe?: number;
onRpeChange?: (index: number, rpe: number) => void;
```

In the `isDone` branch (currently returns at line 43–70), add the selector below the existing content:

```tsx
if (isDone) {
  const { weightLabel, repsLabel } = formatSetLoadParts(weight, repValue, exerciseType);
  return (
    <div className="rounded-2xl p-2.5 border"
      style={{ background: "rgba(34,197,94,0.04)", borderColor: "rgba(34,197,94,0.18)" }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
          style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
          <CheckIcon className="h-4 w-4 text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-muted-foreground">{isAmrap ? 'AMRAP' : `Set ${index + 1}`} · Logged</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            {weightLabel ? (
              <>
                <p className="text-sm font-bold tabular-nums">{weightLabel}</p>
                <p className="text-xs text-muted-foreground">{repsLabel}</p>
              </>
            ) : (
              <p className="text-sm font-bold tabular-nums">{repsLabel}</p>
            )}
          </div>
        </div>
        <div className="text-right flex-none">
          {lapTime !== undefined && <p className="text-[10px] text-muted-foreground">{formatTime(lapTime)} set</p>}
          {restTime !== undefined && <p className="text-[10px] text-muted-foreground">{restTime}s rest</p>}
        </div>
      </div>
      {onRpeChange && rpe != null && (
        <RpeSelector value={rpe} onChange={r => onRpeChange(index, r)} />
      )}
    </div>
  );
}
```

Add the import at the top of set-card.tsx:

```ts
import { RpeSelector } from "./rpe-selector";
```

- [ ] **Step 4: Wire rpeValues through workout-screen.tsx**

In `components/workout-screen.tsx`, find where `SetCard` is rendered and add the new props. Also find `handleLogCurrentSet` (the callback that fires when a set is started/logged) and push an initial RPE value into the store there.

In `handleLogCurrentSet` (around line 429), after `store.appendSetWeight(...)`, add:

```ts
// Pre-fill RPE from the set's intensityPct before the user can see the done card
const styleSet = currentExercise?.progressionStyle?.[store.currentSet]
store.setRpeValue(store.currentSet, expectedRpe(styleSet?.pct))
```

Import `expectedRpe` from `"./rpe-selector"` (or from `"../workout/rpe-selector"` depending on location).

In the `SetCard` render, pass the new props:

```tsx
<SetCard
  ...existing props...
  rpe={store.rpeValues[index]}
  onRpeChange={(idx, rpe) => store.setRpeValue(idx, rpe)}
/>
```

In `handleCompleteSet`, find where the API payload is built and add `rpeValues`:

```ts
body: JSON.stringify({
  ...existingFields,
  rpeValues: store.rpeValues.slice(0, store.currentSet),
}),
```

After the exercise is logged, clear RPE values in the reset block alongside `clearSetWeights()`:

```ts
store.clearRpeValues()
```

- [ ] **Step 5: Test on dev server**

```bash
pnpm dev
```

1. Start a workout, complete a set. The done set card should show an RPE strip (6 7 8 9 10) with the expected value highlighted.
2. Tap a different RPE value — it should highlight immediately.
3. Complete the exercise. In the DB:

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -c "SELECT set_number, weight_kg, reps, rpe, intensity_pct FROM set_logs ORDER BY updated_at DESC LIMIT 5;"
```

`rpe` should now be populated (not NULL) for the logged sets.

- [ ] **Step 6: Commit**

```bash
git add components/workout/rpe-selector.tsx lib/stores/workout-store.ts \
        components/workout/set-card.tsx components/workout-screen.tsx
git commit -m "Add per-set RPE capture to workout UI and log-exercise flow"
```

---

## Task 5 — Signal Aggregator

**Files:**
- Create: `lib/periodization/signals.ts`

This is a pure TypeScript module — no React, no API routes. It reads from the repository and returns a structured `SignalSummary` object that the AI evaluation prompt and the status UI both consume.

- [ ] **Step 1: Create the file**

```ts
// lib/periodization/signals.ts
import type { Repository, PeriodizationState } from '@/lib/data/repository'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@/lib/date-utils'

export interface RpeTrend {
  avgRpe: number
  avgExpectedRpe: number        // from intensityPct mapping
  delta: number                 // avgRpe - avgExpectedRpe (+ve = harder than expected)
  sampleSize: number
}

export interface OneRmTrend {
  exerciseName: string
  recentRm: number
  previousRm: number
  direction: 'up' | 'down' | 'flat'
  changeKg: number
}

export interface SignalSummary {
  // Always available
  consecutiveTrainingDays: number
  sessionsThisWeek: number
  rpeTrend: RpeTrend | null           // null if <3 RPE readings

  // Available after a few weeks
  oneRmTrends: OneRmTrend[]           // top 3 exercises by volume
  acwr: number | null                  // null if <28 days of data

  // Available after ~2 weeks of daily logging
  sleepTrend: { recentAvg: number; baselineAvg: number; delta: number } | null
  hrvTrend:   { recentAvg: number; baselineAvg: number; delta: number } | null

  // Phase context
  phase: PeriodizationState['phase']
  sessionsInPhase: number
  baselineComplete: boolean

  // Confidence tier (determines how assertive the AI should be)
  confidenceTier: 1 | 2 | 3
  // 1 = RPE + consecutive days only (week 1–2)
  // 2 = + 1RM trajectory + sleep trend (week 3–4)
  // 3 = + ACWR + HRV baseline (week 5+)
}

/** Maps intensityPct → expected RPE (same mapping as the UI selector). */
function expectedRpeFromPct(pct: number | null): number {
  if (!pct) return 7
  if (pct >= 92.5) return 10
  if (pct >= 87.5) return 9
  if (pct >= 80)   return 8
  if (pct >= 70)   return 7
  return 6
}

export async function aggregateSignals(
  userId: string,
  repo: Repository,
  tz = DEFAULT_TZ,
): Promise<SignalSummary> {
  const todayStr = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const since90d = new Date(Date.now() - 90 * 86_400_000)
  const since14d = new Date(Date.now() - 14 * 86_400_000)

  const [state, recentSessions, recentRpe, bodyMetrics, sleepRows] = await Promise.all([
    repo.getPeriodizationState(userId),
    repo.getWorkoutSessionsFrom(userId, since90d),
    repo.getRecentSetRpe(userId, 21),
    repo.listBodyMetrics(
      userId,
      formatInTimeZone(since14d, tz, 'yyyy-MM-dd'),
      todayStr,
    ),
    repo.getSleepSessionsFrom
      ? repo.getSleepSessionsFrom(userId, since14d)
      : Promise.resolve([]),
  ])

  // ── Consecutive training days ──
  const trainingDates = new Set(
    recentSessions.map(s => formatInTimeZone(new Date(s.startedAt), tz, 'yyyy-MM-dd')),
  )
  let consecutiveTrainingDays = 0
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i * 86_400_000)
    const ds = formatInTimeZone(d, tz, 'yyyy-MM-dd')
    if (trainingDates.has(ds)) {
      consecutiveTrainingDays++
    } else if (i > 0) {
      break
    }
  }

  // ── Sessions this week ──
  const monday = new Date()
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  monday.setUTCHours(0, 0, 0, 0)
  const sessionsThisWeek = recentSessions.filter(s => new Date(s.startedAt) >= monday).length

  // ── RPE trend ──
  let rpeTrend: RpeTrend | null = null
  if (recentRpe.length >= 3) {
    const rpeSets = recentRpe.slice(0, 30)
    const avgRpe = rpeSets.reduce((s, r) => s + r.rpe, 0) / rpeSets.length
    const avgExpected = rpeSets.reduce((s, r) => s + expectedRpeFromPct(r.intensityPct), 0) / rpeSets.length
    rpeTrend = {
      avgRpe:         Math.round(avgRpe * 10) / 10,
      avgExpectedRpe: Math.round(avgExpected * 10) / 10,
      delta:          Math.round((avgRpe - avgExpected) * 10) / 10,
      sampleSize:     rpeSets.length,
    }
  }

  // ── 1RM trends (top 3 exercises by recency) ──
  const exerciseMap = new Map<string, { recent: number; previous: number }>()
  const sortedSessions = [...recentSessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
  for (const session of sortedSessions) {
    for (const log of session.exercises ?? []) {
      if (!log.estimated1rm) continue
      const existing = exerciseMap.get(log.exerciseName)
      if (!existing) {
        exerciseMap.set(log.exerciseName, { recent: log.estimated1rm, previous: 0 })
      } else if (existing.previous === 0) {
        exerciseMap.set(log.exerciseName, { ...existing, previous: log.estimated1rm })
      }
    }
  }
  const oneRmTrends: OneRmTrend[] = Array.from(exerciseMap.entries())
    .filter(([, v]) => v.previous > 0)
    .slice(0, 3)
    .map(([name, { recent, previous }]) => {
      const changeKg = Math.round((recent - previous) * 10) / 10
      return {
        exerciseName: name,
        recentRm:     recent,
        previousRm:   previous,
        direction:    changeKg > 0.5 ? 'up' : changeKg < -0.5 ? 'down' : 'flat',
        changeKg:     Math.abs(changeKg),
      }
    })

  // ── Sleep trend ──
  let sleepTrend: SignalSummary['sleepTrend'] = null
  const sleepWithData = (sleepRows as { durationHours?: number | null }[])
    .filter(r => r.durationHours != null)
  if (sleepWithData.length >= 4) {
    const recent = sleepWithData.slice(0, 3).map(r => r.durationHours!) 
    const baseline = sleepWithData.slice(0, 10).map(r => r.durationHours!)
    const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length
    const baselineAvg = baseline.reduce((s, v) => s + v, 0) / baseline.length
    sleepTrend = {
      recentAvg:   Math.round(recentAvg * 10) / 10,
      baselineAvg: Math.round(baselineAvg * 10) / 10,
      delta:       Math.round((recentAvg - baselineAvg) * 10) / 10,
    }
  }

  // ── HRV trend ──
  let hrvTrend: SignalSummary['hrvTrend'] = null
  const hrvRows = bodyMetrics.filter(r => r.hrvMs != null)
  if (hrvRows.length >= 4) {
    const recent = hrvRows.slice(0, 3).map(r => r.hrvMs!)
    const baseline = hrvRows.slice(0, 10).map(r => r.hrvMs!)
    const recentAvg  = recent.reduce((s, v) => s + v, 0) / recent.length
    const baselineAvg = baseline.reduce((s, v) => s + v, 0) / baseline.length
    hrvTrend = {
      recentAvg:   Math.round(recentAvg),
      baselineAvg: Math.round(baselineAvg),
      delta:       Math.round(recentAvg - baselineAvg),
    }
  }

  // ── ACWR (proxy: use recentSessions volume) ──
  // Full ACWR requires 28 days — only compute if enough history
  let acwr: number | null = null
  if (recentSessions.length > 0 && since90d < new Date(Date.now() - 28 * 86_400_000)) {
    const acute7  = recentSessions.filter(s => new Date(s.startedAt) >= new Date(Date.now() - 7  * 86_400_000)).length
    const chronic28 = recentSessions.filter(s => new Date(s.startedAt) >= new Date(Date.now() - 28 * 86_400_000)).length
    const chronicAvg = chronic28 / 4
    acwr = chronicAvg > 0 ? Math.round((acute7 / chronicAvg) * 100) / 100 : null
  }

  // ── Confidence tier ──
  let confidenceTier: 1 | 2 | 3 = 1
  if (acwr != null && (hrvTrend != null || sleepTrend != null)) confidenceTier = 3
  else if (oneRmTrends.length >= 2 || sleepTrend != null) confidenceTier = 2

  return {
    consecutiveTrainingDays,
    sessionsThisWeek,
    rpeTrend,
    oneRmTrends,
    acwr,
    sleepTrend,
    hrvTrend,
    phase:            state?.phase ?? 'baseline',
    sessionsInPhase:  state?.sessionsInPhase ?? 0,
    baselineComplete: state?.baselineComplete ?? false,
    confidenceTier,
  }
}
```

> **Note:** `repo.getWorkoutSessionsFrom` returns `WorkoutSession[]`. If those objects don't have an `exercises` property, replace the 1RM trend loop with a separate `repo.getExerciseSummary(userId)` call.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep "signals" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/periodization/signals.ts
git commit -m "Add signal aggregator for periodization engine"
```

---

## Task 6 — Periodization AI Prompt Builder

**Files:**
- Create: `lib/periodization/prompt.ts`

- [ ] **Step 1: Create the prompt builder**

```ts
// lib/periodization/prompt.ts
import type { SignalSummary } from './signals'
import type { PeriodizationPhase } from '@/lib/data/repository'

const PHASE_DESCRIPTIONS: Record<PeriodizationPhase, string> = {
  baseline:        'Observation phase — learning the athlete's true work capacity and RPE calibration. Avoid aggressive phase shifts.',
  accumulation:    'Building volume. Moderate intensity (65–75% 1RM), higher reps (8–12). Goal: increase work capacity.',
  intensification: 'Increasing load, reducing volume. Higher intensity (80–87.5% 1RM), moderate reps (4–6). Goal: convert volume into strength.',
  realisation:     'Peaking. Low volume, high intensity (87.5–92.5%+ 1RM), low reps (1–3). Goal: express maximal strength.',
  deload:          'Recovery week. Reduce load 40–50%, keep movement patterns. Goal: dissipate fatigue.',
}

const NEXT_PHASES: Partial<Record<PeriodizationPhase, PeriodizationPhase>> = {
  baseline:        'accumulation',
  accumulation:    'intensification',
  intensification: 'realisation',
  realisation:     'deload',
  deload:          'accumulation',
}

export function buildPeriodizationSystemPrompt(): string {
  return `You are a periodization coach analyzing an athlete's training data to recommend whether to shift phases or adjust parameters.

## Your output
Always respond with a single JSON object — no markdown, no prose, just the JSON:

{
  "recommendation": "phase_shift" | "deload" | "rest_day" | "parameter_adjustment" | "stay",
  "title": "short title (max 60 chars)",
  "reasoning": "2–3 sentences explaining the data signals that led to this recommendation",
  "urgency": "low" | "medium" | "high",
  "payload": {
    // For phase_shift:
    "newPhase": "accumulation" | "intensification" | "realisation" | "deload",
    "suggestedSets": 4,
    "suggestedRepsPerSet": [8, 8, 8, 8],
    "suggestedIntensityPct": [70, 72.5, 75, 77.5],

    // For rest_day:
    "targetDate": "YYYY-MM-DD",

    // For parameter_adjustment (no phase change, just tweak):
    "suggestedSets": 4,
    "suggestedRepsPerSet": [6, 6, 5, 5],
    "suggestedIntensityPct": [80, 82.5, 82.5, 85],
    "note": "brief explanation"

    // For deload:
    "loadReductionPct": 40,

    // For stay:
    // payload can be {}
  }
}

## Phase transition rules (guidelines — use judgment)
- baseline → accumulation: baseline_complete = true AND athlete has ≥6 sessions with RPE data
- accumulation → intensification: RPE delta > +0.5 for 2+ sessions AND at least one 1RM trending up
- intensification → realisation: ACWR < 1.1 AND 1RM plateau (flat for 2 sessions)
- Any phase → deload (emergency): ACWR > 1.5 OR consecutive_training_days ≥ 5 OR RPE delta > +1.5
- deload → accumulation: always after a deload of ≥5 sessions

## Confidence tiers
- Tier 1 (limited data): Be conservative. Only recommend rest_day or stay unless signals are very clear.
- Tier 2 (moderate data): Can recommend parameter_adjustment or phase_shift with good reasoning.
- Tier 3 (full data): Full range of recommendations available.

## Baseline phase
During baseline, the primary goal is calibration. Recommend "stay" unless consecutive_training_days ≥ 5 or RPE delta > +2.0.
`.trim()
}

export function buildPeriodizationUserPrompt(signals: SignalSummary, todayDate: string): string {
  const lines: string[] = [
    `Today: ${todayDate}`,
    `Current phase: ${signals.phase} — ${PHASE_DESCRIPTIONS[signals.phase]}`,
    `Sessions in current phase: ${signals.sessionsInPhase}`,
    `Baseline complete: ${signals.baselineComplete}`,
    `Confidence tier: ${signals.confidenceTier}/3`,
    ``,
    `## Training load signals`,
    `Consecutive training days: ${signals.consecutiveTrainingDays}`,
    `Sessions this week: ${signals.sessionsThisWeek}`,
    signals.acwr != null ? `ACWR: ${signals.acwr}` : `ACWR: not yet available (<28 days of data)`,
    ``,
  ]

  if (signals.rpeTrend) {
    lines.push(`## RPE trend (last ${signals.rpeTrend.sampleSize} sets)`)
    lines.push(`Average actual RPE: ${signals.rpeTrend.avgRpe}`)
    lines.push(`Average expected RPE (from intensity %): ${signals.rpeTrend.avgExpectedRpe}`)
    lines.push(`Delta (positive = harder than programmed): ${signals.rpeTrend.delta}`)
    lines.push(``)
  } else {
    lines.push(`## RPE: insufficient data (<3 logged sets with RPE)`)
    lines.push(``)
  }

  if (signals.oneRmTrends.length > 0) {
    lines.push(`## 1RM trends`)
    for (const t of signals.oneRmTrends) {
      lines.push(`${t.exerciseName}: ${t.previousRm}kg → ${t.recentRm}kg (${t.direction}, ${t.changeKg}kg)`)
    }
    lines.push(``)
  }

  if (signals.sleepTrend) {
    lines.push(`## Sleep (last 3 nights avg vs 10-night baseline)`)
    lines.push(`Recent: ${signals.sleepTrend.recentAvg}h | Baseline: ${signals.sleepTrend.baselineAvg}h | Delta: ${signals.sleepTrend.delta}h`)
    lines.push(``)
  }

  if (signals.hrvTrend) {
    lines.push(`## HRV (last 3 days avg vs 10-day baseline)`)
    lines.push(`Recent: ${signals.hrvTrend.recentAvg}ms | Baseline: ${signals.hrvTrend.baselineAvg}ms | Delta: ${signals.hrvTrend.delta}ms`)
    lines.push(``)
  }

  const nextPhase = NEXT_PHASES[signals.phase]
  if (nextPhase) {
    lines.push(`## Next phase if shifted: ${nextPhase}`)
    lines.push(PHASE_DESCRIPTIONS[nextPhase])
  }

  lines.push(``)
  lines.push(`Based on the above signals, provide your recommendation as JSON.`)

  return lines.join('\n')
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/periodization/prompt.ts
git commit -m "Add periodization AI prompt builder"
```

---

## Task 7 — Periodization Status API

**Files:**
- Create: `app/api/periodization/status/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/periodization/status/route.ts
import { getSession } from '@/lib/session'
import { getRepositoryAsync } from '@/lib/data/postgres/adapter'
import { aggregateSignals } from '@/lib/periodization/signals'
import { DEFAULT_TZ } from '@/lib/date-utils'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepositoryAsync()

  const [signals, pending] = await Promise.all([
    aggregateSignals(userId, repo, tz),
    repo.listPendingRecommendations(userId),
  ])

  return NextResponse.json({ signals, pending })
}
```

- [ ] **Step 2: Test the endpoint**

```bash
pnpm dev
# In another terminal:
curl -s http://localhost:3000/api/periodization/status \
  -H "Cookie: $(cat /tmp/test-cookie 2>/dev/null || echo '')" | jq .
```

If you don't have a session cookie, open the app in the browser and copy the cookie from DevTools. You should get back:

```json
{
  "signals": {
    "consecutiveTrainingDays": 1,
    "sessionsThisWeek": 1,
    "rpeTrend": null,
    "oneRmTrends": [...],
    "acwr": null,
    "phase": "baseline",
    "sessionsInPhase": 0,
    "baselineComplete": false,
    "confidenceTier": 1
  },
  "pending": []
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/periodization/status/route.ts
git commit -m "Add periodization status API"
```

---

## Task 8 — AI Evaluation Route

**Files:**
- Create: `app/api/periodization/evaluate/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/periodization/evaluate/route.ts
import { getSession } from '@/lib/session'
import { getRepositoryAsync } from '@/lib/data/postgres/adapter'
import { aggregateSignals } from '@/lib/periodization/signals'
import {
  buildPeriodizationSystemPrompt,
  buildPeriodizationUserPrompt,
} from '@/lib/periodization/prompt'
import { DEFAULT_TZ, todayInTz } from '@/lib/date-utils'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import type {
  RecommendationType,
  RecommendationUrgency,
} from '@/lib/data/repository'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST() {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepositoryAsync()

  const signals = await aggregateSignals(userId, repo, tz)
  const today   = todayInTz(tz)

  const systemPrompt = buildPeriodizationSystemPrompt()
  const userPrompt   = buildPeriodizationUserPrompt(signals, today)

  let parsed: {
    recommendation: string
    title: string
    reasoning: string
    urgency: string
    payload: Record<string, unknown>
  }

  try {
    const { text } = await generateText({
      model: google('gemini-2.0-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })

    // Strip markdown fences if the model wraps the JSON
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('[periodization/evaluate] AI or parse error:', String(err).slice(0, 300))
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 })
  }

  // Validate required fields
  if (!parsed.recommendation || !parsed.title || !parsed.reasoning) {
    return NextResponse.json({ error: 'Invalid AI response shape' }, { status: 500 })
  }

  // Don't store "stay" recommendations — no action needed
  if (parsed.recommendation === 'stay') {
    return NextResponse.json({ recommendation: 'stay', title: parsed.title, reasoning: parsed.reasoning })
  }

  const rec = await repo.createRecommendation(userId, {
    type:      parsed.recommendation as RecommendationType,
    title:     parsed.title,
    reasoning: parsed.reasoning,
    urgency:   (parsed.urgency ?? 'low') as RecommendationUrgency,
    payload:   parsed.payload ?? {},
    status:    'pending',
  })

  return NextResponse.json(rec)
}
```

- [ ] **Step 2: Test the endpoint**

```bash
pnpm dev
# With an active dev session:
curl -s -X POST http://localhost:3000/api/periodization/evaluate \
  -H "Cookie: <your-session-cookie>" | jq .
```

Expected response (example — AI output varies):
```json
{
  "id": "...",
  "type": "stay",
  "title": "Continue baseline phase",
  "reasoning": "Only 1 session with RPE data available. Continuing observation before making recommendations.",
  "urgency": "low",
  "payload": {},
  "status": "pending"
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/periodization/evaluate/route.ts
git commit -m "Add periodization AI evaluation route"
```

---

## Task 9 — Accept / Reject Recommendation Route

**Files:**
- Create: `app/api/periodization/recommendations/[id]/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/periodization/recommendations/[id]/route.ts
import { getSession } from '@/lib/session'
import { getRepositoryAsync } from '@/lib/data/postgres/adapter'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { PeriodizationPhase } from '@/lib/data/repository'

const BodySchema = z.object({
  action: z.enum(['accept', 'reject']),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = BodySchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const userId = session.user.id
  const repo   = await getRepositoryAsync()
  const status = body.data.action === 'accept' ? 'accepted' : 'rejected'

  await repo.updateRecommendationStatus(id, userId, status)

  // On accept, apply side effects
  if (status === 'accepted') {
    const pending = await repo.listPendingRecommendations(userId)
    // The recommendation we just accepted is now 'accepted', so fetch it differently
    // For now, re-read from DB — a dedicated getRecommendation method could be added in Phase 2
    // Side effect: if it's a phase_shift, update periodization_state
    // We'll rely on the payload being included in the response body for now
    // and the client can call /api/periodization/status to refresh
  }

  return NextResponse.json({ ok: true })
}
```

> **Note on accept side effects:** Phase 2 should add a `getRecommendationById` method to apply the payload (e.g., update `periodization_state.phase` on phase_shift). For the base implementation, accepting updates the status and the UI re-fetches state. A follow-up task should wire the phase_shift payload into `upsertPeriodizationState`.

- [ ] **Step 2: Wire phase-shift side effect (important — do this in the same task)**

Extend the PATCH handler above. After `await repo.updateRecommendationStatus(...)`, add:

```ts
if (status === 'accepted') {
  // Read the recommendation from the DB to get its payload
  // Add getRecommendationById to adapter (simple SELECT by id):
  // For now, parse payload from the request body if client sends it
}
```

Since the client will have the full recommendation object when it calls this endpoint, accept the recommendation payload in the body:

```ts
const BodySchema = z.object({
  action:  z.enum(['accept', 'reject']),
  type:    z.string().optional(),
  payload: z.record(z.unknown()).optional(),
})
```

Then on accept, if `type === 'phase_shift'` and `payload.newPhase` is set:

```ts
if (status === 'accepted' && body.data.type === 'phase_shift' && body.data.payload?.newPhase) {
  await repo.upsertPeriodizationState(userId, {
    phase:           body.data.payload.newPhase as PeriodizationPhase,
    phaseStartedAt:  new Date(),
    sessionsInPhase: 0,
  })
}
```

If `type === 'deload'`, force a deload phase:

```ts
if (status === 'accepted' && body.data.type === 'deload') {
  await repo.upsertPeriodizationState(userId, {
    phase:           'deload',
    phaseStartedAt:  new Date(),
    sessionsInPhase: 0,
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/periodization/recommendations
git commit -m "Add recommendation accept/reject route with phase-shift side effects"
```

---

## Task 10 — Auto-increment sessionsInPhase After Each Workout

**Files:**
- Modify: `app/api/log-exercise/route.ts` (or a new `app/api/workout-complete/route.ts` if it exists)

Each time a workout session is completed, `periodization_state.sessions_in_phase` should increment. The right hook is when `completedAt` is set on a workout session.

- [ ] **Step 1: Find where workout completion is called**

```bash
grep -n "completedAt\|completeWorkoutSession\|workout-complete" \
  app/api/log-exercise/route.ts app/api/workout-complete/route.ts 2>/dev/null | head -20
```

- [ ] **Step 2: Add increment after session completion**

In whichever route calls `repo.completeWorkoutSession(...)`, add directly after:

```ts
// Increment sessions_in_phase counter
const currentState = await repo.getPeriodizationState(userId)
const sessionsInPhase = (currentState?.sessionsInPhase ?? 0) + 1
// Mark baseline complete after 6 sessions with RPE data across all session types
const baselineComplete = currentState?.baselineComplete
  ?? sessionsInPhase >= 6

await repo.upsertPeriodizationState(userId, {
  sessionsInPhase,
  baselineComplete: currentState?.baselineComplete || baselineComplete,
})
```

- [ ] **Step 3: Commit**

```bash
git add app/api/log-exercise/route.ts  # or whichever file was modified
git commit -m "Increment sessions_in_phase after each completed workout"
```

---

## Task 11 — Periodization Card UI + Health Tab Integration

**Files:**
- Create: `components/health/periodization-card.tsx`
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Create the PeriodizationCard component**

```tsx
// components/health/periodization-card.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { BrainIcon, CheckIcon, XIcon, RefreshCwIcon } from "lucide-react";
import { accentCardStyle } from "@/lib/utils";
import type { SignalSummary } from "@/lib/periodization/signals";
import type { PeriodizationRecommendation } from "@/lib/data/repository";

const PHASE_COLOR: Record<string, string> = {
  baseline:        "#94a3b8",
  accumulation:    "#22c55e",
  intensification: "#f97316",
  realisation:     "#ef4444",
  deload:          "#8b5cf6",
};

const PHASE_LABEL: Record<string, string> = {
  baseline:        "Baseline",
  accumulation:    "Accumulation",
  intensification: "Intensification",
  realisation:     "Realisation",
  deload:          "Deload",
};

interface PeriodizationStatus {
  signals: SignalSummary;
  pending: PeriodizationRecommendation[];
}

export function PeriodizationCard() {
  const [data, setData] = useState<PeriodizationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/periodization/status");
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      await fetch("/api/periodization/evaluate", { method: "POST" });
      await fetchStatus();
    } catch { /* ignore */ }
    finally { setEvaluating(false); }
  }

  async function handleAction(rec: PeriodizationRecommendation, action: "accept" | "reject") {
    setActionLoading(rec.id);
    try {
      await fetch(`/api/periodization/recommendations/${rec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, type: rec.type, payload: rec.payload }),
      });
      await fetchStatus();
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <div className="h-20 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  const phase = data?.signals.phase ?? "baseline";
  const color = PHASE_COLOR[phase] ?? "#94a3b8";
  const signals = data?.signals;
  const pending = data?.pending ?? [];

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle(color)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BrainIcon className="h-3.5 w-3.5" style={{ color }} />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            AI Periodization
          </p>
        </div>
        <button
          type="button"
          onClick={handleEvaluate}
          disabled={evaluating}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Run evaluation"
        >
          <RefreshCwIcon className={`h-3 w-3 ${evaluating ? "animate-spin" : ""}`} />
          {evaluating ? "Evaluating…" : "Evaluate"}
        </button>
      </div>

      {/* Phase badge */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="rounded-xl px-3 py-1.5 text-xs font-bold"
          style={{ background: `${color}22`, color }}
        >
          {PHASE_LABEL[phase] ?? phase}
        </div>
        {signals && (
          <p className="text-[10px] text-muted-foreground">
            {signals.sessionsInPhase} session{signals.sessionsInPhase !== 1 ? "s" : ""} in phase
            {!signals.baselineComplete && " · calibrating"}
          </p>
        )}
      </div>

      {/* Signal health row */}
      {signals && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <Signal
            label="Training days"
            value={`${signals.consecutiveTrainingDays} in a row`}
            alert={signals.consecutiveTrainingDays >= 4}
          />
          {signals.rpeTrend && (
            <Signal
              label="RPE delta"
              value={`${signals.rpeTrend.delta > 0 ? "+" : ""}${signals.rpeTrend.delta}`}
              alert={signals.rpeTrend.delta > 1}
            />
          )}
          {signals.acwr != null && (
            <Signal
              label="ACWR"
              value={signals.acwr.toFixed(2)}
              alert={signals.acwr > 1.3}
            />
          )}
          {signals.sleepTrend && (
            <Signal
              label="Sleep Δ"
              value={`${signals.sleepTrend.delta > 0 ? "+" : ""}${signals.sleepTrend.delta}h`}
              alert={signals.sleepTrend.delta < -0.75}
            />
          )}
        </div>
      )}

      {/* Pending recommendation */}
      {pending.map(rec => (
        <div
          key={rec.id}
          className="rounded-xl border border-border/50 bg-background/60 p-3 mt-2"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-sm font-semibold leading-snug">{rec.title}</p>
            <span
              className="text-[9px] font-bold rounded-full px-1.5 py-0.5 flex-none"
              style={{
                background: rec.urgency === "high" ? "#ef444422" : rec.urgency === "medium" ? "#f9731622" : "#94a3b822",
                color:      rec.urgency === "high" ? "#ef4444"   : rec.urgency === "medium" ? "#f97316"   : "#94a3b8",
              }}
            >
              {rec.urgency}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{rec.reasoning}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleAction(rec, "reject")}
              disabled={!!actionLoading}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              <XIcon className="h-3 w-3" /> Dismiss
            </button>
            <button
              type="button"
              onClick={() => handleAction(rec, "accept")}
              disabled={!!actionLoading}
              className="flex-1 flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
              style={{ background: color, color: "#000" }}
            >
              <CheckIcon className="h-3 w-3" />
              {actionLoading === rec.id ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      ))}

      {pending.length === 0 && !evaluating && (
        <p className="text-[11px] text-muted-foreground text-center py-1">
          No recommendations pending · tap Evaluate to analyse
        </p>
      )}

      <p className="text-[9px] text-muted-foreground mt-3 text-center">
        Confidence tier {signals?.confidenceTier ?? 1}/3
        {signals?.confidenceTier === 1 ? " · building baseline data" : ""}
      </p>
    </div>
  );
}

function Signal({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1 text-center ${alert ? "bg-red-500/10" : "bg-muted/60"}`}>
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-bold ${alert ? "text-red-400" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Add the card to Health > Training tab**

Open `app/health/health-content.tsx`. Find the import block and add:

```ts
import { PeriodizationCard } from "@/components/health/periodization-card";
```

Find the Training tab section (`{tab === "training" && (`). Add `<PeriodizationCard />` at the top of the training tab content, before `<CalendarWidget>`:

```tsx
{tab === "training" && (
  <div className="space-y-4">
    <PeriodizationCard />
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <CalendarWidget onDayClick={handleDayClick} />
    </div>
    ...rest of training tab...
```

- [ ] **Step 3: Test end-to-end**

```bash
pnpm dev
```

1. Open Health → Training tab — the Periodization Card should appear, showing phase "Baseline" and confidence tier 1.
2. Tap "Evaluate" — it should spin, call the AI, and show either "No recommendations pending" (if AI says stay) or a recommendation card.
3. If a recommendation appears, tap "Apply" — the card should re-fetch and show the updated phase.
4. Log a workout set and check that `rpe` appears in the DB.

- [ ] **Step 4: Commit**

```bash
git add components/health/periodization-card.tsx app/health/health-content.tsx
git commit -m "Add PeriodizationCard UI to Health > Training tab"
```

---

## Post-implementation Checklist

- [ ] All 5 RPE values (6–10) selectable in set card done state
- [ ] RPE persists to DB (`set_logs.rpe`) after exercise completion
- [ ] `/api/periodization/status` returns signals without error
- [ ] `/api/periodization/evaluate` returns a valid JSON recommendation from the AI
- [ ] Accepting a `phase_shift` recommendation updates `periodization_state.phase`
- [ ] `sessions_in_phase` increments after each completed workout
- [ ] PeriodizationCard renders in Health > Training with phase badge and signal row
- [ ] `confidenceTier` advances from 1 to 2 to 3 as data accumulates

---

## Phase 2 Notes (not in this plan)

- **Per-exercise phase overrides** — each lift tracks its own phase independently
- **Auto-apply progression style changes** — on phase_shift accept, rewrite the user's `style_sets` rows to match the new `suggestedSets/Reps/IntensityPct`
- **Phase history timeline** — visual log of all past transitions and what triggered them
- **Recommendation push notifications** — notify user when AI flags a high-urgency signal
- **Evaluate trigger on workout completion** — auto-run evaluation after each session instead of requiring manual tap
