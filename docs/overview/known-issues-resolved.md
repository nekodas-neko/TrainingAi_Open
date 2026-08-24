# Known Issues & Risks — resolved, archived

Entries moved out of `projectOverview.md` once they were fully resolved: shipped, verified, and
carrying no outstanding action — no open work, no pending owner or device check, no un-run
follow-up. Anything with a thread still hanging stays in `projectOverview.md`, where the
start-of-session orientation read will actually see it.

**Why this file exists.** `projectOverview.md` is the file every session reads before doing
anything, and 68% of it was Known Issues. Resolved entries held 1092 lines of that — context that is
worth keeping and is not worth re-reading at the start of every session. They are here, greppable,
in the order they appeared.

**The retention rule (`CLAUDE.md`, Session Wrap-Up step 2): striking a Known Issue means MOVING it
here, not marking it ✅ in place.** Without that, `projectOverview.md` regrows to exactly where it
was — 72 resolved entries had accumulated by the first sweep.

Search this file before concluding something has never been looked at — "we already fixed that, in
this version, and here is what it turned out to be" is the whole point of keeping them.

---

### [nutrition] ✅ Barcode scanning called an Open Food Facts outage "not in the database" — FIXED 2026-08-13 (v1.302.3)

Owner-reported as "barcode scanning and AI photo meal logging isn't working". **Two unrelated causes,
neither a bug in the features themselves.**

- **Photo logging was never broken.** The Railway HTTP log shows the owner's scan returning **200 in
  129,073 ms** — it worked, and the client gave up first. CPU was pegged (1.07 → 1.60 → 1.13) across
  12:40–12:50 Brisbane, exactly spanning the request. **That is Q-213**, and fixing Q-213 fixes this.
- **Barcode hit a real Open Food Facts outage** — 502 on their API *and* their main site, with an
  "Unscheduled downtime" page. Our route turned every OFF failure into `notFound`, so the app said
  *"this product isn't in the database"*, which is false during an outage and sends the owner off to
  type the item in by hand. Now `unavailable` and `notFound` are distinct answers with distinct UI.
  The search route has drawn this distinction since it was written; barcode was the sibling that
  never got it, and the shared `offFetchJson()` now serves both.

⚠️ **Not device-verified** — the scanner uses the device camera via a Capacitor plugin, which does not
run in the sandbox; only the route and its response shape were exercised, against the live outage.
The genuine `notFound` path could not be walked end-to-end while OFF is down.

### [heart-rate] ✅ One duplicate timestamp discarded up to 5,000 chest-strap HR samples — FIXED 2026-08-13 (v1.302.2, Q-215)

`upsertOuraHeartrate` never deduped within a batch, so two samples sharing a timestamp raised
`ON CONFLICT DO UPDATE command cannot affect row a second time` and failed the whole 5,000-row chunk.
Observed 8 consecutive failures at 1 Hz in production; the device retried, failed identically, and
those samples were lost. Independent of Q-213 — it was observed while CPU was idle. The prior session counted **2,472** occurrences in `error_events`, so the loss was far larger than the 8 consecutive failures visible in the deploy logs. Now collapses
repeats on the conflict target before the insert, last value wins. Verified by mutation: reverting
the dedupe fails all three new tests with the exact production error. ⚠️ **Not device-verified** —
the chest-strap path runs through the Capacitor BLE plugin, which does not run in the sandbox; the
server-side write path is what was exercised.

### [platform][app-shell] ✅ AI Coach promised charts it had no way to draw — FIXED 2026-08-11 (v1.281.0)

Coach's system prompt carried a chart-pairing rule while Coach had **no chart mechanism at all** — no
tool, no schema, no renderer. Reproduced against the live model: asked to show body weight over time
"on a chart", it drew nothing and emitted a colour-keyed choice list of date ranges — the pairing
rule firing with the chart half missing, so the user got **a legend for a chart that does not exist**,
as tappable rows that do nothing.

**Fixed** with a `renderChart` widget. The design point worth knowing: a chart asks nothing, so
nothing will ever answer it, and an unanswered client-side tool call wedges the thread — it resolves
itself on render, and it never collapses into a spent-form bubble the way the input widgets do.
Verified end to end against the live model, including the follow-up turn that would wedge if the
self-resolve were wrong. Journal:
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**⚠️ Not device-verified.** The chart renders on canvas in Samsung's WebView, which is where this
app's chart and gradient rendering has misbehaved before. Treat the visual as unverified until seen
on the S25.

**Also found, not fixed:** `/chat` + `/api/ai-chat` are now unreachable — every entry point goes to
`/coach` — but still in the tree. Deleting them is the cleanup `app/api/coach/route.ts` already
describes; the repoint happened, the deletion did not.
### [activity][readiness] ✅ A lifting day's zero zone-minutes was scored as a missed cardio target — FIXED 2026-08-11 (v1.279.2)

The Activity Score excluded *absent* zone-minutes data and renormalised, but scored a **structural
zero** at full weight (10). Zone 1 starts around 60% HRR and lifting with rest between sets rarely
holds it, so a lifter was marked down permanently for the shape of their training.

**Measured first, then fixed** — of the owner's last 45 days, **40 had exactly zero zone minutes and
32 of those were lifting days**, so the exclusion keys off an exact zero with no invented threshold.
Deliberately narrow: a zero on a *rest* day still scores 0, because there it does mean no moderate
activity happened. Live A/B on the same data: **33 → 38**. Journal:
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**Carry into Q-137:** with 40 of 45 days at zero, `zoneMinutes` carries almost no information for
this user either way — worth knowing before its goal is re-anchored.


### [workouts] ✅ Confirming an early-deload WEEK from Home didn't reduce AI-dynamic prescribed weight — FIXED 2026-08-11 (v1.279.1)

Owner: "even though i selected the deload button; it still gave me my normal session.." — sent
immediately after tapping "Take deload week now" on Home's `EarlyDeloadCard`. It was the exact
Q-109 bug arriving through the app's *other* deload-confirmation entry point: that card writes
`programs.earlyDeloadWeekStart` and passes no `aiDeload=1` param, and an `ai_dynamic` program has
no `ProgramPhase` rows for `isDeloadActive()` to consult — so `/api/workout-data` reported
`isDeloadActive: false` for the whole confirmed week and the prescription came out at full
intensity for up to seven days.

**Fixed:** `isEarlyDeloadWeek()` answers the window with no phase to consult, both `workout-data`
paths (single-tab *and* `?tab=all`) surface it, and `buildWorkoutExercises` reads
`aiDeload || isDeloadActive` so both entry points converge on the one `deloadOverrideForGoal`
mechanism. Measured on the dev server: 82.5% × 4 sets → **50% × 2 sets** on confirming, back to
82.5% × 4 on day 8, and the Q-109 toggle path unregressed. Journal:
[`docs/overview/history-2026-08-08.md`](history-2026-08-08.md).

**⚠️ What it exposed and did not fix — Q-185.** The reduction lives inside `if (aiDrivesLoad)`, so
an exercise the AI prescription does not name is not reduced at all: measured on the same run, an
accessory with no prescription entry stayed at 75% × 3 while its two prescribed siblings dropped to
50% × 2, and a session whose prescription is missing or expired comes back at full base-style load.
This predates the fix and **both** deload entry points share it.


### [heart-rate][activity][app-shell] ✅ The activity detail sheet's HR chart had never rendered — fixed 2026-08-09 (v1.276.1)

`/api/oura/hr-window` validated its time params with `/^\d{2}:\d{2}$/`. The activity detail sheet
fills them from `log.startTime`/`log.endTime`, which come straight off `activity_logs.start_time` —
a Postgres `time` column, serialised as **`HH:MM:SS`**. Every call that sheet has made since it
shipped was rejected with a 400 *before the handler ran*, and the client swallows the failure
(`.catch(() => {})`), so the HR chart, zone breakdown and HR-coloured route line simply stayed
empty — indistinguishable from "no Oura data for that window".

This is the same class as the dash-vs-slash date-regex rule already in CLAUDE.md, one field along:
the **validation gate** disagreed with what the client actually sends, and the failure is invisible
because the empty state is a legitimate outcome. Fixed by accepting optional seconds (then dropping
them — the window already snaps to whole minutes). Pinned by a DB-backed route test that was
confirmed to fail against the old regex before being kept.

Found only because Q-165's cache conversion could not be verified: the request it was caching had
never once succeeded. ⚠️ **Not device-verified** — the fix is proven in a browser at 412×915
against the local DB; the Samsung WebView rendering of the now-actually-drawing chart is not.

### [readiness][body] ✅ Body Battery no longer shows a provisional anchor that changes under you — Q-42 shipped 2026-08-09

`/api/body-battery` anchors the day's curve on our own derived readiness, but that row only existed
once `/api/readiness-score` had run and persisted it. So the **first** Body Battery read of any day
fell back to the sleep score and painted an anchor labelled *provisional*, which then moved once the
Health screen was opened — the behaviour the owner confirmed 2026-08-03 was bothering them.

**None of the entry's three proposed shapes were right.** It framed this as "one shared function
both routes call", which would have run ~11 repository reads on a route warmed at every app open.
The readiness route **already** compute-and-persists, and Body Battery **already** prefers the
persisted row — so the only gap was the first read of the day. Body Battery now computes and
persists readiness itself when that row is missing, which by construction happens at most **once a
day**; every later read on either route hits the stored row.

`buildReadinessPayload` moved to `lib/health/readiness-payload.ts` and both routes call it. The
formula was never the problem — `computeReadinessComposite` has been in
`@trainingai/shared/health/readiness-composite` all along; what was inline was the orchestration.

**Measured, not assumed** (`pnpm dev`, seeded DB, alternating cold/warm to cancel dev drift): warm
~134 ms, cold ~182 ms — **~48 ms added**, once per day. Verified end to end that readiness and the
anchor now report the **same number** (54/54), which is the property that makes the two Home cards
agree.

⚠️ **The safety gate is deliberate and worth knowing:** the on-demand result is used only if the
builder actually *persisted* it. With thin data the builder still returns a number, and an early
version of this change anchored on it — breaking the sibling tests that assert a user with no data
gets an honest `default`/`sleep` anchor. Re-reading the persisted row takes exactly the signal the
old path used, and adds no new judgement. ⚠️ **Not device-verified.**

### [platform] ✅ `001_initial.sql` had never applied and re-failed on every boot — FIXED 2026-08-09 (Q-159)

Found once Q-152 made the line legible.
`001_initial.sql:145` declares `cardio_sessions.user_id TEXT NOT NULL REFERENCES users(id)`;
`002_users_uuid.sql` later made `users.id` a `UUID`. So **001 could not apply to any database past
002** (SQLSTATE `42804`), was never recorded in `schema_migrations`, and was retried and re-failed
forever. A multi-statement `pool.query` is one implicit transaction, so the whole file rolled back
each time.

**The owner ran the production index query on 2026-08-09, and it changed the conclusion.**
`idx_bm_user_date`, `idx_programs_user` and `idx_style_user` are all **present in production**; only
`idx_el_name_date` is absent, and that is **by design** — `009_perf_indexes.sql` drops it and
replaces it with the superset covering index `idx_el_name_date_ws`. So **production was never
missing anything**, and the three gaps were a drifted *local dev* database only.

🚫 **The Q-107 link is retracted.** This row previously suggested a missing
`body_metrics(user_id, date DESC)` could contribute to `/api/sync/pull` slowness. That index exists
in production, so it cannot. Q-107 still has no evidence and still must not be built on a guess.

**Migration 174** (`174_retire_001_initial_retry.sql`) creates the three indexes `IF NOT EXISTS` — a
no-op in production, a repair anywhere drifted — then records `001_initial.sql` in
`schema_migrations` so the retry stops. Verified: applied twice for idempotency, and a dev boot now
prints `5 applied, 4 already present, 0 failed` with 001 gone from the block. `cardio_sessions` and
its index are deliberately **not** created — the table exists nowhere, nothing outside
`migrations/` references it, and creating it would mean inventing the `user_id` type 001 got wrong.

**Two deliberate negative results.** (1) **98 `Failed query` rows in production, zero carrying a
Postgres code** — the last fault predates the cause-capture deploy by ~78 minutes, so **Q-107's
batching decision still cannot be made**; re-run that query before assuming otherwise.
**Re-read 2026-08-08 22:06 UTC and still no evidence:** the 7-day window holds 5 `Failed query` rows
(`/api/sync/pull` ×3, `/api/readiness-score`, `/api/body-battery`), 1 hit each, **none carrying a
`[pg …]` prefix**, newest 2026-08-08 03:26. Q-107 stays unbuilt. (2) The DB
fault **has** hit writes (a `log-exercise` INSERT and a `complete-workout` UPDATE) but **lost no
data** — both sessions completed 27 s and 82 s *before* their failing statement, so both were
trailing retries.

**Clean:** all 14 real pages HTTP 200 with zero `pageerror` and zero non-401 console errors.

**NOT done:** no device/APK/native SQLite (so every finding is web-surface only), no adversarial or
boundary-date or offline or rapid-tap testing, no second user, and lenses 2–12 (CLAUDE.md accuracy,
mobile standards, test-suite mutation checks, multi-user scale) not started. The prompt stands.

### [platform][devices] ✅ Counter audit clean; Q-7b was undercounting its own work-list (2026-08-08)

A production audit pass, recorded because "checked, clean" is information when CLAUDE.md says every
stored counter in this project has drifted at least once. **`user_stats`** 66/66 sessions and 922/922
sets — exact. **`sessions_in_phase`** exact on all five active-program rows (the one drifted row found
2026-08-07 is on an *inactive* program; Q-128 now reconciles on every `workout-data` read, so active
drift should self-heal before it is seen). **`personal_records`** — zero of 30 drift by more than
0.25 kg from the best qualifying log, checked under the same gates `reconcilePersonalRecord` applies.

**Q-7b corrected: ten always-NULL columns, not eight.** Machine-counted across 82 rows —
`active_calories_est`, `training_load_ots`, `training_load_high`, `recovery_index_hours`,
`worn_hours_ble`, `night_hrv_baseline_ms`, `chronic_stress_score`, `chronic_stress_contributors`,
`vascular_age`, `pwv`. The 2026-08-05 pass named seven and missed three. That list *is* the
build-the-producer work-list, so it needed to be exact. Also: the table is sparse where it is
populated (`sleep_score` 25/82, `readiness_score` 24/82, `activity_score` 12/82) — "has a producer"
and "has coverage" are separate questions.

**Q-107 has nothing new to diagnose yet**, by construction: the `err.cause` capture is deployed
(prod on v1.270.24) and **zero server errors have been recorded since**. The change makes the next
fault readable; there has not been one.

Session journal: `docs/overview/entries/2026-08-08-production-counter-audit.md`.

### [workouts][platform] ✅ The Year Review read a deload as a lift dropping to zero (found + fixed 2026-08-08, v1.270.24)

Found while running Q-52's outstanding "re-measure once blocks cycle" audit: four exercises in the
2026-08-06 Upper session read as **−100%** trends. Not a bug in the estimate — `estimateOneRm`
returns `estimated1rm: 0` when `deloaded` (`1rm.ts:158`), deliberately, so deload work never enters
an estimate. The bug is that **a stored 0 passes an `IS NOT NULL` filter**, and
`getYearReviewTopExercises` guarded that way, so a deload on the most recent session of the year's
most-trained lift rendered as "92.75 → 0 kg" under "Most trained". Both FILTER clauses now guard
`> 0`, matching `getExercise1rmHistory` and `reconcilePersonalRecord`, which already did — so PRs,
prescriptions and strength history were never affected, only this one screen. New DB-backed test
fails against the pre-fix adapter with `expected +0 to be 92.75`. No backfill: the stored zeros are
correct data, only the read was wrong.

