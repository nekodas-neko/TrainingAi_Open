> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Security Uplift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three security gaps found during the 2026-06-12 deep review: a write-IDOR in `/api/sync-workout` that lets a malicious client overwrite another user's logged sets, a non-constant-time secret comparison on the Health Connect ingest webhook, and an email-enumeration oracle on the friend-request endpoint.

**Architecture:** This is a backlog of **3 independent tasks** — pick any one, implement, verify, and commit on its own. There is no shared design between them beyond "all three are auth/IDOR-adjacent hardening fixes". Do not attempt all three in one commit.

**Tech Stack:** Next.js 15 route handlers, Drizzle ORM, PostgreSQL, Node `crypto`.

**Prerequisite:** Local dev Postgres must be running (`pnpm db:local` — already done automatically at session start per `CLAUDE.md`). Task 1's DB verification runs against `trainingai_dev`, never production.

---

### Task 1: Fix write-IDOR in `/api/sync-workout`

**Problem:** `POST /api/sync-workout` accepts client-generated `workoutSessionId` and `exerciseLogId` UUIDs and upserts rows keyed on them with no ownership check:

- `ensureWorkoutSession(...)` uses `.onConflictDoNothing()` on `workout_sessions.id` — if the id already belongs to another user, the insert silently no-ops and the request continues.
- `logExerciseWithId(...)` uses `.onConflictDoNothing()` on `exercise_logs.id` — same silent no-op for another user's exercise log.
- `logSets(exerciseLogId, ...)` uses `.onConflictDoUpdate({ target: [exerciseLogId, setNumber], ... set: {...EXCLUDED} })` — **this is the actual overwrite vector**. `set_logs` has no `userId` column, only `(exerciseLogId, setNumber)` uniqueness. If an attacker submits a payload with an `exerciseLogId` belonging to another user's existing exercise log, this call **overwrites that user's set rows** (weight, reps, etc.) in place.

**Fix:** Before processing the batch, look up the existing owners of every `workoutSessionId` and `exerciseLogId` referenced in the payload (two batched queries, not N+1). For any item where an existing row's owner doesn't match the authenticated `userId`, skip that item entirely.

**Files:**
- Modify: `lib/data/repository.ts:109-116`
- Modify: `lib/data/postgres/adapter.ts:1217-1230` (insert two new methods after `getDayLog`)
- Modify: `app/api/sync-workout/route.ts`

- [ ] **Step 1: Add the two new methods to the `WorkoutRepository` interface**

In `lib/data/repository.ts`, the "Queries" section currently reads:

```ts
  // ── Queries ────────────────────────────────────────────────────────────────
  getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
  getCalendarData(userId: string, year: number, month: number): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>
  getDayLog(userId: string, date: string): Promise<WorkoutSession[]>
  getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]>
```

Add the two ownership-lookup methods after `getDayLog`:

```ts
  // ── Queries ────────────────────────────────────────────────────────────────
  getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
  getCalendarData(userId: string, year: number, month: number): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>
  getDayLog(userId: string, date: string): Promise<WorkoutSession[]>
  // Batched ownership lookups for sync-time IDOR checks — returns a map of
  // row id -> owning userId for whichever of the given ids already exist.
  getWorkoutSessionOwners(sessionIds: string[]): Promise<Map<string, string>>
  getExerciseLogOwners(exerciseLogIds: string[]): Promise<Map<string, string>>
  getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]>
```

- [ ] **Step 2: Implement both methods in the Postgres adapter**

In `lib/data/postgres/adapter.ts`, `getDayLog` ends at line 1229:

```ts
  async getDayLog(userId: string, date: string): Promise<WorkoutSession[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d)
    const to   = aestMidnight(y, m, d + 1)
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }

  async getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]> {
```

Insert the two new methods between them:

```ts
  async getDayLog(userId: string, date: string): Promise<WorkoutSession[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d)
    const to   = aestMidnight(y, m, d + 1)
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }

  async getWorkoutSessionOwners(sessionIds: string[]): Promise<Map<string, string>> {
    if (!sessionIds.length) return new Map()
    const rows = await this.db.select({ id: s.workoutSessions.id, userId: s.workoutSessions.userId })
      .from(s.workoutSessions)
      .where(inArray(s.workoutSessions.id, sessionIds))
    return new Map(rows.map(r => [r.id, r.userId]))
  }

  async getExerciseLogOwners(exerciseLogIds: string[]): Promise<Map<string, string>> {
    if (!exerciseLogIds.length) return new Map()
    const rows = await this.db.select({ id: s.exerciseLogs.id, userId: s.workoutSessions.userId })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(inArray(s.exerciseLogs.id, exerciseLogIds))
    return new Map(rows.map(r => [r.id, r.userId]))
  }

  async getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]> {
```

