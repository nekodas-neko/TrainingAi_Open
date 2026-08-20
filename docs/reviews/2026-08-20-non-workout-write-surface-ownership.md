# The non-workout write surface: one ownership rule holds everywhere, another holds on one route in three

**Date:** 2026-08-20 · **Agent:** Review 📖 (sweep 40) · **Pillars:** `[workouts]` `[platform]` `[nutrition]`
**Lens:** the write surface the previous sweeps left — the program / phase-set / progression-style /
template routes — plus the one of the three write-path ownership rules in `CLAUDE.md` that had never
been audited: **rule (b), a raw request body reaching Drizzle `.set()`**.

Sweep 3 covered the **workout** mutations and stopped there; the baton has carried "the rest of the
write surface" as the top unstarted lens since. This is that sweep.

**Two results, and they point opposite ways.** Rule (b) is clean — 116 mutating routes, 325 `.set()`
sites, zero violations, and now some evidence behind a rule that had none. Rule (c) — *client-supplied
row ids must be ownership-verified* — holds on one route out of the four that accept a progression-style
id, and the route where it holds is the **PUT** twin of a **POST** where it does not.

---

## 1. Method, and what it does not establish

The app was run, not read. `pnpm dev` against the seeded local Postgres, two real signed-in accounts
(**A** = the seeded `test@local.dev`, **B** = a second account created for this sweep), every probe a
live HTTP request with a real session cookie, every result confirmed by reading the row back out of
Postgres rather than by trusting the response body. The Config screen was driven through Playwright as
B to confirm the surface works end-to-end for a second account (no console errors, no `pageerror`, no
4xx).

Three things this does **not** establish:

- **It is the web build.** `getLocalStore()` returns null, so every offline-first domain took its web
  fallback. No device, safe-area, Samsung-WebView or native-SQLite claim can come from here.
- **The production check covers one account.** `claude_ro` is row-scoped to the owner, and in the bug
  below the *victim* is the account whose style is borrowed — whose rows are precisely the ones that
  view cannot show. "No evidence in the owner's data" is the strongest statement available, and it is
  not "this has not happened".
- **Sweep 39's lesson was applied.** Every probe asserts it reached a real route: a JSON body, not
  Next's HTML 404, which is indistinguishable from an access-control rejection by status alone. The
  one 405 in the run (`PUT` on a `PATCH`-only route) was caught by that check and re-run.

---

## 2. Clean: rule (b), a raw request body into `.set()`

`CLAUDE.md` names three write-path ownership rules. Rule (b) says never pass a raw request body into
Drizzle `.set()`, because `userId` / `deletedAt` / `createdAt` are settable column keys and the
TypeScript `Omit<>` in front of them is compile-time only. The baton recorded that this rule had "no
evidence behind it". It does now.

**Method:** 325 `.set(` call sites under `lib/`, `app/api/` and `packages/shared/src/`, filtered to the
21 that take a bare identifier or an object spread rather than an inline literal, then each of those 21
traced back to where its argument is built.

**Result: every one is constructed field by field**, in the `const set: Record<string, unknown> = {}`
+ `if (x !== undefined) set.x = x` shape — `updateUserProfile`, `updateUserGoals`, `updateInjury`,
`updateSupplement`, `updateMealPlan`, `updateProgramPhaseSettings`, `updateActivityLog`,
`updatePrescribedRun`, and the four `lib/coach/domains/*` writers among them.

Live confirmation rather than a source read: `PATCH /api/user/profile` sent with
`{"isAdmin":true,"id":"<other user>","passwordHash":"x","emailVerified":"2020-01-01"}` alongside a legitimate
`displayName`. The name changed; `is_admin` stayed `false` and `id` was untouched in the row read back.
Zod strips unknown keys by default, so even the routes whose schema is not `.strict()` do not pass them on.

**One structural caveat, not a defect today.** `updateMealType` (`lib/data/postgres/slices/nutrition.ts:86`)
is the only repo function that `.set()`s its argument wholesale. It is safe because its single caller
uses a `.strict()` schema — the guarantee lives at the route, not at the writer, so a second caller
would inherit no protection. Filed as a hardening bullet on RV-33.

---

## 3. Rule (c): a progression-style id belonging to another user is accepted by three write paths

`progression_styles` is strictly user-scoped — `user_id` is `NOT NULL` and there is no shared or global
style. Q-129 established the posture for exactly this shape on `programs.phase_set_id`: validate a
client-supplied FK against the caller's own list, and 400 anything else.

**Measured, as B, against a style owned by A** (`33a48cd1…`, owner `a3924784…`):

| write path | column written | result |
|---|---|---|
| `PUT /api/phase-sets/[id]` | `program_phases.primary_style_id` | **400 `Invalid primaryStyleId`** ✅ |
| `POST /api/phase-sets` | `program_phases.primary_style_id` | **201, row persisted** ❌ |
| `POST /api/workout-templates` | `session_exercises.style_id` | **200, row persisted** ❌ |
| `POST /api/log-exercise` | `exercise_logs.style_id` | **200, row persisted** ❌ |

The first two rows are the finding in one line: **the same value, on the same resource, in the same
session — rejected by PUT, accepted by POST.** The check exists in
`app/api/phase-sets/[id]/route.ts:34-50` and was never added to the create twin fourteen lines away in
the sibling file. Each accepted row was read back out of Postgres with a join proving the style's
owner is a different user.

### What it actually costs

**A cross-user read, bounded to one string.** `listPhaseSets` joins the style name in without a user
scope (`lib/data/postgres/slices/programs.ts:427` — `leftJoin(primaryStyle, eq(primaryStyle.id, …))`),
so `GET /api/phase-sets` returned **A's style name, `"General 4-set"`, to B**. That field is not
internal: `primaryStyleName` renders in the workout-builder review (`components/workout-builder/builder-review.tsx:484`)
and is interpolated into the LLM prompt in `app/api/nutrition-goals/recommend/route.ts:103`.