Session journal: `docs/overview/entries/2026-08-08-year-review-deload-1rm.md`.

### [platform] ✅ Q-144 — the calendar and streak now use the user's own timezone (2026-08-08, v1.270.18)

`getCalendarData` and `getRecentTrainedDays` hardcoded `AT TIME ZONE 'Australia/Brisbane'` in SQL,
and the calendar built its upper window boundary as `Date.UTC(year, month, 1) - 10 hours` — a
hand-rolled AEST offset, the manual calendar arithmetic CLAUDE.md bans after it produced `2026-06-31`
and a 500 (#23). **20:00 in New York is already the next day in Brisbane**, so an evening workout
appeared on the calendar and streak a day late: measured at **14 of every 24 hours** for a New York
user. A third site, `getOuraWorkouts`'s `unreviewed` 30-day lookback, had the same class.

`timezone` now threads from the session through all three; `session.user.timezone` was already on the
JWT the whole time. The window is now `aestMidnight(year, month + 1, 1, tz)`, which normalises month
overflow, so December → January rolls correctly instead of depending on arithmetic that only worked
at UTC+10. **Zero `TODO(tz)` markers remain in the tree.**

**Verified by mutation, not just by going green:** reverting the SQL to the hardcoded zone fails two
of the four new tests with exactly the original symptom (the workout files under the Brisbane key
instead of the New York one). The fixture instant is **derived from the clock**, since
`getRecentTrainedDays` anchors on today's local midnight and a hardcoded date would be one side of a
rolling window — the shape that took a test red on `main` on 2026-08-03. There is also an explicit
assertion that the two zones disagree on the chosen instant, without which every other assertion in
the file would be trivially true. The Brisbane case is asserted too, so "fixed" cannot quietly mean
"now wrong for the owner".

**NOT observed in the wild** — verified against the local DB; no second real account exists in
production yet. The owner's own data is unaffected by construction (same zone in, same buckets out).
Server-side only, no device path. Other `DEFAULT_TZ` fallbacks outside these three sites were **not**
swept — each needs its own check for whether a session timezone is even reachable there.

### [heart-rate][workouts] ✅ "Adequate rest" now requires a measured recovery (Q-149, found + fixed 2026-08-08, v1.270.26)

Measured while answering Q-11: `set_hr_stats.rest_adequate` was non-null 278 times and **true all 278
times**, with **271 (97.5%)** coming from `analyseHrRecovery`'s `bpmAtLog < 120 → true` shortcut. The
120 bpm threshold assumes chest-strap-grade end-of-set HR (140–170); the ring's highest recorded
`bpm_at_end` in the whole table is **128**, so the shortcut could never not fire, and the flag
answered "was the sampled HR below 120?" rather than "did you recover?".

The owner handed the call back asking for the most data-driven option, so the shortcut is **gone**
rather than re-tuned: `adequate` now requires a measured `hrr1` and returns `null` when there is
none. Re-tuning would have been the same population assumption with a different constant; requiring
the measurement is source-independent and leaves a per-source threshold (via `set_hr_stats.source`)
available later without changing what the column means. **Coverage drops from 278 verdicts to ~7** —
the honest coverage of a question this data can answer.

**No backfill:** the 278 stored `true` values remain, separated by `computed_at`; the admin backfill
can recompute on request. Still open: whether 15 bpm is the right bar for this user.

Session journal: `docs/overview/entries/2026-08-08-rest-adequate-requires-hrr.md`.

### [heart-rate][workouts] ✅ Per-set HR coverage was an artefact of one backfill, not device dropout (answered 2026-08-08)

Q-11 asked for a specific re-measurement before anyone concluded anything about strap dropout: were
the 79% `coverage_ok=false` / 67% NULL `peak_bpm` figures real, or contamination from days-late
computes? Split by `computed_at`, **508 of 615 rows are the single 2026-07-22 backfill batch** (74
coverage_ok, 138 peak, **334 with zero readings**) — run over old sessions whose HR series was thin
or absent. Same-day computes since the Defect B fix carry near-complete `peak_bpm` and no
zero-reading rows (2026-08-06: 24 rows / 18 coverage_ok / 23 peak / 0 zero). Every aggregate that
treated the table as one population was measuring that batch. No evidence of systematic device
dropout; that half of Q-11 is closed. The B2 analysis blocker eased rather than cleared — rows
joining to a following set went 92 → 108, accruing ~10–13 per training day, so it is waiting rather
than re-engineering.

### [platform] ✅ Q-142 — the catch-less routes now record the Postgres cause too (2026-08-08, v1.270.15)

Finishes what #1150 started. A `DrizzleQueryError`'s own message is only `Failed query: <sql>`; the
Postgres error saying *why* sits on `err.cause`. #1150 fixed `reportServerError` (13 routes' own
catch blocks); this fixes `recordRequestError` behind Next's `onRequestError` — which per
`docs/module-map.md` §14 covers **the 80 route files with no `catch` at all**, the larger population,
whose failures previously reached the client as a bare 500 with no trace anywhere.

**The constraint that shaped it:** `request-error.ts` can never import `lib/observability.ts` — that
module reaches the DB via `getRepositoryAsync()`, which pulls the Drizzle adapter → onnxruntime-node,
which webpack cannot bundle from an instrumentation entry point. So `summariseCause` moved to
**`lib/observability/pg-cause.ts`**, which imports nothing; `lib/observability.ts` re-exports it. One
implementation, two callers — the alternative was a second copy on the instrumentation side, which is
how this project's duplicate-formula bugs start.

**Deliberate:** dedup keys on the **base** message, before the pg-code prefix. The prefix is derived
from the same error so it cannot separate two distinct faults, but a cause that *varies* between
identical failures (a pool timeout carries no code where a statement timeout carries `57014`) would
write a row per occurrence and defeat the 60 s window that stops a broken route filling the DB.

**Verified:** 4 end-to-end tests against the real `error_events` table (not a mock) — the `57014`
prefix lands inside `left(message,120)` where the standing session-start query can see it, the
codeless pool-timeout shape falls back to the cause message, a plain error is unchanged, and a
varying cause does not defeat the dedup. Skips cleanly without `DATABASE_URL`. Full suite + lint +
Custom Rules green.

**NOT yet observed in production** — no failure has occurred since either fix deployed, so the codes
landing in prod is still unconfirmed; the next occurrence is the real confirmation. **This is what
unblocks Q-107's batching half:** one `error_events` read now settles whether the cause is
`statement_timeout` (`57014`, batching aimed correctly) or codeless connection-acquisition failures
(something else). Read the codes before writing that PR.

### [workouts] ✅ Workout card's RECOVERY chip strip was unreadable (found 2026-08-07, fixed 2026-08-07, v1.269.2)

The chips ran as an **infinite marquee**, not a static clipped strip — which is why they were sliced
mid-word at both edges ("…lers" for Shoulders) on every glance: the row was permanently in motion
and could never be read at rest. Worse for anyone with `prefers-reduced-motion`, where
`globals.css` neutralises the animation and everything past the first two chips became unreachable.

Fixed by letting the chips **wrap** (`components/workout/muscle-recovery-card.tsx`). Deliberately
not a horizontally-scrollable strip: this card renders inside the session carousel's swipe
container, which sets `touchAction: "none"` and hand-rolls its touch handlers, so a scrollable child
would fight the carousel gesture — the conflict the gesture rule in CLAUDE.md warns about. A wrapped
row needs no gesture at all.

Verified against the dev server across all three seeded sessions: every chip inside its wrapper, two
rows, workout card unchanged at 594dp (the muscle diagram is `flex-1` and absorbs the extra line).
**Leftover:** the `ta-marquee` keyframe in `app/globals.css` now has no callers, and CLAUDE.md's Key
Files table still lists it as live — worth a cleanup sweep, not urgent.

### [cardio] ✅ Guided-walk summaries show cadence, leading pace (Q-84, 2026-08-05, v1.265.0)

Owner report. Cadence was already live on the walk screen, computed per interval
(`computeWalkSegmentStats` → `avgCadenceSpm`) and persisted (`activity_logs.cadence_spm*`, migration
140). It fell out in exactly one place: `aggregateSegmentsByKind` built `KindAggregate` from HR, pace
and distance and read straight past the value sitting on each segment.

Cadence now **leads** — on an interval walk, step rate is the direct effort read while pace over a
1–3 minute block is a small, error-prone GPS sample. It falls back to pace when no cadence source was
connected, so a strapless walk reads exactly as before rather than leading with a dash; the unit
disambiguates. `walkEffortDisplay()` owns that decision because three surfaces render the pair (the
summary's fast/slow cards, its per-interval rows, the walk-config history card) and a per-site copy is
the display-format drift the sibling-surface rule names.

**⚠️ Not exercised: the rendered pixels.** The three components are client-only and this repo has no
component-render test setup (jsdom is present, React Testing Library is not — adding it for a
formatting change was disproportionate). The *decision* is a tested pure function; what is unobserved
is layout, specifically whether the extra token on `KindColumn`'s secondary line wraps at the S25
width. It is a `<p>` so it wraps rather than overflows, but that is reasoning, not observation.

**⚠️ Also not exercised: a real Polar H10 walk.** Cadence is non-null only with the strap connected
(`RING_CADENCE_VALIDATED = false` — ring cadence stays gated off), so on-device confirmation needs an
actual interval walk wearing it. The aggregation itself was verified through the real route against
seeded rows, including the mixed case where one segment has cadence and another does not.

### [readiness] ✅ Body Battery checked against subjective recovery (Q-79, 2026-08-05, v1.264.0)

`GET /api/admin/battery-recovery-calibration` → **Body Battery vs how recovered you felt**, under
Admin → Day Review beside the Sleep Score calibration.

**⚑ The pairing was measured, not assumed — and the assumption was wrong.** The causally appealing
version (a day drains you, you report it the *next* morning) finds nothing:

| pairing | n | r | p |
|---|---|---|---|
| **same date** | 33 | **−0.390** | **0.018** |
| rating the next morning | 33 | +0.115 | 0.52 |
| battery of the previous day | 32 | −0.000 | 1.00 |

Only same-date reproduces the review's r = −0.400 — both are downstream of the same night (the
battery day starts from an overnight-recovery anchor, and the morning rating describes that night).
The module comment carries this table and says not to "fix" it into a lag without re-measuring.
**Negative r is agreement:** `perceivedRecovery` stores 1 = fully recovered … 5 = wrecked, and the
engine flips it onto a higher-is-better axis before ranking. That sign has its own test.

**One engine, not a copy.** The rank maths, buckets, spread comparison and note rules moved to
`packages/shared/src/health/model-report-calibration.ts`; both calibrations are thin adapters. The
sleep module's public API and route contract are **unchanged** and its 14 tests pass untouched, which
is what proves the extraction was behaviour-preserving. The card followed —
`components/admin/calibration-card.tsx` is the panel and the sleep card dropped ~190 lines to ~50.
Rating labels now come from `storedOrderLabels()` over the check-in's own copy, so a reworded scale
cannot leave a panel using the old words.

**Deliberately admin-only.** The gradient is modest (3.00 / 3.00 / 2.65 across battery bands
< 40 / 40–60 / > 60) and the owner already knows how they felt. The value is noticing when the
agreement breaks after a model change.

**Not exercised: the S25 viewport** — Day Review now carries a second calibration card, not viewed on
device or at ≤640px. No native/safe-area/gesture/notification surface, so no device gate.

### [readiness][workouts] ✅ HRV vs training volume, surfaced but not automated (Q-78, 2026-08-05, v1.263.0)

`GET /api/health-trends?view=hrv-volume`, an **HRV vs volume** pill in the Trends card. Overnight
HRV → same-day tonnage **r|t = +0.495, p = 0.006, n = 30**; median split **4,376 kg vs 5,799 kg**.
`recovery-vs-strength?metric=hrv` was already scoring this input — against mean 1RM percent, which is
the weaker read. Night RHR agrees in direction (r = −0.491) but fails the trend control (p|t = 0.079)
and is not offered here.

Coding: HRV as **percent of a 28-day baseline** (matching the sibling view — a raw-ms median is a fact
about one ring, and r is unchanged by the rescale), tonnage summed **per day** (two sessions share one
overnight reading; two points at the same x would double-weight the day and inflate n against the
significance gate).

**⚠️ Deliberately not automated, and this should stay true until re-measured.** The backlog entry
named the prescription engine as a candidate consumer. **n = 30 does not survive Bonferroni** across
the ~60 pairs the review tested. Surfacing it as an observation is safe; letting it move a
prescription is not. **Re-measure at n ≥ 60 before wiring it anywhere.**

**Not exercised: the S25 viewport** — the Trends pill row now carries nine pills and has not been
viewed on device or at ≤640px. No native/safe-area/gesture/notification surface, so no device gate;
the overflow behaviour is unverified visually.

### [sleep] ✅ Bedtime vs sleep — the one finding that survives Bonferroni is now a view (Q-77, 2026-08-05, v1.262.0)

`GET /api/health-trends?view=bedtime-sleep`, surfaced as a **Bedtime vs sleep** pill in the Trends
card. Measured against production before it was built: **−0.70 h of sleep per hour later to bed**
(r|t = −0.534, p < 0.001, n = 52); before 22:00 → 8.15 h, after 23:00 → 6.92 h, and the wake time
does not compensate.

The risk in this view was never the statistics — it is the **encoding**. Bedtimes wrap at midnight,
so a raw clock hour puts 00:30 (0.5) below 22:30 (22.5) and reverses the finding to **r = +0.75**,
reading as *"later bedtime → better sleep"* at high apparent significance. It uses `minutesFromNoon`,
and the route test **flips to raw-clock coding and asserts red** — reproducing r = +0.768 against the
review's measured +0.75. A comment could not have held that line through a refactor.

Built on `nightSessions()` (Q-76) and inherits Q-75's n ≥ 20 / p ≤ 0.05 / day-index partial gate with
no new code. Cache needed nothing — the `health-trends:` prefix family is already in the health-write
groups.

**Deliberately not built:** bedtime → deep sleep (r|t = −0.301, **p = 0.038**) does not survive
Bonferroni across the ~60 pairs the review tested, and the bucket bars carry one value per bucket.

**Also fixed in passing:** `CorrelationBars` signed every value, so a sleep-efficiency percentage
rendered as `+92` and a 1–5 recovery rating as `+3.0`. Only three of the eight views are baseline
deltas; the rest are absolute readings and are unsigned now.

**Not exercised: the S25 viewport.** The Trends pill row is a horizontal scroller and now carries
eight pills instead of seven. It was not viewed on device or at ≤640px — Playwright is not installed
in the sandbox and installing it for this was disproportionate. Nothing native, safe-area, gesture or
notification is involved, so there is no device gate; the overflow behaviour with the extra pill is
simply unverified visually.

### [heart-rate][workouts] ✅ Per-set HR now records which device measured it (2026-08-05, v1.260.0)

