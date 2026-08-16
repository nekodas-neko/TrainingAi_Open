# Running-app review — 2026-08-08

_Domains: `app-shell` (primary), `platform`. Partial execution of
[`2026-08-09-deep-review-prompt.md`](2026-08-09-deep-review-prompt.md)._

## Scope — read this before trusting the coverage

This is **Step 0 (production reads) and part of Step 1 (running the app)** of that prompt. It is
**not** the full twelve-lens review. Lenses 2–12 were not run: no CLAUDE.md accuracy audit, no
mobile-standards pass, no test-suite mutation checks, no multi-user drive. Those remain open and the
prompt still stands for a session with the budget to do them.

What makes the findings here worth having anyway: **they were observed in a running browser**, not
inferred from source. Every previous review of this app was read-only — the 2026-08-07 sweep says so
in its own §8. Two of the four findings below are things no amount of code reading had surfaced in 25
prior reviews.

Method: `pnpm dev` against the local seeded Postgres, driven with headless Chromium at a 390×844
viewport (S25-ish) via the globally-installed Playwright — **no project dependency was added**.
Production numbers via `POST /api/admin/db-query`.

---

## 1. The signed-out sign-in page fires 12 authenticated API calls, all 401 — including a POST

**Observed.** Loading `http://localhost:3000/sign-in` with no session produces **12 requests to
`/api/*`, every one 401**:

```
/api/oura-ble/freshness   /api/oura/sync (POST)   /api/body-metadata     /api/next-session
/api/weekly-stats         /api/progression-styles /api/workout-data      /api/workout-templates
/api/exercise-library     /api/activity-types     /api/weights-summary   /api/progress-summary
```

**Root cause — two unguarded effects in `components/sync-provider.tsx`, which otherwise guards
correctly.** The component takes `userId` and uses it properly for the sync operations:
`pushMutations` at `:123-124`, `pullDelta` at `:128-130`, and both again on the network-resume
listener at `:174-175`. But:

- **The cache-warm phases have no `userId` guard.** `:115` (`CACHE_TASKS.map`) and `:159`
  (`CACHE_TASKS.slice(i, i + WARM_CHUNK).map(warmCache)`) run unconditionally — 20 warm tasks, of
  which the network-hitting ones produce the GETs above.
- **`maybeSyncOura` has no guard at all.** Defined `:194`, invoked at `:225` and again on every app
  `resume` at `:232`. It issues `GET /api/oura-ble/freshness` and then **`POST /api/oura/sync`** — an
  expensive external-sync route — before anyone has logged in.

**Consequence.** Every visit to the login screen costs 12 rejected round-trips at the worst possible
moment: app open, cold cache, before the user has done anything. On the APK over mobile network that
is real latency and battery on the critical first-paint path, and it puts a POST to an external-sync
endpoint in front of an unauthenticated user. `SyncProvider` is mounted in the root layout
(`app/layout.tsx:126`), so this happens on **every** signed-out route, not just `/sign-in`.

**Fix direction.** Gate both on `userId`, the same way the push/pull phases already are. The warm
phase arguably should still mirror *cached* data to sessionStorage when signed out (that part is
local-only and harmless) — but it must not fetch.

Filed as **Q-150**.

## 2. The sign-in page has a hydration mismatch

**Observed.** First load of `/sign-in` logs:

> A tree hydrated but some attributes of the server rendered HTML didn't match the client
> properties. This won't be patched up.

