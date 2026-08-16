> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Per-Session Phase Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

The phase engine currently tracks **one global phase** for the entire program, advancing it based on the **total session count** across all session types. This breaks when a user repeats a session instead of completing the rotation:

**Example:** Push/Pull/Legs program, baseline phase (1 cycle = 3 sessions total).
- User does: Push, Pull, Push (repeat) — 3 sessions total.
- System sees: `floor(3/3) = 1` completed cycle → advances ALL sessions out of baseline.
- **Result:** Legs enters Accumulation having never been baselined. No 1RM data exists for Legs exercises. Prescribed weights default to zero or stale values.

Additionally, if a user simply never does one session type (e.g. never does Legs), the other sessions can never progress — they're blocked waiting for a count that will never arrive.

## Solution

Each program session (Push, Pull, Legs) independently tracks its own cycle count. Push progresses through phases by counting Push sessions only. Legs progresses by counting Legs sessions only. They advance completely independently.

The phase engine call changes from:
```typescript
getCurrentPhase(phases, sessionsPerCycle, totalSessions)
// e.g. getCurrentPhase(phases, 3, 6)
```
to per-session:
```typescript
getCurrentPhase(phases, 1, thisSessionCount)
// e.g. getCurrentPhase(phases, 1, 2) — Push has been done twice
```

A "cycle" for each session is simply: how many times has **that session** been logged since the program started.

## Architecture

- **Phase engine (`lib/phase-engine.ts`):** Unchanged. The function signature stays the same; callers pass `sessionsPerCycle=1` and a session-specific count.
- **DB layer:** One new method — `countAllSessionsSinceStart` — returns a `Map<sessionName, count>` via a single `GROUP BY session_name` query. No schema changes needed (`workout_sessions.session_name` is already stored).
- **`programs.sessionsPerCycle`:** Retained in schema and used only in `cycleAnchorFromHistory` (initial block anchor calculation). No longer passed to `getCurrentPhase`. Existing programs keep their value; phase logic ignores it.
- **UI summary — "leader session":** The session furthest through the program (highest `completedCycles`) is the "leader." Its phase is shown in the Block Progress card and home screen when no specific session is selected.
- **Home card:** Shows the phase of today's recommended session (from `next-session`), looked up from the `perSessionPhaseStatus` array returned in the meta response.
- **Progress card:** Shows the leader session's phase — "highest phase wins."
- **Cache bug fix (included):** `completeWorkout()` currently only clears `workout-data:meta`. This causes stale baseline data to persist on adjacent session screens for up to 6 hours after a phase-changing workout. Fixed in Task 0.

## File Map

| File | Change |
|------|--------|
| `lib/data/repository.ts` | Add `countAllSessionsSinceStart` to interface |
| `lib/data/postgres/adapter.ts` | Implement `countAllSessionsSinceStart`; relax `getActiveProgramWithPhases` `sessionsPerCycle` guard |
| `app/api/workout-data/route.ts` | Session path: per-session count + `sessionsPerCycle=1`; meta path: `perSessionPhaseStatus[]` + leader summary |
| `app/api/log-exercise/route.ts` | Per-session count for the session being logged |
| `app/api/sync-workout/route.ts` | Per-session count per item in batch |
| `components/workout-screen.tsx` | `completeWorkout`: widen `invalidateCache('workout-data:meta')` → `invalidateCache('workout-data')` |
| `app/session-select/session-select-content.tsx` | Progress card: use leader session phase; session cards: show per-session phase |
| `app/workout-select/workout-select-content.tsx` | Home card: look up today's session's phase from `perSessionPhaseStatus` |

---

## Task 0 (Quick Fix): Cache invalidation bug in `completeWorkout`

**Files:** `components/workout-screen.tsx`

### Background

The `completeWorkout()` callback uses `invalidateCache` which does prefix-matching on the SQLite + localStorage + sessionStorage caches:
- `invalidateCache('workout-data:meta')` clears only the key starting with `workout-data:meta`
- Session-specific caches like `workout-data:push`, `workout-data:pull` are **not cleared**
- These have a 6-hour TTL and stale baseline data persists on the pre-workout screen for up to 6 hours after the phase transition

This bug exists today independently of per-session tracking and should be fixed first.

- [ ] **Step 1: Widen the invalidation key**

In `components/workout-screen.tsx`, in the `completeWorkout` callback (search for `invalidateCache('workout-data:meta')`):

