# Session journal — batch folded 2026-09-26

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-08-26-hr-tile-and-activity-pacing"></a>

# 2026-08-26 — what the HR tile should show, and whether a paced Activity score works (TN-17, TN-13 amended)

**Tuning · docs-only.** Four owner follow-ups to the pillar review. Two were measurable and got
measured; one was a reconciliation; one is agreement.
Full working: [`docs/reviews/2026-08-26-hr-tile-and-activity-pacing.md`](../reviews/2026-08-26-hr-tile-and-activity-pacing.md).

## The HR tile — the metric was never the lever

The owner offered two alternatives (average awake resting HR, or a resting-HR comparison) and asked
what could actually be used. Both were tested against `perceived_recovery`:

| | r | n |
|---|---|---|
| waking-rest HR, raw bpm | +0.176 | 51 |
| nightly resting HR, raw bpm | +0.129 | 46 |
| waking-rest HR, **Δ vs baseline** | **+0.291** | 51 |
| nightly resting HR, **Δ vs baseline** | **+0.278** | 43 |

**Baseline-relative roughly doubles either candidate; choosing between them barely moves anything.**
So the defect is showing an absolute bpm at all — 69 means nothing without knowing your usual is 63.
TN-13's recommendation is unchanged and now has a measured reason instead of an assumed one.

**A reconciliation the entry needed.** The pillar review's headline **+0.557** and this **+0.129** are
the same signal measured two ways: the stored `readiness_contributors.restingHeartRate` score against
`perceived_recovery` is **−0.553 (n = 35)**, the sign carried by two scales running opposite ways
(`perceived_recovery` is 1 = fully recovered … 5 = wrecked). **Dropping the 4 `provisional: true`
days — score pinned at the placeholder 50 — is what takes it from −0.395 to −0.553.**

The owner's waking-rest HR is a genuine signal (70 days, 984 samples/day, moving 6.24 bpm/night
against the tile's 0.44) and the better **stress** candidate. It stays out of TN-13 because nothing
in the app computes it — it was derived in SQL for this review.

## Activity pacing — TN-17, and the goals are the problem

The owner's design works mechanically: `body_metrics.steps` is a running daily total, so "steps so
far" is answerable at any hour. **`step_live_windows`, the obvious source, is effectively empty** —
8 rows across 6 days — and would read a flat zero.

**What the measurement adds is the caution.** Median day 4,649 steps; 7,000 reached on **32%** of
days, 10,000 on **15%**. A paced score goes red from mid-morning on most days, where today's lenient
average reads 63–82. **Pacing does not create that — it stops the averaging from hiding it**, which
makes goal calibration (Q-524, three live step goals) load-bearing rather than tidy-up.

## TN-3a shipped and its entry had not noticed

`oura_daytime_stress_buckets` is live (migrations 212/213), **69 rows across three days, ~26
buckets/day**. The back-fill has not happened, so the entry stays queued with a `Keep:` naming it
rather than being struck. **This does not unblock TN-3b** — that and TN-16 are parked on Q-507's
sign, unchanged.

## Verification

`pnpm check:rules` — **Ran 58 of 58 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. The waking-rest HR is derived in SQL here and **is not a
shipped code path**. Every correlation is same-day, single-subject, n = 35–51, and
`perceived_recovery` is a 5-point ordinal treated as continuous. A correlation of 0.29 is weak in
absolute terms — the claim is that baseline-relative is **twice raw**, not that either is strong.

<a id="2026-08-31-four-tiles-at-55"></a>

# 2026-08-31 — "everything is 55": three answers, one defect (TN-18)

**Tuning · docs-only.** Owner screenshot at 06:43 Brisbane — Readiness 55, Heart Rate 55, Sleep 56,
Activity 56, Body Battery 55. *"its jts all in the 55 region."*
Full working: [`docs/reviews/2026-08-31-four-tiles-at-55.md`](../reviews/2026-08-31-four-tiles-at-55.md).

## The clustering is unusual, not a collapse

The three scores normally sit **20 points apart** (mean 20.0, median 19.0, max 65). Only **2 of 35
days** have all three within 3 points, and today is one of them — 2026-08-30 read 73/69/64 and
2026-08-26 read 52/15/80. **Heart Rate's 55 is bpm**, not a score: a coincidence of units, and an
argument for TN-13's baseline-delta format on its own.

## Today's number is correct, and the reason is physiological

