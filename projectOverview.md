# TrainingAI — Project Overview

> **Lean index — orient here, then dive.** This file holds only the current status, the live
> Known Issues & Risks, and the What's Left To Do list. It is deliberately kept small; the
> per-session journal lives in the history files (see the Document Map at the bottom).

**The documentation flow at a glance:**

| Kind of work | Where it lives |
|---|---|
| **Upcoming — ready to build** | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) — a priority-ordered queue; implementer sessions take the top item per the protocol in that file |
| **Upcoming — ideas/findings** | [`docs/planned_upgrades.md`](docs/planned_upgrades.md) — open uplift ideas; they graduate to the backlog once a session writes their implementation plan |
| **Completed — session journal** | `docs/overview/history-*.md` — one entry per session, batched by size (newest in `history-newest.md`) |
| **Completed — shipped plans/specs** | `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/` (fully-shipped, historical reference) |
| **Completed — shipped uplift ideas** | `docs/overview/uplift-archive.md` (batches split out of `planned_upgrades.md`) |
| **Architecture reference** | the top of [`CLAUDE.md`](CLAUDE.md) — stack, data model, key files, Oura integration (authoritative, kept current) |
| **Session handoffs** | 🆕 **The app-shell lane is empty** — [`docs/handoff-2026-08-16-app-shell-goal-cache-and-e2e-findings.md`](docs/handoff-2026-08-16-app-shell-goal-cache-and-e2e-findings.md) (6 PRs, v1.317.1→v1.317.3; Q-255, Q-232-followup, Q-258, Q-259, Q-260, Q-262 closed). **Q-260** is the substantive fix — Health rendered a stale goal while the server, the cache *and* the device copy all held the new one, because `user-goals` was fetched by the Progress tab's group while the water goal renders on a Body card and every tab stays mounted for the app's life. Two standing beliefs corrected: Q-240's "renders the old one for 30 minutes" was never right for that path (`cachedFetchCore` always revalidates), and `invalidateGoalRecommendations()` is **inert for all six keys** — audit at [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](docs/reviews/2026-08-16-goal-invalidation-audit.md). Two follow-ups need the owner: **Q-261** (a design call on `<Label>` for button groups) and a review of the CLAUDE.md cache-invalidation rule added that day. Before that: **the 2026-08-14 UI/flow/IA cluster is closed** — [`docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md`](docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md) (11 PRs, v1.307.2→v1.314.0; Q-232…Q-244 and Q-256 done, Q-243 the only one left; the lane's file ownership is released and Q-187's UI half is unblocked; three follow-ups filed — Q-255 needs the owner, Q-257 needs a product call, Q-232-followup is cosmetic). Before that: ⭐ **Start with [`docs/handoff-2026-08-13-cross-combined-backlog-handover.md`](docs/handoff-2026-08-13-cross-combined-backlog-handover.md)** — it reconciles the two parallel sessions of 2026-08-13 into one queue and one pickup prompt. Otherwise `docs/handoff-YYYY-MM-DD-<title>.md` — the **only** handoff convention (there is no root `HANDOFF.md`); written when a session closes a cluster of related work, and records what shipped, what was deliberately not done, the traps found, and a paste-ready pickup prompt. Written via the `handoff` skill; see **Session Wrap-Up** in [`CLAUDE.md`](CLAUDE.md). Latest: [`docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md`](docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md) (an eight-PR queue drain — Q-175 the deload **week** that never reached the AI prescription, Q-183 the lifting-day zero zone-minutes scored as a failure, Q-141 redirected into a Coach chart widget after the filed route turned out to be unreachable, and **Q-182 closed**: all 35 remaining soft-delete filters covered and individually mutation-verified. Carries three method traps — a mutation's substitute predicate must name a table the query already joins; counting tests calls a two-query function covered when it is not; and Q-182's own "needs a seeded rollup window" deferral was wrong. **Two queue entries were stale when re-verified**, so re-verify before implementing). Before that: [`docs/handoff-2026-08-08-app-shell-review-backlog-ui-batch.md`](docs/handoff-2026-08-08-app-shell-review-backlog-ui-batch.md) (the **Agent-2 (UI/cache) half** of the 2026-08-07 full-app-review dispatch, worked to completion — 16 PRs, v1.270.x→v1.270.30, closing Q-119/120/121/123/125/126/127/132/133/135, Q-136 part 1, the Q-95/Q-97/Q-109 follow-ups, Q-148 and Q-111's ring half. Records **four findings that contradicted the review** and the `color-mix(in oklch, …, <achromatic>)` hue bug that was miscolouring **26 shipped sites** — with `scripts/check-color-mix-hue.js` now ratcheting it. Also the parallel-agent git traps: version collisions in `changelog.ts`, `reset --soft` leaving rebased copies of `main`, and `pkill -f "next dev"` killing its own shell). Before that: [`docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md`](docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md) (the dispatch that split that review into the two parallel agent tracks). Before that: [`docs/handoff-2026-08-06-cardio-owner-ui-bug-batch-continuation.md`](docs/handoff-2026-08-06-cardio-owner-ui-bug-batch-continuation.md) (owner UI-bug batch: Q-93/Q-92/Q-91/Q-90/Q-87/Q-86/Q-88/Q-99/Q-98 **all shipped this session** — v1.266.9→v1.267.8, joining the already-shipped Q-89/Q-94/Q-95/Q-96/Q-97/Q-100/Q-101 from earlier sessions to close out every task in the plan doc's batch (Tasks 1–16; only Task 17/Q-102 remains, and it's owner-declined — see the plan doc). Separately, Q-85 (found while building Q-83, not part of this batch) needs a planning session before it can be built. The chart.js Legend-plugin gotcha, mid-session base-drift rebases, and a GitHub Actions outage that delayed CI on this batch's last few PRs are also documented here). Before that: [`docs/handoff-2026-08-05-workouts-measured-warmup-preset-scaling.md`](docs/handoff-2026-08-05-workouts-measured-warmup-preset-scaling.md) (Q-83 **built** — v1.266.0; the sandbox traps for probing the AI time-budget path, why an ungated cap is wrong, and the Q-85 finding it produced). Before that: [`docs/handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md`](docs/handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md) (the planning session for that same work plus Q-84 guided-walk cadence, **triaged and queued, neither built at the time** — both have since shipped). Before that: [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md) (seven owner-reported bugs/features of 2026-08-02/03 — root causes, decisions, backlog Q-63…Q-69; **triaged and planned, none fixed**). Same day, also: [`docs/handoff-2026-08-03-workouts-auto-apply-phase-transitions.md`](docs/handoff-2026-08-03-workouts-auto-apply-phase-transitions.md) (auto-apply set a status but never moved the phase — #1025 / v1.252.0) |

---

## 🔖 Current Status

**Current version:** v1.303.3 · Branch: `main` · Railway auto-deploys on push to `main`.

**Last updated:** 2026-08-14.

**🆕 2026-08-13/14 — a stale sleep-session window traced to a full local repro, plus sharper evidence
for the standing DB-pool-contention fault (docs-only, Q-225).** Owner reported a displayed bedtime
2.5h later than reality. Ruled out the anchor-lag bug (too small a correction) and confirmed, by
importing the real night's raw data into the local dev DB and running the actual
`aggregateOuraRawSamples` function directly against it, that the algorithm computes the *correct*
window (matching the owner's account of a real sleep with brief overheating wake-ups) — the live
stored row just doesn't match it. Leading theory ties it to the Q-107 DB-pool-contention fault,
which got much stronger burst evidence in the same investigation (two ~20-minute windows hitting
15–20+ unrelated routes at once). Verified fix (an admin Redecode) confirmed locally; not run in
production yet. See the two `[sleep]`/`[platform]` Known-Issues rows below and Q-225/Q-107 in
`docs/implementation-backlog.md`.

**🆕 2026-08-13 — the step-decoder table leaves the browser bundle (Q-221).** The ring's own
quantisation spec was a static JSON import inside `steps-motion-decoder.ts`, so webpack compiled it
into client chunks — and `middleware.ts` excludes `_next/static`, so those chunks were served **with
no session**. It was the only thing failing the owner's rule that nothing Oura-derived is reachable
unauthenticated, and it blocked the public cut. The decoder now takes the table by **injection** and
**throws** when unset (decoding without it yields plausible wrong stride values feeding step counts
and auto-detection — a caller that cannot supply it must do nothing, and both client decode sites now
do). Served from session-gated `GET /api/oura-ble/decoder-constants`, cached client-side so an
offline cold start still works after one online session. **Verified against a fresh build:** none of
`sum_accel_mg_std`, `y_accel_std_ratio`, `stride_amplitude_frac`, `first_non_locomotor_frequency` or
`frequency_bin_high_frac` appears in any of the 154 client chunks. (The `decoder_base_settings`
matches that remain are the decoder's own property accesses, not the data — worth knowing before
reading that grep as a failure.) **This does not hide the numbers from a signed-in user and cannot**;
it closes *publication*. ⚠️ **NOT device-verified** — a cold offline launch is the case the caching
exists for and it cannot run in the sandbox. Journal:
[`entries/2026-08-13-decoder-table-off-the-client.md`](docs/overview/entries/2026-08-13-decoder-table-off-the-client.md).

**🆕 2026-08-15 — Nutrition gets its Log Food action, and its deferred decision was already made
(Q-257, v1.316.0).** Q-237 shipped the row as Water · Saved Meals; the third was deferred because a
global Log Food must pick a meal type. **That pick already existed twice** — `mealTypeForHour` chooses
by clock time against the user's own windows and is shared by the saved-meals sheet and `logPlanMeal`
*precisely so the two cannot drift*, so a third rule would have been that drift. The entry's open
question is answered with live data: `meal_types` does carry the windows (`Breakfast 6-10 … Evening
Snack 21-24`). **The size gate forced the right shape** — the button took `nutrition-content.tsx` to
803 lines, so the row was extracted to its own component, which review had not caught. ⚠️ **Not
device-verified, and the live check could not show the button**: the whole row is client-gated on
`selectedDate`, and *Water* and *Saved Meals* are absent from the fetched HTML too — the control that
proves it is client-rendering rather than a bug. Journal:
[`entries/2026-08-15-nutrition-log-food-action.md`](docs/overview/entries/2026-08-15-nutrition-log-food-action.md).

**🆕 2026-08-15 — logging water stopped invalidating five caches for nothing (Q-243).** Taken after
the IA lane closed and released file ownership. `water-log-sheet` already invalidated on both write
paths, so nothing was stale — but Home also called `invalidateReadinessInputs()`, dropping
`readiness-score`, `weekly-stats`, `progress-summary`, `muscle-recovery` and `body-battery`.
**Verified rather than trusted:** grepping `waterMl`/`water_ml`/`waterIntake` across the readiness,
body-battery, shared-health and oura-model paths returns **nothing**, so water feeds none of them and
a glass of water was making five instant-paint cards refetch. Both redundant calls removed; each
screen keeps its own `fetchMeta()`, which is a refresh rather than invalidation. **The size ratchet
earned its keep on the way:** a 3-line comment pushed `health-content.tsx` 929 → 931 against its
shrink-only baseline and failed `check:rules`, so the explanation moved to where the expensive call
actually was.

**🆕 2026-08-15 — a planned meal can be answered both ways (Q-187 phase 2 slice 2, v1.315.0).** The
IA lane's Q-237 landed, which released the hold on this. Alongside "I ate this" there is now a
dismiss for a meal you skipped, hidden once the meal is logged (that answer is *derived* from the
food, so offering "no" beside it would offer to contradict it) and undoable in one tap. **"No" is
stored and "yes" is not**, deliberately: an absent food log is indistinguishable from an unanswered
prompt, while "ate it" is already visible in the day. **The number the design protects** — a day with
prefills and no answers reporting identical totals to a plan-off day — holds structurally, because
nothing unconfirmed enters `food_logs` and none of its **23 readers** changed. ⚠️ **Not
device-verified**; local SQLite v26 has still never run on a phone, so if the plan card comes up
blank, revert rather than debug forward. Automatic prefill is deliberately still unbuilt. Journal:
[`entries/2026-08-15-plan-meal-decline.md`](docs/overview/entries/2026-08-15-plan-meal-decline.md).

**🆕 2026-08-15 — Q-270 fixed forward: the training-stress route is warmed on launch.** The column
was empty because nothing called the route — it persists only as a side effect of being rendered, on
a Health tab the app does not open by default. One sync-provider warm-list entry fixes it, **placed
deliberately off the BLE ingest path** that Q-213 traced a multi-week outage to (and with no cron
layer to fall back on). ⚠️ **Forward only — the 89 empty days stay empty**, and the persist is
unproven locally because the dev seed gates before the write. **Re-read `training_load_ots` in a day
or two; if still 0, the diagnosis was incomplete.** Unblocks Q-204. Journal:
[`entries/2026-08-15-training-stress-warmed.md`](docs/overview/entries/2026-08-15-training-stress-warmed.md).

**🆕 2026-08-15 — Q-270 diagnosed: `training_load_ots` is computable every day and simply never
computed.** All four gates of `computeTrainingStress` measured against production rather than
reasoned about, and **all four pass**: readiness is `ble-derived` (31 days), `n_history` is 40 against
a threshold of 14, RHR is present on 30 of 30 recent days, and the MET grid on 2026-08-13 spans
**1,425 minutes with 1,146 values** against floors of 720/360. So the value could be written every
day, and is written on none. **The cause is that nothing calls the route**: it computes and persists
only as a side effect of rendering the Training Stress card, for *today* only — and that card lives
on Health → **Body** while the tab defaults to **training**. ⚠️ **The fix has a footgun worth
knowing before anyone starts it:** the obvious host is the BLE ingest path, which is exactly the loop
Q-213 traced a multi-week outage to, and there is **no cron layer** to fall back on. Fix shape is
recorded on the entry; it must be measured against the Q-213 CPU signature before merging.

**🆕 2026-08-15 — the explainer says "still learning" instead of nothing (Q-105-followup, v1.308.0).**
Below 30 nights the elevated-temperature deload cannot fire, and the panel said nothing about
temperature at all — indistinguishable from the feature not existing. The entry was blocked only on
having no channel to ask; measured first (**owner at 40 nights**, crossed 30 around 2026-08-05, so
this affects new accounts and resets rather than them), then asked. Owner chose to show the progress.
Rendered as its own line, **not** as a deload reason — the helper returns `number | null` rather than
a `Signal`, so the compiler stops it joining the "why recovery is suggested" list. **The build caught
a bundle regression nothing else did:** importing the threshold from `ai-dynamic` dragged
`onnxruntime-node` into the browser bundle — the **third** Q-221-boundary breach in two days, after
`node:path` (Q-230) and the decoder table. tsc, lint and all 3,899 tests passed with it in place.
Both temperature constants moved to the import-free `deload-constants.ts` and re-exported. ⚠️ Not
device-verified, and the state itself is unreachable on the owner's account. Journal:
[`entries/2026-08-15-temperature-baseline-progress.md`](docs/overview/entries/2026-08-15-temperature-baseline-progress.md).

**🆕 2026-08-14 — Q-107 measured and closed: the batching fix would have changed nothing.** The entry
said to read `error_events` in production before building, because #1149 made the Postgres codes
visible. Doing that reversed the conclusion. The dominant fault is not pool contention at all — it is
**`[pg 21000]` cardinality violations on `oura_heartrate` inserts, 5,771 events** (Q-215's
batch-dedupe fault). The pool/connect signature is real but small (16–39/day) and **both families
stop dead after 2026-08-13**, when Q-213 stage 1 and the HR dedupe fix shipped: 08-14 and 08-15 show
**zero**. Q-213 had already diagnosed pool exhaustion as a *symptom* of event-loop starvation — `pg`'s
connect timeout is a JS timer, so a blocked loop kills healthy connections while the DB answers in
milliseconds — which is why this entry's own 2026-08-08 update found 79% of failures were a lone
query failing while everything else succeeded, the wrong shape for exhaustion. Chunking the fan-out
was never the fix. **Corollary:** `getSyncDelta` going 23 → 24 queries on 2026-08-14 is safe on this
evidence, not merely tolerated. ⚠️ **Stopped is not fixed** — two quiet days is not proof, and 08-14
had zero events of *any* kind, as consistent with a quiet day as with a fix. Re-read `error_events`
next session; if either family returns it reopens as Q-213's, not this entry's.

**🆕 2026-08-14 — the pre-build check on Q-184 says don't build it, and found an emptier pipe next to
it (Q-270).** Q-184 asks for an on-device calorie estimate — Kotlin plus an APK, the most expensive
work in the queue. Its own entry asks for a check first, and the check answers twice over.
**(a)** `activity-goal-calibration.md` §5-B's direction B explicitly *replaces* the dead
`activeEnergy`, and the owner chose direction C on 2026-08-11 — so building `active_calories_est`
means building the input the agreed direction discards. **(b)** The suggested alternative is not
ready either: **`training_load_ots` is 0 of 89 days populated in production**, despite having a live
server-side producer (`/api/training-stress`). §5-B's "already exists and may be most of it" is true
in code and **false in the data**. Two gates ruled out by measurement so nobody re-checks them:
readiness is fine (**31 days** `ble-derived` with scores, latest today) and MET events are arriving
(**222 rows in the most recent 50,000** raw samples). The likely cause is that the route only ever
computes *today*, on demand, and never backfills — which would make it **server-side work with no
APK**, far cheaper than Q-184. Filed as **Q-270**; it gates Q-204, whose design assumes that column
is most of its input. Q-184 is now recommended to be held behind both.

**🆕 2026-08-14 — Q-181's deferral re-confirmed by re-measuring it (watch-only).** The entry records a
decision *not* to build per-worker DB isolation, because every instability observed had a specific
cause that isolation would have hidden rather than fixed. A deferral is worth what its evidence is
worth, so it was re-measured: **89 files / 545 tests, 3 consecutive runs, 0 failures, 86–88 s**,
against the 2026-08-10 baseline of 387 tests at 72–107 s. The suite has grown **+41%** against the
same shared database — more of exactly the pressure isolation would relieve — and the spread got
*tighter*. The named trigger (two files failing on each other's rows, distinct ids, no migration) has
not fired. Kept as ⏳ watch-only rather than removed: it is not finishable, and deleting it would lose
the trigger's definition. Journal:
[`entries/2026-08-14-q181-deferral-remeasured.md`](docs/overview/entries/2026-08-14-q181-deferral-remeasured.md).

**🆕 2026-08-14 — Q-180 decided: keep `getOuraTimeseriesDelta`, and make the code say why.** Q-136's
route deletion left a keyset-cursor implementation and 142 lines of passing tests with no caller, and
the entry deliberately left the delete-or-keep call un-taken. Decided from measurement rather than
preference: **`ouraHeartrate` appears nowhere in `SyncDelta`**, so intraday HR reaches a fresh device
by no other path, and the owner's 2026-08-02 retention decision makes the device-local raw store a
14-day rolling window with the **server** as the archive — a re-install loses history that still
exists server-side. **The entry's real cost was the audit paragraph, not the code**, so that is what
was fixed: the method and its test file now carry the decision and its evidence, and the queue no
longer holds it. No behaviour change. Journal:
[`entries/2026-08-14-timeseries-delta-decision.md`](docs/overview/entries/2026-08-14-timeseries-delta-decision.md).

**🆕 2026-08-14 — the meal-plan prefill's table and sync path, with nothing reading it (Q-187 phase 2,
slice 1).** A prefilled meal is *suggested*, not eaten, so a prefilled row reaching `food_logs` would
make the day's totals count food nobody ate. The obvious fix — a `confirmed_at` column plus a filter
at every read — means teaching **23 files** a new filter in the domain with this project's worst
data-loss history; instead unconfirmed prefills never enter `food_logs` at all, and **none of the 23
readers change**. Only *declines* are stored: "ate it" is derivable from the food log, and a row
asserting it too would be two sources of truth for one fact. **The tests caught a real bug rather
than confirming one** — re-declining after an undo inserted a *second* row, because the unique index
is partial on `deleted_at IS NULL` and the tombstone is invisible to the conflict target; the read
filtered it out, so it would only ever have shown up as row growth. **The CI failure was a gap in the
local gate, not the diff:** `claude-ro-readonly-role.test.ts` is pinned to the newest views migration
(80 views vs 81 tables), and it **skips entirely under the socket `DATABASE_URL`** the session hook
exports — so the local run read `470 files | 1 skipped` and looked green, while the TCP form gives
`471 files, 3,900 tests, none skipped` and reproduces CI exactly. Run role-sensitive suites under
TCP, and treat a nonzero skip count as something to explain. ⚠️ **Not device-verified, and higher
risk than most**: local SQLite v25 has never run on a phone and v26 stacks on it — if Saved Meals or
the plan card comes up blank after this ships, **revert rather than debug forward**. The prefill UI
is deliberately still owed, held until the Q-237 nutrition-screen work lands. Journal:
[`entries/2026-08-14-plan-meal-answers-table-and-sync.md`](docs/overview/entries/2026-08-14-plan-meal-answers-table-and-sync.md).

**🆕 2026-08-14 — goals stop being two disagreeing copies (Q-240, Q-241).** Editing a goal PATCHed
the server and invalidated nothing, so Health rendered the previous goal for up to the `user-goals`
TTL and repainted it stale on the next cold start — while `patchProfile` forty lines above it in the
same file had always invalidated, through a group that already contained the key. **The sibling
sweep found the same omission on two Coach surfaces the entry did not name.** Underneath it, nine
goal values lived in `localStorage` *and* the database and the Health tab read three from the device
copy only; `localStorage` does not sync, so a second device or a re-install showed defaults while
the server held the real goals, with nothing to reconcile them. The payload is authoritative now and
the seed is written **from** it — including its nulls, and through the sync-provider warm list
rather than a tab, since a device that never opens Health was the case that stayed wrong. **A third
bug had to ship with it:** clearing a goal never worked — the editor sent no request when a field
was emptied, and the route's `?? undefined` made an explicit null a 200 that changed nothing
(measured live). Making the server authoritative is what would have made that visible. **Two guards
were wrong before they were right, and both are worth knowing:** the invalidation guard first
detected Coach writers by a string this fix itself introduced, so it recognised only code already
carrying the fix; and matching the goals URL and `PATCH` separately flagged `health-content.tsx`,
which only reads that endpoint. ⚠️ **Not device-verified** — JS-only, so it reaches the phone on the
next deploy, but "a second device sees the first one's goals" is by definition a two-device check.
Journal: [`entries/2026-08-14-goals-server-source-of-truth.md`](docs/overview/entries/2026-08-14-goals-server-source-of-truth.md).

**🆕 2026-08-15 — Nutrition's actions stop depending on scroll depth (Q-237, v1.314.0), closing the
2026-08-14 review cluster.** Saved Meals is a library, not an action, and it sat **below every meal
card** — so how far you scrolled to reach it depended on how many meals the day had; Water was
mid-scroll for the same reason. Both are now one row directly under the macro ring, above every meal
card. Verified by position rather than by eye: in the rendered text the ring is at index 126, Water
at 208, Saved Meals at 220, End of Day at 490. **Two things deliberately not done.** *End of Day*
stayed put — merging it with Home's "Your Day in Review" is **Q-112**, spec-sized with its own entry,
and moving it halfway is worse than either end state. *"Log Food"*, which the plan's row names, was
**not** added: no global log-food action exists (`openLogger` requires a meal type, each meal card
supplies its own), so a row-level button must *pick* one — by clock time, next unlogged meal, first
meal type, or a picker — and that is a product decision this placement change should not invent.
Filed as **Q-257**. Water's three `WaterLogSheet` mounts stay three mounts; their divergent
invalidation is **Q-243**, still open, and is a behaviour fix rather than a layout one. ⚠️ **Not
device-verified** — two-column tap targets at 412 px are the case the S25 decides (the row is
`min-h-[48px]` with `gap-3`, meeting 48 dp / 8 dp on paper). Journal:
[`entries/2026-08-15-nutrition-action-row.md`](docs/overview/entries/2026-08-15-nutrition-action-row.md).

**🆕 2026-08-15 — the admin console splits by audience (Q-234, v1.313.0).** `/admin` had nine tabs,
three sub-consoles reachable only from inside the Tools tab, and a nested "Additional tools"
collapsible inside that — two audiences in one console. **User administration** (users, invites,
feedback) stays at `/admin`, now five tabs and 395 lines from 476. **Developer diagnostics** (BLE
debug, cadence calibration, device data capture, HR backfills, time audit, error log, AI usage, model
assets) are **Settings → Developer**, admin-only, with the three device consoles as **rows** rather
than buttons inside a tab inside a console — which is what Q-239 identified as the only genuinely
misplaced single-entry screens. **`exercises`/`activities` stayed on `/admin` deliberately:** the
plan names them under neither audience, and they are content administration — the library every user
sees — not device diagnostics, so they sit with the audience they match rather than moving because
they were adjacent to things that moved. **Both sides of the gate were exercised** by flipping the
local test user's `is_admin` and re-logging in each time (reverted after): non-admin sees no
Developer row and `/more/settings/developer` redirects to `/`; admin sees the row and all three
sub-routes render real content. **A trap worth knowing:** `isAdminUser(id, flag)` returns the **JWT**
flag whenever it is a boolean and only hits the DB when it is undefined — so flipping
`users.is_admin` does nothing until a fresh login stamps a new token. ⚠️ **Not device-verified** —
four more navless takeovers on `pb-safe-action-lg`, and the consoles behind these rows are APK-only
by nature. Journal:
[`entries/2026-08-15-admin-split-by-audience.md`](docs/overview/entries/2026-08-15-admin-split-by-audience.md).

**🆕 2026-08-15 — the Program Builder gets a route, and a dead deep link comes back (Q-235, Q-256,
v1.312.0).** The app had a bottom-nav tab called **Workout** and, inside More, a second tab *also*
called **Workout**, mounting the 997-line Program Builder two containers away from the tab it
configures. It is `/program` now — reachable from a control in the Workout tab's header and from
More → Program; More has two tabs left. **Q-256 was fixed by changing the shape, not the string.**
`/config` dropped the query string through a bare `redirect()`, and `config-screen.tsx` read
`?new=program` from `window.location.search`, so the post-deload "New program" action opened the
Builder and silently never opened the sheet. Forwarding the string would have left the same trap for
the next redirect; the flag is a **prop** resolved from `/program`'s own `searchParams` instead — a
param read from the URL can be dropped by anything in between without a call site changing, a prop
cannot. Measured before and after on the same URL: no sheet, then the sheet. **The Q-223 regression
test was rewritten rather than deleted** — its specifics were gone (no `tab=` value, no
`ConfigScreen` in More) but its invariant survives: every legacy entry point must land on the
Builder carrying its parameters. **One of its assertions did not discriminate, and only mutation
testing found that** — it checked that `searchParams`/`URLSearchParams` *appear* in the file, and a
mutation keeping both while setting the suffix to `''` passed it while dropping every param. That is
a guard recognising the shape of the fix rather than its effect. It now calls the route and reads
the `NEXT_REDIRECT` digest; all six assertions are mutation-verified. **The negative assertions also
first failed on my own comments** (prose describing the very bugs they guard) — the test strips
comments now, the same shape as the Custom Rules safe-area step failing on a comment two PRs ago.
⚠️ **Not device-verified** — `/program` is a navless takeover on `pb-safe-action-lg` and the Builder
ends in tappable controls. Journal:
[`entries/2026-08-15-program-route.md`](docs/overview/entries/2026-08-15-program-route.md).

**🆕 2026-08-15 — Settings gets a screen, and `profile-tab.tsx` leaves the size baseline (Q-232 step
3, v1.311.0).** Preferences (six switches), Theme & Appearance and Home Widgets were three
collapsibles inline in the More scroll; they are `/more/settings` now, behind one row. **The file
that opened this cluster as one of six `check-component-size.js` hotspots is 465 lines, from 845,
and its BASELINE row is deleted** — the script's own rule, since a row left behind for a file under
the limit turns the ratchet into an allowlist. Five hotspots remain. The plan predicted this and it
happened **without an artificial split**: 845 → 835 (devices) → 697 (data/about) → 465 (settings),
four screens carved along seams the IA already implied. Ten pieces of state and nine handlers moved
whole, having been checked as read *only* inside the moving block — every value they set is a
`localStorage` flag some other screen reads, so nothing in More depended on where the state lived.
**The toggles were operated, not just rendered:** flipping "Rest Timer in Status Bar" wrote
`ta_pref_rest_chip = "false"`, read back out of `localStorage`. ⚠️ **Not device-verified** — the
`pb-safe-action-lg` clearance on four navless sub-screens, the push toggle (needs a real
service-worker registration and permission prompt), and whether the *native* status-bar pill reads
those flags correctly: the write side is proven here, the read side is not. Journal:
[`entries/2026-08-15-settings-screen.md`](docs/overview/entries/2026-08-15-settings-screen.md).

**🆕 2026-08-15 — "Restore from cloud" stops living under the version number (Q-232 step 2,
v1.310.0).** One block on More → Profile held the version, update check, SW status, APK download and
changelog — **and** Sync now, Restore from cloud, Export my data, all under a heading saying *About*.
The plan calls this the clearest single instance of the owner's complaint, and it is the one part
that has to be **split** rather than moved: three data operations filed under a version number. They
are `/more/data` now; the rest is `/more/about`. **Settings was deliberately left to step 3** — it is
an independent block sharing no state, so bundling it would have made one PR touching ten preference
toggles, two collapsibles and three sync handlers at once; About/Data had to move together because
they were one block. `components/more/sub-screen.tsx` now owns the navless takeover shell, extracted
at its second copy and used by Devices, Data and About. `profile-tab.tsx` is **697** lines, from 845
at the start of this cluster. **The custom-rules safe-area check failed on my comment** — the grep
found the raw inset expression in the prose explaining why the utility is floored; reworded the
comment rather than touching the check, which is the right trade for a rule with that history.
**The moved handler was run, not just rendered:** tapping *Sync now* produced "Cache cleared" within
400 ms. ⚠️ **Not device-verified** — the `pb-safe-action-lg` clearance on three navless screens, and
the *native* branches of both moved handlers (`pullDelta` and `restoreFromCloud` both return null
without SQLite, so only the fallback path runs here; Restore has never run in the sandbox at all).
Journal: [`entries/2026-08-15-data-and-about-split.md`](docs/overview/entries/2026-08-15-data-and-about-split.md).

**🆕 2026-08-15 — the Devices screen (Q-233, v1.309.0).** Ring, chest strap, scale and the
background-location permission were four cards stacked between "Goals" and "Settings" in the More
scroll, so *"is my ring connected and what is its battery?"* meant scrolling two-thirds of the way
down More. They are one screen now, `/more/devices`, behind a single row — step 1 of the IA plan's
build order, taken first because it is the smallest real win and proves the sub-route pattern.
**Three things the plan did not anticipate.** All four cards already render their own uppercase
heading, so the wrapper section headers produced *PAIRED DEVICES / INTEGRATIONS / Oura Ring 5* — a
heading above a heading, now gone. `BackgroundLocationCard` returns **null** off-device, so a
"Permissions" heading sat above nothing in the sandbox and would do the same wherever the permission
check is unavailable — caught by reading the rendered text, not the source. And **the size ratchet
fired**: swapping four component tags for a row grew `profile-tab.tsx` 845 → 850, past its baseline.
The fix was not to raise the number — the row was the *second* copy of the Admin row's markup, so it
became `components/more/more-row.tsx`, both call sites use it, the file is **835**, and the baseline
ratcheted down with it. That primitive is the grouped-list row the rest of the plan needs, arrived at
because the check refused the lazy option. One string changed inside a moved component:
`oura-section.tsx`'s heading said "Integrations", which is not what it is on a screen called Devices.
⚠️ **Not device-verified, and this screen has more riding on that than most** — it is navless, so its
trailing padding is `pb-safe-action-lg` rather than a bare `pb-safe`, every card ends in a tappable
pairing control, and the sandbox renders insets as 0; `BackgroundLocationCard` cannot render here at
all, so the Permissions half has never been seen. Journal:
[`entries/2026-08-15-devices-screen.md`](docs/overview/entries/2026-08-15-devices-screen.md).

**🆕 2026-08-15 — the More-tab IA plan is written, and it found a dead deep link (Q-232, Q-239,
Q-256).** Q-232's entry forbids executing it from the entry — the five IA items share one target
structure and working them one at a time leaves the app half-reorganised in two incompatible
directions — so this is the plan, covering Q-232/233/234/235/237 and the Q-239 decisions together:
[`docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md`](docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md).
Target is the standard grouped-list pattern with **each row a real sub-route**; all sixteen of
today's `profile-tab.tsx` sections are mapped, and **the cost claim was checked rather than assumed**
— ten already-extracted components totalling 2,053 lines, so it is routing and composition with no
screen internals rewritten. **Admin splits by audience** (user administration stays at `/admin`;
device/data diagnostics become Settings → Developer). **Q-239 is decided: five of the six
single-entry screens are "leave"** — each is genuinely the detail view of the card that owns it —
and only the `/admin/*` trio was misplaced, which is Q-234's job; the table is written down so the
next reachability sweep does not re-open it. **Q-256 found on the way:**
`components/workout/ai-prescription-card.tsx` sends the post-deload "New program" action to
`/config?new=program`, `app/config/page.tsx` does a bare `redirect('/more?tab=workout')` that
**drops the query string**, and `config-screen.tsx` reads that param from `window.location.search` —
so the sheet never opens and the action silently degrades to "open the Program Builder". Measured
live, second instance of Q-223's class, deliberately left for Q-235 to fix since that item rewrites
these redirects anyway. Docs-only, no version bump. Journal:
[`entries/2026-08-15-more-tab-ia-plan.md`](docs/overview/entries/2026-08-15-more-tab-ia-plan.md).

**🆕 2026-08-15 — the theme-token rule gets a ratchet, and the trend it was recording was backwards
(Q-244).** Hex literals under `app/`+`components/` `.tsx`: 455 on 2026-08-07, 430 on 2026-08-09,
**471** on 2026-08-14 — while CLAUDE.md recorded the trend as improving. **+41 in five days,
unnoticed**, because the rule was prose and nothing measured it between two hand counts. The two
comparable rules that hold (component size, the `color-mix` hue bug) each have a shrink-only CI
baseline, and that is the only structural difference. `scripts/check-hex-literals.js` now runs in
Custom Rules (**35 steps**) with a **per-file** baseline rather than a single total — a total lets
one file grow while another shrinks, which is precisely what "the trend looks fine" looked like on
2026-08-09 — and a row for a file that reaches zero **must be deleted**, or the baseline decays into
an allowlist that lets hex return to a file already fixed. The regex is deliberately the one that
produced the numbers above, over-matching (`#1279` in a comment counts) and all, because a baseline
whose number cannot be reproduced from a shell is one nobody trusts. **The existing 471 are not
swept** — that is separate and much larger. Mutation-verified three ways: a literal added to a
baselined file, one added to a file with no row, and a baselined file stripped clean. CLAUDE.md's
count is corrected and now records the reversal itself. Nothing device-shaped here — one CI script,
one workflow step, two doc lines, no runtime code. Journal:
[`entries/2026-08-15-hex-literal-ratchet.md`](docs/overview/entries/2026-08-15-hex-literal-ratchet.md).

**🆕 2026-08-15 — the second Home screen is deleted, and one shim decision goes back to the owner
(Q-236).** `/overview` was 543 lines with its own fetches and cache reads and **zero** in-app links —
re-verified before deleting, including that no push payload or manifest entry points at it. **The
review predicted it would drift from Home; it already had:** the orphan carried private
`loadWidgets`/`saveWidgets` copies against a *different* storage key (`ta_meta_widgets` vs
`ta_ss_widgets`) with *different* defaults and no SSR guard, so it could never have agreed with Home
even if something had linked to it. Gone with it: `components/readiness-card.tsx` (269 lines, sole
importer was the orphan — the Q-238/Q-180 dead-with-a-passing-grep shape) and the `'overview'`
background palette the entry did not mention, in **four** places (`dynamic-background.tsx` ×2, the
`ScreenPaletteKey` union, and both light and dark `--screen-palette-overview` blocks). **The three
`/sheet/[id]/*` shims were NOT deleted, deliberately:** the owner decided to keep them on 2026-08-10
(Q-136) *because they were "the only inbound path to `/chat`"* — and `#1293` deleted `/chat` three
days later on a different decision. The rationale has expired but the decision is the owner's, so it
was filed as **Q-255** rather than reversed. ✅ **Answered 2026-08-16: the owner confirmed no
bookmark, shortcut or saved note uses a `/sheet/...` URL, and all three shims were deleted.** The overview shim is repointed at `/`, since its target
no longer exists. **Getting that target right needed the browser:** the first attempt used
`/session-select` — which is named like Home and is even the manifest's `start_url` — and it is a
legacy redirect that lands on the **Workout tab**. ⚠️ **Not device-verified** — CSS-variable-only
palette removal, no layout or safe-area change, but unseen on the S25. Journal:
[`entries/2026-08-15-overview-screen-deleted.md`](docs/overview/entries/2026-08-15-overview-screen-deleted.md).

**🆕 2026-08-15 — one TTL per cache key is now a CI check, not a request (Q-242).** The entry was the
review's smallest item — `day-log:` fetched with a literal `TTL_MEDIUM` at one site and `DAY_LOG_TTL`
at another, equal values, nothing broken. **The whole-repo scan it asked for is what mattered:**
`day-log:` had **three** sites, not two, and two further keys diverged — `hr-profile` was
`HR_PROFILE_TTL` (6 h) at seven sites and a raw `TTL_MEDIUM` (30 min) at the eighth, which is the
last-writer-wins split the rule exists to prevent rather than hygiene; and `workout-data:` carried a
local `const TTL = TTL_LONG` alias against a direct `TTL_LONG`. Three divergences under a rule that
has had a constants file built for it since ~session 104 is the actual finding, so the scan shipped
as **`scripts/check-cache-ttl-divergence.js`** in the Custom Rules job (**34 steps**). It compares
TTL *expressions* rather than values (two names for one number today is what drifts tomorrow),
covers `setCached` and the **sync-provider warm list** as well as the fetch sites, and **prints its
own blind spot** — four keys built by helper calls cannot be resolved statically, so a clean run
states how many it skipped. **It was wrong twice first:** it resolved a re-declared `const cacheKey`
from the file's first definition and invented a divergence that did not exist, then counted a
comment beside an argument as part of the expression. Mutation-verified against each unfixed site.
**A second, different bug rode along:** `observed-hr-card.tsx` held the repo's only
`useState(() => readCacheSync(…))` — the forbidden lazy initializer, the session-165 / Q-73
hydration-mismatch class — now seeded in the effect. That is the user-visible half and what the
version bump is for. ⚠️ **Not device-verified**, and note the hydration fix is precisely what
`pnpm dev` cannot prove either way (one process, one timezone). Journal:
[`entries/2026-08-15-one-ttl-per-cache-key-mechanised.md`](docs/overview/entries/2026-08-15-one-ttl-per-cache-key-mechanised.md).

**🆕 2026-08-14 — the Health tab's card customiser is gone, not rebuilt (Q-238).** `saveHealthCardOrder`
and `saveHiddenHealthCards` had no caller outside their own test while the readers ran on every
mount — the shape that reads as a shipped feature in every grep. **Git history is what decided it,
and the backlog entry did not carry that history:** the UI existed (`0376da61`, card-visibility
toggles in More → Settings), its render site was removed on purpose the next day (`4e9ecffd`),
drag-to-reorder went with it for scroll lag (`077f48e0`), and the orphaned file was swept as a
"dead file, not imported anywhere" on 2026-06-28 (`73d6d0c3`) — while the helpers and every reader
stayed. Rebuilding it would re-add what the owner removed and would place a Settings surface
**Q-232's plan has not decided yet**. **It also had a half nobody had noticed:** a card hidden during
that one-day window could never be un-hidden, because the readers went on honouring
`ta_health_hidden` with no writer left — so the deletion goes through the readers too, and any such
card is visible again. Rendering is otherwise unchanged: with the hidden set permanently empty, all
nine gates were already constant `true`. ⚠️ **Not device-verified** — no layout, safe-area or sheet
geometry changed (the removed wrappers were `{flag && (…)}` around cards that always rendered), and
all three Health tabs were exercised in `pnpm dev` at 412×915 with zero console errors, but this has
not been seen on the S25. Journal:
[`entries/2026-08-14-health-card-order-dead-mechanism.md`](docs/overview/entries/2026-08-14-health-card-order-dead-mechanism.md).

**🆕 2026-08-14 — a walk records the steps and calories it always could have (Q-230).** Owner: *"we
[have] spm we should be able to get steps count right? as well as a burned calorie number"*. Right on
both — neither was missing because it could not be computed; both were written as literal `null`
while the inputs sat there. Steps now integrate the strap cadence series the walk already persists
(**gated per reading, not per activity**: it is a no-op while `RING_CADENCE_VALIDATED` is false, and
stops a future mixed-source walk counting ring data into a step total). Calories call the same
`estWorkoutKcal` the Body tab's aggregate already ran over the same row, with a test asserting the
two agree exactly. **A comment saying "computed server-side; hydrates on the next sync" appeared in
three writers and was false** — nothing computes it, which is why nobody looked. The sweep found
**four** `activity_logs` writers, not two — but the calorie derivation covers all of them from one
place, because it lives in `saveActivityLog`, which the web route and the outbox's `pushMutations`
branch both already call. **It got there the hard way:** the first attempt computed the estimate in
the client components and **failed CI's Build check** — `estWorkoutKcal` reads its MET table through
`lib/oura-models/constants`, which resolves files with `node:path`, so a client import drags
`node:path` into the browser bundle. That is the Q-221 boundary holding. **The local gate was
running tsc, lint, custom rules and the suite but not `pnpm build`; it does now.** **Near-miss the
client attempt produced, kept because the lesson outlives the code:** the helper read `profile` off
the cached `body-metadata` payload and **that route never exposed it** — it would have returned null
forever, the exact empty column it was written to fill. No test would have caught it; hitting the
live dev server did, and the guard then written to pin the coupling *passed with the field deleted*
because it sliced from the handler's `Unauthorized` early return. Both are gone with the move
server-side. ⚠️ **Not device-verified**: the step
estimate's inputs come from a live strap over BLE, so the arithmetic and wiring are proven but not
that a real walk reports something a pedometer would recognise. Journal:
[`entries/2026-08-14-walk-steps-and-calories.md`](docs/overview/entries/2026-08-14-walk-steps-and-calories.md).

**🆕 2026-08-14 — a failed local write now falls through to the server (Q-216).** #1292 made
`runSQL` throw when the local DB is not open, so a silently-failing local write became a loudly
failing one — and four sites had the shape `if (store) { …local… } else { …API… }` inside one `try`,
so a throw skipped the `else` and landed in the outer catch. **The guided walk was the worst**: its
handler set `saved` and said *"the outbox retries on device"* when the outbox write was exactly what
had failed, so a walk with GPS, splits and pace series was gone while the screen said it was safe.
Fixed in `walk-summary`, `end-of-day-review`, `saved-meals-sheet` and `nutrition-content`'s delete.
**The entry's premise was wrong**: it said only two sites had the fallback; **twelve** did, and
`test-result.tsx` has the correct behaviour written a different way — so this audit had to be on
behaviour, not on grepping `savedLocally`. `workout-screen` is correct by design (local write
best-effort, POST primary). The size gate pushed the quantity maths out of `saved-meals-sheet` into
`saved-meal-qty.ts`, where it finally has tests. ⚠️ **The failure itself is not exercisable here** —
`getLocalStore` returns null in the sandbox, so the branch being fixed cannot run; only the S25
reaches it, which is why these survived #1292's sweep. Journal:
[`entries/2026-08-14-local-write-failures-reach-the-server.md`](docs/overview/entries/2026-08-14-local-write-failures-reach-the-server.md).

**🆕 2026-08-14 — the check-in's suggested soreness can no longer survive an open (Q-226).** The owner
opened Exercise Readiness to five selected muscles and a whole-session-deload warning, closed it, and
reopened to two and no warning. `MoodCheckInSheet` is rendered with `open` as a prop and never
remounts, so **all its state survives every close** — and two effects read `suggested` in ways that
let the previous open's value reach the picker: the cache seed used `if (seed)`, so a miss left the
old value in place, and the reset effect seeded `soreMuscles` from a closure with no `suggested`
dependency. **Both were needed**: the two effects run in the same flush, so reassigning `suggested` in
one does not change what the other closes over in that pass. ⚠️ **Not proven, and worth being plain
about**: a CDP browser harness (Chromium over node's WebSocket, no new dependency) never reproduced
the fault — fixed and unfixed code produced identical output — so this rests on reading the source,
not on observing the fix work. Both stale reads are real and neither is defensible on its own terms,
but the owner's sequence is unconfirmed. Journal:
[`entries/2026-08-14-checkin-suggestions-cannot-survive-an-open.md`](docs/overview/entries/2026-08-14-checkin-suggestions-cannot-survive-an-open.md).

**🆕 2026-08-14 — Coach asks about pain instead of logging an injury off it (Q-227).** The owner asked
*"lower back pain from some of my excercises what donyou think it is?"* and got back only a **"Log
Lower Back Injury" card at Severity: mild** — no prose, and a severity they never said. `SYSTEM` has
had a "propose only when asked" guardrail for `early_deload` since it shipped, and `program_phase` has
its own; **`injury` had neither**, so a bare mention of pain was enough to fire a write proposal. A new
`## Pain and injuries` section names what to ask first and forbids proposing in the same turn as the
first mention of pain. **The severity half is not just a prompt change**: telling the model to omit the
field moves the fabrication into `apply`'s `severity ?? 'moderate'` default, so the confirmation screen
now says *"Recorded as moderate — change it in Health → Injuries if that is not right"* whenever the
proposal omits one, and the literal is named once so the promise and the write cannot drift.
⚠️ **The prompt half is unverifiable here** — proving the model obeys it needs a real conversation, so
what is proven is that the instruction is present and specific. Worth reporting back next time pain
comes up. Journal:
[`entries/2026-08-14-coach-asks-before-logging-an-injury.md`](docs/overview/entries/2026-08-14-coach-asks-before-logging-an-injury.md).

**🆕 2026-08-14 — a deloaded log can no longer become a prescription basis (Q-228).** The owner was
prescribed **72.5 kg on Incline Bench Press (83% of an 86.25 kg 1RM)** against a last session of
42.5×8 — and caught it before loading the bar. Those 42.5s were a whole-session AI deload at 52%;
migration 168 corrected four of that session's five exercises, auditing 21:47–22:09 UTC, and **Incline
Bench Press was logged at 21:41:20, six minutes before the window**. The structural half is the part
that matters: `getLastRealOneRmBatch` selected on `estimated_1rm > 0` and **never filtered
`exercise_deloaded`**, trusting a write-time invariant that production disproves — while its sibling
`reconcilePersonalRecord` has carried that exact filter all along. Migration 186 zeroes **both**
`estimated_1rm` and `target_80` on the straggler (the second column is the dial pre-fill, and the
entry missed it). **Honest current state: the symptom already self-cleared** — the owner logged a real
76.5 on 2026-08-13, which shadows the straggler, and exactly one poisoned row exists in their history.
This closes the gap and cleans the row; it changes no number visible tomorrow. No `personal_records`
fix needed — `shouldCountTowardPr` does check the flag, so the PR (78.75) was never touched.
**Reproduced on the live route in both directions**: with a poisoned deload row as the newest log,
`/api/workout-data` returns the real 98/80; reverting the one filter line returns 999/799.
**✅ Confirmed in production 2026-08-14** — v1.306.2 deployed, migration 186 in `schema_migrations`,
and the row now reads `estimated_1rm = 0`, `target_80 = 0` with the flag still true; **zero** rows in
the owner's history now have `exercise_deloaded = true AND estimated_1rm > 0`. (Worth knowing: a query
run seconds after the merge still showed 85.75/44.5 — `ensureSchema` applies on cold start, so read
the deploy as landed only once `/api/version` reports the new version.) Journal:
[`entries/2026-08-14-deload-poisoned-prescription-basis.md`](docs/overview/entries/2026-08-14-deload-poisoned-prescription-basis.md).

**🆕 2026-08-14 — AI prescriptions actually expire (Q-229).** `prescriptionExpiresAt` was written at
generation and read in exactly one place — the emergency-deload suppression, which only asks whether
a still-*pending* offer is still on the table. Nothing aged out a prescription the lifter was
training against, so a session type left unused past its own 7-day window replayed its last
AI-computed pct/sets/reps until an unrelated soreness or emergency signal happened to fire. The owner
hit it as an **8-day-old deload-era 52% served on a live Intensification day**. The boundary was
real, documented in `reevaluate.ts`'s own doc comment, and enforced by nothing. Nineteen lines now
enforce it, **before** the soreness re-derivation so a stale plan is replaced rather than refreshed
into looking current. `pending` is deliberately excluded — its expiry already belongs to the
suppression, and there are **two** copies of that check (`emergency-deload.ts:19` and
`generate-prescription.ts:218`), both untouched. Measured 2026-08-14T03:05Z: of the owner's five
prescriptions carrying an expiry, none was expired *at that moment* — because the cited row had
regenerated an hour earlier when its session was next run. That is the shape of the bug, not a
refutation: it self-clears on use and only bites in the gap between runs. Live prediction: row
`5e04a6d9` (generated 2026-08-08) expires **2026-08-15T23:47Z**. **Confirmed end-to-end on the dev
server**, not just in unit tests: a seeded 9-day-old `auto_applied` prescription at a flat 52% was
replaced, on one `workout-data` read, by a real regeneration at 84% 4×4 with a fresh 7-day expiry.
Journal:
[`entries/2026-08-14-prescriptions-actually-expire.md`](docs/overview/entries/2026-08-14-prescriptions-actually-expire.md).

**🆕 2026-08-14 — the Oura Cloud integration is gone (Q-224).** The automatic calls went on
2026-08-13; this is the rest — the OAuth/PAT flow, the sync route, the webhook receiver, the HTTP
client, the token cipher, the token storage, and every button that fired one. **Every row of
historical Cloud data is kept**, along with `lib/oura/cloud-freshness.ts` (the re-key constant two
live readiness paths read) and the six `/api/oura/` routes that were only ever local. **Five of the
backlog entry's premises did not survive reading**, and each would have been a live regression — most
quietly, `/api/oura/stats`'s `connected` flag gated the Health tab's whole Ring section on an
`oura_tokens` row, so removing token storage would have made that section render nothing, with
nothing thrown and nothing logged. It is a BLE fact now, pinned in both directions. The More →
Profile card had surgery rather than deletion (it also renders the live BLE battery) and is
BLE-only: battery, last-seen age, a Live badge that now means live. Two new mutation-verified guards,
including a source sweep over 1,000+ files that fails if any Cloud call returns. ⚠️ **NOT
device-verified** — both rewritten surfaces are canonical-runtime screens, and the Ring section's
visibility now depends on an `oura_raw_samples` query; the check is "open More → Profile and the
Health tab, confirm the ring still reports battery and a last-seen time". Journal:
[`entries/2026-08-14-oura-cloud-integration-removed.md`](docs/overview/entries/2026-08-14-oura-cloud-integration-removed.md).

**🆕 2026-08-14 — the Warm Up countdown reads the session's own budget (Q-212).** Owner, on a 30-min
Quick session: *"its still giving 10minutes warmup … should of been only 5minutes"*. They were right,
and the number they expected was already being computed — `warmupBudgetMin()` has been live for
months shaping the `effectiveTimeBudgetMin` the AI prescription is trimmed against, so the app was
already building a **shorter exercise list** for a Quick session while the countdown said ten
minutes. Two concepts, one of which scaled. `warmupGoalSecFor()` composes the two existing shared
functions — no new formula — and both call sites now use it: the screen and `startRestChip()`, which
anchors the Android rest-timer notification to the same number (fixing only the screen would have
left the shade saying 10:00). The 600 s constant survives as a fallback for the window before
`workout-data` lands. The `useMemo` pushed `workout-screen.tsx` past its shrink-only size baseline,
so the whole duration-preset concern moved into `components/workout/use-duration-preset.ts` — the
file ends **smaller** than it started. ⚠️ **NOT device-verified** — the arithmetic is covered, but
seeing a 5-minute countdown, and the notification-shade chip agreeing with it, is a device
observation. Journal:
[`entries/2026-08-14-warmup-timer-scales-with-the-session.md`](docs/overview/entries/2026-08-14-warmup-timer-scales-with-the-session.md).

**🆕 2026-08-13 — `/config` opens the Program Builder again (Q-223).** The shortcut redirected to
`/more?tab=config`, but `more-content.tsx` parses `profile | friends | workout` and silently drops
anything else — so it landed on Profile and looked like the link did nothing. The Builder mounts
under `workout`; one value, wrong. **Two links were affected**, not just the AI Coach card that
surfaced it: the session-select recommendation card has had the same `href="/config"` for longer.
Observed fixed on the dev server (`307 → /more?tab=workout` with a session). The guard pins both that
the tab is *parseable* and that it is the tab `ConfigScreen` actually mounts under — `profile` would
satisfy the first and still strand you. Journal:
[`entries/2026-08-13-config-shortcut-lands-on-the-builder.md`](docs/overview/entries/2026-08-13-config-shortcut-lands-on-the-builder.md).

**🆕 2026-08-13 — the app stops calling the Oura Cloud (owner decision), and two fixes are confirmed
in production.** Owner: *"get rid of oura cloud references we dont use it."* The two **automatic**
calls are gone — the Cloud HR pull on **every workout completion**, and the app-open/resume Cloud
sync (62 lines in `sync-provider.tsx`). Both were unable to succeed since the 2026-07-07 re-key, so
each one spent a request earning a 401. **Deliberately left, and not tidiness:**
`components/more/oura-section.tsx` renders the **live BLE ring battery** *and* the Cloud controls in
one component, so deleting it would remove the ring battery display — it needs surgery, filed as
**Q-224** with the rest of the surface. **Historical Cloud data stays** (`oura_daily` and friends are
health history, read by health-trends/day-timeline/More). Journal:
[`entries/2026-08-13-stop-calling-oura-cloud.md`](docs/overview/entries/2026-08-13-stop-calling-oura-cloud.md).
**Confirmed from production, not predicted:** a ring sync at 13:20:25 logged
`[oura-ble] rollup worker ready` — Q-213 Stage 2 is genuinely off the request loop — and the
v1.304.3 boot log is 13 lines, all `info`, zero errors, where the previous one opened with two
`TOKEN_ENC_KEY` errors.

**🆕 2026-08-13 — the `TOKEN_ENC_KEY` boot log was crying wolf (Q-217).** Every container start
asserted a broken security control, twice, at `error` severity. Measured rather than judged:
`encryptToken` has exactly **two** callers, both meaning "connect an Oura *Cloud* credential" — a
surface dead since the BLE re-key; production's token row was written **2026-06-22**, seven weeks
before `token-crypto.ts` existed, so it is unprefixed plaintext that reads back fine with or without
a key; and `has_pat` is **false** (it is an OAuth pair, not a PAT). The `error` severity was a
Railway artifact — `console.warn` goes to stderr. The import-time warning is gone and the case that
was genuinely **silent** now reports: `decryptToken` handing back ciphertext when the key vanished,
which Oura rejects as "malformed" and sends you hunting the credential instead of the key. Setting
the variable is now optional, not blocking. Journal:
[`entries/2026-08-13-token-enc-key-boot-log.md`](docs/overview/entries/2026-08-13-token-enc-key-boot-log.md).

**🆕 2026-08-13 — Q-213 is fully shipped, and a live barcode report is recorded as unexplained.**
Stage 3 replaced a coalescing predicate that meant "any batch" with a trailing-edge debounce, and the
admin Redecode route — the heaviest pair of calls in the app — moved into the worker too. Separately,
the owner reported barcode scanning broken and then working again an hour later. **Open Food Facts is
up (200 in 0.86 s) and nothing barcode-shaped reached production**, but the cause is unrecoverable
because `/api/nutrition/barcode` only `console.error`'d and never called `reportServerError` — the
same gap Q-218 closed for its sibling scan route and stopped there. That route now reports; **12
other `app/api/nutrition/*` routes still do not.** Recorded as unexplained, not fixed. Journal:
[`entries/2026-08-13-rollup-debounce-and-redecode-off-loop.md`](docs/overview/entries/2026-08-13-rollup-debounce-and-redecode-off-loop.md).

**🆕 2026-08-13 — the resolved Known Issues moved out of the orientation read (Q-220 Lever 1).**
Every session reads this file before it can start, and 68% of it was Known Issues. 53 fully-resolved
entries (1,092 lines) are now in
[`docs/overview/known-issues-resolved.md`](docs/overview/known-issues-resolved.md) — **9,184 → 8,105
lines, 748 KB → 668 KB**, roughly 20k tokens off every session. `CLAUDE.md` gained the rule that
keeps it true: striking an issue means *moving* it there, not marking it ✅ in place. **It came to
11.7%, not the 17% the backlog entry predicted, and the gap is the finding** — of the 72 ✅-marked
entries, **19 still had something owed** (a pending device check, a blocked finding, a WAL restart)
and stayed. A sweep keyed on the tick alone would have archived the sign-out-wipe check the current
handoff is still chasing. Conservation was proved rather than claimed: 885 non-blank lines out, 885
in, identical and in order; 284 headings → 231 + 53. **Lever 2 — routing the 207 open entries to
their pillar docs — is untouched and is the one that changes the number.** Journal:
[`entries/2026-08-13-known-issues-archive.md`](docs/overview/entries/2026-08-13-known-issues-archive.md).

**🆕 2026-08-13 — the BLE rollup runs in a worker thread, so it cannot starve a request (Q-213
Stage 2).** The last piece of the outage. Stage 1 plus the watermark took a real ring sync from
15–30 min to 2 min and that was still not enough — a concurrent ingest 500'd after 27.6 s while a
two-minute rollup held the thread. `POST /api/oura-ble/samples` now dispatches through
`runRollupOffLoop` into a `worker_threads` realm with its own `pg` pool (`PG_POOL_MAX=2`, so a
replica running a rollup holds 12 connections rather than 20). Measured main-thread lag during a
rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. It needs its own esbuild
bundle because the repository reaches `onnxruntime-node`, which webpack cannot bundle — and **a
missing bundle falls back to in-process**, so a broken worker degrades to the previous behaviour
rather than dropping a rollup (proven by deleting the bundle and watching the correctness test still
pass). **Production is the only place the claim settles**; watch CPU and `/api/version`. Journal:
[`entries/2026-08-13-rollup-off-the-request-loop.md`](docs/overview/entries/2026-08-13-rollup-off-the-request-loop.md).

**🆕 2026-08-13 — the local custom-rules gate runs all 31 steps and prints the count (Q-206).**
`pnpm check:rules` parses `.github/workflows/ci.yml`, takes the job named *Custom Rules*, and runs
every one of its steps under the same shell CI uses, ending with `Ran N of N Custom Rules steps.` — a
number to quote instead of the word "pass". **N is read from the YAML, never hardcoded**, and that
earned itself the same day: it was 31 in the morning and 33 once Q-49 Phase A added two rules. `pnpm ci:local` now calls it. **The entry's
own premise was wrong in both directions and measuring it was the first step:** the job has **31**
run-steps, not 35; **20** invoke a `scripts/*.js` and all 20 `check-*.js` files on disk are wired
in, so the glob everyone blamed ran 65%, not 11%. The weak gate was `pnpm ci:local`, which ran
**3 of 31**. The fix is unchanged either way — the **11 inline grep steps** are the ones no glob can
reach, and they hold the `invalidateCache`, UTC-date-slicing, safe-area, nested-button and
LLM-`JSON.parse` rules. Both of those were mutation-probed: a planted violation of each FAILs the
named step and exits 1. Journal:
[`entries/2026-08-13-local-custom-rules-runner.md`](docs/overview/entries/2026-08-13-local-custom-rules-runner.md).

**🆕 2026-08-13 — the production stalls are fixed, and the cause was not what it looked like.** Ten
PRs (#1295–#1304). The app was re-processing **35 days of raw ring data on every sync** — 986,959 rows,
effectively the whole table — to absorb the few minutes a sync actually carried. Each pass outlasted
the gap between syncs, so they ran back-to-back and held Node's single main thread for 15–30 minutes;
`/api/version`, which touches no database and is capped at 5 s, measured **122 seconds**. The DB
connection errors everyone was chasing were a *symptom*: `pg`'s connect timeout is a JS timer and
fires late on a blocked loop, so healthy connections were killed by a stopwatch running behind.
**Verified on a real ring sync: 15–30 min → 2 min, CPU 1.8 → 0.815, memory 2.19 GB → 0.553 GB.**
Two regressions were introduced and fixed inside the same session, both caught by watching production
rather than reading code. Stage 2 (the worker thread) remains, and now has measured justification — a
concurrent ingest still 500'd after 27.6 s while a 2-minute rollup held the thread, which narrowing
cannot fix. Journals:
[`…-oura-rollup-incremental-window`](docs/overview/entries/2026-08-13-oura-rollup-incremental-window.md) ·
[`…-rollup-watermark-survives-restart`](docs/overview/entries/2026-08-13-rollup-watermark-survives-restart.md) ·
[`…-rollup-span-covers-watermark-and-batch`](docs/overview/entries/2026-08-13-rollup-span-covers-watermark-and-batch.md).

**📌 2026-08-13 — session handoff: queue drain + four owner decisions.** A backlog drain that ran
out of implementer-takeable items, put five decisions to the owner, and built four of them —
**Q-202** (prescription follows your last real session), **Q-185** (a deload lightens every
exercise), **Q-189** (unreachable chat surface and read-aloud deleted), **Q-72 partial** (HRV/HR
sleep baselines now a 14-night median) — plus **Q-155**'s ownership coverage for the 13 tables with
no `user_id`. Two standing traps came out of it: **"custom rules pass" locally means a
fraction of the checks** (filed as **Q-206** — its "4 of 35" was measured wrong on both numbers and
corrected when it was built, see the entry above), and **a Q number in an unmerged PR is provisional** — one entry was
renumbered twice. **Nothing from that session is device-verified**; four checks are written up and
waiting. Full record, including the pickup prompt:
[`docs/handoff-2026-08-13-platform-queue-drain-owner-decisions.md`](docs/handoff-2026-08-13-platform-queue-drain-owner-decisions.md).

**🆕 2026-08-13 — the Sleep Score's HRV/HR baselines stop averaging away real progress (Q-72
partial, v1.304.0).** Measuring Q-72 first corrected its diagnosis twice. **It is three stuck
contributors, not four** — `latency` never reaches 100 on any night (0/48), it is merely compressed.
And **the curves were never the problem: the baseline was.** `hrv`/`hr` used a plain mean over
*every* prior night, while the owner's overnight HRV rose 24.8 → 62.7 ms and average HR fell
74.0 → 60.2 bpm. Against that all-time mean every recent night read 1.3–1.8× better than baseline,
past the curve's 1.1 ceiling, pinning **40/44** nights on `hrv` and 36/44 on `hr`. Now a **14-night
trailing median** (window chosen by measuring five options): `hrv` sd 5.2 → 12.9, pinning 40/44 →
25/44; `hr` sd 6.9 → 14.3. **What it does NOT do, and the owner shipped it knowing this:**
agreement with their own morning ratings did not move (r −0.220 → −0.226), so **Q-72 stays open** —
and the correlation target is itself unreliable, since 33 of 39 ratings are a "2" or a "3". The
old baseline broke **zero** tests when reverted, because every existing case used identical nights;
four drift-sensitive tests now cover it, all mutation-verified. Journal:
[`entries/2026-08-13-sleep-autonomic-baseline-rolling.md`](docs/overview/entries/2026-08-13-sleep-autonomic-baseline-rolling.md).

**🆕 2026-08-12 — the unreachable chat surface is deleted, and read-aloud with it (Q-189,
v1.302.0).** `app/chat/`, `app/sheet/[id]/chat/`, `components/chat.tsx` and `app/api/ai-chat/`
(including `/tts`) are gone. Nothing linked to any of it — every entry point already went to
`/coach`, and the Coach route's own comment said the pair would be deleted once that repoint
happened. Owner decision: **drop text-to-speech rather than move it to Coach**, since it was
reachable only from a screen nobody could open. Three consequences worth knowing: **`GEMINI_API_KEY`
is now read by no code** and can be removed from Railway (`@google/genai` stays — `exercise-image-gen`
uses it, on the other key); **one of the two sign-out buttons went with it**, so More/Profile is now
the only one and the device checklist was corrected in the same PR; and `parseChartBlocks` plus the
already-dead `chart-error-boundary.tsx` were removed, while the chart schema Coach depends on stays.
The CLAUDE.md path checker caught a stale `components/chat.tsx` reference that would otherwise have
shipped — one of the 31 inline steps, not the four scripts (Q-206). Journal:
[`entries/2026-08-12-remove-legacy-chat-surface.md`](docs/overview/entries/2026-08-12-remove-legacy-chat-surface.md).

**🆕 2026-08-12 — a deload week lightens every exercise (Q-185, v1.301.0).** Every deload reduction
lived inside `if (aiDrivesLoad)` and keyed off a prescription entry, so an exercise the AI does not
name never reached one. Measured before the fix: two prescribed lifts at 50%/2 beside an accessory
untouched at 75%/3 — and a session whose prescription is **missing or expired** reduced *nothing at
all*. Owner decision 2026-08-12: lighten them too. **Measured end-to-end both ways** on an
ai_dynamic program in a confirmed deload week with no prescription: `origin/main` returned all nine
exercises at 75%/3 with `deloaded: false`; this build returns 50%/2, `deloaded: true`. Static
programs are deliberately excluded — they have `ProgramPhase` rows and `deloadAwareStylePhase` has
already swapped their style, so reducing again would compound. **A guard I wrote turned out to be
unreachable and mutation testing is what said so** (deleting it failed zero tests), and chasing that
surfaced a real pre-existing contradiction now filed as **Q-211**: the AI deload branch reduces a
*baseline* lift to 50% while `estimateOneRm`/`shouldCountTowardPr` both exempt baseline as a genuine
max effort — so the app prescribes half weight and records the result as a max test. ⚠️ Not
device-verified. Journal:
[`entries/2026-08-12-ai-dynamic-deload-covers-all-exercises.md`](docs/overview/entries/2026-08-12-ai-dynamic-deload-covers-all-exercises.md).

**🆕 2026-08-12 — the prescription follows your last real session (Q-202, v1.300.0).** The owner
lowered their weights deliberately to work on form and the app kept prescribing from a lift months
old: `resolveWorkingBasis` took `max(lastLog, seed, allTimePr)`, and the all-time PR is permanent,
so **no number of lighter sessions could ever lower the prescribed weight**. Per the owner's
decision the resolver now takes the **last non-deload session outright** — there is no override
switch; the definition changed. The accepted trade-off, stated up front: one light session now
lowers the next prescription (a smoothed "best of the last 3" was offered and declined, and a test
is named for that so it isn't quietly reintroduced). **Two halves were needed** — changing only the
resolver would have left the bug intact, because `estimateOneRm` stores `estimated1rm: 0` for a
deload, so after one the last log carries no usable number and the basis falls straight back to the
PR. A new `getLastRealOneRmBatch` finds the last real log; `getLastExerciseLogsBatch` still returns
the genuinely most recent one, so the screen keeps showing what you actually lifted. **A sibling bug
was found while verifying and fixed here**: `target80` also reads 0 on a deload row, so after any
deload the target showed **0 kg** and the weight dial started every set at zero. Measured
end-to-end: 98 → 72 with the PR untouched at 98. ⚠️ Not device-verified — the dial's pre-filled
value is an on-device behaviour. Journal:
[`entries/2026-08-12-prescription-basis-last-real-session.md`](docs/overview/entries/2026-08-12-prescription-basis-last-real-session.md).
**🆕 2026-08-12 — a planned meal can be logged in one tap (v1.299.0, Q-187 first slice).** Until this
a plan told you what to eat and then played no part in the day. This is deliberately the half that
needs **none** of phase 2's machinery: the automatic prefill forces a "prefilled but unconfirmed"
state into existence so the energy-balance bar never reports food nobody ate, and none of that is
needed when the tap **is** the confirmation. Two decisions worth keeping — each ingredient is logged
at a 100 g serving with the weight in the quantity, so the library gains "Cooked quinoa" rather than
"Cooked quinoa (236 g)"; and which meals are already logged is **derived from the day's food, not
stored**, because inventing a per-day row to remember a button press is the start of exactly the
design phase 2 must do properly. Verified end-to-end: the plan card's protein bar moved 29.3% → 62.6%
on tap. ⚠️ Not device-verified — `logFoodEntries` takes the local-store branch on the APK and the web
POST branch here, so the branch that matters on the phone did not run.
Journal: [`entries/2026-08-12-log-planned-meal.md`](docs/overview/entries/2026-08-12-log-planned-meal.md).

**🆕 2026-08-12 — macro targets that say when they do not add up (v1.297.0, closes Q-191).** Four
independent fields with nothing keeping them in agreement: the seeded account holds 150P/180C/60F
beside a 1,750 kcal goal — **1,860 by Atwater**, a 110 kcal disagreement with no way to see it, and
the reason every meal plan read "over by 110" for reasons unrelated to the food. The editor now shows
the implied total and offers a one-tap carb refit; the read-path `reconcileDailyMacros` guard stays,
because a saved row is never silently rewritten. **The test found a second bug:** the reconciler was
flagging *its own helper's output* — `carbsFromRemainder` rounds to a whole gram (4 kcal) against a
±1 kcal tolerance, so the new one-tap fix would have produced a row the meal-plan review immediately
called drifted. `MACRO_RECONCILE_TOLERANCE_KCAL` is now named, documented and pinned.
Journal: [`entries/2026-08-12-nutrition-target-consistency.md`](docs/overview/entries/2026-08-12-nutrition-target-consistency.md).

**🆕 2026-08-12 — the plan card shows the day, not just the plan (v1.296.0, closes Q-200).** Its three
macro bars were drawn `w-full` inside the track — **always 100% full regardless of the number beside
them**, which reads as progress and was not. They now fill to `eaten / target`, over-target is marked
with a symbol rather than colour alone, and an unlogged day shows *empty* bars rather than claiming
0% of a day that has not started. Measured in-browser: 0% empty, then 20/19.6/10% after logging.
**Q-201 deliberately left open** — a plan's meal time is a "time to eat" prompt while the existing
reminders are a "you didn't log this" catch-up at a meal *type's* end hour, and the two are not 1:1;
that fork wants an owner decision, not a guess shipped to an unverifiable notification surface.
Journal: [`entries/2026-08-12-plan-card-progress.md`](docs/overview/entries/2026-08-12-plan-card-progress.md).

**🆕 2026-08-12 — a plan can add food to your meal, not just shrink it (v1.295.0, closes Q-210).**
Putting a saved meal into a slot only ever resized what was already in it. **The mechanism was worse
than the backlog entry claimed, and measuring it changed the fix:** not "6.3× exceeds the 2.5× clamp",
but that full cream milk is 31 kcal of fat against 18 of carbohydrate with a 22% protein share, so
`dominantMacro` files it under *fat* — the protein ice cream has **no carb source at all**, the carb
group is empty, and no factor of any size moves carbohydrate. Widening the clamp would not have
helped even slightly. `scaleWithTopUp()` now asks the model for ≤3 additions when a macro is short,
re-scales, and keeps the result **only if it improves the fit meaningfully** — measured, 40 g of
celery improves an ice cream's fit by 0.4%, so a bare better-or-not test would have put celery in it.
Verified end-to-end: the ice cream into a 644/50/57/24 slot came back **639/50/57/24 with frozen
banana added**. Scaling also moved server-side, because the edit sheet scaled on the client and would
have skipped the top-up on the exact path the complaint travelled. ⚠️ Not device-verified; plan
generation is now slower when a meal needs topping up.
Journal: [`entries/2026-08-12-meal-plan-top-up.md`](docs/overview/entries/2026-08-12-meal-plan-top-up.md).

**🆕 2026-08-12 — tell a meal what to change, and move it earlier or later (v1.294.0, closes
Q-208/Q-209).** An instruction box on a plan meal ("make it vegetarian", "swap the rice for potato")
rewrites that one meal instead of throwing it away — `generate/meal` gains `instruction` +
`currentMeal` and is reused deliberately so allergy handling cannot drift, with the "be different
from the plan" line **suppressed** when rewriting because it fights an instruction whose point is to
keep the meal. Reordering lives in the structure route because moving a meal is not a relabel:
`splitMacrosAcrossMeals` weights carbs toward the meals bracketing training, so a meal that moves
gets a different target — **verified live, a meal moved to slot 0 went from a 57 g carb target to
38 g.** Non-permutations rejected with 400. Up/down buttons, not drag. The measured vegetarian
rewrite also shows what is still missing: protein came back 31.8 g against a 45 g target, which is
Q-210. ⚠️ Not device-verified.
Journal: [`entries/2026-08-12-meal-plan-edit-and-reorder.md`](docs/overview/entries/2026-08-12-meal-plan-edit-and-reorder.md).

**🆕 2026-08-12 — one offline-first way to create a food, and a warning on food-database rows
(v1.293.0, closes Q-197/Q-199/Q-196).** The meal builder created a `food_item` three ways and none of
them reached the local store, queued an outbox mutation, or invalidated `nutrition-food-items-all` —
so a food you had just added was missing from the Food Library sheet, invisible to the local-first
search in the same file, and impossible to add at all offline. A comment even claimed the opposite.
All three now go through one `createFoodItem()`, which is `logFoodEntries`' shape extracted rather
than a fourth invention; the sanitiser runs client-side there so local and server hold the same
numbers for the same id. Also: a searched product is no longer stored as `source: 'barcode'`
(`'text'` was in the enum and had never been written), and a row whose macros disagree with its own
calories by >15% now says so — **measured, 4 of 20 live results**, including a yogurt stating 123 kcal
against 164 by Atwater. The two thresholds share one place and a test asserts warn-before-rewrite.
⚠️ Not device-verified, and note the shape of that: the branch this work is *about* is the local-store
one, which the sandbox cannot run.
Journal: [`entries/2026-08-12-food-item-writes-and-off-quality.md`](docs/overview/entries/2026-08-12-food-item-writes-and-off-quality.md).

**🆕 2026-08-12 — sleep/HR/temperature clock conversion wired to the robust offset (Q-71,
v1.292.1).** Follow-up to the same-day anchor-drain-lag investigation: owner reviewed the real-data
evidence (a uniform, stable −3 minute shift across 9 real nights, tested against the actual shipped
function before any code was written) and approved wiring it in. `aggregateOuraRawSamples`'s
`toDate` (`lib/data/postgres/adapter.ts`) now resolves every ds via `resolveDsToMs` (Q-139's
p10-of-lag robust offset over the whole epoch, already proven on the steps path) instead of
`measuredAtMs` off a single newest anchor — the mechanism behind the same night reading three
different bedtimes across three rollup runs. Verified against the full local DB-backed rollup suite
(57 tests, including the anchor-drift regression, which stays valid by construction — with one
anchor the old and new math are identical) plus the full repo suite (3,186 passing) and clean
typecheck/lint. **Only fixes future rollups** — historical `sleep_sessions` rows are unchanged until
an admin Redecode runs, which needs the owner's own session (no bearer-token path exists for that
route). Full writeup:
[`entries/2026-08-12-wire-sleep-clock-to-robust-offset.md`](docs/overview/entries/2026-08-12-wire-sleep-clock-to-robust-offset.md).

**🆕 2026-08-12 — a saved meal can be a batch (v1.292.0).** A recipe that fills two bowls was stored
as if the whole batch were one meal, so a meal plan put the entire tub in one slot.
`saved_meals.servings` (mig 182, **default 1**) plus one shared `oneServingItems()` that both the
log path and the plan conversion call — `totals` deliberately stays the whole recipe, because
dividing it in `listSavedMeals` would change what every existing caller means. Local SQLite **v25**
with all three parts (ALTER + CREATE body + `RECONCILE_COLUMNS`). Stated on purpose: raising the
count **changes what that meal's Log button does**, so the card and builder both say "per serving".
⚠️ Not device-verified — the v25 ALTER has never run on a phone holding v24. First of four slices in
[`plans/2026-08-12-meal-plan-portions-and-editing.md`](docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md).
Journal: [`entries/2026-08-12-saved-meal-servings.md`](docs/overview/entries/2026-08-12-saved-meal-servings.md).

**🆕 2026-08-12 — "Milk" returns milk, and quantities take servings again (v1.291.0).** Four owner
reports from the S25 against v1.290.0, **two of them corrections to it**. Open Food Facts matches
free text against *ingredient lists*, so "Milk" came back with cream cheese and cheddar — the
previous release claimed `sort_by` had fixed that, but sorting reorders a set it cannot change.
Fixed by filtering to Australian products and requiring the query to match the product's own name as
**whole words** ("milk" is inside "Milka", which is how a chocolate bar led the list). The database's
constant "not responding" was **our own doing**: HTTP 503 from that endpoint is rate limiting, and a
250 ms debounce chained behind the library fetch spent OFF's ~10/min budget on prefixes of the word
being typed — now a separate 700 ms effect, our limit cut to 12/min, and one retry. And v1.290.0's
grams-only quantity field broke "two scoops", so each ingredient has a srv/g switch defaulting to
servings. **The lesson worth keeping:** both regressions were measurable in the sandbox and simply
were not measured — one asserted a fix instead of reading the results, the other read a 503 as
someone else's flakiness. ⚠️ Not device-verified.
Journal: [`entries/2026-08-12-food-search-relevance-and-serving-units.md`](docs/overview/entries/2026-08-12-food-search-relevance-and-serving-units.md).

**🆕 2026-08-12 — building a saved meal can search a real food database (v1.290.0).** Ingredient
search could only see food items this user had already created, so the library could never grow past
what was in it. `GET /api/nutrition/food-search` queries Open Food Facts — the source the barcode
scanner already trusts, so no new dependency and no new provenance — and the picker always also
offers "work out its macros" via the existing `POST /api/nutrition/scan`, so a search is never a dead
end when OFF has nothing or does not answer. Ingredient quantity is grams now, not a `1×/2×/3×`
multiplier. **Two lessons, both from measuring rather than reading:** a fix to a shared component can
be *silently overridden by its call sites* — `pr-16` on `SheetHeader`'s outer element changed nothing
because eight sheets pass `px-*` and tailwind-merge lets the later class win, so the reservation had
to move to an inner wrapper — and then the size was wrong too, because the close button is positioned
from `SheetContent`'s edge while the padding is per-call-site. Also fixed a **pre-existing barcode
bug** found while verifying: `"1 glass (200 ml)"` matched the "g" of "glass" and returned a one-gram
serving, dividing every macro by a hundred. ⚠️ Not device-verified — see the Known Issues row.
Journal: [`entries/2026-08-12-saved-meals-search-and-sheet-header.md`](docs/overview/entries/2026-08-12-saved-meals-search-and-sheet-header.md).

**🆕 2026-08-12 — More/Profile's ring battery stops lying (Q-205, v1.290.2).** The Oura card on
More read `batteryLevel`/`batteryStale` from `/api/oura/token` — the **Cloud** value, frozen since
the 2026-07-07 direct-BLE re-key — so it rendered a permanent grey **"Not live"** badge and had done
for over a month. It now reads `/api/oura-ble/battery-latest`, the live BLE poll, on the same key
and TTL the Health card uses, falling back to the Cloud value only when BLE has nothing. **This is
the treatment the same card already gave the sync timestamp** (`bleFresh ? … : …`, twenty lines
above) and never gave the battery. Two things the change exposed are fixed with it: the
`oura-ble-battery-latest` key was in **no invalidation group** despite a BLE sync writing new polls
(now in `invalidateOuraSync()`, which fixes the Health card too), and the card's tab-show refresh
would have served the cached battery forever. ⚠️ Not device-verified, and the literal "Not live"
rendering can't be reproduced locally — see the Known Issues row. Journal:
[`entries/2026-08-12-more-profile-dead-battery-badge.md`](docs/overview/entries/2026-08-12-more-profile-dead-battery-badge.md).

**🆕 2026-08-12 — the ring-battery chip leaves Home (Q-203, v1.290.1).** Fourth round on the same
owner report: Q-169 shipped "move it and simplify it" on 2026-08-10, and the identical *"move it or
remove it"* came back two days later on the build carrying that fix. `OuraBatteryChip` is removed
from the Home header and its component file deleted — Home was the only call site. **The backlog
entry's justification was wrong and checking it mattered:** it said More/Profile "already renders
ring battery status independently", but that surface reads the **frozen Oura Cloud** value and shows
a permanent grey **"Not live"** badge. The surface that actually preserves the live reading is the
**Health tab's Ring Status card**, which fetches the same `/api/oura-ble/battery-latest` endpoint on
the same cache key. Removal is safe — for a different reason than the entry gave. The dead
More/Profile badge is now filed as **Q-205**. ⚠️ Not device-verified — see the Known Issues row.
Journal:
[`entries/2026-08-12-ring-battery-chip-remove-from-home.md`](docs/overview/entries/2026-08-12-ring-battery-chip-remove-from-home.md).

**🆕 2026-08-12 — the ownership guards on tables with no `user_id` are covered (Q-155, test-only).**
Q-155's 246-predicate mutation sweep was structurally blind to **13 tables that have no `user_id`
column at all** — their ownership lives in a parent row-count check or a join, so rewriting
`eq(x.userId, userId)` never touched it. Two were covered in August; the remaining eleven now are,
via 13 cases over `saveProgressionStyle`, `updatePhaseSet`, `updateSavedMeal`, `saveProgram` and the
three `friendships` methods. **Every guard was already correct — nothing here is a fix** — and each
reject case was verified by breaking its own guard and observing exactly one failing test.
`friendships` is worth noting: scoped by `requester_id`/`addressee_id` and by neither name, so it is
invisible to **both** the sweep and `scripts/check-repository-user-scoping.js`. The pre-check/join
class is now closed for all 13 tables; what keeps Q-155 open is exact per-predicate attribution and
the fact that only the DB tests have ever been measured. **These tests do not run in CI** (no
`DATABASE_URL` there) — the evidence is local by construction. Journal:
[`entries/2026-08-12-ownership-precheck-remaining-tables.md`](docs/overview/entries/2026-08-12-ownership-precheck-remaining-tables.md).

**🆕 2026-08-12 — sleep bed/wake-time drift traced to its exact source, and the fix already exists
(docs-only, unblocks Q-71).** Owner report ("displayed bedtime keeps changing") led to finding the
root cause at `insertOuraRawSamples` (`adapter.ts:4655`): `anchorUtc = new Date()` stamps server
batch-receive time, not true ring-capture time, so a night's resolved bed/wake time drifts (verified
three different values for one night across three rollup re-runs, 16–79 min apart) depending purely
on which clock anchor happens to be newest. The "obvious" fix — bracket interpolation — was tested
against real data first and made things *worse* (every recent night shifted 10–48 min later,
independently reproducing a finding this codebase already had on record). The actual fix already
shipped for a sibling bug: Q-139's `resolveDsToMs` (10th-percentile-of-lag robust offset per epoch,
2026-08-08) tests clean against the real data — a uniform, stable −3 minutes across all 9 recent
nights. Re-scoped and unblocked **Q-71** with this evidence; still needs an explicit owner call on
rewriting stored history vs. fix-forward-only before it ships. No code changed this session — every
finding here was tested against real production data via the read-only admin endpoint and the real
shipped functions, never assumed. Full writeup:
[`entries/2026-08-12-oura-ble-anchor-drain-lag-investigation.md`](docs/overview/entries/2026-08-12-oura-ble-anchor-drain-lag-investigation.md).

**🆕 2026-08-11 — direction B's two gates measured, and one of my own warnings was wrong (Q-204,
docs only).** The HR-derived load lane was held *gated, not queued* on two questions. **Gate 2
passed:** waking-hour HR coverage is **13.3 of 15 hours** (range 12–15 excluding a partial day), so
a load model would be fair. **That contradicts a worry I had put in the doc** — I argued the ring
power-gates its PPG when worn-idle and coverage might be too sparse; measured, on **2026-07-30 the
ring alone covered 12 of 15 waking hours with zero chest-strap samples.** Not strap-dependent, and
the gaps I predicted are not there. **Gate 1 failed:** `training_load_ots` — which the doc twice
called "most of it already" — is populated on **0 of 42 days**, the same empty-pipe shape as
`active_calories_est`. That claim had been verified from the *schema*, not the data. So B is
**viable but has no head start**, and is now queued as **Q-204** with the fairness question closed
and the effort estimate corrected.
[`docs/activity-goal-calibration.md` §11](docs/activity-goal-calibration.md).

**🆕 2026-08-11 — the volume target stops chasing the athlete (Q-190, v1.286.0).** The volume lane
scored against `typicalSessionVolumeKg × strengthFreqGoal`, and that median is **the user's own** —
train harder, the median rises, the target rises, the score stays put. The treadmill the 2026-07-22
rewrite removed from the daily-movement lane and left here. **The trap was that the formula had
three copies** — model, score-audit note, and the Volume progress bar's `max` — so changing only the
model would have shown a different target from the one being scored, with nothing failing. One
exported `volumeTargetKg(goals)` now serves all three. Anchor is an absolute
`DEFAULT_SESSION_VOLUME_GOAL_KG = 5200`, **measured for this change** (40 sessions over 8 weeks:
median 4,438, mean 5,032, p75 6,782): the median re-saturates a typical week at 100, p75 makes 100
unreachable, 5,200 gives weak 65 / typical 97 / strong 100. **Two things the types did not catch:**
`readiness-payload.ts` re-listed the goal fields by hand (now `DailyGoals & {…}`), and — worth
knowing generally — **`tsconfig` excludes `**/__tests__/**`, so a fixture missing the new required
field compiled fine and surfaced as `NaN` through the score.** Defining regression test: the same
week now scores identically for a beginner, the owner and an advanced lifter. ⚠️ **Fourth change to
this score today** — use a post-Q-188 baseline. 3635 tests green.
[`docs/overview/entries/2026-08-11-volume-lane-absolute-anchor.md`](docs/overview/entries/2026-08-11-volume-lane-absolute-anchor.md).

**🆕 2026-08-11 — move-hours counted a 24-hour day against a 15-hour goal (Q-188, v1.285.0).**
`computeMovedHours` counted any hour in **0–23**; `moveHoursGoal()` divides by waking hours. The two
measured different windows, so the ratio was structurally ≥1 and the contributor (weight **12**)
pinned at 100 **regardless of the goal**. Q-137 had recorded this as "goal 15 against 19–24 actual"
and proposed *raising the goal* — which would have moved the saturation without removing it, since
19–24 is not a score anyone can reach against a 15-hour denominator. **Same shape as Q-183's
`zoneMinutes` structural zero, inverted.** The fix was smaller than the finding: `wakeHour`/
`sleepHour` were **already on the input type and simply never read**. Now the count skips anything
outside `[wakeHour, sleepHour)` — the identical half-open window the goal uses, so the two agree by
construction for any pair, and both production callers were checked to take the same defaults. Four
tests, all mutation-verified, led by the invariant `movedHours ≤ moveHoursGoal`. **One existing test
was weakened by the change and repaired rather than left** — its 3am fixture would have returned 0
for the wrong reason. ⚠️ **Third change to this score today** (Q-183 +5, Q-137/A lower, this lower):
compare against a fresh baseline, not any figure quoted earlier today. 3632 tests green.
[`docs/overview/entries/2026-08-11-move-hours-window-mismatch.md`](docs/overview/entries/2026-08-11-move-hours-window-mismatch.md).

**🆕 2026-08-11 — one number, two frozen contributors (Q-137/A, v1.284.0).**
`DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5, and that is the whole change. `strengthFreq` (weight **25**, the
largest) was **exactly 100 on all 91 measured days** — 4.9 sessions/wk against a goal of 3 is ratio
1.63 and the curve caps at 1.0. The volume lane is derived from the *same* number
(`volTarget = typicalSessionVolumeKg × strengthFreqGoal`), so at goal 3 its target was 14,100 —
below even a weak week — and clamped too. **45 of 100 weight was constant, from one constant.**
The regression test states the bug as a property using the owner's real figures: **at goal 3 a weak
week (16,843 kg / 3 sessions) and a strong week (25,159 / 5) scored identically on both lanes**; at
5 they separate and a strong week still reaches 100. Set **at** typical rather than above it,
deliberately — the ACWR taper already penalises over-reaching, so a goal of 6 would have one part of
the model rewarding what another punishes. ⚠️ **Expect the score to sit lower than before** — that is
the intended effect, and **Q-183 (+5 points, shipped earlier today) pushed the other way**, so any
before/after needs a post-Q-183 baseline. 3628 tests green.
[`docs/overview/entries/2026-08-11-strength-freq-goal-calibration.md`](docs/overview/entries/2026-08-11-strength-freq-goal-calibration.md).

**🆕 2026-08-11 — calories in vs out is one calibrated number (v1.280.0).** The owner asked why the
planned energy-balance work was never visible. It had **never rendered on any tab**: the card's
`case` was in the training renderer while its key is only in the Body groups. Beyond that, three
surfaces each computed their own TDEE and disagreed — the Health "Balance" tile applied an activity
multiplier *and* subtracted measured movement, double-counting it — and two DB columns held targets
200 kcal apart because the TDEE nudge wrote only one of them. All of it now flows through one
service (`lib/health/energy-balance-service.ts`), which the AI coach also calls so it cannot
contradict the widget. New: maintenance calibrated from the user's own logged intake against their
weight trend, gated so an unlogged day is a gap rather than a zero-calorie day, and the current
(partial) day excluded from the window. Meal Plan is planned but not built — backlog **Q-186/Q-187**.

**🆕 2026-08-10 — Coach stopped transcribing the database: 2,204 output tokens → 41 (v1.278.0).**
Owner: *"make the ai model be used as minimally as possible and have direct links to saved data."*
`renderChoiceList` now takes a **source** (`sessions` / `exercises` / `swap_candidates`) and the
widget reads the real rows from `/api/coach/options`; the model writes a source name and stops.
**Cumulative with the thinking fix: 2,204 → ~41 output tokens and ~8.6 s → ~1.2 s.** The swap flow
runs three turns with **no read tools at all**. Two things beyond speed: an invented id is now
*structurally impossible* for these lists (the model never writes one — that class shipped twice
here), and options are current when the widget renders rather than when the model spoke.
**Also fixes a wedged conversation reported from the device:** typing while a picker was open left
an unanswered tool call in the thread, and the provider refuses that — so every following turn
returned *"Something went wrong"* and asking again could not help. Permanently dead, not
transiently.
[`docs/overview/entries/2026-08-10-coach-sourced-pickers.md`](docs/overview/entries/2026-08-10-coach-sourced-pickers.md).


**Last updated:** 2026-08-10.

**🆕 2026-08-11 — the Activity Score's goals need calibrating, and the three filed options were all
downstream of a question none of them asked (Q-137, docs-only).** Re-measured against production
and every premise holds, sharper: `active_calories` last landed **2026-07-07** (the BLE re-key),
and strength frequency is **4.9/wk** against a goal of **3** — ratio 1.63, where the curve caps at
100 from 1.0, so the largest weight (25) is pinned *structurally*, not just observed. Stated as an
outcome rather than as contributors: the score's 30-day spread is **mean 74.3, sd 5.9, range
60–81**, while steps — its one live discriminating input — runs **sd 4,028** on a mean of 6,959.
The input swings ±58%; the output moves in a 21-point band. Asked to choose between the three
options, the owner said the goals should be **scientifically calibrated** first, so the output is a
design discussion:
[`docs/activity-goal-calibration.md`](docs/activity-goal-calibration.md) — including why
re-anchoring to the user's own baseline reverses a deliberate 2026-07-22 decision ("a lazy week
lowered the bar"), what Garmin/Whoop/Strava/Apple do instead (**every app that handles lifting well
measures HR-derived load, not threshold-minutes**), and the evidence base for any target. Two
findings split out: **Q-183** (`zoneMinutes` scores a lifter's structural zero as a failure at full
weight — goes first, no goal change fixes it) and **Q-184** (`active_calories_est` is plumbed
end-to-end and **0 of 42 days** populated — the device never computes it; needs an APK). ✅ **The
"missing score-days" worry was unfounded** — every day from 2026-07-28 onward has a score; all gaps
precede it, which is its start date. ✅ **DECIDED same day: direction C, and goals set ABOVE
typical.** The second half is the load-bearing one — a strength goal of 5 against a measured 4.9/wk
is ratio 0.98, i.e. the saturation re-created with better-looking numbers. **Expect the score to
move and to centre lower than 74** (intended: 100 should be reachable, not routine), while **Q-183 pushed the other way and has already shipped** (#1249, v1.279.2, +5 points
on a measured A/B), so measure any before/after against a post-Q-183 window, not against 74.3. **B is gated, not queued:** measure non-workout
HR coverage and whether `training_load_ots` is actually populated — the column was verified from the
schema, not the data. **Target values set the same day (§9):** steps **8,000** unchanged, strength
frequency **5** (at the optimum — the ACWR taper already penalises over-reaching, so a goal of 6
would have one part of the model rewarding what another punishes), weekly volume **28,000**.
**Re-verifying the baselines paid for itself twice:** the filed weekly volume of 29,661 turned out
to be near the *maximum*, not the mean (measured 8-week mean **25,159**) — and **move hours is not a
goal problem at all.** `moveHoursGoal()` is `sleepHour − wakeHour` (waking hours) while the
numerator counts any hour 0–23 with movement, so the ratio is structurally ≥1 and the contributor
pins at 100 whatever the goal. Same shape as Q-183, inverted. Filed as **Q-188**; move hours must
not be raised until it is fixed. **Corrected 2026-08-11 (§10): the approved weekly volume of 28,000
is withdrawn** — there is no stored volume goal. `volTarget = typicalSessionVolumeKg ×
strengthFreqGoal`, and that median is the user's own, so **the volume lane is self-referential** —
the treadmill the 2026-07-22 rewrite removed from the daily-movement lane and left here. Filed as
**Q-190** (decided: absolute per-session tonnage). **A therefore shrinks to one line** —
`DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5 — which fixes *both* strength lanes because volTarget scales off
it. **Q-188 decided:** restrict the numerator to waking hours, not divide by 24. Dependabot checked
with the owner: **below threshold**, does not jump the queue.

**🆕 2026-08-10 — the ownership class the mutation sweep could not see (Q-155, partial, no version
bump).** Q-155's 246-predicate sweep named its own blind spot and left it: ownership enforced by a
**join or pre-check** rather than a `user_id` predicate. Counted from the schema, that blind spot is
**13 tables with no `user_id` column at all** — `session_exercises`, `exercise_logs`, `set_logs`,
`style_sets`, `program_sessions`, `saved_meal_items` among them — so rewriting `eq(x.userId, userId)`
was structurally incapable of testing any of them. **No hole was found**, and two that looked like
holes are not: `removeSessionExercise` deletes by bare id but has its join pre-check directly above
(a grep for the DELETE misses it), and `renameExercise`'s cross-user UPDATEs key on
`exercise_library.name`, which is globally UNIQUE — shared-catalogue maintenance, not a leak. Two
guards are now held in place by reject/permit pairs, each verified by mutation.
`ensureWorkoutSession` is the one that matters most: a caller that adopted another user's session id
goes on to write `exercise_logs` and `set_logs` into it, and **neither table has a `user_id` to stop
it**. ⚠️ **2 of 13 tables — the class is sampled, not closed**, and Q-155 stays open. 3461 tests green.
[`docs/overview/entries/2026-08-10-ownership-precheck-coverage.md`](docs/overview/entries/2026-08-10-ownership-precheck-coverage.md).

**2026-08-10 — the server and the device disagreed about deleted mood logs (Q-178, no version
bump).** `mood_logs` carries `deleted_at` on the server *and* locally, and the local store filters
it — the server's user-facing reads did not, so the device would hide a deleted mood log and the
server would hand it back. Latent (nothing writes that column yet), fixed on the owner's call so
whoever adds mood-log deletion doesn't land on a server that already returns deleted rows.
**The entry said three reads; two was correct.** The third is inside `getSyncDelta` and is the
**tombstone channel** — a delta that hid deleted rows could never tell a device a row went away, so
the delete would never propagate. `food_logs`, the domain with working tombstones, is unfiltered
there for exactly that reason. Applying the entry literally would have introduced that bug, so the
sync read keeps a comment and a test holds the two apart. **Both directions mutation-tested:**
removing the filter fails the user-facing test, *and* adding it to the sync read fails the tombstone
test. Verified live: `GET /api/mood` → **null** after a hand-stamped `deleted_at`, while
`/api/sync/pull` still carries the row with `deletedAt` set. 3457 tests green.
[`docs/overview/entries/2026-08-10-mood-log-soft-delete-filter.md`](docs/overview/entries/2026-08-10-mood-log-soft-delete-filter.md).

**2026-08-09/10 — a review-only session mutation-tested the data layer's invariants (10 PRs, almost
no application code).** Handoff:
[`docs/handoff-2026-08-09-platform-mutation-testing-invariants.md`](docs/handoff-2026-08-09-platform-mutation-testing-invariants.md).
Method: break an invariant on purpose, count what notices. **Ownership scoping** — 246 predicates
neutralised left **286 of 317 tests passing**; burned down to no slice and no quartile at zero.
**Soft-delete filtering** — 113 filters neutralised left **371 of 372 passing**, every slice but one
at zero. Both are correct today; nothing held them in place. Shipped four CI checks (numeric bounds,
sparkline primitive, local-column upgrade path, WCAG contrast — the last after three failed browser
attempts), fixed **Q-174**, and filed **Q-178**, **Q-179** (a live user-facing bug) and **Q-181**.
Two of the new checks have already been burned to empty by other sessions. **Carry-forward: seven
assertions the session wrote could not fail**, each caught only by running the test under mutation as
well as clean; and three scanners reported wrong counts, one of them zero. Nothing was verified on
device.

**🆕 2026-08-10 — the meal type you could never delete (Q-179, v1.278.0, migrations 175 + 176).**
Log food against a meal type, delete that log, then try to delete the meal type: *"has food log
entries"* — citing an entry you can no longer see, permanently, with no way out. The in-use probe
counted soft-deleted logs. **Adding the `deleted_at` filter is not the fix and is a worse bug:**
`food_logs.meal_type_id` is ON DELETE RESTRICT, so the hard delete then fails on the foreign key and
the clean 409 becomes a **500**. Both broken variants were put back and run — the original throws
`MEAL_TYPE_HAS_LOGS`, the "fixed" one throws the FK violation — because the one-directional version
of the test passed. The lifecycle was the problem, so it went to the owner, who chose: **meal types
soft-delete too**, like every other user-owned row here. The RESTRICT is never tested and the
soft-deleted logs keep pointing at a row that still exists, so their sync tombstones survive. **The
live-log guard is unchanged.** Two deliberate non-changes: `seedDefaultMealTypes` still counts
deleted rows (it asks *has this user ever been seeded*), and **no sync tombstone was needed** — the
local `meal_types` table is a read-only mirror fully replaced from a GET, not a `getSyncDelta`
domain, which is what kept this small. The `activity_types` twin is admin-only and left as filed.
Verified end-to-end against `pnpm dev`: 409 → delete the log → **200** → gone from the list, with
the row still present and `deleted_at` set. 3455 tests green.
[`docs/overview/entries/2026-08-10-meal-type-soft-delete.md`](docs/overview/entries/2026-08-10-meal-type-soft-delete.md).

**2026-08-10 — DB test isolation: measured first, and the measurement changed the work (Q-177, no
version bump).** The brief was a schema per vitest worker. The baseline said the shared database was
not failing anything — 387 tests, **0 failures in 6 runs** — so the work became *where does shared
state actually leak*. Two answers. **(1) Four `TEST_USER_ID`s were used by two files each**, across
nine DB-touching files; every one of them deletes its own fixture in `beforeAll`, and the `…c0de`
pair both run `DELETE FROM users WHERE id = $1` — with **55 of 58 FKs onto `users.id` cascading**
(proven against the live schema, not read off `schema.ts`), so either file's setup can wipe the
other's entire fixture across ~55 tables. Unique ids + `scripts/check-test-user-ids.js`; mocked
tests exempt, which is what keeps it from being noise. **(2) The one file that was actually failing
had nothing to do with ids.** `implausible-cadence.test.ts` failed **5/10** next to its id-twins —
and **2/10 alone**, which is the control that mattered. Two unrelated defects: a **4.2 s module
import billed to a 5 s test** (first test 4162 ms, other four 1–31 ms), and a rate-limit bucket that
**persists in the `rate_limits` table** across runs. The second was *hidden by* the first — fixing
the import made the file fast enough to trip the limiter, so solo failures went 2/10 → 5/10 before
going to **0/12**. It also claimed to need no database while one test reaches the repo, so it threw
instead of skipping without `DATABASE_URL`. **The per-worker isolation was deliberately not built** —
all three instabilities found so far have specific causes that isolation would have hidden rather
than fixed; filed as **Q-181** with the trigger that should start it. 3453 tests green.
[`docs/overview/entries/2026-08-10-db-test-isolation-measured.md`](docs/overview/entries/2026-08-10-db-test-isolation-measured.md).

**2026-08-10 — API responses stop asking to be cached, and a standing rule is reversed (Q-166, no
version bump).** Owner decision, because it **contradicts a CLAUDE.md rule**: the SWR-header rule
that stood since session 177 is replaced by **`Cache-Control: private, no-store` on every `app/api`
response**. The header sounded like free performance; what it did was put a second cache underneath
the app's own — the only one `invalidateCache()` cannot reach — and it had already caused a live
stale-delete bug in production. With `cachedFetch` and the service worker both bypassing since
v1.276.3, it also governs almost nothing on the device. **76 files / 85 header sites** converted,
plus **13 data routes that had no header at all** now send it explicitly. Two things were measured
before touching anything, and the second changed the shape of the work: the header does reach the
client, and **a headerless Next route handler emits no `Cache-Control` whatsoever** — in dev *and*
production — so those 13 were relying on browser heuristics, not on an implicit no-store.
`lib/ai/stream.ts` covers both AI streaming routes at once (a cached *stream* would freeze a
mid-stream error marker in). `scripts/check-api-no-store.js` keeps the old convention from growing
back, mutation-tested by putting the header back; one exemption, `/api/version`, with its reason in
the script. **Both bypass halves stay** — they fail independently, and the comments now say so.
Verified against the running server: 21 routes, all `200` + `private, no-store`; a
POST/DELETE round-trip on `phase-sets` reflects immediately. 3458 tests green.
[`docs/overview/entries/2026-08-10-api-responses-no-store.md`](docs/overview/entries/2026-08-10-api-responses-no-store.md).

**2026-08-10 — the rest of the dead-code sweep, and the cascade it exposed (Q-136, docs + deletions,
no version bump).** The four decisions Q-136 had left for the owner came back as *delete three, keep
the shims*. Gone, each re-verified unreferenced first: `app/health/timeline` (151 lines, **never had
an inbound link — `git log -S` shows no commit ever added one**), `app/api/sync/oura-timeseries` (the
client driver was never written), `app/api/oura/webhooks` (admin CRUD, no UI). Kept: the
`/sheet/[id]/*` shims, which look like dead redirects and are the reverse — the only inbound path to
`/chat`, whose `components/chat.tsx` is the sole caller of `/api/ai-chat/tts`. The near-miss worth
naming is that `app/api/oura/webhook` (**singular**) is the live receiver sitting one character from
the plural admin route that was deleted; checked explicitly rather than pattern-matched, and
confirmed after — it still answers **400** to an unsigned POST. Deleting the timeseries route removed
the only caller of `repo.getOuraTimeseriesDelta`, leaving its keyset-cursor implementation, adapter
delegate and **142 lines of passing DB tests** orphaned. That cascade was **not** taken unilaterally —
the owner answered a question about *routes* — so it is filed as **Q-180** with the question that
decides it. 3451 tests green.
[`docs/overview/entries/2026-08-10-dead-code-sweep-part-2.md`](docs/overview/entries/2026-08-10-dead-code-sweep-part-2.md).

**2026-08-10 — signing out left the previous account's data on the device (Q-172, v1.277.3).**
Two of three sign-out buttons cleared nothing. Reading the one that "worked" before copying it found
the bigger half: **`clearLocalStoreData()` was a hand-written list that had drifted to 27 of the
schema's 37 tables**, so `oura_heartrate`, the sleep/readiness rollups, `prescribed_runs`,
`meal_types` and `sync_outbox` survived every sign-out — the same drift `RECONCILE_TABLES` was once
missing 17 tables to. It now reads `sqlite_master` and clears everything outside a two-entry
keep-set, so a new table is wiped by default. `lib/sign-out.ts` is the only way to sign out, and a
CI check fails on either way of bypassing it (importing the raw action, or a `<form action={…}>`,
which cannot run a client-side clear at all). **The clear did not hold on first measurement** — 4 of
17 cache keys came back, because in-flight `cachedFetch` calls resolve after it; a write latch plus
a sweep when the sign-in screen mounts took it to **24 keys before, 0 after**. Sign-out still works
(redirects, and `/health` bounces). ⚠️ **The local-store half was never actually run** —
`clearLocalStoreData()` is a no-op on web, so the seven-table fix is unverified off-device.
3456 tests green.
[`docs/overview/entries/2026-08-10-sign-out-clears-device.md`](docs/overview/entries/2026-08-10-sign-out-clears-device.md).

**2026-08-10 — two completed backlog entries had come back from the dead (docs only).** A queue
read on fresh `main` found **Q-173** restored in full and a bare **Q-174** heading with no body —
both shipped hours earlier (#1223 and #1219). Traced rather than guessed: **#1220** was branched
before those removals landed, and its text merge put them back. No PR did anything wrong on its own.
Both cleared after confirming the code: `earlyDeload` is on `ReadinessScoreResponse`,
`listVolumeTargets` takes a `userId`. **A heading with no body under it is the tell**, and the
backlog header now says so — a resurrected entry costs a whole session before anyone notices the
work is already done.

**2026-08-10 — the same rule, two opposite fixes (Q-176, v1.277.2).** The two `tap-dense`
controls Q-160's audit left behind are fixed differently, and the difference *is* the rule. The
avatar's camera badge is isolated — the thing behind it is a plain div — so it takes an invisible
**44×44** box (`.tap-target-44`); a live clash check over every control on the page found **zero**
intersections. The Deload pill sits **8px below a large stats button** as a later DOM sibling, where
an invisible box would win the overlap and swallow that button's taps — the Q-160 failure in reverse
— so its **real ink** grows instead, **21px → 25px**, clearing the 24px minimum. `tap-dense` now has
five different correct remedies across ten users, and what decides each is the clearance to the
nearest interactive neighbour. **My own entry's number was wrong**: it said the pill was "about
16 px" from reading CSS; measured, it was 21. A test pins that the pill must *not* get a
`tap-target-*` class, so a later tidy-up cannot reintroduce the overlap. 3444 tests green.
[`docs/overview/entries/2026-08-10-remaining-tap-dense-hit-areas.md`](docs/overview/entries/2026-08-10-remaining-tap-dense-hit-areas.md).

**2026-08-10 — the flaky cable test was another migration rewriting its fixture (Q-171 fixed).**
`cable-exercise-merge-migration.test.ts` failed ~1 run in 3 under the full suite and passed alone.
The entry suspected an unscoped `DELETE`; it is neither a `DELETE` nor a defect in any test. **A data
migration is table-wide by nature**, vitest runs files in parallel workers, and they share one
`trainingai_dev`. Reproduced directly: seed the Cable test's fixture, run migration 163 as a
concurrent worker would, and that user's PR goes **99 → 20** — 163 step 3 is an unrestricted
`UPDATE personal_records`, and its step 1 `INSERT INTO exercise_estimates` has **no name filter at
all**. Fixed with a Postgres advisory lock held for the whole test across the six
migration-executing files — not `retry`, which the entry rules out. The lock is shown *holding* (a
second acquirer blocks, then completes the instant the first releases), and the suite ran clean
**eight times**, against eight clean baseline runs on unmodified `main`. **The first version of the
fix destabilized the suite** — a blocking `pg_advisory_lock` parks the waiter's pooled connection, which tipped an unrelated 3.3 s test over the 5 s timeout in 2 of 5 runs; polling `pg_try_advisory_lock` and releasing between attempts fixed it. The separate **`deadlock detected`** in `planned-pct-bodyweight-migration.test.ts` is
covered by the same lock. ⚠️ The suite-wide half (every DB test shares one database;
two files still unlocked) is filed as **Q-177**. 3437 tests green.
[`docs/overview/entries/2026-08-10-migration-test-serialization.md`](docs/overview/entries/2026-08-10-migration-test-serialization.md).

**2026-08-09 — Coach is ~3× faster, and the chip moved (Q-169 + Q-170, v1.277.1).** The chip is
now an icon in Home's right-hand icon row rather than a percentage pill on the date line. **Q-170 is
the one worth reading:** two plausible fixes were built first and **both made it worse** (inlining
the program into the prompt: ~1.1 s *slower*; speaking before every tool call: widget pushed out to
~12 s). The token log then answered it in one query — a picker turn emitted **2,204 output tokens to
render a ~400-token widget**, the rest reasoning nobody sees. One line
(`thinkingLevel: 'minimal'`) took it to **554 tokens and 3.5 s**; five-run wall clock **2.2–3.4 s**
against a baseline median of 8.2 s, with quality checked on the three-turn swap,
create-an-exercise, and a six-tool analysis. **Measure output tokens before optimising an LLM
route** — wall clock cannot tell reasoning from generation.
[`docs/overview/entries/2026-08-09-chip-move-and-latency.md`](docs/overview/entries/2026-08-09-chip-move-and-latency.md).

**🆕 2026-08-09 — every icon-only control now has an accessible name (Q-161 + Q-162, v1.276.2).**

**🆕 2026-08-09 — a cache `invalidateCache()` could not reach (v1.276.3).** Q-166 asked for SWR

**🆕 2026-08-09 — 48px hit areas would have made the carousel dots *harder* to hit (Q-160, v1.276.4).**

**🆕 2026-08-09 — half the "inline sparklines" were time-axis charts (Q-154, docs + classification).**

**Current version:** v1.277.0 · Branch: `main` · Railway auto-deploys on push to `main`.

**Last updated:** 2026-08-09.

**🆕 2026-08-09 — a method that takes `userId` and never uses it now fails CI (Q-155, partial).**
Q-155's own measurement: stripping the `user_id` scope from `getBodyMetricsBaseline` left the whole
suite green. Three passes of hand-written ownership tests followed (36, mutation-verified), but exact
per-predicate attribution needs ~246 runs, so the suite can only *bound* it. This closes the other
half — the entry's stated goal, *"fails loudly when a new unscoped method appears"*:
`check-repository-user-scoping.js` fails any adapter/slice method taking `userId: string` whose body
never mentions it. **368 take it, all 368 use it**, so it passes clean today and independently
confirms the 2026-08-07 read-through; the value is what it stops tomorrow. Verified by re-running
Q-155's exact mutation. **It catches an omitted scope, not a wrong one** — that limit is in the
script's own header, and Q-155 stays open. Two earlier versions of the detector were wrong (29 false
positives from a multi-line return type, then 73 from an over-tight rule), both caught by checking a
known-good method first. 3438 tests green.
[`docs/overview/entries/2026-08-09-repository-user-scoping-check.md`](docs/overview/entries/2026-08-09-repository-user-scoping-check.md).

**2026-08-09 — the "Fatigue detected" card now says why (Q-173, v1.277.0).** Owner: *"today it
recommended emergency deload but wouldn't tell me why."* The card fired on `score < 45 && acwr > 1.2`
and showed fixed text — neither number even reached the client. It now carries a
`DeloadExplanation`-style collapsible: *"Readiness 38 — under 45…"*, *"Training load 1.47 — above
1.20 — this week against your four-week average"*, plus what each button does. **The thresholds
travel in the payload**, so the card can never state a bound the server stopped applying; a test
asserts it holds neither literal. Both bounds are now named constants, and one pins a subtlety:
`EARLY_DELOAD_ACWR_MIN` is **1.2** while `ACWR_THRESHOLDS.optimalMax` is **1.3** — the card fires
inside the optimal band because it is paired with a low score, so "unifying" them would change who
sees it. ⚠️ The render was verified by patching the response in-page (the seeded DB has `acwr: null`);
**the real trigger path is unproven end-to-end**, and nothing is device-verified. 3434 tests green.
[`docs/overview/entries/2026-08-09-early-deload-card-reason.md`](docs/overview/entries/2026-08-09-early-deload-card-reason.md).

**2026-08-09 — half the "inline sparklines" were time-axis charts (Q-154, docs + classification).**
Q-154 said six files hand-roll a `<polyline>` instead of using the primitive; convert them. Reading
them first: **three are not sparklines.** `components/ui/sparkline.tsx` projects x by **index**,
while `day-detail/day-sections.tsx` (`minute / 1440`), `activity/exercise-review-sheet.tsx`
(`elapsed / duration`) and `body-battery-card.tsx` (`(t − t0) / span`) all draw a **time** axis —
converting them would have moved every unevenly-spaced point. `day-sections.tsx` **already said so
in a comment**; the entry read past it. They are now `EXEMPT`, alongside `live-hr-chart.tsx` which
was already exempt for the same reason. The three that really are sparklines are blocked on the
primitive, not on effort — no value label, hardcoded stroke width, and a **±0.5 value padding that
halves the amplitude of a 0.5 kg weight spread**, which changes what the chart says. The other
primitive that has those features (`sparkline-chart.tsx`) is chart.js and must not enter the hot
workout screen. Also renamed `health-metric-sheet.tsx`'s **local component also called
`Sparkline`**, which made a violating file look like a compliant caller to `grep`. **No conversions
done** — Q-154 stays open with the exact prop list. 3429 tests green.
[`docs/overview/entries/2026-08-09-sparkline-classification.md`](docs/overview/entries/2026-08-09-sparkline-classification.md).

**2026-08-09 — 48px hit areas would have made the carousel dots *harder* to hit (Q-160, v1.276.4).**
The entry prescribed padding the 7×7 px dots to a 48px hit area. Measured first: the row runs on a
**15 px pitch**, so 48px boxes overlap by 33px each side and the sibling painted last takes the tap —
the left-hand dots would have got less reliable, not more. Shipped **24×44 boxes on a 24 px pitch**
instead: WCAG 2.5.8 AA's minimum and the widest that stays disjoint, with the ink unchanged. The
entry named two screens; there are **four** dot rows, three byte-identical — now one
`components/ui/carousel-dots.tsx`. Proof it works: clicking 10 px left of dot 1 (outside its ink,
inside where a 48px neighbour would have reached) selects **index 0**. The `tap-dense` audit the
entry asked for is done — 4 of 6 users are correct, 2 filed as **Q-176**. ⚠️ Tap targets are the one
thing a desktop browser cannot vouch for; **not device-verified**. 3426 tests green.
[`docs/overview/entries/2026-08-09-carousel-dot-hit-area.md`](docs/overview/entries/2026-08-09-carousel-dot-hit-area.md).

**2026-08-09 — a cache `invalidateCache()` could not reach (v1.276.3).** Q-166 asked for SWR
headers on 12 more GET routes; measuring the header first stopped the sweep and found a live bug
instead. `private, max-age=60` puts the **browser's HTTP cache underneath the app's own**, and it is
the only cache `invalidateCache()` cannot clear. A write to the *same* URL as the read self-heals; a
write to a **different** URL does not — `DELETE /api/supplements/<id>` then `GET /api/supplements`
kept returning the deleted row, on a route that **already ships the header on `main`**. The service
worker was meant to prevent this: its `/api/` branch says *"never cache other API calls — always go
to network"*, but a bare `fetch()` inside a service worker still consults the HTTP cache, so that
comment described an intent the code did not implement. Both now send `cache: 'no-store'`. **Q-166
is on hold, rewritten with the measurement** — with the service worker bypassing, the header governs
almost nothing on the canonical runtime, and the option the evidence favours contradicts a standing
CLAUDE.md rule. ⚠️ **Service-worker change, NOT device-verified.** 3422 tests green.
[`docs/overview/entries/2026-08-09-http-cache-layer-bypass.md`](docs/overview/entries/2026-08-09-http-cache-layer-bypass.md).
**Q-166 was decided 2026-08-10** — the owner took the option the evidence favoured; see the entry at
the top of this section.

**2026-08-09 — every icon-only control now has an accessible name (Q-161 + Q-162, v1.276.2).**
Back arrows, the send button, the profile-photo picker and a dozen more announced as just "button".
**The review's list of six was checked rather than applied, and two were false positives** — the chat
Switch is named by its `<label for>`, the dumbbell by its `title`. Measuring computed names in a real
browser across seven pages found the genuine ones instead, plus one the review never saw: the Coach
composer. `scripts/check-icon-button-names.js` is the durable half — deliberately narrow (only a lone
self-closing icon inside a button), because a check that cries wolf gets exempted away. It found
**nine more** on screens the browser pass never reached, all fixed, so it ships with **no grandfather
list**. Verified both ways.
[`docs/overview/entries/2026-08-09-accessible-names.md`](docs/overview/entries/2026-08-09-accessible-names.md).

**2026-08-09 — an HR chart that had never rendered, found by triaging Q-165 (v1.276.1).** Q-165
counted 62 bare-`fetch` client GETs and named ~24 as "genuine render-path reads", flagging that the
list came from route names rather than from reading the call sites. Reading them: **three** were
genuine. The rest were sanctioned offline-first web fallbacks, non-GET mutations, deliberate
freshness re-reads with written reasons, or streaming responses already hand-seeded — an 8×
over-count, plus one the entry missed (`coach/threads`). Converting the real ones surfaced the
finding that matters: `/api/oura/hr-window` gated times on `/^\d{2}:\d{2}$/`, while
`activity_logs.start_time` is a Postgres `time` and serialises as `HH:MM:SS` — so **every** call the
activity detail sheet has ever made was rejected before the handler, and its HR chart, zone
breakdown and HR-coloured route line have never rendered for any activity. Fixed, with a route test
proven to fail against the old regex. Q-165 closed; **Q-172** filed (two sign-out buttons in
`components/chat.tsx` clear neither cache nor local store). 3419 tests green.
[`docs/overview/entries/2026-08-09-q165-cache-seeded-reads.md`](docs/overview/entries/2026-08-09-q165-cache-seeded-reads.md).

**2026-08-09 — Coach can add an exercise the app has never heard of (v1.276.0).** Owner ask, after
the repaired swap flow worked on device: *"I want to add in Jefferson curls to swap with bent over
row"*. The create rides in the **same patch** as the swap, so it is one confirmation showing both
halves — including **what the new exercise will be recorded as training**, because those muscles
drive deload, recovery and ACWR and a model authored them. **Admin-gated, matching
`POST /api/exercises` exactly** — widening that to all users is an owner decision, not a side effect.
A plain swap to an unknown name still refuses, so a typo creates nothing. **Found a bug in what
shipped this morning:** undo restored the exercise *name* but not its catalogue **link**, leaving the
row displaying the old name while pointing at the replacement. Fixed, with a test that asserts the
join rather than the string. 3397 tests green.
[`docs/overview/entries/2026-08-09-coach-create-on-swap.md`](docs/overview/entries/2026-08-09-coach-create-on-swap.md).

**2026-08-09 — light-theme small text now meets AA (Q-167, v1.275.3).** `--muted-foreground` was
**4.34:1** on `--muted`, under the 4.5:1 bar, across nine full-opacity chips and pill badges at
10–12 px. `oklch(0.556)` → `oklch(0.546)` gives **4.52:1** there and 4.94:1 on white. One line,
because `scripts/check-contrast.js` had already done the measuring — and it closed its own loop by
failing until the now-passing pair was removed from `GRANDFATHERED`. **20 pairs, 0 grandfathered.**
[`docs/overview/entries/2026-08-09-muted-foreground-contrast.md`](docs/overview/entries/2026-08-09-muted-foreground-contrast.md).

**🆕 2026-08-09 — the first on-device AI Coach session found three things (v1.275.0).** The owner
asked Coach to change an exercise, picked one, and **nothing happened** — it asked in prose with no
widget. Reproduced immediately, and the cause was not the model: **nothing exposed the exercise
catalogue**, so a list of replacements was not something it could draw. `findSwapCandidates` fixes
that (same main muscles, injury-aware, reusing `injurySafeAlternatives` rather than a second
matcher); the full swap now runs pick → replacements → confirm. Coach also printed its own tool
names at the end of an answer — forbidden in the prompt *and* stripped on render, because
"instruct the model not to" already failed once here. Latency was **measured, not fixed**: 7–11 s to
the first widget, two of eight runs at 49 s and 121 s, and grounding is not the cause — filed as
**Q-170**. Also ✅ **Q-158**. 3387 tests green.
[`docs/overview/entries/2026-08-09-coach-swap-dead-end.md`](docs/overview/entries/2026-08-09-coach-swap-dead-end.md).

**🆕 2026-08-09 — AI Coach can start your deload week (Q-168 partly, v1.274.0).** A sixth write
domain, `early_deload`: say you are beaten up and Coach proposes starting the deload now, or
cancelling one already running. **Not** the handoff the follow-up entry proposed — a link to the
home card would be a dead end, since that card only renders when fatigue has *already* been
detected. Tier 2, undoable, and the model does not choose the date (the server stamps today in the
user's timezone). The preview states the cost that nobody expects: flagged sessions are excluded
from every cycle count, so anything logged today stops advancing the block. Also fixes a **Q number
that landed on `main` twice** — phase 3b and #1194 both filed as Q-166; the Coach follow-ups are now
**Q-168**. 3351 tests green.
[`docs/overview/entries/2026-08-09-coach-early-deload.md`](docs/overview/entries/2026-08-09-coach-early-deload.md).

**2026-08-09 — AI Coach is complete (Q-157 phase 3b, v1.273.0).** Five write domains, eight
widgets, three confirmation tiers, history and undo. This last part adds **`program_phase`** — the
only tier-3 domain, and the only one whose effects *take something away*: cycles completed are
derived from logged sessions ÷ cycle length, so changing it can move you backwards past work you
have already done. It gets its **own pushed screen** with **hold-to-confirm**, and the consequence
is computed exactly ("Moves you back from cycle 4 to cycle 2 — you lose 2 cycles"). Verified live: a
300 ms tap writes nothing, a 1600 ms hold writes. Also the **Handoff** and **NumberDial** widgets and
the chart-pairing rule. **A Phase 2 claim is corrected here:** `/api/ai-chat` was recorded as
unreferenced and deletable — it is not, `app/chat/page.tsx` uses it, and the earlier check looked for
overlay imports rather than route callers. Caught because the deletion was verified rather than
assumed. 3345 tests green. Details in
[`docs/overview/entries/2026-08-09-ai-coach-tier3-and-widgets.md`](docs/overview/entries/2026-08-09-ai-coach-tier3-and-widgets.md).
⚠️ **Still not device-verified** — two navless full-screen routes with bottom-anchored controls now;
the Known-Issues row and the checklist cover both. Follow-ups (cardio goals, deload handoff) are
**Q-168**.

**🆕 2026-08-09 — AI Coach can change your goals and log an injury (Q-157 phase 3a, v1.272.0).**
Coach could change one thing: an exercise in a session. It now writes four domains — session
exercises, **macro targets**, **steps/calorie/water goals**, and **injuries** — through the same
confirmation, per-row toggles, staleness refusal and undo. Every domain is modelled as a **scalar
field change even when it creates** (`Area: — → left shoulder`), which is why the confirmation UI
was written once rather than per domain; a new domain is now a case in a switch. Goal changes carry
the **localStorage write-through** Home and Profile read from, or the new value would not show until
a reload. A cross-domain guard stops a model aiming a calorie field at an exercise row.
**Coach logs an injury and stops** — the deload weighting, session-swap recommendation and
per-exercise substitution all already exist downstream of the record, so the mockup's "flag N
exercises" toggle was a second implementation and is deliberately not built. **Found while
verifying:** the affected-exercise count read zero for every side-qualified injury (the program
stores `shoulders`, a person says `left shoulder`), which looked identical to "nothing trains this";
fixed and tested. 421 files / 3329 tests green. Details in
[`docs/overview/entries/2026-08-09-ai-coach-write-domains.md`](docs/overview/entries/2026-08-09-ai-coach-write-domains.md).
**Phase 3b** is the tier-3 pushed confirm (phase/deload), the NumberDial and Handoff widgets, cardio
goals and the chart-pairing rule.

**🆕 2026-08-09 — AI Coach is live: the assistant now shows you things to tap, and can change your
program (Q-157 phase 2 of 3, v1.271.0).** Phase 1 built the protocol behind `/api/coach` with no way
in; this makes it reachable. `/coach` is a full screen on `useChat`, and **a resolved widget
collapses into a normal message bubble** — tap "Pull" and it reads like you said it, with an undo
glyph to re-open. Verified end to end against the dev server: the session list carries real UUIDs, a
specific ask skips the ladder straight to a proposal, Apply writes and the DB confirms it, undo
restores. History lists applied changes (free — the rows already existed) plus 30-day conversations.
Coach alone moved to **`gemini-3.6-flash` with search grounding**; every other AI route stays on
flash-lite. All **three** live entry points repointed (Stats' had already been deleted in Q-136 — the
plan said four) and the old overlay deleted. **Two bugs found by looking at the screen rather than by
testing:** every `<Switch>` in the app has been rendering as a black circle, because the global 48px
tap-target floor beats Radix's `h-5 w-9` — fixed in the shared primitive, so the goal-recommendation
sheet is fixed too; and history read "0 messages" for every thread from a Drizzle correlated subquery
that silently returned 0. ⚠️ **Not device-verified** — a navless full-screen route with a
bottom-anchored composer is the exact shape that has regressed 11+ times; see the new AI Coach
section in [`docs/device-smoke-checklist.md`](docs/device-smoke-checklist.md). 420 files / 3316 tests
green; details in
[`docs/overview/entries/2026-08-09-ai-coach-route-and-thread.md`](docs/overview/entries/2026-08-09-ai-coach-route-and-thread.md).

**🆕 2026-08-09 — Home's "Today's Timeline" sleep card had the same stale-refetch gap Q-91 fixed
elsewhere (v1.270.32).** Owner reported last night's bed/wake time looked ~30 min off on first
open, correct after a restart — the classic stale-cache-not-refetched signature, not a clock bug
(the BLE clock-anchor extrapolation skew was investigated and ruled out: the owner's recalled times
were actually *closer* to the stored value than to an alternative resolution method tried during
the investigation). Root cause: Q-91 (2026-08-06) added a `ta:oura-ble-synced` refetch listener to
three readers of the `'sleep-sessions'` cache key, but `components/home-day-timeline.tsx` — almost
certainly the first screen seen — reads a different key (`'home-day-timeline'`) that Q-91's trace
never covered. The cache entry was already being invalidated correctly on sync; only the
already-mounted screen's refetch was missing. Fixed with the same listener pattern, mirrored
exactly. Full writeup: [`entries/2026-08-09-home-timeline-sleep-refetch.md`](docs/overview/entries/2026-08-09-home-timeline-sleep-refetch.md).
**Not verified**: the live client-side refetch in a browser (no Playwright tooling in this
session) or on-device.

**🆕 2026-08-08 — AI Coach Phase 1: the assistant can now render UI in the conversation and write to
your program (Q-157 phase 1 of 3, no version bump — nothing user-facing yet).** The chat had
fourteen read-only tools and zero write paths. Phase 1 builds the spine behind `/api/coach`, with
**no entry point wired up**: widgets are the input schemas of **client-side tools** (a tool with no
`execute` makes the SDK validate the model's args, retry on mismatch, and suspend the turn until the
user answers), and every write goes through `/api/coach/apply`, which re-validates against current
state and 409s on drift. **The model is never in the write path** — forced by a real constraint, not
taste: `ai` v6's `needsApproval` flow looks like an exact fit but `ToolApprovalResponse` is binary,
and per-row toggles cannot ride on it. Consequences have no field in the schema, so the model cannot
author a claim about your training; they are measured by `/api/coach/preview`. Migrations 170–171.
**Three defects the live run caught that review would not have:** `z.literal(false)` breaks Gemini
tool declarations (string enums only) and fails as a *masked* mid-stream error; the model invented
database ids (`push-123`) because the route gave it no program data; and its first two `proposeChange`
attempts were malformed and rejected by the schema — which is precisely the argument for not
extending the in-text `<sheet_chart>` block pattern to input widgets. ⚠️ **Nothing device-verified —
no UI is reachable.** Phase 2 (the `/coach` route) carries that gate. Full suite 417 files / 3300
tests green; details in
[`docs/overview/entries/2026-08-08-ai-coach-widget-protocol.md`](docs/overview/entries/2026-08-08-ai-coach-widget-protocol.md).

**🆕 2026-08-08 — the ring-battery chip was reading a source that froze a month ago (Q-111 ring
half, v1.270.30).** `oura-battery-chip.tsx` existed but fetched `batteryLevel` from
`/api/oura/token` — the Oura **Cloud** value, frozen since the 2026-07-07 re-key — then hid itself
whenever `batteryStale` was set, which is always. **It rendered nothing, anywhere, and had since the
re-key.** `/api/oura-ble/battery-latest` has been serving the live BLE poll the whole time. Source
swapped and the chip wired into the Home header, reusing the `oura-ble-battery-latest` key **and its
`cachedFetchToday` variant** that `health/oura-section.tsx` already owns — a second key for one
endpoint causes stale/blank first paints, and mixing fetch variants on one key makes freshness
last-writer-wins. Readings past 3h render muted with "last seen Nh ago" rather than looking current.
**Two latent bugs in the same file went with it:** a `readCacheSync` in a `useState` lazy
initializer (the documented hydration-mismatch pattern) and five hardcoded `rgb()` literals now on
theme tokens. The chip pushed the header date onto two lines at 412px — caught and fixed
(`whitespace-nowrap shrink-0`). ⚠️ Not device-verified; **only the fresh state was rendered** (stale,
charging and low bands were not), and the weather chip was empty locally, so the header was seen
with one chip rather than two. **Q-111 stays open** — the strap half needs JS wiring to a native
value nothing reads, and the scale has no battery capability at all.

**🆕 2026-08-08 — client components can finally read the user's timezone (Q-148, v1.270.29).** The
structural gap *was* the item: `users.timezone` has always been on the JWT and reachable in every API
route — which is why Q-144 could fix the server-side half — but **nothing on the client could read
it**, so every client `formatTimeOfDay`/`formatDayShort`/`toAestDay` silently fell back to
`DEFAULT_TZ`. New `UserTimezoneProvider` + `useUserTimezone()`, fed from the root layout's **existing**
`auth()` call: no extra fetch, and no mounted gate (a gated read would produce a wrong first frame,
which is the class being removed). Both named sites converted, **plus the sweep the CI check cannot
see** — six `formatTimeOfDay` calls with no tz argument, two of them module-scope helpers that now
take tz as a parameter. **`exercise-review-sheet` mattered most:** Q-123 moved it to
`toAestDay`/`msToHHMMInTz`, which left the check's scope *while still writing `DEFAULT_TZ` into the
database*; its day key and persisted `start_time`/`end_time` now use the user's zone.
`BLOCKED_ON_CLIENT_TZ` is now empty — the ratchet failed the moment both were fixed, which is its
job. **Proved with three distinct zones** so no reading is ambiguous (user New York, device London,
fallback Brisbane): a fixed `2026-08-01T02:00:00Z` rendered `31 July`, which is New York — ruling out
*both* device-local and the fallback. ⚠️ Not device-verified; the individual screens were not each
opened with data, and **pre-existing `activity_logs` clock strings are not back-filled** (they hold
`DEFAULT_TZ`, which for the owner is the same value).

**🆕 2026-08-08 — Deload moves off Home onto the pre-workout screen (Q-109-followup, v1.270.28).**
Home's three-choice card is now two (Rest / Full); intensity is chosen beside the session-length
picker, while looking at the session it applies to. **The part that was not a UI move:** `aiDeload`
was a URL param read at eight places in `workout-screen.tsx`'s data layer, so a toggle required it
to become live state — seeded from the URL by the new `useDeloadChoice()` hook, with a flip re-keying
the workout-data cache and refetching `?aiDeload=1`, the exact request the old navigation made
(verified in-browser). The old URL entry point still works. **A placement bug was caught during
verification, not after:** the first attempt gated the toggle on an existing prescription like the
duration picker, which would have left **no way to pick Deload before one is generated** — precisely
the case Home's button covered. `workout-screen.tsx` breached its size ratchet at 1878/1861, so
rather than trim comments this took Q-138's own proposed split for the file (`WorkoutLoadError`
extracted, deload state into the hook): **1861 → 1850**, baseline shrunk to match. ⚠️ Not
device-verified. The deloaded prescription itself was **not** compared against a full one — the
seeded DB has none to regenerate; only the request and refetch are proven.

**🆕 2026-08-08 — the COMPLETED stamp, and a hue bug it exposed on 26 sites (Q-97-followup,
v1.270.27).** A completed session now carries a rotated CSS stamp across its muscle diagram instead
of a banner above it, and the Front/Back labels are gone from all four labelled `MuscleHeatmap` call
sites (six others already passed `compact`; `exercise-history-sheet` rendered them at 64 px wide,
where "FRONT" was unreadable anyway). Both kept as `sr-only`.

**The find:** the first build of the stamp rendered **salmon pink** in light mode. Measured in
Chromium — `color-mix(in oklch, <green 149°> 18%, white)` returns **hue 26.8°**, because oklch is
polar and mixing interpolates the hue angle; white's chroma is 0 and its stored hue is 0. CSS Color 4
calls that hue "powerless" and says to carry the other colour's, but Chromium does not for
`color-mix`. **26 shipped sites do exactly this** — `color-mix(in oklch, var(--color-brand) 15%,
var(--color-muted))` and friends across More, Profile, trophy case, title picker, Oura section, goal
spectrum, the set cards and session-select — so every brand-green tint there has been rendering the
wrong hue. It hid because the app was dark-only: against near-black the wrong hue lands at very low
lightness and reads as dark grey. All 26 → `in oklab`. **The 129 mixes against `transparent` were
never affected** (alpha compositing preserves hue) and are untouched.
`scripts/check-color-mix-hue.js` is the new ratchet, in the Custom Rules job, verified to fail on a
planted regression. ⚠️ Not device-verified; the hue fix is verified by measurement and by the stamp
rendered in both themes, **not** by re-opening all 26 surfaces.

**🆕 2026-08-08 — the naming sheet stops opening by itself when a Guided Walk ends (Q-95-followup,
v1.270.23).** Q-95's gate refuses a *new* `motionTrigger` while a walk/activity/workout is running,
and `auto-detection-service.ts` said in its own comment that an **already-probing/tracking session
"is left alone rather than torn down — a narrow, low-risk edge case"**. It is not narrow: it is
reachable whenever detection was already running when the walk began, and `endSession()` finalizes a
session by pushing it into `pendingSessions` — **which is what the confirm sheet reads**, so a
surviving session doesn't linger, it *becomes* the popup. New `discardSession()` (throws the session
away without finalizing), a pure `shouldAbortInFlightDetection()` predicate that checks gate state
and session state independently (in ungated web-fallback mode the gate never leaves `'idle'` yet a
session still accrues), and an abort that runs on tick, on resume, **and at the top of `onPoint`** —
the last one closes a race the ticker alone loses, since GPS points keep arriving and `onPoint`
calls the watchdog, which calls `endSession()`. A genuine unattended walk is untouched. **11 new
tests**, including a scripted reproduction of the popup — the item had asked for one before any fix
landed. ⚠️ Not device-verified: the decision and the effect are both tested, but
`abortInFlightIfSessionOwned` itself (module-level gate state + four stores) is not, and the
real-world GPS/motion trigger still can't be produced in the sandbox.

**🆕 2026-08-08 — the detected-activity sheet saves offline, and stops filing activities under the
device's calendar day (Q-123 (b)+(c), v1.270.21 — closes Q-123).** The "we detected a walk — save
it?" sheet did a bare `POST /api/activity-logs` with **no local-store write and no outbox mutation
anywhere in the file**, while both sibling save surfaces (`done-activity-screen`, `walk-summary`) do
local+outbox — so the one save the app *initiates itself* could not save at all offline, and even
online the activity was missing from every local-first read until the next pull. It now copies the
reference shape, with the API call kept as the web fallback. Separately, its day key came from
`getFullYear()/getMonth()/getDate()` — **persisted data, not display**, so on a device outside
Brisbane the activity was filed under the wrong day with no way to recover which day was meant.
**Sibling finding the backlog did not name:** `start_time`/`end_time` are persisted clock strings
too, and **four** sites built them from the device's own `getHours()` (the two above plus
`walk-summary.tsx` and `lib/health-connect-sync.ts`), each with a private copy of the same helper —
now one `msToHHMMInTz()`. No migration needed: the owner's device is in Brisbane, so every row
written so far already agrees. ⚠️ **Not device-verified, and the offline half is exactly what needs
it** — `getLocalStore` returns `null` in the web sandbox, so `pnpm dev` exercises only the API
fallback; the local write and outbox row are verified against the reference implementation and the
type signature, not observed landing in native SQLite.

**🆕 2026-08-08 — disclosure toggles announce their state (Q-133 part 1, v1.270.17).** The review counted
*"21 hand-rolled disclosure toggles ship no `aria-expanded`"*. **That is an overcount** — several
listed sites are Radix `CollapsibleTrigger`s (`deload-explanation`, `signal-sections`,
`profile-tab`, `ai-prescription-card`, `meal-card`), which emit the attribute themselves; a source
grep for "chevron with a rotate class" cannot tell a real gap from a primitive doing its job. So the
gap was **measured in the rendered DOM** across six screens instead: More and Config went from
`3 ok / 7 missing` to `8 ok / 2 missing`, and every remaining "missing" is a confirmed false
positive of the probe (month/day nav arrows, a download link, a connect action) — not a disclosure.
12 controls genuinely lacked it and now have it, bound to the state they already toggle, markup
otherwise untouched. **Not** converted to `CollapsibleSection`: that primitive brings its own
bordered section, chevron and state, so converting 12 externally-controlled toggles would be a
visual redesign of 12 screens inside an accessibility PR. Nutrition's day-stepper arrows — a
*different* gap found by the same audit — also gained `aria-label`s. ⚠️ **No screen reader was
used**. **Part 2 (below) closed the rest — Q-133 is done and the backlog entry is removed.**

**🆕 2026-08-08 — the 48dp tap floor, a real confirm dialog, and the last emoji chrome (Q-133 part 2,
v1.270.20 — closes Q-133).** The floor went **44px → 48px** and now covers `[role="button"]` (the
WebView tappable-card pattern, which cannot be a real `<button>`). **It deliberately stays a global
element selector** rather than moving into `components/ui/button.tsx` variants as the backlog
proposed: every `Button` size declares *less* than the floor (`sm` 32px, `default` 36px, `lg` 40px,
`icon` 36px) and most of the app's controls are hand-rolled `<button>`s, so the move would **shrink
coverage, not tidy it** — the rule now carries a comment saying so. `<a>` is still excluded on
purpose (a text link in prose is not a tap target). **Measured rather than assumed:** a DOM pass over
every rendered control on five screens found **0 under 48px** except the deliberate `.tap-dense`
opt-outs, and **no screen gained horizontal scroll**. Also: the four `window.confirm` calls became
`ConfirmDialog` (two gate unrecoverable DB writes, so their wording was carried over verbatim), the
last six emoji-as-chrome sites became Lucide icons — the leaderboard's `👀` gained the `aria-label`
it never had — and `chat.tsx`'s opaque `bg-background` root became `bg-page`. ⚠️ **Not device-verified,
and that matters more than usual**: this is a CSS change touching every control under 640px, checked
on five screens in the web sandbox. Guided-walk, the in-progress workout screen, health and overview
were not measured. The `ConfirmDialog` conversions are verified in source, not clicked — those
consoles need an admin session and live ring data.

**🆕 2026-08-08 — defeated memos, a contradictory skeleton, and four bypassed cache keys (Q-135).**
From the 2026-08-07 full-app review (§3.13, §4). **Memos:** `ModalityPicker` (two inline arrows from
`cardio-content.tsx`) and `MuscleHeatmap` (an inline `.map()` from `sore-muscle-picker.tsx`) had
their `React.memo` silently defeated by fresh prop identities each render — the heatmap is the
costly one, re-rendering an SVG body map on every keystroke in the mood check-in sheet. The third
site the review names (`AiChatOverlay` ← `stats-content.tsx`) is **deliberately not fixed**: Q-136
deletes that file outright as having zero importers, so fixing it would only create a conflict.
**Skeleton:** `overview-screen.tsx` wrapped `ReadinessCard` in `dynamic(..., { loading: <Skeleton/> })`
while seeding `readiness` synchronously from cache — the skeleton wins first paint and defeats the
seed. Static-imported (268 props-only lines, no fetch, no heavy dep — it never met the `dynamic()`
bar). **Cache keys:** four screens bare-`fetch`ed `/api/hr-profile` while five others use the shared
`cachedFetch` key, so post-run/post-walk summaries fired a redundant round-trip and **could not
render HR zones offline**; all four converted. **Waterfall:** left as-is and documented instead —
home's second fetch is sequenced so the first paints on-screen content while the second only seeds
unopened tabs; the existing comment explained the batching and never the ordering, which is why it
read as accidental. No version bump — no user-visible change. ⚠️ No render counts or profiles
captured (structural, not measured), and none of the four HR-profile screens was opened after the
change.

**🆕 2026-08-08 — dead code deleted, the four decisions left as decisions (Q-136 part 1).** Q-136
opens with *"do not delete blindly — two of these are decisions, not cleanups"*, so this took only
the mechanical half. Gone, each verified at **0 references** by a repo-wide grep before deletion:
`app/api/oura/debug` (Cloud pipeline, dead since the BLE re-key), `admin/seed-exercise-gifs`
(superseded by `mirror-dataset-gifs`), `admin/test-exercise-image` (a scratchpad),
`admin/list-ai-models` (a one-off), `app/stats/stats-content.tsx` (389 lines, zero importers) and
`app/history/page.tsx` (a shim to a shim). **Two corrections worth keeping:** `/stats` itself is
**NOT** dead — `session-select-content.tsx:455` pushes to it from a wired control, so only the
orphaned content component went; and deleting the two admin media routes also removed the rate
limits Q-134 (#1146) had added to them hours earlier — harmless, since both routes were
unreachable, but it is another agent's work going away and is recorded rather than silent.
**Left for the owner:** `app/health/timeline` (orphaned since creation — "wire it up or delete it"
is a product call), `sync/oura-timeseries` (half a feature), `oura/webhooks` (no UI, but the only
way to list/delete subscriptions), and the `/sheet/[id]/*` shims (the only inbound path to `/chat`
and `/overview`). No version bump — nothing user-visible. ⚠️ Nothing exercised in a browser: every
deleted path had zero inbound references, so the intended effect is that nothing changes; a caller
reaching them by a string grep cannot see (Tasker, a bookmark, curl) would 404.

**🆕 2026-08-08 — the per-screen wallpaper stops flashing dark for light-theme users (Q-132 part 1,
v1.270.16).** `ScreenPaletteLayer` painted an `absolute inset-0` full-screen wallpaper across **7 screens**
and picked light-vs-dark with `useHeroColorScheme()`, which returns `'dark'` until its effect runs —
so its first frame was always the dark scene, on every launch and hard navigation. The codebase had
**already fixed and documented this exact class once** (`detail-hero.tsx:46-47`, `usePageGradient` →
a plain CSS var) and never carried it to the larger surface. The seven palettes are now
`--screen-palette-*` variables in `globals.css` under `:root`/`.dark`, and the component has no theme
branch at all. **Scope worth knowing:** the dynamic background ships `enabled: false`, so this only
ever reached users who switched the wallpaper on. Verified on 4 of the 7 screens in light mode with
the feature enabled — each resolves to its light variant. ⚠️ The single dark frame itself was not
caught (one commit long). **Part 2 (below) closed the rest — Q-132 is done and the backlog entry is
removed.**

**🆕 2026-08-08 — the light theme stops hiding things, and three palettes collapse to one function
each (Q-132 part 2, v1.270.19 — closes Q-132).** `rgba(255,255,255,α)` and `text-white` are invisible
on a light background, and the review's six flagged files were only most of it. Fixed there plus two
the list did not name: **`home/score-ring-frames.tsx`** — which is what the entry actually meant by
"SVG ring frames, rendered on Home", the line numbers having moved when it was split out of
`oura-score-chip-row.tsx` on 2026-08-07 — and `health/day/day-detail-content.tsx`'s divider. Before
the fix the four Home score numbers rendered **white-on-white with no ring at all** in the light
theme; both are confirmed correct in both themes now. Replacements are the tokens that already mean
the same thing in both schemes (`var(--border)` is literally `oklch(1 0 0 / 7%)` in dark).
**Re-counted after: 22 white-alpha sites remain and every one is legitimate** — scheme-conditional
pairs, hero art, decoration, or the `bg-black` `pip-view`; no follow-up entry, because there is no
remaining finding. Also: `scoreBandByLabel()` and a shared `ScoreBandLegend` kill the duplicated
band palettes (`readiness-card.tsx` hand-rolled one *in a file already importing `scoreBand`*), and
one `bodyBatteryColor(label)` replaces two divergent battery-colour functions plus a client-side
re-derivation of the 75/50/25 tiers `/api/body-battery` already ships as `label`. Three colour-only
score displays now name their band. ⚠️ Not device-verified; `color-mix(in oklch, …)` in an SVG
`stroke` is unproven on Samsung's WebView.

**🆕 2026-08-08 — activity charts load dynamically; Q-127's cold-start claim did not reproduce
(Q-127).** The review found a real static import chain — `health-content.tsx` →
`health-sections.tsx` → `activity-history-card.tsx` → `activity-detail-sheet.tsx` → three chart
components — supposedly defeating the `dynamic()` wrapper above it and putting chart.js (~208 KB)
in the Health tab chunk `tab-shell` warms on every app open. **Measured against two production
builds, it does not:** `/health`'s initial chunk list is 28 chunks / 1040 KB before *and* after,
and neither chart.js nor the sheet's chunk appears in it either way — webpack was already
isolating the whole subtree behind `health-content.tsx`'s own `dynamic()` boundary. Shipped only
the verifiable half: all six charts in `activity-detail-sheet.tsx` now load through
`dynamic(..., { ssr: false })` (three did, three didn't), and `activity-history-card.tsx` matches
`health-content.tsx` in importing the sheet dynamically — so the split is stated rather than
inferred from bundler heuristics that a Next upgrade could change. A first-tap mount gate was
written and then dropped: the measurement shows the chunk is not requested on tab mount anyway.
**No version bump — no user-visible change.** ⚠️ The sheet was **not** opened at runtime after the
change; import shape only, typechecked but not rendered. ⚠️ The code shipped inside **#1140**
(carried across on a branch switch and swept in by `git add -A`), so `git log` attributes it to the
brand-token PR; #1149 carries only the documentation.

**🆕 2026-08-08 — route `Cache-Control: max-age` stops outliving client cache-group invalidation
(Q-125, v1.270.14).** From the 2026-08-07 full-app review (§3.9). The client invalidation discipline is
good — zero `invalidateCache` calls outside `lib/cache-groups.ts` — and was being undone one layer
down: a write clears the client entry, the refetch goes out, and the **WebView's own HTTP cache**
answers it with the pre-write body for the rest of the route's `max-age`. Worst two were
`public, max-age=3600` on session-gated per-user data (`exercise-library`, `activity-types`) — a
newly added exercise stayed invisible for up to an hour despite `invalidateExerciseLibrary()` firing
correctly. Ten routes moved to the standard `private, max-age=60, stale-while-revalidate=120`; the
four cardio/running stat routes are **not** in the backlog entry but belong with it, because Q-126
(#1152) adds their keys to `invalidateActivityWrites()` and a 300 s `max-age` would defeat that.
The entry's counterpoint — 42 of ~48 aggregate GET routes ship no header at all — was resolved by
**narrowing the rule, not enforcing it**: a route was touched only where a cache group invalidates
its client key. All ten verified live against the dev server. ⚠️ The staleness itself was **not**
reproduced — that needs the APK's HTTP cache, not the dev server.

**🆕 2026-08-08 — the active workout screen stops re-rendering itself once a second (Q-121).**
From the 2026-08-07 full-app review (§2.8). `active-workout-screen.tsx` called `useElapsedSec`
**twice at the top of the screen** — two unsynchronised 1 Hz `setInterval` state hooks driving ~700
lines of JSX for the length of a session, the placement CLAUDE.md's render-discipline section bans
by name. The file already knew: two in-file comments describe mitigations that protect the
*children* while the screen's own JSX kept reconciling 1–2×/s for 45–90 minutes. New
`components/workout/workout-clocks.tsx` holds five leaves — `SessionRing`, `SessionPill`,
`ExerciseClock`, `WarmupRampProgress`, `RestTimer` — each owning its own tick. `RestTimer` also
absorbs the rest arithmetic the screen recomputed from `Date.now()` on every render, which was only
correct *because* the session clock was re-rendering it every second. The screen drops 745 → 627
lines and no longer imports `useElapsedSec`. `workout-screen.tsx:796`'s interval is untouched (module
singleton, never React state). Driven end-to-end on `pnpm dev` through a real session: all four
clocks advance and the rest ring counts down. ⚠️ **The improvement is structural, not measured** —
no profile was captured; per Q-51 that needs an on-device Performance capture. Overtime rest,
superset handoff and the all-sets-done inert ring were not reached.

**🆕 2026-08-08 — five cache-invalidation gaps closed (Q-126, v1.270.13).** From the 2026-08-07 full-app
review (§3.10–3.12, §4). (a) `invalidateActivityWrites()` omitted `running-bests`,
`run-type-stats`, `walk-segment-stats` and `cardio-trends` — all read `activity_logs`, all hold 6 h,
so a new 5K PB left the All-Time Bests card on the old number. (b) Confirming a flagged scale
weigh-in invalidated **nothing** (`scale-pairing.tsx` had no cache-groups import) despite the route
performing a real `body_metrics` write; now fires the same pair a manual metric log uses, awaited
before the refetch. (c) `achievements:` was missing from `invalidateBiometrics()` and
`invalidateOuraSync()`, so sleep-streak badges never refreshed — the same sweep had already closed
this for body-metrics and nutrition. (d) `hr-recovery-profile` and `exercise-hr-trend:` were in **no
group at all** despite deriving from `set_hr_stats`. (e) The done screen's "+XP earned" seeded from
a key written by one screen but cleared by five groups, and `?? 0` turned a missing baseline into
the user's entire lifetime XP; one `recordXpEarned()` helper now skips the badge when there is no
baseline **and** writes the response back so the next session has one. ⚠️ **None of the five was
reproduced end-to-end** — each needs a real write plus a navigation (or a paired BLE scale); what
was verified is that every added key matches its component's actual `cachedFetch` call site.

**🆕 2026-08-08 — weekly muscle volume stops splitting one muscle into two rows (Q-120,
v1.270.6).** From the 2026-08-07 full-app review (§2.7). `computeDefaultVolumeTargets` writes
**normalised** muscle names into `program_volume_targets` (`normalizeMuscle` folds `core→abs`,
`quadriceps→quads`, `pecs→chest`, …) while every consumer keyed logged sets by the **raw**
exercise-library label under a bare `LOWER()`. The seeded library ships `"core"` on 14 rows, so
Health → Weekly Muscle Sets drew one muscle as two: a red `Abs 0/16` beside an untargeted
`Core 12` — and the `MuscleHeatmap` directly above it *does* normalise, so the picture and the list
disagreed with each other. Fixed at the source: `getWeeklySetsByMuscleGroup` now returns canonical
keys, `signals.ts` drops the re-normalisation pass it needed to compensate, and the three routes
that run their own SQL (`weekly-muscle-sets`, `ai-periodization/weekly-volume`,
`muscle-tonnage-trend`) normalise both logged and target keys. **`muscle-tonnage-trend` was not in
the backlog entry** — same defect, same user-visible class (it drew `core` and `abs` as two trend
lines), swept per the sibling-surface rule. Reproduced *and* re-verified against the local DB with a
real `"core"`-tagged log: `main` returned `abs 0/16` + `core 3`, the branch returns `abs 3/16`.
Not device-verified — server-side aggregation only.

**🆕 2026-08-08 — light mode's brand colour finally applies, plus a `--brand-foreground` token
(Q-119, v1.270.11).** `app/globals.css`'s light `:root` set `--brand` but never `--color-brand`, and
`--color-brand` is what `text-brand`/`bg-brand` read (495 sites vs 2). The stated light-mode fix had
therefore been inert since it was written: brand text rendered in the dark-theme green at a measured
**2.22:1 on white**. Set `--color-brand` in the light `:root` and moved the value from `oklch(0.55 …)`
to `oklch(0.52 …)` — wiring alone would only have reached 4.16:1, still under the 4.5 floor; 0.52
measures **4.70:1**. Added `--brand-foreground` (`text-brand-foreground`), black or white per
brand × scheme by measured contrast rather than by scheme — white for every light variant, black for
every dark variant except `.dark[data-brand="red"]`, black for all custom hues (pinned at L 0.7,
where black wins at every hue). Converted 59 hardcoded literals across 44 files, retiring all three
competing conventions (`text-white`, `text-black`, inline `color: '#000'`). Verified in Playwright at
412×915 in **both themes**. Not device-verified — CSS and class names only, no native/safe-area path.

**🆕 2026-08-08 — every "Failed query" in `error_events` is now diagnosable (Q-107 first half,
v1.270.10).** The intermittent `/api/sync/pull` failures (and the identical signature on
`/api/readiness-score` and `/api/body-battery` — same fault, wider than sync) have stayed a
*theory* because the error rows carried nothing to diagnose. One omission explains it:
`DrizzleQueryError` sets its message to `Failed query: <sql>` and puts the **real** Postgres error —
`code`, `severity`, `detail` — on `err.cause`, which `reportServerError` dropped. That field is the
difference between `57014` (`query_canceled`, i.e. `statement_timeout`) and a pool-acquisition
timeout, which arrives with no code at all — the two competing explanations. `summariseCause` now
lifts the code into a message **prefix** (a suffix would sit past the `left(message,120)` the
standing session-start query groups by, i.e. invisible in the one read that matters) and records the
full breakdown in the stack. No migration. Verified against a live Postgres, not synthetic objects:
a real undefined-table error produced `[pg 42P01]` and a real statement timeout produced
`[pg 57014]`. **The batching half is deliberately NOT done** — the entry says the observability half
ships first so the batching fix is measurable, and the next session on Q-107 should read
`error_events` in production before touching `getSyncDelta`, since the codes are there now.

**🆕 2026-08-08 — date-handling hardening sweep (Q-130, v1.270.9).** From the 2026-08-07 full-app
review (§3.15, §3.16, §4). All latent — every current caller sends dashed `todayInTz()` output — but
each failure mode has cost a release before. **(a)** Four routes took a raw `date` param with no
`normalizeDateParam` (`mood`, `day-checkin`, `nutrition/food-logs`, `oura/hr-window`) while five
siblings already had it; `oura/hr-window` was doing `dateParam.split('-').map(Number)` on the raw
value, the exact `RangeError` shape the rule exists to prevent, so its `HH:MM` params got a check
too. `food-logs`' **POST body** date got the guard as well — that one becomes the written row's key.
`day-checkin`'s `phase` also reached the repo unvalidated. **(b)** `formatDateDisplay` did precisely
what the function directly beneath it documents as forbidden — `new Date(raw)` (UTC midnight) then
device-local `toLocaleDateString` — so it read a day early on any device behind UTC; now
component-wise, which fixes both live callers without touching either. **(c)** Seven files carried a
dash-only date regex while the client's `localDateString()` emits **slashes** (the mismatch that
killed ai-chat's `localDate` for a full release), and `health-connect/ingest` had the mirror problem;
all eight now use `[-/]`. **(d)** `sync/pull`'s `since` cursor was unvalidated, so a corrupted cursor
threw inside `getSyncDelta` and came back as a generic 500 — a device would retry forever against an
opaque error; now a 400 naming the param. **(e)** `workout/exercise-hr-trend` used the banned
`Date.now() - N×86400000` anchor. Every guard live-verified against `pnpm dev` with valid **and**
invalid input; the `formatDateDisplay` fix verified by running its tests under `TZ=America/New_York`
(2 failed before, all passed after) — CI runs in UTC, where the old code also looked right, and the
test file says so.

**🆕 2026-08-08 — four drifts between the two write paths closed (Q-131, v1.270.8).** From the
2026-08-07 full-app review (§4), all the "web route and `pushMutations` have drifted" class — the
one behind three production incidents. (1) The **`mood_logs` push branch had no validation at all**,
casting straight through (`p.energyLevel as EnergyLevel`) where the web route parses enums and array
caps; a corrupted payload wrote an arbitrary string into the `NOT NULL` `energy_level` column and
every readiness/energy surface then rendered it as a real check-in. Every sibling domain got a shared
schema under SYNC-P3/P4/Q-24; mood was missed — it now has one
(`packages/shared/src/validation/mood-log.ts`), parsed by both paths. (2) **`food_items` push dropped
`barcode` and hardcoded `region: ''`** despite `FoodItemPushSchema` accepting both, and defaulted
serving size to 0 against the web route's 100 — so an item saved offline lost the barcode a later
rescan matches on, and every per-serving calculation collapsed. (3) **The pull chain dropped four
columns present on both ends** (`workout_sessions.session_id`/`intensity_mode`/`was_override`,
`exercise_logs.exercise_deloaded`) — they exist precisely so a stranded outbox replay keeps real
phase attribution, so a replay on a restored device silently degraded to name-fallback attribution
and a deloaded exercise came back full-intensity. None was reachable from today's UI, so this landed
as hygiene; each becomes live the moment its path is made offline-capable. The two push-branch fixes
have DB-backed tests that **fail against the pre-fix adapter**.

**🆕 2026-08-08 — supplements stop losing offline edits, and five admin media routes get a rate
limit (Q-124 + Q-134, v1.270.7).** ⚠️ **NOT device-verified — see the Known-Issues row.** From the
2026-08-07 full-app review (§3.6, §3.7, §4). Supplements were the **one** offline write domain whose
`applyDelta` arm had no pull-clobber guard, and not by oversight: the local table had no
`sync_status` column to gate on, so a rename made offline reverted to the server's old value on the
next pull. **Local migration v22** adds `sync_status` + `deleted_at` (with `RECONCILE_COLUMNS` rows,
the real authority after a partial upgrade), `applyDelta` gained the synced-guard and a tombstone arm
so cross-device deletes finally propagate, local writes mark rows `pending`, and the sync engine's
confirm loop flips them back — that last arm matters, since without it the new guard would make a
pending row permanently unreachable by sync. Separately, `nutrition-content.tsx` fetched the
`supplements` cache key with **both** `cachedFetchToday` and `cachedFetch` on adjacent branches —
same key, incompatible envelopes, the `weekly-stats` crash class — so whichever wrote last decided
whether the section rendered at all; converted to the today-variant every other site already uses.
`updateSupplement` passed the raw request body into Drizzle `.set()`, safe only because its single
caller uses `.strict()` — now an explicit allowlist, the `updateInjury` shape. **Q-124(c) turned out
to be wrong and is struck from the review:** it claimed a web edit never bumped `updated_at` and so
never synced, but migration 078 installs a `BEFORE UPDATE` trigger that has always done it —
verified live (a real PATCH moved the timestamp and the row came back in the next `/api/sync/pull`
delta). The repo function sets it explicitly now regardless, so a sync-critical column does not
depend on a trigger the code never references. Finally, the five admin image/media routes that had no rate limit at all
(`generate-exercise-media`, `test-exercise-image`, `reference-figure`, `mirror-dataset-gifs`,
`seed-exercise-gifs`) got 10/min per admin, matching their siblings. **Not claimed:** the review's
guess that this explains `supplement_logs` holding 1 row since 2026-06-21 — plausible mechanism,
not a diagnosis.

**🆕 2026-08-08 — cross-user phase-set leak closed (Q-129, v1.270.6).** ⚠️ **Security.** From the
2026-08-07 full-app review (§3.4): `programs.phase_set_id` is a client-writable FK into a strictly
user-scoped table, and three links trusted it. (1) `POST /api/workout-templates` wrote
`body.program.phaseSetId` straight through with no ownership check; (2) `listProgramPhases`
resolved that FK with **no user scope**, so another account's phase names, types, durations and
cycle structure rendered in `workout-data`, `program-week`, `readiness-score`, `weights-summary`
and `daily-digest`; (3) `deletePhaseSet`'s in-use probe was unscoped too, and its message reaches
the client verbatim — disclosing a stranger's **program name** and blocking the caller's own
delete. Exploiting it needs another user's UUID, which is why it was not top-of-queue, but
production now holds several real accounts. Fixed by threading `userId` into `listProgramPhases`
(interface + adapter + six routes, all mechanical), scoping the delete probe, and validating
`phaseSetId` against `listPhaseSets(userId)` before any write — the same shape
`phase-sets/[id]/route.ts` already uses for style ids. Also added the explicit rowcount guard
`saveProgram` was missing: it failed closed only by accident (`pRow.id` throwing on a 0-row match),
now by design. New DB-backed test builds two real users and asserts all three links;
**confirmed all three fail against the pre-fix code**, so they test the fix and not the harness.

**🆕 2026-08-08 — an offline-completed workout finally gets its per-set HR attribution
(Q-123a, v1.270.5).** From the 2026-08-07 full-app review (§3.1): the web completion route fires two
side effects (Oura HR sync **and** an inline per-set/per-workout attribution pass), while the
outbox's `complete_workout` branch fired only the sync half — and only when the push request carried
an `origin`+`cookie`, since it reached it by POSTing back to `/api/oura/hr-sync`. A silent
regression of the Q-11 Defect B fix (v1.266.1), which landed on the web route and was never mirrored
to the push branch. It bites exactly when the outbox matters: the direct POST failed, or the phone
was offline. Because Q-122 had already extracted the pipeline into `syncAndAttributeSessionHr`, the
branch became a two-line call to the shared function. **`ctx` is now gone entirely** from
`pushMutations` (adapter, `WorkoutRepository` interface, and the `sync/push` call site) — the
loopback was its only consumer, and a dead request-context parameter threaded through the sync entry
point is an invitation to reintroduce the pattern. New DB-backed test seeds real HR readings and set
windows, pushes a `complete_workout` mutation, and asserts `workout_hr_stats` + `set_hr_stats`
appear; **verified it fails against the pre-fix adapter**, so it tests the fix rather than the
harness. **Q-123(b) and (c) are deliberately still open** — both live in
`components/activity/exercise-review-sheet.tsx` (a server-only save with no outbox, and a
device-local date key written to the DB, which is persisted data rather than display), and
`components/` was another agent's territory while this landed.

**🆕 2026-08-08 — the server no longer makes HTTP calls to itself (Q-122, v1.270.4).** From the
2026-08-07 full-app review (§3.5): three `fetch()` calls at `req.nextUrl.origin` forwarding the
caller's cookie — `complete-workout` → `/api/oura/hr-sync`, and `workout-data` ×2 →
`/api/ai-periodization/session/[id]/prescribe`. Evidenced, not theoretical: `#hr-sync` logged a
bare `"fetch failed"` 9 times, 5 of them in the 8 days before the review, each one silently
skipping that workout's Oura HR sync until an admin backfill caught it. New shared module
`lib/workout/post-completion-hr.ts` (`syncAndAttributeSessionHr`) now holds the whole
completion-time HR pipeline — sync then attribute, in that order, so the attribution pass finally
sees what the sync just stored instead of racing it — and is called by the completion route, by
`/api/oura/hr-sync` (now a thin wrapper, still needed for its client caller) and, next, by the
outbox branch (Q-123a). The prescribe calls became a direct
`generatePrescriptionForSession` invocation that **re-applies the same `prescribe:<userId>` 20/hr
rate limit** the route enforced, so removing the HTTP hop does not also remove the budget that stops
a poll loop minting unlimited Gemini calls. Live-verified on `pnpm dev`: completing a workout
produced no inbound `/api/oura/hr-sync` request, and a `workout-data` read on a pending ai_dynamic
session generated and stored a real Gemini prescription with no inbound `/prescribe` request. Error
tag deliberately renamed `#hr-sync`/`#hr-stats` → `#hr-pipeline` so the 9 historical rows keep
meaning "the loopback failed", a failure mode that no longer exists.

**🆕 2026-08-08 — `sessions_in_phase` is reconciled where it is read, not only where it is
audited (Q-128, v1.270.3).** From the 2026-08-07 full-app review (§3.14):
`reconcileSessionsInPhase` was called from exactly one route (`ai-periodization/program-overview`),
while the counter was read raw by `workout-data/route.ts` (→ `completedCycles`,
`phaseSessionNumber`, both rendered on the workout screen) and by `signals.ts` (→ the number the
prescription prompt is given). This counter has drifted three times historically, so a drifted row
mislabelled phase progress and skewed the AI's input until the user happened to open the
program-overview screen. Both `workout-data` paths now reconcile before reading — batched into the
existing `Promise.all` on the `?tab=all` path, chained ahead of the periodization read on the
single-session path, so neither adds a serial round-trip — and `aggregateSignals` reconciles and
re-reads its own state, covering the `workout-review` caller that never passed through
`generate-prescription`'s existing SYNC-T2 reconcile. **Deliberately not placed inside
`getSessionPeriodization`** (the backlog's first suggestion): `completeWorkoutFromPayload` completes
the session, reads periodization, then increments the counter — a reconcile inside that read would
count the just-completed session and the increment would add it again, converting a self-heal into
a double-count. Both new calls are advisory (`.catch`), falling back to the unreconciled row.
Live-verified on `pnpm dev` against the local DB: rows drifted low (0) and high (9 and 7) against 3
genuinely-completed sessions healed to 3 through both routes. Production impact today was already
nil — of 10 rows, one is drifted and it is on an inactive program — so this landed as hardening.

**🆕 2026-08-07 — removed the redundant "Interval walk" shortcut from the Log Activity sheet
(Q-140, v1.270.1).** Direct owner report: "this is the log activity section; doesn't need
interval walk like that cause guided [walk] exists." Confirmed redundant, not a navigation
dead-end: Guided Walk already has its own separate, always-visible entry point on the Cardio Hub
screen (`components/cardio/modality-picker.tsx`), and `LogActivitySheet` is only ever opened from
one call site (the Hub's "Other activity" row), so removing its internal shortcut strands nothing.
Deleted the featured button, its `startGuidedWalk()` handler, the `router.prefetch('/activity/
guided-walk')` call that existed only to support it, and the now-unused `PersonSimpleWalk` import.
Verified via Playwright: the Log Activity sheet now shows only the plain activity-type grid, and
the separate Guided Walk card remains visible and reachable on the Cardio Hub screen behind it.

**🆕 2026-08-07 — navless takeover screens swept onto the floored safe-area utility (Q-118,
v1.267.20).** ⚠️ **Not yet device-verified.** 6 sites (`active-activity-screen.tsx`,
`fitness-tests/test-active.tsx` ×2, `guided-walk/walk-active.tsx`, `guided-walk/walk-config.tsx`,
`guided-walk/walk-summary.tsx`, `activity/done-activity-screen.tsx`) used the un-floored
`pb-safe-action` instead of `pb-safe-action-lg` on their bottom action row, the same on-device
gesture-bar-overlap class already fixed once for workout screens but never swept here. Pure
Tailwind class swap, no logic changes. See the Known-Issues row below for the full evidence and
why this can't be verified in this sandbox at all.

**🆕 2026-08-07 — a confirmed early deload and a logged injury now both reach today's plan
(Q-117, v1.267.19).** Found by the 2026-08-07 full-app review (§2.2, §2.3): two separate writes
that change what the workout screen prescribes, neither invalidating the cache that holds it.
Because `workout-data:all` is read with `freshWithinTtl: true` at `TTL_LONG`, the stale entry
wasn't just painted first — **no network request was made at all** for up to 6 hours. (1) Early
deload: `handleEarlyDeloadConfirm` only updated local readiness state; the real server effect
(`programs.ts` → `phase-engine.ts` → `workout-data/route.ts`) never got a cache invalidation to
pair with it, so every card kept showing full-intensity target weights after tapping "Take deload
week now." Fixed by calling `invalidatePrescriptionChanged()` from the confirm handler. (2)
Injury: `invalidateInjuryWrites()` cleared only the `injuries` cache itself, not the
`workout-data`/`workout-card:`/`ai-periodization-session:` caches that actually reflect it —
extended the group to clear all four. **A second, server-side gap the client fix alone couldn't
close:** `workout-data/route.ts`'s consumption-day re-evaluation skip check
(`reevaluationKey(todayStr, moodLog, morningCheckin)`) never included injuries at all, so even a
forced refetch would have returned the pre-injury prescription — added a 4th parameter (max
`updatedAt` over unresolved injuries) to the fingerprint, following the exact pattern Q-113 used
for the Morning Check-in's illness flag. Adding `updatedAt` to the `Injury` type (previously
dropped at the repository mapper despite existing on the DB row) touched 5 call sites across
`api/injuries`, `health-content.tsx`, `injury-sheet.tsx`, and `workout-screen.tsx` — all
mechanical, caught by `tsc`. Also corrected a stale proof comment in both
`session-select-content.tsx` and its Workout-tab sibling `workout-select-content.tsx` (same cache
key, same claim, same gap) that asserted every write invalidating this payload was already
covered — `/api/confirm-early-deload` and injury writes were the counter-examples. Verified live
against `pnpm dev`: confirmed `freshWithinTtl` genuinely skips the network fetch on an immediate
cache-fresh revisit (0 requests), then logged a real injury via the UI and confirmed a revisit
fired a genuine `/api/workout-data?tab=all` request afterward (1 request) — proving the
invalidation fix closes the gap rather than merely reducing its odds. Test injury cleaned up
afterward. 5 new unit tests added for the injury-fingerprint behavior of `reevaluationKey`.

**🆕 2026-08-07 — Home's React hydration mismatch is fixed (Q-73, v1.267.18).** 283 recorded
occurrences of minified React error #418 on `/` since 2026-08-04, root-caused the same day by the
full-app review: `session-select-content.tsx`'s header date called `toLocaleDateString("en-AU", …)`
with no `timeZone` — the banned pattern CLAUDE.md's Timezone section names directly. Railway sets
no `TZ` env var, so Node renders in **UTC** while the S25 renders in **Australia/Brisbane**; for
the 42% of each day between 00:00–10:00 AEST the server sent yesterday's weekday+date and the
client rendered today's, producing a text mismatch on every load in that window. Fixed by switching
to `formatInTimeZone(new Date(), DEFAULT_TZ, "EEEE d MMMM")` — a **fixed** timezone rather than
either side's ambient system tz, so server and client always compute the identical string
regardless of where either process runs. Swept the same banned pattern at three sibling sites:
`getGreeting()`'s `new Date().getHours()` in the same file (not yet a live mismatch — gated behind
a currently-null `displayName` — but the same class and would misfire for a travelling user), plus
identical bare `toLocaleDateString` calls in `overview-screen.tsx` and `pre-workout-screen.tsx`.
**Live-verified crossing the actual bug window**: this session's real wall-clock happened to cross
the UTC/AEST midnight boundary while testing (UTC still Aug 7, Brisbane already Aug 8) — a
pre-fix-cache Playwright run caught a genuine hydration error mid-test (`+ Friday 7 August` client
vs `- Saturday 8 August` server); clearing `.next` and rebuilding confirmed it was a stale
dev-server compile artifact from before the fix landed, not a residual bug — a clean rebuild showed
zero hydration errors and "Saturday 8 August" consistently on both renders. All three sibling sites
re-verified with a fresh `pnpm dev` pass afterward. Also corrected two false premises this
investigation's own history carried forward (see the Known-Issues row below): the shell does **not**
mount all five tabs at once (only the active tab mounts client-side), and the fix needed no
on-device capture — both cost two earlier sessions searching the wrong surface.
**🆕 2026-08-07 — Body Battery's "How it moves" panel stops contradicting the card above it
(Q-103, v1.267.17).** Owner-reported (screenshot): the expanded card showed "Currently 91, from
last night's sleep" directly above a "How it moves" panel unconditionally reading "Opens each
morning at your Readiness" — a visible contradiction on the same card. `body-battery-card.tsx`'s
"How it moves" line was a hardcoded string that never read `battery.anchorSource`, while two
sibling lines on the exact same card already rendered it dynamically ("from readiness" / "from
sleep"). The sleep-anchored state itself is correct, intentional, already-documented behavior (a
provisional anchor before Readiness lands) — only this one line's copy was wrong. Wired the same
field into the third line, matching the existing wording pattern: "Opens each morning at your
Readiness" or "...Sleep" depending on `anchorSource`. Verified against `pnpm dev` for the common
(readiness-anchored) case — confirmed no regression, the line still reads "Opens each morning at
your Readiness" matching "Currently 59, from this morning's readiness" directly above it, in both
light and dark themes. The sleep-anchored case (`anchorSource='sleep'`) needs today's readiness
data to be absent while a sleep score exists, and a persisted anchor snapshot already froze the
seed at `'readiness'` for today — forcing that specific data state was judged disproportionate
effort for a 3-line, purely cosmetic conditional that mirrors an already-proven pattern used
correctly at two other sites in the same file; verified by code review instead.
**🆕 2026-08-07 — "Body temp elevated" now shows the real numbers behind it (Q-105, v1.267.16).**
Owner asked whether the banner is gated to 30+ days of baseline data (confirmed yes,
`TEMP_BASELINE_MIN_DAYS = 30`) and wanted the "Why this recommendation?" expandable to show the
actual deviation driving it instead of a fixed qualitative sentence. Oura only exposes a °C
deviation from the ring's own internal baseline — there is no absolute baseline value anywhere in
the data — so the honest version shows **today's deviation vs the 0.5°C alert threshold** plus
**nights of baseline behind it**, not a fabricated absolute average. The raw
`temperatureDeviation`/`temperatureBaselineDays` values were already computed inside
`computeAiDynamicNextSession` but never threaded into `NextSessionRecommendation.signals` — pure
plumbing fix, no new computation. Also promoted the inline `0.5` magic number to a named
`TEMP_ALERT_THRESHOLD_C` constant alongside `TEMP_BASELINE_MIN_DAYS`, and sent the threshold value
itself over the wire (`signals.temperatureAlertThresholdC`) rather than having the client import
`ai-dynamic.ts` directly — that module pulls in the daytime-stress dHRV inference chain, which has
no business in a client bundle. Verified end-to-end against `pnpm dev`: seeded a
`oura_daily_summary` row (`tempDevC=0.7`, `nHistory=35`) and temporarily flipped the local seed
program to `ai_dynamic` mode (the seed defaults to `manual`, so this path can't fire otherwise),
confirmed the expandable rendered "+0.7°C above your baseline (threshold 0.5°C) — based on 35
nights of history" matching the seeded values exactly, in both light and dark themes, then reverted
the program back to `manual` and removed the seeded row. The plan's open product question — whether
the sub-30-day "baseline still maturing" state should surface anything today (currently silent) —
needs an owner decision this session had no channel to get; split off as **Q-105-followup**.

**🆕 2026-08-07 — home "Recommended Today" card no longer gets stuck on "Last: —" (Q-106,
v1.267.15).** Owner-reported: the Legs card showed "Last: —" despite a 62-day streak and other
sessions already showing completed that same week. Same bug family as Q-89 and Q-91, a third
independent site: `memo`'d `RecommendationCard` read `workout-card:<id>` synchronously inside
`lastSessionDay()`, but none of its props changed when the `workout-data:all` batch actually
populated that cache key (the batch only calls `setCached`, a side effect outside React state) —
a card whose first render landed before the batch resolved stayed frozen on `"—"` for the rest of
the visit. Fixed with the same `dataEpoch`-style counter Q-89 used: a new `workoutCardEpoch` state
in `session-select-content.tsx`, bumped every time the batch's `onData` callback runs, passed as a
prop and wired into a new `useMemo` around the `lastSessionDay()` call so the memo recomputes once
the cache is actually populated. Also fixed the independent code smell the same backlog entry
flagged: `lastSessionDay()` looked its session up by **name** against `activeSessions` even though
the caller already held the full session object with a real `id` — the exact "session identity =
DB id, not name" anti-pattern the Standing Instructions call out. It now takes `sessionId` directly.
Verified via Playwright against a cold cache (fresh browser context, no persisted cache): the card
read "Last: —" at t+1s and correctly updated to "Last: Sun" by t+2s and stayed correct thereafter,
reproducing the exact race and confirming the fix closes it. The local seed's mood-checkin gate
(the "Recommended Today" card only renders once today's mood is logged) meant a mood log had to be
seeded directly into the local dev DB to reach the card at all — removed afterward.

**🆕 2026-08-07 — Body Battery chart's right-edge time label no longer falsely claims "now"
(Q-108, v1.267.14).** Owner asked whether a low-sample-count reading was accurate and suspected
Home doesn't refresh. Two separate findings: (1) working-as-intended — Home's `body-battery` fetch
only re-runs on mount/tab-revisit/pull-to-sync/BLE-sync-settle, no polling, so a long-open tab
genuinely shows stale data; (2) the actual bug — `DayChart`'s right-edge axis label
(`body-battery-card.tsx`) was a hardcoded literal `"now"` string, unrelated to the real last-sample
time, so a stale card actively claimed to be current instead of just failing to update. Fixed by
deriving the label from the last series point's timestamp with the same `fmtAest` formatter already
used for the left (wake-time) label, symmetric with it and requiring no client-side `Date.now()`
comparison (so no hydration-mismatch risk). Verified visually in the local dev server: seeded 37
synthetic HR samples for today into `oura_heartrate` to make the chart render (the local seed
otherwise has no HR data for "today", so this path is untestable via a cold seed), confirmed the
chart showed two real derived clock times instead of "2:09pm"/"now", checked in both light and dark
themes via Playwright, then deleted the synthetic rows. Checked against production
(`claude_ro.sleep_sessions`) beforehand: the wake-time anchor itself is correctly computed from a
real recorded sleep-end — no evidence of a wake-time bug, only the label's false freshness claim.
The existing "Limited data" / low-sample disclaimer is intentional (Q-57) and untouched.

**🆕 2026-08-07 — manual Home "Deload" now actually reduces prescribed load on AI-dynamic sessions
(Q-109, v1.267.13).** Root cause: `buildWorkoutExercises` applied the AI-dynamic prescription's
stored numbers unconditionally once `aiDrivesLoad` was true, with no reference to the `aiDeload`
flag Home's manual Deload choice sets — the flag only ever touched cosmetic/logging metadata (phase
banner, `intensityMode` tag, PR suppression), never the actual weight/reps/rest. Fixed by adding an
`else if (aiDeload)` branch that applies `deloadOverrideForGoal(trainingGoal)` — the same tuned
`DELOAD_LOWER_PCT`/`DELOAD_REPS`/`DELOAD_SETS`/`DELOAD_REST` constants the automatic per-exercise
engine already uses — skipped when the exercise is already auto-deloaded so the two don't compound;
`preDeloadStyle`/`preDeloadSets` are populated so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) still works. Composes automatically with this session's earlier Q-115 1RM-gate
fix: setting `deloaded = true` extends the existing `exerciseDeloaded` payload flag, so manually
deloaded sets are excluded from PR/1RM credit with no additional server-side wiring. **Not
device/live-API verified** — the local seed program is `phase_mode='manual'`, not `ai_dynamic`, so
this path couldn't be exercised via a live `pnpm dev` + API call; verified instead with a direct unit
test against the pure `buildWorkoutExercises` function (5 cases: unaffected normal session, correct
override values, revert-UI compatibility, non-compounding with an already-auto-deloaded exercise,
goal-specific override). The owner's separate request to move the Deload toggle off Home onto the
pre-workout screen was split into Q-109-followup and **has since shipped** (v1.270.28, see the entry
at the top of this file). Full detail:
[`entries/2026-08-07-manual-deload-ai-prescription-wiring.md`](docs/overview/entries/2026-08-07-manual-deload-ai-prescription-wiring.md).

**🆕 2026-08-07 — the sore-muscle check-in warns before a whole-session deload, not just a narrow
one (Q-115-followup, v1.267.12).** Split off from Q-115 after its 1RM-inflation half shipped.
`SoreMusclePicker`'s overlap banner always said "those exercises will be lightened," even when
`computePerExerciseDeload` was about to escalate to a whole-session deload (>50% of the session's
exercises matched on a sore muscle's main-role assignment) — directly observed causing 4 of 5
exercises in a real session to flag false "Personal Records" (the other half of Q-115). Fixed by
threading real per-exercise muscle-role data through: `/api/next-session` now also returns
`muscleAssignmentsByExercise` (from the same `getExerciseMuscleAssignments()` the server's real
computation already uses), and `SoreMusclePicker` calls the shared `computePerExerciseDeload`
directly to predict the escalation and switch banner text — reusing the exact server logic instead
of re-deriving it. Verified with Playwright in both themes against the seeded 3-exercise Push
session: selecting 2 of 3 exercises' sore muscles correctly showed the whole-session warning;
deselecting back to 1 correctly reverted to the narrow phrasing. Full detail:
[`entries/2026-08-07-sore-muscle-picker-whole-session-banner.md`](docs/overview/entries/2026-08-07-sore-muscle-picker-whole-session-banner.md).

**🆕 2026-08-07 — Morning Check-in stops score-based pre-filling; Motivation replaced with an
illness/context flag (Q-113, v1.267.11).** Root cause: `prefillMorningScales()` seeded
`perceivedRecovery`/`sleepQualityFeel` from `scoreToScale(readiness/sleepScore)`, so the sheet
opened already positioned at a score-derived guess — an unedited Save stored that guess as if it
were independent self-report, which is why Recovery felt redundant with Readiness and why
`battery-recovery-calibration.ts`'s published `r=−0.414` correlation was uncertain (partial
circularity, since Body Battery itself anchors from Readiness). Fixed by defaulting both scales to
a neutral 3 (not score-derived) and adding persisted `perceivedRecoveryTouched`/
`sleepQualityFeelTouched` columns (migration 169) so future calibration work can filter to
genuinely-edited rows rather than guessing. `prefillMorningScales()` and its dedicated tests were
removed (fully unused after this). "Motivation to train" (confirmed zero calibration/gating use
anywhere in the codebase) is replaced with a single-select "Anything going on?" chip picker (Feeling
sick / Alcohol last night / Travel or poor sleep environment) — `illnessContext: 'sick'` now feeds
the SAME deterministic `selfReportedSick` signal the mood check-in's `bodyState` already fed,
extracted into one shared `resolveSelfReportedSick()` helper used at all three sites that computed
it (`signals.ts`'s full aggregation, the ai_dynamic home-recommendation path, and the same-day
`reevaluatePrescriptionForToday` path) — previously each computed it slightly differently, all now
consistent. `reevaluationKey()`'s fingerprint now also includes the Morning Check-in's own
`updatedAt`/`illnessContext`, so filling in "sick" after the mood log was already cached still
triggers the same-day re-evaluation instead of being silently skipped. Threaded the two new touched
flags + illness context through the full offline-first chain (Postgres schema/adapter, local SQLite
reconcile-delivered columns, sync-engine mapping, outbox validation schema) per the sync-mirroring
rule. Verified via a real `POST`/`GET /api/day-checkin` round trip against the local seeded DB with
all three new fields, and the full test suite (403 files / 3,187 tests, including new coverage for
`resolveSelfReportedSick` and the extended `reevaluationKey`). **Not exercised:** the auto-prompt
sheet itself couldn't be visually confirmed in the Playwright sandbox — the same "no existing
checkin" auto-open behaviour also doesn't fire on unmodified `main` in this environment, confirming
a pre-existing sandbox/dev-server limitation rather than a regression, but it means the actual
on-screen chip picker and neutral-default sliders were verified by code review and the underlying
data flow, not a live screenshot. No on-device S25 verification — JS-only, no native/safe-area
involvement. Full detail:
[`entries/2026-08-07-morning-checkin-prefill-illness-flag.md`](docs/overview/entries/2026-08-07-morning-checkin-prefill-illness-flag.md).

**🆕 2026-08-07 — Running screen carousel gets per-type imagery, Skip button removed
(Q-98-followup, v1.267.10).** A scoped subset of the owner's suggested redesign: each carousel
slide now shows a themed icon + HR-zone-coloured badge (reusing the existing `HR_ZONE_META`
palette, not new illustration assets), and the separate Skip button/`markRun` machinery is gone —
swiping to a different type already resets status via the existing `applyOverride` path, so
there's no longer a distinct "I don't want this" action. Confirmed by grep that nothing else reads
`status === 'skipped'` as meaningful (stats/streaks only filter for `'completed'`), so removing it
was safe. **Deliberately did not** fold Start into every slide or eliminate `PrescribedRunCard` —
that panel carries content (AI rationale, gate-softening warnings, Push badge) that doesn't map
cleanly onto a small carousel slide, and duplicating a Start button per-slide alongside a
persistent external one would be redundant. Kept one external Start button driven by whichever
slide is currently showing. Full detail:
[`entries/2026-08-06-running-screen-carousel-imagery.md`](docs/overview/entries/2026-08-06-running-screen-carousel-imagery.md).

**🆕 2026-08-07 — deloaded sets no longer inflate the 1RM estimate or mint bogus PRs (Q-115,
v1.267.9).** `prescriptionStyleForExercise()` unconditionally set `useFor1rm: true` on every
prescribed set regardless of `presc.deloaded`, so a deliberately submaximal deload set ran through
the 1RM formula as if it were a genuine top set — confirmed against the owner's own report (Incline
Bench Press: 78.75kg → false 85.75kg PR off two 42.5kg sets). **The naive fix wasn't enough on its
own**: `calculate1RM`'s own fallback treats "every set marked `useFor1rm: false`" as "no preference,
use them all" (needed by other real styles like "General") — so simply flipping the flag to `false`
for a deload would have silently kept inflating the estimate. The real fix adds an unambiguous
`deloaded` option to the shared `estimateOneRm()` (`packages/shared/src/1rm.ts`) that short-circuits
to a zero estimate, wired at both the client (`workout-screen.tsx`) and server
(`log-exercise.ts`) call sites — zero is already safely ignored by `resolveWorkingBasis()` (filters
`v > 0`) and `shouldCountTowardPr()` (`<= 0` gate), so a deload never corrupts a future prescription.
Also stamped `deloaded: true` at construction in `buildWholeSessionDeloadPrescription`, closing a
second gap the owner's follow-up report surfaced: a whole-session AI deload (>50% of exercises sore)
never set the per-exercise flag at all, so it bypassed **every** downstream gate — confirmed via a
read-only production query that this had already written 4 bogus PRs on 2026-08-06, corrected in the
same PR by a scoped, idempotent migration (`168_q115_whole_session_deload_pr_correction.sql`) after
explicit confirmation. The static-progression-style deload phase was checked and is already
correctly configured (`use_for_1rm: false` on every deload-phase style set in production) — no bug
there. Verified via a real `POST /api/log-exercise` against the local seeded DB with the owner's
exact reported numbers (estimated1rm: 0, isPR: false) and a control case with genuine working sets
(estimated1rm: 79, isPR: true, unaffected). The sore-muscle-picker's "will be lightened" banner
still doesn't account for the whole-session escalation — split off as **Q-115-followup** (needs
per-exercise muscle-role data threaded through several component layers, out of scope for this fix).
Full detail: [`entries/2026-08-07-deload-1rm-inflation-fix.md`](docs/overview/entries/2026-08-07-deload-1rm-inflation-fix.md).

**🆕 2026-08-07 — the "Today's Timeline" wakeup/sleep cards are tappable → that night's sleep
detail (Q-93-followup sleep half, v1.267.8).** The blocker that scoped these out of Q-93 was real
for `/health/sleep` (`SleepContent` has no date-selection UI) but not fatal — `HealthMetricSheet`'s
existing sleep sheet already renders full per-night detail for any of the last 14 nights via a
list/detail toggle. Deep-linked into it instead of building a new screen: the "Woke up"/"Fell
asleep" cards now navigate to `/health?tab=body&openSleepDate=YYYY-MM-DD`, which pre-selects that
night. Wired on both timeline renderers. Verified with Playwright in both themes by driving the
`?openSleepDate=` URL directly (seed data has no sleep session recent enough for a live "Woke up"
card to render today) — confirmed the sheet opens straight to that night's stage breakdown, not the
list. The workout card remains unwired — it needs a historical HR-chart/exercise-detail screen that
doesn't exist yet at all; Q-93-followup's backlog entry is scoped down to just that piece. Full
detail: [`entries/2026-08-07-sleep-timeline-detail-deeplink.md`](docs/overview/entries/2026-08-07-sleep-timeline-detail-deeplink.md).

**🆕 2026-08-06 — Running-plan overrides now write through the local store, fixing a real
APK-only skip-then-dead-end bug (Q-98 bug-fix half, v1.267.7). ⚠️ NOT device-verified.**
`applyOverride` (swipe-to-pick-a-different-run-type, after skipping) only did a bare `fetch`,
unlike `markRun` which writes through the local store + outbox — so on a device with a real local
store, the screen's local-first status effect re-read the stale `'skipped'` row `markRun` left
behind and clobbered the optimistic `'pending'` reset back to skipped, permanently. Invisible on
web (`getLocalStore()` returns `null` there), which is why it survived past `pnpm dev` testing
until an owner hit it on the APK. Fixed by writing the override response through
`store.upsertPrescribedRun(...)` as `synced` (the server already has it via the POST that produced
it). **The failing path is structurally unreachable in this sandbox — no native SQLite here — so
the actual fix has not been exercised on a real device.** Verified only that the web path
(unaffected by this change, since the new code never runs there) still works correctly with no
regressions. Needs a real on-device swipe-to-pick-a-different-run-type check before this can be
marked confirmed. The redesign half of Q-98 (per-run-type imagery, folding Start into carousel
slides) was not attempted — split off as **Q-98-followup** in the backlog. Full detail:
[`entries/2026-08-06-running-plan-override-local-write.md`](docs/overview/entries/2026-08-06-running-plan-override-local-write.md).

**🆕 2026-08-06 — Guided Walk's preset picker is now Long / Short / Custom (Q-99, v1.267.6).**
Content/state change only — the carousel mechanics were already shared with the Running screen and
needed no rebuild; the Workout-tab-style visual richness (palette/imagery) stays explicitly out of
scope. Relabeled Standard→Long, Quick→Short (values unchanged), added a persisted `customConfig` to
`guided-walk-store.ts`, and fixed the pre-existing bug where an edited stepper silently kept
claiming "Long selected" instead of showing Custom. Two real bugs found and fixed during
implementation, not just at review: (1) `DEFAULT_WALK_CONFIG`'s numbers are identical to Long's, so
a naive "apply default and let content-derivation take over" approach snapped straight back to Long
the instant Custom was selected — fixed by tracking the selected slide as real state, not a pure
content derivation; (2) the autosave initially only wrote `customConfig` on a *subsequent* edit
after the flip-to-custom, leaving the Custom slide's own preview text stale until a second stepper
touch — fixed by saving in the same effect pass that detects the flip. Both caught by an actual
Playwright screenshot, not by reasoning about the code. Full detail:
[`entries/2026-08-06-guided-walk-long-short-custom-presets.md`](docs/overview/entries/2026-08-06-guided-walk-long-short-custom-presets.md).

**🆕 2026-08-06 — Zone 1 minutes now get lazy-day credit on the Cardiovascular screen (Q-88,
v1.267.5).** Reopens D-10 (`docs/superpowers/specs/2026-07-26-cardio-system-spec.md:60-82`) without
overturning it: Zone 1 stays excluded from both the weekly training quota and the Activity Score's
active minutes exactly as before — the owner's ask was the inverse of D-10's original concern (a
"you still moved" signal, not training credit). Shipped as a new, separate card
(`components/cardio/lazy-day-credit-card.tsx`) shown only on days with no dedicated workout or
logged cardio/guided-walk session, reusing the existing lightweight `getDayExerciseNames()`
"trained today" check plus a same-day `listActivityLogs()` read — `GET /api/cardio-week` gained a
`trainedToday` boolean, no new zone-minutes query needed since `dayQuota` already carries the Zone 1
row. Verified with Playwright against seeded local HR data in both themes: card renders with a real
Zone 1 minute count on a no-workout day, disappears the moment a workout is logged that day. Full
detail: [`entries/2026-08-06-zone1-lazy-day-credit.md`](docs/overview/entries/2026-08-06-zone1-lazy-day-credit.md).

**🆕 2026-08-06 — the pre-workout header refresh button no longer flashes "done" mid-generation
(Q-86, v1.267.3).** Not a caching bug — the duration-preset switch correctly forces a real,
uncached LLM regeneration; the bug was that the header refresh button's spin/disabled state was
bound only to its own unrelated re-fetch (workout-data + periodization status), which resolves
from cache almost instantly. Now bound to `prescriptionPending` too (the same flag already driving
the "Preparing your AI workout…" heading), so it stays visibly busy and disabled for the whole
generation window and can't fire a redundant request mid-flight. Verified against a real seeded
`ai_dynamic` prescription with the actual `/prescribe` call intercepted and delayed (no LLM key
configured in this sandbox), confirming the disabled/spin state holds via direct DOM attribute
checks, not just a screenshot. Full detail:
[`entries/2026-08-06-duration-preset-refresh-feedback.md`](docs/overview/entries/2026-08-06-duration-preset-refresh-feedback.md).

**🆕 2026-08-06 — the exercise-summary/rest screen shows what's up next (Q-87, v1.267.2).** Cheap,
traced to source — `effectiveExercises[store.currentIdx + 1]` at the exact call site that already
builds the committed summary object, and the planned starting weight reuses
`computeInitialWeights()`, the same formula the set actually opens with (not the pre-workout
screen's "last time" line, which is last-*logged* weight and can read differently). Renders an "Up
Next" card between the rest timer and the sets table; `null` at the last exercise of a session, no
broken/empty state. Verified end-to-end with a real Playwright run through the actual Log Set /
rest-skip UI against seeded local data, in both themes. Full detail:
[`entries/2026-08-06-exercise-summary-up-next.md`](docs/overview/entries/2026-08-06-exercise-summary-up-next.md).

**🆕 2026-08-06 — the Sleep screen gains phase-hours/bedtime/wake-time trend charts + skin
temperature (Q-90, v1.267.1).** The plan flagged one real ambiguity — "toggle between, or
combine" — needing a decision before building; resolved as a segmented control (the app's
existing `SegmentedTabs` pill-tab primitive) over one shared chart area switching between Sleep
Stages / Bedtime / Wake Time, with skin temperature as its own always-visible card (a separate ask
in the report's own phrasing). Bedtime plots on the noon-shifted axis (`minutesFromNoon`, already
used by this screen's consistency card) to avoid the midnight-wrap trap this domain has hit
before — covered by 8 new unit tests. `extraCards`'s signature grew an additive third `trends`
argument (Readiness/Activity unaffected). Caught a real bug during visual verification: the new
stacked-bar chart's legend didn't render at all because chart.js's `Legend` plugin was never
registered — fixed before merge, a reminder that a clean typecheck/lint/test pass doesn't catch a
silently-missing chart.js plugin registration.

**🆕 2026-08-06 — Sleep Score gets an awake-time fragmentation cap, decided live against a real
disrupted night (v1.267.0).** Owner reported a work-call-disrupted night scoring 89 "High" — traced
to the exact Q-72 finding (score barely uses its range) plus the specific mechanism: normal
duration/HRV/HR/timing diluted the small efficiency/restfulness hit from fragmentation. Owner
explicitly ruled out wiring `sleep_quality_feel` into the score (Q-102's direction — wants it kept
independent for backlog calibration, reversing nothing) and asked for an objective awake-time/
fragmentation criterion instead. Two false starts before the shipped design: (1) reweighting +
steepening existing curves moved the target night but didn't generalise and barely touched the
feel-correlation; (2) `restlessPeriods` (ring wake-event count) was tried as the driving signal and
rejected — production data showed the SAME value (4) on both the disrupted night and the single
best-rated night of the prior month, i.e. it's noise for this ring, not a separator. What shipped:
`sleep-score.ts` adds a STANDALONE cap (not another weighted contributor) — `min(weightedScore,
awakeFractionCap(z))` — keyed on how many personal standard deviations this night's awake-time
fraction sits above the sleeper's own trailing mean (`SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS =
14` prior main sleeps before it evaluates at all, same opt-in-baseline pattern as `hrv`/`hr`/
`schedule`). Backtested against the real function and the full 53-night production history (not a
reimplementation): correctly fires on genuine outliers already in the data (2026-07-11, z=3.00,
76→32; 07-04, z=1.88, 86→76) and does nothing to the other 51 nights, including every clean one —
confirms the "never lowers the ceiling" design goal held. **One honesty note for whoever reads this
next:** the specific night that motivated this (2026-08-06) was re-queried mid-session and its
`awake_hours` had been revised downward by the live BLE rollup (1.92h → 1.17h) between the first and
final read — under the corrected numbers that particular night's z-score (0.99) falls just short of
the cap threshold. The mechanism is correct and proven on other real nights; this specific night
just turned out milder than the ring's still-catching-up numbers first suggested. Full detail:
[`entries/2026-08-06-sleep-fragmentation-cap.md`](docs/overview/entries/2026-08-06-sleep-fragmentation-cap.md).

**🆕 2026-08-06 — the sleep hypnogram no longer looks "stuck missing" after a sync/redecode
(Q-91, v1.266.11).** Measured production first: no recent night was actually missing hypnogram
data. The real bug was a missing reactive refetch — `invalidateOuraSync()` correctly clears the
`'sleep-sessions'` cache after a BLE drain settles or a Redecode, but nothing told an
already-mounted sleep screen to refetch, so the fix was invisible until the next navigate-away/
remount. Traced wider than the plan itself found: `session-select-content.tsx` was the only
`ta:oura-ble-synced` listener in the app, but even its own handler didn't refetch this cache key.
All three readers (`sleep-content.tsx`, `health-content.tsx`, `session-select-content.tsx`) now
refetch on that event. Verified end-to-end with Playwright: updated a row and dispatched the real
event without navigating away, watched the hypnogram appear live. The ingest rollup's own
missing invalidation signal is deferred as `docs/implementation-backlog.md` Q-91-followup — it
needs a scoped design to avoid reintroducing a latency risk the plan flagged.

**🆕 2026-08-06 — the home HR-today chart is smoother, with an opt-in dashed backfill across gaps
(Q-92, v1.266.10).** The bucket width behind the line was already tunable math (`bucketAverage`,
shared with two other charts), just hardcoded at 5 min — promoted to a `bucketMinutes` prop,
defaulted to 10. Added a new pure function, `interpolateGaps`, as a sibling to the existing
`withGapBreaks` (untouched — the real line still shows an honest break at every gap); it produces
a second, separate chart.js dataset that linearly bridges 20min–2h gaps only, rendered dashed in a
distinct scheme-aware color with its own legend entry. Wired on (`showBackfill`) only at the home
widget that was reported — the other three chart consumers keep the smoother bucket, no backfill.
Verified visually in both themes against seeded real-gap data.

**🆕 2026-08-06 — the "Today's Timeline" meal card is tappable → jumps to that day's food log
(Q-93, v1.266.9).** Scoped down from the full Q-93 ask after finding the plan's premise wrong:
the sleep-card destination (`/health/sleep`) has no date-selection UI at all (always shows the
latest night), and the workout-card destination needs a historical HR-chart/exercise-detail screen
that doesn't exist yet — wiring either today would land on a misleading or nonexistent screen.
Shipped only the meal card, on both timeline renderers (home + `/health/timeline`), navigating to
`/nutrition?date=YYYY-MM-DD` using a new `date` field on `TimelineEvent`. Verified end-to-end via
`pnpm dev` + a headless Playwright click. Remaining sleep/workout wiring filed as
`docs/implementation-backlog.md` Q-93-followup with the concrete screen work each needs.

**🆕 2026-08-05 — the Workout tab's "already trained today" state gets a full-width banner (Q-97,
v1.266.8).** Follow-up to Q-89: the underlying state was now correct/timely, but the indication
itself — a faint ring, a 12px icon+text line, a softened button — was too easy to miss. A dedicated
"Completed Today" banner (larger icon, bold text, tinted background) now sits between the session
header and the muscle diagram. Icon+text pairing kept (never colour-only); "Start Again" stays
reachable underneath, unchanged.

**🆕 2026-08-05 — the Workout tab card shows "trained today" immediately, not after a tab revisit
(Q-89, v1.266.7).** Every relevant cache key genuinely was invalidated correctly — the defect was a
stale `useMemo` local to `WorkoutSelectContent`: its `getLastTrainedLabel` callback reads
`workout-card:<id>` from cache directly rather than taking it as an argument, and the
post-completion refresh only bumped a discarded `forceUpdate` counter, never changing
`currentSession`'s object reference, so the memo never recomputed on the same mount. Captured the
counter's value and added it to the memo's deps.

**🆕 2026-08-05 — auto-activity-detection no longer double-logs during a Guided Walk or manual
activity (Q-95, v1.266.6).** `dispatchGate()` already suppressed the passive walk/run trigger
while a lifting workout was active (`isWorkoutInProgress`) — a Guided Walk is the identical case,
but the service never checked the equivalent, already-existing `isGuidedWalkActive` predicate.
Added it, plus a sibling gap found in passing (`isActivityActive` for the manual "Other Activity"
flow). No new plumbing — both predicates already existed and were already used elsewhere for
nav-away guards. Verified via a new test suite proving the composed suppression condition with the
real predicates, since `dispatchGate()` itself isn't exported and GPS/motion triggers aren't
reproducible in the sandbox.

**🆕 2026-08-05 — a Guided Walk shows as "Guided Walk" on the timeline, not "Outdoor walking"
(Q-94, v1.266.5).** The distinguishing data (a guided walk's `segments` column, only it ever
populates) already reached `day-timeline/route.ts` intact — a keyword-collapse step there flattened
every walk to a bare `"Walk"` before display. Checked `segments != null` before that collapse;
both display surfaces (the home timeline card, the separate `/health/timeline` page) already fall
through to rendering the title verbatim for anything that isn't literally "Run"/"Walk", so no other
changes were needed. Reproduced against real seeded data: a guided walk and a plain walk on the
same day were indistinguishable before, correctly labeled after.

**🆕 2026-08-05 — "Burned" and "Balance" now use the correct active-energy source (Q-96,
v1.266.4).** Owner report: Body tab "Burned" read 0 kcal despite a logged workout + guided walk;
"Balance" never showed real data. Both read `calsBurnedToday`, a bare sum of
`activity_logs.caloriesBurned` that a Guided Walk always writes null and lifting workouts never
touch at all — not a data bug, a source bug. `computeActiveEnergy()` already computes the correct
figure (BMR-adjacent + workout + walk/run + steps) and already feeds the separate, working
`EnergyBudgetCard`; swapped both broken cards onto it, per "One Formula, One Place." Sibling-surface
check found two more genuine siblings sharing the same broken concept (the home nutrition-donut
boost, the nutrition macro-ring "+N from cardio" label) and fixed those too. Also relaxed
`useEnergyBalance`'s stricter all-or-nothing null gate to match `useEnergyBudget`'s (no food logged
yet isn't missing data). Reproduced end-to-end against `pnpm dev`: seeded a completed workout + a
null-calorie guided walk, confirmed `calsBurnedToday: 0` (broken) vs `activeEnergyKcalToday: 402`
(correct, now what every UI consumer reads).

**🆕 2026-08-05 — no more visible scrollbar chrome on cardio and its siblings (Q-100, v1.266.3).**
Owner report: a scrollbar shows on the cardio page's right edge. The app already had a
scrollbar-hiding utility (in fact two near-identical ones, now consolidated to one) applied at only
two places app-wide. Sibling-surface sweep found the same bare `overflow-y-auto` pattern on five
more top-level screens plus a shared component (`components/pull-to-sync.tsx`) three more screens
route through — fixed centrally there rather than patching each caller. Confirmed via real SSR that
both the raw-div fix (cardio) and the shared-component fix (session-select/home) render the class
correctly; the client-only tab screens aren't in SSR output to check the same way, so those are the
identical, type-checked mechanical edit extended with confidence rather than individually
screenshotted. **Not exercised:** on-device confirmation that the reported native scrollbar chrome
is actually gone (WebView can render differently from the sandbox) — the fix is inert wherever a
screen never showed one.

**🆕 2026-08-05 — the sleep list no longer shows onset latency as if it were bedtime (Q-101,
v1.266.2).** Owner report: bedtimes looked pushed back from the usual ~10-10:30pm. Root cause: three
surfaces (the sleep list, its detail header, the Body-tab sleep card) displayed an onset-trimmed
start time instead of the raw `sleepStart` — matching `sleep_start + onset_latency_sec` to the
minute, not a data bug. Two other surfaces (the Hypnogram ribbon, the day-timeline "Fell asleep"
card) already showed raw bedtime with latency called out separately, which is the pattern that
matches how the owner reads "bedtime." Standardized the three disagreeing sites on it — latency is
now shown as `· Nm latency` alongside the time range instead of being folded in.

**🆕 2026-08-05 — per-set/per-workout HR attribution no longer depends on opening the recap (Q-11
Defect B, v1.266.1).** A session that was finished and never revisited got zero HR detail forever —
the recap fetch was the only trigger. `POST /api/complete-workout` now fires a best-effort
fire-and-forget compute at completion (closes it outright for a live chest strap), and the two
backfill work-lists are now coverage-aware so an Oura-ring-only session (no data yet at completion)
still gets picked up once the ring drains and a backfill pass runs — the trap a naive
"just compute at completion" fix would have walked straight into. Verified end-to-end against
`pnpm dev`, no mocks. The device-side coverage-quality question (large share of `coverage_ok=false`)
is unrelated and left for a fresh re-measurement.

**🆕 2026-08-05 — a shortened session no longer over-charges warmup (Q-83, v1.266.0).** Once a
measured warmup median is learned, it was subtracted whole from whichever preset budget was chosen,
so the same 9 minutes cost Quick 30% of its budget and Normal 15%. It is now capped at 20% of the
budget — but **only when today's budget is below the session's own configured length**, which is the
only case where the double-charge exists; a session genuinely configured at 30 minutes keeps its
measured value, because there 9 minutes really is 30% of it. Measured through the real prescribe
route: Quick went from 2 dropped exercises / 11 min estimated to 1 dropped / 22 min, standard and
long byte-identical. **The warmup was not the dominant cost, though** — the trimmer's exercise-count
thresholds are ~6–7 min apart and this recovers 3, so it crossed one on the owner's session and
often will not. Rest, not warmup, dominates a short budget (~12 of a main lift's 19 minutes), filed
as **Q-85**.

**🆕 2026-08-05 — guided-walk summaries show cadence, and show it first (Q-84, v1.265.0).** Owner
report. Nothing new is captured: cadence was already live on the walk screen, computed per interval
and persisted — `aggregateSegmentsByKind` just read past it, so three render sites had nothing to
show. Cadence now leads the fast/slow cards, the per-interval rows and the history card, falling back
to pace when no strap was connected. `walkEffortDisplay()` owns that choice so the three sites can't
drift. **Queue note:** Q-71 and Q-73 were skipped as ⛔ blocked (owner decision on a ~5-min sleep-time
shift; a device capture for the hydration error) and annotated in the backlog — next ready is Q-83.

**🆕 2026-08-05 — Body Battery is checked against subjective recovery (Q-79, v1.264.0), and the
data-analysis review batch Q-75…Q-79 is closed.** An admin panel under Day Review, beside the Sleep
Score calibration and sharing its engine and card. **The pairing was measured rather than assumed,
and the assumption was wrong:** the causally appealing "you report it the next morning" lag finds
nothing (r = +0.115, p = 0.52); only same-date reproduces the review's r = −0.400. Shipping the lag
would have rendered a flat panel that read as the model failing. Negative r is agreement —
`perceivedRecovery` stores 1 = fully recovered … 5 = wrecked.

**🆕 2026-08-05 — HRV vs training volume is on screen (Q-78, v1.263.0).** Overnight HRV → same-day
tonnage, r|t = **+0.495, p = 0.006, n = 30**; split at the median, **4,376 kg vs 5,799 kg — a 33 %
difference**. The signal was already being scored by `recovery-vs-strength`, just against mean 1RM
percent rather than volume, which is where the response actually shows. HRV is coded as percent of a
28-day baseline (a raw-ms boundary is a fact about one ring) and tonnage is summed **per day**, since
two sessions share one overnight reading. **Nothing acts on it** — n = 30 does not survive Bonferroni,
so the entry's "candidate input to the prescription engine" was deliberately left unbuilt until n ≥ 60.

**🆕 2026-08-05 — the bedtime-cost trend is live (Q-77, v1.262.0).** A **Bedtime vs sleep** view on
the Health screen, carrying the strongest relationship in the dataset: **−0.70 h of sleep per hour
later to bed** (r|t = −0.534, p < 0.001, n = 52), the only finding in the review that survives
Bonferroni. Built on Q-76's `nightSessions()` and Q-75's significance gate, so it inherits both with
no new code. The trap it guards is the encoding, not the statistics — a raw clock hour wraps at
midnight and reverses the finding to r = +0.75; the route test flips to that coding and asserts red,
reproducing +0.768. Deep sleep (p = 0.038) was deliberately not built.

**🆕 2026-08-05 — sleep analysis counts nights instead of rows (Q-76, v1.261.0).** Eleven read sites
treated one `sleep_sessions` row as one night. Production holds **66 rows for 54 nights**, so **7 of
the 54 dates fed the wrong duration into the sleep-vs-performance correlation** — six by ~8 h
(2026-07-04 read as 0.11 h, not 8.22 h), and the one genuinely split night as 4.02 h, not 6.55 h.
The fix routes them all through the existing `nightSessions()`; the new predicate the backlog entry
proposed was **not** built, because the shared helper already did both halves. Four sites stay on raw
rows on purpose. Two nights (2026-06-01, 2026-06-04) and the 2026-06-02/03 gap remain unrecoverable
at read time — see Known Issues.

**🆕 2026-08-05 — two owner-reported gaps triaged and queued, not yet built (Q-83, Q-84).**
Docs-only planning session. **Q-83:** a 30-min "Quick" session preset was prescribing only 2
exercises because the measured per-lifter warmup carve-out is a fixed absolute minute count that
doesn't scale down with a shorter preset — Quick loses 30% of its budget to warmup vs Normal's 15%
and Long's 10%, for the identical learned warmup value. **Q-84:** the guided-walk summary shows
pace, not cadence, for fast/slow intervals — cadence is already computed per interval and
persisted, it's just dropped at the fast/slow rollup and never rendered. Plans + backlog entries:
[`docs/overview/entries/2026-08-05-time-budget-cadence-backlog-planning.md`](docs/overview/entries/2026-08-05-time-budget-cadence-backlog-planning.md).
**Renumbered from Q-75/Q-76** — a same-day PR (#1078) claimed those numbers first for an unrelated
data-analysis review, below.

**🆕 2026-08-05 — the recorded data was reviewed for what else it can tell us, and the review's main
finding is about our own method (docs only, Q-75…Q-79 queued).** A 110-day, 64-column daily matrix
pulled from production and analysed with two controls the app does not apply: a **date-trend control**
(overnight HRV correlates with the calendar at **r = 0.79**, so anything else that trends with time
correlates with HRV for free) and exclusion of the **14 of 66 sleep rows under 4 h**. Of the five
strongest raw correlations, **three vanished under the trend control, one was entirely an artefact of
the degenerate rows, and one reversed direction** under correct variable coding — and
`correlationInsight`, which backs all seven `/api/health-trends` views plus
`/api/sleep-performance-correlation`, applies none of those checks (it renders a confident sentence
whenever two buckets of ≥3 points differ by >1 *raw unit*, a unit-blind threshold). Fixing that is
**Q-75** and ranks above every new view. What survived: **later bedtime costs 0.70 h of sleep per
hour** (r|t = −0.534, p < 0.001, n = 52 — Q-77); **overnight HRV predicts same-day volume**, +33 %
across the median (r|t = +0.495, p = 0.006, n = 30 — Q-78); **Body Battery agrees with subjective
recovery** (r|t = −0.414, p = 0.010 — Q-79). Measured and deliberately *not* built: workout time of
day, steps→sleep, bedtime regularity, tonnage→overnight recovery, set-to-set rest→next set. Evidence:
[`docs/reviews/2026-08-05-data-analysis-opportunities.md`](docs/reviews/2026-08-05-data-analysis-opportunities.md).

**🆕 2026-08-04 — Q-58 is complete (v1.256.3): 30 of the 31 routes that can return a 500 now report
it.** Part 2 covered the 21 routes that caught their own error and returned a 500 silently — the
global hook of part 1 cannot see those, because nothing escapes. Scripted, then every hunk read:
**two routes would have logged a normal duplicate-name 409 as a server fault**, and `log-calendar-
event` a missing calendar grant, so those calls sit past their non-500 branches. The one route left
out returns its 500 from a data-shape guard rather than a catch.

**🆕 2026-08-04 — server errors that escape a route are recorded instead of vanishing (Q-58 part 1,
v1.256.2).** Counting first changed the shape of this item: it was filed as "189 routes need a
one-line edit", but **80** route files have no `catch` at all (a global hook covers them with zero
edits), **31** catch their own error and return a 500 (invisible to any global hook — they need the
explicit call, queued as **Q-58b**), 13 already report, and ~76 have no 500 path at all. Next's
`onRequestError` now writes to `error_events`, deduped 60 s per route+message so a hot loop in a
broken route cannot fill the 1 GB volume. **Verified by actually firing it** — a temporary throwing
route, hit against `pnpm dev`, row read back out of Postgres with path, method, message and stack.

**🆕 2026-08-04 — the “Update available” banner now tracks the APK, not the app version (Q-59,
v1.256.0).** It compared the installed APK against the server's `package.json`, but the APK is a
WebView loading Railway, so nearly every release reaches the phone with no reinstall — it was telling
the owner to reinstall for changes they already had, every release. **The half the plan missed:**
`package.json` was in the Android workflow's path gate, and every release bumps it, so the APK was
being rebuilt and republished on *literally every merge* (last six checked: all one-line version
bumps, none native). There genuinely was a newer APK each time — identical apart from its version
string. `package.json` is out of the gate (dependency changes still trigger via `pnpm-lock.yaml`), and
the card now compares against the newest **published APK**. It can also finally say **“up to
date”**; it used to render nothing, which is what made the owner's install check ambiguous.
**One more install is needed before it goes quiet** — the owner is on ~1.252.x, the newest APK is
1.255.1.

**🆕 2026-08-04 — the step rollup can no longer file readings on days that have not happened
(Q-56, v1.255.1).** Five `body_metrics` rows were written on 2026-07-30 carrying real ring step
counts dated up to five days ahead; all five self-healed as their dates arrived, which is precisely
why the writer still needed fixing. Root cause confirmed against production anchor rows: ring time
runs ~15 minutes ahead of wall time per anchor re-stamp during a drain, and the step path
extrapolated linearly from whichever anchor was newest with no bound in either direction. Now it
resolves against the anchor **nearest each frame**, and anything still landing in the future is
**dropped and re-read on the next pass** rather than stored. **The rest of the rollup — sleep, HR,
temperature — still uses the single-anchor converter**; that is queued as Q-71, deliberately not
folded in.

**🆕 2026-08-04 — navigation speed is now instrumented on the device (v1.255.0).** The question
"does navigation feel slow, and did the prefetch sweep help?" had no measurement behind it at all —
cold start was measured, navigation never was. Every tap that changes the URL now records how long
the new screen took and **whether the route had been prefetched** (`rscCount === 0` = warm), read
out of **More → Admin → Device data capture**. Verified end-to-end in a real browser, including the
query-only `/workout` → `/workout?session=…` transition. **The phone capture itself is still owed** —
until then the prefetch sweep's effect and the Q-1b bundling drop rest on no navigation evidence.

**🆕 2026-08-03 — a phone-call interruption was silently deleting real sleep from the record
(v1.252.8).** Owner-reported: last night's recorded bedtime showed 00:59 instead of the real
~22:32 onset. Root-caused with the production admin endpoints (`day-review` + the `claude_ro`
read-only DB access) down to the actual decoded raw BLE beats: a genuine ~130-min sleep bout
22:32–00:42, a 15-min gap during the calls, then a ~6h40m bout from 00:57 — `denseSensingSpan`'s
comparable-length ratio test (`lib/sleep/sensing-span.ts`) dropped the whole first bout because it
was only ~0.33× the second, reading as a later bedtime with implausibly little awake time instead
of an interrupted night. Fixed: a substantial run within ~1h of an already-kept run is now bridged
in regardless of length ratio — a real interruption sits far under the 2h night-split threshold, so
proximity alone rules out a distant evening-activity burst (which the ratio test still correctly
rejects). Verified against the real decoded beats for the 08-03/04 night. See
[`docs/oura-ble-operations.md`](docs/oura-ble-operations.md) §1 row I23. **Not yet done:** last
night's own `sleep_sessions` row still carries the wrong (truncated) `sleep_start` — the fix only
changes future rollups; that specific row needs a targeted Redecode/backfill to correct
retroactively.

**🆕 2026-08-03 — seven owner-reported bugs/features triaged and queued (Q-63…Q-69), none
fixed yet.** Workout skip-confirmation, voice logging dead on the APK, PiP missing the rest
countdown on the exercise-summary screen, guided walk needs a treadmill/no-GPS mode, the scale's
persistent "listening" notification, auto walk/run detection still false-positiving (a real gap
distinct from the already-tracked Hz-band calibration issue), and the scale weight trend should use
the day's lowest confirmed reading instead of the first. Full root causes, decisions and a plan per
item in
[`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md)
and `docs/implementation-backlog.md`. **Renumbered twice** (an original Q-52…Q-58, briefly Q-57…Q-62,
now finally Q-63…Q-69) to resolve two separate collisions: a "per-exercise phase hold" plan already
held Q-52, and the cross-domain bug review below already held Q-53…Q-56 — both landed on `main`
first.

**🆕 2026-08-03 — cross-domain bug review: 5 new findings, all queued (no code changes this
session).** Four review agents (Cache-Control staleness sweep, write-path ownership/offline-sync
mirroring audit, auto-apply/1RM logic deep-dive, production DB integrity checks) plus a direct
production DB audit via the admin read-only endpoint. Full evidence:
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](docs/reviews/2026-08-03-cross-domain-bug-review.md).
Highlights: a real `body_metrics` row dated one day in the future (Q-56, part of a 5-row batch from
2026-07-30 — **all five have now self-healed as those dates arrived; the writer has not been
fixed**, and a root-cause lead is recorded on the backlog entry);
two cache-staleness bugs in the phase-transition/prescription flow (Q-53); a prescription-write
race under concurrent triggers (Q-54); a third unfixed instance of the bodyweight-1RM-as-kg bug
(Q-55, following the v1.252.4 fix). Sync-push mirroring and nutrition data integrity both came back
clean. See the Known-Issues entry below for the full list; queued in
`docs/implementation-backlog.md` as Q-53 through Q-56.

**🆕 2026-08-03 — auto-apply never moved the phase, and a prod audit found four session types stuck
in accumulation since late June.** `generatePrescriptionForSession` set `prescriptionStatus =
'auto_applied'` without ever calling `advancePhase`, and auto-apply was gated on `phaseAction ===
'stay'` so a transition could not qualify anyway. Legs/Push/Upper each carried a pending "move to
intensification" for up to a week while their prescriptions were **already written at
intensification loads** (powerbuilding primaries at 82.5–83% against an 80–87.5% band) — Push had
trained them with the stored phase still saying accumulation. Fixed in v1.252.0: a transition
auto-applies only when the model earned it (`canAutoApplyTransition`), deloads and ceiling-forced
transitions still ask, and an auto-applied transition now carries a deterministic evidence-cited
rationale. See
[`docs/overview/entries/2026-08-03-exercise-deload-scoping.md`](docs/overview/entries/2026-08-03-exercise-deload-scoping.md).

**🆕 2026-08-02 — the roadmap was reviewed against the native endpoint, and the public-repo cut moved
to the front of the queue.** Review:
[`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](docs/reviews/2026-08-02-native-convergence-roadmap-review.md)
(eight findings; the roadmap converges on a native-*data* app on one device, not on a shippable
product — those are about one unwritten stage apart). Plan and top queue item:
[`docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md),
backlog **Q-49**. Three things a future session should not re-derive:
- **The private repo has a running daily cost** — `apk-latest` 404s unauthenticated, so
  `/api/download-apk` plus a PAT is the only distribution path and a second user cannot install.
  That is why the cut jumped the queue; **the Q-1 + Q-30 gates on Q-31/Q-32 are released.**
- **The blocker is model *delivery*, not Phase 3.** SleepNet and `step_counter` run server-side
  (`onnxruntime-node`, `adapter.ts:5006`) behind loaders that return `null` on failure, so
  gitignoring them silently kills the hypnogram and ring steps. Owner chose a build-time fetch.
- **One repo, not two.** Stages 6–7 ship Compose and WebView screens in the same APK.

**Untracked risk worth knowing (Q-48 F2):** after Phase 3 bundles the shell, every UI change becomes
a manual sideload and there is **no OTA path in the repo**. The note calling that low-priority
predates the multi-user answer by a day, and Stage 6 is the highest-UI-churn period the app will
have.

**🆕 2026-08-02 — the "Swift feel" push has a target and an order now.** The owner named where the
app actually feels slow: **the home screen and tab navigation**, not the workout screen. That
retargets both live tracks, because Phase 3's own sizing note says it *"will not make navigation
faster"* and Stage 6 ranked the workout screen first. Owner-approved sequence: **Q-51** (split the
1,414-line home component → prefetch the four tab chunks on idle → **profile cold start on the
S25**) → **Q-49** (public repo) → **Stage 3** (device-primary data) → **measure again and decide**
→ Stage 5 → Phase 3 and Compose only if the profile still shows a gap. **Phase 3 (Q-1) is
measurement-gated, not cancelled** — the architecture rationale stands, the urgency waits on
evidence; do not provision the second Railway `api/` service. One thing worth not re-deriving:
`components/shell/tab-shell.tsx:97` renders `SessionSelectContent` for the **`home`** tab, so
Stage 6's *"session select (1,407)"* **is** the home screen.

**In flight — the "Swift feel" performance push (Q-1, issue #868).** Owner-directed and ongoing.
Post-region-move the network side is exhausted (API calls return in 1–25 ms); every remaining win
has come from **device Performance profiles**, not the Network panel. Shipped so far: cache seeding
(#877), SW icon caching (#881, its cached-document half reverted in #891), `/api/oura/stats` no
longer blocking on Oura Cloud (#885), Health fetching one tab instead of three (#897), screen/tab
transitions + the local-store `getWorkoutHistory` N+1 (#904 — corrected 2026-07-30, this previously
misattributed the citation to #906, which shipped separately as the guided-walk status-bar chip,
v1.243.1), the animated wallpaper made
compositable (#909), animations paused in hidden tab panels (v1.240.3), and Capacitor's bridge no
longer logging (and `JSON.stringify`-ing) every plugin call and result — 16.4% of main-thread self
time (v1.240.4), and screen motion moved from an iOS-style horizontal push to Material 3 shared-axis
Y with back animated for the first time (v1.241.0). **Still open:** Phase 3 (bundling the shell into
the APK), which is the owner's
stated app-native architecture. All of the above are sandbox/Chromium-verified only — the profiles
that found them came from the owner's S25, and only the owner can confirm the numbers moved.
**v1.240.4's config half needs an APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`)
to apply at the source; its runtime half applies to the installed APK on the next Railway deploy.

**Phase 3 detail (updated 2026-08-02):** Task 1 decided (bearer token in native secure storage,
owner-confirmed), Task 2's spike run, Task 2b's auth preconditions written, **Task 4 DECIDED —
option B, two apps in a workspace** (owner-delegated 2026-07-30). Task 3 (move auth client-side,
~21 sites) is ready to implement, sequenced around the workspace split (see below) rather than
strictly before or after it. Both adjacent auth fixes are now done — nothing auth-side blocks
Task 3 anymore. See backlog Q-1, the plan's Task 2b/Task 4, and
[`docs/handoff-phase-3-bundled-shell.md`](docs/handoff-phase-3-bundled-shell.md) (keep until Phase 3
fully lands — carries negative results not recorded elsewhere).

**⚠️ Task 4 Step 3 (the actual `shell/`+`api/` app split) was attempted 2026-07-31 (#952) and broke
production immediately** — the root `build`/`start` scripts deployed `shell/` alone, and its
`/api/*` rewrite fell back to `http://localhost:3001` because the second Railway service for `api/`
was never provisioned, so every API call (including `/api/auth/*`) failed — sign-in broke, site
500'd. Reverted clean within the hour (#962), production confirmed recovered by the owner. **Blocked
on an owner/infra action, not code:** stand up a second Railway service for `api/`, confirm it
serves `/api/**`, and set `API_ORIGIN` in `shell/`'s Railway environment — *before* re-merging. The
branch content itself is already built and tested; nothing needs redoing once the service exists.
Also noted 2026-08-02 (#964): once the split does land, every future shell/UI change becomes a full
APK-rebuild-and-manual-sideload cycle (today's zero-rebuild Railway deploy goes away for the shell)
— there's no OTA/hot-swap path, though the existing in-app update card would keep working as-is.
Not actioned; a low-priority idea if it turns out cheap. See the Phase 3 plan doc's new
"post-split update delivery" note.

**🆕 Open as of 2026-08-02 — the whole Phase-3/Capacitor approach is now in question, not just its
execution.** After watching #952 break production, the owner asked whether Next.js+Capacitor is
even the right architecture at all, given the app is single-user, Android-only (S25 Ultra,
sideloaded, no Play Store, no iOS), and already committed to offline-first — and floated starting
fresh on a new repo if a design change is warranted. This session gave a stress-test-me opinion
(full native rewrite: Kotlin + Jetpack Compose + Room + WorkManager, Postgres/Railway kept only as
a thin sync/AI-proxy backend) but **no decision was made** — see
[`docs/handoff-2026-08-02-platform-offline-architecture-review.md`](docs/handoff-2026-08-02-platform-offline-architecture-review.md)
for the full reasoning and a ready-to-paste research prompt for a follow-up session to
independently validate or refute it. **This is upstream of Phase 3 and the workspace-split infra
blocker above** — worth resolving before spending the owner's Railway-service-provisioning effort
on an architecture that might be abandoned.

**✅ RESOLVED 2026-08-02 — incremental convergence, not a rewrite.** The owner directed working
through to the native destination following the staged order in
[`docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](docs/superpowers/plans/2026-08-02-native-convergence-goal-layout.md),
and answered the three inputs the decision hinged on:

- **All ~38 screens are kept** — the one condition that would have re-opened the rewrite case does
  not hold. The research prompt above was **not run**, and is now moot.
- **Local retention is tiered**, from production measurement: raw BLE frames **14-day rolling**
  (~25,200 rows/day ≈ 3.2 MB/day — uncapped this would be ~1.2 GB/yr), decoded per-minute HR
  **1 year** (~38 MB), daily rollups + all logs **uncapped** (~2 MB/yr). ~85–100 MB total.
- **Device-agnostic source tiers are now a written goal** —
  [`docs/device-agnostic-source-architecture.md`](docs/device-agnostic-source-architecture.md)
  (2026-08-02). The split is **raw-capable sources** (we derive: the ring over BLE) vs **computed
  sources** (the vendor already derived: Health Connect). Health Connect *does* supply full sleep
  stage intervals — verified against the pinned plugin source — so staging and steps for non-Oura
  users are already solved and need no model of ours. Queued as Q-43 (HC first-class tier) and
  Q-44 (remove vendor naming from user-visible copy).
- **Cross-device sync and multi-user are both permanent** — more than one phone over time, plus
  other users with their own accounts. Railway stays a full sync peer and **the ~8,200-line sync
  engine is maintained and extended, not reduced.** (An initial "S25 only" answer was recorded and
  corrected the same day; the proposal to retire peer conflict-resolution is withdrawn.) The D1
  restore-proof check, unrun since #758, is a routine path under multi-device.

Corroborating the call: `@trainingai/shared` (#939/#941) — 348 files, 36,450 lines, 492 importers —
**is live on `main`** and was never reverted; #962 rolled back only #952's `shell/`+`api/` split.
The bulkiest step of the convergence is already done and running in production. **Gate A (Railway
`api/` service) is now the only owner action blocking Stage 2**; Stages 1 and 3 do not depend on it
and Stage 3 (Oura D2 Task 5) is the active work.

**Offline-first consolidation (2026-07-30).** The owner clarified the destination is
device-primary, not just fast: the app works fully offline except AI calls and older/archival data;
Railway keeps the DB for calculated data. This reframes Phase 3 as step one of that migration, not
a latency optimisation. Written up in
[`docs/offline-first-target-architecture.md`](docs/offline-first-target-architecture.md), which also
corrects a near-duplication: a large, already-in-progress effort (**the Oura on-device +
own-analysis program, D0–D7**, owner-directed 2026-07-21, ~40% shipped — see
[`docs/oura-ondevice-hybrid-handover.md`](docs/oura-ondevice-hybrid-handover.md)) already covers the
Oura-BLE-rollup migration a different 2026-07-30 session was about to re-plan from scratch. That
program's one blocking owner action (on-device APK verification, open since 2026-07-27) **passed
2026-07-30** — see the D2 Tasks 2+3 Known-Issues row below — unblocking its next several tasks
(D2 Tasks 4-9). Three other threads sequence against Phase 3 + this program: the Task 4
workspace-split plan (backlog Q-1, new 2026-07-30 — Steps 1 and 2 have merged, moving isomorphic
`lib/` code into `@trainingai/shared`), a Postgres volume fix whose recommended `bytea` migration is
in tension with the Oura program's own D4 decision (backlog Q-30), and a public-GitHub-repo
migration gated on both (backlog Q-31/Q-32). Full picture:
[`docs/handoff-2026-07-30-platform-offline-first-consolidation.md`](docs/handoff-2026-07-30-platform-offline-first-consolidation.md).

**Latest feature:** (v1.246.9) **Scale: faster advertisement detection + speculative
stored-measurement drain.** Final iteration of tonight's scale reliability arc — owner asked to
"fix the advertising and pull old saved data," explicitly authorizing in-session implementation
(no separate planning PR). Full reasoning in `docs/superpowers/plans/2026-07-30-scale-stored-
measurement-drain-and-scan-latency.md`. Two changes: (1) `ScaleBleScanManager`'s passive scan
switched from `SCAN_MODE_LOW_POWER` to `SCAN_MODE_LOW_LATENCY` — the duty-cycled low-power scan
was adding avoidable seconds to detecting the scale's advertisement in the first place, worsening
the exact connect-pipeline-vs-measurement-cycle race identified in v1.246.8; (2) a **speculative**
stored-measurement drain, following a real lead the owner found
(`ronnnnnnnnnnnnn/renpho-escs20m`, a third-party BLE client for this scale family) — its source
independently confirms our own FFE1/FFE2/FFE3 roles and resolves the always-present 11-byte
handshake frame as a display-unit request (`0x12`), and documents a genuine offline-measurement
store (`0x23`-marked records, queried via `0x22`-prefixed commands). Its opcode family doesn't
match our own confirmed `0x13`-prefixed live-measurement request — different firmware generation
— so this is an explicit, owner-authorized bet: `ScaleGattClient` now also sends the guessed query
after the live request and decodes any `0x23`-marked response via a new `parseStoredRecord()`
(`ScaleProtocol.kt`), posting drained records through the *existing* `/api/scale-ble/samples`
route's `measuredAt` field — no server-side changes needed. Written to fail silently: if the guess
is wrong, no stored records ever decode and the live-weigh-in flow is completely unaffected.
**Not yet verified on-device** on either count — needs the owner to rebuild and report whether
detection feels faster, and whether any `0x23`-marked frame ever actually arrives.

**Previous feature:** (v1.246.8) **Scale: failure notification + one more retry, informed by a
reframed root-cause theory.** After v1.246.7's re-arm fix was device-verified (see Previous
Feature), the owner's actual test procedure surfaced a better explanation for the underlying
stalls than "notify-subscribe sometimes silently fails": across every capture so far, the scale's
11-byte handshake frame has arrived **100% of the time**, on every attempt, success or failure —
meaning the subscribe was never actually the flaky part. What varies is whether a real reading
follows it, and the owner's procedure (step on → wait for the scale's own display to say
"complete" → check the phone → nothing yet → step on again → that's when it worked) points at a
race: the scale's own local measurement cycle finishes faster than the phone's full BLE pipeline
(scan-detect → connect → discover services → subscribe → write the request), so by the time the
app is ready to ask for a reading, the person has often already stepped off and there's nothing new
to send. Two changes land from this, both in `ScaleBleService.kt`: (1) `notifyWeighInFailed()` — a
new low-priority notification ("Weigh-in not captured — step on the scale again") fires when a wake
gives up after all attempts, closing a real silent-failure gap (previously the "Retrying…"
foreground notification just disappeared with no lasting trace either way); (2) `MAX_ATTEMPTS`
bumped 2→3 and the retry notification text changed to "Retrying — stay on the scale…", giving one
more bounded (~8-30s) cycle and clearer guidance to catch a delayed re-engagement, at the cost of a
longer worst-case wake before giving up. **Not yet verified on-device.** Still open and
unaddressed: the `connectionStateChange status=19` mid-measurement disconnect (a separate failure
mode, not yet investigated — no grounded theory yet), and whether the race theory itself should
lead to UI guidance change (e.g. "stay on the scale a few seconds after it beeps") rather than just
service-level tuning.

**Previous feature:** (v1.246.7) **Scale: re-arm the early-data watchdog on the handshake frame.**
Device-verified 2026-07-30 — see the Known-Issues entry for the full before/after evidence.

**Previous feature:** (v1.246.6) **Scale: early-data watchdog for a stalled first connection.**
Owner rebuilt v1.243.2 and, via `chrome://inspect`, found a third scale bug: the very first
connection of a fresh app session could reach `state=waiting` (measurement requested successfully)
and then receive **zero** `FFE1` notifications — not even an unstable packet — for the entire 30s
timeout, while the owner stood on the scale the whole time (confirmed by the scale's own on-device
countdown). The very next connection attempt in the same session worked immediately. Root cause
theory (code-inspection only, matches this codebase's existing documented Samsung-BLE-stack
flakiness for the Oura ring): `ScaleGattClient.onDescriptorWrite` never verified the `FFE1` CCCD
(notify-subscribe) write actually succeeded before proceeding to request a measurement — if that
subscribe silently doesn't take on a fresh GATT session, the scale still accepts the measurement
request but the phone never receives any of its notifications. **Not a regression from #929/#937**
— `ScaleGattClient.kt`'s connection logic hasn't changed since the original integration (#848);
what changed is connection *frequency*: pre-#929, stale-scan replays triggered a real
`connectGatt()` every ~3 minutes continuously, incidentally keeping the BLE stack warm and masking
this cold-first-connection case. #929 correctly stopped those spurious wakes, so a true first
connection (idle period or app restart) is now the normal case again, exposing a quirk that was
always there. Added a bounded early-data watchdog
(`EARLY_DATA_TIMEOUT_MS`, 8s) started alongside the existing 30s weigh-in timeout: if literally no
`FFE1` notification (not even one that fails to parse) arrives within 8s of the request, treat it as
a failed subscribe and close+let `ScaleBleService`'s existing retry policy reconnect with a fresh
GATT session, rather than sitting out the full 30s for a wake that was never going to produce data.
**Not yet verified on-device** — this is a theory from log inspection, not a confirmed root cause;
needs the owner to rebuild and confirm the first-connection-after-reload case now recovers within
~8-16s instead of failing silently for 30s+. **Update (2026-07-30): owner rebuilt and re-tested —
did not fix it,** same full-30s zero-visible-notification timeout twice in a row on the correctly
rebuilt binary. See the Known-Issues entry below for the follow-up theory (a swallowed
handshake/malformed frame can retire the watchdog silently) and the diagnostic-logging-only
follow-up branch (`fix/scale-ble-handshake-frame-watchdog-log`) that's not yet a real fix.
**Second update (2026-07-30): device-verified fixed.** The diagnostic logging confirmed the theory
(the scale sends a consistent 11-byte handshake frame before any real reading, and it was silently
retiring the watchdog for good); `fix/scale-ble-rearm-watchdog-on-handshake-frame` (v1.246.7)
re-arms it instead, and the owner's rebuild caught it firing correctly on-device — a stalled
connection now bails with `"no data within 8s of request…"` instead of the old 30s timeout. See the
Known-Issues entry below for the full before/after evidence.

**Previous feature:** (v1.246.5) **AI-adaptive workout UI: real phase labels + no more prescription-card
pop-in.** Two owner-reported bugs, both traced to `ai_dynamic` programs' phase status being
constructed with hardcoded `cycleInPhase: 1, totalPhaseCycles: 1` (since these programs have no
fixed cycle count) — every render site showed a meaningless "Cycle 1/1". Added `openEnded`/
`phaseSessionNumber` to `PhaseStatus` (`lib/workout/session-data.ts`) and updated all four render
sites (pre-workout header + deload banner, active-workout header, workout-select, the
recommendation card's progress section) to show "Phase · Session N" instead when `openEnded` is
set — non-AI automatic programs are unaffected. Separately, the pre-workout AI-prescription card's
cache-seeding infrastructure (`readCacheSync` in `workout-screen.tsx`) already existed, but the
render gate in `pre-workout-screen.tsx` hid the card whenever `periodizationLoading` was true —
even with a valid cache seed already painted into state — so the card always popped in ~2s after
open regardless. Now renders the moment `periodization` is set; the loading skeleton only shows on
a genuine cold start with no cache seed yet.

**Previous feature:** (v1.246.4) **Heart-rate strap pairing card shows a live connection status.**
Owner-requested follow-up to the H10 integration: the card showed only the device name +
battery/firmware, which read as "permanently connected" when the app only holds a BLE link during
workouts, and an unclipped H10 powers off entirely. `ChestStrapSource.linkStatus()` +
`getChestStrapLinkStatus()` expose the raw GATT truth (`gattConnected`/`worn`/`active`) — separate
from the worn-gated `connectionState()` the live-HR manager uses, which would misreport a
linked-but-unworn strap as "not connected". The card polls it at 1 Hz while mounted and shows one of
four states with a paired colour+label (no colour-only state): Not connected / Connecting /
Connected · on your chest / Connected · no chest contact (ring takes over). Extended to also report
correctly in native foreground-service mode (`nativeState === 'ready'`), which didn't exist when
this was first written. ⚠️ Not verified on device.

**Previous feature:** (v1.246.2) **Deactivating a user now takes effect within ~24h, not up to 7 days.**
`auth.ts`'s jwt callback re-reads `isActive` from the DB (`lib/auth/is-active-refresh.ts`),
throttled to once per 24h per user — bounds the staleness window rather than closing it fully
(owner's choice; a continuously-active user is never signed out or re-prompted). See Known Issues
for the full writeup. ⚠️ The 24h flip itself was not observed end-to-end.

**Previous feature:** (v1.243.2) **Scale: shorter cooldown, plain-success notification.** Follow-up
to v1.242.4's stale-scan-result fix. Owner rebuilt and confirmed the endless-loop bug is gone, but
a live `chrome://inspect` test surfaced a real (much smaller) side effect of v1.242.0's cooldown:
after a real weigh-in, the scale genuinely (not stale-filtered) keeps re-advertising for a short
post-use settling period, triggering a bounded 2-attempt retry cycle that then gives up and starts
the cooldown — and the owner's deliberate second weigh-in ~2 minutes later landed inside that
2-minute cooldown window and was silently missed. `GIVE_UP_COOLDOWN_MS` cut from 120s to 20s
(`ScaleBleService.kt`) — a real weigh-in always succeeds on its first attempt in ~1-5s, so a short
cooldown costs nothing for the genuine case; worst case with it too short is one or two extra
bounded (~1 minute max, self-terminating either way) retry cycles while the scale settles. Also
added `notifyWeighInLogged()`: a plain successful weigh-in previously produced no lasting
confirmation at all (the transient "syncing…" notification just vanished) — now shows "X.X kg
logged" (or "— additional reading today" for a same-day non-trend reading), same one-shot/low
priority pattern as the existing pending/composition-skipped notifications. **Not yet verified
on-device** — needs the owner to rebuild and re-run the same back-to-back-weigh-in test to confirm
the second reading is no longer missed, and confirm the new notification actually shows.

**Previous feature:** (v1.243.1) **Guided walk — Android status-bar pill for phase + countdown.**
Phase D of the guided-walk uplift plan, the last item from the owner's original screenshot report.
Reuses the existing `AndroidRunChip` native bridge (already built for the prescribed-duration
running chip) rather than adding a new Kotlin plugin — its "duration" mode already counts down to a
target instant and flips to count-up past it, which is exactly a walk phase's countdown. The screen
re-anchors the chip on every phase change with the phase name as the label ("Fast — set N of M",
"Warm up", etc). Reused the existing `ta_pref_run_chip` toggle (relabeled "Run/Walk in Status Bar")
instead of adding a third chip preference. Per-phase color was investigated and NOT built — no
color hook exists in the reused bridge, and the phase name already satisfies the no-color-only-state
rule. ⚠️ Not verified on device — see Known Issues.

**Previous feature:** (v1.242.4) **Scale background-sync retry storm — second, deeper root cause
found and fixed.** The v1.242.0 cooldown fix looked confirmed via a `chrome://inspect` capture
(real weigh-in succeeded, a repeat scan match was suppressed, the cooldown suppressed the next
wake) — but the same "connecting…"/"Retrying…" cycle kept recurring indefinitely on a steady ~3
minute cadence, hours later, with nobody near the scale. Testing with an independent BLE scanner
(nRF Connect) proved the scale itself only advertises while someone is actually stepping on it —
disproving this entry's own earlier "motion-sensor wake" theory. The real cause: Android's
`PendingIntent`-based BLE scan can redeliver a stale `ScanResult` well after the real advertisement
stopped, and `ScaleScanReceiver` trusted "the broadcast fired" alone as proof of a live weigh-in,
never checking when the match was actually seen. Fixed by reading each result's own
`ScanResult.timestampNanos` out of the intent extras and discarding the broadcast unless at least
one result is within 5 seconds old. **Not yet verified on-device** — needs another owner rebuild
and confirmation the spurious wakes actually stop this time; see Known Issues below for the full
misdiagnosis-then-fix writeup.

**Previous feature:** (v1.242.2) **Backlog audit + a batch of small real bugs fixed; offline
meal-type mirror.** A source-verified audit of `docs/implementation-backlog.md` (trimmed
~3,050 → ~380 lines) surfaced ten small, independent, genuinely-live bugs, all fixed and merged
in #922: the Intervals running goal was silently using the wrong zone-target split
(`norwegian-4x4` had no `ZONE_WEIGHTS` entry); an abandoned activity session's elapsed timer
could run away indefinitely on rehydrate (owner-reported: 25,723 minutes on a 0.51 km route),
now capped at 12h; the offline activity-log card dropped 9 display fields for a pending-sync
activity; a BLE HR-series rollup bin-key collision could silently merge two different-width
averages; a gait-confirm streak with no gap check could backdate a walk to windows that weren't
actually consecutive; guided-activity pace mixed two different clocks; the manual food-entry
route was missing the Atwater cross-check the AI-scan path already had; the step orchestrator's
auto-post had no retry and misreported failed posts as successful; `/api/oura/sync` could write
a phantom day row once the Cloud API went frozen; and three exercise names two prior migrations
merged away (Q-26) stayed selectable in every picker (migration 165 adds `merged_into`). Also
added a read-only `meal_types` local-SQLite mirror (v21) so an offline food log groups under a
real name/emoji even after the generic response cache expires — editing stays online-only.

**Previous feature:** (v1.242.0) **Scale background-sync retry storm fixed; new Body Composition
card.** Owner reported the on-device passive-scan rework (v1.238.0) got stuck alternating
"connecting…"/"Retrying…" for ~30 minutes with the scale untouched — an on-device log
(`ScaleScanReceiver` fired 37×, ~every 20-90s) confirmed the scale itself was periodically
re-advertising (likely waking on ambient vibration, not a real weigh-in) with no OS Bluetooth
bond and no competing app involved. Root cause in `ScaleBleService.kt`: `onFailure` nulls
`client` before the 8s scheduled retry fires, so any scan match arriving in that gap (or during
the 30s `WEIGH_IN_TIMEOUT_MS` wait) looked like a brand-new wake and reset `attempts` to 0,
bypassing `MAX_ATTEMPTS` indefinitely as long as the scale kept re-advertising. Fixed with a
`cycleActive` guard covering the whole wake episode (not just while a GATT client object exists)
plus a 2-minute cooldown (`GIVE_UP_COOLDOWN_MS`, companion-object state) after giving up — a real
weigh-in still succeeds on its first attempt (stable reading in ~1-5s), so this costs nothing for
the genuine case. Also wired `scaleLog`/`scaleStatus` native events to `console.info` in
`capacitor-native-init.tsx` (JS-only, no rebuild) so a recurrence is debuggable live via
`chrome://inspect` instead of scavenging `adb logcat` for lines that were never actually logged
there. Separately, added a **Body Composition** card to Health > Body: the scale ingest path
already computed and stored 10 BIA fields (skeletal muscle %, fat-free mass, muscle/bone mass,
body water %, subcutaneous fat %, visceral fat index, protein %, BMR, metabolic age) but nothing
in the UI ever surfaced them beyond weight/body-fat — extended `/api/body-metadata`'s
`BodyMetaRow` (reusing the existing `repo.listBodyMetrics` call, no new endpoint) and added the
card next to `bodyWeight`/`bodyFat`/`leanMass`, visible only once a user has a scale reading.
**The cooldown fix is confirmed on-device** (2026-07-30, post-rebuild `chrome://inspect` capture —
see Known Issues below for the log sequence); the Body Composition card is JS/API-only and
auto-deploys, not yet separately confirmed rendering real data on-screen.

**Previous feature:** (v1.240.0) **Guided walk — recorded per-segment stats, HR-zone map, fast/slow
averages.** Owner-directed: the walk-complete screen's per-interval numbers were ephemeral (thrown
away on save) and there was no way to compare a walk's fast/slow blocks against each other over
time. A new `activity_logs.segments` column (mirrors the existing `paceSeries`/`elevationProfile`
JSONB-array pattern, migration 161) now records every segment's HR/pace/distance/cadence — the
same granularity a lift's `set_logs` get per set — threaded through the full stack (schema,
validation, adapter, local SQLite, `RECONCILE_COLUMNS`). The walk-complete screen gained an
HR-zone-colored route map (reusing the #878 helper) and "Fast avg"/"Slow avg" cards. ⚠️ Not
verified on device — see Known Issues. Owner request, no separate plan doc (small enough relative
to the shipped GPS/pace work it extends).

**Previous feature:** (v1.238.0) **Scale background sync reworked from a continuous poll to a
passive BLE scan — no more permanent "Watching for scale…" notification.** Follow-up to the
owner's on-device feedback: the old design ran `ScaleBleService` continuously with a 45s retry
loop and an always-visible foreground-service notification, for a scale used ~10s/day. Replaced
with `ScaleBleScanManager`, a `BluetoothLeScanner.startScan(..., PendingIntent)` registration
(filtered on the FFE0 service UUID — the same filter `scale-pairing.tsx`'s pairing flow already
uses and has proven correct on real hardware) that survives the app process being killed with no
ongoing notification cost. `ScaleScanReceiver` fires only when the scale actually starts
advertising and starts `ScaleBleService` for a bounded 2-attempt connect (`MAX_ATTEMPTS`) that
stops itself once resolved — `stopSelf()` moved to the end of the actual network POST (not a
fixed timer) so a slow request can't race the service's own teardown. `ScaleBootReceiver` re-arms
the scan after a reboot (scan registrations don't survive that, unlike SharedPreferences); unlike
`OuraBootReceiver` this isn't subject to the BOOT_COMPLETED foreground-service-start restriction,
since registering a scan isn't starting one. `ScaleGattClient`/`ScaleProtocol` (the actual
connect/decode logic) are untouched. **Not verified on-device** — this is the first
PendingIntent-scan pattern in this codebase (every other native BLE piece here holds a continuous
connection instead), so it needs a real on-device check before being trusted; flagged in Known
Issues below alongside the still-open two-phone scenario.

**Previous feature:** (v1.237.0) **Multiple scale weigh-ins per day — first reading sets the trend,
later ones are recorded alongside it.** Owner feedback on the same session as the socks-composition
fix below: they want to just step on the scale whenever, morning and night, without the second
reading clobbering the first. `body_metrics` is a one-row-per-day table used everywhere (trend
charts, AI insights), so the fix is at the write path, not the schema: `hasConfirmedScaleTrendForDate`
(`lib/data/repository.ts`/`adapter.ts`) checks whether today already has a scale-sourced weight
before `/api/scale-ble/samples` (and the pending-confirm route) calls `upsertBodyMetrics` — the
day's first confirmed reading always wins the trend value (fasted-morning-weigh-in convention),
and every reading after that is skipped for `body_metrics` but still fully archived in
`scale_raw_samples` (which already stored every past reading with full composition, unaffected).
A new `GET /api/scale-ble/today` surfaces the day's readings, and `scale-pairing.tsx` shows them
in a "Today's weigh-ins" list with the trend entry marked. 5 new DB-backed tests cover the
gating logic and the local-timezone day-boundary case (a reading at 11pm-AEST-previous-day must
not count as "today"). Fully sandbox-verified via `curl` (see the entry) — no native surface.

**Previous feature:** (v1.236.0) **Fix: a no-skin-contact scale reading no longer corrupts body
composition.** Follow-up to the direct-BLE Renpho scale integration's first real on-device use —
the owner weighed in wearing socks, which broke the foot-plate contact BIA needs; the scale
reported impedance as `0` rather than omitting the packet, and dividing by that zero floored the
body-fat estimate at its 3% clamp along with every other composition field (skeletal muscle,
water%, protein%, BMR, metabolic age all garbage in the same write). Confirmed via the read-only
production audit endpoint against the owner's actual `scale_raw_samples`/`body_metrics` rows
before fixing. `hasValidImpedance()` / `MIN_VALID_IMPEDANCE_OHMS` (`lib/scale-ble/composition.ts`)
now rejects an implausibly-low impedance reading before the formula runs; the weight itself (a
load-cell reading, contact-independent) still saves, composition fields are left untouched rather
than overwritten with a wrong number, and `ScaleBleService.kt` fires a one-shot low-priority
notification explaining why composition wasn't updated. Verified live against the local dev server
using the owner's actual captured socks-reading bytes (confirms `compositionSkipped: true`, weight
saves, composition columns stay null) and a real bare-foot reading (confirms the normal path is
unaffected). See the Known Issues entry below for the fuller incident writeup and the still-open
background-sync-notification design question raised in the same conversation.

**Previous feature:** (v1.235.0) **Exercise Readiness rework.** The pre-session check-in now shows the
body map beside the sore-muscle pills, auto-marks any muscle still recovering from recent training
(**"sore" now means "not recovered"** — it uses the recovery curve, not a flat clock, so a hard leg
day still counts at 47 h while a light one doesn't),
drops the two Issues that duplicated other sections, makes **Sick/Unwell** actually do something
(recommends rest; deloads the session if you train anyway — it was stored and never read by the
engine), and adds a **Time Constraints** section: Quick / Normal / Long at the session's own budget
**±30** rather than fixed 30/90 clocks. It shares the stored prescription with the pre-workout picker
so the two can't disagree. Two bugs surfaced while verifying in a real browser: the duration control
was clobbered by its own late-resolving fetch, and dropped exercises escaped the per-role set cap
(storing an accessory at 5 sets against a ceiling of 4).

**Previous feature:** (v1.234.0) **Guided walk — HR chart with fast/slow phase shading.** The
walk summary's per-interval bpm list gets a visual companion: a heart-rate line chart with a
translucent background band per fast/slow segment, via a small custom chart.js plugin (no new
dependency). Extends the existing `ActivityHrChart` with an optional prop rather than forking a
second chart component. Plan: `docs/superpowers/plans/2026-07-23-guided-walk-uplift.md` (Phase C).

**Previous feature:** (v1.233.0) **Guided walk — live GPS, pace-primary UI, recorded per-phase
stats.** The interval walk's mid-exercise screen was missing a live map/speed/HR-zone breakdown,
and fast/slow segments had no real metrics to compare against each other — both owner-reported
gaps. Ships live GPS point tracking + route map (mirroring the regular activity flow's pattern),
pace becomes the headline live stat once a GPS fix exists (HR demoted to secondary — HR drifts
set-over-set on a walk and doesn't cleanly separate fast/slow, pace is the real signal), and route
polyline/splits/pace-series/elevation/per-phase avg pace are now actually saved on finish
(previously hardcoded `null` on every walk). ⚠️ **Not yet device-verified** — see Known Issues:
only the browser `navigator.geolocation` web-fallback path was exercised (via Playwright with
mocked location), not the native `BackgroundGeolocation` plugin. Plan:
`docs/superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md`.

**Previous feature:** (v1.232.0) **Role ordering — the main lift is the hardest-worked movement again.**
A production audit of every live prescription found one unambiguous inversion: Upper prescribed
**Skull Crusher 5×7 @77.5 %** against **Incline Bench 4×7 @76 %** — an accessory beating the primary
on both load *and* volume. Two independent gaps: the "never out-load the anchor" rule was applied
against the primary's *zone ceiling* (80 %) rather than its *prescribed* pct (76 %), so at 77.5 %
nothing bound; and `SET_CEILING` was reached only via `expandToBudget`, i.e. only on the `long`
preset, so a standard session's set counts were unbounded. Per the owner's decision the two axes now
behave differently — **load order is absolute** (nothing out-loads the anchor, no exception) while
**set order yields to weekly need** (a muscle below its weekly target may carry extra sets), because
a lagging muscle is corrected with volume, never a heavier bar. Verified end-to-end against a real
generated prescription on the dev server. Plan:
`docs/superpowers/plans/2026-07-28-role-ordering-plausibility.md`.

**Previous feature:** (v1.230.0) **AI workout prescription — full review + six fixes.** A read-only
production audit of the pipeline found the AI driving load on only **1 of 5 sessions**: a pending
`transition_recommended` discarded its own sets/reps/pct, and three of the four affected sessions
carried a self-contradictory "transition" to the phase already in progress, which reset
`sessions_in_phase` on acceptance so the block could never complete. Separately the duration model
charged rest for `sets − 1` — production shows per-set rest and inter-exercise gaps are distinct
clocks, so it under-estimated by ~7-8 min per five-exercise session and **10 of the last 20 workouts
ran past their 60-minute budget**. Both fixed, plus: a soreness check-in now actually reaches today's
plan (it was blocked by a 6-hour cache *and* by a once-per-day stamp set by the first read of the
day), model-authored sets floor at 2 (four single-set exercises were live), and a **Short / Standard
/ Long session-length picker** — a short session drops the exercises furthest ahead of their weekly
target rather than cutting everything to two token sets; a long one adds work where you're furthest
behind, bounded by MRV. Two pre-existing bugs surfaced en route: the periodization GET's 60s HTTP
cache answered *every* post-write refetch (accept/dismiss/transition/poll) with pre-write state, and
`/prescribe`'s 10/hour limit predated user-initiated generation. Done screen's six uncached fetches
are now cache-seeded, and HR recovery reports per exercise instead of per set. Plan:
`docs/superpowers/plans/2026-07-28-ai-prescription-review.md`.

**Previous feature:** (v1.229.3) **Stop escalating the Oura ring's live-HR loop during a workout when
the chest strap is already connected.** Follow-up to the same session's chest-strap bug-fix batch —
while investigating how HR source precedence works, found that `lib/live-hr/manager.ts`'s `wants()`
started the ring (`CONNECTED_LIVE` + the 10 s DHR burst) unconditionally whenever a workout was
active, regardless of whether the strap was already connected and covering. The strap already wins
read-path precedence (`activeSourceId()`), so the ring's beats were never even surfaced — pure
battery waste, and a direct contradiction of the original always-on-chest-strap plan's stated Goal
3 ("no new drain on the ring"), which was never actually wired up. `wants()` now also checks
`activeSourceId() !== 'chest_strap'` for non-ambient sources; since there's no push notification
for a source's `connectionState()` changing (BLE connects happen deep in native code), a 10 s
periodic re-check runs for the duration of a workout so a strap that connects, disconnects, or
gets taken off mid-workout escalates/de-escalates the ring without any caller needing to re-call
`start()`. Two of the five existing manager tests asserted the OLD behaviour (ring always
escalates) and were rewritten to match the new intended behaviour, plus three new tests covering
the gating and the periodic re-check (including that the timer actually stops on `stop()`). Every
other live-HR consumer (`useLiveHr`, the walk/fitness-test/run screens) only reads the resolved
`bpm`/`live`/`stale` output and is unaffected. **Not verified on-device** — this only changes when
the ring's native BLE burst loop fires, which cannot be observed in the sandbox; needs an owner
smoke test (start a workout with the strap connected, confirm ring battery doesn't move) on the
S25. Entry:
[`docs/overview/entries/2026-07-28-ring-deescalation-when-strap-covers.md`](docs/overview/entries/2026-07-28-ring-deescalation-when-strap-covers.md).

**Previous feature:** (v1.229.0) **Direct-BLE Renpho ES-20M scale integration.** Pairs the owner's
Renpho scale directly over Bluetooth from Profile settings — bypasses Health Connect entirely,
which structurally can't carry 5 of the scale's metrics (Skeletal Muscle %, Subcutaneous Fat %,
Visceral Fat, Protein %, Metabolic Age have no Health Connect record type at all). Protocol was
pinned from a real on-device capture against the owner's actual scale (nRF Connect, Phase 0 —
`docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`), not memory or generic docs: GATT
service `0xFFE0`, notify on `FFE1`, request command on `FFE3`, verified byte layout + a checksum
formula cross-checked against 4 independent real weigh-ins. A native Kotlin foreground service
(`android/.../scale/`, mirrors `PolarStrapService`'s shape) periodically attempts a connection
since the scale sleeps except when stepped on; on a stable reading it POSTs to
`/api/scale-ble/samples` using the same shared-session-cookie mechanism the Polar chest strap
already uses. New `body_metrics` columns (migration 157 — 145, 153 and 155 were already taken by
other PRs on `main` by the time this merged) hold the 10 previously-unreachable fields, computed by a
documented generic BIA formula (`lib/scale-ble/composition.ts` — explicitly NOT Renpho's own
proprietary algorithm, which is unpublished). **Multi-user safety net:** the owner's partner also
uses this scale, so a reading more than 15% off the account's last confirmed weight is staged as
`pending` (a local notification + Confirm/Dismiss in Settings) instead of auto-saved — verified
end-to-end against the local dev DB (confirmed/pending/dismiss/confirm all smoke-tested with
curl). Background sync is opt-in (off by default) so a user without this scale pays no
battery/notification cost. ⚠️ **Not yet device-verified** — see Known Issues: the entire native
Kotlin layer (BLE connect/handshake/decode, the foreground service, the background notification)
cannot be exercised in the sandbox (no Android SDK, Gradle proxy-blocked, no Bluetooth hardware)
and needs an owner APK rebuild + on-device smoke test before this is fully trusted. Entry:
[`docs/overview/entries/2026-07-27-renpho-ble-scale-integration.md`](docs/overview/entries/2026-07-27-renpho-ble-scale-integration.md).

**Previous feature:** (v1.228.2) **Skip the "all sets logged, tap Complete" screen — go straight to
the exercise summary, with the rest countdown moved onto it.** Owner-reported: after the last set,
the old rest-ring screen's only action was "Complete →", which got reflexively spam-tapped while
just trying to rest. `handleLogCurrentSet` (`components/workout-screen.tsx`) now auto-finalizes the
exercise (calling the same logic the "Complete →" button used) the instant the truly-last set is
logged — no superset handoff, no buffered exercise pending. The rest countdown itself moved to a
new leaf component, `LastSetRestTimer` (`components/workout/last-set-rest-timer.tsx`), rendered at
the top of the exercise-summary screen; `lastSetRestStartMs` now survives the transition into
`exercise-summary` mode (previously nulled immediately) and is cleared once `advance()` actually
leaves the screen, so it can't bleed a stale countdown into the next exercise's own ready screen.
The old rest-ring + "Complete →" screen in `active-workout-screen.tsx` is left in place as a
fallback (unreachable in the new flow, but protects any already-in-flight/rehydrated session stuck
in that old state). **Verified end-to-end in the sandbox** — not just read-through: drove a full
exercise (3 sets) through a real browser session against the local dev server, confirmed the
summary screen appears immediately with no intermediate screen, the ring visibly ticks down
(90s → 87s over 3 real seconds), and tapping "Next Exercise" clears it cleanly with no stale
countdown on exercise 2's ready screen. Superset/buffered-exercise handoff paths were verified by
code review only (the seeded local program has no supersets to drive through). Entry:
[`docs/overview/entries/2026-07-28-exercise-summary-rest-timer.md`](docs/overview/entries/2026-07-28-exercise-summary-rest-timer.md).

**Previous feature:** (v1.228.0) **Intervals goal (Norwegian 4×4) — cardio batch, last item in the
running-system backlog sweep.** A fifth selectable running-plan goal, running the well-known 4×4-
minute high-intensity interval protocol (capped at 2 sessions/week, easy/long fill otherwise). Pure
TypeScript — the prescription engine's swappable `RunFramework` interface was explicitly built for
this exact extension and had never been used until now. Fully verified in the sandbox (unit tests +
end-to-end Playwright + `psql` confirmation), no device-only surface. Entry:
[`docs/overview/entries/2026-07-27-cardio-intervals-goal.md`](docs/overview/entries/2026-07-27-cardio-intervals-goal.md).

**Previous feature:** (v1.227.2) **Run status-bar chip — cardio batch.** Live runs now show their
actual goal's progress in the Android status-bar pill: distance-so-far/target for a distance-goal
run, time-remaining for a duration-goal run, or a plain elapsed clock for a freeform run — reusing
the same native chip mechanism the lifting rest timer already has. Toggle from Profile →
Preferences → Run in Status Bar. **Not verified on-device** — the native chip itself (the entire
payoff) cannot be exercised in the web/dev sandbox; needs an owner APK rebuild + smoke test. See the
Known Issues row below. Entry:
[`docs/overview/entries/2026-07-27-cardio-run-status-chip.md`](docs/overview/entries/2026-07-27-cardio-run-status-chip.md).

**Previous feature:** (v1.227.1) **Max-HR resolver consolidation.** Max HR was resolved three
different ways that could silently disagree; `resolveHrProfile` is now the only resolver, with
every observed value corroborated through `computeObservedHr` so a single motion artefact can no
longer become a permanent target ceiling. **Not verified on-device** — the guided-walk and
fitness-test target screens weren't run on the S25. See the Known Issues row below.

**Previous feature:** (v1.226.2) **Bug-fix batch: chest-strap notification spam + battery, wrong
"weekly step goal met" claim, premature "day in review" banner.** See the session journal entry
for details. See the Known Issues row above for the chest-strap piece's device-verification status.

**Previous:** (v1.225.0) **Elevation profile chart — cardio batch, last item in the running-
system backlog sweep.** GPS activities (mainly runs) with elevation data now show an
elevation-vs-distance chart on the activity detail sheet, next to the existing pace-per-km bar
chart. New `computeElevationProfile` (distance-bucketed, mirrors `computePaceSeries`'s bucketing
shape) plus a new `ActivityLog.elevationProfile` field threaded through the full stack — DB column,
validation, adapter, `activity-store.ts`'s `finish()`, all `done-activity-screen.tsx` save paths,
and the offline sync chain. **Not verified on-device** — the local-SQLite write→sync→pull path and
real GPS elevation data were both only exercised via a manually-seeded row in the sandbox. Entry:
[`docs/overview/entries/2026-07-27-cardio-elevation-profile.md`](docs/overview/entries/2026-07-27-cardio-elevation-profile.md).

**Previous feature:** (v1.222.0) **Dedicated run execution screen — cardio batch.** Runs get their
own live tracking screen (`RunActiveScreen`) instead of the generic activity screen: a live HR +
zone hero (the first place `lib/live-hr/` is wired into the activity flow, not just the workout
screen), splits-so-far and elevation-so-far, a live map, and cadence — and if today's run has a
prescription, the hero shows whether the current zone is on target. No new stored data, no new API
route. **Not verified on-device** — live HR needs a real strap/ring. Entry:
[`docs/overview/entries/2026-07-27-cardio-run-execution-screen.md`](docs/overview/entries/2026-07-27-cardio-run-execution-screen.md).

**Also recently:** (v1.220.1) **D5 — own daytime-HRV.** Replaces Oura's `dhrv_imputation` ONNX
model with a per-user linear regression (`ln(rmssd) = a + b·hr + c·temp`, closed-form OLS) fit from
this user's own **night-time** `0x5d` HRV events — the ring only streams real daytime HRV ~7% of
waking hours (verified on-device 2026-07-16), so direct measurement isn't viable, but night-time
`0x5d` is dense and real. MET is deliberately NOT a fit feature (near-zero night-time variance to
learn from) — it's an evaluation-time gate instead: a bucket above `MET_ACTIVE_THRESHOLD` scores
null rather than mis-extrapolating from a resting-only fit. Built with **zero knowledge of dHRV's
actual output** (observe-never-feed, per the master plan) — Oura's ONNX path stays golden-tested
and importable but is no longer called from production. Refit is throttled (24h) and runs from the
existing server-side raw-sample aggregation pass, never on `body-battery`'s live request path
(just a coefficient lookup + closed-form eval there). New **Admin → Oura BLE → Comparison harness
→ own daytime-HRV vs Polar H10** console (D6's harness, second adapter registered) is the real
validation gate. This is the master plan's **D6 → D5 → D2** sequencing — D5 unblocks D2 (native
raw store + on-device rollup) next. ⚠️ **Cold-start**: the model needs a few days of real overnight
ring wear post-merge before it produces anything (same "not enough data" outcome as before); **not
yet device-verified** — no real H10 spot-check has been run on this console. See Known Issues.
Entry: [`docs/overview/entries/2026-07-27-d5-own-daytime-hrv.md`](docs/overview/entries/2026-07-27-d5-own-daytime-hrv.md).

**Also recently:** (v1.220.0) **Naps no longer drag down your sleep quality trend or your weekly
recap's average sleep score.** A 20-minute afternoon doze was being scored as if it were a night's
sleep in those two places, which also fed the AI's view of how you'd been sleeping when it planned
your sessions. New in Admin → Day Review: your Sleep Score for each night next to the rating you
gave it the next morning.

**Also recently:** (v1.217.1) **Naps no longer overwrite nights.** The original "my sleep score doesn't
match how I slept" bug — F-1/Q-1/Q-18 — is closed; see Known Issues. One shared module now decides
which sleep was the night, by circadian position (with a length override so non-nocturnal sleep still
counts) rather than by whichever row ended last, and reassembles a night broken by a wake-up. Entry:
[`docs/overview/entries/2026-07-27-night-selection-f1-q1-q18.md`](docs/overview/entries/2026-07-27-night-selection-f1-q1-q18.md).

**Previous feature:** (v1.218.0) **Baseline anchors + push sessions — cardio batch, density-progression
item (split plan 2 of 2).** A new `running_baselines` table freezes a fitness/pace snapshot (VO2max,
HR profile, easy pace) at the moment a running plan is created. Every 5th completed session in a
plan is now a derived "push" session (`isPushSession`, `lib/running/push-sessions.ts`): the
prescription's distance target bumps 2% past the best same-environment outdoor run completed so far
in the block, with an explicit "beat your best" rationale and a "PUSH" badge on the running card.
Environment tagging (`inferEnvironment`) is purely derived from whether a run has a GPS route, so a
treadmill result never corrupts an outdoor comparison — nothing new is stored beyond the anchor
table itself, per the "derive, or reconcile on read" rule. **Not verified:** a real 5-session push
cadence over genuine calendar time (checked via seeded DB rows instead) or on-device. Completes the
density-progression backlog item (both split plans now shipped). Entry:
[`docs/overview/entries/2026-07-27-feat-cardio-baseline-anchors.md`](docs/overview/entries/2026-07-27-feat-cardio-baseline-anchors.md).

**Previous feature:** (v1.217.0) **Density-progression running framework + two prescription bug
fixes.** Running plans can now hold their session time fixed (20/30/45/60 min) and grow the distance
target ~3%/week instead of growing the time itself. Also fixed two pre-existing bugs that silently
blocked every framework's week-over-week growth (`weekIndex` hardcoded to `0`; `ctx.goal` a hardcoded
fake) and the Running screen's "Start run" button (never called `startActivity()`). Entry:
[`docs/overview/entries/2026-07-27-feat-cardio-density-progression.md`](docs/overview/entries/2026-07-27-feat-cardio-density-progression.md).

**Also recently:** (v1.216.0) **Cardio trends surface — cardio batch item 1 (renumbered).** New
`/api/cardio-trends` route + a Trends card on `/cardio` with a three-pill view picker: weekly
heart-rate zone stacks (`bucketZoneMinutesByWeek` over `getZoneMinutesRange`), a pace-vs-HR
efficiency curve for GPS runs (dual-axis, reversed pace axis matching the session-visuals item's
convention), and a cadence trend. Entry:
[`docs/overview/entries/2026-07-27-cardio-trends.md`](docs/overview/entries/2026-07-27-cardio-trends.md).

**Also recently:** (v1.215.0) **Sleep Score gains an autonomic axis.** Owner-directed, from the
data-quality review's case study of the night of 2026-07-25 — a night rated 5/5 "Terrible" that
scored 80 because it was normal on everything the model looked at and abnormal only where nothing
was looking (HRV −2.76 σ, overnight HR +10 bpm, a 2 h-early wake). Adds an `hr` contributor and a
directional `schedule` contributor (only a late bedtime or early wake counts against you), routes
all six callers through one shared baseline derivation (four previously passed none, so a night
could score 82 on the weekly digest and 80 on the Health screen), and rebalances weights so
autonomic state is 28 of 110 rather than 12 of 100. That night now scores **71** — 2nd lowest of 20
and 5 clear of the 3rd, where it used to sit 5th and indistinguishable from ordinary nights — while
the top of the range is unmoved and a perfect night still reaches 100 (pinned by a test).
**Historical scores change meaning**, and the two new contributor bars are **not device-verified**.
Entry: [`docs/overview/entries/2026-07-27-sleep-score-autonomic-axis.md`](docs/overview/entries/2026-07-27-sleep-score-autonomic-axis.md).

**Also recently:** (v1.214.0) **Cardio session visuals — cardio batch item 1.** The per-session
`ActivityDetailSheet` gained a hero interactive HR/pace scrub chart (drag across it and the route
map's marker slides to that moment — the scrub position, a time-based index into `paceSeries`,
maps to a distance via `estimateDistanceKmAtTime` and then to a lat/lng via `pointAtDistanceKm`, a
pure interpolation needing no new stored data), a pace-per-km bar chart with fastest-1km/5km
callouts from `bestEfforts` (computed and stored since GPS tracking shipped, never rendered until
now), a time-in-zone donut beside the existing zone-breakdown bar list, and a proper bordered
splits table. ⚠️ **Not yet device-verified** — the `touch-none` scroll-guard on the hero chart's
touch-drag scrub is untested on a real Samsung WebView gesture. Entry:
[`docs/overview/entries/2026-07-27-cardio-session-visuals.md`](docs/overview/entries/2026-07-27-cardio-session-visuals.md).

**Also recently:** (v1.213.0) **Cardio session picker — cardio batch item 1 (renumbered).** The
Cardiovascular hub's modality picker gained a "How much time do you have?" flow: pick 15/30/45/60
minutes and it recommends Run, Guided walk, or Other activity — recommending Run (and surfacing
the running program's own recovery-gate reason, e.g. easing off after a heavy leg day) only when
today's pending prescription actually fits the time budget, otherwise recommending a walk to close
whichever training zone (Z2-Z5, Z1 excluded per D-10) has the most minutes outstanding. Entry:
[`docs/overview/entries/2026-07-27-cardio-session-picker.md`](docs/overview/entries/2026-07-27-cardio-session-picker.md).

**Latest fixes:** (v1.208.2) added a time-in-zone + Session Load breakdown to the guided walk's
summary screen, reusing the same `ZoneBreakdown` component regular activities already have.
(Real zone-minutes in the Activity score itself was independently wired the same day in
v1.207.0's Activity Score v2 round 3 — see that entry below; no separate wiring was needed here.)

**Also this session:** (v1.208.1) **guided interval walk uplifts** — the fast/slow HR-zone targets
were using a fallback profile (190bpm max/60bpm resting) instead of the walker's real data,
making the fast target unreachable without jogging; now wired to real observed max-HR history
(the existing 70%/40% split itself already matched the actual research protocol, confirmed
against source). The preset buttons (Standard/Quick) now show a selected-state highlight + tap
feedback (they worked before, just gave zero visual confirmation). Added a confirm-before-exit
dialog on the End-walk button, bottom-nav tab-away, and the hardware back button, mirroring the
workout screen's existing three-surface guard. A phased plan for the remaining, much larger
uplift (live GPS map/speed/cadence/elevation, an HR chart with fast/slow phase shading, reusing
the Android status-bar pill for phase/countdown, reactive walk/jog nudge notifications, steps,
per-phase speed/HR stats) is queued in the backlog —
[`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`](docs/superpowers/plans/2026-07-23-guided-walk-uplift.md).

**Also this session:** (v1.208.0) **AD-2 — ring-cadence walk/run detection**, fixing false
"Activity detected" notifications during stationary training (e.g. a garage lifting session).
Walk/run **confirmation** (session start + the notification) now comes from the ring's real
stride cadence (`lib/health/gait-classifier.ts` + `lib/activity/gait-confirm.ts`'s sustained
~90s-window accumulator) instead of GPS speed — the same approach Oura's AAD model and Garmin
Move IQ use. GPS is demoted to route recording; session start is backdated to the true onset via
a new probe-phase point buffer. GPS-speed confirm + the AD-1 distance/elapsed gate remain as the
ring-disconnected fallback. **Device-gated** — see Known Issues below for the still-open Hz-band
calibration and the on-device smoke run.

**Latest feature:** (v1.197.0) **per-set / per-exercise HR metrics** — every logged set now saves a
durable HR snapshot (peak/avg during the set, the rest-bounded beat-drop curve, and three
time-to-recover models), surviving the 180 d raw-HR prune in the new `set_hr_stats` table (migration
139, sibling of `workout_hr_stats`). A new "Heart & Recovery" card on the exercise-history sheet trends
peak HR + rest recovery over time and breaks it down by working weight (%1RM). Cardiovascular signal
only (not CNS). Data path fully sandbox-tested; the card surface needs the on-device gate (see
Known-Issues below).

**Latest fixes:** (v1.185.1) the workout screen no longer flashes on open — the exercise list used to
be replaced by a full-screen "Preparing your AI workout" takeover and then swapped back; the list now
stays put and only the heading/Start button reflect the "preparing" state in place. (v1.185.2) locked
the WebView viewport (`maximum-scale=1, user-scalable=no`) so an accidental pinch/double-tap can no
longer leave the app stuck zoomed-in after a minimize/reopen — **needs on-device confirmation** (not
reproducible in the web sandbox). (v1.185.3) the next AI prescription is now generated **at session
end, in-process** (new `lib/ai-periodization/generate-prescription.ts`) instead of via an unreliable
self-origin fetch on next open — a just-trained ai_dynamic session gets its updated plan/"Auto" status
queued immediately, and offline completions regenerate on sync. **Gemini path needs real-data/on-device
confirmation** (local seed is a manual program, no LLM path reachable). (v1.188.1) fixed the home-screen
**"Sync failed" toast**: the Oura-BLE ingest ran its heavy rollup **inline** on every `/api/oura-ble/samples`
POST, and that rollup fanned reads out over **10 pool connections at once** (of `max:10`) for 12–30 s —
starving the outbox sync of a DB connection and blowing the native client's 30 s timeout → 499 → cursor-held
re-drain **retry storm** that pinned the pool (prod `NO_SOCKET`/`TCP_INVALID_SYN`). Now: the rollup reads via
**one** connection and is **time-boxed** so the POST returns 2xx promptly (rollup finishes in the background),
with a per-user in-flight guard. Server-side JS (no APK rebuild); **needs on-device confirmation** that ring
drains no longer 499 (sandbox can't reproduce the native POST). Failure-matrix row I19 in `docs/oura-ble-operations.md`.

**Where the app stands.** The full-system deep-review batch (`docs/reviews/2026-07-18-deep-app-review.md`)
is shipped, the backlog + `planned_upgrades.md` ledgers were source-verified against `main` (PRs
#676/#677 — a large number of "open" entries turned out to be already shipped and are now struck with
file:line proof), the R-1 native BLE cursor hole-jump race was fixed (v1.181.2, native — needs the owner
APK rebuild to take effect), and the goal-based **cardio training system** (running engine + VDOT paces +
observed-HR profile + progress observation) shipped this session (v1.182.0–v1.183.0). The remaining cardio
pieces — `/running` goal-picker UI, admin device-data capture panel, cumulative-stress rollup wiring — are
handed off in `docs/superpowers/plans/2026-07-20-cardio-system-remaining.md` and queued in the backlog.

**Status:** the **owner-directed Core score-cards + Activity overhaul** (v1.207.0) is **fully shipped** —
all four workstreams (W-A accent-tick ring redesign + HR-resting fix + de-Oura, W-B Activity Score v2
including active minutes, W-C sleep recalibration + HRV, W-D readiness recalibration + check-in) landed
across three owner-reviewed rounds. **Remaining is device verification only**: the whole batch needs the
on-device smoke (see Known-Issues below) — nothing left to build against this plan. Two small pieces were
deliberately left out of scope (yesterday-completed home display, hourly move-nudge notification); pick
those up as their own small item if wanted. Plan
[`docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md`](docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md).
Also, the **owner-directed Health/Training/Workout UX batch** (2026-07-21, 14
items filed on-device with screenshots) is **fully shipped** — all 14 items across 8 PRs
(#709–#712, #716, #717, + the device-gated batch and the workout redesign), v1.189.0–v1.193.0. **The only
outstanding work is on-device verification** of the device-gated items (#2/#4/#7/#9a/#14) and the
energy-budget / Run-card populated states — see the Known-Issues rows above and run
`docs/device-smoke-checklist.md` on the S25. Separately, a
wiring & load-performance audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`)
queued **seven scoped fix plans W1–W7** in `docs/implementation-backlog.md` (cache staleness,
wiring & load-performance audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`) shipped its
seven W1–W7 fix plans (see the entries below). **Corrected 2026-07-30:** this paragraph used to claim
"every previously-open backlog task buildable in the sandbox is done" and pointed at
`docs/owner-action-required.md` as the authoritative what's-left list — both were stale by the time of
a fresh audit (a 3,000-line backlog had accumulated real, non-device-gated open items alongside ~2,300
lines of unremoved shipped work; `owner-action-required.md` hadn't tracked most of the last 9 days).
`docs/implementation-backlog.md` was trimmed and corrected 2026-07-30 and is the current source for
what's open — read its Queue directly rather than assuming everything in it is blocked.

**For the full per-session history of what shipped and why, read the session journal** — the recent
uncompacted entries and the batched `docs/overview/history-*.md` archives (see the Document Map at the
bottom of this file). This section is a lean pointer, not a changelog: it is deliberately kept short so it
stays useful to orient by. Do not grow a run-on "Previously — …" chain here again; that belongs in the
journal.

---

## ⚠️ Known Issues & Risks With Recently Shipped Features

> **This section is the OPEN issues. Resolved ones live in
> [`docs/overview/known-issues-resolved.md`](docs/overview/known-issues-resolved.md)** — 53 entries,
> 1,092 lines, moved out 2026-08-13. **Grep the archive before concluding something has never been
> looked at**; "we already fixed that, and here is what it turned out to be" is why they are kept.
>
> **Striking an issue means MOVING it there, not marking it ✅ in place** (`CLAUDE.md`, Session
> Wrap-Up step 2). Without that rule this regrows — 72 ✅ entries had accumulated before the first
> sweep, and 53 of them had nothing outstanding at all.
>
> An entry only leaves when **nothing is still owed**: no open work, no pending owner or device
> check, no un-run follow-up. Nineteen ✅-marked entries stayed for exactly that reason and are still
> below.

### [platform] ⚠️ PR #1390 is OPEN with a red E2E job nobody has seen the cause of (Q-297/Q-309, 2026-08-16)

- **Five required checks green** (Lint, Tests, Build, Custom Rules, Migration Check); the **E2E job
  is red** on run `31973027001`. Failed jobs were re-queued — check that result before anything else.
- **The specs are not the problem, and this was measured rather than assumed.** A fresh
  `trainingai_e2e_fresh` database was created, migrated, seeded from `scripts/local-db/seed.sql` —
  CI's exact condition — and the whole suite run against it: **12 of 12 pass in 4.3 min**, the new
  water spec fastest at 7.3 s. So the CI failure is environmental. **Do not delete a spec to make
  the job green.**
- **The blocker is tooling, not the app.** `get_job_logs` returns only the Postgres *service
  container* stream for this job, on both the `job_id` form and `run_id` + `failed_only` — the spec
  names appear nowhere in the 24 KB it returns. **The untried path: download the `playwright-report`
  artifact** via `list_workflow_run_artifacts`.
- **One live lead:** `FATAL: role "root" does not exist` repeats every ~10 s through the whole run —
  something connects without the `DATABASE_URL` credentials and falls back to the runner's OS user.
  Whether it also appears in the three earlier *passing* E2E runs has not been checked; check that
  before chasing it.
- Full context: [`docs/handoff-2026-08-16-platform-e2e-harness-and-backlog-run.md`](docs/handoff-2026-08-16-platform-e2e-harness-and-backlog-run.md).

### [platform] ✅ The repo can now run its own app — E2E harness shipped (Q-249, 2026-08-15)

- **466 test files, none of which opened a browser** — until now. `playwright.config.ts`, `e2e/`,
  `pnpm e2e` and a separate `E2E` CI job. One spec: the five tabs must paint real content on a
  repeat visit, which makes the instant-paint rule executable instead of reviewed by eye.
- **Read [`e2e/README.md`](e2e/README.md) before trusting a green run.** It records what the harness
  proves and what it cannot, all measured: it drives the **web** build (`getLocalStore` returns null,
  so every offline-first domain takes its web fallback and the device branch never runs); it uses
  `pnpm dev` because the pg pool forces SSL under `NODE_ENV=production` and the local Postgres does
  not speak it; and its skeleton check covers **only the panel in the viewport**, so a tabbed screen
  like Health is roughly a third covered.
- **The harness was shown to discriminate, and the first attempt to do so failed usefully.** Forcing
  a Training-panel card to stay loading turns Health red. Forcing the Body-tile skeletons does not —
  that panel is off-screen — which is how the viewport limitation was found rather than shipped as a
  false guarantee. A Health "bug" found on the first run was traced, fixed, and then **reverted**
  once the off-screen carousel panel explained it.
- **The per-tab coverage gap is closed for Health** (2026-08-15, Q-297): `e2e/health-tabs-instant-paint.spec.ts`
  drives `?tab=` and asserts the requested tab is *selected* before checking, so each panel is
  actually in the viewport. Verified by the mutation Q-249's spec could not catch — pinning the
  Body tiles' skeleton now fails, and fails only the Body case. **Every other tabbed screen still
  has the gap.**
- **The `E2E` job is not a required status check** and should stay that way until it has a track
  record. Remaining write-path specs and the promotion are **Q-297**.
- Detail: [`docs/overview/entries/2026-08-15-e2e-harness.md`](docs/overview/entries/2026-08-15-e2e-harness.md).

### [app-shell][health] ⚠️ Two user-visible goal fixes shipped — NOT device-verified (Q-260, Q-258, 2026-08-16)

- **v1.317.2 (Q-260)** — changing a goal on More now reaches Health. `user-goals` was fetched by
  `fetchProgressHealthData` while the water goal renders in `waterIntake`, a `BODY_GROUPS` card, so a
  value shown on Body was fetched only by a tab the user may never open — and since every tab stays
  mounted for the app's life, nothing re-read it. Measured at the stale moment: server,
  `ta_cache:user-goals` **and** the `ta_water_goal_ml` device copy all held the new value while the
  screen showed the old one for 120 s. Fetch moved to the shared group; the localStorage seed moved
  to `useGoalSeeds`, which re-reads on `tabEpoch`.
- **v1.317.3 (Q-258)** — six goal/body inputs on More now announce their names to screen readers.
- **Neither is device-verified.** For Q-258 the gap is precise: Playwright resolving `getByLabel`
  proves the accessible name is wired, which is the mechanism that was broken — it is **not** the
  same as hearing TalkBack announce the field on the S25.
- **The class behind Q-260 is not swept.** Target weight and target body fat ride the same
  seed/`userGoals` pair and are fixed by the same change, but **any other screen that reads a value
  it does not re-subscribe to has this exact shape** — mount-scoped state on a screen that never
  unmounts. No sweep was done.
- Detail: [`docs/overview/entries/2026-08-16-health-stale-goal.md`](docs/overview/entries/2026-08-16-health-stale-goal.md) ·
  [`docs/overview/entries/2026-08-16-goal-label-association.md`](docs/overview/entries/2026-08-16-goal-label-association.md).

### [app-shell][platform] Q-261 — six `<Label>`s front button groups, and `<Label>` may be the wrong element (2026-08-16)

- Found finishing Q-258, which fixed every `<Label>`/`<Input>` pair in `components/profile/`. These
  six are a different shape: Fitness Goal, Biological Sex, Activity Level, Timezone, Weight Units,
  Food Region all front **button groups or static text**, so there is no `id` to point `htmlFor` at.
- **Needs an owner decision, which is why it was not bundled.** `<Label>` renders
  `@radix-ui/react-label`, whose job is associating text with a control; pointed at a `<div>` of
  buttons it is the wrong element rather than an unfinished one. Either wrap each group in
  `role="group"` + `aria-labelledby`, or drop `<Label>` where nothing is being labelled at all
  (Timezone and Weight Units front a value and a button, not a set of options).
- Not a regression — it has been this way since the components were written.

### [readiness][app-shell] ⚠️ The readiness card now flips on the tap — cause is code-evidenced, NOT device-reproduced (Q-248, 2026-08-15)

- **Shipped in v1.317.1.** Logging Exercise Readiness on Home showed a "Readiness saved" toast over
  an unchanged "How are you feeling?" prompt. The callback that flips the card sat behind
  `await localWrite`, a write already documented as able to queue for ~2 minutes behind a sync
  pull's `applyDelta` on the single Capacitor SQLite connection. It now fires on the same beat as
  the toast; `onSaved` stays behind the invalidation so the prescription refetch keeps its
  session-164 ordering.
- **The entry's step 1 was "reproduce on device with a sync pull in flight before changing
  anything", and that did not happen** — no device in session. What shipped fixes the cause the code
  evidences, not a cause confirmed against the observed failure.
- **The second possible cause is still open.** The screenshot cannot separate "still mid-stall" from
  "`onSaved` never fired at all". If it was the latter, the card will flip now regardless, but the
  local write would still be failing silently. **If the card flips and a day's readiness later turns
  out to be missing from the server, that is the other cause and this reopens.**
- **The device check that would close this:** trigger a sync pull, log readiness mid-pull, and
  confirm both that the card flips immediately and that the log reaches the server afterwards.
- Detail: [`docs/overview/entries/2026-08-15-readiness-card-optimistic-flip.md`](docs/overview/entries/2026-08-15-readiness-card-optimistic-flip.md).

### [workouts][platform] 🟠 The deferred measurements, taken — one escape hatch tested and closed off, one confound ruled out (2026-08-16)

No new Q numbers. This round **answered questions four existing entries told an implementer to answer
first**, and the answers change what two of the fixes are. Evidence in
[`docs/reviews/2026-08-16-deferred-measurements.md`](docs/reviews/2026-08-16-deferred-measurements.md).

**Q-304's escape hatch was tested and did not fire.** The entry allowed that `prescriptionFactor`
might already absorb the high-rep inflation, and said closing it as measured-and-rejected was
acceptable. **28 of the 29 sets at 13+ reps that feed the 1RM carry no `planned_pct`**, so the factor
returns 1 and the raw curve stands. The proxy is exact: `log-exercise.ts:233` writes the same value
the factor consumes. **Q-304 stands — go straight to the fix.**

**Q-300's question is answered: rest is NOT the confound, so Q-289 should not wait on it.** Delta by
rest band at expected-10: on-target **−1.75**, rushed **−2.80**, overlong **−2.33**, unknown
**−2.21** — the shape error survives in every band and clears the 1.5 dead band in all four. Rest is
*a* contributor (on-target is mildest) but not the explanation. **Q-300 is re-scoped to its secondary
half — rest adherence as an unsurfaced coaching signal.**

**⚠️ And a synthesis I retracted before merging, which narrows two entries.** A first draft claimed
the prescribed-vs-unprescribed split showed `prescriptionFactor` working (r 0.30 → 0.50). It is
**confounded**: `planned_pct` only exists from **2026-07-18** (migration
`126_set_log_planned_snapshot.sql` — 0 before, ~100% after), so "unprescribed" means "older data",
and only ~15 unprescribed sets exist post-cutover. **The comparison cannot be made.**
Splitting by **era** instead: post-cutover (n=278) reads **+1.09** at expected-5 — *inside* the dead
band — and **−2.29** at expected-10, which still clears. So **Q-289 is re-scoped to the top of the
range** (heavy prescriptions reading as easy, plus the non-monotonic top that survives both eras),
and **Q-306's headline is weakened**: the emergency-deload trigger is **not** sitting inside the
error band on current data. Q-306 keeps its ACWR-at-three-thresholds half.

**Q-298 is now a one-line fix.** `log-exercise.ts:196` zeroes the 1RM when **either** the AI flag or
**the phase** says deload; **line 264 stores only the AI flag**. Line 264 should store the same
predicate. The file's own comment at 190–191 says both cases must not feed the estimate — they don't;
only one is recorded.

**Q-292 sized: all 117 insights audited.** **7 imperial-unit errors** (all Fahrenheit, all in
`sleep`) and **12 absolute superlatives** — roughly **16% carry at least one**. A second fabricated
superlative is double-confirmed: *"a perfect recovery index"*, for a contributor **Q-271 measured has
never exceeded 50 on any of 31 scored days**. One quasi-medical inference (hedged, benign advice, but
it infers infection from a temperature reading **and states it is advising without a readiness
score**). One regex hit was read and is a **false positive** — recorded so it is not re-raised.

**⛔ Still blocked on the owner:** **Railway per-query RTT**, which Q-308 needs before anyone touches
the sync fan-out, and which cannot be measured from the sandbox.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. One user's data. The AI audit
is pattern-match plus read-back, not an independent judgement of every insight. Cell counts at the
extremes are small (expected-10 prescribed is n = 4).

### [platform][workouts][cardio] 🟠 The last four reviews, and the load test finally run — nothing breaks at 100 users (Q-306…Q-308, 2026-08-16)

Fifth and final review. Closes the four items previous rounds listed as *not started*, and answers
the question deferred four times. Evidence in
[`docs/reviews/2026-08-16-multi-user-load-test.md`](docs/reviews/2026-08-16-multi-user-load-test.md).

**✅ Q-298 is RESOLVED.** The five unexplained 2026-08-09 zero-1RM rows all belong to **one `Pull`
session**, and `session_periodization` shows **Pull entered the `deload` phase on exactly
2026-08-09**. `estimateOneRm` was called with `deloaded: true` from the phase and correctly returned
0. **The zeros were never the bug — the defect is that the phase-level deload never stamped
`exercise_deloaded` on the row**, which is precisely why Q-228's filter misses them and why they leak
into prescription. Two small fixes now: stamp the column from the phase, and store `null` not `0`.

**🎯 The load test, finally run.** Two committed harnesses (`scripts/load-test/`), both refusing to
run against a non-local database. Seeded 10 users at the owner's real profile — 10,527 set logs,
20,000 HR rows — and replayed `getSyncDelta`'s 21-query fan-out at production's `poolMax = 10`:

| concurrent syncs | p95 | failures |
|---|---|---|
| 10 | 210 ms | 0 |
| 50 | 778 ms | 0 |
| 100 | **1,562 ms** | 0 |
| 200 | 2,868 ms | 0 |

**Nothing breaks at 10 users. Nothing breaks at 100.** Linear degradation, zero failures; first
failures extrapolate to ~**300 concurrent syncs**, arriving as timeouts. And 10 *users* ≠ 10
concurrent *syncs* — real concurrency is near zero unless devices sync on a shared schedule.

**🟠 Two results that change the diagnosis (Q-308).** **A bigger pool does not help — it is slightly
worse**: at 50 concurrent, poolMax 10 → 778 ms, 20 → 803 ms, 40 → 952 ms. **Q-107 and Q-213 both
attribute production sync failures to "DB-pool contention", and the pool measures as not the binding
constraint.** And **the entire fan-out is 22.6 ms of query work** — so it demands 21 connections to
save ~8 ms. Serialising gives **identical p95 for a 21× cut in connection demand** (10 concurrent:
174 → 180 ms; 100: 1,450 → 1,519 ms). **⚠️ Do not act on that yet**: the harness runs over a Unix
socket where RTT is ~0, and on Railway serial adds 21 × RTT. Q-308's first task is measuring that RTT.

**🟠 The emergency-deload RPE trigger sits 0.07 inside a known error (Q-306).** It fires at
`rpeTrend.delta > 2.0`; **Q-289 measured a systematic +1.93 at expected-5 sets.** Blocked on Q-289 —
the threshold must be re-derived after that calibration, not tuned now. Separately, **ACWR now drives
three behaviours at three thresholds** (1.5 here, 1.2 early-deload, 1.5 activity taper) on a metric
Q-279 already questions. Deload has fired **once in 3.5 months**, so this is not over-firing today.

**🟠 Pace is null on 32 of the 39 activity logs that could compute it (Q-307).** `avg_pace_sec_per_km`
is populated on **7 of 46** while 39 carry both duration and distance. Read from the column, never
derived at render, and written as an explicit `null` at save — the same shape as **Q-230**, and very
likely one fix for pace, steps and calories together.

**Clean results, recorded so they are not re-swept.** **The phase engine is working** — the active
program progresses coherently; five rows that looked like stuck `sessions_in_phase` counters belong
to an **inactive** program (`AI-Phase1`), which is correct dormant state. **Fifth finding to die on
verification across these five reviews.** Muscle balance is push:pull **1.30** — mildly push-dominant,
not alarming, and folded into Q-305 rather than filed separately.

**⚠️ Still open:** the systematic AI-output audit (8 of 117 read), the degradation matrix against a
running app (Q-294, desk-only), and **Railway per-query RTT** — the measurement Q-308 needs, which
cannot be taken from the sandbox.

**Surfaces NOT exercised:** the load test is **local Postgres, raw SQL, one instance** — no Railway
network, no Next request path, no drizzle overhead, no replicas. It answers a contention question,
not a capacity-planning one. Synthetic users are uniform; a single heavy user is not modelled. No
device, emulator, browser or `pnpm dev` in any of the five reviews.

### [workouts][platform] 🟠 Round 3 — the 1RM high-rep gap, volume landmarks nobody sees, and a correction to Q-298 (Q-304/Q-305, 2026-08-15)

Fourth review of the day, taking the items the third listed as *not started*. Two are done;
**four are still not started and are named below.** Evidence in
[`docs/reviews/2026-08-15-workout-model-round-3.md`](docs/reviews/2026-08-15-workout-model-round-3.md).

**🔧 First, a self-inflicted one, fixed in the same PR.** A merge resolution staged with `git add -A`
put **21 conflict markers across four files onto `main`** in #1380. They passed **Lint, Tests, Build,
Migration Check, Custom Rules and E2E** — six green checks — because nothing looks at markdown for
this and `<<<<<<< HEAD` is ordinary prose to every other tool. Resolved, and
`scripts/check-conflict-markers.js` is now a Custom Rules step (**36 of 36**), verified to fail on a
planted marker. No backlog entry — it is fixed.

**⚠️ Q-298 was HALF WRONG as filed, and is amended in place.** It called all ten zero-`estimated_1rm`
rows a defect. The write path calls `estimateOneRm`, and `1rm.ts:158` is
`if (deloaded) return { estimated1rm: 0, … }` — **the five 2026-08-06 rows carry
`exercise_deloaded = true` and are zero on purpose.** Two things survive: **`0` is the wrong sentinel
and should be `null`** (a zero propagates as an estimate *of* zero — that is what read as −100% on a
trend), and **the five 2026-08-09 rows are still unexplained**. Those narrow to a bodyweight-resolution
path (Pull-Up, `weight_kg = 0`), a `useFor1rm`-subset with no qualifying set (Preacher Curl), and
**three rows with real weights, real reps and `use_for_1rm = true` that should compute and do not** —
that is where the work starts. `runningEstimate1RM` already has the empty-result fallback that
`calculate1RM` lacks, and the write path uses `calculate1RM`.

**🟠 29 sets at 13+ reps feed the 1RM estimate on the path that skips the AMRAP correction (Q-304).**
`amrapScaleFactor` exists (0.88 at 13–20 reps, 0.82 at 21+) and is applied by `calcAmrap1RM`;
`estimateOneRm`'s ordinary path calls `calculate1RM`, which does not. **The entry carries an explicit
qualifier that may close it**: `prescriptionFactor` may already absorb the inflation where a style is
present, and how often that holds for those 29 sets was **not measured**. Measure first.

**🟠 The volume landmarks are computed and shown to nobody (Q-305).** `MUSCLE_LANDMARKS` carries
MEV/MAV/MRV per muscle and `program_volume_targets` exists. Last 7 days: **calves 2 sets against an
MEV of 8**, lats 9 vs 10, upper back 7 vs 8, while triceps sit at 17 (above MAV). Nothing surfaces
any of it. Same "computed and discarded" class as Q-278 and Q-302 — worth one shared treatment.
**One week is a small sample**; the durable finding is the missing surface, not this week's numbers.

**A check that came back clean:** `core` is tagged on exercises and absent from `MUSCLE_LANDMARKS`,
which looked like a silent fall-through — but `muscles.ts:17` maps `core: 'abs'` and
`volume-targets.ts:58` normalises before the lookup. **Fourth finding to die on verification across
these four reviews**, which is the process working.

**⚠️ STILL NOT STARTED after four reviews** — deload *policy* (as opposed to its twice-fixed
mechanism), the phase engine, muscle balance / exercise selection, and the cardio pace/HR model
across 47 activity logs. The AI-output audit is 8 of 117. The degradation matrix is desk-only (Q-294).
And **"what breaks at 10 users, at 100" is unanswered for the fourth time — it needs load testing
against a seeded multi-user database, not reading, and will not close by inspection.**

### [workouts][cardio][nutrition] 🔴 Every remaining pillar reviewed for model soundness — 6 findings, and 2 pillars clean (Q-298…Q-303, 2026-08-15)

Third and final review of the day. The owner asked for every pillar to get the treatment the health
scores got: not *is the code correct* but **is the model sound, and does it do anything in
production?** Evidence in
[`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](docs/reviews/2026-08-15-pillar-model-soundness-review.md).
**Heart-rate and body were reviewed and came back clean — no entries filed for either.**

**🔴 Ten exercise logs store an estimated 1RM of exactly zero (Q-298).** Not null — zero — beside real
volume and reps (Sumo Deadlift: 2,062 kg at 6.3 avg reps → e1RM 0). Two clusters: 2026-08-06 ×5, all
`exercise_deloaded = true` (the Q-115/Q-228 date), and **2026-08-09 ×5, all `deload = false`,
consecutive over 37 minutes — one entire session**. **Q-228's fix filters on `exercise_deloaded`, so
the 08-09 cluster passes straight through into prescription.** A zero is a value, not an absence: it
flows into trends, PR detection and the next prescription, and reads as −100% on a trend chart.
**2026-08-09 also logged 1,000 `error_events`** and carries the 0.00 h sleep row from Q-274 — three
domains, one heavy-fault day, pointing at the connection-starvation class (Q-213/Q-107).

**🟠 Autoregulation's missing-data defaults favour adding load (Q-299).** `planned_reps` is recorded
on **176 of 1,009 sets (17%)**, so `repCompletionRate` is usually null — and
`autoregulation.ts` reads null as `missedReps = false` but `metReps = (x ?? 1) >= 1` → **true**.
Missing data *removes* a condition from the increase path and *adds* one to the decrease path. It
compounds **Q-289**, whose measured −2.19 delta at expected-10 already clears the `<= -2` two-rep bump.

**🟠 37% of sets are rushed, and `expectedRpe` has no rest term (Q-300).** Where both are recorded
(n = 276): mean 99 s taken vs 111 s planned; **103 rushed (< 75%)**, 44 overlong. A set at 80% with
60 s rest is not the stimulus the model assumes. **Re-run Q-289's bucket table split by rest
adherence before recalibrating anything** — the confound may be most of the finding.

**🟠 The running baseline is written, empty, and read by nothing (Q-301).** `running_baselines` holds
vo2max / max_hr / threshold_hr / easy_pace. Production: **0 rows**, against 12 `prescribed_runs`.
`saveRunningBaseline` **is** wired at plan creation — but **`getRunningBaseline` has zero callers
outside the repository layer**, so even a full table would change nothing. Third instance of this
class after Q-270 and Q-231.

**🟠 Adaptive TDEE has not fired once in 30 days (Q-302).** Its gate needs 10 logged days per
fortnight; production runs **1–4 per 14**, and **0 of the last 30 rolling windows pass**. The gate is
probably right and should not be lowered — the defect is that `TdeeAdaptationCard` never says it is
dormant or what would wake it. Same class as Q-278, different pillar. And the AI coaches on that
sparse data unqualified — *"bump that protein closer to your 150 g goal"* on a window with 4 logged
days (Q-303).

**What came back clean, recorded so it is not re-swept.** **Progressive overload is working** — 10 of
12 tracked lifts improving over 3.5 months (Bench 84 → 100 kg, Hip Thrust 98 → 157 kg); the two
"regressions" are the Q-298 artefacts. Rep adherence where recorded: **135 of 176 exact**. Nutrition
targets internally consistent (150×4 + 190×4 + 60×9 = 1,900) and the energy model uses Schofield BMR
+ Mifflin factors + Compendium METs. **Heart rate**: 57,494 samples, observed max **168** — independent
corroboration of the figure Q-57 adopted over `220 − age`; `daily_zone_minutes` stores `max_hr`/`resting_hr`
per row, which is the provenance discipline Q-273 asks for elsewhere. **Body**: the 17-vs-68 composition
gap resolved as **benign** (those columns first appear 2026-07-29); the six tape-measure columns at 0 of
108 are **correctly empty**, not broken.

**⚠️ Still open after three reviews** — stated so completeness is not assumed: the 1RM formula question
at high reps (I4) **not started**; deload *policy* (as opposed to its twice-fixed mechanism) **not
started**; volume-landmark adherence, muscle balance and the phase engine **not started**; the cardio
pace/HR model across 47 activity logs **not started**; the AI-output audit partial (8 of 117 read); the
degradation matrix desk-only (Q-294); and **"what breaks at 10 users, at 100" is still unanswered — left
open three times now.**

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev` across any of the three reviews.
Every number is one user's via row-scoped `claude_ro` views; the *mechanisms* are user-independent, the
*magnitudes* are not.

### [workouts][platform] 🔴 The RPE model misses by more than the threshold that consumes it, and five other unswept lenses — 12 findings (Q-285…Q-296, 2026-08-15)

The owner asked what twelve review sweeps had never looked at. Six lenses survived a grounding
check: feature usage, account lifecycle, **training science**, AI output, cost, and failure
degradation. Full evidence in
[`docs/reviews/2026-08-15-uncovered-lenses-review.md`](docs/reviews/2026-08-15-uncovered-lenses-review.md);
entries **Q-285 … Q-296**.

**🔴 The headline (Q-289) — `expectedRpe` measured against 569 real production sets.** It drives RPE
autoregulation and the emergency-deload safety net. It predicts logged RPE at **r = 0.348**,
MAE 0.99:

| expected | actual mean | **delta** | n |
|---|---|---|---|
| 5 | 6.93 | **+1.93** | 68 |
| 8 | 7.57 | −0.43 | 288 |
| 9 | 7.90 | −1.10 | 60 |
| 10 | 7.81 | **−2.19** | 52 |

`autoregulation.ts:19` sets `RPE_DEAD_BAND = 1.5` on `actual − expected`; `<= −2` adds **two** target
reps; `emergency-deload.ts:35` fires at `> 2.0`. **At expected 5 the systematic error alone is
+1.93, and at expected 10 it is −2.19** — both clear the trigger before the lifter has done
anything. **120 of 569 sets (21%)** sit in those buckets, so the heaviest prescriptions systematically
read as *"that felt easy, earning the next jump"*. The model is also **non-monotonic at the top**
(expected 9 → 7.90, expected 10 → 7.81), which points at `maxRepsAtPct` rather than a simple offset.
The construction is sound and should not be rewritten — this is calibration. Its ceiling is set by
**Q-290**: logged RPE has **sd 0.87 over range 6–10**, effectively two values, so autoregulation
differences a 1-point signal against a 5-point prediction.

**🟠 A shipped toggle that can never do anything (Q-285/Q-286).** `push_subscriptions` has **0 rows**,
and `sendPushToUser` has exactly one caller in the codebase — `/api/push/test`. So web push has
neither senders nor subscribers. **This is not the native notification work recorded elsewhere in
this file** (`OuraRingService.kt` etc.), which works. It strands a real feature:
`supplements.reminder_enabled` is a live `<Switch>` in `manage-supplements-sheet.tsx:253` that
persists and syncs, and there is no cron layer (`module-map.md` §0) and no push sender — so the
reminder cannot arrive, while looking like it saved.

**🟠 The AI contradicts itself, and stated a false number (Q-291/Q-292).** On 2026-08-06 the readiness
insight said *"Keep your planned exercise intensity low"*; the user did **two** sessions; the same
day's digest said *"Crushing three PRs… Keep that same energy tomorrow!"* Readiness then fell
79 → 76 → 76 → **65**. Separately, the 2026-08-05 activity insight claimed *"a perfect activity
score"* when the stored value was **80**, and a sleep insight prescribed *"65 degrees Fahrenheit"* to
a metric user. `CLAUDE.md` forbids an LLM number *gating an action*; it does not yet cover a number
*displayed as fact*, and it should.

**🟠 Two Play Store gates are unmet (Q-287/Q-288).** No self-service account deletion exists (admin
route only) — required in-app and on web since 2024. And `/api/export` covers **27 domains against
80 tables**, silently omitting the user's heart rate, derived scores, AI conversations and nutrition
plans. Deletion is **⛔ owner-sign-off-first**; it is destructive and irreversible.

**The rest:** `ai_health_insights.context_hash` is NULL on **109 of 117** rows, so the
regeneration-avoidance key is written by one section of fourteen (Q-293). Coach is **8% of AI calls
and 52% of tokens** at 19,400 input tokens and **5.8 s** per call (Q-295) — *latency*, not cost.
`module-map.md` says Coach runs `gemini-3.6-flash`; **production logs all 17 coach calls on
`gemini-3.1-flash-lite`** (Q-296). Four failure cells have undefined intended behaviour, filed as a
note against Q-249 rather than standalone work (Q-294).

**Cost was measured and is a NEGATIVE result — do not optimise it.** 255 calls / 632,639 tokens over
24 days ≈ 26,360 tokens/day, cents per month, ~$6/month at 100× the users. The database remains the
real cost curve and is already tracked.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. **Lens L (degradation) was
not executed at all** — no failure was induced, and its table is reasoning from source. The RPE
finding is **one lifter's 569 sets**. Only 8 of 117 AI insights were read closely. The Play Store
requirements in Q-287/Q-288 are asserted from knowledge and should be re-checked against Google's
current policy before building.

### [readiness][sleep][activity][body] 🔴 The five scoring pillars, measured together against production for the first time — 14 findings (Q-271…Q-284, 2026-08-15)

Prior sweeps measured **one** pillar each, in isolation and months apart. The 2026-08-15
comprehensive review measured all five on the same days against the same production rows, and asked
whether they agree with each other. Full evidence and every query in
[`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md);
one backlog entry per finding, **Q-271 … Q-284**.

**The five that change what the user sees:**

- **🔴 Readiness is structurally blind to training load (Q-275).** `readiness-payload.ts:329` reads
  the Activity Score's `preTaperScore` *specifically* to avoid double-counting ACWR — but load
  enters the composite nowhere else. Both activity terms (15% combined) are **goal-completion**
  scores, so a 12,000-step rest day and a heavy squat session contribute identically. Garmin's
  Training Readiness takes two load inputs of six. For a resistance-training app this is the largest
  modelling gap in the score.
- **🔴 Fragment "nights" reach the sleep score, and on two dates the fragment is the only record
  (Q-274).** Post-re-key, 10 of 46 `sleep_sessions` rows are under 1.5 h and **three are exactly
  0.00 h**. On 2026-08-11 and 2026-08-13 the fragment is the *entire* record for the date. These feed
  `previousNight` (16% of readiness) and `sleepBalance` (10%). **This is the sweep Q-225 asked for,
  and it found at least one more night sharing 08-13's signature.**
- **🟠 The Recovery Index contributor can never score above ~50 (Q-271).** `RECOVERY_INDEX_OPTIMAL_HOURS = 6`
  against a production mean of **2.58 h**, with 1 of 39 days reaching the optimum. Realised
  sub-scores across all 31 scored days: 13, 18, 20, 21, 22, 28, 43, 48 — **never above 50, ever.**
  Nine percent of readiness weight that can only subtract (~2.2 points/day), flagged `provisional`
  on 31 of 31 days.
- **🟠 Body Battery v5 drains 5× faster than it charges (Q-272).** v5 halved `CHARGE_RATE` to fix
  ceiling-pinning and overshot: charge 10.5/day vs drain 52.4/day, **ends at its daily minimum on 10
  of 12 days**, hits 0 on 3. Across all 40 days it never rises above its waking value on a third of
  them. Garmin's equivalent recovers during waking rest — that is the feature's headline behaviour.
- **🟠 Readiness and Body Battery share no variance (Q-276).** Readiness ↔ battery *anchor* r = +0.93
  (the anchor **is** readiness); readiness ↔ *end value* r = **+0.12**. Two headline numbers both read
  as "how recovered am I", sharing nothing. Needs an owner decision on whether they are different
  questions or one is wrong.

**And one correction to a claim already in this file.** The Body Battery v5 row below records
end-of-day battery vs next-day readiness at **r = −0.06** as evidence the model has no outcome
signal. That number was computed **across four different model versions** (v1/v2/v4/v5 all ran
inside 40 days, with no backfill). Split by version, **v5 alone gives r = +0.67 (n = 11)**. The
deferred re-check that row asked for is done and it answers **in v5's favour** — tune, don't
abandon. That the pooled figure stood for eleven days is itself the finding: **Body Battery is the
only pillar that stamps a `model_version` at all**, so this class of error is undetectable for the
other four (Q-273 — do this one **before** the calibration items, or each creates another
incomparable segment).

**The rest, in brief:** Activity Score still occupies a quarter of its range (sd 5.9 over 19 days)
even though v2 fixed the mechanism Q-137 blamed — Q-137 should be re-scoped or closed in its favour
(Q-277). Scores are absent on 20–52% of days with nothing distinguishing "no data" from a real value
(Q-278). Q-214's duplicate-collapse fix — which stopped a **5,771-hit** `[pg 21000]` fault that was
discarding 5,000-point HR chunks — reached **one of three** same-shaped batch upserts; `upsertOuraBucket`
and `upsertSetHrStats` are still exposed (Q-280). ACWR drives the early-deload card and the activity
taper on evidence the literature has substantially retracted (Q-279). No automated accessibility
check exists anywhere in CI, which is why the 2026-08-08 sweep's contrast finding "could NOT be
measured" (Q-282). Plus score presentation vs the incumbents (Q-281), ~11 MB of never-scanned
indexes (Q-283), and the Oura activity blend now firing on 1 day in 40 (Q-284).

**Surfaces NOT exercised:** no device, no emulator, no browser, no `pnpm dev` run — this was a
docs-only review. Every number is **one user's** data via the row-scoped `claude_ro` views, and
`error_events` prunes at 30 days. Correlations at n = 11 to n = 31 are directional, not conclusive.
The review's own architecture lens (Lens F) is shallower than the rest, and **"what breaks first at
10 users, at 100" is not answered.**

### [nutrition][workouts] ⚠️ Three owner-reported day-screen fixes shipped — NOT device-verified (Q-245, Q-246, Q-247, 2026-08-15) · needs: browser

- **Shipped in v1.317.0.** Nutrition's food-log guard is now scoped to the date the rendered logs
  belong to, so swiping to a past day and back to a fresh today no longer keeps the previous day's
  meals. The weekly Training Load bar draws a deload day at a real height with a striped fill
  instead of the grey "no data" sliver a rest day gets, and a testing-only day now shows "T" rather
  than the "D" it was mislabelled with. The day screen gained an Energy section (eaten / burned /
  net, broken down into workouts, activity, steps and resting), reading the same
  `/api/nutrition/energy-balance` route Nutrition's card uses; activity rows now render the
  distance, calories, pace, HR, steps and elevation the payload already carried.
- **All three were verified on the local dev server and by mutation-verified tests, and none has
  been seen on the S25.** Three specific gaps: the Q-245 repro is a *swipe gesture driving React
  state*, and Playwright's npm package is not a dependency here (only the browsers are installed),
  so the interaction was never driven in a browser — the decision it turns on is unit-tested, the
  wiring around it is not. The deload stripe is a CSS mask (`-webkit-mask-image`), whose rendering
  on Samsung's WebView compositor is assumed rather than observed. And no day-screen section appears
  in server-rendered HTML, so the Energy section and enriched activity rows were verified through
  the route's numbers and their display logic, never *visually*.
- **The device check that would close this:** on the APK, swipe Nutrition back a day and forward to
  today on a day with no food logged yet, and confirm today reads empty; open Health → Training in a
  week containing a deload and confirm the bar is striped and full-height, not grey; open a day with
  a workout and a walk on it and confirm the Energy section reads sensibly and the activity row
  shows its distance/calories/HR.
- **Deliberately not done:** a per-workout kcal estimate in the day screen's Training section. It
  needs `estWorkoutKcal` per session, which is the Q-230 bundle hazard from a client component —
  doing it properly means computing it server-side in `/api/day-log`.
- Detail: [`docs/overview/entries/2026-08-15-nutrition-day-guard-and-deload-bar.md`](docs/overview/entries/2026-08-15-nutrition-day-guard-and-deload-bar.md).

### [platform][app-shell] 🟠 Editing a goal never busts the goal cache — Health shows the old goal for 30 minutes (Q-240, 2026-08-14)

- Found by the owner-requested UI/flow/caching review,
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §4.2.
- `components/profile/goals-section.tsx:177-186` fires `PATCH /api/user/goals` and invalidates
  nothing. Its sibling `patchProfile` in the same file (`:123-140`) calls
  `invalidateGoalRecommendations()` after its PATCH — and **that group already contains
  `invalidateCache('user-goals')`** (`lib/cache-groups.ts:176`). The group is right; the call site
  was never wired to it.
- **User-visible:** change your steps / sleep / calorie / water / target-weight / target-body-fat
  goal in More → Profile → Goals, switch to the Health tab, and its goal-driven cards keep rendering
  the **previous** goal for up to 30 minutes (`user-goals` at `TTL_MEDIUM`,
  `app/health/health-content.tsx:454`), and the stale value paints first on the next cold start
  (same key seeded synchronously at `:242`).
- **Not reproduced at runtime** — found by reading source and the invalidation groups. The fix is
  one `await invalidateGoalRecommendations()`. Queued as **Q-240**.

### [platform][body] 🟠 Goals live in two places — `localStorage` and the server — and Health reads three of them from the device copy only (Q-241, 2026-08-14)

- Same review, §4.3. `components/profile/goals-section.tsx:192-235` writes nine `ta_*` goal keys to
  `localStorage` **and** PATCHes the same values to `/api/user/goals`;
  `components/profile/goal-recommendation-sheet.tsx:125-126` writes the device copy too;
  `lib/coach/domains/goals.ts:137-138` is a third reader/writer of the same keys.
- `app/health/health-content.tsx:202-214` reads the **water goal** (defaulting to 2500 ml),
  **target weight** and **target body fat** from `localStorage` only.
- **User-visible:** the device copy never syncs. On a second device, after a re-install, after
  clearing browser data, or between the web surface and the APK, the server holds the real goals
  while the Health tab shows defaults — and the two copies can then disagree indefinitely with
  nothing to reconcile them. Against the *Canonical Runtime* amendment (no surface may assume the
  owner's own device) and against the offline-first rule that the **local store**, not
  `localStorage`, is the local source of truth.
- **Not reproduced on a second device** — the sandbox has one. Queued as **Q-241**.

### [platform] 🟠 83 device-verification rows, now tagged by which capability each actually waits on (re-measured 2026-08-15, Q-249…Q-254)

- **Every row now carries a `· needs:` tag** (Q-254's re-tagging half, 2026-08-15 — see
  [`docs/overview/entries/2026-08-15-device-verification-retag.md`](docs/overview/entries/2026-08-15-device-verification-retag.md)). Re-measured on
  the day Q-249 landed, the 83 rows split **browser 32 · android 26 · data 11 · hardware 13** —
  `grep -cE '^### .*needs: browser' projectOverview.md` and friends are the live count (anchor it to
  the heading, or this paragraph counts itself). The 2026-08-14
  projection below ("~25 need nothing but running the app", "17 Android", "25 hardware") was made by
  reading and is **superseded by this**: the browser bucket is larger than projected and the hardware
  bucket smaller, but the shape of the finding held — roughly 40% of the wall never needed a phone.
- **The tags were assigned from each row's own heading text, not from opening the feature.** A row
  tagged `browser` is a claim about *which gate it is waiting on*, not that it has been verified —
  striking a row still requires an E2E spec that covers it, per "never mark an issue fixed from
  intent". `data` means real accumulated/owner/ring data that no emulator conjures; those rows are
  not unblocked by Q-249 or Q-250.
- Owner asked what access would let agents test more end-to-end, citing the Railway key as the model.
  Measuring the gate first changed the answer. Full working:
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §7.
- **The 81 rows are five gates, not one:** ~25 need nothing but somebody running the app; **17** need
  an Android runtime (local SQLite, offline, notifications, back button, deep links, PiP); ~10 need
  real data; **25** need real hardware; ~4 are perceived performance.
- **The largest bucket needs no new access.** There are **466 test files and none runs the app** —
  Chromium and Playwright's browsers ship in every session (`/opt/pw-browsers`) but Playwright is not
  a dependency, so there is no harness. Rows like "Bodyweight sets no longer count as zero volume"
  and "Injury workout warning" have sat since v1.45–v1.50 not because they need a phone, but because
  the device-verification rule had **no cheaper tier beneath it** — "cannot verify here" was the only
  truthful thing a session could write. Queued as **Q-249** (build, don't plan).
- **The Android bucket's most valuable line is local SQLite migrations** — the failure that has
  silently killed the local DB twice (#27, #85) and is the root of the recurring "my data
  disappeared" reports. A migration's first real execution is currently on the owner's phone.
  **Q-250** puts it on an emulator in CI first. Verified it cannot run in a session: no `/dev/kvm`,
  no `vmx`/`svm` — Firecracker microVM, no nested virtualisation. GitHub's `ubuntu-latest` has KVM.
- **Owner directed the cluster be implemented before Q-49** (the public-repo migration), and that
  deadline is load-bearing: Q-49's decisions commit to "CI stays offline and holds no credential",
  while Q-252 (error tracking) and Q-253 (device farm) both want one. Easier to settle on a private
  repo than after the cut.
- **~15–18 of the 25 hardware rows are BLE and stay owner-only permanently** — no emulator or device
  farm produces a Ring 5 on our own re-keyed protocol. This cluster shrinks what falls under the
  device gate; it does not remove it. Projected outcome: the owner-gated queue drops from 81 to
  roughly 30. **That is a projection from heading-level bucketing, not a promise** — Q-254 re-tags
  each row properly.

### [app-shell] 🟠 The app's containers are organised by build order, not by convention — 13 findings from the 2026-08-14 UI/flow/IA review

- Owner-requested review of UI and "flow/location":
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md).
  The screens are mostly well built; the **container layer** is the problem. Nothing is missing, a
  lot of it is unfindable.
- **The five structural ones:** More → Profile is thirteen kinds of thing in one 845-line scroll
  (**Q-232**, the umbrella — needs a written plan before any of these are built); admin/user
  administration is mixed with developer diagnostics and both hide at the bottom of that scroll
  (**Q-234**); the Program Builder lives in More under a sub-tab *also* called "Workout"
  (**Q-235** — already caused Q-223; ✅ resolved 2026-08-15, and it had caused a second one,
  **Q-256**); four device-pairing cards sit inline with no Devices screen
  (**Q-233**, the other half of Q-111); Nutrition's actions are placed by scroll depth, with
  "End of Day" and "Saved Meals" below every meal card (**Q-237**, feeding Q-112). ✅ **All five
  structural items are resolved (2026-08-15)** — Q-232's own restructure, Q-233, Q-234, Q-235 and
  Q-237; see the status entries above.
- **Two dead surfaces found by reachability grep:** `/overview` is a 543-line screen with **zero**
  in-app entry points, duplicating Home (**Q-236**); Health's card ordering/hiding has live readers
  and **no callers for either writer** (**Q-238** — same shape as Q-180). ✅ **Q-238 is resolved
  (2026-08-14, v1.307.2)** — deleted rather than rebuilt, because git shows the UI was removed
  deliberately in June 2026 and the machinery simply outlived it; see the status entry above. ✅ **Q-236 is resolved (2026-08-15)** — screen, its orphaned readiness card and its
  background palette deleted; the `/sheet/[id]/*` shims kept and their expired rationale filed as
  **Q-255** for the owner. ✅ **Q-255 is resolved (2026-08-16)** — the owner confirmed no external
  link uses a `/sheet/...` URL, so all three shims were deleted.
- **Plus:** six screens reachable from exactly one card each (**Q-239**), water logged from Home
  over-invalidates five instant-paint caches it does not feed (**Q-243**), `day-log:` fetched with
  two different TTL expressions (**Q-242**), and hex literals up 430 → **471** in five days with
  nothing mechanising the theme-token rule (**Q-244**). ✅ **Q-244 is resolved (2026-08-15)** — a per-file
  shrink-only baseline now ratchets it; the 471 are recorded, not swept. ✅ **Q-242 is resolved (2026-08-15,
  v1.307.3)** — and it was three divergent keys, not one; the scan is now a Custom Rules check. See
  the status entry above.
- **What the review confirmed healthy, measured not assumed:** all 33 Custom Rules steps pass; zero
  `invalidateCache()` call sites outside `lib/cache-groups.ts`; 73 cache keys all reachable from an
  invalidation group; one fetch variant per key; every `body-metadata` read guarded by
  `isBodyMetadataFresh`; 204 API routes none caching; every admin route `requireAdmin`-gated; the
  service worker's two-generation retention makes deploy-time cache busting sound.
- **Not checked** (cannot be, in the sandbox): native SQLite/Capacitor paths, safe-area on device,
  Samsung WebView rendering, real device pairing, drifted production data. Every finding is from
  source reading and static analysis; **none was exercised on the S25**.

### [workouts] 🔴 AI prescriptions never expire — `prescriptionExpiresAt` is stored and never checked (Q-229, 2026-08-14)

- **Found investigating Q-228, same live session.** The owner's "Upper" session's AI prescription
  (`session_periodization` row `a4fec65d-95e6-44d2-8091-95c7e35e6003`) was generated **2026-08-06
  22:11:55 UTC**, with `prescription_expires_at` set to exactly 7 days later
  (**2026-08-13T22:11:55Z**, confirmed by direct calculation). Today, 2026-08-14, well past that
  expiry, the app served the owner **the exact same prescription object, unchanged digit for
  digit** — same `pct`/`reps`/`sets` for every one of the 5 exercises — for a live, real workout.
  `updated_at` on that row is **2026-08-13T22:28:18Z, 16 minutes AFTER its own expiry**, meaning the
  row was touched (re-consumed) past expiry without a fresh generation.
- **Root cause, confirmed by reading the only two places `prescriptionExpiresAt` is referenced in
  the whole codebase**: it is written correctly at generation time
  (`generate-prescription.ts:654`, "the last real session wins" pattern), but the ONLY place it is
  ever *read* is `shouldTriggerEmergencyDeload` (`emergency-deload.ts:19`) — and there it gates a
  narrow, unrelated case (suppressing re-offering a *pending* emergency-deload while its own offer
  window is open). **Nothing anywhere compares `prescriptionExpiresAt` against `now` to force
  regeneration of an `auto_applied` prescription once it goes stale.** The only two conditions that
  ever trigger `needsRegenerate` in `reevaluatePrescriptionForToday`
  (`packages/shared/src/ai-periodization/reevaluate.ts`) are an emergency-deload signal
  (overtraining/illness/injury/ACWR) or a whole-session soreness deload — plain calendar expiry is
  not one of them. `reevaluate.ts`'s own doc comment (lines 84-86) states the intended design
  outright: *"A prescription generated after the previous session is consumed up to 7 days
  later... without re-running Gemini"* — the 7-day boundary is real intent, just never enforced.
- **Effect**: any session type not actually re-run within its own 7-day window keeps replaying its
  last AI-generated numbers indefinitely — no new LLM-computed load, set, or rep progression happens
  for that session until an emergency or soreness signal happens to fire for an unrelated reason.
  This is a plain calendar-time gap, not a per-user data issue — it reproduces for any account
  whenever a session type in their split goes unused for more than a week, which ordinary program
  variety (e.g. an Upper/Lower/Push/Pull/Legs split, a missed week, travel) makes routine, not rare.
- **Compounds with Q-228 on today's Incline Bench Press number specifically**: the replayed 83%
  target was computed against Q-228's separately-poisoned 1RM, so that exercise stacked two
  independent bugs into one dramatic-looking jump. Barbell Overhead Press (this entry) shows the
  bug in isolation — its 1RM basis is correct (57.5 kg, matches the Q-115-corrected true max) but
  the replayed 52% (an original deload-era percentage from 2026-08-06) is simply the wrong intensity
  for a live Intensification-phase set 8 days later.
- **Not yet done**: the fix (an explicit `now > prescriptionExpiresAt` check forcing
  `needsRegenerate: true`) and a sweep for how many other users/sessions are currently serving an
  expired prescription. See Q-229.

### [workouts] 🔴 A stray pre-Q-115 deload log is still poisoning one exercise's prescribed weight (Q-228, 2026-08-14)

- **Live, currently affecting the owner's in-progress workout.** Today's Incline Bench Press
  prescription (Intensification phase) showed **72.5 kg** (83% of an 86.25 kg "1RM"), against a
  genuine recent working weight of 62.5 kg × 6-7 reps at 80% (2026-07-30) — an unearned ~11 kg
  overload the owner caught before loading the bar and reported live.
- **Root cause: Q-115's own corrective migration (`168_q115_whole_session_deload_pr_correction.sql`,
  2026-08-07) fixed 4 of the 5 exercises corrupted by the 2026-08-06 whole-session-deload bug, and
  missed the 5th.** All 5 exercises logged in that one corrupted session still show
  `exercise_deloaded = true`; the migration zeroed `estimated_1rm` on 4 of them (Overhead Press,
  Skull Crusher, Preacher Curl, Pulldown) but Incline Bench Press — exercise 1 of that same session,
  logged 21:41 UTC, just before the migration's audited 21:47-22:09 window — was never touched, and
  still carries the original inflated `estimated_1rm: 85.75`. Confirmed directly against production
  via the read-only admin endpoint, not inferred.
- **Deeper structural gap this exposed: `getLastRealOneRmBatch` (`lib/data/postgres/adapter.ts`)
  never filters on `exercise_deloaded`.** It picks the most recent log with `estimated_1rm > 0`,
  relying entirely on the write-time invariant that a deloaded set always stores `estimated_1rm = 0`
  — an invariant this exact row already disproves. The sibling query `reconcilePersonalRecord` in
  the same file explicitly filters `eq(exerciseLogs.exerciseDeloaded, false)` "mirrors
  shouldCountTowardPr's per-exercise deload gate" — `getLastRealOneRmBatch` is the one query in this
  family missing that same defensive filter, so any future write-time regression (or any other
  straggler like this one) silently poisons the very next prescription for that exercise, for every
  user, with no read-time backstop.
- **Scope, confirmed for the owner's account**: exactly one row (`exercise_logs` id
  `c4e3d87d-b357-4f08-8910-dfe3462611ca`) currently has `exercise_deloaded = true AND
  estimated_1rm > 0` — this is not an ongoing leak, just one missed straggler plus a real gap in the
  defense that let it leak into today's prescription. See Q-228 for the fix (read-time filter + a
  Q-115-style corrective migration for this one row).
- **Not yet done**: the code fix and the corrective migration — this is the live-investigation
  finding, queued for an implementer session.

### [devices][platform] ⚠️ The step-decoder table now loads over the network — NOT device-verified (Q-221, 2026-08-13) · needs: browser

`steps_motion_decoder_2_0_0`'s dequantisation table used to be bundled, so it was always present.
It now comes from session-gated `GET /api/oura-ble/decoder-constants` and is cached client-side
(`cachedFetch`, seeded synchronously). **Verified in the bundle** — none of the table's column names
appear in any of the 154 client chunks of a fresh build. **Not verified on the device**, and the
untested path is the one the caching exists for:

1. one online session (fetch + cache), 2. kill the app, 3. relaunch with no network, 4. walk.

`getLocalStore` returns null in the sandbox and the BLE plugin does not run there, so this sequence
is device-only. Until it is run, treat offline ring-cadence as unproven.

**Known and intended:** before the first successful fetch, ring-cadence confirmation and the cadence
tracker do nothing. `runStepsMotionDecoder` throws on an absent table rather than guessing, because
decoding without it produces plausible wrong physical values. On a genuinely first-ever launch with
no network there is therefore no ring cadence until the app has been online once.

### [nutrition][platform] ⚠️ Barcode scanning failed for the owner ~22:20 Brisbane 2026-08-13, recovered on its own, cause UNRECORDED

**Reported live** ("im still unable to scan barcodes"), then **"its working now — about 1 hour ago
it didnt work"**. It is working; that is the whole of what is established. *Something that stopped is
not something that was fixed.*

**What was checked while it was still fresh:**

- **Open Food Facts is up** — a real product lookup returned `status: 1, product found`, HTTP 200 in
  **0.86 s**. So this is not a repeat of the 2026-08-13 OFF outage.
- **Nothing barcode-shaped reached production.** The live deployment (12:01 UTC) had **9 HTTP
  requests total** and **zero** to `/api/nutrition/*`. Either the attempt predates that deploy, or the
  app never got as far as calling the lookup.
- **`error_events` has nothing, and structurally cannot** — see below.

**Why there is no evidence, which is the actual finding:** `/api/nutrition/barcode` caught its OFF
failure, did `console.error`, and returned 503. It never called `reportServerError`, so the failure
left no row in `error_events` and Railway stdout for that window is gone. **Q-218 gave exactly this
treatment to the sibling `/api/nutrition/scan` route and stopped there.** Fixed now — the barcode
route reports — so a recurrence will be diagnosable. The other **12** `app/api/nutrition/*` routes
still do not report; barcode was fixed because it is the one that just failed, not because it is the
only gap.

**The plausible-but-unproven story:** the same event-loop starvation that measured the owner's photo
scan at *200 in 129,073 ms* (Q-213). Q-213 Stage 2 deployed at 12:01 UTC, and `/api/oura-ble/samples`
— the route that was returning 500s after 27.6 s — now measures **76–458 ms** in production. That is
consistent, and it is not proof: a barcode request was never recorded either way.

**Do not close this from the recovery.** If it recurs, `error_events` will now hold the reason.

### [platform][devices] ⚠️ Production stalls — all three Q-213 stages shipped 2026-08-13; production has NOT yet confirmed it

**Stage 1 shipped.** `aggregateOuraRawSamples` re-read, hex-decoded and re-derived a 35-day window of
`oura_raw_samples` on every BLE sync — **984,862 rows against ~37 days of history**, i.e. the whole
table, to absorb the few minutes a sync carried. Runs outlasted the gap between syncs, went
back-to-back, and pegged the single Node main thread for 15–30 minutes, starving everything else on
the process. Measured symptoms: `/api/version` (no DB, bounded to 5 s) at **122,044 ms**; the owner's
food photo scan at **200 in 129,073 ms** — it worked, the phone gave up first.

It now re-derives only the span an ingest touched. **Measured 10,560 ms → 930 ms (11.4×)** on a
seeded 35-day table; production has ~40× the rows and the narrowed cost does not scale with history,
so the real gain is larger. The `hrSeriesCutoffDs` clamp is load-bearing — without it a narrowed run
would delete up to 13 days of HR series it could no longer rebuild — and is mutation-tested.

**Why this stays ⚠️ rather than ✅:**

- **Not device-verified.** The BLE plugin does not run in the sandbox; the ingest path was exercised
  through the route and repository only, against a seeded table 40× smaller than production.
- ~~**The first rollup after each deploy is still a full-window pass**~~ — **fixed 2026-08-13
  (v1.303.2)**, and it was worse than "expected": measured at **six minutes of a pegged main thread**
  (CPU 1.8, memory 2.19 GB, `/api/version` 10–28 s), paid on every one of the day's five deploys. The
  watermark is now persisted in `oura_rollup_state` (migration 184), so a cold start narrows from
  where the last run reached. **The proof is the next deploy** — that plateau should not recur at
  container start.
- ~~**Stage 2 — move the run off the request event loop**~~ — **shipped 2026-08-13.** The ingest route
  dispatches through `runRollupOffLoop` into a `worker_threads` realm with its own `pg` pool
  (`PG_POOL_MAX=2`; a replica running a rollup holds 12 connections, not 20). Measured main-thread lag
  during a rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. A missing or
  unstartable worker bundle **falls back to in-process**, i.e. to the prior behaviour — proven by
  deleting the bundle and watching the correctness test still pass. Journal:
  [`entries/2026-08-13-rollup-off-the-request-loop.md`](docs/overview/entries/2026-08-13-rollup-off-the-request-loop.md).
- ~~**Stage 3 — the coalescing predicate**~~ — **shipped 2026-08-13.** `frames.length < 255` meant
  "any batch", not "the drain's last batch", so it bypassed its own 8 s window nearly every time. Now
  a trailing-edge debounce with a max-wait (`lib/oura-ble/rollup-debounce.ts`, 3 s / 20 s). Dev:
  three batches in quick succession → three 200s and **one** rollup.
- ~~**The admin redecode route**~~ — **shipped 2026-08-13.** Both phases go through the worker,
  keeping the route's per-phase errors. Journal:
  [`entries/2026-08-13-rollup-debounce-and-redecode-off-loop.md`](docs/overview/entries/2026-08-13-rollup-debounce-and-redecode-off-loop.md).
- **Why this stays ⚠️ with everything shipped:** none of it is confirmed by production yet. The one
  number so far is `POST /api/oura-ble/samples` at **76–458 ms** on the live deployment, against 500s
  after 27.6 s during the outage — pointing the right way, over one quiet hour. Both of the outage
  session's confident cost predictions were wrong and only production caught them. Keep watching
  Railway CPU for the sustained 1.0–1.6 plateaus and `/api/version` latency.

**First production evidence, 2026-08-13** — the ring synced at 15:47 after the watermark deployed:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold start, Stage 1 only (14:45) | 6 min | 1.8 | 2.19 GB |
| seeding pass, with watermark (15:47) | **2 min** | **0.815** | **0.553 GB** |

**But a concurrent ingest still 500'd** at 15:47:33 after 27.6 s, starved by that 2-minute pass. A
non-2xx on `/api/oura-ble/samples` holds the ring cursor and triggers a re-drain. **Narrowing cannot
remove that — only Stage 2 (the worker thread) can**, and that was the hard evidence it was necessary
rather than tidy. Stage 2 has since shipped; **whether it actually holds is a claim about production
and nothing else settles it** — both of the outage session's confident cost predictions were wrong,
and only production caught them.

Keep watching Railway CPU: the sustained 1.0–1.6 plateaus should stop recurring. `/api/version`
latency is the cheapest ongoing probe — it should stay in milliseconds.

### [platform][readiness] A check-in tapped during the local-store init window was silently lost (fixed v1.302.1, 2026-08-13) — NOT verified on device · needs: hardware

- **What happened**: `getLocalStore()` screens out the *dead* store (K4) but not the
  *not-open-yet* one. `_db` is null for the whole of `initSQLite` — versioned upgrade, WAL pragma,
  then a full `reconcileSchema()` pass — which is seconds on the first launch after a release that
  adds a local migration (v25, #1282). A Save landing there hit `if (!_db) return`: nothing
  written, nothing queued to the outbox, `savedLocally = true`, success toast.
- **Confirmed, not inferred**: production has **no `day_checkins` row for 2026-08-13** and no
  client error anywhere to explain it.
- **Fixed in #1292**: `runSQL` waits for an in-flight open and throws on the canonical runtime if
  the DB never opened, so write sites take their API fallback; the morning check-in gained the
  fallback it never had. Reads and cache writes stay soft deliberately.
- **Separately**, both check-in sheets stopped blocking their close on the local write — the
  ~2 minutes of "Saving…" the owner saw was a tap queued behind the sync pull's `applyDelta`
  transaction on the plugin's single SQLite connection. That underlying hold is **not** fixed;
  it is queued as Q-214.
- **Not exercised**: the S25. Native SQLite does not run in the sandbox, so the init window this
  fixes cannot be reproduced here. The on-device check is a force-stop, reopen, and tap Save on
  the readiness sheet within a second or two of the app appearing.

### [workouts] Deload now reduces every exercise, not just prescribed ones (v1.301.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: a branch after the AI prescription block applies `deloadOverrideForGoal` to any
  ai_dynamic exercise the prescription does not cover, when a deload is active. Q-185, owner decision.
- **Expected behaviour change, not a bug**: deload weeks will feel noticeably easier. The owner was
  told this is the largest-change option of the three offered and chose it.
- **Verified end-to-end**: ai_dynamic program, `early_deload_week_start = CURRENT_DATE`, no stored
  prescription. `origin/main` returned all nine exercises at 75% / 3 sets with `deloaded: false`;
  this build returns 50% / 2 sets, `deloaded: true`.
- **Not exercised**: the S25, and the partially-covered case against a *real* model-generated
  prescription (covered by fixture-based unit tests instead).
- **Related open issue**: **Q-211** — a deload week also reduces a *baseline* lift, which the 1RM
  and PR paths both treat as a genuine max effort. Pre-existing, filed not fixed.
### [workouts] Prescription basis changed to the last non-deload session (v1.300.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: `resolveWorkingBasis` returns the last non-deload 1RM outright instead of
  `max(lastLog, seed, allTimePr)`; new `getLastRealOneRmBatch` supplies it and also carries
  `target80`. Q-202, on an explicit owner decision.
- **Expected behaviour change, not a bug**: one light or interrupted session now lowers the next
  prescription. The owner was offered a smoothed "best of the last ~3" variant and declined it. If
  this proves annoying in practice, that variant is a small change from here.
- **Verified end-to-end on the dev server** against a seeded fixture (last real session 72, PR 98):
  `origin/main` returned `estimated1rm: 98`, this build returns 72 with the PR untouched. Adding a
  deload log after it kept the basis at 72 and restored `target80` from 0 to 57.5.
- **Not exercised**: the S25. Nothing here touches safe-area or a native plugin, but the weight
  dial's pre-filled value is a real on-device behaviour and the `target80` half changes it — worth
  confirming the dial opens at a sensible weight on the first session after a deload.
- **Not exercised**: drifted production data. An exercise whose entire history predates the deload
  suppression may carry `estimated_1rm` NULL rather than 0; those are excluded the same way (which
  is correct), but such an exercise falls back to seed/PR rather than to a real session.

### [devices][app-shell] More/Profile ring battery now reads the live BLE poll (v1.290.2, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `components/more/oura-section.tsx` prefers `/api/oura-ble/battery-latest` over
  the frozen Cloud value; `oura-ble-battery-latest` added to `invalidateOuraSync()`; the card's
  tab-show refresh now re-fetches the battery. Q-205.
- **The "Not live" state could not be reproduced locally, in either direction.** It needs the Oura
  Cloud call to *succeed* and return an old timestamp. With no real token the call rejects,
  `batteryLevel` stays null, and the local before-state is **no badge at all** rather than "Not
  live". The fix was verified against that local before-state (no indicator → `68%`); the
  owner-device before-state is established from the code path, not observed.
- **Verified**: seeded `oura_tokens` + one `oura_ble_battery_poll` at 412×915. Fresh poll (12 min,
  68%) → coloured `68%`; aged poll (5 h, 41%) → muted `41%` with
  `title="Ring battery 41%, last seen 5h ago"`. `origin/main` showed no battery indicator in both.
  Seeds deleted afterwards.
- **Not exercised**: the `useRefreshOnTabShow` path (fires on native tab visibility changes), the
  Samsung WebView compositor, and safe-area insets.

### [devices][app-shell] Ring-battery chip removed from Home (v1.290.1, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `OuraBatteryChip` removed from the Home header's right-hand icon cluster;
  `components/oura-battery-chip.tsx` deleted (Home was its only call site). Q-203.
- **Verified in the web sandbox only.** Proven falsifiable first — the local fixture returns
  `{"latest":null}` from `/api/oura-ble/battery-latest`, so the chip renders nothing either way and
  a plain before/after smoke run proves nothing. Seeded one real `oura_ble_battery_poll` row (72%,
  10 min old) and confirmed at 412×915 that `origin/main` renders
  `aria-label="Ring battery 72 percent"` in that cluster and this build does not, with the rest of
  the header byte-identical and no console or page errors. Seed row deleted afterwards.
- **Not exercised**: the Samsung WebView compositor, and safe-area insets (which render as 0 in the
  web sandbox). This is a header layout change, so the header's `pt-safe` clearance is the thing to
  eyeball on the S25 — nothing in the diff touches it, but the row width changed.
- **Also not exercised**: the Health tab's Ring Status card, which is the surface that keeps the
  live battery reading. `OuraSection` early-returns on `if (!data?.connected)` and the local
  fixture has no Oura token, so it could not be made to render here. That it reads the live BLE
  endpoint is established from source, not observed.

### [nutrition] Saved-meal batch servings + local SQLite v25 (v1.292.0, 2026-08-12) — NOT verified on device · needs: android

Journal: [`entries/2026-08-12-saved-meal-servings.md`](docs/overview/entries/2026-08-12-saved-meal-servings.md) ·
plan: [`plans/2026-08-12-meal-plan-portions-and-editing.md`](docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md)

**The local migration is the risk, not the feature.** Local SQLite v25 adds
`saved_meals.servings` as an `ALTER` that has only ever run against the dev harness — native SQLite
does not exist in the sandbox, and this project has had the local DB die on Android twice from
migration bugs. Needs an app launch on a device already holding a **v24** database as the first
device check. All three parts are in place (ALTER + `CREATE TABLE` body + `RECONCILE_COLUMNS`) and
pinned by tests, but that is the shape being correct, not the upgrade being observed.

Also unexercised on device: offline create/edit of a batch meal, and the cross-device pull of
`servings`.

**Behaviour change worth knowing:** raising a meal's serving count changes what its "Log this meal"
button writes — one portion, not the batch. Existing meals default to 1, so nothing moves until a
count is set.

### [nutrition][app-shell] Ingredient search, gram-level meal editing, sheet close-button clearance (v1.290.0, 2026-08-12) — NOT verified on device · needs: browser

Journal: [`entries/2026-08-12-saved-meals-search-and-sheet-header.md`](docs/overview/entries/2026-08-12-saved-meals-search-and-sheet-header.md)

Verified only in headless Chromium at 412×915. Safe-area insets read 0 in the sandbox and Samsung's
WebView renderer is absent, so three things need `docs/device-smoke-checklist.md` on the S25:

- **The `SheetHeader` clearance change is app-wide** (`components/ui/sheet.tsx`), so it touches all
  45 sheet call sites, not just the nutrition ones. Measured correct at 412px; check a few headers
  with right-aligned controls on-device.
- **The grams input** in the meal builder uses a numeric keyboard (`inputmode="decimal"`) that the
  sandbox does not render.
- **Open Food Facts availability is outside our control.** It answered 3/3 probes at ~1.3 s during
  this session but has returned 503 before, which is why the route reports `unavailable: true` and
  the UI says the database is not responding rather than showing an empty list. That failure path
  *was* exercised for real during verification; the success path on a phone was not.

No migration, no schema change and no sync-path change in this release.

### [nutrition] Meal Plan Phase 1 (v1.282.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`entries/2026-08-11-meal-plan-phase-1.md`](docs/overview/entries/2026-08-11-meal-plan-phase-1.md) ·
plan: [`superpowers/plans/2026-08-11-meal-plan.md`](docs/superpowers/plans/2026-08-11-meal-plan.md)

Shipped: build/edit/activate a plan with optional training-rest variants, a six-step setup sheet, a
searchable per-user dietary-restriction picker, the ~4-week review card, the saved-meals uplift, the
`getMealPlan` coach tool, and local SQLite v23 for offline rendering.

**Not verified on device, and the untested surface is larger than usual.** The sandbox reports
safe-area insets as 0 and has no native SQLite, so *none* of the local-store path has run: the v23
upgrade, `getActiveMealPlan`, and the `applyDelta` arms are all unexercised, as is the setup sheet's
real bottom clearance. Needs `docs/device-smoke-checklist.md` on the S25 — specifically an app
launch on a device already holding a v22 database, to prove the upgrade lands.

**The AI does not verify allergens, and no screen claims it does.** Structured capture makes the
restriction reliable; the model's filtering is best-effort. The review step shows ingredients beside
a must-not-contain list and says the plan was written by AI. Do not add a shield, badge or tick to
that screen, and do not let any automatic action depend on the filtering having worked — that is
also why Q-187's prefill must prompt per meal.

**Three gaps in the first cut, fixed in v1.283.0:** the "Save to my meals" switch was decorative,
nothing could deactivate or delete a plan, and "Manage plan" opened the new-plan wizard. Found by
re-reading the shipped code rather than by testing it — worth noting because all three would have
looked fine in a click-through.

**One stale CLAUDE.md entry found, not fixed:** `nutrition/saved-meals-sheet` is listed among the
nine hand-rolled chevron toggles missing `aria-expanded`. It has no chevron toggle at all. Only that
one entry was checked, so the count in CLAUDE.md is left alone rather than decremented on a guess.

**Portions, per-meal reroll, macro bars and a real manage sheet followed in v1.287.0** —
journal: [`entries/2026-08-11-meal-plan-portions-and-controls.md`](docs/overview/entries/2026-08-11-meal-plan-portions-and-controls.md).
Ingredient weights are now sized in code per variant (`scaleIngredientsToTargets`), so a split plan
no longer shows a permanent shortfall on whichever variant it was not sized for; a single meal can
be rerolled without touching the others; each meal shows a bar per macro against its target; and
meals-per-day / training-time / retarget are editable as instant re-splits.

**The riskiest untested change in that batch is offline, not visual.** A re-split deletes the
server's variants and writes new ones with new ids, and `applyDelta` previously only upserted by id
— a device pulling a 5→3 re-split would have rendered **8** meals. The delete-then-insert-by-parent
fix is in, but it can only be exercised on a device that already holds a plan and then pulls a
re-split. Add that case to the smoke run.

**A saved plan is now editable meal-by-meal (Q-192/Q-193, v1.288.0)** —
journal: [`entries/2026-08-11-meal-plan-edit-and-your-own-meals.md`](docs/overview/entries/2026-08-11-meal-plan-edit-and-your-own-meals.md).
Per-meal reroll previously worked only during review, and that was not a UI gap: `meal_plan_meals`
stored a name and four targets and **discarded the ingredients on save**, so there was nothing to
re-scale or replace. Migration 180 persists an ingredient snapshot; Manage plan → **Edit meals**
swaps, rerolls or renames one meal without touching the rest. Setup gained a **Meals you already
eat** step that keeps chosen library meals verbatim (portions resized) and takes free-text steers.

**The v24 local migration is the thing to watch on device.** Unlike v23 (table creation only) it is
ALTER-based, so a device already holding a v23 database is the case that matters, and no local-store
path has ever executed in the sandbox.

**Two near-misses worth remembering when regenerating `claude_ro` views:** capturing the generator
with `2>&1` puts its summary line inside the SQL (migration failed to parse on every boot), and
passing a local `CLAUDE_RO_OWNER_USER_ID` scopes every production view to a user that does not exist
there. Diff a regenerated views migration against its predecessor — the only difference should be
the new columns.

**Typed meals now get looked-up macros, and Saved Meals has a real UI (Q-194/Q-195, v1.289.0)** —
journal: [`entries/2026-08-11-typed-meal-macros-and-saved-meals-uplift.md`](docs/overview/entries/2026-08-11-typed-meal-macros-and-saved-meals-uplift.md).
Typing a meal into a plan calls the existing `/api/nutrition/scan` text mode (no new AI route), so it
becomes a keepable meal rather than only a steer. Saved Meals gained a per-ingredient breakdown, a
macro split bar, a delete confirmation, and multi-select delete.

**Prompt lesson worth keeping:** "do not repeat these" did NOT stop the model regenerating a kept
meal into the very next slot. The wording that works — already proven in the per-meal reroll route —
is "the plan ALREADY contains these; everything you return must be genuinely different food". Found
by reading a real generation, not by review.

**Known limitation, not a bug in the plan:** the nutrition-targets screen still lets you save macros
that do not sum to your calorie goal (the seeded account holds 150P/180C/60F beside 1,750 kcal =
1,860). The plan reconciles at read time — calories win, protein and fat kept, carbs refitted — and
says so on the review step, without writing to the saved targets. Enforcing it at source is a
backlog item on the targets editor.

### [nutrition] Energy Balance + calibrated maintenance (v1.280.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`entries/2026-08-11-nutrition-tracking-review.md`](docs/overview/entries/2026-08-11-nutrition-tracking-review.md)

Shipped: the five-band Energy Balance card on Nutrition, Health and (optional) Home; calibrated
maintenance from logged intake vs weight trend; one calorie target across the app; the
`getEnergyBalance` AI tool.

**Root cause of "it was never visible":** the `energyBudget` card's `case` lived in
`renderTrainingSection` while the key is listed only in `BODY_GROUPS`, and no training order
contains it — so it fell through to `default: return null` on both tabs and had **never rendered
anywhere**. Fixed by moving the case to `renderBodySection`.

**Not verified on device.** Rendering was confirmed at the 412×915 S25 viewport in the sandbox
(Nutrition, Health and Home), but the sandbox reports safe-area insets as 0 and has no native
SQLite, so the card's real bottom clearance and any local-store read path are unexercised. Needs
`docs/device-smoke-checklist.md` on the S25.

**Calibration will not engage for ~2 weeks.** Food logging stopped 2026-07-26 (1 logged day in
August, 11 in July), and the estimator needs ≥10 logged days at ≥70% window coverage. Until then
the card shows the Mifflin-St Jeor baseline with a countdown, which is the intended state, not a
fault. Expect it to switch to "measured" around 2026-08-24 if daily logging holds.

**Production still has two different saved targets** (`users.calorie_goal` 1950 vs
`nutrition_targets.calories` 1750) until the first write after this deploy. Both write paths now
mirror, so any target edit — including accepting the Calorie Nudge — converges them. No migration
was written to reconcile the existing rows.

**Latent (not live): `listBodyMetrics` does not filter `deleted_at`.** The column exists on
`body_metrics`, the repo read ignores it, and the calibrated maintenance consumes those rows for its
weight slope — so a deleted weigh-in (e.g. a bad scale reading) would still skew the estimate.
**Currently harmless: no code path soft-deletes a body metric, and production has 0 such rows of the
owner's** (checked 2026-08-11). Not fixed here because the change touches ~10 consumers and
overlaps open PR #1244's soft-delete work. **If a body-metrics delete path is ever added, this must
be filtered in the same PR.**

**Weekly calorie goals convert on the mirror.** `users.calorie_goal` may be a weekly total while
`nutrition_targets.calories` is always daily. Caught pre-merge: mirroring a 13,650 kcal/week goal
straight across wrote 13,650 into the daily macro target. Both directions now convert via
`goalToDailyKcal`/`dailyKcalToGoal` and the user's daily/weekly preference is preserved.

### [platform][nutrition][readiness] ✅ Deleted rows coming back was 96% untested — COVERAGE COMPLETE 2026-08-11; mood logs' missing server filter is still open (2026-08-09)


Review:
[`docs/reviews/2026-08-09-soft-delete-mutation-coverage.md`](docs/reviews/2026-08-09-soft-delete-mutation-coverage.md)
· journal:
[`entries/2026-08-09-soft-delete-mutation-coverage.md`](docs/overview/entries/2026-08-09-soft-delete-mutation-coverage.md)

The ownership mutation harness, pointed at soft-delete filtering. **113 filters neutralised, 371 of
372 tests still passed** — one test notices, as a side clause. Every slice was at zero except
`programs.ts`. **109 of 113 (96%) provably unguarded**, worse than ownership's 38%, on a class whose
symptom is directly user-visible: *"my deleted workout is back"* is the mirror of the
"my data disappeared" reports already tracked here.

**Shipped:** `repository-soft-delete-filtering.test.ts` — 7 tests over injuries, supplements,
activity logs, fitness tests, food logs and workout sessions, each asserting present-before /
absent-after so a failed seed cannot pass. 7/7 fail under mutation. `adapter.ts` 0 → 6,
`nutrition.ts` 0 → 1.

**~~Deliberately incomplete~~ — finished 2026-08-11.** The remaining 35 (`user-stats.ts` 7 in #1244,
`periodization.ts` 17 in #1251, `oura.ts` 11 after that) all have attributable tests now, each of the
35 verified by individual mutation. **All 113 filters in the original sweep are covered or
accounted for.** Two things the burn-down taught, both worth more than the tests:
`getWeeklySetsByMuscleGroup` is two queries with three filters each and a case deleting only one
side leaves the other three untested — *counting* tests would have called it done; and `oura.ts` was
deferred for a whole entry as "needs a seeded rollup window" when its eleven filters are ordinary
work-list queries over sessions and sets. The estimate came from the slice's name.

**One real gap, filed as Q-178:** `mood_logs` carries `deleted_at` on the server *and* the device,
the local store filters it, and **all three server reads have no filter at all** — the device would
hide a deleted mood log while the server returned it. Latent (nothing server-side writes the column),
so filed rather than fixed: adding the predicate and dropping the column are both defensible, and
that is a product question.

**The static sweep followed, and found a live bug — Q-179.** 129 reads of the 13 soft-deletable
tables, 44 without a filter; most correct (13 are in `getSyncDelta`, which *must* return deleted rows
for tombstones, and only 6 of 13 tables are ever soft-deleted server-side). Two are live in-use
probes, and one reproduces: **delete your only food log for a meal type and the meal type is
undeletable forever**, refused with `MEAL_TYPE_HAS_LOGS` citing a log you cannot see.

**The obvious fix is wrong, and only a two-directional test showed it.** Adding the `deleted_at`
filter makes the probe pass, then the hard `DELETE` fails on `food_logs.meal_type_id -> meal_types`
(**ON DELETE RESTRICT**) — trading a clean domain error for a 500. Reverted. Q-179 lays out four
options; the cheapest destroys the sync tombstone. A decision, not a patch.

**Method note worth carrying:** the first mutator matched only Drizzle's `isNull()` and reported 86
filters, silently missing **27 raw-SQL** `deleted_at IS NULL` predicates. A scanner reporting a
*smaller* number is as suspect as one reporting zero. The mutation also cannot see a **missing**
filter — Q-178 surfaced only because a test written for it failed on clean code, and a systematic
static sweep for that has **not** been done.

### [platform][app-shell] ⚠️ The service worker's `/api/` passthrough changed — NOT device-verified (2026-08-09, v1.276.3) · needs: android

`public/sw-template.js`'s `/api/` branch now sends `cache: "no-store"`, and `cachedFetch` does the
same. This closes a measured bug — the browser HTTP cache sat under the app's own cache with no
invalidation path, so `DELETE /api/supplements/<id>` followed by `GET /api/supplements` kept
returning the deleted row for up to a minute (verified on a route that already ships the header on
`main`, so this was live, not hypothetical).

**The risk is where it was fixed, not what it fixed.** The service worker is the APK's network path
*and* its offline cold-start mechanism, and it deploys automatically (`app/sw.js/route.ts` stamps
the commit SHA into the template). Verified in Chromium — every main screen renders with the SW in
control, no `/api/` 4xx/5xx, and `POST /api/mood` (a write with a body, the case `no-store` could
plausibly break in a SW) returns 200 — but **not on the S25**. Also unexercised: the real offline
path with a populated seed. A service-worker fault on device is not subtle, so this belongs on the
next device smoke run.

### [app-shell][platform] ✅ One of the two sign-out buttons left the previous account's data on the device — fixed 2026-08-10 (Q-172, v1.277.3)

More → Profile signs out through `clearLocalStoreData()` → `clearAllCache()` → `signOut()`.
`components/chat.tsx` has **two** sign-out buttons (`:554`, `:636`) that post a bare
`<form action={signOut}>` and do neither. After signing out that way, `ta_cache:*` and the native
SQLite store still hold the previous account's data, and most cache keys carry no user id
(`weekly-stats`, `readiness-score`, `home-day-timeline`), so the next account paints from them via
`readCacheSync` before any fetch returns.

Invisible today — one account per device — and squarely in the way of the multi-user/Play Store
direction recorded in the Canonical Runtime note. The localStorage half was proven in the browser;
the native SQLite half was inferred from the absent call, not observed.

**Fixed 2026-08-10 (#1235, v1.277.3)** — and the fix was larger than the finding: reading the
sign-out that *did* work found `clearLocalStoreData()` was a hand-written list drifted to 27 of the
schema's 37 tables. See the Current Status entry above and
[`docs/overview/entries/2026-08-10-sign-out-clears-device.md`](docs/overview/entries/2026-08-10-sign-out-clears-device.md).
⚠️ **Still not device-verified:** `clearLocalStoreData()` is a no-op on web, so the local-store half
has never actually run.

### [platform][nutrition] 🟠 90% of the DB suite is blind to a total loss of user scoping (measured 2026-08-09)

Full method:
[`docs/reviews/2026-08-09-ownership-mutation-coverage.md`](docs/reviews/2026-08-09-ownership-mutation-coverage.md)
· journal:
[`entries/2026-08-09-ownership-mutation-coverage.md`](docs/overview/entries/2026-08-09-ownership-mutation-coverage.md)

**The scoping is correct today — this is not a live leak.** Q-155 said one cross-user leak passes all
tests; mutation testing turns that into a number. All **246** `user_id` predicates in
`adapter.ts` + slices were neutralised at once and **286 of 317 DB tests still passed**.

- **`nutrition.ts` (22 predicates), `body-battery.ts` (1) and `social.ts` (1) fail ZERO tests** with
  every ownership check removed. Two quartiles of `adapter.ts` (69 predicates) behave the same.
- **Lower bound: 93 of 246 predicates (38%) unguarded.**
- The uncovered set includes ten destructive writes (`deleteInjury`, `deleteSupplement`,
  `deleteActivityLog`, `updateFoodLog`, `deleteSavedMeal`, …) and the bulk mutations
  `applyLbsToKgFix` / `reconcilePersonalRecord`. **`updateInjury` is among them** — the method
  CLAUDE.md calls *"the reference"* for the write-path ownership rule.
- The 31 tests that did fail are weaker evidence than they look: the failing set **varied between
  runs** (14–17 files), because with scoping gone the tests contaminate each other by execution
  order. Only 7 of 71 DB test files set up two users at all.

**Burn-down done across three passes, same day.** `repository-ownership-scoping.test.ts` is now
**36 tests**, each verified to fail under mutation. Re-measured: all-246 detection **31 → 75**,
detecting files **14 → 21**, `adapter.ts` **23 → 44**, slices nutrition **0 → 12**, body-battery
**0 → 1**, social **0 → 2**, and the two dead `adapter.ts` quartiles **0 → 13** and **0 → 7**.
**No quartile and no slice sits at zero.** The bulk mutations that worried me most —
`applyLbsToKgFix`, `previewLbsToKgFix`, `reconcilePersonalRecord` — are covered, two-sided (empty
result *and* the other user's stored rows unchanged).

**Fourth pass — the blind spot, audited statically (Q-174 filed).** Mutation cannot see ownership
enforced by a join or pre-check, so all **50** writes to `user_id`-less tables were classified by
hand. **13 of the 14 parent-id-keyed writes are correct** — `saveProgram`, `saveProgressionStyle` and
`updatePhaseSet` all carry affected-row-count guards citing Q-129, and `activity_types` is a global
catalogue behind `requireAdmin`. The one gap is the **volume-target family**: four methods taking a
`programId` with no `userId`, over a table with no `user_id` column, of which two have zero callers.
Safe today; filed as **Q-174** — and **fixed the same session**:
`listVolumeTargets(userId, programId)` now scopes via an `innerJoin` to `programs`,
`replaceVolumeTargets(userId, programId, targets)` carries an ownership pre-check with a row-count
guard inside the transaction before the DELETE, and the two dead methods were deleted rather than
fixed. Three new tests, mutation-checked, including a **positive** case proving the owner is still
permitted — without it, a guard that rejected everyone would have passed. Read-side over-filtering
was checked on a running dev server: a seeded target returns `{"targets":{"chest":16}}` for its
owner, and a forged `programId` returns 404, not 500.

**Q-155 stays open, and the reason matters.** "No range at zero" is far weaker than "all 246
covered": the quartile bisect bounds rather than attributes, so a range producing 7 failures is not
34 covered predicates. Exact attribution needs ~246 individual runs. Untouched entirely: ownership
enforced by a join or pre-check instead of a `user_id` predicate, and the full ~3,270-test suite —
only the 363 DB tests were measured.

**Carry this into any addition:** **four** assertions in that file could not fail as first written —
`getBodyBatteryHistory` returns a row shape with no `userId`, making `not.toContain(USER_B)`
unfalsifiable; `deleteFitnessTest` is a soft delete, so asserting on an untouched column could never
fail; `deleteMealType` throws `MEAL_TYPE_HAS_LOGS` before reaching the ownership check; and
`listSeasonsWithResults` reads a global table, so a leak attaches B's rank to a season A may
legitimately see rather than adding a row. Every one was caught only by running the new test under
mutation as well as clean. **Do that for each addition before counting it as coverage.**

**Limits:** DB suite only (317 tests), not the full ~3,270 — route/component tests were not measured.
Ownership enforced by a join or a pre-check (`ensureWorkoutSession`) is untouched by this method.
Local Postgres only; no device, no production data.

### [platform][app-shell][workouts] AI Coach is NOT verified on device (2026-08-09, v1.271.0–v1.273.0) · needs: browser

**This is the device gate for Q-157 phases 1 and 2, recorded because no S25 was available in the
session that built it.** Everything below was verified in Chromium at 412×891 in both themes and
against the local dev database; none of it proves anything about the phone.

- **A second full-screen surface since this row was written:** `/coach/confirm/[toolCallId]`, the
  tier-3 hold-to-confirm screen, has the same navless bottom-anchored shape as the composer and
  the same unverified inset.
- **The one that matters: composer clearance.** `/coach` is a **navless full-screen route with a
  bottom-anchored composer** — the exact shape that has put a control under the gesture bar 11+
  times. It uses the floored `pb-safe-action-lg` and measures 64px of clearance in the sandbox, but
  the sandbox renders `env(safe-area-inset-bottom)` as **0**, so that 64px is the floor doing all
  the work and the real inset has never been added to it. Also unchecked with the keyboard open.
- **Header clearance** under the status bar / punch-hole (`pt-safe-or-4`).
- **Samsung WebView rendering** of the widget cards (`color-mix` tints, no blur/filter used).
- **Real touch** on the 56dp FAB, the 48dp back/history buttons and the 56dp option rows.
- **Offline behaviour behind the service worker** — airplane mode was not exercised; only
  `navigator.onLine` was.

Run the **AI Coach** section of [`docs/device-smoke-checklist.md`](docs/device-smoke-checklist.md)
and strike this row. Nothing here blocks use of the app — the three entry points and every other
screen are unchanged — but a composer under the gesture bar would make Coach awkward to type into.

**Also in this release, and worth a look on-device:** every `<Switch>` in the app rendered as a
black circle (the global 48px tap-target floor beats Radix's `h-5 w-9`); fixed in the shared
primitive, so the **goal-recommendation sheet** in Profile is the other surface to eyeball.

### [platform][app-shell] Three rules mechanised, one CI blind spot closed, two cache findings queued (2026-08-09)

Journal:
[`docs/overview/entries/2026-08-09-ci-enforcement-and-cache-findings.md`](docs/overview/entries/2026-08-09-ci-enforcement-and-cache-findings.md).
**No app behaviour changed** — CI scripts, workflow config and docs only.

**The pattern behind all of it:** every rule checked this session was either *in CI and holding* or
*written down and drifting*, with nothing in between. `check-timezone-rendering` has kept
device-local rendering at zero since it landed; the sparkline count went 5 → 6 days after it was last
re-verified by hand.

**Shipped (#1192, #1193, #1194):**
- `check-numeric-bounds.js` — an unbounded `z.number()` in a validation schema (Q-164). The
  `activity-log.ts` grandfather row was **deleted 2026-08-09** when that file was bounded in full, so
  the check now holds every schema in `validation/`+`validators/` with no exceptions.
- `check-sparkline-primitive.js` — a `<polyline>` instead of `components/ui/sparkline.tsx` (Q-154),
  six existing copies grandfathered. **Q-154 stays open** — the check stops a seventh, it does not do
  the replacement work.
- `check-local-column-upgrade-path.js` — closes a **real blind spot found by mutation-testing the
  existing checks**: `check-reconcile.js` scans `ALTER TABLE … ADD COLUMN`, so it cannot see a column
  added to a `CREATE TABLE IF NOT EXISTS` body. That column reaches fresh installs and is **missing
  forever** on upgraded devices, throwing on every `INSERT` that names it while tests, the web
  sandbox and fresh installs all stay green — the #85 class. **Zero live instances** across all 41
  commits touching `migrations.ts`, so it ships with no grandfather list.
- Three inline Custom Rules greps widened past `app/ lib/ components/` to include **`packages/`** —
  229 files, 21% of the TypeScript surface, and where `date-utils`, the validation schemas and the
  health formulas live. Verified clean at the new scope.

**Queued, not fixed:** **Q-165** — 171 client GETs use `cachedFetch`, **62 use bare `fetch`** (29
admin/debug consoles that should *not* be swept, 33 user-facing, ~24 genuine render-path reads after
excluding nine with a real reason to stay uncached). ~~**Q-166** — 44 of 124 GET routes carry no
`Cache-Control`, 24 after excluding admin/OAuth/webhook routes.~~ **Q-166 is done (2026-08-10), and
it inverted:** the headers came *off* rather than being added, and the ~13 headerless data routes got
an explicit `private, no-store`. Work Q-165 next; the client side is what the user sees.

**A deliberate non-decision worth keeping:** Q-165 is explicitly filed as *not* a CI-check candidate
yet. With nine legitimate exceptions in 33 cases, the exemption list would be as long as the violation
list — a rule that documents drift rather than preventing it. That is the opposite call from the two
checks above, and the difference is the size of the exception set.

**Not verified on device.** Nothing here touches runtime, but the local-column hazard is device-only
by nature and was confirmed by reading `reconcileSchema()` and by history sweep, never by running an
upgrade on hardware.

### [activity][platform] 🟠 A 69-day walk was accepted — and my own Q-151 was wrong (2026-08-09)

[`docs/reviews/2026-08-08-adversarial-input-review.md`](docs/reviews/2026-08-08-adversarial-input-review.md).

**✅ Q-164 — FIXED 2026-08-09 (v1.275.2).** `POST /api/activity-logs` with `durationMin: 100000`
returned 201 and persisted a single walk lasting 69.4 days. All 28 unbounded numerics in
`activity-log.ts` now carry named upper bounds, and the check's grandfather row is gone.

**Why the existing cross-field refine could not catch it.** Every rate check in
`activityImplausibleReason` divides by `durationMin` and is skipped when it is absent or zero — so a
single field on its own met nothing at all. The two layers are complementary, and the new
single-field ceilings close exactly the hole the rate checks leave. Bounds are **derived** from the
existing rate constants (`MAX_ACTIVITY_DISTANCE_KM = MAX_AVG_SPEED_KMH × 24 h`, and so on) so a
ceiling can never contradict the per-minute check beside it.

**Two of the entry's claims were wrong and are corrected here.** (1) The HR fields were *already*
bounded — the plausibility refine rejects `avgHr: 9999` today, so they were never part of the gap.
(2) The entry said an over-long duration "produces an end timestamp days later and can push an
activity into the wrong day bucket". It does not: `addMinutes` wraps at `% 1440`, so
`addMinutes('08:00', 100000)` returns **18:40 the same day**. That wrap is instead what *justifies*
the 1440-minute ceiling — beyond a day the value is unrepresentable anyway.

⚠️ **The entry's "plausible typo" case is NOT caught, deliberately.** 1000 minutes for 100 is
16.7 hours, which a real ultra reaches; a physiological bound that rejected it would reject a good
day. Pinned as a passing test so the limitation is visible rather than assumed fixed — catching
typos needs a confirmation prompt, not a tighter ceiling.

Closed the way it was opened: **POSTed against the running route.** The four reproductions now
return 400 and a real 90-minute walk still returns 201 (probe row deleted).

**Correctly rejected in the same sweep:** negative durations, a 500-char emoji/RTL title, out-of-range
body fat, and every bad weight. The gap is specifically the *upper* end of otherwise-validated
numerics — a narrower and more fixable statement than "validation is weak".

**❌ My Q-151 was a false positive — refuted by #1184, correctly.** I claimed `/sign-in` carried a live
React #418 and tied it to production's 153-hit series. Zero of 272 production #418s are on `/sign-in`;
the series stopped 19 minutes after Q-73's deploy; it does not reproduce in eight runs across dev and
a production build. **What I actually saw was a dev-mode React hydration warning**, which the
production build does not emit — and I attributed a production count to a route **without checking the
`url` column, while already querying that table**. One `GROUP BY url` would have killed it before
filing. Recorded because the reasoning error generalises: *"I saw an error on page X" and "the counter
for that class is high" are two claims, and joining them needs evidence, not adjacency.*

**✅ Boundary dates clean — zero 500s across four date routes, twelve inputs.** The class CLAUDE.md has
been burned by repeatedly. `2026-02-29` rejected and `2024-02-29` accepted is the strongest signal:
real calendar validation, not a regex that looks right. Slashes accepted, malformed rejected. Q-130's
hardening holds.

**✅ Concurrent duplicate submits — checked, mitigated, NOT filed.** Five identical concurrent POSTs
create five rows (no server idempotency), but the real save paths carry the client guard CLAUDE.md
prescribes: `done-activity-screen.tsx:65,423` (`saving` + `disabled`) and `walk-summary.tsx:55,112`
(a `savedRef`, the stronger ref form). My probe bypassed the UI. Filing it would have been a false
positive — noted rather than queued.

**⚠️ Contrast: third attempt, definitive stop.** This time starting with a self-test — black on white,
expect ~21:1. **It returned 1.96:1**, so the method is broken in a case whose answer is known and no
measurement from it should be believed. The self-test did immediately catch a `clip` key-name bug
(`w`/`h` vs `width`/`height`) that likely caused attempt 2's uniform 1:1 results. Contrast stays
**unmeasured**; the self-test harness is what the next attempt inherits.

### [app-shell] 🔴 The home header shows the WRONG DAY for a non-Brisbane user — OBSERVED live (2026-08-08)

Lens 12 + empty states —
[`docs/reviews/2026-08-08-multi-user-and-empty-state-review.md`](docs/reviews/2026-08-08-multi-user-and-empty-state-review.md).
A second account was **seeded and driven**, not reasoned about.

**✅ Q-163 — FIXED 2026-08-09 (v1.275.1).** Logged in as an `America/New_York` user at **18:52
Saturday their time** (08:52 Sunday in Brisbane), the app showed them header date **"Sunday 9
August"** — a full day ahead — and **"Good morning"** at 6:52 PM. Fourth appearance of the class
after Q-73, Q-144 and Q-148, and the one that finally removed the cause rather than the instances.

**It was six sites, not the four listed.** The two extra were load-bearing: the calendar-day key
built from local-store history (`session-select-content.tsx:376`) has to match the keys the week
strip uses, so fixing one without the other would have shipped a *new* day-off-by-one inside the fix;
and `workout-select-content.tsx:22` held a second independent copy of the same hardcoded helper.
`overview-screen.tsx` also had a bare `todayInTz()` keying a **body-metric write** — the same defect
on a write path.

**The comment was half the bug.** `session-select-content.tsx:99-100` defended the hardcode —
*"the server buckets workout/rest days in AEST regardless of device timezone"* — which **was true
when written and Q-144 (#1161) made false**. It is deleted. `dayKeyInTz(tz, daysAgo, at?)` now lives
once in `packages/shared/src/date-utils.ts` and the `aestDateString` prop was renamed `dayKey`,
because a name asserting AEST is the same trap as the comment.

**Verified with three zones, because two cannot prove it** (the Q-148 lesson: device-local and the
`DEFAULT_TZ` fallback are indistinguishable unless all three differ). User `America/New_York`, device
`Europe/London`, fallback `Australia/Brisbane` — hours 08/13/22 at run time. Rendered: **"Good
morning"**, i.e. the user's own zone. Planting the hardcode back reproduced **"Good night"** for a
user at 08:40 their own time. ⚠️ **Not verified on the S25** — these are all Home-screen surfaces on
the APK.

**✅ Cross-user isolation verified by attack, not by reading.** As user B: four read probes at A's
session (404/401/404/404) and five write probes at A's injury and program (401/401/404/404/404).
**Nothing leaked; A's rows verified unchanged afterwards.** Corroborates the 2026-08-07 read-based
verdict empirically. Minor inconsistency noted, not filed: the same condition returns 401 on injuries
routes and 404 on programs routes.

**✅ Empty states clean — and it kills a standing hypothesis.** Every page driven as a user with no
program, no logs, no ring: all render, zero `pageerror`. Production's unexplained client bursts
(`Cannot read properties of null`, `.reduce is not a function`) were suspected to come from
sparse-data screens. **They do not** — that does not explain them, but it removes the obvious
candidate.

**Onboarding fact worth having:** `users.is_active` defaults to **false** and `middleware.ts:23-26`
sends inactive users to `/pending`. The app is invite-gated by default — a new account authenticates
but reaches nothing until someone flips the flag. Correct today; it is the gate a Play Store
self-service signup would have to change.

**NOT done:** adversarial values, boundary dates, offline, rapid double-tap — all need write flows and
were not reached. No device.

### [app-shell] 🟠 Lens 10 — mobile UI vs Material/WCAG: 7×7 px tap targets, and contrast that could NOT be measured (2026-08-08)

[`docs/reviews/2026-08-08-mobile-ui-standards-review.md`](docs/reviews/2026-08-08-mobile-ui-standards-review.md).
Judged against **Material 3 and WCAG 2.2 AA**, not the repo's own rules — measured in a real browser
at 390×844 with a logged-in session, both themes.

**🟠 Q-160 — the session carousel dots are 7×7 px.** Material wants 48dp; WCAG 2.5.8 AA wants 24×24.
And it is deliberate: the app *has* a 48px floor (`globals.css:538-543`) and the dots opt out via
`.tap-dense` (`:540-544`), whose documented purpose is *"inline text buttons"*. **A carousel dot is
not an inline text button.** Stated fairly, WCAG's *equivalent alternative* exception may apply since
the carousel swipes — but 7×7 on a 6.9" screen fails the intent regardless. The fix is conventional:
keep the dot 7px visually, pad the hit area to 48px. Then audit the other `.tap-dense` users, because
the opt-out is doing more than its comment claims.

**Q-161** — three inputs use a placeholder as their only label (both `/sign-in` fields and the `/chat`
textarea), so the field's identity vanishes exactly while the user types. **Q-161** — six controls
expose no accessible name, including a **Radix Switch** that announces "switch, on" with no indication
of what it toggles. Not a duplicate of Q-133, which covered `aria-expanded` on disclosures.

**⚠️ Contrast was NOT measured, and that is the biggest gap.** Two methods, both invalid. (1)
Computed-style with an ancestor background walk produced ten tidy sub-4.5:1 results that were
**identical in light and dark** — the tell. The theme did switch, but `body` computes to
`rgba(0,0,0,0)` in both, because this app paints via the dynamic-background layer, so the walk fell
back to assumed white **in both themes**. Those numbers are discarded, not reported. (2) Pixel
sampling from a screenshot returned exactly **1:1 for every element**, impossible for visible text.
§4 of the review records what a working method needs. **The `DetailHero` hardcoded-dark case remains
unverified.**

**Also not covered by Lens 10:** `prefers-reduced-motion`, Android text scaling, keyboard/focus order,
per-screen error/empty/loading states, destructive-action confirmation, numeric `inputMode`. No
device, so no Samsung WebView compositing, no real safe-area insets, no actual touch.

### [platform] 🟠 The rulebook is wrong and the test suite is blind to a cross-user leak (2026-08-08)

Lenses 9 and 11 of the deep review —
[`docs/reviews/2026-08-08-claude-md-and-test-suite-review.md`](docs/reviews/2026-08-08-claude-md-and-test-suite-review.md).
Two questions nobody had asked: **is CLAUDE.md true**, and **does the suite actually test anything**.

**🟠 Q-155 — a cross-user data leak passes all 3,270 tests.** Measured by mutation: removing the
`user_id` scope from `adapter.ts:1852` (`getBodyMetricsBaseline`, live on two routes) leaves the
suite fully green — **414 files, 3,270 tests, 0 failures**. Read it correctly: the 2026-08-07 review
certified ownership clean *by reading* and was right, the scope **is** correct today. The gap is that
**nothing would tell you if it stopped being right**, in the highest-severity class this project has.
Supporting signal with its limits stated: 180 of 286 repository methods appear in no test by name —
a crude proxy for *where to look*, not a count. Separately, breaking a `scoreBand()` threshold fails
exactly **1** test, for a formula 18 call sites consume.

**✅ Q-153 — FIXED 2026-08-09.** CLAUDE.md instructed an import that does not compile: nine modules
moved to `packages/shared/src/` and the rulebook still named them under `lib/`. The Timezone
section — which the document itself calls *"a strict rule"* — showed
`import { todayInTz } from '@/lib/date-utils'`, a path **0 files use** against 197 using
`@trainingai/shared/date-utils`. All thirteen occurrences corrected (four of them
`lib/changelog.ts`, which two sessions had already had to grep past), plus the header sentence of
the One-Formula rule, which claimed domain math *"lives exactly once in `lib/`"* and would have sent
a reader to the wrong directory.

**The durable half is the point.** `scripts/check-claude-md-paths.js` now fails CI (Custom Rules) on
any backticked path or `@/…` import specifier in CLAUDE.md that does not exist, with a
`-> moved to packages/shared/src/…` hint when it can work one out. Template filenames
(`<pillar>`, `YYYY-MM-DD`) are skipped, and genuine exceptions — the deliberate *"there is no
`lib/health/score-band.ts`"*, the unbuilt APK artifact — sit in a `DELIBERATE` map that requires a
written reason per entry. It found exactly the nine the review did, independently, and was verified
to fail on the original `@/lib/date-utils` line. **A wrong path in a rulebook is worse than one in
code: nothing compiles it, so it rots silently and gets copied confidently.**

**Q-154 — a sixth inline sparkline shipped days after the rule was re-verified.**
`components/health/day-detail/day-sections.tsx:57` hand-rolls an HR chart instead of using
`components/ui/sparkline.tsx`, arriving in #1136. CLAUDE.md records the count as eight; it is nine.
The finding is as much about the rule as the file — *"replace on touch"* is enforced by reviewer
memory alone, which is to say by nothing.

**Also drifted (improving):** hex literals 455 → **430**; score-band call sites 17 → 18.

**NOT done:** Lens 10 (mobile UI vs external standards) and Lens 12 (multi-user scale) not run; the
rest of the CLAUDE.md audit — rules contradicted by their own code, rules that could become CI
checks, rules now obsolete — not started. No device.

### [workouts][app-shell] 🔴 A same-day mood check-in with zero sore muscles doesn't clear an already-on-screen whole-session Deload recommendation (found 2026-08-09, NOT fixed)

Owner asked why the Lower pre-workout screen recommended a whole-session Deload — "Most of this
session's muscles are still sore (Glutes, Quads, Back, Hamstrings)" — when "there was no training of
those muscles within 48 hours." Traced to source rather than dismissed as an odd recommendation.

**Confirmed real against production data, not a soreness-detection accuracy question.** The
whole-session deload trigger (`computePerExerciseDeload`,
`packages/shared/src/ai-periodization/per-exercise-deload.ts:60`) escalates whenever more than half
a session's exercises match a mood-log self-reported sore-muscle label — it never independently
checks whether a muscle was actually trained within any time window at prescription time, despite
the banner's phrasing reading like automatic detection. Queried `claude_ro.mood_logs` directly:
today's check-in (`log_date` 2026-08-09, `created_at` 22:31:07 UTC = 08:31 AEST — essentially the
same minute as the owner's screenshots) recorded zero sore muscles (`body_state: []`); **yesterday's**
check-in (`log_date` 2026-08-08) listed all four muscles named in the stale banner among its nine.
The server's fallback logic (`todayMoodLog ?? yesterdayMoodLog`, `app/api/workout-data/route.ts:496`)
correctly prefers today's log via nullish coalescing when one exists — so this match is only
possible if the rendered screen held a prescription computed *before* today's check-in was saved.

**Root cause: the mood check-in's save handler never triggers a refetch of the screen showing the
prescription it affects.** `MoodCheckInSheet` has exactly one call site
(`app/session-select/session-select-content.tsx:1438-1443`), wired as
`onSaved={(log) => setMoodLog(log)}` — a purely local state update that only feeds the check-in
card's own display, confirmed unconnected to the `workout-data` fetch by grep. The save handler
does correctly call `invalidateCheckinAffectsPrescription()`
(`components/mood-checkin-sheet.tsx:242`), which clears the right cache groups — the invalidation
half of this pattern is fine. What's missing is the refetch trigger: nothing calls
`fetchWorkoutData()` or bumps `refreshTick` afterward, so the already-rendered screen keeps its
stale in-memory prescription until an unrelated remount or the header refresh button, which already
calls the correct function (`fetchWorkoutData()`, same file, line 1086) — proof the fix is wiring an
existing function to a new call site, not writing new logic.

**Real downstream harm, not cosmetic**: a materially wrong training prescription (a full-session
deload cutting working weight ~50%) directly contradicting the lifter's own same-day self-report,
silently persisting until an unrelated screen action happens to force a refetch.

**✅ Fixed 2026-08-09 (Q-158, v1.275.0).** `onSaved` now refetches and bumps `refreshTick`. One
thing the plan did not anticipate: the sheet fired `onSaved` *before* invalidating, which is
harmless for a callback that only sets state and wrong for one that refetches — the refetch would
have read the stale `workout-data` cache straight back — so the invalidation is awaited first.
Proven both ways in a browser at 412×891: pre-fix a save fires only `POST /api/mood`; post-fix it
also fires `workout-data?tab=meta`, `next-session`, `workout-data?tab=all` and `readiness-score`.
(Filed here as Q-159 while #1187 was open; it landed on `main` as **Q-158**.)

### [app-shell][platform] 🟠 The first review to RUN the app — unauthenticated calls on the login screen (fixed), and a second live hydration bug (2026-08-08)

[`docs/reviews/2026-08-08-running-app-review.md`](docs/reviews/2026-08-08-running-app-review.md).
Step 0 + part of Step 1 of the deep-review prompt — **not** the full twelve lenses. What makes it
worth reading: it was **observed in a running browser**, and two of these had survived 25 read-only
reviews.

**✅ Q-150 — the signed-out login screen no longer calls the API at all. FIXED 2026-08-08 (v1.270.31).**
`components/sync-provider.tsx` guarded `pushMutations`/`pullDelta` on `userId` but not the cache-warm
phase or `maybeSyncOura`, which fired **`POST /api/oura/sync`** — an expensive external sync — before
login. `SyncProvider` sits in the root layout, so it happened on **every** signed-out route.
**Measured, not estimated: the real count is 22, not 12** — phase 3 sleeps 2.5 s then warms all 20
`CACHE_TASKS` in chunks of five, so the review's network-panel read caught roughly the first two
chunks. A scripted browser watching for 12 s after load records 22 before, **0** after; signed in,
the warm cycle and Oura sync still fire with 0 401s. The **four native-only reminder reconcilers**
were swept in the same PR — on the APK they fetched meal types, next session, supplements, readiness
and body battery before login too, which the browser reproduction structurally could not show.
⚠️ **That native half is unverified on device** — the sandbox cannot reach it, so what is proven is
that they cannot fire signed out, not that reminders still schedule correctly signed in on the S25.
Phase 1 (sessionStorage mirroring, no network) and the two BLE radio effects stay ungated on purpose;
a failed step post re-queues in its own retry buffer against a server that dedups, so nothing is
lost. Held by `components/__tests__/sync-provider-auth-gate.test.ts`, a source-text check because the
repo has no jsdom environment — verified to fail on a planted regression.

**⏳ Q-151 — REFUTED 2026-08-08, and it looks like Q-73 did close the class.** Filed as "React #418
is NOT closed — `/sign-in` has a second, independent instance". Three measurements say otherwise
([journal](docs/overview/entries/2026-08-08-signin-hydration-refuted.md)). **(1)** Production has
**never** recorded a #418 on the sign-in page — `0` of `272` rows; all of them are on `/` (234),
`/more` (15), `/health` (13) and four `/workout` URLs. **(2)** The whole series **stopped at Q-73's
deploy**: last occurrence anywhere 2026-08-07 20:53 UTC, #1130 merged 21:12 UTC, nothing since,
against a 1–13/day baseline for the fortnight before. **(3)** It **does not reproduce** — `/sign-in`
signed out in a scripted browser at 412×915, in a dev server *and* a production `next build`, under
four localStorage theme states (the ones that make the inline theme script mutate `<html>` pre-
hydration), gave **zero console messages in all eight runs**; `Meteors`, `Typewriter` and
`GoogleSignIn` were each read and cleared. ⚠️ **One clean day is one day** — *stopped ≠ fixed* — so
the entry survives as a dated re-check, not a deletion. ⚠️ The **signed-in home** path could not be
reproduced locally at all: `NODE_ENV === 'production'` hard-forces SSL in
`lib/data/postgres/client.ts:16` and the local Postgres refuses it, so login fails under
`next start`; home-after-Q-73 rests on telemetry alone. **Re-run the standing `error_events` query
around 2026-08-15**: if #418 is back, the row's `url` names the real route.

**✅ Q-152 — FIXED 2026-08-08.** `ensureSchema` printed a genuine migration failure
(`cardio_sessions_user_id_fkey cannot be implemented`) in the same format as four benign
`already exists` notices, then continued. Now classified by **SQLSTATE**, not message text: six
idempotency codes (`42P07`, `42710`, `42701`, `42P06`, `42723`, `23505`) collapse into one aggregated
info line; anything else — **including a codeless error** — is a `console.error` carrying its code,
plus a `N failed` summary. **Deliberately not fatal**: a migration that cannot apply is usually
permanent, so failing closed would crash-loop every boot rather than surface anything new.

### [app-shell] ✅ Device-local rendering list triaged — 7 benign, 1 real bug fixed, 2 blocked (2026-08-08, v1.270.22)

The `check-timezone-rendering` CI rule shipped earlier the same day with twelve undifferentiated
files. That was honest but not useful — **"calls `toLocale*` without a `timeZone`" is not by itself a
bug** — so every file was read and classified
([journal](docs/overview/entries/2026-08-08-timezone-rendering-triage.md)).

**7 benign, no work needed:** each builds its Date from calendar components or a **local**-anchored
string, so device-local rendering returns the same calendar date in any zone.

**1 real bug, fixed:** `components/health/strength-trend-card.tsx:42` used
`new Date(h.date + "T00:00:00Z")` — **UTC** midnight — then rendered device-local. Correct on the
owner's Brisbane device (10:00 same day); **a day early anywhere behind UTC**. Now uses
`formatDayShort`, the single-source helper whose docstring already warns against that construction.
Visible consequence, stated plainly: labels change from `6 Jul` to `Jul 6`, because that is what the
shared helper emits — keeping the old order meant a second inline copy.

**2 real but blocked (3 at triage time), and this is the finding worth carrying: 🟠 no client component can read the
user's timezone at all.** `users.timezone` is on the JWT and reaches every API route, but every
*client-side* formatter falls back to `DEFAULT_TZ`. Q-144 was fixable precisely because it was
server-side; `exercise-review-sheet`, `chat` and `stats-grid` render absolute instants and are not.
Filed as **Q-148** — **✅ since shipped (v1.270.29): `UserTimezoneProvider` closed the gap and all
three sites are converted.** The entry's note not to "fix" them by passing `DEFAULT_TZ` — that is
what they already did — is what made the plumbing the item rather than the symptoms. **A third file left the list mid-review and showed a limit of the check:** Q-123
(#1167) switched `exercise-review-sheet` to `formatDayShort`/`formatTimeOfDay`, which default to
`DEFAULT_TZ` when no tz is passed — so it escaped a check that matches `toLocale*String` only, while
still not rendering in the user's zone. Improvement, not correctness; both the script and Q-148 now
say the sweep must cover shared formatters called without a tz, not just `toLocale*`.

The script now composes its list from named `REVIEWED_BENIGN` and `BLOCKED_ON_CLIENT_TZ` sets with a
per-file reason, both still shrink-only. **Process correction:** this change also adds the
2026-08-08 DB review link to `docs/domains/platform/README.md`, which CLAUDE.md required in the PR
that added the review and which was missed there.

### [app-shell][platform] Bundle sizes measured for the first time — and they are NOT the navigation lever (2026-08-08)

Never measured in 25 review documents. Numbers now exist
([journal](docs/overview/entries/2026-08-08-bundle-baseline-measured.md)): **105 kB First Load JS
shared by every route**; `/workout` heaviest at **361 kB**; `/` · `/health` · `/nutrition` · `/more`
all at **316 kB while carrying 235 B of their own code** — so the weight is shared-layer, and
screen-level splitting would move almost none of it.

**Recorded as a negative result, on purpose.** The 2026-08-05 S25 capture already settled where
navigation cost lives: **22 navigations, warm 22 · cold 0, not one fetched an RSC payload**, and the
worst sample (1348.7 ms, ~9× median) was entirely client-side render/mount. Transfer size cannot
explain a cost that involves no transfer, so the evidence still points at **rendering** — Q-51's
file-splitting item — not at bundle weight. The point of writing it down is to stop a future session
re-opening and re-measuring a plausible-sounding thread. Same discipline the Q-127 entry earned the
hard way the same day: a real static import chain whose claimed consequence did not reproduce.

**Still genuinely unmeasured: cold app start.** In-app navigation was captured; the boot cost —
when the shared baseline and a screen's First Load are actually paid — never has been. Needs the
device, filed as **Q-147** with an explicit "do not optimise off the baseline" note.

**Correction to an earlier claim this session:** the `@capacitor-community/speech-recognition`
typecheck/build error was called "pre-existing" — it was a **stale sandbox `node_modules`**, not a
repo defect. `pnpm install --frozen-lockfile` clears it and touches neither `package.json` nor the
lockfile.

### [platform][devices] DB/scalability + dev-tooling review, 2026-08-08 — 4 findings QUEUED, 4 CI rules SHIPPED, no app behaviour changed

Full write-up:
[`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](docs/reviews/2026-08-08-db-scalability-and-tooling-review.md).
The database layer had never been reviewed — 24 review docs, none covering indexes, query plans,
table growth or connection behaviour — and it is also the only layer currently producing unexplained
production faults. Nothing was fixed inline; everything is queued.

**Q-142 was overtaken mid-session and is now half the size it was filed at.** The review found that
`lib/observability.ts` recorded `message`/`stack` only, dropping the Postgres error on `err.cause` —
why **98 `Failed query` events over 30 days carried no diagnosis**. **PR #1150 (Q-107 first half)
shipped exactly that fix the same day**, independently. What remains is the half it did not touch:
`lib/observability/request-error.ts:55-59` still drops the cause, and per `docs/module-map.md` §14
that `onRequestError` path covers **the 80 route files with no `catch` of their own** — more routes
than the one just fixed. Q-142 was rewritten to that narrower scope rather than closed.

**And the leading hypothesis for the fault itself is probably wrong.** Grouping those 98 by the
second they landed in: **77 are a lone query failing while every other query in flight succeeded**,
12 in pairs, 4+5 in two bursts. Pool exhaustion fails everything competing for a connection at once
— that shape covers 21 of 98. An isolated failure fits a per-connection drop or
`statement_timeout: 15_000` better, which means Q-107's queued `getSyncDelta` batching fix may
address the smaller half. Now that the `code` capture has landed this is settleable by one
production `error_events` read rather than by argument: **read the codes before writing the batching
PR.** Recorded on Q-107; this also amends the `/api/sync/pull` row further down.

**🔴 The DB volume problem is re-accumulating faster than documented.** 205 MB post-REINDEX on
2026-07-21 → **421 MB on 2026-08-08** ≈ **12 MB/day**; `oura_raw_samples` is 73% of the database and
its row count **doubled in 18 days** (432,919 → 881,603). Q-46's guard stopped index *bloat*; the
console actions still queued under Q-30 reclaim bloat too. **At this rate the database alone returns
to the ~924 MB alarm level in roughly six weeks whether or not they run** — only D4
(drop-after-pull) or a retention policy changes the direction. Related doc correction: CLAUDE.md's
~3.2 MB/day for this table describes the **device-local** window and has been read as the server
rate, which is ~3× higher. Q-30 updated in place.

**Multi-user debt, now tracked (Q-144).** Three `TODO(tz)` markers (`adapter.ts:1051`, `:1109`,
`slices/oura.ts:1074`) acknowledge `DEFAULT_TZ` is assumed on read paths — with zero references in
the backlog or here, i.e. an orphaned finding. A user outside Brisbane silently gets Brisbane day
boundaries on windows feeding health aggregation. The "app is AEST-only in practice" premise in
those comments no longer holds. **Q-143 is now ✅ FIXED (2026-08-08)** — the clock-anchor full-table
read (17,045 seq scans / 45.3M tuples, latent but linear in a number that only grows) ran inside
`insertOuraRawSamples`, i.e. on **every ingest batch**, not just the rollup as the entry's title
said. It needed exactly three numbers, and now takes them from two single-row reads
(`getOuraClockEpochHead`, `getNewestOuraClockAnchorByUtc`) issued in parallel; cost is now flat in
anchor count. Equivalence with the reduce it replaced is pinned by
`lib/data/postgres/__tests__/oura-clock-anchor-scoping.test.ts`, verified to fail on a planted
regression that drops the epoch scoping. **Server-side only — not verified on device**; it is the
ring pipeline, so the ingest path deserves an on-device drain before it is called done.
**Q-145 is now ✅ FIXED (2026-08-08)** — errors from the 80 catch-less routes are attributed to a
user again, and the dedup key is user-scoped, so one user's fault no longer hides another's.
**The entry's blocking premise was wrong**: it recorded the fix as "not implementable" because
`onRequestError` is handed only `{ path, method }` — that was the repo's own narrowed local type
being read as if it were Next's. Next's `InstrumentationOnRequestError` passes
`{ path, method, headers }`, and the session cookie is in there. `userIdFromSessionCookie` decrypts
it with `AUTH_SECRET` via `next-auth/jwt`; every failure mode yields null and records exactly as
before, the id is UUID-shape checked, and the INSERT retries with `NULL` if it fails — `user_id`
carries an FK and a token can outlive the row it names, so attribution must never cost the error
report. Proven end-to-end against `pnpm dev`: anonymous → `(null)`, signed in → the seeded user's id,
both recorded 27 s apart with identical url+message (the dedup fix, demonstrated at the same time).
⚠️ **Not verified in production or on the APK**, and the FK-retry branch is reasoned rather than
exercised. Gotcha for the next person: **`instrumentation.ts` registers once at boot and does not
hot-reload** — a dev server started before the edit shows no attribution and looks like a bug.

**Shipped: four `Custom Rules` CI checks**, each verified to pass on the current tree and fail on a
planted violation — `check-migration-numbers.js` (duplicate migration numbers; also prints the next
free number), `check-timezone-rendering.js`, `check-date-param-regex.js`, `check-component-size.js`.
The last three carry **shrink-only** grandfather lists: each fails if a listed file is fixed but left
in the list, so the inventories cannot rot. They corrected two counts Q-130 held by hand — 12 files
call `toLocale*String` with no `timeZone` (not 3), and 11 carried a dash-only date regex (not 7).
**That design proved itself within the session:** Q-130 then shipped (#1148) and widened 7 of the
11, and the check failed the merge with *"these files no longer carry a dash-only date regex —
remove them from GRANDFATHERED"*, naming all seven. A hand-written list would have gone on claiming
eleven. Four remain, all of them ones Q-130 never knew about.

**Checked and clean, so it is not re-derived:** index coverage on every hot table is good; `users`
showing 895k sequential scans and 0 index scans is correct at a handful of rows, not a defect; the
BLE ingest path is properly bounded/coalesced/backgrounded with unbounded reads confined to two
admin diagnostics; rate-limit keys are all user-scoped; module-level server state is user-keyed.

**NOT done:** no `EXPLAIN ANALYZE` — the read-only `claude_ro` role reaches curated views, so query
plans are inferred from scan counters, not observed. No real second account was driven through the
app; the multi-user findings are static analysis. No device/emulator/browser, though nothing here
touches a device path.

### [nutrition][platform] Supplements pull-clobber guard + local schema v22 (Q-124, 2026-08-08, v1.270.7) — NOT verified on device · needs: android

`supplements` was the one offline write domain whose `applyDelta` arm could not gate on
`sync_status`, because the local table had no such column. Local migration **v22** adds
`sync_status` and `deleted_at` (with the matching `RECONCILE_COLUMNS` rows, which are the real
authority after a partial upgrade), `applyDelta` gained the `WHERE supplements.sync_status='synced'`
guard and a tombstone arm, local writes now mark rows `pending`, and the sync engine's confirm loop
flips them back via `markSupplementSynced`.

**Everything that actually matters here happens on device and none of it ran on one.** Native
SQLite does not run in this sandbox (`getLocalStore` returns null), so the v22 upgrade path, the
reconcile fallback if it partially applies, and the offline rename → pull → "did it survive?"
sequence are covered by unit tests and code review only. Local migrations have twice killed the
store outright (WAL pragma inside the upgrade transaction, non-idempotent `ADD COLUMN`), so this is
the exact change class that deserves the device check: install the APK, open the app, confirm
supplements still list, rename one offline, let it sync, confirm the rename survives the next pull.

Two things reduce (not remove) the risk: both statements are plain `ADD COLUMN` with no PRAGMA, and
`reconcileSchema()` carries both columns, so a partial v22 heals on the next open rather than
wedging.

Session journal: `docs/overview/entries/2026-08-08-supplements-sync-and-route-hygiene.md`.

### [app-shell] Day-detail screen behind the training calendar (Q-110, 2026-08-08, v1.270.0) — swipe NOT verified on device · needs: android

Tapping a calendar day now opens `/health/day?date=` — a dedicated screen with the day's sleep and
hypnogram, full body composition, derived scores and a whole-day HR trace, swipeable between days.
Verified against the dev server at 412×891 (renders, calendar tap routes correctly, empty day states,
all tap targets ≥48dp, no page errors).

**The device unknown is the swipe, and it is the one worth checking first.** `useDrag` sits on a
vertically-scrolling page; `touchAction: pan-y` should hand the vertical axis to the browser, but this
app has twice lost a session to gesture conflicts (pull-to-sync) and a mouse drag in Chromium is not a
thumb. Nothing else here is device-sensitive — no blur, filter or backdrop-filter, nothing anchored.

**Two known gaps, deliberate:** days never scored show "—" for readiness/activity (the screen reads
`oura_daily_derived` in one query rather than recomputing via `buildDayAudit`, whose ~13-query fan-out
is the shape Q-107 blames for pool exhaustion — if the gap is common, run the existing backfill rather
than making this screen expensive). The old `day-overlay-sheet.tsx` still exists and is still reachable
from other surfaces; retiring it is its own change.

Session journal: `docs/overview/entries/2026-08-08-day-detail-screen.md`.

### [app-shell][cardio][activity] Navless safe-area utility sweep (Q-118, 2026-08-07, v1.269.1) — NOT verified on device · needs: android

Found by the 2026-08-07 full-app review (§2.4): `activity-screen.tsx` renders `<RunActiveScreen/>`
or `<ActiveActivityScreen/>` from the same parent, same navless `/activity` page, same bottom
Pause/Finish action row — but `run-active-screen.tsx` already used the floored `pb-safe-action-lg`
while `active-activity-screen.tsx` used plain `pb-safe-action`, a divergence within the same
feature. `pb-safe-action` is `max(env, 0.75rem)`; under Capacitor edge-to-edge the inset *replaces*
the gap instead of adding to it — the documented on-device failure class `pb-safe-action-lg`
(`max(env + 2rem, 4rem)`) exists specifically to fix.

Swept all 6 flagged sites onto `pb-safe-action-lg`: `active-activity-screen.tsx`,
`fitness-tests/test-active.tsx` (×2), `guided-walk/walk-active.tsx`, `guided-walk/walk-config.tsx`,
`guided-walk/walk-summary.tsx`, `activity/done-activity-screen.tsx`. Pure Tailwind class swap, no
logic changes; both classes were confirmed to already exist as the correct floored variants in
`globals.css`.

**The web sandbox renders `env()` as 0, which is exactly the value this bug depends on** — the
class change is visible in a screenshot (extra bottom padding, no layout breakage confirmed on
`walk-config`'s "Start walk" button) but real Capacitor edge-to-edge inset behavior cannot be
exercised here at all. Needs the on-device smoke run
(`docs/device-smoke-checklist.md`) — specifically: Pause/Finish during a tracked activity, "End
test early" during a fitness test, and "End walk" during a guided walk, checked against the
gesture bar on the S25. Full detail:
[`entries/2026-08-07-navless-safe-area-sweep.md`](docs/overview/entries/2026-08-07-navless-safe-area-sweep.md).

### [app-shell] Cardio Hub entry card on the workout screen (2026-08-07, v1.269.0) — NOT verified on device · needs: browser

The workout screen's "Other Activity" row is now a card matching the session card's inset and
radius, tinted via `--accent-cyan`, naming its three destinations; the `/cardio` heading follows the
rename. Verified against the local dev server at 412×891 — renders, aligns, and navigates.

Low device risk by construction: no blur, filter or backdrop-filter, and the row is not
bottom-anchored, so neither the Samsung compositor bug nor the safe-area floor applies. The one
unexercised surface is Samsung WebView rendering of the `color-mix(in oklch, …)` gradient.

Session journal: `docs/overview/entries/2026-08-07-cardio-hub-entry-card.md`.
Design docs: `docs/design/2026-08-07-other-activity-mockups.html`, `…-cardio-hub-fullscreen.html`.

### [app-shell] Fourteen new home score-card styles (2026-08-07, v1.268.0) — NOT verified on device · needs: browser

The four home score buttons (Readiness / HR / Sleep / Activity) gained fourteen selectable looks on
top of the original five — More → Home widgets → Score Card Style. All nineteen render correctly in
Chromium at 412dp with no errors, and every tap target clears the 48dp floor (tightest: Pill at
89×52dp).

**Two carry real Samsung WebView risk and have not been checked on the S25:** `frosted` uses
`backdrop-filter: blur()`, and `duorail` stacks a low-opacity 58px glyph behind live content. Both
are the shape of CSS behind the known compositor bug that wipes sibling gradients in card grids —
Chrome renders them fine, which is exactly why this needs the APK. The other twelve use no blur,
filter, backdrop-filter or gradient at all and are low-risk by construction. Nothing here touches
safe-area (the row is not anchored), gestures, native plugins or an offline-first domain.

Session journal: `docs/overview/entries/2026-08-07-health-metrics-button-designs.md`.
Design galleries: `docs/design/2026-08-07-score-row-mockups*.html`.

Secondary, non-blocking: the picker is now a flat list of nineteen radio options, which wants
grouping or thumbnails rather than a longer list. Not scoped.

### [activity][devices][platform] 🔴 Q-139 — `resolveDsToMs` compresses ring time by up to 18× during a backlog drain (found 2026-08-07, OPEN)

Found investigating an owner report that app steps read higher than the Samsung Health phone count
(app 4,176 vs phone 3,376 at 21:49 on 2026-08-07). The step gap turned out **not** to be the bug —
see the closing note below — but the investigation surfaced a real one on the shared ring clock.

**What is wrong.** A clock anchor is `(batch max ds, server receive time)`, so its *lag*
(`anchorUtcMs − anchorDs × 100`) is however long that batch took to reach the server. That lag is
not constant: over 2026-08-07's ds range (n=99 anchors) it spans **56.2 minutes**, with a sharp
lower edge (p0→p10 is 1.4 min) and a long upper tail — the signature of true time plus a variable
receive latency. `resolveDsToMs` interpolates linearly between the two anchors bracketing a ds, so
the local time-scale it applies is `Δutc / Δds`. When the ring drains buffered history, ds advances
far faster than the wall clock and that ratio collapses.

Measured on real production frames: ds `28297856`→`28314950` is Δds 17,094 = **28.5 minutes of ring
time**, and it resolves into `12:47:19`→`12:48:54` — **95 seconds**, an ~18× compression. This is not
one bad moment; at the 30 s frame cadence a 60 s block should hold 2 paired windows, and
2026-08-07's blocks hold 79 (11:42), 70 (10:41), 66 (14:01) and 60 (17:11).

**Why it shows up in steps.** `resampleSteps` folds per-sample steps into fixed 60 s wall-clock
blocks, so every window squeezed into one block sums there. 2026-08-07 produced 60 s windows of
**1,555**, 664 and 268 steps — the top one is 26 steps *per second*.

**It distorts placement far more than totals.** Re-running the real rollup over the same frames with
a physically-correct clock (ds ticks at exactly 100 ms; offset = the minimum observed lag) gives
**zero** implausible windows, and moves the day total from 4,178 to 4,652 — and 2026-08-06 from 1,232
to 1,245. So the totals were roughly right and the *timeline* was wrong.

**Blast radius is steps only.** `resolveDsToMs` is used by `step-day-buckets.ts` (the steps rollup
write and `previewStepsBackfill`) and the admin step-counter console — nothing else. Sleep
boundaries, HR bins and temperature go through `measuredAtMs`, a **fixed** 100 ms/ds slope from one
anchor, which carries Q-71's offset error but structurally cannot compress. An earlier draft of this
row said a fix would move sleep boundaries; it will not.

**This is an input to [Q-71](docs/implementation-backlog.md), and partly contradicts it.** Q-71
proposes moving the sleep/HR/temperature paths onto `resolveDsToMs` on the grounds that
interpolation is "the more accurate one". It is more accurate than unbounded newest-anchor
extrapolation, and it still carries this defect — so implementing Q-71 as written would trade an
offset error for a compression error on sleep and HR. Fix Q-139 first; its fix (a robust
non-interpolating offset) is also the right fix for Q-71's paths, letting one converter serve both.

**Watch the monotonic guard.** The rollup recomputes a 35-day window but can only ever *raise* a
stored total (`mergedSteps > existingSteps`), so a clock fix is not "future days only" — recent days
would drift upward wherever the corrected number is higher, while days that should come *down* stay
inflated without an owner-gated `allowStepsDecrease` backfill. Both measured days moved up.

**Second, smaller gap on the same path:** `mergeStepCounterWithLive`
(`packages/shared/src/health/step-estimate.ts`) applies `isPlausibleStepWindow` to **live** windows
only — model windows go through unfiltered. That asymmetry is what let the three impossible windows
above reach the daily total. Worth closing as a backstop, though under a correct clock it would not
have fired on 2026-08-07.

**Reproduction is exact**, so nothing here is inferred: replaying production's own
`computeStepsByDay` over the same anchors and frames returns 4,178 against the stored 4,176.
Full investigation, including the measurement traps that make this expensive to re-derive:
[`docs/handoff-2026-08-07-activity-ring-clock-compression.md`](docs/handoff-2026-08-07-activity-ring-clock-compression.md).

**On the original step question — no tuning is warranted.** 2026-08-07's steps are 100 %
`step_counter` over ring frames: `body_metrics.source_map->>'steps'` is `oura_ble`, and
`step_live_windows` has held no row since 2026-07-28, so no phone or Health Connect value is in the
mix. Correcting the clock moves the ring *further* from the phone (4,652 vs 3,376), which is the
expected direction — a finger-worn sensor counts movement a pocketed phone misses. Applying a scale
factor to close that gap would be fitting a fudge to one day of paired data. Note also that the
rollup's same-day guard is monotonic (`mergedSteps > existingSteps` in `adapter.ts`), so an
over-count from a distorted clock can never self-correct downward.

**Not found by the same-day full-app deep review** (below) — that sweep covered routes and pages;
this sits under the ring rollup's clock conversion.

### [platform][app-shell] Full-app deep review, 2026-08-07 — 53 findings, ALL QUEUED (nothing fixed)

A whole-app review of saving, caching, performance and domain logic across all **201 API routes** and
**40 pages** — the first comparable sweep since 2026-07-20, roughly 400 commits earlier. Eight code
lenses run in parallel, plus two production passes (`error_events`, and **91 days** of
`/api/admin/day-review`). Full writeup, including the coverage ledger and every clean result:
[`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md).

**Nothing was fixed in that PR — it is docs-only.** Findings landed as **Q-117 … Q-138** plus updates
to three existing entries. The four highest-value outcomes:

1. **Q-73's root cause was found and reproduced** — the home-screen React #418 hydration error (138
   hits, still firing) is `session-select-content.tsx:1063`: `toLocaleDateString` with no `timeZone`.
   Railway runs UTC, the S25 runs Brisbane, so for the 42% of each day between 00:00 and 10:00 AEST
   the server renders yesterday's date. **That entry was marked ⛔ "needs a device capture" — it does
   not.** See the correction below.
2. **The `Failed query` faults are one fault, and it is app-wide.** `getSyncDelta` fires **22**
   parallel queries at a `max: 10` pool. It is not sync-specific — `/api/readiness-score` and
   `/api/body-battery` share the signature, which means the "⚠️ cause NOT diagnosed" row for those two
   routes and Q-107 are **the same issue**. It stayed undiagnosed because `lib/observability.ts:9-10`
   discards `err.cause`, where Drizzle puts the real Postgres error.
3. **Two of the four headline scores carry much less information than they appear to.** Measured over
   91 days: the Activity Score is effectively a step counter (r=0.775; `strengthFreq`, its largest
   weight, has been exactly 100 on **91/91 days**), and the Sleep Score's compression traces to four
   saturated contributors. Both are ⛔ owner decisions — Q-137 and the Q-72 update.
4. **A cross-user data leak** (Q-129) and **an activity date filed in the device's timezone rather
   than the user's** (Q-123c) — the latter is persisted data, so it cannot be corrected after the fact.

**Two corrections to previously-recorded claims, both of which had cost real time:**
- **Q-73 and its Known-Issues row state that `/` mounts all five tabs**, so a mismatch in any tab
  surfaces there. **That is false.** `components/shell/tab-shell.tsx:57-61` initialises
  `mounted: [initialTab]`; the rest mount on first activation, which is client-only and cannot
  hydrate. The search space was always the home tab alone — and that wrong premise is what produced
  two dead-end investigations.
- **SEC-H2 is fixed.** A sweep re-reported that `app/api/oura/webhooks` echoes the HMAC signing key
  (from the 2026-07-06 review). It does not — the route returns `{success: true}` and carries an
  explicit comment forbidding it. The claim was dropped rather than passed on. Do not re-raise it.

**Also worth knowing (clean results, so they are not re-audited):** zero persisted-vs-recomputed score
divergence across 88 pillar-days · auth solid (only 6 of 201 routes unauthenticated, all deliberate;
all 25 admin routes re-read the DB) · zero `JSON.parse` of model text · poison-pill handling correct ·
`RECONCILE_TABLES` machine-checked with zero mismatches · instant-paint genuinely done · **the
2026-07-20 Zustand hot-path finding is fixed** · every safe-area utility exists and is the correct
variant · referential integrity clean · `onset_latency_sec` genuinely fixed (100% → 23% null).

**⚠️ Not verified:** no device, emulator or browser was used. Q-118's on-device magnitude, Q-119's
contrast ratios (reasoned from OKLCH, not measured), Samsung WebView rendering and native SQLite paths
were all unexercised. The dead-route ledger is static analysis.

**Open question for the owner, recorded rather than guessed:** `supplement_logs` (1 row ever, none
since 2026-06-21), `food_logs` (none since 2026-07-26), `step_live_windows` (2026-07-28) and
`oura_accel_chunks` (2026-07-15) have all gone quiet in production. Q-124 gives a plausible mechanism
for the supplements case; the rest need the owner to separate "stopped logging" from "broken".

### [platform][devices] 🟠 Voice logging is broken on the device right now — the APK carrying it was never installed (found 2026-08-07)

`"SpeechRecognition" plugin is not implemented on android` fired three times in production,
2026-08-05 and 2026-08-06, from `/workout`. That is direct evidence that the APK carrying v1.258.0's
native-STT rebuild has **not** been installed on the S25 — the JS half shipped via Railway and is
calling a native plugin that isn't there.

**Still live — re-checked 2026-08-09.** A fourth occurrence landed **2026-08-08 22:56 UTC**, again
from `/workout`. So the count is now 4 across 2026-08-05, 08-06 and 08-08: this is not a one-off from
the week it was found, it is the owner reaching for voice logging every couple of days and getting
nothing.

**Two limits on that count, both worth carrying into every future `error_events` read.**
`error_events` prunes at 30 days, so any total is a floor. And **the `claude_ro` view is row-scoped to
one user** — this read returned **383 rows where the real table holds 7,331**. Every `error_events`
figure obtained through that endpoint describes the owner's faults only; other accounts' errors are
invisible by design. "Nothing else is failing" is not a statement this endpoint can support — only
"nothing else of the owner's".

Within that scope, the only other events in 24 hours were one `/api/body-battery` + one
`/api/readiness-score` `Failed query` in **the same second** (2026-08-08 03:26:19) — one transient DB
blip hitting two concurrent queries, not two faults.

**DB health checked in the same pass and is sound.** `oura_raw_samples` is 311 MB growing steadily at
~24k rows / ~570 kB of `body_hex` per day with no acceleration; autovacuum is current and dead tuples
are zero on the two largest tables. One observation short of a finding: `oura_raw_samples` has
autoanalyzed **once**, with ~36k modifications since — the default threshold
(`50 + 0.1 × n_live_tup` ≈ 90k rows) means statistics refresh only about every 3.7 days at the current
ingest rate, so planner stats on its time columns lag by days. **Whether that actually produces a bad
plan was not measured** — no `EXPLAIN` was run, so this is a lead, not a diagnosis.

This makes three ⚠️ rows concrete rather than merely unverified: the voice-logging rebuild
(v1.258.0), the ring + strap notification quieting (v1.259.0), and the scale notification quieting
(v1.257.3) all say "needs the new APK". **This is owner action, not a code fix** — the APK is already
built and published by CI at
`https://github.com/nekodas-neko/TrainingAI/releases/download/apk-latest/app-debug.apk`.

Related and worth doing in the same pass: **90 rows in this file carry a NOT-verified-on-device
marker**. They have accumulated to the point where no one can act on them individually. Installing the
current APK and running `docs/device-smoke-checklist.md` once would clear a large batch of them at
one go.


### [cardio] Running-plan override local-write fix (Q-98 bug-fix half, 2026-08-06, v1.267.7) — NOT verified on device · needs: browser

Fixes a real APK-only bug: `applyOverride` (swipe-to-pick-a-different-run-type after skipping
today's run) only did a bare `fetch`, unlike `markRun` which writes through the local SQLite store
+ outbox. On a device with a real local store, this let the screen's local-first status effect
re-read the stale `'skipped'` row `markRun` left behind and clobber the optimistic `'pending'`
reset back to skipped — permanently defeating the swipe-to-reset-status path, which read to the
owner as "I picked a different run, nothing happened." Invisible on web
(`getLocalStore()` returns `null` there), which is why the bug survived past `pnpm dev` testing.

Fixed by writing the override's server response through `store.upsertPrescribedRun(...)` as
`synced`. **The failing path is structurally unreachable in this sandbox** (no native SQLite here)
— only the unaffected web path was verified (regression-free, since this change's new code never
runs on web). Needs a real on-device swipe-to-pick-a-different-run-type check, after a skip, before
this can be marked confirmed. Full detail:
[`entries/2026-08-06-running-plan-override-local-write.md`](docs/overview/entries/2026-08-06-running-plan-override-local-write.md).

### [sleep] ✅ Sleep analysis counts nights, not rows (Q-76, 2026-08-05, v1.261.0) — two nights still unrecoverable

Eleven read sites called `listSleepSessions` and treated each row as a night. Production stores
**66 rows for 54 nights**: twelve are daytime/evening bouts, and one real night (2026-05-29) arrived
as two rows either side of a wake-up. Measured against the production table, **7 of the 54 dates fed
the wrong sleep duration into the sleep-vs-performance correlation**, six of them by roughly eight
hours — 2026-07-04 was read as **0.11 h instead of 8.22 h** because a `Map` keyed on date let the
nap overwrite the night. The 29 May night read as 4.02 h instead of 6.55 h.

`nightSessions()` (`packages/shared/src/health/sleep-night.ts`) already did both halves of this —
circadian nap/night classification, then gap-merge — so **the `isAnalysableNight()` predicate the
backlog entry proposed was deliberately not built**; a second rule beside the existing one is the
"One Formula, One Place" failure this codebase keeps paying for. The eleven sites now route through
it: sleep-performance-correlation, health-trends `meal-timing`, progress-summary, bedtime-estimate,
ai/health-insight, nutrition-goals/recommend, ai-chat, both ai-chat recovery tools,
`sleepDurationTrend`, and the running plan's short-sleep gate. Four read sites were left on raw rows
**on purpose** and say so in comments — the day timeline, the sleep list, `oura/hr-day`, and the two
daytime-HRV sleep-exclusion windows all want naps included.

`sleepDurationTrend` also stopped counting a duration-less row as **0 hours** — legacy parity that
manufactured exactly the sleep deficit the ratio exists to detect, and the input to the AI-dynamic
0.85 low-sleep gate.

**Still broken, and no read-time rule can fix it:** 2026-06-01 (1.45 h) and 2026-06-04 (3.83 h) are
the only rows on their dates — the rest of each night was never stored. **2026-06-02 and 2026-06-03
have no sleep row at all.** Both need a redecode/backfill from `oura_raw_samples` or the gap stands.

**Not exercised:** the local seed's sleep rows have `sleep_start == sleep_end` and no naps, so the
dev-server pass proved the routes still return 200 with byte-identical payloads (a genuine
no-regression result) and **not** that the nap filtering fires — that was measured separately by
running the real production rows through the helper. Nothing here is device-dependent (no native,
safe-area, gesture or notification surface), so the APK inherits it on the next Railway deploy.

### [heart-rate][devices] 🟠 Health tab's "Live HR" card shows a live reading without the owner tapping "Measure now" — likely tied to reported ~15%/night ring drain (found 2026-08-06, root cause NOT pinned down)

Owner noticed the Health screen's "Live HR" card reading a fresh bpm value despite never tapping
"Measure now," and suspects this is why their ring loses ~15% battery overnight. Traced the
mechanism, but this needs on-device evidence before a fix can be scoped — recorded as an open
investigation, not a confirmed root cause.

**Structurally confirmed**: `MeasureHrNow` (`components/health/measure-hr-now.tsx`) renders
`useLiveHr()`'s `bpm` unconditionally — it does not gate display on whether *this component*
started the stream. `useLiveHr()` (`lib/live-hr/use-live-hr.ts`) is explicitly documented as
"read-only... does NOT start/stop the manager" — it just subscribes to the app-wide `LiveHrManager`
singleton (`lib/live-hr/manager.ts`). So the card showing a live, non-stale reading (opacity-normal,
meaning the sample is under 8s old — a genuinely active stream, not a stale leftover) means
*something else in the app* currently has the manager's workout-grade live path engaged. This is
the correct symptom to chase for a real leak, but on its own doesn't say what's causing it.

**Design intent confirms this shouldn't happen from ring drain alone**: the ring is deliberately
**workout-only**, never ambient (`manager.ts:14-18,89-92`) — explicit comment: "keeps the ring's
battery-costly burst loop from running 24/7." Only the chest strap (if paired) runs in ambient
(all-day) mode by design. So a live ring reading outside an actual workout is a real deviation from
intended behavior, not a documented ambient feature — worth chasing, not dismissing.

**Leak vectors worth checking, most-likely first, none confirmed yet**:
1. A stale/abandoned workout sitting in `store.mode === 'active'` in the persisted Zustand store
   (workout state deliberately survives a refresh, per this file's own Known Issues) — `workout-screen.tsx`'s
   `useEffect` calls `mgr.start()` whenever `liveHrRun` (`mode === 'active' || 'exercise-summary'`)
   is true, with `mgr.stop()` only in the effect's cleanup. A workout left active without ever being
   properly finished/left would keep this engaged indefinitely.
2. The native BLE foreground service surviving an app crash/force-kill without ever receiving the
   JS-side stop call — Android foreground services are independent of the JS/React lifecycle, so a
   killed app mid-workout could leave the ring's native burst loop running all night with nothing on
   the JS side left to tell it to stop.
3. Lower likelihood, worth ruling out: a debug console (`components/oura-ble/live-hr-test-console.tsx`)
   left running — admin-only surface, so unlikely for normal use, but has its own start/stop pairing
   worth double-checking against this same class of leak.

**Not yet fixed — needs on-device diagnostics before a fix is scoped.** Check
`getLiveHrManager().getDiagnostics()`/the ring source's connection state during a period of reported
drain, and check whether the workout store's persisted `mode` was stuck at `'active'` overnight,
before committing to one of the leak vectors above. Backlog entry: **Q-116**
(`docs/implementation-backlog.md`).

### [workouts] 🟢 Manual "Deload" choice on Home had NO effect on prescribed weights/reps for any AI-dynamic session with an active prescription (found 2026-08-06, fixed 2026-08-07)

Owner picked "Deload" from Home's three-way Full/Deload/Rest card before a Legs session; the
resulting pre-workout screen showed the same "AI Prescription · Intensification" numbers as a
normal Full session, with no visible deload treatment.

**Root cause, confirmed real, not a display-only gap:** `handleDeload`
(`session-select-content.tsx:929-932`) routes to `/workout?session=<id>&aiDeload=1`. Server-side,
`aiDeload=1` reached `app/api/workout-data/route.ts:359-378`, which set
`sessionPhaseStatus.isDeloadActive = true` — but that flag only reached the actual prescribed load
through `deloadAwareStylePhase()` (`packages/shared/src/phase-engine.ts:125-134`), a mechanism that
swaps in a lighter phase style and **only applied to the static-progression-style path**. The moment
`aiDrivesLoad` was true — i.e. an AI-dynamic prescription actively driving load, the normal state for
this program — `buildWorkoutExercises` (`packages/shared/src/workout/session-data.ts`) unconditionally
applied `prescriptionStyleForExercise(p)` from the already-generated prescription, with no reference
to `aiDeload` at all. The only per-exercise reduction that could appear was `p.deloaded`, a flag baked
into the prescription **at generation time** by the AI-dynamic engine's own independent, automatic
emergency/per-exercise deload detection — a completely different mechanism from the user manually
asking for a lighter session today.

**Fixed:** `buildWorkoutExercises` now applies `deloadOverrideForGoal(trainingGoal)` — the same
tuned `DELOAD_LOWER_PCT`/`DELOAD_REPS`/`DELOAD_SETS`/`DELOAD_REST` constants the automatic engine
already uses — in a new `else if (aiDeload)` branch, skipped when the exercise was already deloaded
by the automatic engine so the two reductions don't compound. `preDeloadStyle`/`preDeloadSets` are
populated from the pre-deload numbers so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) works for a manual deload too. Setting `deloaded = true` on the returned
`WorkoutExercise` automatically extends the existing `exerciseDeloaded` payload flag and this
session's earlier 1RM-inflation fix (below) to also exclude manually-deloaded sets from PR/1RM
credit, with no additional server-side wiring. Verified via a direct unit test against the pure
`buildWorkoutExercises` function (the local seed program is `phase_mode='manual'`, not `ai_dynamic`,
so a live API/UI verification of this specific path wasn't possible this session — **not
device/live-API verified**, unit-test-verified only).

**Separately, owner-requested UX change — ✅ SHIPPED 2026-08-08 (Q-109-followup, v1.270.28):** the
Full/Deload/Rest choice moved off Home (now Rest/Full only) onto the pre-workout screen, beside the
Quick/Normal/Long duration picker, so choosing Deload happens at the point that actually determines
the session.

### [platform] 🟠 `/api/sync/pull` intermittently fails one of its ~21 parallel per-domain queries — likely DB-pool contention, cursor stuck for 4+ days on one device (found 2026-08-05/06, NOT fixed)

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
`cause`" item is now its own top-priority entry.** ([review §1.1, §1.2](docs/reviews/2026-08-08-db-scalability-and-tooling-review.md))
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

### [sleep][devices][platform] 🟠 A sleep session can get stuck on a stale, narrower window with no self-heal (Q-225, found 2026-08-13/14)

Owner reported the previous night's displayed bedtime (1:15am) looked far too late. Not the
anchor-lag bug (Q-71/Q-139, ≤3 min correction) — a 2h35min gap, so traced separately. **Confirmed by
full local reproduction, not inference**: pulled all of that night's real raw samples (11,208 rows)
and clock anchors from production, loaded them into the local dev DB under a throwaway user, and ran
the actual `aggregateOuraRawSamples` function directly against them (both `fullHistory: true` and a
bare incremental call). Both produced the same correct answer — sleep 22:40pm→8:05am (8.5h), onset
10 min, with the neural stager correctly flagging a brief overheating-driven wake bout around
00:50am as `awake` rather than delaying the start — exactly matching the owner's account ("asleep,
woke here and there from overheating"). The live stored row does not match this and fails every
check run against it (no >2h raw-data gap, no bedtime-event override, no stale-decoded-JSONB issue).
Leading theory (not confirmed): the DB-pool-contention pattern amended into the `[platform]` Q-107
row above — the timing correlates, though the causal link isn't proven. **Verified fix**: an admin
Redecode (`fullHistory: true`) deletes the stale row (keyed by wake-day, not `oura_id`) and inserts
the correct one — confirmed by running that exact code path locally. Backlog: **Q-225**
(`docs/implementation-backlog.md`), which also has a reusable local-repro harness for checking
whether other recent nights hit the same bug during the same error bursts.

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

### [readiness][devices] ✅ Q-81 — a query filtered on a column nothing has ever written (2026-08-05, v1.259.1)

The sweep guessed the daytime-HRV model was failing downstream, in the extractor or the fit.
**Wrong — execution never got there.** `getOuraRawSamplesForTags` filtered on `decoded IS NOT NULL`,
and that column is NULL on **all 812,816 rows across all 30 tags**. `body_hex` is the archival
source of truth and every other consumer decodes on the fly; this function was the odd one out, so
it returned an empty array to every caller, always.

**Two victims, one already on the record:** `oura_daytime_hrv_model` empty since the feature shipped
(Body Battery's D5 input permanently absent), and `/api/oura-ble/device-metrics` returning
`{"days": []}` — which the 2026-08-05 navigation entry had recorded as unexplained. Same cause.

Fixed by decoding from `body_hex`, matching the three existing sites in the same file. **Two further
finds while fixing it:** the caller asked for a 60-day window and was being silently clamped to 31
(now an exported constant, so the lie is gone), and the refit's throttle only applied *once a model
existed* — so with an empty table it ran on every rollup, which was free at zero rows and would have
become a ~43k-row / 503 KB read on **every ingest drain** after this fix. Now throttled on attempt.
That was a regression this fix would have introduced, caught by asking what the change costs on the
path it runs on. Both silent bails now report into `stepErrors`.

**Verified:** a DB-backed test drives real production hex through the real repository function to a
model that actually fits (60 rows → 150 samples → finite coefficients); reverting the one-line
filter reproduces the production numbers exactly (0 rows, 0 samples).

**⚠️ Not verified — whether it fits on the owner's real data.** The test proves the chain, not that
31 days of the owner's nights clear `MIN_TRAINING_SAMPLES = 50` with enough variance for a
non-singular system. The refit runs inside the ingest rollup, so this resolves on the next drain.
**Worth re-checking after a day:** `oura_daytime_hrv_model` should have a row, and device-metrics
should stop returning `{"days": []}`. If it still refuses, the new `stepErrors` message names which
reason — which it never did before.

### [platform][devices] ⚠️ Ring + strap notifications quieted with a low-battery exception — needs the new APK (2026-08-05, v1.259.0)

Answers Q-67's open sibling question. The owner's answer improved on it: quiet the ring and strap
ongoing notifications like the scale's, **but surface the battery once it drops below ~35%**.

Two channels, because a `NotificationChannel`'s importance is fixed at creation and cannot be raised
for one notification: the ongoing status channel drops to `IMPORTANCE_MIN` (ids bumped to
`oura-ble-v2` / `polar-ble-v2`, legacy deleted — Android will not retroactively lower an existing
channel), and a separate one-shot `IMPORTANCE_DEFAULT` alert fires on the downward crossing.

**Hysteresis is the feature.** The ring polls every 5 minutes, so a naive threshold check would post
**288 notifications a day**. `DeviceBatteryNotifier.decide` fires once on the way down and re-arms
only above **40%**, not 35 — a single threshold would let a boundary reading alternate and notify
every other poll. Charging both suppresses and clears. Eight JUnit cases including a simulated
day of polls asserting exactly one alert.

**Not verified — native, no APK in-session.** CI compiles the Kotlin and runs the JUnit tests, and
the hysteresis was re-derived independently, but none of that shows how One UI renders
`IMPORTANCE_MIN` (it has differed from stock AOSP before). **On device:** confirm both ongoing
notifications lose their status-bar icons; confirm the low-battery alert fires once when a device is
genuinely under 35% and **does not repeat five minutes later** — that one needs a full day's
watching. Thresholds are named constants, one-line changes if 35/40 turn out wrong.

### [workouts][platform] ⚠️ Voice logging rebuilt on native STT — needs the new APK, unverified until then (2026-08-05, v1.258.0)

Q-64. Two stacked causes, both hit before any speech could be recognised: `RECORD_AUDIO` was never
declared in the manifest (Android silently fails a runtime request for an undeclared permission, so
the WebView's `AUDIO_CAPTURE` request was denied and `onerror` fired in the same tick — the
"turns off instantly" symptom), and an embedded WebView has no speech recognition service anyway, so
declaring it alone would not have produced transcripts.

Now: manifest `RECORD_AUDIO` + an Android 11+ `<queries>` intent for `RecognitionService` (without
it, package-visibility hides the recogniser and `SpeechRecognizer` reports unavailable), and
`@capacitor-community/speech-recognition@7.0.1` wrapping Android's own recogniser. Its peer range is
`>=7.0.0` against our `@capacitor/core ^8.3.4`, so the plan's "Capacitor 8 compatibility TBD" is
resolved. Failure states are now visible instead of silent. The web path is unchanged and stays
logic-free.

**Verified:** the web path in a browser against `pnpm dev` (button renders, no crash, no regression)
and six new `parseVoice` tests. **NOT verified — and it is the actual fix:** whether the recogniser
produces a usable transcript on the S25. No microphone, no Android runtime, plugin resolves to null
off-device.

**On-device:** tap Voice mid-set, grant the prompt, say "eighty kilos five reps", confirm the dial
and reps update; tap again without re-granting; then deny once and confirm it says "Microphone
permission denied" rather than going quiet. **Needs the new APK** (CI builds it; `apk-latest`).

### [platform][devices] ⚠️ Scale notification quieted — needs the new APK, and the sibling services are still loud (2026-08-05, v1.257.3)

Q-67: the scale's ongoing "Connected — listening for weigh-ins" channel dropped
`IMPORTANCE_LOW` → `IMPORTANCE_MIN` (no status-bar icon, collapsed to the bottom of the shade). The
channel id had to change to `scale-ble-v2` — `NotificationChannel` is immutable once created and
Android will not retroactively lower an existing channel, so an upgraded install would otherwise
keep the old one and see no change. The legacy id is deleted on first run. The four one-shot event
channels are untouched.

**Native — a new APK is required** (CI builds it; `apk-latest` after merge). Compile-gated only in
the sandbox, so nothing here is observed working. On-device: check the ongoing notification loses
its status-bar icon (One UI's `IMPORTANCE_MIN` treatment can differ from stock AOSP), that
"Weigh-in logged" still shows normally, and that the scale still connects and logs.

**⚑ Owner question, unanswered on purpose:** the Oura ring and chest-strap services show the same
persistent "Connected" notification, and the plan said not to change them without asking. This
matters more since v1.257.0 — the strap auto-retry restarts the strap's foreground service roughly
every 4 minutes while the app is foregrounded and the strap is off, so "Connecting to strap…" now
cycles rather than sitting still. Quieting that channel the same way is the obvious follow-up if
wanted; the ring's "Connected · 37% battery" line may be genuinely useful.

### [workouts] ⚠️ PiP rest countdown (Q-65) is not device-verified — and structurally cannot be here (2026-08-05, v1.257.1) · needs: android

The exercise-summary PiP branch was a static "Done / tap Next" card that never read
`lastSetRestStartMs`, so backgrounding into PiP during the last set's rest lost the countdown. It
now routes through the same `PipView` the active branch uses, with the identical inputs
`LastSetRestTimer` subscribes to.

**Unverifiable in the sandbox by construction:** `usePipMode()` flips on a `pipModeChanged` window
event, and `grep -rn pipModeChanged` finds exactly one dispatcher —
`android/app/src/main/java/com/trainingai/app/MainActivity.java:578`. No web path sets it, so no
amount of browser driving reaches this branch. Verified by reading, not running.

**On-device check:** log the last set of an exercise to land on the summary screen with the rest
ring counting, then background into PiP. Expect the countdown ring (filling → red `+overtime`),
not "Done / tap Next". **JS-only — ships with the Railway deploy, no APK.**

**Related sandbox limitation, unexplained:** a set cannot currently be logged through `pnpm dev` in
a headless browser — the Log Set button is enabled and clicks without error, but the label never
advances and no `/api/log-exercise` request fires. Not chased to root cause and most likely a
sandbox artefact (the owner logs sets on device daily), but it means the workout-logging path is
not drivable end-to-end in the browser harness.

### [app-shell][devices] ⚠️ Strap auto-reconnect is NOT device-verified (2026-08-05, v1.257.0) · needs: hardware

Two owner-reported faults were fixed in one PR. The first is verified; the second is not.

**Verified — the More tab never refreshed.** All five tabs stay permanently mounted
(`components/shell/tab-shell.tsx`), so a `useEffect(…, [])` fetch runs once per app launch. The
persistent-tab-shell plan wired `epoch` through Home, Health, Workout and Nutrition — and never
covered More, so an app restart was the only way to update profile, stats, season badges, the
friends feed and leaderboard, ring battery/last-sync, outbox health, the update card, and the
scale/strap pairing rows. Fixed with a shared `useRefreshOnTabShow()` hook in
`components/shell/tab-visibility.tsx`. **Confirmed in a real browser** (headless Chromium against
`pnpm dev`, 412×915): first show fetched nothing (module cache warm, correct), and both re-shows
re-fetched `/api/user/profile`, `/api/seasons`, `/api/friends`, `/api/friends/feed` and
`/api/oura/token`. No page errors.

**NOT verified — the strap gave up and never retried.** Both strap paths stop trying by design:
the native foreground service after its ~4 min backoff ladder (`PolarStrapService.kt`,
`MAX_CONSECUTIVE_FAILURES = 6`, then `stopSelf()`), and the WebView fallback after
`RECONNECT_DELAYS_MS` (~17 s). The service's own comment says *"JS restarts it on the next app
open"* — nothing did, because `startAmbient()` is guarded by `if (ambientWanted) return` and
`LiveHrAmbientProvider` mounts once. So a strap put on after launch stayed disconnected until an
app restart, which is exactly what the owner hit. Fixed by adding `retry()` to the source contract
and `retryAmbient()` to the manager, driven by a 60 s foreground tick +
`visibilitychange` + the More tab re-show + a workout starting.

**Why it is unverified:** every path is BLE and native. The sandbox has no Bluetooth, no Polar H10,
and `getPolarBle()` returns null off-device, so the fallback path is the only one that could even
execute here and it has no radio either. Unit tests cover the manager's decision logic (7 cases in
`lib/live-hr/__tests__/manager.test.ts`) — they prove `retryAmbient` calls `retry()` on ambient
sources only, never wakes the ring, is inert unpaired, survives a throwing source, and does not
re-reconcile once started. They prove nothing about whether the H10 actually reconnects.

**What would confirm it, on the S25:** open the app with the strap off and the More → Workout tab
showing the strap card; leave it 5+ minutes so the native service exhausts its ladder and stops;
then put the strap on and watch the card **without restarting the app**. It should flip to
connected within ~60 s. Also worth checking the battery cost of the foreground tick over a day with
the strap deliberately off — the tick is a no-op while connected, but while disconnected it
restarts the service's ladder roughly continuously.

**Note this is a JS-only change** — no APK rebuild needed, it ships with the Railway deploy.

### [app-shell] ⚠️ Navigation speed has never been measured — and that is why Q-1b got closed on the wrong evidence (2026-08-04)

The owner reported navigation feeling not-quite-swift, and clarified it was **not** cold start.
Cold start *was* measured (472 ms, Q-51 Task 3) and is fine. **Navigation has not been measured at
all**, and Q-1b (bundle the shell) was closed against the cold-start number — which does not cover
the question actually being asked. The drop still looks right on cost, but it rests on evidence
about a different thing; say so rather than treating it as settled.

Two behaviours are being conflated and only one is fast:
- **The five bottom tabs** stay mounted; switching flips visibility, no network. Confirmed instant.
- **Everything else** is a real route navigation fetching an RSC payload from Railway. `<Link>`
  prefetches automatically; a **`router.push` from a button does not** (#919) — and most of this app
  navigates by button.

**Shipped:** the four targets that had no prefetch — `done-screen` → `/session-select`,
`done-activity-screen` → `/workout-select`, `workout-select` → `/cardio`, `running-plan` →
`/cardio`. **Effect unverified**: prefetch is client-side and cannot be observed from `pnpm dev` or
a test, only on the phone.

**Left deliberately undone (Q-70):** `session-select` prefetches only the *recommended* session, so
tapping any other one is cold — the app's most-used navigation. The code carries a documented reason
(*"N payload fetches to serve one tap"*), and overturning it needs a measurement. The approach that
avoids the trade is prefetch-on-`onPointerDown`, which covers every session at zero waste.

**A correction worth carrying:** I first reported "42 push sites, ~5 prefetched, ~35 cold
navigations". Counting per file rather than in aggregate, the sweep had **largely already been
done** — the real gap was four. Second time in one session a quoted number did not survive checking.

**Update (v1.255.0) — the instrument now exists; the measurement is still owed.** Rather than carry
this argument into another session, navigation is now measured on the device: every tap that changes
the URL records `urlMs` / `paintMs` / `settleMs` and, critically, **`rscCount` — 0 means the route
was already warm**, which turns "did the prefetch work?" into a per-navigation boolean. Read it in
**More → Admin → Device data capture** (`Reset nav timings` → use the app → `Run all` → Copy).
Verified working end-to-end in a real Chromium against `pnpm dev` — including the query-only
`/workout` → `/workout?session=…` transition, which recorded a cold 243 ms payload fetch and which a
`usePathname` hook would have missed entirely. **What is still not measured is the phone**; until
the owner runs a capture, both the prefetch sweep's effect and the Q-1b bundling drop remain
supported by no navigation evidence. One field, `settleMs`, has never been observed diverging from
`urlMs` (nothing local was slow enough to have a settling phase) — see the journal entry.


### [app-shell] ⚠️ The update banner cannot see a native change that ships without a version bump (2026-08-04, v1.256.0)

**Fixed and verified in the diff (Q-59):** `UpdateCheckCard` now compares the installed APK against
`nativeVersion` — the version of the newest published `apk-latest` release — instead of the server's
`package.json`, and `package.json` is out of the Android workflow's path gate so a version-only bump
no longer republishes an identical APK. Three states now, including a positive **"Up to date"** the
card never had (it rendered `null` when there was no update).

**The residual hole, accepted deliberately:** a native change merged *without* a version bump
republishes the APK at the **same** version, so the card sees no difference and stays quiet — the
owner would never be told a genuine new build exists. Closing it properly means stamping the build's
commit SHA into the APK and comparing that, which needs a Gradle change **and** one bootstrap install
before it can work at all. Judged more machinery than the reported bug warranted. The mitigating
convention is the standing rule that user-visible changes bump the version, which every native change
in this repo's history has followed — but it is a convention, not a gate.

**Not verified:** the card is `Capacitor.isNativePlatform()`-gated, so none of its three states ever
rendered — the decision logic is unit-tested, the markup is not.

**🔴 LIVE DEFECT, found immediately after the merge:** production `/api/version` returns
`"nativeVersion": null`, so the card is currently showing **"Could not check for a newer build"** —
not the up-to-date/update state it was built for. Re-checked after the 300 s fetch-cache window (the
publish step *deletes and recreates* the release, so a lookup in that gap legitimately 404s):
still null, so it is persistent, not the gap. v1.256.1 adds `nativeVersionStatus`
(`ok` / `unconfigured` / `unavailable`) to tell a missing `GITHUB_RELEASES_TOKEN` apart from a
GitHub-side failure, readable from the admin data-capture console. **If it reports `unconfigured`,
the token is unset in Railway — and More → Download APK has been 502ing all along, since it uses the
same token.**


### [app-shell] ✅ React hydration error on the home screen — 283 times (found 2026-08-04) — **FIXED 2026-08-07 (Q-73)**

> **⚑ Read this first — the section below is preserved for its evidence trail, but two of its
> conclusions are wrong.** The cause was found on 2026-08-07 and reproduced without a device:
> `app/session-select/session-select-content.tsx:1063` called `toLocaleDateString("en-AU", …)` with
> **no `timeZone`**. Railway sets no `TZ`, so Node rendered **UTC** while the S25 rendered
> **Australia/Brisbane** — for the 42% of each day between 00:00 and 10:00 AEST the server sent
> yesterday's weekday+date and the client rendered today's (`"Thursday 6 August"` vs
> `"Friday 7 August"`). It was the banned `toLocale*`-without-`timeZone` pattern from CLAUDE.md's
> Timezone section, on the home header.
>
> **Correction 1 — the "all five tabs mount at once" claim below was FALSE**, and it is what produced
> both dead ends. `components/shell/tab-shell.tsx:57-61` initialises `mounted: [initialTab]`; the
> other four mount on first activation, which is client-only and cannot hydrate. **The search space
> was always the home tab alone.**
>
> **Correction 2 — "needs the un-minified error captured on the device" was not true either.** The
> reason it never reproduced in the sandbox is that `pnpm dev` runs the server and headless Chromium
> in the **same timezone**, so both sides format identically. No device was needed; a timezone
> difference was.
>
> **Fixed (Q-73, v1.267.18):** the header date now renders via `formatInTimeZone(new Date(),
> DEFAULT_TZ, "EEEE d MMMM")` — a fixed timezone, not either side's ambient system tz — so server and
> client always compute the identical string. Swept the same banned pattern at three sibling sites
> found by grep: `getGreeting()`'s `new Date().getHours()` four lines above the header fix (same
> file, gated behind a currently-null `displayName` so not yet a live mismatch, but the same class),
> plus the identical bare `toLocaleDateString` on `overview-screen.tsx` and
> `pre-workout-screen.tsx`. Detail:
> [`docs/overview/entries/2026-08-07-home-hydration-mismatch.md`](docs/overview/entries/2026-08-07-home-hydration-mismatch.md),
> [`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md) §2.1.

**Minified React error #418** (`args[]=text` — *"Text content does not match server-rendered HTML"*),
reported by the client error reporter from real browsing. `/` has **283** occurrences with the most
recent on **2026-08-03**, running 1–13 a day with no downward trend. `/health` (17) and `/more` (15)
both stopped 2026-07-14; home did not.

**Established:** it is a *text* mismatch, so the pre-hydration theme script (classes and
`data-brand`) is not the cause. The session-165 lazy-initializer rule is **not** being violated —
`useState(() => readCacheSync…)` returns nothing across `app/` and `components/`. `/` renders
`TabPage`, and the shell mounts **all five tabs at once**, so a mismatch in any tab's content
surfaces on `/` — which explains the ~17× count and widens rather than narrows the search.

**Did not reproduce** on `pnpm dev` (which emits the un-minified error naming the component and both
texts) driven with Playwright at the S25 viewport as the seeded user. So it needs production data,
the WebView, or a specific time — not the sandbox.

**Two leads chased and killed — do not re-chase.** (1) `toLocaleString()` on the steps number: this
Node is full-icu and returns `1,234`, identical to Chromium. (2) DOM nesting (the error's args
`['text','']` read like *"text cannot be a child of <x>"*): there is no table markup anywhere on the
home path. **Next step is the un-minified error captured on the device** — it names the component
and prints both strings, and two rounds of static reasoning have now produced two dead ends. Full
evidence in
[`docs/reviews/2026-08-04-error-events-first-read.md`](docs/reviews/2026-08-04-error-events-first-read.md).

**Worth noting how this was found:** `error_events` had been collecting for a month and nobody had
read it. Two *other* faults in the same table had already stopped on their own before anyone looked,
and the table prunes at 30 days — so a fault that self-resolves disappears unrecorded.


### [sleep] 🔴 The Sleep Score cannot tell a good night from a bad one — measured against 32 rated nights (2026-08-04)

**Measured, not suspected.** Production `sleep_sessions` run through the real `computeSleepScoreSeries`
and paired against the owner's own morning ratings (`day_checkins.sleep_quality_feel`, 1 = best),
longest session per date:

| | value |
|---|---|
| paired nights | 32 (2026-07-03 → 08-04) |
| **Sleep Score** | mean **91.3**, sd **4.4**, range **80–98** |
| owner's feel | mean 2.59, sd 0.78, range **1–5** |
| correlation | r = −0.354 (correct sign, weak) |

**The score never left the 80s/90s across an entire month** while the owner's experience used the
whole scale. A night rated **5 (worst)** scored **80**; a night rated **4** scored **93**; nights
rated **1 (best)** scored 93 and 92. Worst-of-month and best-of-month land within a point of each
other.

**Two things this changes.** Q-3b was marked *"⛔ owner/data-gated — no code without that data"*;
**the data has existed all along** — the morning check-in has been collecting the rating since
2026-07-03 and `/api/admin/sleep-feel-calibration` already reads it. And the owner's suggestion to
"move the calibration to the morning check-in" is **already built**, so no UI work is needed.

**⛔ Not fixed — needs an owner decision.** Re-tuning the Sleep Score changes a number they read
every morning, and "what should a bad night score" is a product judgement. Tracked as **Q-72**.

**🆕 2026-08-06 — a THIRD direction shipped (v1.267.0), not a resolution of this finding.** The
owner explicitly declined both of this entry's original options (rescale the whole model, or make
`sleep_quality_feel` a live input) and asked for an objective awake-time/fragmentation criterion
instead. An awake-time fragmentation cap now ships in `sleep-score.ts` — see the Current Status
entry above and [`entries/2026-08-06-sleep-fragmentation-cap.md`](docs/overview/entries/2026-08-06-sleep-fragmentation-cap.md).
This measured 32-night finding (the score's compressed dynamic range) is **still true and still
open** — the cap only fires on awake-time outliers specifically, it does not widen the range for
nights that are bad on other axes (autonomic, short duration). Q-72 itself is not closed.


### [devices][body] ⚠️ Q-56 fixed the step path only — the rest of the ring rollup keeps the unbounded clock (2026-08-04, v1.255.1)

**Fixed and verified in the diff:** `bucketStepInputsByDay` now converts a ring `ds` with
`resolveDsToMs` (nearest/interpolated anchor) and drops any frame resolving past
`now + INGEST_FUTURE_TOLERANCE_MS`. 10 new tests, one of which pins the original defect so the fix
cannot be mistaken for a test that never failed.

**Still open, and it is the larger surface:** `toDate` in `aggregateOuraRawSamples`
(`adapter.ts:4696`) is unchanged — bare `measuredAtMs` from the newest anchor — and it converts ring
time for **sleep session start/end, HR bins, temperature and its own `dayForDs`**. Those paths carry
the same unbounded skew the step path just lost. Not folded in because it would move sleep-session
boundaries across the whole rollup on the same day the owner's wake times were corrected by an
unrelated fix. Queued as **Q-71** with a required before/after measurement against production sleep
rows.

**Never reproduced end to end.** The mechanism is evidenced (production anchor rows, exact
arithmetic) and the code path demonstrably produces the observed dates, but replaying the 2026-07-30
incident needs a drain in flight and the sandbox has no ring. What is proven is that those dates can
no longer be persisted.

**Per-frame epochs are still not threaded** — `oura_raw_samples.epoch` exists but the step queries
don't select it, so every frame resolves against the current epoch. Unchanged from before, not a
regression.


### [platform] ⚠️ 44 MB of dormant Oura weights nobody was watching — and the "87 MB" figure was wrong (2026-08-04)

Measured while scoping Q-49 Phase B. The repository is ~101 MB of git history. Where it actually
goes:

| | size | loaded at runtime? |
|---|---|---|
| `lib/oura-models/weights/` (15 `.weights.npz`) | **44 MB** | **no — all 14 tracked files dormant** |
| `lib/oura-models/onnx/` | 27 MB | partly — 10.7 MB across the 8 required files |
| `lib/oura-models/constants/` | 12 MB | yes (provenance + real constants) |

**Two corrections to what the backlog said.** Q-49 A1's deletion step targets the 8 required `.onnx`
files — that is **10.7 MB, not the 87 MB** repeatedly quoted. And the largest thing in the repo by
far is the weights directory, which **A1 does not touch at all**.

**`scripts/check-oura-models-dormancy.js` was not looking at `.weights.npz`** — its asset filter
covered only `.onnx` and `.constants.json`, so the tool built to find dormant model assets had never
examined the biggest group of them. Fixed; the sweep now reports all 14 as dormant. Nothing loads
them: the runtime path is `.onnx` via `inference/`, and the only references to these filenames are
`"weights_npz"` provenance fields inside constants JSON.

**They are KEPT, not deleted** — re-extracting weights is impossible from this repo, so removal is
irreversible here and is the owner's decision, the same class as Q-50's finding 2. Explicit KEEP
entries now carry that reason, so they are visible and awaiting a decision rather than invisible.

**This is the real question for Q-49 Phase B**, not A1: 44 MB of extracted vendored Oura weights
would become public the moment history is pushed. **Decide before the push — once public, it is
public.**

### [platform] ⚠️ Q-49 A4b has shipped — Oura's material is out of the tree; Phase B (the cut) is what remains

The owner ran `GET /api/admin/model-assets` and it returned **`complete`**, which the backlog, the
admin card and `bucket-report.ts`'s own summary string all described as the gate for deleting the
87 MB of `.onnx` files from git and making the boot check fatal. **All three were wrong**, and
acting on them would have turned CI red.

`complete` proves the *production* half: the bucket really can serve every model. But **the
repo-tree copies are load-bearing for CI, not just a production fallback** — fourteen test files
read `lib/oura-models/onnx`, most via `fs.readFileSync` directly (bypassing `getSession` and its
bucket path entirely), and `inference/__tests__/sleepnet.test.ts` asserts `not.toBeNull()` with a
comment reading *"incl. CI"*. `.github/workflows/ci.yml` has **no bucket credentials at all**.

**Second, independent problem:** `instrumentation-node.ts`'s check verifies files **on disk**, so
flipping it to fatal while deleting the files would fail the boot immediately. It has to be
repointed at the bucket in the same change. And while the local fallback still exists a fatal check
has nothing real to catch — production cannot silently degrade with a working copy sitting there.

**The real gate is a CI model-delivery story nobody has scoped.** The owner has already approved the
availability trade, so the decision is not what is blocking this. Options and the recommended
fatal-on-`incomplete` / log-on-`unreachable` split are recorded on the Q-49 backlog entry.

**Update 2026-08-16 — Phase A is COMPLETE.** The CI story is solved on both halves: the model tests
replay from recorded fixtures, and the constants now fall back to synthetic fixtures (#1384), so the
suite passes with no vendor material and no credential in CI. Both bucket verdicts read `complete`.
The public repo `nekodas-neko/TrainingAi_Open` exists and is empty.

**Update 2026-08-16 — A4b SHIPPED.** All ten private paths are deleted, `.gitignore`d and covered by
`check-private-paths` (which now reports `total tracked: 0.0 MB`); both boot checks ask the bucket
and throw in production; `NOTICE` states that no third-party model weights are included. Guards on
17 test files, not the 16 the handoff measured — see the two rows below for what that count missed
and for what has still never executed.

**What remains is Phase B**, the cut itself: [`docs/public-repo-cut-runbook.md`](docs/public-repo-cut-runbook.md)
steps 8–14. Rollback stays available throughout — the old repo remains a working Railway target
until the final step, and that step archives rather than deletes it.

**Update 2026-08-15 (#1353):** the CI story is solved — the model tests replay from recorded
fixtures, so the suite passes with all ten `.onnx` files absent, and the constants resolve from the
repo copy in CI without any credential. The `constants` half now has the same bucket delivery the
models have had since A1, plus its own report. **What remains owed is the deletion itself** (A4b):
delete the tree copies, `.gitignore` them, and repoint both boot checks at the bucket in that one
change. Until then a fatal check still has nothing real to catch.

### [platform] ⚠️ The bucket download path for the model constants has never actually run (2026-08-15)

`ensureConstantsAvailable()` (#1353) prefers the repo copy, which still exists — so every execution
so far has taken the tree branch and returned before touching object storage. Session sandboxes hold
placeholder storage credentials that reject with `SignatureDoesNotMatch`, so the download cannot be
exercised here at all; only the pure report-building logic is covered by tests.

Its first real run is on Railway, in the deploy that deletes the tree copies. That is the correct
ordering — a mechanism added *after* a deletion is a mechanism nobody tested — and A4b flipped the
boot check to fatal in the same change, so a failed download fails the deploy instead of silently
serving a half-populated directory.

**Status 2026-08-16: A4b has merged, so that deploy is the one to watch.** A healthy boot logs
`[instrumentation] model constants: bucket — downloaded 34 file(s)` followed by
`[instrumentation] model assets: 8 file(s) in object storage`. Anything else and the process will
not come up; `GET /api/admin/model-assets` answers why, and reverting the deploy restores a tree
that still has the files. **Until those two lines are seen in a Railway deploy log, the download
path remains unexecuted** — merging is not the same as running it.

**Related, and already caught once:** the owner's console upload of the 34 constants landed 33,
dropping `stress_daytime_sensing_1_1_0.tables.json`. `GET /api/admin/model-assets` names the missing
file; re-check it reads `complete` before A4b deletes anything.


### [platform] ⚠️ A failed `REINDEX TABLE CONCURRENTLY` left 42 MB of invalid indexes in production (2026-08-04)

### [platform] ✅ DB index bloat cleared — 176 MB reclaimed, WAL restart still owed (2026-08-04)

Owner ran the corrected procedure. Measured after:

| | before | after |
|---|---|---|
| `oura_raw_samples` indexes | 316 MB | **140 MB** |
| `oura_raw_samples` total | 462 MB | **286 MB** |
| whole database | — | **363 MB** |
| invalid `_ccnew` indexes | 4 (42 MB) | **0** |

**Restart done** (`pg_postmaster_start_time` 02:03:58 UTC). Volume **~890 MB → ~680 MB of 1.00 GB**
— 68%, against the 92% that started this. `max_wal_size` deliberately left at 256 MB: at 68% there
is no case for trading checkpoint I/O for disk on a database already timing out on BLE ingest
batches.

**⚠️ The runway is ~5 weeks, and the trend is unchanged.** `oura_raw_samples` takes **~24,700
rows/day** at ~363 bytes/row with indexes ≈ **9 MB/day**, against ~320 MB headroom → **~35 days**
before this recurs. The reindex bought time; it did not fix anything. The structural fix is
**Q-30** (raw-sample retention / raw-drop-vs-bytea). Re-check in ~3 weeks.

### [devices][platform] ⚠️ Oura BLE ingest fails often — noisy, but verified NOT lossy (2026-08-04)

The device BLE service log carries repeated `ingest POST failed` across 48 hours: `timeout`,
`HTTP 500`, `HTTP 502`, `HTTP 403`, and one `Unable to resolve host`. Counters read
`ingestPosted 72,126` against `ingestStored 49,787`.

**Checked, and no data is being lost.** Server `oura_raw_samples` sits at `ring_timestamp_ds`
25,680,106 against the device cursor 25,680,154 — a **4.8-second** gap, i.e. current. The
posted/stored gap is dedup (`(user_id, ring_timestamp_ds, tag, body_hex)`), not loss: re-sends are
free by design and the cursor only advances past durably-ingested events, so a failed POST is
retried on the next drain. The log says so itself — *"data is safe locally, retries next drain"*.

**What is unexplained is the failure *rate*.** The 502s and the DNS failure are not the app, and the
500/timeout bursts line up with Railway deploy windows (several releases landed on 2026-08-04), so
container restarts explain much of it. That is a hypothesis, not a measurement. `/api/oura-ble/samples`
does call `reportServerError`, yet none of these reached `error_events` — which points at the failures
happening before the handler runs (edge/platform) rather than inside it. Worth a proper look if the
rate does not fall now that deploys have stopped.


### [readiness] ⚠️ Body Battery v5 — inputs corrected, but the model still has no validated target (2026-08-04, v1.253.0)

Q-57 shipped: HRmax for the reserve now comes from the highest corroborated daily peak over 90 days
(**168**) rather than `220 − age` (**190**); `CHARGE_RATE` halved 0.40 → 0.20; sparse days are
flagged rather than rendered as confident flat lines. Backtested over the real 41-day production HR
series: days pinned at the 100 ceiling **14 → 0**, end-of-day mean **71.9 → 49.9**.

**The open risk, stated plainly: these constants are not fitted to anything.** End-of-day battery
vs next-day readiness sits at **r = −0.06** over 18 pairs, so there is no outcome signal to tune
against. They were chosen for distributional plausibility — nothing pinned at either rail, centred
near 50. That is a defensible position for inputs that were wrong on their own terms, and it is
**not** evidence the number now means something. Re-check after ~2 weeks of v5 days
(`docs/body-battery-tuning.md`); if the correlation is still absent, the question is whether
end-of-day battery is the right predictor at all.

> **⚠️ AMENDED 2026-08-15 — that re-check is done, and the r = −0.06 above is not a v5 number.**
> Twelve v5 days have accrued. Split by `model_version`, **v5 alone gives r = +0.67 (n = 11)**
> against −0.12 pooled across v1/v2/v4/v5 — all four of which ran inside the same 40 days with no
> backfill, so any correlation over the full series mixes four models. **The deferred question is
> answered in v5's favour: tune, don't abandon** (**Q-272**), and the versioning gap that made the
> pooled number look authoritative is **Q-273**. Underpowered at n = 11 — re-run at ~30 v5 days.
> Separately, and not visible in the correlation: v5 **drains 5× faster than it charges** (10.5 vs
> 52.4/day) and **ends at its daily minimum on 10 of 12 days**. Evidence in
> [`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md) §1.4–1.6.

**Two secondary risks:**
- **The reserve now varies per user and per window.** A user with fewer than 14 recorded peak days
  falls back to the age estimate, so two v5 days are not comparable unless both resolved
  `hrMax.source === 'observed'`. The response carries `hrMax.source`/`peakDays` for exactly this.
- **Not verified on device.** The "Limited data" chip and its explanation were never rendered — the
  seeded local DB has no HR data, so that state is unreachable in the sandbox. Card rendering at
  the S25 viewport is unchecked.

The anchor ("start number") is untouched and still swings with readiness (29–87). Q-42 was the
structural half — **✅ shipped 2026-08-09**, see the Body Battery anchor row below.


### [workouts][cardio][devices][platform][body] Owner bug/feature batch, 2026-08-02/03 (Q-63…Q-69) — triaged and planned, NOT fixed

Seven items reported/requested by the owner across a single session, each traced to source and
queued with an implementation plan, none implemented. **Renumbered twice** (an original Q-52…Q-58,
briefly Q-57…Q-62, now Q-63…Q-69) — Q-52 collided with an unrelated "per-exercise phase hold" plan,
and Q-53…Q-56 collided with the separate cross-domain bug review below; both landed on `main` first:

- ~~**Q-63 `[workouts]`**~~ ✅ **SHIPPED v1.253.3, 2026-08-04.** Both skip buttons now route through
  the existing confirm; the guard moved to `components/workout/leave-guard.ts` so it is testable at
  all (this repo has no component-test setup). Deliberately still conditional on there being work to
  lose — a prompt dismissed by reflex guards nothing. Originally: the workout skip button advances to the next exercise with zero
  confirmation in a normal (non-solo) workout, discarding in-progress set/rest state on one tap.
- **Q-64 `[workouts][devices]`** — voice logging turns itself off instantly on the APK:
  `RECORD_AUDIO` isn't declared in the Android manifest at all, and even fixed, embedded Android
  WebView doesn't reliably implement real speech-to-text the way Chrome does.
- **Q-65 `[workouts]`** — Picture-in-Picture shows a static "DONE / tap Next" placeholder instead of
  the live rest-countdown ring on the exercise-summary screen (the active-mode PiP case already
  solves this correctly via `PipView`; the summary-mode branch never got the same treatment).
- ~~**Q-66 `[cardio]`**~~ ✅ **SHIPPED 2026-08-04.** Treadmill toggle on the walk config; GPS is
  never started in that mode, and the walk saves as `treadmill` with distance/route/pace null.
  Beyond the plan: treadmill walks are now **included** in the fast/slow segment-stats card, which
  filtered to `'walk'` and would have silently dropped them — the aggregate filters nulls per field,
  so they contribute real heart rate and nothing to pace. Originally: guided walk has no
  treadmill/no-GPS mode, so doing the interval walk indoors
  risks polluting pace/distance stats with GPS drift; the manual "Other activity" flow already
  solved this exact problem and guided walk never got it.
- **Q-67 `[platform]`** — the Renpho scale's persistent "Connected — listening for weigh-ins"
  notification runs continuously (foreground service is `START_STICKY` since 2026-08-01) and is
  unwanted noise distinct from the actual "Weigh-in logged" event.
- ~~**Q-68 `[cardio][devices]`**~~ ✅ **SHIPPED 2026-08-04.** The ring-confirm path now runs behind
  the same notify gate AD-1 already used, as a **GPS veto rather than a requirement** — no GPS fix
  still trusts the ring, which is the indoor case AD-2 exists for. Does not touch the AD-2 Hz-band
  calibration issue, which is separate and still owner-blocked. Originally: auto walk/run detection
  still false-positives on ordinary movement.
  Distinct from the already-tracked "AD-2 Hz bands provisional/uncalibrated" issue: the ring-confirm
  path (the one actually active whenever a ring is connected) skips the GPS distance/elapsed notify
  gate the sensor-fallback path already has.
- ~~**Q-69 `[body]`**~~ ✅ **SHIPPED v1.253.2, 2026-08-04** — see the Known-Issues entry above. The
  scale weight trend only ever took the day's *first* confirmed reading; a
  clothed first weigh-in permanently locks in a high trend value with no correction path. Decided
  (after rejecting both a same-day average and a manual override UI) to have the trend use the day's
  *lowest* confirmed reading instead.

Full root causes, decisions, and rejected alternatives (with rationale) in
[`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md).
Plans and branch names in `docs/implementation-backlog.md`. **Do not strike any of these seven
until each is actually implemented and verified** — this entry only records that they were scoped.

### [platform][body] 🔴 `body_metrics` could neither save locally nor pull — BOTH statements were short of columns (fixed v1.252.8, 2026-08-04)

Found in the owner's device console, not by any test. `applyDeltaBody` threw
`Run: 30 values for 32 columns` on every pull. Checking its sibling found the **local write broken
too**: 32 columns against 31 placeholders.

So on device, **every body-metric write failed in both directions** — weight, steps, calories,
macros, water, resting HR, HRV, SpO₂ and the whole scale body-composition set. The ten
body-composition columns added with the scale-BLE work were added to the column lists and the param
arrays but not to the `VALUES` lists.

**The blast radius was wider than "body metrics" — traced 2026-08-04, after the fix shipped.**
`applyDeltaBody` applies `delta.bodyMetrics` in its **first** loop, and `applyDelta` wraps the whole
thing in one transaction (`sqlite-backend.ts:1173`). So a delta page carrying even one body-metric
row threw on its opening statement and rolled back **all 26 domains in that page** — workouts, food,
sleep, programs, everything. With Oura BLE writing body metrics more or less continuously, that is
close to every page. **Incremental sync was dead on the device, not degraded.**

**Nothing was lost, though.** `setLastSyncAt(raw.syncedAt)` sits *inside* the same `try` as
`applyDelta` (`sync-engine.ts:539-545`), so a failed page never advanced the cursor — the server
still holds everything and it re-pulls from the same point. The device needs a restart to pick up
the fixed JS; no repair step, no full resync.

**This also closes out the `BeginTransactionAlready in transaction` error** from the same console
dump, which the fix PR could only call "probably a cascade". It is one: the `catch` at
`sqlite-backend.ts:1181` swallows a failing `rollbackTransaction()`, so the connection stays inside
the aborted transaction and the *next* `beginTransaction()` throws exactly that. Downstream of the
arity bug, not independent — but note the swallow is still there and would re-surface the same
confusing second error behind any future `applyDelta` failure.

TypeScript cannot see the original fault (template-string SQL, plain array params), lint cannot, and
**no test in this repo could have** — `getLocalStore` returns null off device, so nothing that goes
through the store executes these statements at all. It only ever appears as a runtime SQLite error
on the phone.

Guarded now by `lib/local-store/__tests__/insert-arity.test.ts`, which parses the backend source and
asserts column count equals value count for **all 33** INSERTs — confirmed to fail on the original
bug, naming the exact line. It also pins a floor on how many statements it finds, so a reformat that
breaks the parse fails loudly instead of passing vacuously.

**Still open, same console dump — two things this does NOT fix:**
- `/api/body-battery` and `/api/readiness-score` both returned **500** in production — see the
  Known Issue directly below; both now report, but the cause is still unproven.
- A `BeginTransactionAlready in transaction` error also appeared. Most likely a cascade from the
  above (a failed statement leaves the transaction open and the next `applyDelta` cannot begin), but
  that is reasoning, not evidence — re-check on device once the arity fix ships.

### [platform] ⚠️ `/api/body-battery` and `/api/readiness-score` 500'd in production, cause NOT diagnosed (reporting added 2026-08-04)

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

### [app-shell][platform] ⚠️ The APK's version was frozen at 1.30.0, so "Update available" was always on (fixed v1.252.7, 2026-08-03) — needs the next APK

`android/app/build.gradle` hardcoded `versionName "1.30.0"` while the app shipped 1.252.x. CI reads
`package.json` for the GitHub release *title*, but never stamped it into the build. `UpdateCheckCard`
(More) compares the installed APK's `versionName` against `/api/version`, so the comparison was
`1.30.0` vs `1.252.6` — permanently "behind". The card claimed an update was available forever,
**including immediately after installing the newest build**, and could never say "up to date".

Fixed by deriving both `versionName` and `versionCode` from `package.json` at Gradle configure time
(so a local build gets the same number as CI, not a CI-only patch). `versionCode` goes 3 →
1,252,006 via `major·1,000,000 + minor·1,000 + patch`; it only ever increases, so installs over the
old APK still work.

**Which surface was NOT exercised:** the Gradle build itself. The sandbox has no Android SDK and the
Gradle download is proxy-blocked, so the file is compile-checked only by CI's Android job — which is
**not a required check**, so it was watched explicitly rather than trusted to the merge gate. And
**the fix cannot take effect until the next APK is installed**, because it lives in the file that
builds the APK: the currently-installed build still reports 1.30.0. Expect the card to keep claiming
an update until then — that is the bug, not a new one.

### [sleep] ⚠️ Last night's own record is still wrong — the sensing-span fix only covers future rollups (2026-08-03, v1.252.8)

The `denseSensingSpan` fix (see Current Status above) stops this class of bug going forward, but it's
a pure function of already-decoded input — it doesn't retroactively rewrite the `sleep_sessions` row
for the 08-03/04 night itself, which still shows `sleep_start` = 00:59 instead of the real ~22:32.
`body_hex` for that night is untouched (archival, per the Oura BLE rules), so the row is recoverable
by re-running the rollup over it (Redecode / a targeted backfill) — that re-run just hasn't happened
yet. Any other historical night with a similar asymmetric mid-night interruption has the same stale
`sleep_start` until the same backfill runs. No backlog entry filed — flag here so it isn't
re-discovered as a fresh bug; do the backfill next time this file is touched for a sleep-domain
session, or on request.

### [cross] Cross-domain bug review 2026-08-03 — 5 findings, ALL QUEUED (fixes not yet shipped)

Review-only session (no code changes): 4 parallel review agents + a direct production DB audit via
the admin read-only endpoint. Full evidence in
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](docs/reviews/2026-08-03-cross-domain-bug-review.md);
each item queued in `docs/implementation-backlog.md` with its own plan doc. This row is struck
per-item as the fix PRs land.

- **[devices][body][sleep] Q-56 — real sensor data landed on dates up to 5 days in the future.**
  Five `body_metrics` rows + one `oura_daily` row, written in one batch on 2026-07-30, dated 1-5
  days ahead of that write. **Re-checked 2026-08-04: all five have self-healed and there are now
  zero future-dated rows** across `body_metrics`, `sleep_sessions`, `oura_daily`,
  `oura_daily_summary` and `activity_logs`, keyed on the user's local day. **That is the symptom
  expiring, not a fix — do not close it on that basis.** Root cause not proven, but a strong lead is
  now recorded on the backlog entry: the ring-time → wall-clock conversion (`measuredAtMs`) has **no
  future clamp at all** while the scale path does (`INGEST_FUTURE_TOLERANCE_MS`), and the step/day
  path resolves against the single newest clock anchor rather than the nearest-frame resolution
  migration 161 built for exactly this — with production anchors observed re-stamping ~39 minutes of
  ring time in 11 real seconds mid-drain. Plan:
  `docs/superpowers/plans/2026-08-03-future-dated-ble-ingest-rows.md`.
- ~~**[workouts] Q-53 — prescription cache staleness after a mutation.**~~ ✅ **SHIPPED 2026-08-03
  (v1.252.6).** Finding (a) turned out to be worse than filed and the fix is a **deletion**: the
  bare `fetch` in `onPhaseChanged` duplicated the `refreshExercises()` call on the next line, minus
  the `no-store`, the cache write-back, the 404 recovery *and* the request-id guard — so it could
  resolve last and overwrite fresh state with a 60s-stale response. Finding (b) added the missing
  `invalidatePrescriptionChanged` to the `aiPrescriptionPending` trigger. Finding (c) was
  investigated and is **unreachable** — after (a), every remaining reader of that endpoint either
  passes `no-store` or goes through the invalidated cache key — so no code was written for it. See
  [`docs/overview/entries/2026-08-03-prescription-cache-staleness.md`](docs/overview/entries/2026-08-03-prescription-cache-staleness.md).
  **Not reproduced end to end:** the staleness needs a real transition plus a second read inside a
  60-second window, which is not drivable from the sandbox.
- **[workouts] Q-54 — prescription-generation write race under concurrent triggers.** Two
  generation calls for the same session (duration-preset picker vs. standard auto-fire) use
  different dedup keys and can interleave three sequential writes to `session_periodization`,
  leaving `prescriptionStatus` mismatched against the stored content. Source-read finding, not yet
  reproduced — reproduction is Task 1 of the plan:
  `docs/superpowers/plans/2026-08-03-prescription-generation-race.md`.
- ~~**[workouts] Q-55 — bodyweight `target80` rendered as "X kg" in the workout-preview sheet.**~~
  ✅ **SHIPPED 2026-08-03 (v1.252.5)** — `overview-screen.tsx:484` now carries the same
  `exerciseType` guard as the block 70 lines above it. The sibling sweep was re-run and found
  nothing else: every other `target80` render is already guarded, two of them by an earlier
  short-circuit in the same ternary chain rather than an explicit check. See
  [`docs/overview/entries/2026-08-03-bodyweight-target-preview-sheet.md`](docs/overview/entries/2026-08-03-bodyweight-target-preview-sheet.md)
  — which also records a **new, smaller finding** the fix surfaced: `target80` for a bodyweight
  exercise is 0.8 × a BW_REF(100)-relative index, so it falls *below* BW_REF and inverts to
  "1 reps". Both blocks now agree and neither fabricates a weight, but "1 reps" is a weak reading
  and the right bodyweight target is a product question nobody has answered.
- Also verified clean (no findings): sync-push mirroring (`pushMutations` vs API routes) across
  every write-capable route touched in the last 40 commits; ownership checks on the two most
  recently added mutating routes; nutrition production data integrity (zero orphans, no bad values);
  sleep production data integrity beyond one n=1 edge case noted for awareness only (a 45-minute nap
  stored with all sleep-stage fields zeroed — not filed as a bug).

### [platform] ⚠️ Model-asset bucket report (Q-49 A1 gate, v1.252.3, 2026-08-03) — two of its three verdicts have never run against a real bucket

`GET /api/admin/model-assets` + the **Model asset delivery** card (Admin → Tools → Additional tools)
replace the old "read the deploy logs for eight `[oura-models]` lines" gate, which could not work:
the model loaders are lazy, so those lines only appear once a sleep rollup runs, and their absence is
indistinguishable between "bucket empty" and "nothing asked yet".

**Which surfaces were NOT exercised:** (a) the `complete` and `incomplete` verdicts — the sandbox's
bucket credentials are rejected, so only `unreachable` can be reached here (it *was* reached, live:
`SignatureDoesNotMatch (403)` with an empty missing-list, which is the behaviour the design exists
for). Their logic is unit-tested; the S3 round trip is not. (b) **The card's rendering** — it sits
behind two client-side toggles so it is absent from the server-rendered HTML, and this repo has no
React render-test setup (`vitest` runs in `node`, no `@testing-library`). Both on the owner
checklist. Ships through Railway — no APK needed.

### [activity] ⚠️ Home streak now merges unsynced workouts (Q-41, v1.252.2, 2026-08-03) — the sandbox cannot produce a single overlay row

Home's week strip and streak now merge outbox-pending workouts on top of the server payload at read
time (`mergeCalendarOverlay` + a separate `pendingDays` state), so a **second** workout on a day that
already holds a synced one is no longer masked. A workout on a fresh day already showed — the
backlog entry's stated cause was wrong and is corrected in
[`docs/overview/entries/2026-08-03-streak-local-overlay.md`](docs/overview/entries/2026-08-03-streak-local-overlay.md).

**Which surface was NOT exercised:** the overlay itself, on any path. `getLocalStore` returns null in
the web sandbox, so `pendingDays` is provably always `{}` there and the merge is a no-op — the dev
server can only demonstrate that the server-only rendering is unchanged (it is, and a test asserts
the merged result is `toEqual` the server payload for an empty overlay). Logging offline and seeing
the streak move before sync needs the APK. On the owner device checklist. Ships through Railway —
no new APK needed to *get* the change, only to verify it.

### [workouts] ⚠️ Auto-applied phase transition (v1.252.0, 2026-08-03) — device-unverified, and one branch not exercised

Auto-apply now calls `advancePhase` for a model-earned transition (fix for four session types stuck
in accumulation since June). Verified end-to-end on the local dev server: `accumulation →
intensification`, status `auto_applied`, phase moved in the DB. **Not verified:** the new rationale
banner and the amended card header on the S25 (Samsung WebView, safe-area). This is a JS/server
change, so it reaches the device through the Railway deploy — **no APK needed**, just a look at the
pre-workout screen.
**Not exercised end-to-end:** the ceiling-forced branch, because the model cannot be made to answer
"stay" on demand while a session cap is tripped; it is covered by `canAutoApplyTransition`'s unit
tests and by reasoning (a forced transition carries the previous phase's clamped loads, so applying
it would advance into a zone too light).

### [workouts] "Lower" has no primary exercise — the load anchor is a secondary (found 2026-08-03)

The active program's Lower session holds 3 secondaries and 2 accessories, no primary.
`capLoadToAnchor` (`role-plausibility.ts:53`) resolves the anchor from roles and caps every
non-anchor exercise at the anchor's pct, so with no primary the absolute role-ordering rule is
degraded on that day — a secondary is acting as the anchor. Every other session (Legs, Pull, Push,
Upper) has exactly 1 primary. Likely a program-config slip rather than an engine bug, but it should
either be corrected in the program or `capLoadToAnchor` should state what it does with no primary.

### [workouts] ✅ Estimated 1RM growth is implausible on several lifts (found 2026-08-03) — MEASURED 2026-08-03, not an estimator fault

Over seven weeks: bent-over row +45.8%, incline bench +38.7%, barbell shrug +37.6%, calf raise
+38.5%. These are not physiological gains — most likely loads ramping from a start well below true
capacity (consistent with the open "starting weights never reach the bar" issue) and/or estimator
drift. It matters because `rm1Trend` gates phase-transition eligibility and autoregulation, so every
prescription rides on these numbers.

**Resolved by measurement — it is the first hypothesis, and there is no estimator drift.** Every one
of the four was traced through production set-by-set. Each starts with a light, very-high-rep
session and progresses to a heavier, lower-rep one; the weight actually on the bar grew *more* than
the 1RM estimate did, in all four cases:

| Lift | first session | last session | bar weight | 1RM estimate |
|---|---|---|---|---|
| Bent-Over Barbell Row | 25 kg × 15 | 60 kg × 9 | **+140%** | +121% (37.5 → 82.8) |
| Incline Bench Press | 30 kg × 20 | 62.5 kg × 7 | **+108%** | +39% (56.8 → 78.8) |
| Barbell Shrug | 50 kg × 15 | 77.5 kg × 10 | **+55%** | +38% (78.5 → 108.0) |
| Barbell Calf Raise | 50 kg × 20 | 92.5 kg × 10 | **+85%** | +39% (94.8 → 131.3) |

So the estimator is **damping** the raw load increase, not inflating it — the opposite of drift. It
is also well-guarded: `repFactor` averages Epley and Brzycki, freezes the Brzycki term past 20 reps
(it blows up toward rep 36), and `REP_CEILING = 30` rejects anything beyond.

Two things follow. **(a) `rm1Trend` is reporting correctly** — those lifts genuinely went up, so the
phase-transition gate and autoregulation are reading real progression, and nothing needs changing
there. **(b) The audit's percentages are inflated by their own baseline.** Each is measured from a
15–20-rep opening set, which is where a rep-max formula is least trustworthy *and* where the lifter
was furthest below capacity. That makes the number a measurement artifact of the starting point, not
a property of the estimator.

**What stays open is the separate, already-known issue** the finding pointed at: *starting weights
never reach the bar*. This measurement corroborates it with four independent cases — a first session
at 25 kg × 15 for a lift that reaches 60 kg × 9 seven weeks later is a start far below capacity. No
new entry filed; it belongs to that issue.

~~Separately, bodyweight movements carry meaningless absolute values (Hanging Leg Raise "128 kg",
Pull-Up "118 kg") which makes their trend unreadable — worth excluding bodyweight lifts from any
stall/trend judgement.~~ **Investigated and partly wrong — corrected 2026-08-03 (v1.252.4).** A
bodyweight `estimated_1rm` is a `BW_REF`(100)-relative index, so its *trend* is readable (monotone in
reps) and must stay in stall/trend judgement; only the absolute number is meaningless, and only where
a surface prints "kg" after it. A sweep of every 1RM render found two that did: the Year in Review
(which also *selected* the wrong PR — a plain `max` over two incomparable units ranked a pull-up
above a 96 kg bench press) and the deload sheet's kg target. Both fixed; `live-1rm-readout.tsx` looks
like the same bug but is unreachable for bodyweight, and the digests were already correct. See
[`docs/overview/entries/2026-08-03-year-review-bodyweight-1rm.md`](docs/overview/entries/2026-08-03-year-review-bodyweight-1rm.md).
**The weighted-lift half above is untouched and still open.**

### [activity] ⚠️ Activity HR for GPS runs/walks (Q-41 finding 2, v1.250.4, 2026-08-02) — not run against a real GPS activity

Runs and walks now save `avgHr`/`maxHr` on the activity row instead of leaving them null; the values
come from the `/api/oura/hr-window` response the screen already fetches for its route-map colouring
and was discarding.

**Which surface was NOT exercised:** a real GPS activity end to end. That needs the whole
activity-tracking flow — location permission and a moving device — which does not exist in the
sandbox. Proven: the endpoint returns `avgHr`/`maxHr`, the effect that fetches them runs for every
activity type, and the save reads them synchronously (so the save stays instant). Unproven: that a
real run or walk finishes with non-null HR on the row. On the owner device checklist.

**Related, measured not fixed:** `cadence_spm` is null on **all 42** production activity rows while
3 carry a `cadence_series` — so Q-41's finding 4 (does the 60 spm floor reject slow walks?) was
unanswerable, and the real question is why the scalar is never written. Re-filed as **Q-47**.

### [devices][heart-rate] ⚠️ Chest-strap link status (Q-40, v1.250.3, 2026-08-02) — Kotlin half needs an APK, labels unproven on a real strap

Q-40 shipped: the pairing card's label now comes from the native service's own state rather than two
booleans (`lib/live-hr/strap-link-label.ts`, 7 tests), a **Connect** button recovers a link the
service gave up on without restarting the app, and `PolarStrapService` emits a final `stopped`
status in both teardown paths instead of dying silently.

**Which surfaces were NOT exercised:**

- **The Kotlin change did not compile locally** — the sandbox has no Android SDK (`npx cap sync
  android` succeeds; `./gradlew compileDebugKotlin` fails with "SDK location not found"). CI's
  Android job is the compile gate and it passed, but that is a build, not a run.
- **It needs a new APK to reach the device.** The JS half (label + Connect button) ships through
  Railway; the give-up-announces-itself behaviour does not.
- **No connected / retrying / stopped label has run against a real strap.** Those states are
  device-only by construction; only the unpaired web state was rendered.

Both device checks are on the checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).
Do not strike this row on intent.

### [devices][platform] `oura_raw_samples` is 452 MB and ~130 MB of that is index bloat (measured 2026-08-02)

Not a regression — a measurement, taken while re-verifying Q-35 before implementing it. Production:
740,966 rows, 146 MB heap, **306 MB of indexes**. `n_tup_upd` is 1,324,792 with `n_tup_hot_upd` of
**19**, so almost every update rewrites an entry in all four indexes.

The cause was `redecodeOuraRawSamples` re-stamping the **indexed** `measured_at` column over every
row in a page with no `IS DISTINCT FROM` guard — an update that writes back the value already there
still cannot be HOT. ✅ **Fixed in #1003 (v1.250.6)**, with a DB-backed test asserting a second pass
writes zero rows (checked against the un-fixed code, where it writes 40). **The existing ~130 MB is
still there** — that needs the one-time `REINDEX TABLE CONCURRENTLY` on the owner's console
checklist. Doing the REINDEX without this guard would simply have refilled it.

**Q-35 was retired rather than built** as a result: its Finding 1 was already done by Lever 1 (0 of
740,966 rows carry `decoded`) and its Finding 4 — a sha256 generated column for the dedup index —
would have made the table *bigger* (sha256 is 32 bytes; `body_hex` averages 24 characters). Full
numbers in
[`docs/overview/entries/2026-08-02-oura-raw-samples-footprint-remeasured.md`](docs/overview/entries/2026-08-02-oura-raw-samples-footprint-remeasured.md).

### [platform][devices][readiness] ⚠️ Health Connect tier (Q-43, v1.250.0, 2026-08-02) — never run against a real provider

Q-43 shipped: readiness degrades to the generic tables when there is no ring rollup, the derived
score is persisted so the trend surfaces fill in, `saveSleepSession` writes through the per-field
rank merge with a required `source`, and a Health Connect hypnogram is carried through to
`sleep_phase_5_min`.

**Which surface was NOT exercised:** the Health Connect ingest path itself. The owner has Health
Connect switched off and there is no second device in the sandbox, so nothing here ran against a
real provider. Specifically unproven:

- the Capacitor plugin read path (`lib/health-connect-sync.ts` — browser-only code, `pnpm dev`
  early-returns before it),
- the actual stage strings a real provider emits. The five we map were read out of the pinned
  plugin source (`RecordConverter.kt:390-400`), not from memory, but nothing has confirmed which
  ones Samsung Health / Google Fit actually populate,
- whether any real provider stages a whole night cleanly enough to clear the hypnogram's
  full-coverage requirement. If none do, the fallback is the four stage totals we already had —
  a no-op, not a regression.

Everything else is proven: the DB rank-merge orderings, the route degradation boundaries, the
rasteriser, and a `/api/sync-health` POST landing a row with `source_map` stamped `health_connect`.
Do not strike this row on intent — the device check is on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

**Adjacent finding (Q-45) — ✅ FIXED 2026-08-02 in #1007, v1.250.9.** On the Readiness breakdown a
*provisional* contributor rendered a weight-derived bar value that read exactly like a score —
"Resting heart rate 88" when there was no resting-HR data at all. Provisional factors now show their
weight as `15%` in muted text, fill the bar to that same weight, and sort last instead of
interleaving at their neutral `50` placeholder. See
[`docs/overview/entries/2026-08-02-provisional-contributor-bar.md`](docs/overview/entries/2026-08-02-provisional-contributor-bar.md).

### [activity][platform][workouts][readiness][devices] Owner bug batch reported 2026-08-02 — all 5 shipped, device checks outstanding

Five live production bugs reported by the owner on 2026-08-02. All five were traced to source in
the investigation session and **all five have now shipped** (#987, #988, #995, #996, #997) —
the plan is
[`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
with follow-ups Q-41/Q-42 still queued. What remains is **device verification** — see the checklist
in [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

1. ✅ **[activity] A guided walk can never sync, and so never reaches the training calendar (Q-36).**
   Fixed in **#987** (v1.249.5). ⚠️ The owner's stranded walk needs a manual **Retry** tap on the
   sync-health card — a dead-lettered row is never re-attempted on its own.
   `computeWalkSegmentStats` rounds segment mean HR to 1dp (`lib/walk/segment-stats.ts:23`) but
   `WalkSegmentStatSchema.avgHr` is `z.number().int()`
   (`packages/shared/src/validation/activity-log.ts:17`), so one fractional mean rejects the
   **entire** `activity_logs` payload on both write paths → dead-letter after 5 attempts.
   **Reproduced** with a Vitest run against the real schema. The walk still renders in the
   local-first Health list while being absent from Postgres — and `getCalendarData` reads
   `activity_logs` from Postgres, which is why the calendar showed nothing. The owner's device is
   holding one such stranded mutation (Activity — 2026-08-01); the fix has shipped, so the Retry tap
   noted above is all that remains.
2. ✅ **[platform] The local SQLite store fails its version upgrade on every launch (Q-37).**
   Fixed in **#988** (v1.249.6). ⚠️ NOT yet verified on device — see the dedicated Known-Issues row
   below. Three
   faults, each independently able to produce the "Sync failed — will retry automatically" toast:
   the v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` fails with "duplicate column name"
   every launch because the fallback reopen never stamps the version forward; `PRAGMA
   journal_mode=WAL` is sent through `execute()`, which cannot return rows, so **WAL has never
   actually been enabled** on this device; and a leaked connection registration is misdiagnosed as
   an upgrade fault. Separately, `applyDelta` sits outside `pullPage`'s try block, so a device-side
   schema fault surfaces as the same generic toast as a network failure.
3. ✅ **[workouts] Accepting a phase transition empties the prescription card permanently (Q-38).**
   Fixed in **#995** (v1.250.1). The transition now leaves the slot in the `'consumed'` state
   `isAiPrescriptionPending` keys on, which lights up the "Preparing your AI workout…" placeholder,
   the bounded poll and the regeneration triggers; the unreliable server self-fetch is replaced by
   a client-fired one. Verified end to end at the S25 viewport on the dev server.
4. ✅ **[readiness] The Body Battery anchor flips between readiness and sleep mid-day (Q-39).**
   Fixed in **#996** (v1.250.2). The decision moved into `app/api/body-battery/anchor.ts` and a
   readiness-derived anchor is now frozen for the rest of the day; a sleep anchor is labelled
   provisional and upgrades exactly once. Reproduced on the dev DB (82 → 54 → held at 54) and the
   provisional copy checked at 360px in both themes.
5. ✅ **[devices] The chest-strap card reads "Connecting…" forever (Q-40).** Fixed in **#997**
   (v1.250.3) — the label now comes from the service's own state (`lib/live-hr/strap-link-label.ts`,
   7 tests), a **Connect** button recovers a given-up link without an app restart, and the native
   service announces `stopped` before it dies. ⚠️ **The Kotlin half needs a new APK and none of the
   connected/retrying/stopped labels have run against a real strap** — see the Known-Issues row
   below. Previously: the label was derived
   from two booleans and `active` is true from app start (ambient mode runs all day), so every
   non-`ready` native state collapses into "Connecting…". The native service also calls `stopSelf()`
   after exhausting its backoff ladder **without emitting a final status**, so the WebView holds its
   last-seen state indefinitely.

### [cardio] Run-type carousel + zone-gap recommendation (v1.246.0, 2026-07-30)

Follow-up to the v1.245.0 entry below, same session: the flat pill-row run-type picker became a
real swipeable carousel, mirroring `app/workout-select/workout-select-content.tsx`'s session
carousel shape (one card at a time via the existing `SwipeCarousel` primitive, dot indicators, a
"Recommended" badge whose dot stays visually distinct even off-screen). The recommendation itself
is new: `lib/running/recommend-run-type.ts` deterministically scores each run type by how much of
the week's biggest **open** HR-zone gap it would close (using the same `ZoneQuota` the
Cardiovascular hub shows — no LLM number gates this), so picking Interval when Z4/5 minutes are
still owed is a computed suggestion, not a guess. Z1 never drives it (spec D-10 — passive fill).
Returns no recommendation once every training zone is already complete/not-required.

⚠️ **A second real bug found by testing this, on top of the v1.245.0 GET-recompute fix:** even
with that fix in place, reloading shortly after an override could *still* show the stale
pre-override prescription — this time because `GET /api/running-plan`'s `Cache-Control:
private, max-age=60, stale-while-revalidate=120` let the **browser's own HTTP cache** (not the
app's `cachedFetchToday`/`invalidateRunningPlan()` layer, which was already invalidating
correctly) serve a stale response for up to 60s, invisible to and uninvalidated by the app's own
cache-group system. `lib/sqlite/cache.ts`'s `cachedFetchCore` calls plain `fetch(url)` with no
`cache` override, so it fully honours that header. Fixed: `GET /api/running-plan` now sends
`Cache-Control: private, no-store` — the app's own TTL+invalidation layer already provides real,
correctly-invalidated caching, so the HTTP-cache layer was redundant and actively wrong once
multiple state changes within seconds became routine (the carousel). **Worth a sweep**: any other
route with a `max-age` Cache-Control whose data can change multiple times within that window via
rapid user action (not just occasional writes) is a candidate for the same bug — not audited
this session, flagged for a future pass.

Verified with a `page.waitForResponse`-driven Playwright script (deterministic, not
timeout-based) — pick a type → confirm the override response and rendered card agree → adjust
duration → confirm again → reload and wait specifically for that GET → confirm it still shows the
override instead of reverting. Not device-verified (same caveat as the rest of this domain;
nothing here touches native code).

### [cardio] Skip → choose your run; default session time in plan setup (v1.245.0, 2026-07-30)

Follow-up to the v1.244.0 entry below, same session. The owner wanted skip to offer a real
alternative rather than just leaving, and the session-time picker moved into plan setup:

- **`RunTypePicker`** (new, above the prescribed-run card on `/running`): a ±10 min duration
  stepper + a Recovery/Easy/Long/Tempo/Interval chip row. Selecting either POSTs to the new
  `/api/running-plan/override`, which re-prescribes today's run via `prescribeOverride()`
  (`lib/running/prescription.ts`) — the **same recovery-gate pipeline** as the framework's own
  pick, so a manual choice still can't bypass the interference/readiness/monotony/sleep safety
  checks. "Skip" is unchanged and still available as the no-thanks fallback.
- **`PlanSetupSheet`'s default session length** is no longer gated behind choosing "Fixed time" —
  every new plan now saves `timePerSessionMinutes`, seeding the stepper above.
- **The hub's "How much time do you have?" button is hidden once a running plan exists**
  (`ModalityPicker`, gated on `!hasRunningPlan`) — with a plan, the default time + the new
  per-session adjuster on `/running` cover the same job.

⚠️ **Two real bugs found by testing this feature, both fixed in the same PR:**
1. `GET /api/running-plan` always recomputed the prescription fresh from the framework, so
   reloading right after an override silently reverted the display to the AI's original pick.
   Fixed: GET now checks whether today's persisted row carries the override marker
   (`OVERRIDE_RATIONALE_PREFIX`) and, if so, builds the response from the persisted row instead
   of recomputing. **Caveat:** `gateReasons` (never persisted) come back empty on an overridden
   day — `gateAction` still reflects the gate's outcome, but the explanatory sentences are lost
   until the row resets (next day, or the run completes).
2. A slow initial-load GET could resolve *after* a faster override POST and clobber it back to
   stale data — fixed with a monotonic request-sequence ref (`requestSeqRef` in
   `running-plan-content.tsx`) so only the most-recently-fired request's response is ever applied.

Verified via curl (override → repeated GET, confirms the choice sticks) and a full Playwright
pass against the local dev DB (create plan → pick a type → adjust duration → reload → still
shows the override → skip → "Back to Cardio" still works → hub button confirmed hidden). Not
device-verified — same caveat as everything else in this domain; nothing here touches
native/Capacitor code, so risk is low, but the on-device APK path is unexercised.

### [cardio] Running-screen polish: bests card, daily zone view, skip fix, run leave-guard (v1.244.0, 2026-07-30)

Four small, independently-verified gaps found against the already-shipped cardio redesign (the full
system was designed and phased in `docs/superpowers/specs/2026-07-26-cardio-system-spec.md`, closed
with no open decisions, and Phases 1–6 mostly landed 2026-07-26→30 — this was a gap sweep against
that work, not a new design pass):

- **`/running` now shows an all-time bests card** (best 1K, best 5K, best avg pace, longest run) —
  `GET /api/running-bests`, `computeRunningBests()` in `lib/health/cardio-trends.ts`. Reuses
  `activity_logs.bestEfforts`/`avgPaceSecPerKm`, already computed per-run and previously unrendered
  anywhere. Dev-DB-verified with a seeded run row + Playwright screenshot.
- **The Cardiovascular hub's zone quota now has a Today/This week toggle** — `ZoneQuotaCard` took a
  `dayQuota`/`weekQuota` pair instead of one `quota`; `/api/cardio-week` divides the weekly framework
  target by 7 for the daily row. Steps already had this split; zone minutes didn't (Finding 2 in the
  2026-07-26 redesign brief). Dev-verified both toggle states render correct numbers.
- **Skipping today's run was a dead end** — `RunningPlanContent`'s skipped/completed state had no
  navigation; added a "Back to Cardio" button. Verified end-to-end (skip → button → lands on
  `/cardio`) via Playwright.
- **The run/activity screen had no leave-confirmation guard** — guided walk and workouts already
  confirm before a hardware-back or bottom-nav tab-away mid-session; `/activity` (run, treadmill, any
  GPS/manual activity) had none, so navigating away silently discarded an in-progress recording.
  Added `isActivityActive()` (`lib/stores/activity-store.ts`) + `LeaveActivityDialog`, wired into
  `mobile-auth-handler.tsx`'s backButton listener and `bottom-nav.tsx`'s tab-click guard, mirroring
  the existing `isGuidedWalkActive`/`LeaveWalkDialog` pattern exactly.

⚠️ **The leave-guard is NOT verified on device** — same caveat as every other hardware-back-button
guard in this codebase (`docs/domains/cardio/README.md`); the sandbox cannot generate Samsung's real
back gesture. `TabSwipeNavigator` (edge-swipe) still does not guard walk OR the new activity case —
pre-existing gap, not newly introduced, left as-is to avoid scope creep on an unrelated file.

**Deliberately not built this pass:** D-14's optional "beat-your-last" walk distance goal (closed
decision, but never actually wired into `walk-config.tsx`/`walk-active.tsx` — grepped, no match) —
flagged, not implemented, since it wasn't explicitly requested. The "How much time do you have?"
button's placement on the hub (vs. woven into the Run/Walk/Activity cards) is unresolved — it's
already where the closed spec (D-9) puts it, but the owner's original complaint about its position
was never fully disambiguated.

### [cardio] Guided walk Android status-bar pill (v1.243.1, 2026-07-29) — NOT verified on device · needs: android
`walk-active.tsx` now calls the existing `AndroidRunChip` native bridge (`lib/native/run-status-chip.ts`)
on every guided-walk phase change. No Kotlin was touched — this reuses the bridge already shipped for
the running screen's duration chip. Verified via dev-server Playwright: started a walk with mocked
geolocation, the active-walk screen rendered correctly with no new console/page errors — the bridge is
undefined in the web sandbox so the calls silently no-op, exactly as designed. **Not verified:** the
actual native chip on-device — real promoted-notification rendering in the Android 16 One UI Now Bar,
the phase-to-phase re-anchor, tap-to-reopen, and the countdown→overtime flip. Compile-gated only in
this sandbox (no Android SDK, no APK rebuild available this session).

### [readiness] Nightly temperature now uses 0x75 alone — a defensible measurement, not the ring's behaviour (v1.243.0, 2026-07-30)

Q-2 shipped: the rollup no longer flattens a frame's simultaneous probes into consecutive "samples"
(631 frames had become 2,398 samples on 631 timestamps), and no longer mixes `0x46`/`0x69`, whose
middle value sits on a 0.5 °C grid in 98.3% of 30k rows — the reason 19 of 21 nights read as exact
whole degrees and `tempZ` / readiness's `bodyTemperature` had no discriminative power.

⚠️ **Which decoded stream the ring itself consumes is still unknown.** `nightly_temperature_calculate
@ 0x203520` is an address in the Oura app binary and is not covered by `open_oura`, so the choice of
`0x75` rests on the empirical comparison in the plan (the only variant tested that yields a
non-quantised result), not on protocol. Treat the nightly value as our measurement, not as a
reproduction of Oura's.

⚠️ **The prod comparison could not be re-run in-sandbox** — no reachable prod data, and the local seed
has no `oura_raw_samples`. The first real re-aggregation is the check: nightly values should stop
landing on exact whole degrees. If they don't, the median convention is the first thing to look at.

Note the plan's "needs a redecode pass" is **retracted** — `0x75` already decodes to `temps_c` and is
already in `ROLLUP_TAGS`, so past nights recompute on the next `aggregateOuraRawSamples` run with no
owner-run step.

> **Every heading below is tagged with its domain(s)**, primary first, using the eleven pillar slugs
> from [`docs/domains/README.md`](docs/domains/README.md). To pull just one pillar's issues:
> `grep -n '^### .*\[sleep\]' projectOverview.md`. Counts today — devices 45 · workouts 39 ·
> cardio 36 · platform 30 · app-shell 18 · sleep 14 · activity 14 · heart-rate 12 · readiness 9 ·
> nutrition 6 · body 2 · cross 3. **A new entry must carry its tag(s)** — an untagged heading is
> invisible to every per-pillar sweep. Each pillar's index
> (`docs/domains/<pillar>/README.md`) links back here with that grep.

### [app-shell] Edge-swipe tab navigation stays live on the four health detail screens (2026-07-29)

`activeTabIndex()` (`components/shell/tabs.ts:29`) maps **any** `/health/*` path to the Health tab,
so on `/health/{readiness,heart-rate,sleep,activity}` the bottom nav highlights Health and
`TabSwipeNavigator` treats an edge swipe as a tab flip: a left-edge swipe fires
`navigate(-1)` → Home, a right-edge swipe fires `navigate(1)` → `/workout`. On Samsung gesture
navigation the back gesture *is* an edge swipe, so on these screens the back gesture can be consumed
as a tab change rather than a history pop — two different handlers racing on one gesture.

Found while fixing the dead back button (v1.241.2); **not fixed there** because it is a shell-layer
behaviour, separate from the tap-target bug that was reported, and the correct treatment (should a
non-tab detail screen under a tab prefix disable tab-swipe? does `activeTabIndex` need a
"detail screen" concept?) needs a decision rather than a patch.

**Not reproduced on device** — the sandbox cannot generate Samsung's system back gesture; this is
read off the code path, not observed. It is the leading candidate for the owner's report that back
from a home circle "takes you to home sometimes or health", which the v1.241.2 fixes may or may not
have fully resolved.

### [platform] `/mobile-signin` is behind the auth gate, which likely breaks first-run APK sign-in (2026-07-29)

`components/google-sign-in.tsx:29` opens `https://…/mobile-signin?challenge=<sha256>` in a system
browser to start the Capacitor OAuth flow. But `/mobile-signin` is **not** in `middleware.ts`'s
`PUBLIC_PATHS` — `"/mobile-signin".startsWith("/sign-in")` is `false` — so it is guarded like any
other route.

**Measured** against `pnpm dev`: unauthenticated `GET /mobile-signin?challenge=abc` → `307
/sign-in`, and the `challenge` param is dropped. That is the exact state of a fresh install, where
the system browser holds no Railway session. Without the challenge there is no PKCE binding, so
`/auth-mobile-bridge` is never reached and the `trainingai://` deep link that hands the APK its
session never fires. The flow would only work when the system browser *already* has a valid session
for the Railway origin.

**Not confirmed on device** — the sandbox can't run the APK, and it is possible something about the
real flow (a browser that already carries a session from a previous sign-in) has masked this. That is
also why it may have gone unnoticed: it breaks *first* sign-in, not subsequent ones.

**✅ FIXED 2026-07-30 (v1.242.3)** — `/mobile-signin` added to `PUBLIC_PATHS`. It grants no authority
`/sign-in` doesn't already grant: the page's only action is `signIn("google")` (re-read to confirm
before applying). A/B measured against `pnpm dev`: unauthenticated
`GET /mobile-signin?challenge=abc123` returned `307 → /sign-in` with the param dropped before the
change and `200` after, while a control route (`/health`) still `307`s — so the gate itself is intact.

⚠️ **Still not confirmed on a real first-run install**, which is the only way to prove the whole PKCE
chain end-to-end: a fresh APK install whose system browser carries no Railway session, through Google,
to the `trainingai://` deep link handing the app its session. The middleware half is verified; the
chain beyond it is not.

### [platform] ⚠️ Local SQLite open-path recovery (Q-37) is NOT verified on device (2026-08-02) · needs: android

**Was:** three faults compounding on every launch of the owner's S25, visible in the device console.
(a) `PRAGMA journal_mode=WAL` went through `execute()`, which cannot return rows — the pragma
*returns* one, so the call always threw and **WAL has never been enabled on this device**.
(b) The v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` failed with "duplicate column name"
on every launch; the fallback reopened at version 1 but never stamped the version forward, so the
poisoned upgrade was retried forever. (c) A leaked connection registration
("Connection trainingai already exists") was misdiagnosed as an upgrade fault and pushed down the
version-1 fallback path. Separately, `applyDelta` sat outside `pullPage`'s try, so a device-side
schema fault surfaced as the same generic "Sync failed" toast as a network failure — and so did a
plain backoff window, which is not a failure at all.

**Now:** WAL is set through `query()` and the resulting mode is checked; a stale registration is
closed before opening; `reconcileSchema()` reports whether it fully succeeded and the schema version
is stamped forward **only** after a clean reconcile (stamping a partial one would retire the repair
path with work outstanding); `applyDelta` failures are caught, logged, and reported as a failed page
so the caller's existing backoff applies; and a backoff window gets its own toast copy.

⚠️ **NOT VERIFIED ON DEVICE — this is the gate this row exists to record.** `getLocalStore` returns
`null` in the web sandbox and `initSQLite` early-returns when the Capacitor plugin is absent, so
**none of this code executes under `pnpm dev`** — the dev-server run only confirmed the app still
compiles and `/session-select` renders. This is the file that has silently killed the local DB twice
(WAL-in-transaction #27, non-idempotent ADD COLUMN #85). What still needs an on-device pass:
WAL actually reporting `wal`; the v13 upgrade no longer failing on launch; `user_version` stamped to
21; and no "Connection trainingai already exists" on a cold start.

The version stamp's safety rests on the `RECONCILE_COLUMNS` mirror test in
`lib/sqlite/__tests__/migrations.test.ts` being exhaustive — it was made case-insensitive in the
same PR, since a lowercase `alter table … add column` would otherwise escape the guard and be
retired unrepaired.

### [platform] Deactivating a user takes effect within ~24h, not instantly (v1.246.2, 2026-07-30)

**Was:** `auth.config.ts` set `token.isActive` only when a `user` object was present — i.e. at
sign-in — so a user deactivated afterwards kept `isActive: true` in their JWT and `middleware.ts:18`
(the only enforcement point) let them through until the token was re-minted, up to 7 days.

**Now:** `auth.ts`'s jwt callback re-reads `isActive` from the DB via `refreshIsActiveClaim`
(`lib/auth/is-active-refresh.ts`), throttled to once per 24h per user. The check cannot live in
middleware — that runs on the Edge runtime and imports the deliberately Node-free `auth.config.ts`
("no bcrypt, no pg") — so it lives in the Node config and middleware reads the claim it refreshes.
It is a claim refresh, not a re-authentication: a continuously-active user is never signed out or
re-prompted (covered by a test that walks a week of hourly use and asserts 7 lookups, claim always
true).

⚠️ **Residual, accepted by the owner:** the window is bounded, not closed — deactivation can take up
to a day to bite. Closing it fully would mean a Node-side re-check at a server choke point (root
layout / a shared `requireActiveUser()`), costing a DB query per server render; judged
disproportionate for a small invited-user app.

⚠️ **The 24h flip was not observed end-to-end.** The refresh logic has 8 unit tests, and sign-in,
guarded routes and the session payload were verified unaffected against `pnpm dev` — but watching a
real token cross the 24h boundary needs either a day or a faked clock, and neither was run. A DB blip
during the re-read leaves the claim untouched and does not advance the timestamp, so it retries.

### [app-shell] Screen transition timing + prefetch (v1.241.1, 2026-07-29) — NOT verified on device · needs: android
The view transition's early-resolve was dead code — `pendingRef` lived on the component that called
`push()`, which unmounts on navigation, so every push fell through to the timeout cap regardless of
how fast the route was (measured: route ready at 51 ms, screen frozen until 184 ms). Commit is now
detected by polling `location.href`, which has no React lifecycle coupling. Plus `router.prefetch`
on the four health score circles and their sibling surfaces, and a sequenced (rather than
simultaneous) cross-fade so two dense screens no longer superimpose mid-animation.

Measured in Chromium at 412×915 under a 150 ms RTT / 4 Mbps CDP throttle standing in for the mobile
link to Railway: time-to-motion 190/213/211 ms → 118/129/118 ms across warm runs, and it now tracks
the route commit rather than a fixed floor. **Chromium is not Samsung's WebView** and the throttle is
a stand-in, not a measurement of the real link — so the felt result on the S25 is unconfirmed. The
25%/40% fade split, the 200 ms duration and the 30 px displacement are all judgement calls made
against a slowed desktop capture and are one-line changes in `globals.css`.

### [cardio] Guided walk per-segment stats (v1.240.0, 2026-07-29) — NOT verified on device · needs: browser
The new `activity_logs.segments` column and the walk-complete screen's HR-zone-colored map/
fast-slow average cards were verified via Playwright against the dev server: a real 10-segment
array with correct per-segment pace/distance saved (`POST /api/activity-logs` → 201), the map and
average cards rendered correctly. Two things weren't exercised: **real HR-zone-colored route
segments** — this sandbox has no live HR samples, so `zoneSegments` correctly fell back to the flat
single-color line rather than actually painting per-run zone colors; and **the native offline-first
path** — `getLocalStore` returns null in the web sandbox, so only the web-fallback save (not
`upsertActivityLog`/local SQLite/`applyDelta` pull-sync) was exercised for the new column.

### [sleep] ⚠️ Two staging changes shipped but NEVER observed on a real night (2026-08-02, v1.251.0 / v1.251.1)

Q-34 item 3 added `spo2Var` — within-epoch SpO₂ spread — as a fourth REM/wake signal in the
heuristic stager (`W_SPO2 = 0.2`). **Two things about it are unknown and only the device can answer
them**, because `aggregateOuraRawSamples` needs real `oura_raw_samples` rows and the local database
has none:

1. **Whether the column is populated at all.** The spread is gated at ≥ 5 valid SpO₂ readings inside
   one 5-minute epoch, and the ring's oximeter cadence over BLE has never been measured against that
   bar. Mostly-blank is a real possible outcome.
2. **Whether it discriminates.** If populated values are weakly bimodal, that is the same negative
   result `brVar` gave in session 246.

**Risk is bounded, not zero.** The term is self-neutralising by construction — a null z-scores to 0,
and a uniform column has no spread for the per-night z-score to read — so a quiet oximeter leaves
staging exactly as it was, and a unit test pins that. What is genuinely unverified is the *populated*
case: if the column is dense but noisy it will perturb REM/light boundaries on real nights before
anyone has looked at it.

What WAS verified in-sandbox: the pure spread function (sample floor, artefact rejection, ranking),
the self-neutralising path, and that the term is genuinely read (a night differing only in its
`spo2Var` column stages differently; the test fails with `W_SPO2 = 0`).

**A second change rides on the same device check: the ultradian cycle prior (v1.251.1, Q-34 item 2).**
Sleep staging now expects REM to recur on a ~95-minute grid rather than ramping linearly across the
night (`W_CYCLE = 0.15`, modulating the existing `W_TIME` term rather than replacing it). Its pure
prior function is unit-tested, but **no stager-level behavioural test ships with it** — three were
attempted and every one passed with the weight zeroed, so none proved anything. Its effect on a real
night is therefore entirely unobserved, and the plan names a concrete failure mode: a fixed period
can fight the Viterbi bout decoder on a fragmented night. The revert is deleting two addends.

Clear this row from the device check on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md)
— Redecode a night, read the `spo2V` column in the admin debug dump. Do not tune `W_SPO2` before
that answer exists; the verdict belongs in
[`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [workouts] Exercise Readiness rework (v1.235.0, 2026-07-29) — NOT verified on device · needs: browser

Driven end-to-end in a real browser at an S25-shaped 412×915 viewport (all four sections render, the
body map tracks the pills, Sick/Unwell warns, Quick rebuilds the plan and the stored estimate fell
38 → 24 min). **But the browser is not the device.** Unverified: Samsung WebView rendering of the
body-map SVG inside a bottom sheet, real safe-area insets, and haptics. The sheet deliberately adds
no `pb-safe` of its own — `SheetContent side="bottom"` owns the bottom inset — but that is reasoning,
not an observation.

Auto-marking WAS exercised against a seeded recent session (chest at 57 % recovered opened pre-marked,
with the in-session warning), but **not against the real multi-week history**. The safety argument —
8 of the last 10 production sessions share zero muscles with the session before, so this usually marks
muscles that aren't trained today and changes nothing — is a measurement of the data, not an
observation of the UI running on it. On the first real check-in, confirm the auto-marked muscles match
what you actually trained, since a marked muscle in today's session lightens those exercises.

Note the `LAGGING_RATIO` and realisation-phase caveats in the role-ordering row below still apply, and
now matter more: the short/long presets are the surfaces where weekly-volume rebalancing is most
visible.

### [devices][body] Scale passive-scan background sync (v1.246.9 → v1.249.1, 2026-07-30/31, 2026-08-01) — persistent connection + dedup fixes, PARTIALLY verified on device
Reworked `ScaleBleService` from a continuous 45s-poll foreground service (always-visible
notification) to a `BluetoothLeScanner`-PendingIntent scan (`ScaleBleScanManager`) that only wakes
`ScaleScanReceiver`/the service when the paired scale actually starts advertising — see the Latest
Feature entry above for the full mechanism.

The retry-storm cooldown (v1.242.0) initially looked confirmed via a `chrome://inspect` capture
(real weigh-in succeeded, a repeat scan match was correctly suppressed, cooldown correctly
suppressed the next wake) — **but the wake episodes kept recurring indefinitely on a steady ~3
minute cycle even hours later**, which an independent BLE scanner (nRF Connect) proved was NOT the
scale: it only appears in a neutral scan while someone is actually stepping on it. The earlier
"scale re-advertises on its own / motion-sensor wake" theory in this entry was **wrong** — root
cause is that Android's `PendingIntent`-based scan can redeliver a stale `ScanResult` well after
the real advertisement stopped, and `ScaleScanReceiver` trusted "the broadcast fired" alone as
proof of a live weigh-in, with no check on when the match was actually seen. Fixed by reading each
`ScanResult.timestampNanos` out of the intent extras and discarding the broadcast unless at least
one result is within `MAX_RESULT_AGE_MS` (5s) of now — **confirmed on-device 2026-07-30**: the
owner rebuilt and the endless-loop bug is gone, every wake now resolves within a bounded couple of
attempts.

That same test surfaced a smaller, real side effect of the v1.242.0 cooldown: the scale genuinely
(not stale-filtered) keeps re-advertising for a short post-use settling period after a real
weigh-in, which triggers one bounded retry cycle that gives up and starts the cooldown — and the
owner's deliberate second weigh-in ~2 minutes later landed inside that 2-minute window and was
silently missed. `GIVE_UP_COOLDOWN_MS` cut to 20s (see Latest Feature) since a real weigh-in always
succeeds on its first attempt regardless of cooldown length. Also added `notifyWeighInLogged()` —
a plain successful weigh-in previously produced no lasting confirmation once the transient
"syncing…" notification disappeared. **Not yet verified on-device** — needs the owner to rebuild
and re-run the back-to-back-weigh-in test.

That rebuild+test surfaced a third bug: the very first connection of a fresh app session could
reach `state=waiting` and then receive zero `FFE1` notifications at all (not even unstable) for the
full 30s timeout, despite the owner standing on the scale the whole time (confirmed via the scale's
own countdown) — the very next connection in the same session worked immediately. Theory (see
Latest Feature): the `FFE1` notify-subscribe write can silently fail to take on a fresh GATT
session without `onDescriptorWrite` noticing, matching this codebase's documented Samsung-BLE-stack
flakiness elsewhere (the Oura ring). **Not a regression from #929/#937** — `ScaleGattClient.kt`
hasn't changed since the original integration (#848); what changed is connection frequency, since
pre-#929 stale-scan replays triggered a real reconnect every ~3 minutes and incidentally kept the
BLE stack warm, masking this cold-first-connection case that #929's fix now exposes as the normal
case. Added an 8s early-data watchdog in `ScaleGattClient` that gives
up and lets the service reconnect with a fresh GATT session if zero notifications arrive that
quickly, instead of waiting the full 30s.

**Owner rebuilt and re-tested (2026-07-30): the watchdog did NOT fix it** — a fresh weigh-in still
timed out at the full 30s with no visible notifications, twice in a row, and the new watchdog's own
log line never appeared. Source confirmed correct (owner's local `main` checkout had the merged
fix). Root cause of the miss, found on review: `onCharacteristicChanged` calls
`cancelEarlyDataTimeout()` unconditionally for *any* `FFE1` notification, including one that then
fails `ScaleProtocol.parseWeightPacket` and hits its own `return` with **no log line at all** (the
"malformed or the auto handshake frame" case the original code comment already knew about). If the
scale sends exactly one such frame right after subscribe — proving the subscribe worked — the
watchdog retires silently, and if no genuine weight packet ever follows, the connection then sits
out the full `WEIGH_IN_TIMEOUT_MS` with a console trace indistinguishable from the original
zero-notification bug. Added a log line for that swallowed case (`fix/scale-ble-handshake-frame-watchdog-log`,
diagnostic only — no behavior change) so the next on-device run can confirm or rule this out.

**Confirmed by owner's next test (2026-07-30, 4 weigh-ins within ~1 minute):** the scale reliably
sends an always-11-byte unparseable frame as the first `FFE1` notification on every connection,
before any real reading. 2 of 4 attempts got real data right after it and succeeded; 1 of 4 got only
that frame and then genuine silence for the rest of the 30s — the exact bug, now proven rather than
theorized. (The 4th attempt failed a different way — `connectionStateChange status=19`, the scale
itself terminating the connection mid-measurement — logged as a separate, not-yet-investigated
failure mode; the existing 2-attempt-then-cooldown retry policy already absorbed it correctly.)
Real fix: `onCharacteristicChanged` now re-arms the early-data watchdog when it sees an unparseable
frame instead of retiring it for good, so a connection that stalls right after the handshake frame
still bails within `EARLY_DATA_TIMEOUT_MS` of *that* frame rather than sitting out the remaining
~22s. The outer `WEIGH_IN_TIMEOUT_MS` runs as an independent, never-reset timer, so this can't push
a stalled connection past the original 30s ceiling regardless of how many junk frames arrive.
**Device-verified 2026-07-30.** Owner rebuilt and retested: a real weigh-in registered normally
(handshake frame, then immediate unstable → stable data). Separately, the scale's own post-weigh-in
settling re-advertisement triggered a fresh connection that got only the handshake frame and then
genuine silence — and this time it printed `"no data within 8s of request — notify subscribe likely
failed, retrying"` and bailed after 8s, instead of the old 30s `weigh-in timeout`. That's the fix
firing exactly as designed, live on-device, not just in theory.

**Reframed root cause (2026-07-30), from the owner's actual test procedure:** step on the scale →
wait for its own display to say "complete" → check the phone → nothing yet → step back on → that's
when a reading landed. Combined with the handshake frame appearing in **100% of captures so far**
(success and failure alike), this points away from "notify-subscribe sometimes silently fails" and
toward a race: the scale's local measurement cycle finishes faster than the phone's full BLE
pipeline (scan-detect → connect → discover services → subscribe → write the request), so the
request often goes out after the person has already stepped off, with nothing new to report. Two
follow-up changes in `ScaleBleService.kt`: `notifyWeighInFailed()` (new low-priority notification —
"Weigh-in not captured — step on the scale again" — fires when a wake exhausts all attempts; this
path previously notified nothing at all, so a failed weigh-in and a successful one looked identical
from the notification shade), and `MAX_ATTEMPTS` bumped 2→3 with the retry notification text changed
to "Retrying — stay on the scale…" (one more bounded ~8-30s cycle to catch a delayed
re-engagement, explicit user tradeoff — accepted a longer worst-case wake for better odds of
catching it). **Not yet verified on-device.** Still open: the `connectionStateChange status=19`
mid-measurement disconnect (separate failure mode, no grounded theory yet), the `ScaleBootReceiver`
reboot re-arm, the two-phone household scenario, and whether the race theory should also drive a UI
change (explicit "stay on the scale a few seconds" guidance) rather than just service-level tuning.
Separately raised by the owner: whether the scale buffers recent readings for later pull (like the
official Renpho app appears to show). A real, independent third-party open-source client for this
exact scale family (`ronnnnnnnnnnnnn/renpho-escs20m`) confirms such a mechanism genuinely exists on
this scale family (`_OP_STORED_MEASUREMENT`, query commands documented) and, as a bonus, resolves
what our own always-11-byte unparseable frame actually is — their `_OP_UNIT_REQUEST = 0x12` opcode
matches our own Phase 0 note about a "handshake-identification packet... marker `0x12`" exactly, so
it's a display-unit request, not a stored-measurement record. Their command opcode family
(`0x20`/`0x22`-prefixed) doesn't match our own scale's confirmed, 4-times-verified live-measurement
opcode (`0x13`-prefixed) — different firmware/scale variant — so it isn't verified against our
hardware. **Update (v1.246.9): implemented anyway, as an explicit owner-authorized bet** (see the
Latest Feature entry above and `docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-
and-scan-latency.md` for the full reasoning) — written to fail silently if the guess is wrong, with
no server-side changes needed (reuses the existing `/api/scale-ble/samples` `measuredAt` field).
Backlog Q-36 removed since the "concrete next step" it described has now been taken; whether it
actually works is an open question for the owner's next on-device test, not a backlog item.

**Continued (2026-07-31 – 2026-08-01), owner-directed on-device iteration, no separate planning
PR — same arc, ten more rounds (#965–#974):**

- **False positive matches (#965, device-confirmed).** `ScaleBleService`'s FFE0 service-UUID scan
  filter matches any nearby BLE peripheral built on the same generic Bluetooth-serial module
  (fitness bands, LED controllers, OBD adapters, etc. all share the FFE0/1/2/3 pattern), not just
  the paired scale — confirmed on-device connecting to something that wasn't the scale at all,
  producing a misleading "step on the scale again" failure with nobody near it. Both the live
  (`ScaleForegroundScanner`) and background (`ScaleScanReceiver`) scan paths now additionally
  check the matched result's own MAC against the paired scale's stored `device_id` before acting.
- **Stale toast bleed-through (#966, device-confirmed).** Sonner's toast-update-by-id merges the
  old toast object into the new one; `toast.success/warning/error`'s `data` type omits `jsx`, so
  it could never clear the progress-bar `jsx` set by the in-progress toast — a frozen "Weighing
  you…" bar was rendering underneath the real result text. Fixed by rendering every weigh-in toast
  state (progress **and** result) via `toast.custom()`, so each call always sets a fresh `jsx`.
- **Scan latency tuning (#967)** — `MATCH_MODE_AGGRESSIVE`/`MATCH_NUM_ONE_ADVERTISEMENT` on the
  live Home-screen scan (safe now that scan is scoped to Home-screen dwell, not all-day), plus a
  diagnostic-only `scan_source` tag (live vs. background) to settle which scan path actually wins
  the race, next time it's needed.
- **FFE3 request-write back-and-forth (#968–#971), same-day reversal.** Raw hex logging (#968) of
  the previously "harmless" unparseable handshake frame surfaced a real disagreement with an
  earlier note, prompting closer investigation. #969 re-enabled the previously-disabled speculative
  stored-measurement drain write as a genuine second attempt. #970 made the live-measurement
  request (`FFE3`) write a *fallback* — subscribe-and-wait first, only write if nothing arrives
  within `EARLY_DATA_TIMEOUT_MS` — on the theory the write itself was resetting the scale's
  in-progress reading. **#971 reverted that the same day**: on-device testing showed deferring the
  write made the common case *worse* (stopped producing the sometimes-instant weigh-ins earlier
  iterations had), stronger evidence than the correlation that motivated the defer. Net effect:
  request-write timing is back to "write immediately after subscribing," same as the original
  integration, with `EARLY_DATA_TIMEOUT_MS` simplified back to a single-tier watchdog armed once
  per connection instead of twice.
- **Persistent connection, modeled on the Polar strap (#972, architecture change).** Previously
  each wake ran a bounded connect-attempt-then-disconnect cycle (`CYCLE_BUDGET_MS`, 12–16s). On-device
  testing kept finding "instant" weigh-ins only when a connection was *already* open (via nRF
  Connect, the official app, or a prior run of this app) and never torn down — i.e. this app was
  discarding a working link every time and paying the full reconnect cost on the next wake, not
  missing a handshake. `ScaleBleService` now holds the GATT connection open indefinitely once
  linked (`START_STICKY`, no auto-disconnect after one reading) and reports every weigh-in that
  happens on it, the same pattern `PolarStrapService` already uses for the chest strap.
  `MAX_ATTEMPTS` bumped 3→5 since a successful first link now pays off for the whole session
  instead of being thrown away after one reading.
- **Scoped to the Home screen (#973)**, since the connection is no longer self-bounding: the
  persistent link (and the aggressive live scan from #967) now stops outright when the owner
  leaves Home (`setHomeScreenActive(false)` calls `stopService`), and a background scan hit is
  ignored unless `ScaleForegroundScanner.isHomeScreenActive()` — keeping the new architecture's
  battery cost bounded to actual dwell time rather than "the app is open anywhere."
- **Two bugs that were direct consequences of going persistent (#974, NOT yet device-confirmed).**
  The scale itself retransmits an identical stable-weight packet up to 3× before going idle; with
  the connection no longer closed after one reading, each repeat was being treated as a brand new
  weigh-in and re-posted to ingest — `ScaleGattClient` now drops a stable reading matching the last
  one it reported within a short window. Separately, the scale disconnects on its own after a
  reading and `ScaleBleService`'s background reconnect was forwarding its
  CONNECTING/PREPARING/WAITING transitions to JS exactly like a fresh weigh-in, reopening the
  "weighing you…" toast with nothing left to weigh (and firing a spurious failure notification if
  that reconnect then timed out) — state forwarding and failure notifications are now suppressed
  for background reconnects following a capture, and only a genuine `onUnstableReading` reopens the
  cycle.

**Net effect of this round:** weigh-in reliability should be meaningfully better (persistent
connection catches readings the old bounded-cycle model was structurally likely to miss, false
device matches are gated out, duplicate postings and stuck toasts from the new architecture are
fixed) — but **the persistent-connection redesign itself (#972–#974) has no on-device confirmation
recorded**, unlike every earlier step in this arc which was explicitly rebuilt-and-retested before
the next theory was tried. This entire round is native Kotlin (`android/app/.../scale/*.kt`) —
compile-gated only in the sandbox, requires `npx cap sync android && ./gradlew assembleDebug` to
reach a real device. Per the Canonical Runtime device-verification gate, treat as **NOT verified**
until the owner rebuilds and runs a normal weigh-in, a back-to-back double weigh-in (the #974 dedup
case), and a Home→Settings→Home screen transition (the #973 scoping case).

**First real on-device rebuild (2026-08-01), via `chrome://inspect`:** a normal weigh-in captured
correctly (71.75 kg + impedance), and the #974 duplicate-reading dedup **is confirmed working** —
two repeat stable frames from the same weigh-in were correctly logged as "ignored — scale repeated
the same frame it already reported." But the stuck-toast fix was only half-effective: the scale's
post-reading disconnect (`status=19`) triggered a background reconnect through `onFailure()`'s
retry branch, which broadcasts `scaleStatus=retrying` **unconditionally** — that path was never
covered by the `hasCapturedThisWake` guard #974 added to `onState()` (guards a different call
site), so the JS toast reopened as "Still trying — stay on the scale…" right after a successful
capture, the same user-visible bug in different wording. Fixed by extending the same guard to the
`retrying` broadcast (and to the paired "Retrying — stay on the scale…" foreground-notification
update) in `onFailure()`. **Not yet re-verified on device** — needs another rebuild + the same
back-to-back weigh-in test to confirm the toast now stays on the success state through a
post-capture reconnect.

**Second rebuild (2026-08-01): the retrying-suppression fix is confirmed.** Same test — capture,
dedup-ignored repeats, `status=19` disconnect, `RETRY_GAP_MS`-timed reconnect — but this time with
no `state=retrying` line and no toast reopening. Separately, the owner raised a different concern
from the same test: connect/detect speed feels noticeably worse than the very first integration
(#848), describing a "prime the connection by stepping on once, then it's instant ~30s later"
workaround. Two responses, both native-only, not yet device-tested:
- **Restored the stored-measurement-drain request** (`ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD`,
  `0x22 0x04 0x15`), which turned out to have been silently dropped: #969 (2026-08-01 08:19) added
  the write, #970 (2026-08-01 11:36, "defer FFE3 to a fallback path") rewrote `onServicesDiscovered`
  and dropped it as a side effect while doing something unrelated, and #971's revert of #970 never
  noticed it was gone. The receive side (`parseStoredRecord`/`onStoredReading`/`postStoredReading`)
  was never removed, so this was dead code with nothing left to trigger it. Restoring the write is
  the most direct fix for the owner's actual complaint — a missed live connection window currently
  just loses that reading instead of it being recoverable on the next connect.
- **Added stage-timing diagnostics** to `ScaleGattClient`, logging elapsed ms (from `connectGatt()`)
  at gatt-connected, services-discovered, notify-subscribed, measurement-requested, and
  first-FFE1-notification. Purpose is purely diagnostic — comparing a "cold" first connect's log
  against a "primed" one should show which specific stage the latency is actually in, rather than
  guessing between Home-screen-scoping races, GATT service-discovery caching, or something else.
- **On-device timing captured (2026-08-01), analysed, findings written up:** see
  [`docs/scale-ble-connect-latency.md`](docs/scale-ble-connect-latency.md). Headline: the entire
  ~950ms gap between a cold connect (2206ms to link-alive) and a warm one (1270ms) lives in raw
  GATT connection establishment, not in anything our own discover/subscribe/request code does. The
  "priming" the owner described is already what #972's persistent-connection design provides
  (holding the link open indefinitely once linked); the remaining constraint — the scale doesn't
  advertise at all while idle — is a hardware limit no app can pre-connect around. **Still open:**
  the captured "warm" sample was an automatic same-session reconnect after a peer-drop, not the
  originally-reported "walked away, came back 30s later" scenario, so that comparison is still
  needed; a parked idea to decompile the Renpho app's APK for connection-parameter differences
  (bonding, PHY/interval) is blocked pending the owner supplying the file.
- **Found from the same on-device session: the persistent connection produced a false "Weighing
  you…" toast on every Home-tab visit.** Confirmed from the captured log — a connection linked at
  `08.887` sat idle for 22s before the first real reading at `30.946`, with the toast showing the
  whole time. Root cause: `setHomeScreenActive` stops/restarts `ScaleBleService` on Home-tab
  focus/blur to bound its now-persistent battery cost to Home-screen dwell time, and a return to
  Home can re-link while the scale is still finishing its own post-use re-advertising — with
  nobody actually on it. `onState()`/`onFailure()` broadcast CONNECTING/PREPARING/WAITING/RETRYING
  to JS unconditionally on any such reconnect, with no way to tell "just re-linking" apart from "a
  real weigh-in in progress". **Fixed:** added `hasSeenActivityThisWake`, set only by
  `onUnstableReading` (real proof someone is on the plates) — gates the progress toast, the
  "Retrying…" state, and the `notifyWeighInFailed()` give-up notification, all previously keyed off
  bare connection state. Trade-off, accepted: a genuine step-on whose connect fails before ever
  receiving a real weight packet now also fails silently (no "Didn't catch that") — there's no BLE
  evidence to distinguish that case from a spurious reconnect, and the spurious case is far more
  common in practice. Kotlin-only (`ScaleBleService.kt`), no JS changes needed. **Not yet
  on-device tested** — needs a rebuild, then repeated Home-tab navigation with nobody on the scale
  (should show nothing) and a real weigh-in (should still show the toast, with a real-world
  imperceptible ~1s-or-less delay vs before, since it now waits for the first unstable reading
  rather than bare connection state).

### [cardio] Guided walk GPS/pace (v1.233.0, 2026-07-29) — NOT verified on device · needs: hardware
Live GPS tracking, the route map, and pace-primary UI in the guided interval walk were only
exercised via Playwright against the dev server with `navigator.geolocation` mocked — that drives
`lib/activity/gps-tracking.ts`'s **web** fallback (`navigator.geolocation.watchPosition`), never
the native `@capacitor-community/background-geolocation` path real devices use. End-to-end save
was confirmed real (a `POST /api/activity-logs` with real computed route/pace fields returned
201), and the no-GPS-fix degradation (indoor/treadmill walk, today's HR-primary layout) was also
confirmed to render without a crash. What's unverified: the native background-location permission
flow, whether GPS keeps reporting fixes with the screen off during a real walk, and real ring/strap
cadence running concurrently with real GPS movement.

### [workouts] Role ordering (v1.232.0 + v1.233.1, 2026-07-28/29) — clamp now observed firing; two knobs untuned

**Update (v1.233.1):** the earlier note here said the clamp had never been seen to fire. It has now.
The live Upper shape (accessory `5×7 @77.5 %` vs primary `4×7 @76 %`) was seeded into the local DB and
read back through the periodization route as **`4×7 @76 %`**, with the stored row unchanged — so both
the load cap and the set ceiling bind, read-side, without a write.

Also fixed in v1.233.1: the generation-time rule could not reach prescriptions **already stored**, and
production's Upper plan (generated 6 days before the rule shipped) was still serving the bad numbers.
Role caps now apply on read via `normalizeStoredPrescription`. Note the read path applies only the two
*absolute* rules (per-role set ceiling, anchor load cap) — **not** the anchor set cap, whose
lagging-muscle exception needs weekly-volume data the read path lacks.

Still worth watching rather than assuming:
- **`LAGGING_RATIO = -0.25` is an untuned guess.** It decides how eagerly role order breaks on volume.
  If accessories start routinely out-setting compounds, it is too close to zero.
- **The realisation-phase case is tested but not observed.** A realisation primary is deliberately
  low-set (3×2) beside legitimately high-volume isolation work; the lagging exception is what stops the
  rule stripping that volume. Covered by a unit test, not yet by a real realisation block.
- **`workout-data`'s weight-bearing output was not watched end-to-end** — the local seed has an empty
  `baseline_1rm`, so no weights are computed there. Same helper, same role map as the verified path.

Server-side only — no native surface, so no device verification is required for these changes.

### [workouts] Q-5 personal records vs starting weights (v1.231.0, 2026-07-28) — two known gaps
`personal_records` is now log-derived only; the starting 1RM typed in the builder lives in the new
`exercise_estimates` and finally reaches the bar via one shared `resolveWorkingBasis`. Verified
end-to-end on `pnpm dev`: a typed 100 kg produced `estimated1rm: 100` where it was previously null,
with `personal_records` confirmed untouched.

**Gap 1 — historical rows are still wrong.** 5 `personal_records` rows disagree with the best
surviving log (Barbell Bench Press 90.8 vs a real 96.0, Barbell Front Squat 67.5 vs 73.8, plus three
whose values appear in no log), and 5 near-duplicate spellings still split one exercise's best
across two rows. Correcting them **rewrites real user data**, so it is queued as **Q-5b** for
owner confirmation rather than merged here. New drift is prevented from today either way.

**Gap 2 — no offline mirror yet.** `exercise_estimates` has no local-store table, so offline an
exercise with only a typed estimate (no log) still resolves to null. Online-first flow, so the
common path is unaffected, but it is a real offline-first gap.

Also deferred: `computeInitialWeights` still has its `return 60` fallback. The resolver makes it
unreachable for any exercise with a log, PR or estimate — what is left is the genuinely-nothing
case, and changing what the weight input renders with no value wants an on-device look.

### [workouts][platform] Local exercise-library mirror (v1.234.2, 2026-07-29) — NOT verified on device · needs: browser
The on-device store now mirrors the exercise catalogue, so an offline read can tell a bodyweight
movement from a weighted one instead of assuming `weighted` (Q-20). Hydrated from the
`/api/workout-data` response; falls back to `weighted` for an exercise the mirror has not seen.

**Not device-verified, and that is the entire surface this change lives on.** `getLocalStore`
returns null in the web sandbox, so the v20 migration, the accessors, the hydration write and the
offline read all went unrun natively — only the pure logic and the server half were exercised.
Requires an APK rebuild.

Owner check: open the app once online so the mirror populates, then go offline and open a session
containing a bodyweight exercise (e.g. Pull-Up) — it should render a rep target, not a kg weight.
Also confirm no dead-store banner on first open after the v20 upgrade.

### [workouts] AI prescription silent auto-dismiss + generation moved to pre-workout (v1.247.0, 2026-07-30)

Owner noticed a phase-transition recommendation on a real "Upper" session showed
`AI Prescription · Accumulation · Dismissed` despite never having tapped Move or Skip. Traced via
`POST /api/admin/db-query` against production: the prescription was generated 2026-07-22, its 7-day
`prescription_expires_at` lapsed 2026-07-29 with nobody having acted on it (the owner hadn't reopened
that specific session in the interim), and the very next open — `GET
/api/ai-periodization/session/[id]` — silently flipped `pending` → `dismissed` with no prompt. Root
cause: two auto-dismiss-on-expiry code paths (that GET route, and `workout-data`'s equivalent) existed
specifically so a stale phase decision couldn't linger — but "linger" was resolved by silently
deciding *no* on the owner's behalf, which is worse than lingering.

**Fix (three parts, one PR):**
1. **No auto-expiry, anywhere.** Removed both auto-dismiss-on-expiry blocks
   (`app/api/ai-periodization/session/[sessionId]/route.ts`, `app/api/workout-data/route.ts`) and the
   matching `expired` gates in `app/api/next-session/route.ts` and
   `app/api/next-session/prescription/route.ts` that mirrored them. A `pending` prescription — phase
   transition, deload, or otherwise — now only ever changes status on an explicit Move/Skip/Accept/
   Dismiss. `prescriptionExpiresAt` is still stored (harmless) but nothing reads it for gating anymore.
2. **Generation moved from session-end to pre-workout-open**, closing the staleness problem at the
   source rather than papering over it with an expiry: `regenerateNextPrescription` and its two callers
   (`app/api/complete-workout/route.ts`, the offline-outbox `complete_workout` branch in
   `lib/data/postgres/adapter.ts`) are deleted. `completeWorkoutFromPayload` just marks the slot
   `consumed`; the existing `isAiPrescriptionPending` on-open trigger (previously the Gemini-outage
   retry path) is now the only generation trigger, so a prescription is never more than minutes old by
   the time it's acted on. This reverses the 2026-07-20 "generate at session end" decision — see that
   entry's history for why it existed (a blank "Auto" chip on the Health card) — because the owner
   confirmed that chip distinction is redundant (auto-apply is a single program-wide toggle) and asked
   for a more useful stat instead.
3. **`AiPeriodizationStatusCard`** (Health → Training) replaced the Auto/Ready/New status dot with
   "Nd ago" / "Yesterday" / "Trained today" / "Never trained" per session
   (`app/api/ai-periodization/program-overview/route.ts` now returns `lastTrainedDaysAgo` via the
   existing `getRecentSessionsOfType`, no new repo method).

**Verified:** full test suite green (2 new/updated test files, one pre-existing DB-test env quirk
unrelated to this change — see the DB-test note above), `tsc` clean, lint clean (pre-existing warnings
only), both Custom Rules checks pass. Exercised against `pnpm dev` on local Postgres with the exact
production shape reproduced (pending + `transition_recommended`, expired 2 days, `auto_apply_
prescriptions = true`): confirmed the GET session route and `workout-data` both leave it `pending` and
still drive load off it; confirmed completing a workout leaves the slot `consumed` with no eager
regeneration; confirmed reopening a `consumed` session sets `aiPrescriptionPending: true`; screenshotted
the Health → Training card showing "9d ago" / "7d ago" / "No data" in place of the old chip.

**NOT exercised:** the S25 APK — this is a server/web-route + React-card change with no
Capacitor/native/safe-area/gesture surface, so there is nothing native-specific to verify, but the
real on-device render has not been looked at.

### [workouts] AI prescription review (v1.230.0, 2026-07-28) — NOT device-verified; HR list never rendered with real data · needs: data

Everything shipped was exercised against `pnpm dev` on the local Postgres with the program flipped to
`ai_dynamic` and the production bad state seeded verbatim — real Gemini generation at all three
duration presets, a stored no-op transition normalising on read, a post-first-read soreness check-in
deloading and reverting, and the picker swapping live in a real browser at 412 px in both themes.
None of it has run on the S25 APK.

- **Per-exercise HR recovery is unit-tested only.** The local dev DB has no heart-rate readings, so
  `aggregateHrRecoveryByExercise`'s rendering (done screen + day-overlay sheet) has never been seen
  with real data. Eight unit tests cover the aggregation, including the negative-recovery case that
  motivated it (a set whose HR *rose* rendered as "↓-9 bpm/min ✓").
- **The done-screen cache-seeding is an APK surface** — `workout-recap:` / `workout-timing:` /
  `workout-energy:` / `workout-hr:` seeds and their invalidation need the on-device smoke run.
- **A `long` session fills only to the per-role set ceilings** (primary 6, secondary 5, accessory 4),
  so a small session tops out well under 90 min. Deliberate — deepening the AI's shape, not
  redesigning it. Adding exercises would be a separate feature.
- **Set-count plausibility across roles is not checked.** Production had Upper prescribing Skull
  Crusher 5×7 @77.5 % against Incline Bench 4×7 — an accessory outranking the primary on volume.
  Real, but it needs a role-ordering rule that doesn't exist yet; the effort-floor layer only
  partially governs it.
- **A short session doesn't re-balance the rest of the week.** Volume skipped today isn't
  redistributed to the remaining sessions; the weekly-MAV trim priority recovers most of it
  implicitly (what's skipped is under-target next session), but nothing does it explicitly.
- **RETRACTED — the "possible soft-delete" was a mid-sync read, not data loss.** The original note
  claimed the 2026-07-28 Push session showed 5/5 exercises and 14 sets on device while a
  `deleted_at IS NULL` query returned 4 and 12. Re-checked against production: **5 exercise rows and
  14 set rows, none deleted**. The discrepancy was entirely timing — the last exercise (Tricep Cable
  Combo, 2 sets) has `updated_at 08:54:14` and the query ran ~08:52, while the owner was still on
  the done screen. 5 − 1 unsynced = 4; 14 − 2 = 12, exactly. Offline-first behaved correctly: the
  device held the truth and Postgres caught up ~90 s later.
  **Method lesson for the data-quality review session** (`docs/data-quality-review-charter.md`): a
  query issued while the owner is actively training reads a moving target. Any device-vs-DB row-count
  gap must be re-checked after sync settles, and compared against `updated_at`, before it is written
  down as a finding.
- **`GET /api/ai-periodization/session/[id]` runs the full `aggregateSignals`** (~12 sequential DB
  waves) on every prescription-card load *and* every ~3s poll tick, though the card only consumes
  `signals.exercises`. A significant share of the "few seconds before the AI numbers appear" the
  owner reported. Not addressed here — trimming the payload is its own change.


### [devices][heart-rate] Ring de-escalation when the strap covers (v1.229.3, 2026-07-28) — NOT device-verified · needs: hardware
`lib/live-hr/manager.ts` now skips starting the Oura ring's aggressive live-HR loop during a
workout whenever the chest strap is already connected, with a 10s periodic re-check so a strap
that connects/disconnects mid-workout escalates/de-escalates the ring automatically. Pure JS —
`tsc`/`eslint`/the full unit suite are green, including rewritten and new manager tests exercising
the gating and the periodic re-check with fake timers. **What can't be verified in the sandbox:**
whether the ring's actual on-device battery drain changes, since that requires a real strap + ring
pair and a real workout. Owner should confirm on the S25: start a workout with the strap connected
and worn, and check (via the admin BLE console or just observed battery drain over a session) that
the ring's live-HR burst loop doesn't fire while the strap is covering.

### [cardio] Run status-bar chip (v1.227.2, 2026-07-27) — native chip NOT verified on device · needs: android
`RunChipBridge` (`MainActivity.java`) and the JS wiring were verified as far as this sandbox
allows: braces balance, every `@JavascriptInterface` signature matches what
`lib/native/run-status-chip.ts` calls, `RunActiveScreen` renders correctly with the chip effects
active (Playwright, injected active-run state, no new console errors), and the new "Run in Status
Bar" preference toggle persists across a reload. **The actual chip appearing in the Android status
bar / One UI Now Bar during a real run has never been exercised** — no Android SDK/Gradle in this
sandbox (proxy-blocked), so `./gradlew compileDebugJavaWithJavac` couldn't even compile-check it.
Needs an owner APK rebuild + on-device smoke test: start a distance-goal run and confirm the pill
shows live "X.XX / Y.YY km" text ticking on GPS fixes; start a duration-goal or freeform run and
confirm the pill counts down/up like the existing rest-timer chip; pause/resume and confirm the
chip clears then reappears with a correctly-shifted target; tap the chip and confirm it reopens the
app to `/activity`.

### [heart-rate] Max-HR resolver consolidation (v1.226.3, 2026-07-28) — target screens NOT verified on device · needs: browser
Max HR was resolved three different ways (`hrMaxFromAge`, `resolveMaxHr`, `estimateHrMax`); they
agreed only because the observed max sat below the age prediction, and the first reading above it
would have split them silently. `resolveHrProfile` is now the only resolver, and every observed
value is corroborated through `computeObservedHr` — previously two producers took a bare
`Math.max` over raw readings and one **persisted** it, so a single motion artefact became a
permanent ceiling that raised every Karvonen target with no way back down.

It returns two named numbers on purpose: `maxHr` (effort ceiling, never falls below the age
prediction) and `targetAnchorMax` (reachable targets, does use a lower observed max — anchoring
walk blocks on 220−age put the fast block out of reach without jogging). Collapsing them to one
would have regressed that.

**Not device-verified.** The two screens whose targets change — guided interval walk and the
fitness-test protocols — were not run on the S25; there is no live HR source in the sandbox. The
change is JS/server-only (ships via Railway, no APK rebuild) and the target math is unit-tested
plus proven end-to-end against seeded `oura_heartrate` rows on `pnpm dev`, but the on-device read
of the new anchors is unverified. Owner check: start a guided walk and confirm the fast/slow
targets are still reachable and haven't jumped.

**Known-by-design:** `body_battery_daily.hr_max_observed` rows written before this change are
still raw maxima. Nothing reads them as a max-HR override any more, so no value depends on them,
but they are not retroactively corrected — a future consumer must not treat historical rows as
corroborated.

### [devices] Chest-strap notification cap + battery readout (v1.226.2, 2026-07-28) — NOT device-verified · needs: hardware
`PolarStrapService` now gives up (stops itself, clearing the ongoing notification) after 6
consecutive connect failures instead of retrying at the 120s ceiling forever — the strap isn't
worn all day, so an unreachable strap almost always just means it isn't on, and the ring already
covers HR. It also reads the standard Battery Service once connected and shows `Connected · X%
battery` in the notification (mirrors the Oura ring service's pattern), exposed in `getStatus()`
too. **Native — requires an APK rebuild to take effect; nothing here ran against a real H10 or
Android's BLE stack.** Owner should confirm on the S25: the notification stops nagging after ~4
min when the strap is out of range/not worn, and shows the battery % once actually connected.

### [cardio] Elevation profile chart (v1.225.0, 2026-07-27) — local-SQLite sync path and real GPS elevation data NOT verified
Verified via a manually-seeded `activity_logs` row (`psql`) that the chart renders correctly on the
activity detail sheet. The local-SQLite write→outbox→sync→pull round-trip (Task 5 of the plan) was
only exercised via `tsc`/the offline-sync unit suite, never a real native SQLite write on-device —
and no real GPS route with elevation data has been recorded, since the sandbox has no device GPS.

### [cardio] Dedicated run execution screen (v1.222.0, 2026-07-27) — live HR NOT verified on-device
The new `RunActiveScreen`'s live HR + zone hero was verified end-to-end in the web sandbox (renders
correctly in its "waiting" state, no console errors), but live HR requires a real Polar strap or
Oura ring — not reachable in the sandbox. Also inherits `ActivityRouteMap`'s pre-existing,
out-of-scope limitation that the map viewport doesn't auto-recenter as new GPS points stream in
(react-leaflet's `bounds` prop is effectively mount-time-only).

### [devices][platform] D2 Task 1 — local-store Oura accessors (2026-07-27) — now has a caller path ahead of it
Added `LocalStore` read/write accessors for the on-device Oura tiers (`oura_daily_summary`,
`oura_daily_derived`, `oura_bucket`, `oura_heartrate`). Still inert — Tasks 2+3 above build the
raw store and the bridge that feed them, but the on-device rollup writer that will actually call
them is Task 6. No user-visible behaviour changed, so no version/changelog bump.

### [heart-rate] D5 own daytime-HRV (v1.220.1, 2026-07-27) — cold-start gate + NOT device-verified · needs: browser
Two distinct, real gates, not formalities:
1. **Cold start.** The model only exists after its first successful refit, which needs
   `MIN_TRAINING_SAMPLES` (50) night-time `0x5d` HRV buckets — realistically a few days of real
   overnight ring wear post-merge. Until then `getDaytimeHrvModel` returns null and daytime-stress
   contributes nothing to Body Battery, identical to today's behaviour — not a regression, but also
   not yet doing anything.
2. **Not device-verified.** The actual validation gate — a real H10 spot-check (wear both ring +
   strap, run **Admin → Oura BLE → own daytime-HRV vs Polar H10**) — hasn't happened, and can't
   until gate 1 clears (no model → nothing to compare). The design decision to gate the regression
   on MET rather than fit it as a feature, and the ±10ms tolerance band, are both first-principles
   choices pending this real-data check, not validated ones.
Owner action once gate 1 clears (a few days out): run the spot-check console and confirm the two
sources roughly agree.

### [cardio] Baseline anchors + push sessions (v1.218.0, 2026-07-27) — real push cadence and on-device NOT verified
The every-5th-session push detection and the 2%-beat-your-best distance bump were verified by
seeding 4 completed `prescribed_runs` rows (with GPS-bearing `activity_logs`) via `psql` and
backdating the plan's `created_at` so they fall within its lifetime — confirmed the 5th
`GET /api/running-plan` call correctly returns `isPushSession: true` with the bumped distance and
rationale, and that the "PUSH" badge renders on `/running`. Never exercised against a real 5-session
history built up over genuine calendar time. No native/offline-sync code paths touched (no new field
goes through the `prescribed_run` mutation domain), but the on-device (S25) smoke run per
`docs/device-smoke-checklist.md` hasn't been done.

### [cardio] Density-progression running framework (v1.217.0, 2026-07-27) — multi-week growth and on-device NOT verified
The framework's distance target grows `1.03 ** weekIndex` — confirmed correct via unit tests and a
manually backdated `running_plans.created_at` row, but never exercised against a real multi-week
user history (the local dev seed can't fast-forward calendar time). The completion round-trip (Start
→ active → Finish → Save → `prescribed_runs.status = 'completed'`) was verified end-to-end via
Playwright + `psql`, but this PR touches no native/offline-sync code paths, so the on-device (S25)
smoke run per `docs/device-smoke-checklist.md` hasn't been done.

### [devices] 🔴 Ring calibration captures were scoped wrong — fixed v1.216.1, prior ring data suspect
The console scoped a capture's ring windows as `ds >= newestDs − captureDs`, which assumes the
**newest window sits at the capture's END**. That holds only if a drain lands as the capture
finishes. In the owner's 150 bpm capture the drain arrived **16 s into a 147 s capture**, so the
filter reached 147 s *backwards* from a window near the start — roughly **87% of the "in-capture"
windows predated the walk entirely**, and the scatter they showed (81 / 115 / 139 / 159 spm) was
pre-capture history, not a ring failure at running cadence.

**This is the third time drain timing has corrupted a ring conclusion**, and the second time a
fix for it was itself wrong. Fixed by (a) requesting a drain **on capture stop** and waiting for
the burst, and (b) scoping by reconstructed **occurrence time** — anchoring `(newest ds ↔ its
arrival time)`, since a drain replays history *up to the present* — rather than by a ds offset.
Exports now carry `ringCoveredToSec` / `ringCoversCapture` so a partly-seen capture can never
read as a complete one.

**Consequence:** every ring number from a capture before v1.216.1 is only trustworthy if its
drain happened to land near the end. The 120 bpm capture qualifies (drain at 80% through) and its
ring/strap agreement stands; the 150 bpm capture does **not**, and says nothing about the ring.

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio trends surface (v1.216.0, 2026-07-27) — only single-week/single-run data exercised; two trend views deferred
`/api/cardio-trends` (5 unit tests for the pure aggregation functions) and the Trends card's three
chart.js views are dev-server + Playwright verified against real local data (the same synthetic
GPS activity inserted for the session-visuals item's verification pass): the zone-stack, efficiency,
and cadence charts all render with correct colours in both light and dark theme, no console
errors. **What is NOT verified:** the seed only produced one week of zone data and one run, so the
zone-stack chart's cross-week rendering (multiple stacked bars side by side) was only confirmed via
chart.js config, not visually with >1 week of non-zero data; on-device Samsung WebView paint, same
caveat as every prior cardio-hub surface. **By design, not a gap:** "distance/pace vs anchor" and
"PR history" trend views are deferred until the baseline-anchor system (backlog item "Density-
progression engine") exists. Entry:
[`docs/overview/entries/2026-07-27-cardio-trends.md`](docs/overview/entries/2026-07-27-cardio-trends.md).

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio session visuals (v1.214.0, 2026-07-27) — touch-drag scrub unverified on-device; elevation profile deferred
The hero HR/pace scrub chart, pace-per-km bars + best-efforts callout, zone donut, and dense
splits table are dev-server + Playwright verified against synthetic seed data (a GPS-tracked
activity log + matching HR readings inserted directly into the local Postgres instance for this
pass, since the base seed has zero `activity_logs` rows): the hero chart renders both HR and pace
lines, dragging the pointer across it moves a marker on the route map (confirmed by a Leaflet
marker-count change, 3→4→3, not just the unit tests), the non-GPS fallback (plain HR-only chart)
renders without crashing, and both light and dark theme show visible gridlines/text (the exact
canvas-colour hazard this item's Task 3 fixed elsewhere). **What is NOT verified:** (1) a real
Samsung WebView touch-drag gesture over the hero chart — the `touch-none` class is meant to stop
the drag from scrolling the sheet instead of scrubbing, untested outside desktop Chromium pointer
events; (2) populated real-world data — all verification used synthetic single-session seed rows,
not a real multi-week GPS history. **By design, not a gap:** a full elevation-vs-distance profile
chart is not included — `encodeRoute` drops the per-point `ele` field, so only the aggregate
gain/loss numbers persist; a real profile needs a new stored series + migration + sync-mirroring,
tracked separately as `feat/cardio-elevation-profile`. Entry:
[`docs/overview/entries/2026-07-27-cardio-session-visuals.md`](docs/overview/entries/2026-07-27-cardio-session-visuals.md).

### [cardio][devices] Cadence: slow-walk capture found 3 bugs; D-2 now supported at TWO cadences (v1.213.2, 2026-07-27)
Owner capture at 1.5 km/h, counted **64 spm** — the first below the old band floor. Three distinct
defects, all fixed:

1. **AD-2's walk/run bands were gating cadence.** `classifyGait`'s walk band starts at 1.4 Hz
   (~84 spm), so a real 64 spm walk classified **`idle`** and every window of it was discarded.
   Correct for "is this a walk worth detecting", wrong for "what is this cadence". Cadence now gates
   on **motion** (`hasGaitMotion`, new export) plus its own plausibility bounds; the band verdict is
   kept for reporting only. AD-2's bands are untouched.
2. **One octave mis-lock skewed the saved average.** A single window doubled to 140.8 among readings
   clustered at ~64; the **mean** reported 73.6 (+9.6), the **median** 63.8 (−0.2). `summarizeCadence`
   now uses the median — a mean has no defence against a single bad window.
3. **The console judged the capture against 19 minutes of unrelated history.** A drain replays the
   ring's whole backlog, so a 3.4-minute capture arrived with 19 min attached (mostly earlier, faster
   walking). The "locomotor median" reported **140.8 spm for a 64 spm walk** — the wrong walk
   entirely. Now filtered to the capture's own span using the ring's monotonic `ds` clock.

**D-2 (×60) is now supported at two very different cadences**, with errors bracketing zero rather
than sharing a sign — which is what noise around a correct factor looks like:

| truth | capture-period median | ×60 | ×120 |
|---|---|---|---|
| 96 spm | 1.7233 Hz | **103.4 (+7.7%)** | 206.8 |
| 64 spm | 0.9834 Hz | **59.0 (−7.8%)** | 118.0 |

Still short of confirmation (two points, both walking, ±8%). The remaining gap is a **high-cadence
(150+ spm)** capture — untested, and the regime where octave error is most likely.

### [cardio][devices] ⚠️ D-2 NOT closed — ×60 indicated by ONE window; an earlier entry over-claimed it
A 2026-07-27 entry declared the `stride_frequency` units resolved (steps/second, ×60) on the
strength of a single treadmill capture. **That was premature and is retracted.** The next capture
appeared to contradict it, and the reason is instructive:

| capture | truth | reported strideHz | window verdict | ×60 | ×120 |
|---|---|---|---|---|---|
| 2.7 km/h | 96 spm | 1.7233 Hz | **walk** (locomotor) | 103.4 | 206.8 |
| 4.0 km/h | 114 spm | 1.0739 Hz | **idle** — not the walk | 64.4 | 128.9 |

Read naively the second inverts the relationship (higher cadence, lower stride frequency). It does
not: 1.0739 Hz is below `WALK_HZ_MIN` (1.4), so that window is **idle** and describes whatever the
ring was doing then, not the walk. The console only ever showed the *newest* window, and the newest
is frequently a non-walking one — so the 30 locomotor windows that capture actually contained were
invisible.

**So exactly one locomotor window supports ×60.** Suggestive, not conclusive. Closing this needs
several captures at DIFFERENT counted cadences whose *locomotor* windows track the change.
**Fixed:** the calibration console now exports every ring window with its gait verdict
(`ringWindows`) plus the median stride-Hz across locomotor windows only
(`ringLocomotorMedianHz`, with both candidate conversions). AD-2's Hz bands and step_counter trust
remain gated on this.

**Ring accuracy** cannot be characterised until the above is settled — the earlier "~+7% high" figure
also rested on that single window.

### [cardio][devices] Cadence: strap band-pinning bug found on-device (v1.213.1, 2026-07-27)
**Second owner capture exposed a confidently-wrong strap reading.** A real 102 spm walk came back
as **71.4 spm, identical in every bin** — and an unvarying number is the tell, since real gait varies.
Root cause: `CADENCE_MIN_HZ` was 1.2 Hz = **72 spm**, sitting *above* the 60 spm `MIN_PLAUSIBLE_SPM`
floor, so any cadence below 72 was unreachable by the search and the autocorrelation argmax pinned to
the band edge — which was then reported as a measurement. Fixed two ways: the band now lies strictly
outside the plausibility bounds at both ends (0.9–3.9 Hz), so a reading is rejected for being
implausible *for a person* rather than for falling outside where we happened to look; and
`bandAutocorrPeak` now **rejects an argmax sitting on a band edge outright**. Regression-tested.

**The first capture passing (99.4 vs 102) did not catch this** — that walk was fast enough to sit
inside the band.

**Third capture (same session, fixed 2.7 km/h treadmill, 96 spm truth) is the good one:** strap mean
**99.6 (+3.6)**, final 96.6 (+0.6), 160 readings over 172 s, and the series now *varies* (96.2–103.1)
instead of pinning — measurement behaviour, not an artifact. Ring and strap differed by 6.8 spm,
inside the 8 spm agreement threshold, so the two independent derivations cross-validate. Both read
slightly high, which may be a shared bias or a slightly-low manual step count; more captures needed.
**Still unproven: running pace** (where octave error is most likely) and battery cost over a full
session.

**Ring: still no usable window, and my instrumentation hid why.** `ringWindowCount: 0` alongside a
non-null `ringStrideHz` was contradictory: the counter was incremented *after* the idle branch, so it
counted locomotor windows rather than windows delivered — collapsing "the ring sent nothing" and
"sent windows, none locomotor" into an identical 0, which is exactly the distinction it exists to
make. Now counted before the branch, with a separate locomotor count and the classifier's verdict
surfaced. The observed 1.127 Hz matched neither ×60 (67.6) nor ×120 (135.3) against a 102 spm truth —
but every window was `idle`, so it was not from the walk. **D-2 (the `stride_frequency` units
question) remains OPEN.**

**Diagnostic gap closed:** captures now export the **raw accelerometer magnitudes** plus per-reading
rhythm confidence, so a wrong reading can be replayed against the DSP offline. The 71.4 pinning was
only diagnosable because the number happened to equal the band floor exactly — that is luck, not a
strategy.

### [devices][body] Direct-BLE Renpho scale integration (v1.228.0, 2026-07-27) — ✅ device-verified 2026-07-28
Plan: `docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`. Server-side (migration 157
— 145, 153 and 155 were already taken by other PRs on `main` by the time this merged; `/api/scale-ble/*`
routes, the BIA composition formula, local-SQLite/sync mirroring) is fully sandbox-verified —
smoke-tested end-to-end against the local dev DB with `curl` using the real byte values captured
from the owner's actual scale: confirmed writes land correctly in `body_metrics` with per-field
`source_map='scale_ble'`, the >15% weight-anomaly gate correctly stages a reading as `pending`
without touching `body_metrics`, and both `dismiss` (archives, never writes) and `confirm`
(retroactively computes composition + writes) work. **Device-verified 2026-07-28:** the owner
rebuilt the APK, paired the scale, and confirmed a real weigh-in with background sync on landed
correctly end-to-end — `ScaleGattClient`'s GATT connect/handshake/decode, `ScaleBleService`'s
foreground-service reconnect loop, and the ongoing "Watching for scale…" notification all worked
on-device as designed. **Bug found in that same session (v1.231.5 fix):** weighing in with socks
on broke foot-plate contact, and the scale reported impedance as 0 rather than omitting the
packet — dividing by that zero floored the body-fat estimate at its 3% clamp along with every
other composition field, while the weight itself (a load-cell reading, contact-independent) was
correct. Fixed: `hasValidImpedance()`/`MIN_VALID_IMPEDANCE_OHMS` (`lib/scale-ble/composition.ts`)
now rejects a no-contact reading before the formula runs — weight still saves, composition is
skipped rather than clobbered with a wrong number, and the native service fires a one-shot
low-priority notification explaining why. **Still open:** the household's two-phone scenario
(both partners running background sync against the same physical scale) hasn't been exercised —
expected an occasional missed reading on whichever phone loses the BLE connection race, not a
data-integrity issue, per the plan's Risks section. **Also open (design question, not yet
decided):** the background-sync foreground service polls every 45s and keeps its ongoing
notification visible the entire time it's on, for a scale that's actually used ~10s/day — a
PendingIntent-based passive BLE scan (no persistent notification, lower battery, wakes only when
the scale actually advertises) would fit the usage pattern better but is a real rework of the
connection strategy, raised 2026-07-28, not yet scheduled.

### [cardio] Cardio session picker (v1.213.0, 2026-07-27) — recommendation heuristic unvalidated against real usage; no cross-modality gate by design
`recommendSession()` (7 unit tests) and the time-picker sheet are dev-server + Playwright
verified: the sheet opens, all three options render and stay tappable regardless of the
recommendation, and the walk recommendation correctly identifies the biggest-remaining
**training** zone (Z1 excluded, matching D-10). **What is NOT verified:** (1) the seed has no
active running plan, so the `run` branch of the recommendation (a pending prescription fitting
the time budget, plus the softened-gate note) has never been exercised against a real plan —
only the walk/activity branches were observed live; (2) the heuristic itself ("recommend the
zone with the most remaining minutes") is a first cut, not validated against what actually feels
like a good suggestion over real usage — expect it to want tuning once the owner has used it a
few times; (3) on-device paint/safe-area of the new sheet, same caveat as Phase 1 below (desktop
Chromium, not the canonical S25 WebView). **By design, not a gap:** walk and Other activity never
carry a recovery-gate note — `recovery-gate.ts` has no modality-agnostic equivalent, and building
one was explicitly scoped out of this item (see the plan). Entry:
[`docs/overview/entries/2026-07-27-cardio-session-picker.md`](docs/overview/entries/2026-07-27-cardio-session-picker.md).

### [cardio] Cardiovascular hub Phase 1 (v1.212.0, 2026-07-27) — NOT verified on device / on real zone data · needs: data
New `/cardio` screen + `GET /api/cardio-week` + the workout-select IA split. The quota logic
(`computeZoneQuota`, 7 tests) and the route are dev-server verified — 200 with all 5 zones, Z5
correctly `not-required` for the seed's `zone2-base` framework — and a real Chromium render
(Playwright) confirmed the zone-bar fill actually scales with percentage, not just renders at
0%. **What is NOT verified:** (1) the local seed has no `oura_heartrate` rows, so every zone
shows `doneMin: 0` — a genuinely non-zero quota from real ring/strap wear has not been observed;
(2) Samsung WebView paint of the zone bars and safe-area clearance on the new screen (the
sandbox render is a real desktop Chromium, not the canonical APK WebView); (3) the plan-driven
quota-size path — the seed user has no active running plan, so the quota always falls back to
the framework default rather than a plan's personalised `weeklyBaseMinutes`. Device smoke: open
`/cardio` on the S25 after a day of ring/strap wear and with a real running plan set up; confirm
non-zero zone minutes, the bars render and clear the status/gesture bars, and the quota total
reflects the plan's actual volume rather than the 150-min floor. Entry:
[`docs/overview/entries/2026-07-26-cardio-hub-phase-1.md`](docs/overview/entries/2026-07-26-cardio-hub-phase-1.md).
### [readiness] 🔴 Nightly temperature treats one frame's simultaneous probes as consecutive samples (found 2026-07-27, OPEN)
Same audit; **description rewritten twice** — first after re-verifying against full production
history, then again after the `open_oura` source answered the protocol questions. `open_oura` decodes
`0x46`/`0x69`/`0x75` with one shared decoder as a **flat probe vector** of centi-°C, so the repo's
`decodeTemperatures` is already correct and the earlier "three interleaved channels" framing was
wrong. The defect is entirely in the rollup: a frame's probes are **simultaneous**, but
`adapter.ts:4861-4869` stamps every value with the frame's single `ds` and feeds them to
`nightlyTemperatureCentiC`, a *temporal* median-7 pipeline — 631 frames become 2,398 "samples" on 631
real timestamps. Running the shipped path over one real night reproduces production's stored
**36.00 °C** exactly. Collapsing each frame to one value does **not** fix it (per-frame median →
37.00 °C): `0x46` frames hold three values with the middle on an exact 0.5 °C grid in 98.3% of 30,135
rows, so the median *is* the quantised probe. Of the 21 nights with a value, **19 are exact whole
degrees**, range 34.00–37.00 °C, σ = 0.743 °C, and the baseline's own spread converges to **2.63 °C**
— leaving the illness radar's `tempZ` and readiness's `bodyTemperature` contributor with no
discriminative power. Queued as backlog Q-2; preferred remedy (use `0x75` alone) is justified
empirically. One question stays open and needs the **Oura app binary**: which stream
`nightly_temperature_calculate` actually consumes.

### [sleep][devices] 🟠 Sleep/HRV/breathing metrics changed scale at the BLE re-key with no conversion (found 2026-07-27, OPEN)
Same audit. Four `sleep_sessions` columns shifted regime on 2026-07-07/08 while keeping the same
column and the same scoring curves: ~~`restless_periods` **230.6 → 2.5**~~ (**Q-3 fixed in v1.223.0**
— see below), `respiratory_rate` **13.11 → 9.32 rpm** (written from an estimator its own docs call
"not calibrated, display/debug only"), `average_hrv_ms` **27.5 → 49.0**, `lowest_heart_rate`
**65.1 → 56.7**. These have **non-overlapping** ranges. No baseline, trend or z-score may span
2026-07-07 without a documented conversion. Still queued as backlog Q-4.

### [sleep] ✅ `restless_periods` was two quantities in one column — now unscored (v1.223.0, 2026-07-27) — NOT verified on device · needs: browser
Q-3. The column holds Oura's restlessness measure on Cloud nights (**138–330**) and `model.awakenings`
on BLE nights (**0–5**); one curve, topping out at 50, was applied to both. Measured over the full
history: **every Cloud night clamped to the maximum 32-point penalty** while BLE nights drew ≤2.5, so
restfulness read **48.6 vs 86.3** across the eras — a 37.7-point gap that was purely units, depressing
every pre-cutover score by ~2.6 points. The term is **dropped rather than re-scaled**: a count of
movement periods and a count of wake events are different quantities, so any conversion would be
invented. `efficiency` and the awake fraction are unit-stable and carry the signal. Useful discovery:
the era is already recorded per-field in `sleep_sessions.source_map`, so no new column was needed.
Remainders (a calibrated awakenings penalty; the chronic-stress consumer, whose score is populated on
**0 of 70 rows**) queued as **Q-3b**. Journal:
[`entries/2026-07-27-restless-periods-unit-mismatch.md`](docs/overview/entries/2026-07-27-restless-periods-unit-mismatch.md).

### [sleep] ✅ Sleep Score gained an autonomic axis (v1.215.0, 2026-07-27) — NOT verified on device · needs: browser
Owner-directed, from the case study of the night of 2026-07-25
([`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](docs/reviews/2026-07-27-night-2026-07-25-case-study.md)).
That night was rated **5/5 "Terrible"** and scored **80**: normal on every contributor the model had,
abnormal only in autonomic state (HRV −2.76 σ, overnight HR +10 bpm) and a 2 h-early wake. Shipped:
one shared baseline derivation every caller uses (four of six previously passed none, so the same
night scored 82 on some surfaces and 80 on others), a new `hr` contributor, a directional `schedule`
contributor (only a late bedtime or early wake is penalised), and rebalanced weights putting
autonomic state at 28 of 110 rather than 12 of 100. **That night now scores 71 — 2nd lowest of 20 and
5 clear of the 3rd — where it used to sit 5th and indistinguishable from ordinary nights.** The top
of the range is unmoved (best night still 98) and a perfect night still reaches 100, pinned by a test.
**What is NOT verified:** the sleep-detail contributor chart gains two bars and has not been seen on
the S25; only a dev-server run against a seeded local Postgres was possible. **Historical scores
change meaning** — any night with a mature baseline now scores differently than when it was
persisted. Both remainders have now shipped — Q-16 in v1.220.0 and Q-17 in v1.221.0 (both below).

### [readiness] ✅ Body Battery: an evening nap was throwing away the whole day (v1.221.0, 2026-07-27) — NOT verified on device · needs: hardware
Q-17, and **the finding was filed with the wrong cause**. It read as *"consumes nothing on a
**ring-only** day"*; nothing in the route filters on `source`. The real cause is the **F-1
nap-vs-night bug in a fifth place** — the wake anchor was `sleepSessions` sorted by `sleepEnd`
descending, first element. On 2026-07-26 production holds two rows: the night ending **05:54** and a
45-minute evening nap ending **18:09**. The nap won, and since the walk keeps only HR at or after
`wakeTime`, the whole day was discarded: **164 ring samples sat unused**, and the 18:09→19:39 window
held exactly the **0** that was stored. Ring-only days merely showed it, because a strap day's ~1,500
workout samples happened to land after the nap. Fixed by using the shared night selection scoped to
today, plus a fallback when the recorded wake is in the future, and the response now reports the
anchor the curve actually used rather than re-deriving it. Journal:
[`entries/2026-07-27-body-battery-nap-wake-anchor.md`](docs/overview/entries/2026-07-27-body-battery-nap-wake-anchor.md).
⚠️ Server-side only, but the card has not been re-checked on the S25.

### [sleep] ✅ Sleep Score vs how it actually felt — a calibration view (v1.220.0, 2026-07-27) — NOT verified on device · needs: browser
Owner decision on Q-16: `sleep_quality_feel` stays **out** of the score and becomes something to look
back on when tuning. `GET /api/admin/sleep-feel-calibration` + a card atop Admin → Day Review pair
each night's model score with the next morning's rating and report rank agreement, the range each
side uses, mean score per rating, and the worst disagreements; the single-day audit gained
`context.morningCheckin` so one day reads "scored 91 · you said Terrible" in place. Comparisons are
**rank-based on purpose** — the rating spans 1–5 while the model's real range is 81–98, so a raw
difference would be meaningless. Against production (24 rated mornings) it says **Spearman +0.42**,
and surfaces three concrete targets: the model uses 15 points where the owner uses the whole scale,
"Good" nights average *higher* (92.5) than "Great" ones (91.0), and 2026-07-21 was rated **Poor**
while scoring **92**. Nothing here changes a score. Journal:
[`entries/2026-07-27-sleep-feel-calibration.md`](docs/overview/entries/2026-07-27-sleep-feel-calibration.md).
⚠️ Admin-only surface, not seen on the S25.

### [workouts] ✅ AI no longer quotes bodyweight 1RMs in kilograms (v1.224.0, 2026-07-27) — NOT verified on device · needs: browser
Q-19. `app/api/ai-chat/route.ts` tells the model *"Quote them exactly — NEVER recompute a 1RM"*, so a
Pull-Up read back to the user as "118 kg" — the exact misreading Q-12 removed from the UI. Every
surface whose text reaches the **user** is fixed: the ai-chat context and its two 1RM-bearing tools,
the prescription card's rationale bullets (`exerciseType` threaded through following the existing
`equipmentById` pattern), both digests' PR lines (via a new shared `describePersonalRecord`), and a
guard on the kg achievement milestones — `prFor` matches by **substring**, so a bodyweight "Pistol
Squat" would have unlocked Century Squat at its `BW_REF` value. Proven end-to-end on `pnpm dev`:
*"what is my pull-up PR?"* → **"6 reps (bodyweight)"**, while bench still answers "98kg". Three
model-input-only builders remain (never quoted at the user) — queued as **Q-19b**. Journal:
[`entries/2026-07-27-ai-bodyweight-units.md`](docs/overview/entries/2026-07-27-ai-bodyweight-units.md).

### [workouts] ✅ Bodyweight sets no longer count as zero volume (v1.227.0, 2026-07-27) — NOT verified on device · needs: browser
Q-13. The same sets were priced at `BW_REF + added` for the 1RM and intensity but at the **raw**
weight for volume, three lines apart, so 208 real reps (19 Pull-Up / 93 reps, 13 Hanging Leg Raise /
115 reps) read as 82–88% intensity and zero work done — missing from `user_stats`,
`computeVolumeAcwr` (which gates early deload), weekly volume and the prescription engine's volume
budget. Owner decision: price a rep at **real body weight × a per-exercise fraction** (Dempster/Winter
segmental masses — Pull-Up 1.00, Hanging Leg Raise 0.32), deliberately *not* `BW_REF`, which would
have added 20,800 kg and made pull-ups a top-3 volume contributor instead of the **8,856 kg** (~3.5%)
this adds. Isometrics stay unpriced on purpose — their "reps" are seconds. Migration 152 backfills the
13 historical logs. ⚠️ **This deliberately breaks an invariant the first audit verified:**
`exercise_logs.volume` no longer equals Σ(`set_logs.weight_kg` × reps) on bodyweight rows, because the
set records the *bar* and volume records work *done* — any future check must exempt bodyweight rather
than "correct" it back. Journal:
[`entries/2026-07-27-bodyweight-volume.md`](docs/overview/entries/2026-07-27-bodyweight-volume.md).

### [workouts] ✅ Bodyweight sets no longer record a prescription they were never given (v1.227.3, 2026-07-27) — NOT verified on device · needs: browser
Q-14. `planned_pct` stored the progression style's nominal percentage while `intensity_pct` is
BW_REF-relative, and for a bodyweight movement that percentage is never a load target —
`resolveBodyweightStyle` turns it into a **rep** target. So every bodyweight set recorded a phantom
14–18 pp overshoot (Pull-Up planned 75.0 / actual 88.5; Hanging Leg Raise 68.0 / 83.9 ×3); all eight
≥2 pp deviations in production were this, while weighted exercises deviate by ≤2.3 pp of real
autoregulation. Owner decision: NULL `planned_pct` where no %1RM was prescribed and record the
prescribed rep target instead — `planned_reps` is written for **every** exercise type, not just
bodyweight. Migration 153 adds the column to `set_logs`/`set_hr_stats` and clears the 6 historical
rows; `planned_reps` is left NULL on them rather than reconstructed from a 1RM that has since moved.
`sync-helpers` now replays the *prescribed* reps, not the performed ones. Journal:
[`entries/2026-07-27-planned-pct-bodyweight.md`](docs/overview/entries/2026-07-27-planned-pct-bodyweight.md).

### [workouts] 🔴 `personal_records` is not the all-time best, and "starting weights" never reach the bar (found 2026-07-27, **enlarged 2026-07-28**, OPEN)
Same audit. `POST /api/personal-records/seed` uses the unconditional upsert (no `IfBetter` gate, no
validation, `achievedAt = now`), bypassing the correct paths; its only caller is the workout-builder
review screen, so reviewing a program rewrites PRs. **5 of 36 rows disagree with the best surviving
log** — Barbell Bench Press shows **90.8 kg against a real 96.0**, Barbell Front Squat **67.5 against
73.8**, and four PR values appear in no exercise log at all. Separately, PRs are keyed on exercise
*name*, so five near-duplicate spellings split one exercise's best into two rows.

**Tracing the seeded value on 2026-07-28 found worse.** (a) The builder's *"Enter your 1RM for each
main lift to pre-seed working weights"* **does not do that**: `session-data.ts:226` reads
`lastLog?.estimated1rm ?? null` and never consults the PR map, so with no prior log
`computeInitialWeights` falls through every branch to a hardcoded **`return 60`** — 60 kg on the bar
for any new weighted lift, whatever you typed. (b) **Two weight paths disagree**:
`/api/next-session/prescription` uses `max(lastLog, PR)` and shows real kg on the done-screen "next
workout" card, while the workout screen uses the last log alone — so the preview and the session it
previews can show different weights. (c) Deleting the seed route (the literal form of the owner's
"derive from logs only" decision) would break `ai-periodization/baseline/complete`, which 400s with
`no_prior_data` when no PR exists, making "skip the AMRAP baseline" unreachable for a new user.

Decision stands — PRs derived from logs only — but delivered by giving the user-entered starting 1RM
its **own** store, plus one shared basis resolver used by both weight paths (which kills the magic
60). Queued as backlog Q-5, **plan-first**.

### [devices] ⏳ Ring clock anchors are now append-only observations (2026-07-29) — phase 1 of 2, inert
`oura_ble_clock_anchors` held **exactly one row**, created at the 2026-07-07 re-key and mutated
forward on every ingest, applied to **every `ds` in the database**. It doesn't stretch time
(ring-vs-ring intervals were always fine) but it **offsets every ring timestamp by that one row's
lag** — hours, by the redecode route's own notes. Hence Q-23 §1 (ring rows interleaved with
chest-strap wall clock), sliding day boundaries under the steps rollup's one-way max-merge, and
Q-22 §2: a ring clock **reset was silently fatal**, since the forward-only update meant post-reset
frames mapped weeks into the past and fell below the rollup cutoff, contributing zero forever.
**Landed:** migration 161 (`epoch`/`observed_source` on anchors, `epoch` on `oura_raw_samples`),
`lib/oura-ble/clock.ts` (`resolveDsToMs` — nearest observation, interpolating, epoch-isolated,
`null` rather than a guess), and append-only ingest with reset detection.
⚠️ **No timestamp has changed yet — every read still uses the single newest anchor.** Phase 1 only
starts *recording* the observations phase 2 needs. **Phase 2 (queued, Q-23)** switches the ~11 read
sites to `resolveDsToMs`; it wants a few days of accumulated observations first so the improvement is
measurable rather than assumed, and is deliberately kept apart from the step backfill. Plan:
[`plans/2026-07-29-ring-clock-anchor-epochs.md`](docs/superpowers/plans/2026-07-29-ring-clock-anchor-epochs.md).
Journal: [`entries/2026-07-29-ring-clock-anchor-epochs.md`](docs/overview/entries/2026-07-29-ring-clock-anchor-epochs.md).

### [activity] 🟠 Step backfill preview computed; three days materially inflated (2026-07-28, OPEN)
Recomputed all 20 ring-era days: stored **106,902** → recomputed **104,458** (net **−2,444**). Most
days barely move; **07-24 −1,719**, **07-27 −1,059**, **07-28 −3,326**; two rise (07-12 +2,696,
07-13 +1,327). ⚠️ **Indicative only** — it buckets by `measured_at` while the rollup buckets by
`dayForDs` via the mutable clock anchor, which has moved since; the two rising days are the likely
artefacts. Run `/api/oura-ble/samples/step-backfill-preview` (rollup's own bucketing) before any
destructive backfill — and note Q-22 §3: that preview is a hand-copied duplicate of the rollup block
and should be collapsed into one function first.

### [activity] 🟠 Three days hold inflated step totals that cannot self-correct (found 2026-07-28, OPEN)
The v1.228.5 guard stops new inflation but the rollup's max-merge (`> existingSteps`) means a stored
day can only ever rise. Verified against production by re-running the guarded merge over each day's
real frames: **2026-07-24 7,691 → 5,972**, **2026-07-27 6,981 → 5,922**, **2026-07-28 4,903 →
1,578** (−6,103 total). Correcting them is destructive and already has an owner-gated lever
(`?allowStepsDecrease=1` on the redecode route, with a read-only preview at
`/api/oura-ble/samples/step-backfill-preview`) — awaiting an explicit decision. Note the wider
ring-era history is also suspect: phone-sourced days (to 07-08) averaged ~2,300/day against ~5,300
for ring-sourced days, and the retired flat-30 estimate that produced 2026-07-09→22 is documented
in-code as over-counting.

### [activity] ✅ The Activity Score is persisted (v1.228.4, 2026-07-28) — NOT verified on device · needs: browser
Q-7. It was computed on every `/api/readiness-score` call and then discarded, while
`/api/health/trends` fell back to `oura_daily.activity_score` — NULL every day since the 2026-07-07
re-key, because the Cloud stopped scoring. Activity Score v2 (v1.207.0) therefore shipped with
**0 of 20 days** of trend. Now written as a third compute-and-persist block beside the existing
readiness and sleep ones: today's date key, only the `activity_*` columns (never the shared
`source`/`model_versions`, which the upsert replaces wholesale), best-effort so a persist failure
never fails the read. `oura_daily_derived.activity_score` is a COALESCE column, so the on-device
rollup's eventual push fills or overwrites the same field without conflict — persisting now costs no
future device work.

### [devices][readiness] 🟡 Eight device-owned `oura_daily_derived` columns have no producer (found 2026-07-27, **re-diagnosed 2026-07-28**, OPEN)
Same audit. The finding said the device "has never pushed" these. Tracing the chain found the
opposite: **nothing on the device could push them.** There are **zero** `queueMutation` call sites
for `oura_daily_derived`/`oura_daily_summary` anywhere; the local table's only live writer is
`applyDelta`, which hardcodes `sync_status='synced'` and so can never create an outbox row; and
`lib/oura-ble/rollup/` **does not exist** — `lib/sqlite/migrations.ts:1030` says so outright
(*"the rollup that writes them isn't built yet"*). The push loop and server branch are correct and
need no change. `worn_hours_ble`, `active_calories_est` and `pwv` are written *only* inside the
device-push branch, so they are unreachable by construction. This is Phase-1 Task 5/6 + Phase-2 Task
A2 — planned and entry-gate-cleared, not started. Queued as backlog **Q-7b**, which exists mainly to
stop a future session "fixing" a sync layer that is already correct. Related: `/api/oura/sync` still
writes a daily `oura_daily` row containing nothing but `non_wear_time_sec`, so "Oura sync succeeded"
is a false-positive health signal.

### [heart-rate][workouts] 🟡 Only ~20% of logged sets have usable HR (found 2026-07-27, measurement only)
Same audit. Of 550 `set_hr_stats` rows, **436 (79%) have `coverage_ok = false`** and **370 (67%) have
a NULL `peak_bpm`**, so v1.197.0's "Heart & Recovery" card trends over roughly one set in five;
`workout_hr_stats` holds 0 rows. Likely cause (strap disconnection / ring power-gating during
lifting) leaves no trace in Postgres — **this needs the device smoke checklist, not more SQL.** Queued
as backlog Q-11.

### [sleep] ⚠️ Only 12 of 57 nights have a persisted derived score — tooling shipped, **not yet run on prod** (v1.222.0, 2026-07-27)
`oura_daily_derived` scores are written as a side effect of loading `/api/readiness-score`, which only
ever persists *today*, so historical nights are unscored and calibration work over that table reads a
~21% sample. F-2 shipped the fix: `POST /api/admin/backfill-derived-scores?from=&to=&dryRun=`
recomputes through `buildDayAudit` and persists **exactly** what the live route would write (via a new
shared `PillarAudit.persist` field, so the two can't drift — including the subtlety that the stored
readiness is the composite *before* illness suppression, not the displayed score). Dry-run by default,
31 days/call, sequential, idempotent. **The remaining work is operational:** nobody has paged through
production with `dryRun=false` yet, so coverage is still 21%. Journal:
[`entries/2026-07-27-backfill-derived-scores.md`](docs/overview/entries/2026-07-27-backfill-derived-scores.md).

### [platform] ⏰ Claude read-only prod-DB access is approved FOR BETA ONLY — revisit on beta exit (2026-07-26)
Owner approved standing read-only production-DB access for Claude sessions for the duration of beta
(*"until we move out of the 'beta' phase and know everything is wired up correctly"*), accepting the
§9 risk that a leaked `CLAUDE_DB_QUERY_SECRET` exposes the full health history. Plan:
[`docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md`](docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md).
**This row exists so a temporary decision cannot decay into a permanent one by default.** On beta exit
— first non-owner user with real data, or the owner declaring beta over — either unset
`CLAUDE_DB_QUERY_SECRET` in Railway, or consciously re-approve after re-reading §9. If re-approved,
decision 8.1 (views unscoped across all users) must be revisited: it is defensible only while this is
a single-user app, and stops being so the moment a second user has data. Emergency stop at any time:
`REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;` (immediate, no deploy).

### [cardio][devices] Cadence: strap CONFIRMED on-device; ring path blocked by the hourly drain (v1.211.2, 2026-07-27)
**First real treadmill capture (owner, 102 spm counted ground truth) — strap PASSES, ring produced
nothing.**

**Strap ✅ validated on real hardware.** `frameType: 0x01` — the H10 emits **raw** PMD frames, not
delta. That was the genuinely disputed part of the protocol (sources disagree; both conventions
were made to decode and the observed type surfaced rather than guessed), and it is now settled.
50 Hz granted as requested. Accuracy vs 102 spm: first 10 s bin **103.1 (+1.1)**, mean 99.4 (−2.6),
final 98.5. Inside the ±3–5 spm bar. The mean reads low because the capture ran 33.5 s while the
counted 51 steps spanned ~30 s — the start/stop edges drag it down. **Still unproven: running pace**
(where octave error is most likely) and battery cost over a full session. n=1, walking only.

**Ring ❌ no data — my design error, now fixed.** `ringStrideHz: null`. Two causes:
(1) one gait window needs a *pair* of 0x7e/0x7f frames spanning ~30 s, so a 33 s capture yields at
most one; (2) decisively, `OuraRingService.kt` drains ring history **hourly**
(`DRAIN_INTERVAL_MS = 3_600_000`) and gait frames largely reach JS with that drain. A short capture
therefore *cannot* produce ring cadence. The console now shows a gait-window count and a **Sync
ring** button (`drainHistory`, an existing plugin method — JS only, no APK rebuild) so the ring is
testable on demand. **The `stride_frequency` units question (D-2) remains OPEN** — the capture that
answers it has not yet been taken.

**Bug found while root-causing that, fixed in v1.211.1:** `cadence-tracker.ts` stamped every ring
window with `Date.now()`, so an hourly drain's burst — an hour of history arriving at once — looked
like ~120 live readings, jittering the display and flooding the saved activity average. Now
deduped on the ring's own `ds` and rate-limited to one recorded reading per ~25 s, with later
(newer) windows in a burst *superseding* the earlier ones rather than the first-arriving (oldest,
hour-stale) window being the one kept. Regression-tested (`cadence-tracker.test.ts`).

### [cardio] Cadence metric (v1.211.0, 2026-07-27) — strap now confirmed (above); other surfaces still device-gated
Everything that actually produces a cadence number is BLE-bound and inert in the sandbox. **The
strap path is Kotlin and requires a rebuilt APK** — CI publishes one to the rolling `apk-latest`
release on merge (`/releases/download/apk-latest/app-debug.apk`), so no local Gradle build is
needed. Sandbox-verified: full gate green (2035 tests, tsc, lint, check-reconcile,
check-push-mutations), migration 140 applied, a dev-server `POST /api/activity-logs` with cadence
round-tripping through Postgres to `GET`, an implausible value rejected 400, and a Playwright pass
at 412×915 confirming the detail sheet paints "CADENCE · 168 spm avg · strap" with its sparkline
and the admin console renders both unit interpretations.
**Unproven until the treadmill run:** (1) whether the H10 delivers a PMD stream at all and in which
frame encoding — both conventions decode and the observed frame type is surfaced in the console,
because a silent zero looks identical to standing still; (2) real accuracy vs the treadmill for
either source; (3) **the ring's `stride_frequency` units (the open D-2 question)** — the conversion
is deliberately left as one of two principled values (×60 steps/s or ×120 strides/s) with both
rendered against ground truth, rather than guessed; (4) battery cost of a sustained 50 Hz stream
over a full run, and that HR streaming is unaffected; (5) safe-area / Samsung-WebView rendering of
the new readouts. Owner action: **Admin → Tools → Cadence calibration**, walk a known cadence on
the treadmill, and check which stride interpretation matches — that single capture also unblocks
the AD-2 Hz bands and step-counter trust, which depend on the same answer.

### [heart-rate][devices] D6 comparison harness (v1.212.1, 2026-07-27) — NOT device-verified; ±5bpm band unvalidated · needs: data
The admin route/console/DB path were exercised end-to-end against local Postgres (401 anon, 200 +
real bucketed comparison for an admin), and the pure merge/scoring function plus the minute-bucketing
helper are unit-tested. **What has NOT happened:** a real H10 spot-check — wearing both the ring and
the strap simultaneously for ~15 min and running the console against that window. Per the plan's own
gate, that run is the point of D6, not a formality: it's the first real signal on whether the ring's
own HR is trustworthy, and the ±5bpm tolerance band is a first guess to be tuned from that data, not
a validated threshold. Owner action: **Admin → Oura BLE → Comparison harness**, wear both devices for
a short burst, run it, and confirm the two sources roughly agree (or don't — either result is useful
data for D5, which is gated on this).

### [cardio][platform] `localToActivityLog` drops display fields for unsynced activities (found 2026-07-27, pre-existing)
`components/health/activity-history-card.tsx` has a second, hand-written row mapper that silently
drops fields. Cadence was added to it in v1.211.0, but it **still drops** `routePolyline`, `splits`,
`bestEfforts`, `paceSeries`, `avgPaceSecPerKm`, `elevationGainM/LossM` and `notes` — so a *pending*
(offline/unsynced) activity opened from that card shows a detail sheet missing its route, splits and
elevation until the server copy lands. Exactly the "update every row→object mapper" class in
CLAUDE.md. Not fixed in v1.211.0 because it is pre-existing and outside that change's scope; low
severity (transient, resolves on sync).

### [readiness] Readiness composite is persisted under the wrong day (found 2026-07-26 by Admin → Day Review) — OPEN, not yet fixed
The new Day Review tool's drift flag fired on its first real run: **stored 36 vs recompute 40** for
the same date. Root cause is pre-existing, in `app/api/readiness-score/route.ts`: the compute-and-persist
block writes the composite to `oura_daily_derived` keyed on **`latestSummary.date`** — the most recent
night that has an `oura_daily_summary` row, which is not necessarily today. So *today's* check-in,
today's activity score and today's illness inputs get persisted into a row **labelled with an earlier
date**, and any later read of that row (analysis, trends, the audit's `stored` comparison) attributes
them to the wrong day. The sleep-score persist immediately below it already does the right thing —
it keys on `lastSleep.date`, the actual wake day of the scored night.
**Deliberately not fixed in v1.210.0** — the correct key is a real behavioural decision (is that row
"the day the signals are about" or "the night the baselines came from"?), and changing it rewrites how
existing `oura_daily_derived.readiness_*` rows are interpreted. Needs an owner call before a fix, plus a
decision on whether historical rows get corrected. Reproduce: Admin → Day Review, pick a day whose
summary row is older than today, look for the amber "differs from this recompute" line.

### [platform] Admin → Day Review (v1.210.0, 2026-07-26) — NOT verified on device or against real ring data · needs: data
Admin-only, read-only, no offline-first domain, no native plugin, no new safe-area surface (it renders
inside the existing `/admin` shell). Verified in-sandbox: full gate green, dev-server exercised
end-to-end (200 on both date separators, 400 on an invalid calendar date, 401 unauthenticated),
contributions proven to sum to the score each model reports, and a Playwright pass at the 412×915 S25
viewport (tab renders, date stepper navigates, pillars expand, no console errors).
**Two things the sandbox can't prove:** (1) the local seed has **no `oura_daily_summary` or
`oura_heartrate` rows**, so the readiness composite and the zone-minutes/move-hours paths were exercised
by inserting synthetic summary rows and deleting them afterwards — the Activity zone-minutes and
move-hours contributors have never run on real data here; (2) whether the numbers are **sane against the
owner's real history**, which is the entire purpose of the tool. First device action: open Admin → Day
Review on a day that felt clearly wrong and check the contributor breakdown against how the day actually
felt. Known fidelity limit (surfaced in the payload, not hidden): sub-scores are exposed rounded, so a
rebuilt `contributionSum` can sit up to a point off the score — each pillar says so inline.

### [cardio] Guided walk uplifts (v1.208.1, 2026-07-23) — hardware back-button guard NOT device-verified · needs: android

The new confirm-exit dialog's hardware/gesture back-button path (`mobile-auth-handler.tsx`,
mirrors the existing workout-screen guard) can only be exercised on the APK — the web sandbox
has no Capacitor `App.addListener('backButton', ...)`. The in-screen "End walk" button and the
bottom-nav tab-away guard were both verified working via a live dev-server Playwright pass.

### [cardio][devices] AD-2 ring-cadence walk/run detection (v1.208.0, 2026-07-23) — Hz bands provisional, NOT device-verified · needs: data

The whole confirmation path (`classifyGait`/`gait-confirm`) is BLE-gated and inert in the sandbox
by design (no ring). Two things need an owner APK rebuild + on-device pass before this can be
called fully trusted: (1) the walk/run Hz bands are physiological-prior estimates, not calibrated
against a real captured walk/run/lifting session (the shared D-2 units question); (2) the
probe-phase backdating (route not clipped to the ~90s-later confirm instant) needs a real walk to
confirm. Run `docs/device-smoke-checklist.md`: a garage lifting session must never confirm; a
real walk must confirm within ~90s with the correct backdated start/route; a run must classify
as run; removing the ring mid-walk must fall back to the GPS/AD-1 path without crashing.

### [app-shell][activity] Core score-cards + Activity overhaul (v1.204.0 → v1.209.0, four rounds, 2026-07-23/26) — NOT verified on device / real ring data · needs: data
Home cards redesigned (W-A), sleep recalibrated + overnight HRV (W-C), readiness recalibrated + check-in
(W-D), and Activity Score v2 (W-B) — **all four workstreams now fully shipped** across four rounds, each
after live owner review of screenshots/mockups.

**Round 4 (v1.209.0, visual only — no scoring change):** the round-3 fixed-accent-tick ring was replaced
after another two mockup rounds. Landed on four options, offered as a real **user-selectable
preference** ("Score Card Style" in More → Home Widgets, `lib/home/home-prefs.ts`) — the owner's own
idea mid-review, rendered as a **vertical list with a checkmark** (the owner asked for a list once a
third option made the original 2-button toggle too cramped): **Default** (plain closed circle),
**Open ring**, **Perforated ring** — each with the coloured accent moved from the ring onto each card's
**icon** (readiness blue, HR red, sleep purple, activity orange) and the dot removed, circles sized up
(114px default/open-ring, 94px perforated — perforated keeps its own tuned size since it needs denser
dots at a smaller diameter to read as texture; the two plain-stroke styles share the larger size) — plus
**Accent ring**, added in a follow-up clarification to keep the round-3 fixed-accent-tick design
(white icon + coloured dot + coloured arc, 80px) selectable rather than discarded outright. For the
three newer styles, **home-row state (good/moderate/low) is no longer shown visually at all** now that
both the arc and the dot are gone — carried only in the `aria-label` and via the number/detail-screen
tap-through; this tradeoff was flagged to the owner during the mockup rounds and accepted (Accent ring
keeps its original dot).

**Round 5 (same PR, v1.209.0):** asked to brainstorm further, six new frame concepts were mocked up
(gradient sweep, plate-rim dashes, double hairline, soft halo, compass ticks, no frame) — the owner
rejected five outright and rated **Halo** only "average," but chose to add it as a fifth selectable
style anyway rather than keep guessing blind. Halo drops the stroke entirely for a soft blurred glow
(CSS `radial-gradient` + blur, not an SVG frame) in the card's identity colour behind the icon/number,
sharing the 114px size. Sandbox-verified: `tsc` clean, full suite 1952 passing, Playwright screenshots +
DOM-structure checks confirmed all **five** ring styles render at their correct sizes/content model and
the settings list switches between them correctly (both via a direct localStorage flip and via a real
click on a list row, confirmed the stored preference updates).

**Round 3 (v1.207.0):** the round-2 progress-fill ring ("still not what I am after — a progress bar
doesn't work for HR") was replaced after two mockup rounds (13 concepts total, shown to the owner before
any code) with **"M — fixed accent tick"**: a thin white ring + one fixed-position, fixed-length arc in
each card's own identity colour (the same hexes each metric's detail-screen sparkline already uses —
`#60a5fa`/`#f87171`/`#818cf8`/`#f97316` — not new colours). Same length/position on every card regardless
of score, so it can't be misread as a percentage; state still lives only in the dot. Also added **active
minutes** to Activity Score v2 — zone-minutes (WHO moderate/vigorous, vigorous double-counted) and
move-every-hour (an HR-elevation proxy, since there's no hourly step data), both computed from the
intraday HR series already fetched for the HR card (`todayHrRows`) — the "device-gated" deferral in the
original plan was overcautious, nothing new was needed. New gauges on the Activity detail screen. A
duplicate `ageFromDob` (accidentally created in round 1) was found and deleted in favour of the existing
canonical one in `lib/date-utils.ts`.
**Sandbox-verified (round 3):** `tsc` clean, full suite 1927 passing (17 new). Synthetic `oura_heartrate`
rows inserted directly into the local dev DB (then deleted) to prove the zone-minutes/moved-hours
computation end-to-end, since the seed has no intraday HR data by default — confirmed correct values and
sub-scores. Playwright screenshots confirmed the new ring (arc + dot, no text) and the new gauge card
render correctly.
**Round 2 (v1.206.0):** the Activity detail screen's contributor chart + "how to improve it" guide were
found silently empty (wired to the permanently-null frozen Oura field) — fixed to serve the Activity
Score v2's own components; added a goals-vs-actual gauge card; fixed `/api/ai/health-insight`'s activity
section, which read the same frozen fields and always said "activity data is missing" even with a real
score showing.
**Caveats still open (all rounds):** (1) Samsung WebView render of the new ring — non-intersection at the
real S25 width, safe-area, colour rendering against the true blue-gradient hero (sandbox renders a plain
fallback background since the weather-driven hero has no network path here — the ring/dot/arc behaviour
was still clearly correct against it); (2) real-ring scores — the seed lacks ≥14-night baselines /
overnight HRV / a mature composite / real intraday HR, so the sleep-HRV term, the +1.5σ readiness terms,
zone-minutes/moved-hours, and a real "great day → ~100" are unproven on real data. **Deliberately not in
scope this round:** the "yesterday-completed" home display (circle shows today's live score) and an
hourly move-nudge notification. Anchors/weights are tunable starting values. Run
`docs/device-smoke-checklist.md` on the S25.

### [cardio][platform] Auto walk/run "Activity detected" notification gate (v1.204.1, 2026-07-23) — NOT verified on device · needs: android
The passive walk/run detector fired the "Activity detected · Recording your walk or run" ping on the
**first** GPS point clearing 0.8 m/s, before the end-of-session save gates ran — so indoor GPS drift
during stationary garage training posted a false ping every session (the session was still correctly
discarded, nothing saved). Fix (`lib/activity/auto-detection-service.ts`): the ping is now held behind
a **sustained-movement latch** — fires at most once per session, only once the live session has covered
`NOTIFY_MIN_DISTANCE_M` (200 m) over `NOTIFY_MIN_ELAPSED_SEC` (90 s), via the pure `shouldNotifyActivity`
predicate. Detection/session-start and the save-path quality gates (`detection-thresholds.ts`) are
unchanged. **Sandbox-verified:** 6 unit tests on the gate predicate + all activity/auto-detection-store
suites green (1867 tests pass; the one failing suite is the pre-existing `onnxruntime-web` sandbox dep
gap, unrelated). **NOT verified on device (APK-only path):** the significant-motion sensor → GPS →
Capacitor local-notification chain does not run in the web/dev sandbox. Owner action (device smoke): on
the S25 APK, (1) do a stationary garage weight session → confirm **no** "Activity detected" ping; (2) take
a real ≥200 m walk → confirm the ping fires once (~90 s / 200 m in) and the walk still saves as before.
Plan: `docs/superpowers/plans/2026-07-22-activity-detection-notification-gate.md`.

### [heart-rate][workouts] Per-set HR metrics "Heart & Recovery" card (v1.199.0/.200.1, 2026-07-21/22) — card paint NOT verified on device · needs: browser
New per-set HR snapshots (`set_hr_stats`, migration 139) + the exercise-history "Heart & Recovery" card
(`components/workout/exercise-hr-trend-card.tsx`) + a `getWorkoutHrTrends` AI-chat tool. **The data path
is fully sandbox-tested** (formula, DB round-trip, `computeWorkoutHr` integration, trend aggregator, chat
tool — 24 tests) **and dev-server verified** (trend route 200 + correct aggregation; recap route actually
persisted a per-set row). **Accessibility fix (v1.200.1):** the card was shipped **unreachable** — the
only entry points were `session-select`/`/stats`, which the owner reported don't surface it. Now tapping
an **exercise in the Health → Training calendar day-overlay** opens its history sheet (wired
`onExerciseTap` on `day-overlay-sheet.tsx` → `ExerciseHistorySheet` in `health-content.tsx`, with a `›`
affordance). **Playwright-verified in dev** that the tap opens the correct sheet (screenshot) and both
`/api/workout/exercise-hr-trend` + `/api/exercise-history` return 200 with data — **but the sheet's
content paint could not be confirmed in the dev harness** (nested bottom-sheet showed persistent loading
skeletons behind successful 200s; believed a turbopack dev-compile/timing artifact since it's the same
sheet that ships elsewhere). **NOT verified on device:** the card's actual paint + look/safe-area inside
the bottom sheet and Samsung-WebView SVG sparkline rendering. No risk to existing data — reads only.
Owner action: on Health → Training, tap a trained day → tap an exercise (one with monitored sets) → scroll
to "Heart & Recovery"; existing sessions inside the 180 d window populate via Admin → Tools → Additional
tools → "Run backfill" (`POST /api/workout/backfill-set-hr-stats`, oldest-first, resumable). Plan:
`docs/superpowers/plans/2026-07-21-per-set-hr-metrics.md`.

### [workouts][app-shell] Workout & health UX batch (v1.198.0, 2026-07-22) — capture paths NOT device-verified · needs: browser
Owner-directed batch (see `docs/overview/entries/2026-07-22-workout-screen-fixes.md`): workout
category/intensity pills, home deload "why" panel, per-factor health deep-dives across the 4 pillars,
AI-prescription card refreshing in place (no app reopen), and an end-of-workout Time Summary
(setup/work/rest actual-vs-planned). Logic + endpoints are `tsc`/lint/test green and dev-server
verified. **NOT exercised in-sandbox:** the **timing capture** (new `prep_time_sec` bar-load time +
the last-set rest) only runs during a real device workout — the seed has no set-timing, so the card
logic is proven but on-device capture is not; **Readiness per-factor scores** are null until BLE
daily-summary history exists (deep-dives render guide text without a live score); category badges +
prescription-card refresh only hit their real paths on an `ai_dynamic` program. Migration 138 is
additive/nullable. Run `docs/device-smoke-checklist.md` on the S25. Follow-up: planned *work* time
could use the user's measured pace when history exists (currently standard pace, labelled as such).

### [platform] AI usage observability panel (v1.197.0, 2026-07-21) — panel render NOT eyeballed on device
All 15 `@ai-sdk/google` call sites now route through one instrumentation wrapper (`lib/ai/instrument.ts`)
that logs metadata (section/model/tokens/latency/ok/fingerprint) to `ai_call_log` (migration 136),
surfaced in a new **Admin → AI Usage** tab (calls by section, tokens, est. cost, over-time, double-trip
detection). Instrumentation + admin route are **dev-server verified end-to-end** with a real Gemini key
(all three wrapper shapes log real token counts; 403 for non-admin; double-trip detection works) — a
circular-import bug that silently dropped all logs was found and fixed there. **NOT verified:** the
panel's pixel render at the S25 viewport / both themes (admin-only surface, no browser in sandbox; uses
theme tokens + CSS bars, no chart.js). Est. cost uses approximate Flash-Lite pricing (labelled an
estimate). Foundation for the B3 double-trip-reduction work. Audit: `docs/reviews/2026-07-21-ui-responsiveness-audit.md`.

### [devices][platform] Oura raw-on-device: local v18 schema (2026-07-21) — NOT verified on device · needs: hardware
Local SQLite is at **v18**: v17 added four calculated-form tables (`oura_bucket` tier store,
`oura_daily_summary`, `oura_daily_derived`, `oura_heartrate`) + Oura columns on local `sleep_sessions`
(via reconcile); **v18 is corrective** — it drops+recreates `oura_bucket`/`oura_daily_summary`/
`oura_daily_derived` to fix the `oura_bucket` PK (re-keyed on `bucket_start_ms`) + type/column drift.
Additive/nullable, not yet read or written by any code (the on-device rollup that populates them lands in
a later PR). Verified in-sandbox: `check-reconcile` green, and **every migration version + the reconcile
pass applied cleanly to a real in-memory SQLite, including the idempotent re-run of the reconcile ALTERs
(the partial-upgrade path that has killed the local DB twice)**. NOT verified on device: the Capacitor
SQLite plugin's actual v16→v18 upgrade transaction on the S25 — open the app once and confirm the local DB
loads (no dead-store banner) per `docs/device-smoke-checklist.md`. Part of the Oura raw-on-device
architecture (`docs/superpowers/plans/2026-07-21-oura-raw-on-device-*.md`); the data-requirements map
(`…-oura-data-requirements-keep-cull-calculate-matrix.md`) is the foundation for what these tables hold.

### [platform][devices] D1/F3: restore pull endpoint live server-side (2026-07-22) — full restore flow device-gated
`GET /api/sync/pull?mode=restore` now unclamps the 90-day floor (`getSyncDelta(windowDays=null)` → full
history) and the previously-unlimited pull route gained rate limiting (separate `sync-pull` 60/min vs
`sync-pull-restore` 120/min buckets). **This server half is fully sandbox-verified** (route test 6/6 +
the F1 DB-backed window test). **NOT reachable / NOT verified end-to-end:** no client calls `?mode=restore`
yet — the restore driver loop (`pullDelta` outer `hasMore`, seed-cursor-to-epoch-once-then-loop,
loop-until-`hasMore===false`) lives in `lib/local-store/sync-engine.ts` where `getLocalStore` is null on
web, so it ships with the device-gated client batch and is proven only by the RST **wipe→restore** smoke on
the S25 (full sleep/HRV/RHR/score history returns, not a 90-day slice). Until then the endpoint is dormant
infrastructure.

### [platform][devices] D1/Track-B: dedicated timeseries pull endpoint live server-side (2026-07-22) — dormant, client-gated
`POST /api/sync/oura-timeseries` (`getOuraTimeseriesDelta`) serves `oura_heartrate` + coarse `oura_bucket`
on a single pooled connection with an exact keyset `(updated_at,id)` cursor, outside the shared
`getSyncDelta` fan-out. **Server half fully sandbox-verified** — DB-backed drain/stall-safety/concurrent-pool
tests (10 concurrent restore drains stay ≤ pool max:10, no leak) + a pure-mock route test, all green.
**NOT reachable / NOT verified end-to-end:** nothing calls it yet. The client drain-loop consumer, the
`oura_heartrate`/`oura_bucket` local tables + `applyDelta` mapping, the push registration
(SYNCED_MUTATION_DOMAINS + pushMutations branches) and B3 replace-by-day outbox are all device-gated /
D2-blocked (`getLocalStore` null on web) and ride the client batch + the RST wipe→restore S25 proof.
**Bucket pull returns empty until the device push lands** (the server `oura_bucket` table is greenfield —
no writer yet). Accepted bounded behaviour: the server HR rollup restamps ~14 days of `updated_at` per run,
so a synced client re-pulls that span — removed by the C1 single-writer flip, not before.

### [devices][sleep] D1 client batch pt.1: sleep restore widening + oura_daily guard (2026-07-22) — NOT verified on device · needs: hardware
The `applyDelta` pull path now carries the 12 Oura sleep columns (HRV/RHR/stages) through to the local
`sleep_sessions` table (was stripped to stage-hours — review R6 data-loss), clobber-guarded; and `oura_daily`
gained a local `sync_status` column (RECONCILE) with its `INSERT OR REPLACE` converted to a clobber-guarded
`ON CONFLICT(day)` upsert (D4). **Verified in sandbox by compile + mock-SQL unit tests only** —
`getLocalStore` is null on web, so native SQLite never runs here. **NOT verified on device:** (1) the RECONCILE
add of `oura_daily.sync_status` on the S25's existing local DB (the partial-upgrade path that has killed the
local store twice — open the app once, confirm no dead-store banner + history intact), and (2) the durability
payoff — a wipe→restore returning **sleep with HRV/stages intact** (not stripped), per `docs/device-smoke-checklist.md`
+ the RST proof. Until the S25 smoke runs, treat this as not-device-verified. The rest of the client batch
(F3 restore driver loop; summary/derived local persistence; the D2-blocked F4 arms + device write helpers +
Track-B push/B3) is still pending. **Update 2026-07-23:** an on-device attempt found `sleep_sessions`/`oura_daily`
unaffected — the transaction failed one domain later, on `oura_daily_summary`; see the RECONCILE_COLUMNS
schema-drift fix in the "Restore from cloud" row below. **Update 2026-07-26:** F4 mark-synced arms shipped
(see the D0/D1 Oura on-device backlog note) — device write helpers + Track-B push/B3 remain D2-blocked.

### [platform][devices] D1/F3 "Restore from cloud" driver + button (v1.200.0, 2026-07-22) — real on-device bug found + fixed 2026-07-23
`pullDelta` gained a `restore` param (`&mode=restore` → server full-history unclamp) and now surfaces
`hasMore`; the new `restoreFromCloud` driver seeds the cursor to epoch once then drains restore pulls until
`hasMore=false` (resumable), fronted by a "Restore from cloud" button under More → profile. Restore applies
**all four** day-grained finished-form domains locally — sleep, `oura_daily`, `oura_daily_summary`,
`oura_daily_derived` (readiness/illness/resilience/body-comp + EMA baselines), clobber-guarded.

**On-device attempt (2026-07-23) found a real bug, now fixed:** plain "Sync now" failed with a generic
toast; two follow-ups (surface the real error, then unmask a rollback that was hiding it) isolated the true
cause: `no such column: hrv_baseline_mean_x8` on `oura_daily_summary`. Root cause — **#725** extended
`CREATE_OURA_DAILY_SUMMARY_LOCAL`/`CREATE_OURA_DAILY_DERIVED_LOCAL` with 30 baseline/derived columns behind
a **v18 corrective DROP+CREATE**, but a versioned migration only runs once per device; any device already
past v18 before #725 shipped keeps the old (pre-#725) schema forever, and the new columns were never
registered in `RECONCILE_COLUMNS` (the mechanism that actually self-heals — it runs on every open, not once
per version). Exactly the "17 tables once missing from reconcile" bug class CLAUDE.md warns about. **Fixed**
by registering all 13 missing `oura_daily_summary` columns + 17 missing `oura_daily_derived` columns in
`RECONCILE_COLUMNS`, self-healing on the next app open — no wipe, no version bump, no APK rebuild needed
(confirmed **not** a stale-APK/Capacitor-version issue — the owner rebuilt the APK and the error persisted
unchanged, which is what pinned this to a JS/schema bug rather than the native plugin).
**NOT yet re-verified:** owner needs to retry Sync/Restore once this fix deploys and confirm it succeeds —
that closes out the RST durability gate for the day-grained domains. Three known, lower-priority, non-blocking
warts from the same incident (documented, not yet fixed): (1) `illness_flag`/`illness_score`/`resilience_level`
kept their pre-#725 column type on drifted devices (SQLite's loose typing means read/write still works, just
without a corrective ALTER); (2) `oura_bucket`'s PK correction (the other half of #725/v18) likely also never
applied on an affected device — moot today since nothing writes local buckets before D2; (3) Track-B
time-series restore (`/api/sync/oura-timeseries`) still needs its own client driver (not wired).

**Round 2 (2026-07-23), same investigation:** after the RECONCILE_COLUMNS fix deployed, the missing-column
error was gone but retrying Sync surfaced a **new, deeper** bug at the same site: `SQL failed [COMMIT]: Run:
Cannot perform this operation because there is no current transaction.` Root cause: `applyDelta`/
`logWorkoutLocally` managed their transaction with literal `'BEGIN'`/`'COMMIT'`/`'ROLLBACK'` **SQL text**
through `runSQL()`, but `@capacitor-community/sqlite`'s `run()` defaults its own `transaction` param to
`true` — every individual `.run()` call auto-wraps itself in its own begin+commit unless told otherwise, so
the manual sequence never was one atomic transaction: the first write's auto-commit silently closed
whatever the literal `BEGIN` opened, every later write auto-committed itself in isolation (data still landed,
just non-atomically), and the final literal `COMMIT` found no transaction the plugin's bookkeeping still
considered open. **Fixed** by using the plugin's real `beginTransaction()`/`commitTransaction()`/
`rollbackTransaction()` methods (first-class API, not raw SQL text), gated through a module-level flag in
`sqlite-service.ts` so every write's `runSQL()` call gets `transaction:false` while a manual transaction is
open — zero change to the dozens of individual write call sites. **NOT yet re-verified** — same as above,
owner needs to retry Sync/Restore once this deploys.

**Round 3 (2026-07-26):** owner tapped "Restore from cloud" on-device (without wiping local data first) as
a sanity check — got a "Restored 0 records from cloud" **success** toast. Investigation (re-ran the
server-side `getSyncDelta(epoch, windowDays:null)` query against the local seeded DB — returned real
history correctly, ruling out a server regression) found the real bug in the client driver:
`restoreFromCloud` treated a failed pull page (dead network, expired session, rate limit) identically to
"genuinely nothing to restore" — both returned `{ synced: 0 }`, so a transient failure silently rendered
as a success toast. An existing unit test even encoded this as expected behavior. **Fixed**: `restoreFromCloud`
now returns `{ synced, failed }`; the UI shows an error toast on `failed:true` instead of a false-positive
success. **NOT yet re-verified on-device** — owner should retry "Restore from cloud" once this deploys and
confirm it now reports a non-zero count (their history is substantial — months of data, 14+ backfilled step
days). This does not change the D1 durability gate's real remaining requirement: a true wipe-then-restore
test is still the outstanding owner checklist item.

### [workouts] Workout screen 3-card redesign (v1.193.0) — REVERTED in v1.195.1 (2026-07-21)
The #718 3-card rewrite (Workout / Run / Activity) shipped a `RunCard` that called `.reduce` on
`zoneTargets` — a `WeeklyZoneTargets` **object**, not an array — so `/workout-select` threw
"reduce is not a function" and would not load for any user with a real running plan (the seed had
none, so it passed dev/CI). On-device QA hit it immediately. **v1.195.1 restored the original
full-height swipe carousel** (the owner also missed it) and added a Run + Log-Activity button row
beneath it; `run-card.tsx` deleted. The 3-card redesign is shelved — revisit only if re-attempted
with the correct `zoneTargets` shape. Round-2 health refinements (Body Battery diagrams, ACWR
monotony/strain graph, Heart & Recovery visual cohesion, Trends pill-swipe gesture) are queued.

### [app-shell] Health UX device-gated batch (v1.192.0, 2026-07-21) — NOT verified on device · needs: browser
The #2/#4/#7/#9a items shipped web-verified (tsc/lint/test/build + dev-server 200) but their
device-specific behaviour is unconfirmed in the sandbox: the redesigned detail-screen back button
(safe-area + back-stack), the moved standalone "Measure HR now" card (live HR from ring **or** Polar
strap, safe-area), the live direct-BLE ring battery (`/api/oura-ble/battery-latest` reads `null` until
the native service posts a keepalive poll — verified endpoint, not real telemetry), and the Heart &
Recovery range scales (need real multi-day data). Also the energy-budget card (v1.191.0) was not
exercised with a logged day (seed has no food/goal today). Run `docs/device-smoke-checklist.md` on the
S25 to confirm. **~~Follow-up: activity energy in the budget~~ ✅ SHIPPED v1.194.0 (strength) →
v1.195.0 (all movement)** — the energy budget's "burned" now folds in strength workouts + logged
activities (walk/run/cycle/…) + passive steps, all via the shared MET/Schofield estimator
(`lib/health/daily-energy.ts`, 9 unit tests). Double-counting is handled: the budget bases on a
**resting** floor (BMR×1.2) and adds movement explicitly (rather than an inflated activity multiplier
that already assumes exercise); steps below a 3,000/day baseline don't count; and steps inside a logged
outdoor walk/run are subtracted from the passive total. Verified 624 kcal active energy for a lift +
30-min run + 12k-step day. **On-device look of the budget with a real day still wants the S25 smoke run.**

### [platform] 🔴 Postgres volume approaching 1 GB for one user (2026-07-21) — HANDOVER, structural fix pending
Railway postgres-volume hit **92% of 1 GB**. Immediate crisis de-escalated by an owner-run `REINDEX`
of `oura_raw_samples` (~105 MB of index bloat from the migration-115 `measured_at` backfill reclaimed;
DB 320→205 MB) + a WAL cap/restart to flush ~180 MB of WAL. **Root problem unsolved:** `oura_raw_samples`
raw-BLE archival (`body_hex`) is 91% of the DB and grows ~50 MB/week unbounded, so the volume refills
in ~3-4 months. Long-term fix (owner decision) is likely **(a) store `body_hex` as `bytea` not hex TEXT
= instant ~50% cut** and/or **(b) S3 cold-storage of aged raw events**. Full data + query outputs +
plan captured in **[`docs/db-volume-cleanup-handover.md`](docs/db-volume-cleanup-handover.md)** — read
that first when picking this up. Also note a perf flag: `oura_raw_samples` takes 15.2 K seq scans (may
need an index).

### [devices][platform] Oura-BLE rollup DB-pool fix (v1.188.1, 2026-07-21) — server-side, needs on-device 499-check
Fixed the home "Sync failed" toast, root-caused to the Oura-BLE ingest: `aggregateOuraRawSamples` ran
**inline** on every `/api/oura-ble/samples` POST and fanned reads over **10 of the 10 pool connections**
for 12–30 s — starving the outbox sync and blowing the native client's 30 s timeout (→ 499 → cursor-held
re-drain retry storm → prod `NO_SOCKET`/`TCP_INVALID_SYN`). Now the rollup reads via **one** connection
and is **time-boxed** (`ROLLUP_RESPONSE_DEADLINE_MS = 10 s`) so the POST returns 2xx promptly and the rollup
finishes in the background, with a per-user in-flight guard. **Verified:** full suite (1901 tests) + real-HTTP
`pnpm dev` exercise of the 200/rollup/deadline branches. **NOT device-verified** — `getLocalStore`/the native
POST path don't run in the sandbox, so the actual 499→2xx improvement on a real ring drain is unconfirmed.
Ships via Railway (no APK rebuild). **Device-smoke:** pull-to-sync on the S25 while the ring drains; confirm
`/api/oura-ble/samples` returns 2xx quickly (no 499 in Railway HTTP logs) and no "Sync failed" toast. Row I19
in `docs/oura-ble-operations.md §1`.

### [nutrition] Offline saved-meal create/edit/delete (v1.188.0, 2026-07-21) — new sync domain, NOT device-verified · needs: android
Saved meals became a full offline-first write domain: new SQLite v16 tables (`saved_meals` +
`saved_meal_items`), local-first read hydrated from the page's server fetch (clobber-gated on
`sync_status`), and an outbox `saved_meals` domain whose `pushMutations` branch replays create/edit/
delete idempotently (`writeSavedMeal` upserts on the client-minted id). No Postgres migration or
getSyncDelta change — cross-device convergence rides the existing `cachedFetch` refresh. **Entirely
APK-only** (`getLocalStore` null on web → unchanged online-only fallback, no web regression); the local
mirror, outbox replay, and clobber-gate only run on the S25. Scope: existing library foods only —
"add a new food from scratch" stays online-only with a needs-connection message. **Device-smoke:**
airplane-mode → create/edit/delete a meal from logged foods, confirm instant list update + pending
count in More→sync-health, then reconnect and confirm all three land server-side and pending clears.

### [nutrition] Offline food search (v1.187.0, 2026-07-21) — APK-only, NOT device-verified · needs: android
Food-library search, the build-a-meal ingredient search, and the "recently logged here" quick-pick
now read the local `food_items` store first (new `searchFoodItems`/`getRecentFoodItemsForMeal` local
methods) so re-logging a usual food works offline. `getLocalStore` returns null on web, so this path
is dead in `pnpm dev` (web = unchanged server fetch, no regression) and only runs on the S25 native
SQLite. **Device-smoke:** airplane-mode, open the food logger, confirm My-Foods search + build-a-meal
ingredient search + the recent-for-meal quick-pick return previously-logged foods with no signal.
Saved-meal *view + logging* were already offline (cachedFetch persistence + food-log outbox); only
saved-meal *create/edit while offline* remains a gap (deferred, owner decision).

### [workouts] Deload badge on exercise history (v1.186.0, 2026-07-21) — badge absent offline until fetch lands
Exercise-history Session Log rows now show an amber "Deload" pill when `isDeload` is true. The flag is
server-computed and already on each entry; no plumbing added. **Known limitation (pre-existing):** the
offline local-seed path in `exercise-history-sheet.tsx` stubs `isDeload: false` (the local store doesn't
carry the phase flag), so the badge is transiently absent when seeded offline and only correct once the
server fetch resolves. Fixing that needs the deload flag persisted in the local store — deferred.
Builder-review row keys were also made stable (`clientId`) in the same PR; no visible change.

### [workouts] Workout-screen open-flash / zoom-lock / prescription-at-session-end (v1.185.1–v1.185.3, 2026-07-20) — NOT device-verified · needs: browser
Three WebView/pipeline fixes from this session, none reproducible in the web sandbox:
(1) **Open-flash** — the pre-workout screen no longer replaces the painted exercise list with the
full-screen "Preparing your AI workout" takeover (heading swaps in place instead). Pure render change,
verified in `pnpm dev`, but the `aiPrescriptionPending` branch needs an ai_dynamic program mid-regeneration
to see on-device. (2) **Zoom-lock** — viewport now sets `maximum-scale=1, user-scalable=no` to stop the
app reopening stuck-zoomed after minimize/reopen; the stuck-zoom state only manifests in the Android
WebView, so **needs an on-device minimize→reopen check**. (3) **Prescription-at-session-end** — the next
AI prescription is generated in-process at completion (new `lib/ai-periodization/generate-prescription.ts`)
instead of via the unreliable self-origin `fetch(.../prescribe)` on next open; full test suite + tsc green,
but the **Gemini end-to-end path is not testable in-sandbox** (local seed is a `manual` program, no API
key) — needs real-data/on-device confirmation that finishing an ai_dynamic session queues the next
prescription and the card shows "Auto". Note the completion-time regeneration threads the just-completed
session as `excludeSessionId` so it can't self-trigger the emergency deload (reconciled with the W5 fix on merge).

### [cardio][workouts] Run-explain narration + prescription volume pills (v1.185.0, 2026-07-20) — NOT device-verified · needs: browser
Two new UI surfaces (owner chose to surface, not delete, the W4 §5 dead fields): the prescribed-run
card now shows an AI one-liner from `running-plan/explain` (falls back to the deterministic rationale
on failure/offline), and the AI-prescription card shows per-muscle weekly-volume pills. Both render
fine in `pnpm dev` but are APK surfaces (running screen, workout prescription card). **Device-smoke:**
confirm the run AI sentence renders and degrades to the plain rationale offline, and the volume pills
render + sum sensibly on the S25.

### [workouts][app-shell] Workout-screen render-perf (W2, 2026-07-20) — perceived responsiveness NOT device-verified · needs: browser
The 2026-07-20 audit (§2.1) flagged the workout orchestrator's broad `useShallow` pick as re-rendering
on every weight-dial tick. Re-verification found the premise wrong — the dial mutates `perSetWeights`,
which the orchestrator never subscribed (it was already isolated by design). The real dial-tick hot path
was the **814-line `ActiveWorkoutScreen`** (it subscribed the whole `perSetWeights` array and fed
`SetCard`/warmup/live-1RM by value). Fix: extracted self-subscribing memoized leaves (`ActiveSetCard`,
`SetsGrid`) + leaf-ified `Live1rmReadout`/`PipView`, so a dial detent re-renders only those small leaves;
the parent now reads just `perSetWeights[0]` (working-weight header + warmup). Also narrowed the
orchestrator pick (reps/setWeights/lap/rest moved to leaves + `getState()` in handlers). **Pure
render-optimization — the same values render, only *which* component re-renders changed** (trivially
revertible). tsc/lint/tests/build green. **NOT verified:** the actual perceived-smoothness improvement is
web-sandbox-invisible — needs the S25 APK active-workout smoke (log several sets across exercises: no
dropped dial ticks, no stale displayed weight/reps, rest ring + lap/rest counters still update, live-1RM
+ warmup update as set-1 weight changes) per `docs/device-smoke-checklist.md`.

### [readiness] Chronic-stress rollup wiring (Chunk 1, 2026-07-20) — score is null in-sandbox; NOT device-verified on real ring data · needs: data
`cumulative_stress_1_2_2` (ChronicStress) is now wired into `aggregateOuraRawSamples` (`chronic_stress`
step) via `lib/health/chronic-stress-assembly.ts` + a new per-5-min HRV series (`lib/health/hrv-5min.ts`,
ported from the preserved `sleepstaging_2_6_0` source per the owner's unblock). The golden model test is
unaffected and a synthetic-full-data unit test proves the assembly produces a non-null score. **What is
NOT verified (and can't be in-sandbox):** (1) a real **non-null** score — the model's 21-day gate means
nothing renders until ≥21 nights of real ring data with granular hypnogram/HRV/temp-skin signals exist,
and the seed DB has none; (2) whether the score is *sane vs Oura's own historical ChronicStress* — owner
/ on-device only. Two documented approximations pending owner calibration: the **fever-deviation limit**
(`TEMP_DEV_FEVER_LIMIT_C = 1.0`°C, biased against over-masking so the 21-night gate isn't starved; the
`highestTemp > 38°C` branch is the primary fever gate) and the **30-sec hypnogram** (up-sampled 10× from
the 5-min stager since the Ring 5 emits no native 30-sec phase events, making SFI transition-counting
coarser). No surface yet — a Health ChronicStress card (Chunk 2) is deferred until the owner confirms a
plausible on-device value. First score also needs a wide/full rollup pass covering ≥21 nights (the
in-memory history is built from that pass's stashed signals).

### [workouts] `active-workout-screen.tsx` has grown past the 800-line component-size guidance (found 2026-07-20)
The 2026-07-20 wiring/caching-perf audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`
§2.5) found `components/workout/active-workout-screen.tsx` is now 814 lines — a new hotspot not on
CLAUDE.md's named list (`session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`,
`health-content.tsx`/`health-sections.tsx`, `program-editor-sheet.tsx`). Advisory only — no single
extraction was obviously correct at audit time, so no plan was written for it (per the "no
orphaned findings" rule, recording it here instead). Watch it: new features should extract into
`components/workout/` children rather than appending further, and it's a candidate for a split
plan once a natural seam appears (e.g. the rest-ring/lap display vs. the exercise-list body).

### [workouts] Warm-up / bar-load status-bar chip counts DOWN + red/negative over-run (v1.181.0) — NOT device-verified · needs: android
Owner report: the green Android Now Bar prep pill counted up; they want a countdown, and at 0 it should
turn red and show how far over target it is. Both prep UIs already render a fixed target
(`WARMUP_GOAL_SEC=600`; bar-load `transitionSecForEquipment`), so the chip now passes a **future finish
anchor** and the native chip counts down, flipping to a red negative `−M:SS` over-run at the boundary.
- **This is a NATIVE change (`MainActivity.java`) — the Railway WebView deploy alone is NOT sufficient.**
  The JS half (`workout-screen.tsx`, the future anchor) is coupled to the native half: a future anchor
  renders wrong on the old native. It requires an **APK rebuild** (`npx cap sync android &&
  ./gradlew assembleDebug`, install on the S25) to take effect.
- **On-device smoke:** start a workout → warm-up pill counts down from 10:00; enter a barbell set's
  get-ready → counts down from 4:00; let one run past 0 → stays green→**red**, ticking `−0:15`, no
  "Start set" action fires. Kotlin is compile-checked only by the Android CI job (no Android SDK in the
  sandbox); `tsc`/lint green.

### [devices] Phase 2: native chest-strap foreground service (v1.180.0) — NOT device-verified · needs: hardware
Shipped for on-device testing at the owner's request. New `com.trainingai.app.polar` native package
(foreground service + GATT client + Capacitor plugin) that holds the Polar H10 connection all day so
strap HR streams with the screen off / app backgrounded (Phase 1 was foreground-only).
- **Kotlin is compile-checked only** — the Android CI job runs `assembleDebug` + the `0x2A37`
  JVM decoder test (`PolarProtocolTest`). There is no Android SDK in the sandbox, so **all runtime
  BLE / foreground-service / background behaviour is APK-only**: real all-day + screen-off streaming,
  connect/reconnect-backoff, worn-gating, and the native `/api/hr-ingest` POST using the
  `CookieManager` session cookie. On-device smoke on the S25 is the real gate
  (`npx cap sync android && ./gradlew assembleDebug`, install, wear the strap through a day of
  intermittent walks with the phone pocketed; confirm HR lands + the ring battery is unaffected).
- **Separate foreground-service chip** — Android requires one notification per foreground service,
  so this adds a "TrainingAI · Chest strap" chip alongside the Oura ring's. Consolidating both into a
  single "Sensors" notification is a deferred follow-up (needs one service to own a shared chip).
- **Mid-session pairing** still needs an app restart to activate the service (mount-time gate,
  inherited from Phase 1).

### [devices][heart-rate] Always-on chest-strap HR + "activity detected" notification (v1.177.0) — NOT device-verified · needs: hardware
Shipped to `main` for on-device testing at the owner's request; all JS, deploys via Railway (no APK rebuild).
- **Always-on strap + strap-preferred HR all day (Phase 1):** the strap now connects and wins precedence
  over the Oura ring app-wide (ambient mode), not only during workouts. Unit tests prove **ambient never
  starts the ring's burst loop** (ring-battery-safe in logic) and that ambient persistence is thinned to
  ~1 sample/30 s. But **no BLE runs in the sandbox** — real strap connect/stream, the ring battery holding
  over a full day, and actual `oura_heartrate` write-volume are **APK-only**. **Foreground-only:**
  background/screen-off all-day capture needs the native foreground service (**Phase 2**, still on the
  backlog). A strap paired **mid-session** needs an app restart to go ambient (mount-time gate). No off
  toggle yet (default-on when paired, per owner).
- **"Activity detected" notification + reworded GPS chip:** `LocalNotifications` no-op on web, so the
  one-off heads-up firing at the confirmed-walk (`probing→tracking`) transition and clearing when GPS
  stops, plus the reworded "TrainingAI · Activity / Tracking your walk or run" foreground chip, are
  **APK-only**. Verified in-sandbox: tsc, lint, build, 1715 tests (10 new live-hr/store).

### [cross] Deep app review 2026-07-19 — 1 critical + 6 high verified findings, ALL QUEUED (fixes not yet shipped)
Full-system audit (`docs/reviews/2026-07-18-deep-app-review.md`: 13 review agents, adversarial
verification of every critical/high, empirical dev-server probes; ~100 raw findings). Everything
below is **live on `main` right now** and queued in `docs/implementation-backlog.md`
(▶ Deep-review batch, plans P1–P5); this row is struck per-item as the fix PRs land.
- ~~**CRITICAL — new-food logs never reach the server (D-1):**~~ ✅ **FIXED v1.171.1**
  (`fix/s1-food-items-sync-envelope`). `food_items` added to the push envelope; the enum and the
  local-store `PendingMutation` type now both derive from one canonical `SYNCED_MUTATION_DOMAINS`
  list, and a source-scan test (D-2) fails CI if any `queueMutation` domain literal is missing from
  it. A one-shot `requeueStrandedFoodItems` heal (run before each push) re-queues the item + re-opens
  any log already dead-lettered by this bug. Server path verified on local Postgres; **the on-device
  native-SQLite heal itself is NOT device-verified** (`getLocalStore` returns null in-sandbox — the
  final gate is an APK smoke: log a new food online, confirm it appears server-side).
- ~~**HIGH — Time-in-Zone feature dead since ship (J-8):**~~ ✅ **FIXED v1.172.0** (P2) — additive
  `normalizeDateParamIso` (dash) revives the day iterator; zone-cache also invalidate-on-HR-rewrite +
  canonical profile + profile stamp. ⚠️ **Zone *values* not device-verified** — sandbox seed has no
  `oura_heartrate`, so only iteration/persist/cache-stamp are proven; real zone minutes need the S25.
- ~~**HIGH — Training Stress (OTS) route 500s in prod / never persists (J-9):**~~ ✅ **FIXED v1.172.0**
  (P2) — dash-form date; route now 200s and OTS persists on a good read. ⚠️ **Not device-verified** —
  gates `no_readiness` in-sandbox (no BLE-derived readiness); real OTS + the J-6 gappy-day grid need
  the S25 + ring data.
- ~~**HIGH — AI layers blind to live readiness (F8=E2-1+E2-12):**~~ ✅ **FIXED v1.176.0** (P3) — new
  canonical `lib/health/live-readiness.ts` (`liveReadinessByDay`/`liveReadinessForDay`/`getLiveReadiness`:
  own BLE composite wins, pre-re-key Cloud fills gaps, frozen post-re-key Cloud withheld) reads across
  prescribe signals, chat context/tools, weekly digest, health insight, and next-session. Also E2-8
  (provisional≠absent), E2-11 (prescription-retry guard widened to `consumed` alone), F9 (resilience+OTS
  surfaced to chat/digest), F6/F7 hygiene. ⚠️ **Not device / real-token verified** — no real ring data in
  sandbox; composite-vs-frozen precedence is unit-tested + seeded-smoked, S25 end-to-end freshness is device-gated.
- ~~**HIGH — BLE rollup statement-timeout cliff ~Sep–Oct 2026 (C-1=H-2):**~~ ✅ **FIXED v1.174.0** (P4
  efficiency half) — the rollup is now O(window): 35d bounded reads + an incremental daily-summary fold
  seeded from the persisted checkpoint (byte-identical to full replay) + window-scoped upsert, coalesced
  per-drain (+0x50 trigger), with K6 failure telemetry. ⚠️ **Not device-verified on real ring data** —
  admin ingest/redecode routes + real drain throughput need the S25 (rollup logic covered by 32 DB-backed
  test files on the windowed path).
- ~~**HIGH — per-workout HR stats erased by the 180d prune + rr_intervals unbounded (H-3, H-1/G-6):**~~
  ✅ **FIXED v1.177.0** (P4b retention half, `fix/s2-ble-retention`) — Lever W persists a durable
  `workout_hr_stats` snapshot (mig 135) on first recap view (COALESCE fuller-wins) with a fallback when
  the raw series thins + an admin backfill; Lever R adds the 90d `rr_intervals` write-path prune (safe
  once workout-HRV is snapshotted). ⚠️ **Not device / real-token verified** — APK recap render of the new
  snapshot summary, real strap-RR prune, and the admin backfill (seed user non-admin, `requireAdmin`→403)
  are unit/DB-tested, not on-device; the backfill must be run before ~2027-01 (first BLE workout hits 180d).
- **HIGH — native drain cursor hole-jump race (R-1):** a batch succeeding after a failed batch
  confirms past the failed span (`OuraRingService.kt` non-volatile `drainIngestFailed`, never
  re-checked in `confirmStored`) — silent permanent loss of ~one ≤255-event history batch per
  incident. Kotlin fix + owner APK rebuild (native pen).
- ~~**HIGH — dead local store silently no-ops writes (K4):**~~ ✅ **FIXED v1.172.0**
  (`fix/s1-error-surfacing-standard`). A failed native init now sets a dead-store flag →
  `getLocalStore` returns null, so writes take the online API fallback (the same path web uses — no
  risky global `runSQL`-throw) instead of no-op'ing behind a success toast; plus an amber
  "Local storage unavailable — saving online only" banner and one `error_events` telemetry row. This
  also realises R3 Task 4.2's intent (that plan's `runSQL`-throw approach is now superseded).
  **The dead-store path itself is APK-only (native SQLite) — NOT device-verified.**
- Also verified then downgraded to medium (**all FIXED v1.172.0 except where noted**): chat's
  body-weight regex auto-log (F1, still open — Stream 1 Task 5), fitness-test
  HRR1 deterministically null (E2-9, Stream 2), ✅ workout-screen infinite-skeleton path + dead error toast
  (K2), ✅ zero signal at dead-letter time (K3), `daily_zone_minutes` compute-once-forever cache
  (J-1, latent until J-8 lands). Positive: 14/17 sampled prior "fixed" claims verified
  still-fixed; admin gating, Zod coverage, ownership checks, safe-area utilities, S7 signal
  consistency, and the formula library all held up.

### [platform][app-shell] P5 error-surfacing (v1.172.0, 2026-07-19) — APK-only surfaces NOT device-verified · needs: android
Shipped the §K standard; the JS/server logic is unit-tested (cachedFetch `onError` channel,
dead-letter signal) and server-render smoked (authenticated /workout, /more, /health/heart-rate all
200, no error boundaries). These surfaces run only on the canonical APK runtime and could not be
exercised in the web sandbox — flagged per the Canonical Runtime rule:
- **Dead-store banner + write-rerouting (K4):** `getLocalStore` only returns null-on-dead when
  `isSQLiteAvailable()` is true (native + plugin). Requires a real APK with a forced init failure to
  observe the banner render, the telemetry row, and a food/body-metric save actually taking the API
  fallback. The web fallback path (which the fix reuses) IS exercised by `pnpm dev`.
- **Dead-letter toast + More-tab badge (K3):** the toast fires from `reconcileDeadLetters` after a
  real 5×-failed outbox push (native SQLite outbox); the badge is `useSyncExternalStore`-driven.
  Logic is unit-tested; on-device appearance at an actual quarantine transition is unverified.
- **Chest-strap HR re-buffer (K5):** BLE-only; the re-buffer on a failed `/api/hr-ingest` POST needs
  a paired strap on a flaky connection to observe. Pure buffer-cap logic is straightforward but
  device-unverified.
- Web-observable pieces (K2 workout error-with-retry, K9 card retry states, K1/K8 telemetry, K7
  pull-to-sync toast) are covered by the render smoke + unit tests, but the literal error UI only
  appears under a live 500/429, which was simulated in unit tests, not click-driven in-session.

### [workouts] §E1 workout-flow batch (v1.172.1, 2026-07-19) — two APK-only surfaces NOT device-verified · needs: android
The server/logic pieces are unit-tested (rehydrate reset) and DB-verified (E1-2 `loggedAt`, E1-6 `achievedAt`
against local Postgres), and `/workout` renders 200 with `allTimePr1rm` in the route payload. Two surfaces run
only on the canonical APK runtime:
- **E1-4 rehydrate reset:** the full workout-identity reset on a stale/date-rolled session fires from zustand's
  `onRehydrateStorage` at app reopen. The pure `applyRehydrateFixups` is unit-tested (a stale/warmup/date-rolled
  session fully clears; a recent session keeps its identity), but the actual app-kill-and-reopen-days-later
  behaviour needs an on-device run.
- **E1-5 offline id-only seed:** the strict-id resolution + offline reselect path only runs when `getLocalStore`
  is non-null (native SQLite) and the network fetch fails — not reproducible in the web sandbox.

### [workouts][platform] PERF-9 workout-data `?tab=all` batch (2026-07-18) — shipped, `ai_dynamic` batch branch NOT runtime-verified
- The `?tab=all` batch was dev-server verified for **byte-identical** per-session output vs the single-tab
  path (exercises/phaseStatus/aiPrescriptionPending/dataDate), zero prescribe calls, zero write POSTs — but
  only on the local **`manual`**-mode Push/Pull/Legs seed. The batch's `ai_dynamic` derivation (AI-prescription
  override, expiry-stops-driving-load, `aiPrescriptionPending`, baseline/deload phase-status) ran its empty
  paths only. It is a line-for-line mirror of the single-tab path minus the writes, and shares the same
  `buildWorkoutExercises` helper (so the exercise mapping cannot drift), and `deload-reverts` unit-tests the
  payload — but a real `ai_dynamic` program's batch output has not been compared against its single-tab output
  at runtime. Low risk (structural parity + shared helper); flagged per the verification-disclosure rule.
- Not exercised on-device: native SQLite `setCached` of the per-session seeds + Samsung WebView paint. The
  client change is a like-for-like swap of an existing `cachedFetch`+`setCached` seed pattern.

### [workouts] R4 workout-flow hygiene — WK-13 / WK-16 (v1.170.2) — shipped, both APK-only surfaces NOT device-verified · needs: android
- **WK-13 (day rollover while foregrounded):** the `rolloverDay` store action is unit-tested and the
  `visibilitychange` listener was confirmed to attach + fire without error on the dev server. The actual
  bug it fixes — an app held open **across local midnight** dropping yesterday's ticks/Complete button —
  can only be observed on a real device kept foregrounded past midnight. NOT verified on-device.
- **WK-16 (one timezone basis for the completion flow):** server date behaviour is provably unchanged
  (`normalizeDateParam` already discarded the payload's datetime suffix and fell back to the server's own
  `todayInTz(tz)`), and the optimistic calendar stamp now uses the same `YYYY/MM/DD` user-tz format
  `getCalendarData` keys with. The divergence it fixes is only observable on a device whose OS clock is set
  to a **non-`Australia/Brisbane`** timezone near midnight — the dev sandbox tz is Brisbane (device == user
  tz), so it's unobservable here. NOT verified on-device.
- **Deferred (item 8 backlog notes, not regressions):** WK-15 (re-key phase counting off `session_id` —
  needs a backfill migration for the nullable column; renaming a session still resets phase progress) and
  WK-18 calendar_event outbox (a failed Google Calendar add still drops silently).

### [workouts] Goal-aware accessory intensity (v1.170.0) — shipped, owner's live program NOT device-verified · needs: data
- The math (`pctForExpectedRpe` inverse, goal-aware bands, the prescribe + workout-data apply points)
  is fully unit-covered (16 tests + regression sweep) and `tsc`/lint/full-suite/build green; dev-server
  verified the manual path is untouched and an ai_dynamic accessory moved 75%→66% at 12 reps (RPE-8
  strength target).
- **NOT verified on-device:** the fix is visible only where an accessory flows through an **AI-dynamic**
  path; the owner's live "RPE 6 → RPE 8" change is confirmable only against their production program on
  the S25 (open an accessory, confirm the slider reads ~RPE 8 and the prescribed weight rose). Run
  `docs/device-smoke-checklist.md` or treat this row as the not-yet-device-verified marker.
- **Out of scope (flagged follow-ups):** a stored **static** accessory style % on a **non-AI-dynamic**
  program is per-user DB data, untouched (retro-fixing needs re-generation or a confirm-first migration);
  **per-muscle-group** intensity profiles were explicitly deferred by the owner. `ACCESSORY_SPEC` target
  RPEs are starting points — tunable per goal if the owner wants more/less.

### [platform][readiness] On-device health-anomaly alerts (v1.169.0) — shipped, native delivery NOT verified
- The pure decision logic (`computeHealthAlertActions` — illness/stress/readiness fire/skip, dedup,
  precedence) is fully unit-covered (11 cases) and `tsc`/lint/full-suite/build green; the two dependency
  constants (`STRESS_HIGH_LEVEL`, `STRESS_HIGH_DAY_THRESHOLD_MIN`) and the `body-battery.stress.highMinutes`
  field are confirmed live on `main`.
- **NOT verified on-device (owner APK smoke pending):** `Capacitor.LocalNotifications` no-ops in the web
  sandbox, so the **actual notification delivery** — scheduling, the `health-alerts` channel auto-create,
  the mount/resume firing from `sync-provider.tsx`, the per-day dedup persistence, and the tap-through
  route (`/health/readiness`) — is APK-only and unexercised here. Client/JS only (ships via Railway, no
  APK rebuild), so the code reaches the device on next WebView load; only the native transport needs the
  smoke run.
- **Scope, by design:** delivers the offline-first 90% — the anomaly fires the next time the app is
  opened/resumed that day. True closed-all-day-unsynced push needs the deferred FCM-native endgame.

### [cardio] Running Prescription Coach Phase 1 (v1.167.0) — shipped, offline-first + device paths NOT verified
- The engine (`lib/running/`, 22 tests), persistence (`running_plans`/`prescribed_runs`, mig 132, SQLite v15),
  `GET/POST /api/running-plan` + `PATCH runs/[id]` + `explain`, and the `/running` UI are sandbox-verified:
  full suite (1698) / `tsc` / lint / `check-push-mutations` / `pnpm build` green, and a dev-server round-trip with
  real auth exercised create → gate-aware prescription → `rest` on seeded low readiness → complete/skip →
  no-clobber re-GET → real Gemini `explain`.
- **NOT verified on-device (owner APK smoke pending):** the **offline-first completion path** — native SQLite
  (`getLocalStore` is null in-sandbox), so the local-first read of today's status, the `prescribed_run` outbox
  push, the `pushMutations` mirror, and the `applyDelta` pull clobber-gate only ran via the web API fallback here;
  the SQLite **v15** table create + reconcile need the APK. Also **safe-area insets** (`/running` header + `pb-safe`
  Start button render as 0 in-sandbox) and the **guided-activity hand-off round-trip** (Start → `/activity` →
  `activity_logs` row → `activity_log_id` link → next prescription). JS/server ships via Railway with no APK rebuild;
  the local SQLite table is created by the existing JS migration runner on next open.
- **Adaptive re-prescription is Phase 1 only** — the plan is regenerated each `GET` from current signals but the
  weekly base volume does not yet grow from logged runs, and there is no multi-week look-ahead (Phase 2, backlogged).

### [app-shell] App icon → dumbbell (v1.166.3) — launcher + notification icon NOT device-verified · needs: android
- Replaced the blank white launcher placeholder with a green dumbbell (candidate B): Android adaptive
  foreground/background + a new `<monochrome>` themed-icon cutout across all densities, legacy
  `ic_launcher`/`ic_launcher_round`, a new `ic_stat_dumbbell` notification silhouette (Oura foreground-service
  notification now uses it, `OuraRingService.kt`), and the PWA `app/icon.tsx`/`apple-icon.tsx` refreshed to
  match (manifest cache-bust `?v=3`, version 1.166.3).
- **Verified in-sandbox + CI:** the PWA icon routes render valid PNGs (`/icon?v=3` 512×512, `/apple-icon`
  180×180, both 200/image-png), lint clean, and CI's "Android (Kotlin tests + debug APK)" job compiled the
  Kotlin change + resources. **NOT verified on-device:** the *visual appearance* of the native launcher icon,
  themed-icon cutout, and notification small-icon only takes effect after an **owner APK rebuild** (`npx cap
  sync android && ./gradlew assembleDebug`) — the home-screen icon won't change until that rebuild. The
  in-app/browser icon updates immediately via Railway.

### [cardio] Cardio Baseline Fitness Tests (v1.166.0) — shipped, on-device flow NOT verified
- The guided-test flow (`/baselines`), the offline-first `fitness_tests` domain (mig 131, SQLite v14, full
  outbox/sync mirror), the VO₂max equations (`lib/health/fitness-tests.ts`, unit-tested), and
  `/api/fitness-tests` (GET/POST/DELETE, dev-server round-tripped against local Postgres) are all
  sandbox-verified; `tsc`/lint/`check-push-mutations`/full suite (1669) green.
- **NOT verified on-device (owner APK smoke pending):** **live HR** (`useLiveHr` shows `—` in the sandbox —
  ring/strap sources are APK-only), **GPS distance** (`navigator.geolocation` yields no fix in-sandbox, so a
  real 6MWT/Cooper VO₂max is only obtainable on-device outdoors, screen-off), the **native SQLite offline
  path** (`getLocalStore` is null in-sandbox → local write/outbox/`pullDelta`/offline-render only run via the
  web API fallback here; the SQLite v14 create, the pull-clobber `sync_status` guard, and cross-device delete
  propagation need the APK), **safe-area insets** on the four full-screen test surfaces, and **haptics** on
  finish. JS/server ships via Railway; the SQLite v14 migration + native paths require an APK rebuild.

### [cardio][heart-rate] HR/cardio baseline bug fixes (v1.173.2) — shipped, guided-HRR + safe-area NOT device-verified · needs: android
- **What changed (3 owner-reported bugs):** (1) 6MWT VO₂max was ~half of reality — switched from the
  clinical-population Ross 2010 distance-only equation to the **Burr 2011** healthy-adult multivariable
  equation (weight/sex/RHR/age threaded through `app/baselines/page.tsx`), Ross kept only as a
  missing-data fallback; (2) Resting HR + Recovery now runs a guided rest→effort→recovery phase machine
  (`TestHrrGuide`) and measures the 1-min drop from a deterministic `recoveryStartMs` (was measured
  from end-of-capture → always blank); (3) fitness-test screens moved off floorless `pb-safe` to the
  floored `pb-safe-action`/`-lg` utilities. CLAUDE.md Safe-Area section rewritten so the doc no longer
  prescribes the floorless utility for anchored controls.
- **Sandbox-verified:** `tsc`/lint green; 16 fitness-test unit tests (Burr + Ross fallback, phased-HRR
  recovery computation, phase helpers); `/baselines` renders authenticated (200) against local Postgres.
- **NOT verified on-device (APK smoke pending):** the guided-HRR recovery drop depends on **live BLE HR
  samples** arriving through the recovery minute (sandbox shows `—`), **GPS** distance for a real Burr
  VO₂max, native SQLite save, **safe-area** clearance on the four test surfaces (insets render 0 in web),
  and phase-transition haptics. JS/server ships via Railway; no migration/native change, so no APK rebuild.
- **Cooper 12-min run confirmed unaffected** (correct Cooper 1968 equation, shares no code with the bugs).

### [workouts] Stale-session-id fix / strict id-only identity (v1.171.0) — shipped, NOT verified on-device
- **What changed:** `/api/workout-data` now resolves sessions **by id only** (removed the
  `find by name` and `sessions[0]` fallbacks) and returns `{ sessionNotFound: true }` for an unknown
  id; the 3 card-prefetch callers pass `sess.id`; program save force-re-syncs the offline mirror
  (`pullDelta(userId, true)`), and `pullDelta` gained `fullResync` (since=0); the workout screen
  recovers a stale id via an id-based full re-sync + a "reopen the session" reselect screen; exercise
  ids round-trip through the editor; prescribe self-heals a valid-but-stateless session.
- **Highest risk — removing workout-data's name fallback.** Audited every `workout-data?tab=` caller
  (all pass id or `meta`; chat's `sessionType` feeds WeightsPanel, not a session load) and full
  suite/build are green, but a missed name-based caller would now 404 as `sessionNotFound`. **On-device
  smoke required:** open each session (Push/Pull/Legs/Upper/Lower), confirm exercises + AI card load;
  edit a program → reopen → confirm the AI prescription regenerates (no "couldn't generate"); confirm
  a genuinely stale link shows the reselect screen and recovers after reselect.
- **Device-only unverified paths:** the native SQLite mirror write on save, `fullResync` rebuild,
  the `sessionNotFound`→re-sync→reselect flow, and baseline-1RM preservation across an edit — none run
  in the web sandbox. JS/server-only — live via Railway on merge, no APK rebuild.
- **Owner recovery for the currently-stuck device:** after deploy, opening the broken session
  force-re-syncs the mirror; then reopen it from the session list (correct id). A reinstall also works.

### [activity] Step-counter real-data console — shipped, step count NOT owner-validated on-device
- The real-data pipeline (`lib/oura-ble/step-counter-pipeline.ts`: stored `0x7e/0x7f` → `unpack27` →
  `runStepsMotionDecoder` → `runStepCounter`) is wired, exposed by admin-gated
  `GET /api/oura-ble/step-counter-export`, and surfaced by `StepCounterExportConsole` on `/admin/oura-ble`.
  The wiring is unit-tested (pair → dequantize → step_counter over synthetic frames), the authed route
  happy-path was exercised on the dev server against the local DB (seeded anchor + 8 paired frames →
  valid JSON: paired windows, decoded stride-frequency summary, step_counter total, Tier-1 gate estimate),
  and the admin page renders. `tsc`/lint/full suite (1657) green.
- **The step_counter TOTAL is NOT a trusted count yet** — two things are unconfirmed and are exactly what
  the console exists to validate against a phone: (1) that `unpack27`'s 27-column order matches
  `steps_motion_decoder`'s `data_columns` order (Sub-plan D-2), and (2) the `0x47` → step_counter 8-column
  motion mapping (`regular_motion` isn't decoded → NaN→0; motion is often absent daytime → the stream is
  zeroed). Trust the **golden-verified decoded stride-frequency** (~1.5–3 Hz walking) and the **Tier-1 gate
  estimate** as the physical cross-checks meanwhile. Owner validation: do a counted walk, sync the ring, run
  the console, compare the total to the phone. JS/server-only — ships via Railway, **no APK rebuild**.

### [sleep] BDI reclaim (breathing-disturbance index) — shipped, real-night value NOT device-verified · needs: data
- The moonstone SleepNet apnea head (a free byproduct of the nightly staging pass) is now captured as
  `bdi_derived` (disturbed asleep-epochs/hour) and persisted to `oura_daily_derived` in the rollup, with a
  read path. The BDI math (`bdiFromApnea`) is unit-tested (disturbed-count, awake-epoch drop, no-sleep zero),
  the read path is DB-integration-tested (round-trip + COALESCE no-clobber), and the rollup plumbing is
  typecheck + full-suite green.
- **NOT trustworthy until on-device validation:** the neural stager and its apnea head only run against
  synthetic vectors in the sandbox — a real-night number requires the owner to run the admin SleepNet dump on
  a worn-overnight drain (`components/oura-ble/sleepnet-dump-console.tsx`) and confirm a sane value (the
  per-beat IBI-timestamp reconstruction feeding the model is itself an unproven device assumption). This is
  why the **user-facing display is deferred** (backlog follow-on) and no Health surface ships in this PR.
  Observational, not a diagnosis. JS/server-only — ships via Railway, **no APK rebuild**.

### [readiness] Stress-resilience (v1.163.0) — shipped, rollup compute path NOT device-verified end-to-end · needs: data
- The `stress_resilience_2_2_1` TS port is **golden-verified** against the captured `.pt` vector (all 13
  outputs within 1e-3); the orchestrator's provisional-contributor gating, band cut-points, `<5`-valid-day
  null gate and confidence are unit-tested. The read path is dev-server verified: seeding
  `oura_daily_derived.resilience_*` and hitting `GET /api/readiness-score` returns
  `ownResilienceLevel/Band/Confidence` (4 → "solid" → 1.0), and nulling the level hides the tile with **no**
  frozen-Cloud fallthrough.
- **Unverified on device:** the rollup `resilience` step (`aggregateOuraRawSamples`) builds the daytime
  stress series from raw BLE temp/met/hr and runs one ONNX pass per 30-min bucket — the sandbox has no raw
  BLE samples, so the per-night index computation + level fit can only be exercised via the seeded read
  path, not end-to-end. A real level also needs ≥14 nights of mature `oura_daily_summary` baseline **and**
  ≥5 days with ≥4 h of daytime-stress coverage (the ring power-gates when worn-idle at a desk), so live
  resilience is only observable on-device after history accrues. Also the tile rendering at ≤640px in both
  themes (self-hides while null). JS/server-only — ships via Railway, **no APK rebuild**.

### [cardio] Training Stress Score (OTS) + VO₂max (v1.162.0) — shipped, OTS `ok` path NOT device-verified end-to-end · needs: data
- VO₂max derivation + the OTS core port are **golden-verified** against the captured `.pt` vector
  (parity within 1e-3) and the assembly/gating is unit-tested. The route (`GET /api/training-stress`)
  runs the full chain on the dev server and correctly gates.
- **Unverified on device:** the raw `0x50` MET-stream decode → 1-min series (native BLE ingest) — the
  sandbox has no real MET data, so the route's `ok` path (a live OTS number + persistence) can only be
  exercised with the golden MET series in unit tests, not end-to-end. On a real worn day the ring must
  yield ≥720 minutes with ≥360 valid (≥0.9 MET) for OTS to compute. Also the done-screen badge / health
  line rendering at ≤640px in both themes (they self-hide while gated, so appear only with live MET).
  JS/server-only — ships via Railway, no APK rebuild.

### [devices][app-shell] Frozen-Cloud display honesty (v1.161.2, item 21) — shipped, NOT visually verified at S25 viewport / both themes
- New display markers/date-stamps: readiness-card temp row "Pre-re-key" chip on the Cloud fallback;
  heart-rate page VO₂ max / vascular age "as of \<date\>" stamps; RHR/HRV/SpO₂ tiles append the
  reading's date when it isn't today's; admin tester drops the dead Battery stat (live plugin
  battery strip unchanged). All server/JSON contracts + route SSR verified on the dev server
  (readiness-score new fields present / `resilienceLevel`+`sleepTimeStatus` gone / 10c derived
  stress preserved; VO₂ date-stamp via a seeded pre-re-key row; health-insight + ai-chat 200).
- **Unverified:** the pixel-level appearance of the new chips/date lines at ≤640px in **both**
  dark and light themes — no browser in the sandbox (Playwright unavailable). JS/server-only change
  (no native/safe-area/gesture/offline-first surface), ships via Railway, no APK rebuild. Give the
  markers an on-device eyeball on the next APK build.

### [workouts] "Preparing your AI workout" pre-start gate (v1.156.0, poll fix v1.165.2) — UI device-confirmed; generation-success still to verify
- New behavior: while an ai_dynamic non-baseline prescription is regenerating (`consumed` + null),
  the pre-workout screen shows a "Preparing…" state (Start held) and bounded-polls workout-data
  (~10 × 3s = 30s) until the AI numbers land, then swaps them in; on timeout it reveals the base
  numbers with a note. Server flag (`isAiPrescriptionPending` + `aiPrescriptionPending` in
  `/api/workout-data`) and the helper are unit-tested.
- **Device-CONFIRMED (owner screenshots, 2026-07-17):** the "Preparing…" card + Start-gating render,
  and the timeout→base-fallback note renders. Those halves of #584 are verified.
- **v1.165.2 fix:** the poll was re-firing `/prescribe` every tick (cachedFetch always revalidates →
  workout-data re-fires generation), bursting ~8 Gemini calls in 24s and rate-limiting itself into
  the 502 → base-fallback the owner hit. Poll now sends `?poll=1` to read-only-check (no re-fire);
  generation fires once per screen-open + on manual refresh.
- **Still to verify on-device:** that a real generation now **succeeds** (preparing → moderated numbers
  swap in) rather than falling back — the rate-limit was the suspected cause but can't be reproduced
  in the sandbox. If it still falls back after v1.165.2 with only one generation firing, the failure
  is a deeper `/prescribe` error (Railway logs needed).

### [devices][heart-rate] Polar H10 chest-strap live HR (v1.154.0, this session) — shipped, NOT verified on-device
- The whole BLE half is device-only: pairing via the OS picker, streaming, the worn-gate
  fallback (unclip → ring takes over in ~15 s, re-clip → strap reclaims), reconnect retry, and
  two-device coexistence with the ring's own GATT connection. The web sandbox exercises none of
  it (`@capacitor-community/bluetooth-le` is native; the source degrades to inert `disconnected`).
- **Requires an owner APK rebuild first**: `npx cap sync android && ./gradlew assembleDebug`
  (new native plugin — self-registers, no `MainActivity` edit). JS/server halves are live via
  Railway on merge.
- Sandbox-verified: parser/merge/rMSSD unit tests (16), `/api/hr-ingest` +
  `/api/oura/hr-data?sessionId` live-route smokes against the local DB (RR beat-time
  reconstruction exact; seeded ±25 ms alternation returned rMSSD 25), full suite green,
  `pnpm build` clean.

These are the **open** risks — mostly features that shipped but were only verifiable in the web
sandbox, never on the Samsung S25 (no Capacitor/native SQLite/safe-area insets in the sandbox).
Run `docs/device-smoke-checklist.md` as the concrete on-device verification step.

### [sleep][devices] Neural SleepNet stager now primary (v1.151.0, this session) — assembler validated on 3 real nights; production 5-min output not yet eyeballed on-device
Oura's `sleepnet_moonstone` model (ONNX, onnxruntime-node, server-side in the rollup) replaced the
heuristic stager as primary; the heuristic stays the automatic fallback when inference/preprocess
can't run. Validated via the admin dump on 3 real nights (07-14/15/16): sane inputs (HR ~62–66 bpm,
full-night beat span) and REM 21.6–25.9% (in/near the Cloud band 23–28%), vs the heuristic's erratic
17.6–24.2%. **Open:** the production path downsamples the model's 30-s hypnogram to the 5-min grid
(majority vote) — the resulting `sleep_sessions` %s haven't been compared against the admin dump's
30-s %s on-device yet. After deploy, cross-check the Health tab sleep card vs `/admin/oura-ble` →
SleepNet dump for the same night. Also `spo2=0` on all dumps (the ring isn't feeding SpO₂ to the
assembler — minor, REM is right without it; tag mapping TBD). Perf: runs one ONNX inference per night
in the aggregate — negligible for a normal sync, ~adds up over a full-history redecode.

### [platform] Admin console G-1 domain-section skeleton — ① Data section device-verified (owner, on S25 APK)
`oura-ble-debug.tsx` was re-sliced into the six domain `CollapsibleSection`s. Every BLE lever was moved
**verbatim with its handler** (state stays at the top level of the component, so wiring is preserved by
construction), and it's tsc/lint clean + builds. **✅ Owner confirmed on-device (screenshots, real S25
APK + production data):** the ① Data·Ingestion·Retention chevron renders and expands correctly, and its
G-2 footprint card + **Lever 1b backfill button work end-to-end against real data** (see the dedicated
Lever 1b entry below). **Remaining to spot-check:** the other five domain sections (Sleep,
Steps·Activity·Energy, Recovery·Readiness·Illness, Cardio·Body-comp, Cloud-legacy) — chevron
render/toggle and that a moved lever in each still fires (Sync/Drain, a HR lever, Enable steps, Dump
sleep frames, Battery soak). Hand-rolled chevrons in `sample-inspector.tsx` / `time-audit-card.tsx` /
`admin-content.tsx` are not yet converted (deferred).

### [readiness] Illness radar advisory render (v1.150.0, this session) — shipped, NOT verified on-device
The radar logic + readiness-route suppression are verified end-to-end on the dev server (a +3σ
skin-temp night → `fever`, readiness 85→22). The **advisory line** in the readiness detail
(`components/health/health-score-detail.tsx`) is a plain bordered text card (Lucide icon + flag label +
copy) inside an existing scroll container — no safe-area/fixed/gesture surface, so low device risk — but
its Samsung WebView render was not checked on-device. Verify the advisory shows on a real elevated/fever
night. Also not yet persisted to `oura_daily_derived` (analysis record deferred to the readiness-persist PR).

### [workouts] Next-workout prescription card on the done screen (v1.149.0, session 295) — shipped, NOT device-verified · needs: browser
Server/JS only (no APK rebuild), but the plan's own gate is on-device: complete a workout on
the APK, tap "Show" on the new "Next workout" card, and confirm the previewed per-set
weights/reps/rest match what `/workout` actually opens with for that next session. Web `pnpm dev`
verification only proves the endpoint returns a well-formed response and the card renders it —
it cannot prove the previewed loads agree with the live workout screen's own computation for a
real AI-dynamic prescription, since the seeded dev-DB user's exact periodization state wasn't
independently cross-checked set-by-set.

### [workouts] Rest-timer status-bar chip (v1.147.0 → v1.166.0, session 292) — CONFIRMED working on-device
Android 16 promoted ongoing notification (One UI Now Bar / status-bar pill) showing a live rest
countdown during a workout, tap-to-reopen. Native-only: an `AndroidRestChip` JavascriptInterface
bridge in `MainActivity.java`, `POST_PROMOTED_NOTIFICATIONS`, `ic_rest_timer` drawable, a guarded
`lib/native/rest-timer-chip.ts` bridge (no-op off-device), start/stop wiring in `workout-screen.tsx`,
Profile → Preferences toggle (`ta_pref_rest_chip`, default on).
**CONFIRMED on-device (owner APK 2026-07-16): the pill shows with the ticking countdown.** Two
device-only gotchas that took the debugging: (1) Samsung gates third-party Now Bar behind
**Developer options → "Live notifications for all apps"** (off by default) — must be on; (2) the app's
**PiP window suppresses the pill** — while the app shows PiP, Samsung hides its status-bar chip.
Promotion mechanism: `NotificationCompat.Builder` + `setRequestPromotedOngoing(true)` (androidx.core
1.17.0, added 1.17.0-alpha01) + `CATEGORY_STOPWATCH`; the hand-written raw extra (v1.147.0) did NOT
promote — NotificationCompat does.
**v1.155.0 follow-ups (native, MainActivity — NOT yet device-verified):** (a) **suppress PiP during
rest** so the pill is the leave surface (PiP still opens for the active set) — gated on `restChipActive`
in `onUserLeaveHint`; (b) **overtime persistence** — a `Handler` re-posts the chip counting UP at the
rest boundary (`setChronometerCountDown(false)`, `setWhen` now in the past) instead of `setTimeoutAfter`
clearing it at 0:00 (which let another app's chip steal the slot); safety timeout extended to 30 min;
(c) **"Start set" notification action** reusing the PiP `ACTION_LOG` broadcast (pipReceiver moved to
onCreate→onDestroy so it's delivered while backgrounded — no app open, no new JS). **On-device smoke
after rebuild:** home-out during rest → pill (no PiP); let it hit 0:00 → flips to count-up overtime,
doesn't vanish; tap "Start set" from the notification → next set starts; home-out during a set → PiP
still works. **CONFIRMED on-device (owner APK 2026-07-17): pill-during-rest + overtime count-up both
work.**
**v1.165.3 (native, NOT yet device-verified):** overtime tints the pill **red** — `builder.setColor(0xFFEF4444)`
(the app's overtime red) on the count-up re-post only; the Now Bar chip follows the notification's
accent colour, so the countdown pill keeps the system-default blue and the overtime pill goes red. If
the chip doesn't pick up the colour on-device, the fallback is a red variant of `ic_rest_timer` (the
chip always tints its icon by `setColor` even when it won't recolour the pill background).
**v1.166.0 (green warm-up/prep pill — native + JS, NOT yet device-verified):** the pill now also shows
during the two "prep" periods it previously skipped, tinted **green** (`WARMUP_COLOR = 0xFF22C55E`):
the whole-workout warm-up (`store.mode === 'warmup'`) and the pre-set get-ready / bar-load screen
(`mode === 'active' && !timerStarted`). The bridge gained a `mode` arg (`"rest" | "warmup"`);
warm-up/prep **counts up** from its start anchor (green, no overtime), a working-set rest still counts
down (blue → red). Anchors: warm-up = `workoutStartMs`; get-ready = `workoutStartMs +
readyElapsedBaselineSec*1000` (survives a background remount). No "Start set" action on the green pill.
PiP is already suppressed while the chip is active, so these prep periods now show the green pill
instead of PiP too. Colour model: **green = preparing, blue = resting between work sets, red =
overtime.** On-device smoke: warm-up screen → green count-up pill; get-ready/bar-load before a set →
green; start the set → clears; between working sets → blue; past 0:00 → red.

### [workouts] Rest timer on the "All sets done!" screen (v1.146.0) — shipped, NOT device-verified · needs: browser
After logging the last set of an exercise, the rest countdown ring now stays on the "All sets
done!" screen (`active-workout-screen.tsx`, extracted into `components/workout/rest-ring.tsx`)
instead of being replaced by a static card — the rest period was always running (beep +
notification already scheduled; the last set IS awarded `progressionStyle[last].restSec`, 90s
fallback), only the ring was hidden. Tests/lint/`tsc` green, `/workout` compiles + renders 200 in
`pnpm dev`. **NOT verified on the APK** — reaching the all-sets-done state requires driving the
full log-all-sets flow, and the ring is a visual change on the workout screen. Safe-area untouched
(ring is in the existing centre flex zone). On-device smoke: log every set of an exercise, confirm
the ring counts down on the done panel and rolls into red "Overtime" if you wait.

### [heart-rate] Live-HR beat-median smoothing (v1.145.1, 2026-07-14) — shipped, NOT verified on-device
Owner-reported spiky in-workout/rest HR readings. Root cause: the live path decoded a *batch* of
beats per BLE frame but surfaced only the single newest one (`latestBpmWithTsFromFrames` →
last-array-element), so instantaneous beat-to-beat HRV read as jumpy and a lone motion/decode
artifact showed unfiltered. Fix (pure TS, JS-only — ships via Railway, **no APK rebuild**, no
native/burst-cadence change): `decode-live-hr.ts` now exposes `smoothedBpmFromFrames()` which
medians the most-recent `HR_AVG_WINDOW_BEATS = 10` fresh beats (reusing the shared `median()`),
applied at the decode source so the live number, exercise trace, and sparkline all inherit it; the
near-live freshness/dedup guard is preserved and the `latest*` newest-beat functions were removed.
Also added an admin **Live HR test console** (`components/oura-ble/live-hr-test-console.tsx`, mounted
on `/admin/oura-ble`) that surfaces the manager diagnostics (frames/HR-frames/decode-hits), the raw
within-batch beat spread the median smooths over, and a rolling log of surfaced readings with deltas.
Unit tests (median-not-newest, artifact rejection, window bound, freshness guard, `allBeatsFromFrames`)
+ `tsc`/`eslint` clean; the full local `pnpm build` fails only on the pre-existing sandbox-absent
`@capacitor/splash-screen` module (CI installs it). **NOT verifiable in the web sandbox** (no BLE
frames — `getOuraBle()` is null): the on-device smoothness of the rest-window readout. On device:
during a workout rest (or via the new console's Start/Measure), confirm the surfaced bpm tracks
smoothly with no single-beat spikes while `decodeHits` advances, and that the batch-spread row shows
multiple beats per burst. If bursts prove sparse, `HR_AVG_WINDOW_BEATS` is the single tunable.

### [app-shell] Persistent tab shell (v1.145.0, session 298) — shipped, NOT verified on-device
Instant tab switching via a persistent client `TabShell` that keeps all five tab trees mounted
and flips visibility instead of navigating routes (`components/shell/tab-shell.tsx` +
`tab-page.tsx` + `tab-visibility.tsx` + `lib/shell-nav.ts`). **Verified in the web sandbox**
(Playwright vs `pnpm dev`): every tab tap — first activation and revisit — issues zero
RSC/document requests, URL syncs per tab, scroll position and sub-tab/date state survive
switches, deep links work. `pnpm lint`/`tsc`/tests (1294)/`build` green. **NOT verified on the
S25**, and several load-bearing behaviours only exist on-device: (a) the actual *feel* and paint
timing in the Samsung WebView (the whole point of the change); (b) memory/GC pressure with all
five heavy trees kept alive at once (`content-visibility:hidden` skips their *rendering*, not
their JS state — if this janks on-device, the fallback is to unmount the least-recently-used
hidden tab, but that costs its keep-alive); (c) the Android hardware back button now exits the
app from a tab instead of unwinding tab history (intended, `replaceState` not `pushState` — but
confirm it doesn't strand a mid-workout leave-dialog); (d) `inert`/`content-visibility` WebView
rendering; (e) the Nutrition cross-midnight rollover (only reproducible by rolling the device
clock). Run the "Persistent tab shell" section of `docs/device-smoke-checklist.md` on-device.

### [app-shell] R7 UI Polish & Accessibility (v1.143.7, session 287) — shipped, PARTIALLY verified
Chart black-bar fix, double-inset sheet fix, `DismissibleBanner` primitive + two banner
rewrites, `aria-expanded` sweep, and palette-literal→token/emoji→icon swaps (see Current Status
above for the full list). `pnpm lint`/`tsc`/tests/build all green, and most of it was verified
live via Playwright in both light and dark theme. **NOT verified live: the workout-load-
comparison chart's black-bar fix inside the actual Day-in-Review sheet** (`day-review-sheet.tsx`
→ `workout-load-comparison-chart.tsx`) — the verification pass couldn't get the sheet to expand
past its collapsed header in headless Playwright, and the seed data had no day with an actual
comparison chart to render. The fix is the same `resolveColor()` pattern already verified working
elsewhere (the R6 PR's HR-recovery-chart fix, and `trend-sparkline.tsx`'s long-standing use of
it), so risk is low, but it hasn't been observed rendering. Also **not exercised: the Oura
stale-sync amber+warning-icon indicator** (`more/oura-section.tsx`) — the seed data's Oura Ring
was never connected, so the stale-sync branch never renders. A follow-up pass should open the
Day-in-Review sheet on a day with real workout-load history and confirm the "today" bar is
brand-coloured (not black) in both themes, and separately confirm the Oura section's stale-sync
line shows amber + a warning icon when `lastSyncedAt` is old.

**Also found during this pass, not fixed (out of scope, noted for a future backlog entry):** a
reproducible React hydration mismatch on Home's week-strip "today" cell — SSR renders a muted,
non-"today" `aria-label`/styling; the client re-renders it brand-coloured/bold with "today" in
the label immediately after hydration. Root cause looks like the today-check running with a
different date server-side vs client-side (the classic `todayInTz()` SSR/client boundary drift
this project's CLAUDE.md already has a standing rule about).

### [app-shell] R6 Performance & Paint, Chunks 1/2/3/5 (v1.143.6, session 287) — shipped, PARTIALLY verified
Bundle-size, hydration, and render-hygiene batch (see Current Status above for the full list).
Every change is either a pure import-strategy swap (dynamic-with-skeleton → static, static →
dynamic), a `useMemo`/leaf-component extraction with no logic change, or a data-fetch
consolidation/split verified against the Network panel — `pnpm lint`/`tsc`/tests/build all
green, and the majority was verified live via Playwright (Home reload, all 3 Health tabs,
Nutrition's 6-date swipe — see Current Status for specifics). **NOT verified live: the Warm Up
screen's memoized `MuscleHeatmap` (PERF-2 fix in `warmup-screen.tsx`)** — the verification
pass's workout-entry point wasn't reached in the time available. The fix is a direct,
minimal `useMemo` wrap copying an already-shipped identical fix in the sibling
`active-workout-screen.tsx:176-181`, so risk is low, but this hasn't been observed rendering.
A follow-up pass should start a workout, open the Warm Up screen, and confirm the muscle
diagram renders correctly and does not re-render every second (a temporary `console.count` in
`MuscleHeatmap` during the check, removed after).

### [workouts] Workout-system hardening Chunk 5 (v1.143.5, session 287) — shipped, PARTIALLY verified
UI/UX polish + in-workout HR theming sweep across nine workout files (see Current Status above
for the full list). All server/client logic is either pure-function-driven (weight snapping, RPE
re-tap) or a mechanical color-token/icon swap with no new branching — `pnpm lint`/`tsc`/tests/build
all green. **Verified live via Playwright:** `/workout-select`'s carousel dots and card layout
render correctly in both light and dark themes at the 384×832 viewport. **NOT reached live** (ran
out of time mid-verification): the active-workout screen's header buttons and set-card borders,
the exercise-summary screen's chevron/1RM-arrow icons, the done-screen PR-card color / share-icon
visibility / HR error-retry state, and the weight-dial's check/recommended-dot icons — these were
verified via code review and the full build/lint/tsc/test gate only, not observed rendering. A
follow-up on-device or Playwright pass into an actual active workout should confirm these render
as intended (theme-token borders visible, icons showing, no broken layout).

### [devices][platform] Admin Oura BLE debug UI cleanup (v1.143.3, session 297) — shipped, NOT verified on-device
Pure UI reorganisation of `/admin/oura-ble` (owner-requested — the screen had grown a single giant
"Advanced (raw protocol)" panel cramming ~25 raw buttons + four large tester cards together). Now:
raw commands grouped by function under one collapsible (`Raw protocol commands`), and each tester
(Step calibration, Live step test, Continuous capture, Battery soak, Sleep epochs) is its own
`CollapsibleSection` (new shared primitive `components/ui/collapsible-section.tsx`). The log console
gained Copy + Clear buttons (new shared `lib/use-copy.ts` hook, WebView-first execCommand path)
so logs no longer need screenshotting; the four tester cards' duplicated copy logic was folded onto
the same hook. **No functionality was removed** — all handlers preserved; this is layout only.
`tsc`/`eslint` clean. **APK-only screen — the native OuraBle plugin is inert in the web sandbox, so
the collapsibles/copy could only be checked to compile, not exercised with real ring data.** On
device: open `/admin` → Tools → Oura BLE debug, confirm each section expands/collapses, the raw
buttons still fire (watch the Log section), and the log Copy button lands the full text on the
clipboard. Candidates for outright removal (kept this pass because in-use status couldn't be
confirmed from the sandbox): Step calibration and Live step test are the pre-production step-count
spikes now superseded by Continuous capture; Battery soak was a one-off measurement.

### [sleep][devices] BLE sleep-timing fixes (v1.143.2 → v1.144.1, sessions 292–293) — verified on real data; window clamp hardened
Three owner-reported sleep-timing fixes across two nights.
**(1) Future wake time (v1.143.2):** the sleep detail could show a wake a few minutes in the future when
opened right after waking; `lib/sleep/actual-window.ts` now anchors the end to the ring's recorded wake
(`phaseWindowEnd ?? sleepEnd`). Verified on-device (07-14 read `10:14 pm – 6:07 am`, no future wake).
**(2) Bedtime too early (v1.143.2, then hardened v1.144.1):** the night window included evening
wind-down before real sleep. v1.143.2 clamped to the 0x72 sleep-accelerometer span (fixed 07-14: 8:42 pm
→ 10 pm). But 07-15 defeated it — a short dense-but-AWAKE burst at 19:53–20:03 (elevated HR + movement)
made the accelerometer "start" ~2h early, so bedtime showed 8:28 pm. v1.144.1 reworks the clamp
(`lib/sleep/sensing-span.ts`) to key on HR-sample **density** per epoch (the ring spot-checks HR while
awake but streams hundreds of beats/epoch continuously only while asleep), clamping to the span of
substantial dense runs — dropping a short evening burst while still spanning a genuinely split night.
Pinned to both owners' per-epoch dumps (07-14, 07-15) + a DB-backed end-to-end regression; the 07-09
split-night merge test stays green. **Server-side — ships via Railway, retroactive on a redecode; no APK
rebuild.** ⛔ v1.144.1 NOT yet confirmed on real data: after deploy, redecode `2026-07-15` and check
bedtime snaps to ~10 pm (was 8:28 pm) and other recent nights' durations didn't shift unexpectedly.
**(3) Debugger timeout fixed (2026-07-21):** the per-night sleep-epoch dump 500'd with a gateway
"upstream error" because it re-decoded every stored sample + re-aggregated all history (`debugDate`
forced `fullHistory`). Added a `?dump=1` lightweight path (skip re-decode, keep the 35-day bound via a
`dumpOnly` flag), applied to BOTH the "Sleep epochs" button and the "SleepNet neural stager" dump
console (which had the same timeout + a bare `res.json()` that crashed on the plain-text error). Admin-tool only.
**(4) Evening-activity burst pulled into the night (v1.184.5):** the owner's 07-21 dump (via the fixed
debugger) showed it was NOT an orphan — a 6-epoch dense evening-activity burst at 17:19–17:44 (~4h before
real sleep) got spanned into the night by the density clamp's "first-to-last substantial run" logic →
window 17:19–06:44, ~13h, bedtime ~5:53 pm, and SleepNet staged the sparse evening in between as sleep.
Fixed in `lib/sleep/sensing-span.ts`: anchor the span on the LONGEST substantial run and fold in only
comparable-length neighbours (≥ 0.5× longest), so the tiny burst drops and the night starts at real onset
(~21:39); a genuinely split night stays whole (07-09 merge test green). Pinned to the 07-21 dump structure.
**⛔ v1.184.5 NOT yet confirmed on real data:** after deploy, redecode `2026-07-21` and check bedtime snaps
to ~10 pm (was 5:53 pm) and the duration is ~8–9h.

### [activity][devices] Battery-soak tester for the continuous-streaming step counter (v1.141.0, session 291) — shipped, NOT verified on-device
`lib/oura-ble/battery-soak.ts` + the "Battery soak" card on `/admin/oura-ble`. Everything it
does is BLE (feature toggle, accel stream, watchdog re-arm, reconnect handling, measurement
restore) — inert in the sandbox, so it shipped unverified by design; the owner's daytime soak
run is itself the verification. Specific risks to watch on the first run: (a) the guaranteed
restore — after Stop, tap Feature status and confirm DAYTIME_HR/SPO2/REAL_STEPS are back ON;
(b) WebView background throttling stalling the JS re-arm timers with the screen off (stalls
are logged in the exported JSON — that data feeds the Chunk 3 native decision); (c) the
reconnect path re-applying REAL_STEPS-off fast enough to keep the stream alive. An app kill
mid-soak self-heals (the native service re-enables all measurements on every connect).

### [activity][devices] Ring step count over-counts on full days; step data auto-refresh unverified on-device (session 290) — over-count open, fix shipped-but-unverified
Two parts. **(a) Over-count — OPEN.** The ring's own step estimate (col14 walk gate,
`lib/health/step-estimate.ts`) reads ~16,800 vs ~11,260 (Garmin)/~10,500 (Samsung) on a full day.
The gate was only ever calibrated on isolated short walks; across a full day, non-walk activity
(driving, gym, cooking, gestures) trips scattered low-col14 windows that each add 30 steps. The
prior "accurate" totals were Samsung Health Connect (now off), so the ring's full-day estimate has
never actually been validated. **Direction decided (session 291):** col14 is unfixable (can't
separate walking from rhythmic hand motion) and is being replaced by the gait-gated accel counter —
see `docs/superpowers/plans/2026-07-13-ring-accel-step-counter.md` (REVISION section) and backlog
item 1; col14 retires in that plan's Chunk 2. Additional additive risk to fold into the fix:
`body-metadata` adds `activity_logs`
(treadmill) steps on top of `body_metrics.steps`, and `mergeStepSources` adds non-overlapping live
windows on top of the gate estimate. **(b) Auto-refresh fix — SHIPPED (v1.138.1), NOT verified
on-device.** `sync-provider.tsx` now invalidates Oura caches when the native ring service's
autonomous (hourly/on-connect) drain lands new data, so steps update without a manual pull-to-sync.
Native/BLE — traced and reasoned in-sandbox (no ring), only truly confirmable on the S25 APK: leave
the app an hour with the ring connected and confirm today's steps update on their own.

### [nutrition] Nutrition quick-edit sheet (NUT-1/2/3) fixes — shipped, interactive verification blocked in the sandbox this session (v1.139.10, session 287)
`QuickEditLogSheet`'s stale-quantity fix (added `key={editingLog?.id}`), its synchronous
cache-invalidate/callback restructure, and `SavedMealsSheet`'s `logDate` threading all shipped
in `fix/nutrition-fixes-chunk1`. Live Playwright verification of these three (open the sheet by
clicking the pencil icon on a logged food row) repeatedly failed in this session's sandbox — the
click handler visibly fired (a `DialogContent` a11y warning appeared in the console) but the
sheet's content never rendered in the DOM, across a fresh dev-server restart and several click
strategies (locator click, raw mouse click, direct `onClick` invocation). A sibling fix in the
same PR (NUT-4, a plain API 400) verified live without issue on the same page in the same
session, so this looks like an environment-specific rendering/timing quirk rather than a defect
in the fix — but it was never actually confirmed working. **Gate: manually open the quick-edit
sheet on two different food logs in a row** (web `pnpm dev` is sufficient — this is pure React
state, not device-gated) and confirm the second log doesn't show the first log's stale quantity,
before trusting this fix in production.

### [nutrition][platform] Supplement/meal-type reminder cancellation (NUT-5) — shipped, NOT verified on-device (v1.139.11, session 287)
`computeSupplementReminderActions` now emits `cancel` for inactive/reminder-disabled supplements
instead of silently dropping them, and the manage-sheet handlers + meal-type deletion call
`cancelSupplementReminder`/`cancelMealReminder` directly. Verified only via unit tests — the
actual `LocalNotifications.cancel` OS call is native-only and no-ops in this sandbox
(`Capacitor.isNativePlatform()` is `false`). Gate: on the S25 APK, enable a supplement reminder
2 min out, then disable/delete it before it fires — the OS notification must not appear; delete
a meal type with reminders on and confirm its reminder doesn't fire either.

### [nutrition] Nutrition hygiene pass (NUT-10/NUT-11) — shipped, interactive verification blocked in the sandbox this session (v1.139.13, session 287)
R5's final chunk: removed the dead "save to my food library" toggle from the scan review screen
(`ReviewStep`), threaded a `region` hint into the AI-correction refine call, clamped quantity
inputs (`QuickEditLogSheet`/`AssignStep`/`SavedMealsSheet`) to a sane range, gated `AssignStep`'s
"today after logging" projection off for past-day logs, moved `meal-type-manager.tsx`'s
drag-reorder PATCH out of the `setMealTypes` state updater, and bumped touch-target padding
(`p-1.5`/`p-2.5` → `p-4`, ≥44px) plus an emoji→Lucide swap and a hex-literal→token swap across
`saved-meals-sheet.tsx`/`meal-type-manager.tsx`/`meal-card.tsx`/`manage-supplements-sheet.tsx`/
`water-log-sheet.tsx`. These are pure client-side changes, **not device-gated** — the gate is a
plain `pnpm dev` check, not an APK smoke run. But this session hit the same Sheet-rendering
sandbox limitation as the NUT-1/2/3 row above (click handlers fire — confirmed via a
`DialogContent` a11y console warning — but sheet content never renders in this session's headless
Playwright/Turbopack combination), so none of the Sheet-gated pieces above were interactively
confirmed; only the meal-types reorder PATCH endpoint and the scan route's `region` acceptance
were verified live via direct API calls. **Gate: manually exercise each surface via `pnpm dev`**
— open the scan review screen and confirm the save-to-library toggle is gone, type an
out-of-range quantity into the quick-edit/assign/saved-meal sheets and confirm it clamps, log
against a past day from the day-detail sheet and confirm the "today" projection is hidden,
reorder meal types twice in a row (React 19 StrictMode is on in dev) and confirm only one PATCH
fires per drag, and eyeball the touch-target sizes are visibly larger. The `p-4` touch-target
bump is code-only per CLAUDE.md's unconditional ≥44px rule — not yet confirmed against a real
48dp on-device measurement.

### [app-shell] Home/Nutrition/More bounded-shell fix (v1.138.13, session 294) — shipped, NOT verified on-device
Switched the three tab screens from `min-h-screen` (page body scrolled under the fixed tab bar) to
the bounded `h-screen` shell Health already uses, so the inner container scrolls and the nav can't
overlap bottom content. Verified only in the web sandbox (safe-area insets render as 0 there); the
on-device gate is that the last card and the rest-day streak banner clear the tab bar — including the
raised center Workout button, which pokes ~16px above the nav while `pb-nav-safe` gives ~12px
clearance (so the banner's bottom-center could tuck a few px under the button; the banner's own
padding keeps its text clear). Also note the class of bug: the static safe-area CI checks are
grep-based and can't detect a correctly-classed container that isn't the actual scroll context.
Run `docs/device-smoke-checklist.md` on the S25.

### [platform] Dependabot remediation (2026-07-27) — cleared from 24 alerts down to 1 accepted residual
Superseded the session-287 entry above (that one predates `gh`-less alert access being worked
around via `pnpm audit` + reading GitHub's own push-time advisory summary). Two PRs cleared the
standing threshold item:
- **#803** — bumped `next` (App Router Server Actions DoS/SSRF/cache-confusion advisories) and
  `sharp` (libvips CVEs), plus pnpm overrides for transitive advisories (`js-yaml`, `tar`,
  `postcss`, `brace-expansion`). Deliberately left `next-auth`/`@auth/core` out — auth/session
  changes need their own sign-off gate per CLAUDE.md, filed separately rather than riding in on a
  routine dependency bump. `pnpm audit` count: 24 (3 critical/13 high/8 moderate) → 11 (3
  critical/4 high/2 moderate); the remaining `pnpm audit` count is a different accounting than
  GitHub's own dependency-graph scan (see below), and does not by itself mean 11 GHSA alerts.
- **next-auth bump to `beta.32`** — separate PR fixing the auth-check-fail-open CVE, run through
  the auth-change confirmation gate rather than folded into #803.
- **Residual, accepted, documented (not silently dropped):** two `sharp` copies below 0.35.0
  remain out of our direct control — one bundled inside `next@15.5.22` itself (Next pins its own
  `sharp` for the Image Optimization API; overriding it risks breaking Next's image pipeline in
  ways untested upstream, so this waits for Next's own bump) and one inside `@capacitor/assets`'s
  dev-only CLI (never invoked at runtime, never exposed to external input). GitHub's own scan
  reports this residual as **1 high** alert as of this write-up (confirmed via the advisory link
  GitHub prints on every push to `main`, since this sandbox has no `gh` CLI/Dependabot-alerts API
  access). **Next implementer session:** no action needed below the ≥5 high/critical threshold —
  re-check when `next` bumps its bundled `sharp` past 0.35.0, or opportunistically if touching
  `@capacitor/assets`.

### [app-shell][platform] Home-day-timeline reads server-only (R3 SYNC-R3, session 287) — known limitation, documented exception
`components/home-day-timeline.tsx` renders today's Home timeline (workouts, food, mood,
activity, supplements — all individually local-first domains) from `/api/day-timeline` only. It
merges several already-local-first domains into one cross-domain, server-assembled aggregate,
so it doesn't cleanly fit either "trivially local-first" or the sanctioned cross-session-
aggregate exception list — a real client-side timeline assembler was judged out of scope for the
R3 batch that found it (see the plan's Task 2.2, `docs/superpowers/plans/2026-07-09-r3-offline-first-integrity.md`).
**Effect:** a same-day offline log (food/mood/activity/workout) won't appear on the Home
timeline until the next sync, even though the underlying domain writes are already
local-first-safe and not lost. Documented as a sanctioned exception in CLAUDE.md's Offline-First
read-site status list. Revisit if this becomes a live user-reported pain point.

### [app-shell] Perceived latency / More-tab cache-wipe (v1.133.0, session 277) — shipped, NOT verified on-device
Both structural-latency findings from the 2026-07-11 offline-feel review shipped in full: tab
taps no longer do a network RSC round-trip on revisit (`experimental.staleTimes`, empirically
verified zero-network against `pnpm dev`), app open serves the cached document stale-while-
revalidate instead of blocking network-first, and More's pull-to-sync no longer calls
`invalidateCache('')` (replaced with targeted domain-flag invalidation) or fires the frozen Oura
Cloud sync unconditionally (now BLE-freshness-gated). Review:
`docs/reviews/2026-07-11-offline-feel-performance-review.md`; plan
`docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`. P4 (bundle the shell into the
APK) remains the unqueued Track A endgame bullet. **Superseded (tab-tap half):** the persistent
tab shell (v1.144.0, session 298) took the RSC round-trip off tab switching entirely — warm tab
taps no longer touch the router at all, so the `staleTimes` router-cache behaviour now only
matters for *cold* route entries (app open, deep links, back from `/profile`/`/admin`). **What's
NOT verified:** real cold-open timing and the splash screen (`@capacitor/splash-screen`,
compile-gated only — needs an owner APK rebuild to take effect). See
`docs/device-smoke-checklist.md` §8.

### [platform][app-shell] Offline shell availability (v1.130.0, session 271) — shipped, NOT verified on-device
Fixed in full: the service worker now precaches every `_next/static` asset + an unauthenticated
`/offline` fallback page per build, retains the current + previous cache generation across
deploys instead of wiping, and falls back to the exact cached document or `/offline` (never a raw
Chromium error) on a failed navigation fetch. Verified via a genuine offline repro in-sandbox
(dev server killed outright, not `context.setOffline`) — see session 271's journal entry for the
before/after. **What's NOT verified:** the plan's own stated merge gate is on-device Samsung
WebView airplane-mode behaviour (`docs/device-smoke-checklist.md` §2b) — whether the WebView
actually keeps the SW registered and persists Cache Storage across a real deploy + reopen, real
airplane-mode radio behaviour, and native `@capacitor/network` events. No physical device was
available in this sandbox. Also unverified: the true `next build && next start` production path
(blocked on local Postgres SSL — see session 271's journal for the mechanism); verification ran
on `next dev` instead, which shares the identical SW/cache code path.

### [devices] Oura BLE derived metrics (v1.120.0) — verified with synthetic frames only, not real ring data
The SpO₂ R/PI→% calibration, the 5-min binned HR series (`oura_heartrate` source `ble`), and the
signal-density wear time all shipped verified end-to-end against synthetic frames in the sandbox —
real-ring unknowns remain: whether/how often the Ring 5 emits `0x86 aohr` daytime HR (the daytime
half of the HR chart; sleep HR from IBI is proven), whether the 15-min-bin density yields a
wear-time figure comparable to Oura's (~23 h/day on the owner's old chart), and how close the
gen4-coefficient SpO₂ estimate sits to Oura's reported values. **Owner:** after deploy tap
**Redecode**, then compare the Health cards/charts against pre-re-key Oura app history (backlog
has the validation item). If aohr turns out absent, daytime HR needs the on-demand-measurement
path instead — a follow-up, not a fix to this.

### [devices] Oura direct-BLE: drained history could be silently lost (BLE-1) — FIXED in two layers; needs APK rebuild + Full re-sync
Found in the session-217 review and **confirmed live the same day** (ring delivered
`green_ibi_quality×1520, ibi_and_amplitude×360, spo2_r_pi×103, temp×520, hrv×2`; the DB kept
12 IBI events and zero of three metric types). Fixed in two layers: **v1.117.5** decoupled
the cursors — the persisted resume cursor only advances via `confirmStored(ds)` after the
server 2xx's (durable, but only while the tester screen is mounted to forward frames);
**v1.119.0** makes it set-and-forget — the native service POSTs each drained batch itself
(shared-CookieManager session cookie) and drives `confirmStored` internally, drains auto-run
on connect + hourly, and a failed batch skips all later confirms so the cursor never jumps a
hole. **Owner actions:** (1) rebuild + install the APK (`npx cap sync android && ./gradlew
assembleDebug`, or take the new Android CI job's `app-debug-apk` artifact); (2)
`/admin/oura-ble` → Advanced → **Full re-sync**, then the data-integrity runbook in
`docs/oura-ble-operations.md` §4 — frame counters and stored per-event counts must agree for
every biometric type. Do the re-sync promptly: events the ring's finite buffer has already
overwritten are unrecoverable. Kotlin is compile-gated by the new Android CI job but NOT yet
verified on-device (incl. the native cookie-auth POST path).

### [devices][app-shell] Health screens frozen since the ring re-key (BLE-3/4, found session 217) — mapping SHIPPED v1.118.0; cutover SHIPPED v1.128.1; overnight verification remains
The ring left the Oura ecosystem on 2026-07-07 (Option A re-key), so the Oura Cloud has no
data after that date. **v1.118.0 closed the mapping gap:** `aggregateOuraRawSamples` now
rolls raw BLE samples into `sleep_sessions` (bedtime window, stages, efficiency, sleep
HR/HRV) and `body_metrics` (HRV/RHR/SpO₂ per wake day) automatically after each biometric
ingest — verified live against local Postgres with captured frames. **The Cloud-sync cutover
shipped v1.128.1 (session 268):** app-open/resume and Health-tab auto-syncs skip the frozen
`/api/oura/sync` when BLE data is <48 h fresh (`GET /api/oura-ble/freshness`), and the More-page
ring status reads the BLE timestamp instead of the permanently-empty Cloud sync. **Still open:**
verify against a real overnight drain on-device, `source` provenance and the per-epoch clock
anchor (both remain on the data-mapping item — backlog item 5), and the tester decoded-field
inspector. The 0–100 readiness/sleep/activity scores return with the Phase-5 own-scores work.

### [sleep][devices] Sleep hypnogram/stages over BLE — believed impossible, now corrected; rollup wired but UNCONFIRMED on-device (session 221)
Earlier journal rows (v1.119.4/.5) state the Ring 5 emits "no sleep-phase (0x4b/0x4e/0x5a)
events" and that stages are "null by design". **That was premature** — checked against
`open_oura` (the sanctioned source): the ring **does** emit its own hypnogram over BLE
(`sleep_phase_*` tags carry DEEP/LIGHT/REM/AWAKE; observed on a real Ring 5), and there's no
sleep feature to enable. Same pattern as the REAL_STEPS "can't enable → actually can"
correction. **Shipped this session:** the rollup now assembles `sleep_phase_5_min` + stage
hours from these events (single-tag-longest to avoid triple-counting; dormant until events
arrive), and the Health hypnogram was redesigned into a banded ribbon. **Still open (on-device,
backlog):** we've captured **zero** phase events so far, so a clean *worn-overnight →
next-morning* drain is needed (and a check that the sync cursor isn't skipping the staging span)
before the 30 s-epoch / single-tag / timestamp assumptions can be validated against a real
captured vector. Full analysis: [`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [devices] Oura direct-BLE Phase 2 plugin (v1.116.4, session 216) — RESOLVED on device by v1.117.x; connect-failure history retained below
**Resolution (2026-07-07, v1.117.1–.4):** clean scan → bond → MTU 247 → `auth: SUCCESS` →
READY in ~4.7 s, feature-enable acked, full multi-thousand-event history drain, real
biometrics decoded and stored (HR 82 bpm / temp 37.00 °C) — the go/no-go this row tracked
has passed. The paragraphs below are retained as the diagnostic record of the
connect-reliability rounds (status 133/147/135, Samsung `autoConnect` misbehaviour), which
remain the reference if a new failure signature appears.
The native Kotlin `OuraBle` plugin + `OuraRingService` foreground service + `/admin/oura-ble`
debug screen shipped **compile-gated only in the sandbox**: there is no Android SDK here, so the
gradle build + JUnit tests (`./gradlew :app:testDebugUnitTest`) and **every** on-device BLE
behaviour are unrun. **v1.116.1 fixed a real on-device bug found immediately after merge:** the
debug screen hung forever on "Checking native plugin…" — `getOuraBle()` (`lib/oura-ble/plugin.ts`)
returned Capacitor's `registerPlugin()` Proxy directly from an `async` function; since that Proxy's
`get` trap answers *any* property access (including `then`) with a callable, JS's promise-resolution
algorithm treated it as a thenable and called `plugin.then(...)` as a native method, which the bridge
rejected as unimplemented (`"OuraBle.then() is not implemented on android"`) — an unhandled
rejection that never let the outer promise settle. Fixed by wrapping the plugin in a plain
`{ plugin }` object, matching the pattern the codebase's only other `registerPlugin()` caller
(`gps-tracking.ts`) already used. Diagnosed via real `chrome://inspect` remote-debug console output
against the production APK — this is genuine on-device signal, not sandbox-inferred. Owner
verification still required for everything past this point: (1) confirm the fix loads (JS-only fix,
ships via Railway — no APK rebuild needed, just reopen the app); (2) run the plan's on-device spike
protocol (`docs/superpowers/plans/2026-07-07-oura-ble-phase-2-onphone-spike.md` §"On-device spike
protocol") — first connect + auth (record time-to-connect and the RE8 bonding behaviour), live
accel/battery/SyncTime/Live-HR (the RE10 0-beats retest), history drain, and a 2–3-day persistence
soak (connects/drops, Samsung battery-optimisation kills, wedge-guard). The **reconnection-UX
go/no-go** from that soak gates Phases 3–5 (decoder port → `oura_raw_samples` offline domain → our
own `lib/health/*`). **v1.116.2 addendum:** the owner's first real connect attempt showed the
scan/match logic working (found `Oura Ring 5`, correct mfr-id match, valid RSSI) but hit two
distinct generic Android GATT connect failures — status 133 (from a duplicate-start race, now
guarded) and status 147 (`GATT_CONN_FAIL_ESTABLISH`, mitigated with a connect-settle delay). The
owner then tried a Bluetooth-stack reset (toggle off/on) hypothesizing a wedged radio, but saw the
identical failure on the *old*, unpatched build — consistent with it being the reproducible code
race, not a stack-level wedge. **v1.116.3 addendum:** after rebuilding with the v1.116.2 fixes, the
race was confirmed genuinely fixed (a single clean scan→connect sequence), but a clean attempt
still hit status 133 ~10s after connecting — a different, well-known flaky spot in Android's BLE
stack unrelated to any app race. Added a bounded same-device connect retry (up to 2 extra attempts)
before falling back to a full re-scan, bumped the settle delay to 500ms, and fixed a genuine
off-by-one in the retry backoff schedule (`scheduleRetry()` was indexing `BACKOFF_MS` after
`consecutiveFailures` was already incremented, so the first retry fired at 10s instead of 5s —
confirmed against the on-device log). **v1.116.4 addendum:** tried switching `connectGatt()` to
`autoConnect=true` (handing connection establishment to Android's background BLE mechanism, the
standard fix for this failure class) with a bounded 15s timeout given the ring's rotating address.
On-device this was **worse, not better**: an instant, deterministic status-135 failure on every
attempt, including after a full Bluetooth toggle and a full phone reboot (ruling out accumulated
stack state) — since `autoConnect=true` is supposed to fail slowly/silently, this pattern points to
Samsung's BLE stack not honouring `autoConnect` the way stock Android does. Reverted back to a
direct connect (`autoConnect=false`) with the same-device retry restored, keeping the connect
timeout as a generic safety net. **These native fixes require an APK rebuild to take effect**
(`npx cap sync android && ./gradlew assembleDebug`) — no successful `auth: SUCCESS` has been
observed yet, so the actual ring auth handshake on-device remains unconfirmed. App-level races,
phone Bluetooth-stack state, Windows PC interference, and autoConnect-vs-direct-connect have all
now been ruled out or tried without success; recommended the owner capture a Bluetooth HCI snoop
log (Developer Options → "Enable Bluetooth HCI snoop log") on the next attempt for real
protocol-level diagnosis rather than continued guessing.

### [cross] Full app overview review (2026-07-06, session 213) — ~90 verified findings pending planning
A nine-dimension audit (caching, offline-sync, performance, UI, security, dates/formulas,
workouts, nutrition, APK/BLE readiness) is written up in
**`docs/reviews/2026-07-06-full-app-overview-review.md`** — every finding verified with
file:line. The findings are grouped into plan batches (R1–R8 + APK/BLE Tracks A/B) and
registered in `docs/implementation-backlog.md` § "Not yet queued" for planning sessions to
pick up. Highest-impact (see the review's executive summary): the
unverified-rowcount/mass-assignment ownership bug class (SEC-1..3/6), workout deletes never
reaching the device local store (SYNC-C1 — deleted sessions resurrect), the
`progress-summary` cachedFetch/cachedFetchToday variant clash (CACHE-F1), the quick-edit
food sheet stale-quantity corruption (NUT-1), `advance()`'s stale closure losing
single-exercise completions (WK-1), and offline food logging of new items failing entirely
(SYNC-O2). Also verified **fixed/clean** during the review: readiness-score TTLs, legacy
`ta_*` seeds, the training-load inline ACWR copy (gone), auth coverage on all 149 routes,
AI-route schema/rate-limit discipline, local migration/reconcile registration (all 26
tables), and poison-pill outbox handling.

### [platform] Dual-path read-fallback divergences (2026-07-06 audit) — deferred, fix-on-touch
Found while planning the APK-canonical-target work
(`docs/superpowers/plans/2026-07-06-apk-canonical-target-implementation.md`); the write-path
drift and two quick read fixes are queued (backlog item 2), these three heavier read-side
duplications are deliberately deferred to fix-on-touch:
- **Strength trend computed twice:** `app/health/health-content.tsx:413-444` re-implements
  per-exercise 1RM/gain% client-side for the device seed while web delegates to
  `/api/strength-trend` — two implementations of the same trend math that can disagree during
  the seed window. Converge on touch (shared lib fn or seed from the same route shape).
- **Exercise history device path stubs `isDeload:false`** and re-derives `rpeDelta`
  (`components/exercise-history-sheet.tsx:31-50`) — server overwrite makes the divergence
  transient, but the deload flag is always wrong until the fetch lands.
- **Nutrition `calsBurnedToday` has two sources:** device sums local activity logs
  (`app/nutrition/nutrition-content.tsx:192`), web reads `/api/body-metadata` — one number,
  two derivations.

### [workouts][heart-rate] Workout HR/UI polish (v1.143.1, session 296) — shipped, NOT verified on-device
- Follow-up to the Live HR rework (below), owner-reported on-device: (1) the workout-phase action bars sat
  flush against the 3-button nav bar. `pb-safe-action-lg` used `max(env, 4rem)`, which let the
  edge-to-edge inset eat the intended clearance (~16px above nav); changed to
  `max(calc(env + 2rem), 4rem)` so the inset is *added* to the gap (web/no-inset look unchanged at
  4rem). **Consistency sweep:** warmup, pre-workout, exercise-summary and done screens were on plain
  `pb-safe-action` (0.75rem floor → button flush against the nav bar on-device) and now all use
  `pb-safe-action-lg` — every full-screen workout action bar clears the nav bar identically. (Bottom
  sheets keep `SheetContent`'s baked inset per the safe-area rules.) (2) The in-workout Live HR card
  now renders in a `compact` variant (44px trace vs 72px) so it no longer squishes the fixed-height
  rest-timer zone; the summary card keeps the full-height chart + set lines. (3) The done-screen HR
  Recovery chart (`hr-recovery-chart.tsx`) now passes its 30s buckets through `rollingMedian` (window
  5) + higher line tension, so the spiky trace reads as a clean recovery curve (display-only — the
  per-set bpm/min recovery numbers come from `hr-analysis`, unchanged).
- **NOT verified on-device:** the safe-area clearance in particular is invisible in the web sandbox
  (insets render as 0), so the nav-bar gap must be checked on the S25 APK. `tsc`/lint/tests green,
  full `pnpm build` clean.

### [heart-rate][workouts] Live HR — rest-only in-workout + full-exercise summary replay (v1.143.1, session 296) — shipped, NOT verified on-device
- Owner-reported (on-device) rework of the session-295 full-exercise chart: (1) during a workout the
  Live HR card now shows **only in the rest phase** (`sinceMs={restStartMs}`) — the set-phase PPG
  reads poorly under grip/motion, so the mid-set trace dropped then ramped in rest and read as
  inaccurate; and only genuinely-live readings feed it (held/stale values no longer fabricate a moving
  line). (2) The **exercise-summary card** now replays the *whole* exercise's HR with dotted per-set
  markers — previously it mounted a fresh chart with no carried-over samples and showed a flat line.
- Mechanism: a shared, non-persisted per-exercise HR trace singleton
  (`lib/live-hr/exercise-trace.ts`) recorded once by the workout orchestrator's 1 Hz tick across
  set+rest; `LiveHrChart` is now a pure reader of it (active card filters to the current rest window,
  summary shows the full trace + set lines). Set boundaries are captured at log time because
  `commitExerciseSummary` clears the store's set-timing arrays the instant the summary opens. Trace
  logic unit-tested (`lib/live-hr/__tests__/exercise-trace.test.ts`, 7 tests).
- **NOT verified on-device:** the live trace, rest-only gating, summary replay, and set-boundary lines
  all require the real Oura BLE stream (`getLiveHrManager().getCurrent()` is null in the web sandbox,
  so both cards only show their empty state). Web smoke: `tsc`/lint/tests green, full `pnpm build`
  clean, `/workout` route compiles and serves. Owner to verify on the S25.

### [app-shell] UB1 deep-link cold-launch redirect (v1.124.9, session 256) — NOT verified on device · needs: android
- The admin-bounce latency fix (Chunk 2) is verified end-to-end on the local dev DB. Chunk 1 —
  the actual reported bug (a deep-link cold-launch with an existing WebView session yanking the
  user back to home mid-navigation) — is APK-only: `Capacitor.isNativePlatform()` is false in the
  web sandbox, so `App.getLaunchUrl()` never returns a deep-link URL and the fixed code path never
  runs there.
- **Needs on-device confirmation:** sign in fresh (first-ever exchange) → lands on home as before.
  Sign in again so the process cold-launches from the deep link with a session already in the
  WebView jar; as soon as home paints, navigate to `/admin`; wait out the exchange → **stay on
  `/admin`** (this is the UB1 repro). Warm re-auth from `/sign-in` still lands on home correctly.

### [platform] R3 offline-first integrity, Chunk 1 local-store surfaces (v1.124.7, session 254) — NOT verified on device · needs: android
- Server-side soft-delete (SYNC-C1) and its ~35 read-site guards are verified end-to-end on the
  local dev DB. Three sub-tasks are APK-only and unverified: the local-store mirror on history
  edit/delete (SYNC-R4, `deleteExerciseLogLocally`/`updateExerciseLogLocally`), Home's body-metric
  tile local-first seed (SYNC-R1, `session-select-content.tsx`), and the `food_items` outbox
  domain's push ordering (SYNC-O2) — `getLocalStore` returns `null` in the web sandbox, so none of
  these can be exercised without the APK.
- **Needs on-device confirmation:** delete a synced workout on-device, force a pull on a second
  device/after clearing app data → it doesn't resurrect; edit a past set offline → the Stats/Health
  list reflects it immediately and survives a restart before sync; go offline, scan/add a
  brand-new food → it logs, appears in the day list, survives restart, and dedups correctly once
  reconnected (no duplicate `food_items` row).

### [workouts] Workout leave-confirmation on Android hardware back button (v1.82.0, session 182) — NOT verified on device · needs: android
- The hardware/gesture back button now checks `isWorkoutActive()` and shows the shared
  `LeaveWorkoutDialog` (previously it bypassed every "leave workout?" guard). Verified via
  Playwright in the web sandbox for the pre-workout back chevron and bottom-nav tabs.
- **Needs on-device confirmation** that a real hardware back-press / edge-swipe mid-workout
  shows the dialog, and "Leave" still triggers `App.minimizeApp()`/`window.history.back()`.

### [cardio] GPS background-location walk detection (v1.80.1, session 181) — NOT verified on device · needs: hardware
- Root cause: `@capacitor-community/background-geolocation`'s `addWatcher` only requests
  foreground location, never `ACCESS_BACKGROUND_LOCATION`, so a backgrounded GPS start is
  silently refused; the error was discarded with no logging/UI. Fixed with a native
  `window.AndroidLocation` bridge, a Profile/More status card, and errors routed into
  `useAutoDetectionStore.detectionError`.
- **Needs on-device confirmation** that the card renders, "Open Settings" opens the right
  screen, the card flips to "Enabled" after granting "Allow all the time", and a real
  backgrounded walk is detected end-to-end.
- **Open question:** Android 12+ may block starting a *new* foreground service from the
  background even with the permission granted — a persistent lightweight foreground service
  may be needed as a follow-up.

**Update 2026-07-11 (session 272), owner-reported:** the open question above is now confirmed
live impact, not theoretical — auto walk/run detection has stopped presenting walks, and the
GPS watcher appears to be the source of a reported phone battery drain. Root cause traced to the
watcher's off-switches (probe timeout, stall) running in WebView timers that Android
throttles/suspends with the screen off while the native GPS foreground service keeps running
underneath — reachable precisely because this section's original fix got "Allow all the time"
granted. Both detected-walk sources are also dead (Oura-Cloud froze at the 2026-07-07 re-key;
background sessions rarely finalize). Fix planned:
`docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md` (**backlog
item 1**) — a timer-independent GPS watchdog, then the ring's walk-specific gate as the GPS
trigger (battery win), then a deferred native pipeline. Until it ships: a persistent "Tracking
your activity" notification while not walking indicates a wedged watcher; force-killing the app
clears it.

### [platform] Offline-sync protocol hardening (Batch A, v1.76.0, session 177) — NOT verified on device · needs: android
- Shipped: mutation-id-based outbox confirms, dead-letter quarantine after 5 attempts +
  `sync-health-card.tsx` retry/discard UI, `applyDelta` pull-clobber guards on every domain,
  server-authoritative `personal_records`, workout-log replay idempotency, `applyDelta` in a
  real transaction, bulk `saveProgram` inserts, and a paginated sync-pull cursor.
- **Not exercisable in the sandbox** (`getLocalStore` returns null there) — verified via unit
  tests + one DB-level replay-idempotency check. **Needs an on-device pass:** local SQLite v13
  migration applies cleanly, a failed mutation quarantines after 5 attempts with working
  Retry/Discard, and a pull no longer reverts a pending offline edit.

### [nutrition] Supplement reminders (v1.50.0) — NOT verified on device · needs: android
- `reconcileSupplementReminders()` on app open/resume; `cancelSupplementReminder()` on toggle-off.
- **Risk — ID collision:** IDs 8500–8699 (200-ID range) hash from `supplementId`; two supplements
  could collide (unlikely with <10 supplements). **Risk — timezone:** `reminderTime` (`"HH:MM"`,
  no tz) compared against local device time; a timezone change fires at the wrong time until the
  next reconcile.

### [workouts] Injury workout warning (v1.50.0) — NOT verified on device · needs: browser
- Amber banner in `active-workout-screen.tsx` when an exercise's muscles overlap an active injury.
- **Risk:** custom exercises with no muscle assignments never trigger it; matching is string
  equality between `injury.muscleName` and `exercise_library.muscle_groups` — casing/naming drift
  (e.g. "Quads" vs "Quadriceps") misses. Verify `MUSCLE_OPTIONS`/`MUSCLE_TO_SLUG`/`muscle_groups`
  all agree.

### [workouts][platform] Workout reminder notifications (v1.45.0) — NOT verified on device · needs: android
- Channel `workout-reminders`, ID 8000. Only fires for weekly/rotation schedule modes (disabled
  for auto-schedule). Cancelled by `cancelWorkoutReminder()` on workout start.

### [workouts] Per-session phase tracking (v1.42.x) — data-quality risk
- Phase counts recompute from `workout_sessions.session_name` via `GROUP BY session_name`.
  Inconsistent historical name casing (`"push"` vs `"Push"`) would split counts and produce wrong
  phase resets. No normalisation migration was written — watch if users report unexpected resets.

### [devices] Oura Ring integration — mostly shipped, expansion pending
- ✅ SpO2 re-auth done (scope fixed `spo2Daily`→`spo2`; user reconnected, `spo2_pct` populates).
- **Data expansion available but unbuilt:** many synced `oura_daily` fields aren't displayed yet
  (sedentary/non-wear time, temperature deviation, stress/recovery, resilience, vascular age,
  VO2 max, ring battery). Full reference in `docs/oura-ring-data-reference.md`.

### [workouts][platform] AI periodization (v1.54.0) — ops dependency
- Tier 5 refinements shipped (accumulation ceiling, deload auto-advance, low-confidence
  explain/confirm); exercise-swap UI dropped. Muscle-group weekly volume targets now auto-seed
  (v1.72.0) so the engine no longer runs unconstrained — a manual *editing* UI is still a
  nice-to-have.
- **v1.104.6:** volume targets now use real per-muscle MEV/MAV/MRV landmarks (not a large/small
  binary), and the time-budget trimmer is volume-aware (cuts the muscle furthest over its MAV
  first, can cross role tiers for a severe outlier). Also fixed a live-reproduced bug where
  Gemini's occasional 0-1 `pct` fraction 502'd the whole prescription.
- **Known gap:** the model can drop a `session_exercise_id` from its response entirely (observed
  live, not fixed) — that exercise silently gets no prescription for the session rather than an
  explicit sets=0/skip signal.
- **Ops note:** requires `GOOGLE_GENERATIVE_AI_API_KEY` in Railway env vars — without it the
  prescribe route 502s (emergency deload still works, it skips AI).

### [cross] Recently resolved (full detail in the session journal)
- ✅ **AI workout prescription "couldn't generate" every session** — client now fires `POST …/prescribe` directly + `?poll=1` made `no-store` (v1.173.2/.4); device-confirmed 2026-07-19.
- ✅ **AI chat "Invalid input" (localDate slash vs dash)** — `chatSchema` regex relaxed to accept both separators (v1.173.2); permanent CLAUDE.md rule added.
- ✅ **Culling Lever 1b (historical decoded backfill)** — device-verified end-to-end on the S25 APK against real prod data (2026-07-15); `body_hex` untouched.
- ✅ **Live HR — DHR on-demand burst** — true-live in-workout HR verified working on-device (v1.122.11, owner-confirmed 2026-07-09).
- ✅ **Home week-strip rest-day hydration mismatch** (found 2026-07-06, session 208) — root-caused
  as `session-select-content.tsx`'s week-strip building "today" from the device's local timezone
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) while the server buckets workout/rest days
  in AEST; the two disagreed whenever they diverged, producing exactly the server-vs-client
  "today"/rest-day mismatch this issue described. Fixed as part of R8 (Dates & Formulas
  Consolidation) by rebuilding the week strip on `todayInTz()`/`startOfWeekInTz()`/
  `todayDayOfWeek()`/`shiftDateStr()` — all server-tz — instead of the device tz.
- ✅ **Local SQLite never opened on-device** — v4's `PRAGMA journal_mode=WAL` inside the upgrade
  transaction; WAL moved post-open (#27) + missing v8 columns (#28). Confirmed on S25 (v1.68.0).
- ✅ **Sleep duration discrepancy** — Oura row authoritative for duration in `mergeByDate` (v1.62.0/.1).
- ✅ **Activity walk detection** — distance/speed/duration filters on Oura + timeline routes (v1.62.0).
- ✅ **AI "Baseline needed" stuck** — "Use prior data →" advances from existing PRs (v1.62.0).
- ✅ **Feedback screenshot size** — route rejects `screenshotData` > 500 KB (v1.56.0).

---

## 📋 What's Left To Do

> **Ready-to-build work is queued in [`docs/implementation-backlog.md`](docs/implementation-backlog.md);
> open uplift ideas are in [`docs/planned_upgrades.md`](docs/planned_upgrades.md).** The list below
> is the residual legacy backlog — mostly ✅/🚫 — plus the device-only verifications that can't be
> exercised in the sandbox.

**Next free Postgres migration number: 167.** (**Corrected 2026-08-02** — 166 was claimed and used
the same day by `166_sleep_sessions_oura_id_user_scope.sql` (#1004). Previously said 166; before
that, "next: 127"
and was 38 migrations stale; on disk through 165 now. Known same-number collisions: 081, 087, 146,
161 — apply order between each pair is ambiguous but independent, per CLAUDE.md's migration-number
rule; do not rename an applied migration. Local SQLite is at **v20**. Claim any new number against
both the directory AND open plan docs before writing a migration — this line drifts fast because
multiple parallel sessions claim numbers; treat it as a hint, verify with `ls lib/data/postgres/migrations/`
before trusting it.)

### 🔴 Security
- ✅ **AI SDK CVE bump done.** `@ai-sdk/google ^3.0.86` (+ `@ai-sdk/openai`, `@ai-sdk/react`,
  `@ai-sdk/provider-utils@4.0.33`), `package.json`/`pnpm-lock.yaml` in sync. No open security items.

### ✅ Local-first reads — operational on-device
The headline goal (every screen paints from local data instantly, then revalidates) works since
session 166's SQLite-open fix. Remaining server-only reads are cross-session aggregates
(`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`), server-computed by
design — they stay on `cachedFetch`.

### 🟡 Derived-score read paths (v1.158.1) — known limitation + prod check
The Readiness/Sleep sparklines (`/api/health/trends`), the Body Battery morning anchor
(`/api/body-battery`), and the Sleep contributor bars (`/api/readiness-score`) now coalesce our own
`oura_daily_derived` scores over the frozen post-re-key Cloud columns (data-efficiency S1/S2/S6, item 3a).
**No backfill** — `oura_daily_derived` only has rows from each persist's start date, so sparklines fill
in from ~2026-07-15 (readiness) / this release (sleep) **forward**; derived `activity_score` stays
Cloud-only-then-null until P-D writes it (the coalesce is already in place for it). **Prod check after
deploy** (the local seed is Cloud-shaped + always fresh, so the frozen-vs-live split can't repro in the
sandbox): open Health → Sleep/Readiness, confirm today-forward sparkline points appear and the
contributor bars render on a BLE night; confirm Body Battery no longer opens at a flat 50.

### 🔵 Device-only (cannot test in the sandbox — requires Samsung Galaxy S25 Ultra)
- [ ] **GPS background-location walk detection** (v1.80.1, APK rebuild): confirm the status card
  renders, "Open Settings" works, the card flips to "Enabled" after "Allow all the time", and a
  real backgrounded walk is detected end-to-end (may be blocked by Android 12+ foreground-service
  restriction — see Known Issues). **Update 2026-07-11:** end-to-end background
  detection is known-broken and owner-reported — the fix is planned as backlog item 1
  (`2026-07-11-ring-triggered-walk-detection-gps-battery.md`); its on-device soak supersedes
  this checklist line.
- [ ] **Android App Links for mobile auth** (APK rebuild): replace the custom
  `trainingai://auth-complete` scheme with a verified `https://…/auth-complete` App Link
  (`android:autoVerify="true"` + `/.well-known/assetlinks.json` with the release-cert SHA-256).
  Defence-in-depth only — the shipped PKCE binding already makes an intercepted token unredeemable.
- [ ] **Offline-sync on-device pass** (Batch A + local-first): v13 migration applies on a fresh
  APK launch; body-weight/supplement/injury writes round-trip through the outbox offline;
  `pullDelta` populates on first open; rest-timer reconciles after suspend mid-rest; a failed
  mutation quarantines after 5 attempts with working Retry/Discard.
- [ ] **Notification verification:** supplement reminder fires at `reminderTime` and cancels on
  toggle-off; workout reminder fires on training days only and cancels on workout start; injury
  amber banner fires when an exercise overlaps an active injury.
- [ ] **Guided interval walk — on-device (v1.158.0):** the config→active→summary flow and the
  server page + save path are dev-verified (authed page 200; a `walk` `activity_log` persisted via
  the web fallback), but the client interaction and the two device-only behaviours are unverified in
  the sandbox. Confirm on the S25: (a) live HR + the fast/slow zone verdict update during the walk
  (sandbox shows "—", no ring); (b) the background interval cues (`lib/walk/walk-cues.ts`) fire with
  sound/vibration at each transition while backgrounded / screen-off (local-notification exact timing
  under Doze can drift a few seconds — acceptable for cues); (c) the walk lands in activity history
  through the local-store path (`getLocalStore` is null on web). Open via Log Activity → Interval walk.
- [ ] **Set-log planned snapshot — native local-store leg** (2026-07-17, migration 126): the
  server + web write paths are dev-DB-verified, but the on-device sync chain (raw SQLite insert,
  `mapSetLog`, `applyDelta`, `RECONCILE_COLUMNS`) runs only on the APK (`getLocalStore` is null in
  the sandbox). Confirm: log a set offline on the S25 → kill/reopen → the set still renders and,
  after reconnecting, the row round-trips with `planned_pct`/`planned_rest_sec` intact through
  `pushMutations` and back via `getSyncDelta`/`applyDelta`; plus a cross-device pull of a web-logged
  set carrying the snapshot. Columns are write-and-store (no UI), so nothing is user-visible.
- [ ] **Run/activity leave-confirmation guard (v1.244.0):** confirm hardware back and bottom-nav
  tab taps mid-run/mid-activity on the S25 show "Leave activity?" and discard on confirm, keep
  recording on cancel — mirrors the already-verified guided-walk/workout equivalents, but this is a
  new call site (`/activity`) never exercised on a real back gesture before.
- 🔄 **Health Connect is no longer dormant** (corrected 2026-08-02). This line used to read "HC is
  dormant… verification items are parked". Q-43 (v1.250.0) made HC a **first-class tier-2 source**:
  it is how every non-Oura user gets sleep, and `saveSleepSession` now stamps provenance through the
  ranked merge. The Tasker ingest route is still the unexercised part. **The HC device check is
  owed** — see the owner checklist in
  [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md);
  nothing in the HC path has ever run against a real provider.

### 🟢 Nice-to-have
- **Body Battery model tuning** (v1.66.0): the charge/drain constants are heuristic. A
  `body_battery_daily` snapshot table (migration 100) records daily end value / min-max /
  charged-drained / RHR-HRmax inputs / observed peak HR / sample count / `model_version`. After
  ~1–2 weeks of data, correlate end-of-day battery vs next-day readiness/HRV, swap `220−age` for
  observed max HR, retune constants, bump `MODEL_VERSION`. Methodology: `docs/body-battery-tuning.md`.
- **Manual per-muscle weekly-volume-target editing UI** in program config (the engine already
  auto-seeds targets — Batch 1 in `planned_upgrades.md`).

---

## 🗂️ Document Map

`projectOverview.md` is the lean index (current status + Known Issues & Risks + What's Left). The
append-only session journal and the batched archives live under `docs/`:

| File | Contents |
|------|----------|
| `docs/overview/known-issues-resolved.md` | **Completed Known Issues** — entries archived out of this file once nothing was still owed (53 moved 2026-08-13). Grep it before concluding something has never been looked at. Striking an issue means *moving* it here — see `CLAUDE.md` Session Wrap-Up step 2 |
| `docs/implementation-backlog.md` | **Upcoming (ready)** — priority-ordered queue; implementers take the top item |
| `docs/planned_upgrades.md` | **Upcoming (ideas)** — open uplift findings, batched by data/structure |
| `docs/overview/uplift-archive.md` | **Completed** — shipped uplift batches split out of `planned_upgrades.md` |
| `docs/overview/entries/` | **Recent journal (uncompacted)** — one file per PR/session (`YYYY-MM-DD-<slug>.md`); read these + the newest history file for "what happened lately". Folded into the batched history by the compaction sweep — see the README there. **Corrected 2026-07-30:** this line said "near-empty (compacted 2026-07-20)" but the directory holds ~179 files from 07-20→07-29 — the compaction sweep is overdue; a future session should run it. |
| `docs/overview/history-2026-07-20.md` | **Completed journal (batched, newest)** — the 2026-07-17 → 2026-07-20 loose entries, compacted 2026-07-20, newest at top |
| `docs/overview/history-2026-07-16.md` | **Completed journal (batched)** — sessions 2026-07-16 → 2026-07-17, newest at top |
| `docs/overview/history-current.md` | Sessions ~287 → 2026-07-16 (closed batch) |
| `docs/overview/history-newer.md` | Sessions ~217–286 (closed batch) |
| `docs/overview/history-newest.md` | Sessions ~209–216 (closed batch) |
| `docs/overview/history-latest.md` | Sessions ~177–209 (closed batch) |
| `docs/overview/history-recent.md` | Sessions ~105–176 + roadmap / version-history tables |
| `docs/overview/history-past.md` | Sessions ~51–104 |
| `docs/overview/history-early.md` | Sessions ~1–50 + legacy architecture appendix |
| `docs/superpowers/plans/archive/` | All completed implementation plans (shipped) — reference |
| `docs/superpowers/specs/archive/` | All completed design specs (shipped) — reference |
| `docs/reviews/` | Full review write-ups that seed backlog items (source material) |
| [`docs/domains/`](docs/domains/README.md) | **Per-pillar entry point — read this first when working in one area.** Eleven indexes (`sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`, `nutrition`, `body`, `devices`, `app-shell`, `platform`), each gathering that pillar's code locations, reference docs, open issues, handoffs and gotchas. Its `README.md` holds the boundary rules and the `[domain]` tag convention used by the Known-Issues headings above and by handoff filenames |

**Reference docs:** `docs/module-map.md` (**what shared module/infrastructure already
exists and where** — read before building any new feature or helper; documents the
no-cron-layer scheduling patterns), `docs/oura-ring-data-reference.md` (Oura v2 field
reference), `docs/device-smoke-checklist.md` (on-device verification steps),
`docs/owner-action-required.md` (**everything left that the sandbox can't do** — owner-run
device/APK/data/decision items, grouped by action type; read when asking "what's left"),
`docs/body-battery-tuning.md` (Body Battery model methodology),
`docs/sleep-system.md` (**sleep reference** — staging pipeline, scoring, what's
reliable vs approximate, tuning discipline, open levers; read before any sleep work),
`docs/public-launch-checklist.md` (**things deliberately deferred because the app is
personal-use-only** — read when asked "what needs fixing before going public").

**Runbooks:** `docs/runbooks/db-backup-restore.md` (manual `pg_dump`/`pg_restore`
against Railway, disaster-recovery walkthrough), `docs/runbooks/account-recovery.md`
(password reset via `scripts/reset-password.js` when locked out of both
credentials and Google OAuth).

**When adding a session note:** write a **new file** in `docs/overview/entries/` named
`YYYY-MM-DD-<branch-slug>.md` — do **not** prepend to a shared `history-*.md` (that shared-line edit
was the most frequent multi-PR merge conflict; per-entry files take it to zero). See
[`docs/overview/entries/README.md`](docs/overview/entries/README.md) for the convention and the
compaction chore. Keep this index to current status, Known Issues & Risks, and What's Left. The
compaction sweep folds loose entries into the newest `history-*.md`, starting a new one when it
approaches ~250 KB and adding it to this table.
