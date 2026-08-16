# R1 — Security & Ownership Hardening

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §1 (batch R1).
**Branch:** `fix/security-ownership-hardening`. **Server/JS only** — every change is an API
route or a repository/adapter function; it ships via Railway into the WebView with **no APK
rebuild**, and is fully testable against the local dev Postgres (`pnpm db:local` + `pnpm dev`).
No DB migration is required by any chunk. Where a write path that a synced domain uses changes
(SEC-6 supplements PATCH), the **`pushMutations` branch must be kept in parity** with the route
per the CLAUDE.md sync-mirroring rule — noted inline.

**CLAUDE.md rules in force:** *Security checks fail closed* (SEC-H1/H2); *write-path ownership
discipline* — affected-row-count check before any dependent child write, no unscoped child
DELETE, no raw request body into `.set()`, client-supplied upsert ids ownership-verified even
without a `user_id` column (SEC-1/2/3/6); *one write function per domain / push mirroring*
(SEC-6); *ingest/AI/expensive routes get a rate limit + Zod at creation* (SEC-H3/H4/H5/H6);
*no silent info leaks on failure paths* (SEC-4/5).

**Verification status of the review's findings against current `main` (2026-07-09):** all
twelve findings were re-opened at the cited files and **all still reproduce**. Line numbers
below are current. Nothing in this batch was already fixed.

**Goal:** close the review's ownership, mass-assignment, fail-open and unbounded-input holes so
no request can wipe, steal, reassign, or flood another user's rows.

---

## Chunk 1 — Ownership row-count + unscoped child writes (SEC-1, SEC-2, SEC-3) — highest severity

The recurring class: a user-scoped parent UPDATE whose affected-row count is never checked,
followed by an **unscoped** child DELETE + re-insert (or a bare-id upsert). A foreign parent id
survives the no-op UPDATE and then has its children wiped/overwritten. Reference fix: the
`.returning()` row-count guard in `updateInjury` (`adapter.ts:4040-4056`) and the
`assertOwnership` join in `app/api/workout-entry/route.ts:8-16`.

### Task 1.1 — SEC-1 `saveProgressionStyle` (`lib/data/postgres/slices/programs.ts:675-710`)

