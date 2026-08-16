> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Phase-Type Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `phase_type` on `workout_sessions` at write time so historical deload/testing analytics (`isDeload`, `isTesting` in exercise history, training load, weekly stats) no longer depend on `program_phases`/`phase_sets` rows still existing.

**Architecture:** Add a nullable `phase_type` text column to `workout_sessions`. Populate it from the resolved `ProgramPhase.phaseType` at the two places workout sessions are created (`sync-workout`, `log-exercise`) — both already compute this value, it's just not persisted. Backfill existing rows from the current `phase_id` join. Update `buildWorkoutSessions` to read the column directly instead of joining `program_phases`. After this, `phase_id` becomes a soft pointer only — its `ON DELETE SET NULL` no longer affects analytics, which unblocks unconditionally deleting phase sets later.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL, vitest

**Prerequisite:** Local dev Postgres must be running (`pnpm db:local` — already done automatically at session start per `CLAUDE.md`). All DB verification in this plan runs against `trainingai_dev`, never production.

---

### Task 1: Migration — add `phase_type` column and backfill existing rows

**Files:**
- Create: `lib/data/postgres/migrations/061_workout_sessions_phase_type.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS phase_type text;

-- Backfill existing rows from the program_phases row their phase_id currently
-- points at. After this runs once, phase_type becomes a permanent write-time
-- snapshot — independent of whether the program_phases/phase_sets rows are
-- later deleted.
UPDATE workout_sessions ws
SET phase_type = pp.phase_type
FROM program_phases pp
WHERE ws.phase_id = pp.id
  AND ws.phase_type IS NULL;
```

- [ ] **Step 2: Apply the migration to the local dev DB**