This is the React #418 family — **153 occurrences in production over 30 days**, the single
highest-count error in `error_events`. Q-73 (#1130) diagnosed and fixed the **home** screen's
instance (server/client timezone divergence in the header date). The Known-Issues row for it is
written as though the class is closed.

**It is not: `/sign-in` is a different route and was never touched.** Production hits continued to
2026-08-07T20:53, and the last one predates the Q-73 deploy by ~19 minutes, so they are *consistent
with* Q-73 having fixed the home instance — but this second, independent instance is still live and
will keep generating #418s.

Not root-caused here (the dev overlay does not name the attribute). Filed as **Q-151** with the
reproduction, which is the hard part.

## 3. Production: 98 failed queries, **zero** carrying a Postgres code

**Measured.** The prompt's highest-value question was whether the new cause-capture had produced
any diagnosable rows yet. It has not:

| | |
|---|---|
| `Failed query` rows, all time | **98** |
| …with a `[pg …]` code prefix | **0** |
| …with a `[cause: …]` fallback | **0** |
| latest occurrence | 2026-08-08T03:26:19Z |
| cause-capture deployed (#1150) | 2026-08-08T04:44Z |

**No fault has occurred in the ~6 hours since the fix deployed.** So **Q-107's batching decision
still cannot be made** — the next occurrence decides it. A `57014` majority means `statement_timeout`
and the batching fix is aimed correctly; codeless connection-acquisition failures mean something else
is dropping connections. This is a "no data yet" result, and recording it is the point: the next
session should re-run this query *first* rather than assuming the codes are there.

## 4. Two production **write** failures — and neither lost data

**Measured, and a deliberate negative result.** The open Known Issue frames the app-wide DB fault as
read failures (`/api/sync/pull`, `/api/readiness-score`, `/api/body-battery`). It has also hit
**writes**, which would be a far more serious class:

| when | route | statement |
|---|---|---|
| 2026-07-27T22:53:06Z | `/api/log-exercise` | `insert into "workout_sessions"` |
| 2026-07-20T22:29:25Z | `/api/complete-workout` | `update "workout_sessions" set "completed_at"` |

**Both workouts are intact.** Checking the sessions on those two days: 2026-07-20 completed at
**22:28:58** — 27 seconds *before* its failed UPDATE; 2026-07-27 completed at **22:51:44** — 82
seconds *before* its failed INSERT. In both cases the data was already durably stored and the failing
statement was a trailing retry.

So the fault reaches write paths but has not been observed to cost data. That is worth writing down
in both directions: it stops the next reader escalating this to "the DB fault can drop a workout",
and it stops anyone assuming writes are immune.

## 5. `ensureSchema` swallows a real migration error

**Observed** in the dev-server boot log:

```
[ensureSchema] 001_initial.sql: foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented
[ensureSchema] 0 migration(s) applied
```

The other four lines in that block are benign idempotency notices (`already exists`, `duplicate key`).
This one is not — it is a constraint that **could not be created**, logged at the same level and then
stepped over. Given `CLAUDE.md`'s "Local SQLite Migrations — assume partial application" rule exists
because exactly this class silently broke the app twice on Android, the Postgres side deserves the
same suspicion. Filed as **Q-152**, low severity but explicitly *not* dismissed: nothing currently
proves `cardio_sessions` is unused.

## 6. Checked and clean

- **All 14 real pages render without console errors.** `/`, `/health`, `/workout`, `/nutrition`,
  `/more`, `/overview`, `/activity`, `/stats`, `/chat`, `/workout-select`, `/session-select`,
  `/config`, `/profile`, `/cardio` — every one HTTP 200, zero `pageerror`, zero non-401 console
  errors. Four of them are redirects that resolve correctly (`/stats` → `/health?tab=training`,
  `/session-select` → `/workout`, `/config` → `/more?tab=config`, `/profile` → `/more`).
- **Login works** with the seeded `test@local.dev` credentials, and the home screen paints its real
  content.

**One methodological warning for the next session, because it nearly became a false finding:**
`/activity` returns only 11 characters of body text, which reads exactly like a blank screen. It is
not — it is a legitimately sparse "start an activity" form (a Title input and a Start button), which
the screenshot settles immediately. **Text length is not a render check; look at the picture.**

## 7. What was NOT exercised

No device, no APK, no native SQLite — `getLocalStore` returns null in the web sandbox, so the entire
offline-first *device* path is untested here and every finding above is web-surface only. No second
user was driven (the multi-user lens was not run). No adversarial-value, boundary-date, offline, or
rapid-tap testing — all of Step 1's items 2–6 remain undone. Lenses 2–12 not run at all. Production
reads were `error_events` and `workout_sessions` only; no null-rate sweep, no volume re-measurement.

The `/activity` screenshot also shows a large unlabelled circular control and a very sparse layout,
which look like real UI findings — but the mobile-standards lens was not run, so they are recorded
here as unreviewed observations rather than filed.