Current code (675-696) runs the scoped UPDATE with no row-count check, sets
`styleId = style.id` unconditionally, then `tx.delete(s.styleSets).where(eq(styleSets.styleId, styleId))`
(unscoped) + re-insert. A `POST /api/progression-styles` (`route.ts:19-37`, un-Zod'd body)
carrying another user's style UUID wipes that style's sets. Fix — guard the UPDATE branch:

```ts
if (style.id) {
  // Bump updatedAt so set-only edits (which don't change the name) still
  // surface in the sync delta, which keys the style subtree off this column.
  const updated = await tx.update(s.progressionStyles)
    .set({ name: style.name, updatedAt: new Date() })
    .where(and(eq(s.progressionStyles.id, style.id), eq(s.progressionStyles.userId, userId)))
    .returning({ id: s.progressionStyles.id })
  if (updated.length === 0) throw new Error('Progression style not found')
  styleId = updated[0].id
} else {
  // …unchanged insert-with-onConflict branch…
}
```

After the guard, `styleId` is proven owned, so the existing `tx.delete(s.styleSets)…` +
re-insert is safe as written (no further scoping needed — `style_sets` has no `user_id`, and its
parent is now verified). No route change: the thrown error surfaces as a 500, which is the
correct fail-closed response for a forged id (matches `updateInjury`/`updateMealType`).

**Verify:** `pnpm exec tsc --noEmit`. Dev-DB curl: create style A as the seed user, note its id
and set count; `POST /api/progression-styles` with `{style:{id:"<A's id>", name:"x", sets:[]}}`
authenticated as a *second* user → expect the request to fail and `style_sets` for A **unchanged**
(`SELECT count(*) FROM style_sets WHERE style_id='<A>'`). Repeat with the owner → succeeds.

### Task 1.2 — SEC-2 `updateSavedMeal` (`lib/data/postgres/slices/nutrition.ts:342-350`)

Same class via `PUT /api/nutrition/saved-meals/[id]` (`route.ts:5-17`). Current: scoped name
UPDATE, unchecked, then `db.delete(s.savedMealItems).where(eq(savedMealItems.savedMealId, id))`
(unscoped) + re-insert. Wrap in a transaction, guard the UPDATE, and fix the two low-severity
sub-findings in the same edit:

```ts
export async function updateSavedMeal(db: Db, id: string, userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[]): Promise<SavedMeal> {
  await db.transaction(async tx => {
    const updated = await tx.update(s.savedMeals).set({ name })
      .where(and(eq(s.savedMeals.id, id), eq(s.savedMeals.userId, userId)))
      .returning({ id: s.savedMeals.id })
    if (updated.length === 0) throw new Error('Saved meal not found')

    // Ownership-verify every referenced food item belongs to this user before
    // re-inserting — a saved meal must not embed another user's food_items rows.
    if (items.length > 0) {
      const ids = [...new Set(items.map(i => i.foodItemId))]
      const owned = await tx.select({ id: s.foodItems.id }).from(s.foodItems)
        .where(and(eq(s.foodItems.userId, userId), inArray(s.foodItems.id, ids)))
      if (owned.length !== ids.length) throw new Error('Unknown food item')
    }

    await tx.delete(s.savedMealItems).where(eq(s.savedMealItems.savedMealId, id))
    if (items.length > 0) {
      await tx.insert(s.savedMealItems).values(items.map(i => ({ savedMealId: id, ...i })))
    }
  })
  const all = await listSavedMeals(db, userId)
  return all.find(m => m.id === id)!
}
```

Also SEC-2 (low) **stable ingredient order**: `listSavedMeals` (line ~305-307) selects
`savedMealItems` with no `ORDER BY`, so ingredient order shuffles between reads. Add
`.orderBy(asc(s.savedMealItems.id))` to that `itemRows` query. Confirm `inArray`/`asc` are
already imported in this file (they are — used elsewhere in the slice).

**Verify:** `tsc`. Dev-DB: as user B, `PUT /api/nutrition/saved-meals/<A's meal id>` → fails,
A's `saved_meal_items` intact. As the owner with a `foodItemId` belonging to another user →
`Unknown food item`. Reorder check: GET a saved meal twice → identical item order.

### Task 1.3 — SEC-3 `logExerciseAndSets` bare-id upserts (`lib/data/postgres/adapter.ts:790-878`)

The exercise-log id and each set-log id are **client-supplied** (`log-exercise.ts:191-205`
threads `clientExerciseLogId`/`clientSetLogIds`). The upserts use `onConflictDoUpdate` on bare
`exercise_logs.id` (828-845) and `set_logs.id` (861-876) with **no `setWhere`/pre-check**, and
the exercise-log SET reassigns `workout_session_id = EXCLUDED` (831). These tables have no
`user_id` column. `ensureWorkoutSession` already guards the *session* id
(`adapter.ts:683-689`, scoped `AND user_id`), so a forged `workoutSessionId` is rejected — but a
forged **log/set id that collides with another user's row** is not: the upsert overwrites that
row and moves it into the attacker's session. The replay-detection SELECT (805-808) checks
existence by id with no ownership join. Fix — thread `userId` in and pre-check ownership of any
colliding ids by joining `workout_sessions`.

1. **Signature** — add `userId` as the first parameter in `lib/data/repository.ts:340-343` and
   `adapter.ts:790-793`, and pass it at the call site `lib/workout/log-exercise.ts:191`
   (`userId` is already in scope in `logExerciseFromPayload`):

```ts
// repository.ts
logExerciseAndSets(
  userId: string,
  log: Omit<ExerciseLog, 'id' | 'sets'> & { exerciseLogId?: string },
  sets: (Omit<SetLog, 'id' | 'exerciseLogId'> & { id?: string })[],
): Promise<{ exerciseLog: ExerciseLog; setLogs: SetLog[] }>
```

2. **Pre-check inside the transaction**, right after `clientExerciseLogId` is resolved (replaces
   the existing bare replay SELECT at 805-808 — fold ownership into the same query):

```ts
// Replay detection AND ownership: an existing exercise_log id must belong to a
// workout_session owned by this user. A colliding id under someone else's session
// would otherwise be overwritten (and reassigned into this user's session) by the
// bare-id upsert below — a cross-user row theft. exercise_logs has no user_id, so
// ownership is via the workout_sessions join (the assertOwnership pattern).
const [existing] = await tx.select({ ownerId: s.workoutSessions.userId })
  .from(s.exerciseLogs)
  .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
  .where(eq(s.exerciseLogs.id, clientExerciseLogId))
  .limit(1)
if (existing && existing.ownerId !== userId) {
  throw new Error('exercise log not owned by user')
}
const isReplay = !!existing

// Same guard for client-supplied set ids: reject any that already exist under
// another user's exercise log.
const clientSetIds = sets.map(st => st.id).filter((v): v is string => !!v)
if (clientSetIds.length > 0) {
  const foreign = await tx.select({ id: s.setLogs.id })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
    .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
    .where(and(inArray(s.setLogs.id, clientSetIds), ne(s.workoutSessions.userId, userId)))
    .limit(1)
  if (foreign.length > 0) throw new Error('set log not owned by user')
}
```

`ne` and `inArray` are already imported in `adapter.ts`. Keep the existing `isReplay` usage
(user_stats increment skip) — this replaces the old `alreadyLogged` SELECT, so remove that block
to avoid a duplicate query.

**Verify:** `tsc` + the existing parity test (`lib/data/postgres/__tests__/push-mutations-web-parity.test.ts`)
still green. Dev-DB: log an exercise as user A, capture its `exercise_log` id and a `set_log` id;
as user B POST `/api/log-exercise` with `exerciseLogId`/`setLogIds` set to A's ids (and B's own
`workoutSessionId`) → request fails, A's row still points at A's session
(`SELECT workout_session_id FROM exercise_logs WHERE id='<A>'` unchanged). Normal same-user
replay (re-POST identical payload) still succeeds and does not double-count `user_stats`.

