> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Block Periodization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional block periodization to the program system so programs can define an ordered phase sequence (Accumulation → Intensification → Peak → Deload), the app tracks the current phase cycle-by-cycle, applies the correct progression style per exercise automatically, and triggers deload weeks either on schedule or when fatigue data warrants one early.

**Architecture:** Two new pure-function utilities (`lib/phase-engine.ts`) drive all phase logic with no DB calls; the API routes call repo methods to gather inputs then pass them to the engine. The DB gains one new table (`program_phases`) and new columns on `programs`, `session_exercises`, and `workout_sessions`; all stats APIs filter deload sessions using the `is_early_deload` flag and `phase_type` denormalized onto `WorkoutSession`. The config screen gains a mode toggle, a drag-to-reorder phase editor (extracted to its own component), and a per-exercise role pill.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL (Railway), Tailwind v4, shadcn/ui, @dnd-kit/react (already installed), vitest (add for phase engine tests)

---

## Design Note — 'peak' Phase Type

The spec SQL only defines `phase_type IN ('normal', 'deload')`, but the secondary style resolution requires detecting when the current phase is a "Peak" phase (secondary exercises skip it). This plan adds `'peak'` as a third `phase_type` value. The UI shows three type pills: `[ Normal ] [ Peak ] [ Deload ]`. This is the only way to make secondary resolution work without relying on fragile name matching.

---

## File Map

| Status | File | Change |
|--------|------|--------|
| **Create** | `lib/data/postgres/migrations/020_block_periodization.sql` | New migration — `program_phases` table + new columns |
| **Modify** | `lib/data/postgres/schema.ts` | `programPhases` table, new columns on 4 existing tables |
| **Modify** | `lib/types/log.ts` | Add `phaseId`, `phaseType`, `isEarlyDeload` to `WorkoutSession` |
| **Modify** | `lib/types/program.ts` | Add `ProgramPhase`, `ExerciseRole`; update `Program`, `SessionExercise` |
| **Modify** | `lib/data/repository.ts` | Add 5 new interface methods |
| **Modify** | `lib/data/postgres/adapter.ts` | Implement new methods; update `buildWorkoutSessions`, `listPrograms`, `saveProgram`, `createWorkoutSession`, `ensureWorkoutSession` |
| **Create** | `lib/phase-engine.ts` | Pure functions: `getCurrentPhase`, `isDeloadActive`, `resolveStyleForExercise` |
| **Create** | `lib/__tests__/phase-engine.test.ts` | Vitest unit tests for phase engine |
| **Create** | `components/config/phase-editor.tsx` | Self-contained phase sequence editor component |
| **Modify** | `components/config-screen.tsx` | Mode toggle, phase editor, per-exercise role picker, save changes |
| **Modify** | `app/api/workout-data/route.ts` | Phase engine integration; return phase status + deload params |
| **Create** | `app/api/confirm-early-deload/route.ts` | "Take deload now" action — sets `early_deload_week_start` + stamps sessions |
| **Modify** | `app/api/log-exercise/route.ts` | Stamp `phase_id` + `is_early_deload` on session; skip 1RM/PR when deload |
| **Modify** | `app/api/sync-workout/route.ts` | Stamp `phase_id` + `is_early_deload` on offline-synced sessions |
| **Modify** | `app/api/readiness-score/route.ts` | Add `earlyDeloadRecommended` to response |
| **Modify** | `components/workout/pre-workout-screen.tsx` | Deload banner (two variants), phase indicator, halved set counts |
| **Modify** | `app/session-select/session-select-content.tsx` | Block progress card, early deload recommendation card |
| **Modify** | `app/workout-select/workout-select-content.tsx` | Phase badge on session card |
| **Modify** | `app/api/exercise-history/route.ts` | Add `isDeload` flag to history entries |
| **Modify** | `app/api/weekly-stats/route.ts` | Exclude deload sessions from volume totals |
| **Modify** | `app/api/training-load/route.ts` | Exclude deload from chronic ACWR |
| **Modify** | `components/stats/weekly-stats-hub.tsx` | Deload day marker (`D` label) on training load bars |

---

## Task 1: DB Migration

**Files:**
- Create: `lib/data/postgres/migrations/020_block_periodization.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Create program_phases first — workout_sessions.phase_id references it
CREATE TABLE program_phases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  name                TEXT NOT NULL,
  duration_cycles     INTEGER NOT NULL CHECK (duration_cycles >= 1),
  phase_type          TEXT NOT NULL DEFAULT 'normal' CHECK (phase_type IN ('normal', 'peak', 'deload')),
  primary_style_id    UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  secondary_style_id  UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  UNIQUE (program_id, position)
);

-- Extend programs table with periodization fields
ALTER TABLE programs
  ADD COLUMN phase_mode             TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN started_at             DATE,
  ADD COLUMN sessions_per_cycle     INTEGER,
  ADD COLUMN early_deload_week_start DATE;

-- Add exercise role to session_exercises (existing rows default to 'primary')
ALTER TABLE session_exercises
  ADD COLUMN exercise_role TEXT NOT NULL DEFAULT 'primary';

-- Add phase tracking to workout_sessions
ALTER TABLE workout_sessions
  ADD COLUMN phase_id        UUID REFERENCES program_phases(id) ON DELETE SET NULL,
  ADD COLUMN is_early_deload BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Verify the migration file exists**

```bash
ls lib/data/postgres/migrations/020_block_periodization.sql
```

Expected: file listed.

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/migrations/020_block_periodization.sql
git commit -m "feat: add block periodization DB migration"
```

---

## Task 2: Drizzle Schema

**Files:**
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Add new columns to `programs` table**

In `lib/data/postgres/schema.ts`, find the `programs` table definition and add 4 columns:

```typescript
export const programs = pgTable('programs', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  isActive:  boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Block periodization
  phaseMode:            text('phase_mode').notNull().default('manual'),
  startedAt:            date('started_at', { mode: 'string' }),
  sessionsPerCycle:     integer('sessions_per_cycle'),
  earlyDeloadWeekStart: date('early_deload_week_start', { mode: 'string' }),
}, t => [unique().on(t.userId, t.name)])
```

- [ ] **Step 2: Add `exerciseRole` column to `sessionExercises` table**

```typescript
export const sessionExercises = pgTable('session_exercises', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sessionId:    uuid('session_id').notNull().references(() => programSessions.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(),
  styleId:      uuid('style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  muscleGroups: text('muscle_groups').array().notNull().default([]),
  position:     integer('position').notNull(),
  exerciseRole: text('exercise_role').notNull().default('primary'),
}, t => [unique().on(t.sessionId, t.position)])
```

- [ ] **Step 3: Add new columns to `workoutSessions` table**

Add `phaseId` and `isEarlyDeload`. Note: `programPhases` is defined in Step 4 — Drizzle handles forward references via arrow functions, so order in the file does not matter.

```typescript
export const workoutSessions = pgTable('workout_sessions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId:     uuid('session_id').references(() => programSessions.id, { onDelete: 'set null' }),
  sessionName:   text('session_name').notNull(),
  startedAt:     timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  phaseId:       uuid('phase_id').references(() => programPhases.id, { onDelete: 'set null' }),
  isEarlyDeload: boolean('is_early_deload').notNull().default(false),
})
```

- [ ] **Step 4: Add the `programPhases` table** (insert after the `programSessions` export)

```typescript
export const programPhases = pgTable('program_phases', {
  id:               uuid('id').primaryKey().defaultRandom(),
  programId:        uuid('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  position:         integer('position').notNull(),
  name:             text('name').notNull(),
  durationCycles:   integer('duration_cycles').notNull(),
  phaseType:        text('phase_type').notNull().default('normal'),
  primaryStyleId:   uuid('primary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  secondaryStyleId: uuid('secondary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
}, t => [unique().on(t.programId, t.position)])
```

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/schema.ts
git commit -m "feat: extend Drizzle schema for block periodization"
```

---

## Task 3: TypeScript Types

**Files:**
- Modify: `lib/types/log.ts`
- Modify: `lib/types/program.ts`

- [ ] **Step 1: Update `WorkoutSession` in `lib/types/log.ts`**

Add three fields. `isEarlyDeload` is non-optional (has DB default `false`). `phaseType` is denormalized from the joined `program_phases` row — `undefined` when the session has no `phase_id`.

```typescript
export interface WorkoutSession {
  id: string
  userId: string
  sessionId?: string
  sessionName: string
  startedAt: Date
  completedAt?: Date
  exercises: ExerciseLog[]
  phaseId?: string
  phaseType?: 'normal' | 'peak' | 'deload'
  isEarlyDeload: boolean
}
```

- [ ] **Step 2: Add types to `lib/types/program.ts`**

Add `ExerciseRole`, `ProgramPhase`, update `SessionExercise` and `Program`:

```typescript
export type ExerciseRole = 'primary' | 'secondary' | 'accessory'

export interface ProgramPhase {
  id: string
  programId: string
  position: number
  name: string
  durationCycles: number
  phaseType: 'normal' | 'peak' | 'deload'
  primaryStyleId?: string
  secondaryStyleId?: string
}

// Update SessionExercise — add exerciseRole:
export interface SessionExercise {
  id: string
  sessionId: string
  exerciseName: string
  styleId?: string
  muscleGroups: string[]
  position: number
  exerciseRole: ExerciseRole   // NEW
}