Reproduced exactly from the stored contributors and `READINESS_WEIGHTS`: **55.3 → 55**. Against
yesterday's 73, **overnight HRV (53 ms vs 71–72) and resting HR (63.7 vs 59.0) account for 15.8 of
the 18-point drop**. Sleep duration was fine at 7.75 h. Two caveats, both queued: `recoveryIndex`
scored **100** flagged provisional after 22 and 44 the previous days, **lifting** readiness by 5
(Q-509); and `checkin` sits at the placeholder 50 until logged, so the number will move after first
open (TN-9).

## What is permanent: two of the five are not independent

`previousNight.input = 56` **is** the Sleep tile and `activityBalance.input = 56` **is** the Activity
tile — **22% of readiness is the two tiles beside it** (`corr(readiness, sleep)` = +0.656 against
`corr(sleep, activity)` = +0.139). Body Battery's morning anchor *is* the readiness score
(+0.838, n = 47). So the screen reads as more corroboration than it is. Recorded, not filed — the fix
is presentational and belongs with TN-15.

## The defect — TN-18

**TN-6a shipped and works**: `tempLadderTrusted` nulls the deviation, so today carries no temperature
penalty despite a stored 0.519 °C. **The deload banner was never gated** —
`ai-dynamic.ts:184` is still a bare `> TEMP_ALERT_THRESHOLD_C`, and `isTemperatureBaselineCentred`
appears in exactly one file, though TN-6a's entry required all three consumers.

**One frame holds both halves of the broken baseline**: the readiness contributor sees `tempZ` =
0.303 and scores temperature **80/100**, while the banner sees 0.519 °C and recommends a deload. The
z is small **because `temp_baseline_dev_x8` reads 1.714 °C** against a true nightly sd of ~0.14 —
`0.519 / 1.714 = 0.303`, matching the stored input to three decimals. **Q-506's inflated sd and
TN-6's low mean, failing in opposite directions, visible at once.** The banner is the surface behind
the owner's original *"its often triggering deload days"*, so the protection landed on the path they
never read.

## Verification

`pnpm check:rules` — **Ran 62 of 62 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. **The ladder and banner were not executed** — the claim is
that the gate exists in one file and not the other, plus the owner's screenshot as the observation.

<a id="2026-09-24-device-sweep-3"></a>

# 2026-09-24 — Device sweep 3: the tab-switch blank measured, three new Lane B defects, DV-15 twice more

**Branch:** `device/sweep-3` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, web v1.465.17, APK 1.460.4, **three-button navigation**, owner's account. Plan:
`docs/device-sweep-3-plan.md`. Production was watched every 30 s throughout, with no slow answer.
The admin BLE console stayed closed (DV-13). The phone showed 🔴 throughout and 🟢 at the end.

## Answers

| entry | result |
|---|---|
| **RV-128** | Every tab switch (10 of 10) shows **~60–110 ms with neither panel painted**. The outgoing panel hides in the same frame the incoming one activates at opacity 0. What shows through is the `html` colour/wallpaper. The answer now sits on RV-113; RV-128 is closed |
| **RV-129** | Warm visits paint no skeleton on Home, Health or More (9 of 9). **Nutrition paints one every visit** (3 of 3), for 300–460 ms, from `MealPlanSection` when there is no plan. RV-129 is closed and **DV-17** filed |
| **DV-12** | Lead: every tap re-runs a chart.js `update` that re-measures axis labels (the `font` setter, 7–48 ms per tap) |
| **BF-22** | Narrowed: 40 plain tab visits leak nothing (listeners 1,804 → 1,804) |
| **RV-125** | Every reader of a food write refetched. After the weigh-in, `weights-summary` and `health-trends` were fetched only once. Attribution to name a component is still owed |
| **DV-8** | Unchanged: the set row is still pending against an empty outbox; its session resolves locally |

## Checks

- **Passed and removed:** BF-95 (edge-strip swipe opens the tray; tab and day unchanged), BF-161 (the
  builder's rows and 651 kcal total match the sources; its Known-Issues row is archived), OR-118
  (one-line rows).
- **Passed, entry kept:**
  - BF-12: a saved meal's row appears in 271 ms and stays.
  - BF-49: the workout row goes back to Home in one press; the food row is untested.
  - BF-147: the admin rows and the sweep sheet look right; the S3 half is still owed.
  - Q-300: the card renders, but its data source wasn't isolated.
- **Failed:** **BF-61**. An immediate tap after the swipe raises no confirmation (2 of 2). After that
  swallowed tap, the next rightward swipe moves Nutrition to **Yesterday** (2 of 2).
- **Q-305 look:** the rows are red with no word beside them (colour-only state), while the body map
  above is all green.

## New entries

- **DV-16:** "Leave workout? Your workout is in progress" after the day's workout is done (2 of 2,
  after a restart). The persisted state says `mode: done`, so the cause is not established. Pressed
  *Stay* both times.
