# Session history — August 2026 (batch 4)

Folded from `docs/overview/entries/` by the compaction chore on 2026-09-01, oldest first.
Started as a new batch because `history-newest.md` had reached 333 KB, over the ~250 KB
per-file rule. Only entries that **no durable doc cited** were folded; the rest stay loose in
`docs/overview/entries/`, which is what keeps every existing citation working.

---

<!-- folded from docs/overview/entries/2026-08-26-model-versions-jsonb-merge.md -->

# 2026-08-26 — the model stamp that another pillar could erase (Q-273)

**Branch:** `fix/model-versions-jsonb-merge` · **Lane A** · no migration, no APK.

`oura_daily_derived.model_versions` is a **map** of pillar → model version. The shared upsert wrote
every column with `COALESCE(excluded.col, existing.col)` — replace-if-non-null. For a map that means
**the last pillar to stamp wins and every other pillar's key silently disappears.**

Not theoretical. `backfillBodyComp` writes `modelVersions: { bodyComp: … }` flat, so every day it
touched lost its readiness stamp. Readiness escaped only because `readiness-payload.ts` read the row
first and spread the result back — two statements, so a race, against a value that could already be
stale.

The stamp exists so a correlation computed across a model change can be split by model. **A stamp
another pillar can erase does not do that job, and the erasure leaves no trace.**

## The fix

`upsertOuraDailyDerived` now merges that one column inside the statement:

```sql
model_versions = COALESCE(existing.model_versions, '{}'::jsonb) || COALESCE(excluded.model_versions, '{}'::jsonb)
```

Every other column keeps `COALESCE`, which is right for a scalar. Each pillar writes only its own
key, no writer can clobber another, and the JS read-merge is deleted rather than copied to the next
three pillars that need a stamp.

## Verified

- **Five DB-backed tests, and they fail against the old code.** Reverting to plain `COALESCE` fails
  **3 of 5** — including *"a later pillar stamping its own key keeps the earlier one"*, which is the
  live sequence — while the two that should pass either way (a write omitting the field; the first
  stamp on a fresh row) still pass. That asymmetry is the point: the suite distinguishes the fix from
  the bug rather than merely exercising the code.
- The tests also pin that re-stamping the **same** pillar still overwrites that key, so merging did
  not freeze a version at its first value.
- **Full suite 599 files / 4,901 tests green** — exactly +5. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 58 of 58** · lint 0 errors.

## The premise was partly stale, which is why it was checked first

Q-273 was filed 2026-08-15 saying no pillar but Body Battery records its model. By now the
`model_versions` column exists on `oura_daily_derived` and **two** pillars write it. Building the
entry as written would have re-added a column that was already there. What was actually missing was
not the column — it was that writing to it was unsafe.

**Q-273 stays in the queue with its residue stated.** Sleep, activity and training load still do not
stamp, and giving them one means *defining* their model versions: only two such constants exist in
the tree, and inventing three more in passing is a judgement about each pillar's model that belongs
with whoever owns it. The backfill half is untouched and should stay that way until someone decides
it — re-deriving history is the Q-304b hazard.

## A second cross-file test collision, same shape as this morning's

The new test file turned the suite red in `backfill-derived-scores` — a file this change never
touches — on `sleep_sessions_user_id_fkey`. Same class as `...05e3` earlier today: `...f002` is that
file's only test user **and** an incidental "other user" in `user-preferences-merge.test.ts`, which
deletes it. Parallel workers, one shared database, so the delete lands between the other file's seed
and its query.

Twice in one session is a class, so it was **measured rather than patched**: 603 test files hold
**233 distinct hardcoded UUIDs**, **10 shared across files**, **7 of them risky** (shared *and* some
holder deletes from `users`). Two are now fixed; the remaining six and a CI check to hold it at zero
are **LA-32**, filed with the table. Swept-but-unchecked is the weaker half, which is why the check
is in the entry rather than the sweep being done blind here.

## Also shipped: Q-273's scope item 3

`CLAUDE.md` gains *A Correlation Across a Model Change Is Not Evidence*, with the worked example —
four model versions pooled over 40 days produced **r = −0.06**, written down as evidence the model
had no outcome signal, where **v5 days alone give r = +0.67**. That stood in the docs for eleven
days. It also records two facts that are properties of a *pair* of files and invisible from either:
`model_versions` merges and must never regain a JS read-merge, and `updated_at` does not identify
the writing model.

## The compaction chore bit, and the recovery is the part worth recording

Merging `main` tripped `check-doc-index-size` at **61 foldable journal entries against a limit of
60** — Lane B was adding entries in parallel, so the shared count crossed on this branch. The
documented fix is the compaction sweep, so it was attempted, and it went wrong in two ways at once:

1. **It folded by DATE rather than by the unlinked list**, which is trap #1 in
   [`entries/README.md`](entries/README.md) — *"do not fold an entry that another doc links to"*. 45 entries
   went in where only a subset was foldable, breaking six links immediately.
2. **It wrote to `docs/overview/history-2026-08-24.md`, which already existed** — a 228 KB file —
   and clobbered it.

Nothing was lost: the fold was never committed, `git merge --abort` restored the pre-merge tree, and
`history-2026-08-24.md` was verified **byte-identical to `origin/main`'s copy** rather than assumed
intact. **The lesson is the one in the README's own trap list**: a fold is driven by the *linked/
unlinked* computation, never by a filename glob, and a fold target is appended to, never written
over.

The sweep was not re-attempted after that — it is Orchestrator's chore, and #528 did it properly
within the hour, folding 52 entries and amending the rule. The stopgap used in between was to cite
this entry from the readiness domain index, which took it out of the foldable set; **that citation
has been removed again** now the pressure is off, because `projectOverview.md` is right that a sweep
can undo a fold and cannot undo a citation, and a workaround kept past its reason becomes a
permanent cost.

## Not exercised

No migration (the column already existed) and **no APK** — server-side only. Nothing native,
offline-first, safe-area or gesture-related, so **no device smoke run is owed**. The production
backfill has not been re-run; the fix is forward-only, so days whose readiness stamp was already
erased stay erased until something re-stamps them.

---

<!-- folded from docs/overview/entries/2026-08-26-my-foods-split.md -->

# 2026-08-26 — My Foods put two different things in one list

**Branch:** `fix/my-foods-split` · docs-only · BugFix Intake

## The report

*"my foods combined saved meals + history thats not right they are 2 seperate things."* — on
v1.382.0, which is Q-395c.

## The distinction worth stating, because it is not a change of mind

Q-395c was specified from the owner's own earlier question: *"So im picking up a discrepancy between
My Meals and My foods? Whats the difference"*. That was read as *these are one list wearing two
names*, and the merge followed.

Re-read against today's report it says something narrower: **two lists with confusingly similar
names, and no way to tell which held what.** The fix was to name them so the difference is obvious.
It was not to delete one of them.

They are genuinely different kinds of thing:

| | Saved meal | Food item |
|---|---|---|
| What it is | a composition — ingredients, a batch, a per-portion figure | one ingredient with a serving size |
| How it got there | you assembled and saved it | it appeared because you logged it once |
| What logging it means | log the whole thing | pick a quantity of one thing |

A composed recipe and a raw ingredient in one list makes *"log this"* ambiguous on every tap.

**BF-37** therefore reverses the merge and **keeps three things Q-395c got right**, so it is not
reverted wholesale: the naming sweep, `food-list.tsx`'s two-source design (its own journal says a
food row and a meal row already open different destinations — the separation exists inside the
component), and LB-17's three-deep back-dismiss fix, which is unrelated and hard-won.

## The bug in the same screenshot that was not reported

`LOADED MAC & CHEESE / CORE POWERFOODS / 350 g` appears **twice** in a 24-item list. Measured against
production:

| Measure | Value |
|---|---|
| `food_items` rows | **209** |
| Distinct name + brand | **190** |
| **Redundant** | **19 — 9%** |
| By source | `ai` 14 names / 32 rows · `barcode` 1 / 2 · `text` 0 |

Filed as **BF-38**, Lane A's #1. Two things make it worth fixing now rather than tolerating:

- **It multiplies BF-35's spend.** Three rows for one mac and cheese is three generated images, three
  stored copies, and three different-looking pictures of one product in a single list.
- **It corrects this session's own measurement.** The "209 food items" behind BF-35's storage
  estimate is really **190 foods and 19 accidents**.