```typescript
// BEFORE
invalidateCache('workout-data:meta');

// AFTER — prefix match clears workout-data:meta, workout-data:push, workout-data:pull, etc.
invalidateCache('workout-data');
```

- [ ] **Step 2: Verify TypeScript + lint**

```bash
pnpm tsc --noEmit 2>&1 | head -20
pnpm lint 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "fix: clear all workout-data caches on workout completion, not just meta"
```

---

## Task 1: DB layer — per-session count query

**Files:** `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`

### Background

`countSessionsSinceStart` currently counts ALL `workout_sessions` rows for the user since the program anchor, regardless of session type. The new `countAllSessionsSinceStart` method returns a `Map<sessionName, count>` for every session name, computed in a single `GROUP BY` query — faster than N per-session queries.

Session identification uses `workout_sessions.session_name` (a non-nullable text snapshot stored at log time). This is reliable even when program sessions are deleted/recreated (the FK `session_id` gets set to NULL on program saves, but `session_name` is always preserved). The known limitation: if a user renames a session, historical logs retain the old name and count separately. This is acceptable — renaming a session is semantically creating a new session.

- [ ] **Step 1: Add the interface method**

In `lib/data/repository.ts`, find the block containing `countSessionsSinceStart`. After it, add:

```typescript
countAllSessionsSinceStart(userId: string, programId: string): Promise<Map<string, number>>
```

- [ ] **Step 2: Implement in the adapter**

In `lib/data/postgres/adapter.ts`, after the `countSessionsSinceStart` method, add:

```typescript
async countAllSessionsSinceStart(userId: string, programId: string): Promise<Map<string, number>> {
  const [prog] = await this.db
    .select({ cycleAnchorAt: s.programs.cycleAnchorAt, startedAt: s.programs.startedAt })
    .from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))

  const rows = await this.db
    .select({
      sessionName: s.workoutSessions.sessionName,
      count: sql<number>`count(*)::int`,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.isEarlyDeload, false),
      sql`${s.workoutSessions.startedAt} > coalesce(${prog?.cycleAnchorAt ?? null}, ${prog?.startedAt ?? null}::timestamptz, '-infinity'::timestamptz)`,
    ))
    .groupBy(s.workoutSessions.sessionName)

  return new Map(rows.map(r => [r.sessionName, r.count]))
}
```

- [ ] **Step 3: Relax the `sessionsPerCycle` guard in `getActiveProgramWithPhases`**

In `lib/data/postgres/adapter.ts`, find:

```typescript
async getActiveProgramWithPhases(userId: string) {
  const prog = await this.getActiveProgram(userId);
  if (!prog || prog.phaseMode !== 'automatic' || !prog.startedAt || !prog.sessionsPerCycle) return null;
```

Change to (drop `!prog.sessionsPerCycle` — per-session tracking uses `sessionsPerCycle=1`, so the field on the program is no longer required):

```typescript
async getActiveProgramWithPhases(userId: string) {
  const prog = await this.getActiveProgram(userId);
  if (!prog || prog.phaseMode !== 'automatic' || !prog.startedAt) return null;
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If the repository interface has TypeScript strict checking, the new method must match the signature exactly.

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat: add countAllSessionsSinceStart for per-session phase tracking"
```

---

## Task 2: `workout-data` route — session-specific path

**Files:** `app/api/workout-data/route.ts`

### Background

When called with a session tab param (e.g. `?tab=push`), the route computes `currentPhase` and `sessionPhaseStatus`. Currently it calls `countSessionsSinceStart` (total count) and passes `program.sessionsPerCycle!`. Change it to call `countAllSessionsSinceStart`, look up the count for THIS session's name, and pass `sessionsPerCycle=1`.

`approxWeeksRemaining` needs adjustment: with `sessionsPerCycle=1`, the phase engine calculates remaining time as `phaseCyclesLeft / avgSessionsPerWeek`. But `avgSessionsPerWeek` here should be the per-session frequency (how many times THIS session is done per week), not the total. For a PPL program with 3 sessions/week, each individual session is done ~1 time/week. So divide `getScheduledSessionsPerWeek(program)` by `program.sessions.length`.

- [ ] **Step 1: Add `PerSessionPhaseStatus` interface**

In `app/api/workout-data/route.ts`, after the existing `PhaseStatus` interface, add:

```typescript
export interface PerSessionPhaseStatus {
  sessionId: string
  sessionName: string
  phaseStatus: PhaseStatus
}
```

- [ ] **Step 2: Update the session-specific phase resolution block**

Find the block (around line 129–147) that computes `sessionPhaseStatus`:

```typescript
if (isAutomatic && allPhases.length > 0) {
  const sessionsCount = await repo.countSessionsSinceStart(userId, program.id)
  const result = getCurrentPhase(allPhases, program.sessionsPerCycle!, sessionsCount)
  currentPhase = result.phase
  const avgPerWeek = getScheduledSessionsPerWeek(program)
  sessionPhaseStatus = {
    ...
    sessionsPerCycle: program.sessionsPerCycle!,
    sessionsInCurrentCycle: sessionsCount % program.sessionsPerCycle!,
    approxWeeksRemaining: avgPerWeek > 0 ? result.approxWeeksRemaining(avgPerWeek) : null,
    ...
  }
}
```

Replace with:

```typescript
if (isAutomatic && allPhases.length > 0) {
  const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
  const thisSessionCount = sessionCounts.get(programSession.name) ?? 0
  const result = getCurrentPhase(allPhases, 1, thisSessionCount)
  currentPhase = result.phase

  // Per-session frequency: total scheduled ÷ number of sessions in program
  const totalPerWeek = getScheduledSessionsPerWeek(program)
  const numSessions = Math.max(1, program.sessions.length)
  const sessionPerWeek = totalPerWeek / numSessions

  sessionPhaseStatus = {
    phase: result.phase,
    cycleInPhase: result.cycleInPhase,
    totalPhaseCycles: result.totalPhaseCycles,
    completedCycles: result.completedCycles,
    totalProgramCycles: result.totalProgramCycles,
    sessionsPerCycle: 1,
    sessionsInCurrentCycle: 0,
    blockComplete: result.blockComplete,
    approxWeeksRemaining: sessionPerWeek > 0 ? result.approxWeeksRemaining(sessionPerWeek) : null,
    isDeloadActive: isDeloadActive(result.phase, program, todayStr),
    isBaseline: result.phase.phaseType === 'baseline',
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "feat: compute per-session phase in workout-data session path"
```

---

## Task 3: `workout-data` route — meta path

**Files:** `app/api/workout-data/route.ts`

### Background

The meta path (`?tab=meta` or no tab param) is consumed by the home screen and session-select screen. It currently returns a single global `phaseStatus`. It needs to return:
1. `perSessionPhaseStatus: PerSessionPhaseStatus[]` — one entry per program session
2. `phaseStatus` — the "leader" session's phase status (session with the most `completedCycles`), used by the Block Progress card ("highest phase wins")

The home card will look up the recommended session's phase from `perSessionPhaseStatus`. The progress card uses `phaseStatus` (leader) as before, but the progress bar now reflects the leader session's individual progress through its phase.

- [ ] **Step 1: Update the meta phase resolution block**

Find the block (around line 69–95) that builds `phaseStatus` for the meta path:

```typescript
if (program.phaseMode === 'automatic' && program.sessionsPerCycle && program.sessionsPerCycle >= 1) {
  const phases = await repo.listProgramPhases(program.id)
  if (phases.length > 0) {
    // ... builds phaseStatus from countSessionsSinceStart
  }
}
```

Replace with:

```typescript
let perSessionPhaseStatus: PerSessionPhaseStatus[] = []
if (program.phaseMode === 'automatic') {
  const phases = await repo.listProgramPhases(program.id)
  if (phases.length > 0) {
    const tz = session?.user?.timezone ?? 'Australia/Brisbane'
    const today = todayInTz(tz)
    const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
    const totalPerWeek = getScheduledSessionsPerWeek(program)
    const numSessions = Math.max(1, program.sessions.length)
    const sessionPerWeek = totalPerWeek / numSessions

    perSessionPhaseStatus = program.sessions.map(sess => {
      const count = sessionCounts.get(sess.name) ?? 0
      const result = getCurrentPhase(phases, 1, count)
      const deloadActive = isDeloadActive(result.phase, program, today)
      return {
        sessionId: sess.id,
        sessionName: sess.name,
        phaseStatus: {
          phase: result.phase,
          cycleInPhase: result.cycleInPhase,
          totalPhaseCycles: result.totalPhaseCycles,
          completedCycles: result.completedCycles,
          totalProgramCycles: result.totalProgramCycles,
          sessionsPerCycle: 1,
          sessionsInCurrentCycle: 0,
          blockComplete: result.blockComplete,
          approxWeeksRemaining: sessionPerWeek > 0 ? result.approxWeeksRemaining(sessionPerWeek) : null,
          isDeloadActive: deloadActive,
          isBaseline: result.phase.phaseType === 'baseline',
        },
      }
    })

    // Leader = session furthest through the program (most completedCycles)
    if (perSessionPhaseStatus.length > 0) {
      const leader = perSessionPhaseStatus.reduce((best, curr) =>
        curr.phaseStatus.completedCycles > best.phaseStatus.completedCycles ? curr : best
      )
      phaseStatus = leader.phaseStatus
    }
  }
}
```