`inArray`, `eq`, `and`, `gte`, `lt`, `asc` are already imported at the top of `adapter.ts` (used elsewhere in this file, e.g. `getLastExerciseLogsBatch`).

- [ ] **Step 3: Batch-check ownership in the sync route and skip mismatched items**

In `app/api/sync-workout/route.ts`, the setup before the loop currently reads:

```ts
  const repo = await getRepository();
  const pgRepo = repo as import('@/lib/data/postgres/adapter').PostgresWorkoutRepository;

  // Load phase info once for automatic-mode programs
  let phases: ProgramPhase[] = []
  let phaseProgram: { id: string; startedAt?: string; sessionsPerCycle?: number; earlyDeloadWeekStart?: string } | null = null
  // Fetch count once before the batch; increment only when a workout session is newly inserted
  // (not on re-syncs of sessions already counted by countSessionsSinceStart, and not per exercise)
  let syncedSessionCount = 0
  const activeProgram = await repo.getActiveProgram(userId)
  if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
    phaseProgram = activeProgram
    phases = await repo.listProgramPhases(activeProgram.id)
    syncedSessionCount = await repo.countSessionsSinceStart(userId, activeProgram.id, activeProgram.startedAt)
  }

  for (const item of items) {
    const [y, m, d] = item.startedAt.slice(0, 10).split('-').map(Number);
    const dayStart = aestMidnight(y, m, d);
```

Change to:

```ts
  const repo = await getRepository();
  const pgRepo = repo as import('@/lib/data/postgres/adapter').PostgresWorkoutRepository;

  // Batch-check ownership of any pre-existing session/exercise-log rows so a
  // malicious payload can't overwrite another user's workout data via the
  // onConflictDoNothing/onConflictDoUpdate upserts below (write-IDOR).
  const sessionIds = [...new Set(items.map(i => i.workoutSessionId))]
  const exerciseLogIds = [...new Set(items.map(i => i.exerciseLogId))]
  const [sessionOwners, exerciseLogOwners] = await Promise.all([
    repo.getWorkoutSessionOwners(sessionIds),
    repo.getExerciseLogOwners(exerciseLogIds),
  ])
  let skipped = 0

  // Load phase info once for automatic-mode programs
  let phases: ProgramPhase[] = []
  let phaseProgram: { id: string; startedAt?: string; sessionsPerCycle?: number; earlyDeloadWeekStart?: string } | null = null
  // Fetch count once before the batch; increment only when a workout session is newly inserted
  // (not on re-syncs of sessions already counted by countSessionsSinceStart, and not per exercise)
  let syncedSessionCount = 0
  const activeProgram = await repo.getActiveProgram(userId)
  if (activeProgram?.phaseMode === 'automatic' && activeProgram.startedAt && activeProgram.sessionsPerCycle) {
    phaseProgram = activeProgram
    phases = await repo.listProgramPhases(activeProgram.id)
    syncedSessionCount = await repo.countSessionsSinceStart(userId, activeProgram.id, activeProgram.startedAt)
  }

  for (const item of items) {
    const existingSessionOwner = sessionOwners.get(item.workoutSessionId)
    const existingExerciseOwner = exerciseLogOwners.get(item.exerciseLogId)
    if ((existingSessionOwner && existingSessionOwner !== userId) ||
        (existingExerciseOwner && existingExerciseOwner !== userId)) {
      skipped++
      continue
    }

    const [y, m, d] = item.startedAt.slice(0, 10).split('-').map(Number);
    const dayStart = aestMidnight(y, m, d);
```

Then update the final response to surface skipped items:

```ts
  return NextResponse.json({ synced: items.length });
```

becomes:

```ts
  return NextResponse.json({ synced: items.length - skipped, skipped });
```

- [ ] **Step 4: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors from `repository.ts`, `adapter.ts`, or `sync-workout/route.ts`.