From the null-rate sweep — the follow-up the gap sweep named as its own blind spot. **847 columns
across 69 tables**, one `count(col)` each: **49 are 100% null in a table that has rows.** Most were
classified out (optional inputs, tombstones, frozen Cloud columns, and columns whose *input* is null
rather than whose producer is missing — each checked against its writer). Two survived:
`oura_daily_derived`'s ten always-null columns, which is the queued **Q-7b** confirmed and its count
corrected from eight; and **`set_hr_stats.source`** — declared in migration 139, never written,
never read, across 582 rows.

`source` now records `chest_strap` / `oura_ble` / `mixed` per set. The data was always there —
`getHrForWindow` selects it and the workout-level summary already used it; it just never reached the
per-set rows. Reads the **working-set window only**, not the rest that follows (that is where the
ring takes over if a strap comes off, and attributing it to the set would be wrong), and stays
**null rather than `'unknown'`**.

Why it matters: *"were those sets ring-only?"* is the first question asked of suspect per-set HR, and
it is exactly what the still-open half of **Q-11** needs to answer about the sessions with zero
attribution. Existing rows fill in via **Admin → Tools → "Backfill per-set HR stats"**.

Seven tests — five on the derivation, two DB round-trips. The round-trip pair earns its place:
`workout_hr_stats` failed at exactly that seam, computed correctly and rejected by the column, while
its unit tests passed.

### [platform] ✅ The rollup tests weren't flaky, they were slower than the limit (2026-08-05, v1.260.1)

CLAUDE.md carried a standing instruction to re-run DB tests alone before believing a red CI, blamed
on connection-pool oversubscription. **That explanation was plausible and never measured.**

Timed alone with zero contention, every file running a full `aggregateOuraRawSamples` pass takes
**3.4 s to 14.6 s** against vitest's **5000 ms** default — `oura-ble-sleep-bedtime-fragment` at
14.55 s, `sleep-fallback` 9.42 s, `staging-rollup` 6.51 s. Three sat within 20% of the limit before
any parallel load. The suite was flaky by construction and the documented workaround was to
disbelieve it — which cost **four false alarms in one session**.

**The v1.259.1 daytime-HRV refit was the obvious suspect and was measured out** — stubbed, the same
files take 5.50 s and 6.11 s vs 6.04 s and 5.86 s. Indistinguishable.

Fixed with a separate `rollup` vitest project at a 60 s timeout; the other ~380 files stay at 5 s so
a genuine hang still fails fast. **Not** a raised global timeout — that would hide real hangs
everywhere, which is the opposite of the point. Full suite now 397 files / 3,136 tests, exit 0, same
file count as before the split.

The CLAUDE.md rule is narrowed rather than deleted: genuine pool exhaustion is still possible and
has a **different signature** (a connection-acquisition failure, not a 5 s timeout), and the
operative line is inverted — a rollup test that times out now is worth believing. **Keep the glob in
step with `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`**; a new rollup test
outside it inherits the 5 s default and becomes the next false alarm.
### [platform] ✅ The audit view was lying — `program_phases` scoped on a column nothing sets (2026-08-05, v1.259.2, migration 167)

The gap sweep reported *"eight phase sets contain no phases"*. **That was the tool, not the data.**
`claude_ro.program_phases` scoped through `program_id`, which is nullable (migration 024 is named
for making it so) and which the modern write path never sets — `createPhaseSet`, `updatePhaseSet`
and the 042 seed all insert with only `phase_set_id`. Measured locally: **573 phases, 0 with
`program_id`, 573 with `phase_set_id`** — the old predicate could return zero rows for any user,
ever.

Fixed by scoping through `phase_sets`, keeping the `program_id` arm for legacy rows, regenerated
into migration **167** (never edit an applied migration — `ensureSchema` tracks by filename). A
DB-backed test pins the scoping and asserts the OR arm doesn't leak across users.

**The lesson is about the tool.** An audit view filtering on the wrong column doesn't fail, it lies
consistently, and every conclusion drawn through it inherits the lie. Treat a zero that no code path
explains as a claim about the *view* until proven otherwise.

Regenerating also picked up **`prescribed_runs.segments` and `exercise_library.merged_into`** —
columns added by migrations 163–166 without re-running the generator, and therefore unreadable under
the default-deny schema. Four migrations had missed that step.

### [platform] ✅ Data-collection gap sweep — every table counted and dated (2026-08-05)

Prompted by the `workout_hr_stats` find: that table was empty for every workout ever logged while
its sibling held 582 rows. The generalisation is two queries — row count per table, and latest write
per table — over all 69 production tables. Method and full classification:
[`docs/reviews/2026-08-05-data-collection-gap-sweep.md`](../reviews/2026-08-05-data-collection-gap-sweep.md).

**11 empty · 16 with 1–5 rows · 19 not written in over 14 days.** After classification: **one**
confirmed defect (**Q-81 — now fixed, v1.259.1**, see below), **one** structural oddity (**Q-82** —
eight phase sets containing no phases), and everything else explained.

**`workout_hr_stats` now reads 66 rows**, one per completed session — the v1.257.2 fix and the new
backfill card both worked. That table was the sweep's control.

**Checked and NOT gaps, recorded so nobody re-chases them:** `schedule_days` is empty because all
four schedules are `type='rotation'` and that table only applies to `type='weekly'`;
`daily_zone_minutes` is a read-through cache so its staleness tracks screen visits, not data loss;
`oura_accel_chunks` is opt-in and deliberately off; and `oura_workouts` last wrote **2026-07-05**,
two days before the BLE re-key — that is the re-key visible in the data, exactly as designed.

**What the sweep cannot see:** a column that is always null inside a populated table (the
`latency`/`onset_latency` class), values that are wrong rather than absent, and rows written to the
wrong user or day. A per-column null-rate sweep is the natural follow-up and has not been run. **[Corrected on archiving, 2026-08-13: it was run the same day** — 847 columns across 69 tables, 49 fully null, two real findings. See "Per-set HR now records which device measured it" below, which is its result.]

### [app-shell] ✅ Exercise demo GIFs were CSP-blocked — every one of them (2026-08-05, v1.258.1)

`raw.githubusercontent.com` was in `next.config.ts`'s `images.remotePatterns` — with a comment
naming it as the exercise dataset host — but in **neither `img-src` nor `connect-src`** in the CSP
defined directly above it. Confirmed against the production response header, not inferred. Every
exercise GIF and still served from the dataset was blocked.

Impact was partial, which is why it went unnoticed for so long: `getThumbnail` prefers a same-origin
S3 proxy URL when one exists and only falls back to the dataset URL otherwise, so exercises with an
S3 GIF rendered and the rest silently showed nothing.

The host is now in **both** directives. Both are needed and the file already said why — the comment
above `connect-src` explains that the service worker re-issues `fetch()` for cross-origin `<img>`
loads to populate its cache, and a fetch from inside a SW is governed by `connect-src` regardless of
resource type. Adding only `img-src` would have reproduced the exact tile bug that comment was
written about, one host later.

**Verified in a browser** against `pnpm dev` at the S25 viewport: the workout screen went from one
violation per exercise to **zero**, with no other CSP violations introduced. Not measured: how many
exercises lack an S3 GIF, since the `claude_ro` view doesn't expose `gif_url`/`image_url` — the
count of what was invisible is unknown, only that it is now visible.

### [platform][sleep][readiness] ✅ Eight correlation surfaces now test before they claim (Q-75, 2026-08-05, v1.258.2) — Q-76 fixed 2026-08-05 in v1.261.0

`correlationInsight` backs all seven `/api/health-trends` views plus `/api/sleep-performance-correlation`.
It rendered a confident sentence whenever the best and worst bucket differed by more than one raw
unit — unit-blind, so one percentage point weighed the same as one whole point on a 1–5 scale — with
no significance test, no sample size, and no control. The review checked five strong-looking
production correlations and **all five failed**: three vanished once the date trend was removed, one
was an artefact of degenerate rows, one reversed direction under correct coding.

Four ordered checks now gate every claim, each with its own copy (*"we checked and found nothing"*
and *"we did not check"* must not read the same, which the old single fallback string made them):
bucket eligibility raised 3 → **5** observations, **n ≥ 20** paired days, **p ≤ 0.05** on Pearson r,
and a **partial correlation controlling for the day index**. A surviving claim renders with its
sample size; responses carry `stats { n, r, p, partialR, partialP }` and `withheld`.

**Verified end-to-end, not only in unit tests.** 45 seeded days where readiness and perceived
recovery both rise with the calendar and nothing else, called through a real authenticated route:
raw **r = 0.784, p ≈ 0** → partial **r = 0.108, p = 0.483** → `withheld: confounded`. That is the same
shape as the review's HRV-vs-date r = 0.79. The old engine would have published it. 22 unit tests
(from 9); full suite 395 files / 3,129 tests green.

**Expect several views to go quiet.** That is the fix, not a regression — a view saying *"No reliable
relationship across 45 paired days"* is the first honest answer it has given.

**Still open — Q-76:** degenerate sleep rows reach every sleep consumer, and that was one of the five
failure modes. The gate stops unjustified *conclusions*; it does not clean bad *input*, and a
correlation over degenerate rows can still be significant.
### [heart-rate][workouts] ✅ `workout_hr_stats` was empty for every workout ever — a float into an integer column (2026-08-05, v1.257.2)

0 rows across all 66 completed sessions, since migration 135 shipped. Its sibling `set_hr_stats` —
written from the same block, three lines away, same fire-and-forget shape — held **582**. The
difference was one column type: `workout_hr_stats.workout_hrv_ms` is `integer` (the **only** integer
HRV column in the schema; every sibling is `doublePrecision`) and its producer `rmssdFromRr` returns
`Math.sqrt(mean)`. Postgres rejected the whole insert with `invalid input syntax for type integer:
"38.42156862745098"`, and `console.error` inside a fire-and-forget `.catch` made it invisible — the
recap renders identically either way, so there was never a symptom.

Fixed by rounding at the write site (the column is the constraint; other rMSSD consumers want the
float). Both persist calls now use `reportServerError` so the next one lands in `error_events`.
Verified end-to-end: seeded a real HR+RR series locally so the rMSSD came out fractional, ran the
backfill in a browser, row landed with `workout_hrv_ms 42`. The regression test fails with the exact
production error when the fix is removed.

**⚠️ Owner action, one tap:** existing sessions are still empty. **Admin → Tools → Additional tools
→ "Backfill per-workout HR summary"** (new card — the route existed since 135 with no button).

### [heart-rate][workouts] ✅ Per-set HR attribution only ran when the recap was opened — fixed (2026-08-05, v1.266.1)

Four recent sessions had **no** `set_hr_stats` rows at all (2026-08-02 Pull, 2026-07-30 Upper *and*
Legs, 2026-07-26 Pull) despite hundreds of HR samples inside their own windows — zero rows, not rows
with null metrics, so attribution never ran. The only trigger was `GET /api/oura/hr-data`, the recap
fetch. Finish a workout, never open its recap, and that session was never attributed. Everything
before 2026-07-22 had rows because the backfill was run once that day; every gap was after it.

**Fixed with two changes, not just "compute at completion"** (a naive completion-time compute alone
would have re-created the same trap): `POST /api/complete-workout` now fires a best-effort
fire-and-forget HR compute/upsert at completion, **and** `listSessionsMissingSetHrStats` /
`listSessionsMissingHrStats` are now coverage-aware — a session whose only attempt produced
`readings_count = 0` stays on the backfill work-list instead of being permanently marked done. So a
live chest strap gets attributed immediately with no recap opened, and an Oura-ring-only workout
(no data yet at completion) still gets picked up by a later backfill pass once the ring drains.
Verified end-to-end against `pnpm dev`: a completed session with live HR data already in
`oura_heartrate` got both snapshot rows immediately; a completed session with no HR data got neither,
stayed on the missing-list, and was correctly picked up once HR data was added and a backfill pass
ran. See
[`docs/overview/history-2026-08-04.md`](history-2026-08-04.md).

**Still open (residual, tracked as the remainder of Q-11):** of the rows that exist, a large share
have `coverage_ok=false`/null `peak_bpm` — possibly genuine strap dropout during lifting, possibly
partly an artefact of the days-late computes this fix removes. Needs a fresh re-measurement now that
new sessions attribute same-day.

**Remedy for pre-fix gaps still needed, no code:** Admin → Tools → "Backfill per-set HR stats" — this
fix prevents new gaps, it doesn't retroactively attribute sessions that already have none.

### [app-shell] ✅ Navigation measured on the S25 — it is fast, and the cost is rendering not network (2026-08-05)

**22 navigations, app v1.256.4, owner's device.** Median settle **146.2 ms**, p95 270.4, median
press→URL 115.3. **warm 22 · cold 0** — not one navigation fetched an RSC payload.