- [ ] **Step 2: Include `perSessionPhaseStatus` in the response**

Find the return statement for the meta path:
```typescript
return NextResponse.json({ program, styles, phaseStatus }, { headers: cacheHeaders });
```

Change to:
```typescript
return NextResponse.json({ program, styles, phaseStatus, perSessionPhaseStatus }, { headers: cacheHeaders });
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "feat: return per-session phase array and leader phase in workout-data meta"
```

---

## Task 4: `log-exercise` route

**Files:** `app/api/log-exercise/route.ts`

### Background

The route resolves `currentPhaseType` before creating the workout session row. It currently calls `countSessionsSinceStart` (total) and uses `activeProg.sessionsPerCycle!`. Change it to call `countAllSessionsSinceStart` and look up the count for `sessionName` (already available from the parsed request body).

- [ ] **Step 1: Replace phase resolution block**

Find (around line 74–86):

```typescript
const programWithPhases = await repo.getActiveProgramWithPhases(userId)
const activeProgram = programWithPhases?.program ?? await repo.getActiveProgram(userId)
if (programWithPhases) {
  const { program: activeProg, phases: phaseList } = programWithPhases
  const todayStr = todayInTz(tz)
  const sessionsCount = await repo.countSessionsSinceStart(userId, activeProg.id)
  if (phaseList.length > 0) {
    const { phase } = getCurrentPhase(phaseList, activeProg.sessionsPerCycle!, sessionsCount)
    currentPhaseId = phase.id
    currentPhaseType = phase.phaseType
    sessionIsEarlyDeload = isDeloadActive(phase, activeProg, todayStr)
  }
}
```

Replace with:

```typescript
const programWithPhases = await repo.getActiveProgramWithPhases(userId)
const activeProgram = programWithPhases?.program ?? await repo.getActiveProgram(userId)
if (programWithPhases) {
  const { program: activeProg, phases: phaseList } = programWithPhases
  const todayStr = todayInTz(tz)
  if (phaseList.length > 0) {
    // Count only sessions with this specific session name — per-session phase tracking
    const sessionCounts = await repo.countAllSessionsSinceStart(userId, activeProg.id)
    const thisSessionCount = sessionCounts.get(sessionName) ?? 0
    const { phase } = getCurrentPhase(phaseList, 1, thisSessionCount)
    currentPhaseId = phase.id
    currentPhaseType = phase.phaseType
    sessionIsEarlyDeload = isDeloadActive(phase, activeProg, todayStr)
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Run test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "feat: use per-session count for phase resolution in log-exercise"
```

---

## Task 5: `sync-workout` route

**Files:** `app/api/sync-workout/route.ts`

### Background

The sync route processes a batch of offline workout items. It currently fetches the total count once and increments a single `syncedSessionCount` as it processes new session rows. With per-session tracking, it needs a per-session-name count that increments independently per session name.

- [ ] **Step 1: Replace session count initialisation**

Find (around line 83–89):

```typescript
let syncedSessionCount = 0
const activeProgram = await repo.getActiveProgram(userId)
if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
  phaseProgram = activeProgram
  phases = await repo.listProgramPhases(activeProgram.id)
  syncedSessionCount = await repo.countSessionsSinceStart(userId, activeProgram.id)
}
```

Replace with:

```typescript
const syncedSessionCounts = new Map<string, number>()
const activeProgram = await repo.getActiveProgram(userId)
if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt) {
  phaseProgram = activeProgram
  phases = await repo.listProgramPhases(activeProgram.id)
  const baseCounts = await repo.countAllSessionsSinceStart(userId, activeProgram.id)
  for (const [k, v] of baseCounts) syncedSessionCounts.set(k, v)
}
```