- [ ] **Step 5: Verify against the local dev DB**

Start the dev server:
```bash
pnpm dev
```

In the browser at `http://localhost:3000`, log in as `test@local.dev` / `testpass123`, start a workout, log at least one set, and finish the exercise. This calls `/api/sync-workout` (or `/api/log-exercise`, depending on the sync path) with a fresh `workoutSessionId`/`exerciseLogId` — both owned by the test user, so they pass the new check unchanged.

Then confirm the write-IDOR is actually blocked: find another user's existing `exercise_logs.id` in the seed data —

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -c "
  SELECT el.id AS exercise_log_id, ws.id AS workout_session_id, ws.user_id
  FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE ws.user_id <> (SELECT id FROM users WHERE email = 'test@local.dev')
  LIMIT 1;
"
```

If a row is returned, send a sync payload as `test@local.dev` reusing that `exercise_log_id` (and a fresh `workout_session_id`) via the browser's session cookie, e.g. from devtools console while logged in:

```js
fetch('/api/sync-workout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{
    workoutSessionId: crypto.randomUUID(),
    sessionName: 'IDOR test',
    startedAt: new Date().toISOString(),
    exerciseLogId: '<the other user exercise_log_id from above>',
    exercise: 'IDOR Test Exercise',
    loggedAt: new Date().toISOString(),
    estimated1rm: 999, target80: 999, volume: 999, avgReps: 99,
    setLogs: [{ id: crypto.randomUUID(), setNumber: 1, weightKg: 999, reps: 99, useFor1rm: false }],
  }]),
}).then(r => r.json()).then(console.log)
```

Expected: response is `{ synced: 0, skipped: 1 }`. Then re-run the `psql` query above for that `exercise_log_id`'s sets:

```bash
psql "$DATABASE_URL" -c "SELECT * FROM set_logs WHERE exercise_log_id = '<that id>';"
```

Expected: the other user's set row is **unchanged** (not overwritten with `weightKg: 999, reps: 99`). If no other-user row exists in the seed data (only `test@local.dev` is seeded), skip this manual exploit check — the unit-level reasoning in Step 3 plus the `tsc`/lint pass are sufficient, since this path is only reachable with another user's id.

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/sync-workout/route.ts
git commit -m "Block sync-workout write-IDOR via batched session/exercise-log ownership checks"
```

---

### Task 2: Use a timing-safe comparison for the Health Connect ingest secret

**Problem:** `app/api/health-connect/ingest/route.ts` compares the request's `secret` field to `process.env.HEALTH_CONNECT_INGEST_SECRET` with `!==`. JavaScript's string `!==` short-circuits on the first differing character, so the comparison time leaks information about how many leading characters of a guess are correct — a timing side-channel against a long-lived bearer secret.

**Files:**
- Modify: `app/api/health-connect/ingest/route.ts`

- [ ] **Step 1: Add a constant-time comparison helper and use it**

