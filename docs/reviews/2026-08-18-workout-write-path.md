# Review — 2026-08-18 · the workout write path, driven live and probed cross-user

_Lens: **the write surface**. Every prior sweep of this pillar read the model (1RM, RPE,
autoregulation, deload, volume landmarks) or swept `GET`. Nothing had probed the mutations, and
workout logging is the app's core write path._

_Findings: **Q-460 … Q-462**. The headline is a **clean** one: cross-user write protection holds
across the whole workout surface, verified against a real second account rather than argued._

## Why this lens

`docs/agents/state/review.md` named it as the top gap after the 2026-08-17 sweeps: *"Only `GET` was
swept. The same anonymous / degenerate-input matrix against POST/PATCH/DELETE is the obvious next
step, and `CLAUDE.md`'s write-path ownership rules say exactly what to look for."* Those rules exist
because the class recurred across three domains: **(a)** an unchecked affected-row count after a
user-scoped UPDATE whose id came from the client, **(b)** a raw request body passed into Drizzle
`.set()`, and **(c)** client-supplied row ids on tables with **no `user_id` column**.

Rule (c) is not hypothetical here. `exercise_logs` and `set_logs` both lack a `user_id` column
entirely — confirmed against the live schema — so ownership is only reachable by joining up to
`workout_sessions`. Every write that touches a set or an exercise log depends on someone remembering
to do that join.

## Method, and what it does not establish

Two halves, both against `pnpm dev` on the seeded local Postgres.

**Cross-user probe.** A second account (`fresh@local.dev`, activated so sign-in succeeds) was signed
in alongside the seeded owner, and each workout mutation was called **as user B against user A's real
row ids**, then A's rows were re-read from Postgres to confirm they were untouched. A control was run
for every probe — the same call by A against A's own row — because a 4xx proves nothing if the body
was malformed. That control caught a mistake mid-sweep: an early `PATCH` returned `400 Invalid body`
which read like protection and was actually my payload exceeding the schema's `max(500)` weight cap.
The numbers below are from the corrected run.

**Live drive.** The workout was driven through the real UI in Playwright at the S25 viewport
(412×915): `/workout-select` → pre-workout → warm-up → active → set logging, capturing console
errors, failing `/api/` responses and every non-`GET` request body.

**What this does not establish.** The **web** build: `getLocalStore()` returns null, so the device's
local-write-plus-outbox path was never exercised and no claim here covers native SQLite, safe-area or
Samsung WebView. The local Postgres is a fresh correct seed, so nothing here speaks to prod drift.
The probe covered the **workout** mutations only — the program/phase-set/progression-style/template
routes were listed but not called. Rule (b) — raw bodies into `.set()` — was **not** systematically
audited; only the routes reached by the probe were read.

---

## Q-460 — the session-RPE route reports success for a write that matched nothing, and the sync path then discards the mutation

**Severity: medium. A silently dropped write on the canonical runtime.** `[workouts][platform]`

`POST /api/workout-sessions/rpe` returns `{"success":true}` unconditionally. Measured three ways:

| Call | Result | Row after |
|---|---|---|
| B → A's real session | `200 {"success":true}` | A's `session_rpe` **still NULL** |
| B → a fabricated UUID (`…0000deadbeef`) | `200 {"success":true}` | no such row |
| A → A's own session | `200` | written |

The security half is **correct**: `setSessionRpe` (`lib/data/postgres/adapter.ts:814`) scopes the
UPDATE with `and(eq(id, …), eq(userId, …))`, so the cross-user write matched zero rows and changed
nothing. **No data crossed accounts.** What is missing is the check `CLAUDE.md` rule (a) asks for —
the route never looks at how many rows were affected:

```ts
await repo.setSessionRpe(userId, parsed.data.workoutSessionId, parsed.data.sessionRpe)
return NextResponse.json({ success: true })
```

**On the web path** the consequence is a lying status code. **On the device — the canonical runtime —
it is worse.** `done-screen.tsx:160-167` writes locally and queues a `session_rpe` outbox mutation;
`pushMutations` (`adapter.ts:4105-4112`) handles it as:

```ts
await this.setSessionRpe(userId, rpeCheck.data.workoutSessionId, rpeCheck.data.sessionRpe)
processed++
```

`processed++` fires whether or not a row matched. A mutation whose session row is absent
server-side — not yet synced, deleted from another device, or an id that drifted — is **counted as
processed and removed from the outbox**. The local store keeps the RPE, the server never receives it,
and nothing is left to retry. That is permanent divergence with no error surface, which is precisely
what the outbox exists to prevent.

**Fix shape:** have `setSessionRpe` return the affected-row count and let both callers act on it —
the route with a 404, the push branch by pushing to `errors` so the client's bounded-retry path can
see it. **Lane A** (adapter + route).

**Not every void scoped update is this bug.** Its neighbour `setWorkoutSessionWarmupEnd`
(`adapter.ts:820`) also matches zero rows sometimes, but deliberately — it carries
`isNull(warmupEndedAt)`, so a zero-row match means "already set" and reporting success is correct.
The distinguishing question is whether zero rows is an expected idempotent outcome or an error.

---

## Q-461 — the workout flow cannot be automated past set 1: the Start Set button animates forever, so Playwright never sees it as stable

**Severity: medium, and it is a testability finding rather than a user-facing one.**
`[workouts][app-shell][platform]`

Driving a real workout in Playwright, every step worked — select, pre-workout, warm-up, Begin
Exercises, Start Set 1, Log Set 1 — and then `Start Set 2` **hung until the 300 s test timeout**. The
locator resolved to the button; the click never completed.

Proven, not inferred:

