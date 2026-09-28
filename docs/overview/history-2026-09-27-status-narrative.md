# Session narrative — everything `Current Status` accumulated up to 2026-09-27

**This file is a RELOCATION, not a rewrite.** Every paragraph below was moved whole out of
`projectOverview.md`'s `## 🔖 Current Status` section on 2026-09-27 (OR-197). Nothing was edited,
summarised or dropped, so a claim that reads as current here may since have been superseded —
**date it against the journal before trusting it.**

## Why it moved

`Current Status` had become a reverse-chronological changelog living inside the file every agent
session reads before it can start. Measured the day of the move: **`projectOverview.md` was 309 KB,
of which this narrative was 292 KB — 94%.** With seven standing roles each paying that read at
session start, it was the single largest fixed cost in the system, and none of it was *status* —
it was history, which is what `docs/overview/entries/` and the batched `history-*.md` files are for.

## What it holds, measured

**281 paragraphs.** **152** end in a `Detail:` pointer to a journal entry that still exists, so for
those this is a second copy and the journal is authoritative. **129 carry no pointer at all**, and
for those this file is the only record — which is why the block was moved intact rather than
curated. Deleting the duplicated half is a later, cheaper job that can happen in here, where it
costs no session anything.

## One known-stale pointer

`LB-158`'s paragraph cites `docs/overview/history-2026-09-27-folded-2.md` (folded there from `entries/2026-09-26-lb158-local-barcode.md`), which the
journal-fold sweep has since folded into `docs/overview/history-2026-09-27-folded-2.md`. The fold
does not rewrite `Detail:` pointers, and they are bare paths in backticks rather than markdown
links, so `check-doc-links` cannot see them. Filed as `OR-198`.

---
**Three Sleep contributors rendered their own key, and the class had shipped twice before (RV-217, v1.477.0).** Of the Sleep score's ten rows, seven carried a label and a chevron and three showed `hrv`, `hr`, `schedule` in lowercase with nothing to tap. The fall-through causing it is correct and stays — `CONTRIBUTOR_KEYS` translates the model's keys into Oura's vocabulary, and Oura's `daily_sleep` set is exactly the seven that are mapped, so the app's own three pass through by design. What was missing is a label and a guide entry for what comes out. **The sibling sweep found the same defect one step along:** readiness's `checkin` has a label (RV-201) and no guide, so it was the one row there that read correctly and did nothing when tapped. Both fixed. The test **derives** the key set by running the model rather than listing it — a list is what let the third occurrence happen — and carries a vacuity guard so it cannot quietly stop testing. ⚠️ **Nothing was rendered**: `labelFor`/`guideFor` are pure and covered by test, but the Sleep list itself was not opened. The entry's third item, uneven row spacing that "looks like empty rows", is a layout question a screenshot cannot settle and is filed as **LA-157** (Lane B). Detail: `docs/overview/history-2026-09-28-folded-1.md#2026-09-27-rv217-contributor-labels`.

**A best streak below the current one, because the two were counting different things (RV-216, v1.476.0).** Home said a 111-day streak and More said the best was 49. Both functions were called `computeStreak` and neither was arithmetically wrong: Home counts **calendar days** (`count += 1 + consecutiveRest`), achievements counted **sessions** (`streak++` per dated entry). Replayed against the owner's real 103 trained days: **111 days against 83 sessions at the same gap**, and the 49 was the session count at BF-122a's rotation allowance of 1. One shared `computeDayStreak` in `packages/shared/src/workout/day-streak.ts` now serves `/api/achievements` and `/api/friends/leaderboard`, counting days — which is what the card ("STREAK … days"), the four achievements ("7-day", "30-day") and the banner already promised. **The rest gap is a floor, not a replacement:** `streakRestGapFor` is `max(2, maxCompliantRestGapFor(schedule))`, because a flat 2 would have regressed BF-122a, whose Mon+Tue user has a legitimate five-day hole. The achievements file's function is renamed `computeEntryStreak` and still serves food, sleep and calorie streaks, which correctly count entries. ⚠️ **This raises his best streak from 49 to 111 and awards "Iron Will" (60-day)** — the intended change, stated plainly because it is a number he reads. ⚠️ **Home still holds its own identical copy**; the swap is `LA-156` (Lane B), and until then a *weekly* user sees Home under-report, since Home cannot read the schedule. Detail: `docs/overview/history-2026-09-28-folded-1.md#2026-09-27-rv216-one-streak-formula`.

**The Workout Review stopped calling a model, and the recap turned out to be broken rather than unused (RV-204, v1.475.0).** The review's `generateObject` call is gone: `reconcileReview` already clamped every number, refused unsafe drops, back-filled omissions and recomputed the totals, so what survived the model was the *choice* — and that choice is already made deterministically on every prescription by the same trim ordering. Running it here is what makes a review and a prescription agree instead of proposing contradicting shapes. **The second half is the finding.** The entry priced both routes as unused ("neither ran in 30 days"); over 60 days both are at zero, but the recap fires **automatically** on the done screen, and against **43 workouts completed 2026-07-30 → 2026-09-25** it has stored **4** rows ever, the last on **2026-07-23**, with nothing in `error_events`. It is never being called — a fault, not disuse — so RV-204 ② is parked behind **LA-155** rather than built into a screen that may not be reached. The mutation pass also deleted a branch this work had written: a trim-before-drop guard that could not change any answer, because `dropToBudget` already is trim-then-drop. Detail: `docs/overview/history-2026-09-27-folded-3.md#2026-09-26-rv204-rules-workout-review`.

**The barcode column existed everywhere and held nothing (LB-158, v1.474.0).** `food_items.barcode`
had a column, a Zod schema, a server read mapper, a route that passes it through and a push branch
that Q-131 fixed *specifically* so an offline save would keep it — and production held **341 food
items with zero barcodes, 42 of them `source: 'barcode'`**, because no client ever set the field.
The entry was filed as a mirroring problem ("the server has it, the device does not"), which is
true about the device and wrong about the cause: mirroring would have mirrored nulls. The code now
travels on `NutritionScanResult` / `NewFoodItem` / `NewFoodEntry`, the device holds it at local
SQLite **v41**, and one shared `lookupBarcode(code, userId)` asks the user's saved foods before the
network — so a re-scan of a tin you already have resolves with no signal. That closes **RV-203 ②**,
which was blocked on this. The local upsert **COALESCEs** that one column: a code is known only at
the scan, so `excluded` winning would erase it the next time the food is logged from Recent.
⚠️ **The library-first read is unexercised end to end** — `getLocalStore` is null in the sandbox, so
the local hit is covered by unit tests and a mutation, never by a device. Open Food Facts is also
unreachable from the container, so the route's echo of the code is proved by its test rather than a
live scan. Detail: `docs/overview/history-2026-09-27-folded-2.md` (folded there from `entries/2026-09-26-lb158-local-barcode.md`).

**The weekly recap stopped calling a model, and became a cacheable GET (RV-201 ②, v1.471.0).**
`/api/weekly-digest` is now `GET`-only — every number it reports was already computed before the
model was ever reached, so `buildWeeklyDigestText` writes the sentences from the same
`WeeklyDigestMetrics`. The method is the change that matters: `cachedFetch` caches only GETs, so as
a POST the week page's charts had no stored copy and the screen fell to its error state offline.
Home's banner and `/health/week` now share one `weekly-digest:<week>` entry, cleared by four write
groups; the cached row, the rate limit and the degrade path went with the model. **Three defects
came out of the work rather than the entry:** the banner's own `ta_weekly_recap_v1_` entry was a
second cache nothing invalidated; a hook cannot be skipped, so moving the fetch into one would have
made a *dismissed* banner fetch on every Home mount; and the recap said "first week of data"
whenever the prior week logged no tonnage, so a deload read as no history. ⚠️ **The offline
*navigation* is not demonstrated** — it needs the service worker, which `pnpm dev` does not run, so
it is owed a device check. Detail: `docs/overview/history-2026-09-27-folded-3.md#2026-09-26-rv201-weekly-digest-offline`.

**Four sync confirm arms could never mark a pushed row synced (DV-5).** `pushMutations` confirms a
drained mutation by re-reading the row through the **UI-facing getter**, and every one of those
getters filters `deleted_at IS NULL` — so a DELETE's row is never found, the `if (rec)` guard does
nothing, and the outbox entry is dropped anyway. The tombstone stays `pending` forever, which makes
it immune to `applyDelta` (which only overwrites `synced` rows) and unreclaimable by the local prune
(which only deletes `synced` rows). Device Verification measured **33 such `food_logs` rows on the
S25 against an empty outbox**. The sibling sweep found three more: `injuries` and `supplement_logs`
on their delete paths, and **`plan_meal_answers`, which had no confirm arm at all** — so every
answer, not only a delete, was stuck from its first write, and that table's `applyDelta` upsert
gates *each column* on `sync_status='synced'`. Fixed with three keyed marks that read nothing back.
⚠️ **The pass test is on-device only** (empty outbox, zero pending rows) and has not been run — the
sandbox has no local SQLite. **DV-5's other half — one `set_logs` row pending since 2026-09-19 whose
`exercise_logs.workout_session_id` is not in the local `workout_sessions` table — is NOT explained
by this fix** (`workout_log` confirms with a keyed `UPDATE`, not a read-back) and is carved out as
**DV-8**, `Gate: device`.

**Score bands now use the theme tokens, and the thing guarding them failed silently (RV-99, half).**
`scoreBand()` returned raw `#22c55e`/`#f59e0b`/`#ef4444` while `recovery-band.ts` and
`body-battery-band.ts` returned tokens for the identical concept — in dark those are different
colours, not shades (green `rgb(34,197,94)` vs `rgb(86,238,102)`). It now returns
`SCORE_BAND_COLOR`. **The entry warned about Chart.js canvas and `resolveColor()`; all eleven
consumers are DOM or SVG, so none was needed.** The real blocker was **`accentCardStyle`**, which
sliced the hex to parse it and returned a bare muted background — no gradient, no border, no error —
for anything not starting with `#`, so the HRV-baseline card would have lost its tint silently. It
has a `color-mix` path now; the hex branch is untouched on purpose (≈30 cards render through it and
`rgba()` ≠ `color-mix(in oklch)`), and `transparent` keeps its bail. ⚠ **Half of RV-99 only** — the
hex triad is **183 occurrences across 68 files**, not the entry's "173 across ~25", and four of
those modules (`rarity-colors`, `hr-zones`, `macro-colors`, `home-prefs`) are identity colours that
must keep their hex. ⚠ **Not seen rendered** — every assertion is on a returned string; no card was
viewed in a browser or on device.
**An unknown key on the check-in route is a 400 that names it, not a silent strip (LA-128).**
`Body` was `.extend()`-built and never `.strict()`, so a sheet posting a field whose server half had
not landed got **201 and wrote nothing** — the failure LB-124 was filed over rather than attempted,
and the one that would have burned TN-58's pass test. **Checked before flipping it: no current
client sends an unknown key** (morning sheet 13, evening review 9, all known; the retired
`motivation`/`restingSoreness`/`wakeMood` are still in the schema and sent as null on purpose).
**⛔ The outbox stays LENIENT deliberately — do not "fix" the mismatch.** It never touches the
route's `Body`; it is `adapter.ts` parsing the two shared schemas non-strictly, and stricting them
would reject a queued check-in outright rather than surface a mistake, turning a partial save into
no save. That path is already gated by the local SQLite column list (LB-124 needed a migration),
which the POST path is not. Reasoning is written beside both. Driven over HTTP on `pnpm dev`, and
the pre-fix 201-writes-nothing was **observed**, not assumed. No user-visible change.
**A test file under `app/` was buying the 34-minute browser suite, and a plain `git fetch` was
producing PRs CI never ran (2026-09-23).** Two independent CI/tooling findings from one session.
**E2E's path gate now drops `__tests__/` the way it already drops `app/api/**`** — a vitest file is
not loaded by any browser, and PR #1405 touched exactly one of them and bought **four** full runs,
reaching all-six-green on the fourth and still failing to merge because `main` moved each time.
⛔ **The expensive one: this sandbox's git proxy returns a SHALLOW pack on every `git fetch origin
main`**, grafting the tip as a root, so `git merge origin/main` fails with *"refusing to merge
unrelated histories"* and the resulting tree reads as conflicted to GitHub — **and a conflicted PR
is never given a workflow run**, which presents as `total_count: 0` forever while every other branch
builds fine. Four PRs with sound diffs died that way (#1426, #1428, #1430, #1435). The rule, the two
cheap discriminators and the `--unshallow` remedy are in CLAUDE.md's Git Workflow section; the
decisive test is `update_pull_request_branch`, which merges server-side and so distinguishes a real
conflict from a reporting lag. Also filed: **LA-129** (generate the `.size` baselines in CI — the
answer owner decision item 5 named and left unfiled) and **OR-132** (the five dead PRs, which need
the owner's authorisation to close).


**The fetch-once ratchet could only see `[]`, so two of sweep 53's freshness findings were invisible
to it (RV-105).** ⛔ **The entry claims four; two survive checking** — RV-106 and RV-109 are this
shape, while RV-104 and RV-107 are `nutrition-content.tsx:318`'s `useCallback` shape
(`}, [fetchMountData, userId]`, no `cachedFetch` in the effect body), which the script excludes on
purpose: counting it is what inflated its baseline by 11 of 25 in the first version. `check-fetch-once-effects.js` gated on an empty dep array; inside the
persistent tab shell `[userId]`, `[tz]` and `[today]` never change either, so those effects re-run
never. **The entry's open question is answered by a scan rather than by hand: widening takes the
tracked population from 11 to 25 across 20 files** — a re-baseline, not a tweak. **⛔ The entry
contradicts itself on `trendsProp`** — its diagnosis names it, its narrow fix list omits it; the fix
list is right, because `trendsProp` is a prop the parent resolves from `undefined`, so it genuinely
changes and `oura-section.tsx` already carries a second effect to adopt it. Excluded, with the
reason in the code. ⚠ **This widened the lens, it did not audit what it revealed** — all 14 new
sites predate it and went into the baseline. `sync-provider.tsx` is 4 of them and is the sanctioned
warm pass; `workout-screen` still needs judging by where it MOUNTS. **Two of the fourteen proved the
gate immediately** — Lane B converted `hr-day-card` and `activity-history-card` in #1422 while this
branch was open, and the shrink-only rule failed the check on the first run after the merge and
demanded their rows go; both were `[today]`/`[userId]`, invisible to the old gate, which is why
RV-106 and RV-109 had to be found by hand. Baseline is 23 across 18. All four motivating findings
(RV-104/106/107/109) have since shipped. Mutation-checked in both directions, six cases.

**A training phase was painted in the state colours (RV-100, v1.465.5).** `PHASE_COLORS` had
`realisation` — the PEAK-output phase — as `text-red-500`, the app's failure colour, and `deload` as
`text-green-500` while Home's banner paints a deload *recommendation* amber or red. **Both are live,
which the entry asked to establish before sizing the work:** the active program is `ai_dynamic` and
production carries 2 sessions in each of those phases. The five phases now use a cool ramp, leaving
green/amber/red for state. **The entry's suggested source was wrong** — `SESSION_PALETTE` is indexed
by session position and contains green and red itself, so borrowing it would have re-randomised the
collision. Home's banner also had a third amber of its own; it takes `--accent-amber` now, and the
hex baseline drops 3 → 2.

**Four more date labels moved onto the shared formatter (LB-126, v1.465.4).** LB-125 (#1404, Lane A)
gave `formatDateDisplay` the `weekday`, `weekday-date` and `weekday-date-long` styles; these are the
call sites RV-91 closed with as *"noted, not filed"*. Output is byte-identical — checked before the
swap, not after. **The fifth site that entry named is not one:** `calendar-widget` renders a MONTH
and YEAR, which the helper cannot take, and the test asserts it stays as it is. **An unpredicted
consequence:** all four were `REVIEWED_BENIGN` rows in `check-timezone-rendering.js`, and routing
them through the helper means they no longer call `toLocale*String` at all — the gate failed until
their rows were deleted, which is that script's own rule working.

**Opacity-modified text was below AA and the contrast check could not see it (RV-98, v1.465.3).**
`check-contrast.js` validated ten BARE token pairs and had no opacity handling, so everything from
`text-muted-foreground/60` down was unguarded: over `--card`, 70% opacity gives 4.64:1 and passes,
60% gives 3.73, 50% 2.97, 40% 2.34, 30% 1.83 — against 4.5:1 for body text. **45 call sites raised
to 70%**, four exempted with written reasons (an inactive future day, two ring *tracks* where the
class is a fill colour rather than text, a separator glyph). The calendar's `rest` marker went to
**full** opacity rather than the floor: it is `text-[7px]` and the only thing distinguishing a past
rest day from a past untracked one. The check now composites alpha **in gamma-encoded sRGB** —
blending the linear values put 40% at 3.93:1 instead of 2.34:1, and a wrong number in an error
message is worse than no number. **RV-98's own measurements reproduced independently to ±0.01**,
which given this sweep's record with entry claims is worth recording.

**A doc comment was quoted as evidence of what a screen rendered; it was wrong, and so was its
neighbour (LB-125).** `formatDateDisplay`'s header claimed `'short'` gave `Jan 5` and `'long'` gave
`Monday, 5 January`; `en-AU` produces **`15 Sept`** and **`Tuesday 15 September`**. The entry did not
catch that `formatDayShort` directly below made the same two errors against its own example
(`Jul 6` → really **`6 July`**) off a byte-identical option bag — it is now an alias that delegates.
Three `en-AU` properties are pinned in tests because none is guessable: it is day-first,
`month: 'short'` is **four** characters for June/July/Sept so label columns are ragged-width, and it
emits a comma after a **short** weekday but not a long one (`Tue, 15 Sept` vs `Tuesday 15 Sept`) —
which is the likeliest origin of the comma in the old comment. Three weekday styles added.
**The entry's open question is answered rather than deferred:** the style stays device-local and
takes no `tz`, because its input is an already-resolved calendar day, so an explicit `timeZone`
would reintroduce Q-130 on a device ahead of that zone. **Two counts corrected for Lane B (LB-126):**
two sites are a bare `{ weekday: 'short' }`, not three, and `calendar-widget.tsx` is a month-and-year
label built from numbers that the helper cannot take at all — so that entry is four sites, not five.
No user-visible change, so no version bump.


**One weigh-in printed four ways; now one helper decides rounding and spacing (RV-90, v1.465.2).**
`packages/shared/src/format/units.ts` holds `formatKg` / `formatMinutes` / `formatHoursMinutes`, and
pace keeps `formatPace` / `formatPaceValue` in `vdot.ts`. **The entry's "seven sites, five ways"
overstates it** — the tree holds three body-weight renders that genuinely disagreed plus six already
agreeing on `.toFixed(1)`, so most of this was latent drift awaiting a >1dp value from Health Connect
or a hand-log. **The bug that was actually live is the one nobody filed:** every pace formatter split
minutes from seconds *before* rounding, so `[5:59.5, 6:00)` printed the literal **`5:60`** — fixed in
the shared helper by rounding the total first. `formatKg` rounds by exponential shift, not `toFixed`,
which gave `1.00` for `1.005`. **One documented exception:** `hypnogram.tsx` keeps its own `h/m`,
because a chart stage label reads better as `2h` than the helper's padded `2h 00m`. ⚠ **The rendered
output was NOT observed** — the e2e seed user has no weight data, so no kg path was painted in a
browser; unit-tested only, and not device-verified.


**The morning check-in asks a comparative question now (TN-58, v1.465.0).** The absolute 1–5
produced **two distinct values across 96 check-ins**, sd 0.29, none of them touched — a question
with no variance cannot be a target, which is what blocks TN-33. *Better / about the same / worse
than yesterday*, three taps above the two scales, **no default and no pre-selection**: the column
has no default for the same reason, since a neutral stored as an answer is the TN-57 defect under a
new name. **Added rather than replacing the absolute scale**, despite the entry saying "replace" in
one line: `perceivedRecovery` feeds `signals.morningCheckin` and shapes the prescription, so
retiring its control silently changes what the engine receives. ⚠ **A two-week pass test is owed**
— ≥3 distinct values and a touched-rate above zero, or the finding is that self-report is not
available from this owner at all. It is the backlog `Keep:` on TN-58, and **not device-verified**.

**The ACWR number was painted the "High" colour in every band (RV-97, v1.464.9).** The headline was
a hard-coded `#f59e0b`, which is exactly what `acwrBand()` reserves for `high`, while the band WORD
beside it came from the real `interpretation` — so a 1.05 rendered *"✓ Optimal zone"* in warning
amber, directly above body copy calling 0.8–1.3 the green zone. `acwrBandByKey()` had existed for
this caller since it was written. **The entry's one-line fix does not compile:** the route's
`interpretation` is a SIX-key union and that helper takes four, and the card's two guards are
booleans rather than type predicates, so the key is narrowed explicitly and the unreachable arm
inherits the text colour instead of inventing one.


**Home's score row said nothing when it failed to load (RV-85, v1.464.9).** `{readiness && <row>}`
gated the whole row — and with it the illness advisory and the early-deload banner — so a failed
fetch rendered **nothing at all**: no row, no skeleton (`showHomeSkeleton` requires `refreshing`)
and no message, on the owner's most-used screen. `/api/readiness-score` has no null-payload path, so
an absent value there is always a failure rather than "nothing to say". **The helper meant to
prevent this is the one that permitted it**: `fetchWithRetry` exists, by its own header, to stop a
blip *"leaving the readiness/sleep widgets blank until the app is restarted"* — it retries three
times and then gave up silently, landing on exactly that. It now reports exhaustion, and the row's
slot says *"Scores didn't load — pull to refresh."* **The distinction is the feature**: an absent
value means "still trying" until the attempts are spent, so the message cannot appear under a
request that is about to succeed. The retry ladder is unchanged. The helper had **no tests at all**;
it has nine now, and an e2e that fails the route persistently, asserts the slot stays empty partway
through the ladder, and carries a control case — a test that only checked the message appears would
pass against a build that showed it always.

**The comparative check-in now has a column to write to (LB-124, v1.464.8).** TN-58 asks *"is today
better or worse than yesterday?"* instead of an absolute 1-5, because the absolute scale produced
two distinct values in 81 days. The field did not exist anywhere, and the route's `Body` is not
`.strict()`, so a control built first would have posted **201 and stored nothing** — which is why
Lane B filed this rather than attempting it. `day_checkins.vs_yesterday` now exists (migration 280,
`claude_ro` twin 281, local SQLite v40): `better` | `same` | `worse`, **nullable with no default**,
carried by both write paths, all three row mappers, the local store and the pull-delta, and counted
by `dayCheckinHasAnswers` so a check-in whose only answer is this one saves rather than reading as
empty. Text rather than a signed integer because every other scale on this table stores 1 = best …
5 = worst, and a `+1 = better` column would put two polarities in one row. **The compiler found two
sites no test would have**: `food-logging-complete` re-saves the evening row and would have cleared
the answer on every food-log completion, and there are three row mappers rather than two. **What
remains is TN-58's control** — the sheet — and nothing else. `LA-128` records the `.strict()` hazard
that made this entry necessary: LB-124 closed it for one field by making the key known, not for the
class.