**This closes the "navigation feels not-quite-swift" thread and redirects it.** The prefetch line of
work (#1062, and Q-70's proposal) targets a network fetch that never happens in this capture;
prefetching cannot improve a zero. But the **worst** sample, `/cardio` → `/workout` at **1348.7 ms**,
*also* had `rscCount: 0` — ~9× the median, entirely client-side render/mount work. So the remaining
cost is **rendering**, which is what Q-51's file-splitting addresses. That item now has the only
measurement pointing at it.

⚠️ **The original complaint is still unmeasured.** The owner reported tapping a *session* and waiting
for the workout screen; the capture contains `/workout` (the tab) and **no `?session` navigation at
all**. Q-70 is downgraded to 🟢 but explicitly **not refuted**.

**Also in the same capture:** `nativeVersionStatus: "unconfigured"` (the Railway token is still
unset), and `/api/oura-ble/device-metrics` returns `{"days": []}` on a device that ingested all day.


### [devices] ✅ Ring ingest is noisy but NOT lossy — verified, not assumed (2026-08-05)

The BLE log is full of `ingest POST failed` (timeouts on most drains, plus HTTP 500, 502, one 403),
and the plugin counters read `ingestPosted: 101550` vs `ingestStored: 71179` — a 30% gap that reads
exactly like data loss.

**It is not, and this was one query away from being reported as one.** Device cursor **26 389 620**;
server `max(ring_timestamp_ds)` **26 389 619**. The cursor points at the next frame to fetch, so the
server holds everything the ring has produced (809,512 frames). The gap is **dedup on re-send** —
the table keys on `(user_id, ring_timestamp_ds, tag, body_hex)` and the retry design re-posts whole
batches, exactly as `docs/oura-ble-operations.md` describes.

`error_events` holds no server error for these in 36 hours, which fits: timeouts and 502s never
reach the application.


### [app-shell] ✅ Cold start measured on the S25 — Q-1b (bundling the shell) DROPPED (2026-08-04)

The measurement Q-51 Task 3 asked for was finally taken by the owner. Home paints in **472 ms**, of
which **439 ms is the document round trip to Railway** and about **15 ms is JavaScript** (87 files,
all served from the service-worker cache).

**There is no JavaScript problem on the home screen** — the opposite of what Q-51's items 1 and 2
assumed, and the reason taking the number before committing to Stage 5/6 was worth doing. Bundling
the shell into the APK removes only that 439 ms fetch, so the whole prize is ~0.44 s against a
1.5 s threshold. **Q-1b is closed on evidence, not intuition; do not reopen it without a new
measurement.**

Also confirmed on the same pass: **returning to an already-opened tab is instant** (the v1.251.2
prefetch works) and **there is no ~1 Hz idle repaint** — both would have been bugs outranking the
whole perf question.

**The cheaper lever, if home ever feels slow again:** the service worker's navigation handler is
**network-first**, so the document waits on the network even with a cached copy. A cache-first shell
attacks the same 439 ms without bundling. Not queued — 472 ms doesn't justify it.


### [body] ✅ Scale weight trend now takes the day's lowest reading, not the first (Q-69, v1.253.2, 2026-08-04)

Owner request. A first weigh-in taken clothed used to be locked in as the day's trend with no
correction path short of a manual edit; a later, lighter reading now replaces it. Clothes only add
weight, and on an ordinary day the fasted morning reading is already the low point, so the common
case is unchanged. Averaging was rejected in planning — it launders the clothed reading into the
trend instead of replacing it.

**Two things the plan did not cover, both handled:**
- **The native toast would have started lying.** `isAdditionalReadingForDay` drives the APK's
  "Additional reading today" copy, which means *"this did not change your trend"* — false once a
  lower second reading becomes the trend. The wire field name is kept (the installed APK reads it)
  and its **meaning** moved to `!trendUpdated`, so the copy is correct in every case **with no new
  APK**.
- **Ties.** Two readings can land on the same weight; value-matching would have badged both. At most
  one row is marked, the earlier.

**Known limitation, deliberate:** `trendUpdated` means "written", not "won". With a **manual** weight
already set for the day the write proceeds and the rank merge rejects it, so the flag reads true
while the trend did not move. Verified: a 70 kg reading against a manual 80 left 80 standing.
Distinguishing them would need a read-back on every scale write for a toast nuance in a rare case,
and the behaviour is **identical to before this change**.

**Not verified on device** — the toast copy is correct by construction but was never seen rendered,
and the pending-confirm path is unit-tested rather than driven end to end.


### [platform] ~~⚠️ A failed `REINDEX TABLE CONCURRENTLY` left 42 MB of invalid indexes in production~~ ✅ CLEARED (2026-08-04)

The owner ran the maintenance step and hit `not enough space`. `REINDEX … CONCURRENTLY` builds a
second copy of every index before swapping — `REINDEX TABLE` does all four of
`oura_raw_samples`'s at once, wanting another **316 MB** free. **It does not clean up on failure**:
four invalid `*_ccnew` indexes remain, holding **42 MB**, never used by the planner and never
garbage-collected. A retry therefore has *less* space than the first attempt.

**Not yet cleaned up — needs the owner.** Procedure (drop the leftovers first, then reindex one
index at a time, largest first) is in
[`docs/db-volume-cleanup-handover.md`](../db-volume-cleanup-handover.md) §7b.

Same section records the other trap from the same sitting: **`VACUUM` cannot run in Railway's web
SQL console at all** — the console wraps statements in a transaction and `VACUUM` /
`REINDEX CONCURRENTLY` / `CREATE INDEX CONCURRENTLY` cannot run inside one. `railway connect
Postgres` is required.

### [sleep][devices] ✅ `sleep_sessions.oura_id` was globally unique while the BLE id it stores is only per-ring (2026-07-29, FIXED 2026-08-02)

**Fixed in #1004 (v1.250.7, migration 166)** — the constraint is now
`UNIQUE (user_id, oura_id) WHERE oura_id IS NOT NULL`. Safe by construction: the old constraint was
strictly stronger, so no duplicate pair could already exist, and nothing queries the table by
`oura_id` (it is a dedup guard, never a lookup key). A DB-backed test asserts two users can hold the
same ring-derived id, checked against the old constraint where it fails. Details in
[`docs/overview/history-2026-07-30.md`](history-2026-07-30.md).
The original description follows.



The BLE rollup derives `oura_id` as `` `ble:<startDs>` `` from the ring counter, with **no user
component**, while `sleep_sessions_oura_id_key` is a **global** unique constraint. Real Oura Cloud ids
are globally unique so the constraint suits them; the synthetic BLE ids are not.

Latent today — one BLE ring — but **if a second user ever wears one, their nights collide with the
owner's**. The rollup's insert arbitrates on `(user_id, sleep_start)`, which does not cover `oura_id`,
so the loser hits an unhandled unique violation; `aggregateOuraRawSamples` files write errors into its
returned `stepErrors` instead of throwing, so that user's sleep data would **silently stop landing**
with nothing surfaced. Production holds several real accounts, so this is a live exposure the moment a
second ring appears.

Found because it was already happening between *test users*: four rollup tests sharing a ds base all
derived `ble:1000000`, which was the long-running `oura-ble-sleep-window-union` CI flake (backlog
Q-21, fixed 2026-07-29 by separating the test bases). The product-side mismatch is untouched — the fix
is either scoping the id (`ble:<userId>:<ds>`) or moving the constraint to `(user_id, oura_id)`, both
of which touch the Cloud dedup key and want their own change.

### [cardio] ✅ Activity map: Atlas style, attribution hidden, HR-zone route coloring (v1.234.5, 2026-07-29)

Follow-on work after the blank-tile bug below was fixed. Three owner-requested changes, all
confirmed working on-device:
- **Tile style** switched from Thunderforest's terrain-oriented "Outdoors" to "Atlas" (clearer
  street-level detail for suburban routes) — same API key, no new provider.
- **Map attribution hidden** (`attributionControl={false}` in `activity-route-map.tsx`) — a
  **deliberate, tracked compliance deferral**, not an oversight: OpenStreetMap's ODbL and
  Thunderforest's ToS both require visible attribution, acceptable to skip only because this app
  is personal-use-only today. Tracked in
  [`docs/public-launch-checklist.md`](../public-launch-checklist.md) — must be restored (or
  replaced with a compliant collapsed/info-icon treatment) before any public release.
