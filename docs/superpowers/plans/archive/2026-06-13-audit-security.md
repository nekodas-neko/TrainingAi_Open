> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the new security gaps found in the 2026-06-13 audit — a cross-tenant write IDOR and several unprotected/unbounded paid-AI and bulk-write endpoints.

**Architecture:** All routes already authenticate via `auth()` and scope repository queries by `userId`. The fixes add (a) ownership scoping to the one route that looks data up by id alone, (b) `rateLimit()` to the AI routes that lack it, and (c) Zod `.max()` bounds to unbounded write/AI payloads. No new abstractions — reuse `lib/rate-limit.ts` and existing Zod patterns.

**Tech Stack:** Next.js 15 route handlers, Zod, Drizzle ORM, `lib/rate-limit.ts` in-memory limiter.

> These are bug fixes to features already on `main`. Per CLAUDE.md the security items below may be committed directly without a feature branch once verified — but in this session keep them on the designated audit branch unless told otherwise.

---

## Findings addressed

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| N1 | **High** | `app/api/exercises/route.ts:25-27` → `adapter.ts:1711` | Any authenticated user can rename ANY exercise (no ownership check); rewrites every user's `session_exercises`, `exercise_logs`, `personal_records`. |
| N2 | **High** | `app/api/ai-chat/tts/route.ts` | No rate limit on the paid `gemini-2.5-flash-preview-tts` endpoint. |
| N3 | **Medium** | `lib/validators/tts.ts:3-5` | TTS `text` has no max length — multi-MB strings hit the paid model. |
| N4 | **Medium** | `app/api/exercises/generate/route.ts:19` | No rate limit on the `generateText` Gemini call. |
| N5 | **Medium** | `app/api/sync-health/route.ts:18` | Body cast `as SyncPayload` with no Zod/array bounds — unbounded bulk writes. |
| N6 | **Low** | `app/api/log-calendar-event/route.ts:20` | Body unvalidated; `exercises.map` 500s on bad input. |
| N7 | **Low** | `app/api/exercises/route.ts` POST | Library mutation exposed to any authenticated user (decide if admin-only). |

---

## Task 1: Fix cross-tenant IDOR in exercise rename (N1)

**Files:**
- Modify: `lib/data/repository.ts:134` (interface signature)
- Modify: `lib/data/postgres/adapter.ts:1711-1722` (`renameExercise`)
- Modify: `app/api/exercises/route.ts:25-33` (pass `userId`)

The rename is destructive across all users because it matches `session_exercises`/`exercise_logs`/`personal_records` by the OLD NAME globally. The minimal correct fix: only allow the rename when the caller owns the library row (`createdBy === userId`). Seeded/global catalogue rows have `createdBy = null` and must only be renamed by an admin — gate those via the existing admin route, not this one.

- [ ] **Step 1: Change the repository interface to require `userId`**

In `lib/data/repository.ts`, line 134, change:

```ts
  renameExercise(id: string, newName: string): Promise<ExerciseLibraryEntry>
```

to:

```ts
  renameExercise(userId: string, id: string, newName: string): Promise<ExerciseLibraryEntry>
```

- [ ] **Step 2: Scope the adapter lookup by ownership**

In `lib/data/postgres/adapter.ts`, replace the `renameExercise` method (lines 1711-1722) with:

```ts
  async renameExercise(userId: string, id: string, newName: string): Promise<ExerciseLibraryEntry> {
    return await this.db.transaction(async tx => {
      const [existing] = await tx.select().from(s.exerciseLibrary).where(eq(s.exerciseLibrary.id, id))
      if (!existing) throw new Error('Exercise not found')
      if (existing.createdBy !== userId) throw new Error('Not authorized to rename this exercise')
      const oldName = existing.name
      await tx.update(s.sessionExercises).set({ exerciseName: newName }).where(eq(s.sessionExercises.exerciseName, oldName))
      await tx.update(s.exerciseLogs).set({ exerciseName: newName }).where(eq(s.exerciseLogs.exerciseName, oldName))
      await tx.update(s.personalRecords).set({ exerciseName: newName }).where(eq(s.personalRecords.exerciseName, oldName))
      const [row] = await tx.update(s.exerciseLibrary).set({ name: newName }).where(eq(s.exerciseLibrary.id, id)).returning()
      return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [], instructions: row.instructions ?? undefined, createdBy: row.createdBy ?? undefined, exerciseType: (row.exerciseType as ExerciseType) ?? 'weighted' }
    })
  }
```