**Nothing worse than the name.** Every other read of `progression_styles` is scoped by `user_id` —
`saveProgressionStyle`'s row-count guard, `deleteProgressionStyle`, and the eleven routes that resolve a
style through `listProgressionStyles(userId)`. So the borrowed style's **set structure** (pct/reps/rest)
does not reach the borrower: the client looks the id up in its own list, misses, and falls back. This
is a name disclosure and a persisted cross-user reference, **not** a route to another user's training data.

**A cross-user side effect in the other direction.** All three FKs are `ON DELETE SET NULL`. So A
deleting their own progression style silently nulls a column in **B's** program and workout history.

**Not exploited in the data this sweep can see.** Production, via `claude_ro`: 46 phase rows (46 with a
primary style), 82 styled `session_exercises`, 280 styled `exercise_logs` — **zero** pointing at a style
outside the owner's own set. Read the caveat in §1: this view is the owner's rows only, and the victim's
rows are the ones it cannot show.

**Filed as RV-32.**

---

## 4. A client-supplied `program_sessions.id` is a 500, not a refusal

`saveProgram` uses the client's `sessions[].id` as the primary key of the row it inserts — deliberately,
so that a program edit does not sever `workout_sessions.session_id` (which is `ON DELETE SET NULL`) from
already-logged workouts. The id is never checked against the caller.

As B, saving a program whose session carries **A's** `program_sessions.id`: **HTTP 500 `{"error":"Save
failed"}`**, from a raw `[pg 23505]` duplicate-key violation on the insert, and an `error_events` row
carrying the failed SQL. The transaction rolls back, so nothing cross-user is written — it fails closed,
but by accident of a PK constraint rather than by design, which is the same shape Q-129's own comment
calls out on the line above.

**Filed as RV-34**, batched with RV-32: one verification pass over the program-config write path covers both.

---

## 5. An ownership refusal answered as an empty-bodied 500, on two more routes

Q-462 and Q-463 established that a not-yours id is a 404, not a server fault — and fixed it on
`phase-sets/[id]`, `supplements/[id]`, `meal-types/[id]`, `activity-logs` and `log-exercise`. Two routes
were missed, and both were found by probe rather than by reading:

- **`POST /api/progression-styles`** with an id owned by A → **HTTP 500 with a completely empty body**.
  The repo's `NotFoundError('Progression style')` — a *correct* refusal — escapes an unguarded handler.
- **`PATCH /api/nutrition/food-logs/[id]`** with an id that is not the caller's → **HTTP 500, empty body**.

Both wrote a row into **`error_events`** — the one fault channel `CLAUDE.md` says nobody is watching —
misfiled as `source: server`. Verified by reading the table after each probe:
`POST /api/progression-styles | Progression style not found` and
`PATCH /api/nutrition/food-logs/… | Food log not found`.

**Two things this is not.** It is not an outbox-wedge: neither route is on a `pushMutations` path
(`food_logs` syncs through the push branch, which has its own FK ownership check and returns a per-mutation
`errors[]` entry rather than throwing). And it is not a leak — both refuse correctly, they just refuse in
the wrong dialect.

**How the two were found, since the method generalises:** cross the 20 repo/slice functions that
`throw new NotFoundError`/`UserFacingError` against the 54 of 116 mutating routes carrying neither a
`try {` nor one of the shared error helpers (`withRouteErrors`, `refusalResponse`, `routeErrorResponse`).
Four routes intersect; two of them turned out to be reachable with a refusable id, and both reproduced.

**Filed as RV-33.**

---

## 6. Everything else this sweep checked, and found sound

Recording these so the next sweep does not re-cover them:

- **`PUT` / `DELETE /api/phase-sets/[id]`** with A's phase-set id → `404 {"error":"Phase set not found"}` on both.
- **`POST /api/workout-templates`** with A's `program.id` → `404 {"error":"Program not found"}` (Q-129's guard, live).
- **`saveProgressionStyle`** — the row-count guard is real: a foreign id cannot reach the unscoped
  `style_sets` delete/re-insert below it.
- **`saveThread`** (`lib/coach/threads.ts:42`) — ownership check and update in one statement; a foreign
  thread id falls through to creating a new thread rather than rewriting someone else's.
- **`foodLogRefsValid`** — the reference pattern for this whole class, and the only place it is
  implemented on **both** the web route and the `pushMutations` branch. The program surface has no equivalent.
- **`/api/ai-periodization/weekly-volume`** validates a `programId` query param against the caller's own programs.
- **`PATCH /api/admin/activity-types`** — Zod-parsed before `.set(patch)`, `requireAdmin` first.
- **The Config screen renders and works for a fresh second account** — program list, Advanced Settings,
  the phase-set list — with no console error, no `pageerror` and no 4xx in the run.

## 7. What this sweep deliberately left

- **The 62 mutating routes that *do* carry a `try {`** were not checked for whether they map the refusal
  to the *right* status — only for whether they map it at all.
- **The other 23 FK edges into user-scoped tables.** The inventory is in this sweep's method (one query
  against `information_schema`); four edges were probed live and one class fell out. `meal_plan_meals.saved_meal_id`,
  `saved_meal_items.food_item_id`, `prescribed_runs.plan_id` and `supplement_logs.supplement_id` are the
  next four worth an hour.
- **Rule (a)** — the affected-row count before a dependent child write — was not audited. Rule (b) is now
  done, rule (c) has this sweep's evidence; (a) is the remaining one with none.