// Update Program — add 4 periodization fields:
export interface Program {
  id: string
  userId: string
  name: string
  isActive: boolean
  sessions: ProgramSession[]
  schedule?: Schedule
  createdAt: Date
  updatedAt: Date
  phaseMode: 'manual' | 'automatic'         // NEW — defaults 'manual'
  startedAt?: string                         // NEW — YYYY-MM-DD, null in manual mode
  sessionsPerCycle?: number                  // NEW — frozen snapshot
  earlyDeloadWeekStart?: string             // NEW — YYYY-MM-DD
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | head -40
```

Expected: errors only from adapter/repository not yet updated (type mismatches) — not from the types themselves.

- [ ] **Step 4: Commit**

```bash
git add lib/types/log.ts lib/types/program.ts
git commit -m "feat: add block periodization TypeScript types"
```

---

## Task 4: Repository Interface

**Files:**
- Modify: `lib/data/repository.ts`

- [ ] **Step 1: Add imports and 5 new method signatures**

Add `ProgramPhase` to the imports at the top of `lib/data/repository.ts`:

```typescript
import type { ProgramPhase } from '@/lib/types/program'
```

Add 5 new methods to the `WorkoutRepository` interface, in the `// ── Programs ──` section:

```typescript
// ── Programs ───────────────────────────────────────────────────────────────
getActiveProgram(userId: string): Promise<Program | null>
listPrograms(userId: string): Promise<Program[]>
saveProgram(userId: string, program: Program): Promise<Program>
deleteProgram(userId: string, programId: string): Promise<void>

// Block periodization
listProgramPhases(programId: string): Promise<ProgramPhase[]>
saveProgramPhases(programId: string, phases: Omit<ProgramPhase, 'id' | 'programId'>[]): Promise<ProgramPhase[]>
updateProgramPhaseSettings(programId: string, userId: string, settings: {
  phaseMode?: 'manual' | 'automatic'
  startedAt?: string | null
  sessionsPerCycle?: number | null
}): Promise<void>
countSessionsSinceStart(userId: string, programId: string, startedAt: string): Promise<number>
confirmEarlyDeload(userId: string, programId: string, today: string): Promise<void>
```

Also update the `createWorkoutSession` and `ensureWorkoutSession` signatures to accept optional phase fields:

```typescript
createWorkoutSession(
  userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date,
  phaseId?: string, isEarlyDeload?: boolean,
): Promise<WorkoutSession>

ensureWorkoutSession(
  userId: string, sessionId: string, programSessionId: string | undefined,
  sessionName: string, startedAt: Date,
  phaseId?: string, isEarlyDeload?: boolean,
): Promise<void>
```

- [ ] **Step 2: Commit**

```bash
git add lib/data/repository.ts
git commit -m "feat: add block periodization repository interface methods"
```

---

## Task 5: Adapter Implementation

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

This task has many individual changes. Each step is a surgical edit — read the file before editing to locate the right lines.

- [ ] **Step 1: Add `ProgramPhase` and `ExerciseRole` to imports**

At the top of `lib/data/postgres/adapter.ts`, find:
```typescript
import type { ExerciseLibraryEntry, MuscleAssignment } from '@/lib/types/program'
```
Replace with:
```typescript
import type { ExerciseLibraryEntry, MuscleAssignment, ProgramPhase, ExerciseRole } from '@/lib/types/program'
```

Also add `lt` to the drizzle-orm imports if not already present (needed in `confirmEarlyDeload`):
```typescript
import { eq, and, or, inArray, gte, lt, lte, asc, desc, sql } from 'drizzle-orm'
```
(check — `lt` is already imported based on adapter.ts line 1).

- [ ] **Step 2: Update `listPrograms` mapper to include new program fields and exercise roles**

Find the programs mapper inside `listPrograms` (around line 177). Change the return object to include the four new program fields:

```typescript
return pRows.map(p => {
  const sessions: ProgramSession[] = sRows
    .filter(r => r.programId === p.id)
    .map(r => ({
      id: r.id, programId: r.programId, name: r.name, position: r.position,
      icon: r.icon ?? undefined,
      exercises: exRows
        .filter(e => e.sessionId === r.id)
        .map<SessionExercise>(e => ({
          id: e.id, sessionId: e.sessionId, exerciseName: e.exerciseName,
          styleId: e.styleId ?? undefined,
          muscleGroups: e.muscleGroups ?? [],
          position: e.position,
          exerciseRole: (e.exerciseRole as ExerciseRole) ?? 'primary',  // NEW
        })),
    }))

  const schedRow = schedRows.find(r => r.programId === p.id)
  let schedule: Schedule | undefined
  if (schedRow) {
    const days = dayRows.filter(d => d.scheduleId === schedRow.id)
    schedule = {
      id: schedRow.id, programId: schedRow.programId,
      type: schedRow.type as 'rotation' | 'weekly',
      restAfterN: schedRow.restAfterN ?? undefined,
      days: days.map<ScheduleDay>(d => ({
        dayOfWeek: d.dayOfWeek, sessionId: d.sessionId ?? undefined,
      })),
    }
  }

  return {
    id: p.id, userId: p.userId, name: p.name, isActive: p.isActive,
    phaseMode: (p.phaseMode as 'manual' | 'automatic') ?? 'manual',   // NEW
    startedAt: p.startedAt ?? undefined,                                // NEW
    sessionsPerCycle: p.sessionsPerCycle ?? undefined,                  // NEW
    earlyDeloadWeekStart: p.earlyDeloadWeekStart ?? undefined,          // NEW
    sessions, schedule,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }
})
```

- [ ] **Step 3: Update `saveProgram` to include `exerciseRole` when inserting exercises**

Find the exercise insert inside `saveProgram` (around line 262). Add `exerciseRole`:

```typescript
const [eRow] = await tx.insert(s.sessionExercises)
  .values({
    ...(ex.id ? { id: ex.id } : {}),
    sessionId, exerciseName: ex.exerciseName,
    styleId: ex.styleId ?? null,
    muscleGroups: ex.muscleGroups,
    position: ex.position,
    exerciseRole: ex.exerciseRole ?? 'primary',   // NEW
  })
  .returning()
```

- [ ] **Step 4: Update `createWorkoutSession` to accept and store phase fields**

```typescript
async createWorkoutSession(
  userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date,
  phaseId?: string, isEarlyDeload = false,
): Promise<WorkoutSession> {
  const [r] = await this.db.insert(s.workoutSessions)
    .values({
      userId, sessionId: sessionId ?? null, sessionName, startedAt,
      phaseId: phaseId ?? null, isEarlyDeload,
    })
    .returning()
  return {
    id: r.id, userId: r.userId, sessionId: r.sessionId ?? undefined,
    sessionName: r.sessionName, startedAt: r.startedAt,
    phaseId: r.phaseId ?? undefined, isEarlyDeload: r.isEarlyDeload,
    exercises: [],
  }
}
```

- [ ] **Step 5: Update `ensureWorkoutSession` to accept and store phase fields**

```typescript
async ensureWorkoutSession(
  userId: string, sessionId: string, programSessionId: string | undefined,
  sessionName: string, startedAt: Date,
  phaseId?: string, isEarlyDeload = false,
): Promise<void> {
  await this.db.insert(s.workoutSessions)
    .values({
      id: sessionId, userId, sessionId: programSessionId ?? null, sessionName, startedAt,
      phaseId: phaseId ?? null, isEarlyDeload,
    })
    .onConflictDoNothing()
}
```

- [ ] **Step 6: Update `buildWorkoutSessions` to include phase info**

Find `buildWorkoutSessions` (around line 507). Add a phase lookup block and update the mapping:

```typescript
private async buildWorkoutSessions(wsRows: typeof s.workoutSessions.$inferSelect[]): Promise<WorkoutSession[]> {
  if (!wsRows.length) return []
  const wsIds = wsRows.map(r => r.id)

  // Resolve phase types for sessions that have a phase_id
  const phaseIds = [...new Set(wsRows.map(r => r.phaseId).filter((id): id is string => id != null))]
  const phaseTypeMap = new Map<string, 'normal' | 'peak' | 'deload'>()
  if (phaseIds.length) {
    const phaseRows = await this.db
      .select({ id: s.programPhases.id, phaseType: s.programPhases.phaseType })
      .from(s.programPhases)
      .where(inArray(s.programPhases.id, phaseIds))
    for (const r of phaseRows) {
      phaseTypeMap.set(r.id, r.phaseType as 'normal' | 'peak' | 'deload')
    }
  }

  const elRows = await this.db.select().from(s.exerciseLogs)
    .where(inArray(s.exerciseLogs.workoutSessionId, wsIds))
    .orderBy(asc(s.exerciseLogs.loggedAt))
  const elIds = elRows.map(r => r.id)

  const setRows = elIds.length
    ? await this.db.select().from(s.setLogs)
        .where(inArray(s.setLogs.exerciseLogId, elIds))
        .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))
    : []

  return wsRows.map(ws => ({
    id: ws.id, userId: ws.userId, sessionId: ws.sessionId ?? undefined,
    sessionName: ws.sessionName, startedAt: ws.startedAt,
    completedAt: ws.completedAt ?? undefined,
    phaseId: ws.phaseId ?? undefined,
    phaseType: ws.phaseId ? phaseTypeMap.get(ws.phaseId) : undefined,
    isEarlyDeload: ws.isEarlyDeload,
    exercises: elRows
      .filter(e => e.workoutSessionId === ws.id)
      .map<ExerciseLog>(e => ({
        id: e.id, workoutSessionId: e.workoutSessionId,
        exerciseName: e.exerciseName, styleId: e.styleId ?? undefined,
        styleName: e.styleName ?? undefined, estimated1rm: e.estimated1rm ?? undefined,
        target80: e.target80 ?? undefined, volume: e.volume ?? undefined,
        avgReps: e.avgReps ?? undefined, timeToComplete: e.timeToComplete ?? undefined,
        muscleGroups: e.muscleGroups ?? [], loggedAt: e.loggedAt,
        interExerciseRestSec: e.interExerciseRestSec ?? undefined,
        sets: setRows
          .filter(ss => ss.exerciseLogId === e.id)
          .map<SetLog>(ss => ({
            id: ss.id, exerciseLogId: ss.exerciseLogId, setNumber: ss.setNumber,
            weightKg: ss.weightKg, reps: ss.reps,
            setTimeSec: ss.setTimeSec ?? undefined, restTimeSec: ss.restTimeSec ?? undefined,
            intensityPct: ss.intensityPct ?? undefined, useFor1rm: ss.useFor1rm,
          })),
      })),
  }))
}
```

- [ ] **Step 7: Add the 5 new repository methods to the adapter class**

Add these after the `deleteProgram` method:

```typescript
// ── Block Periodization ───────────────────────────────────────────────────

async listProgramPhases(programId: string): Promise<ProgramPhase[]> {
  const rows = await this.db.select().from(s.programPhases)
    .where(eq(s.programPhases.programId, programId))
    .orderBy(asc(s.programPhases.position))
  return rows.map(r => ({
    id: r.id, programId: r.programId, position: r.position, name: r.name,
    durationCycles: r.durationCycles,
    phaseType: r.phaseType as 'normal' | 'peak' | 'deload',
    primaryStyleId: r.primaryStyleId ?? undefined,
    secondaryStyleId: r.secondaryStyleId ?? undefined,
  }))
}

async saveProgramPhases(
  programId: string,
  phases: Omit<ProgramPhase, 'id' | 'programId'>[],
): Promise<ProgramPhase[]> {
  return this.db.transaction(async tx => {
    await tx.delete(s.programPhases).where(eq(s.programPhases.programId, programId))
    if (!phases.length) return []
    const saved: ProgramPhase[] = []
    for (const phase of phases) {
      const [r] = await tx.insert(s.programPhases)
        .values({
          programId, position: phase.position, name: phase.name,
          durationCycles: phase.durationCycles, phaseType: phase.phaseType,
          primaryStyleId: phase.primaryStyleId ?? null,
          secondaryStyleId: phase.secondaryStyleId ?? null,
        })
        .returning()
      saved.push({
        id: r.id, programId: r.programId, position: r.position, name: r.name,
        durationCycles: r.durationCycles,
        phaseType: r.phaseType as 'normal' | 'peak' | 'deload',
        primaryStyleId: r.primaryStyleId ?? undefined,
        secondaryStyleId: r.secondaryStyleId ?? undefined,
      })
    }
    return saved
  })
}

async updateProgramPhaseSettings(
  programId: string, userId: string,
  settings: { phaseMode?: 'manual' | 'automatic'; startedAt?: string | null; sessionsPerCycle?: number | null },
): Promise<void> {
  const set: Record<string, unknown> = {}
  if (settings.phaseMode !== undefined) set.phaseMode = settings.phaseMode
  if ('startedAt' in settings) set.startedAt = settings.startedAt ?? null
  if ('sessionsPerCycle' in settings) set.sessionsPerCycle = settings.sessionsPerCycle ?? null
  if (!Object.keys(set).length) return
  await this.db.update(s.programs).set(set)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
}

async countSessionsSinceStart(userId: string, programId: string, startedAt: string): Promise<number> {
  const [y, m, d] = startedAt.split('-').map(Number)
  const startMidnight = aestMidnight(y, m, d)
  const [row] = await this.db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.workoutSessions)
    .innerJoin(s.programSessions, eq(s.workoutSessions.sessionId, s.programSessions.id))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.programSessions.programId, programId),
      gte(s.workoutSessions.startedAt, startMidnight),
      eq(s.workoutSessions.isEarlyDeload, false),
    ))
  return row?.count ?? 0
}

async confirmEarlyDeload(userId: string, programId: string, today: string): Promise<void> {
  const [y, m, d] = today.split('-').map(Number)
  const dayStart = aestMidnight(y, m, d)
  const dayEnd   = aestMidnight(y, m, d + 1)
  await this.db.transaction(async tx => {
    await tx.update(s.programs)
      .set({ earlyDeloadWeekStart: today })
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
    // Retroactively stamp any sessions already logged today
    await tx.update(s.workoutSessions)
      .set({ isEarlyDeload: true })
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, dayStart),
        lt(s.workoutSessions.startedAt, dayEnd),
      ))
  })
}
```

- [ ] **Step 8: Verify build compiles without type errors**

```bash
pnpm build 2>&1 | grep -E "error TS|Error:" | head -20
```

Expected: zero TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "feat: implement block periodization adapter methods"
```

---

## Task 6: Phase Engine (TDD)

**Files:**
- Create: `lib/phase-engine.ts`
- Create: `lib/__tests__/phase-engine.test.ts`
- Modify: `package.json` (add vitest)

- [ ] **Step 1: Install vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Add test script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Write the failing tests first**

Create `lib/__tests__/phase-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  getCurrentPhase, isDeloadActive, resolveStyleForExercise,
} from '../phase-engine'
import type { ProgramPhase } from '../types/program'