Run:
```bash
set -a && source .env.local && set +a && node scripts/local-db/migrate.js
```
Expected: no new errors (existing migrations may log "already exists"-style warnings — that's normal, per the comment in `migrate.js`).

- [ ] **Step 3: Verify the column exists and backfill ran**

Run:
```bash
set -a && source .env.local && set +a && psql "$DATABASE_URL" -c "\d workout_sessions" | grep phase_type
psql "$DATABASE_URL" -c "SELECT phase_id, phase_type FROM workout_sessions WHERE phase_id IS NOT NULL LIMIT 5;"
```
Expected: `phase_type | text |` in the first output. The second query returns rows where `phase_type` is non-null wherever `phase_id` is non-null (the seed data includes `~9` logged sessions, some of which may have a `phase_id`).

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/061_workout_sessions_phase_type.sql
git commit -m "Add workout_sessions.phase_type snapshot column with backfill"
```

---

### Task 2: Persist `phase_type` on workout-session writes

**Files:**
- Modify: `lib/types/log.ts`
- Modify: `lib/data/postgres/schema.ts:122-132`
- Modify: `lib/data/repository.ts:7,79,81`
- Modify: `lib/data/postgres/adapter.ts:956-981`

- [ ] **Step 1: Widen `WorkoutSession.phaseType` to the full `ProgramPhaseType` union**

`lib/types/log.ts` currently redefines a 5-value union that's missing `'baseline'`. Reuse the canonical type instead.

In `lib/types/log.ts`, add an import at the top of the file:

```ts
import type { ProgramPhaseType } from './program'
```

Then change:

```ts
  phaseType?: 'normal' | 'peak' | 'deload' | 'accessory' | 'testing'
```

to:

```ts
  phaseType?: ProgramPhaseType
```

- [ ] **Step 2: Add the `phaseType` column to the Drizzle schema**

In `lib/data/postgres/schema.ts`, the `workoutSessions` table is:

```ts
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

Add `phaseType` after `phaseId`:

```ts
export const workoutSessions = pgTable('workout_sessions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId:     uuid('session_id').references(() => programSessions.id, { onDelete: 'set null' }),
  sessionName:   text('session_name').notNull(),
  startedAt:     timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  phaseId:       uuid('phase_id').references(() => programPhases.id, { onDelete: 'set null' }),
  phaseType:     text('phase_type'),
  isEarlyDeload: boolean('is_early_deload').notNull().default(false),
})
```

- [ ] **Step 3: Update the repository interface**

In `lib/data/repository.ts`, the type import on line 7 is:

```ts
import type { ExerciseLibraryEntry, MuscleAssignment, ProgramPhase, PhaseSetWithPhases, ExerciseType } from '@/lib/types/program'
```

Change to:

```ts
import type { ExerciseLibraryEntry, MuscleAssignment, ProgramPhase, ProgramPhaseType, PhaseSetWithPhases, ExerciseType } from '@/lib/types/program'
```

Then update the two method signatures (lines 79 and 81):

```ts
  createWorkoutSession(userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean): Promise<WorkoutSession>
```

```ts
  ensureWorkoutSession(userId: string, sessionId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean): Promise<boolean>
```

- [ ] **Step 4: Run the type checker to confirm the adapter is now out of sync**

Run:
```bash
npx tsc --noEmit
```
Expected: errors in `lib/data/postgres/adapter.ts` for `createWorkoutSession` and `ensureWorkoutSession` — argument count/order no longer matches the interface. This confirms the interface change is wired up; we'll fix the adapter next.

- [ ] **Step 5: Update the adapter implementations**

In `lib/data/postgres/adapter.ts`, `createWorkoutSession` (around line 956) is:

```ts
  async createWorkoutSession(
    userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date,
    phaseId?: string, isEarlyDeload = false,
  ): Promise<WorkoutSession> {
    const [r] = await this.db.insert(s.workoutSessions)
      .values({ userId, sessionId: sessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, isEarlyDeload })
      .returning()
    return {
      id: r.id, userId: r.userId, sessionId: r.sessionId ?? undefined,
      sessionName: r.sessionName, startedAt: r.startedAt,
      phaseId: r.phaseId ?? undefined, isEarlyDeload: r.isEarlyDeload,
      exercises: [],
    }
  }
```

Replace with:

```ts
  async createWorkoutSession(
    userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date,
    phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload = false,
  ): Promise<WorkoutSession> {
    const [r] = await this.db.insert(s.workoutSessions)
      .values({ userId, sessionId: sessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, phaseType: phaseType ?? null, isEarlyDeload })
      .returning()
    return {
      id: r.id, userId: r.userId, sessionId: r.sessionId ?? undefined,
      sessionName: r.sessionName, startedAt: r.startedAt,
      phaseId: r.phaseId ?? undefined, phaseType: (r.phaseType as ProgramPhaseType | null) ?? undefined,
      isEarlyDeload: r.isEarlyDeload,
      exercises: [],
    }
  }
```

`ensureWorkoutSession` (around line 971) is:

```ts
  async ensureWorkoutSession(
    userId: string, sessionId: string, programSessionId: string | undefined,
    sessionName: string, startedAt: Date,
    phaseId?: string, isEarlyDeload = false,
  ): Promise<boolean> {
    const inserted = await this.db.insert(s.workoutSessions)
      .values({ id: sessionId, userId, sessionId: programSessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, isEarlyDeload })
      .onConflictDoNothing()
      .returning({ id: s.workoutSessions.id })
    return inserted.length > 0
  }
```

Replace with:

```ts
  async ensureWorkoutSession(
    userId: string, sessionId: string, programSessionId: string | undefined,
    sessionName: string, startedAt: Date,
    phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload = false,
  ): Promise<boolean> {
    const inserted = await this.db.insert(s.workoutSessions)
      .values({ id: sessionId, userId, sessionId: programSessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, phaseType: phaseType ?? null, isEarlyDeload })
      .onConflictDoNothing()
      .returning({ id: s.workoutSessions.id })
    return inserted.length > 0
  }
```

(`ProgramPhaseType` is already imported in `adapter.ts` — no import change needed there.)

- [ ] **Step 6: Run the type checker again**

Run:
```bash
npx tsc --noEmit
```
Expected: the `adapter.ts` errors from Step 4 are gone. Errors will now appear in `app/api/sync-workout/route.ts` and `app/api/log-exercise/route.ts` (call sites still passing the old argument order) — that's expected, fixed in Tasks 3 and 4.

- [ ] **Step 7: Commit**

```bash
git add lib/types/log.ts lib/data/postgres/schema.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Persist phase_type when creating workout sessions"
```

---

### Task 3: Read the snapshot in `buildWorkoutSessions` (drop the `program_phases` join)

**Files:**
- Modify: `lib/data/postgres/adapter.ts:1144-1200`

- [ ] **Step 1: Remove the join and read `phase_type` directly**

The current `buildWorkoutSessions` (around line 1144) starts with:

```ts
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
```

Remove the "Resolve phase types..." block entirely, so it reads:

```ts
  private async buildWorkoutSessions(wsRows: typeof s.workoutSessions.$inferSelect[]): Promise<WorkoutSession[]> {
    if (!wsRows.length) return []
    const wsIds = wsRows.map(r => r.id)

    const elRows = await this.db.select().from(s.exerciseLogs)
```

- [ ] **Step 2: Update the returned `phaseType` field**

Further down in the same function, the mapped result currently has:

```ts
      phaseId: ws.phaseId ?? undefined,
      phaseType: ws.phaseId ? phaseTypeMap.get(ws.phaseId) : undefined,
      isEarlyDeload: ws.isEarlyDeload,
```

Replace with:

```ts
      phaseId: ws.phaseId ?? undefined,
      phaseType: (ws.phaseType as ProgramPhaseType | null) ?? undefined,
      isEarlyDeload: ws.isEarlyDeload,
```

- [ ] **Step 3: Run the type checker**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors from `adapter.ts` (the `inArray`/`s.programPhases` usage removed here is still used elsewhere in the file, so imports remain valid).

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Read phase_type snapshot directly in buildWorkoutSessions"
```

---

### Task 4: Wire up `sync-workout`

**Files:**
- Modify: `app/api/sync-workout/route.ts:7,82-99`

- [ ] **Step 1: Import `ProgramPhaseType`**

Line 7 currently:

```ts
import type { ProgramPhase } from '@/lib/types/program'
```

Change to:

```ts
import type { ProgramPhase, ProgramPhaseType } from '@/lib/types/program'
```

- [ ] **Step 2: Capture and pass `phase.phaseType`**

The loop body (around line 82) currently:

```ts
    let phaseId: string | undefined
    let isEarlyDeload = false
    if (phaseProgram && phases.length > 0 && phaseProgram.sessionsPerCycle) {
      const { phase } = getCurrentPhase(phases, phaseProgram.sessionsPerCycle, syncedSessionCount)
      phaseId = phase.id
      isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
    }

    const wasInserted = await repo.ensureWorkoutSession(
      userId,
      item.workoutSessionId,
      undefined,
      item.sessionName,
      dayStart,
      phaseId,
      isEarlyDeload,
    );
```

Replace with:

```ts
    let phaseId: string | undefined
    let phaseType: ProgramPhaseType | undefined
    let isEarlyDeload = false
    if (phaseProgram && phases.length > 0 && phaseProgram.sessionsPerCycle) {
      const { phase } = getCurrentPhase(phases, phaseProgram.sessionsPerCycle, syncedSessionCount)
      phaseId = phase.id
      phaseType = phase.phaseType
      isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
    }

    const wasInserted = await repo.ensureWorkoutSession(
      userId,
      item.workoutSessionId,
      undefined,
      item.sessionName,
      dayStart,
      phaseId,
      phaseType,
      isEarlyDeload,
    );
```

- [ ] **Step 3: Run the type checker**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors referencing `app/api/sync-workout/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync-workout/route.ts
git commit -m "Pass phase type through to ensureWorkoutSession in sync-workout"
```

---

### Task 5: Wire up `log-exercise`

**Files:**
- Modify: `app/api/log-exercise/route.ts:1-7,109-165`

- [ ] **Step 1: Import `ProgramPhaseType`**

Add to the imports near the top of the file (after the existing `import type { StyleSet } from "@/lib/types/progression"` line):

```ts
import type { ProgramPhaseType } from "@/lib/types/program"
```

- [ ] **Step 2: Type `currentPhaseType` correctly**

Around line 109-126, currently:

```ts
  // Resolve phase context for automatic-mode programs
  let currentPhaseId: string | undefined
  let currentPhaseType: string | undefined
  let isPhaseDeload = false
  let sessionIsEarlyDeload = false

  const programWithPhases = await repo.getActiveProgramWithPhases(userId)
  const activeProgram = programWithPhases?.program ?? await repo.getActiveProgram(userId)
  if (programWithPhases) {
    const { program: activeProg, phases: phaseList } = programWithPhases
    const todayStr = todayInTz(tz)
    const sessionsCount = await repo.countSessionsSinceStart(userId, activeProg.id, activeProg.startedAt!)
    if (phaseList.length > 0) {
      const { phase } = getCurrentPhase(phaseList, activeProg.sessionsPerCycle!, sessionsCount)
      currentPhaseId = phase.id
      currentPhaseType = phase.phaseType
      isPhaseDeload = phase.phaseType === 'deload'
      sessionIsEarlyDeload = isDeloadActive(phase, activeProg, todayStr)
    }
  }
```

Change `let currentPhaseType: string | undefined` to:

```ts
  let currentPhaseType: ProgramPhaseType | undefined
```

(no other changes needed in this block — `phase.phaseType` is already `ProgramPhaseType`, so the assignment now type-checks cleanly).

- [ ] **Step 3: Pass `currentPhaseType` to both session-creation calls**

Around line 156:

```ts
    await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, sessionStart, currentPhaseId, sessionIsEarlyDeload);