- **DV-17:** the meal-plan skeleton on every Nutrition visit.
- **DV-18:** the admin "AI style reference" image is broken.
- **DV-15:** reproduced twice more, now 3 in about 9 deletes. A traced delete shows a
  `GET food-logs` racing the push, which is a likely mechanism; still to be proven.

## Writes (all undone)

Lite Cheese logged 3×, Protein Granola 1× (saved meal), all deleted: the server list for the day is
empty and every local row is tombstoned. Weigh-in at today's own 69.8 kg (manual-sourced now). The
meal builder was cancelled with nothing saved (still 19 saved meals).

## Harness

- `rawSwipeThenTap` added: a guarded swipe and tap in one shell call.
- Runbook: token rAF samplers, recorder `t` is relative, scope reads to the active panel, and never
  press *Leave* on the workout dialog.

## Not exercised

Gesture navigation and insets, reduce-motion, TalkBack, the light theme, the admin BLE console, and
RV-114/RV-115.

<a id="2026-09-25-review-sweep-62-dv-design-capture"></a>

**Follow-up (2026-09-26, `review/sweep-62b-dv-design-start-here`):** the owner asked whether DV had
been given enough to produce effective results. The honest answer was "not quite". Part D was right
about *what* to measure, but it left four things for DV to work out mid-sitting:
- whether the image channel works at all;
- which screens come first, for a pass bigger than one sitting;
- the harness calls. A script `focus()` does not raise the Android keyboard, and
  `synthesizeScrollGesture` is unproven there. `rawTap`/`rawSwipe` are what work.
- what counts as design-token "drift".

A "Start here" section now covers all four: prove the channel with one image, work tiers of the
daily screens first, keep to about 60 labelled images, and measure drift against the `@theme`
tokens.

<a id="2026-09-25-rv102-dead-chart-tokens-and-shadow"></a>

# 2026-09-25 — RV-102: the two halves that change nothing, and the one that is the owner's

**Branch:** `lane-b/rv102-dead-chart-tokens-and-shadow` · **Lane:** Implementation B

RV-102 bundled three things: five dead theme tokens, a duplicated colour table, and a merge of three
chart palettes into one. The first two are invisible defect fixes and shipped. The third changes
what the owner sees every session, so it went to him as `LB-153`.

## Verified before building, and two claims did not hold

**The contrast figure is exact.** `--chart-1` measures **2.72:1** against `--card`, matching the
entry to the digit, and it is the only one of the five under the 3:1 floor — the others are 7.52,
8.64, 4.50 and 4.94.

**"Declared twice… identical today" — the second half is wrong, and it decided the fix.** The
canonical table carries **13** keys; the picker's private copy had **10**, lacking `streakLeft`,
`streakRight` and `recommendedToday`. So this was never a copy-paste to delete on sight: pointing
the picker at the canonical table is only safe because the picker iterates its own
`CARD_WIDGET_DEFS` rather than the table's keys, which had to be checked. It does, so the three
extra keys cannot leak into the settings UI.

**The prescribed home for the shared palette is Lane A's file.** `packages/shared/src/chart-colors.ts`
already exists — `hr-recovery-chart.tsx` imports `resolveColor` from it — and `packages/shared/**`
belongs to Lane A by the path rule. RV-102 assigned the whole entry to Lane B.

## What shipped

Five `--chart-*` tokens gone from both palettes, plus five unused `@theme` aliases. Dead confirmed
by a tracked-files grep across `.ts`/`.tsx`/`.css` — the first attempt at that grep hit `.next/`
build output and returned a wall of minified CSS, which is a good reminder that "grep found it" and
"the source uses it" are different claims. Deleted rather than re-tuned, per the entry's own
preference not to leave a dead alternative; reversal is five lines.

`CARD_DEFAULT_COLORS` is one table, now typed `Record<CardWidgetKey | "streakLeft" | "streakRight" |
"recommendedToday", string>`. That is stronger than what either copy had: adding a widget key now
fails **at the table** instead of arriving at a call site as `undefined`. Mutation-checked — dropping
`collectionWidget` produces `TS2741` at `constants.ts` itself. The `CardWidgetKey` import is
type-only on purpose: a value import would close a real runtime cycle, because `home-prefs` reaches
back to this file through `home-card-widget`.

`app/__tests__/rv102-one-card-colour-table.test.ts` pins all three properties. It excludes itself
from its own scan in JS rather than in git — `git ls-files a b -- '*.ts'` unions pathspecs instead of
filtering, and this file names both of the things it bans. Control-run: all three assertions fail
against `origin/main`.

## What went to the owner