- [ ] **Step 2: Update per-item phase resolution**

Find (around line 103–111):

```typescript
if (phaseProgram && phases.length > 0 && phaseProgram.sessionsPerCycle) {
  const { phase } = getCurrentPhase(phases, phaseProgram.sessionsPerCycle, syncedSessionCount)
  phaseId = phase.id
  phaseType = phase.phaseType
  isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
}
```

Replace with:

```typescript
if (phaseProgram && phases.length > 0) {
  const thisSessionCount = syncedSessionCounts.get(item.sessionName) ?? 0
  const { phase } = getCurrentPhase(phases, 1, thisSessionCount)
  phaseId = phase.id
  phaseType = phase.phaseType
  isEarlyDeload = isDeloadActive(phase, phaseProgram, item.startedAt.slice(0, 10))
}
```

- [ ] **Step 3: Increment per-session count on new session insert**

Find the comment (around line 124) that says "Only advance the count once per newly-created workout session". Below `ensured`, the code currently increments `syncedSessionCount`. Change to increment the per-session count:

```typescript
// BEFORE
if (ensured.wasInserted) syncedSessionCount++

// AFTER
if (ensured.wasInserted) {
  syncedSessionCounts.set(item.sessionName, (syncedSessionCounts.get(item.sessionName) ?? 0) + 1)
}
```

- [ ] **Step 4: Remove the `phaseProgram.sessionsPerCycle` type annotation**

The type annotation for `phaseProgram` currently includes `sessionsPerCycle?`:
```typescript
let phaseProgram: { id: string; startedAt?: string; sessionsPerCycle?: number; earlyDeloadWeekStart?: string } | null = null
```

Remove `sessionsPerCycle?` from the type since it's no longer read:
```typescript
let phaseProgram: { id: string; startedAt?: string; earlyDeloadWeekStart?: string } | null = null
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add app/api/sync-workout/route.ts
git commit -m "feat: per-session phase tracking in sync-workout batch processor"
```

---

## Task 6: UI — home card shows today's session phase

**Files:** `app/workout-select/workout-select-content.tsx`

### Background

The home/today screen shows a card for the recommended session (from `next-session`) with the phase name below it. Currently it uses the global `phaseStatus` from the meta response. It should instead show the phase of the specific recommended session, looked up from the `perSessionPhaseStatus` array now returned in the meta response.

- [ ] **Step 1: Read `perSessionPhaseStatus` from the cached meta response**

In `workout-select-content.tsx`, find where `phaseStatus` is read from the meta fetch. The component state currently has:
```typescript
const [phaseStatus, setPhaseStatus] = useState<...PhaseStatus | null>(null)
```

Add alongside it:
```typescript
const [perSessionPhaseStatus, setPerSessionPhaseStatus] = useState<import('@/app/api/workout-data/route').PerSessionPhaseStatus[]>([])
```

In every place `setPhaseStatus(meta?.phaseStatus ?? null)` is called, also call:
```typescript
setPerSessionPhaseStatus(meta?.perSessionPhaseStatus ?? [])
```

- [ ] **Step 2: Derive today's session phase**

After the state declarations, add a derived value:

```typescript
// Look up the phase for today's recommended session specifically.
// Falls back to leader phaseStatus if the session name isn't found.
const todaySessionPhase = useMemo(() => {
  if (!nextSession?.session?.name || perSessionPhaseStatus.length === 0) return phaseStatus
  return perSessionPhaseStatus.find(p => p.sessionName === nextSession.session!.name)?.phaseStatus ?? phaseStatus
}, [nextSession, perSessionPhaseStatus, phaseStatus])
```

Where `nextSession` is the state holding the `next-session` API response.

- [ ] **Step 3: Pass `todaySessionPhase` to the session card's phase badge**