The entry says explicitly **not** to clean up history with a merge migration in the same change:
`food_logs.food_item_id` is `ON DELETE RESTRICT`, so collapsing duplicates means re-pointing every
log at a survivor, and a wrong matching rule rewrites what the owner ate. Stop the creation, live
with the 19, decide de-duplication separately once the rule is shown correct on new writes.

## Also confirmed

**BF-34 shipped** — `2026-08-26-sibling-sheet-back-dismiss.md`. The delete fix is on `main` and
carries `Gate: device`; it needs the owner to press it.

## A logged meal stops being a meal (BF-39)

Owner: *"the meal is a complete in 'saved meal' and it can have a picture etc. but when adding it to
the log; its broken down into its components so the image wont transfer over ... maybe it needs to
stay as a whole item."*

Right, and the missing piece was already written down as a *different* problem. Logging a saved meal
writes one `food_logs` row per ingredient and **nothing records that they came from a meal** —
`food_logs` has `food_item_id` and no `saved_meal_id`.

**Three symptoms, one cause:**

| Symptom | Where it surfaced |
|---|---|
| The meal's photo cannot follow it into the diary | this report |
| A saved meal has **no last-used timestamp at all** | Q-395c's journal, filed as a constraint |
| The diary shows five ingredients where one thing was eaten | implied by both |

Q-395c's journal says it outright — *"True MRU needs a column that does not exist — Lane A's to
add."* That is this column, and adding it for ordering alone would under-sell it.

**Recommended: stamp the ingredients, don't change the row shape.** A nullable `saved_meal_id` plus a
per-log group id is additive; the diary groups rows that share it and renders the meal's name and
photo over them. The alternative the owner reached for — one row for the whole meal — makes the diary
trivially correct and costs a **second shape** in a table read by the diary, the energy balance, the
adaptive-TDEE window, the sync delta and the local store, and it makes editing one ingredient
impossible without decomposing anyway.

**The owner's phrasing asks for the outcome, not the storage.** "Stay as a whole item" is satisfied by
the diary *showing* one grouped item, which the additive option delivers.

## The DEXA scan is tomorrow — what is and is not ready

**BF-33 shipped.** `measured_rmr` exists (`schema.ts:774`) with `POST /api/measured-rmr`, bounds
checking, and — the load-bearing column — `ffm_kg_at_test`, so the measurement can be re-scaled to a
future body instead of expiring on a date. **There is no UI yet**: `grep` finds no `.tsx` referencing
it. Entry is a route call, not a screen.

**BF-2 has not shipped.** No `dexa` anywhere in the tree. The DEXA half has nowhere to go.

**So the operational note went into BF-2, because one part of tomorrow is irreversible.** The owner
identified it themselves: *"Will need to get the dexa matched with the same days renpho scale
measurement."* The scale reading is one half of the calibration pair and cannot be reconstructed
later — while the DEXA numbers can be entered any time, since the record is dated by when it was
measured rather than when it was typed.

---

<!-- folded from docs/overview/entries/2026-08-26-q513-already-fixed.md -->

# 2026-08-26 — Q-513's window was already 28 days, so there was nothing to implement

**Branch:** `fix/build-day-audit-acwr-window` · **Lane A** · docs only.

Q-513 says `score-audit/build-day-audit.ts` passes **all history** to `computeVolumeAcwr`, making the
chronic denominator a *lifetime* weekly average — inflating the ratio, disagreeing with the engine's
band on **38% of days**, and showing `very_high` on three days the engine never saw past `high`.

Checked against current `main` before implementing, which is the habit that has now changed the work
on eleven consecutive entries. **The code already does what the entry asks.**

| | |
|---|---|
| `build-day-audit.ts` | `AUDIT_HISTORY_DAYS = 28`, fetches `getWorkoutSessionsFrom(userId, dayMid − 28d)` |
| `readiness-payload.ts` (engine) | `from28dDate = todayMid − 28d` |
| banding | both through `ACWR_THRESHOLDS` |

Same 7:28 shape, each anchored at its own day. The "lifetime weekly average" mechanism the entry
describes is not what the file does.

## What I did not conclude

`git log` attributes the 28-day constant to #137 on 2026-08-19 — a day after Q-513 was filed — which
would make it an incidental fix by unrelated work. **This clone is depth-limited and that same commit
shows the file as a 280-line pure addition**, which is what a shallow boundary or the public-repo
import looks like as much as a real creation. So the attribution is not load-bearing here and is not
claimed: what is verified is the code as it stands, read directly.

## What is still owed, and it is not Lane A's

The entry's second half — *"then re-measure"* — has **not** been done. Nobody has re-run the 88-day
replay against the current window, so **38% of days, mean |difference| 0.150, three days past the
emergency-deload line are all unconfirmed and may already be zero.** That replay is Tuning's tooling
and Tuning's proposal to make; Lane A has nothing to implement until it says otherwise.

So the entry **stays in the queue with a `Keep:` and `Gate: owner`** rather than being deleted. Deleting
it would lose a real open question; implementing it would have meant changing a window that is already
correct, which is the "forcing a mismatched implementation just to clear the queue" that CLAUDE.md
names outright.

## Verified

- `pnpm check:rules` **Ran 59 of 59** · `check-backlog-pointers` OK at 204 entries · Q-513 confirmed
  moved out of READY into the gated set by `next-item.js`, not inferred from the diff.

## Not exercised

Prose only. No code, no measurement — and the measurement is precisely what is still owed.

---

<!-- folded from docs/overview/entries/2026-08-26-q519-manual-bedtime-audit.md -->

# 2026-08-26 — Q-519's own audit falsifies Q-519's design

**Lane A · branch `docs/q519-manual-bedtime-audit` · docs only**

Q-519 (manual bedtime entry for a night the ring missed) ends with an instruction rather than a
finding: *"audit whether any consumer recomputes duration/efficiency from the span; that audit is part
of this item, not a finding of the review."* And a warning: *"if anyone later recomputes duration or
efficiency from the span, this silently produces a 9-hour night at 34% efficiency."*

Run before implementing: **something already does.**
[`docs/reviews/2026-08-26-manual-bedtime-write-audit.md`](../reviews/2026-08-26-manual-bedtime-write-audit.md)

- `aggregateNight` (`sleep-night.ts:225`) computes `timeInBed = last.sleepEnd − first.sleepStart` and
  `efficiency = totalSleep / timeInBed`. On the owner's own reported night that is 9.05 h and **34%** —
  the warning's number exactly. Guarded only by a single-window fast path, so it fires on a fragmented
  night, and Q-274 measures ten fragment rows in production. Seven consumers reach it via
  `nightSessions`.
- The daytime-HRV model classifies samples by window membership and is fed from **stored** rows, so
  five awake hours would enter its *nightly* training set. No fragmentation needed. That fit feeds
  daytime-stress, which feeds resilience — already open as Q-507/Q-508/Q-510.
- `primaryCluster` unions same-date rows within an hour of the window, so widening the start can pull
  in an evening fragment: the "7:40 pm bedtime" bug that function exists to prevent.

**One consumer looked affected and is not**, and that is worth as much as the three that are:
`stress-resilience.ts:104` runs the identical window test, but its windows come from the rollup's own
freshly-built rows, never from storage. Third wrong-source near-miss of the session, after
`recovery_index_hours` on the wrong table and `n_live_tup` against a real count. **Trace the value to
its writer before believing a consumer is affected.**

## The corrected design

A nullable `manual_sleep_start` on `sleep_sessions`, read by the bedtime estimate and nothing else. It
delivers the owner's stated outcome — *"I don't want it to change estimated bed time values"* — while
the measured window stays measured. It costs the migration the entry ruled out, and that ruling rested
on the premise the audit just removed.

The principle underneath: **the per-field merge exists to let a better *measurement* of the same
quantity win.** A remembered bedtime is not a better measurement of the observed sleep window — it is
a different quantity, and giving it the same column is the entire cause.

## Also fixed: two ordering constraints that were prose

- **Q-294** sat at READY #3 while its own body says *"Do not start this as a standalone item"*. Its
  four cells each need an owner decision on intended behaviour first, so it now carries `Gate: owner`
  and the queue tool stops offering it.
- **Q-520** said *"Do Q-519 first"* in prose; it now carries `Needs: Q-519`, so it parks behind its own
  prerequisite instead of being offered above it.

Both are fields the protocol already has. The general "notes should leave READY" sweep remains the
Orchestrator's.

## Not done

The implementation. Q-519 stays in the queue carrying the corrected design and the shape it needs.

---