> Note: the cross-user reference updates (`session_exercises` etc.) match by NAME, so renaming a user's own exercise still touches only rows that share that name. Since names are intended to be unique per the `createExercise` unique-constraint handling, this is acceptable. If shared-name collisions across users are a real concern, a follow-up should scope those updates by `userId` too — out of scope for this fix.

- [ ] **Step 3: Pass `userId` from the route**

In `app/api/exercises/route.ts`, update the `mergeWithId` branch (lines 25-33):

```ts
  if (body.data.mergeWithId) {
    try {
      const exercise = await repo.renameExercise(session.user.id, body.data.mergeWithId, body.data.name)
      return NextResponse.json({ exercise })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Rename failed'
      const status = msg.includes('Not authorized') ? 403 : 400
      return NextResponse.json({ error: msg }, { status })
    }
  }
```

- [ ] **Step 4: Find and update any other callers**

Run: `grep -rn "renameExercise(" --include=*.ts --include=*.tsx app lib | grep -v "renameExerciseRefs"`
Expected: only the route call site (now updated) and the interface/adapter definitions. If an admin route calls it, update that call to pass the admin's `userId` (admins owning a row) or use a separate admin-scoped path. If none other, proceed.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no signature mismatches).

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/exercises/route.ts
git commit -m "Scope exercise rename to the owning user to prevent cross-tenant data corruption"
```

---

## Task 2: Rate-limit + bound the TTS endpoint (N2, N3)

**Files:**
- Modify: `lib/validators/tts.ts:3-5`
- Modify: `app/api/ai-chat/tts/route.ts`

- [ ] **Step 1: Add a max length to the TTS schema**

Replace `lib/validators/tts.ts` lines 3-5:

```ts
export const ttsSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000, "Text too long"),
});
```

- [ ] **Step 2: Read the TTS route to find the auth/userId anchor**

Run: `grep -n "auth()\|userId\|session.user\|export async function POST" app/api/ai-chat/tts/route.ts`
Expected: an `auth()` call and a `session.user.id` guard already exist (added in S8).

- [ ] **Step 3: Add the rate limit immediately after the userId guard**

Add this import near the top of `app/api/ai-chat/tts/route.ts` (match existing import style):

```ts
import { rateLimit } from '@/lib/rate-limit'
```

Immediately after the `session.user.id` guard (the line that returns 401 when unauthenticated), insert:

```ts
  const userId = session.user.id
  if (!rateLimit(`tts:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
```

> Use the exact `rateLimit(key, limit, windowMs)` signature already used in `app/api/ai-chat/route.ts`. Verify the signature with: `grep -n "export function rateLimit" lib/rate-limit.ts`.

- [ ] **Step 4: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/tts.ts app/api/ai-chat/tts/route.ts
git commit -m "Rate-limit and length-bound the TTS endpoint to prevent paid-API abuse"
```

---

## Task 3: Rate-limit the exercise-generation AI route (N4)

**Files:**
- Modify: `app/api/exercises/generate/route.ts`

- [ ] **Step 1: Read the route to find the userId guard**

Run: `grep -n "auth()\|session.user\|export async function POST\|import" app/api/exercises/generate/route.ts`
Expected: an `auth()` + `session.user.id` guard already present.

- [ ] **Step 2: Add rate limiting after the userId guard**

Add `import { rateLimit } from '@/lib/rate-limit'` to the imports, then after the `session.user.id` guard insert:

```ts
  if (!rateLimit(`exercise-gen:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/exercises/generate/route.ts
git commit -m "Rate-limit the AI exercise-generation endpoint"
```

---

## Task 4: Bound the sync-health payload (N5)

**Files:**
- Modify: `app/api/sync-health/route.ts`

- [ ] **Step 1: Read the route and the SyncPayload shape**

Run: `grep -n "SyncPayload\|dailyMetrics\|exerciseSessions\|sleepRecords\|as SyncPayload\|export async function POST" app/api/sync-health/route.ts`
Expected: `const body = (await req.json()) as SyncPayload` with three arrays iterated for upsert.

- [ ] **Step 2: Add a bounded Zod schema and parse instead of cast**

Add `import { z } from 'zod'` if not present. Define a schema near the top of the file (adjust field names to match the existing `SyncPayload` interface — read it first):

```ts
const SyncHealthBody = z.object({
  dailyMetrics:     z.array(z.record(z.unknown())).max(400).default([]),
  exerciseSessions: z.array(z.record(z.unknown())).max(400).default([]),
  sleepRecords:     z.array(z.record(z.unknown())).max(400).default([]),
}).passthrough()
```

Replace the `as SyncPayload` cast with:

```ts
  const parsed = SyncHealthBody.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const body = parsed.data as unknown as SyncPayload
```

> If the per-item shapes are well-defined in the `SyncPayload` interface, tighten `z.record(z.unknown())` to a proper object schema with numeric bounds — but the `.max(400)` array cap is the security-critical part (prevents thousands of writes per request).

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync-health/route.ts
git commit -m "Bound sync-health array sizes to prevent unbounded bulk writes"
```

---

## Task 5: Validate the calendar-event body (N6)

**Files:**
- Modify: `app/api/log-calendar-event/route.ts:20-47`

- [ ] **Step 1: Read the handler to see the fields consumed**

Run: `grep -n "exercises\|setWeights\|reps\|await req.json\|\.map(" app/api/log-calendar-event/route.ts`

- [ ] **Step 2: Add a tolerant Zod schema**

Add `import { z } from 'zod'`, define above the handler:

```ts
const CalendarBody = z.object({
  exercises:  z.array(z.string()).max(50).default([]),
  setWeights: z.array(z.array(z.number())).max(50).optional(),
  reps:       z.array(z.array(z.number())).max(50).optional(),
}).passthrough()
```

Replace the raw `await req.json()` read with:

```ts
  const parsed = CalendarBody.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { exercises } = parsed.data
```

…and use `parsed.data` fields downstream. This makes `exercises.map` safe (defaults to `[]`).

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add app/api/log-calendar-event/route.ts
git commit -m "Validate calendar-event body to avoid 500s on malformed input"
```

---

## Task 6: Decide library-mutation access policy (N7)

**Files:**
- Possibly modify: `app/api/exercises/route.ts` POST (create branch)

This is a product decision, not a clear bug. The `exercise_library` is a shared global catalogue, but `createExercise` is open to any authenticated user (rows tagged with `createdBy`). After Task 1, users can only RENAME their own rows, so the remaining question is whether arbitrary users should be able to ADD catalogue rows at all.

- [ ] **Step 1: Confirm intended product behaviour with the user**

Use `AskUserQuestion`: "Should any logged-in user be able to add custom exercises to the shared library (current behaviour), or should library additions be admin-only?" Options: keep open (custom exercises are a feature) / make admin-only.

- [ ] **Step 2 (only if admin-only chosen): Gate the create branch**

Add `import { requireAdmin } from '@/lib/admin'` and at the top of the create branch:

```ts
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

> Verify the exact `requireAdmin` signature/return with `grep -n "export.*requireAdmin" lib/admin.ts` before using.

- [ ] **Step 3: Commit (if changed)**

```bash
git add app/api/exercises/route.ts
git commit -m "Gate exercise-library creation behind admin check"
```

---

## Verification before completion (whole plan)

- [ ] Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test` — all PASS.
- [ ] Manual IDOR check (local DB): start `pnpm dev`, log in as the seeded `test@local.dev`, POST `/api/exercises` with `{ "name": "x", "mergeWithId": "<a seeded global exercise id with null createdBy>" }`; expect `403 Not authorized`, and confirm the seeded exercise name is unchanged in the DB.
- [ ] Confirm `grep -rn "renameExercise(" app lib | grep -v Refs` shows only updated call sites.
- [ ] Push: `git push -u origin claude/app-comprehensive-audit-goew61` (retry with backoff on network error).

## Local testing notes (per CLAUDE.md)
- **Pull:** `git pull origin claude/app-comprehensive-audit-goew61`
- **What to look for:** `/api/exercises` rename now returns 403 for non-owned rows; TTS and exercise-gen return 429 after the limit; oversized sync-health/calendar bodies return 400.
- **How to test:** use the local seeded DB; the unprotected paths previously returned 200 for any payload.