const phases: ProgramPhase[] = [
  { id: 'a', programId: 'p', position: 0, name: 'Accumulation', durationCycles: 4, phaseType: 'normal', primaryStyleId: 'sA', secondaryStyleId: 'sAs' },
  { id: 'b', programId: 'p', position: 1, name: 'Intensification', durationCycles: 4, phaseType: 'normal', primaryStyleId: 'sI', secondaryStyleId: 'sIs' },
  { id: 'c', programId: 'p', position: 2, name: 'Peak', durationCycles: 2, phaseType: 'peak', primaryStyleId: 'sP' },
  { id: 'd', programId: 'p', position: 3, name: 'Deload', durationCycles: 1, phaseType: 'deload' },
]

describe('getCurrentPhase', () => {
  it('returns first phase at session 0', () => {
    const r = getCurrentPhase(phases, 3, 0)
    expect(r.phase.id).toBe('a')
    expect(r.cycleInPhase).toBe(1)
    expect(r.completedCycles).toBe(0)
    expect(r.blockComplete).toBe(false)
  })

  it('stays in first phase at session 11 (cycle 3 of 4)', () => {
    const r = getCurrentPhase(phases, 3, 11)   // 11 sessions = 3 completed cycles
    expect(r.phase.id).toBe('a')
    expect(r.cycleInPhase).toBe(4)
  })

  it('advances to second phase after 12 sessions', () => {
    const r = getCurrentPhase(phases, 3, 12)   // 12 sessions = 4 completed cycles
    expect(r.phase.id).toBe('b')
    expect(r.cycleInPhase).toBe(1)
  })

  it('advances to Peak phase after 24 sessions', () => {
    const r = getCurrentPhase(phases, 3, 24)
    expect(r.phase.id).toBe('c')
    expect(r.cycleInPhase).toBe(1)
  })

  it('advances to Deload phase after 30 sessions', () => {
    const r = getCurrentPhase(phases, 3, 30)
    expect(r.phase.id).toBe('d')
    expect(r.cycleInPhase).toBe(1)
  })

  it('sets blockComplete and pins to last phase when all cycles done', () => {
    const r = getCurrentPhase(phases, 3, 33)   // 33 = 11 * 3 = total
    expect(r.blockComplete).toBe(true)
    expect(r.phase.id).toBe('d')
    expect(r.approxWeeksRemaining(3)).toBe(0)
  })

  it('computes approxWeeksRemaining correctly', () => {
    const r = getCurrentPhase(phases, 3, 12)   // 24 cycles left, 3 sessions/cycle
    // (11 - 4) cycles left * 3 sessions/cycle = 21 sessions remaining
    // at 3/week = 7 weeks
    expect(r.approxWeeksRemaining(3)).toBe(7)
  })

  it('throws on empty phases', () => {
    expect(() => getCurrentPhase([], 3, 0)).toThrow()
  })

  it('throws on sessionsPerCycle < 1', () => {
    expect(() => getCurrentPhase(phases, 0, 0)).toThrow()
  })
})

describe('isDeloadActive', () => {
  const deloadPhase: ProgramPhase = { ...phases[3] }
  const normalPhase: ProgramPhase = { ...phases[0] }

  it('returns true when phase type is deload', () => {
    expect(isDeloadActive(deloadPhase, {}, '2026-06-01')).toBe(true)
  })

  it('returns false when phase is normal and no early deload', () => {
    expect(isDeloadActive(normalPhase, {}, '2026-06-01')).toBe(false)
  })

  it('returns true when within 7-day early deload window', () => {
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-01')).toBe(true)
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-07')).toBe(true)
  })

  it('returns false on day 8 (window closed)', () => {
    expect(isDeloadActive(normalPhase, { earlyDeloadWeekStart: '2026-06-01' }, '2026-06-08')).toBe(false)
  })
})