Find the JSX that renders the phase badge for the recommended session (currently references `phaseStatus`). Replace `phaseStatus` with `todaySessionPhase` in that badge.

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/workout-select/workout-select-content.tsx
git commit -m "feat: show per-session phase on home card for today's recommended session"
```

---

## Task 7: UI — session-select progress card uses leader phase

**Files:** `app/session-select/session-select-content.tsx`

### Background

The `BlockProgressCard` shows a progress bar and phase name for the overall program. Currently it uses the global `phaseStatus`. With per-session tracking, `phaseStatus` from the meta response is already the leader's phase status — no structural change needed. However:

1. The progress bar calculation currently uses `sessionsPerCycle` in its formula. With `sessionsPerCycle=1`, it simplifies cleanly: the bar shows `completedCycles / totalProgramCycles`.
2. The session cards on the session-select screen show individual phase badges. Each card should show ITS OWN session's phase from `perSessionPhaseStatus`, not the global leader phase.

- [ ] **Step 1: Read `perSessionPhaseStatus` from the meta response**

In `session-select-content.tsx`, find where the meta fetch data is applied (search for `setPhaseStatus`). Add alongside:

```typescript
const [perSessionPhaseStatus, setPerSessionPhaseStatus] = useState<import('@/app/api/workout-data/route').PerSessionPhaseStatus[]>([])
```

Update every `setPhaseStatus(d?.phaseStatus ?? null)` call to also set:
```typescript
setPerSessionPhaseStatus(d?.perSessionPhaseStatus ?? [])
```

- [ ] **Step 2: Fix the `BlockProgressCard` progress bar calculation**

Find in `BlockProgressCard`:

```typescript
const total = phaseStatus.totalPhaseCycles * (phaseStatus.sessionsPerCycle || 1);
const done = (phaseStatus.cycleInPhase - 1) * (phaseStatus.sessionsPerCycle || 1) + (phaseStatus.sessionsInCurrentCycle || 0);
```

With `sessionsPerCycle=1` these simplify to `totalPhaseCycles` and `cycleInPhase - 1`. Since the progress bar above uses `completedCycles / totalProgramCycles`, these lines may be for the inner-phase progress pill — check context. Update both to avoid multiplying by `sessionsPerCycle`:

```typescript
const total = phaseStatus.totalPhaseCycles;
const done = phaseStatus.cycleInPhase - 1;
```

- [ ] **Step 3: Per-session phase badge on each session card**

Find the JSX that renders each program session card on the session-select screen. Each card has a phase badge showing `phaseStatus.phase.name`. Change it to look up that session's own phase:

```typescript
const sessionPhase = perSessionPhaseStatus.find(p => p.sessionId === sess.id)?.phaseStatus ?? phaseStatus
```

Pass `sessionPhase` to each card's phase badge instead of the global `phaseStatus`.

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "feat: per-session phase badges on session cards; leader phase in progress card"
```

---

## Task 8: Done screen — phase completion banner

**Files:** `components/workout-screen.tsx`, `components/workout/done-screen.tsx`

### Background

