# `/api/log-exercise` 500s under `next dev --turbopack` — Dev-Gate Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** Under the dev server (`pnpm dev`, which runs `next dev --turbopack`), **every**
`POST /api/log-exercise` returns 500 with:

```
TypeError: (0 , …lib/data/index.ts…getRepository) is not a function
    at logExerciseFromPayload (lib/workout/log-exercise.ts:85)
    at POST (app/api/log-exercise/route.ts:27)
```

The production build is **unaffected** — `next build` + `next start` against the same
DB returns 200 and persists every timing column. This was found + root-caused + the fix
below was verified live during the 2026-07-05 workout-backlog review
(`docs/reviews/2026-07-05-workout-backlog-review.md` §8).

**Why this matters beyond a dev annoyance:** logging a set is the app's single most
important write path, and CLAUDE.md **mandates** exercising every changed API route on
the local dev server before presenting work for merge. That gate is currently broken for
this route — and it fails **silently in the UI**: the workout POST is fire-and-forget,
the web sandbox has no local outbox (`getLocalStore` returns null there), so a full
Playwright walkthrough sails all the way to the Done screen while **zero rows persist**.
Any "verified the workout flow on the dev server" claim that didn't check the DB
directly has been unreliable.

**Root cause** (from the emitted Turbopack chunks): `lib/data/postgres/client.ts`
compiles as a Turbopack *async module* (it pulls in `pg`/`drizzle-orm/node-postgres`),
which makes `lib/data/index.ts` and `lib/data/postgres/adapter.ts` async modules too.
`lib/workout/log-exercise.ts` is imported **both**:
- **statically** by the route (`app/api/log-exercise/route.ts:4`), and
- **dynamically** by the outbox (`await import('@/lib/workout/log-exercise')` in
  `pushMutations`, `lib/data/postgres/adapter.ts:3112`).

Under Turbopack dev, `log-exercise.ts`'s dynamic async-loader stub resolves *in place*
(`Promise.resolve()`) rather than through a real chunk, and the route's **static
namespace binding** for `@/lib/data` comes up with `getRepository === undefined` — hence
the `is not a function` at first call. `complete-workout.ts` has the identical
dual-import shape (`adapter.ts:3131`) but gets its own chunk, so it works — which is why
only `log-exercise` fails.

**Fix (verified live):** resolve the repository via a **lazy dynamic import inside**
`logExerciseFromPayload` instead of a module-level static import, so the route module no
longer statically binds the async `@/lib/data` namespace. One import moves from the top
of the file to the one call site. Confirmed: dev `POST /api/log-exercise` → 200, row
persists with correct `set_time_sec`/`inter_exercise_rest_sec`/`warmup_ended_at`,
`tsc --noEmit` clean, production build unchanged (the outbox path already used a dynamic
import, so it is unaffected).

**Tech Stack:** Next.js 15 (Turbopack dev), TypeScript.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/workout/log-exercise.ts` | Modify | Move `getRepository` from a top-level static import to a lazy `await import` at its single call site |

No schema/migration change. No test-file change strictly required (behaviour is
identical; the failure was a bundler-graph artifact, not logic) — but Task 2 adds a
lightweight guard so a future refactor can't silently reintroduce the static import.

---

### Task 1: Lazily resolve the repository inside `logExerciseFromPayload`

**Files:**
- Modify: `lib/workout/log-exercise.ts`

- [ ] **Step 1: Reproduce the failure first (confirm the repro is real on your machine)**

Start the dev server and hit the route authenticated (the local seed user is
`test@local.dev` / `testpass123`). A CSRF + credentials login then:
```bash
curl -s --noproxy localhost -b cj.txt -X POST http://localhost:3000/api/log-exercise \
  -H 'Content-Type: application/json' \
  -d '{"sessionName":"Push","sessionId":"<active Push session id>","exercise":"Barbell Bench Press","weights":[70],"sets":1,"reps":[5],"setTimes":[30],"restTimes":[]}'