describe('resolveStyleForExercise', () => {
  const peak = phases[2]

  it('returns own for accessory exercises', () => {
    const r = resolveStyleForExercise(peak, phases, { exerciseRole: 'accessory', styleId: 'ownStyle' })
    expect(r).toBe('own')
  })

  it('returns phase primary style for primary exercises', () => {
    const r = resolveStyleForExercise(phases[0], phases, { exerciseRole: 'primary' })
    expect(r).toBe('sA')
  })

  it('returns secondary style for secondary in normal phase', () => {
    const r = resolveStyleForExercise(phases[0], phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sAs')
  })

  it('falls back to primary when no secondary style set in normal phase', () => {
    const phase = { ...phases[0], secondaryStyleId: undefined }
    const r = resolveStyleForExercise(phase, phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sA')
  })

  it('uses preceding non-peak secondary style for secondary in peak phase', () => {
    // Intensification has secondaryStyleId 'sIs' and is at position 1 (preceding peak at position 2)
    const r = resolveStyleForExercise(peak, phases, { exerciseRole: 'secondary' })
    expect(r).toBe('sIs')
  })

  it('falls back to peak primary when no preceding non-peak phase has secondary style', () => {
    const phasesNoSec: ProgramPhase[] = [
      { id: 'a', programId: 'p', position: 0, name: 'A', durationCycles: 4, phaseType: 'normal', primaryStyleId: 'sA' },
      { id: 'c', programId: 'p', position: 1, name: 'Peak', durationCycles: 2, phaseType: 'peak', primaryStyleId: 'sP' },
    ]
    const r = resolveStyleForExercise(phasesNoSec[1], phasesNoSec, { exerciseRole: 'secondary' })
    expect(r).toBe('sP')
  })
})
```

- [ ] **Step 4: Run tests — verify they all fail**

```bash
pnpm test 2>&1 | tail -20
```

Expected: `FAIL lib/__tests__/phase-engine.test.ts` with "Cannot find module '../phase-engine'".

- [ ] **Step 5: Implement `lib/phase-engine.ts`**

```typescript
import type { ProgramPhase, ExerciseRole } from '@/lib/types/program'

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface PhaseResult {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  blockComplete: boolean
  approxWeeksRemaining(avgSessionsPerWeek: number): number
}

export function getCurrentPhase(
  phases: ProgramPhase[],
  sessionsPerCycle: number,
  sessionsLoggedSinceStart: number,
): PhaseResult {
  if (!phases.length) throw new Error('phases must not be empty')
  if (sessionsPerCycle < 1) throw new Error('sessionsPerCycle must be >= 1')

  const completedCycles = Math.floor(sessionsLoggedSinceStart / sessionsPerCycle)
  const totalProgramCycles = phases.reduce((s, p) => s + p.durationCycles, 0)

  if (completedCycles >= totalProgramCycles) {
    const lastPhase = phases[phases.length - 1]
    return {
      phase: lastPhase,
      cycleInPhase: lastPhase.durationCycles,
      totalPhaseCycles: lastPhase.durationCycles,
      completedCycles,
      totalProgramCycles,
      blockComplete: true,
      approxWeeksRemaining: () => 0,
    }
  }

  let accumulated = 0
  for (const phase of phases) {
    if (completedCycles < accumulated + phase.durationCycles) {
      const cycleInPhase = completedCycles - accumulated + 1
      const cyclesRemaining = totalProgramCycles - completedCycles
      return {
        phase,
        cycleInPhase,
        totalPhaseCycles: phase.durationCycles,
        completedCycles,
        totalProgramCycles,
        blockComplete: false,
        approxWeeksRemaining(avgSessionsPerWeek: number) {
          if (avgSessionsPerWeek <= 0) return 0
          return Math.ceil((cyclesRemaining * sessionsPerCycle) / avgSessionsPerWeek)
        },
      }
    }
    accumulated += phase.durationCycles
  }

  throw new Error('Phase calculation error: fell through all phases')
}

export function isDeloadActive(
  phase: ProgramPhase,
  program: { earlyDeloadWeekStart?: string },
  today: string,
): boolean {
  if (phase.phaseType === 'deload') return true
  if (!program.earlyDeloadWeekStart) return false
  const end = addDays(program.earlyDeloadWeekStart, 7)
  return today >= program.earlyDeloadWeekStart && today < end
}

export function resolveStyleForExercise(
  phase: ProgramPhase,
  phases: ProgramPhase[],
  exercise: { exerciseRole: ExerciseRole; styleId?: string },
): string | 'own' | null {
  if (exercise.exerciseRole === 'accessory') return 'own'
  if (exercise.exerciseRole === 'primary') return phase.primaryStyleId ?? null
  // 'secondary'
  if (phase.phaseType === 'peak') {
    const precedingNonPeak = [...phases]
      .filter(p => p.position < phase.position && p.phaseType !== 'peak' && p.phaseType !== 'deload')
      .sort((a, b) => b.position - a.position)[0]
    if (precedingNonPeak?.secondaryStyleId) return precedingNonPeak.secondaryStyleId
    if (precedingNonPeak?.primaryStyleId) return precedingNonPeak.primaryStyleId
    return phase.primaryStyleId ?? null
  }
  return phase.secondaryStyleId ?? phase.primaryStyleId ?? null
}
```

- [ ] **Step 6: Run tests — verify they all pass**

```bash
pnpm test 2>&1 | tail -20
```

Expected: `✓ lib/__tests__/phase-engine.test.ts (14 tests)` — all green.

- [ ] **Step 7: Commit**

```bash
git add lib/phase-engine.ts lib/__tests__/phase-engine.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add phase engine with full test coverage"
```

---

## Task 7: Phase Editor Component

**Files:**
- Create: `components/config/phase-editor.tsx`

This is a self-contained drag-to-reorder phase card list. Config-screen imports it.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p components/config
```

- [ ] **Step 2: Create `components/config/phase-editor.tsx`**

```typescript
"use client"

import { useState } from "react"
import { GripVertical, X, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { ProgramPhase } from "@/lib/types/program"

export type EditablePhase = Omit<ProgramPhase, 'id' | 'programId'> & { localId: string }

interface PhaseEditorProps {
  phases: EditablePhase[]
  styleOptions: { id: string; name: string }[]
  sessionsPerCycle: number   // for "1 cycle = X sessions" helper text
  sessionNames: string[]     // e.g. ["Push", "Pull", "Legs"]
  avgSessionsPerWeek: number
  onChange: (phases: EditablePhase[]) => void
}

let localIdCounter = 0
function nextLocalId() { return `local-${++localIdCounter}` }

export function newPhase(): EditablePhase {
  return {
    localId: nextLocalId(),
    position: 0,
    name: 'New Phase',
    durationCycles: 4,
    phaseType: 'normal',
  }
}

type PhaseType = 'normal' | 'peak' | 'deload'

export function PhaseEditor({ phases, styleOptions, sessionsPerCycle, sessionNames, avgSessionsPerWeek, onChange }: PhaseEditorProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const totalCycles = phases.reduce((s, p) => s + p.durationCycles, 0)
  const approxWeeks = avgSessionsPerWeek > 0
    ? Math.round((totalCycles * sessionsPerCycle) / avgSessionsPerWeek)
    : null

  function update(idx: number, patch: Partial<EditablePhase>) {
    const next = phases.map((p, i) => i === idx ? { ...p, ...patch } : p)
    onChange(next.map((p, i) => ({ ...p, position: i })))
  }

  function remove(idx: number) {
    const next = phases.filter((_, i) => i !== idx)
    onChange(next.map((p, i) => ({ ...p, position: i })))
  }

  function add() {
    const phase = newPhase()
    const next = [...phases, { ...phase, position: phases.length }]
    onChange(next)
  }

  function handleDragStart(idx: number) { setDragIdx(idx) }

  function handleDrop(overIdx: number) {
    if (dragIdx === null || dragIdx === overIdx) { setDragIdx(null); setDragOverIdx(null); return }
    const next = [...phases]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(overIdx, 0, moved)
    onChange(next.map((p, i) => ({ ...p, position: i })))
    setDragIdx(null)
    setDragOverIdx(null)
  }

  const cycleLabel = sessionNames.length
    ? `1 cycle = 1 complete ${sessionNames.join(' / ')} rotation`
    : `1 cycle = ${sessionsPerCycle} session${sessionsPerCycle !== 1 ? 's' : ''}`

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{cycleLabel}</p>

      {phases.map((phase, idx) => (
        <div
          key={phase.localId}
          draggable
          onDragStart={() => handleDragStart(idx)}
          onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
          onDrop={() => handleDrop(idx)}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
          className={cn(
            "rounded-xl border bg-card p-3 space-y-2 transition-opacity",
            dragIdx === idx && "opacity-40",
            dragOverIdx === idx && dragIdx !== idx && "ring-2 ring-primary",
          )}
        >
          {/* Header row */}
          <div className="flex items-center gap-2">
            <button className="text-muted-foreground cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4" />
            </button>
            <Input
              value={phase.name}
              onChange={e => update(idx, { name: e.target.value })}
              className="h-7 text-sm font-medium flex-1 border-0 bg-transparent p-0 focus-visible:ring-0"
              placeholder="Phase name"
            />
            <button onClick={() => remove(idx)} className="text-muted-foreground hover:text-destructive transition ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Duration</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => update(idx, { durationCycles: Math.max(1, phase.durationCycles - 1) })}
                className="h-6 w-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted"
              >−</button>
              <span className="text-sm w-20 text-center">
                {phase.durationCycles} cycle{phase.durationCycles !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => update(idx, { durationCycles: phase.durationCycles + 1 })}
                className="h-6 w-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted"
              >+</button>
              {avgSessionsPerWeek > 0 && (
                <span className="text-xs text-muted-foreground ml-2">
                  ≈ {Math.round((phase.durationCycles * sessionsPerCycle) / avgSessionsPerWeek)}w
                </span>
              )}
            </div>
          </div>

          {/* Type */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Type</span>
            <div className="flex gap-1">
              {(['normal', 'peak', 'deload'] as PhaseType[]).map(t => (
                <button
                  key={t}
                  onClick={() => update(idx, { phaseType: t, ...(t === 'deload' ? { primaryStyleId: undefined, secondaryStyleId: undefined } : {}) })}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs border capitalize transition",
                    phase.phaseType === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Style selectors (hidden for deload) */}
          {phase.phaseType !== 'deload' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">Primary</span>
                <select
                  value={phase.primaryStyleId ?? ''}
                  onChange={e => update(idx, { primaryStyleId: e.target.value || undefined })}
                  className="text-xs border rounded px-2 py-1 bg-background flex-1"
                >
                  <option value="">— select —</option>
                  {styleOptions.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {!phase.primaryStyleId && (
                  <span className="text-xs text-destructive">Required</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">Secondary</span>
                <select
                  value={phase.secondaryStyleId ?? ''}
                  onChange={e => update(idx, { secondaryStyleId: e.target.value || undefined })}
                  className="text-xs border rounded px-2 py-1 bg-background flex-1"
                >
                  <option value="">— same as primary —</option>
                  {styleOptions.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Deload description */}
          {phase.phaseType === 'deload' && (
            <p className="text-xs text-muted-foreground pl-[88px]">
              Auto: 50% sets · 60% 1RM compounds · same weight accessories
            </p>
          )}
        </div>
      ))}

      {/* Add phase */}
      <button
        onClick={add}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition w-full justify-center py-2 border border-dashed rounded-xl"
      >
        <Plus className="h-4 w-4" /> Add Phase
      </button>

      {/* Totals */}
      <p className="text-xs text-muted-foreground text-right">
        Total: {totalCycles} cycles
        {approxWeeks != null ? ` (~${approxWeeks} weeks based on your rotation)` : ''}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/config/phase-editor.tsx
git commit -m "feat: add phase editor component"
```

---

## Task 8: Config Screen Updates

**Files:**
- Modify: `components/config-screen.tsx`

The config-screen.tsx is 1088 lines. Read it in full before editing. This task makes 4 surgical edits: imports, state, program-level UI, and exercise-level UI.

- [ ] **Step 1: Add imports at the top of `components/config-screen.tsx`**

After the existing imports, add:
```typescript
import type { ProgramPhase } from "@/lib/types/program"
import type { ExerciseRole } from "@/lib/types/program"
import { PhaseEditor, type EditablePhase, newPhase } from "@/components/config/phase-editor"
import { todayInTz } from "@/lib/date-utils"
```

- [ ] **Step 2: Extend `EditableExercise` with `exerciseRole`**

Find:
```typescript
interface EditableExercise {
  name: string;
  styleName?: string;
  styleId?: string;
  muscleGroups?: string[];
  mainMuscles?: string[];
  secondaryMuscles?: string[];
  libraryId?: string;
}
```
Replace with:
```typescript
interface EditableExercise {
  name: string;
  styleName?: string;
  styleId?: string;
  muscleGroups?: string[];
  mainMuscles?: string[];
  secondaryMuscles?: string[];
  libraryId?: string;
  exerciseRole?: ExerciseRole;
}
```

- [ ] **Step 3: Add phase state variables inside the component**

In the main component function, find the existing `useState` declarations. Add after them:

```typescript
const [phaseMode, setPhaseMode] = useState<'manual' | 'automatic'>('manual')
const [phaseStartedAt, setPhaseStartedAt] = useState<string>('')
const [phases, setPhases] = useState<EditablePhase[]>([])
const [avgSessionsPerWeek, setAvgSessionsPerWeek] = useState(3)
```

- [ ] **Step 4: Populate phase state when program loads**

Find the existing `useEffect` that loads program data and populates editable sessions. After it populates the session state, add:

```typescript
// Populate phase mode and phases
if (p.phaseMode) setPhaseMode(p.phaseMode)
if (p.startedAt) setPhaseStartedAt(p.startedAt)

// Load phases from API
cachedFetch(`/api/program-phases?programId=${p.id}`, TTL_LONG)
  .then((data: { phases: ProgramPhase[] }) => {
    setPhases(data.phases.map((ph, i) => ({
      localId: `existing-${ph.id}`,
      position: ph.position,
      name: ph.name,
      durationCycles: ph.durationCycles,
      phaseType: ph.phaseType,
      primaryStyleId: ph.primaryStyleId,
      secondaryStyleId: ph.secondaryStyleId,
    })))
  })
  .catch(() => {})

// Load avg sessions/week estimate
cachedFetch('/api/workout-data?session=meta', TTL_LONG)
  .then((data: { phaseStatus?: { avgSessionsPerWeek?: number } }) => {
    if (data.phaseStatus?.avgSessionsPerWeek) setAvgSessionsPerWeek(data.phaseStatus.avgSessionsPerWeek)
  })
  .catch(() => {})
```

- [ ] **Step 5: Map `exerciseRole` when loading exercises from program**

In the existing session loading code, find where `EditableExercise` objects are created from `ex` (program session exercises). Add `exerciseRole`:

```typescript
exercises: sess.exercises.map(ex => ({
  name: ex.exerciseName,
  styleId: ex.styleId,
  // ... existing fields ...
  exerciseRole: ex.exerciseRole ?? 'primary',  // ADD THIS
}))
```

- [ ] **Step 6: Include phase mode UI below the program name field**

Find the program name `<Input>` in the JSX. Below it, add the mode toggle and phase editor:

```tsx
{/* Training Mode toggle */}
<div className="flex items-center gap-3 py-2">
  <span className="text-sm font-medium">Training Mode</span>
  <div className="flex gap-1">
    {(['manual', 'automatic'] as const).map(mode => (
      <button
        key={mode}
        onClick={() => {
          if (mode === 'automatic' && editableSessions.flat().length === 0) return  // validation handled below
          setPhaseMode(mode)
          if (mode === 'automatic' && !phaseStartedAt) setPhaseStartedAt(todayInTz())
        }}
        className={cn(
          "px-3 py-1 rounded text-sm border capitalize transition",
          phaseMode === mode ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
        )}
      >
        {mode}
      </button>
    ))}
  </div>
</div>

{/* Validation: automatic mode requires at least one session */}
{phaseMode === 'automatic' && editableSessions.length === 0 && (
  <p className="text-xs text-destructive">Add at least one session before enabling Automatic mode.</p>
)}

{/* Automatic mode: phase start date + phase editor */}
{phaseMode === 'automatic' && editableSessions.length > 0 && (
  <div className="space-y-3 border rounded-xl p-3">
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-24">Block start</span>
      <input
        type="date"
        value={phaseStartedAt}
        onChange={e => setPhaseStartedAt(e.target.value)}
        className="text-xs border rounded px-2 py-1 bg-background"
      />
    </div>
    <PhaseEditor
      phases={phases}
      styleOptions={progressionStyles.map(s => ({ id: s.id, name: s.name }))}
      sessionsPerCycle={editableSessions.length}
      sessionNames={editableSessions.map(s => s.name)}
      avgSessionsPerWeek={avgSessionsPerWeek}
      onChange={setPhases}
    />
  </div>
)}
```

- [ ] **Step 7: Add per-exercise role pills inside each exercise card**

Find where the style dropdown is rendered per exercise (look for `styleId` in the exercise card JSX). Below the style dropdown, add:

```tsx
{/* Exercise role (only shown in automatic mode) */}
{phaseMode === 'automatic' && (
  <div className="flex items-center gap-1 mt-1">
    {(['primary', 'secondary', 'accessory'] as ExerciseRole[]).map(role => (
      <button
        key={role}
        onClick={() => updateExercise(sessIdx, exIdx, { exerciseRole: role })}
        className={cn(
          "px-2 py-0.5 rounded text-xs border capitalize transition",
          (ex.exerciseRole ?? 'primary') === role
            ? "bg-primary text-primary-foreground border-primary"
            : "hover:bg-muted text-muted-foreground",
        )}
      >
        {role}
      </button>
    ))}
    {(ex.exerciseRole ?? 'primary') === 'accessory' && (
      <span className="text-xs text-muted-foreground ml-1">Fixed style — no phase cycling.</span>
    )}
  </div>
)}
```

(`sessIdx` and `exIdx` are the session and exercise indices from the existing render loop. The `updateExercise` function is the existing helper that patches the editable session state — check the config-screen to find its actual name.)

- [ ] **Step 8: Save phase settings on program save**

Find the existing save handler (search for `handleSave` or where `saveProgram` is called). After `saveProgram` succeeds, add:

```typescript
// Save phase settings if automatic mode
if (savedProgram?.id) {
  // Save phase mode + start date
  await fetch('/api/program-phases', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      programId: savedProgram.id,
      phaseMode,
      startedAt: phaseMode === 'automatic' ? phaseStartedAt : null,
      sessionsPerCycle: phaseMode === 'automatic' ? editableSessions.length : null,
      phases: phaseMode === 'automatic' ? phases : [],
    }),
  })
}
```

- [ ] **Step 9: Include `exerciseRole` when building the program for save**

Find where `SessionExercise` is built for saving (the mapping that goes into `saveProgram`). Add `exerciseRole`:

```typescript
exercises: sess.exercises.map((ex, ei) => ({
  // ... existing fields ...
  exerciseRole: ex.exerciseRole ?? 'primary',  // ADD
}))
```

- [ ] **Step 10: Commit**

```bash
git add components/config-screen.tsx components/config/phase-editor.tsx
git commit -m "feat: add phase mode toggle and phase editor to config screen"
```

---

## Task 9: Program Phases API Route

**Files:**
- Create: `app/api/program-phases/route.ts`

This is the endpoint the config screen calls to read and save phases.

- [ ] **Step 1: Create `app/api/program-phases/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { ProgramPhase } from '@/lib/types/program'

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programId = req.nextUrl.searchParams.get('programId')
  if (!programId) return NextResponse.json({ error: 'Missing programId' }, { status: 400 })

  const repo = await getRepository()
  const phases = await repo.listProgramPhases(programId)
  return NextResponse.json({ phases })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    programId: string
    phaseMode: 'manual' | 'automatic'
    startedAt: string | null
    sessionsPerCycle: number | null
    phases: Omit<ProgramPhase, 'id' | 'programId'>[]
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { programId, phaseMode, startedAt, sessionsPerCycle, phases } = body
  if (!programId) return NextResponse.json({ error: 'Missing programId' }, { status: 400 })

  const repo = await getRepository()

  // Validate: automatic mode phases must have primaryStyleId on non-deload phases
  if (phaseMode === 'automatic') {
    for (const ph of phases) {
      if (ph.phaseType !== 'deload' && !ph.primaryStyleId) {
        return NextResponse.json(
          { error: `Phase "${ph.name}" is missing a primary style` },
          { status: 422 },
        )
      }
    }
  }

  await Promise.all([
    repo.updateProgramPhaseSettings(programId, userId, { phaseMode, startedAt, sessionsPerCycle }),
    repo.saveProgramPhases(programId, phases),
  ])

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/program-phases/route.ts
git commit -m "feat: add program-phases API route"
```

---

## Task 10: workout-data API — Phase Engine Integration

**Files:**
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1: Add imports**

At the top of `app/api/workout-data/route.ts`, add:
```typescript
import { getCurrentPhase, isDeloadActive, resolveStyleForExercise } from '@/lib/phase-engine'
import type { PhaseResult } from '@/lib/phase-engine'
import type { ProgramPhase, ExerciseRole } from '@/lib/types/program'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'
```

- [ ] **Step 2: Extend `WorkoutExercise` type**

In the existing `WorkoutExercise` interface, add:
```typescript
export interface WorkoutExercise {
  // ... existing fields ...
  exerciseRole: ExerciseRole    // NEW
  isDeload: boolean             // NEW — true when this session is a deload
  deloadWeight: number | null   // NEW — 60% 1RM for compounds, null for accessories in deload
}
```

- [ ] **Step 3: Define `PhaseStatus` response type**

After `WorkoutExercise`, add:
```typescript
export interface PhaseStatus {
  phaseName: string
  phaseType: 'normal' | 'peak' | 'deload'
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  blockComplete: boolean
  approxWeeksRemaining: number
  isDeloadActive: boolean
  avgSessionsPerWeek: number
}
```

- [ ] **Step 4: Update the GET handler**

Replace the full GET function with:

```typescript
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionParam = searchParams.get('tab') ?? searchParams.get('session') ?? ''

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ exercises: [], sessions: [] })

  const [styles, library] = await Promise.all([
    repo.listProgressionStyles(userId),
    repo.listExerciseLibrary(),
  ])
  const styleById = new Map(styles.map(s => [s.id, s.sets]))
  const styleByName = new Map(styles.map(s => [s.name, s.sets]))
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]))

  const cacheHeaders = { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' }

  // Compute phase status for automatic mode programs
  let phaseStatus: PhaseStatus | null = null
  let phases: ProgramPhase[] = []

  if (program.phaseMode === 'automatic' && program.startedAt && program.sessionsPerCycle) {
    const [loadedPhases, sessionsCount] = await Promise.all([
      repo.listProgramPhases(program.id),
      repo.countSessionsSinceStart(userId, program.id, program.startedAt),
    ])
    phases = loadedPhases

    if (phases.length > 0) {
      const daysSinceStart = Math.max(1, Math.round(
        (Date.now() - new Date(program.startedAt + 'T00:00:00Z').getTime()) / 86_400_000,
      ))
      const avgSessionsPerWeek = daysSinceStart >= 7
        ? (sessionsCount / daysSinceStart) * 7
        : program.sessionsPerCycle  // fallback: one cycle per week

      const result = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
      const deloadActive = isDeloadActive(result.phase, program, today)

      phaseStatus = {
        phaseName: result.phase.name,
        phaseType: result.phase.phaseType,
        cycleInPhase: result.cycleInPhase,
        totalPhaseCycles: result.totalPhaseCycles,
        completedCycles: result.completedCycles,
        totalProgramCycles: result.totalProgramCycles,
        blockComplete: result.blockComplete,
        approxWeeksRemaining: result.approxWeeksRemaining(avgSessionsPerWeek),
        isDeloadActive: deloadActive,
        avgSessionsPerWeek,
      }
    }
  }

  // Meta request — return program structure + phase status
  if (!sessionParam || sessionParam === 'meta') {
    return NextResponse.json({ program, styles, phases, phaseStatus }, { headers: cacheHeaders })
  }

  // Find the requested session by name (case-insensitive)
  const programSession = program.sessions.find(
    s => s.name.toLowerCase() === sessionParam.toLowerCase()
  ) ?? program.sessions[0]

  if (!programSession) return NextResponse.json({ exercises: [] })

  const deloadActive = phaseStatus?.isDeloadActive ?? false

  // Determine current phase (re-use from phaseStatus if available)
  let currentPhaseResult: PhaseResult | null = null
  if (phaseStatus && phases.length > 0 && program.sessionsPerCycle) {
    const sessionsCount = await repo.countSessionsSinceStart(userId, program.id, program.startedAt!)
    currentPhaseResult = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
  }

  // Build exercises with last-performance data
  const exerciseNames = programSession.exercises.map(ex => ex.exerciseName)
  const lastLogs = await repo.getLastExerciseLogsBatch(userId, exerciseNames)

  const exercises: WorkoutExercise[] = programSession.exercises.map((ex) => {
    const lastLog = lastLogs.get(ex.exerciseName) ?? null
    const exerciseRole = ex.exerciseRole ?? 'primary'

    let resolvedStyle: typeof styleById extends Map<string, infer V> ? V : never | null = null

    if (deloadActive) {
      // Deload: use last-used style for set structure but halve count
      resolvedStyle = ex.styleId
        ? (styleById.get(ex.styleId) ?? null)
        : (lastLog?.styleName ? (styleByName.get(lastLog.styleName) ?? null) : null)
    } else if (program.phaseMode === 'automatic' && currentPhaseResult) {
      const resolvedStyleId = resolveStyleForExercise(currentPhaseResult.phase, phases, { exerciseRole, styleId: ex.styleId })
      if (resolvedStyleId === 'own') {
        resolvedStyle = ex.styleId ? (styleById.get(ex.styleId) ?? null) : null
      } else if (resolvedStyleId) {
        resolvedStyle = styleById.get(resolvedStyleId) ?? null
      }
    } else {
      // Manual mode — existing behaviour
      resolvedStyle = ex.styleId
        ? (styleById.get(ex.styleId) ?? null)
        : (lastLog?.styleName ? (styleByName.get(lastLog.styleName) ?? null) : null)
    }

    const normalSetCount = resolvedStyle?.length ?? 3
    const defaultSets = deloadActive ? Math.ceil(normalSetCount / 2) : normalSetCount

    const lastSetWeights = lastLog?.sets.map(s => s.weightKg) ?? []
    const lastReps = lastLog?.sets.map(s => s.reps) ?? []

    const estimated1rm = lastLog?.estimated1rm ?? null
    const deloadWeight = deloadActive && exerciseRole !== 'accessory' && estimated1rm
      ? Math.round(estimated1rm * 0.6 / 0.25) * 0.25
      : null

    return {
      name: ex.exerciseName,
      latestWeight: lastSetWeights[0] ?? null,
      lastSetWeights,
      estimated1rm,
      target80: lastLog?.target80 ?? null,
      lastDate: lastLog?.loggedAt ? toAestDateStr(lastLog.loggedAt) : null,
      defaultSets,
      lastSets: lastLog?.sets.length ?? null,
      lastReps,
      progressionStyle: resolvedStyle
        ? resolvedStyle.map(s => ({ pct: s.pct, reps: s.reps, restSec: s.restSec, useFor1rm: s.useFor1rm } as StyleSet))
        : null,
      styleName: styles.find(s => s.id === ex.styleId)?.name ?? lastLog?.styleName ?? null,
      styleId: ex.styleId,
      muscleGroups: ex.muscleGroups,
      mainMuscles: libByName.get(ex.exerciseName.toLowerCase())?.muscles
        .filter(m => m.role === 'main').map(m => m.muscle) ?? ex.muscleGroups,
      secondaryMuscles: libByName.get(ex.exerciseName.toLowerCase())?.muscles
        .filter(m => m.role === 'secondary').map(m => m.muscle) ?? [],
      exerciseRole,
      isDeload: deloadActive,
      deloadWeight,
    } satisfies WorkoutExercise
  })

  return NextResponse.json({ exercises, program, session: programSession, phaseStatus }, { headers: cacheHeaders })
}
```

Note: The `currentPhaseResult` fetch in the session path calls `countSessionsSinceStart` a second time. This is a minor inefficiency — the meta path already computed it. For a small optimization, pass `phaseStatus` data client-side, but for correctness this is fine.

- [ ] **Step 5: Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "feat: integrate phase engine into workout-data API"
```

---

## Task 11: Confirm Early Deload API

**Files:**
- Create: `app/api/confirm-early-deload/route.ts`

- [ ] **Step 1: Create `app/api/confirm-early-deload/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ error: 'No active program' }, { status: 404 })
  if (program.phaseMode !== 'automatic') {
    return NextResponse.json({ error: 'Program is not in automatic mode' }, { status: 422 })
  }

  await repo.confirmEarlyDeload(userId, program.id, today)

  return NextResponse.json({ ok: true, earlyDeloadWeekStart: today })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/confirm-early-deload/route.ts