- **Route line colored by HR zone** instead of one flat color (`lib/activity/route-hr-zones.ts`,
  `buildRouteZoneSegments`) — ships on the historical detail view, the completion screen, and the
  passively-detected-session review sheet. Since route points carry no timestamp (the encoded
  polyline only stores lat/lng), correlating a point to an HR reading needs either a real
  `paceSeries` or, when one wasn't captured, a constant-pace-across-the-route fallback using just
  the start/end time. A real bug surfaced and was fixed along the way: one caller
  (`activity-detail-sheet.tsx`) built an ambiguous no-timezone-offset date string for the fallback
  path, which — parsed as UTC instead of local AEST — shifted every query point ~10 hours off,
  collapsing the whole route to one zone's color; fixed by using the unambiguous multi-argument
  `Date` constructor instead (same pattern the server's own date+`HH:MM`→UTC conversion already
  uses). Entries:
  [`docs/overview/history-2026-07-28.md`](history-2026-07-28.md),
  [`docs/overview/history-2026-07-23.md`](history-2026-07-23.md),
  [`docs/overview/history-2026-07-23.md`](history-2026-07-23.md),
  [`docs/overview/history-2026-07-28.md`](history-2026-07-28.md),
  [`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

### [cardio] ✅ Activity route map blank-tile bug — root cause confirmed and fixed (v1.230.2, 2026-07-28)

Root cause was the `connect-src` CSP directive, not `img-src`. The service worker's fetch handler
re-issues `fetch()` for cross-origin tile requests to populate its cache, and a `fetch()` call made
*from inside a service worker* is governed by `connect-src` regardless of the resource type —
`img-src` (fixed in #800) only covers the direct `<img>` element load, never the SW's own internal
re-fetch of that same request. `connect-src` never had the tile domains added, so the SW's fetch
was silently CSP-blocked, explaining every earlier piece of evidence (curl and direct address-bar
navigation both bypass CSP/aren't governed by connect-src, so they always "worked" while the app
never did). Confirmed via a real online-state DevTools console capture showing the exact CSP
violation on `sw.js:162`. Fixed by adding both tile providers to `connect-src` in `next.config.ts`.
The prior candidate fix (v1.230.1, a Leaflet compositor CSS promotion) was a plausible but incorrect
hypothesis and has been reverted — the CSP finding fully explains the bug on its own. Entry:
[`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

### [devices] ✅ D2 Tasks 2+3 — native `oura_raw.db` + cursor gate — device-verified 2026-07-30
The Oura history cursor no longer advances on the server's 2xx. It advances when the drained batch
is durably committed to the phone's own `oura_raw.db`, rows and cursor in one transaction under
`synchronous=FULL`; the POST is now a best-effort backup that only marks its own batch's rows
`synced=1`. The WebView reads/marks/prunes raw rows through five new plugin bridge methods rather
than opening the file. **Native — required an APK rebuild to take effect.**

Verified in-sandbox further than usual for native work: an Android SDK installs fine here
(`dl.google.com` is reachable — the earlier "no Android SDK" blocker was wrong), so the Kotlin
genuinely compiles, the debug APK builds, 23 JVM protocol tests pass, and every SQL statement was
replayed against a real SQLite engine including the kill-mid-drain rollback and the dedup-on-
re-drain case.

**Owner ran ops-doc §4 on the S25, 2026-07-30.** A Full re-sync drained 694 batches clean
("drain complete: batches=694 bytesLeft=0"), and a kill-mid-drain test (force-closed the app
partway through a second drain, reopened) resumed cleanly — monotonically-advancing cursor, no
gaps, no repeats, no errors, batches continuing to commit "N of N" across the reinit point. Two
sub-checks from the original runbook (`getUnrolledRaw`/`markRolledUp`, `rawStoreOpen`/`lowDisk`)
were not directly observable — the admin console has no UI for them (filed as backlog Q-33) — and
were inferred passing from the "batch committed locally" log lines themselves (an unopenable raw
store silently falls back to the old server-gated cursor per ops-doc I22, which would not produce
those lines at all). **D2 Tasks 4-9 (clock anchor, the on-device rollup port, neural WASM) are now
unblocked** — see backlog Q-29.

Known-by-design gaps until D2 Task 4 (clock anchor) lands: `measured_at` is written NULL (ring
deciseconds are a counter from the ring's own epoch, not wall-clock — a guessed timestamp would be
worse than none), so `pruneRaw` has nothing eligible and the raw table only grows for now. New
failure signatures are documented as `docs/oura-ble-operations.md` rows I21 (disk full → cursor
held, `lowDisk` surfaced) and I22 (raw DB won't open → degrades to the old server-2xx gate rather
than wedging the drain). No user-visible behaviour changed, so no version/changelog bump.

**D2 Task 4 (clock anchor) — ✅ merged 2026-08-02 (#953).** Ports the current epoch-aware
anchor-observation logic (`insertOuraRawSamples` in `adapter.ts`, migration 161's design — not the
plan's original, superseded single-forward-anchor shape) to Kotlin, inside
`insertBatchAndAdvance`'s existing durability transaction, and backfills `measured_at` from it.
Kotlin compiles, debug APK assembles, new JVM unit tests pass, full TS gate green. **⚠️ Still not
device-verified** — no Robolectric coverage for the SQLite path in this project, so `measured_at`
correctness against a real drain has not been confirmed on hardware; needs a real drain to confirm
before D2 Task 5 (the on-device rollup port) trusts its output. Detail:
[`docs/oura-ondevice-hybrid-implementer-progress.md`](../oura-ondevice-hybrid-implementer-progress.md).

### [cardio][devices] ✅ RESOLVED — strap cadence validated end to end, 64 → 150 spm (2026-07-27)
Metronome-referenced captures at **120** and **150 bpm** both land ~2% low (117.5 and 147.3), a
constant offset rather than a growing one, and the 150 run is the **octave test** that had never
been run: at running cadence a detector is most likely to lock onto stride and report half.
**Not one of the 14 bins came back near 75** — series 145.9–148.3, rhythm strength 0.797 (higher
than at 120). Cadence from the strap is considered validated across the walking range.

The residual −2% is stepping lag, not instrument error: the ring, whose decode path shares no
code with the strap DSP, independently read 117.1 when the strap read 117.5 against a set 120.

### [cardio][devices] ✅ RESOLVED — strap cadence has no scale error (2026-07-27)
The earlier "ratio drifts with cadence" concern (1.00 / 1.04 / 1.08 at 64 / 96 / 114 spm) was
**manual-count error, not DSP error**. Two independent proofs:

1. **Synthetic sweep** over a realistic non-sinusoidal gait waveform (asymmetric footfall +
   stride harmonic): `detectCadence` returns **+0.1% flat from 64 to 170 spm**, and 120 spm across
   109 window offsets returns 120.0–120.1. There is no cadence-dependent scale term to find.
2. **Metronome capture**: strap read 117.5 and the ring independently read 117.1 against a set
   120 bpm. Two unrelated sensors landing 2% low together means the *stepping* was 2% behind the
   metronome — a shared reading error would require a mechanism they do not share.

Hand counts run progressively low as pace rises (counting 57 steps in 30 s vs 32), which fully
explains the apparent drift. **The DSP was never wrong — do not "correct" it against hand
counts.** Metronome-referenced captures are now the standard for cadence ground truth.

### [sleep] ✅ Naps no longer overwrite nights — F-1 / Q-1 / Q-18 fixed (v1.217.1, 2026-07-27)

**Corrected 2026-07-30:** this row previously duplicated the "OPEN" finding below it —
both described the same bug, one before the fix and one after. Struck the stale OPEN
copy; this row (the fix) is the current state.

The original "my sleep score doesn't match how I slept" bug is closed. Every consumer used to answer
"which row is the night?" itself, all the same wrong way (latest `sleepEnd` wins), so a post-waking
nap won: a 20-minute nap scored **5** against a 7.86 h night, and the rollup fed its pick into the
checkpointed EMA baselines. Now one shared module (`lib/health/sleep-night.ts`) classifies windows by
**circadian position** — midpoint inside 21:00–10:00 is night sleep, anything else is a nap — and
merges night fragments up to 3 h apart. Gap-merging alone provably could not work: the one genuinely
fragmented night in production has a **105-minute** gap while three nap→night transitions have
**67/81/94-minute** gaps, so no threshold separates them; circadian position does, cleanly, across the
entire history. Verified on all five contaminated days (07-07, 07-10, 07-16, 07-21, 07-26): each now
resolves to the real night. **A night broken by a wake-up is now reassembled** rather than counted as
two — sleep sums, time-in-bed spans the gap so efficiency correctly drops, each gap counts as an
awakening, and HRV/HR are duration-weighted. Q-18 fixed with it: `body_metrics` HRV/RHR now come from
the resolved night, so a nap can no longer shift every HR-zone boundary via `resolveHrProfile`'s
28-day mean. **Not device-verified.** Note the persisted historical rows in `oura_daily_derived` still
hold nap-derived values — F-2's backfill is what corrects those, and it shipped in v1.222.0 (the
route exists; it still has to be run against production).

### [sleep] ✅ Naps no longer drag the sleep trend or the weekly digest (v1.220.0, 2026-07-27)
Residual of F-1. `computeSleepScore` has no minimum-duration guard, and while v1.216.0 wired
`nightSessions` into the readiness route, day audit and rollup, **`lib/health/sleep-trend.ts` and
`app/api/weekly-digest/route.ts` still passed raw sessions** — so a 20-minute nap scored as a night.
That trend feeds `signals.sleepScoreTrend` → the AI periodization prompt, so it could shift a
prescription. Both now resolve nights first; regression tests cover it.

### [workouts] ~~🔴 Bodyweight 1RM history has two incommensurable eras — a phantom +40% Pull-Up PR~~ ✅ FIXED (v1.219.0, 2026-07-27)
Owner call: bodyweight strength is measured in **reps**. Migration 148 rebased the six pre-changeover
rows onto the fixed `BW_REF = 100` (values generated by the real `estimateOneRm`, never restated in
SQL, and pinned by a test), so Pull-Up now reads a flat 5 → 3 → 6 → 4 → 5 → 5 → 5 → 4 rep max across
the whole history instead of a +40% rally. Both phantom PRs were re-derived from the corrected logs
(Pull-Up 114.5 → **118.0** @ 2026-06-21, Hanging Leg Raise 123.25 → **128.0** @ 2026-06-23), and every
display surface now renders bodyweight strength as a rep max via the shared `displayOneRm` helpers in
`lib/1rm.ts`. Journal:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).
⚠️ Not verified on device — none of the reworked cards have been seen on the S25.

### [workouts][platform] ✅ Local store now mirrors `exercise_library` — bodyweight exercises type correctly offline (fixed by v1.234.2)
Pre-existing bug found 2026-07-27, surfaced while fixing the above: `lib/local-store/program-assembler.ts`
used to hardcode `exerciseType: 'weighted'`, so a bodyweight exercise opened offline on the APK
rendered a kg working weight instead of a rep target. **Corrected 2026-07-30:** verified in source —
the local `exercise_library` mirror shipped in v1.234.2, and `program-assembler.ts` now reads
`lib?.exerciseType ?? 'weighted'` from it. This row previously stayed OPEN after the fix landed; fixed
now, no outstanding work (backlog Q-20 removed as well — device confirmation still nice-to-have but
not blocking).

### [activity] ✅ Step merge now decides on source rank, not raw magnitude (2026-07-29)
The rollup's max-merge guard read the stored step count **with no source filter**, so a Health
Connect total (rank 1) larger than the ring's honest count (rank 3) kept the ring's value from ever
reaching `mergeSet` — the stored daily total was whichever source produced the *biggest* number.
The guard now applies only when the stored value's `source_map.steps` ranks at or above `oura_ble`;
below that, rank decides. **Blast radius measured first and it is zero**: the eras don't overlap
(`health_connect` owns steps through 07-08, `oura_ble` from 07-09), and 07-07/07-08 carry **zero gait
frames**, so the ring produces no total for the days Health Connect still owns inside the 35-day
window. Real but latent — a correctness change, not a data change. Q-22 §3 (preview/rollup duplicate)
also verified already-fixed and struck. Journal:
[`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

### [activity][devices] ✅ The ring's step model is device-verified accurate (2026-07-29)
Guided-walk check: app **3,716** vs Samsung Health **3,759** — a **1.1%** difference over ~28 minutes
against an independent reference. Isolates blame cleanly: the `step_counter` model is accurate, and
the **live-accel tier was the entire source of the inflation**. Retro-validates the 07-28 diagnosis
(4,903 stored = 1,578 model + 3,325 from one bogus live window). ⚠️ Residual: no live window was
posted for the counted walk at all, so the orchestrator did not fire — unresolved whether that is
correct (gate never detected a walk) or a missed trigger. With the model trusted and the live tier
gated, a missed live window is the safe direction.

### [activity] ✅ Three more step faults fixed (v1.234.2, 2026-07-29) — model verified on device, orchestrator not
Three agent sweeps after the live-window over-count found the **larger** bug. (a) The posted count was
**never gait-gated on the default path** — `step-orchestrator.ts` posted the raw `StepPeakCounter`,
replacing it with the gait-gated count only when auto-capture was on, which defaults **off**.
`gait-step-count.ts`'s own header records that counter producing **114 "steps" over 61 s of cooking
with zero real steps** (~112/min) — comfortably *under* the cadence ceiling, so the morning's gate
could not catch it. Now gait-gated on every burst. (b) **Overlapping live windows were summed**:
`upsertStepLiveWindow` conflicts on `(userId, startDs)` only, so a retry a decisecond later inserts a
second row; production holds **15 overlapping pairs**, one cluster crediting 375 steps for a span
that should credit 301. Now deduped greedily (can only lower a total). (c) A **midnight-crossing
window was counted twice** — credited whole to the start day while the next day's model windows over
the same minutes were never dropped. Now split pro-rata via the shared `dateStrMidnightInTz`. Journal:
[`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

### [activity] ✅ Step counts no longer inflated by impossible live windows (v1.229.2, 2026-07-28)
Owner-reported: the app showed **4,903 steps** while Samsung Health showed **911**. Running the real
pipeline over the day's own 539 raw gait windows reproduced the stored number exactly — Oura's
`step_counter` model gives **1,578**, and one live-accel window claiming **3,605 steps in 12.5 min
(289/min)** made up the rest. That is impossible *for this counter*: its 350 ms refractory and the
`GAIT_CADENCE_MAX_HZ = 2.8` band cap it at ~168/min. `POST /api/oura-ble/live-steps` bounded steps
and duration but never checked them against each other, and a live window **overrides** the model for
its whole span — so one bad row replaced good data rather than adding noise. Three stored windows are
impossible (289, 190 and **1,145** steps/min), one per affected day. Shipped: shared
`isPlausibleStepWindow` derived from the detector's own band edge, enforced at both ingest routes
(reject, never clamp) and inside `mergeStepCounterWithLive` so already-stored bad rows stop
suppressing the model. Journal:
[`docs/overview/history-2026-07-28.md`](history-2026-07-28.md).

### [activity] ✅ Root cause: the posted step window came from a different stream than the count (v1.228.5, 2026-07-28)
Proven, and it is the **window**, not the count. `StepPeakCounter` applies its 350 ms refractory *in
samples*, so `count / accel_seconds` is hard-bounded — 60 s of a maximal spike train yields 167 steps
(2.78/s, under the 2.86/s ceiling). But `steps` accumulated from the **0x33 accel** stream while
`endDs` was `lastGateDs + GATE_WINDOW_SPAN_DS`, derived from the **0x7e/0x7f gate** stream, which
stalls whenever the ring power-gates its radio. Three of the four post paths used it, and
`onDisconnect` with no gate frames posts a **30-second** window for a burst of up to 20 minutes.
3,605 steps needs ≥21.0 min of accel by the refractory bound and was posted over 12.5 min — so
"289 steps/min" was never a cadence, it divided a count from one stream by a duration from another.
Fixed by exposing `StepPeakCounter.elapsedSec` and taking `max(gateEnd, startDs + elapsedSec)` — the
same rule the capture path already used. ⚠️ Consequence for the three inflated days: those steps were
probably **real**, just mis-attributed to too short a window; the guard discards rather than recovers
them, because the true end is unrecoverable once written. **Still open:** whether the rate byte is
*also* sometimes wrong (the bound is relative to *reported* samples, so it cannot rule that out) —
needs an on-device counted walk.

### [readiness] ✅ Temperature deviation is withheld until the baseline is mature (v1.228.3, 2026-07-27)
Q-6. The six EMA baselines seed at **zero** (a faithful ecore port, but our fold cold-started
2026-07-07), so they climb from 0 over ~3 weeks: production `temp_dev_c` read **+17.000 °C** on
2026-07-09, +8.5, +5.25 … reaching +0.04 only by 07-27. The illness radar and readiness composite
were already gated on `nHistory`, but `temp_dev_c` is *persisted* and escaped — going verbatim into
the AI health-insight prompt and onto the day-log surface. Owner decision: keep the pinned port
untouched and **suppress the derived value** until `BASELINE_MIN_NIGHTS` (14), gated at the point of
derivation in `computeDailySummaries` so no future reader can inherit a cold value. Migration 155
cleared the **11 of 22** stored rows below that threshold; the baseline *state* columns are left
alone, since the fold resumes from them. Journal:
[`docs/overview/history-2026-07-23.md`](history-2026-07-23.md).

### [workouts] ✅ Lifetime totals now count finished workouts only (v1.218.1, 2026-07-27)
Owner decision on audit finding Q-8. `user_stats` used two different definitions of "a workout" in
one row — the session count was "has at least one log" while volume and sets swept in every
started-and-abandoned session, so ~26% of displayed lifetime volume came from workouts that were
never completed. Filtering on `completed_at` alone would have **silently deleted real training**: of
28 unfinished sessions, **14 carry a full 6-exercise / 18-set workout**, all dated 2026-05-01 →
2026-06-21, i.e. before the completion flow was reliable. The other 14 are 12 empty shells (0 logs —
the row is written when the screen opens) and 2 genuine one-exercise abandons. So migration 146
stamps `completed_at` on the historical finishers (≥3 logged exercises, set to the session's own last
log, never `now()`), and only then do the counters filter on it. Production effect: **61 → 58
sessions, 257,966 → 251,516 kg** — against 44 / 191,260 kg had the backfill not run first.

### [activity][devices] ✅ D0 CLOSED (2026-07-23): ring steps from `step_counter` — bug found+fixed, accuracy confirmed, history corrected
Full arc, resolved: shipped (v1.196.0) → owner's on-device check found `step_counter` returned **0 on
clear walking** → root-caused to a `steps_motion_decoder`↔`step_counter` **stepmotion column-order
mismatch** (the model read `stride_frequency` from the wrong slot) → fixed (`STEPMOTION_MODEL_ORDER` in
`step-counter-pipeline.ts`, real-walk regression test added since the golden fixture is all-zero noise
and can't catch this class of bug) → **accuracy confirmed**: owner's counted 100-step walk matched a
≈99.3-step model burst → owner reviewed the historical-correction preview (`/admin/oura-ble` → "D0
historical step backfill") and ran it: **14 days corrected, 223,191 → 73,055 total steps**, re-preview
confirmed 0 days remaining. No `manual`-sourced day was touched (sourceMap rank protection verified by
test). **No further action needed.** Master plan D0; full history in
`docs/overview/entries/2026-07-2{1,2,3}-d0-*.md`.

### [activity][devices] Continuous step capture Chunk 1 (v1.143.0, session 291) — ✅ day-one run VERIFIED on-device (2026-07-15); role reframed by the Oura-models program
The production capture loop (`lib/oura-ble/continuous-capture.ts` + `/api/oura-ble/accel-chunks` +
`oura_accel_chunks`). **Day-one diagnostics (owner, 2026-07-15):** ~2 h clean streaming (102k
frames, 447 steps incl. a verified walk burst), live-HR pause/resume worked in production,
**~4%/hr battery while streaming**, reconnect/stall re-arms fired correctly, and the end-of-day
bounded retry queue dropped ~10 chunks as designed while the server was mid-migration. Confirmed
limit: the WebView-alive gap is real — the app was killed 12:16–21:27 AEST and that whole span had
zero step coverage. **Role reframed (owner-ratified):** sub-plan D's `steps_motion_decoder` port
(recorded gait windows, all-day, app-independent) supersedes streaming as the primary step source;
this pipeline stays opt-in/off as D's ground-truth validator and the AAD capture asset (see
backlog item 1 reconciliation). Toggle is OFF; steps recording (REAL_STEPS) restored.

### [platform] ✅ `TOKEN_ENC_KEY` unset — the boot log was crying wolf; measured and quieted 2026-08-13

Every container start logged `[token-crypto] TOKEN_ENC_KEY unset — token writes will fail closed`,
twice, at `error` severity. **The variable is genuinely unset and the message overstated the
situation**, which three measurements settle:

- **`encryptToken` has exactly two callers** — `saveOuraPat` and `saveOuraOAuthTokens`. Both mean
  connecting an Oura *Cloud* credential, a surface that has received no new data since the
  2026-07-07 BLE re-key. Nothing that runs day to day can reach the fail-closed path.
- **Production's stored tokens cannot be affected.** The `oura_tokens` row was written **2026-06-22**
  and never updated; `token-crypto.ts` landed **2026-08-11**. The values predate the `v1:` prefix, so
  `decryptToken` returns them unchanged with or without a key.
- **`has_pat` is `false`** — there is no PAT, only an OAuth access/refresh pair.

The `error` severity was a Railway artifact: a `console.warn` goes to stderr, and Railway labels
stderr as error.

**Fixed:** the import-time warning is gone, and the case that was genuinely silent now reports —
`decryptToken` handing back a `v1:` ciphertext because the key vanished, which Oura then rejects as
"malformed", sending you to inspect the credential rather than the key. `encryptToken` still throws;
the fail-closed property is unchanged. Both directions mutation-verified. Journal:
[`docs/overview/history-2026-08-12.md`](history-2026-08-12.md).

**⚠️ Owner, optional not blocking:** setting `TOKEN_ENC_KEY` (`openssl rand -hex 32`) is only needed
to connect an Oura Cloud credential again.

**Still open, separate:** the dead Cloud token is called on **every workout completion**
(`post-completion-hr.ts:32` → `syncHrForSession`), 401ing and logging each time. Deleting the call
would break HR sync for a user with live Cloud credentials, so it needs a decision on whether a 401
should auto-disconnect the integration. On the Q-217 backlog entry.

**Closed out 2026-08-14 (Q-224):** `TOKEN_ENC_KEY` is now read by nothing — `lib/oura/token-crypto.ts`
was deleted with the Oura Cloud integration, so the "owner, optional" action below is moot, and the
"still open, separate" dead-token call on every workout completion was removed on 2026-08-13. Nothing
is outstanding, which is what makes this archivable rather than resident.

### [sleep][devices] ✅ 43 nights of sleep windows were 14.2 h wrong — fixed and confirmed (Q-536, 2026-08-17)

- **Confirmed on the owner's device**, which is what let this leave `projectOverview.md`. After
  migrations 189 + 190 (v1.318.2) and the 10:47 redecode, the midday cluster went **43 nights → 4**,
  and 21:00–22:00 went from 25 nights to **62**. The four survivors are short daytime fragments, not
  bedtimes — filed under Q-274, which now owns the only remaining deviation.
- **Cause.** A 2026-08-17 re-pair made the ring re-drain days of buffered history;
  `isClockEpochReset` read the replayed counter as a reset and opened a spurious epoch. Its offset is
  estimated at the p10 of anchor lag, and >90% of a re-drain burst's anchors carry backlog, so it
  landed **+14.16 h** out. `aggregateOuraRawSamples` resolves every ds against `currentEpoch`, so the
  full redecode re-timed all of history. The ring clock never actually reset: minimum anchor lag
  agreed across all four epochs to within 50 s.
- **It took three deploys, and two of the three were my own mistakes.** v1.318.0's migration
  relabelled 434,707 rows against a 15 s `statement_timeout` and rolled back on every boot, silently;
  it was verified against an 8-row fixture that could not see scale. Then the redecode failed with an
  unreadable error for two more rounds because the rollup worker flattened errors with
  `err.message`, discarding Drizzle's `cause` and pg's `code` (fixed in v1.318.4).
- **Still live: Q-314**, the misdetection that caused it. Every re-pair reopens this until it lands.
- Journal: [`entries/2026-08-17-q536-clock-epoch-diagnosis.md`](entries/2026-08-17-q536-clock-epoch-diagnosis.md) ·
  [`entries/2026-08-17-q536-migration-statement-timeout.md`](entries/2026-08-17-q536-migration-statement-timeout.md) ·
  [`entries/2026-08-17-rollup-worker-error-cause.md`](entries/2026-08-17-rollup-worker-error-cause.md)



<!-- Struck 2026-08-20 by Review (session wrap-up, sweeps 29-39). Each verified fixed in
     source on main before moving -- not inferred from the queue's silence. Evidence per entry
     in docs/handoff-2026-08-20-platform-review-sweeps-29-39.md. -->

### [platform] ✅ Seven of nine hand-typed counts in `CLAUDE.md` are stale; every script-backed one is current (Q-492, 2026-08-18)

- **The lens was the file every session must read first.** Three sweeps this week each found a stale
  `CLAUDE.md` number by accident (Q-480, Q-490, Q-491). This one enumerated **every** checkable count
  and re-derived it against `main` at `63fb89c`:
  [`docs/reviews/2026-08-18-claude-md-prose-counts.md`](../reviews/2026-08-18-claude-md-prose-counts.md).
- **Script-backed: 3 of 3 current.** Sparkline (3 inline / 6 exempt), `Ran 40 of 40` custom rules, the
  rollup vitest glob. **Prose: 7 of 9 stale** — hex literals **471 → 428**; the >800-line hotspot list
  still names `more/profile-tab.tsx` (**476 lines**); "22 of 33" → **29 of 40**; `READINESS_SCORE_TTL`
  "four sites" → **6**; suite "448 files" → **504**; plus the two already filed. **Two prose counts are
  right** (score-band 17, "11 inline grep rules") — the correlation is strong, not absolute.
- **Two items are more than drift.** `more/profile-tab.tsx` **should already have been struck** — the
  same paragraph mandates it and cites `health-sections.tsx` as the precedent. And the rollup-glob
  maintenance command at `CLAUDE.md:976` is scoped to the directory the glob covers, so it **can only
  confirm the glob against itself** — a rollup test written elsewhere is invisible to the check that
  exists to find it. **Both defects are latent:** no test outside the glob calls the rollup today.
- **One ratchet with slack.** `check-component-size.js` is shrink-only; `components/workout-screen.tsx`
  is pinned at **1850** against an actual **1831** — 19 lines of regrowth that would pass silently.
- **The fix is not correcting seven numbers** — that buys a week. Cite the command, or delete the
  number and keep the rule. The file already contains the model in its own sparkline paragraph.
  *A count in prose is a claim with a decay date; a count in a script is a fact.*
- **Not exercised:** static verification only — no runtime, no device.

### [devices][platform][body] ✅ The Health Connect ingest route, driven for real — the brute-force gate is bypassable and a far-future date poisons "latest" permanently (Q-493…Q-496, 2026-08-18)

- **The only unauthenticated write into `body_metrics`, exercised for the first time.** It has sat on
  the Review baton as untested since sweep 1 because it needs `HEALTH_CONNECT_INGEST_SECRET` set. All
  four findings are **reproduced against a running server**:
  [`docs/reviews/2026-08-18-health-connect-ingest.md`](../reviews/2026-08-18-health-connect-ingest.md).
- **🔴 Q-493 — the SEC-I3 brute-force gate is bypassed by rotating one request header.** The limiter
  keys on `x-forwarded-for`'s **leftmost** hop, which is the value the *client* supplies. Measured, 30
  wrong-secret attempts each way: **fixed** header → 1 key at count 20, gate engaged; **rotating** →
  **30 keys at count 1, all 30 reached the secret compare.** **Seven sites** share the pattern,
  including `admin/day-review` (bearer path to the owner's full health history). Nothing in the docs
  records it, and the R1 security-hardening plan *propagated* it as "the existing pattern".
  **⚠️ Unverified: whether Railway's proxy sanitises the header** — not determinable from the sandbox,
  and production's limiter was not probed. The fix does not depend on the answer.
- **🔴 Q-494 — one far-future date permanently captures every `ORDER BY date DESC LIMIT 1` read.**
  `POST {"date":"9999/12/30","weightKg":499}` took `getMostRecentConfirmedWeightKg` from **81 kg to
  499 kg**, and no later write can outrank it. Feeds the BLE-scale confirmation path and
  `deriveActivityKcal`. **The ranked source merge is orthogonal to this, not weak against it** —
  ranking is per column *per date*, and a row on a date nothing else writes has no competitor.
  **⚠️ And it is not a novel class:** `packages/shared/src/validation/ingest-clock.ts` exists for
  exactly this and guards `scale-ble/samples`; `oura-ble/samples` is guarded downstream; the workout
  path got `resolveCompletedAt` at **Q-24 §7**, whose comment uses the same phrase — *"accepted
  unbounded and uncompared"*. **`health-connect/ingest` is the only health-write ingest path with no
  clock bound anywhere in its chain** — the sibling-surface rule missed twice. The fix is to route the
  date through `ingest-clock`, not to add a bespoke range check.
- **🟡 Q-496** — `2026-13-45` / `2026-02-31` / `0000-00-00` pass the shape regex and return **HTTP 500**
  plus an `error_events` row each. The class `normalizeDateParam` exists to prevent; this route never
  got the guard. **🟢 Q-495** — `z.coerce.number()` turns `[]`→0, `true`→1, `""`→0 kg; the route's own
  comment names two garbage inputs and both are correctly rejected, these three are not named.
- **What the route gets right, stated because three findings are refinements of it:** the gate runs
  *before* the compare and returns an identical 401 on trip; `safeCompare` is constant-time and
  length-safe; the date regex accepts both separators (the Q-130 lesson); both garbage examples its
  comment names are rejected.
- **Not exercised:** local dev server, seeded DB. Not on device, not against production, not against
  Railway's real proxy — the one unknown Q-493 turns on. All test rows, `error_events` and
  `rate_limits` rows were deleted and the 81 kg reading verified restored.

### [platform] ✅ A 31-day range that passes every guard makes two admin routes loop forever (Q-497, 2026-08-18)

- **Applied sweep 30's lesson to the *other* secret-gated route.** `admin/day-review` is gated by
  `ADMIN_EXPORT_SECRET`; sweep 30 had just shown that "needs configuration" was never a real barrier.
  [`docs/reviews/2026-08-18-admin-range-loop-termination.md`](../reviews/2026-08-18-admin-range-loop-termination.md).
- **All three of `CLAUDE.md`'s claims about the route hold** — GET-only, fail-closed on either unset
  var, and `requireAdmin` on the token path so the token widens *transport* not authority. Checked,
  not assumed.
- **🟡 Q-497 — the day loop compares strings, and `shiftDateStr` does not pad the year.** One day after
  `9999-12-31` is `10000-01-01`, and `'10000-01-01' <= '9999-12-31'` is **true** (`'1' < '9'`).
  `from=9999-12-01&to=9999-12-31` passes `normalizeDateParamIso`, passes `end < start`, and spans
  **exactly 31 = `MAX_RANGE_DAYS`** — then runs forever. Measured: still looping at iteration 5000, at
  year 10013; the control range terminates at 31. Each iteration is a `buildDayAudit` (~12 queries)
  against a `max: 10` pool.
- **The comment directly above the loop** explains the days run sequentially rather than concurrently
  because fanning out *"would starve the rest of the app (the failure mode that took production down
  in session 165)"*. The sequential loop avoids that — and then never stops.
- **Two sites; the second writes.** `admin/backfill-derived-scores:80` has the identical loop and
  identical guards, and `dryRun=false` commits — unbounded writes, not just a hang.
  `energy-balance-service.ts:152` is safe (start derived by shifting back from today).
- **Severity: medium — admin-only.** Weigh it as *"one mistyped year takes the app down"*, not an
  attack. **Fix:** pad the year in `shiftDateStr`, the single place producing the malformed value.
- **Also corroborates Q-496 directly:** `2026-13-45` / `2026-02-31` / `0000-00-00` return **400** here
  via `normalizeDateParamIso` and **500** on `health-connect/ingest` via its raw regex. Same inputs,
  opposite outcomes, one directory apart — the correct behaviour is already demonstrated next door.
- **Not exercised:** the loop was reproduced verbatim in isolation, not by hitting the route — driving
  it against a running server *is* the hang. No device, no production.

### [platform] ✅ Three unauthenticated routes buffer an unbounded request body; one parses it before any check (Q-498, 2026-08-18)

- **Lens taken from sweep 31's method note** — *find bounds declared one way and enforced another*.
  [`docs/reviews/2026-08-18-unbounded-request-bodies.md`](../reviews/2026-08-18-unbounded-request-bodies.md).
- **The shared guard is correct and is not the defect.** `readJsonLimited` uses `Content-Length` only
  as a fast path and streams with a real byte counter. Measured: 20 MB to `/api/client-error` (16 KB
  cap) was **cut off at 2,949,120 bytes**.
- **Coverage:** 113 routes take a body, **7** are guarded, **93** are not — and of those 93 exactly
  **3** are reachable without a session: `auth/register`, `auth/exchange-mobile-token`,
  `health-connect/ingest`. **The seven guarded routes are all *less* exposed than these three.**
  Measured: the two tested each accepted the **full 20,000,048 bytes**, then returned 400.
- **⚠️ Ordering separates them.** `auth/register` and `exchange-mobile-token` rate-limit **before**
  parsing, so the rate is bounded. **`health-connect/ingest` reads at line 35 and Zod-parses at 40 but
  rate-limits at 53 and checks the secret at 58** — a caller **holding no secret** makes the server
  buffer and fully parse an arbitrary body, unthrottleable because the limiter runs after.
- **Compounds with Q-493:** all three limiters key on the spoofable `x-forwarded-for` leftmost hop, so
  the ordering that protects the two auth routes is itself bypassable. Two independent defects that
  remove each other's mitigation.
- **Fix:** route the three through `readJsonLimited`, **and** move the limiter + secret check above the
  body read on the ingest route — the second is the larger win and is independent of the first.
- **Not exercised:** the actual ceiling was **not** probed (20 MB proved there is no cap; going further
  risked destabilising the server for no extra information). Railway's edge may impose its own limit —
  not checked. No device, no production.

### [platform] ✅ Two sources of truth for the next Q band; the prose one was wrong (Q-552, 2026-08-18)

- **Review's band 450–499 was exhausted by Q-499.** `docs/agents/README.md` says *"claim the next block
  of 50 above 529"* — which literally gives **530–579** and collides with **fourteen numbers already
  in use**. The predecessor baton had already written 530–579 into the handover.
- **The ledger recorded 530–537, 538–542 and 543; `544–551` were also live** across two platform
  handoffs, `docs/overview/history-2026-08-15.md`, the devices domain index and the backlog, and
  appeared nowhere in it.
- **⚠️ Correcting this row's first draft: the ledger is NOT the only defence, and the truth is more
  interesting.** Two sources exist for the same fact — the backlog's *Live pointers* row said
  **552** and is **CI-enforced** (`scripts/check-backlog-pointers.js`); the README's prose ledger and
  its *"next block of 50 above 529"* said **530** and was stale. **The machine-checked pointer was
  right the whole time**, and the collision was reachable only by following the prose instruction —
  which is what the README tells you to do, and what the Review baton had copied.
- **The check earns its place:** claiming 552 without updating the band table **failed Custom Rules**
  in this very PR (*"a band was used without being recorded"*).
- **Third confirmed instance of Q-492's thesis** — *a count in prose is a claim with a decay date; a
  count in a script is a fact* — and the first where the checked copy was silently right while the
  prose copy was silently wrong.
- **Fixed in the same PR:** claimed **552–601**, recorded 544–551, bumped the pointer to **602**, and
  pointed the instruction at the checked source. Kept as the record of why the procedure changed.

### [platform] ✅ A Known Issue was in both the live list and the resolved archive; nothing checked (Q-553, 2026-08-18)

- **Filed and fixed in the same PR**, kept as the record of the class.
  [`docs/reviews/2026-08-18-known-issue-duplication.md`](../reviews/2026-08-18-known-issue-duplication.md).
- **Q-139 read `🔴 OPEN` here and `✅ fixed` in the archive, for ten days** — 69 lines describing a bug
  fixed 2026-08-08 in v1.270.25. **Every session's mandated orientation read showed a red,
  highest-severity open issue for a ten-day-old fix.** Both halves verified fixed **in source**
  (`packages/shared/src/health/step-estimate.ts:176`), not taken on the archive's word. **Q-81** was a
  byte-identical 31-line entry in both files.
- **⚠️ Both were also archived early.** The rule allows a move only when nothing is owed, *including a
  pending device check* — and both entries name one. So: **copied rather than moved, and moved before
  it was allowed.** Resolution: cut the premature archive copies, keep the live entries (where an owed
  check belongs), fold in anything unique first.
- **Now enforced:** `scripts/check-known-issue-duplication.js`, step **41 of 41** in Custom Rules. Its
  first version reported 4 of which 2 were real, so it skips **range** headings and identifies an entry
  by its **first** Q number — both narrowings documented in the script itself.
- **Not exercised:** static reconciliation. Q-139 still owes an on-device check after the next history
  drain; Q-81 owes a production check. Neither is possible in this harness.

### [platform] ✅ The orientation indexes named paths that do not exist, one of them never built (Q-554, 2026-08-18)

- **Filed and fixed in the same PR**, kept as the record of the class.
  [`docs/reviews/2026-08-18-orientation-index-paths.md`](../reviews/2026-08-18-orientation-index-paths.md).
- **`CLAUDE.md` has had a path check since Q-153; `docs/module-map.md` and the eleven domain indexes
  had none** — though sessions are told to read them before building a helper or working in a pillar.
- **⚠️ `module-map.md:232` described a module that has never existed** — `lib/oura-ble/steps-motion-decoder.ts`
  → `decodeStepsPacket`, **zero references tree-wide**. The real port is the row below
  (`lib/oura-models/…`), itself flagged there as **"NOT yet wired"**. So the map presented *planned
  wiring* as existing infrastructure, in the table read specifically **to avoid re-implementing what
  already exists**. Marked `⚠️ NOT BUILT`.
- **Three stale rows fixed** — `app/history/` (workouts), `docs/oura-models/` (devices), `app/overview/`
  (app-shell); none exist. **Plus 49 malformed display paths** (`docs/../overview/…`) across all eleven
  indexes: link targets were correct, the visible labels were not.
- **Now enforced:** `scripts/check-index-doc-paths.js`, step **42 of 42**, covering **748 paths across 12
  docs**. Its first pass reported 59 of 787 — nearly all noise — and the fixes then re-triggered it,
  since naming a path as *absent* still names it; four `DELIBERATE` entries carry their reasons.
- **Not exercised:** existence only. It does **not** check that the description beside a path is true —
  a row naming a real file while describing behaviour it lacks still passes.

### [platform] ✅ `/api/sync/pull` intermittently failed one of its ~21 parallel per-domain queries — RESOLVED 2026-08-20 as a symptom of the event-loop starvation fault

**Resolved without the fix this row proposed.** The batching of `getSyncDelta`'s fan-out was never
built, and should not be: Q-213 established that the pool exhaustion was a *symptom* of event-loop
starvation rather than a cause — `pg`'s connect timeout is a JS `setTimeout`, so on a blocked loop it
fires late and kills healthy connections while the database answers in milliseconds. Chunking the
fan-out would have changed nothing. The evidence that closes it is the retained-window census below.

Owner reported the client-side symptom: pull-to-sync on Home surfaces "Sync is backing off after an
earlier error — retrying shortly" (the deliberate Q-37 backoff-copy branch,
`session-select-content.tsx:660` — see `docs/overview/entries/2026-08-02-local-sqlite-init-recovery.md`).
That toast only means *a prior pull already failed and set the backoff window* — it doesn't say why.
Queried `claude_ro.error_events` for the real cause (per the session-start orientation rule) and
found a live, ongoing, evidenced production fault, not just a copy question.

**What the evidence shows:** the same user (`fe481797-...`) hit `/api/sync/pull` server errors
repeatedly from 2026-07-30 through 2026-08-01 (quiet since in the 7-day window checked, which per
the "stopped ≠ fixed" rule is not proof it's resolved) — a different table each time (`programs`,
`day_checkins`, `injuries`, `mood_logs`, `food_logs`, `set_logs`, `progression_styles`,
`prescribed_runs`), Drizzle's generic `"Failed query: select ..."` wrapper with no underlying
Postgres cause captured in either `message` or `stack`. **Every one of these errors carries the
exact same `since` cursor param, `2026-07-28T01:09:17.285Z`, unchanged across 4+ days of failures**
— strong evidence this device's local sync cursor was stuck retrying the same page repeatedly
without ever fully succeeding over that window (a partial/first-page pull failure never advances
`lastSyncAt`, so this is consistent with `pullDelta`'s existing backoff design, not a mystery — the
mystery is why the underlying query kept failing).

**Root-cause theory, not yet confirmed against Railway's own logs:** `getSyncDelta`
(`lib/data/postgres/adapter.ts:3211-3235`) fires **~21 queries in one `Promise.all`** per pull call.
The app's own DB-pool rule (`lib/data/postgres/client.ts`, documented in this file's Database
section) keeps `max: 10` connections deliberately modest — a single sync pull alone can want more
connections than the whole pool has, and the moment any other concurrent request on the same pool
also needs a connection, one of the 21 queries is the one left waiting and is the one that times out
or errors — which matches the observed fingerprint exactly (a different, effectively-random table
failing each time, same user, repeated occurrences, not a deterministic query bug that would fail
100% of the time for every user). CLAUDE.md's own Database section already flags this class of risk
for "a heavy sync domain" — this reads as that risk materialising, not a new category of bug.

**Not yet done:** confirming the pool-contention theory against Railway's actual Postgres logs
(connection-acquire timeouts / `statement_timeout` hits, not just the app's own truncated error
report); reducing `getSyncDelta`'s query parallelism (chunk the 21 queries instead of one flat
`Promise.all`) to cut peak connection demand; capturing the underlying Postgres error `cause` in the
server error-report path so this class of failure doesn't need a manual query dig next time; and
confirming whether today's live toast (2026-08-06, screenshot) is the same fault recurring or a
distinct client-side network blip that never reached the server (which would produce no
`error_events` row at all). Backlog entry: **Q-107** (`docs/implementation-backlog.md`).