`LB-153`, `Lane: O`, ungated. The three "series 1" colours really are different — `#22c55e`,
`#f97316`, `#f59e0b` — but the case that matters is the workout screen, where set 1 is amber and set
2 is green **by index**, so the colour reads as a verdict on the set. Nothing is broken; which
palette to standardise on is a preference, and merging it would change three surfaces he looks at
daily. The brief carries the recommendation, what he would actually see change, three alternatives
with what each is better at, and the reversal cost (one constant).

**Not exercised:** nothing was opened on the S25 or in a browser — but neither shipped change alters
a pixel, which is why no device check is owed and RV-102 leaves the queue outright rather than
staying with a `Keep:`.

<a id="2026-09-25-rv122-retry-all"></a>

# 2026-09-25 — RV-122: the sync-failure card can clear itself, and the fix the entry asked for would not have

**Branch:** `lane-b/rv122-retry-all` · **Lane:** Implementation B

## The entry's prescription was wrong, and that is the useful part

RV-122 said: the More tab's sync-failure card lists failed mutations with a per-item retry, while
*"the global **Sync now** that usually clears them is one tap deeper at `/more/data`"*, and the fix
is to render that button on the card.

Reading the code rather than the entry, three things:

- **"Sync now" does not push.** `DataSyncPanel.handleSyncNow` calls `pullDelta(userId, true)`, and
  `pullDelta` contains no `pushMutations`. It is a download. It could never have cleared an outbox
  failure.
- **The More tab's pull-to-sync gesture does push** (`more-content.tsx:118`), so the entry's mental
  model was probably built from that, not from the button it named.
- **Even a push is not enough.** A dead-lettered row stays dead until `retryFailedMutation` resets
  `status` from `'failed'` to `'pending'` (`sqlite-backend.ts:3192`); the push skips it otherwise.

So the per-item Retry genuinely was the only thing that could clear this card — which is exactly the
complaint — and promoting "Sync now" would have shipped a button that looks like it resolves the
card and silently does nothing.

## What shipped instead

**"Retry all N"** on the card: reset every failed row, then **one** `pushMutations` for the batch.
Same one-button scope the entry asked for, and it reduces pushes rather than adding them — N taps of
per-item Retry sent N pushes.

Details worth keeping:

- Guarded with `useGuardedAction` (from RV-178, merged earlier today), which is also the entry's
  *"do not double-fire"* note answered for the in-card case.
- Every button on the card disables while the batch runs. The per-row `disabled={busyId === m.id}`
  left the *other* rows tappable mid-batch.
- Not offered when there is exactly one failure, where it would duplicate the Retry directly above
  it.
- The toast distinguishes all-cleared, partial, and none-cleared, because a batch can half-succeed and
  "Synced" over three remaining failures is a lie.

## LB-151, filed rather than fixed

The entry's "do not double-fire against `handlePullSync`" note turned out to describe a gap in the
engine, not the card: **`pushMutations` has no in-flight guard at all** — only `push5xxUntil`, a
server-error backoff — and eleven call sites can reach it, two of them on the More tab at once.

What I did **not** establish is whether a double drain double-*writes*. The push endpoint shows no
dedup on a mutation id, but the per-domain handlers may be upserts, which would make this wasteful
rather than wrong. That is the read that sizes it, and it is Lane A's file. Filed with the
measurement and the open question stated separately, so nobody reads the first as settling the
second.

## Verification

`components/__tests__/rv122-retry-all.test.ts` — 6 tests. Two of them pin the *premise* rather than
the fix (that "Sync now" still does not push, and that `retryFailedMutation` is still what revives a
row), so if either ever changes the correction gets revisited instead of silently rotting.
**Control-run: 4 of the 6 fail against the unmodified card**; the two premise tests pass either way,
by design.

Not exercised: the device, and the card itself. Reproducing it needs a genuinely dead-lettered
mutation in the local store, which the web sandbox has no native SQLite for — `getLocalStore`
returns null there. What is proven is the batch's shape, not that it drains a real outbox.

<a id="2026-09-25-rv168-session-exercise-catalogue-fk"></a>

# RV-168 — the catalogue join key that every program save emptied

**Branch:** `fix/session-exercise-catalogue-fk` · **Lane A** · `[workouts][platform]`

## What was wrong

Migration 099 added `session_exercises.exercise_id`, called it *"the join key"* in its own header
comment, and backfilled it from `exercise_library` by name. Nothing kept it filled. `saveProgram`
expresses a program edit as a delete of the session's exercise rows followed by a re-insert, and
the re-insert never carried the column — so every save reset it to NULL for every exercise in
every session it touched.