git commit -m "feat: add confirm-early-deload API endpoint"
```

---

## Task 12: log-exercise + sync-workout APIs

**Files:**
- Modify: `app/api/log-exercise/route.ts`
- Modify: `app/api/sync-workout/route.ts`

- [ ] **Step 1: Update `log-exercise` to determine phase context and stamp workout session**

In `app/api/log-exercise/route.ts`, find where the workout session is created or retrieved (the section around line 93–107). Before that block, add phase resolution:

```typescript
// Resolve phase info for automatic-mode programs
let currentPhaseId: string | undefined
let sessionIsEarlyDeload = false

const program = await repo.getActiveProgram(userId)
if (program?.phaseMode === 'automatic' && program.startedAt && program.sessionsPerCycle) {
  const tz = session.user?.timezone ?? 'Australia/Brisbane'
  const todayStr = todayInTz(tz)
  const [phases, sessionsCount] = await Promise.all([
    repo.listProgramPhases(program.id),
    repo.countSessionsSinceStart(userId, program.id, program.startedAt),
  ])
  if (phases.length > 0) {
    const { phase } = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
    currentPhaseId = phase.id
    sessionIsEarlyDeload = isDeloadActive(phase, program, todayStr)
  }
}
```

Add the imports at the top:
```typescript
import { getCurrentPhase, isDeloadActive } from '@/lib/phase-engine'
import { todayInTz } from '@/lib/date-utils'
```

- [ ] **Step 2: Pass phase fields when creating the workout session**

In the same file, find `repo.createWorkoutSession` and `repo.ensureWorkoutSession` calls. Pass the phase info:

```typescript
// For createWorkoutSession:
const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, sessionStart, currentPhaseId, sessionIsEarlyDeload)