**🆕 Amended 2026-08-08 — the pool-contention theory above is weakly supported, and the "capture the
`cause`" item is now its own top-priority entry.** ([review §1.1, §1.2](../reviews/2026-08-08-db-scalability-and-tooling-review.md))
Widening the query from `/api/sync/pull` to **all 98 `Failed query` events across every route** and
grouping them by the second they landed in: **77 are a lone query failing while every other query in
flight succeeded**, 12 in pairs, and 4+5 in two bursts. Pool exhaustion fails everything competing
for a connection at once — that is the shape of the two bursts, covering 21 of 98, not of the 77. An
isolated single-query failure fits a per-connection drop or `statement_timeout: 15_000` better. The
theory above is not refuted (the bursts are real, and `getSyncDelta`'s ~21-query `Promise.all` is
still a genuine peak-demand risk) but it should **not** be the first thing built. The `cause`-capture
item this row already listed under "Not yet done" is now **Q-142** with a written scope — it is the
smallest diff available and it makes the next occurrence self-diagnosing. Take it first, read one
real Postgres error, then decide whether to chunk `getSyncDelta`.

**🆕 Amended 2026-08-13/14 — much sharper burst evidence, found investigating an unrelated sleep-data
report (see the new `[sleep]` Q-225 row below), plus a candidate downstream consequence.** A 3-day
`error_events` pull found a **chronic background rate (1–9 timeout/connection-terminated/aborted
errors per hour) sustained continuously the whole time this entry has been open**, with two much
sharper bursts on top: **23 errors in the 23:00 UTC hour of 2026-08-12, 15 in the 02:00 UTC hour of
2026-08-13** — each spanning 15-20+ unrelated routes (`oura-ble/samples`, `next-session`,
`workout-sessions/day`, `sync/pull`, `body-battery`, `readiness-score`, `hr-ingest`, several
`nutrition/*` routes, and more) within the same ~20-minute window. That is a much cleaner
pool-exhaustion signature than the 2026-08-08 measurement found (max burst there was 5). The now-live
`cause` capture (Q-142, shipped) confirms it directly: `[cause: timeout exceeded when trying to
connect]` / `[cause: Connection terminated due to connection timeout]` on the app's own
`pool.max: 10` (`client.ts:19`) — not a `statement_timeout` cancellation. Checked Postgres's own
side: `max_connections = 500`, only 11 in use at check time, so there is headroom on the database;
the constraint is the app pool size relative to burst demand. **Not confirmed ongoing right now**
(0 matches in the last hour checked) — consistent with "stopped ≠ fixed," since this went quiet
before and came back. **Candidate downstream consequence, not proven:** Q-225's stale sleep-session
row was last written a few hours after the second burst ended; a fresh recomputation from the same
raw data does not reproduce it. Plausible mechanism (a rollup succeeding overall while one internal
query silently saw a partial result during contention), not confirmed. Neither the `getSyncDelta`
batching fix nor a `pool.max` increase (500-connection ceiling leaves large headroom, but this file
is CLAUDE.md's load-bearing pool config — a size change should get the same review as the
timeout/error-handler settings next to it) was done this session.