<!-- folded from docs/overview/entries/2026-08-26-recipe-image-intake.md -->

# 2026-08-26 — a recipe screenshot has nowhere to go, and almost everything for it exists

**Branch:** `feat/recipe-image-intake` · docs-only · BugFix Intake

## The request

*"id like to be able to upload an image like above to the meal creator and have it make it - i see we
dont have that upload option yet."* — with a screenshot of a Google recipe overview.

## Where the meal creator actually is

The BF-11 chain is mostly shipped. **BF-11b, c, d, e, f and g** are all out of the queue with journal
entries — the scan returning N candidates, recipe-URL import, duplicate detection on save, meal-type
tags, tagging from Build a Meal, and the planner searching the library before asking the AI.

What is left: **BF-11h** (the wizard rendering what BF-11g's engine already returns — `source`,
`matchReason`, `libraryMatchCount`, `droppedPins`; and **nothing sets `useLibrary` yet**, so the
library search is off for every real request until that entry turns it on), **Q-407** (the wizard's
seven screens for six answers), and **BF-11** itself as the spec and final checkpoint.

## The finding: this is smaller than it looks

BF-11c shipped recipe import — the builder's search field detects a URL and `importRecipe()` POSTs
`{ url }` to `/api/nutrition/scan`, which returns `ingredients[]` and `candidates[]`, mints a
`food_item` per ingredient, and hands them to the builder.

**That same route already accepts `{ image, mimeType }`,** and both branches share one `ScanSchema`
that already carries `ingredients[]` and `candidates[]`. The plumbing exists end to end. Two things
are missing:

1. **The image branch's per-request prompt says `'Analyse this food photo'`** — which, handed a
   screenshot of an ingredient list, instructs the model to estimate a finished plate instead of
   reading the list. The *system* prompt above it already understands recipes and multi-dish pages.
2. **No affordance** in the builder to hand it an image.

## Why the URL path doesn't already cover it

The owner's screenshot is a **Google AI overview**, not a recipe site. The ingredients are rendered
into Google's own results page with the source behind a `YouTube · MOMables` chip — **there is no
recipe URL to paste.** The image is the only handle on that content, which is precisely the case the
URL path cannot serve.

## The trap, already paid for once

`importRecipe()` carries the comment: `recipeYield` *"is handed straight up rather than defaulted to
1 … a banana-bread page measured 1,956 kcal for the loaf. Deciding here that it is one portion is
exactly the four-fold calorie error that reads as plausible."*

The URL branch gets the yield from the page's JSON-LD. **A screenshot has none**, so it can only come
from the model reading it off the image or from the builder's batch-size field. Null is the correct
answer and the builder already asks. The entry says never to default it.

## One design line worth holding

*Photograph your dinner* and *screenshot a recipe* are different acts with different outputs — a
logged food versus a saved meal. One tile that guesses which was meant will guess wrong. The owner
said *"the meal creator"*, so this belongs in the builder beside the URL path, not on Log Food.

---

<!-- folded from docs/overview/entries/2026-08-26-test-user-uuid-collisions.md -->

# 2026-08-26 — the shared test-user UUID, and why the obvious check would have been deleted (LA-32)

**Branch:** `fix/test-user-uuid-collisions` · **Lane A** · no migration, no APK.

Three times on 2026-08-25/26, **adding an unrelated test file turned the suite red in a file the PR
never touched**. Vitest runs test files in parallel workers against one shared local Postgres, so if
file A hardcodes a user UUID as its only test user and file B hardcodes the same one as an
incidental "other user" it deletes in cleanup, B's delete can land between A's seed and its first
query. A dies on a foreign key, naming a table nobody edited — and it stays hidden for exactly as
long as scheduling keeps the two apart.

## The count in my own entry was wrong, and finding that out was the work

LA-32 was filed with a survey saying **7 risky, 2 fixed, 6 remaining**. Re-measuring against current
`main` before touching anything — the habit that has now paid on eight consecutive entries — found
**one** real collision. Five of the six were false positives:

| UUID | verdict |
|---|---|
| `…00cf01` / `…00cf02` | **REAL.** `clear-program-prescriptions` and `coach-domains` both INSERT *and* DELETE both ids, with **different hardcoded emails** — so they race on `users_email_unique` as well as the foreign key. |
| `…00d011` | **False.** It is a *program* id in `coach-options-source`, which deletes entirely different users. |
| `fe481797…` | **False.** It is the canonical `claude_ro` owner id, which those files are *supposed* to agree on. Nothing deletes it as a user. |
| `1111…4111…`, `…0000ff` | **False.** Pure-logic files that never touch the `users` table. |

The filing's rule was "shares a UUID literal, and some holder mentions `DELETE FROM users`". That is
not the same claim as "shares a *user id* that someone deletes", and the gap was 83% noise.

## Why that ratio decided the shape of the fix

**A check that is 83% false positives is one the first person it stops will baseline into
uselessness.** So the detection is narrow: the UUID must reach an `INSERT INTO users` /
`DELETE FROM users` statement — directly, or through a `const` named inside it — in two or more
files, with at least one deleting it. `scripts/check-test-user-uuid-collisions.js`, in the Custom
Rules job (**Ran 59 of 59**, up from 58), **baseline empty** so the next collision is a regression.

**Getting that narrowness right took three attempts, and the first two shipped bugs the tests now
pin.** A fixed 400-character tail after the SQL keyword swallowed the *following* statement — that
is how `fe481797` was reported, from an unrelated `ALTER ROLE … claude_ro_owner = '<uuid>'` on the
next line. Breaking instead at "a line ending in `)`" stopped **inside** the SQL, which ends lines
with `)` constantly (`… VALUES ($1, $2, 'x', 'T')`), so no parameters were seen at all. Tracking
string parity fails for a third reason: a match starting at the SQL keyword starts *mid-literal*
with no way to know which delimiter opened it. What works is scanning the whole `query(...)` call
with balanced parens — the parameter array is inside it by construction and the next statement is
outside it by construction.

## Verified

- **Seven detection tests, five of them false-positive cases**, because those are what the check
  lives or dies on. Mutation-checked with proof each edit applied: restoring the 400-char tail fails
  the after-the-delete case; dropping the users-table requirement fails the program-id case.
- **The real collision fixed** — `coach-domains`'s `OWNER3`/`OWNER4` moved to `…cfa1`/`…cfa2` with
  **emails derived from the id**, so a stale hardcoded address can never outlive a rename. Both files
  run green together (33 tests), which is the pair that could not before.
- **Full suite 600 files / 4,908 tests green** — exactly +7. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 59 of 59** · `check-backlog-pointers` OK at 205 entries.

## Not exercised

No migration, no APK, no runtime code — test fixtures and a CI script. The check's known blind spot
is a user id passed through a helper the scan cannot follow, which reads as unused. That is
deliberate under-reach: a false negative costs a flake, a false positive costs the check.

---

<!-- folded from docs/overview/entries/2026-08-26-tuning-battery-anchor-is-readiness.md -->

# 2026-08-26 — the Body Battery does not charge overnight; its morning value IS the readiness score

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner, on a 7:03 am Home screenshot reading Readiness 53 / Sleep 57 / Activity 63 / Battery 53:
*"everything is so low — battery starts at 57? I figured it should be much higher when waking up."*

**The battery has no overnight charge phase.** `walkBodyBattery` filters samples to
`tsMs >= wakeTime`, and `resolveAnchor` sets the starting value to the readiness score. So the number
on the screen at wake is a readiness score wearing a battery label — and anything that penalises
readiness lands directly on it. Today: `anchor = 53`, `anchor_source = 'readiness'`,
`readiness_score = 53`, `hr_sample_count = 0` (nothing walked yet).

**Most of the gap is the temperature penalty already queued.** Today's `temp_dev_c` is **+0.466**,
which trips the −10 arm, so readiness would read **63** and the battery would start there. Across the
35 days holding both a battery row and a deviation:

| | now | penalty removed |
|---|---|---|
| mean morning anchor | **64.8** | **76.8** |
| mornings ≥75 ("Charged") | **7/35** | **21/35** |

Conservative: the 6 days clamped at 40 by the >1.0 °C arm count as unchanged, because a clamp cannot
be reversed by adding the penalty back.

**Recorded as a pass test on TN-6 rather than filed as a new entry.** The fix for "the battery never
wakes up full" is the baseline fix already signed off; proposing overnight charging or an anchor
redesign would be a large change to a value Q-511 shows is load-bearing, aimed at a symptom that fix
removes. Re-measure after it lands — only then is the design question real.