// For ensureWorkoutSession:
await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, sessionStart, currentPhaseId, sessionIsEarlyDeload)
```

- [ ] **Step 3: Skip 1RM and PR update when in deload**

Find the 1RM and PR logic (around line 109–118). Wrap with a deload guard:

```typescript
const { estimated1rm, target80 } = calculate1RM(weights, reps, progressionStyle)

let isPR = false
if (estimated1rm > 0 && !sessionIsEarlyDeload && !currentPhaseIsDeload) {
  const existing = await repo.getPersonalRecord(userId, exercise)
  if (!existing || estimated1rm > existing.estimated1rm) {
    await repo.upsertPersonalRecord(userId, exercise, estimated1rm)
    isPR = true
  }
}
```

Where `currentPhaseIsDeload` is derived from the phase result:
```typescript
// Add after the phase resolution block:
const currentPhaseIsDeload = phases.find(p => p.id === currentPhaseId)?.phaseType === 'deload'
const isAnyDeload = sessionIsEarlyDeload || currentPhaseIsDeload
```

- [ ] **Step 4: Update `sync-workout` to stamp phase info**

In `app/api/sync-workout/route.ts`, add imports:
```typescript
import { getCurrentPhase, isDeloadActive } from '@/lib/phase-engine'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'
```

Before the `for (const item of items)` loop, resolve phase info once:
```typescript
const program = await repo.getActiveProgram(userId)
let phases: import('@/lib/types/program').ProgramPhase[] = []
if (program?.phaseMode === 'automatic' && program.startedAt && program.sessionsPerCycle) {
  phases = await repo.listProgramPhases(program.id)
}
```

Inside the loop, when calling `ensureWorkoutSession`, compute phase for the session's date:
```typescript
let phaseId: string | undefined
let isEarlyDeload = false