The only writer left was the Coach swap, which sets the FK when it replaces an exercise. That is
exactly the distribution review sweep 57 found in production: the active program **Bankai at 0 of
25**, the others at 1 of 25, 2 of 25 and 1 of 17, and only "Main" — last saved 06-28, before the
Coach existed in its current form — at 20 of 20.

**Nothing is broken today**, and the entry said so. Programs resolve exercises by name, and
`exercise_logs.exercise_id` is 100% filled with 0 mismatches. This is Q-474's trap rather than a
live fault: a column documented as the join key, empty in practice, so the first thing that ever
joins on it returns nothing and looks like a data problem.

## The choice: populate, not mark dead

The entry offered both — fill it in `saveProgram`, or mark it dead the way `unusedProgramSessionId`
was. Populating, for three reasons:

1. **Marking it dead is the bigger, riskier diff.** The Coach maintains this FK deliberately:
   `captureBefore` stores it so `undo` can restore it, with a comment recording the 2026-08-09 bug
   where an undo restored only the display name and left `exercise_id` pointing at the replacement.
   Killing the column means deleting that, and ends in a `DROP COLUMN` migration — the owner's call,
   not a lane's.
2. **The FK is strictly more robust than the name.** `exercise_library.name` is unique but mutable;
   a rename silently orphans every name-matched row, and a filled FK survives it. The library even
   plans for this — `merged_into` exists precisely so "historical `exercise_id` FKs stay valid".
3. **It makes a documented invariant true** instead of leaving a second thing to remember.

Reversal cost either way is one lookup in one function.

## What shipped

`saveProgram` resolves the FK for the rows it inserts, in **one batched query** over the distinct
exercise names rather than a round trip per row — a program save inserts ~25 of them. The
resolution is migration 099's, unchanged: exact, case-sensitive match on the library's unique name,
NULL when there is no match.

Two subtleties worth recording rather than rediscovering:

- **`exerciseId` means two different things three lines apart.** The name destructured from
  `sessionsWithIds` is the row's **own primary key**; the `exerciseId:` column being written is the
  **catalogue FK**. Both are in the same object literal. A comment now says so at the site.
- **A merged-away catalogue row still matches, and that is deliberate.** `merged_into` is not
  filtered here, because neither `resolveExerciseId` nor the Coach's own lookup filters it. Adding
  the filter in this one place would give the app two different answers to "which row does this
  name mean". If merge-following is wanted it belongs in a shared resolver, changed everywhere at
  once.

## Verification

`lib/data/postgres/__tests__/save-program-exercise-fk.test.ts`, 5 cases: a name in the library
links; two names link to their own rows rather than the first found; a name the library lacks stays
NULL; matching is case-sensitive; and — the one that pins the actual regression — **the FK is still
there after a re-save**, which is the delete + re-insert path. A first save filling the column
proves nothing if the next save empties it.

Mutation pass, all against the real local Postgres:

| mutation | killed |
|---|---|
| drop the `exerciseId:` assignment (the original bug) | 4 of 5 |
| match case-insensitively instead of 099's exact match | 1 of 5 — exactly the case-sensitivity case |
| link every exercise to the first library row found | 3 of 5 |
| **control:** drop the `new Set` dedupe from the name list | **0 — survived, as intended** |

A first attempt at the case-insensitive mutation failed all 5, which meant it had errored rather
than changed behaviour; re-run as `inArray(sql\`lower(name)\`, …)` it kills the one case it should.
A sixth test asserting the batch (counting `pool.query` calls) was **written and then deleted** —
`saveProgram` runs in a transaction, so its queries go through `client.query` and the probe could
never have failed.

**Exercised through the real route, not just the slice.** Four Playwright specs that drive program
edits — `get-ready-timer`, `session-delete-confirm`, `same-named-sessions-one-day`,
`rv81-one-exercise-datalist` — were run against the dev server through the harness's real
sign-in, 6 passed. Reading the database afterwards: **8 of 9 live rows linked, 0 FKs pointing at a
row whose name differs from `exercise_name`.** The one NULL is `Bicep Curl`, which genuinely has no
`exercise_library` row — a correct NULL rather than a miss. That is the end-to-end confirmation the
unit tests cannot give, since they call `saveProgram` directly.

Gates: `tsc --noEmit` clean · `typecheck:tests` none above baseline · lint 0 errors ·
**Ran 78 of 78 Custom Rules steps** · the 8 program/coach test files that touch this path, 148
passed · **full suite 1058 files / 9838 tests passed, 5 files and 87 tests skipped**.

## Not exercised

Server-side only. `session_exercises.exercise_id` is **not** in the device mirror — neither the
local SQLite table nor the pull delta carries it — so there is no local-store change, no schema
version bump and nothing for the device to verify. No user-visible behaviour changes, so no version
or changelog bump.