**✅ RESOLVED — production has now confirmed it, 2026-08-20.** The whole retained `error_events`
window (2026-07-20 → 2026-08-19; the table prunes at 30 days and is row-scoped to the owner) grouped
by day, counting the two connect fingerprints, this route, and the two fan-out routes:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-18 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-16 | 0 | 0 | 0 | 1 |
| 08-15 | 0 | 0 | 0 | 1 |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-11 | 20 | 1 | 0 | 38 |
| 08-10 | 16 | 1 | 0 | 31 |
| 08-09 | 33 | 1 | 3 | 2,615 |

**Every one of the three families stops dead on 2026-08-13**, the day Q-213's stages shipped. The
single connect-timeout since then landed on 2026-08-17, inside the unrelated `disk_full` outage that
day (the same date carries two `[pg 53100]` rows). Six days, one event.

**Two limits on this, stated rather than left implicit.** `claude_ro.error_events` is scoped to the
owner's rows, so this is a claim about the owner's account and not about anyone else's; and it is a
claim that the fault stopped, which the "stopped is not fixed" rule says to hold loosely — except
that here the stop coincides exactly with a shipped fix whose mechanism predicts it, which is the
one case where a silence is evidence. The app was in use throughout: `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19.

### [platform] ✅ `/api/body-battery` and `/api/readiness-score` 500'd in production — cause DIAGNOSED as the event-loop starvation fault, RESOLVED 2026-08-20

**The cause this row could not name is Q-213's event-loop starvation.** Its own leading hypothesis —
a connection-pool acquisition timeout, these two routes having the largest single-request fan-out in
the codebase (11 and 8 concurrent `repo.*` queries) — was right about the mechanism at the point of
failure and wrong about what was exhausting the pool. Both routes stop erroring on the same day
every other connect-timeout does.

Seen in the owner's device console on 2026-08-03, ~23:04–23:13 UTC. **Not reproduced and not
explained.** What is actually established:

- **It is transient, not deterministic.** `body_battery_daily` carries a row for 2026-08-04 with
  `updated_at = 2026-08-03T23:19:53Z` — the route completed successfully six minutes after the 500s,
  from the same data. A data-shape fault would not self-heal.
- **Nothing was logged.** Neither route had a `catch`, so no row reached `error_events`. Confirmed
  by query: the only rows in that window are ten React #418 hydration errors, none server-side.
- Both return **200 locally** against the seeded DB.

**What changed (this PR):** both handlers are now thin — auth + rate-limit, then a `try` around an
extracted `buildBodyBattery` / `buildReadinessScore`, with `reportServerError({ userId, url })` and a
JSON 500 in the `catch`. Proven end-to-end locally by injecting a throw: 500 body returned *and* a
row with the full stack landed in `error_events`. **The next occurrence is readable remotely** via
`POST /api/admin/db-query`.

**Leading hypothesis — connection-pool acquisition timeout. Unproven; do not record it as cause.**
The pool is `max: 10` with `connectionTimeoutMillis: 5_000` (`lib/data/postgres/client.ts`), and a
failed acquire *throws*, which in an unwrapped handler is exactly a bare 500. These two routes have
the largest single-request fan-out in the codebase — `readiness-score` issues **11** concurrent
`repo.*` queries and `body-battery` **8** (`day-timeline` is next at 10) — so they are the first to
starve under contention, and the arity bug above was making the device retry sync pulls in a loop at
the same time. That is a coherent mechanism, not evidence. One logged stack settles it.

**Systemic, filed separately as backlog Q-58:** only **11 of 200** API route files call
`reportServerError` at all, so a 500 in any of the other 189 is invisible the same way these two were.


**✅ RESOLVED — production has now confirmed it, 2026-08-20.** The whole retained `error_events`
window (2026-07-20 → 2026-08-19; the table prunes at 30 days and is row-scoped to the owner) grouped
by day, counting the two connect fingerprints, this route, and the two fan-out routes:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-18 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-16 | 0 | 0 | 0 | 1 |
| 08-15 | 0 | 0 | 0 | 1 |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-11 | 20 | 1 | 0 | 38 |
| 08-10 | 16 | 1 | 0 | 31 |
| 08-09 | 33 | 1 | 3 | 2,615 |

**Every one of the three families stops dead on 2026-08-13**, the day Q-213's stages shipped. The
single connect-timeout since then landed on 2026-08-17, inside the unrelated `disk_full` outage that
day (the same date carries two `[pg 53100]` rows). Six days, one event.

**Two limits on this, stated rather than left implicit.** `claude_ro.error_events` is scoped to the
owner's rows, so this is a claim about the owner's account and not about anyone else's; and it is a
claim that the fault stopped, which the "stopped is not fixed" rule says to hold loosely — except
that here the stop coincides exactly with a shipped fix whose mechanism predicts it, which is the
one case where a silence is evidence. The app was in use throughout: `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19.

### [app-shell] ✅ The other four render rules audited — all held, and every mechanical check over-reported (2026-08-18)

- **Completes the render lens** that sweep 26 opened.
  [`docs/reviews/2026-08-18-render-hot-paths.md`](../reviews/2026-08-18-render-hot-paths.md). Filed
  nothing; Q-490 remains the only open item in this area.
- **`key={index}` in editable lists — held.** 85 occurrences exist, but filtering to lists that are
  **both editable and deletable** gives **zero**, and the known editable lists key on stable ids
  (`meal.id`, `item.id`, `style.id`, `program.id`). **Reporting the 85 would have been wrong** — index
  keys on a static list are correct React.
- **A 1 Hz timer in the orchestrator — held.** `workout-screen.tsx:797` does hold a `setInterval`, and
  it writes `recordTraceSample(...)` to a module singleton with **no `setState`** — which is the
  pattern the rule wants, and its comment says so.
- **Zustand selector breadth — held.** The orchestrator's `useShallow` pick is **62 fields**, which
  looks alarming and is not: the hot-path *values* (`perSetWeights`, `rpeValues`) are **absent**; only
  their *actions* are picked, and action references are stable. The leaves read the values via their
  own narrow selectors (`active-set-card.tsx:40,44`). **Counting fields in a pick is not the test —
  actions vs values is.**
- **`readCacheSync` in a render body — held, and the grep flagged the rule itself.** 25 hits outside an
  effect/callback; the three in the orchestrator are all false positives, and the first
  (`workout-screen.tsx:264`) is **the comment stating the rule** — *"readCacheSync must never live in
  that path"* — reported as a breach of that rule.
- **The standing lesson, now six sweeps running:** every mechanical check here over-reported. The raw
  counts — 85 index keys, 62 picked fields, 25 bare cache reads — are all defensible, and a review
  that filed them would have produced three wrong entries and one absurd one. **The grep finds
  candidates; the handler decides.**
- **Not verified:** static analysis, no profiler, not on the APK.

> Moved out of `projectOverview.md` on 2026-08-24: an audit that found nothing and filed nothing, with
> no open work, owner check or device check owed.

### [platform] ✅ Both halves of the staleness test now audited — case (b) clean, and the mechanical test for it does not work (2026-08-18)

- **Completes the lens.** Sweep 21 audited case (a) (`freshWithinTtl`); this audits case (b),
  **seed-only read paths** — the worse half, because a seed-only key never revalidates at all.
  [`docs/reviews/2026-08-18-seed-only-read-paths.md`](../reviews/2026-08-18-seed-only-read-paths.md).
- **The naive test over-reports and must not be used.** Differencing `readCacheSync` keys against
  `cachedFetch` keys (51 vs 66) yields five seed-only candidates — `achievements:<userId>`,
  `ai-health-insight:<section>:<date>`, `mood:<date>`, and two `workout-card:*`. **All five
  revalidate. None is seed-only.**
- **Because revalidation happens three ways and `cachedFetch` is only one:** (1) `cachedFetch`;
  (2) a raw `fetch(...)` then `setCached(...)` — `ai-insight-card.tsx`, `workout-screen.tsx`;
  (3) a **local-store read** then `setCached(...)` — `session-select-content.tsx`'s `mood:` path.
  **The third matters most:** for an offline-first domain the local store *is* the source of truth, so
  "revalidate" correctly means reading SQLite, not the network. A test that looks for a network call
  marks the app's most authoritative paths as stale.
- **So the test for seed-only cannot be "`readCacheSync` without `cachedFetch`"** — it is "no
  write-back to the key from any source after the seed", which is not greppable in one pass. Five
  candidates had to be read individually.