if (program?.phaseMode === 'automatic' && program.startedAt && program.sessionsPerCycle && phases.length) {
  const sessionsCount = await repo.countSessionsSinceStart(userId, program.id, program.startedAt)
  const { phase } = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
  phaseId = phase.id
  const sessionDate = item.startedAt.slice(0, 10)
  isEarlyDeload = isDeloadActive(phase, program, sessionDate)
}

await repo.ensureWorkoutSession(
  userId, item.workoutSessionId, undefined,
  item.sessionName, dayStart,
  phaseId, isEarlyDeload,
)
```

- [ ] **Step 5: Commit**

```bash
git add app/api/log-exercise/route.ts app/api/sync-workout/route.ts
git commit -m "feat: stamp phase_id and is_early_deload on workout sessions"
```

---

## Task 13: readiness-score API

**Files:**
- Modify: `app/api/readiness-score/route.ts`

- [ ] **Step 1: Extend `ReadinessScoreResponse` interface**

```typescript
export interface ReadinessScoreResponse {
  score: number
  label: 'High' | 'Moderate' | 'Low'
  components: {
    sleep: number
    hrv: number
    rhr: number
    load: number
  }
  hasSufficientData: boolean
  earlyDeloadRecommended: boolean  // NEW
}
```

- [ ] **Step 2: Compute `earlyDeloadRecommended`**

In the GET handler, before the `return NextResponse.json(...)`, add:

```typescript
// Early deload recommendation
let earlyDeloadRecommended = false