Named explicitly, per the failure-surface rule: the **APK was not run** (nothing reaches it — the
column never leaves the server); the **Coach swap was not driven by hand**, only by its own
148-test surface, which is green; and the e2e run is the **web** build, where `getLocalStore`
returns null, so it says nothing about the device branch. None of those are paths this change can
reach, which is why they were not chased.

## Left open

**LA-143** (`Gate: owner`): the rows saved *before* this fix are still NULL and fill in on their own
the next time each program is saved. A one-statement backfill — migration 099's own `UPDATE`,
`WHERE exercise_id IS NULL` so it cannot overwrite a Coach-set value — would do it at once. It is
recommended and it is not in this PR for one reason only: it writes production rows.

<a id="2026-09-25-rv177-date-validity-group"></a>

# RV-177 (date group) — a date-shaped string that is not a day

**Branch:** `fix/rv177-date-validity` · **Lane A** · `[platform]`

Four of RV-177's nine gaps, shipped together because they are one rule. The other five stay on the
entry with a `Keep:`; each wants its own verification, and a half-checked rate-limit or ownership
change is exactly what this repo's rules exist to prevent.

## The rule, and why the regex was not it

`CLAUDE.md` names two separate guards and they are easy to conflate — I conflated them mid-way
through this and had to back out. The `^\d{4}[-/]\d{2}[-/]\d{2}$` regex on a route schema guards the
**shape**; `normalizeDateParam`/`isCalendarDate` guard **validity**. All four routes already had the
regex, so `2026-02-31` — a real month, a plausible day — passed the gate and reached date arithmetic
or the `date` column, and came back as a bodiless 500 with an `error_events` row. That is Q-496's
shape: a client error recorded as a server fault.

## What shipped

- `ai/health-insight` and `food-logging-complete` take `normalizeDateParamIso` in the handler and
  answer **400**.
- `activity-logs` and `fitness-tests` get `.refine(isCalendarDate, …)` in their **shared**
  validators — the pattern `sync/mutation-schema.ts` already uses. Those validators are shared with
  `pushMutations` on purpose, so this closes the outbox path in the same change rather than leaving
  a device able to write a day that does not exist.

## Two things the entry had wrong, and one is the interesting half

**The slash case is not a validation gap — the right answer is to accept it.** The entry read
health-insight's missing slash conversion as another thing to reject. It is the opposite: the schema
permits `2026/09/10` *deliberately*, because that is what the client's `localDateString()` emits, and
the handler then built `new Date('2026/09/10T00:00:00.000Z')` — Invalid for a perfectly real day. So
the fix converts it. A test asserting 400 for the slash form was written, **failed against the fixed
route**, and was corrected; the passing version asserts it is neither 400 nor 500.

**The line numbers were stale.** `activity-logs:38` and `fitness-tests:38` are inside `POST`, and
neither route has a `date` query param at all — their dates arrive through the shared body
validators, which is why the fix landed there rather than in the routes.

## Verification

Six cases added to `app/api/__tests__/rv55-56-route-input-500s.test.ts`, which already owned this
class. 20 pass.

| mutation | killed |
|---|---|
| health-insight back to the raw date | 3 of 20 |
| food-logging-complete back to replace-only | 3 of 20 |
| drop `.refine` from `ActivityLogBody` | 1 of 20 |
| drop `.refine` from `FitnessTestCreateBody` | 1 of 20 |
| **control:** reword the refine's message string | **0 — survived, as intended** |

**The mutation pass caught a bad test of mine, which is the reason to run it.** The first validator
case asserted `safeParse(...).success === false` — true if the body fails for *any* reason. Dropping
the refine left it **green**. That is the same "right for the wrong reason" trap this very file
records against an earlier case. It now asserts the issue is on the `date` path specifically, and
the re-run kills both refine mutations.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Server-side validation only — no schema change, no migration, no local-store change, no device path.
No user-visible behaviour beyond a 400 replacing a 500 on input the app does not send, so no version
or changelog bump. The routes were not driven by hand on `pnpm dev`; the added cases invoke each
route's real `POST` handler directly against the dev database, which is the same path.

## Left open (on the entry, not here)

The **general form is larger than these four and is deliberately not smuggled in**: the shape regex
is repeated in **20+ files** while `isCalendarDate` guards about five of them. That wants its own
sweep entry. RV-177's remaining five groups keep their `Keep:` — of them, only the dead
`logExerciseWithId`/`logSets` pair and `createFoodItem`'s unscoped read-back have been re-verified.