---

## Chunk 2 — Mass assignment via raw `.set(body)` (SEC-6, = SYNC-P2)

`userId`, `deletedAt`, `createdAt` are all settable Drizzle column keys; the TypeScript `Omit<>`
on the repo signatures is compile-time only, so a raw request body reaches `.set()` at runtime.
A `PATCH {"userId":"<other-uuid>"}` moves the row to another account. Reference: the explicit
field allow-list in `updateInjury` (`adapter.ts:4040-4056`). Whitelist at the **route** with Zod
(the house pattern for request bodies) so the driver only ever receives vetted fields.

### Task 2.1 — SEC-6a supplements PATCH (`app/api/supplements/[id]/route.ts:5-13` → `updateSupplement` `adapter.ts:4094-4101`)

Route currently does `repo.updateSupplement(id, session.user.id, body)` with `body = await req.json()`
passed straight through to `.set(data)`. Add a Zod whitelist in the route:

```ts
import { z } from 'zod'

const SupplementPatchSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  dose:            z.string().max(200).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime:    z.string().max(20).nullable().optional(),
  sortOrder:       z.number().int().min(0).max(10_000).optional(),
  active:          z.boolean().optional(),
}).strict()   // reject unknown keys (userId/deletedAt/createdAt) outright

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = SupplementPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const supplement = await repo.updateSupplement(id, session.user.id, parsed.data)
  return NextResponse.json(supplement)
}
```

`updateSupplement` itself may keep `.set(data)` now that `data` is whitelisted — but for
defence-in-depth and to match `updateInjury`, optionally also convert it to explicit
field-by-field assignment. The Zod `.strict()` at the route is the load-bearing fix.