**Not all of today is the model.** Overnight HRV read 53 against 60 two days earlier and resting HR
53.7 against 50.2, so `hrvBalance` 38 and `restingHeartRate` 42 are genuine. Two of nine readiness
contributors were still provisional at the time of the screenshot — `checkin` 50 (the Log Readiness
card was unanswered) and `recoveryIndex` 49.

**Sleep 57 is the calibration curve, not a bad night.** The weighted blend reconstructs to **73.15**
and `SCORE_CALIBRATION` maps that to exactly 57 — reproduced to the stored value. TN-5's uniform-gain
curve would display **≈63** for the same night.

**Not exercised:** no code ran — SQL against production plus source reading.

---

<!-- folded from docs/overview/entries/2026-08-26-tuning-checkin-and-sleep-curve.md -->

# 2026-08-26 — the check-in moves readiness by design; and a sleep curve that disagrees with its own comment

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner: *"we shouldn't have readiness move the number — the numbers should be fully set on first
open/load"*, and *"have a look at sleep and activity too. I went to bed at good hours and good sleep
hours. I trained yesterday so I'd imagine it's higher."*

**TN-9 — readiness is 10% self-report, frozen at 50 until logged.** `READINESS_WEIGHTS.checkin = 0.10`
and an unlogged check-in contributes `NEUTRAL = { score: 50, provisional: true }`, so the score
shifts the moment the card is answered. It also contradicts that card's own copy — *"It tunes today's
session, not your whole plan"* — while quietly moving the number above it.

Recommended: drop `checkin` and renormalise over the remaining eight, keeping the check-in for the
session prescription. **Measured over 35 days it is nearly free** — mean 69.9 → 70.4, sd 11.59 →
11.79, largest single-day move 3.84, **no day moves ≥5**. Removing a 10% contributor usually moves a
score; this one does not, because the logged check-in tracks the objective contributors closely
enough to add little independent information. Worth knowing before assuming any weight is
load-bearing.

**TN-10 — `TOTAL_SLEEP`'s comment and its anchors disagree by ~15 points.** The comment says
*"8h is excellent (~92); 7.6h normal-good (~86)"*; the curve gives **77.0** and **71.4**. On the
heaviest of the ten contributors (weight 24 of 110), that is ~3.3 blend points on every night in the
band most of the owner's nights land in. **Which is wrong is not answerable from data** — either the
comment is stale or the anchors were shifted — so the entry says to read the plan the comment cites
before changing either, and sequences it after TN-5 so two sleep changes are not evaluated at once.

The owner's night: 7.75 h → contributor **73.5**, blend **73.15**, displayed **57** (reproduced
exactly from the stored value). So "good sleep hours scoring 57" is the duration curve plus a genuine
autonomic dip — overnight HRV 53 against 60 two days earlier, resting HR 53.7 against 50.2 — passed
through TN-5's compression.

**Activity 63 was not filed, deliberately.** At 7:03 am the daily-movement lane (steps 18 +
activeEnergy 15 + zoneMinutes 10 + moveHours 12 = **55** of 100) is near-empty, while the strength
lane (**45**) already carries yesterday's session. A 63 with the whole day still ahead is the score
working, and yesterday's training is exactly what is holding it up. The mismatch with the owner's
expectation is Q-505's daily-vs-weekly split, already queued.

**Not exercised:** no code ran — SQL against production plus source reading.

---

<!-- folded from docs/overview/entries/2026-08-26-tuning-checkin-lookback.md -->

# 2026-08-26 — the check-in lookback, and the second thing that unsettles readiness

*Tuning · docs-only · branch `tuning/checkin-lookback`*

Owner: readiness should not be affected by the check-in, but keep the check-in as a tuning
opportunity — *"see if we can match up the signals that give a good check in"* — and *"ideally I want
the starting values to not be depicted by anything."*

**The lookback, n = 33 logged days.** The check-in correlates meaningfully with the objective
signals: restingHeartRate **+0.557**, previousNight **+0.520**, sleepBalance **+0.470**, temperature
**+0.463**, hrvBalance +0.427. Yesterday's training predicts it essentially not at all (**+0.028**) —
how hard you trained says nothing about how you report feeling the next morning.

**The multivariate half is where the honest answer is.** Best model is two predictors — resting HR
and last night's sleep — at **LOO R² 0.293**. Every predictor after that raises in-sample R² and
lowers out-of-sample: all eight contributors reach R² **0.541** with **LOO R² 0.047**. On 33 rows an
eight-predictor fit is memorising the sample, and quoting its R² would have sold a model with no
predictive power.

**Three things follow.** Dropping the check-in from readiness stays right, but **not** for the reason
this session first gave — I had written that it "adds little independent information", and r ≈ 0.5 is
~25% shared variance, so **~75% of the check-in is information nothing else has**. It moves readiness
little because its weight is 10% and it correlates with the rest. And **imputing it on unlogged days
is refuted** — 5% out-of-sample is a fabricated value with a model's authority.

**The check-in is not the only thing that unsettles readiness, and the other cause is worse.**
`activityBalance` (weight 0.06) is **today's** activity score, which is a partial day filling through
the day (63 at 07:03 against 78 and 82 on the two preceding completed days). So readiness drifts
~1 point **continuously, with no user action at all** — where the check-in moves once, on a button
press. `prevDayActivity` already uses a completed day and is settled. TN-9 now covers both, with a
pass test that two reads twelve hours apart must be identical; the check-in half alone does not
achieve that.

Review: [`docs/reviews/2026-08-26-checkin-lookback.md`](../reviews/2026-08-26-checkin-lookback.md).

**Not exercised:** no code ran — SQL plus arithmetic in Python (numpy is unavailable in the session
container, so OLS and leave-one-out were implemented directly).

---

<!-- folded from docs/overview/entries/2026-08-26-tuning-move-hours.md -->

# 2026-08-26 — "moved this hour" measures whether the ring was recording, not whether you moved

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner: *"how are move hours being tracked? I don't see a dash/notification for it at all… I'd like to
see something for it to make sure there is movement every hour. Also need to make sure it doesn't
count sleep time."*

**The mechanism.** An hour in `[wakeHour, sleepHour)` counts as *moved* when **at least one HR
reading that hour** clears `HR_REST_THRESHOLD` (0.05 of reserve). For the owner that boundary is
**57.8 bpm**, and only **1.57% of waking time** sits below it — so requiring one sample in sixty
minutes to clear it is the weakest test available. Measured over 45 days and **657 waking hours
holding data: 99.8% qualify.** With 14.6 of the 15 window-hours carrying data on a typical day, the
numerator is effectively "hours the ring recorded anything".

**This answers the open half of Q-522.** That entry recorded moveHours pinned at 100 on 48 of 59 days
and attributed the numerator's saturation to "an unrelated reason" after Q-188 fixed the denominator.
The reason is the boundary and the single-sample test.

**TN-2 does not fix it, and the two must not be merged.** Both read `HR_REST_THRESHOLD`, but Body
Battery needs *resting vs not* and this needs *sedentary vs moving*. At TN-2's most generous proposed
offset move-hours still qualifies **97.6%** of hours. Raising the shared constant far enough to fix
this would break the charge window in the other direction. Filed as **TN-11** with its own test —
sustained elevation or hourly steps, not a single touch of a resting boundary.

**Sleep is not counted**, by two independent guards: the `[7, 22)` window, and overnight HR (~50–55)
running below the 57.8 bar. But the window is **hardcoded** — `computeMovedHours` accepts
`wakeHour`/`sleepHour` and `readiness-payload.ts:324` never passes them — so the owner's 6 am wake
loses an hour of real waking time from both numerator and denominator. The night's real window is
already in `sleep_sessions`.

**On the missing surface:** there is exactly one, `app/health/activity/activity-content.tsx:64`, two
taps deep on Health → Activity, inside a block that only renders when zone-minutes or move-hours are
non-null. No nudge, no notification, no hourly breakdown. Filed as **TN-12** (Lane B) — deliberately
`Needs: TN-11`, because a nudge on a metric that qualifies 99.8% of hours would never fire and an
hourly strip would show a full row every day regardless of what the owner did. The entry also records
that a *notification* is not a small addition: there is **no cron layer** (`docs/module-map.md` §0),
so scheduling it is its own problem and its own entry.

**Not exercised:** no code ran — SQL against production plus source reading.

---

<!-- folded from docs/overview/entries/2026-08-26-tuning-pillar-review.md -->