<a id="2026-09-25-rv177-input-500s"></a>

# RV-177 — five routes that turned client input into a server fault, and the entry closes

**Branch:** `fix/rv177-input-500s` · **Lane A** · `[platform][devices][nutrition]`

RV-177's last two groups. **The entry is now removed from the queue**; the one thing in it that was
never filed — the general form of the date gap — became **LA-145**.

## Everything here was measured before it was fixed

Every claim in the entry was re-verified by calling the real handlers against the local dev
database, not by reading. Three of the five turned out to be worse than written, and two were
partly stale:

| probe | measured |
|---|---|
| `sync-health`, `2026-99-99` among two good days | **the whole batch throws — neither good day written** |
| `sync-health`, `{"date":"9999-12-30","weightKg":499}` | **200, row written** |
| `body-metadata`, `localDate:"3026-08-18"` | **200, year-3026 row written** |
| `body-metadata`, `localDate:"2026-02-31"` | throws out of the route — bodiless 500 |
| `calendar-data?year=abc` | throws `RangeError: Invalid time value` |
| `oura/hr-sync`, `workoutSessionId:"not-a-uuid"` **and** `5` | driver 22P02 → 500 |
| `nutrition/food-logs`, non-uuid ids | driver 22P02 → 500 |

The batch result is the one that matters. `sync-health` carries a written policy — per-record
rejections, never a 400 for the batch, "the poison-pill class, G-2" — and `date` was the one field
that policy did not cover. So the route was already defending against exactly this and losing the
flush anyway.

The entry's framing of the two id sites as *unguarded* was stale: BF-39 had added type guards. What
was missing is narrower and still live — a type guard stops a non-string, not `"not-a-uuid"`.

## What shipped

`ingestDayRejection` (`packages/shared/src/validation/ingest-clock.ts`), beside `resolveIngestDate`.
The sibling reconciles a day it means to keep; this one answers whether keeping it is possible, so a
batch route can refuse one record.

**Two choices in it are load-bearing and easy to get backwards:**

- **No past bound.** `SYNC_DAYS_COLD` is 30, so a first install backfills a month. Reusing
  `resolveIngestDate`'s 7-day window here would have clamped three weeks of real days onto
  `today-7` and merged them — far worse than the defect. An old day is history; only a far-future
  one captures reads that no later write can outrank.
- **One day of future tolerance, not zero.** The client buckets by *its* local date and the server
  reads today from the session timezone. They legitimately disagree around local midnight, and a
  zero tolerance would discard the steps of the hour the user is actually awake for.

**One of the five claims was simply wrong, and the existing test is what said so.** RV-177 listed
`calendar-data` as validating its params *before* authenticating, as a fault. It is deliberate:
`home-aggregate-routes.test.ts` pins the order with the reason, which is that an out-of-range
request must answer the same whether or not the caller is signed in, so the route cannot be used to
probe whether a session is still valid. Reversing it would have created the oracle, not closed one.
The order is unchanged and now carries that reasoning in the route; only the NaN guard shipped.
**That is the fourth RV-177 claim to be stale or backwards** — after the slash-date one, the stale
line numbers, and the two id sites described as unguarded when BF-39 had already typed them.

`sync-health` filters all three arrays — and `exerciseSessions` is filtered *before* its range
lookup, because that query is keyed on the batch's first and last date, so an unusable day poisons
the read as well as the write. `body-metadata` answers 400. `calendar-data` authenticates first and
rejects a non-integer year. `food-logs` and `hr-sync` take `isUuid`, whose own docstring already
described this failure.

## Verification

69 tests across four files, including controls that a 30-day backfill and tomorrow both still
write, and that `calendar-data` still answers 200 across its whole accepted range.

| mutation | killed |
|---|---|
| `calendar-data` loses the NaN guard | 3 of 69 |
| `hr-sync` back to a truthiness check | 2 |
| the day guard stops checking the calendar day | 2 |
| the day guard stops checking the future | 5 |
| future tolerance 1 → 0 | 3 |
| a 7-day past bound added | 2 |
| `body-metadata` loses its day guard | 2 |
| `food-logs` loses the uuid loop | 2 |
| `sync-health` stops filtering `dailyMetrics` | 2 |
| auth moved ahead of the range check | 2 |
| **control:** inline the `latest` temporary | **0 — survived, as intended** |

**The pass found a real redundancy, and the fix is smaller for it.** A `.refine(isCalendarDate)` was
added to `BodyMetadataPostSchema` as well as the handler guard, and dropping it killed **nothing** —
the handler already rejects `2026-02-31`. Two guards for one property is two places to keep in step,
so the refine was reverted rather than explained away as a control.