Current (lines 1-2, 30-33):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getRepositoryAsync } from "@/lib/data";
```

```ts
  const expectedSecret = process.env.HEALTH_CONNECT_INGEST_SECRET;
  if (!expectedSecret || body.secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

Change the imports to:

```ts
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getRepositoryAsync } from "@/lib/data";
```

Add a helper function above `POST` (after the `IngestBody` interface, before `export async function POST`):

```ts
// Constant-time string comparison — avoids leaking how many leading
// characters of a guessed secret matched via response timing.
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // keep timing constant regardless of length mismatch
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

Then change the secret check to:

```ts
  const expectedSecret = process.env.HEALTH_CONNECT_INGEST_SECRET;
  if (!expectedSecret || typeof body.secret !== "string" || !safeCompare(body.secret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 3: Verify locally**

Start the dev server (`pnpm dev`) and, with `HEALTH_CONNECT_INGEST_SECRET` set in `.env.local` (e.g. `HEALTH_CONNECT_INGEST_SECRET=test-secret` and `WEBHOOK_USER_ID=<a seeded user id>`), send two requests:

```bash
# correct secret — expect { "success": true, ... }
curl -s -X POST http://localhost:3000/api/health-connect/ingest \
  -H 'Content-Type: application/json' \
  -d '{"secret":"test-secret","steps":1000}'

# wrong secret — expect { "error": "Unauthorized" } with 401
curl -s -X POST http://localhost:3000/api/health-connect/ingest \
  -H 'Content-Type: application/json' \
  -d '{"secret":"wrong","steps":1000}'

# missing secret field entirely — expect 401, not a thrown TypeError
curl -s -X POST http://localhost:3000/api/health-connect/ingest \
  -H 'Content-Type: application/json' \
  -d '{"steps":1000}'
```

Expected: first call succeeds, second and third return `401 Unauthorized` with no server-side exception in the `pnpm dev` log.

- [ ] **Step 4: Commit**

```bash
git add app/api/health-connect/ingest/route.ts
git commit -m "Use constant-time comparison for Health Connect ingest secret"
```

---

### Task 3: Rate-limit the friend-request endpoint to mitigate email enumeration

**Problem:** `POST /api/friends` (`lib/data/postgres/adapter.ts:2266-2279`, `sendFriendRequest`) looks up a user by `email` or `friendCode` and throws a distinct `'User not found'` error if no match exists, vs. a `201` success (or `'Cannot add yourself'` / `'Friend request already exists'`) when a match does exist. The HTTP status (`201` vs `400`) alone is enough to confirm whether an arbitrary email address has a TrainingAI account — an attacker can script through a list of emails and observe which ones return `201`. There's currently no rate limit on this endpoint, so the list can be checked at full request speed.

**Fix:** Apply the same per-user rate limit already used on `/api/auth/register` (`lib/rate-limit.ts`) to `/api/friends` POST. This doesn't change the response semantics (still out of scope to redesign the friend-request UX), but caps enumeration to 10 guesses per signed-in account per 15 minutes — impractical for scanning an email list.

**Files:**
- Modify: `app/api/friends/route.ts`

- [ ] **Step 1: Add the rate limit to the POST handler**

Current:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepositoryAsync()
  const friendships = await repo.listFriendships(session.user.id)
  return NextResponse.json({ friendships })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { emailOrCode } = await req.json()
  if (!emailOrCode || typeof emailOrCode !== 'string') {
    return NextResponse.json({ error: 'emailOrCode required' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  try {
    const friendship = await repo.sendFriendRequest(session.user.id, emailOrCode.trim())
    return NextResponse.json({ friendship }, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
```

Change to:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepositoryAsync()
  const friendships = await repo.listFriendships(session.user.id)
  return NextResponse.json({ friendships })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 10 friend-request attempts per user per 15 minutes — limits how fast an
  // account can be used to enumerate registered emails via the 201/400 split
  // in sendFriendRequest below.
  if (!rateLimit(`friend-request:${session.user.id}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const { emailOrCode } = await req.json()
  if (!emailOrCode || typeof emailOrCode !== 'string') {
    return NextResponse.json({ error: 'emailOrCode required' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  try {
    const friendship = await repo.sendFriendRequest(session.user.id, emailOrCode.trim())
    return NextResponse.json({ friendship }, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 3: Verify locally**

Start the dev server (`pnpm dev`), log in as `test@local.dev` / `testpass123`, open the Friends UI (Profile/More → Friends), and send 11 friend requests in a row to non-existent emails (e.g. `nobody1@example.com` .. `nobody11@example.com`). Expected: the first 10 return the normal `'User not found'`-style error toast; the 11th returns `'Too many requests. Please try again later.'` (429).

- [ ] **Step 4: Commit**

```bash
git add app/api/friends/route.ts
git commit -m "Rate-limit friend requests to slow email-enumeration via sendFriendRequest"
```

---

## Self-Review Notes

- **Spec coverage:** All 3 confirmed security findings from the 2026-06-12 review are covered — sync-workout write-IDOR (Task 1), non-constant-time secret compare on health-connect ingest (Task 2), friend-request email enumeration (Task 3).
- **Independence:** Each task touches a disjoint set of files and can be implemented, tested, and committed without the others.
- **Type consistency:** Task 1's new `getWorkoutSessionOwners`/`getExerciseLogOwners` methods are added to both `WorkoutRepository` (interface) and `PostgresWorkoutRepository` (implementation) with matching signatures (`Map<string, string>`), and `inArray`/`eq` are already imported in `adapter.ts`.
- **No placeholders:** every step shows exact before/after code or exact commands with expected output.