```
Expected on unpatched code: `500` and the `getRepository is not a function` TypeError in
the dev log. (If you get 200, the Turbopack graph may have changed — re-derive before
proceeding.)

- [ ] **Step 2: Remove the top-level static import**

In `lib/workout/log-exercise.ts`, delete line 2:
```ts
import { getRepository } from '@/lib/data';
```
(Leave the other imports — `zod`, `date-utils`, `phase-engine`, `1rm`, the type-only
`program` import — untouched. `phase-engine`/`1rm` do not transitively pull the async
`pg` module the way `@/lib/data` does; only `@/lib/data` is the offending static binding.
Verify with `tsc` in Step 4 that nothing else needed the removed symbol.)

- [ ] **Step 3: Resolve it lazily at the call site**

Replace the call site (currently `lib/workout/log-exercise.ts:85`):
```ts
  const repo = await getRepository();
```
with:
```ts
  // Lazy import: `@/lib/data` compiles as a Turbopack async module (it pulls in pg /
  // node-postgres). A *static* top-level import of it here, combined with this module
  // also being dynamically imported by the outbox (pushMutations, adapter.ts), leaves
  // the route's static namespace binding empty under `next dev --turbopack` —
  // `getRepository` reads as undefined and every dev POST 500s (prod build is fine).
  // Resolving it lazily breaks that static-import-of-async-module edge.
  // See docs/superpowers/plans/2026-07-05-log-exercise-turbopack-dev-fix.md.
  const { getRepository } = await import('@/lib/data');
  const repo = await getRepository();
```

- [ ] **Step 4: Typecheck + lint + full suite**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
Expected: all green (the change is type-identical; the existing 721-test suite is
unaffected).

- [ ] **Step 5: Verify the fix on the dev server (the whole point)**

Restart `pnpm dev` (clear `.next` first to force a clean Turbopack graph:
`rm -rf .next && pnpm dev`), repeat the Step-1 `curl`, and confirm:
- Response is `200` with a `workoutSessionId`/`estimated1rm` body.
- The row persisted — query the local dev DB and confirm `set_time_sec`,
  `inter_exercise_rest_sec` (if sent), and `warmup_ended_at` (if sent) all landed:
  ```sql
  SELECT sl.set_time_sec, el.inter_exercise_rest_sec
  FROM set_logs sl JOIN exercise_logs el ON sl.exercise_log_id = el.id
  WHERE el.id = '<exerciseLogId from the response>';
  ```
- Sanity-check `POST /api/complete-workout` still returns 200 (it uses the sibling
  dynamic-import path — should be untouched, but confirm the outbox chain didn't regress).

- [ ] **Step 6: Commit**

```bash
git add lib/workout/log-exercise.ts
git commit -m "fix: log-exercise route 500 on dev by lazily resolving the repository"
```

---

### Task 2 (optional guard): a lint/test tripwire against the static import

The failure is invisible to `tsc`, `lint`, and the unit suite — it only shows at
runtime under Turbopack dev. To stop a future "tidy the imports" refactor from silently
reintroducing it, add one of:

- [ ] A tiny test asserting `lib/workout/log-exercise.ts`'s **module source** does not
  contain a top-level `import { getRepository } from '@/lib/data'` (read the file text in
  the test and assert the lazy `await import('@/lib/data')` form is present). This is a
  cheap source-shape guard, in the spirit of the repo's other structural tests.
- [ ] **Or** add the smoke `curl` of `/api/log-exercise` (dev-mode, authenticated,
  assert 200 + a persisted row) to `docs/device-smoke-checklist.md` / the session-start
  verification notes, so the dev gate is exercised deliberately rather than assumed.

Pick whichever fits; commit alongside Task 1 or as a follow-up.

---

⚠️ **Not exercised:** on-device / Capacitor outbox behaviour (the `pushMutations`
`workout_log` branch already used a dynamic import and was 200 before and after this
change, but the native SQLite outbox path can't run in the sandbox). No production
surface changes — `next build`/`next start` returned 200 both before and after the fix.