# 2026-08-26 — the five Home pillars, answered one at a time (TN-13…TN-16, Q-507 amended)

**Tuning · docs-only.** Owner: *"Overall the pillars are not working great and not very useful.
Requires tuning."* Six specific questions, each answered with a measurement rather than a reading of
the source. Full working: [`docs/reviews/2026-08-26-pillar-review.md`](../reviews/2026-08-26-pillar-review.md).

## What each pillar turned out to be

**Heart Rate — "my value is 52; what is that?"** The **7-day average** resting HR. Over 50 nights the
nightly value moves **2.11 bpm** night to night and the tile's average moves **0.33** — it discards
**84%** of the daily movement, in the signal that predicts the owner's own check-in better than any
other (r = **+0.557**, best of nine). **TN-13**: show last night's value with its baseline delta.

**Sleep — "60 is way off."** Three causes, and the owner's 75–80 intuition matches the **blend**
(73.15); `SCORE_CALIBRATION` maps that to exactly 57, and TN-5's approved curve gives ≈63. The other
two are TN-10 (the duration curve's comment and anchors disagree by ~15 points) and a real autonomic
dip. **2026-08-19 still holds 3.50 h and still feeds every baseline** — **TN-14**.

**Activity — "how would I make this 100?"** You currently cannot. Over 30 days: mean 75.1, range
51–91, never 100. Two of the six contributors are structurally broken (`zoneMinutes` floored on 53/59
days, `activeEnergy` present on 8/51) and a third is meaningless (`moveHours`, 99.8% of hours qualify).

**Stress — "how real is it?"** It replicates **backwards**. n = 33: high-stress minutes correlate
**+0.386 with readiness** and **+0.477 with the sleep score** — the sleep correlation is stronger and
was untested in Q-507. Q-507 amended.

**Body Battery.** Both halves of the model the owner describes are absent: no overnight recharge at
all (`walkBodyBattery` filters to `tsMs >= wakeTime`), and drain that tracks wear time (Q-521).
**TN-15**, owner-signed-off, supersedes the standing "do not redesign the anchor" guidance.

**Readiness.** The one in the best shape: its two heaviest objective inputs genuinely track felt state.
Its problems are contaminated inputs already queued — TN-6, TN-9, Q-509.

## The part worth keeping: a hypothesis was refuted and not replaced

The obvious explanation for stress pointing the wrong way — better sleep → denser HRV signal → more
buckets scored → more minutes classified as anything — was **measured and refuted**: r = **−0.128**
against HR sample count. No replacement mechanism is established, and the entry says so rather than
reaching for a second story. That is why **TN-16** (the prolonged-stress warning and calm-down prompt
the owner asked for) is filed **parked behind Q-507** instead of built: a warning on this metric would
fire on the owner's best days, which is the Q-504 failure mode exactly.

## Verification

`pnpm check:rules` — **Ran 58 of 58 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. Every correlation is same-day and single-subject
(n = 30–50); none establishes direction of causation. Counts are the owner's account only
(`claude_ro` is row-scoped).

---

<!-- folded from docs/overview/entries/2026-08-26-zero-calorie-foods.md -->

# 2026-08-26 — a calorie-free food can be logged

**Branch:** `fix/zero-calorie-foods` · **Entry:** LA-30 · **Filed:** LB-15 · **Lane:** B

## What was wrong

`review-step.tsx:159` gated the primary action on `value.calories > 0`, so **every genuinely
calorie-free item was refused**: supplements, water, black coffee, plain tea, diet soft drink,
sugar-free gum, sweetener, most spices and herbs. The owner hit it on a ZMA scan the AI had read
correctly as *"It is calorie-free"* — and the only feedback was a greyed-out **Next**.

**The server never agreed with the gate.** `FoodItemFieldsSchema` is `calories: z.number().min(0)`;
the log being refused would have been accepted. Zero is a value, not a missing one.

All three of the entry's claims verified unchanged against `main` before anything was written.

## What changed

- `review-step.tsx` — a name is the only field that must be present, and **the disabled state now
  says what it wants**. That was half the bug: the report was *"it wouldn't let me log it"*, not
  *"it told me why"*, and a greyed-out primary action with no reason is indistinguishable from a
  broken app.
- `ingredient-picker.tsx:154` — the sibling surface. `!(scan.calories > 0)` classified a
  zero-calorie scan as a **failed** scan and toasted *"Could not work out the macros"*. It now tests
  that the scan *returned* — `typeof scan.calories !== 'number'` — which is what the entry suggested
  and what the rule actually is.

## The sweep found a third site, and it is Lane A's

`grep` for the same predicate across `components`, `app`, `lib` and `packages` returned four more
hits. Exactly one is the same defect:

- **`packages/shared/src/nutrition/open-food-facts.ts:58`** — `if (!(calories > 0)) return null`,
  where `null` is how the caller learns the **barcode did not resolve**. So scanning a Coke Zero
  reports an unknown barcode. Filed as **LB-15** for Lane A, because the lane rule is the path and
  this sits below both client predicates — LA-30's fix does not reach it.

The other three are **not** this defect, checked and recorded on LB-15 so nobody "fixes" them:
`macroCalorieDisagreement` returns `null` at zero because a percentage deviation against zero is
undefined (its contract), and `sanitiseNutrition` recomputes from macros when `calories === 0`,
which for a truly calorie-free item yields zero again. Both correct.

## The specs fail against the old gate

Verified by stashing the two component changes and re-running: `toBeEnabled()` fails on the
zero-calorie review step, and the missing-name message is absent. The scan route is stubbed —
what is under test is the client's handling of a zero-calorie result, not the model's ability to
produce one.

**One harness note worth carrying:** the capture tiles are a grid, and a coordinate tap that misses
`Describe it` opens **History** instead, which is a Food Library dialog with its own textbox — close
enough to the describe field that the spec filled the wrong box and failed three assertions later.
The opener now waits for the describe pane's own copy before touching anything in it.

## Gates

`pnpm check:rules` — **Ran 58 of 58**. New e2e 2 of 2, and proven to fail without the fix.

## Not verified

**Device.** The two paths are a scan review and a free-text estimate, neither of which is native —
but both are reached through sheets, and the new message is a line of copy inside one. No
`Gate: device` beyond the ordinary smoke pass.

**Not exercised:** a real zero-calorie *barcode*, which is LB-15's and needs Open Food Facts.

---

<!-- folded from docs/overview/entries/2026-08-27-clinical-import-shape.md -->

# 2026-08-27 — RMR, DEXA and blood are one intake shape

**Branch:** `feat/clinical-import-intake` · docs-only · BugFix Intake

## The request

The owner is about to send RMR, DEXA and blood results together: *"ideally you can see what we are
getting and create an endpoint or so to record these down- then the ability to upload the documents
and have it auto scan. I will scrub it of my PII first. but there is a lot of fields/details."*

## Three entries already existed, at three different stages

| Result | Entry | State |
|---|---|---|
| **RMR** | BF-33 | **engine shipped** — `measured_rmr` (migrations 225/226), `POST /api/measured-rmr`, bounds, `ffm_kg_at_test`. No UI. |
| **DEXA** | BF-2 | filed, planning item |
| **Blood panel** | BF-1 | filed, crop-before-upload already decided by the owner |

Nothing said they are the same shape. **BF-41** is that statement, and it does not replace them — it
stops the second one built from re-deriving the first one's pipeline.

## The split that matters

**Typed storage per result; one shared pipeline in front of it.**

Storage stays typed because **BF-2's calibration and BF-33's precedence rule both do arithmetic on
named columns** — a JSONB blob makes exactly that hard. `measured_rmr` is already the right template.
A blood panel gets a parent plus a **child analyte table**, because a panel is N rows and not N
columns.

The pipeline — pick a document → crop → extract with `generateObject` → **confirm the parsed fields**
→ save — is built once and parameterised by result type. `app/api/nutrition/scan/route.ts` is the
working reference, as BF-1 already says.

## Two things the entry insists on

**Do not design the field lists before seeing a real report.** This repo's own rule about external
field names — read the pinned source, never memory — applies to a DEXA printout and a pathology panel
as much as to an API. A schema invented from a description silently drops the field that turns out to
matter. The owner is sending real scrubbed reports; the schemas get written from those.

**Two different redactions, and conflating them is the security bug.** The owner scrubbing a file
before pasting it into a chat is not the same as the app's crop-before-upload step — that one is
still required, because the extraction call sends the document to Google and BF-1 already records
that *"redacting after extraction is too late"*. BF-1 decided this for blood panels; BF-41 makes it
the rule for every document type, DEXA included, since those reports carry name, date of birth and a
patient reference too.

## One recommendation with a reversal cost

**Do not store the source document.** Extract, confirm, save the fields, discard the file. The only
`bytea` column in the whole schema today is `oura_raw_packed.blob`, so a document store would be new
— and with the app's Play Store ambition (health data plus a declared-use-case review) a stored
pathology PDF is a liability rather than an asset. If one must be kept, that is its own decision with
its own entry, not a side effect of this one.

## Sequencing

BF-33's UI first — the table exists, so it is the smallest end-to-end slice and it proves the confirm
step on real numbers. Then DEXA, which that UI widens into and which unblocks the scale calibration.
Then blood, the largest field set.

---

<!-- folded from docs/overview/entries/2026-08-27-colmi-accepted-count.md -->

# 2026-08-27 — show what the ingest kept, not just what it stored

Branch `fix/colmi-show-accepted` · diagnostic only

## What the packet tally settled, and what it did not

v1.390.2 added a per-sub-type tally to the sync panel. The 2026-08-27 18:50 sync read:

```
s0:1p/0s s1:1p/0s … s7:1p/3s s8:1p/7s s9:1p/13s … s18:1p/9s s19:1p/0s … s255:2p/0s
```

**Every sub-type carries exactly one packet.** The packets are numbered, the placement arithmetic
that spaces them by `9 + (subType - 2) × 13` is right, and the theory that the byte repeats — the
one this tally was built to test — is **wrong**.

The decoder was then run against a reconstruction of that exact packet set. It produces **132
samples at 132 distinct timestamps, 06:10 to 18:45**. Nothing collides and nothing is dropped in
mapping.

The database holds **17** heart-rate rows, all from 16:50 onward.

## Why a third number was needed

`/api/colmi/samples` already computes `accepted` — what survives its per-sample window and range
filters — and returns it beside `stored`. The card showed `read` and `stored` only, and those two
cannot distinguish:

- **the filters rejected them** (`accepted` far below `read`) — the ring stores a value in slots it
  could not measure, and anything under `MIN_PLAUSIBLE_BPM` of 20 is discarded on the way in; or
- **the unique key deduped them** (`accepted` high, `stored` low) — the samples landed on
  timestamps that already existed.

The first is the system working. The second is a bug. One number separates them and it was already
being sent.

## The pattern this is the fourth instance of

Four diagnoses of this bug have now been made by reasoning about counts rather than reading a value,
and **three were wrong**: the request shape was blamed first, then a stale CI base, then packet
numbering. Each was plausible, each fitted the evidence available, and each cost a release cycle.

The reproduction that settled the decoder took four minutes and should have come first. Recorded
here because the lesson is not about this protocol.

---

<!-- folded from docs/overview/entries/2026-08-27-colmi-heart-rate-continuations.md -->

# 2026-08-27 — the Colmi heart-rate log was arriving all along

Branch `fix/colmi-heart-rate-continuations` · closes **PS-13**

## What the diagnostics panel found, and what it corrected

Yesterday's fix gave the `0x15` heart-rate request the day it was asking for, on the theory that a
malformed command was being answered with silence. The next sync still produced **zero** heart-rate
rows, which read as the fix having failed.

The frame tally says otherwise: **`0x15×26`**. The request worked. Twenty-six packets of heart rate
came back and none of them reached the database.

`framesToPayload` kept only sub-type 1 — the one packet carrying a unix anchor — and dropped
sub-types 2+ for lack of a clock to place them against. That was the deliberate choice PS-13
recorded, and on its own it would have cost 24 of 26 packets. What made it total is the second half:
**the 9 samples sub-type 1 does carry are the first 45 minutes after local midnight.** The ring
records nothing there, so they came back as zeros, the `bpm > 0` guard filtered every one, and a
sync pulling a full day of heart rate reported nothing at all.

Two independent reasons for the same symptom, which is why reading the request shape alone never
found it.

## The mapping

Sub-type 0 is a header naming `packetTotal` and `intervalMinutes`. Sub-type 1 carries the start time
and 9 samples. Every packet after it carries 13 that continue the same series, so sample index is
`9 + (subType - 2) × 13`, spaced by the header's interval — **not** the hardcoded 300 seconds the
old code used, which was right only because auto-HR happens to be set to 5 minutes.

A continuation arriving with no anchor is still dropped rather than placed by guess.

## Two smaller things in the same diff

**Forget now asks first.** It sat beside Sync now, the button pressed on every visit, and undoing a
mis-tap means having the ring in hand and Bluetooth in range. The owner hit it by accident, which is
the report that earned this.

**The sync panel stopped calling understood frames unreadable.** Two of the six "not understood"
frames were `43 ff` — the ring's "no more activity history" sentinel, which decodes to `unknown`
because it carries no sample. Counting an answer as a failure is the opposite of what the panel is
for.

## Verified, and not

Verified: 4 new unit tests over the packet mapping (anchor placement, header-declared interval,
anchorless continuation, all-zero anchor), 64 Colmi tests green, `pnpm check:rules` 61 of 61.

**Not verified: any of it against the ring.** The mapping is derived from a real 26-packet capture
described by its frame tally, not from decoded bytes — the panel displays unmapped hex but does not
store it, so the packets themselves were never available here. The next sync is the test, and the
number to look at is whether heart-rate rows span the waking day rather than clustering.

---

<!-- folded from docs/overview/entries/2026-08-27-colmi-hr-anchor-ten-hours.md -->

# 2026-08-27 — the heart-rate log was ten hours late, and the archive found it in minutes

Branch `fix/colmi-hr-anchor-timezone` · migration 237 (corrective delete)

## What it was

`cmdSyncHeartRate` sends the day's local midnight **expressed as though it were UTC** — the ring
wants wall-clock seconds, not an epoch, and the command's own comment says so. The ring **echoes
that number back** in packet 1, and `framesToPayload` read the echo as a genuine epoch.

So every heart-rate sample was stored late by the size of the timezone offset. Ten hours in
Brisbane: a log the ring recorded **06:50–20:50** was filed as **16:50 through 06:50 the next
morning**.

Two consequences, and the second is the one that misled a whole afternoon:

- **119 of 157 samples per sync landed in the future** and were rejected by the ingest's 60-second
  future tolerance. What survived was not a sample of the day but a biased fifth of it.
- **The survivors were morning readings wearing evening timestamps.** Compared against the Oura at
  the same wall-clock minute they read **+15.6 bpm with r = 0.37**, and that was written up as a
  sensor difference — the ring being noisy and reading high. It was this bug. Morning activity was
  being compared against evening rest.

## How it was found

`colmi_raw_frames` shipped in v1.392.0 at 20:45. The owner synced at 20:52. The frames were queried
at 20:55 and the anchor read `1787788800` — `2026-08-27T00:00:00Z`, which is 10:00 Brisbane, exactly
ten hours off local midnight.

Four earlier diagnoses were made by reasoning about row counts and three were wrong: the request
shape, a stale CI base, then packet numbering. This one took three minutes and needed no theory at
all, because the bytes were there to read.

## The fix

`wallClockSecondsToEpochMs(wallSeconds, tz)` reads the echoed number as the wall clock it is and
places it in the user's zone. Every sample derives from that instant.

`hr-anchor-real-capture.test.ts` replays the **actual 20:52 packet set** and asserts the log spans
06:50–20:50 — ending two minutes before the sync that fetched it, which is the property the ten-hour
shift broke.

## The destructive half

Migration 237 deletes `colmi_readings WHERE kind = 'heart_rate'`. Those rows are wrong in a way that
is worse than missing: biased in coverage and mislabelled in time, and they already produced one
false finding. They are re-derivable — the ring holds the day, re-syncs are free, and from today the
frames are archived. Only `heart_rate` is touched; every other kind is placed by a different path.

## Verified, and not

Verified: 68 Colmi tests including the real-capture replay, `pnpm check:rules` 61 of 61, migration
applies locally.

**Not verified: a sync after the fix.** The correction is proven against captured bytes, not against
the ring. The check is one sync showing heart rate across the waking day rather than a 50-minute
band, and `kept` close to `read` rather than half of it.

---

<!-- folded from docs/overview/entries/2026-08-27-colmi-hr-subtype-tally.md -->

# 2026-08-27 — say how the ring numbers its heart-rate packets

Branch `diag/colmi-hr-subtypes` · diagnostic only, no data path changed

## Why

v1.390.1 made heart rate arrive. It arrives at exactly the right 5-minute boundaries with plausible
values, so the request and the placement are both right — and the sync card reads **"Read 204
samples, stored 8 new"** against 82 the sync before. Roughly 122 heart-rate samples were produced
and **7** reached the database.

Readings are keyed `(kind, measured_at)`, so a sample landing on a timestamp that already exists is
discarded. 122 collapsing to 7 means the packets are being placed on top of each other, and there is
one assumption that would do it: `framesToPayload` reads the sub-type byte as a packet **number**
and spaces the series by `9 + (subType - 2) × 13`. If this firmware repeats that byte rather than
counting up, every packet lands in the same 13 slots. Seven readings inside a single 50-minute band,
from a ring holding a full day, is what that looks like from the database.

## What this adds

`diagnostics.hrSubTypes` — packets and non-zero samples per sub-type byte — rendered in Sync detail
as `s0:1p/0s  s1:1p/2s  s2:9p/117s` or similar. Numbered packets give one packet per sub-type; a
repeated byte gives one sub-type carrying nine.

Nothing in the write path changed.

## The reason this is a screen and not a query

The panel still does not persist. Three diagnoses of this bug have now been made by reasoning about
row counts rather than bytes, and **two of the three were wrong** — first that the request shape was
malformed, then that a stale base explained a CI failure on the same day. The tally is the smallest
thing that replaces inference with a reading, and it costs one screenshot.

Storing frames server-side is the real answer and is not this change.

---

<!-- folded from docs/overview/entries/2026-08-27-colmi-raw-frame-archive.md -->

# 2026-08-27 — keep the ring's bytes, because the readings have been wrong

Branch `feat/colmi-raw-frames` · migrations 235, 236

## The number that forced this

v1.390.3 surfaced what the ingest route keeps, and the 19:27 sync read:

```
Read 240 samples, kept 121, stored 17 new
```

240 produced, **121 survived the filters**. Of the 140 heart-rate samples in that payload, **21
passed and 119 were rejected** as outside 20–250 bpm — 85% of a day's heart rate, discarded at the
door, with nothing recording what the values were.

That makes the open question unanswerable rather than merely unanswered. Whether those are sensor
noise, a wrong byte offset, or an encoding that isn't beats-per-minute cannot be decided without the
bytes, and every day spent deciding is a day of history that no later fix can recover.

## What it adds

`colmi_raw_frames` — user, receive time, channel, tag, hex — written **unfiltered and
unconditionally** beside the decoded readings, in the same request so a frame and the samples read
out of it cannot diverge. Deduped on `(user_id, channel, hex)`, since a re-sync re-sends history
verbatim.

This is the Oura pipeline's own rule, applied where it was missing. `oura_raw_samples.body_hex` is
the archival source of truth precisely because a decoder added later can only back-fill by
re-decoding stored bytes. The Colmi pipeline shipped without an equivalent.

Size is not a concern: ~66 frames per sync at ~40 bytes of hex is under 3 KB, so ten syncs a day is
~30 KB. `oura_raw_samples` reached 563 MB holding 20 Hz sample streams; this holds sync-time frames.

## Why it is worth its own release rather than riding a fix

Four diagnoses of the heart-rate loss were made in one day and three were wrong — the request shape,
a stale CI base, then packet numbering. Each was inference from counts, because counts were all
there was. The reproduction that finally exonerated the decoder took four minutes and needed only
the packet structure; the remaining question needs the values themselves.

The archive is what stops a fifth round. It is also what lets a week of recording start now instead
of after the answer, which was the actual constraint the owner was working against.

## Verified, and not

Verified: migrations apply locally, 830 DB-backed tests pass, 5,165 unit tests pass,
`pnpm check:rules` 61 of 61, `claude_ro` regenerated to 90 views with the new table scoped by
`user_id`.

**Not verified: a real sync.** No frame has been written by the ring — the write path is exercised
by tests and by nothing else. The first sync after deploy is the check, and the signal is
`stored.frames` coming back non-zero.

---

<!-- folded from docs/overview/entries/2026-08-27-fix-colmi-sync-diagnostics.md -->

# 2026-08-27 — Colmi R09: the heart-rate request was missing its day

Branch `fix/colmi-sync-diagnostics` · PR #566 · follows
[2026-08-26-alternative-ring-testing](entries/2026-08-26-alternative-ring-testing.md)

## What this fixes

Every enabled metric on the R09 landed except heart rate, which stayed at zero rows across three
syncs. The request was a bare `0x15` — Gadgetbridge sends `[0x15, <int32 LE local midnight>]`, and
this ring answers a command it cannot parse with **silence rather than an error**. A silent ring and
a ring with no history are the same observation from our side, which is why this read as "no data"
for a day rather than as a malformed request.

`cmdSyncHeartRate(dayStartSeconds)` now carries the day, and `localDayStartSeconds()` derives it
from the user-local date string rather than from `Date.now()`.

Two changes ride with it, both of which exist so the next silence is diagnosable:

- **The sync card reports what the ring actually sent.** `diagnostics: { frameTags, unmapped,
  unmappedHex }` is surfaced under a "Sync detail" disclosure. Frame tags distinguish "the ring
  said nothing" from "the ring answered and we did not decode it" — the distinction that cost the
  day above.
- **The drain window went from 12 s to 30 s.** The ring returns history in bursts with gaps between
  them, so a short window truncates a real response into something indistinguishable from an empty
  one.

## What is verified, and what is not

Verified: `pnpm dev` against the local DB, the protocol and time-resolution unit tests, and the full
CI gate (60 of 60 Custom Rules steps).

**Not verified: any of it against the ring.** The fix is inferred from Gadgetbridge's request shape,
not observed working — no heart-rate row exists yet. The first sync after this deploys is the test.
Also unexercised: the day boundary. Every sample so far falls inside one local day, so
`resolveRelative`'s day-shift arithmetic has only ever run against unit fixtures. The first overnight
capture runs it for real.

## Ring state at the time of writing

Eight kinds present — steps, distance, calories, SpO₂, stress, temperature, HRV, battery — all
stamped 07:00 Brisbane or later, against auto-measurement switches enabled at 06:48. The ring
recorded nothing before them, which is the confirmation that the switches were off from the factory
and that the blank first night is the ring behaving correctly rather than a decode failure.

Sleep is still zero, for the same reason.

`calories` reads 1431 beside 485 steps and 328 m. 485 steps is roughly 20–25 kcal, so it is neither
a per-bucket figure nor the ×10 scaling some firmware applies; a running daily total is the fit. It
is stored raw and summed nowhere until a full day settles it — summing a cumulative counter would
produce an inflated number that still looks plausible.

## Note on the CI failure this branch hit — and the wrong call made about it

`e2e/food-row-shared.spec.ts:115` went red here twice. The first read was that the base was stale:
#567 changed the meal-builder entry path, #568 touches the components the spec walks through, and
this branch had the first without the second. Merging `main` cleared it, which looked like
confirmation.

**It was not.** The spec failed again on a head that already contained #568, with the nutrition code
byte-identical between the passing and failing runs. Three runs on a branch that touches no nutrition
file at all went fail → pass → fail. That is a flaky spec, and merging `main` fixed nothing — it
coincided with a pass.

Recorded because the wrong conclusion was the plausible one, and because a single green run after a
base update is exactly the evidence that makes a flake look solved. The finding is filed as **PS-14**
with the mechanism it is most likely to be — `IngredientPicker` is keyed on `buildSession`, so a
remount landing after the test's `fill()` would discard the typed query silently — and a proposed
patch. It has not been reproduced locally, and the entry says so.

---

<!-- folded from docs/overview/entries/2026-08-27-one-calorie-budget-stranded-copy.md -->

# 2026-08-27 — `fix/one-calorie-budget-stranded-copy` — a copy change left one guard unable to fail

**Lane B · v1.393.1 · test-only.** No product file changes.

`e2e/one-calorie-budget.spec.ts` has been red on `main` since **#586** (BF-24 ②, `cc0555e7`) landed
the nutrition energy card. That PR rewrote the copy the spec asserts on and updated its sibling
`calorie-progress-bar.spec.ts` but not this one. Found on a full local run while verifying Q-112a —
93 passed, 3 failed, two of them these.

## Three stranded assertions, and the third is the one that mattered

| Asserted | Now rendered |
|---|---|
| `+718 from movement` | `+718 burned` in the header; "movement" moved to the zone-bar detail |
| `/295g` | `0/295 g` — `energy-card.tsx:225` renders the unit in its own span, with a space |
| `3196 left` | `3,196 kcal left` — the card formats with `toLocaleString()` |

Two of those fail loudly. **The third does not exist in that list** — it is the *negative* assertion
that closes the same test:

```ts
await expect(page.getByText(`/${BASE.carbsG}g`)).toHaveCount(0)
```

That line is the whole point of the test. It proves the ring draws Q-323's **earned-scaled** macro
targets rather than the stored ones — the defect being that a 551-kcal-earned day reported fat *over*
when it was well under. After the copy change nothing on the page matches `/NNNg` at all, so the
count is 0 whether or not the base target is on screen. **A guard that cannot fail is not a guard**,
and repairing only the two loud assertions would have turned the test green with that one
permanently vacuous — which is worse than red, because red gets looked at.

## What changed

- The header and detail are asserted **separately**, because each carries half of the original
  intent: the header proves the earned figure is on screen, and *"movement"* — not "cardio" — is the
  wording the test was written to pin, since the figure includes strength sessions and steps and this
  fixture's whole contribution is a strength session.
- The macro assertions go through one `/${grams}\s*g` helper, so the positives and the negative can
  never again drift apart on whitespace.
- `kcal left` is matched with an optional thousands separator built from the digits, **not**
  `left.toLocaleString()` — that resolves in the *runner's* locale and the browser's need not agree,
  which trades a red-here failure for a red-elsewhere one.

## Driven, not inspected

Reverting `targets={effectiveTargets}` to `targets={targets}` in `nutrition-content.tsx:587` fails
exactly one test — `the ring's macro bars use the scaled targets, not the stored ones` — and leaves
the other four green. That is the mutation the negative assertion exists to catch, and it is what
proves the repair restored it rather than just silencing it.

`e2e/one-calorie-budget.spec.ts` and `e2e/calorie-progress-bar.spec.ts` pass together, 7 of 7.

## The general shape, for the next copy change

A spec that asserts on a string has no link to the component that renders it, so a rename strands it
with no compiler or lint signal. `CLAUDE.md`'s sibling-surface rule already says to grep every
surface handling the same domain when changing a pattern — **specs are one of those surfaces**, and
`calorie-progress-bar.spec.ts` being updated in the same PR shows the sweep happened and stopped one
file short. The tell that it is worth grepping harder: this file's own name says it is about the same
card.

## Not exercised

- No product code changed, so there is nothing new to verify on device.
- The full E2E suite was not re-run for this change; the two specs covering the energy card were, plus
  the mutation above. `goal-invalidation.spec.ts` remains red locally for the unrelated aged-seed
  reason (it needs today's steps row; `max(date) WHERE steps IS NOT NULL` is 2026-08-25 here).

---

<!-- folded from docs/overview/entries/2026-08-27-recipe-image-priority.md -->

# 2026-08-27 — the serving-size payoff already exists; only the entry point is missing

**Branch:** `feat/recipe-image-upload` · docs-only · BugFix Intake

## The request

*"can you make it so I can uploaded an image of ingredients and it can make a meal out of it. that
way when I increase serving size I can see calories drop till its a good serving size from a batch"*

## The second half is already built

That is `components/nutrition/meal-batch-size.tsx` and the builder footer, both shipped:

- **"This recipe makes N portions"** — `−`/`+` and a number input, quarter-portion steps, capped at 50.
- **Live per-portion arithmetic under it:** *"Logging this meal takes one portion — 278 kcal of the
  555 below."*
- **The footer keeps the batch total, the macro split and `N / portion` on screen *while ingredients
  are edited*.**

So raising the servings count already makes per-portion calories fall, in two places at once.
**BF-40 is only the missing entry point** — once an image can reach the builder, the behaviour the
owner described is what happens next with no further work. The entry now says so, so nobody rebuilds
it.

Also recorded: *"an image of ingredients"* covers a screenshot of a written list **and** a photo of
physical ingredients laid out. Both post an image to the same route; the fix is the same prompt
change either way.

## BF-40 raised to Lane B's #1

The owner asked for the capability, not for intake to write it — and two things make handing it to
Lane B the right call rather than a process reflex:

- **Lane B is in these exact files right now.** #570 is open on `food-list.tsx` and #568 shipped
  changes to it hours ago. Editing the builder from here would collide with an active branch, which
  is the specific failure the lane split exists to prevent.
- **BugFix never writes code** (`docs/agents/README.md` §1). The role ends at a traced entry.

BF-40 is now the top of Lane B's READY list, ahead of BF-28.

## DEXA and RMR are done

The owner completed both and will send the results. Two things stand from the earlier intake:

- **BF-33 shipped the storage** — `measured_rmr` with `POST /api/measured-rmr` and the
  `ffm_kg_at_test` column that lets the reading be re-scaled to a future body. **There is no UI**, so
  the numbers cannot be entered from the app yet.
- **BF-2 has not shipped**, so the DEXA half still has nowhere to go. The same-day Renpho reading was
  the irreversible part and it is done; everything else can be entered whenever, because both records
  are dated by measurement rather than entry.

---

<!-- folded from docs/overview/entries/2026-08-29-hr-fixture-prune-horizon.md -->

# 2026-08-29 — A fixture I wrote crossed a retention horizon and took `main` red

**Lane A · branch `fix/hr-collapse-test-prune-horizon`**

`batch-upsert-duplicate-collapse.test.ts` — written for Q-280 in this session's earlier run — failed
on `main` with `expected [] to deeply equal [ 61, 99 ]`. Nothing had been written; the rows were
gone.

## The cause

`upsertOuraHeartrate` ends with a throttled retention prune:

```ts
db.execute(sql`DELETE FROM oura_heartrate WHERE timestamp < now() - interval '180 days'`)
  .catch(...)   // unawaited, fire-and-forget
```

The test's fixture was `new Date('2026-03-02T00:00:00Z')`. Measured when it broke: **181.05 days
old**. The prune fires on the first call of the day, is not awaited, and therefore races the SELECT —
so the rows were inserted and deleted before the read.

**This is the rule in `CLAUDE.md`, verbatim, and I broke it in my own PR:** *a test may hardcode a
timestamp only when BOTH sides of the comparison are fixed; the moment one side is the real clock, an
absolute date is a time bomb with a known detonation date.* `scale-ble-day-keying.test.ts` is the
previous instance — same shape against an ingest tolerance rather than a retention window. That one
"fires once and then stays red forever", and so did this.

## Why it was easy to write

The 180 was a **SQL literal inside the prune**, and the same number appeared 280 lines further down
as `ZONE_HR_RETENTION_DAYS = 180` — a constant that exists *because* of the prune and whose comment
points at it. Two copies of a number, neither reachable from a test. A retention window is a boundary
fixtures get placed against, and this one was invisible from where fixtures are written.

## The fix

- **`HR_RETENTION_DAYS` is exported and written once.** The prune builds its interval from it and
  `ZONE_HR_RETENTION_DAYS` reads it, so the two can no longer drift and the horizon is importable.
- **The heart-rate fixtures derive from the clock** — `daysAgo(2)` and `daysAgo(3)`, anchored at
  midday rather than midnight, because a boundary is where an off-by-one stops being visible (Q-356).
  Two days back leaves 178 days of margin, so node/Postgres clock skew cannot reach it either.
- **A guard that fires on every run**, not on a date: the fixtures are asserted to sit inside
  `HR_RETENTION_DAYS / 2`. The previous instance of this class sat red for a day before anyone looked,
  and the rule for a regression test here is that it must not wait for the window.

**The other fixtures in the file stay written down.** `oura_bucket`, `sleep_sessions` and
`body_metrics` are compared against nothing but themselves, which is exactly when a fixed date is
allowed. Changing them would be noise.

## Verified

Two mutations, each with an asserted anchor: reverting to the hardcoded fixture reproduces the
original failure, and shrinking `HR_RETENTION_DAYS` below the fixtures trips the new guard. Full
suite green.

## The process lesson, which is the more useful half

The energy-card PR (#586) also went in this session and stranded three assertions in
`one-calorie-budget.spec.ts`; another agent repaired them in #590 before I noticed. **I had run four
E2E specs locally and picked the wrong four.** Two failures in one session from the same root: a
change was checked against the tests I expected to be affected rather than against the suite. On a
UI or storage change the affected set is not guessable — run the whole thing.