```

Change to:

```ts
    await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, sessionStart, currentPhaseId, currentPhaseType, sessionIsEarlyDeload);
```

Around line 164:

```ts
      const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, sessionStart, currentPhaseId, sessionIsEarlyDeload);
```

Change to:

```ts
      const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, sessionStart, currentPhaseId, currentPhaseType, sessionIsEarlyDeload);
```

- [ ] **Step 4: Run the type checker**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors anywhere referencing `phaseType`/`ensureWorkoutSession`/`createWorkoutSession`. If there are unrelated pre-existing errors in the codebase, confirm they're identical to a baseline run before this plan started (run `git stash && npx tsc --noEmit` to compare, then `git stash pop`).

- [ ] **Step 5: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "Pass phase type through to workout session creation in log-exercise"
```

---

### Task 6: Run the test suite and verify end-to-end against the local dev DB

**Files:** none (verification only)

- [ ] **Step 1: Run the existing automated test suite**

Run:
```bash
pnpm test
```
Expected: all existing tests pass (`lib/__tests__/phase-engine.test.ts` and others) — phase-type values and the phase engine itself are unchanged, only where the result is persisted has changed.

- [ ] **Step 2: Start the dev server against the local dev DB**

Run (in background):
```bash
pnpm dev
```
Wait for "Ready" in the output.