After completing a workout session that finishes a phase for that session (e.g. Push's 1st baseline workout completes the baseline for Push), the user gets no feedback. They only discover the phase changed when they next open the workout screen. A banner on the done screen — "Baseline complete! Next Push workout starts Accumulation" — closes this gap.

- [ ] **Step 1: Capture the session's phase before the workout**

In `workout-screen.tsx`, at workout start, record the current `phaseStatus` for this session. The `phaseStatus` state is already loaded from the pre-workout screen. Store it in a ref:

```typescript
const phaseAtWorkoutStart = useRef<PhaseStatus | null>(null)
```

In `launchExercise` or at the point `startWorkout` is called, capture it:
```typescript
phaseAtWorkoutStart.current = phaseStatus
```

- [ ] **Step 2: Detect phase change after workout completion**

In `completeWorkout()`, after `invalidateCache('workout-data')`, schedule a fresh fetch of the session-specific `workout-data` to compare phases. Because `completeWorkout` is a callback (no async), use a post-completion effect or fire-and-forget fetch:

```typescript
// After invalidation, fetch fresh phase for this session
fetch(`/api/workout-data?tab=${encodeURIComponent(sessionType.toLowerCase())}`)
  .then(r => r.ok ? r.json() : null)
  .then((d: { phaseStatus?: PhaseStatus } | null) => {
    const oldPhase = phaseAtWorkoutStart.current?.phase?.name
    const newPhase = d?.phaseStatus?.phase?.name
    if (newPhase && oldPhase && newPhase !== oldPhase) {
      setPhaseCompletionBanner({ from: oldPhase, to: newPhase })
    }
  })
  .catch(() => {})
```

Add `phaseCompletionBanner` state:
```typescript
const [phaseCompletionBanner, setPhaseCompletionBanner] = useState<{ from: string; to: string } | null>(null)
```

- [ ] **Step 3: Render the banner on the done screen**

Pass `phaseCompletionBanner` to `DoneScreen`. In `done-screen.tsx`, accept a `phaseCompletionBanner?: { from: string; to: string } | null` prop. Render it prominently near the top:

```tsx
{phaseCompletionBanner && (
  <div className="rounded-2xl p-4 mb-3" style={{ background: 'color-mix(in oklch, var(--color-brand) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--color-brand) 30%, transparent)' }}>
    <p className="text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>
      {phaseCompletionBanner.from} complete!
    </p>
    <p className="text-xs text-muted-foreground mt-0.5">
      Next workout starts {phaseCompletionBanner.to}
    </p>
  </div>
)}
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx components/workout/done-screen.tsx
git commit -m "feat: show phase completion banner on done screen when session advances phase"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Start local dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Manual test — Push/Pull/Legs baseline scenario**

1. Create a program with Push/Pull/Legs sessions and a baseline phase (toggle on in builder)
2. Activate the program
3. Open Push workout → confirm phase shows "Baseline · Cycle 1/1"
4. Log Push → complete workout
5. Open Pull workout → confirm phase shows "Baseline · Cycle 1/1" (independent of Push)
6. Log Pull → complete workout
7. Open Push workout AGAIN (repeat) → confirm still shows "Baseline" (Push has done 1 baseline cycle — wait, baseline durationCycles=1, so after 1 Push session, baseline is complete for Push)

> **Note:** With `sessionsPerCycle=1` and baseline `durationCycles=1`, Push advances out of baseline after the FIRST Push workout. This is the intended per-session behaviour — each session needs to do 1 baseline workout to establish its 1RM. Verify this is correct for the desired UX.

8. After Push's 2nd workout, Push should be in Accumulation cycle 1
9. Legs first workout → Legs shows "Baseline · Cycle 1/1" (has never been done)
10. Done screen after Legs baseline workout → banner "Baseline complete! Next Legs workout starts Accumulation"

- [ ] **Step 3: Home card phase check**

11. Home card → shows "Baseline" for today's recommended session (Legs, if it hasn't been done yet)
12. After doing Legs baseline → home card for next session (Push, if that's next) → shows "Accumulation"

- [ ] **Step 4: Progress card check**

13. Progress card → shows leader session's phase (Push after 3 Push sessions would be in Accumulation if durationCycles>1)
14. Block complete detection still works when leader session finishes all phase cycles

- [ ] **Step 5: Regression — non-phase programs**

15. Activate a linear progression program (no phases, `phaseMode = 'manual'`) → workout screen shows no phase badge → logs correctly → no errors

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass. The phase engine tests are unaffected (same function, same signature).

---

## Migration notes

- **Existing programs mid-block:** Historical `workout_sessions` already store `session_name`. The `countAllSessionsSinceStart` GROUP BY query correctly recovers per-session counts from existing data. No SQL migration needed.
- **`programs.sessionsPerCycle`:** Retained in schema. Only used in `cycleAnchorFromHistory` to compute the initial block anchor. Existing programs keep their stored value. New programs should set `sessionsPerCycle = program.sessions.length` at activation time so `cycleAnchorFromHistory` continues to work correctly.
- **Phase engine tests:** `lib/__tests__/phase-engine.test.ts` tests `getCurrentPhase` directly and is completely unaffected — the function signature is unchanged.
- **`readiness-score`, `weights-summary`, `nutrition-goals/recommend`:** These all read the global phase for context (deload detection, phase-adjusted nutrition targets). The leader session's phase is appropriate for all three. No changes needed; `phaseStatus` from the meta route already returns the leader.

## Risk areas

| Risk | Mitigation |
|------|-----------|
| User renames a session | Old `session_name` logs count separately from the renamed session. Accepted — renaming changes session identity. Could warn the user at rename time. |
| Session name case inconsistency | `session_name` is stored as written. Ensure all writes use `programSession.name` consistently (not `.toLowerCase()` or user-edited strings) |
| `sessionsPerCycle=null` on legacy programs | `getActiveProgramWithPhases` no longer guards on it; all phase engine calls now use `1` explicitly — no null-reference risk |
| Phase engine receives `sessionsPerCycle=1` always | Verify no callers still pass `program.sessionsPerCycle` — search for `getCurrentPhase` across all routes after the change |
| Sync route `item.sessionName` availability | Confirm `sessionName` is present in the offline outbox payload (`lib/sqlite/outbox.ts`) before Task 5 |