```
##CLASS  … transition hover:opacity-90 active:scale-95 animate-bounce
##ANIM   bounce | infinite
##NORMAL BLOCKED: TimeoutError: locator.click: Timeout 8000ms exceeded
##FORCED CLICKED     → screen advanced to "2 … ▶ active"
```

This is the W1 bounce that `CLAUDE.md` documents by design (*"Start button `animate-bounce` when
`workoutPhase === 'rest'`"*). Playwright's actionability check requires a stable bounding box for two
consecutive frames; an infinite CSS animation never provides one, so the click waits forever. A human
tapping a bouncing button is completely unaffected — **this is not a user-facing defect and must not
be written up as one.**

Why it still matters: the repo has just invested in an E2E harness precisely to catch regressions
(Q-249, extended by Q-352's zero-data account), and **the app's core write path cannot be driven by
it past the first set.** The two most severe findings of the preceding week — Q-450's silently
discarded activity and Q-451's dead first-run button — were both exactly the shape an E2E spec
catches. `force: true` is the available workaround and a poor one: it bypasses *all* actionability
checks, including "is this covered by an overlay", so a spec written that way would keep passing
through a real regression.

**Fix shape (Lane B):** gate the animation on something a test can disable — honour
`prefers-reduced-motion` (which Playwright can set via `contextOptions`), or drop the bounce while a
`data-testid` test hook is present. Either keeps the affordance on device and makes the control
automatable.

---

## Q-462 — an ownership violation on `/api/log-exercise` surfaces as a 500

**Severity: low. The block is correct; only the reporting is wrong.** `[workouts][platform]`

`POST /api/log-exercise` as user B, with user A's `workoutSessionId`, returns
`500 {"error":"Failed to log exercise"}`. **Nothing was written** — A's session still held exactly its
original exercise log, and B gained no session — because `ensureWorkoutSession` catches it:

```
[log-exercise] logExerciseFromPayload threw Error: ensureWorkoutSession:
  session 3fbf3d8a-… is not owned by user 1d7059d1-…
    at PostgresWorkoutRepository.ensureWorkoutSession (adapter.ts:794)
```

So rule (c) is honoured — this is the guard working. The defect is that a permanent, correctly-refused
condition is reported as a **transient server error**, and logged with a full stack trace as if the
server had faulted.

Two mitigations keep this low, and both were checked rather than assumed. It is **unreachable through
the UI**: the client only ever sends a session id it created. And the sync path does **not** treat it
as retry-forever — `pushMutations` wraps each mutation in its own `try/catch`
(`adapter.ts:4333-4338`) that records the failure in `errors` and continues, so the queue cannot wedge
and the client's `MAX_MUTATION_ATTEMPTS` dead-letters it.

**Fix shape:** give `ensureWorkoutSession` a typed ownership error and map it to 403/404 at the route,
leaving 500 for genuine faults.

---

## Clean — the result that matters most, and three more

**1. Cross-user write protection holds across the workout surface.** Every workout mutation was called
by user B against user A's real ids, and A's rows were re-read afterwards:

| Call (B → A's row) | Result | A's data |
|---|---|---|
| `PATCH /api/workout-entry` (exercise log) | **404 Not found** | unchanged |
| `DELETE /api/workout-entry` | **404 Not found** | unchanged |
| `DELETE /api/workout-sessions` | **404 Not found** | unchanged |
| `POST /api/log-exercise` (A's session id) | 500, **write refused** | unchanged |
| `POST /api/ai-periodization/session/…/prescribe` | **404 Not found** | unchanged |
| `POST /api/workout-sessions/rpe` | 200, **but wrote nothing** (Q-460) | unchanged |

`workout-entry`'s `assertOwnership` is the documented reference pattern done right — an explicit
`JOIN workout_sessions ON … WHERE ws.user_id = $2`, which is the only way to establish ownership on a
table that has no `user_id`. **And the control proves the checks are real rather than my payloads
being wrong:** A calling the same PATCH on A's own log returned `200` and the set weights actually
changed to `62.5,62.5,62.5` in Postgres.

**2. The outbox cannot be wedged by one bad workout mutation.** `pushMutations` catches per mutation,
records to `errors`, and continues — the `CLAUDE.md` poison-pill rule, implemented.

**3. The workout flow works end to end on the web build.** Select → pre-workout → warm-up → active →
set logging, with correct rest countdown (82/90 s), RPE capture, live 1RM readout, and plate maths
("75 kg · 25 + 2.5 per side" — correct for a 20 kg bar). **Zero uncaught page errors and zero failing
`/api/` responses** across the whole drive.

**4. Two near-misses, checked and cleared.** Recorded so a later sweep does not re-raise them:

- The live 1RM readout showing **"= 100 kg ▲ +2.00 kg"** while the header read "1RM 97.5 kg" looked
  like a delta computed off a rounded value. It is not: the stored `personal_records` 1RM is
  **98**, so `+2.00` is exact. The 97.5 is the *previous session's* estimate — a different quantity
  that happens to sit on the same screen.
- The warm-up ramp labelling **70 kg as "92%"** of a 75 kg working weight (really 93.3%) looked like
  a rounding bug. It is not: `active-workout-screen.tsx:175-183` uses fixed target percentages
  (50/74/92) and rounds the *weight* to the loadable plate step. The label states intent, the number
  states what can be loaded.

**One thing I did not find, and nearly reported.** The UI drive produced **no** `POST /api/log-exercise`,
which looked like "web logging never persists". It is not a bug: `workout-screen.tsx:1307` fires that
POST when an **exercise** completes, not per set, and the drive only finished one of three sets.
Recorded because the false version of this is an easy and expensive mistake.