**One overlap worth knowing before trusting a test here.** `'2026-99-99' > '2026-09-26'` as a
*string*, so the future check catches that value by accident and the calendar check looks
unnecessary against it. The dedicated check is pinned by `2026-02-31`, which sorts *below* today.
A test using only `2026-99-99` would have proved less than it appears to.

**The full suite caught two things the four new files did not**, which is the second time in two
PRs that the pre-existing tests were the ones holding the line. The auth-ordering revert above was
one. The other: `hr-sync`'s own tests drove the route with `workoutSessionId: 'ws-1'`, so the uuid
guard 400ed six of them. The fixture was the unrealistic part — the column is `uuid` — but the
first fix was a blanket replace of `'ws-1'`, which silently changed an *unrelated* set-backfill
expectation whose ids come from a `sessions(n)` helper. The targeted replacement leaves that one
alone. The guard also keeps `Missing workoutSessionId` as its own branch, because that file pins
"you did not send one" and "that is not an id" as distinguishable answers.

Gates (real exit codes): `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 · pointers 0 ·
doc-size 0 · full suite green.

## Not exercised

Server-side only — no migration, no local-store change, no device path, no APK. The Health Connect
aggregator itself was not run: the batch behaviour is exercised by calling the route with the shapes
the aggregator produces, not by a real sync. `body-metadata`'s two POST clients were read (both send
`todayInTz(tz)`) rather than driven, which is what makes a 400 on a future day safe rather than a
lost weigh-in.

<a id="2026-09-25-rv177-ownership-and-dead-code"></a>

# RV-177 — a food item that was not yours, and two methods nothing called

**Branch:** `fix/rv177-ownership-dead-code` · **Lane A** · `[platform][nutrition][workouts]`

Two more of RV-177's nine gaps. Four remain, and none of them is re-verified — the entry's `Keep:`
says so, because three of its claims have now turned out stale or backwards.

## The read that was not scoped

`createFoodItem`'s id-bearing branch exists to make an outbox retry idempotent: the device mints the
id before the push, so a re-push conflicts and the row is read back instead of inserted. It read it
back **by id alone**.

So if the supplied id belonged to somebody else, the insert no-opped and their food item — name,
brand, macros — was returned to the caller, for the cost of guessing a uuid. CLAUDE.md's write-path
ownership rule (c) names exactly this: a client-supplied row id in an upsert must be
ownership-verified. `food_items` has a `user_id`, so the check is direct rather than a join.

**Scoped, not blanket-refused, and the distinction is the whole design.** A 409 on every conflict
would break the idempotent retry this branch exists for, and on the push path a 4xx is a poison pill
the outbox quarantines — it would cost a real food log to close a latent read. So the read is scoped
on `userId`, the caller's own row still comes back, and only a foreign id is refused.

## The two dead methods, and the thing I had wrong about them

`logExerciseWithId` and `logSets` had no production caller and — re-verified — no place on the
`WorkoutRepository` interface, so deleting them was contained.

**My own note on the entry said deleting their tests lost no coverage. That was wrong.** `logSets`
collapsed duplicates on `set_number`; the live path a completed workout actually calls,
`logExerciseAndSets`, collapses on `set.id`. Different conflict target — and the live one had **no
direct test at all**. Deleting the two cases would have left the real key uncovered while the dead
key had been pinned for months.

So the coverage moved rather than went: one case now drives `logExerciseAndSets` with a repeated set
id and asserts the batch survives, last write wins, and the returned ids match the stored rows.
Removing that collapse now fails it — which was the point of checking.

## Verification

| mutation | killed |
|---|---|
| drop the `userId` scope from the read-back (the original bug) | the cross-user case |
| refuse every conflict, breaking the idempotent retry | the retry control |
| remove `collapseOnConflict` from the live `logExerciseAndSets` | the new live-path case |
| **control:** reword the refusal message | **0 — survived, as intended** |

`create-food-item-id-ownership.test.ts` is new (2 cases, one of them the retry control);
`batch-upsert-duplicate-collapse.test.ts` keeps its 6 untouched cases and swaps the 2 dead ones for
the live-path case, 7 in all.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Server-side only — no schema change, no migration, no local-store change, no device path. The
ownership fix NARROWS access and adds no new auth surface, which is why it is not in the
confirm-first carve-out; the carve-out is for changes that could weaken security, and this is the
safer direction. No user-visible behaviour on any path the app actually takes, so no version or
changelog bump.

One first-draft failure worth recording: the new test's fixture omitted `food_items.source`, which
is `NOT NULL` with no default, and failed as a 23502 rather than as the assertion. The schema, not
the type, is the authority for what a fixture needs.