**The self-report was never answered, and five readers took the seed as data (TN-57, v1.464.7).**
The morning check-in sheet seeds `perceivedRecovery` and `sleepQualityFeel` from a neutral constant
and records whether the lifter moved each one. Measured on production 2026-09-22 over 97 morning
check-ins: **78 carry a `perceived_recovery` and 0 of them were ever touched** — two distinct values,
standard deviation 0.286 — which is what the owner said unprompted (*"I dont really choose them; I
let it auto select"*). The row was always honest; the readers were not, and the schema had said so
since the columns were added (Q-113). A calibration route was fitting to 78 values nobody gave, a
user-facing correlation was plotting them, the score audit was displaying them, and the periodization
prompt was telling the model the lifter had reported them. All five now resolve through
`answeredMorningScales`, and the write paths store null for an untouched scale. **No migration, no
data write, and the 78 rows are deliberately not backfilled** — the flag already tells them apart.
**Expect the correlations to EMPTY rather than shift**, which is correct and must not be rescued by
relaxing the filter. **Five claims in the entry were wrong**; the load-bearing one is that its
write-path instruction — make an untouched body count as carrying no answers — would have **stopped
the owner's daily check-in reaching the server**, because the sheet sends nothing else that counts
and `pushMutations` rejects such a body as a no-retry poison pill. The Q-465 guard therefore reads
the submitted body and the nulling applies to what is stored.
**Five places a 384px screen cut the wrong thing (`layout-384` — RV-92/93/94/95/96, v1.464.6).**
`truncate` on a **flex container** does nothing — the text becomes an anonymous flex item at
`min-width:auto`, so the exercise name clipped flat and took the green "done today" tick with it,
making a logged exercise read as unlogged. The injury chip was `shrink-0` at 176 of 352px, leaving
the mid-set title ~15 characters. The food diary cut names at 22 against 130 of 337 real items. The
Volume tile wrapped its unit every non-zero week. The done screen cut the `· 3/4 sets` caveat off
the longest names. **All three of the batch's "not established" questions were settled, two against
the entries:** the injury chip does fire on the exercise RV-93 guessed at; `/api/weekly-stats` does
round; and RV-94's secondary line *does* differ between the colliding pair (350 g vs 258 g) but only
at the tail, which truncation removes. ⚠ **Not device-verified** — every fix is a pixel claim at
412px.

**A raw ISO date on two activity screens, and one `Cal` among 155 `kcal` (RV-91, v1.464.5).** The
activity history row and the activity detail sheet printed `2026-09-15` on the line above a
correctly formatted time; both now call `formatDateDisplay`, and the day detail's hand-rolled
long-form date calls it too. **The entry quoted the helper's header comment instead of running the
function** — it says the day detail reads *"Monday, 15 September"*, and that string exists nowhere:
`en-AU` is day-first with no comma, so the real returns are `15 Sept` and `Tuesday 15 September`.
The comment is in `packages/shared`, so it is filed as **LB-125** with the five remaining
hand-rolled option bags, not edited here.

**One stored 1RM printed four different numbers (RV-89, v1.464.4).** A lift stored on the 0.25 grid
at 92.25 read as **92.5** on the ready screen, **~92** in the exercise list, **92.3** in the stats
sheet and on the Strength Trend card, and **92.25** in the exercise summary — in one session. All
of them now call `displayOneRm`. **The ready screen's rounder was `mround125`, the 1.25 kg plate
grid** — a *prescription* rounder, and the one that told the owner to load 82.5 kg onto a pull-up in
BF-127; its import is gone from that file, while the stats sheet's two remaining calls are genuine
prescription weights. **The Strength Trend card held three of the sites, not the one the entry
named** (headline, 90-day low, peak), and both of the entry's open questions are answered in the
negative: the `~` was not a deliberate approximation signal, and no site reads a pre-rounded server
field.

**AI calls are bounded, and the prose routes answer with their own facts when the model fails
(RV-69 + RV-70, v1.464.3).** Four routes — the daily and weekly digests, the health insight and the
workout recap — assemble a complete fact block from the user's logs *before* calling the model, and
threw all of it away on the catch path (502, or 500 for the recap). They now return it with
`degraded: true` and status 200, the shape `running-plan/explain` already used. **Nothing degraded is
stored**: the insight cache keys on a context hash that does not move, so a persisted fallback would
be served ahead of every later attempt, and the three clients that cache are guarded (`cachedFetch`
gained a `shouldCache` predicate — a response can be worth painting and not worth keeping).
Separately, **no AI call carried a wall-clock ceiling** — every route passes `maxRetries: 0`, which
takes the SDK's own timeout handling out of the picture, and nothing replaced it. One **30 s total
budget** now applies at the chokepoint, across the shared retry rather than per attempt, sized
against a slowest-call-ever-recorded of **4,786 ms**. **Four claims in the two entries were wrong and
are corrected in the journal**, the load-bearing one being that the chokepoint wraps a *thunk*, so
the "one-place `abortSignal`" fix the entry described was not possible as written; 17 call sites now
pass the signal, and the deadline also races the attempt so a site that ignores it is still bounded.
**The degraded path has not been seen in production** — the model has not failed since the logging
existed — so it is verified by tests at all four routes, not by observation.
**A failed read is no longer painted as a measured zero (RV-86 + RV-87, v1.464.2).** Home's Streak
card rendered `calendarDays`'s `{}` initial value as "0 sessions this week" with an empty progress
bar, and the Profile tab rendered a row of `?? 0` defaults as a genuine *Level 1 · Novice · 0 XP*
with an all-zero lifetime, **best streak included** — both reached on a first launch after a
reinstall, offline, or any failed fetch past the cache seed. Each screen now carries a gate raised
only by a successful read, and shows "—" until it is. **Two of the entries' own claims were wrong
and the fix went where the defect actually was:** the streak *number* already degraded to "—", and
the rest-day banner comes from `/api/next-session`, not from the streak fetch. Held by e2e specs
that were run against the unfixed components as a control, not only against the fix.

**The streak counted the API's window, not the training (BF-176, v1.457.13).** The owner asked why it
went **90 → 89 on a day he trained**; his real streak is **102 days**, unbroken since 2026-06-08.
`app/api/streak-data/route.ts` sent 90 days of `trainedDays` while the consuming loop walked back
365, and a missing day reads as a **rest day** rather than as missing data — so past day 90 three
lookups broke the streak and the count was pinned to the window edge. **The mechanism is worth
stating because it is counter-intuitive: once the real streak exceeds the window, the number tracks
where the edge lands, not what the lifter did.** It dropped because the edge slid off a rest day onto
a trained one. `STREAK_LOOKBACK_DAYS` (`packages/shared/src/workout/streak-window.ts`) is now shared
by both sides, because they have to agree and nothing made them. **The card may show the old number
until the `streak-data` cache turns over** (`TTL_LONG`, also stamped optimistically on workout
completion).

**And the same defect on the leaderboard, now fixed (LA-117, v1.457.14).** `allTimeStreak` was
computed over a 90-day query bound, so a field promising *all-time* structurally could not exceed 90
against a real 102. The bound is gone — chosen over the cheaper "rename it `recentStreak`" only
after measuring that the unbounded scan is free (`workout_sessions` is **133 rows / 96 kB** across
the whole database, indexed on `(user_id, started_at)`). **`weeklyStreak` on the same route read the
same clipped day list** and was capped at ~14 weeks; the entry named only `allTimeStreak`, and
reading the route rather than the entry is what found the sibling. **The two streak implementations
are still deliberately NOT unified** — `computeStreak` counts *training days* with a rest allowance,
the home loop counts *calendar days spanned* — so `streak-window.ts` now says outright that the
leaderboard does not read `STREAK_LOOKBACK_DAYS`: 365 would cap an all-time field just as 90 did.

**The queue tool called four shipped entries unstarted, and the entry it offered as next was
owner-blocked (LA-120, 2026-09-18).** `keepFromLines` did not match `- **⚠ Keep:`, so TN-49's three
residues and LA-118's one were invisible and those entries kept their original high priority — the
third time `scripts/lib/keep.js` has been narrow in a way nobody noticed until a shipped entry was
offered as buildable. Widened to a **non-word** prefix only, after measuring that 140 of 144 Keep
bullets already matched and all four misses were that one shape; the two documented false positives
(`**Keep the stored field on 1–10**`, prose `The Keep:`) still refuse, and both are asserted.
Separately, **two entries got the gate their own text already implied.** LA-76's `Gate: owner` was
removed in September when the owner settled the deload *rule*, leaving the different question it
actually waits on (does a deload span become first-class stored state?) with nothing marking it.
Q-220 carried a ⚠ written *"so the next implementer does not defer it again silently"* — and three
days later it was offered as next-up and re-derived, because prose cannot reach a tool that reads
fields; its Lever 2 needs a quiet window and a structural decision, both the owner's. Lane A's READY
list went **12 → 9**.

**TN-50 SHIPPED — the check-in no longer answers itself (2026-09-19, v1.459.0).** Nothing is
pre-selected; Save waits for a tap; `readinessToEnergy` is deleted. **A fixed default could not have
worked**, and the reason is the finding: the middle option `ok` scores 72, the only level scoring the
documented NEUTRAL 50 is `low` (unusable as a daily default), and `MoodLog.energyLevel` is
non-nullable — so "unanswered" had to mean *no log*, which already scores 50. Item 3 is discharged as
the documented cutoff in [`docs/domains/readiness/README.md`](../domains/readiness/README.md):
`mood_logs.energy_level` before 2026-09-19 may be auto-filled, after it is an answer. ⚠ **Expect the
readiness line to step down** — 36 of 62 days stored `ok` at 72. Owed: the S25 check (the extra tap
in the morning flow; the revert is one line) and Tuning's re-measure of TN-47's 6.5% `checkin`
figure, which was fitted against auto-filled days.

**TN-50 re-laned to B, and the check-in auto-fill is a +22 bias rather than a neutral one
(2026-09-19).** Its central number re-verified independently against production — **62 days, 45
matching the auto-fill, `pumped` 0** — so the entry is sound. The sharpening: `CHECKIN_ENERGY_SCORE.ok`
is **72** against a documented `NEUTRAL` of **50**, and `readinessToEnergy(null)` returns `ok`, so a
saved-but-unanswered check-in contributes **+22 above neutral** on the 36 of 62 days that stored `ok`
— "default to neutral" will visibly *lower* the readiness line, not leave it flat. It also has **no
Lane A engine half**: both seed sites are in one Lane B file and the entry forbids re-mapping the
scores. Item 3's storage flag is recommended as a **documented cutoff** instead — a flag can only
label rows written after item 1 removes the ambiguity, and never the history that actually needs it.

**LA-110: two candidates tested and refuted, mechanism named, cause still open (2026-09-18).** A
**baseline block** would produce the exact fingerprint — `isBaselinePhase` forces `aiPrescription` to
null and an AMRAP baseline is one set with no pct — but every `session_periodization` row reads
`baseline_complete = true` and none is in a `baseline` phase. **BF-148** lands inside the window and
touches the same flag, but runs the wrong way: it turns that behaviour *on*. What is established is
the path — pct, style and set count all descend from `aiPrescription`, null whenever the stored
`prescription` is absent — and that all five sessions entered `accumulation` 09-09 → 09-12 with
replacements generated 09-13 → 09-16, bracketing the *end* of the window. **09-07 and 09-08 remain
unexplained.** ⛔ `session_periodization` keeps only current state, so the window cannot be
reconstructed by query — this needs a reproduction, not more SQL.

**LA-100 closed, and 40 journal entries folded (2026-09-18).** The entry said the sweep had nowhere
to fold to because the batched history files are era-named; **28 of 32 are dated** and the fold script
has written `history-<date>-folded-N.md` since LA-80, so the convention it asked the owner to choose
was already chosen. Its "BLOCKING" ceiling claim is also stale — that check is advisory now. OR-119
recorded both on 09-17; what was missing was removing the entry, so every lane kept being offered it.
The sweep ran: **80 → 40 entry files**, citations rewritten in four docs, 5 held back because an agent
baton cites them, `check-doc-links` clean on 816. The one real residual — whether the four frozen
era-named files are ever renamed — moved to the entries README, where whoever next touches them will
see it.

**LA-110's missing-prescription window re-measured: five sessions, and the set count is the tell
(2026-09-18).** 09-07 → 09-12 logged **one set per exercise** with no `style_name` and no
`planned_pct`; 09-06 and 09-14 are clean, with **two** sets each. Half the sets missing — not just
null columns — says the exercises were presented with no resolved style at all, since the set count
and the planned fields descend from the same `ex.progressionStyle`. **A null `style_id` is NOT the
signature:** 09-17 is a clean day where all five logs have one. **No cause is recorded**, because
three hypotheses fit and none was tested — the entry has already been filed with a wrong diagnosis
twice, and a third is worse than none.

**The readiness number is ours, and three surfaces credited it to Oura (BF-178, 2026-09-20).** The
value is the app's own ble-derived composite — `oura_daily_derived.readiness_score`, source
`ble-derived`, with the frozen Cloud column a fallback only for pre-re-key days. Home already called
it **"Readiness"**; the explain row, the weekly-digest line and the session-explain **prompt** called
it "Oura readiness". **The prompt line is why this was a bug and not a quibble:** it fed the model
the false provenance, so the generated prose said it too (*"Despite your Oura readiness of 46"*) —
unspottable by reading the UI. Its `'not connected'` fallback became `'no data'` for the same reason.
The field is still `ouraReadiness`, now commented in two places, because the NAME is what taught all
three call sites to write "Oura". Left alone deliberately: `readiness-payload.ts`'s comment, which
correctly describes the real Cloud column — **though that availability branch still reads that frozen
column, which is a separate unexamined question.**

**The equipped title was gated on the catalogue, not on having earned it (RV-61, 2026-09-18).**
`PATCH /api/user/equipped-title` checked only that the id existed in `TITLES`; the unlock filter lives
in the picker sheet, which is the **client's** copy of a rule only the server can hold. A direct PATCH
skipped it and the stored title renders on the friend leaderboard, the friend feed and the public
profile. The route now resolves `unlockedBy` and asks `computeAchievements` — **the** implementation
of unlock state, not a cheaper second one that could disagree — refusing with 403. Clearing a title is
not gated and does not pay for it. **No rate limit added:** `/api/achievements` already runs the same
fifteen queries on every profile paint and carries none, so gating the rarer PATCH alone would be
theatre. Verified first that all 16 `unlockedBy` values resolve to real achievement ids — this fix's
failure mode is locking someone out of a title they earned, not letting one through.

**`Authorization: Bearer` now resolves a session, server side only (Q-1a server half, 2026-09-18).**
A native client on a different origin has no cookie to send, so it presents the same NextAuth session
JWT as a bearer. It is resolved **inside `auth()`** — the wrapper all 222 route files import and none
bypass — so every route gains it with no route change, and `isActive` is enforced at the point
identity is established rather than in the cookie-keyed middleware gate that cannot see a bearer.
**The entry's stated failure mode was half wrong:** a deactivated holder does not reach routes with a
200, because PS-24 already put `isActive === false → null` in that wrapper; the answer is 401. And
`getToken` already reads the header, so this was wiring rather than crypto. **The client half is now
`Gate: owner`** — returning the JWT in the exchange response takes a 30-day credential from httpOnly
into JS, and there is no consumer yet (the APK is same-origin on cookies; Q-1b is deferred).

**Three shared modules whose contract and behaviour had drifted (RV-58/59/60, 2026-09-18 — one PR,
the last sweep-50 batch).** **RV-58** — `equipmentEligible` folded case on the exercise side and
`buildEquipmentSet` on neither, so `equipmentEligible(['Barbell'], buildEquipmentSet(['barbell']))`
was true and its mirror false, and `full_gym` in upper case went unexpanded. Unreachable today (the
one producer emits lowercase, 0 of 156 rows are non-lowercase) but both API schemas take a bare
`z.array(z.string())`. **RV-59** — `summariseSupplementDay` summed across units and labelled the
total by row order, so `1 mg + 2 g` reported `3 mg` **or** `3 g` depending on which row came first.
Converting is impossible in general — `unit` is free text and includes `ml` and "1 scoop" — so a
mixed day now refuses to total, reporting `mixedUnits: true` and no number. **RV-60** — the walk
recommender chose between *"Zone 2 is done"* and *"No Zone 2 target set"* on `zone2 == null`, but
`computeZoneQuota` emits a **row** with `status: 'not-required'` for no-target, so the null branch
never fired and a user with no target was told it was done. No production caller yet, so it is fixed
before the first consumer rather than after.

**The only unbounded route, narrowed and rate-limited — but not floored (RV-63, 2026-09-18).**
`/api/collection` reads all history five ways with no rate limit, and the home card re-fetches it on
every paint (`cachedFetch` revalidates regardless of TTL, Q-262). Two of those reads were full-width
for one field each — **36 columns** of `body_metrics` and **25** of `sleep_sessions`, projected
straight to `.map(x => x.date)`; they are one column wide now, with the `> 0` predicate pushed into
SQL. **The entry's date floor is deliberately NOT taken:** `replayCollection` walks every recorded
day from the beginning, so a floor changes what the ladder reports for anyone with history behind it
— a behaviour change dressed as a performance fix, and the route's own comment already said there is
no window to bound it with. **The rate-limit norm was decided rather than matched:** the entry was
right that the siblings split on nothing (`weekly-muscle-sets` has five repo calls and no limit),
but every other route is windowed and this is the only all-history one — so the rule is *an
unbounded replay gets a limit, a windowed read does not*, at 30/60 s. **Two route tests moved rather
than weakened:** they asserted a low day still spawns a cat, which the route can no longer see, so
that guarantee is now asserted against a real Postgres.

**Two ways a client error became a server fault (RV-55/56, 2026-09-18 — one PR, the sweep-50
route-input batch).** Both are the Q-496 shape: input the route should refuse reaches the driver,
which answers **500 with an empty body** and writes an `error_events` row. **RV-55** — the vial POST
accepted a client-supplied `id` and inserted it unguarded (the parent was ownership-checked, the id
was not), so re-posting another user's vial UUID raised `23505`: an existence oracle plus fault-table
noise, though no cross-user write occurred. The entry left the fix open; reading the callers settled
it — nothing sends `id` (the only client posts three numbers and a date, and the local vial mirror is
read-only with no outbox push), so the field is **dropped** rather than conflict-scoped, which
removes the oracle instead of renaming its status code. **RV-56** — three routes carried the correct
separator regex and no calendar check, so `2026-02-31` 500'd; all three now `.refine(isCalendarDate)`.

**Three cache keys that no write evicted (RV-52/53/54, 2026-09-18 — one PR, the sweep-50 batch).**
`weekly-review-month-window:` was in **zero** invalidation groups while its sibling
`day-review-week-window:` — rendered by the same surface from the same writes — was in three;
`stress-day:` was in zero while `body-battery`, on the same card, was in four; and
`invalidatePrescriptionChanged()` did not clear `collection`, though `/api/collection` computes
`pausedDays` from the deload confirmation that group exists to fan out, and the deload handler calls
only that group. **One claim of mine was wrong and was corrected before it shipped:** the first
comment said the collection ladder "kept decaying across a week", but per Q-262 both readers use
`useCachedValue` without `freshWithinTtl` and neither is seed-only, so `cachedFetchCore` always
revalidates — the real symptom was a briefly-stale first paint. Registered anyway, because an inert
key becomes load-bearing the moment someone adds `freshWithinTtl` to it.

**The soreness-provenance window used the banned ms-offset form, and it is not hygiene (RV-62,
2026-09-18).** `deriveSuggestedSoreMuscles` built its seven-day window as `Date.now() - 7 *
86_400_000` — the exact pattern the Date Arithmetic rule names — shipped in BF-173 that morning and
caught by review sweep 50 the same day. It now anchors at `dateStrMidnightInTz`, keyed on the
**check-in's own `logDate`** rather than on today, and `saveMoodLog` takes the session timezone.
**The entry left open whether the skew can flip a verdict; it can, but only one way.** A session at
the seven-day edge is ~168 h old and `suggestedSoreMuscles` only looks within 48 h, so it can never
be eligible itself — but `computeMuscleRecovery` takes the MEDIAN bout volume as `typical` and
scales `tau` by `latest/typical`, so an old heavy bout entering the window raises a recent bout's
recovery percentage. Pinned: **81 → 92**, flipping suggested to not-suggested. Narrow, real, and
only near the 85 line. The entry's second half shipped too — the check-in write path was selecting
the whole exercise catalogue on every save and now reads the name→muscles map alone.

**Two merged duplicates were being offered in generated programs, and the entry that found the area
pointed the other way (RV-51, 2026-09-18 — no migration).** `listExerciseLibrary` is deliberately
unfiltered, so every **picker** filters `mergedInto` itself; `builder-review.tsx` did,
`generate-program` and `builder-chat` did not. They looked correct only because two of the four
merged rows carry an empty equipment list, which `equipmentEligible` rejects — `Cable Crunch` and
`Straight Arm Pulldown` carry `['cable']` and were being offered beside the canonical rows they were
merged into. **RV-51 reported the opposite**: it found the two *harmless* rows (`Cable Lat Pulldown`,
`Dumbbell Lunges`), read them as real exercises hidden from every program, and prescribed a migration
to label them — which would have un-hidden two duplicates, and whose pass test (*"a full-gym program
can offer both names"*) is the outcome to avoid. Both are merged, to `Cable Pulldown` and `Dumbbell
Lunge`. The `POST /api/exercises` guard the entry suspected is sound: it exempts merge requests from
requiring equipment, which is exactly what those rows are. `equipmentEligible`'s header — which
claimed *"an empty list should not occur"* and is what aimed the review at the wrong target — is
corrected in place.

**A readiness audit was contradicting its own evidence, and an entry was written from it (TN-49,
2026-09-18 — no data write).** Seven `oura_daily_derived` rows read 4–6 points below their own
stored breakdown. The entry prescribed rewriting those seven scores; doing so would have written the
error into production. **The cause:** `rederiveReadinessFromStored` skipped any contributor key
absent from the stored map, dropping its weight from a sum defined to total exactly 1.00. The seven
disagreeing rows are **exactly** the seven storing eight contributors instead of nine, missing
`checkin` (weight 0.10); all 58 nine-key rows reproduce exactly. **The audit then printed "the
stored score IS reproducible from its own stored inputs (42)" against a stored 48** — a
reproducibility claim contradicted by the number in the same sentence — and concluded the inputs had
moved. An absent key now contributes the model's own neutral 50 and is reported as `missing`, and the
audit refuses to claim reproducibility while it is non-empty. **Four of the seven then reproduce
exactly; three keep a 1-point residual that is recorded as unexplained rather than fitted.** Two
owner-gated production writes stay on the entry: back-filling the missing `checkin` key (only the
four reconstructable rows), and back-stamping `model_versions.readiness`, still absent on 40 of 65
rows.

**The muscle-attribution query was four copies; three are now one (LA-118, 2026-09-18 —
unversioned).** `weightedSetsByMuscle` in `periodization.ts` is the single set-counting query;
`getWeeklySetsByMuscleGroup`, `getSetsByMuscleInWindow` and `/api/weekly-muscle-sets` call it. The
two things the copies disagreed about — **which timestamp attributes a set to a day**, and **whether
a previous programme counts** — are parameters now, so a caller states its answer instead of
inheriting whichever copy it started from. **One behaviour change, and it is the defect:**
`weekly-muscle-sets` had no upper bound at all, so a log dated in the future counted toward this week
forever; it has one now. **The date column had no test holding it in either direction** — every
fixture in the repo set `started_at` and `logged_at` to the same instant — so there is one now, a
session started 22:00 yesterday with its sets logged 00:30 today, where the two reads deliberately
disagree. **`muscle-tonnage-trend` is still its own copy**, as LA-118 instructed for a first pass: it
sums tonnage and buckets by week, so folding it in changes the shared function's shape. LA-118 stays
queued for that, and the honest count is two implementations rather than one.

**Sets per muscle over any window, so the balance card can finally be built (LB-111, 2026-09-18 —
engine half, unversioned).** `GET /api/muscle-sets?from=&to=` is new: nothing served this number
before, because every muscle-set route computed the current week server-side and took no parameters.
**LB-111's premise was wrong in the place that decided the shape** — it said `weekly-muscle-sets`
calls `getWeeklySetsByMuscleGroup` and throws its date arguments away; it does not call it at all.
That method scopes to **one programme**, so widening it would have changed what its two real callers
mean, both of which grade a week against *that* programme's targets. The new read counts **across
programme changes**, which is what a balance card's claim is about, and the difference is pinned by a
test running one fixture through both reads: **3 sets against 7**. Checking the premise also found
that the attribution SQL now exists **four times**, disagreeing on date column and programme scope —
filed as **LA-118** rather than fixed here, since the extraction touches three live routes. Nothing
renders it yet; OR-118 (Lane B) is now unblocked. **Shipped 2026-09-20 (v1.460.0):** the
Training list's **Movement Balance** card is its first caller, and `movementPattern()`'s too. It
sat startable and invisible for four days — a `⛔` used for emphasis parks an entry, so Lane B's
READY read 0 across five checks while it waited (**LB-121**, which now carries the measured cost
and two more entries parked the same way, TN-3b and Q-305). The S25 look is owed.

**The only illness band that ever fires now says what moved (TN-45, v1.457.12 — engine half only).**
`watch` has fired **2 days in 72**; `elevated` and `fever` have fired **zero** times, so the illness
banner has never rendered at all. And `watch` is inert twice over — no readiness penalty (deliberate,
"advisory-only") and no UI, so the band is named advisory-only and there is no advisory. Its copy also
named nothing, while `IllnessResult.biomarkers` already carried the per-biomarker `{ z, contribution }`
the source comments call *"the 'why', for the advisory"*. `illnessAdvisory(flag, biomarkers?)` now reads
it: *"Resting HR and HRV are drifting from your baseline — worth keeping an eye on."* Ranked by
**contribution** rather than raw z, capped at two, zero-contribution biomarkers never named, and the
parameter is optional so no existing caller changes. **The wording deliberately implies nothing about
cause** — both real firings were driven by a medication rather than illness (TN-46), so an
infection-flavoured line would have been wrong on 100% of the occasions this feature has ever appeared.
**⚠ NOTHING RENDERS IT YET** — the guard at `components/home/illness-advisory-banner.tsx:15` still
returns `null` for `watch`, and the owner chose a quiet line under the readiness score rather than the
amber banner. Until Lane B ships that line the defect is unchanged from the owner's side, and TN-45
stays queued with a `Keep:` saying so. **Also unexplained:** the other `watch` day, **2026-08-27**,
predates the first dose by eleven days and carries an HRV z of **−4.26** — TN-46's "the cause is now
known" covers 09-16 and cannot cover it.

**Two calorie budgets, two taps apart, are now one (BF-175, v1.457.11).** The card said 1,506 and
the log-food sheet said 1,660 — not a stale cache: the sheet fetched `nutrition_targets.calories`
for itself, the **rest-day floor**, and coloured its bar against it, so a day with 151 kcal left
painted full green. The page resolves the budget once and hands it down. **A cache-key sweep could
not have found the second surface** — the end-of-day review took the same stored row as a *prop*
(with a `?? 2000` fallback under it). ⚠️ **Not device-verified:** the green/orange flip at S25 width.

**The check-in now records which sore ticks were its own suggestions (LB-116, v1.457.10).** BF-173
stopped a suggested tick penalising recovery twice; the sheet already computed that list and never
sent it, so the server fell back to deriving it — which cannot tell a muscle the lifter volunteered
from one it would have suggested anyway, and for a queued offline check-in runs hours later against
a recovery feed that has moved on. **It required one optional field in `MoodFieldsSchema`, a Lane A
path:** that schema has no `.strict()`, so Zod drops unknown keys, and without the edit the value
would have been stripped silently and the fix shipped inert. **An e2e was written and deleted rather
than shipped green** — it passed against unfixed `main`, because the server's fallback makes the
stored column non-null either way, and a vacuous test is worse than none.

**The explain screen called the session-fit score "readiness" (BF-172, v1.457.9).** `overallScore`
is `recovery·w + balance·w + freshness·w` — how well a session fits today — and the ring captioned it
*"Overall readiness for this session"* and graded it on the readiness ladder, so it read **84 HIGH**
in green directly above *Oura readiness 37 · Low* and *strong deload advised*. BF-154's class: a
number correct in its own terms under a caption belonging to the quantity it replaced. The caption
now names fit and the ring prints Strong/Fair/Poor fit, **mapped from `scoreBand` rather than derived
from the score**, so the 70/50 thresholds stay in the one module that owns them. Two of the entry's
instructions were adjusted: "no band word" was not available (the ring is band-coloured, so the word
is what keeps the band off colour-only), and the band could live in `ScoreRing` after all — it is
session-explain's own component with one caller, not the shared thing a bare grep suggests.

**A sore "Back" moved nothing, and `core` never found its recovery (BF-171, v1.457.8).**
`sessionRecoveryScore` compared muscle names with exact lowercased equality on both sides — the only
one of seven soreness/recovery consumers in the repo that matched raw. The check-in offers **Back**
as a pill and the exercise library has no muscle of that name (`lats`, `upper back`, `traps`), so
ticking it moved **every** session score by zero: a wrecked back still got Pull recommended at full
confidence. Separately `computeMuscleRecovery` emits `abs` where an assignment says `core`, and a
missed lookup returns **100**, so a synonym mismatch was indistinguishable from a rested muscle while
the real 86% sat in the same payload. Both sides now go through `normalizeMuscle` /
`moodMuscleMatches`; no synonym list was hand-rolled. **It composes with BF-173 and that was
tested, not assumed** — shipped before it, this would have fed every newly-matched muscle into a live
double count, which is what its `Needs:` was protecting. The entry's production deltas (Legs 59 → 62,
Lower 74 → 77) were **not re-measured**; the fixtures are synthetic, so what is proved is the
behaviour rather than the new numbers on the owner's screen.

**The session picker counted your soreness twice (BF-173, v1.457.7).** `suggestedSoreMuscles`
pre-ticks any muscle trained within 48 h and under 85% recovered — reading the recovery model — and
`sessionRecoveryScore` then read both that feed *and* the resulting tick and clamped the muscle to
`min(pct, 40)`. One fact counted twice, with the second pass overwriting the model's own figure with
a harsher flat one. The owner confirmed the premise rather than it being inferred (*"It auto picked
muscles for me i didnt choose them manually"*), which makes it the normal path, not an edge case.
Measured on his rows: quads 69 → 40, chest 49 → 40, and the flat floor erased the ordering he was
actually asking about — Lower 74/Upper 84 with the double count live, against Lower **85**/Upper 84
with the leg ticks removed. **⚠ That second pair is the pre-BF-171 counterfactual, NOT the shipped
state, and re-measuring after both landed is what makes the difference visible (BugFix, 2026-09-17).**
Against the SHIPPED engine on the same rows, with every tick recorded as a suggestion:
**Upper 91 · Lower 88 · Pull 85 · Legs 76 · Push 59 — Upper still wins.** The double count is gone
and Lower gained 12 points from its removal, but the gap narrowed from 9 to 3 rather than reversing,
because BF-171's normalisation lifts the sore-but-recovering muscles on *both* sides. **So the entry
fixed the defect it described and did not change this particular answer** — Upper wins on merit now,
being half back work at 95% and six days overdue. Do not read "it flipped the pick" as a claim about
the current app. `mood_logs.suggested_sore_muscles` (migration 276, `claude_ro` twin 277,
local SQLite v39) now records where each tick came from, and only lifter-added ticks clamp.
**Provenance is recorded at write time, never re-derived at score time** — re-deriving was the option
the owner weighed and rejected, because it discards the one case the check-in exists for. **Expect
the clamp to go dormant and do not repair it:** with the owner accepting the pre-selection nothing is
lifter-added, which is correct, and the soreness-driven deload is untouched (verified —
`computePerExerciseDeload` never reads the clamp). **The check-in sheet still does not send the list
it displayed** (LB-116), so provenance comes from a server-side derivation that cannot separate a
volunteered muscle from an accepted one when both qualify, and is stale for an offline check-in.
Not device-verified.

**Health Connect was syncing everyone into Brisbane (LB-113, v1.457.6).** `syncHealthConnect` and
`enrichActivityLogs` took the user's timezone as of 2026-09-16 and nothing passed it, so both fell
back to `DEFAULT_TZ` — right for the owner, silently wrong for anyone else, and enough to shift a
day's steps, calories and sleep across a date boundary. The provider now reads `useUserTimezone()`,
which `app/layout.tsx` feeds from the session. **The entry named the wrong second call site:** it
said the provider called both functions, and the un-timezoned `enrichActivityLogs` was in fact
*inside* `syncHealthConnect`, where `tz` was already in scope and being dropped — so fixing the
component alone would have passed the entry's own test while enrichment kept bucketing in Brisbane.
The sync is native-only and cannot run in the harness at all, so it carries `Verify: device`.

**The stress-deload override is unwired, and the notification nobody had noticed went with it
(TN-34, v1.457.1).** A deload was being recommended on **83% of days** off a daily stress figure
that is 57% night buckets and correlates **+0.072** with readiness — a flag that fires four days in
five carries no information. The owner approved unwiring it on 2026-09-10; what the entry did not
say is that `lib/health-alerts.ts` ran the **same condition on the same input** as a **push
notification**, and that a fired stress alert **suppresses the readiness-low alert** — so the
signal-less flag was also masking the real one. Both are unwired; temperature and illness still
override, and the instantaneous `stressCurrent` level still fires, because TN-33 measured real
episode structure in the series and none in the daily aggregate. **The re-wire is still owed** and
waits on TN-33's level-2 test — re-anchored to this user's own distribution, not the 120-minute
constant.

**The week in review is a page now, and BF-5 is closed after both halves (v1.457.0).** `/health/week`
sits beside `/health/day` and draws what the paragraph describes: tonnage day by day, readiness,
sleep, HRV and high-stress minutes each against the week before with the seven daily readings behind
them, personal records, muscle volume, and Q-112e's month-at-a-glance reused rather than rebuilt. The
banner becomes the entry point rather than the content, there is a permanent **Week in review** entry
in Health beside the calendar — the banner is dismissible, so a page reachable only from it is
unreachable for the rest of the week — and the weekly reminder lands on the page instead of Home.
**Two of the plan's own instructions did not survive contact**, both because `/api/weekly-digest`
computes the recap week itself and takes none: the suggested query param would have been a control
the route cannot honour, so the page takes no `?week=` and `reminder-deep-links.test.ts` was
generalised instead — a query-less route must have its own `page.tsx` **and not be a tab href**,
which is the original failure (`/` opens a tab and leaves the user hunting a banner) restated rather
than weakened. The stray trailing `*` was `Response` repairing a finished string as though it were
still streaming; fixed at both finished-string surfaces, left on for the coach, which streams.

**A meal in the diary showed its macros nowhere, and the four e2e tests over that component could
not see it (BF-170, v1.456.23).** `mealFooter` withholds a lone meal's section footer on a premise
written in its own source — *"a group row states its own macros AND calories"* — and the group row
stated only calories, because the P/C/F line sat inside `{open && …}` and collapsed is the default.
So the footer was withheld for a claim that was half true. It is **BF-120's defect with the kinds
swapped**: the owner's screenshot has a meal section showing nothing directly above a loose-food
section showing all three. Fixed at the group, which makes the premise true for every meal group
rather than only a lone one; `mealFooter` untouched. **The coverage lesson is the durable half** —
`diary-nested-meal.spec.ts` had four tests over this component and the one asserting `P 24g` taps
the row open first, so it passed throughout the defect. A fifth case now asserts before any tap and
fails against the unfixed component with `Expected: 1, Received: 0`.

**Three defects either side of finishing a workout, shipped as one PR (BF-169 · BF-168 · BF-167,
v1.456.22) — and two of the three entries recommended a fix that would have broken something.**
The COMPLETED stamp was gated on the exercise **library** arriving, a fetch it has nothing to do
with, so on a slow load the card said "complete" three other ways with no stamp — the owner's *"some
days dont… it may be some specific excercises or how long it takes"*, where both guesses were right
and were one cause. "Leave workout?" could fire on the session-select **tab**, because `/workout` is
both the workout screen (`?session=<id>`) and the tab, and `pathname` drops the query; separately, a
prompt raised legitimately was cleared only by Stay/Leave, so it outlived its screen. And the
intensity toggle read the prescription's phase flag, which an illness- or soreness-driven deload
never sets, so it said *Full — as prescribed* over a session cut to 52% of 1RM. **Both corrections
came from checking the recommendation rather than implementing it:** BF-168's proposed `pathname`
dismissal would not have fired for the case it was filed on (`/workout?session=x` → `/workout` is
the same path), and BF-167's proposed replacement of the phase flag turns BF-8's own e2e guard red —
it seeds `deload: true` with no exercises — so that one shipped as a union instead. **All three are
`Verify: device`**; BF-168's gesture is a Capacitor channel no harness run can fire at all.

**The trainer role has a plan, and the plan's main job is stopping it rebuilding a bug we already
have open (BF-9 — docs only, no code).** `saveProgram` is already parameterised by user id, so a
trainer route is "call the same function with a different id" — which is what makes the feature
cheap and what makes it dangerous. The style-ownership check in front of it is scoped to one user:
aim it at the trainee and a trainer cannot use their own library, aim it at the trainer and you have
a row in one account pointing at a row in another on an `ON DELETE SET NULL` foreign key. That is
**RV-42's exact shape in a second domain, while RV-42's own fix is still unmerged**. The plan's
answer is copy-on-assign. Also corrected: the entry's claim that PR #124 is open and awaiting the
owner is stale — **it merged 2026-08-23**, verified against `main`, so BF-9 has no prerequisite left
and is blocked only on the owner's word to merge.

**The weekly digest returns its numbers now, so the week in review can be drawn rather than
described (BF-5 PR 2a — no version bump, nothing user-visible changed). ⚠️ The prompt this
paragraph freezes no longer exists — RV-201 removed the model on 2026-09-26, and the byte-identical
golden is now over the digest the user reads. The rest of the paragraph still holds.** `/api/weekly-digest`
computed every figure the Home banner talks about, flattened them into the model's prompt and threw
the values away; it now builds `WeeklyDigestMetrics`, formats the prompt **from** that, and returns
it — on the cached path too, which is the one the banner almost always takes. The prompt is
byte-identical, and that was measured rather than claimed: the same fixture run through the old
route and the new one produced identical context blocks, now frozen as a test. Each metric carries a
7-day series because the route was already computing one per day and averaging it away — so the
entry's open "is a daily series in scope" question was never a cost. **The page itself is Lane B's
and is still owed**; BF-5 stays queued and was reclassified to Lane B.

**A generic data-source connector contract now exists, written from the code rather than intent (no
version bump — docs only).** Owner request: a structure so a second user's own ring/strap/phone can
feed the app, prompted by a friend testing on an iPhone with Apple Health rather than Android's
Health Connect. [`docs/data-source-connector-guide.md`](../data-source-connector-guide.md) is the
result — the canonical shape of every data type, which calculation reads what and degrades how
without it, and a metric-by-metric classification of what Oura's ring computes for us versus what
the app computes itself (this matters for portability: the stress/resilience/Body-Battery family
runs on the ring's own per-epoch outputs, not raw sensor waveforms, which lowers the bar for a future
device considerably).
[`docs/sync-health-api-reference.md`](../sync-health-api-reference.md) is the actual JSON contract
for `POST /api/sync-health`, and [`docs/superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md`](../superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md)
is a buildable HealthKit plan mirroring the real Health Connect sync field-by-field. **Six backlog
entries filed, none built yet:** PS-40 (typed connector registry), PS-41 (Health Connect's HR series
never reaches the table Activity Score depends on), PS-42 (illness radar's own formula degrades
gracefully but its caller skips it for non-Oura users), PS-43 (Health Connect's 30-day backfill cap
is an undecided client heuristic), PS-44 (a working rMSSD-from-raw-beats calculator already exists,
wired only to workout summaries — nightly HRV could use it too, pending validation), PS-45 (no
per-user API key for external device integration), PS-46 (the HealthKit connector itself — needs a
real Apple Developer account, hence owner-gated)
([journal](history-2026-09-17-folded-1.md#2026-09-14-generic-datasource-connector)).

**BF-110's blank resume now gets a second look, and the next move is the owner's (no version bump —
instrumentation only).** Sixteen `error_events` samples separate perfectly on viewport height: every
blank resume reports **667**, every rendered one **826**, and 826 is the S25's real CSS viewport.
384×667 is the classic *default* a WebView falls back to before it is told the real size — so the
shape is *"resumed at a fallback viewport and rendered almost nothing into it"*, not *"the renderer
died"*. **What the data could not separate is a viewport genuinely stuck from a measurement taken too
early**, and those point at different files. `handleResume` now logs the viewport again
**500 ms into the same resume**, riding the first row's budget so a reported resume costs two rows
and an unreported one costs none. Next: one blank resume in normal use, then read
`bf110 resume recheck%` — **`stuck` means native, `resized` means render timing.** No fix before that
row exists ([journal](history-2026-09-16-folded-1.md#2026-09-14-bf110-second-viewport-log)).

**BF-100's `touchstart` cause is CONFIRMED in the harness and FIXED; the S25 pass is what is left
(2026-09-19).** Owner, 2026-09-13: *"Checked on more - and still doesnt work"* — its second failure.
Twice before, this entry read as *"shipped, a look is owed"* while the look had already been taken and
failed; it is back under `Verify: device` now only because the device has **never seen this change**,
and its `Keep:` states the reversal condition outright so a third failure cannot hide there.

**What was measured, which is what makes this different from the two earlier passes.** Instrumenting
`addEventListener` and `sessionStorage` on a live `/more` back-navigation: the takeover listeners
attach at 15681 ms and the restore lands at 15863 ms — a **182 ms window with `done` still false and
the listeners live**. Nothing had established the window was non-empty before. Then, with a target
seeded beyond the container's reach so the window widens to the whole of `RESTORE_WINDOW_MS`, the
cancellation reproduces outright against the unfixed hook: **`restored to 0 against a reachable
1019`**. `use-scroll-restoration.ts` took its takeover from **`touchstart`**, and `stop` latches
`done` with no re-arm — so one finger-down abandoned a pending restore permanently. It is now
`touchmove`: still an input event (trap 4 intact), but a finger that never moved has scrolled nothing.

**This reverses *"the fix is deliberately not built — it must not ship on a hypothesis when one tap
decides it"*, and the reason is that it is no longer a hypothesis.** The mechanism is demonstrated,
both directions are pinned by `e2e/bf100-touch-does-not-cancel-pending-restore.spec.ts` (both arms
proven red pre-fix), and the blast radius is the three screens using `PullToSync`. **What is still
unconfirmed is causation on the device** — the harness fires no touch on a back navigation, so it
cannot say whether the S25's gesture delivers one into that window. **The one-tap experiment survives
as the fallback:** if the gesture still lands at the top, come back with a **UI back control** instead
— if that restores, the cause is elsewhere in the gesture path, and this is buildable work again.

**The 2026-09-15 probe's null result is explained and should not be re-run.** Not the element and not
the dispatch site: `page.goBack()` does not resolve until *after* the mount and restore, and arming
the dispatcher earlier does not help either, because the container only matches a selector once it has
mounted — the same instant the restore lands. **The 182 ms window cannot be hit from the test side at
all.** Reading that null as evidence against the hypothesis would have been wrong. (The separate
exact-offset finding from that run — `scroll-restoration.spec.ts` asserting `toBe(before)`, which
cannot tell *cancelled* from *imprecise* — was **fixed 2026-09-17**; both assertions go through
`expectRestoredNear`, a floor at 90% of the saved offset.)

A second owner request found in
the same body had **no entry anywhere** and is now **LB-107**: back on a tab with nothing to pop
should land on Home rather than leave the app
([journal](history-2026-09-17-folded-1.md#2026-09-14-refile-shipped-rv36)).

**`day-review-read-through` was broken in both directions, and only one of them was visible
(LB-105).** Its wrap-up test failed in the sandbox and passed on CI — every section of
`DayReadThrough` self-hides when its domain is empty and the local seed has **nothing at all**
recorded for today, so the dialog was legitimately blank. Its `/health/day` test passed on that same
empty day, which is the half nobody was looking at: the regex matched `^Sleep$` and that screen
renders a **`Sleep` score cell** of its own above the read-through, so the test guarding *"both hosts
render ONE implementation"* would have passed with `DayReadThrough` absent entirely. The label list
was wrong too — the component renders **`Body composition`**, which `^Body$` never matched. The spec
now records an activity for today and removes it, and both halves scope to a
`data-testid="day-read-through"`. Proven rather than assumed: with the seed suppressed, the
`/health/day` test **now fails where it used to pass**. No product behaviour changed
([journal](history-2026-09-17-folded-1.md#2026-09-14-lb105-day-review-seed-independence)).

**The nutrition surface says two things it knew and withheld (LA-102 + TN-28, batched).** LA-102 —
the owner on the anchored budget: *"1350 doesnt count some basic metabolic needs".* He is right; the
ⓘ panel now names the two omissions (thermic effect of food, non-step NEAT) rather than inflating
the base with a multiplier, which is the trade BF-152 already decided. TN-28 — `TdeeAdaptationCard`
writes the calorie goal in one tap and was the **only** surface printing the maintenance figure
without its confidence; it now prints the siblings' exact qualifier.
**A third finding came out of doing them together:** the ⓘ copy existed **twice**, inline in
`energy-card.tsx` and `calorie-balance-bar.tsx`, and had already drifted — the card carried BF-134's
resting-burn paragraph and the bar never got it. Both now render one
`components/nutrition/energy-explainer.tsx`, and `movement-breakdown.test.ts`'s two-file loop is
repointed at it plus a new check that neither host re-states the copy. ⚠️ **Not device-verified**
([journal](history-2026-09-17-folded-1.md#2026-09-14-la102-tn28-nutrition-budget-honesty)).

**The AI card says what skipping Accept costs (BF-156).** Owner: *"what happens if I dont select to
apply the session? Its pretty easy to miss that button."* There are two answers.
`prescriptionDrivesLoad` splits the five phase actions: a pending `stay` or
`transition_recommended` already drives today's loads, so ignoring the button costs only the phase
decision; a pending `deload_recommended`, `session_swap_recommended` or `rest_day_recommended` does
not, so ignoring it trains the base progression style instead of what is on screen. **The card's own
two button blocks split on a DIFFERENT axis**, which the entry did not note and is why the shape of
the buttons was never a usable signal: `transition_recommended` and `deload_recommended` share the
"Move to …" block with opposite load consequences, and `stay` shares "Accept" with
`session_swap_recommended`. One `ConsequenceLine` now reads `prescriptionDrivesLoad` in both blocks
— no second copy of the split — muted on the driving half, bold amber on the opt-in half. ⚠️ **Not
device-verified**, and the owner has a live `session_swap_recommended` to check it against
([journal](history-2026-09-16-folded-1.md#2026-09-14-bf156-accept-consequence)).

**The bodyweight ready screen has a clock again (BF-157).** Owner, on the Pull-Up ready screen with
the session clock at **8:42**: *"The body weight screens have no warmup timer or load time so its
just infinite on this screen."* The three-stage ramp is built from 50/74/92% of the working weight
and is correctly absent at zero load — but the clock was rendered *from* that ladder, so dropping one
dropped the other. **Four cases have no working weight, not one:** bodyweight, an AMRAP baseline,
solo mode, and anything logged at zero; the entry named only the first. All four now render a
`GetReadyProgress` bar running to `transitionSecForEquipment(equipment)` — the same total
`startRestChip` was already counting against, whose comment claimed it was *"the same total the
on-screen ready bar uses"* and was wrong for every one of them. It matters past the screen:
`handleStart` submits the ready-screen elapsed as `prepTimeSec`, so an unbounded ready screen was
measuring whatever distraction occurred and feeding it to the session card's time budget. ⚠️ **Not
device-verified**
([journal](history-2026-09-16-folded-1.md#2026-09-14-bf157-bodyweight-get-ready-clock)).

**Cardio Baselines moved to the Cardio tab (BF-159).** Owner, after having to be told where the
Cooper test lives: *"That section should be moved to cardio hub."* The card sat in the Health tab's
`TRAINING_ORDER` between *Muscle Volume This Week* and *Workout Density*, surrounded by lifting
cards while holding VO₂max and HR recovery — and `/baselines` has **exactly one entrance in the whole
app**, so a card in the wrong list was the entire discoverability story for all three protocols. It
now renders under `HeartProfileCard` and above `ModalityPicker`. **Moved, not duplicated** — the
`TRAINING_ORDER` entry and its `renderTrainingSection` case are both gone, since two entrances to one
destination is how a stale copy starts. `e2e/cardio-baselines-placement.spec.ts` asserts both halves
and **each was proven to fail without the change** (the Cardio half against clean `main`, the Health
half against a deliberately duplicated build). ⚠️ **Not device-verified**
([journal](history-2026-09-16-folded-1.md#2026-09-14-bf159-cardio-baselines-placement)).

**The stress chart reads one baseline, and now reaches past days (LA-104).** TN-3b shipped the chart
reading `/api/body-battery`'s **live** series while LB-102's route served every stored day — and the
two are not the same number: measured in production over the eight days that had both, the sign
differed on **6** and high-stress minutes by **4–8×**. So today drawn one way and yesterday drawn the
other made the owner's own pass test — *"open a past day, read a stressed window off the axis"* —
compare two metrics on one axis. Both halves now come from `/api/body-battery/stress-day`. The chart
is also **mounted on `/health/day`**, which is what makes that test runnable at all; before this
there was no past-day surface, so the claim was unobservable. The honest cost is printed on the
chart: *"Measured through HH:MM — the last reading stored, not the end of your day."* ⚠️ **Not
device-verified** — the Home card and the day screen were exercised on `pnpm dev` at 412 dp only
([journal](history-2026-09-17-folded-1.md#2026-09-14-la104-stress-chart-one-baseline)).

**The AMRAP baseline session was never consumed (BF-131).** Owner: *"even though the session was
done it's saying baseline needed"*. He ran both baseline sessions as instructed and
`session_periodization` still read `baseline_complete = false` — completion WAS wired and wrote the
wrong field, moving `sessions_in_phase` while the flag never flipped, so the only exit was the "Use
prior data →" button that discards the session you just ran. The 1RM already existed: the screen runs
the AMRAP estimator and persists it to `exercise_logs.estimated_1rm`; what was missing was the copy
into `baseline_1rm`. Completion now does that hop, tagged `source: 'amrap'`, and a **partial**
baseline accumulates rather than completing on a gap. **Existing rows are untouched** — this fixes
new completions, not the two already sitting at false; "Use prior data" remains valid and is now a
choice rather than the only way through. The card still reads "Baseline needed" until LA-92 (Lane B)
lands, and **none of this has been seen on the S25**
([journal](history-2026-09-12-folded-1.md#2026-09-09-bf131-baseline-anchor-hop)).

**The weekly weight trend was measuring change per weigh-in, not per day (LB-67).**
`computeWeightRateKgPerWeek` fitted the array index, and rows exist only on days carrying a metric —
so weighing in about three days in four made a true −0.70 kg/wk report as **−1.04** (−1.76 at six
readings in fourteen days). Past 1.0 kg/wk the band says `too_fast`, so an ordinary healthy rate
rendered on Health → Body as **"Faster than ideal pace"** in amber. The correct fit already existed
in `adaptive-tdee`, so the app held two weekly-rate figures disagreeing by ~1.5× on one data set;
both now call `computeWeightRateFit`, which also returns a standard error (OR-102b ④ needed the
interval and would otherwise have invented a third). **Not seen on a screen** — the band is asserted
in a unit test, not observed turning green on the S25
([journal](history-2026-09-12-folded-1.md#2026-09-09-lb67-weight-rate-day-index)).


**The baseline banner told him to load 82.5 kg on a pull-up (BF-127).** Owner, mid-session: *"pull
up = weight"*. `personal_records` holds `Pull-Up estimated_1rm = 118.25` — **not kilograms**: a
bodyweight 1RM is computed against `BW_REF = 100`, a fixed stand-in, so it is an index of reps and
added load, and the owner weighs 70.65 kg. The banner printed `mround125(118.25 × 0.7)` with a
hardcoded `kg`. **The repo already forbade this in a comment written after Q-12** — *"bodyweight
strength is measured in REPS, never kilograms … Every surface … resolves its unit here"* — and the
exercise card **six lines below** rendered `5 RM` correctly for the same exercise. A bodyweight row
now says `Bodyweight` with the rep max beside it, and offers no load, because 70% of a rep max is not
a prescription. **The entry's own stated fix does not work** (`exerciseType` is on the LLM-prompt
signal, not the card signal the client gets); the type comes from workout-data instead, keeping this
in Lane B. **The sibling sweep found nothing else** — the other five sites all guard on
`isBodyweight` or use the number as arithmetic. **Not seen on a screen, not device-verified**
([journal](history-2026-09-10-folded-6.md#2026-09-07-bf-127-bodyweight-baseline-unit)).

**The meal builder divided the calories and not the macros (BF-121).** Owner: *"for the meal creator
when adding in serving size it would be good to see the macros per serve."* A 4-portion recipe read
`BATCH 983 kcal · 52 P · 103 C · 39 F` with `246 / portion` at the far right — **one row carrying two
denominators, only one of them labelled**, while the same meal's detail sheet shows per-portion macros
and says so. Now two labelled lines, `Batch` and `Per portion`, through one `MacroLine` component; a
second LINE rather than six more numbers on the first, because width is the stated risk and BF-116 is
that exact failure one screen over. `perPortion` divides and the render rounds — rounding first would
disagree with the diary row the log writes — and dividing the batch is exact rather than approximate,
which a test proves against `oneServingItems` instead of asserting in a comment.
**The two lines have not been seen at 412 dp, and for a width change that is the gap that matters**
([journal](history-2026-09-10-folded-6.md#2026-09-06-bf-121-per-portion-macros)).

**A refused meal-type reorder no longer reports success (LA-59).** `handleDragEnd` fired
`fetch(...).then(success).catch(failure)`, and **a `fetch` promise does not reject on a 4xx** — so the
`.then` ran for every response the server sent and the `.catch` only ever saw a transport error.
RV-48 gave that route a 404 for a reorder it declines to apply and nothing here read it. It now checks
`res.ok` and **refetches rather than only toasting**, which is the substantive half: a 404 means the
list the drag was computed from is stale, so restoring the previous local order would put back a
different wrong one. Last of the four surfaces RV-45/RV-47/RV-48 touched. **The 404 is proven live;
the toast and the refetch have not been seen on screen**
([journal](history-2026-09-10-folded-6.md#2026-09-06-la-59-reorder-status)).

**A meal with one food in it shows its macros again (BF-120 / OR-101).** The owner, from two
device checks: *"1 meal doesnt show the calorie total; but 2 meals do"*. A section holding one
loose food printed no protein, carbs or fat **anywhere**, while the section above it printed all
three. The gate was a COUNT (`entries.length > 1`) and the question is a KIND: a group row states
its own macros, a loose row has not since **Q-406** moved the per-item P/C/F into the detail
sheet — and `meal-card.tsx` held both the true statement and the false one depending on it, ten
lines apart. **The two reports disagreed about the cause and OR-101's reading is the one that
holds:** BF-98 did not regress this — its own case table lists *"one loose row → no footer
(unchanged)"* — and the first test in `diary-nested-meal.spec.ts` still pins the duplication it
did fix. The calorie total stays gated at two or more, per BF-120: with one entry the section
total *is* that row's number and the header prints it already.
**Not device-verified** ([journal](history-2026-09-10-folded-6.md#2026-09-06-bf-120-lone-row-macros)).

**A dose can be typed in at last (BF-112, stage 2 of BF-69).** The storage shipped 2026-09-01 and
nothing could write to it: production held two supplements with `default_amount`, `unit`,
`dose_prompt` and `started_on` all empty, and one log of any kind, from June — with the owner due to
start dosing on **2026-09-06**. The manage sheet now carries an amount, a unit, the started/stopped
window and an *ask me each time* switch; a supplement with that switch asks for the number when it is
ticked, pre-filled from the definition. The row's second line reads **what today's log recorded**,
not what the definition currently says, so changing the dose later does not rewrite a past day —
verified live by patching a definition from 2.5 mg to 10 mg while its earlier log kept reading 5 mg.
**Two defects were found while verifying and both are fixed here:** the nutrition page's local-first
branch dropped every new field, so the prompt would never have fired **on the device** while working
in the browser; and the tick left the previous log's number on screen until the next pull. **Not
device-verified** — which is precisely the surface the first defect was hiding on. Left behind as
**LB-57**: the day's exposure is now derived once per lane, and the single home is `packages/shared`,
which Lane B may not write
([journal](history-2026-09-10-folded-6.md#2026-09-06-bf-112-dose-entry)).

**About stops looking like it contradicts itself (BF-111).** The screen showed **v1.436.2** and, two
rows below, a green tick reading *"Up to date — v1.414.1 is the newest build."* Both were right — the
first is the web app, advanced by every deploy; the second is the newest APK — and nothing said so, so
the tick appeared to vouch for the smaller number. Both are labelled now, and **every state names the
INSTALLED build**, which is what answers *"has that native fix reached my phone?"*: the update state
used to name a version the device does not have and say nothing about the one it does.
**The date was already in the payload** — `/api/version` has returned `nativeBuiltAt` all along and
the card dropped it. **That is the third entry today of that shape** (Q-529's `provisional`, Q-516's
`informativeShare`), which is a class worth watching rather than three coincidences. Rendered through
`toAestDay`, not `toLocaleDateString`, which would use the *device's* zone.
**Not device-verified, and here that is the whole surface** — the card returns early off-native, so
none of its three states has ever been on a screen
([journal](history-2026-09-10-folded-6.md#2026-09-03-bf-111-version-labels)).

**The blank resume was never a dead renderer (BF-110).** The owner: *"it fixes itself if you just
scroll on it."* **That one detail overturns BF-80's diagnosis** — a killed WebView renderer has no
document left to scroll, so content that reappears when you drag it was there all along and was not
painted. A compositor failure, not a process death, and the two want opposite fixes. **BF-80's
handler stays and is still correct**; they are two causes of one appearance. Shipped both halves in
the order the entry insists on: measure the shell root's box and children on resume, then promote and
release a layer for one frame — the instruction the manual scroll gives the compositor, without
touching scroll state (BF-100's restoration listens for scroll on that same container).
**⚠ The entry's "row per resume" was deliberately NOT built:** `error_events` prunes at 30 days, and
**JS cannot tell whether the screen was blank** — the DOM is intact either way — so a row per resume
evidences nothing while flooding the table. A `dom-lost` sample files always (it would disprove the
entry); a `dom-intact` sample once per launch.
**Not device-verified, and here that is the whole verdict** — this compositor is invisible in Chrome
and `pnpm dev`, so the suite proves the effect runs and nothing about whether it fixes anything
([journal](history-2026-09-10-folded-6.md#2026-09-03-bf-110-resume-repaint)).

**The HR Recovery Profile now says how much of it is signal (Q-516).** `aggregateHrRecoveryProfile`
has returned `informativeShare` since the re-banding and **nothing rendered it** — the state the
entry warned about in its own words: *four populated buckets look like a working feature whether or
not they are.* The card states the share, emphasised below half, where it stops being a footnote
about the dimmed rows and becomes the headline about the table. A share of 1 stays silent.
**⚠ THE ENTRY WAS UNREACHABLE FROM EITHER QUEUE and that is the durable finding:** two bare lane
mentions disagreed — the `Keep:` said Lane B, a stale line eleven lines below still said *"Lane A
implements"* — so `laneFromLines` returned `?` and `next-item.js` filed it under UNCLASSIFIED, where
neither lane looks. Found by auditing the queue, not by taking the next READY item.
**BF-94's `Needs: BF-84` was also discharged** (that storage shipped 2026-09-01) while its real
blocker, BF-61's device check, sat in prose the parser cannot read; it is a `Gate: device` now.
**Not device-verified** — the seed has no `set_hr_stats`, so the emphasised branch has never been on
a screen ([journal](history-2026-09-10-folded-6.md#2026-09-03-q516-hr-recovery-honesty)).

**A redecode that finishes late can now say so (LA-56).** The owner ran the `fullHistory` pass and
it was reaped as *abandoned* after exactly 30 minutes having written nothing — the second such
failure in four days, and every full-history redecode that has ever run ended the same way.
`finishRedecodeJob` filtered `isNull(finishedAt)`, which the reaper has already set, so a late
success could not record itself: **the work would land while the record said it failed.** Migrations
**261 + 262** add `reaped_at` and let a reaped row be closed — keeping both facts, when the reaper
gave up and what came back. Immutability is preserved exactly: a job that genuinely finished and
recorded a result is still untouchable. **The heartbeat is still owed** — the reaper remains a pure
`startedAt` age check, so slow and dead look identical
([journal](history-2026-09-10-folded-6.md#2026-09-03-la56-late-redecode-result)).

**A still-syncing sleep score now says so (Q-529).** The owner saw a night scored **47** at 06:46
while the ring was still uploading; it settled at **62**. **The entry's central claim was already
stale:** it says sleep has no provisional concept, but `lib/sleep/provisional.ts` shipped for BF-83
on 2026-09-01 and `/api/sleep-sessions` has returned a per-night `provisional` flag ever since —
**four local `SleepRow` interface copies dropped it**, so it reached the client in the JSON and no
sleep surface read it. Marked now on all three: the Home chip (via its existing `lowWear`/`limited`
glyph, whose predicate was written out at three sites and is now one tested function), the Body
tab's sleep card, and `/health/sleep`. An absent flag reads as **settled** — the local-store seed has
no watermark, and badging every historical night would be worse than the bug.
**⚠ Filed as LB-53 (Lane A), and REFUTED as filed on 2026-09-04 — read the corrected version.**
The original reading (four `computed_at` stamps in the table's whole history, a nine-day gap, a pass
rewriting 85 rows after a deploy) was drawn from a column stamped by every write of any of the row's
36 columns, so it says nothing about when a score was computed; the 85-row pass writes `body_comp`
only. What is true: the live route rewrites **today's** score on every request and nothing revises a
day once it ends. So this marking is still *more* load-bearing than the ~9 minutes Q-529 measured —
the provisional window is the whole local day — but it is bounded by that day, not open-ended.
**Not device-verified**, and the device owns the only real test: a morning where the ring is
genuinely mid-upload ([journal](history-2026-09-10-folded-6.md#2026-09-02-q529-provisional-sleep-score)).

**The database's growth is partly the archive its baseline predates (BF-55, Q-283).** Total re-read
at **200 MB** — down from 206, because migration 249 took the 21 MB index on 09-01. `oura_raw_packed`
holds 1,072 rows / 18 MB and its **first pack is dated 2026-08-18, the same day as the 171 MB
baseline**, so it has grown ~**1.2 MB/day** since and is never pruned. That is **~62% of the excess,
and the ~0.4 MB/day expectation cannot have included it** — the packing work that set the baseline
created a permanent writer on the same day. **Q-283 is stale by ~14×:** its one real candidate was
already dropped, and excluding primary keys and unique constraints the droppable remainder is
**800 kB**, 0.4% of the database, for a destructive migration
([journal](history-2026-09-10-folded-5.md#2026-09-02-db-growth-archive-attribution)).

**The chronic-stress refusal now leaves a number behind (TN-1).** `chronic_stress_score` has been
NULL on every row since the model shipped — the third dormant score — and both gates countable from
stored data pass, so the refusal is in the granular layer, which by design recomputes its
intermediates in memory and records no reason. `chronic_stress_granular_nights` counts the nights in
the model's own 31-night window carrying a non-empty hypnogram, rMSSD series **and** skin-temp run
(migrations **258 + 259**, local SQLite **v36**). **`CHRONIC_STRESS_MIN_DAYS` does not move and
nothing consults the count** — relaxing a threshold before knowing its input distribution is the
Q-504 mistake. **NULL means NOT EVALUATED**, and **only a hand-triggered `fullHistory` pass will ever
write a value**, which is the owner's to run
([journal](history-2026-09-10-folded-6.md#2026-09-02-tn1-chronic-stress-count)).

**A guided walk's phase change now lands on the screen (BF-105).** The owner, mid-walk: *"there isn't
enough of a queue to indicate session phase changed."* The notification was firing correctly and on
time — what did not exist was any in-app response: `walk-active.tsx` called `hapticSuccess()` once, at
the end of the whole walk, so a boundary moved one word and nothing else. Now a haptic per boundary
(`hapticSuccess` for fast, `hapticLight` for slow, so the two are tellable apart through a pocket),
keyed on the segment index so it fires once per change and **never on mount** — the screen mounts with
an active segment when a walk in progress is reopened. Plus a vignette wash of the incoming phase's
colour, which keeps the centre clear because peripheral vision is what has to catch it.
**⚠ Two corrections to the entry's second half, both measured:** `workout-timers` is NOT dead and must
not be deleted (the workout rest timer posts to it), and the plugin's per-channel `vibration` is a
boolean rather than a pattern — so a fast/slow channel split needs a sound file in `res/raw/`, making
that half **APK-gated**, not the JS-only work the entry described. **Not device-verified**, and the
device owns the haptic, which is the half the report is about
([journal](history-2026-09-10-folded-5.md#2026-09-02-bf-105-walk-phase-cue)).

**A finished walk no longer arms the Start screen (BF-108).** The owner: *"after closing it - it still
opens with the activity naming screen"*, titled from a walk they had just done. **The entry blamed the
completion path and that was wrong** — `done-activity-screen.tsx` calls `resetSession()` on both save
paths and Back calls it too, so a saved or cancelled activity has always left clean state. **What
survives is an ABANDONED session:** `onRehydrateStorage` demotes a `done` session, and a stale
`active` one, to `pre` and neither cleared `activityType` or `title`, so the screen rendered pre-armed
instead of falling to the type picker. That is the persisted-store class CLAUDE.md already names, and
this is its fifth shape. **Q-450 is intact and pinned** — a live in-flight session keeps its type and
returns to its own screen, and the 12-hour boundary is asserted as `>` because an off-by-one there
discards a recording. `Done` now lands on `/health`, where the walk it just saved is visible.
**Not device-verified**, and the device owns the Q-450 case, which needs a real kill and relaunch
([journal](history-2026-09-10-folded-5.md#2026-09-02-bf-108-activity-store-stale)).

**HR-recovery peak bands re-cut, and the entry's own proposal rejected (Q-516).** The `<110`
boundary cut through the middle of the informative range — mean 60-second drop **−3.5** under 90 and
**5.1** at 90–104 against **12.2** at 105–119 — so **42 episodes peaking 105–109 shed 11.5 bpm** and
were dimmed as noise and dropped from the trend. **⛔ The proposed `120+` top band was not shipped:**
it was measured over `set_hr_stats` (strength, max 132) while **HRP-2 is built** and cardio cool-downs
reach **168**, so collapsing the top would bucket a 168 bpm cool-down with a 120 bpm lifting rest.
Shipped `<90 · 90–104 · 105–119 · 120–149 · 150+`; only the genuinely empty `170+` went. The stale
header comment that misled the entry (*"Phase 1 seeds exclusively from set_hr_stats"*) is corrected.
**The honesty half is Lane B's and is NOT done** — `informativeShare` is computed and unrendered
([journal](history-2026-09-10-folded-5.md#2026-09-02-q516-peak-bands)).

**The calibrated maintenance can no longer land below your own resting burn (Q-517).**
`adaptive-tdee.ts` warns in its own header that an ungated estimate *"would tell the user their
maintenance is 1200 kcal — actively harmful advice"*, then clamped at **1000**; the owner's worst
window computed **1052** and slipped through the gap. The floor is now the user's BMR — the
**measured** resting rate where one exists, since `energy-balance-service.ts` already resolves that
better number two dozen lines above the call. Below it the window is **rejected, not clamped**, so
the resolver falls back to the formula baseline rather than reporting a number the data never
supported. **The right floor already existed one line below, applied to the wrong quantity:** it
protected what the balance *displays*, not the maintenance that becomes the recommendation and then
`users.calorie_goal`. **SAFE, not CORRECT** — survivors still sit under the formula's 2,397, which is
under-logging showing through ([journal](history-2026-09-10-folded-5.md#2026-09-02-q517-tdee-bmr-floor)).

**A clamped expectation no longer cuts your load (Q-514).** `expectedRpe` clamps to the 5–10 slider,
and on light accessory work the floor binds — 37 of 570 rated sets, hiding raw expectations as low as
−10. Those sets ran a **+1.89** mean delta against **−0.34** everywhere else, a 2.2-point offset in
the direction the engine reads as "RPE ran high", and they produced **64% of all back-off triggers**
while leaving the push arm untouched. They are now **dropped** from the autoregulation delta rather
than neutralised: the model cannot state what it expected, so the gap to the reported RPE measures
the clamp and not the athlete. `RPE_DEAD_BAND` does not move and the clamp does not widen — both were
measured and both are correctly placed. **`rpeTrendFromSets` deliberately still sees every set**: it
is the emergency-deload safety net, and the same bias makes it fire slightly early, which is the safe
direction ([journal](history-2026-09-10-folded-5.md#2026-09-02-q514-expected-rpe-clamp)).

**The walk summary shows its calories (BF-107).** The owner: *"the final screen doesnt show calories
burned."* **The number was already reaching the client and the screen threw it away** — `POST
/api/activity-logs` answers `{ activityLog }` carrying it, and the web branch checked `res.ok` and
discarded the body. **The device half is the one that mattered:** `pushMutations` only flips the row to
`synced`, so the derived value lands on a **pull** — the fix forces one inside `pushThenRevalidate`'s
callback and reads the row back, without which the tile is a dash forever on the canonical runtime.
The tile reads `—` until a figure lands, never `0`, because a zero is a claim about a walk that burned
nothing. **The entry's sibling claim was wrong:** `done-activity-screen.tsx` navigates away the instant
it saves, so its grid is a pre-save draft and a tile there would vanish before filling. `StatTile` is
now one primitive rather than two drifted copies. **Not device-verified**, and the device owns both
interesting cases — offline, and the fill itself
([journal](history-2026-09-10-folded-5.md#2026-09-02-bf-107-walk-calories)).

**LB-38 is root-caused: `@zxing/library` cannot read certain VALID QR symbols upright, and the flake
was never in the app.** Over **3,000** meal tokens, encoded by the same `qrcode` call the label
renderer makes and rendered synthetically at 13 px per module with **no app code in the reproduction**,
**115 (3.83%) fail upright** and **4 (0.13%) still fail after four rotations**. The symbols are valid —
seven of eight sampled failures decode once turned, and rotation changes only the detector's traversal.
It is independent of ECC level, QR version, mask, module size and quiet zone. **It was deterministic
per token all along**, which is why no retry helped: each run seeds one meal, every style draws that
same symbol, and 3.83% is 1 in 26 against the ~1 in 19 measured. `decodeQrRotating` tries four
orientations, guarded by a fixed token that fails upright. **⚠ The app's own scanner is the same
decoder**, so ~4% of labels may be unreadable upright by the app that printed them — untested on a real
camera, so it is flagged for the owner rather than claimed
([journal](history-2026-09-10-folded-5.md#2026-09-02-lb-38-root-caused)).

**Nutrition's plan button opens the coach, in the nutrition scope (Q-407).** LA-47's plan card
unblocked this, and the Lane B half was exactly what the entry said: `/coach` takes `?scope=`,
`CoachContent` forwards it in the request body, and `Build a meal plan` goes to
`/coach?scope=nutrition`. **The scope is the point, not the navigation** — it decides the coach's tool
subset, and *a tool it never receives is a boundary it cannot cross*, as against a prompt asking the
model not to read workout data. **The stepper sits beside the conversation, not behind it:** the entry
warns that a flow stalling with no fallback is worse than seven screens that finish, and Rebuild —
the only other route to the sheet — does not exist until a plan does, so the no-plan user is the one
who would have been stranded. **Still owed, and it is Lane A's:** the coach does not yet open by
stating what it already knows instead of asking. **No real Gemini turn was made and the device is
untouched** ([journal](history-2026-09-10-folded-5.md#2026-09-02-q-407-nutrition-coach-entry)).

**AI Coach draws the meal plan, and one button puts every meal in My Foods (LA-47).** The owner's
review is the acceptance test — *"I want it to make the meal plan; then add each item to the saved
meals/my foods"* — and nothing in a Coach thread could put one there until now. **`showMealPlan`
takes a title and nothing else:** the card reads each meal from the plan the app holds, so the model
cannot round a calorie figure or drop a meal, and it spends none of the output tokens that are
essentially all of Coach's latency. Save-all goes through Q-398's write path, keyed on
`meal_plan_meals.saved_meal_id`, so a second press is a no-op. Both buttons resolve as ordinary
`chose` results — a card with two buttons is a choice list with a rich body, not a new result type.
**Shipped as one PR across both lanes on purpose:** a new union member is a type error until
`widget-registry.tsx` handles it, and a branch rendering `null` wedges the thread permanently.
Verified with a real Gemini turn against `pnpm dev` (three saved meals, three stamped plan rows) and
**not device-verified**. **Q-407's `Needs:` is cleared**, so the conversational wizard is startable
for Lane B ([journal](history-2026-09-10-folded-5.md#2026-09-02-la-47-coach-plan-card)).
**LB-38's dump was captured, it does not decode offline, and the reading I first gave it was wrong.**
The share-code e2e flake has been open on one question: keep the pixels ZXing refuses and decode them
offline, because a buffer that decodes offline would put the fault in *how* the decode is invoked. One
was finally caught, on `Ingredients · centred`, and **no binarizer × `TRY_HARDER` combination decodes
it** — so the fault is in the image, and the last unexamined mechanism is eliminated. **The follow-up
was then wrong and one more measurement caught it:** the dump's ink of 0.0807 looked like half the
recorded 0.172–0.179 band, a mid-repaint signature, and a canvas-settling gate was written for it —
but ink is **per-style**, `Ingredients · centred` reads **0.0800 on a passing run**, and that band
belongs to a different style. 0.0807 is normal. **The gate was reverted unshipped** rather than fix a
cause that is not established. The four measured per-style figures are now in `darkFraction`'s comment,
which previously said "~0.17" and is what made the error easy
([journal](history-2026-09-10-folded-5.md#2026-09-02-lb-38-dump-captured)).

**The `Full` override told the user it had reverted a deload when it had not (LB-47).** The entry
asked whether BF-64's override does anything on a real session-level deload; **its measurement was
exactly right and its conclusion was not.** Re-measured: 5 prescriptions, 1 session-level deload
carrying 0 exercises with `preDeload`, 2 per-exercise, 0 with both — the entry's figures to the row.
But on that prescription the toggle **is not rendered at all** (`phase: 'deload'` → `isDeloadActive`
→ `pre-workout-screen` gates the whole control on it), so `Full` is not an override that does nothing;
it is not offerable, and the entry's proposed fix was already the behaviour. **What is reachable is
worse:** `deloadRevertNames` and `deloadOverrideBlocked` both return empty in that shape, and the card
read `blocked.length === 0` as *everything reverted* — rendering *"Every exercise is back to its
pre-deload weights and sets, and these sets count toward your 1RM."* Both clauses false, which is
BF-8's complaint arriving from inside the fix filed to prevent it. `deloadOverrideOutcome` gives the
card a `nothing-to-revert` state and honest copy. **BF-64 is not reverted.** Latent rather than live —
it needs a prescription whose `deload` flag and `phase` disagree, 0 of 5 so far — and **not
device-verified** ([journal](history-2026-09-10-folded-5.md#2026-09-02-lb-47-deload-override-honesty)).

**The Review sheet flags macros that disagree with their own calories (BF-109).** A scan read **173
kcal** beside 45.7 P / 52.1 C / 13.6 F — **514** by Atwater. **The screen was right and the row is
wrong at source:** OFF carries `energy-kcal_serving 173` on the same per-serving basis as every other
field, so the mapper is correct, and `energy-kcal_100g` is that figure ÷ 3.5, so nothing in the row can
be fallen back to. **The guard already existed** — `macroCalorieDisagreement` and the 15% limit have
been in `scan-totals.ts` since they were written, for this failure against this source; the search list
surfaces them and two routes sanitise, and this sheet did neither. It **warns and offers a one-tap
correction, never rewriting silently**: Review exists for the user to decide, and fibre and alcohol put
real foods 10–20% out. Photo-scan and manual share the sheet, so they get it too. **Not device-verified
and no barcode was actually scanned** — the e2e reaches the identical sheet by the manual road, because
a barcode needs a camera ([journal](history-2026-09-10-folded-5.md#2026-09-02-fix-bf-109-macro-calorie-warning)).

**A meal can be logged at ½×, 1× or 1½× (BF-104).** The owner's ask, and the second half of a split
that paid off: BF-104 was parked behind LB-49 this morning and became startable the moment LB-49's
engine argument merged. **The picker had to change the sheet's own figures**, which the entry did not
anticipate — the detail sheet documents its headline and macros as *"per portion, that is what Log
this meal writes"*, so a figure fixed at one portion would have stopped describing the button. They
follow the picker now and the label says which portion it is showing. Discrete taps rather than a
number field (the entry is explicit), reset to 1× whenever a different meal opens, and the scanned-
label path deliberately keeps no picker because it is scan-and-go. Verified against the database
rather than a toast: logging at 1½× writes `quantity_multiplier` **1.5**. **Not device-verified**, and
**`saved-meals-sheet.tsx` now sits at 798 lines against the 800 limit** — two lines of headroom, and
it is not in the size baseline, so the next addition there fails outright
([journal](history-2026-09-10-folded-5.md#2026-09-02-feat-bf-104-meal-scale)).

**Lane A session wrapped 2026-09-02 — ten PRs, and the finding is about the QUEUE rather than the
code.** Handoff:
[`docs/handoffs/handoff-2026-09-02-nutrition-lane-a-session.md`](../handoffs/handoff-2026-09-02-nutrition-lane-a-session.md).
**Six of the eight backlog entries examined were wrong about something load-bearing** — not stale,
wrong at filing time: a function name that does not exist (`logMealFromSaved`), a severity that does
not reproduce (LB-48's "until the app is restarted"), a missing `Gate:` that put owner-gated planning
at the head of a build queue, and a migration LB-18 insisted on that `listSavedMeals` had already
made unnecessary. **Line numbers were accurate every time; names and conclusions were not.** Another
session hit the same class independently in #789. Worth Orchestrator's attention as a filing-quality
pattern rather than six coincidences.

**`Recent` gets an unscoped source, and the migration LB-18 said it needed does not exist.** The
owner settled the behaviour on the device — *"Recent doesnt need to be scoped to current meal
bracket"* — and the entry said ordering foods and meals by recency **needs a Lane A schema change,
not a Lane B sort**, because a saved meal has no last-used timestamp. **`listSavedMeals` already
derives `lastUsedAt` from `max(food_logs.logged_at)`**, orders by it, and reads
`idx_food_logs_saved_meal_recent` from migration 238 — deriving rather than storing, as the Stored
Counters rule asks. The whole planned chain (migration, SQLite version, `RECONCILE_COLUMNS`, sync)
was unnecessary; what was missing was a query without a `WHERE meal_type_id`. That shipped on both
sides, sharing one body each so the de-dup and the 100-row window cannot drift, and `mealTypeId` is
now optional on the route. **Lane B's half is dropping the query param**
([journal](history-2026-09-10-folded-6.md#2026-09-02-recent-food-items-unscoped)).

**The goal-recommendation prompt claimed an activity-scaled TDEE it never had (LB-50).** It read
*"Baseline (Katch-McArdle, lean mass Xkg, activity level 'moderate'): BMR X, TDEE X"* — which parses
as *computed for that level*. `calculateBaseline` is `bmr × SEDENTARY_MULTIPLIER`, unconditionally,
since Q-401 deleted `ACTIVITY_MULTIPLIERS` precisely so a self-report cannot double-count against
measured movement; the level reaches only `waterMl` and `stepsGoal`. The model was being handed a
number, a false account of how it was made, an activity level and a step count — everything needed
to "correct" for a multiplier that is not there. The prompt now says outright that the TDEE is
BMR × 1.2 and must not be scaled, which beats merely deleting the claim: the level is still on its
own line, so silence would leave the inference to the model. **Still owed: the exposed factor and
its not-enough-data state**, which is what BF-102's picker needs
([journal](history-2026-09-10-folded-6.md#2026-09-02-recommend-prompt-tdee)).

**The journal directory's total ceiling is 320, up from 250 — `main` had reached it and every agent
was one PR from a hard CI block.** The standing rule puts a journal entry in every PR, so the next
one took the count to 251 and failed. The raise is not a workaround: the check's *other* guard, the
one a compaction sweep can act on, counts UNLINKED entries and read **3 of 60**. The ceiling was
firing because entries are well cited by durable docs — the habit the entries README exists to
establish — and the four foldable ones were all written in the previous two days, so a sweep would
have deleted the newest rather than the oldest. Reversal is one number in
`docs/doc-size-baseline.json`; the signal to do the real compaction instead is the floor rising from
something other than journal citations.

**A scale argument on the meal log, and four things its entry got wrong (LB-49).** `logMealItems`
takes an optional `scale`, applied at write time to each item's multiplier and defaulting to 1 — so
nothing is user-visible until Lane B ships the control. The entry named a function that does not
exist (`logMealFromSaved`), justified the lane by calling it *"the single shared write function both
server paths call"* when it is client-side and neither an API route nor `pushMutations` touches it,
demanded a sync chain its own **scale-at-write-time** decision makes unnecessary, and named three
write sites where there are **five** — the two it missed are the optimistic pushes, the pair that
decides whether the diary agrees with the database
([journal](history-2026-09-10-folded-5.md#2026-09-02-meal-log-scale)).

**A saved RMR test evicts the goal caches — and the entry's severity claim did not survive being
measured (LB-48).** `measured-rmr` was in no cache group and its route invalidated nothing, so
Profile's Recommended calories painted the previous resting rate before revalidating. The fix is the
key joining `invalidateGoalRecommendations()` and the RMR form calling that group. **What the entry
got wrong is worth more than the fix:** it said the stale value survived *"until the app is
restarted"*, because the goals section fetches in a `useEffect(…, [user?.id])` inside the persistent
tab shell. The shell does keep its five tabs mounted — but the RMR form lives at `/more/clinical`, a
plain page outside it, and driving `/more` → `/more/clinical` → back in Chromium logged the goals
effect **3 times then 3 more**. It remounts, so this was a first-paint flash. A `useCachedValue`
conversion written for the claimed symptom was reverted, and a backlog entry filed on the same
premise was withdrawn before it reached the queue
([journal](history-2026-09-10-folded-5.md#2026-09-02-measured-rmr-invalidation)).

**The ring and strap batteries reach the Home header (Q-111), and the entry was wrong about both
halves.** It claimed the ring chip was already there — **it was not**; there was no
`oura-battery-chip.tsx` and the header rendered only the weather chip, with the ring battery on
Health and More. And it claimed nothing in JS read the strap battery — **`chest-strap-pairing.tsx`
does**, over browser BLE while pairing. The true gap was that nothing read `PolarBleStatus.battery`
and nothing persisted either number: **two numbers in two screens with no relationship**. Now one
store with two writers, a shared chip, and a stale reading shown **muted rather than hidden** (a chip
that vanishes reads as "no strap", which is a chest strap's state most of the day). The header could
not grow — `session-select-content.tsx` is shrink-only — so the row was extracted at net-zero lines.
**Not device-verified, and the strap's live path has never executed:** `getPolarBle()` returns null
off-device, so every reading in every test came from the store. **Two things are the owner's:** the
scale (new Kotlin BLE, flagged a stretch) and whether the header's manual refresh button should go —
measured, it does **not** bump `refreshTick`, so it is strictly narrower than pull-to-sync
([journal](history-2026-09-10-folded-5.md#2026-09-02-feat-home-device-battery-chips)).

**A day's dose is a sum of contributions, not a tick (BF-69 stage 1).** `supplement_logs` held one
row per substance per day, enforced by a unique constraint — so a dose carried by a logged meal and
one ticked by hand were **last-writer-wins**, and unticking wiped the day whoever had written it.
That is silent data loss the moment a second writer exists, and the meal attachment is that second
writer. Each act of taking something is now its own row with a `source` and, for a meal, the
`food_logs` row it came from; the day's amount is **derived on read**, never stored. What replaced
the constraint is a *partial* unique over `source = 'manual'` — the tick stays idempotent under a
double-tap or a replayed outbox mutation, while the same meal logged twice counts twice, correctly.
`supplements` also gained `started_on`/`stopped_on`, which is what makes **"forgot to log it"
distinguishable from "did not take it"**: outside the window is a true zero, inside it with no
contribution is *unknown* and must be excluded rather than counted as 0. **Nothing can write a
number yet** — that is stage 2, Lane B's, and until it ships production still holds 2 supplements and
1 log ever. **⚠ Not device-verified**, and the local v34 migration rebuilds a table rather than
adding a column ([journal](history-2026-09-10-folded-5.md#2026-09-01-supplement-contributions)).

**A CI flake had a cause, and `main` gets a nightly (LB-31).** `anchor-source.test.ts` failed once
on CI and nowhere else; an hour had already gone into it. The entry's diagnosis was half right — the
second test's own sleep row does let the route build and persist a readiness that out-ranks the rung
under test — and the missing half is what made it unreproducible: the build is also gated on
`!todaySnapshot`, and **the route's snapshot write is fire-and-forget**, so the whole file was
passing on a race between an unawaited write and the next test. **Reproduced on demand** by running
the second test alone, where test 1's snapshot never exists. Separately, `ci.yml` now runs `Tests`
against `main` nightly (every other job skipped on that trigger, so a night costs one job) — a PR is
green against the `main` it was cut from, and nothing re-checked the combination after several
landed; a failure now names `main` and the merge window instead of the next contributor's PR. **The
no-`push` decision is untouched**
([journal](history-2026-09-10-folded-5.md#2026-09-01-verify-main-nightly)).

**Test files are typechecked now, and they never were (LB-37).** `tsconfig.json` excluded
`**/__tests__/**`, so across ~700 specs a test could reference a type that does not exist or assert
against an interface that had since changed shape and `tsc` said nothing — which means the sentence
*"tsc clean"*, the first gate every session runs, **carried no information about any spec**. The
split is exact: the base project reports **0** errors, the same project with the exclusion dropped
reports **320 across 90 files**, and every one is in a test. Shipped as a shrink-only per-file
ratchet (`tsconfig.tests.json` + `scripts/check-test-typecheck.js`), so every NEW spec is checked
immediately and the 320 come down as files are touched. **A real broken reference is already
confirmed** — `lib/__tests__/ai-dynamic.test.ts` imports `../types/program`, which does not exist,
and the spec passes. Two placement calls: a **second tsconfig** rather than editing the one
`next build` reads, and the step in **Build** rather than Custom Rules, which installs nothing and
would have failed CI on the entry's own suggestion
([journal](history-2026-09-10-folded-5.md#2026-09-01-typecheck-tests)).

**✅ ANSWERED AND IN FORCE, 2026-09-25 (OR-164): E2E is NOT a required check, and the other five now
genuinely are.** The owner set the `ProtectMain` ruleset to **Active** — it had been sitting at
Enforcement `Disabled` since 2026-08-17, which is why none of its rules bound anything. Required:
`Lint, Tests, Build, Migration Check, Custom Rules`. Also enforced now: PR-before-merge, **squash as
the only merge method**, force-pushes and deletions blocked. The paragraph below is the state of the
question before it was answered, kept because its measurement is what made E2E safe to require had
he wanted to.

**⚠ (Historical) One decision was waiting on the owner: whether the E2E job becomes a required check (Q-297).**
**Measured rather than read — it is NOT required today:** PR #776 merged while its E2E job was still
`in_progress`. LA-22 has since made the job always-run and always-report specifically so it is safe
to require, so the only remaining question is whether to, and it is **branch protection** — a shared
system, not a lane's to change. E2E takes 15–40 minutes and catches real bugs; requiring it makes
every merge wait for it. Alongside this, `e2e/plan-rescale.spec.ts` closes **LB-51** (the plan card
had no e2e at all, because the seed builds no meal plan and logs no food), and Lane B's READY queue
went from 11 entries to 5 — three of the six removed were split or reclassified rather than finished
([journal](history-2026-09-10-folded-5.md#2026-09-02-docs-lane-b-queue-hygiene)).

**The meal plan recalculates against what you actually ate (Q-187).** The owner's held-back
sentence — *"if you eat too much during lunch it will cut some portions for other meals or vice
versa"* — with the gate answered the same day: *"if choosing one then spread is fine."* The day's
overshoot or shortfall is spread across every remaining meal **at read time**, each row showing the
adjusted figure with `(planned N)` beside it. **The floor is the half that keeps it usable:** a meal
that would drop under 250 kcal is left as planned and the card says why, because a plan that says
*"eat 180 kcal for dinner"* is ignored once and then always. **The entry pointed at the wrong set** —
`fillableMeals` answers which meals are *due enough to log now*, which is the opposite of what is
left to eat; using it would have handed a skipped lunch's calories to dinner. Nothing is stored and
nothing is logged. **Not device-verified, and there is no e2e** — the seed creates no meal plan and
no food logs, so the whole plan card is unreachable from the harness (**LB-51**); the three states
were driven by hand against the local database instead
([journal](history-2026-09-10-folded-5.md#2026-09-01-feat-q-187-plan-rescale)).

**The walk pacer reads speed now rather than the whole walk (LA-52).** `appendPoint` set
`currentPaceSecPerKm` from cumulative distance over cumulative elapsed and the screen fed that
straight into `readPacer`, so the speed rung's input was the **average speed of the walk so far**.
Twenty minutes in, a surge or a slow-down moved it by almost nothing; `STOPPED_KMH` could never fire,
because standing still cannot drag a whole-walk average below 1.5 km/h; and warm-up, fast and slow
all banded against one drifting number. `windowedSpeedKmh` now reads the last **20 s** of
`rawPoints`, carried on the store as `recentSpeedKmh`. **The entry missed half of it: the big
on-screen km/h was the average too** — under a comment claiming both figures came off one series —
so a walker reading 4.8 km/h mid-walk was reading their average since starting. That number is live
now and the min/km beside it is labelled `avg`. **`e2e/walk-pacer-speed-rung.spec.ts` asserted the
two were one number in two units and was updated in the same PR**, since that claim is now false by
design. **Not device-verified** — slowing mid-segment and stopping at a crossing are LB-36's device
checks 2 and 3, which could not have passed before this
([journal](history-2026-09-10-folded-5.md#2026-09-01-fix-la-52-windowed-walk-speed)).

**A Recommended value under every goal field, and no model behind it (BF-101).** The owner asked
for one and assumed AI: *"id assume we use AI here to choose but maybe we could have some logic to
decide so not using the ai if not needed?"* It needs none — `calculateBaseline` already returns a
deterministic figure for every field on that screen except sleep, and the AI route computes that
same baseline before asking a model to *adjust* it. The control now sits under steps, water and
calories, plus protein, carbs and fat in Macro Targets, each naming where its number comes from.
**The matching state is half the feature:** the entry was filed on live drift — the steps goal held
**7,000**, the *sedentary* figure, while the activity level said Moderate, whose target is
**10,000**, and nothing on screen said which fields followed the recommendation. **The measured RMR
is carried through** rather than dropped, so the button cannot quote a predicted resting rate on a
screen whose Health card shows a measured one. **Sleep and fiber get no button** — `BaselineResult`
carries no figure for either, and the guard pins that. **Not device-verified** — six controls land
in an already-dense collapsible at 412 dp
([journal](history-2026-09-10-folded-5.md#2026-09-01-feat-bf-101-recommended-values)).

**One name for the saved list — `My Foods`, everywhere (BF-103).** The owner overrode the entry's own
proposal and was right to: it suggested `Saved` for the tab with `My Meals` left on the button, which
is a *second* name, and **the historical failure was never the wording — it was two labels for one
list.** *"we only need one. lets go with MyFoods."* It also describes the contents honestly: 5 of his
10 saved meals hold exactly one item. Eight files carry the strings, including an **`aria-label`** a
rename would leave saying a name the screen no longer uses. **The two comments from BF-37 and BF-60
that read as a standing prohibition on the name are rewritten** — left alone, they are what the next
session reverts this on. **The guard found what the entry's file table missed: twelve e2e spec files
asserting `My Meals`**, which would have broken CI on the next run rather than at review. It also
pins the strip at `Recent · My Foods · Search`, because `My Foods` was once a *merged* list and that
revert was about the merge, not the name. **Not device-verified** — `My Foods` is longer than `Meals`
and three tabs share the width ([journal](history-2026-09-10-folded-5.md#2026-09-01-fix-bf-103-my-foods)).

**The queue tool stops pointing Lane A at another lane's finished work (LA-53).** `next-item.js`
reads an entry's `Lane:` field and nothing re-reads it when the remaining work moves lanes, so
**Q-535 headed Lane A's READY list for two weeks** after its Lane A half shipped. An advisory note in
`check-backlog-pointers` now names any entry that contradicts itself that way — 0 on the current
tree, and it fires on Q-535's real pre-fix state. **The rule reported its own documentation twice**
before the two exclusions were added (undated prose describing the shape; a dated citation of another
entry), which is the concrete reason it prints rather than fails
([journal](history-2026-09-10-folded-5.md#2026-09-01-lane-drift-note)).

**A fixture that misrepresented production closed one finding and opened a doubt about a shipped fix
(LB-46, LB-47).** LB-46 — the AI Prescription card showing pre-deload numbers — **is not a bug**:
`reevaluateForToday` self-reverts a per-exercise deload once the soreness clears, and the card was
rendering the result faithfully. The tell was on screen and missed: the card suppresses its
intensity-zone chip when an exercise is deloaded, and the chip was showing. **The fixture merged two
mechanisms production keeps apart** — of 5 stored prescriptions, 1 has a session-level deload, 2 have
per-exercise deloads, **0 have both**. A session deload bakes low intensities into the LLM's own
pcts; a per-exercise deload is an overlay with a `preDeload` to undo. **⚠ Which means BF-64's
override, shipped hours earlier, may revert nothing on a real session-level deload** — it reused the
per-exercise mechanism for the session-level case, and on the only real such row there is no
`preDeload` to go back to. Not reverted: nothing regressed and the per-exercise path works. Filed as
**LB-47** with three candidate answers, the cheapest being to disable the toggle on a session deload
and say why. **The lesson is cheap and was available all along:** check a hand-built fixture's shape
against production *before* verification leans on it — the `db-query` call that settled this took two
minutes ([journal](history-2026-09-10-folded-5.md#2026-09-01-docs-lb-46-closed-lb-47-filed)).

**Back navigation returns to where you were (BF-100).** Owner: *"when I press back I want to go back
to that page at the same scroll level I was at. It usually starts me at the top of the page. This is
on many pages if not all pages."* **"If not all pages" was right, and there was one cause** — the app
scrolls an inner container, Next's restoration watches the window scroller, and nothing bridged them.
One hook in `pull-to-sync.tsx`, so every screen on the shell inherits it. **Six implementation traps
and four spec traps are written into the entry and the code**, because every one produced something
that runs and achieves nothing: two separate StrictMode double-invoke failures (a consumed `popstate`
flag; a cleanup writing 0 over a pending target), `scrollTop` reading 0 on a node React has already
detached, scroll anchoring pushing the restore 144–231 px past the mark, a takeover check that
mistook that settling for a finger, and a page that comes back shorter than it left. **All four spec
failures reported the same line a broken feature would**, which is why the spec now asserts its own
preconditions. `e2e/scroll-restoration.spec.ts` is green on a cold server. **Not device-verified** —
the system back gesture is not `page.goBack()`, and WebView scroll anchoring may differ from
Chromium's, which matters because anchoring was one of the traps
([journal](history-2026-09-10-folded-5.md#2026-09-01-feat-bf-100-scroll-restoration)).

**The calorie line called a goal deficit part of the base rate (BF-99).** Owner, with a screenshot:
*"why is my base rate under the 1350 RMR value."* `budgetProvenance().base` is
`restingBaseKcal + targetNetKcal` — the resting base with the goal delta already folded in — and the
line printed it beside the word *base*. On a recomp that is ~200 below his measured RMR, so a goal
choice was presented as a metabolic fact. **Every number on the screen reconciled**, which is what
made it worth fixing rather than explaining: correct maths described incorrectly sends someone
hunting a bug that does not exist. Now `1,972 base − 200 for your goal + 1 earned from movement`,
collapsing to `1,972 base + …` on maintain. Split in the component, **not in `budgetProvenance`** —
that is shared, and one combined number is right for a caller that wants one. **The floor and the
goal maths were not touched and should not be.** The second half shipped too: the measured RMR is
re-scaled onto current lean mass rather than used raw, and nothing said so, so a measurement the
owner paid for looked ignored — one line on the RMR form now says what the app does with it.
**Not device-verified**; the line gained a clause and Home's copy is `compact`, so wrapping at 412 dp
is unchecked ([journal](history-2026-09-10-folded-5.md#2026-09-01-fix-bf-99-base-label)).

**`Full · Override` now overrides something (BF-64).** Owner: *"pressing full or deload doesnt change
the 'prescription' not sure if its over writing it."* It was overwriting **in one direction only** —
`session-data.ts` applies the deload override inside an `else if` that runs only when the exercise is
not already deloaded, so the pipeline could ADD a deload and never remove one, while the toggle
rendered the word **Override**. Worse than the BF-8 bug it descends from: that was the toggle
disagreeing with the card, this was a control that did nothing. Session-level `Full` is now the
per-exercise revert applied to every deloaded exercise — the machinery was already on the device, so
no LLM call, no 429 budget, works offline. **All three of the entry's warnings held:** the override
keys on an *explicit* choice (keyed on `!deload` it would flash full weights on first render); an
exercise with no `preDeload` stays deloaded **and the card names it**; and 1RM accounting follows
without a separate change, because the revert clears `deloaded` and the completion path already reads
the reverted array. Five mutations, five failures, including that last one.
**Verified only against a hand-built fixture — the local seed has no `ai_dynamic` program and zero
prescriptions, so the path is unreachable out of the box — and NOT on device**, which is where
completing a set under each toggle position would show the 1RM actually count or not
([journal](history-2026-09-10-folded-5.md#2026-09-01-fix-deload-full-override)).

**The e2e README told spec authors the opposite of what was measured (Q-354).** On Nutrition a
`.click()` is swallowed and gives no clue — no toast, no request, no error, just silence — while a
touch works every time; the cause is the date-swipe `useDrag` on the scroll container, and it is
deliberately unfixed because touch is the only input the canonical runtime has. The README said
*"a real touch sequence does not open the water sheet while a synthesised `click` event does"* —
Q-309's pre-measurement suspicion, never updated when `water-log-write-path.spec.ts` measured the
reverse the same week. **A wrong signpost costs more than none, because it is followed:** anyone
hitting a dead tap would have concluded touch was broken and reached for `dispatchEvent('click')`,
the workaround that spec had deliberately abandoned. Corrected, along with that spec's own
*"the gesture code is not implicated"* conclusion, which reasoned about the touch path while
`useDrag` binds mouse too. **Q-354 is now a `Reference:` entry** — its own text says *do not pursue*,
and while it sat in READY it headed Lane B's work list, offering every session a build it argues
against ([journal](history-2026-09-10-folded-5.md#2026-09-01-docs-q354-nutrition-tap-gotcha)).

**A score-ring arc that could not be drawn is gone (LA-42).** `ScoreDisplay` took a
`trainingBoostFrom` and drew a second brand-coloured arc for the share of an activity score that came
from a same-day training blend. `blendActivityScore` went with Q-284, so `adjustment` is a literal 0
at **both** of that payload's construction sites and the branch was unreachable. **Not a
regression** — the blend last had an Oura score to adjust on 2026-07-07, the re-key day, so it had
been dead in practice for two months; Q-284 made it dead by construction, which is the difference
that licenses a deletion. **No guard and no version bump, both deliberate:** the invariant a test
could pin lives in Lane A's file and would block the revival it is meant to protect, and nothing a
user can see changed. All three score screens re-rendered with their rings intact
([journal](history-2026-09-10-folded-5.md#2026-09-01-chore-la-42-drop-dead-training-boost)).

**The device consoles have one home, and the BLE page is a runbook (Q-531).** Owner, running the
re-sync: *"it was moved away from the admin section = bad"* and *"everything is spread out
sporadically."* **The first half was already false and checking it changed the work:** all three
consoles were routed under `/admin` and `isAdminUser`-gated the whole time — Q-234 moved the *links*
to Settings → Developer, so the owner went to `/admin`, found nothing listed, and reasonably
concluded they had left. A **reachability** defect, needing the opposite fix from the one the entry
proposed; building it as written would have been a no-op dressed as a security fix. `/admin` now has
a **Devices** tab, `/admin/oura-ble` is six numbered sections in §4-of-the-runbook order instead of
fourteen stacked consoles, and Settings → Developer keeps Diagnostics only.
`device-console-access.test.ts` pins the gating, the reachability, the one-home rule and Q-544's
card ordering — five mutations, five failures. Non-admin redirect verified on all three routes.
**Not device-verified, and here that is most of the value** — every console below step 2 needs the
native plugin, so the structure was checked and the flow was not
([journal](history-2026-09-10-folded-5.md#2026-09-01-fix-device-console-ia)).

**The screens show the DEXA-corrected body fat now (LA-45).** BF-2 step 4 put
`bodyFatCorrected`/`bodyFatIsCorrected` on every row of `/api/body-metadata` and `/api/day-log`, plus
the offset once per response — and **nothing read any of it**, so Health showed the raw 18.4 while the
calorie goal was already built from the corrected 21.6. Seven surfaces now go through one rule
(`components/health/body-fat-display.ts`), and the card says why its number differs from the scale:
`DEXA-corrected +3.2% · 1 scan compared`, with `3 of 4 corrected` on a window that mixes instruments,
because two thirds of the history is on instruments the offset does not cover. **Two invariants hold
it and both are easy to reverse:** `bodyFat` stays what the log sheet seeds from (it POSTs at `manual`,
which outranks `scale_ble`, so a corrected value round-tripped through the edit sheet would overwrite
the measurement permanently), and "corrected" is never inferred from the values differing, since an
offset can round to zero. Verified on `pnpm dev` against a hand-seeded DEXA pair — the local seed has
none, so the whole path is unreachable without one — including the case that matters: the card read
21.6 while the log sheet seeded 18.4. **Not device-verified**, and the local-store fix inside it is
only reachable on the APK
([journal](history-2026-09-10-folded-5.md#2026-09-01-feat-la-45-corrected-body-fat-display)).

**The More page is two groups, not nine (BF-82).** Owner: *"a review of all the pages/chevrons in
the More page and reorganize/group things together that can be. It’s very messy and not very
organized."* `MoreRowGroup` is an uppercase heading plus a bordered container, and **nine of them
wrapped exactly one row** — seven on the tab, one on the Settings sub-screen, and one hand-written
copy in `feedback-section.tsx`; `goals-section.tsx` was a tenth copy, which is what made an inline
disclosure look like the navigating rows below it. Now: `Your setup` and `App`, each covering three
or four rows; `label` is optional on the primitive so one row can be a plain card; Report an Issue
moved to the bottom actions where the other sheet-openers are; Goals presents as a card like
`StatsGrid` and `TrophyCase` above it, with its disclosure untouched.
`more-row-group-arity.test.ts` fails a labelled group under two rows and was mutation-verified.
**Destination parity was clicked, not read** — all seven rows still land where they did, admin and
non-admin. **✅ Verified on the S25, 2026-09-13, and the entry has left the queue** — with the owner's grumble
recorded rather than converted into work: *"Still not as organised/separated as I would like it to
be."* No second group was named and nothing was pointed at, so there is nothing to act on; a pass
with a complaint is not a defect, and inventing the fix invents the requirement too. **The *"sliders"* half is
answered — the word was loose:** *"yes it wasnt the sliders specifically; more that its messy and
needs re'organisation."* No control changes, and none should be made off the original wording —
More and its six sub-screens carry no slider and no `<select>` at all
([journal](history-2026-09-10-folded-5.md#2026-09-01-feat-bf-82-more-page-grouping)).

**The Home pill that "moved" had not moved, and a swipe marker nothing read (BF-96, BF-95).** Owner:
*"I dont like how the temperature/uV pill sits. can we go back to the old way when it was side by
side."* It was already side by side — it was **wrapping**, because the header row's other item (the
date) carries `whitespace-nowrap shrink-0` and the chip carried neither, so the chip absorbed every
shortfall and `UV 5` broke at its own space. Measured against a real render, `EEEE d MMMM` runs
**12–22** characters (*"Wednesday 30 September"*), correcting the entry's own 12–20 — so *"the old
way"* is the same code on a shorter date. Separately, `swipe-actions.tsx` declared
`data-swipe-actions` and the tab navigator's exclusion list never read it: latent rather than
impossible, since the navigator arms within 24 px of the edge and meal rows reach it. **Neither is
device-verified, and the chip cannot be — the seeded sandbox has no weather snapshot, so only the
skeleton renders** ([journal](history-2026-09-10-folded-5.md#2026-09-01-chip-wrap-and-swipe-marker)).

**A meal section holding one combined meal printed its macros twice (BF-98).** Owner: *"the combined
item UI doesnt look great with the double macros at the bottom."* The totals footer was gated on
`logs.length > 1` — the flat list — so a group of three ingredients passed it and the section drew
the group's own macros and then the identical footer, calories included. It counts **rendered
entries** now, which is the rule the collapsed branch twelve lines above already followed.
**⚠ The duplication could not be reproduced in e2e** — `diary-nested-meal.spec.ts` seeds this exact
case and the footer does not render there on either condition, so a test written against it passed
with the fix reverted and was deleted rather than kept as a guard that cannot fail. The change is
right by reading and is held by a mutation-checked source guard; **what differs between the owner's
diary and that fixture is an open question recorded on the entry.** **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-double-macros-footer)).

**The app notices the day changed on resume, without restarting (BF-86).** Owner: *"when I open the
app in the morning and it just resumes, it doesn't give me the morning check-in."* The cause was
structural — the tab shell never unmounts, so an effect keyed on `[userId, tz]` ran **once per app
launch** and nothing re-asked what day it was. `LocalDayProvider` re-evaluates the local date on
mount and `visibilitychange` and exposes it as a value, so subscribers key an effect on it: the
workout store's `todayLogged` (which is where the listener came from — it moved up rather than being
copied), the check-in prompt, and the today-mood read. **The requested "close / full reset" is
deliberately not built** — BF-80 forbids fixing a resume with a reload, and the signal delivers the
ask without trading instant paint for a spinner. The e2e test drives Playwright's clock across local
midnight so the case fires on every run; **its first version passed with the fix reverted**, because
`isVisible()` is a point-in-time check and not a wait. **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-local-day-rollover)). **The half this deliberately
deferred shipped as BF-117 on 2026-09-04** — the rest of Home, plus Health and Nutrition, now follow
the day too, via `useDayRolloverRefresh` in the same file
([journal](history-2026-09-10-folded-6.md#2026-09-04-bf-117-rollover-refetch)).

**A peaking week stops reading as a volume deficit (BF-59, the screen's half).** Owner: *"i did the
full sessions for the week; and i was nowhere near hitting the reccomended amount of muscle sets"*,
then the cause in their own words — *"oh yes cause its realization phase its been less sets."* MAV is
an **accumulation** target, so showing it during a peak tells an athlete that doing the right thing is
wrong. **Both halves were measured in production first:** the stored targets are a flat binary (15
rows, all 14 or 10) that ignores both the per-muscle landmark table and the program's `powerbuilding`
×0.8, and the ten sessions span **three phases at once** — which is what makes "this week's phase"
unstorable, since phase lives per program session. The Training card's target is now **derived** —
`volumeLandmarks(goal, muscle)` scaled by the week's phase mix, weighted by sessions actually
trained — and `/api/weekly-muscle-sets` returns the `phase` block behind it. Multipliers are the
owner's (accumulation 1.0 · intensification 0.8 · realisation 0.6 · deload 0.5). **Two things are
owed and both are on the entry:** `signals.ts` still steers the AI's set prescription off the stored
binary, so **engine and screen now disagree** where before they were wrong together; and the card
does not print the phase yet, which is Lane B's half and the half the owner explicitly asked for.
**Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-phase-aware-volume-targets)).

**A scanned meal now carries a group and a name — the engine half (BF-97, migration 252, local
SQLite v33).** Owner, with two screenshots: *"looks like saved meals groups the food well; but when
scanning it doesnt."* BF-39's grouping was right and did not cover this: it names a group from its
`saved_meal_id`, and `groupDiaryEntries` **refuses to head a group it cannot name** — so a scan, which
has no saved meal, cannot group. `food_logs.meal_group_name` is that name, denormalised onto every
row for the same reason `meal_group_id` already is: a group **is** the rows sharing an id, and the
local store must draw the header offline with no join. `logFoodEntries` mints a group **only**
alongside a name and **only** past one entry — both negatives are asserted, because a group of one
renders as a meal for a frame and then does not, and a nameless group rebuilds the bug one layer
down. Five mutations across the write/delta/push chain, five caught. **Nothing looks different yet
and that is deliberate:** the rendering rule is Lane B's half, so this cannot half-break the diary.
**Not device-verified**, and the local-SQLite half is verified by reading rather than running
([journal](history-2026-09-10-folded-5.md#2026-09-01-scan-meal-group)).

**Blood panels are stored, de-identified (BF-1, engine half — migrations 250/251).** The schema is
written from the owner's real 58-analyte report rather than a description, and four shapes in it broke
every simpler design: `<0.2` is a result that is **not a number** (`value_num` + `value_operator`),
ranges arrive two-sided, one-sided in both directions and absent (both bounds nullable), the date is
a **month** (a precision column, or every panel lands on the 1st and lies), and flags are commentary
— *"Normal (athletic)"* on a creatinine inside its range — so **out-of-range is derived from the
bounds, never read off the flag**, with `unknown` as a real answer where a bounded result cannot
decide. Two guards fired and both were right: the `claude_ro` generator refused to emit an unscoped
view for the child table, and the dead-method check rejected a repo method whose consumer this PR
does not contain. **The extraction route, the consumers and the whole UI are still owed**
([journal](history-2026-09-10-folded-4.md#2026-09-01-blood-panel-storage)).

**21 MB of index for a code path nothing calls (BF-55, migration 249).**
`oura_heartrate_user_updated` was migration 130's keyset index for `getOuraTimeseriesDelta` — the
restore pull Q-180 kept with no caller because *"it costs nothing at runtime"*. True of the method;
the index was never in that accounting. Measured twice a day apart: **`idx_scan` 0, `idx_tup_read`
0, 21 MB** — a quarter of the database's whole index budget — while the same table's other index
showed **47,922 scans / 22.7 M tuples**. Dropped with the owner's conditional approval; the method
and its tests stay, and its doc comment now carries the `CREATE INDEX` the restore driver must run.
**The entry falsified its own rule and that is the durable part:** `idx_scan` counts reads, not
constraint enforcement, so three of its four zeros were PK/UNIQUE indexes — `rr_intervals_pkey` read
0 one day and 5,034 the next ([journal](history-2026-09-10-folded-5.md#2026-09-01-drop-unused-hr-index)).
**Steps count from the first one (BF-88, v1.418.0).** The first 3,000 steps of every day used to
earn nothing, because the resting base already assumed a desk day's walking. The owner asked the
version of the question that works — *"cant we remove some calories for the base 3000 and have it
start from 0 steps?"* — and that is what shipped: the credit comes out of the base, the steps are
counted. **A day at 3,000 steps burns exactly what it did before** (verified live: base 2087 +
active 110 = 2197, the old base to the kcal); below it the day drops, which is the point. The
calorie target does not move. `STEP_BASELINE` is renamed `STEP_BASE_CREDIT` because a test pinning
3,000 cannot notice a change of meaning, and the rename is what found the three copy sites BF-87
had shipped hours earlier. Two mutations survived their first tests — the credit applied on the
calibrated path as well, and the credit taken off the maintenance target too, which cuts recommended
intake by ~100 kcal a day and passes every relative assertion. **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-step-base-credit)).

**The E2E harness already looks; what it cannot do is take a photo (BF-91).** The entry read *"58
specs assert nothing visual"* — **21 of the 58** assert layout, and the four flows it named already
have dedicated specs. What is genuinely absent is pixel baselines, and a session cannot make one:
the sandbox Chromium is **141** while CI installs **151**, so a committed baseline fails on its first
run. Split out as LA-50 with what a CI-side job would cost. The real gap was BF-73, whose measured
numbers sat in its `Keep:` and nowhere else — now pinned as ratios, along with the finding that
`globals.css`'s bare `button { min-height: 48px }` is what lifts those controls off 44. **Deleting
that one CSS line turns the spec red**, which no source-level check on the classes would notice
([journal](history-2026-09-10-folded-5.md#2026-09-01-e2e-layout-assertions)).

**The prune that was working, and the retraction that matters more than the entry (BF-93).** A
session reported `error_events` never prunes — no `DELETE`, no cron, no trigger — and wrote that
into CLAUDE.md, the file every session reads first. The `DELETE` is in `insertErrorEvent` and has
been there since the initial public snapshot. **The evidence for the finding was the prune working:**
it fires from a write path, not a scheduler, so it runs only when a fault is recorded, and faults are
now rare — measured, last write **2026-08-30**, oldest row **2026-07-31**, span exactly **30 days**,
the cutoff computed from the last write to the day. Reading the age against *today* instead is the
whole mistake. CLAUDE.md is retracted, `export-map.ts` was right and is untouched, and a behavioural
test now pins it because **a grep is what failed the first time**. Owner confirmed: leave the prune,
skip the message truncation — under a working prune those rows age out on their own
([journal](history-2026-09-10-folded-5.md#2026-09-01-error-events-prune-refuted)).

**A chosen rest day is a fact now, not a `localStorage` key (BF-84, engine half).** The route it
posted to persisted nothing — its own comment said rest is inferred from gaps in workout history —
so the choice never reached the server, the second device never saw it, it died on a reinstall, and
refetching `/api/next-session` reverted it. Owner settled it as a fact: *a day with no logged
workout is also a day you forgot, were ill, or logged late.* `rest_days` (migration 247) holds it,
tombstoned on withdrawal, written through a new `rest_days` outbox domain so an offline choice is
carried, and `getNextSession` prefers it over inference — after already-trained, before the
readiness branch that would otherwise offer a deload on a day you said you were resting. **The
surface half is Lane B's and still owed**; the storage shipping first is what makes the new button
safe. **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-rest-day-stored)).

**A gate that did not gate, and the count the owner was given (BF-90).** Asked whether his
decisions were the bottleneck on the queue, the answer is **10 of 41** — device verification was the
other 31, and eleven of those sat on entries whose own headings said *"shipped; device check owed"*.
`Gate:` parks an entry, so finished work was filed beside work that cannot start. `Verify: owner` /
`Verify: device` is now the second meaning, with its own section that does **not** park; `Gate:`
means blocked, uniformly. **Seventeen converted, not eleven** — `keepKind` found six more from their
own `Keep:` residue. PARKED 114 → 97, READY and KEEP unchanged. The larger half is measured and
deliberately deferred: **34 entries carry a `⛔` and only 7 mean blocked**, but narrowing that
detector would move 16 untriaged entries into READY, so it is filed as LA-49 with the order to do it
in ([journal](history-2026-09-10-folded-5.md#2026-09-01-verify-vs-gate)).

**An account with a password could not change it (LB-40).** `EditProfileSheet` initialised
`hasPassword` to `false` and **nothing fetched it**, so the *Current password* field never rendered,
the PATCH went up without it, and the route answered *"Current password is required."* — an error
naming a field that was not on screen. The flow was non-functional for every account with a
password and worked only for one with none. The flag is fetched now, through the key the More tab
already warms; **unknown shows the field**, because `cachedFetch` swallows a failed request and
landing back on `false` would reproduce the bug silently. All four route paths exercised live.
Found by reading during BF-79, not by looking for it. **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-current-password-field)).

**A display constant stops being a copy, and the leaf module it moved into already existed
(LB-43).** BF-87 took the Nutrition tab to a 500 fetching `STEP_BASELINE` for a line of copy —
`daily-energy` → `workout-energy` → `oura-models/constants` reaches `node:fs/promises`, and
Turbopack refuses the client chunk. **The same chain broke the same tab before** (Q-401, with
`node:path`), and the fix then was `energy-baseline.ts`, a leaf module importing nothing. The entry
proposed creating `energy-constants.ts`; that module already was it, so the three constants moved
there instead of standing up a second leaf module for one purpose. **The drift test that guarded
the mirror is now tautological and was replaced** — a re-export cannot disagree with itself — by
the invariant nothing else checks: `energy-baseline.ts` imports nothing at all, which is the only
property keeping it client-importable and the one that broke twice
([journal](history-2026-09-10-folded-5.md#2026-09-01-energy-constants-leaf)).

**Two settings that did nothing, both decided by the owner (LB-41, LB-29).** The **Kg / Lbs switch**
was `useState('kg')` — never persisted, never read, reset on every reopen, and nothing in the app
renders pounds; removed rather than left offering what it could not do, with real unit display
filed as the feature it would actually be. **⚑ 2026-09-10 — it was NOT filed.** No such entry
existed anywhere; the claim was written and the follow-up dropped in the same breath. It exists now
as **BF-141**, prompted by the owner asking for a lb/kg toggle on the weight dial — scoped to
conversion at entry rather than the pounds-everywhere display this line implied. And **a setting could be overwritten by the server's
older copy**: `savePreference` PATCHes fire-and-forget, so a reload before it landed was answered
with the previous value — permanently offline, where the PATCH never lands. The owner chose *the
change follows to other devices* over the simpler never-clobber rule, so hydration now skips a key
whose PATCH is unacknowledged and **re-sends** it, which self-heals offline on the first launch with
a network. Verified in a browser with the PATCH held open: the choice survives the reload. **Not
device-verified** ([journal](history-2026-09-10-folded-5.md#2026-09-01-settings-that-did-nothing)).


**The calorie bar says why zero is zero (BF-87).** Owner: *"is basic steps being counted towards
calorie burn? It says I've done 1000 but not sure if that's counting towards nutrition."* The app was
right and the screen could not say why — only steps above 3,000 earn calories, because the sedentary
base is already BMR × 1.2 and a desk day's stepping sits inside it. The zero line now names the
threshold, the earned line breaks into workouts/activity/steps, and both "calories out" explainers
quote the same number instead of "a baseline". The breakdown was first built with largest-remainder
apportionment; re-reading `daily-energy.ts` showed `computeActiveEnergy` **already rounds all three
parts** and `total` is their sum, so that was guarding a case its producer cannot produce — deleted,
and replaced by a test pinning that guarantee against the real function.
Importing the constant took `/nutrition` to a **500** — `daily-energy` → `workout-energy` →
`oura-models` reads `node:fs/promises`, and no client component had ever imported it — so the value
is mirrored with a test that fails if it drifts, and **LB-43** (Lane A) proposes the leaf-module split
that deletes the mirror. **Not device-verified**
([journal](history-2026-09-10-folded-5.md#2026-09-01-steps-threshold-copy)).

**The personal details are one screen, and one writer (BF-79).** Owner: *"can we combine all the
personal information fields into 1 section in the more/details."* They were split between the Edit
Profile sheet (display name) and the Goals accordion (height, birth year, biological sex) — and
until BF-78 each editor resent the other's fields from a possibly stale copy. `More → Profile
details` (`app/more/details/`) now holds all four, with **weight and body fat read-only** beside a
link to where they are logged — an input there would open a second write path into `body_metrics`.
Targets and activity level stayed in Goals, so the split closed rather than moved, and Goals gained
an *Open Profile details* button because it still demands fields it can no longer edit. Reading the
same two components filed three findings rather than fixing them — **LB-40** (a user who already has
a password *cannot change it*: the form never renders the field the route requires), **LB-42** (two
columns for one weight goal, with different readers, so the number the user sees and the one the AI
is told can differ — Lane A), **LB-41** (a Weight Units toggle with no consumer). **Not
device-verified** ([journal](history-2026-09-10-folded-5.md#2026-09-01-personal-details-consolidation)).

**The quantity box on Assign to Meal centres (BF-85).** Chromium draws the spin button inside the
box, so `text-center` sat left of centre; and `text-sm` was inert under `globals.css`'s
`input { font-size: 16px !important }`. The entry's own fix — use the shared `Input` primitive —
was wrong: **1 of 28** `type="number"` inputs uses it, and neither quantity control does. **Not
device-verified** ([journal](history-2026-09-10-folded-5.md#2026-09-01-quantity-box-spinner-reset)).

**One weight goal, one column (LB-42).** `users` carried **two** columns for one goal:
`weight_goal_kg`, edited on the profile sheet and quoted to the nutrition coach as *"goal weight"*,
and `target_weight_kg`, edited in Goals and the one the Health page actually renders. The number the
user sees and the number the AI is told could differ with nothing reconciling them. Migration 246
fills the survivor **only where it is NULL** — a value the user cannot see never overwrites one they
can — and the API keeps its `weightGoalKg` field name while reading and writing
`target_weight_kg`, which is what let both editors converge with **no client change**. **The retired
column is NOT dropped**: nothing reads it, but dropping is irreversible and the row-scoped audit
view cannot show other accounts' values, so that is the owner's call. Honest about the evidence —
the owner's two columns **agreed**, so this closes a hazard rather than an observed wrong number
([journal](history-2026-09-10-folded-5.md#2026-09-01-one-weight-goal)).

**The deload banner stops firing off a temperature baseline that is known to be wrong (TN-18).**
The owner's 06:43 screenshot held both halves of the same broken baseline for one night: the
readiness contributor scored temperature **80/100** off `temp_dev_c` = 0.519 °C, while the deload
banner read the same number and said *"Body temp elevated — rest or deload recommended"*. TN-6a
suspended the ladder in readiness and its own entry said the suspension must cover all three
consumers; it covered one, and it was the path the owner does not read. The banner now takes the
same `isTemperatureBaselineCentred` condition — imported, not re-derived, since two answers to "is
temperature trustworthy" is what produced the disagreement — and the threshold is untouched, because
raising it is the Q-504 mistake. **The fix needed the adapter's summary read widened to 28 days,
which turned `summaryRows[0]` from *today* into *the oldest of 28 nights*; the first version of the
new test file passed with a month-stale deviation feeding the banner.** Self-clearing: it lifts on
its own once a re-derivation centres the deviations
([journal](history-2026-09-10-folded-4.md#2026-08-31-deload-temp-gate)).
**Coach can be scoped to one subject, and the scope is made of what it never receives (LA-47).**
Opening Coach from Nutrition will give it the meal plan, intake and targets — and **not** the
training tools, so a program question produces a hand-off instead of a guess. Enforced three ways
the model cannot argue with: the training tools are absent, and `renderChoiceList`'s `source` and
`proposeChange`'s `domain` enums are **rebuilt narrowed per request**, so an out-of-scope call is a
schema error the SDK retries rather than a request anything downstream has to refuse. Verified
against a real Gemini turn in both directions. `general` withholds nothing, so every existing
caller is unchanged. **A bug the tests caught and review would not have:** `value in COACH_SCOPES`
walks the prototype chain, so `scope: "toString"` resolved to `Object.prototype.toString` and would
have crashed the request. **The plan-widget half did NOT ship** — the entry proposes splitting it
across lanes and that split does not compile, since a new widget-union member is a type error until
the registry handles it, and a branch rendering `null` wedges the thread outright
([journal](history-2026-09-10-folded-4.md#2026-08-31-coach-nutrition-scope)).

**A dead WebView renderer is handled instead of fatal, and it now leaves evidence (BF-80).** The
owner's *"tab back into the app and the pages often crash and display a blank page"* had **nothing**
in `error_events`, and that silence is the finding: `app/error.tsx` would have painted a fallback
and filed a row for a JS exception. Reading the pinned Capacitor source settled the rest — its
`BridgeWebViewClient` **already** forwards `onRenderProcessGone`, so the app was never missing a
`WebViewClient` (which is why grepping `android/` for `RenderProcess` came back empty while the
behaviour persisted); what was missing was a listener, and the default answer it left in place is
the documented *"kill the app"* one. The handler now returns `true`, records the death with
`didCrash`, and posts `recreate()` — posted, because the callback runs with the dying WebView on
the stack, and `reload()` cannot work on a WebView whose renderer is gone. The recorded death
becomes an `error_events` row on the next boot. **Not verified: this needs an APK on the S25**, and
until that first row appears the diagnosis is still a hypothesis — but the behaviour it replaces is
process termination, so the handler is right either way
([journal](history-2026-09-10-folded-4.md#2026-08-31-renderer-recovery)).

**A night that is still filling now says so, and the program builder knows you are injured
(BF-83, BF-68).** The owner sent two screenshots of the **same night four minutes apart** — 6 h 15 m
then 7 h 40 m, with the 30-night average it was compared against moving too. The entry offered two
mechanisms; the answer was a third. Production shows the batch covering the missing 82 minutes was
**recorded at 6:42**, two minutes before the earlier screenshot: the raw data was there and the
*row* was stale. So the measure is the **rollup watermark**, which only advances when a run
completes — a test against the newest ingested sample would have called that night settled four
minutes before it grew. `/api/sleep-sessions` returns `provisional` per row; the badge and
excluding a provisional night from its own average are Lane B's. Separately, `injur` appeared
**zero times** in the whole program-builder path. Both builder routes now filter the **candidate
list** — not the prompt — with the predicate the mid-workout swap sheet already substitutes by, so
the builder cannot program an exercise the swap sheet would offer to replace, and a Good Morning
(a hamstring exercise that loads the back in a secondary role) is excluded where an instruction
would have missed it ([journal](history-2026-09-10-folded-4.md#2026-08-31-lane-a-sleep-provisional)).

**A logged meal stops breaking apart, and two nutrition controls stop meaning the wrong thing (BF-72/73/74/76).** The owner's *"it starts as the meal with the image, then breaks into its ingredients"* was the diary hydrating from the server and **omitting `savedMealId`/`mealGroupId`** — a local upsert overwrites every column it is given, so the screen stripped its own grouping and then rendered the stripped copy. There are exactly two `applyDelta` callers and the sync engine's was already correct, so this was the one site BF-39's audit did not reach. The meal photo's ✕ **sat where the sheet's close button would be** — and the sheet passes `hideCloseButton`, so it was the only ✕ on screen: a reach for dismiss deleted the photo. It is a bin at the bottom-right now, with undo. Capture tiles went **60 px → 79 px** and `New` now outranks a small delete bin. **Two findings came out of it that outlive the batch.** `min-h-[Npx]` **does nothing on a `<button>`** — a bare `button { min-height: 48px }` in `globals.css` beats the utility (measured: 48 px on a button, 84 px on a div), so BF-50's documented "62 px" tile actually measured 60; filed as LB-32. And **BF-76's safe-area sweep found the opposite of what it expected** — nothing in nutrition is under-padded, three sheets are *over*-padded by declaring the inset on both the content and the footer, and the `vh`→`dvh` hypothesis is not the mechanism at all, since a bottom sheet is `fixed bottom-0` and its height moves only its top edge. No padding changed: every available fix costs more than the 12–24 px it saves ([journal](history-2026-09-10-folded-4.md#2026-08-31-nutrition-uplift)).


**A red check took an hour to prove innocent, and the hour is the finding (LB-31).** `body-battery`'s anchor-precedence test failed on CI in code this branch does not touch. It did **not** reproduce: the failed job re-run on the identical commit passed, and the full suite passes locally against a freshly migrated database — so it is a flaky test, **not** the red `main` the first reading suggested. The mechanism is still worth fixing: those three assertions are cumulative on one user, and the route under test calls `buildReadinessPayload`, **which persists**, so step 2's own sleep insert can land the readiness step 3 is meant to establish. The durable half is that `ci.yml` has no `push: [main]` trigger — correctly, and for reasons written into the workflow — so nothing verifies the *combination* after several independently-green PRs land together, and there is no signal that separates "flaky test" from "main is broken". That is what cost the hour.

**CI caught the defect LB-30 was filed to describe, on the exact line the fix was already written for.** `food-log-swipe-delete`'s *"the first tap on Delete opens the confirmation, **even mid-animation**"* went red: the spec read `boundingBox()` while the row was still sliding to its resting offset, then dispatched a CDP touch at that coordinate — and `Input.dispatchTouchEvent` performs none of the actionability checks `locator.tap()` does. **It passes three times over locally without the fix, which is the race's signature rather than a reason to dismiss it**; the window only opens when the runner is slow enough for the animation to outlast the read. `stableBox` is exported now with `tapCentre` beside it. The audit that came with it corrects the entry's own framing: of 32 coordinate taps, **21 sit inside a `toPass` retry and are safe**, 11 had a single measure, and **6 more feed a geometry *assertion*** — a class the entry did not cover, and worse, because a moving box gives a wrong verdict rather than a missed tap ([journal](history-2026-09-10-folded-4.md#2026-08-31-stable-box-coordinate-reads)).

**Three sheets said their own name twice (LB-23).** Radix needs a `SheetTitle` for the dialog's accessible name, so each carried an `sr-only` one *beside* the visible `<h2>` — read once as the panel's name, again as a heading. `<SheetTitle asChild><h2>` is one node that is both. `quick-edit-log-sheet` keeps its `sr-only` title and is correct: its visible header is the food's name, a different string, which is why the new guard matches on the **text** rather than the class — banning `sr-only` outright would have failed a working file ([journal](history-2026-09-10-folded-4.md#2026-08-31-sheet-title-duplication)).

**The exercise clip reaches the ready screen, and the fetch behind it stopped multiplying (BF-65).** The owner wanted the movement shown on the screen where they are about to do it. The work was the *fetch*: the same `/api/exercise-gif` call was hand-rolled in **four** places, so this would have been the fifth — `lib/hooks/use-exercise-media.ts` is now the only one and all four are converted. **The shared `exercise-media:<name>` key is the feature**, not plumbing: the warm-up screen fetches every exercise in the session and then unmounts, so the ready screen paints from its cache instead of showing a spinner for a file downloaded sixty seconds ago. The layout question the entry flagged answered itself — at 64 px beside the name, **`SET TARGETS` is now fully visible**, where the owner's screenshot had it cut off behind the action row. **Nothing animated was rendered at any point:** the dataset host is dropped by the sandbox proxy, so every clip here is blank — including the warm-up screen's own untouched thumbnails, which is how that was established as the environment rather than the change ([journal](history-2026-09-10-folded-4.md#2026-08-31-exercise-clip-ready-screen)).

**Energy Balance was estimating a resting rate you had measured (BF-42).** You entered your RMR test on the S25 today — 1325 kcal at 51.5 kg fat-free mass — and the goal wizard started using it while the Energy Balance card kept predicting **1481**. Two screens, two resting rates. **The estimate was also the floor** under the calibrated maintenance, so it clamped the calibration up by 156 kcal: it could not report a lower number even when your own data said so. Both now use the measurement, re-scaled onto today's **DEXA-corrected** lean mass — the two sides of that re-scaling have to be on one instrument, and the raw scale reading would credit fat-free mass you don't have. **My first test for that could not have failed**: it asserted a direction on a pure function rather than what the service does, and the mutation survived it; it now asserts the exact number through the service ([journal](history-2026-09-10-folded-4.md#2026-08-31-measured-rmr-daily-model)).

**Your stress strip and your stress number were two different calculations, and they disagreed about the day (BF-81).** You asked what was happening with the stress indicator. The pipeline runs — 9–14.5 hours of coverage a day, current to today — but the strip came from the rollup and the number came from `/api/body-battery`, each building its own series from a different heart-rate baseline. Re-measured before fixing: **the sign disagreed on 6 of the last 8 days**, and high-stress minutes by 4–8× (the strip saying 2–4.5 hours where the number said none). One producer writes both now. **The filed fix would have been worse than the bug**: deleting the route's write, as the entry recommended, would have left all three columns with *no* writer — the rollup only ever stored the strip — and the weekly digest reads one of them. **Two things stay open for you**: correcting the days already stored needs a full re-read of the ring's history (only 8 of 38 rows can be re-derived without it, which would leave the column more mixed, not less), and `chronic_stress_score` has never been produced on any of 106 rows — that is its documented 21-night gate needing a wide pass, not a fault ([journal](history-2026-09-10-folded-4.md#2026-08-31-stress-one-producer)).

**Saving one profile field would have erased four others, and it had not fired yet (BF-78).** `/api/user/profile` is a PATCH by name and was a PUT by behaviour: display name, height, date of birth and weight goal were written unconditionally as `?? null`, so any body omitting them nulled them — and accepting an activity-level recommendation sends exactly one field. Height feeds the BMR fallback, so a single tap would have moved your calorie targets, not just cleared a profile line. **Confirmed latent**: production still holds all four. **The entry's fix would have been half of one**: the route mapped every field through `?? undefined`, collapsing "sent as null" into "omitted", so guarding the adapter alone would have traded a wipe-everything bug for a clear-nothing one. Both halves are fixed, `timezone` is explicitly the column a null must not clear (a user without one has no "today"), and **both defensive resends are deleted** — one of which was itself a hazard, resending your name from a possibly stale prop. Verified through the real route: one-field PATCH touches one field, `heightCm: null` clears, empty body is a no-op ([journal](history-2026-09-10-folded-4.md#2026-08-31-profile-partial-patch)).

**The barcode picture was fetched every time and thrown away five times (BF-70).** Your scan of `LOADED MAC & CHEESE` logged with a placeholder tile — and the thumbnail had been downloaded successfully before that happened. The entry traced four layers that discard it; there was a **fifth** it had not found, the web save path. **Why it survived:** `create-food-item.ts` read the image off the sanitiser's return, which *declares* the field and never sets it — so the line that dropped the picture compiled cleanly and its own comment said it carried one. Deleting that declaration is what makes the mistake a compile error, and a new check keeps it deleted. **A `@ts-expect-error` in a test could not have held it**: `tsconfig.json` excludes every `__tests__` folder from typechecking, so type assertions written there are inert while reading as guards — worth knowing beyond this fix. Barcode scans are also recorded as `barcode` now rather than `ai`, which is why only 3 of 221 rows had ever carried the right label. **Proven against the real Open Food Facts API**: a live lookup stores a 5,359-character thumbnail and `source = barcode` ([journal](history-2026-09-10-folded-4.md#2026-08-31-barcode-image-chain)).

**The DEXA correction is finished and the chain works end to end — but no screen shows it yet (BF-2, all four steps).** The correction is **+3.2 points**, derived from pairs pulled out of `dexa_scans` × `body_metrics` rather than stored, so **no new table and no migration** — and a second scan re-derives on its own: verified, offset **3.2 → 2.6** and `pairCount` 1 → 2 with no entry step, which is the accumulation you asked for. It is an **offset, not a ratio**: with one pair they agree on the measured point and diverge everywhere else, and only the offset makes no claim about readings never observed. **Entering a scan through BF-71's new form (More › Health › DEXA & RMR) makes it live with no other action** — one POST moved resting burn **1832 → 1773 kcal/day** and the calorie goal **1961 → 1889**, with `body_metrics.body_fat_pct` still reading the raw 25.3. **The safe-looking design was the wrong one:** correcting inside the shared `listBodyMetrics` read would make a missed consumer impossible, but the Health log sheet seeds from that read and POSTs back at source `manual`, which **outranks `scale_ble`** — so saving an untouched field would overwrite your own measurement and collapse the next calibration toward zero. It is applied per consumer instead, with `check-body-fat-correction.js` (Custom Rules, 64) failing CI on one that forgets — **two rules, because the calorie goal never calls a deriver at all**. The payload carries `bodyFat` (raw), `bodyFatCorrected` and `bodyFatIsCorrected` per reading, plus the offset itself. **No screen reads any of it yet — LA-45**, so your Health card shows 25.3 while your calorie goal already uses 28.5, and two numbers disagreeing on screen is worse than neither being corrected ([engine](history-2026-09-10-folded-4.md#2026-08-31-dexa-body-fat-calibration), [consumers](history-2026-09-10-folded-4.md#2026-08-31-dexa-correction-consumers), [payload](history-2026-09-10-folded-4.md#2026-08-31-dexa-corrected-payload), [end to end](history-2026-09-10-folded-4.md#2026-08-31-dexa-chain-end-to-end)).

**Your DEXA scan and your RMR test have nowhere to go — both tables are empty and neither has a form (LA-44, found while planning BF-2).** `dexa_scans` shipped 2026-08-30 with `GET`/`POST /api/dexa-scans`; `measured_rmr` shipped days earlier with `personalRmr` and its own route. Both engines are correct and **nothing in the app calls either** — no screen, no form, no fetch — so the 2026-08-27 results had sat transcribed in a clinical-baseline doc for four days (that doc was removed from the repo 2026-09-24, RV-199; the owner holds it) with no way in. **Nothing was going to catch this**: no test breaks when a table stays empty. BF-2's own plan is now written ([`2026-08-31-dexa-filter.md`](../superpowers/plans/2026-08-31-dexa-filter.md)) and reverses two of its assumptions — the calibration pairs are **derived** from `dexa_scans` × `body_metrics` rather than stored (a stored pair is a stored counter, and every one here has drifted), which takes the whole entry off the migration budget; and the correction is an **offset**, not a ratio, because one pair supports neither and an offset is the one that makes no claim about readings never observed. The engine can ship first and is inert with zero pairs — but nothing shows until a scan can be entered ([journal](history-2026-09-10-folded-4.md#2026-08-31-plan-dexa-filter)).

**AI program generation deleted every exercise it phrased differently, and said nothing (LA-43).** The prompt tells the model to match library names exactly; the model writes *"Barbell Deadlifts"*, *"Press Dumbbell Incline"*, *"Pull-Ups"*. An exact-match filter removed each one with no trace — so a session came back short of the exercise count its own time budget was computed from, and nothing in the response, the logs or `error_events` said why. **The entry was filed against a different line and that line turned out to be dead code**: the `?? ex.mainMuscles` fallback three lines under a comment saying the model's muscles are never trusted could not fire, because the filter above it had already guaranteed a hit. Names now resolve through exact → normalised → word-order tiers and are kept under the **library's** spelling, because `personal_records` and `exercise_estimates` are unique on `(user_id, exercise_name)` and a surviving paraphrase starts that lift's history from zero. It stops short of subset matching on purpose — that would reach "Bench Press" from "Incline Bench Press", and a wrong merge is unrecoverable while a miss costs one exercise. Measured against the real 142-row catalogue: **0** names stopped resolving, and plurals went from **49 of 121 unreachable to 0**. A genuine miss is now reported; a session left empty returns 502 instead of an unusable program. **Proven end-to-end against real Gemini** ([journal](history-2026-09-10-folded-4.md#2026-08-31-fix-generate-program-name-resolution)).


**Voice logging heard the owner correctly and threw it away (BF-66).** *"60 for 6"*, mid-set, transcribed perfectly and printed in red — because that red line is the *parse-failure* branch, not a mis-hear message. `parseVoice` stripped every character outside `[0-9.\s kgreps×x]`, a denylist that keeps the `r` of `for` and the `es` of `times`: **`60 by 6` and `60 at 6` worked and `60 for 6` and `60 times 6` did not**, and nothing in the app stated that rule. A positive tokenizer replaces it — take the numbers and the unit/rep keywords, ignore every word between — so a phrasing works by construction rather than one stripped filler at a time. The seven existing tests all passed and none of them *could* have failed: every case was adjacent numbers or an explicit keyword. The failure message now names an example and the button carries it, since the accepted phrasing was previously learnable only by failing at it. **Proven on strings, not on speech** ([journal](history-2026-09-10-folded-4.md#2026-08-31-voice-filler-words)).

**Four nutrition reports from one device pass, and the interesting one is a fix that is not what its entry proposed (BF-60/61/62/63).** **BF-61:** Delete needed two presses because hit-testing follows the *animated* transform — for the 220 ms the row spends sliding out it is still over the tray and swallows the tap, which is why the owner's *"if I wait a second it works"* was the diagnosis. The tray now stacks above the row while open. **Its test took three attempts and the failures are the value:** a long drag overshoots and animates back *rightwards*, never covering the tray; a CDP-paced flick falls under `FLICK_VELOCITY` and snaps closed instead; and a tap at the tray's *centre* is uncovered within a frame, because the tray uncovers from its right edge first. The first version passed with the fix removed. **BF-62 was NOT `92vh`** — `SheetContent side="bottom"` bakes `.pb-safe-action`, and this repo's own measurement says the inset reports the nav bar's height under edge-to-edge, so `max(inset, 0.75rem)` pads by exactly the bar; five takeover sheets now take `bottomInset="takeover"`. **BF-63** scans a packet into the builder without logging it to today, and **deliberately does not store the code** — that chain is Lane A's and BF-38's. **BF-60** renames the tab to `Search`. **Nothing is device-verified; three of the four stay queued for exactly that** ([journal](history-2026-09-10-folded-4.md#2026-08-31-nutrition-batch-bf60-63)).

**A logged meal is one diary row, and the week-long hold was the spec measuring a moving element (BF-39).** The render half was built on 2026-08-30, passed its own three tests, and was held because the meal library's swipe tray then failed deterministically — recorded as *"a subscriber re-rendering a sibling subtree drops an in-flight `useDrag`"*. **It is none of that.** Sampling the row's rect every frame while the gesture ran: `SwipeActions` mounts once and the drag handler is **never invoked at all**. `toBeVisible()` passes while the sheet is still running its `enter` animation, so `boundingBox()` returned y=605 and the row was at y=503 by the time the CDP touch landed — every point hit the scroll container beneath it. BF-39 never touched the gesture; it added enough work behind the sheet that the animation had not settled. `swipeRowLeft` (`e2e/fixtures.ts`) now waits for two reads a frame apart to agree, all three swipe specs share it, and the pair that failed together passes with the grouping shipped. **The same latent race is in 46 other coordinate reads** — filed as LB-30, not swept ([journal](history-2026-09-10-folded-4.md#2026-08-31-diary-nested-meal-rows)).

**CI refuses `savePreference` inside a `useEffect` (LB-28).** `useEffect(() => localStorage.setItem(K, v), [v])` is a free write; the same line calling `savePreference` is a **PATCH on every mount**, and nothing at the call site says so. One such site left that PATCH and a `GET` behind it pending past sixty seconds in Health's launch burst and failed nine e2e specs, **none of which mentions preferences** — the screen such a failure names is never the screen that caused it. The scanner is a separate module driven by fixtures, and blanks comments and string literals before counting parens, because an unbalanced paren in either extends an effect's span across the rest of the file. Proved by mutation on the real file. **The entry said there were no sites to exempt; there are two** — `usePersistedPreference` itself, and Home's section-order reconciliation, which returns early unless the order changed. The grep behind that claim wanted both tokens on one line, a shape nobody writes ([journal](history-2026-09-10-folded-4.md#2026-08-31-no-save-preference-in-effect)).

**One photo picker per screen, and the held rebuild's failure was the spec (BF-46 ①a).** Two things said *Add a photo* and only one was a picker — the meal's own screen called `onEdit`. Both are real now, at the top of their own screen, writing through the same `saveMealToLibrary`, so there is still one write path. **The interesting half:** rebuilt, the previous session's failure reproduced — `onChange` firing with a valid data URI and the component never receiving it — and instrumenting the *parent* showed the file landing in the **other** picker, because the screen being left is still in the DOM while it closes and carried the same accessible name the spec waited for. *A precondition satisfied by the state it is meant to replace cannot fail* ([journal](history-2026-09-10-folded-4.md#2026-08-30-meal-photo-one-picker)).

**The meal photo was blocked by the app's own CSP, on the branch no test runs (BF-46 ①b).** Three owner reports, recorded as a save failure that *"does not reproduce in source"*. `MealPhotoTile`'s **native** branch did `await fetch(photo.dataUrl)` — and **a `fetch()` of a `data:` URL is governed by `connect-src`**, which this CSP does not open to `data:`. It rejected into a `catch {}` written for picker cancellations, so choosing a photo on the phone did nothing and said nothing. The web branch takes a `File` from an `<input>` and never fetches, which is why every browser test passed. Now `Base64` + `dataUrlToBlob`, and non-cancellations toast. **Verifiable only on the S25** ([journal](history-2026-09-10-folded-4.md#2026-08-30-meal-photo-data-url-fetch)).

**The quantity editor is the owner's Option A, and an ingredient stopped claiming servings (BF-46 ② ③).** The unit toggle moved into a narrow column beside the stepper — which is what frees the width the presets now span — the calorie total stands alone, and the macros are three named tiles rather than `P`/`C`/`F`. **One stated departure from the drawing:** it puts that column at the stepper's height, and the app's 48 dp floor makes a stacked two-option toggle 96 px, so the *stepper* grew instead. And an ingredient row reads `1000 g`, never `8 servings · 1000 g` — a meal is measured in portions, so "serving" meant two different things one line apart. The e2e asserts the toggle's **geometry**, because "beside the stepper" is the whole request and is invisible to a text-only check. **Not device-verified**, and Option A is the tallest of the three drawings ([journal](history-2026-09-10-folded-4.md#2026-08-30-quantity-editor-option-a)).

**Settings follow the account now (Q-392).** The owner's *"when i do a new install or open on computer - it loses all the saved preferences"* was still true in full: the engine (`users.preferences`, `GET`/`PATCH /api/user/preferences`) had shipped and **no read site called it**. `lib/user/preferences-sync.ts` connects them — `hydrateUserPreferences` seeds every device key from the server bag on launch, `savePreference` writes both. Proved by `e2e/preferences-survive-reinstall.spec.ts`, which is the owner's sentence as a test: PATCH three preferences, `localStorage.clear()`, reload, and all three come back in their right encodings — and it fails with the hydration replaced by a no-op. **The rule that was wrong, and CI found it:** hydration first cleared any key the bag did not carry — right for a settled system, wrong in the window between a tap and its PATCH landing. `meal-label.spec.ts` caught it wiping a label style mid-flight, and **offline it reverts every change on the next launch**. Hydration now deletes nothing; the one thing the app clears, the mutually-exclusive brand preset / hue pair, is resolved by `EXCLUSIVE_GROUPS`. The earlier `backgroundSettings` catch was the same rule failing at its extreme, and treating it as one key needing an exclusion would have left the race in place for every other ([journal](history-2026-09-10-folded-4.md#2026-08-30-preferences-read-sites)).

**A logged food swipes to Delete, and the day stopped moving with it (BF-45 ⑤).** The diary reuses the meal list's `SwipeActions` tray, routed to the confirmation the edit sheet's bin already raises. What earns the index is the collision: `nutrition-content.tsx`'s scroll container owns a horizontal drag that steps the **day**, so one touch fed both gestures — and it is **invisible on today**, since that handler refuses to step past today. `SwipeActions` marks itself `[data-swipe-actions]` and the day handler defers, as `tab-swipe-navigator.tsx` already does for a carousel. **Not device-verified** ([journal](history-2026-09-10-folded-4.md#2026-08-30-food-log-swipe-delete)).

**Home's APK-banner link was a 33 px tap target, and the gate that hid the entry was self-inflicted (LB-26).** The link rendered **258×33** against the 48 dp floor — an `<a>`, which `globals.css` excludes on purpose so an inline prose link is not forced to 48 px. It takes the floor locally instead of widening the selector, and the reasoning moved beside the CSS rule rather than sitting in the banner's JSX, which is not where someone tempted to widen it would look. **The spec's allowlist is now empty** — an allowlist that never empties is a backlog wearing a test's clothes. Proved both ways: removing the floor fails the spec with the exact reported measurement. **The process half is the more useful one:** LB-26 carried `Gate: device` on work that had never been built, filed by the session that had read BF-45's warning about that exact mistake hours earlier — a gate parks an entry, so it hid it from `next-item.js`. The rule now sits in the backlog's protocol header where entries are written, not only inside the entry that found it ([journal](history-2026-09-10-folded-3.md#2026-08-30-apk-banner-tap-target)).

**The sparkline primitive can draw the charts that were bypassing it (Q-154).** Three files hand-rolled a `<polyline>`, and "replace on touch" would have been a bug — the primitive could not draw them. It gained six props, all defaulted so its twenty existing call sites are untouched: `pad`, `valuePadding`, `strokeWidth`, `gridLines`, `emphasizeLast`, `valueLabel`. **`valuePadding` is not cosmetic** — the default 0.5 renders a 0.5 kg body-weight spread at half its true amplitude, so the chart says something different from the data; that is now pinned by a test rather than a comment, after the projection moved to `sparkline-geometry.ts` so it can be driven in node at all. Two callers converted; **`active-workout-screen` stays inline on purpose** and is no longer a to-do (four more props no other caller would use). The owner's 2026-08-25 call — **the halo goes** — is what cleared it, and the reasoning generalises: a primitive that grows a prop per caller's art is a wrapper over a config object. **Neither converted chart has been looked at** — no e2e reaches those sheets, and it is a deliberate visual change at 412 dp ([journal](history-2026-09-10-folded-4.md#2026-08-30-sparkline-primitive-props)).

**The meal-label spec was decoding the wrong style, every iteration (LB-19).** Filed as a flaky timeout, then as a repaint race; it is the second and worse than intermittent. The gate after picking a style was `inkFraction > 0.01` — and the canvas already carries the **previous** style's ink, so the condition is true before anything repaints. Measured: the ink at the instant the gate released equals the previous style's settled value **4 of 4** (0.080699 → 0.134665 → 0.092238), so the decode loop read the previous label every time and passed anyway, because **every style encodes the same meal**. The layout check it exists for had effectively never run for three of its four styles. Fixed with two signals — the style-derived `mm at N×N modules` figure changing (all six distinct), then the ink **settling** (two equal reads, because a repaint passes through a cleared canvas). Canvas dimensions, the other candidate, are identical at 1179×1179 for every style. **A deterministic reproduction of the original null decode was not achieved** and the entry says so ([journal](history-2026-09-10-folded-4.md#2026-08-30-meal-label-style-gate)).

**The nutrition surface after two device passes — and two things built, measured and held (BF-45, BF-50, BF-51).** Eight shipped: the macro ring started at **9 o'clock** at all three call sites, Home's included (`from -90deg` is the SVG/canvas idiom; CSS `conic-gradient` already starts at the top); a collapsed meal kept its calories and dropped its macros, because the totals footer sits inside `CollapsibleContent`; bottom-sheet gutters were **4 px against artboards that say 16** — fixed on the nutrition sheets, **not** on `SheetContent`'s bottom variant as the entry proposed, because **26 of 48** bottom sheets set their own `px-*` and most of the rest already pad inner content at 16, so a shared gutter would have doubled theirs; plus the Log Food capture row (62 px tiles from the artboard, a describe pane that fills its sheet, the camera opening directly with the gallery kept, and `Select` renamed `Delete meals` because that is all it does). **Held:** the meal-photo rework and the builder's back surface — both built, both with a reproducible failure recorded on their entries, and neither shipped from a sandbox. **None of the eight is device-verified** ([journal](history-2026-09-10-folded-4.md#2026-08-30-nutrition-ui-uplift)).

**Log Food could not reach the food database (BF-48).** The owner's *"it only searches saved/history food... So its not useful"* was precise: `Single foods` filtered an in-memory list, its placeholder said `Search your foods`, and its empty state said single foods land there *once you have logged them* — so the screen for adding one food could only find foods already eaten. The database search existed the whole time, reachable **only** from inside the meal builder. The query and its results section are now shared (`useFoodDatabaseSearch`, `FoodDatabaseResults`), so the macro/calorie mismatch warning has one implementation rather than two, and the **700 ms debounce travels with the hook** — OFF rate-limits to ~10 searches a minute. The foods tab's search box is unconditional now: it was hidden while the list was empty, which is the state the report was made from. Guard proved by mutation ([journal](history-2026-09-10-folded-4.md#2026-08-30-log-food-database-search)).

**The accessibility scanner that would have passed a 12 px button (Q-282).** `@axe-core/playwright` was installed, measured and removed: WCAG 2.5.8 exempts a *spaced* undersized control, so a deliberately-shrunk **12×12** button (confirmed by `boundingBox`) came back a **pass**, and `color-contrast` cannot read this app at all — it fails to parse the `oklch` tokens (*"Could not parse color string oklab(…)"*) and **evaluated no nodes on Home**. `e2e/touch-target-size.spec.ts` ships instead: DOM geometry against **this repo's 48 dp bar**, covering the roles `globals.css`'s `button, [role="button"]` floor cannot (`<a>`, `role="tab"`, `role="radio"`). It fails on the mutation axe passed. One real finding, **LB-26**: Home's APK-banner link is 258×33 ([journal](history-2026-09-10-folded-4.md#2026-08-30-touch-target-gate)).

**The Heart Rate tile shows last night, as a delta (TN-13).** It read the **7-day mean** and printed it as a bare bpm — in the signal that best predicts how you feel (r = +0.557 against your own check-in, best of nine). Re-measured over 71 production nights: the nightly value changes on **61 of 70** night-pairs, the rounded mean on **29**, so the tile stood still nearly six days in ten and discarded 77 % of the daily movement. And a bare number says nothing: expressing the reading as a deviation from your own baseline roughly **doubles** its correlation with felt state, which is why it now reads `50 · −7 vs usual`. Both halves shipped together because the entry required it — half a fix here is the one that looks like progress. **⚠ The delta was then never drawn, and TN-13 is now CLOSED on the owner's decision to leave it that way (2026-09-15).** `RING_GEOMETRY` sets `showDot: true` on **1 of 18** ring styles, and the cue renders only under it, so the comparison was invisible on seventeen styles including the default — for a fortnight. It failed on the one day it had something to say: `resting_heart_rate` **60** on 2026-09-15 against 57 · 55 · 54 · 55 before it, so it would have read about `+4 vs usual`. Offered four ways to restore it, the owner chose the bare number — *"which is fine as it makes it consistent with the rest"* — because the HR chip would otherwise be the only cell in the row with a second line, and cueing all four puts a cue under three numbers that already interpret themselves. **The engine half stays and still reaches the accessible name**, so the comparison is spoken even though it is not drawn; the legibility question is struck as moot ([journal](history-2026-09-18-folded-1.md#2026-09-15-tn13-closed-bare-number)).

**Changing a supplement's dose no longer rewrites every log you already made (BF-3, gap 1).** The
dose lived on the definition and not on the log, so raising retatrutide from 2 mg to 4 mg made last
month read 4 mg too — for a drug whose whole story is its escalation schedule, the schedule was what
got erased, and nothing recorded it to reconstruct from. The dose is now stamped on the log
(migration 244, local SQLite **v32**), including the free-text form, **so it works with the dose
already typed in and needed no UI change**. The out-of-app note the entry advised keeping is no
longer needed. **Not yet on the S25, and a v32 local migration is the highest-risk kind here** — an
empty Nutrition tab is the signature of a dead local store. Gaps 2 and 3 (twice a day, weekly
cadence) and the dose-entry UI stay queued
([journal](history-2026-09-10-folded-3.md#2026-08-30-feat-supplement-dose-on-log)).

**A meal label can be handed to someone now (BF-57, both halves).** Scanning someone else's said
*"That saved meal no longer exists"* — the QR held a `saved_meals.id` resolved against the scanner's
own meals. Making ids globally resolvable was rejected (a photo of a label would become read access
to someone's meal, on an app heading for a Play Store health-data declaration); the meal travels in
the code instead, so it scans offline, for a user with no account, as a copy, and **nothing is
dropped to fit** — the tail rolls into one remainder carrying its macros, exact to the gram. The
~30 mm the entry asked for is **not available** on the five print styles: four cannot hold 62 bytes,
below which the encoder trims the meal's **name**, so they keep the private bookmark and a new
**Share code** style spends the label on a 34.4 mm code. A scan saves a copy, never logs it.
**Still owed: the two-phone check, and a printer**
([engine](history-2026-09-10-folded-3.md#2026-08-30-feat-self-contained-meal-label) ·
[surface](history-2026-09-10-folded-4.md#2026-08-31-shared-meal-labels)).

**The nutrition sheets carry the tab's palette, and the obvious fix could never have worked (BF-75).**
A translucent sheet reveals `SheetOverlay`'s `bg-black/50`, not the wallpaper — that sits at `z-[-1]`
while the sheet and its overlay are both `z-50` — so the palette is painted *inside* the sheet, behind
an opt-in `surface="page"` five nutrition sheets pass and nothing else does. **⚠ Wallpapers ship
`enabled: false`**, so it is invisible until switched on; the owner has them on. **Still owed: the
≥4.5:1 contrast check on the S25** ([journal](history-2026-09-10-folded-4.md#2026-08-31-nutrition-sheet-surface)).

**The meal builder's three whole-meal inputs are findable (BF-52).** *"I dont see a URL option"* — it
did not exist until you had pasted the URL: the recipe photo, the URL import and the AI estimate were
mutually exclusive renders of one slot inside a search field. A `Recipe photo · Recipe link ·
Describe it` row sits above the collapsed picker now. The barcode is **not** in it, against the
entry's own instruction: those three build a whole ingredient list, a barcode names one product
([journal](history-2026-09-10-folded-4.md#2026-08-31-meal-builder-entry-point)).

**Both pending weigh-in buttons were dead in production (BF-53).** `scale_raw_samples.id` is a
`bigserial` and both routes validated it with a UUID regex, so every press of "Not me" or "Yes,
that's me" returned `400 Invalid id` before the numeric check written for it could run — a reading
that was not yours could not be dismissed, and one that was could not be filed. The client's
`if (res.ok)` with no `else` is why it read as *"doesn't do anything"* rather than as an error, and
that half is fixed too. Reproduced and re-verified on `pnpm dev` against the same real row. **Still
owed: the S25 check** ([journal](history-2026-09-10-folded-4.md#2026-08-30-fix-pending-weighin-numeric-id)).

**Query text reaches the audit role (LA-39, closed the day it was filed).** BF-21's view shipped
returning real timings with every `query` reading `<insufficient privilege>` — `pg_stat_statements`
redacts text outside `pg_read_all_stats`, checked against the session role. The owner ran
`GRANT pg_read_all_stats TO claude_readonly` and it is live; the returned SQL carries `$1`
placeholders, which is the normalisation the safety argument rested on.

**The BLE console counted rows it had been guessing (BF-54).** Its DB footprint printed
`n_live_tup` under a column headed *rows* — a planner estimate, and `last_analyze` is NULL on every
table here, so it read **552** against `oura_raw_samples`' **180,415**, 0 against `rr_intervals`'
87,015 and 1 against `error_events`' 6,102. The display was the smaller half: the reclaim button used
the same counter to call 67 MB against 552 rows *pure bloat*, so pressing it took an ACCESS EXCLUSIVE
lock with the timeouts lifted and reclaimed nothing. Both sites now `count(*)`. **The size columns
were never wrong** and are untouched — only the row columns of `pg_stat_user_tables` are estimates,
and conflating the two is what cost a session on Q-528
([journal](history-2026-09-10-folded-3.md#2026-08-30-fix-db-footprint-real-counts)).

**Query timings are readable by the audit role (BF-21).** The owner enabled `pg_stat_statements` on
production; `claude_ro` is default-deny, so it needed a view, which migration 242 adds through the
generator rather than by hand — that file rebuilds the whole schema each run, so a hand-written view
would vanish at the next regeneration. **The one view here that is not row-scoped**, safely, because
normalised query text carries shapes rather than values; five columns, and a test refuses the rest.
Guarded on the relation existing, since the extension is production-only and an unguarded view would
fail `ensureSchema` on cold start. **The counters start empty from the restart** — give it a day
before drawing conclusions, and BF-19 already showed the database is not where the reported slowness
is ([journal](history-2026-09-10-folded-3.md#2026-08-30-feat-claude-ro-stat-statements)).

**A meal plan the model never needed no longer fails when the model is down (LA-38).** The generate
route called the AI unconditionally, before it knew how many meals it had to invent — so a plan with
every slot pinned, or filled from your saved meals, still sent the full prompt asking for *exactly
zero* meals. Tokens were the smaller half: the catch around that call cannot tell it was
unnecessary, so an outage 502'd a plan that required nothing from it. Reproduced on `pnpm dev` with
no API key (pre-fix 502, post-fix 200) and fixed by deriving the two things the call supplied — the
plan's name, from meals that are all already named, and the rest-day line, from the carb shift the
code actually applies
([journal](history-2026-09-10-folded-4.md#2026-08-30-perf-generate-skip-empty-model-call)).

**A DEXA scan has somewhere to land (BF-41 / BF-2).** `dexa_scans` + `dexa_scan_regions`
(migration 240) and `GET`/`POST /api/dexa-scans` — BF-41's second slice, and what unblocks BF-2's
scale calibration. Written from the owner's real Hologic printout rather than a description, keeping
every field; **no source document is stored** — extract, confirm, save the fields, discard the file.
**There is still no way to enter one from the app**: the upload/crop/confirm surface is Lane B and
unbuilt, and nothing extracts yet
([journal](history-2026-09-10-folded-3.md#2026-08-30-feat-clinical-intake-storage)).

**My Foods sorts by what you actually eat (BF-39 follow-up).** Q-395c filed it as a constraint —
*"a saved meal has no last-used timestamp at all … True MRU needs a column that does not exist"* —
and BF-39's migration added that column this morning. `listSavedMeals` returns `lastUsedAt` and
orders most-recently-eaten first; a meal never eaten sorts last, keeping the `createdAt` order it
had, so saving one does not drop it out of sight before it is used once. **Derived on read**, never
a stored counter: a `last_used_at` column needs a write on every log and an un-write on every
delete, and is wrong forever the first time either is missed. The first version put the same
subquery in the SELECT and the ORDER BY — the ordering worked and the selected value came back
null, which is a neat argument against one formula in two places even when both are the same SQL
([journal](history-2026-09-10-folded-4.md#2026-08-30-saved-meal-last-used)).

**The map that stops you re-implementing things was wrong 108 times (LA-35, filed and fixed the same
day).** `CLAUDE.md` sends readers to `docs/module-map.md` *because* the monorepo extraction moved
code out of `lib/` and the docs kept saying `lib/` (Q-153) — and the map was wrong the same way, for
**108 paths across 8 orientation documents**. It survived because
`scripts/check-index-doc-paths.js`, written to catch exactly this, ended its `resolves()` with
`'packages/shared/src/' + p.replace(/^lib\//, '')`: **the one error class the map exists to prevent,
whitelisted inside its own guard.** The sibling `check-claude-md-paths.js` never had the bug and the
difference is one line — it uses that string to build an error *hint* and fails anyway. The
corrections are applied, the fallback is gone, the hint is ported, and a test pins the absence,
because restoring it makes the check pass *more*
([journal](history-2026-09-10-folded-4.md#2026-08-30-module-map-shared-paths)).

**The deleted food came back, and the filed trace was not why (BF-47).** From device pass N1:
*"when I click delete the item vanishes then re-appears; then when you swap screens - it
dissapears."* The entry said the loader renders the server copy unconditionally — **it does not**;
in the happy path it hydrates through `applyDelta` and re-reads locally, and that path's
`sync_status = 'synced'` gate holds. Two mechanisms do fit: the `catch` fallback rendering the raw
server copy, and — the one that matters — a log created on web or another device, where
`deleteFoodLog` matches **zero rows** so nothing is tombstoned and `applyDelta` inserts the server
row back as `'synced'`. **That distinction decides the fix's position:** a filter applied after the
hydrate would fix the flicker and leave the half that survives a screen swap. It now runs before
both uses, reading the outbox through a store method that deliberately ignores retry backoff — a
delete waiting one out is still a delete. The sibling sweep the entry demanded has a measured
answer: `applyDelta(` has **exactly one** call site outside the sync engine. ⚠️ Reasoned, not
reproduced, and unverified on the S25
([journal](history-2026-09-10-folded-4.md#2026-08-30-pending-delete-resurrection)).

**A logged meal keeps its identity now (BF-39, engine half).** The owner's report was literal —
*"when I add a meal from ai; it breaks it down into its components and floods the list"* — and one
AI-logged breakfast really did render as **eight** diary rows. Logging a saved meal writes one
`food_logs` row per ingredient and nothing recorded that they came from a meal. `saved_meal_id` and
`meal_group_id` do (migration 238, `claude_ro` views regenerated in 239, local SQLite **v31**), and
**two ids rather than one is the design**: the first is WHAT was eaten, the second WHICH TIME, so
two servings of one meal on a day cannot merge into one row. Built as the entry recommended — one
row per ingredient plus a grouping key, not one row per meal, which would change what a `food_logs`
row *is* for five consumers. The full offline chain landed together, `savedMealId` is
ownership-checked on both write paths, and the FK is `ON DELETE SET NULL` because `deleteSavedMeal`
is a hard delete and the default would make a saved meal undeletable once eaten. ⚠️ **The rendering
is Lane B and not built**, so nothing looks different yet, and nothing back-fills older logs
([journal](history-2026-09-10-folded-4.md#2026-08-30-food-log-saved-meal-id)).

**The Voice button was not broken on the APK, it was absent (LA-37).** One `error_events` row from
02:06 — `"SpeechRecognition.then()" is not implemented on android` — and behind it a completely dead
feature. `getNativeSpeech()` returned the raw `registerPlugin()` **Proxy**, whose `get` trap answers
every key with a callable, `then` included; resolving an async function's promise with it makes the
runtime call `plugin.then(...)` across the bridge. **It hangs rather than rejecting** — Capacitor
ignores the resolve/reject it was handed — so `available` stayed `null` and the button never
rendered. `lib/oura-ble/plugin.ts` has documented this footgun since it was written and all four
locally-registered plugins wrap because of it; the voice button escaped because its plugin comes
from a **community package**, so no grep for `registerPlugin` ever reached the file.
`scripts/check-plugin-proxy-thenable.js` now keys on the *shape* instead (Custom Rules is 62 steps).
**The precision matters:** `return BleClient` at two other sites looks identical and is correct —
that one is a plain instance, not a proxy — so the check exempts it by name with the reason.
JS-only, so it reaches the phone on deploy with no APK rebuild. ⚠️ Unpressed on the S25
([journal](history-2026-09-10-folded-4.md#2026-08-30-voice-plugin-proxy-thenable)).

**Nine percent of My Foods was the same food, written again (BF-38, the exact-match half).**
Measured in production: **221 `food_items`, 200 distinct name+brand, 21 redundant**, 20 of them from
the `ai` source — and nothing had ever checked, at any layer, whether a food being created already
existed. `foodItemIdentityKey` decides it once, on exact identity: normalised name and brand (case
and whitespace only) plus **every number a log depends on** — serving size, calories, and the
macros. That is 10 of the 21. **The rest are deliberately left**, because `food_logs` multiplies
against the item's serving size: `mandarin` exists at 42 kcal/80 g and 53 kcal/100 g, so a
density rule would not lose a row, it would change what a new log *means*; and `protein bar` reads
**137 and 342 kcal at the same 40 g**, where merging picks a winner silently. Two of the entry's
premises were falsified before building — **`barcode` is NULL on all 221 rows**, because
`NutritionScanResult` carries no such field, so the "unambiguous" barcode key would have matched
nothing; and the AI's names are usually byte-identical rather than fuzzy. Both write paths check and
**differ on purpose**: the offline push keeps its client-minted id, because a queued `food_logs`
mutation already references it. ⚠️ The device half is unverified on the S25
([journal](history-2026-09-10-folded-4.md#2026-08-30-food-item-duplicate-create)).

**A map entry stops heading the work list (LB-22).** BF-28 and BF-11 exist to be READ, not built, and
said so only in prose — so `next-item.js` printed BF-28 as READY #1. `Reference:` is a **field** now,
ratcheted by `check-backlog-pointers.js`, and checked **last**, so a `Gate:`/`Needs:`/`Keep:` can never hide behind "not a work item" ([journal](history-2026-09-10-folded-4.md#2026-08-30-queue-reference-entries)).

**The e2e flake blamed on a slow sandbox was a stale fixture (LB-19).** The entry said two specs
"fit comfortably on CI's runner and do not fit here" and prescribed a longer timeout. **Neither half
held.** `goal-invalidation` fails on a locator that never resolves 60 s into a test with a minute
spare — `seed.sql` ends at the day it *ran*, nothing back-fills, and the steps row cannot render
without one (measured: newest steps row **2026-08-25** against a `current_date` of **2026-08-30**).
It supplies its own row now, in the **user's** timezone. `meal-label` is intermittent for a different
reason again — its ink poll cannot tell the new label style's paint from the previous one's — and
stays open with the mechanism written down ([journal](history-2026-09-10-folded-3.md#2026-08-30-e2e-fixture-not-time-budget)).

**Two rings that were never compared, reported as two rings that disagree (PS-15, phase + units).**
`/api/admin/device-comparison` returned `overlap: 0` for the rings' daytime stress. Oura's buckets
land at **:15/:45** and the Colmi's at **:00/:30** — fifteen minutes apart, forever — and the route
bucketed at a hardcoded five minutes, so no pair could form at any point in either ring's history.
`lib/health/device-comparison.ts` has said *"bucket to the COARSEST cadence"* in its own header since
the day it was written and **nothing implemented it**. The width is measured now (median
inter-sample gap, coarsest wins) and reported three ways; `verdict` separates `out-of-phase` from
`no-data` and from a real disagreement; and a pair in **mismatched units** (Oura stress is −1..+1,
the Colmi's raw 0..100) suppresses every magnitude and returns rank agreement — **rho = 0.64**, the
figure PS-15 was filed with, now reachable from the endpoint instead of by hand. Adding `spearman`
to `packages/shared/src/health/correlation.ts` *removed* a duplicate: `averageRanks` moved out of
`model-report-calibration.ts`. **Steps stay unbuilt on purpose** — pairing them needs the Colmi's
buckets summed to a day and **PS-16** has not settled whether they are cumulative, so PS-15 keeps
that half with `Needs: PS-16`. Admin JSON, no UI, no version bump
([journal](history-2026-09-10-folded-3.md#2026-08-30-device-comparison-phase-and-units)).

**The Coach can ask a multi-answer question, and stopped retyping six lists (Q-407, widget half).**
The owner's complaint was literal — *"there should be options for 'select all' as I keep clicking
each grocery store"* — and nothing produced one: `ChoiceListSchema` had no multi flag and the
callback resolved a single option. Both flags are flat and optional, so every existing picker is
unchanged. The six meal-plan catalogues are `CHOICE_SOURCES` now, served from `/api/coach/options` —
a nine-option list the model types out costs **~554 output tokens**, and output is essentially all of
Coach's latency. ⚠️ **The conversational half of Q-407 is untouched**; this is the widget it needs
([journal](history-2026-09-10-folded-3.md#2026-08-27-coach-multi-select)).

**The wrap-up shows the day it is wrapping up (Q-112b).** The evening review asked how the day felt
without ever showing the day. The read-through — training, activity, energy, sleep, HR, body — is
step 1 now, drawn by **the same component `/health/day` draws**, off the same `day-log:` key; three
steps, and the meals step is skipped once nothing is missing. **Two findings the entry did not
have:** the HR pair is labelled *15-min averages*, not min/max, because the trace is bucketed by
mean and a resting dip to 48 surfaces as ~55; and **body temp had no route at all** — the live
values are in `oura_daily_summary`, returned by nothing, so it is Lane A (**LB-25**). ⚠️ Not device-verified ([journal](history-2026-09-10-folded-3.md#2026-08-27-day-review-read-through)).

**One evening flow, one door (Q-112a).** Home opened a thinner `DayReviewSheet` only Home had,
Nutrition's End of Day button opened the real one, and **both reminders' `extra.route` was `'/'`** —
tapping either landed you on Home to hunt for a banner. All of it reaches `/nutrition?review=day`.
**The plan hosted the review on Home and that was wrong:** `EndOfDayReview` needs meal types, logs
and targets, all Nutrition's state, so the door moved instead. `day-review-sheet.tsx` is deleted,
its digest carried across **with the `.catch()` and error state it never had**; that orphaned the
load-comparison chart and its route, both kept for Q-112c (**LB-24**). ⚠️ Not device-verified ([journal](history-2026-09-10-folded-3.md#2026-08-27-day-review-one-door)).

**Nutrition's energy block is artboard 1's card now (BF-24 ②).** Ring left, `kcal left` and
`+burned` beside it, three macro columns; the on-track band and the eaten/burned/net detail kept
below a divider in the same card, because the drawing stops at the fold and the band is what says
whether "left" is on track. **No number changed** — and the reason is the finding: the card takes
`goalCalories`, `earnedKcal` and the *effective* targets from the screen and derives none of them,
because Q-401, Q-417 and Q-323 each came from a surface computing its own. A first draft that called
`budgetProvenance` in the card would have been the fourth. ⚠️ Not device-verified — BF-24's gate
covers it ([journal](history-2026-09-10-folded-3.md#2026-08-27-nutrition-energy-card)).

**A recipe from a picture, and the prompt that assumed a plate (BF-40).** The route already took
images; its prompt told the model to estimate a **plate** from a picture of a word list. One line
served both acts, so rewording it would have made dinner read as a recipe, silently — the choice is a
tested pure function now, absent means `plate`. The ⚠ four-fold yield error was already handled: an
image returns `recipeYield: null`. ⚠️ Not device-verified; the model's reading is stubbed ([journal](history-2026-09-10-folded-3.md#2026-08-27-recipe-screenshot-import)).

**A test flake that was the service worker, not the component (PS-14).** The filed hypothesis — a
remount discarding the typed query — was **wrong**, and testing it (a probe asserting the value
survived passed 8 of 8) is what found the real cause: `sw-template.js` re-issues **every** `/api/`
request, Playwright cannot intercept a service-worker fetch, and the worker `claim()`s mid-page-life
— so whether a `page.route` stub applies is a race. **The rule was already in `e2e/README.md`** and
three specs were written against it anyway, two of them mine hours earlier, so
`check-e2e-api-stub-sw.js` now holds it ([journal](history-2026-09-10-folded-3.md#2026-08-27-e2e-api-stub-service-worker)).

**The meal-plan wizard can finally reach the library, and stops dropping pins silently (BF-11h).**
BF-11g shipped the engine and **nothing on the client sent `useLibrary` or read `matchReason`,
`libraryMatchCount` or `droppedPins`** — the search was off for every real request since it landed.
Four things: the toggle, why-this-meal, a reroll offering **one of yours before something new** (no
route, no model call — it runs the generator's own matcher on cached data), and the meal-count
reduction prompt. **That last fixes a live silent drop** — the picker caps pins at `mealCount - 1`
while you pick and `setMealCount` never re-truncated them, so lowering the count afterwards
discarded pins the server capped and reported to nobody. **It also exposed a badge bug BF-11g
created:** `kept` and `library` both carry a `savedMealId`, so a meal the planner *chose* claimed to
be one the user had *pinned*. Regression driven, not inspected — reverting the wiring fails both
reduction e2e tests. ⚠️ Not device-verified, and no end-to-end generation with `useLibrary` on.
[Journal](history-2026-09-10-folded-3.md#2026-08-27-meal-plan-library-surface).

**A saved meal can say which meals of the day it suits (BF-11f) — and the save button was eating
its own argument.** BF-11e built the column, the join table, the route field and the outbox replay and
deliberately shipped no way to set any of it; this is the picker. **Untagged means EVERY slot, not
none**, so the hint under the chips changes with the selection — nothing ticked otherwise reads as
"excluded from everything". Writing the round-trip test caught a live defect underneath it:
`onClick={onSave}` handed React's click event to `handleSave(overwrite?)`, so every save from the
footer looked like an overwrite — which meant **BF-11d's duplicate prompt, shipped the day before,
had never fired once**, and the new tags arrived as `undefined`. Neither TypeScript nor the memo check
can see that shape. A sweep found one sibling (`food-list.tsx`'s empty-state button, which reads
`.items` off the event); it is fixed **by inspection, not reproduced** — no spec has an empty meal
library — **closed the same day in v1.388.1, and the reproduction corrected the claim**: React
swallows the throw, so the only symptom is a **dead button**, not a crash. ⚠️ Not device-verified.
[Journal](history-2026-09-10-folded-3.md#2026-08-26-feat-saved-meal-tag-ui).

**A remembered bedtime, in its own column (Q-519, engine half).** A night the ring only caught from
4 am reads as a 4 am bedtime and moves the 14-day estimate ~23 minutes for a fortnight. The entry
proposed writing it into `sleep_start` at `manual` rank; **the audit that entry commissioned falsified
that** — `aggregateNight` derives time-in-bed and efficiency from the span, so the same night became
10.0 h at 35% instead of 4.62 h at 75%
([audit](../reviews/2026-08-26-manual-bedtime-write-audit.md), reproduced in a test). It gets its
own column, read by the bedtime estimate and nothing else. **No UI yet — Lane B's half**, so nothing
can write one; ⚠️ **the local column is not device-verified.**
[Journal](history-2026-09-10-folded-3.md#2026-08-26-manual-bedtime-engine).

**Every score now stores the breakdown it was made of (Q-501, Q-526).** Readiness contributors record
the number each was scored *from*, so a persisted row no longer needs today's summary — often not the
one it was built on — to explain itself: self-consistent means the **inputs** were rewritten,
inconsistent means the **model** moved, and older rows are named `uncheckable` rather than passing
silently. Activity was the last score keeping the blend *wrapper* where its six components should go
— which on all 30 rows held the score twice and a constant zero, the blend having had no Oura *Cloud*
score to adjust since the re-key. **No score moved, and both are forward-only**: earlier rows cannot
be recovered, so Q-505's before/after window starts here and improves the longer it waits. Details,
and the re-measured populations that corrected both entries, in the journal
([Q-501](history-2026-09-10-folded-3.md#2026-08-26-readiness-contributor-inputs) ·
[Q-526](history-2026-09-10-folded-3.md#2026-08-26-persist-activity-contributors)).

**The doc-size ledger stops being a merge conflict (LA-33), and E2E can now be required (LA-22).**
Every PR raising a documentation baseline edited the same two lines of one shared JSON, so two open
PRs conflicted *by construction* — measured this session at four merge races in 35 minutes, every
conflict in that ledger, the backlog or the changelog, never in code. Baselines are now one file
each at `docs/doc-size/<path>.size`; two PRs raising different docs touch no common line. Same fix
the session journal already took. E2E is gated on `app/`/`components/`/`e2e/` but **always runs and
always reports** — a `paths:` filter would leave a required check that never reports, blocking a
non-UI PR forever. ⛔ **One owner action outstanding: add `E2E` to `main`'s required checks**, or
nothing changes. A ci.yml comment claiming E2E was already required was disproved first — three PRs
merged this session with it still in progress.

**The Coach only swaps an exercise when asked, and says what a swap costs (Q-403).** The owner did
not know the Coach's swap edits the **program** rather than today's workout, and did not want it once
told. Offered remove / keep-and-warn / gate-on-injury, they chose a fourth thing: keep it, never
volunteer it. The prompt now forbids an unprompted swap (mirroring the Deloads idiom), and the
confirmation card states that it changes the named session from now on, that progression history on
the outgoing lift stops advancing, and that a one-off change is the in-workout swap. **On the card,
not the prompt** — this entry measured the prompt's existing ordering rule being ignored 3 of 3
times. **The recommendation I gave was wrong and verifying it is what caught it:** the injury case is
already handled by `injurySafeAlternatives` mid-workout, whose handler mutates local React state
only, so gating a *permanent* edit on injury would have been the worst option. Q-403 stays queued for
the sentence-ordering residual.

**The app's load time is measured now (BF-19).** The owner reported it "VERY slowly lately" and asked
for a second opinion; nothing could give one — the two existing timing endpoints measure **workout**
duration, and everything server-side was already ruled out by measurement. `lib/app-load-metrics.ts`
reports navigation timing once per JS context via `sendBeacon`; `GET /api/admin/app-load-report`
gives p50/p95 per route **split cold vs warm**. That split is the report: every merge is a deploy
that rewrites the service-worker cache name, so a pooled percentile measures release cadence rather
than the app. **Never via the outbox** — telemetry queued as a mutation would sit ahead of the user's
food logs on the next push. `buildId` is baked into the client bundle rather than stamped on ingest,
so a device on a stale shell reports the build it is actually running. **The table stays empty until
it runs on the S25**, which is where the numbers mean anything. Unblocks BF-22.

**A food item can hold a picture now, and it survives offline (BF-35, engine half).** A barcode scan
stores the Open Food Facts thumbnail as **bytes, not a URL** — `food_items` is read local-first and
a URL renders nothing in airplane mode — fetched once at scan time, never per render. Migrations 227
+ 228, local SQLite **v30**, and the full offline chain. **Three of the entry's premises were wrong
and are corrected in place:** it still concluded *"never generate one"* after the owner had overruled
that; it sized the feature against **disk** when `food_items` **syncs**, which is the axis
`meal-image.ts` warns about by name; and "the scan photo is already in the request" understates
1024 px against a 128 px thumbnail (~64× the pixels), which makes route 2 a **Lane B** change.
**Nothing renders these yet** — the display, route 2's client downscale and route 3's AI generation
are BF-35's `Keep:` line. Alongside it, **LB-15**: a calorie-free product (sparkling water, a diet
drink, a supplement) scanned as *"not found"*, because `offProductToNutrition` could not tell zero
from absent and `null` is how a caller learns the barcode failed to resolve.

**A full-history rebuild that computed nothing wiped the history and reported success (Q-528).** `replaceOuraDailySummary` deleted every one of the user's summary rows and only *then* returned early on an empty input. Two more of the same class were in the same seven lines and are fixed with
it: the delete and insert were **separate statements**, so a rejected insert left the delete
committed; and the insert had **no `ON CONFLICT` arm**, so one repeated date raised 23505 and
rejected every row — Q-280's shape under a different SQLSTATE. It now matches
`replaceDaytimeStressBuckets`, which already had all three right. **All three were reproduced against
Postgres before being fixed** — the entry admitted its mechanism was read rather than measured, and
its predecessor had already been retracted once for exactly that. Still latent: only the
hand-triggered redecode reaches it.

**One duplicate in a batch discarded the whole batch, at eight write sites (Q-280).** Postgres aborts
an entire command whose VALUES list hits the same `ON CONFLICT` row twice — nothing lands, not just
the repeat. `error_events` recorded **5,771** hits on `POST /api/hr-ingest` (up to 5,000 HR points
each) before Q-214 fixed `upsertOuraHeartrate` alone; a sweep found **eight** sites of that shape,
not the two the entry named. All now use one `collapseOnConflict`. Strategy is per-site and not
cosmetic: last-wins is exact only for a bare `excluded.*` arm, and three of the eight merge, where it
would have turned a loud 21000 into a silent field loss. **Owner decisions the same day:** readiness
history is **recomputed**, not frozen, when a model is recalibrated (reversing 2026-08-24); the
Coach's mid-program exercise swap is to be **restricted** — see Q-403.

**The shared food row's last call site, and a warning that had nowhere to go (Q-406).** Three of four rows converted days ago; the external food-database result stayed a bespoke `<button>` blocked on a design question. The decided treatment moved its explanatory sentence **to the food's detail** — and this surface has none: tapping the row adds the food outright, so building it would have deleted the only visible explanation on a warning meant to be read *before* use. **Owner's answer: keep the sentence in the row** — what already shipped, so no regression, and option B's losing reason (it *replaced* the serving line) does not apply to keeping it alongside. **That knowingly overrides one bullet of the old design and the entry says so**: *"do not add a warning slot"* was written assuming the sentence was leaving the row, so a slot is what keeping it costs — one optional prop three call sites omit, exactly as they omit six others. **The `+` and the per-row spinner went with the conversion and nothing was lost**: `SearchResultRow` beside it has had neither since v1.338.0 — the tap adds the food — and the tapped row still identifies itself through the existing `highlighted`. A hex literal went too (`#f59e0b` → `var(--accent-amber)`; 427 across 85 files). **The row had no e2e cover at all** — its search reaches Open Food Facts — so the spec now stubs the route and asserts the shared shape, the sentence, and the macros still readable beside it ([`journal`](history-2026-09-10-folded-3.md#2026-08-26-shared-food-row-last-call-site)).

**The journal limit stopped billing the wrong PR (BF-36).** `check-doc-index-size.js` fails the Custom Rules job above 60 foldable journal entries — the right threshold, aimed at the wrong person. It landed on whichever PR happened to be open when the count crossed, and every session writes an entry, so the cost fell at random: it blocked **#527**, a docs-only intake whose diff the failure named none of, and **merging `main` fixed it** because another session had swept concurrently. That PR paid a CI cycle for a condition it neither caused nor fixed. It now applies the same attribution the line-count ratchet beside it already used — over the limit **and this branch adds an entry** fails, adds none gets a note, and an unreadable base still fails rather than silencing the limit. The decision moved to `scripts/lib/entries-verdict.js` and is tested against **fixture counts, not the live directory**, because a test that reads the real count changes verdict as the repo does. **The 250 total ceiling is deliberately left unattributed** — the same argument applies but it is 89 files away, and widening the change would be my call rather than the entry's ([`journal`](history-2026-09-10-folded-3.md#2026-08-26-entries-limit-targets-the-grower)).

**The delete button that opened a confirmation and closed it in the same instant (BF-34).** The owner: *"the delete feature doesnt work"*, then the detail that decided it — *"it opens up the confirm dialog; but then instantly minimizes so we cant click it."* The diary's bin closes its sheet and opens the dialog in ONE TICK, so the sheet's `history.back()` was still in flight when the dialog mounted; the flag marking *"this pop is ours"* was **per-instance**, invisible to the dialog that received it, and a state that is not mine is indistinguishable from a real back gesture. **Since BF-27 put `BackDismiss` in every sheet and dialog, that was every close-one-open-another transition in the app** — this delete was just the first one pressed. Module-level counter now, consumed by whichever surface gets the pop; one listener owns the stack. **Two corrections to the entry's own analysis:** its "share the flag" fix has an ordering trap — `absorb` is registered by the *closing* sheet, so it runs first and would clear a shared boolean too early — and **LB-17 did not fix this** despite changing the same line hours earlier (that was the *nested* case; this is the *sibling* case). The logic now lives in `lib/hooks/sheet-back-stack.ts` with the hook reduced to wiring, because all three failures it has carried were in *when to close* and none was reachable from a test inside an effect. **The sibling sequence cannot be staged through the web UI at all** — the bin is not even actionable in Chromium — so an attempted repro produced a mis-aimed tap that closed the sheet without opening the dialog, which reads exactly like the bug. Seven tests drive it directly; reverting to the per-instance flag fails both sibling tests and the StrictMode one ([`journal`](history-2026-09-10-folded-3.md#2026-08-26-sibling-sheet-back-dismiss)).

**Two food lists became one, and the back gesture turned out to be wrong at three layers (Q-395c).** The owner asked what the difference between *My Meals* and *My foods* was; there wasn't one a user could hold — one listed `saved_meals`, the other `food_items`, and which list a thing was in came down to how it had been added. They are **one list called My Foods** now, newest-first across both sources, with two row shapes because a food's tap opens the assign step and a meal's opens its own screen. `food-library-sheet.tsx` is deleted. **MRU was asked for and is unavailable:** `food_logs` carries no `saved_meal_id`, so a saved meal has **no last-used timestamp at all** — `createdAt DESC` is the only recency signal the two share, and true MRU needs a Lane A column. **Routing the list through the logger made the app's first three-deep sheet nest, and one back press closed two layers.** `useSheetBackDismiss` decided "my entry is gone" by comparing the arriving `sheetId` against its own, so every sheet that was not the one landed on closed itself — right by accident at two layers, wrong at three, where back lands on the *middle* sheet's entry and the *bottom* one reads a foreign id. "Gone" is a **depth** now. The symptom in Playwright was `element was detached from the DOM` on a button just asserted visible, which reads as animation timing and is not; instrumenting `pushState`/`back`/`popstate` is what settled it ([`journal`](history-2026-09-10-folded-3.md#2026-08-26-one-food-list)). **⚠ The merge did not survive the day: the owner reported it the same morning** — *"my foods combined saved meals + history thats not right they are 2 seperate things"* — and BF-37 un-merged it into two tabs. The re-read worth keeping is that *"whats the difference"* was a complaint about two names nobody could tell apart, not about there being two lists. **The three-deep nest went with it**, since LB-16 collapsed the screen that created it ([`journal`](history-2026-09-10-folded-3.md#2026-08-26-log-food-one-screen)).

**A window that made an ACWR impossible, and what it was really breaking (Q-512).** `health-insight`
handed `computeVolumeAcwr` a **7-day** session list against a **21-day** span gate measured from the
earliest session in that list — so ACWR was null on **110 of 110** replayed days, structurally rather
than for want of history. **The entry's mechanism was right and its consequence was wrong:** the route
never reads `.acwr`. It reads `typicalSessionVolumeKg`, the activity score's *volume-lane denominator*
— which is **not** gated, so it always returned a number, a median over one week where every sibling
uses four. Two heavy sessions in a quiet week set the bar. That also makes one of the entry's two
proposed fixes unsafe: dropping the call would have removed the denominator. **And it was not the
one-line fix it looked like** — widening the fetch silently turns `sessions7d`/`volume7dKg`, which the
model reads as "this week", into 28-day figures, trading a visibly-absent null for a wrong number.
They filter back explicitly. `minSpanDays` was not lowered.

**A measured RMR has somewhere to go, and a rule for how it ages (BF-33, engine half).** The owner has
a DEXA + RMR test booked and every resting rate the app used was *predicted*. Migrations **225** (a
`measured_rmr` table) + **226** (claude_ro regen) store it; `personalRmr` decides what happens as the
body changes. **The entry left that open — validity window or re-scale by lean mass — and re-scaling
wins for a reason, not a preference:** a window gives full trust the day before expiry and total
discard the day after, while what actually invalidates a measurement is a change in body composition,
which has no fixed relationship to elapsed time. Cunningham is linear in fat-free mass, so a
measurement carries exactly one thing the prediction does not — **this person's residual from it** —
and re-applying that at today's FFM ages it by body change instead of by the calendar. **Its own table,
not a `body_metrics` column,** because a second test must sit *beside* the first: two measurements at
different compositions are how you learn whether the first still describes this person. **⚠ NOT usable
yet** — there is no way to enter a number; the typed field and the AI results-sheet path are scope
item 3, the 2×2 panel is item 4 and Lane B's.

**A shared test-user UUID, and a check that would have been deleted (LA-32).** Three times in two
days, adding an unrelated test file turned the suite red in a file the PR never touched: two files
hardcoded the same user id and one deleted it, and vitest's parallel workers share one local
Postgres. **The entry's own survey said six remained; re-measuring found one.** `…d011` is a
*program* id, `fe481797` is the canonical `claude_ro` owner two files are meant to share, and the
rest are pure-logic files that never touch `users` — 83% noise, because "shares a UUID literal" is
not the claim "shares a *user id* someone deletes". That ratio is why the fix is a script with
tested detection rather than a grep: **a check that cries wolf gets baselined into uselessness by
the first person it stops.** `check-test-user-uuid-collisions.js` is in Custom Rules (**59 of 59**,
up from 58) with an **empty baseline**. Its first two implementations were wrong in ways the tests
now pin — a fixed tail swallowed the next statement, and breaking on a line-ending `)` stopped
inside the SQL, which ends lines that way constantly.

**A model stamp that another pillar could erase (Q-273).** `oura_daily_derived.model_versions` is a
map of pillar → model version, and the shared upsert `COALESCE`-replaced it — so a writer stamping
its own key wiped every other pillar's. Live: `backfillBodyComp` wrote `{bodyComp: …}` flat and
erased the readiness stamp on every day it touched; readiness survived only through a racy JS
read-merge, now deleted. The upsert merges with `||` inside the statement, so stamping is additive by
construction. **Five DB tests, and reverting the fix fails 3 of them** — including the live sequence
— while the two that should pass either way still pass. **Q-273 is NOT complete:** sleep, activity
and training load still carry no stamp, because only two model-version constants exist and defining
three more is a judgement about each pillar's model, not an implementer's aside. `CLAUDE.md` gains
the rule the entry asked for, with the worked example where pooling four model versions turned
r = +0.67 into r = −0.06 and stood in the docs for eleven days.

**The day's AI surfaces can see each other now (Q-291).** The morning readiness insight once advised keeping intensity low on a raised temperature; that evening the digest cheered the two sessions that followed and said to keep the same energy tomorrow. The digest read nine sources and **readiness was not among them** — so this was data plumbing, not a prompt tweak, which is the question the entry itself asked to settle first. It now reads the day's insights before writing, inside its context hash rather than appended after it. **The read graph is one-directional and must stay acyclic:** two surfaces hashing each other's text would invalidate each other forever, and model output is not deterministic, so it would never settle — the digest is excluded from what the digest can read, in code and in two tests. The instruction permits disagreement and forbids only *silent* disagreement, which is also pinned, so a later tightening to "never contradict" fails rather than passing quietly.

**The journal sweep, and the cadence it revealed (LA-25).** `check-doc-index-size.js` failed a *migration* PR at 61 unlinked entries against a limit of 60. **25 folded into a new `history-2026-08-25.md`, unlinked 59 → 34.** The finding is worth more than the sweep: the README's "~20 loose files" trigger was written for a load that no longer exists — **seventeen entries landed on 2026-08-25 alone** across the concurrent sessions, and the count went from a post-sweep 32 on the 24th to 61 the next day, so a sweep clearing 25 buys **about a day and a half**. This is a near-daily chore now, and the practical trigger is the guard failing someone's PR. **The cheaper half is the citation habit** — cite the review or handoff doc, not the loose journal entry — and this run broke it knowingly: BF-11e cited two journal entries from the nutrition index for want of a handoff doc, which costs the linked floor **two, permanently**. A sweep can undo a fold; it cannot undo a citation.

**The repo root is guarded now, after one scratch file failed every open PR (BF-20).** `m.mjs` — a Playwright screenshot scratch script referenced by nothing — was committed at the root and merged; its `console.log` calls fail `no-console`, so **`main` itself went red and every open PR inherited it**. A Custom Rules step now refuses a stray root module by name (**Ran 57 of 57**, up from 56) and `.gitignore` stops the common shapes being staged. **The entry's proposed allowlist would have failed on nine correct files** — `auth.ts`, `middleware.ts`, `drizzle.config.ts`, the three `instrumentation*.ts` and more — and named a `tailwind.config` this repo does not have; it is derived from `git ls-files` instead, because a guard that fails on correct files gets deleted by the first person to hit it. **And the `.gitignore` half deliberately does NOT cover `.ts`**: fourteen legitimate root `.ts` files exist and a new one would be *silently untracked*, which is a worse failure than the one being fixed — the check covers `.ts` loudly instead. Sibling sweep: the root is otherwise clean.

**Five more catalogue rows get what their family already recorded (LA-24 Kind 1, migration 219).** `Dumbbell Overhead Press`, `Machine Shoulder Press` and `Arnold Press` gained **traps** from `Barbell Overhead Press`; `Lat Pulldown` gained **upper back**; `Decline Bench Press` gained **shoulders**. All five sat at 2 muscles, so BF-15's ≥ 3 anchor rule barred them. **Every before-value and every precedent was read from PRODUCTION**, which also confirmed migration 216 had landed there — so BF-16a's "not run against production" caveat is struck. **LA-24 is now only the question that needs you:** BF-16a's additions to `Barbell Shrug` and `Barbell Hip Thrust` had no in-catalogue precedent, so extending them to the shrug and glute-bridge families is the same judgement made five more times unasked — a machine shrug's handles may be supported where a barbell shrug's grip is not. `Gate: owner`, phrased for an answer rather than an implementer.

**The planner can look in your library before asking the AI (BF-11g).** *"It prefers meals already in the planner and adds other meals around it."* Per unpinned slot: filter by the slot's meal type (plus untagged), rank by `fitDistance`, take the best if `mealFit` passes, else fall through to the model. **Engine half only — nothing sets `useLibrary` yet, so this is off for every real request until BF-11h.** **The plan's ranking was subtly wrong and reading the scaler is what showed it:** `scaleIngredientsToTargets` moves each macro *group* independently and clamps each, so a meal's **size** is the one thing portioning always fixes — judging saved totals would reject a perfectly-shaped half portion. Every candidate is now run through the real scaler before it is ranked or gated, so it is judged on what it will become. Verified live against a real model: the same meal went to the **lunch** slot when tagged Lunch and to **slot 0** when untagged — an A/B on one variable — and it landed **F 20.4** against a 20.3 target while the two AI meals in the same plan came in at 37.9 and 27.8. Also fixed: more pins than slots used to truncate **silently**, and now reports `droppedPins`.

**Saved meals can say which meals they are (BF-11e).** *"We don't want pancakes recommended for dinner"* — a join table on the user's own meal types (migration **217**, local SQLite **v29**), reusing `MealType` rather than inventing a parallel category. **Storage and transport only; no picker yet (BF-11f), so nothing is user-visible.** Three decisions each fail silently if taken the other way: `undefined` leaves stored tags alone while `[]` clears them (a `.default([])` would make tags impossible to keep, since every save today omits them); soft-deleted meal types are filtered on **read** rather than by deleting join rows, so restoring a type restores its tags; and client-supplied type ids are ownership-verified even though the join table has no `user_id`. **A defect was caught in verification, not review:** an unknown meal type answered **500**, and offline that is worse than wrong — the outbox retries 5xx forever and quarantines 4xx, so a mutation that can never succeed would have wedged. Both write handlers now answer 400 with a message. **One link is deliberately unwired** — the sheet's outbox payload carries no tags, because absent means *leave them alone* while sending the loaded ones would revert another device's change; BF-11f's entry and a call-site comment both carry that obligation.

**A scan of several meals stops merging them into one (BF-11b).** `ScanSchema` returned exactly one meal for every input, so a week of meal-prep containers or *"lunch was X, dinner was Y"* became a single estimate. The route now returns a candidate per meal, with the top level unchanged as the first — **five call sites read it and two gate on `ingredients`/`calories` being populated there**, so it must never become an array. *(The entry said four and named `saved-meals-sheet.tsx`, which does not call this route; the plan is corrected in the same PR, since BF-11c reads it next.)* **The measurement is the story.** The first version of the split rule ended *"when in doubt, return one"*, which fought its own repeated-portion clause: five identical tubs came back **5, 5, 1, 1, 5, 1** — a coin flip on the headline case that one passing run would have shipped. Splitting the rule in two took it to **30 of 30 across six cases**, including three chosen because sharpening the split is exactly what could start cutting one crowded plate into six. *(Its test file then went flaky on `main`: the route takes **4.3 s to import** — it reaches the Drizzle adapter — and that was being paid inside the first test's 5 s budget. Hoisted to `beforeAll`: 3834 ms → 11 ms. Third timing-dependent test defect today, and the common root is narrower than "async" — **something timed in the test that is not the behaviour being asserted**.)* **Worth knowing generally: the model IS reachable from an agent sandbox**, so an AI behaviour change can be measured here rather than reasoned about — no baton had recorded that, and nothing else would have found this defect.

**The Body Battery guard stopped swallowing the signal a separate investigation was waiting on (TN-7).** TN-4's fix is right and stays — a stress-model failure costs the stress strip, not the whole card. But its catch only called `console.error`, which reaches no table, so from that deploy a recurrence of the fault that fired **31 times on 2026-08-23** wrote nothing anywhere. LA-20's Known-Issues row asks for a zero `error_events` count over a window where this route was called, and with the guard and without the report that count is zero **whether or not the cause is fixed** — a condition that can no longer fail. The catch now reports as well as logs, tagged `/api/body-battery#stress` so the row is attributable to the strip rather than the outer catch. **The window that counts starts at this deploy**; every zero before it is silence from the guard, and the row says so now. **The general shape, worth naming: a hardening change that turns a loud failure into a quiet degradation also removes the evidence a separate open investigation was relying on.** *(Its first test then asserted `toHaveLength(1)` on a fire-and-forget write that two tests in the file both trigger — green locally and on its own PR, red on the next one. Fixed to assert content rather than count: **an assertion about how many times something happened is an assertion about scheduling** unless one write is the only possible writer.)*

**A required check was failing at random on PRs that could not have caused it (BF-18).** `Tests` went red on a **docs-only** PR with `expected 8 to be +0`, and the same file passed locally 3/3. The autopack test waited for the packer's second phase and asserted its third with **no wait at all** — the three phases commit separately and deliberately, so it allowed the final delete exactly zero milliseconds, which holds on an idle machine and does not on a runner sharing one Postgres with ~380 files. It now polls for the finished state. **Reproduced rather than inferred:** injecting an 800 ms lag between phases 2 and 3 reproduces CI's message *and its line number*, and the fixed assertion passes against the same lag. The sweep found no sibling with this shape — it is the only file in the repository using an `until()` poll, and the three fixed-sleep assertions nearby are all negative ones a short sleep can only make falsely *pass*.

**Five exercises now record the muscles their sibling movement already had (BF-16a).** A cable chest dip left out the shoulders, a dumbbell shoulder press the traps, a cable pulldown the upper back, a barbell shrug the upper back and forearms, and a barbell hip thrust the quads, lower back and adductors. That is the real defect behind *"hip thrusts and dumbbell shoulder press should be able to be a secondary"* — the role rule reads muscle counts and BF-15's anchor rule wants ≥ 3, so a row seeded with two was barred whatever the thresholds said. **The entry's premise was wrong in one way that mattered:** it called this production drift, and it is a defective *seed* — all 140 seeded rows fingerprint identically in the dev DB and production, so it reproduces locally and was proved through the live `/api/weekly-muscle-sets` route rather than reasoned about. Migration **216**, idempotent and case-insensitive. **The scan found eight more rows with the same shape; they are LA-24**, split into the five that a family member already answers and the three families where BF-16a's own additions have no precedent to propagate.

**Lane B's 2026-08-25 run — 19 PRs — is written up in [`docs/handoffs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md`](../handoffs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md).** Read it with the baton at `docs/agents/state/implementation-lane-b.md` before taking a Lane B item: the entire Lane B surface was traversed and every remaining candidate is gated, declined, parked, needs hardware, or wants a plan first. **Nothing that run shipped is device-verified.**

**There were two quantity sheets and the busier one was wrong (BF-26).** The owner's *"everything looks the same"* was literally true of the diary's: its `−`, value and `+` were the same square at the same fill. Both sheets render one `quantity-editor.tsx` now — `srv`/`g`, absolute presets, `MACRO_COLORS`. **And a font-size class on an `<input>` does nothing on a phone:** `globals.css` sets `16px !important` under 640 px for the iOS-zoom guard, so the value needed `!text-2xl` to outgrow its steppers at all. Only two other inputs carry a size class and both want ≤16 px, so it is narrow — but silent ([`journal`](history-2026-09-10-folded-3.md#2026-08-25-quantity-sheet-convergence)).

**The Nutrition day screen's meal grouping was inverted (BF-24, artboard 1).** The owner's *"thats not what the mockup looks like"* had a precise cause: artboard 1 groups the food ROWS within a meal — name as a label above its own card — where Q-395b grouped the MEALS within one container. Both are "grouped", which is why a coverage checklist passed while the screen still looked wrong. Header is one band now (26 px title, date as subtitle) and the meal line is a name and one number. **②③⑥⑦ deliberately not done**, each with a reason on the entry: ② touches `/health` too, ③ is Q-395c's, ⑥ is Q-406's, ⑦ is BF-28's fold rule ([`journal`](history-2026-09-10-folded-3.md#2026-08-25-nutrition-day-artboard-parity)).

**The back gesture stops navigating the page away (BF-27).** `useSheetBackDismiss` was imported by 5 of 45 sheet files and 0 of 6 dialog files; everywhere else Android back reached the WebView, which took the page underneath with it. Shipped **not** as the 40-site sweep the entry scoped but as one component rendered by `SheetContent`/`DialogContent` — so it covers every sheet, every dialog and every future one, closes through Radix's own `onOpenChange` (keeping each surface's existing guards and cancel arms), and reaches the uncontrolled sheet a per-site sweep could not. Dialogs were included deliberately: back can only take a cancel arm, asserted on the database. Three mutation-checked e2e cases, including the nest ([`journal`](history-2026-09-10-folded-2.md#2026-08-25-back-dismiss-sweep)).

**The timeline's workout card had somewhere to land for seventeen days (Q-93-followup).** It was left unwired in August because no screen showed a past session; `/health/day` shipped 2026-08-08 and nothing tracked the dependency clearing. Workout and walk now open it; `bedtime` and `tag` stay inert, having no detail view to reach. Two more of the entry's premises were stale — the second renderer it names is deleted, and the `ev.date` it needs is stamped centrally, so no `app/api/**` change was involved. Guarded by a mutation-checked e2e spec, because a row wired to nothing renders identically to a wired one ([`journal`](history-2026-09-10-folded-3.md#2026-08-25-timeline-workout-day-detail)).

**The queue tool stopped calling shipped work "ready" (LB-11), and then read the two entries it was still missing (LA-23).** `next-item.js` had never learned to read a `- **Keep:**`, so an entry that shipped kept its pre-shipping priority — **17 of Lane B's top 21 were finished**, and the first startable item sat below the tool's ten-row window. A KEEP bucket prints them with what they owe; READY went 86 → 65. **LB-11 closed by recording that Lane A was unaffected; it was not.** The parser required a literal colon, and TN-3a and TN-4 write `- **Keep — what is NOT done:**`, so both read as unstarted and sat at **#1 and #2 of Lane A's READY** — each owing something no sandbox can do. `Keep` now takes a colon **or** a dash, checked against all 196 entries: ten lines begin with the word, two are those Keeps and eight are prose, so the rule covers the whole population rather than a guessed one. Lane A's READY 90 → 88, and its top row is startable.

**Three more cards say so when their fetch fails, and the sweep was three, not ~18 (Q-499).** The
Oura section is the one that mattered: its `return null` means *no ring connected*, so a 429 made a connected user's whole ring section vanish. `.catch()` was never the guard — `cachedFetch` resolves on a non-ok response, so only `onError` fires there. Ten other candidates were judged legitimate.

**The offline tab tap is not silent, and Q-555 closes unfixed.** Driven with the worker blocked so
`controller` is `false` throughout: offline the tap **navigates** and `app/error.tsx` says *"You're offline"*. The one failing window is *before hydration*, where `handleNavClick` cannot run, the anchor navigates natively and Chrome's error page appears — visible, not silent, and inherent: neither our JS nor the worker exists yet. The parked fix would be inert there and a false alarm everywhere else, so nothing merged.

**The diary row is the shared row now, and its sheet can delete (Q-406).** The pencil and bin came
off every food row. **It turned up LB-10, now fixed:** `use-sheet-back-dismiss` was not double-invoke
safe, so the quick-edit sheet could not be opened in `pnpm dev` at all — production was never affected, the pre-merge surface was. **The entry said five sheets; one.** The other four mount with `open` false, so their double-invoked run bails before pushing. `e2e/sheet-back-dismiss.spec.ts` guards it, and fails on the unfixed hook.

**The Nutrition day screen is grouped sections now, and the ring is split by macro (Q-395b).** Gaps
**420 px → 280 px (16% → 11%)**, 111 px shorter — not the *"most of the vertical space"* the entry claimed. Both themes, 11 of 11 sections. `Gate: device`.

**A food draws one way everywhere now, and its amount is edited on its own screen (Q-395a).** The
builder's rows became the shared `FoodRow`; `ingredient-row.tsx` is deleted and the quantity control lives in a new sheet. Segmented tabs went 44 → 48 px in the shared primitive, lifting 8 call sites.

**Build a Meal's ingredient picker is its own component (BF-11a).** `saved-meals-sheet.tsx` 774 → 590 lines; `openBuild`'s reset setters became a keyed remount.

**Q-319's water bug was unreachable, and the half its entry called fine was the broken one.** The generic sheet wrote an ABSOLUTE water total — reintroducing SYNC-P7 — and queues `waterMlDelta` now.

**The workout write path can be driven past set 1 (Q-461).** The Start Set bounce never gave Playwright a stable frame — 85 ms vs 8,009 ms with and without the reduced-motion rule.

**Disk maintenance works from a desktop again (Q-544).** The DB-footprint and device-metrics cards touch no plugin but sat after `OuraBleDebug`'s native early-return; both moved above it.

**The frame packer has a button (Q-316).** In the DB-footprint card, with the packable count beside it. Its confirm copy does not read like the lossless VACUUM one — this is the only control that DELETEs archival frames — and a refusal is listed with its reason. `Gate: device`.

**Declaring a ring re-key has a button (Q-317).** On `/admin/oura-ble`, outside `OuraBleDebug`, which renders nothing without the plugin — the laptop doing the re-key. `Gate: device`.

**The two BLE consoles poll the redecode job instead of guessing (Q-318).** A completed run reported `failed: 502` and the backfill said "Done" at the gateway timeout; both wait for the real status now.

**The Devices card stops calling the ring healthy with no key (LB-5).** Checks `hasKey()` and links to `/admin/oura-ble` when false. `Gate: device`.

**A ratchet row kept an already-fixed file exempt (Q-138).** `health-content.tsx` sat in `check-component-size.js` at a **915** baseline while being **651** lines — 115 lines of room it no longer merited. The script's header has said *"shrinking one below the limit? delete its row"* since it was written and nothing enforced it; **missed three times**. Enforced now, and two of Q-138's six rows turned out already done, with line numbers pointing at nothing.

**The accessibility rules ran and could not fail (Q-282, headline corrected).** *"No automated accessibility check exists in CI"* was false — `jsx-a11y` rides in via `next/core-web-vitals` and has run all along, at **warning**, so `pnpm lint` exited 0 with violations present. The app measured at **zero**, so seven decidable rules are `error` now. **It does not close the entry** — a linter cannot measure touch targets or contrast, and that half is unbuilt.

**A Coach swap leaves every program-structure cache key stale (LB-13, filed not fixed).** `app/api/coach/apply/route.ts:71` calls `invalidateProgramStructure()` **on the server**, where `lib/cache-groups` reaches localStorage and on-device SQLite — nothing. No client caller covers it, so `workout-data`/`next-session`/`workout-card:` keep pre-swap values, and `workout-card:` is `freshWithinTtl`: the Q-262 condition where stale **survives** rather than flashes. **Read from source, not reproduced.** Lane A's.

**The queue says which rows it has not classified (LB-12).** Measured: **77 of 193 entries state no lane**, and **53 of Lane B's 55 READY rows** — so two are rows the queue knows are Lane B's. Showing them to both lanes is right; being silent about it was not. They print `⟨lane unstated⟩` now. **The sweep is the Orchestrator's** and is filed, not done.

**The colour-only score subset was ONE site, not a sweep (Q-281).** Nine `scoreBand()` call sites read rather than counted: only `readiness-breakdown`'s "Final readiness" row coloured without the word. `contributor-chart` has no `.label` at all and is correct — it renders the legend. **A zero-label grep is not a violator list**, the Q-491 lesson again.

**The volume card stops guessing, and the surface was WRONG rather than absent (Q-305, half).** It
already drew a band — a hardcoded generic **10–20** — while `packages/shared` computed real per-muscle MEV/MAV/MRV beside it. The goal multiplier is what makes that material: Q-305's own first pass read the unscaled row and called lats *below MEV*; against the app's own table it is **in range** and three muscles are over MRV. The band's **word** ships with its colour — two of the four are red and mean opposite things. Push:pull stays open: it needs a taxonomy belonging in `packages/shared`, which is Lane A's. `Gate: device`.

**The raw-store console says what its numbers mean (Q-538, half).** It printed **209,326 rows, 0 rolled up, 31.2 MB**, and it took a source trace to know `0 rolled up` was the fault — the prune's predicate matches nothing, so the 14-day window can delete no row at all. It says unbounded, unbacked (past the 25 MB Auto Backup quota) and shedding now, in words. **The bound stays blocked** on an unbuilt rollup consumer that is Lane A's. `Gate: device`.

**The queue tooling learns `OR-` (PS-6).** The Orchestrator prefix was never in the ID alternation, and the failure was **silent deletion**: `next-item.js` counted **194 entries with and without** a scratch `OR-99` and printed it nowhere. One shared `scripts/lib/entry-id.js` now, not four regexes. PS-6 named three sites; there were four.

**The vacuum button can reach the table that needs it (Q-315).** The generalised `/api/admin/vacuum` had **no caller** — the one control still posted to the `oura_raw_samples`-only route. A table picker fed by that route's own `GET` fixed it. **The owner pressed it on 2026-08-25 and it correctly reclaimed 0 B**, because `error_events` was never bloated; see the Known-Issues row above.

**The Coach's undo has a button (Q-467).** A whole undo subsystem — route, five domain handlers, a `captureBefore()` in each, the `undone_at` column, even the struck-through styling — had no caller. Its route's `invalidateProgramStructure()` runs server-side and clears nothing, so the client clears the superset instead (that trail led to **LB-13**). `Gate: device`.

**E2E is green again, and the cause was a modal, not a missing button (OR-1).** Home's first-open
Morning Check-in `aria-hidden`s `<main>` while it is open, so every `getByRole` on Home reported the
affordance **absent** rather than covered — `getByLabel` found it and `getByRole` did not, on correct markup. `suppressMorningCheckin()` is the fixture. Two wrong turns are on the journal entry, one of them mine: a tile refactor built on the wrong theory, reverted in full after measuring.

**Q-477 is COMPLETE — the ratchet baseline is empty** (78 bare calls across 38 files → **0 across
539 scanned**). The last slice did not thread `tz` into the Zustand store; it stopped the store guessing. `onRehydrateStorage` compared against Brisbane while the workout screen compared against the user's zone, so a non-Brisbane user could have the day rolled over twice — and a rollover clears the day's completed-set ticks. One shell component in the root layout answers it now. `Gate: device`.

**"Nine collapsibles missing `aria-expanded`" was actually two (Q-491)** — one retired, four already Radix, two a back chevron. `weights-summary.tsx`/`added-weight-toggle.tsx` were real, now fixed.

**The end-of-workout "How hard was that session?" prompt is gone (Q-420).** 25.6% fill rate; `sessionEffort()` already derives it from set RPEs at read time, so nothing downstream changed.

**Two Health cards stop vanishing on a failed fetch, and the fix needed a second one (Q-499).** They show "Couldn't load…" on a 429/500 now. `onError` alone didn't work: `cachedFetchCore`'s dedup relayed a failure only to the torn-down owner, never a joined caller — fixed in `lib/sqlite/cache.ts`.

**The database reclaim is DONE, and the last piece turned out to be a false premise.** The owner's
`oura_raw_samples` vacuum reclaimed **36 MB** (93 → **57 MB**) and the automatic packer is observed in
production — four runs, **318,883 → 205,278 rows**, 0 faults. **Q-315's `error_events` reclaim was
pressed on 2026-08-25 and correctly returned 0 B**: that table was never bloated, and the "4 live
rows in 49 MB" figure driving the entry was a stale `n_live_tup` estimate. Closed — see the
Known-Issues row for what it really holds.

**Four engine fixes, each of whose entry described something other than the defect.** A deload's
stored `0` was being served as the previous 1RM (**Q-298** — `listPrevious1rm` gated on `IS NOT NULL`
while its two siblings already filtered `> 0`); **11 of 81 production sessions (13.6%) ran 534–845
min** and are real workouts left running, so **LA-21** culls the *duration* and keeps the session,
with `isPlausibleSessionDuration()` consolidated from three copies onto both the MET and HR branches;
the fixture MET constants sat below `estWorkoutKcal`'s 1.5 floor, so **every** MET strength estimate
was **0** in CI and those tests passed vacuously (**Q-312**); and `sessionEffort()` now returns
`{ rpe, source: 'self' | 'derived' }` so a mean of set RPEs is never read as a self-report
(**Q-420**). ⚠️ **None device-verified.** Detail, and the four wrong turns that produced them, in
[the Lane A handoff](../handoffs/handoff-2026-08-24-platform-implementation-lane-a-engine-run.md).

**The raw-frame packer runs itself, and it deletes only what it verified (Q-541 complete).** A button does not hold a growth curve — `oura_raw_samples` regrew to 92 MB within five days of the 2026-08-18 hand-run. Fires from the ingest path now, throttled per user, `OURA_AUTOPACK=off` kill switch. Automating it made the delete's race reachable, so phase 3 deletes by row id, not ds range ([`journal`](history-2026-09-10-folded-2.md#2026-08-23-feat-oura-autopack)).

**Logging food evicted the caches before the server had the write (LB-4).** The invalidation fired
correctly and too early: subscribers refetched a server that lacked the log and re-cached the pre-log
figures, which then stood for the key's full TTL — Home read 42 kcal high, exactly one entry. The
engine write paths now invalidate on **both** sides of the push (`pushThenRevalidate`); the immediate
call stays because offline it is the only one that fires. Six `components/**` sites carry the same shape — filed as **LB-6**, audit done.
The surface sweep that followed it (RV-108, **LB-132**) is complete: RV-108's weigh-in sheet was the only
site missing invalidation outright, and five more had the immediate half without the post-push one —
all shipped 2026-09-23. **The open question is answered:** `sync-engine.ts` fires no cache
invalidation at all, so the pull path never closes the window and the far-side call is the only
thing that does. Six further sites that looked identical were verified correct and are named in the
entries, so a later sweep does not patch them. **Owed: the device pass on both.**
**And the CI guard for this class could not see it (LB-133, fixed 2026-09-23).**
`check-invalidate-after-push.js` reported clean, with no baseline, through the whole period those
five sites carried the defect — it matched a ±12-line window and they sat 14 to 53 lines out.
Checked against the five real pre-fix sources recovered from git: **the old detector missed all
five; the new one catches all five and is clean after the fix.** It now brace-matches the enclosing
handler, scans `lib/` (which it never did), and found a sixth offender on its first run —
`lib/home/rest-day.ts`, where choosing a rest day invalidated the server-computed next-session
recommendation before the push carrying the choice had landed.

**Three route-hardening guards, none of them a fix for an observed symptom (Q-454, Q-455, Q-465).**
Three GET routes answered a parameter or configuration question before establishing the caller was anyone — no data leaked, but `GET /api/push/subscribe` disclosed whether the deployment has push configured to anybody who asked. `GET /api/oura-ble/decoder-constants` answered a failed constants read with an **empty** 500, so a client doing `res.json()` got a parse exception on top of the real fault. And `POST /api/day-checkin` accepted a body of `{}` with a 201, writing a row indistinguishable from a check-in in which the user answered nothing — guarded now on **both** write paths ([`journal`](history-2026-09-10-folded-2.md#2026-08-23-route-hardening-batch)).

**Three ring-service fixes, none verified on the ring (Q-537, Q-533, Q-388 item 2).** Key backup
(`/admin/oura-ble` → **Show key for backup**), a re-sync completion notification, and a connect sequence that resets the live-HR levers a killed session left on. **All native — inert until a new APK is installed, and until then the ring key has one copy.** `Gate: device`. **Item (3) needed no work:** 6,346 battery polls measure the drain the entry called unmeasurable (−22/−24/−22/−38/−15 overnight), confirming the owner's report; the SpO₂ A/B is wear, not code.

**Preferences have a server home; nothing reads it yet (Q-392, engine half).** `users.preferences`
JSONB (mig 206) behind `GET`/`PATCH /api/user/preferences`, merging under a row lock — the unlocked version demonstrably drops the other device's key mid-merge. **Nothing the owner can see changed:** the read sites are `components/**`, so Q-392 was re-scoped to Lane B, not closed.

**The UTC-offset fixture sweep came back clean, and found something else (Q-394, LA-19 — both
closed).** One *correctly written* test failed because the code under it re-derived midnight in
Brisbane: `aestMidnight` takes a timezone and only **9 of 22** call sites passed one. All 22 do now.

**`DELETE /api/activity-logs` stopped reporting success for a delete that deleted nothing (Q-556).**
Q-328's outbox delete reconciled the race that made this unsafe; it now 404s for a nonexistent or not-yours id while a double-tap still matches. The web fallback treats a 404 as success.

**Admin Device Metrics sparklines stopped stretching a partial day to full width (BF-10).**
`Sparkline` takes optional `times`/`timeDomain` and projects `x` by position in the day, so a
night-only SpO₂/HRV signal renders with dead space either side, not apparent 24-hour coverage.
Verified by mounting the component off the native-gated page. `Gate: device`.

**Coach undo wrote over whatever was there (Q-468).** With two stacked changes on one exercise,
undoing the first returned the row to its original value while the history showed the second in
effect. `driftAgainst` takes a side now. Latent: nothing calls the undo route yet (Q-467).

**The worse sync failure had the softer handling (Q-476).** A mutation rejected by the push route's
schema was deleted forever — no badge, no toast, no retry. It returns a per-item error now, so the
row is kept and dead-letters. **The entry's fix shape was wrong:** `retryable: true` backs off the
whole queue under Q-475's split; `retryable: false` quarantines. Write-time companion still open.

**`workout_sessions`'s dead column owned the name the live one was used under (Q-474).** Of its two
FKs to `program_sessions`, `session_id` is live and `program_session_id` never written — yet the
Drizzle property `programSessionId` pointed at the dead one, which already cost a session. Property
names only; the column stays (dropping it is data-losing, owner-gated).

**A rate limit is not an idempotency mechanism (Q-470).** The background prescription regeneration
fired twice for one session-day — two call sites, and `cachedFetch` revalidates on every screen open.
It now takes an in-flight marker keyed like its fingerprint, released when the work settles
(**including on rejection** — a leak would wedge that session-day) and checked before the limit.

**The AI-usage screen's top row was an artefact of its own fingerprint (Q-471).** Three meal-plan
sections fingerprinted on a rounded calorie target alone, so every reroll read as a double trip.
**44 of the 89 redundant calls were this artefact; the other 45 are real** (Q-470, Q-469) —
[journal](history-2026-09-10-folded-2.md#2026-08-23-ai-fingerprint-granularity).

**The Oura rollup now takes an I/O port (Q-545, D2 Task 2).** `aggregateOuraRawSamples` is now
`runOuraRollup(io, timezone, opts)` behind a 22-method `RollupIO`; `adapter.ts` drops 6,906 → 5,818
lines, no behaviour change. Models followed — `sleepnet`/`step-counter`/`dhrv` take a `ModelRuntime`
instead of importing `onnxruntime-node` — and constants followed by injection, so `run.ts` reaches
**zero** server-only modules. Device half is Task 3, unblocked
([journal](history-2026-09-10-folded-2.md#2026-08-23-constants-injection)).

**The public repository is now the working repo.** `nekodas-neko/TrainingAi_Open` carries the
history that was ported out of the archived private repo (PRs #1, #3, #7). The archived repo is
reference only — nothing lands there.

**Work runs through six standing agents.** Two Implementation lanes split the backlog by file
ownership, plus an Orchestrator owning the queue and docs, and a BugFix, a Tuning and a Review
agent. Their roles, authority limits, lane contract and cold-start prompts are in
[`docs/agents/README.md`](../agents/README.md). Start there, not straight off the queue.

**Entry IDs come from your agent's own prefix now, not a reserved band** (2026-08-19). `LA-` Lane A ·
`LB-` Lane B · `BF-` BugFix · `RV-` Review · `TN-` Tuning · `PS-` one-off sessions, counting up with
no shared pointer to collide on. Bands exhausted and their ledger drifted twice; the prefix says who
*found* an item and never changes, so an entry filed by Review and built by Lane A keeps its `RV-`.
Legacy `Q-` numbers stay valid and are not renumbered. **An implementer's first command is now
`node scripts/next-item.js --lane <A|B>`**, which prints READY / PARKED / UNCLASSIFIED from the new
`Needs:` and `Gate: owner|device` fields — the queue file cannot show you which of its top entries
are actually startable.

**Session handoff:** [`docs/handoffs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md`](../handoffs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md)
— Tuning retracted its own Q-528: `oura_daily_summary` was never wiped, and **43 of its 45 rows were
created 2026-08-17 07:50**, straddling the reading that reported one. The count came from
`pg_stat_user_tables.n_live_tup`, a **planner estimate** that reads **0** against `oura_raw_packed`'s
**764** real rows — **to ask whether a table is empty, run `count(*)`**, a rule now in `CLAUDE.md`.
With Q-525 un-suspended, both of chronic stress's countable gates were measured and **both pass**, so
its refusal is inside the granular layer, which records no reason for a null (**TN-1**).

**Session handoff:** [`docs/handoffs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md`](../handoffs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md)
— CI's **Migration Check** couldn't fail on a broken migration; fixing that caught `142_claude_ro_views.sql`
creating a view over a table `143` creates, aborting on every fresh CI database. Also the CSP's
missing `'wasm-unsafe-eval'` and the done screen's first-ever-weight calorie estimate. **PS-3 closed
on top:** the four migrations retried on every cold start are idempotent now, 206 of 206
([journal](history-2026-09-10-folded-2.md#2026-08-20-non-idempotent-migrations)).

**Older session handoffs:** [2026-08-20 workouts energy/RPE intake](../handoffs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md)
(reasoning, not status) and [2026-08-17 agent model/device findings](../handoffs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md)
(**Q-536 CLOSED, confirmed on device**; its cause **Q-314** is still live and reopens on every re-pair).

**Open PRs:** run `list_pull_requests` — any snapshot written here goes stale within the hour, and
one already did. The two oldest, #6 and #10, are public-repo-migration handoffs open since 08-17.

**What shipped recently is in the journal, not here.** Read `docs/overview/entries/` for the current
window, then the newest `history-*.md`. The 157 dated status notes this section used to carry are in
[`docs/overview/status-archive.md`](status-archive.md), which records why.

---

## 🔑 Waiting on the owner

**One place to look for everything the engine cannot unblock itself.** Each row is verified against
the code or against production data, not inferred, and each has a `Gate:` or `Verify:` field on its
backlog entry so `next-item.js` parks it instead of handing it to the next implementer as ready work.
Last swept **2026-09-03**.

| What | Why it needs you | Where it is recorded |
|---|---|---|
| **Run a `fullHistory` rollup pass** | ⛔ **DO NOT ATTEMPT — the workaround is measured not to work, 2026-09-03.** Three attempts have now produced nothing: the async jobs of 08-30 and 09-03 03:00 (reaped at 30 min), and the **synchronous** run at ~08:00 on 09-03, which had written nothing 35 minutes later. The full-history write path deletes and reinserts every row, so a completed pass leaves one shared `created_at` — there are **17 distinct stamps** and the oldest is **2026-08-17**, which dates the last success. The previous advice here ("run the sync path once only, it completes behind the 502") was true on 2026-08-17 and is not true now. **Nothing is owed by you.** ✅ **Diagnosed the same session:** the rollup worker loses its database connection mid-pass (`Connection terminated unexpectedly`, `at Worker.<anonymous>`, recorded in `error_events` at 08:04:43Z and once before, on 2026-08-17). Not the Postgres server — `max_connections` 500, 11 in use. Engine fix, no owner action. |  TN-1, Q-525, LA-56 |
| **Decide the rest/active HR anchor** | **Freeze at a dated constant (recommended) or move to a 90-day trailing mean.** The 90-day option moves the at-rest share **14.9% → 25.9% on 56 of 57 days** — a Body Battery re-levelling, not a stability fix. Structural: a longer window always sits above a shorter one while fitness improves. | Q-515, [review](../reviews/2026-09-02-hr-rest-anchor-level-shift.md) |
| **An S25 smoke run** | Local SQLite **v34 + v35 + v36** have never been opened on a device. v35 and v36 are plain ADD COLUMNs, but they sit behind v34's table rebuild, so a device upgrading from v33 runs all three in one pass. | Known Issues, three rows |
| **The PS-17 back-fill** | `POST /api/oura-ble/samples/redecode` is admin-session gated. Also recovers two of PS-19's seven nights. | PS-17, PS-19 |
| **PS-20's counted-walk test** | The `0x73` cm-per-step hypothesis cannot be settled from stored data — it needs a walk with a known step count. | PS-20 |
| **`worn_hours_ble` and `recovery_index_hours`** | Both **0 of 107 rows** on `oura_daily_derived` with no producer. Populate or drop — and dropping is destructive. | Q-510 `Keep:` |
| **Zone minutes / active minutes re-band** | Tuning has proposed and measured it; it re-scores a contributor reading ~6/100 on 53 of 59 days. Your quoted instruction covers the **anchor** half only, not the WHO band shift. | Q-523 |
| **The movement-per-hour boundary** | Same boundary as the anchor decision above, so it waits on it. Saturated at **856 of 857 waking hours** — it measures ring wear. | Q-522 |
| **Body Battery's drain model** | The replacement is **already owner-confirmed and fitted** (goal-normalised `c`, BMR-proportional baseline). It is sequenced behind the anchor decision above, so that one release unblocks it. Today `0` means *"you wore the ring a long time"*, close to the opposite of what you asked for. | Q-521 |
| **Whether to close Q-283** | Its "~11 MB of unused indexes" is now **800 kB** once primary keys and unique constraints are excluded, and its one real candidate was already dropped. Implementing it means a destructive migration for 0.4% of the database. | Q-283 |
| ~~Approve the Sentry tunnel's widening~~ | ✅ **DECIDED 2026-09-03 — delegated, and reverted.** The tunnel ships behind the auth gate: a signed-in request falls through, so BF-92's reported defect (13 days of browser silence while signed in) is fixed without it. Exclusion would only have added sign-in-screen errors, at the cost of an unauthenticated relay to any Sentry project via this domain. **Still owed: the device check** — a deliberate throw from the APK appearing in the dashboard. | BF-92 |
| **Whether the macro grams and the calorie budget should share an anchor** | The grams come from your stored daily goal, the budget from resting burn + goal + movement recorded — a **constant 406 kcal apart, all day, every day** (they do not converge; the earned addend is in both). The card now says so, which is the whole of what shipped. Scaling grams to the budget prints a morning protein target near 113 g that climbs — the reason it was not just done. TN-29 protects the stored 1,660. | BF-134 `Keep:`, [journal](history-2026-09-12-folded-1.md#2026-09-09-fix-macro-budget-anchor-label) |
| **Where "Exercise detected" gets its data** | Its only writer was the Oura Cloud sync. Either the BLE classifier feeds the existing review UI, or the card and its route retire. Either branch is a different feature. | Q-231 |

## ⚠️ Known Issues & Risks

> **The open issues moved to [`docs/overview/known-issues.md`](known-issues.md) on
> 2026-09-27 (Q-220)** — 451 entries that were **79% of this file**, which calls itself a lean index
> and is read at the top of every session. The move was whole: nothing rewritten, reordered or
> archived.
>
> **Read it when you touch a pillar**, and grep it the way you always did —
> `grep -n '^### .*\[sleep\]' docs/overview/known-issues.md`. Resolved issues remain in
> [`docs/overview/known-issues-resolved.md`](known-issues-resolved.md).


---

## 📋 What's Left To Do

> **Ready-to-build work is queued in [`docs/implementation-backlog.md`](../implementation-backlog.md);
> open uplift ideas are in [`docs/planned_upgrades.md`](../planned_upgrades.md).** The list below
> is the residual legacy backlog — mostly ✅/🚫 — plus the device-only verifications that can't be
> exercised in the sandbox.

**The next migration number and SQLite version are not written here any more** — run
`node scripts/next-schema-number.js`. This line read *167* and *v20* against a directory at 289 and
a schema at v43, and advised verifying with `ls`, which cannot see the numbers an **unmerged
branch** holds — how an inbound PR came to claim 288/289 after `main` had used them (BF-211/BF-213).
The four applied same-number collisions (081, 087, 146, 161) are grandfathered in
`scripts/lib/migration-claims.js`; an applied migration is never renamed.