**Sync mirroring (SYNC-P2):** the supplements outbox branch in `pushMutations`
(`adapter.ts:3066-3081`) already **reconstructs** the supplement field-by-field via
`createSupplement` (it never spreads a raw payload into `.set()`), so the push path is already
safe. No push change is needed — but state this in the PR review so the parity is on record, and
do **not** "simplify" the push branch into a raw spread.

### Task 2.2 — SEC-6b meal-types PUT (`app/api/nutrition/meal-types/[id]/route.ts:5-14` → `updateMealType` `slices/nutrition.ts:75-82`)

Identical hole: `repo.updateMealType(id, userId, body)` with raw `body` into `.set(data)`. Add a
strict Zod whitelist in the route (mirror the shape of `createMealType`'s allowed fields —
`name`, `emoji`, `sortOrder`, `timeStartHour`, `timeEndHour`):

```ts
const MealTypePutSchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  emoji:         z.string().max(16).nullable().optional(),
  sortOrder:     z.number().int().min(0).max(10_000).optional(),
  timeStartHour: z.number().int().min(0).max(24).nullable().optional(),
  timeEndHour:   z.number().int().min(0).max(24).nullable().optional(),
}).strict()
```

Parse with `.safeParse`, 400 on failure, pass `parsed.data` to `updateMealType`.

**Verify (both):** `tsc`. Dev-DB: as user B, `PATCH /api/supplements/<A's id>` with
`{"userId":"<B>"}` → 400 (unknown key rejected); confirm A's supplement `user_id` unchanged.
Legitimate `{"name":"Creatine"}` PATCH by the owner → 200 and persists. Same two cases for
meal-types PUT.

---

## Chunk 3 — Fail-closed webhook + token crypto (SEC-H1, SEC-H2)

### Task 3.1 — SEC-H1 Oura token encryption fails open (`lib/oura/token-crypto.ts:12-21`)

`encryptToken` returns **plaintext** when `TOKEN_ENC_KEY` is absent (line 14: `if (!key) return plaintext`).
A missing key silently stores PATs/OAuth tokens in the clear. Fail closed at write time; keep
`decryptToken` tolerant of legacy plaintext (unprefixed) rows so existing data still reads:

```ts
export function encryptToken(plaintext: string): string {
  const key = getKey()
  if (!key) {
    // Fail closed: storing a bearer token in plaintext is a silent security
    // downgrade. A missing key is a deployment error, not a fallback.
    throw new Error('TOKEN_ENC_KEY is not configured — refusing to store an unencrypted token')
  }
  // …unchanged…
}
```

`decryptToken` stays as-is: it already returns the value untouched when it lacks the `v1:` prefix
(pre-encryption rows) or when the key is missing — do not make the *read* path throw, or existing
plaintext rows become unreadable. Add a **loud startup warning** so a missing key is visible
before the first token write — e.g. in the module body:

```ts
if (!process.env.TOKEN_ENC_KEY) {
  console.warn('[token-crypto] TOKEN_ENC_KEY unset — token writes will fail closed')
}
```

Callers of `saveOuraPat`/`saveOuraOAuthTokens` already run inside route try/catch that returns a
JSON error, so the thrown error surfaces as a clean 500 rather than crashing.

**Verify:** unit test in `lib/oura/__tests__/` (or extend an existing one): with
`TOKEN_ENC_KEY` unset, `encryptToken('x')` throws; with a valid 32-byte hex key,
round-trips `decryptToken(encryptToken('x')) === 'x'`; `decryptToken('legacyplaintext')` (no
prefix) returns it unchanged. `pnpm exec tsc --noEmit`.

### Task 3.2 — SEC-H2 webhook echoes the signing key + stale-JWT admin gate (`app/api/oura/webhooks/route.ts`)

Two issues:
1. **POST leaks the HMAC signing key** — line 36 returns `{ success: true, signingKey }`. The
   signing key is the secret that authenticates every inbound Oura webhook; it must never travel
   in a response body. `registerAllWebhooks` already persists it server-side
   (`saveWebhookSigningKey`); the route just needs to confirm success.