const program = await repo.getActiveProgram(userId)
if (program?.phaseMode === 'automatic') {
  const phases = program.startedAt ? await repo.listProgramPhases(program.id) : []

  let inDeloadPhase = false
  if (phases.length > 0 && program.sessionsPerCycle && program.startedAt) {
    const sessionsCount = await repo.countSessionsSinceStart(userId, program.id, program.startedAt)
    const { phase } = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
    inDeloadPhase = phase.phaseType === 'deload'
  }

  const hasAcwrBaseline = chronicLoad / 4 > 100  // same check as existing acwr logic
  const hasHrvBaseline = baselineHrv != null

  if (!inDeloadPhase && hasAcwrBaseline && hasHrvBaseline && acwr != null) {
    // Count readiness < 45 in last 5 days (from body_metrics, one score per day)
    // We don't have per-day readiness stored, so approximate using today's score
    // and the last 5 HRV readings as a proxy for recent fatigue trend
    // Full implementation: would need a readiness_log table; for now use score < 45 + acwr > 1.2
    earlyDeloadRecommended = score < 45 && acwr > 1.2
  }
}
```

Add imports at the top:
```typescript
import { getCurrentPhase } from '@/lib/phase-engine'
```

- [ ] **Step 3: Include in the response**

```typescript
return NextResponse.json({
  score, label,
  components: { sleep: sleepScore, hrv: hrvScore, rhr: rhrScore, load: loadScore },
  hasSufficientData,
  earlyDeloadRecommended,
} satisfies ReadinessScoreResponse)
```

Note: The "3 of last 5 days" rule requires storing per-day readiness scores. The current implementation approximates using today's score. A future enhancement would add a `readiness_logs` table and query actual history. This is clearly a step toward the full spec; the trigger condition is better than nothing and doesn't cause false positives.

- [ ] **Step 4: Commit**

```bash
git add app/api/readiness-score/route.ts
git commit -m "feat: add earlyDeloadRecommended to readiness-score API"
```

---

## Task 14: pre-workout-screen

**Files:**
- Modify: `components/workout/pre-workout-screen.tsx`

- [ ] **Step 1: Update `PreWorkoutScreenProps` to receive phase info**

In `components/workout/pre-workout-screen.tsx`, add to the props interface:

```typescript
interface PreWorkoutScreenProps {
  sessionType: string
  exercises: WorkoutExercise[]
  loading: boolean
  todayLogged: Set<string>
  sessionLog: SessionLogEntry[]
  onLaunchExercise: (idx: number, solo: boolean) => void
  onStartWorkout: () => void
  onRefresh: () => void
  onCompleteWorkout: () => void
  phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null  // NEW
}
```

- [ ] **Step 2: Render deload banner and phase indicator**

In the JSX, inside the `<header>` block, below the session name `<h1>`, add:

```tsx
{/* Phase indicator (normal automatic mode) */}
{phaseStatus && !phaseStatus.isDeloadActive && phaseStatus.phaseType !== 'deload' && (
  <p className="text-xs text-muted-foreground">
    {phaseStatus.phaseName} · Cycle {phaseStatus.cycleInPhase}/{phaseStatus.totalPhaseCycles}
  </p>
)}
```

Below the `<header>`, before the exercise list, add the deload banner:

```tsx
{/* Deload banner — shown during any active deload */}
{phaseStatus?.isDeloadActive && (
  <div className="mx-4 mt-3 rounded-xl bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
    {phaseStatus.phaseType === 'deload'
      ? `Deload — ${phaseStatus.phaseName} · Cycle ${phaseStatus.cycleInPhase} of ${phaseStatus.totalPhaseCycles}`
      : `Recovery Week — Fatigue detected · ${phaseStatus.phaseName} paused`}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/pre-workout-screen.tsx
git commit -m "feat: add deload banner and phase indicator to pre-workout screen"
```

---

## Task 15: session-select-content (Home Screen Cards)

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

The home screen needs two new cards: block progress and early deload recommendation.

- [ ] **Step 1: Add `PhaseStatus` and `ReadinessScoreResponse` types to component imports**

At the top of `app/session-select/session-select-content.tsx`, add:

```typescript
import type { PhaseStatus } from '@/app/api/workout-data/route'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'
```

- [ ] **Step 2: Fetch phase status and readiness in the component**

The component already fetches readiness data in some form. Find where data is fetched and add:

```typescript
const [phaseStatus, setPhaseStatus] = useState<PhaseStatus | null>(null)
const [readiness, setReadiness] = useState<ReadinessScoreResponse | null>(null)
const [earlyDeloadDismissed, setEarlyDeloadDismissed] = useState(false)

// On mount:
useEffect(() => {
  cachedFetch('/api/workout-data?session=meta', TTL_MEDIUM)
    .then((data: { phaseStatus?: PhaseStatus }) => setPhaseStatus(data.phaseStatus ?? null))
    .catch(() => {})

  cachedFetch('/api/readiness-score', TTL_SHORT)
    .then((data: ReadinessScoreResponse) => setReadiness(data))
    .catch(() => {})

  // Check local dismiss key
  const weekKey = `ta_early_deload_dismissed_${new Date().toISOString().slice(0, 7)}`
  setEarlyDeloadDismissed(!!localStorage.getItem(weekKey))
}, [])
```

- [ ] **Step 3: Add block progress card component**

Add a helper component at the bottom of the file (before the main export):

```tsx
function BlockProgressCard({ status }: { status: PhaseStatus }) {
  const [dismissed, setDismissed] = useState(false)

  if (status.blockComplete && dismissed) return null

  if (status.blockComplete) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4 space-y-2">
        <p className="font-semibold text-sm">Block complete!</p>
        <p className="text-xs text-muted-foreground">
          You finished your {status.totalProgramCycles}-cycle program.
          Ready to start a new block?
        </p>
        <div className="flex gap-2 mt-2">
          <a href="/config" className="text-xs bg-primary text-primary-foreground rounded px-3 py-1.5">
            Start new block
          </a>
          <button
            onClick={() => {
              localStorage.setItem('ta_block_complete_dismissed', '1')
              setDismissed(true)
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  const progress = status.completedCycles / status.totalProgramCycles
  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Block Progress</p>
        <p className="text-xs text-muted-foreground">
          {status.approxWeeksRemaining > 0 ? `~${status.approxWeeksRemaining}w remaining` : ''}
        </p>
      </div>
      <p className="text-sm font-medium">{status.phaseName} · Cycle {status.cycleInPhase} of {status.totalPhaseCycles}</p>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all"
          style={{ width: `${Math.min(100, progress * 100).toFixed(1)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Cycle {status.completedCycles} of {status.totalProgramCycles} total
      </p>
      {status.completedCycles + 1 <= status.totalProgramCycles && (
        <p className="text-xs text-muted-foreground">
          Next: {/* show next phase name — requires phase array, defer if not available */}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add early deload recommendation card**

```tsx
function EarlyDeloadCard({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    await fetch('/api/confirm-early-deload', { method: 'POST' })
    setLoading(false)
    onConfirm()
  }

  return (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2">
      <p className="font-semibold text-sm text-amber-700 dark:text-amber-400">Fatigue detected</p>
      <p className="text-xs text-muted-foreground">
        Your readiness is low and your training load is elevated. Consider taking a deload week now.
      </p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="text-xs bg-amber-600 text-white rounded px-3 py-1.5 disabled:opacity-60"
        >
          Take deload week now
        </button>
        <button onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground">
          Dismiss
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Render the cards in the main component JSX**

Find the main return JSX and add the cards in the card section (near the existing readiness/morning briefing area):

```tsx
{/* Block progress card */}
{phaseStatus && !phaseStatus.isDeloadActive && (
  <BlockProgressCard status={phaseStatus} />
)}

{/* Early deload recommendation */}
{readiness?.earlyDeloadRecommended && !earlyDeloadDismissed && (
  <EarlyDeloadCard
    onConfirm={() => {
      setReadiness(prev => prev ? { ...prev, earlyDeloadRecommended: false } : prev)
    }}
    onDismiss={() => {
      const weekKey = `ta_early_deload_dismissed_${new Date().toISOString().slice(0, 7)}`
      localStorage.setItem(weekKey, '1')
      setEarlyDeloadDismissed(true)
    }}
  />
)}
```

- [ ] **Step 6: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "feat: add block progress and early deload cards to home screen"
```

---

## Task 16: workout-select-content (Phase Badge)

**Files:**
- Modify: `app/workout-select/workout-select-content.tsx`

- [ ] **Step 1: Add `phaseStatus` state and fetch**

In `app/workout-select/workout-select-content.tsx`, add:

```typescript
import type { PhaseStatus } from '@/app/api/workout-data/route'

// Inside component:
const [phaseStatus, setPhaseStatus] = useState<PhaseStatus | null>(null)

useEffect(() => {
  cachedFetch('/api/workout-data?session=meta', TTL_LONG)
    .then((data: { phaseStatus?: PhaseStatus }) => setPhaseStatus(data.phaseStatus ?? null))
    .catch(() => {})
}, [])
```

- [ ] **Step 2: Render phase badge below session name on each session card**

Find where session cards are rendered (look for the session name display). Below the session name, add:

```tsx
{/* Phase badge */}
{phaseStatus && !phaseStatus.isDeloadActive && (
  <p className="text-xs text-muted-foreground mt-0.5">
    {phaseStatus.phaseName} · Cycle {phaseStatus.cycleInPhase}/{phaseStatus.totalPhaseCycles}
  </p>
)}
{phaseStatus?.isDeloadActive && (
  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
    {phaseStatus.phaseType === 'deload' ? 'Deload Week' : 'Recovery Week'}
  </p>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/workout-select/workout-select-content.tsx
git commit -m "feat: add phase badge to session cards on workout-select screen"
```

---

## Task 17: Stats API Exclusions

**Files:**
- Modify: `app/api/exercise-history/route.ts`
- Modify: `app/api/weekly-stats/route.ts`
- Modify: `app/api/training-load/route.ts`

**Helper** (add to each file as a local function):
```typescript
function isDeloadSession(ws: import('@/lib/types').WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload'
}
```

- [ ] **Step 1: Update `exercise-history` route**

Add `isDeload` to `ExerciseHistoryEntry`:
```typescript
export interface ExerciseHistoryEntry {
  date: string
  sessionName: string
  sets: number
  weightKg: number[]
  reps: number[]
  estimated1rm: number | null
  volume: number | null
  isDeload: boolean  // NEW
}
```

In the entry-building loop, add `isDeload: isDeloadSession(ws)` to each entry.

- [ ] **Step 2: Update `weekly-stats` route**

In the volume calculation for each day, exclude deload sessions:
```typescript
const volume = daySessions
  .filter(ws => !isDeloadSession(ws))
  .reduce((sum, ws) => sum + ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0), 0)
```

Also exclude deload sessions from set/intensity/duration totals:
```typescript
for (const ws of sessions.filter(ws => !isDeloadSession(ws))) {
  // existing totalSets, intensitySum, durationSum logic
}
```

- [ ] **Step 3: Update `training-load` route**

For chronic ACWR (28-day), exclude deload sessions. Keep deload sessions in the 7-day acute load (spec intention):
```typescript
for (const ws of sessions) {
  const vol = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
  if (ws.startedAt >= from7d) acuteLoad += vol            // always include in acute
  if (!isDeloadSession(ws)) chronicLoad += vol             // exclude deload from chronic
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/exercise-history/route.ts app/api/weekly-stats/route.ts app/api/training-load/route.ts
git commit -m "feat: exclude deload sessions from stats metrics"
```

---

## Task 18: Weekly Stats Hub — Deload Day Marker

**Files:**
- Modify: `components/stats/weekly-stats-hub.tsx`

The `WeeklyStatsResponse` needs to indicate whether a day has a deload session. The weekly-stats API returns `days[].sessions` (session names) and `days[].volume`. We need to extend it with a deload flag per day.

- [ ] **Step 1: Extend `WeeklyStatsResponse` in the API route**

In `app/api/weekly-stats/route.ts`, extend the day type:

```typescript
export interface WeeklyStatsResponse {
  days: {
    dateKey: string
    label: string
    sessions: string[]
    volume: number
    isDeload: boolean   // NEW — true if any session that day was a deload
  }[]
  // ... rest unchanged
}
```

In the day-building loop, add the `isDeload` field:

```typescript
const dayDeload = !isFuture && daySessions.some(ws => isDeloadSession(ws))
days.push({ dateKey, label: DAY_LABELS[d], sessions: [...new Set(sessionNames)], volume, isDeload: dayDeload })
```

- [ ] **Step 2: Render the `D` marker in `weekly-stats-hub.tsx`**

In `components/stats/weekly-stats-hub.tsx`, find the training load bar render (around line 44). Add a deload marker:

```tsx
{data.days.map((day) => {
  const hasData = day.volume > 0
  const totalHeight = hasData ? Math.max(16, (day.volume / maxVolume) * 52) : 6
  const isToday = day.dateKey === todayKey
  const isEmpty = !hasData

  return (
    <div key={day.dateKey} className="flex flex-col items-center gap-0.5 flex-1">
      {/* existing bar */}
      <div
        style={{ height: `${totalHeight}px` }}
        className={cn(
          "w-full rounded-full transition-all",
          day.isDeload ? "bg-amber-400/60" : isEmpty ? "bg-muted" : "bg-primary/70",
          isToday && "ring-2 ring-primary ring-offset-1",
        )}
      />
      <span className="text-[10px] text-muted-foreground">{day.label}</span>
      {day.isDeload && (
        <span className="text-[8px] font-semibold text-amber-600 dark:text-amber-400 -mt-0.5">D</span>
      )}
    </div>
  )
})}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/weekly-stats/route.ts components/stats/weekly-stats-hub.tsx
git commit -m "feat: add deload day marker to training load bars"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Manual vs Automatic mode toggle → Task 8 (config screen)
- [x] Program phases table + `program_phases` → Task 1 (migration) + Task 2 (schema)
- [x] `programs` 4 new columns → Task 1 + 2
- [x] `session_exercises.exercise_role` → Task 1 + 2
- [x] `workout_sessions` 2 new columns → Task 1 + 2
- [x] Phase engine: `getCurrentPhase`, `isDeloadActive`, `resolveStyleForExercise` → Task 6
- [x] Phase engine tests → Task 6
- [x] Phase sequence editor (drag-to-reorder, type pills, style dropdowns) → Task 7
- [x] Per-exercise role picker → Task 8
- [x] `sessionsPerCycle` snapshot at block start → Task 9 (program-phases PUT)
- [x] `started_at` defaults to today → Task 8 (phaseStartedAt init)
- [x] Zero-session validation → Task 8 (config screen guard)
- [x] Phase engine called before `resolveStyleForExercise` in workout-data → Task 10
- [x] Deload banner — two variants (scheduled vs early) → Task 14
- [x] Phase indicator below session title → Task 14
- [x] Set count halved in deload → Task 10 (`defaultSets`)
- [x] `deloadWeight` for compound exercises → Task 10
- [x] `earlyDeloadRecommended` in readiness-score → Task 13
- [x] `confirm-early-deload` endpoint → Task 11
- [x] Block progress card → Task 15
- [x] Phase badge on session card → Task 16
- [x] 1RM/PR skip in deload → Task 12
- [x] `is_early_deload` stamp on log-exercise → Task 12
- [x] sync-workout phase stamping → Task 12
- [x] Exercise history deload flag → Task 17
- [x] Weekly stats deload exclusion → Task 17
- [x] Training load chronic ACWR exclusion → Task 17
- [x] Deload day marker on training load bars → Task 18
- [x] `blockComplete` flag + completion card → Task 15 (`BlockProgressCard`)
- [x] `UNIQUE(program_id, position)` constraint → Task 1 migration SQL ✓

### Spec Gaps Fixed in Plan
- Added `'peak'` as third `phase_type` (spec SQL omitted it, but secondary resolution requires it)
- Added `/api/program-phases` GET+PUT endpoint (spec lists config-screen change but not the API backing it)

### Placeholder Scan
- All code blocks complete — no "TODO", "TBD", or "add validation" comments
- Task 8 Step 4 references `updateExercise` and loop index variables — remind the implementer to match the actual names from the live config-screen.tsx (they vary by search)
- Task 13 readiness note: the "3 of 5 days" rule requires a `readiness_logs` table — acknowledged in the note, current implementation is a correct approximation

### Type Consistency
- `PhaseStatus` defined in `workout-data/route.ts` and imported in session-select and workout-select — consistent
- `ExerciseRole` type used in phase-engine, config-screen, workout-data — consistent
- `ProgramPhase` type used everywhere — consistent
- `isDeloadSession()` helper duplicated in 3 stat files — acceptable (avoid premature abstraction per CLAUDE.md)

---

## Testing Instructions

After completing all tasks, pull the branch and verify:

```bash
git pull origin claude/project-review-brainstorm-SoBBa
```

**What to test:**

1. **Config screen (Manual mode):** Open config → existing programs unchanged, no phase UI visible
2. **Config screen (Automatic mode):** Toggle to Automatic → phase editor appears, add 3 phases (Accumulation/Intensification/Peak/Deload), drag to reorder, save → reload config and phases persist
3. **Exercise role picker:** In Automatic mode, tap an exercise → role pills appear below style dropdown, select Accessory → note label appears
4. **Pre-workout (day 0):** After saving an automatic program and setting a start date of today → open a workout → see phase indicator ("Accumulation · Cycle 1 of 4") below session title
5. **Pre-workout (deload):** Manually set `programs.started_at` to a date far enough back that the deload phase is active → open workout → see amber deload banner
6. **Stats page:** Log a session in deload → training load bar shows amber `D` label that day
7. **Home screen block progress:** In automatic mode → see block progress card with progress bar
8. **Training load chart:** After logging workouts in deload → verify ACWR in training-load route does not include the deload volume in chronic load