- [ ] **Step 3: Confirm the seeded test program is in automatic phase mode**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT id, name, phase_mode, phase_set_id, started_at, sessions_per_cycle FROM programs WHERE is_active = true;"
```
Note the `id` of the active program. If `phase_mode` is `'manual'` or `started_at`/`sessions_per_cycle` is null, the seed program won't exercise the phase-resolution code path — in that case skip to Step 6 and rely on Task 1's backfill verification instead, since this is pre-existing seed data, not something this plan should change.

- [ ] **Step 4: Log a set via the API as the seeded test user**

First get a session cookie by logging in (replace with the actual login flow used by `auth()` — for credentials login, POST to the NextAuth credentials endpoint with `test@local.dev` / `testpass123`, or use the dev server's UI in a browser at `http://localhost:3000`).

In the browser at `http://localhost:3000`:
1. Log in as `test@local.dev` / `testpass123`.
2. Start a workout, log at least one set, and complete the exercise (this calls `/api/log-exercise`, which calls `ensureWorkoutSession`/`createWorkoutSession`).

- [ ] **Step 5: Verify `phase_type` was written for the new session**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT id, session_name, started_at, phase_id, phase_type, is_early_deload FROM workout_sessions ORDER BY started_at DESC LIMIT 3;"
```
Expected: the newest row has `phase_type` populated whenever `phase_id` is also populated (i.e. the active program is in automatic mode with phases configured). If the active program is in manual mode, both `phase_id` and `phase_type` will be `NULL` for the new row — that's correct.

- [ ] **Step 6: Verify downstream analytics still work**

With the dev server running and logged in via the browser, open these URLs (or `curl` with the session cookie) and confirm they return 200 with sensible data, not errors:
- `/api/exercise-history?name=<an exercise you logged>`
- `/api/training-load`
- `/api/weekly-stats`

Expected: same shape of response as before this change — `isDeload`/`phaseType`-derived fields populate correctly for any sessions that have `phase_type` set.

- [ ] **Step 7: Stop the dev server**

Stop the background `pnpm dev` process once verification is complete.

---

## Self-Review Notes

- **Spec coverage:** Schema column ✅ (Task 1/2), write-time capture at both call sites ✅ (Task 4/5), backfill ✅ (Task 1), read-path simplification ✅ (Task 3), verification against local DB only ✅ (Task 6, no production DB touched anywhere in this plan).
- **Type consistency:** `ProgramPhaseType` is used consistently across `lib/types/log.ts`, `repository.ts`, `adapter.ts`, `sync-workout/route.ts`, and `log-exercise/route.ts` — all six values (`normal | peak | deload | accessory | testing | baseline`) are now representable end-to-end.
- **No placeholders:** every step shows exact before/after code or exact commands with expected output.