2. **GET/POST/DELETE gate on `session.user.isAdmin`** (JWT flag, stamped at login, stale up to
   30 days) instead of `requireAdmin()`'s authoritative DB check (`lib/admin.ts:15-20`).

Fix — replace each `if (!session?.user?.isAdmin) …403` with the `requireAdmin` try/catch pattern,
and drop `signingKey` from the POST response:

```ts
import { requireAdmin, AdminError } from '@/lib/admin'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { await requireAdmin(session.user.id) }
  catch (e) { if (e instanceof AdminError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); throw e }

  const creds = clientCreds()
  const callbackUrl = process.env.OURA_WEBHOOK_CALLBACK_URL
  const verificationToken = process.env.OURA_WEBHOOK_VERIFICATION_TOKEN
  if (!creds || !callbackUrl || !verificationToken) {
    return NextResponse.json({ error: 'Missing OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_WEBHOOK_CALLBACK_URL, or OURA_WEBHOOK_VERIFICATION_TOKEN' }, { status: 503 })
  }
  await registerAllWebhooks(creds.clientId, creds.clientSecret, callbackUrl, verificationToken)
  return NextResponse.json({ success: true })   // signingKey stays server-side
}
```

Apply the same `requireAdmin` gate to GET (line 14) and DELETE (line 42). `requireAdmin` is
already `async` and does a `getUserById` round-trip — that is the point (rare admin calls).

**Verify:** `tsc`. Dev-DB: seed user has `isAdmin=false` by default → `GET/POST /api/oura/webhooks`
→ 403. Flip `users.is_admin=true` for the seed user in the local DB, re-auth → 200 and the POST
response body contains **no** `signingKey` field (`SELECT webhook_signing_key FROM oura_tokens`
confirms it was still persisted).

---

## Chunk 4 — Rate-limit + input-bound hardening (SEC-H3, H4, H5, H6)

House pattern: `rateLimit(key, limit, windowMs)` from `lib/rate-limit.ts` returning `false` →
429, and `readJsonLimited(req, maxBytes)` from `lib/http/request-guards.ts` for size-guarded
bodies. Reference route: `app/api/client-error/route.ts:12-39`. Match sibling limits.

### Task 4.1 — SEC-H3 add rate limits to ingest/sync routes