- **⚠️ Second time this run a `Q-NNN:` comment read as an open bug and was the fix.**
  `workout-screen.tsx:272` (Q-126, lifetime XP reported as one session's gain) is the fix's rationale,
  not a live defect — as was `session-select-content.tsx:896` (Q-117) last sweep. **In this codebase a
  comment naming a Q number is usually why the code is shaped that way.** Worth knowing before
  grepping `never invalidated` or a Q number and reaching for the alarm.
- **Result: both halves of Q-262's test are audited and clean.** The most repeated bug class in this
  project currently has no live instance that either half of the documented test can find.
- **Not verified:** static audit and source reading; not on the APK or production. A stale-value bug
  arising some *other* way — a write that updates the DB without touching the local store — is outside
  what this test catches and was not looked for.

> Moved out of `projectOverview.md` on 2026-08-24: a completed audit that found nothing and filed
> nothing, with no open work, owner check or device check owed.

### [platform][devices] ✅ Production hit `disk_full` during a full re-sync — and the indexes, not the data, were the bulk (2026-08-17, resolved 2026-08-23)

**Live fault, mitigated by raising the volume; the underlying sizing is unresolved.** During the
2026-08-17 ring re-sync, `/admin/oura-ble` returned a Server Components render error and two API
routes failed with **`[pg 53100]`** — PostgreSQL's `disk_full`. Both failing queries read
`oura_raw_samples`; one is a `SELECT DISTINCT ON (tag)` over 1.1M rows, which must sort, and with
`work_mem` at 4 MB it spills to temp disk. There was no room. Confirmed in `error_events`
(`GET /api/oura-ble/device-metrics`, `GET /api/oura-ble/samples/summary`).

**Measured at the time of failure:**

| | |
|---|---|
| Database total | **583 MB**, up ~110 MB in one hour |
| `oura_raw_samples` heap | 175 MB |
| `oura_raw_samples` **indexes** | **291 MB** — 1.66× the heap |
| That one table | **80% of the database** |
| `last_autovacuum` / `last_analyze` | **never** — `n_live_tup` reads 0 |

**Three things stack, and only one of them is the archival data.**
1. The volume was full. Owner raised it 500 MB → 5 GB as a temporary mitigation. **That raise is now
   permanent and correct — the "return to stock 500 MB" target is WITHDRAWN (2026-08-18).** Railway
   cannot shrink a volume (*"Down-sizing a volume is not currently supported"*), and bills *"only …
   the amount of storage used,"* not the provisioned size — so 5 GB costs what 500 MB would. Reverting
   would mean a dump/restore onto a fresh volume: real downtime and risk on the database holding the
   ring archive, to save nothing. **Do not attempt it.** What is genuinely lost is the tripwire — 500 MB
   is what made this bloat scream rather than creep — so add a DB-size line to the session-start
   orientation read beside the `error_events` check.
2. **Indexes exceed the table.** The dedup index covers
   `(user_id, ring_timestamp_ds, tag, body_hex)` — it indexes the raw payload itself, so it grows
   faster than the rows do. **291 MB of the 466 MB is index, not data.**
3. **Autovacuum has never run on this table**, so there are no statistics either. The planner has
   been working blind on the largest table in the database; that same `DISTINCT ON` takes 6.5 s
   even with disk available.

**Why (2) matters more than it looks.** Reclaiming index space is *non-destructive* — it does not
touch `body_hex`, so it does not collide with the rule that the server archive is the source of
truth and must never be pruned. Replacing the payload in that index with a hash would preserve
dedup semantics on a fraction of the bytes. That may get under 500 MB without deleting anything,
which is a very different proposition from the retention question.

**⚠️ Correction to (3), measured after recovery — do not chase an autovacuum misconfiguration.** At
08:04 and 08:45 UTC this table reads `last_autovacuum = 2026-08-17T07:57:35Z` and
`n_live_tup = 1,097,626`. **Autovacuum has run, twice, today.** The never/0 reading was taken while
the statistics were still empty: an unclean shutdown makes Postgres discard the stats file on
recovery, and `stats_reset` stays `NULL` because only an explicit `pg_stat_reset()` sets it — so
freshly-zeroed counters look exactly like "never". `error_events` showed the same artifact, reading
`n_live_tup = 0` while holding 6,222 rows. **Every counter on this table is now "since ~07:42", not
lifetime** — which also means index `idx_scan` counts are a short window, not evidence of disuse.

**What actually consumed the space, proven.** `n_tup_ins = 0`, `n_tup_upd = 681,005`,
**`n_tup_hot_upd = 0`**. The re-sync was the *trigger* (a catch-up drain, whose re-POSTed events all
dedup to zero inserts); the *mechanism* is the full-table `measured_at` re-stamp that ops-doc I14/I25
tells the owner to run after one. The table went 360 → 666 MB — and the DB 464 → 771 MB — while live
rows went **down** by 557 and `body_hex`/`event_name` did not move at all. **Zero new data; ~306 MB
of pure bloat.**

**The fourth finding, and the one with leverage.** `measured_at` is indexed, so **no update that
changes it can ever be HOT** — each rewrites a heap tuple plus an entry in all four indexes — and it
is the *only* indexed column such a re-stamp changes. **Dropping `idx_oura_raw_samples_user_measured`
makes the whole operation HOT-eligible**, so it is both a space win and the fix for the mechanism.
Q-46's `IS DISTINCT FROM` guard is present and correct (`adapter.ts:4954`) and **is not the bug** —
it can only skip a re-stamp writing back the same value, and the Q-71/I25 clock fix changed every
row's derived value. The durable hazard: the operations manual prescribes Redecode as the remedy for
**five** failure modes (I12, I14, I19, I20, I25), so the documented fix procedure is a disk-fill
hazard until that index goes and the route gains a free-space pre-flight check.

**Is 500 MB reachable without touching retention? Yes — measured, not estimated.** `VACUUM FULL`
→ ~465 MB; + the index work → ~355 MB; + Q-540 → ~305 MB; + `error_events` self-clearing → ~260 MB.
**The owner chose A+B+C on 2026-08-17 and declined both irreversible options** (Q-542), so the
archival rule stands unchanged. Caveat worth keeping separate: *reaching* 500 MB and *holding* it
differ — vacuum alone re-crosses it in ~5 days, with the index+row work ~7 weeks, and **with Q-541
(repack) ~3 years**. Sequencing, and the owner's own runbook, in
[`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](../superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md) §0/§0a.

**Owed:** the sizing work (see the storage research item) must now be framed as *how to get back
under 500 MB safely*, not *whether growth will eventually matter* — it already does. Separately,
**do not run another Full re-sync until this is resolved**; that is what triggered it.

**Resolved on measurement, 2026-08-23 — the database is 210 MB and Q-534 is closed.** Not by
building findings 1–3, but by measuring them against a production that no longer resembles the one
they were written about: 819 MB → **210 MB**, `oura_raw_samples` 1.1M rows / 666 MB → 315k / 87 MB,
indexes 443 MB → 46 MB, **dead tuples zero**, and `n_tup_upd = 0` — direct evidence that finding 4's
fix removed the re-stamp mechanism rather than merely mitigating it. **Finding 1 was wrong:**
`body_hex` averages **24 characters** (7.3 MB across every row), so a SHA-256 digest is *larger* than
the value it would replace and MD5 buys ~11% of a 22 MB index in exchange for a collision hazard on
the dedup that exists to stop a distinct ring event vanishing. **Finding 3 is no longer live:** the
`DISTINCT ON` that took 6.5 s at 1.1M rows runs in **246 ms** at 315k. Finding 2 was already marked a
statistics artifact and autovacuum last ran 2026-08-22. What remains is elsewhere: the `VACUUM FULL`
press is **Q-315** (now `Gate: owner` — it needs an admin cookie a session cannot obtain), and the
`bytea` win is Q-540's, superseded by Q-541's packing
([`journal`](entries/2026-08-23-q534-closed-on-measurement.md)).

**Progress, 2026-08-18 — part 2.** Q-534's **finding 4 is done**: both readers of the stored
`measured_at` were rewritten to convert their window through the clock anchors and read ds-keyed, and
migration **193** drops `idx_oura_raw_samples_user_measured` — **136 MB**, the single largest
reclaim available without moving a row. It also **removes the outage's mechanism rather than
mitigating it**: with every reader deriving the time, the stored column is dead, so the redecode's
re-stamp — the non-HOT full-table rewrite that filled the disk — is now a no-op. Findings 1–3 of
Q-534 (payload-in-index, autovacuum never having run, `work_mem`) were still open at the time; all
three are closed on measurement — see the 2026-08-23 note above. ⚠️ The 136 MB is
the measured size in production, **not a reclaim that has happened** — the drop runs on the next
deploy's `ensureSchema`, and the space returns to the file only after a `VACUUM FULL`.

**Progress, 2026-08-18.** Q-541 Tasks 0–3 have shipped (v1.318.11–12) — the `oura_raw_packed` table,
the codec, and the two-tier reader every raw-frame read now goes through. **⚠️ None of it has moved a
row**: nothing writes a blob yet, so the database has not shrunk by a byte and the size numbers above
still stand. Re-measured that morning it is **819 MB**, up from 786 the day before, with
`oura_raw_samples` at 699 MB (255 MB heap, **443 MB indexes**). Tasks 4–7 — packer, backfill, prune,
`measured_at` sweep — are what reclaim the space. One cheap win was found and filed rather than
taken: **Q-315**, `error_events` holding 4 live rows in 49 MB, reclaimable by a single `VACUUM FULL`
with nothing at risk.

### [platform] ✅ The server side of the timezone problem does not exist — verified at every layer below the routes (Q-480, 2026-08-18)

- **A verification sweep, written up because a clean result is a result.**
  [`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](../reviews/2026-08-18-server-tz-and-rate-limit-verification.md).
  Sweep 11 concluded "the server is correct" by counting `todayInTz()` **inside route files**, which
  is not the whole server — a blameless route can still get a Brisbane answer if the repository
  function it calls defaults the timezone. This sweep went looking for that half. **It is not there.**
- **Checked and clean:** every caller of the three tz-defaulting repository helpers
  (`getCalendarData`, `getRecentTrainedDays`, `getNextSession`) passes the session timezone; all
  **four** timezone-sensitive SQL sites in `lib/data` interpolate a parameter, with **no hardcoded
  zone string anywhere in the repository layer**; and every call site of the shared sleep helpers
  (`nightSessions`, `isNightWindow`, `sleepScoreBaselines`, `sleepDurationTrend`, `sleepScoreTrend` —
  the ones that decide which calendar day a night belongs to) passes `tz`. Zero local re-declarations
  of `DEFAULT_TZ`.
- **This bounds Q-477.** The wrong-timezone problem is **exclusively client-side**; its fix does not
  need to touch `lib/data` or `packages/shared/src/health`.
- **Q-480 is the one finding, and it is a documentation correction.** `CLAUDE.md` says *"Repo
  day-window helpers currently **hardcode** `DEFAULT_TZ`"*. They do not — they take it as a default
  parameter that every caller overrides. The stale line marks the repository layer as known-broken, so
  an implementer taking Q-477 would start there and find nothing. Filed rather than edited directly,
  because `CLAUDE.md` is the contract all five agents read.
- **Rate limiting swept in the same pass, also clean:** all **13** routes calling
  `generateObject`/`generateText`/`streamText` are rate-limited, and **all 104 `rateLimit` keys are
  user- or IP-scoped** — zero global keys, so no route where one user's traffic can throttle another's.
- **Not covered:** whether any limit is set at the right *number*, the client half of rate limiting,
  the APK, or production.

> Moved out of `projectOverview.md` on 2026-08-24: a verification sweep that came back clean, whose
> single finding — a stale `CLAUDE.md` line about the repo day-window helpers — has since been
> corrected in that file. Nothing owed.

---

### [workouts][platform][nutrition] 🟠 Three write paths accept another user's progression-style id; the PUT twin of one of them rejects it (RV-32…RV-34, 2026-08-20)

- **The non-workout write surface, probed live with two signed-in accounts**, closing the top item on
  the Review baton's "Next" list since sweep 3.
  [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../reviews/2026-08-20-non-workout-write-surface-ownership.md).
- **🟠 RV-32 — `POST /api/phase-sets`, `POST /api/workout-templates` and `POST /api/log-exercise` all
  persist a `progression_styles` id owned by another user.** `PUT /api/phase-sets/[id]` refuses the
  **identical value** with `400 Invalid primaryStyleId` — same resource, same session. The check exists
  fourteen lines away in the sibling file and was never copied into the create twin. Each accepted row
  was read back out of Postgres with a join proving a different owner.
- **What it costs, measured rather than assumed.** `listPhaseSets` joins the style name in **without a
  user scope**, so `GET /api/phase-sets` returned **the other account's style name**, and that field
  renders in the workout-builder review and goes into an LLM prompt. It stops there: every other read of
  `progression_styles` is `user_id`-scoped, so the borrowed style's set structure never reaches the
  borrower. Separately, all three FKs are `ON DELETE SET NULL` — **deleting your own style nulls a column
  in another user's program and workout history.**
- **🟡 RV-34 — a client-supplied `program_sessions.id` that is not yours is a raw `pg 23505` 500** plus an
  `error_events` row. It fails closed, but by accident of a primary-key constraint rather than by design.
- **🟡 RV-33 — two routes answer a correct ownership refusal with an empty-bodied 500** (`POST
  /api/progression-styles`, `PATCH /api/nutrition/food-logs/[id]`), each filing it into `error_events` as
  a server fault. The Q-462/Q-463 class, on two routes that fix missed. **Neither is a leak or an outbox
  wedge** — both were checked.
- **✅ `CLAUDE.md` write-path ownership rule (b) — a raw request body into Drizzle `.set()` — is audited
  for the first time and is clean.** 116 mutating routes, 325 `.set()` sites, the 21 taking a bare
  identifier or spread each traced to source: every one built field by field. Confirmed live —
  `PATCH /api/user/profile` sent `isAdmin`, `id` and `passwordHash` and changed none of them. **Rule (a)
  is now the only one of the three with no evidence behind it.**
- **Not exploited in the data available:** production shows 0 of 46 phase rows, 0 of 82 styled
  `session_exercises` and 0 of 280 styled `exercise_logs` pointing outside the owner's styles. `claude_ro`
  is row-scoped to the owner and **the victim's rows are the ones it cannot show** — that is "no evidence",
  not "has not happened".
- **Not exercised:** web build only (`getLocalStore()` is null), local DB for the writes, two accounts.
  The 23 other FK edges into user-scoped tables are inventoried in the write-up and unprobed.

> Moved out of `projectOverview.md` on 2026-08-24 by the Review agent that filed it. **All three
> shipped on 2026-08-20 and were re-verified in source before this move, not taken from the closure
> note:** `progressionStyleIdsOwned` now guards `POST /api/phase-sets` (`route.ts:47`),
> `POST /api/workout-templates` and `log-exercise.ts:258`; `POST /api/progression-styles` and
> `PATCH /api/nutrition/food-logs/[id]` both run inside `withRouteErrors`; and the join at
> `programs.ts:457` is scoped to the caller, so a pre-guard row reads blank instead of another user's
> words. Nothing owed. The one item this entry raised that is *not* closed — the 23 unprobed FK edges
> into user-scoped tables — is a future lens, carried in the Review baton's Next section, not an
> outstanding obligation of these fixes.

### [cardio][activity] ✅ Pace was null on 32 of the 39 activity logs that could compute it — FIXED 2026-08-24 (v1.351.0, Q-307)

`avg_pace_sec_per_km` was populated on 7 of 46 logs while 39 carried both `duration_min` and
`distance_km` — read from the column, never derived, and written as an explicit `null` at every
save site.

- **Fix:** `saveActivityLog` now derives `avgPaceSecPerKm = durationMin * 60 / distanceKm` when the
  caller supplies none, the same shape and the same call site as the existing `caloriesBurned`
  derivation from Q-230 — so the web route and the `pushMutations` outbox branch both get it from
  one shared function, by construction.
- **Migration 210** backfills the rows written before the derivation existed: an idempotent
  `UPDATE … WHERE avg_pace_sec_per_km IS NULL AND duration_min IS NOT NULL AND distance_km IS NOT
  NULL AND distance_km > 0`. Never touches a row that already carries a value.
- **Verified:** five new tests (`activity-log-pace.test.ts`) mirroring the Q-230 test's shape — fills
  a missing value, never overwrites a supplied one, stays null with either input missing, stays null
  on a zero-distance guard. Full suite green (123 files, 761 tests). Migration round-tripped by hand
  against three inserted rows on the local DB: one filled, one left alone, one left null.

> Moved out of `projectOverview.md` on 2026-08-24, same PR as the fix. **Not exercised:** the
> backfill has not yet run against the real 46-row production table this entry was measured
> against — it applies automatically on the next `ensureSchema()` cold start after this deploys,
> same as any other migration, and nothing further is owed beyond that ordinary deploy.