- **`app/api/oura/sync/route.ts:32`** — no limiter today; it fans out ~14 upstream Oura calls
  per request. Add after the auth check:
  ```ts
  if (!rateLimit(`oura-sync:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  ```
- **`app/api/oura/hr-sync/route.ts:9`** — add `rateLimit(\`oura-hr-sync:${session.user.id}\`, 20, 60_000)`
  after the auth check (it is fire-and-forget from complete-workout, so keep the window generous).
- **`app/api/health-connect/ingest/route.ts`** — already has a Zod schema (15-26) and constant-time
  secret compare; it lacks a rate limit. Key off the shared-secret path (no session): use the
  client IP, and place it **after** `safeCompare` succeeds so a valid Tasker call is limited but a
  brute-force on the secret is separately bounded:
  ```ts
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!rateLimit(`hc-ingest:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  ```
  (Add a second pre-auth limiter `hc-ingest-auth:${ip}` at 20/min before `safeCompare` if brute
  force on the secret is a concern — optional; the secret is already constant-time compared.)

Import `rateLimit` where not present (`mood`/`register` already import it; the three above do not
except via new imports).

### Task 4.2 — SEC-H4 `POST /api/feedback` — limiter + bounded body (`app/api/feedback/route.ts`)

Currently: no rate limit, `title`/`description` unbounded (only screenshot is capped at 500 KB),
plain `req.json()`. Match `client-error`: add `rateLimit`, switch to `readJsonLimited`, and bound
the text fields.

```ts
import { readJsonLimited } from '@/lib/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

const MAX_BODY_BYTES = 600 * 1024   // screenshot data URI dominates; keep headroom over 500KB cap

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`feedback:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })
  const { type, title, description, screenshotData } = result.body as {
    type?: unknown; title?: unknown; description?: unknown; screenshotData?: unknown
  }
  if (typeof type !== 'string' || !['bug', 'feature', 'other'].includes(type)) {
    return NextResponse.json({ error: 'type must be bug, feature, or other' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (screenshotData != null && (typeof screenshotData !== 'string' || screenshotData.length > MAX_SCREENSHOT_BYTES)) {
    return NextResponse.json({ error: 'Screenshot too large' }, { status: 400 })
  }
  await (await getRepository()).createFeedback(session.user.id, {
    type,
    title: title.trim().slice(0, 200),
    description: typeof description === 'string' ? description.trim().slice(0, 4000) || null : null,
    screenshotData: (screenshotData as string) || null,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

Keep `MAX_SCREENSHOT_BYTES = 500_000`.

### Task 4.3 — SEC-H5 `PATCH /api/workout-entry` — Zod-bound the arrays (`app/api/workout-entry/route.ts:19-35`)

No Zod today; `weights`/`reps` are unbounded arrays iterated into an insert loop (75-86) — a
100k-element body means 100k INSERTs. Bound them exactly like `LogExercisePayloadSchema`
(`lib/workout/log-exercise.ts:15-16`): arrays `.min(1).max(20)`, weights `-100..500`, reps
`0..100`.

```ts
import { z } from 'zod'

const WorkoutEntryPatchSchema = z.object({
  exerciseLogId: z.string().uuid(),
  weights:       z.array(z.number().min(-100).max(500)).min(1).max(20),
  reps:          z.array(z.number().int().min(0).max(100)).min(1).max(20),
}).strict()
```

Replace the manual `body`/presence checks (24-31) with `safeParse`; on failure return 400. The
`assertOwnership` join (33-35) stays. **Same-PR — WK-17:** `DELETE /api/workout-sessions`
(`route.ts:12-19`) also has no schema (only a truthy `workoutSessionId` check). It takes a single
id and `deleteWorkoutSession` scopes the delete to the user, so the blast radius is small — add a
one-line `z.string().uuid()` guard for consistency rather than the full treatment:

```ts
const parsed = z.object({ workoutSessionId: z.string().uuid() }).safeParse(await req.json().catch(() => null))
if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
```

### Task 4.4 — SEC-H6 `POST /api/mood` + `POST /api/auth/register` typing/bounds

- **`app/api/mood/route.ts:21-46`** — has a rate limit already, but `energyLevel`/`bodyState`/
  `soreMuscles` are untyped passthrough (`bodyState`/`soreMuscles` are unbounded arrays). Add a
  Zod schema after the rate-limit check:
  ```ts
  const MoodSchema = z.object({
    energyLevel:  z.number().int().min(1).max(5),
    sleepQuality: z.enum(['poor', 'ok', 'good']).optional(),   // confirm the enum against saveMoodLog's accepted values
    bodyState:    z.array(z.string().max(40)).max(20).optional(),
    soreMuscles:  z.array(z.string().max(40)).max(30).optional(),
  })
  ```
  Parse `await req.json()`; 400 on failure; pass `parsed.data` with the existing
  `?? 'ok'` / `?? []` defaults. **Confirm** `energyLevel`'s real domain and the `sleepQuality`
  literals against `saveMoodLog`/`mood_logs` before finalising the schema (the review only
  flagged the passthrough; do not narrow the type more tightly than the column accepts).
- **`app/api/auth/register/route.ts:13-23`** — rate-limited already. Add upper bounds before the
  bcrypt hash (a multi-MB password is a bcrypt-cost DoS; `name` is unbounded):
  ```ts
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return NextResponse.json({ error: 'Password must be 8–200 characters.' }, { status: 400 })
  }
  if (name != null && (typeof name !== 'string' || name.length > 100)) {
    return NextResponse.json({ error: 'Name too long.' }, { status: 400 })
  }
  ```
  Keep the existing email regex and `< 8` message intent (fold into the range check above).

**Verify (Chunk 4):** `pnpm lint && pnpm exec tsc --noEmit`; existing rate-limit tests
(`lib/__tests__/rate-limit.test.ts`, `register-inactive.test.ts`, `request-guards.test.ts`)
green. Dev-DB curls: hammer `POST /api/oura/sync` 11× in a minute → 11th returns 429; `POST
/api/feedback` with a 700 KB body → 400 `too_large`; `PATCH /api/workout-entry` with
`weights` of length 100 → 400; `POST /api/mood` with `energyLevel:"x"` → 400 and with a valid
payload → 200; `register` with a 5,000-char password → 400.

---

## Chunk 5 — Info-leak on read/failure paths (SEC-4, SEC-5) — lowest severity

### Task 5.1 — SEC-4 unscoped `programId` read leak (`app/api/ai-periodization/weekly-volume/route.ts:15-34`)

The route accepts `?programId=` and passes it straight to `repo.listVolumeTargets(programId)`
(`slices/periodization.ts:204-210`, which filters only by `program_id`, no user scope) **and** to
`getWeeklySetsByMuscleGroup(userId, programId, …)`. The volume targets of any program id are
returned regardless of owner. The `!programId` branch (17-21) already resolves a user-owned
program — verify the supplied id the same way. There is no user-scoped `getProgramById`, but
`listPrograms(userId)` returns the user's programs:

```ts
let programId = searchParams.get('programId') ?? null
if (programId) {
  const owned = await repo.listPrograms(userId)
  if (!owned.some(p => p.id === programId)) {
    return NextResponse.json({ error: 'Program not found' }, { status: 404 })
  }
} else {
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ error: 'No active program' }, { status: 404 })
  programId = program.id
}
```

`replaceVolumeTargets`/`deleteVolumeTarget` are also program-scoped-only but are internal
(no external route passes an unverified id) — leave them, note in the PR they rely on their
callers already resolving an owned program.

### Task 5.2 — SEC-5 stringified internal errors in responses

- **`app/api/phase-sets/clone/route.ts:53`** returns `{ error: 'Failed to create phase set', detail: String(err) }`.
  Drop `detail`; keep the server-side `console.error` (52):
  ```ts
  return NextResponse.json({ error: 'Failed to create phase set' }, { status: 500 })
  ```
- **`app/api/ai-chat/route.ts:166-168`** returns `NextResponse.json({ error: errMsg })` where
  `errMsg = errorLog(error, …)` — and `errorLog` (`lib/logger.ts:1-17`) builds
  `[ERROR]: ${error} …`, i.e. the raw error string. `errorLog` already logs server-side, so keep
  the call for logging but return a generic message:
  ```ts
  errorLog(error, 'API /ai-chat')   // logs server-side
  return NextResponse.json({ error: 'Chat failed' }, { status: StatusCodes.INTERNAL_SERVER_ERROR })
  ```

**Verify:** `tsc`. Dev-DB: `GET /api/ai-periodization/weekly-volume?programId=<another user's program id>`
→ 404, not that program's targets; owner's own id and the no-param default still return data.
Force a phase-set clone failure (e.g. bad `phaseSetId` that passes the presence check but fails
downstream) → response body has no `detail`; server log still shows the stack.

---

## Cross-cutting verification

Run once at the end, on a branch started from fresh `origin/main`:

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

Then `pnpm dev` against the local seeded DB and walk the per-chunk curl checks above. State
explicitly in the merge writeup which surfaces were **not** exercised in the sandbox — none of
these touch native SQLite, safe-area, gestures, or real Oura/Health-Connect tokens, so the web
dev DB is an authoritative test surface for every chunk **except** SEC-H1 (token crypto — verified
by unit test, not a live Oura token) and SEC-H3's `health-connect/ingest` limiter (exercised via
curl with the local `HEALTH_CONNECT_INGEST_SECRET`, not a real Tasker device).

**Backlog:** this plan is queued via `docs/implementation-backlog.md` (batch R1). On
implementation, remove the backlog entry and append the journal / `projectOverview.md` update in
the same PR. No user-visible UI change ships, so a `package.json`/`lib/changelog.ts` bump is
optional (patch, "security hardening") at the implementer's discretion.
