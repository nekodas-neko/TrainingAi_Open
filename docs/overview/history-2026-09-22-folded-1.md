# Session journal — batch folded 2026-09-22

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-18-review-agent-sweep-50"></a>

# Review sweep 50 — the twelve-day catch-up

**Branch:** `claude/review-agent-sweep-40-wu6ss3` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-18-sweep-50-twelve-days.md`](../reviews/2026-09-18-sweep-50-twelve-days.md).

The owner asked for a full review of everything added since the last one, checked from every angle —
performance, safety, logic, efficiency. Base was sweep 49's `3e47f03f` (2026-09-06): **12 days, 50
commits, 671 changed code files**. Run as three read-only lanes (new API-route safety, new
shared-module math, cache and staleness) plus a performance lane, all reporting into this session,
with **every finding re-verified at source by the coordinator before filing** — nothing below is
taken on a lane's word.

## Filed: RV-51 … RV-63

One live, user-affecting defect and twelve that are latent, structural or cosmetic.

**RV-51 is the one that is happening now.** `equipmentEligible` (BF-129) excludes an exercise that
declares no equipment and justifies it with *"Migration 269 labelled the 22 rows that had drifted …
so an empty list should not occur"*. Production holds **2 of 156** rows with `equipment = []` —
`Dumbbell Lunges` and `Cable Lat Pulldown` — and because the implementation is `.some()`, an empty
array is false against **every** selection including `full_gym`. Both are invisible to
`generate-program`, `builder-chat` and the builder review filter, for every user, at every setting.
Filed with the question the data raises attached: `exercise_library` has no `created_at`, so whether
migration 269 *missed* these or something *wrote* them afterwards is unestablished — and if it is the
latter, labelling two rows fixes nothing.

The rest fall into one shape, which is the finding worth carrying: **a rule was written down
correctly and then only half-applied.** `STREAK_LOOKBACK_DAYS` calls itself a contract between two
files and is imported by one of them (RV-57). `equipmentEligible` lowercases the exercise side and
`buildEquipmentSet` lowercases neither (RV-58). `summariseSupplementDay`'s header names a mixed-unit
day as a reason it was hoisted, and then sums across units and labels the total by row order
(RV-59). `recommendWalkPattern` ships two user-facing strings to distinguish two cases, one of which
cannot fire (RV-60). Three cache keys sit in **zero** invalidation groups beside siblings in three
and four (RV-52/53/54) — the sharpest being `collection`, which `/api/collection:59` computes from
exactly the deload confirmation `invalidatePrescriptionChanged()` exists to fan out. That is a better
class of bug than sweep 49's, and also the class a reader cannot catch, because the comment says the
right thing.

Two routes turn a client error into a server fault and an `error_events` row — a client-supplied vial
`id` colliding into an unhandled `23505` (RV-55) and three date params validating separator but not
calendar (RV-56, the Q-496 class). `/api/collection` is the only new route both unbounded and
rate-limit-free, re-running five all-history reads on every home paint (RV-63). A banned ms-offset
window landed on the mood check-in write path (RV-62). And `PATCH /api/user/equipped-title` never
checks a title is unlocked (RV-61) — **pre-existing, and this diff hardened the same line**; filed
because the sweep found it, not because it regressed.

## BF-110's reading is in, and the entry was still parked

The entry set its own decisive criterion — *"`stuck` → the viewport is genuinely held and the fix is
native"*. `error_events` has **3 rows** of `recheck stuck h1=667 h2=667`, 12 healthy at 826→826, and
**0 `resized`, 0 `dom-lost`**, dated 2026-09-15→09-16. **Native-layer verdict, four days old.** Two
telemetry corrections went onto the entry in the same pass: the word `stuck` fires on healthy resumes
too (12 of 15), and `w=384` appears on every row including the healthy ones — so the "384×667"
signature is half right and **only the height discriminates.**

## Two stale numbers corrected in `CLAUDE.md`

Both in the session-start block every agent reads first, so both were actively misleading.
`error_events`' 52 MB was described as "30 days of retained payload rather than unbounded growth";
measured today it is **12 MB heap + 39 MB TOAST + 752 kB index behind 115 live rows** — bloat, not
payload, and the figure was written when the table held 7,331. Growth was stated as ~0.4 MB/day;
it is **1.71 MB/day against 224 MB total**. The amendments keep both rules and fix the numbers,
and say what to watch instead: the *shape* (a window that stops reclaiming), not the daily figure.

## What was clean, and it is most of it

Admin authorisation on both new admin routes, proved by revocation rather than by reading — flipping
`is_admin` to false in Postgres answered 403 on the same cookie. Ownership rules (a)/(b)/(c) on the
vials routes, cross-user PATCH/DELETE both 404 with the victim row read back unchanged. `private,
no-store` on every new route. Zero N+1 queries in the added data layer, confirmed on the wire. Every
new query pattern from migrations 267–277 has a supporting index. No new dependency in 671 files.
Eight of the twelve new shared modules survived adversarial probing of the shipped module unchanged.
`check-memo-prop-stability`, `check-component-size`, `check-fetch-once-effects` and
`check-cache-ttl-divergence` all exit 0 with nothing new. `pnpm check:rules` reports **Ran 75 of 75**
(68 at sweep 49).

## Not exercised

Nothing device-verified — every probe ran in node or against a local dev server, so the offline-first
half of the new vials domain was not touched at all. `claude_ro` reads are **the owner's rows only**
except the catalogue, whose view scoping was not verified, so "2 unlabelled rows" is a floor. No
`EXPLAIN ANALYZE` evidence (the local planner seq-scans everything at 9–145 rows) and no bundle
sizes. `rederive-baselines`' write path never ran — the table is empty locally. The ~33 *changed*
formula files were greppped for duplicates, not audited.

<a id="2026-09-19-bf-177-kcal-left-stale"></a>

# 2026-09-19 — the cache bust he asked for is already there; the refetch is not

**BugFix intake.** Docs-only. Owner: *"The kcal left in the top right; doesnt load on the same page:
it requires page switching to show. Probs needs some sort of cache bust after logging food so it
updates"*. Filed as **BF-177**.

## The hypothesis was half right, and the half that is wrong is the useful part

`logFoodEntries` already calls `invalidateNutritionWrite()`, and that group already clears
`energy-balance:`. The key is evicted on every food log. Adding another invalidation would change
nothing — this is the Q-402 shape CLAUDE.md already names: *"Invalidating a key and re-rendering the
component that reads it are two different things."*

## What actually happens

`onLogged(log)` lands in `handleFoodLogged`, whose optimistic branch appends to `logs` and returns.
Only the `else` branch calls `fetchData`, which is what refetches `energy-balance`. So `logs`
updates — the ring and macro grams move — while `energyBalance` still holds the object fetched
before the meal.

And the card prefers that payload over the two live numbers it already has:

```ts
const remaining = b ? b.remainingKcal : goal != null ? Math.round(goal - calories) : null
```

`remainingKcal` is `budgetKcal − intakeKcal` computed server-side — the same subtraction, against
the server's snapshot of intake. Switching tabs re-runs `fetchData`, the key is now a miss, and the
fresh payload carries the new number. That is the "page switching" he describes.

## The one-line fix is a trap, and the entry says so

Deriving `remaining` from `goal − calories` looks obvious. But `remainingKcal` is `-deviationKcal`,
and **`zoneLabel`, `zoneColor` and the bar all come off that same `deviationKcal`**. Make the number
live without the rest and the card reads "871 kcal left" beside a "Well under so far" band that has
not moved — one visible disagreement traded for a subtler one, against a file whose own comment says
every "left"/"over" reading comes off one number (LB-100).

The fix is to refetch the balance in the optimistic branch — **the balance alone, not `fetchData`**,
which would also reload the food list that was just appended to optimistically.

## Accepted consequence

The ring updates instantly and "kcal left" lands a round trip later. That is correct, because the
budget half genuinely comes from the server, and it is a far smaller gap than one that persists
until the tab changes.

## What was not exercised

Nothing on the S25. The path was traced in source — write → invalidation → callback → render — and
not reproduced at runtime. The device look is owed because the optimistic-append timing is what
decides whether the round trip reads as instant.

<a id="2026-09-19-fix-bf100-touch-cancels-pending-restore"></a>

# 2026-09-19 — BF-100's `touchstart` cause reproduced in the harness, and fixed

**Branch:** `fix/bf100-touch-cancels-pending-restore` · **Lane B** · code + docs · no migration ·
**v1.459.2**

BF-100 was Lane B's only READY entry. It had failed on the S25 **twice**, its candidate cause had
been probed once and come back inconclusive, and `projectOverview.md` carried an explicit decision:
*"the fix is deliberately not built — it must not ship on a hypothesis when one tap decides it."*
That decision is reversed here, and the reason is that it stopped being a hypothesis.

## The window is real, and it had never been measured

The candidate: `use-scroll-restoration.ts` took its user-takeover from **`touchstart`**, and `stop`
latches `done = true` and clears the timer with **no re-arm** — so one touch abandons a *pending*
restore permanently. True in source, but nobody had shown the pending window was non-empty.

Instrumenting `addEventListener` and `sessionStorage` on a live `/more` back-navigation:

```
15240ms SAVE  ta_scroll:/more=840
15681ms LISTEN touchstart  <div class="flex-1 overflow-y-auto pb-nav-safe scrollbar-hide">
15863ms CLEAR ta_scroll:/more (restore landed)
```

**182 ms with the listeners live and `done` still false.** That also identified the container
properly, which the previous probe had only guessed at.

## Why the 2026-09-15 probe came back null — settled, and it was neither stated reason

The old entry blamed the element or the dispatch timing. Both are wrong. **`page.goBack()` does not
resolve until after the mount and the restore**, so any touch dispatched after it is on the wrong
side of the window by construction. Arming the dispatcher *before* `goBack()` does not help either —
the container only matches a selector once it has mounted, which is the same instant the restore
lands. Measured: first dispatch at 15627 ms against a restore at 15613 ms.

**The 182 ms window cannot be hit from the test side at all.** Reading that null result as evidence
against the hypothesis would have been wrong, and very nearly was.

## What made it testable: widen the window instead of chasing it

Seed an offset the container can never reach. `attempt()` then never lands, so the restore stays
pending for the whole of `RESTORE_WINDOW_MS` and the touch places trivially. Against the unfixed
hook the cancellation reproduces outright:

```
restored to 0 against a reachable 1019: 0 means a bare touchstart latched done=true
and cleared the timer, which is the BF-100 cancellation
```

## The fix

`touchstart` → **`touchmove`**, through a single `TAKEOVER_EVENTS` constant so the add and remove
lists cannot drift. Trap (4) is intact — takeover is still an **input event**, not a scroll delta —
but a finger that never moved has scrolled nothing. `e2e/bf100-touch-does-not-cancel-pending-restore.spec.ts`
pins both directions, and **both arms were proven red pre-fix**, in opposite directions: `touchstart`
cancelled when it should not have, `touchmove` was not listened for so it failed to cancel when it
should have. All three existing `scroll-restoration.spec.ts` cases stay green.

## What is NOT established

**Causation on the device.** The harness fires no touch on a back navigation, so it cannot say
whether the S25's gesture delivers one into that window — only the device can. If the gesture still
lands at the top, **the one-tap experiment survives as the fallback**: come back with a UI back
control instead; if that restores while the gesture does not, the cause is elsewhere in the gesture
path and BF-100 is buildable work again. Its `Keep:` says so outright, because this entry has twice
been mis-filed as *"shipped, a look is owed"* while the look had already failed.

BF-100 moves to `Verify: device` — legitimate this time only because the device has **never seen
this change**. It joins BF-166, LB-107 and LA-109 in the `back-gesture-sitting` batch, so Lane B's
READY list is now empty and one sitting answers all four.

## Gate

`Ran 75 of 75` Custom Rules · **8965 vitest tests** (946 files, 0 failed) · the new e2e 2/2 and
`scroll-restoration` 3/3 · tsc clean · tests-typecheck at baseline (320/90) · lint 0 errors.

## Not exercised

**The device** — which is the entire open question here, not a footnote. Also untouched: the offline
path, native SQLite, and real safe-area insets; this change is one event name in a web-reachable
hook.

<a id="2026-09-19-fix-bf177-kcal-left-stale"></a>

# 2026-09-19 — BF-177: "kcal left" stood still while the ring moved

**Lane B.** Branch `fix/bf177-kcal-left-stale-after-log`, v1.459.1.

## The report, and why the obvious fix was already in place

Owner: *"The kcal left in the top right; doesnt load on the same page: it requires page switching to
show. Probs needs some sort of cache bust after logging food so it updates."*

**That cache bust already existed.** `logFoodEntries` calls `invalidateNutritionWrite()`, which
clears `energy-balance:`. The key was evicted correctly on every single food log. This is the Q-402
shape CLAUDE.md already names — *invalidating a key and re-rendering the component that reads it are
two different things* — so a second invalidation would have changed nothing.

What actually happened: `handleFoodLogged`'s optimistic branch appended to `logs` and returned.
`energyBalance` still held the object fetched before the meal, so the card rendered a live ring
against a pre-log payload. Switching tabs re-ran `fetchData`, which refetched the now-evicted key.

## Three sites, not two

BugFix named `handleFoodLogged` and flagged `handleQuickEditSaved` as "the obvious twin". The sweep
found a **third**: the delete path's `refreshAffected` refreshes the log list and the weekly summary
and *not* the balance, so deleting a food entry left the same number stale. All three refetch now.

## The trap, avoided

Deriving `remaining` client-side looks like the one-line fix. `remainingKcal` is `-deviationKcal`,
and `zoneLabel`, `zoneColor` and the bar all come off that same number. Making only the figure live
would print "871 kcal left" beside a band and a bar that had not moved — one visible disagreement
traded for a subtler one. The refetch moves all four together.

Equally, the refetch is **balance-only, not `fetchData`**: that would re-fetch the list just appended
to optimistically and can clobber or flicker the row being looked at.

**Accepted and stated rather than designed around:** the ring updates instantly and "kcal left" lands
a round trip later. The budget half genuinely comes from the server, and that gap is far smaller than
waiting for a tab change.

## Extracted, because the file was at its ceiling

Inlining the reasoning took `nutrition-content.tsx` to **811 lines against the hard 800 limit** and
failed `check-component-size`. The refetch and its rationale now live in
`app/nutrition/use-energy-balance-refetch.ts`; the screen is 789. That is the house rule working —
*extract into a child instead of appending* — enforced by the gate rather than remembered.

## The control

`e2e/bf177-kcal-left-updates-after-log.spec.ts` logs a known 250 kcal item and reads the card
**without navigating** — anything that leaves the screen re-runs `fetchData` and passes against the
unfixed component, which is the vacuous shape this repo has paid for before.

With the refetch removed, the spec reports **`kcal left went 1810 → 1810`**. That is the owner's
report reproduced exactly, in one line of test output.

## Not exercised

**The device.** BugFix's reason stands and is better than a generic one: the optimistic-append timing
is what decides whether the round trip *feels* instant, and a browser can only show the arithmetic.

**Two further `energy-balance:` readers were seen and deliberately not swept** —
`app/health/day/day-detail-content.tsx:122` and
`components/nutrition/end-of-day/day-read-through-section.tsx:37`, both hand-rolled `cachedFetch`.
Neither is mounted during a Nutrition-tab log, so neither is this report. Recorded in the entry
rather than left as an implied clean sweep. Home *is* clean: `useEnergyBalanceToday` uses
`useCachedValue`, which subscribes to invalidation — Q-402's fix, doing its job.

<a id="2026-09-19-fix-tn50-checkin-not-inferred"></a>

# 2026-09-19 — TN-50: the check-in stops answering itself

**Lane B.** Branch `fix/tn50-checkin-not-inferred-from-readiness`, v1.459.0. Items 1 and 2 of TN-50,
plus item 3 discharged as a documented cutoff.

## What was wrong

`mood-checkin-sheet.tsx` opened with an energy level already selected, chosen by
`readinessToEnergy(readiness)`. Readiness set the default; the default usually went unchanged; the
check-in then scored **10% of that same readiness**. The loop closed inside a single day.

Tuning measured it over the 62 days carrying both a check-in and a readiness score: the saved level
was exactly what the auto-fill would have picked on **45 of them — 73%**, against roughly 20–25% by
chance. Lane A re-verified every figure independently before I built anything.

`pumped` had never once been logged, and not because it was never felt: `readinessToEnergy` had no
branch that returns it.

## The decision I had to make, and why the entry could not make it for me

The entry says to *"default to neutral"* and to have an unanswered check-in contribute **the
documented NEUTRAL 50**. Those two instructions cannot both be satisfied by picking a default:

- The middle *option* is `ok`, which scores **72** — `+22` above neutral. That is the current bias.
- The only level scoring exactly **50** is `low`, and a face labelled **Low** pre-selected every
  morning is not what "neutral" meant.
- `MoodLog.energyLevel` is **non-nullable** and lives in `packages/shared` — Lane A's path — so
  "unanswered" cannot be a stored value at all.

So **nothing is pre-selected**. Unanswered now means *no log*, which `checkinScoreFromEnergy(null)`
already scores as NEUTRAL 50 through a path that has always existed. That is the only reading which
delivers both halves of the owner's *"neutral by default… not infer"*: a fixed default would still
write a value he never chose, and would leave the column just as unreadable as before.

**The cost, stated plainly:** Save is disabled until a level is tapped, so the daily check-in gains
one tap. That tap is the entire thing the contributor exists to collect. Reversal is one line if the
owner would rather have the extra tap back.

**Expected effect on the number:** the readiness line will visibly *step down*, because 36 of those
62 days stored `ok` at 72 and an unanswered day is now 50. That is the correction working, not a
regression.

## Item 3, discharged rather than deferred

Lane A recommended a documented cutoff over a storage flag, and the reasoning holds: whether any
*past* row was auto-filled is a statistical inference, never a per-row fact, so a flag added now
would be empty exactly where the ambiguity lives. The cutoff is written into
[`docs/domains/readiness/README.md`](../domains/readiness/README.md) — the pillar index a future
session actually reads — with the three consequences spelled out, including that TN-47's 6.5% figure
for `checkin` is affected and wants re-measuring on post-cutoff days.

## Verification, and the control that mattered

- `lib/__tests__/tn50-checkin-not-seeded-from-readiness.test.ts` — 6 cases. Pins the absence of the
  seed, the save guard, and the arithmetic that rules out a fixed default.
- `e2e/tn50-checkin-starts-unanswered.spec.ts` — reads the rendered picker: nothing selected, Save
  disabled, `pumped` selectable. It deliberately **does not save**, because a saved log would make
  the next run an *edit*, where a pre-selected level is correct and the spec would pass for the
  wrong reason forever.
- **⚠ The first version of that spec was VACUOUS, and only the control showed it.** Mutating the
  `useState` initialiser back to a level left the spec green — the reset effect fires on open and
  overwrites the initialiser, so the load-bearing line is the reset arm, not the initialiser.
  Mutating the reset arm turns it red on the right assertion. Both lines are pinned by the source
  guard, and the test file now says which one a future verifier must mutate.
- **Q-226's guard broke loudly and was re-anchored, not deleted.** It located its slice by
  `SRC.indexOf('setEnergy(readinessToEnergy(readiness))')` — a string this change removes. Its own
  `found the reset arm` meta-assertion is what caught it; without that the slice would have been
  empty and all seven Q-226 cases would have passed on absence.
- Full gate: `Ran 75 of 75` Custom Rules · **7696 vitest tests** · tsc clean · tests-typecheck at
  baseline · lint 0 (an `exhaustive-deps` suppression became unnecessary once the effect stopped
  reading `readiness`, and is gone).

## Not exercised

**The S25.** The sheet is a daily native surface and the change alters what it shows on open; the
web harness cannot speak for the device. Left on TN-50 as the residue, together with Tuning's
re-measure of TN-47 once post-cutoff days accumulate.

<a id="2026-09-19-lane-a-tn50-relane-and-sharpen"></a>

# 2026-09-19 — TN-50 re-laned to B, its central number re-verified, and the defect sharpened

**Branch:** `lane-a/tn50-relane-and-sharpen` · **Lane A** · docs-only · no code, no migration ·
unversioned

TN-50 was filed by Tuning tonight and arrived at the top of Lane A's READY list. Re-verifying it
before starting — the protocol step, and this entry's own first draft had already been wrong once —
produced three things and no code.

## Its central number reproduces exactly

The entry claims the saved `energy_level` is what `readinessToEnergy(readiness)` would have
auto-selected on **45 of 62** days (73%). Re-run independently against production:

| days | matching the auto-fill | `ok` | `good` | `pumped` |
|---:|---:|---:|---:|---:|
| 62 | **45** (72.6%) | 36 | 4 | **0** |

Every figure holds, including `pumped` never having been logged. *(The owner's rows only —
`claude_ro` is row-scoped.)* Worth recording the confirmation rather than assuming it, given the
entry's history.

## The sharpening: the auto-fill biases the term UPWARD, not just circularly

`CHECKIN_ENERGY_SCORE.ok = 72` (`readiness-composite.ts:122`) while the documented `NEUTRAL` is
**50** (`:106`), and `readinessToEnergy(null)` returns `"ok"`. So a saved-but-unanswered check-in
contributes **72, not 50** — **+22 above neutral** — on the **36 of 62 days** that stored `ok`.

That matters for what happens when the fix lands: *"default to neutral"* will **lower** this
contributor on most days rather than leave it where it is, so the readiness line steps down visibly.
The owner's decision is unaffected — he asked for the term to tune on his response rather than infer
one — but the expected effect is now a number instead of a surprise.

## It has no Lane A engine half

Filed `Lane: A, then B` on the reasoning that *"the circularity and the `CHECKIN_ENERGY_SCORE`
mapping are `packages/shared`"*. Checked against the code, the circularity is **not** in shared: both
seed sites are `components/mood-checkin-sheet.tsx:86` (initial state) and `:177` (reset) — one Lane B
file — and the entry's own instruction is *"do NOT re-map `CHECKIN_ENERGY_SCORE`"*. Items 1 and 2 are
therefore a single-file Lane B change. Re-laned to **B**.

## Item 3 is better as a cutoff than a column — recorded as a recommendation, not a decision

Item 3 asks for storage that distinguishes "auto-filled" from "answered". A flag solves that
*going forward*, which is precisely the window item 1 eliminates: once the sheet stops seeding from
readiness, every stored value is an answer. What stays ambiguous is the **history**, and a flag added
now cannot label it — whether a past row was auto-filled is a statistical inference (the 73%), never
a per-row fact.

A dated line — *rows before the fix may be auto-filled, rows after are answers* — carries everything
the column would, applies to the rows that actually need it, costs no migration, and does not delay
items 1 and 2 behind one (a migration ships alone).

**Left as a recommendation because TN-50 is Tuning's entry and the implementer is Lane B**, who will
read it either way. Not removed, not decided unilaterally.

## Not exercised

- **The S25 device.** Docs only.
- **The fix itself.** Lane B's, and not started here.
- **What the readiness series looks like after the change.** The +22 figure is per-day on the
  contributor; the composite effect across history was not computed, and TN-50's own warning against
  re-tuning weights against this column applies to anyone who tries.

<a id="2026-09-20-bf-178-bf-179-readiness-label-stale-deload"></a>

# 2026-09-20 — "still called oura readiness?" and "recommend deload?" are two different bugs

**BugFix intake.** Docs-only. Owner, on the *Why Upper?* screen: *"Still called oura readiness and
reccomend deload?"* Two findings, unrelated to each other: **BF-178** and **BF-179**.

## BF-178 — the number is ours, three surfaces credit Oura

`liveReadinessForDay` returns `oura_daily_derived.readiness_score` where the source is
`ble-derived` — the app's own composite. The frozen Cloud column is a fallback only for pre-re-key
days. Production on the day of his screenshot: **46, `ble-derived`**, as is every recent row.

Home calls the same number "Readiness". The explain screen calls it "Oura readiness". The worse half
is `session-explain/insight/route.ts:46`, which feeds the model `- Oura readiness: ${...}` — so the
generated prose says it too, which is why his screenshot reads *"Despite your Oura readiness of
46"*. A label is a rename; a prompt line teaches the model to attribute our composite to a third
party in text nobody reviews.

## BF-179 — a dismissed prescription that expired three days ago is setting today's loads

First, the two deloads are different systems. The explain screen's signals feed
`computeDeloadStrength`, which gates on `consecutiveTrainingDays < 3` and with his **0** returns
`recommended: false`. The workout screen's banner is the **periodization prescription**, which never
consulted those signals. So "every signal says I'm fine, why deload" has a real answer: nothing on
that screen produced it.

Then the defect. Upper's stored row, measured 2026-09-20:

| field | value |
|---|---|
| `prescription_status` | **dismissed** |
| `prescription_expires_at` | **2026-09-17 21:25** |
| `phaseAction` | `deload_recommended` |

The ageing-out check in `reevaluate.ts:104-110` covers `auto_applied | accepted | consumed`.
`dismissed` is in neither that set nor the deliberate `pending` carve-out, so `needsRegenerate`
never fires and `workout-data` takes the `else` branch — which **re-stamps the stale prescription
and writes it back**. The expired offer is refreshed, not tolerated.

**This is Q-229 returning through a status its fix did not name, and the file says the symptom out
loud**: *"an 8-day-old deload-era 52% served on a live Intensification day."* His screenshot is
**52% across all five exercises**.

## The one thing not pinned down, recorded rather than guessed

`prescriptionDrivesLoad` returns false for `dismissed`, and the card's "· Deload recommended" copy
is gated on `isPending` — so by the code a dismissed prescription should do neither, yet the device
does both. Two candidates with different fixes: a stale `workout-card:` cache seeded by the
read-only `?tab=all` path while the prescription was still pending, or a status divergence between
client and row. The entry names both and the test that separates them. The expiry gap is real
either way.

## What was not exercised

Nothing on the S25. Both were traced in source and confirmed against production rows — the readiness
source column and the periodization row — not reproduced at runtime. BF-179 carries a device check
because the 52% is what the owner actually sees.

<a id="2026-09-20-bf-180-bf-181-full-override-static-fallback"></a>

# 2026-09-20 — "is that the default full, not the AI full?" — yes, and the sweep was worse than the report

**BugFix intake.** Docs-only. Owner, after overriding the BF-179 deload: *"now I have full - but im
guessing its the default full - and not the ai prescribed full (as it was usually 2 sets now its 4).
So we need some sort of catch to make sure its always ai derived right?"* **BF-180** and **BF-181**.

## His diagnosis was right, and it measures out exactly

All five Upper exercises are `{ pct: 52, reps: 8, sets: 2, deloaded: true }` with **no `preDeload`
block**. So `deloadOverrideBlocked` returns all five, `deloadRevertNames` returns empty, and
`deloadOverrideOutcome` returns `nothing-to-revert`. The override has nothing AI-derived to revert
to and the session falls through to each exercise's stored progression style:

| exercise | static style | sets |
|---|---|---|
| Incline Bench Press | Powerbuilding | **4** |
| Chest-Supported Dumbbell Row | Hypertrophy Plus | **4** |
| Chin-Up / Lateral Raise | Hypertrophy 3-set | 3 |
| Barbell Skull Crusher | **none** | **0** |

"Usually 2 sets, now 4" is Incline Bench's Powerbuilding style exactly.

## Root cause

`preDeload` is written only on the **per-exercise** deload path —
`reconcile-prescription.ts:224` iterates `params.deloadedIds` and captures each target's values
before overwriting them. A **session-level** deload never enters that loop: its low percentages are
produced directly at generation, so "what full would have been" is never computed and never stored.
The exercises carry the flag with nothing behind it.

`utils.ts:216-231` (LB-47) already documents `nothing-to-revert` for the case where a session-level
deload carries **no** `deloaded` flag. This is the sibling it did not name — flag set, `preDeload`
absent, same branch.

## Recommendation on his "catch"

Store the full-intensity block at generation for session-level deloads too, so the override reverts
locally and instantly with no network call while he is standing in a gym. **The information is not
currently computed on that path**, so it is a generation change rather than plumbing — that is the
honest cost. Regenerating on tap is kept as the fallback for prescriptions already stored without
the block, including his; it is rejected as the primary because it needs a round trip at the worst
moment and fails offline.

## BF-181 — the sweep was run before filing and changed the entry

The missing style on Skull Crusher looked like one orphan. It is **14 rows, nine in the active
program**, and **`Lower` has no static programming at all** — all five exercises. Every session in
the active program has at least one, and the inactive `Main` shows the same shape, so it is a
missing constraint at write time, not bad rows. Worth knowing: this is invisible while the AI
prescribes every set, and load-bearing the moment anything falls back — which is precisely what
BF-180 found the override doing.

## What was not exercised

Nothing on the S25. Both were traced in source and confirmed against production rows — the stored
prescription JSON, the style join, and the null-style sweep — not reproduced at runtime. BF-180
carries a device check because the owner has to see 4 sets become the AI's number.

<a id="2026-09-20-bf-182-warm-prescription-earlier"></a>

# 2026-09-20 — "generate it at completion?" — he asked for the opposite in July, and BF-179 says he was right

**BugFix intake.** Docs-only. Owner: *"when you select the ai generated workout plan it should be
able to auto create workout as soon as your one is completed right? The only factors would be if you
choose deload or quicker one right? Is there a way we can optimize this?"* Filed as **BF-182**.

## The decision already exists, in the code, with his name on it

`complete-workout/route.ts:47-51`: *"The next prescription for this session is intentionally NOT
generated here — it is generated on demand when the session is next opened, so it is never more than
a few minutes stale and never sits waiting for a decision for days (**owner ask 2026-07-31**:
generation should happen right before the workout, not at the end of the previous one)."*

He is asking for the reverse of his own call. **BF-179 is live evidence the July decision was
right**: a prescription generated early and left sitting is exactly what went stale — dismissed,
expired 2026-09-17, still serving 52% on 2026-09-20.

## His "only two factors" is nearly right, and the distinction decides the design

Deload and duration are not filters over a finished prescription — **both are inputs to it**.
`durationPreset` reaches `generatePrescriptionForSession` and sets `budgetOverrideMin` via
`budgetForPreset`, changing how much work is prescribed; the prescribe route calls it *"a today-only
time-budget choice from the pre-workout screen"*. The deload decision reads the day's readiness at
generation time.

So a prescription built at completion is keyed to **yesterday's readiness** and a guessed duration,
and picking Quick or Long regenerates it anyway. Pre-generating does not remove the wait — it moves
it and adds a stale answer.

## What is actually slow

Nothing warms the prescription before the workout tab opens. `isAiPrescriptionPending` fires
`regeneratePrescriptionInBackground` from `workout-data` **on tab-open**, and the client paints
"preparing your AI workout" while it lands. `/api/next-session/prescription`, the only other reader,
is explicitly read-only and fires no `/prescribe`. **The first thing that ever asks for the
prescription is the screen the lifter is waiting on.**

## Recommendation

Warm it when Home renders the recommendation card — same day, `standard` preset. Generation then
starts seconds-to-minutes before the tap instead of at it, while keeping everything the July
decision bought: same-day readiness, no multi-day sit, no decision waiting. Quick or Long
regenerates, which is a deliberate choice where a visible wait is honest.

Flagged for the implementer: the existing single-flight dedupe was built for a ~3s poll on one
screen. A Home warm racing a tab-open trigger is a different shape, and two concurrent generations
for one session is the failure worth avoiding.

## What was not exercised

Nothing on the S25, and nothing measured at runtime — the trigger chain was read, not timed. The
entry gates on the owner because it revisits his own decision, and carries a device check because
perceived latency is the entire point and the sandbox cannot measure it.

<a id="2026-09-20-bf-183-meal-affinity-icons"></a>

# 2026-09-20 — "which meal is this good for?" — the icon vocabulary already exists

**BugFix intake.** Docs-only. Owner: *"Can we have some sort of icon system to indicate which meal
its good for? Maybe we could use the lucid icon pack for this."* Filed as **BF-183**.

## The recommendation is emoji, not lucide, and the reason is data not taste

`meal_types` already carries a user-set `emoji`, and the Assign-to-Meal sheet already renders it.
His four active types: 🍳 Pre Workout (Breakfast), 🍎 Post Workout, 🥗 Lunch, 🌙 Dinner.

**Meal types are user-created.** A fixed lucide map cannot name a type the app did not anticipate,
and this account has previously carried an *"Afternoon Meal"* 🍽️. The emoji always can, because he
picks it. The mapping is also already trained — he sees those four glyphs every time he logs — and
one vocabulary cannot drift from itself.

## The signal is strong enough to ship

Dominant meal type by log count, across all 19 saved meals:

| tier | count | examples |
|---|---|---|
| Confident (≥3 logs, 100%) | **10** | Protein Shake 45× 🍳 · Cruskit + PB 26× 🍳 · Ninja Creami 10× 🥗 · Wrap Pizza 6× 🌙 |
| Split | 2 | Beef Mince Cube 60% 🌙 · Corn Chips 50% 🥗 |
| Single log | 3 | Protein Granola, Corn Block, Protein Pasta Brick |
| **Never logged** | **4** | Chicken Block, Shredded Chicken Block, Beef Ragu, Pulled Pork Block |

53% of the list gets a confident tag today, and the top of it is unambiguous.

## The part the entry insists on

**Show nothing below the threshold.** Four items have never been logged and three have a single
log; an icon derived from one log is a guess rendered as knowledge, which is exactly what BF-172 and
BF-154 were filed for. Proposed gate ≥3 logs and ≥60%, blank otherwise, self-healing as he logs.

## His "too many meals" worry, answered

The row shows one glyph — the dominant type — never N, so ten meal types render the same as four.
What degrades is the *confidence*: the same logs spread over more buckets clear 60% less often and
more rows fall blank. That is the right failure direction.

## What was not exercised

Nothing on the S25, and nothing built — this is a planning entry. The tiers above are a live query
against his account, so they double as test fixtures. Two calls are gated on him: emoji versus
lucide, and whether a below-threshold row is blank or offers a manual override.

<a id="2026-09-20-bf-184-reta-response-and-bf-183-correction"></a>

# 2026-09-20 — the reta data is sound, nothing shows it, and BF-183 was modelling the wrong thing

**BugFix intake.** Docs-only. Two items: **BF-184** (new) and a same-day correction to **BF-183**.

## BF-184 — recording verified, join verified, one gap

All three doses are present and correct:

| # | log_date | taken_at (Brisbane) | amount | vial |
|---|---|---|---|---|
| 1 | 2026-09-07 | **missing** | **0.5 mg** | none |
| 2 | 2026-09-13 | 20:00 | 1 mg | 10 mg / 3 mL @ 100 u/mL |
| 3 | 2026-09-20 | 20:46 | 1 mg | 10 mg / 3 mL @ 100 u/mL |

`log_date` and the Brisbane day of `taken_at` agree on both timed doses — no timezone drift. The
join to recovery metrics was run rather than assumed: every day 2026-09-06 → 09-20 carries RHR, HRV,
weight, readiness and stress, **15 of 15 rows populated**. The data is already matchable.

Three gaps worth knowing: dose 1 has no `taken_at` and no vial (it predates the vial opened 09-10);
dose 1 was 0.5 mg against 1 mg for 2 and 3, so cycle 1 is a titration step and not comparable; and
the intervals are 6 days then 7, so "day N after dose" and "day of week" are not interchangeable.

**The observed pattern is recorded as an observation and explicitly not a verdict.** Cycle 2 (1 mg):
RHR 55 → **65** at days 3–4 with HRV 48 → **19**, both back to baseline by day 5. Cycle 1 (0.5 mg)
has the same shape, smaller and earlier. Two cycles at two different doses with training, sleep and
stress uncontrolled.

**The bar is already set in that folder.** `weight-response.ts` (OR-102b) rejected the owner's own
two-point-delta request with production numbers — residual SD 1.203 kg, so a two-reading difference
carries ±1.70 kg, *"close to random while looking authoritative, which is worse than no colour"* —
and withholds the verdict unless the whole interval falls one side of a boundary. A recovery-response
card must do the same, and should extend that module rather than add a third estimator.

## BF-183 — corrected the same day, before any work started

Filed as *"the meal a food IS usually eaten at"*, inferred from history. The owner meant the
opposite: *"what meal timing each meal can be used for (i.e protein shake could be all 4 meals).
This will tie into the meal planner."*

**The measurement already in the entry is the proof it matters.** His protein shake has 45 logs,
every one at breakfast — and he names it as suitable for all four meals. **History records where a
food HAS been used, which is a floor on suitability and never the set.** So anything derived from
logs alone under-tags exactly the foods he uses most consistently.

The entry now asks for a stored, multi-valued `suitableMealTypeIds` — declared, not inferred — with
history demoted to a pre-tick seed. That makes it a schema change, so it moves to Lane A. Two things
survive: the emoji recommendation (stronger now, since a row may show four glyphs and they must be
the four he already reads), and the threshold, which now decides only what gets pre-ticked.

**His "too many meals" worry was wrong under my reading and right under his** — one dominant glyph
never grew, a capability set does. Capping the display is now a decision to make before building.

## What was not exercised

Nothing on the S25. BF-184's verification is live queries against production rows; no code was run
and no model fitted. BF-183 remains a planning entry with nothing built.

<a id="2026-09-20-bf-185-bf-186-dose-toggle-and-manage"></a>

# 2026-09-20 — no double log, but the re-tick moved the dose time; and "Manage supplements" is a 10 px "Manage"

**BugFix intake.** Docs-only. Owner: *"In that attempt i unclicked the button then re clicked it so
check if that caused double recording"* and *"I dont see a manage supplements section to change the
default to 1mg."* **BF-185** and **BF-186**, batched.

## BF-185 — the good news and the finding

**No double recording.** `supplement_logs` for Retatrutide still holds exactly 3 rows, none
soft-deleted. The toggle upserts the day's row rather than inserting a second.

**But the re-tick moved `taken_at`, silently.** Same row, across two production reads:

| field | before | after |
|---|---|---|
| `created_at` | 10:46:35 | 10:46:35 |
| **`taken_at`** | **10:46:33** | **11:21:13** |

35 minutes — 20:46 → 21:21 Brisbane. The injection happened once; the stamp now records the last
button press.

This is the one field BF-184's whole purpose depends on (*"dosage night vs hr"*), and nothing in the
UI says it changed. The fix is to preserve the original stamp on a re-tick — with the caveat that
re-ticking is currently the *only* way to correct a wrong time, so the entry insists on deciding
what an intentional edit looks like before removing the accidental one.

## BF-186 — the instruction names a thing that does not exist

The vial sheet says *"changed in **Manage supplements**, under Amount."* The control is labelled
**"Manage"**, at `text-[10px]` in muted grey with a 12 px icon, in the Supplements section header of
a different screen — visually matched to the `text-[10px]` "SUPPLEMENTS" label beside it. Words
differ, styling reads as decoration, and it is behind the sheet giving the instruction.

The tap target is roughly 12–14 px against the repo's 44 px rule, so the same line carries a second
defect; the fix should make it a `Button` variant rather than restyle a bare element, per the repo's
own rule about where tap-target floors live.

**Why it is not a nit:** the hint exists because his saved default (0.5 mg) no longer matches what he
takes (1 mg). The app correctly flags a stale default, then points at a door he cannot find — so the
default stays stale and a hurried tap logs 0.5 mg. That is the most likely explanation for dose 1
being recorded at 0.5 with no time.

## What was not exercised

Nothing on the S25. BF-185 was verified by two production reads of the same row, which is what caught
the moved stamp; BF-186 was read in source. Both carry a device check — one for the toggle's timing,
one because discoverability and tap target are physical properties of the screen.

<a id="2026-09-20-body-battery-remeasured"></a>

# The Body Battery is useless, was already known to be, and got worse

**Tuning agent · 2026-09-20 · branch `tuning/tn2-remeasure-and-fitting-hazard` · docs-only**

The owner: *"can we look at the body battery too. Its pretty much useless at this point."* He is
right. The useful output of the review was an amendment to **TN-2**, not a new entry — TN-2 filed
this on 2026-08-24 with a better measurement than the one this session first reached for.

## What TN-2 already had, and did better

Body Battery charges only while HR ≤ `restingHr + 0.05 × (hrMax − restingHr)`. TN-2 measured that
ceiling **time-weighted** over 56 days — 0.5% of waking time able to charge — and explicitly warns
that a **per-sample** percentile is "wrong by an order of magnitude" for this, because the ring
power-gates its PPG. This session's first pass computed exactly the per-sample version it warns
about (0.99%). Same conclusion, flagged method.

TN-2 also already names the perverse part: resting HR fell 67 → 52, a real fitness gain, and the
ceiling is anchored to resting HR — so **the boundary becomes less reachable as fitness improves.**

## What is actually new

**It has got materially worse**, and the collapse is datable:

| period | charge ceiling | 5th-pct waking HR | gap | charged/day |
|---|---:|---:|---:|---:|
| 2026-06-30 → 08-19 | 65.8 bpm | 64.0 bpm | **−1.8** | **23.1** |
| 2026-08-20 → 09-06 | 57.9 bpm | 64.0 bpm | **+6.1** | **2.2** |
| 2026-09-07 → 09-19 | 58.7 bpm | 68.0 bpm | **+9.3** | **1.0** |

Charging fell **23×** the week the ceiling crossed below his quietest waking hour. Days ending at
zero went from 5 of the last 8 to **9 of the last 13**; the mean day now runs anchor 43.4 → end 6.2.

**And a new hazard for the fix.** TN-2's accepted direction is to anchor the rest boundary to
*waking rest*. Retatrutide started 2026-09-07 and his 5th-percentile waking HR has moved 64.0 → 68.0
in two weeks. **Waking rest is currently a medicated, moving target**, so an offset fitted to it now
would bake a pharmacological transient into a constant that re-scores every stored Body Battery day.
Fit against 2026-06-30 → 09-06 and validate forward. Not knowable when TN-2 was written.

## Why it is still not fixed

TN-2 is fully diagnosed and has owner sign-off. It is blocked on something real: the fit must include
the daytime-stress term, whose `.constants.json` files Q-49 removed from the repo and which do not
exist in a session container — plus `oura_raw_samples` retains only ~7 days of the 56 the pass test
needs, with `decoded` NULL on all of them. It needs a context with the constants present.

## Two column misreads, caught before they became findings

`hr_max_observed` is that day's own peak, not the reserve input — `hr_max` is, and it correctly holds
175. Reading the first produced a false "the reserve has collapsed to 105" theory that was abandoned
when the stored value sat below a floor the code enforces. The same class as the session's earlier
traps; the tell was an internal contradiction, not an external correction.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no
UI. Row-scoped to the owner.

<a id="2026-09-20-feat-or118-movement-balance-card"></a>

# 2026-09-20 — OR-118's movement balance card, and the four days it spent invisible

**Branch:** `feat/or118-movement-balance-card` · **Lane B** · code + docs · no migration ·
**v1.460.0**

Lane B's READY list read **0** for five consecutive queue checks. It was wrong, and the way it was
wrong is worth more than the card.

## The card

Health tab → Training → **Movement Balance**: how the last 60 days of sets split across push, pull,
legs and core. `components/health/movement-balance-card.tsx` fetches `/api/muscle-sets` over a
trailing 60 days and folds the rows with `movementPattern`; `components/health/movement-balance.ts`
holds the fold as a pure function so it can be tested in the node environment.

Both halves it depends on had shipped and had **no callers**: `/api/muscle-sets` (LB-111,
2026-09-18) and `movementPattern()` (LB-103, 2026-09-13). This is the first caller of each.

**No target and no verdict.** There is no defensible universal push:pull ratio, and the owner asked
to see the split rather than be graded on it. All four rows always render, zeros included — **an
empty pull column is the finding**, so dropping empty rows would hide the one case worth seeing.

**Why not the windowed route that already existed.** `muscle-tonnage-trend` spans weeks but reports
tonnage. Legs move far heavier loads, so a tonnage share overstates them and would have hidden the
pull deficit the card exists to show. Rendering it under a set-balance label would be a false claim.

## Why it was invisible, which is the part to keep

Nothing blocked OR-118 after 2026-09-18. Its `Needs:` was empty and the entry said in words that it
was *"now startable"*. It printed under PARKED anyway, because `next-item.js:97` reads a `⛔`
**anywhere** in an entry as the legacy prose blocker — and three bullets up, one was being used as
emphasis on a corrected premise.

That is **LB-121**, filed two days earlier by this lane, and this is its first measured cost: a
buildable card sat behind a READY list reading 0. Two more Lane B entries are parked the same way
right now, **TN-3b** and **Q-305**, both recorded on LB-121 rather than quietly unparked.

**The habit that found it:** when READY reads 0, read PARKED. The baton already said so — *"READY
running low is not 'no work'"* — and it took five checks before I did it.

## Verification

`movement-balance.test.ts`, 11 cases, and the mutations are what make them worth quoting:

| mutation | result |
|---|---|
| ignore the shared classifier (everything → `other`) | **5 fail** |
| drop zero rows | **5 fail** |
| sort rows by size instead of the fixed order | **1 fail** |
| drop the non-finite / negative guard | **1 fail** |

`e2e/or118-movement-balance-card.spec.ts` proves the card is mounted and renders all four patterns,
and goes red — *"the card is not mounted in the Training list"* — with the section unregistered.

**It refuses the empty state deliberately.** `seed.sql` logs Bench Press at 2, 3 and 5 days ago with
`muscle_groups = '{chest}'`, so a fresh CI database lands in-window with one pattern populated and
three at zero: the drawing path and the zero-row case exercised in the same run. Accepting "no data"
would have been the LB-98 trap, where a spec can only ever assert that nothing is there while the
path that draws the bars ships unexercised.

The hex-literal ratchet caught the first version's palette. The four colours are theme tokens now
(`--accent-cyan` / `--accent-purple` / `--accent-green` / `--color-muted-foreground`) — four
*categories*, not a scale, so none of them is green-for-good; colouring push green would imply the
verdict the card refuses to make.

## Gate

`Ran 75 of 75` Custom Rules · **8988 vitest tests** (948 files, 0 failed) · new e2e green and
`cardio-baselines-placement` (the sibling Training-panel spec) still green · tsc clean ·
tests-typecheck at baseline (320/90) · lint 0 errors.

## Not exercised

**The S25.** The pattern word sits beside a set count and a bar on a narrow row — that is a
412 px-width judgement the harness can assert the existence of and not the look of. `Verify: device`
on the entry.

Also untouched: offline/local-store paths (this card is a server read with no local mirror), and
the accuracy of the underlying attribution, which is LB-111's and was pinned there.

<a id="2026-09-20-fix-bf186-saved-dose-note-is-the-door"></a>

# 2026-09-20 — BF-186's note becomes the door, and BF-185 turns out not to be Lane B's

**Branch:** `fix/bf186-manage-supplements-reachable` · **Lane B** · code + docs · no migration ·
**v1.460.4**

The batch `supplement-dose-surface` arrived as two Lane B entries. One was; one was not, and
finding that out before building it is the more useful half of this entry.

## BF-186 — shipped

The vial sheet told the owner his saved dose was *"changed in Manage supplements, under Amount"*.
He replied: *"I dont see a manage supplements section to change the default to 1mg."* He was right —
nothing is called that. Three things stacked:

1. the note said **"Manage supplements"**; the control says **"Manage"**, alone;
2. it is 10 px muted text with a 12 px icon, beside a 10 px "SUPPLEMENTS" label it visually matches;
3. it is on the screen *behind* the sheet giving the instruction.

Matching the words would have fixed one of the three. So **the note stopped naming a destination
and became one**: *"Your saved dose is 0.5 mg. **Change it**"*, which closes the vial sheet and
opens the manage sheet. The navigation is removed rather than described.

Closing one sheet while opening another in the same tick is the sibling sequence
`lib/hooks/sheet-back-stack.ts` handles deliberately — `pendingSelfPops` is module-level for exactly
that case (BF-34), with unit tests. Checked before wiring, not after.

The header control also got `.tap-target-44`, the utility for a small **isolated** control: a
`::before` hit box, so it gains a 44 px target without the header gaining a button. Isolated holds
— its only neighbour in the row is the non-interactive label.

## BF-185 — re-laned to A, unbuilt

The entry says *"Lane: B — the dose toggle in `components/nutrition/supplements-section.tsx`"*. The
toggle never sends a timestamp. `taken_at` is stamped at **`lib/data/postgres/adapter.ts:6756`** —
`lib/data/**`, Lane A by the path rule.

**And the re-stamp is deliberate and documented**, which makes this a request to reverse a decision
rather than to fix an oversight. The comment above the upsert reads:

> *"Re-logging re-stamps because the row is one act of taking it: if the dose was corrected between
> the untick and the re-tick, the second value is the true one."*

That reasoning is coherent. It is simply wrong for the case BF-184 needs, where the stamp feeds a
dose-timing correlation against overnight HR. Whoever takes it has to argue against that comment,
not delete it.

There *is* a Lane B half — the server already honours an explicit `takenAt`, so an editable-time
control can send one — but it is worthless until the re-stamp stops, because the next re-tick would
wipe the edit. Engine half first. The batch is split; a cross-lane batch cannot be one PR.

**This is the sixteen-and-counting pattern again:** an entry's stated cause and lane are prose until
something checks them. The check cost one grep.

## Verification

`e2e/bf186-saved-dose-note-is-the-door.spec.ts` creates a mg-dosed supplement, opens the vial sheet,
taps the note, and asserts the manage sheet opens and the vial sheet closes — plus that the dead
phrase is absent from the rendered copy. **Proven red with the callback unwired:** *"the saved-dose
note carries no control, so the dose stays unreachable"*.

`Ran 75 of 75` Custom Rules · **9048 vitest tests** (0 failed) · tsc clean · tests-typecheck at
baseline (320/90) · lint 0 errors.

## Not exercised

**The 44 px tap target**, which is the point of half the fix and the one thing a browser cannot
check: `domClick` bypasses hit-testing entirely, and synthetic input does not reach these handlers
at all (measured in `vial-dose-calculator.spec.ts`). The spec proves the wiring and the words. The
target is owed on the S25, and the entry carries `Verify: device` saying so.

<a id="2026-09-20-lane-a-bf178-readiness-not-oura"></a>

# 2026-09-20 — BF-178: the readiness number is ours, and three surfaces said it was Oura's

**Branch:** `lane-a/bf178-readiness-not-oura` · **Lane A** · owner report: *"Still called oura
readiness"*, on the *Why Upper?* screen.

## What was wrong

`liveReadinessForDay` returns `oura_daily_derived.readiness_score` where
`readiness_source === 'ble-derived'` — the app's own composite. The frozen Oura Cloud column is a
fallback **only** for pre-re-key days, gated on `isPreRekey(date)`. The header of
`live-readiness.ts` has said so since it was written. Three live surfaces still printed the number
as Oura's:

| site | said |
|---|---|
| `packages/shared/src/session-explain/group-signals.ts:47` | `label: 'Oura readiness'` |
| `packages/shared/src/health/weekly-digest-metrics.ts:111` | `Oura readiness: N/100 avg that week` |
| `app/api/session-explain/insight/route.ts:46` | prompt line `- Oura readiness: …` |

Home calls the same value **"Readiness"**. One tap apart, same number, two provenances implied, and
the Oura one false.

## What shipped

All three now say **"Readiness"**, matching Home rather than inventing a fourth vocabulary.

**The prompt line is the half that mattered** and the reason this is a bug and not a quibble: it
fed the model `- Oura readiness: 46`, so the generated prose said it too — the owner's screenshot
reads *"Despite your Oura readiness of 46"*. A label is a rename; a prompt line teaches the model
to attribute the app's own composite to a third party in text the owner reads as fact.

Its `'not connected'` fallback went with it, to `'no data'`. "Not connected" describes a
third-party device that could be disconnected; when the value is ours it is simply absent.

**The field is still `ouraReadiness`**, now carrying a comment in `types/program.ts` and
`build-explain-data.ts` saying the value is ble-derived. The name is what taught all three call
sites to write "Oura", so leaving it uncommented would re-teach the next one. Renaming the field
touches five more files and is a mechanical change; bundling it into a behavioural fix would have
made the diff harder to read for no gain. Not filed as follow-up work — the comment removes the
trap, and a rename with no defect behind it is churn.

## What was deliberately left alone

- **`lib/health/readiness-payload.ts:749`** — *"An Oura readiness score is a whole-picture number
  by construction"* is guarded by `ouraToday?.readinessScore != null`, i.e. the real Cloud column.
  That comment is correct about what it describes. **It did raise a separate question worth
  recording: that availability branch still reads the frozen Cloud column, which post-re-key is
  absent for every recent day.** Out of scope here and not investigated.
- **`packages/shared/src/types/day-checkin.ts:67`** — design provenance for the Recovery scale.
  History, not a live label.
- **`changelog.ts`** — a changelog entry describing what shipped then is accurate as a record.
- **`score-ring.tsx:8`** was updated, because it *quotes the screen* (*"signals reading Oura
  readiness 37 · Low"*) and the quote had just gone stale. One word; the argument it makes is
  about HIGH-above-Low and is untouched.

## Verification

`packages/shared/src/health/__tests__/bf178-readiness-provenance.test.ts`, 4 cases.

**Mutation pass — 3 mutations, each caught by its intended test:**

| reverted | caught by |
|---|---|
| explain label → `'Oura readiness'` | the label case, plus the pre-existing `group-signals` fallback case |
| prompt line → `- Oura readiness` / `'not connected'` | the source-scan case |
| digest string → `Oura readiness: N/100` | the digest case |

**Two deliberately equivalent controls, both green (11/11):** renaming the internal
`readiness` local in `group-signals.ts`, and rewording an **unrelated** prompt line in the scanned
route (`Sleep trend vs baseline` → `versus baseline`). The second is the one that mattered — a
source-scan test's failure mode is being too broad, and this shows it does not fire on ordinary
edits to the file it scans.

The prompt line is asserted by reading the route source rather than by rendering the route,
because the failure reaches the user only as generated prose and catching it any other way needs a
live model call.

## Not exercised

Browser and device both unexercised — the change is three string literals and a comment, with no
layout, no safe-area, no offline path and no native surface. The owner's stated check is to open
*Why <session>?* and read the row; that is a Railway deploy away and needs no APK.

## Out of scope, stated so it is not re-litigated

Whether **46 is a good score** on a day with HRV well above baseline is calibration, not naming.
That belongs to TN-6 and BF-13, which are open.

<a id="2026-09-20-lane-a-bf179-expire-dismissed-prescription"></a>

# 2026-09-20 — BF-179: a dismissed prescription that expired three days ago was still prescribing 52%

**Branch:** `lane-a/bf179-expire-dismissed-prescription` · **Lane A** · the expiry gap only; the
*pending-looking card* question is narrowed below but not closed.

## What was wrong

The ageing-out check in `reevaluatePrescriptionForToday` was an **allow-list** naming
`auto_applied`, `accepted` and `consumed`. `dismissed` was in neither that set nor the deliberate
`pending` carve-out — so `needsRegenerate` never fired, and `workout-data/route.ts` took the
else-branch, which **re-stamps the stale prescription and writes it back**. The expired offer was
not merely tolerated, it was refreshed on every tab-open.

The owner saw it as a session screen with every exercise at 52% and a Deload chip, asked against an
explain screen reading **100/100 STRONG FIT**, streak 0 days, sore muscles None, HRV well above
usual. His *"why does it say deload when every signal says I'm fine"* had a real answer: **nothing on
that explain screen produced it.** The explain signals feed `computeDeloadStrength`, which gates on
`consecutiveTrainingDays < 3` and returned `{ recommended: false }`. The banner is the periodization
prescription, a different system with its own lifecycle that never consulted today's signals.

**This is Q-229 returning through a status its fix did not name** — and the file said the symptom out
loud in its own comment: *"an 8-day-old deload-era 52% served on a live Intensification day."*

## The shape of the fix is the point, not just the fix

It is a **deny-list** now — every status ages out on expiry except `pending` and `none` — where the
entry could have been satisfied by adding `dismissed` to the existing allow-list.

An allow-list is wrong here by construction. `PrescriptionStatus` has six members; the check named
three; the bug *was* the gap. Adding a fourth name leaves the next status added to that union as the
next silent gap, and nothing fails when it happens. A deny-list ages out by default and a new status
has to argue for its exemption. Both exemptions carry their reason in the code: `pending` is an offer
whose expiry the emergency-deload suppression already owns, and `none` means there is nothing to age
out, so regenerating on it would loop with nothing to show for it.

## What the production read changed

The entry's measured table — `prescription_status: dismissed`, expired 2026-09-17,
`phaseAction: deload_recommended`, `deload: true` — **no longer exists.** Measured 2026-09-20 across
all 15 of the owner's `session_periodization` rows:

| status | rows | expired | with `deload_recommended` |
|---|---|---|---|
| `pending` | 5 | 1 | 0 |
| `consumed` | 5 | 0 | 0 |
| `auto_applied` | 5 | 5 | 0 |

**There is no `dismissed` row at all, and not one row anywhere carries `deload_recommended`.** The
row regenerated at 2026-09-19 23:10, exactly as LA-122 item 1 anticipated.

Two consequences, and they pull in opposite directions:

- **The defect is still real.** It is a code-level gap, independent of whether a dismissed row
  happens to exist today. Nothing about the regeneration fixed the branch.
- **It cannot be reproduced from current data, and that narrows the open question.** The entry left
  two candidates for the *pending-looking card*: a stale client cache, or a status divergence. The
  server side can no longer produce a deload banner for any session — so if the 52% is still on
  screen, **candidate 1 is the only one left standing**. That is worth more than the owner's
  yes/no on its own, because it makes the answer diagnostic either way.

## Verification

- **9 tests**, all timestamps derived from the clock rather than hardcoded, per the repo's
  rolling-window rule.
- **Mutation pass, three mutations:**
  - reverted to the old allow-list (the bug) → **2 red**, both the `dismissed` cases.
  - status test dropped entirely, the obvious over-broad "fix" → **2 red, and they are both
    controls** — `pending` and `none` are exactly what a lazier fix breaks.
  - rewritten as an equivalent `!['pending','none'].includes(...)` (the deliberate control) →
    **9 green**.
- The existing `lib/__tests__/reevaluate.test.ts` passes unchanged (28 tests across both files).

## Not exercised

- **No device look.** The 52% is what the owner sees, and only the APK proves it is gone. Both
  halves are TypeScript, so this ships via Railway with no APK.
- **The regenerated prescription path was not driven end-to-end.** The unit test asserts
  `needsRegenerate: true`; that `workout-data/route.ts` then actually regenerates rather than
  re-stamping is covered by the existing route behaviour, not by a new test of mine.
- **The second candidate is narrowed, not settled.** Confirming a stale client cache needs the
  device — clear the cache, reopen the tab, see whether the chip goes.

<a id="2026-09-20-lane-a-bf185-retick-keeps-taken-at"></a>

# 2026-09-20 — BF-185: a re-tick moved a real injection's time by 35 minutes

**Branch:** `lane-a/bf185-retick-keeps-taken-at` · **Lane A** · engine half only; the editable-time
control is still owed and is Lane B's.

## What was wrong

`supplement_logs.taken_at` followed the last tap rather than the dose. Ticking a dose, unticking it
and re-ticking it rewrote the stamp, and nothing on screen said so. Measured on the owner's
Retatrutide row 2026-09-20: `taken_at` moved **10:46:33 → 11:21:13**, 35 minutes, on an injection
that happened once. `created_at` did not move, so the row knew when it was first written and
reported the last tap anyway.

It matters because BF-184 exists to correlate dose timing against overnight HR and HRV — the owner's
words were *"dosage night vs hr"*. A stamp that follows the last tap is the one field that analysis
cannot tolerate drifting, and it drifted silently: the only way it was found was asking.

**No double recording, which is what the report suspected.** The upsert correctly revives the day's
soft-deleted row rather than inserting a second. Three rows for three doses, none tombstoned. The
bug was in the one field nobody was looking at.

## This reverses a documented decision rather than fixing an oversight

The comment above the upsert argued its position outright: *"Re-logging re-stamps because the row is
one act of taking it: if the dose was corrected between the untick and the re-tick, the second value
is the true one."*

That reasoning is correct **for the dose**, which still re-stamps. It fails **for the time**, because
the two things a re-tick can mean produce the same two taps — *"I mis-tapped"* and *"I took it just
now"* are indistinguishable from a toggle, and the old rule silently assumed the second. So the
comment is argued against in place rather than deleted, per the entry's own instruction.

## The half that actually fixes the APK is the local one

The entry names two files and reads as though either would do. They are not equivalent:

- The **server** now preserves `taken_at` on conflict unless the caller states one.
- The **device** pushes the `taken_at` it reads back from its own local row, and an explicit value
  **wins** server-side.

So a local store that kept re-stamping would push the re-stamped time straight over the server's
preserved one, and the owner's measured drift would have survived the server fix completely. Fixing
only `adapter.ts` would have produced a green suite, a true-sounding journal entry, and no change on
the device. The local mirror is the load-bearing half.

## A third write path the entry did not mention

`applyDelta`'s manual branch carries the **same** `taken_at=excluded.taken_at` line, and it must keep
it. That path mirrors a server row the device did not author, so the server's value *is* the truth
there — copying the fix into it would make a device ignore a correction made anywhere else. A test
pins it as deliberately different rather than leaving the asymmetry to be read as an oversight.

## Verification

- **Server: 5 tests** against local Postgres — re-tick preserves, plain re-log preserves, an explicit
  time still wins, a NULL stamp is filled rather than pinned, and the control below.
- **Device: 6 tests** — and they are **behavioural, not grep**. The sibling suites in
  `lib/local-store/__tests__/` scan source because `getLocalStore` returns null under node, but the
  SQL is a plain string and `node:sqlite` will run it. So the test **extracts the shipped statement**
  from `sqlite-backend.ts`, substitutes each branch of the real ternary, and executes both against a
  table built from the migration's own DDL. A change to that SQL changes what the test runs.
**Two typecheck errors the gate caught, both mine.** `check-test-typecheck` refused the pair:
`Repository` is not an exported name (it is `WorkoutRepository` — the sibling suite carries the same
error as baselined debt, so it was fixed here rather than baselined again), and `node:sqlite` has no
declarations under the pinned @types/node 20. The second is now `types/node-sqlite.d.ts`, declaring
only the members used and carrying its own deletion condition.

- **Mutation pass, four mutations:**
  - server conflict clause reverted → **3 of 5 red**; the two survivors cover arms the mutation does
    not reach (explicit-wins, NULL-fill), which is correct rather than a gap.
  - `COALESCE` rewritten as an equivalent `CASE WHEN … END` (the deliberate control) → **5 of 5 green**.
  - whole row frozen on conflict instead of just the time → **3 red, the control among them**. This
    is what the control exists for: an over-broad fix passes every "preserve" assertion and fails here.
  - fix wrongly copied into `applyDelta` → **1 red**, the asymmetry guard.
  - local fix reverted → **3 of 6 red**.

## Not exercised

- **Not device-verified.** The toggle is the surface and the timing is what is being measured, so the
  entry's own verification — tick, note the stamp, untick, re-tick, confirm it has not moved — needs
  the APK. `getLocalStore` returns null in the sandbox, so the local path ran here only as extracted
  SQL against `node:sqlite`, never through the real store on the real device.
- **No APK needed, though.** Both halves are TypeScript, so they reach the device through a normal
  Railway deploy.
- **The Lane B half is not built and BF-185 stays queued for it.** Preserving the stamp removes
  today's only way to correct a wrong time, which the entry raises against itself. The server already
  honours an explicit `takenAt` and a test pins that arm, so the editable control has something to
  send — but until it exists, a wrong time is uncorrectable from the UI. That is a deliberate,
  stated regression in reach, taken because a silently-drifting stamp is worse for the analysis the
  field exists to support.
- **`pnpm lint` is the CI command and exits 0.** An `npx next lint --max-warnings 0` run of my own
  making reported a warning in `lib/walk/__tests__/segment-stats.test.ts`, a file this PR does not
  touch; the repo tolerates warnings (749 of them) and CI does not pass that flag. Worth stating
  because a stricter-than-CI local invocation reads exactly like a real failure.
- **The owner decision named in the entry is untouched.** Editable-vs-visible-re-stamp is still open;
  this change is compatible with editable (the entry's, Lane B's and Lane A's shared recommendation)
  and is one line to revert under the other answer.

<a id="2026-09-20-lane-a-bf55-growth-attributed"></a>

# 2026-09-20 — BF-55: the database is not growing 7× its trend; two windows had not filled

**Branch:** `lane-a/bf55-growth-attributed` · **Lane A** · docs-only. Fifth KEEP-mined item of the
session, after LA-63, LA-123, LB-27 and LA-74.

## The question that was open

BF-55's index half shipped 2026-09-01. Its `Keep:` was *"the growth trend, which this did not
explain"* — ~2.1 MB/day unaccounted for after excluding the archive, against a ~0.4 MB/day
expectation, last read 2026-09-04.

## Measured 2026-09-20

**227.4 MB** on `sum(pg_total_relation_size)` over `pg_stat_user_tables` — the same measure as the
171 / 200 / 204 / 224 series, stated explicitly because BF-55 records nearly walking into the trap
of mixing it with `pg_database_size`, which reads **242.2 MB** today.

That is **1.71 MB/day against RV sweep 50's 224 MB two days ago, and 1.71 MB/day against the 171 MB
baseline 33 days ago.** The rate is stable, not accelerating.

## The answer, and it inverts the recorded evidence

CLAUDE.md said the growth was *"bounded and explained"* because `oura_raw_samples` reclaims into the
archive, `oura_heartrate` "spans 88 days against its ~90-day window **(steady state)**", and
`rr_intervals` "spans 60".

**The 90-day window belongs to `rr_intervals`. `oura_heartrate` prunes at 180** —
`HR_RETENTION_DAYS` in `lib/data/postgres/slices/oura.ts`, and the comment beside the `rr_intervals`
prune says so outright: *"its sibling oura_heartrate prunes at 180d"*.

So at a measured span of **90.6 days**, `oura_heartrate` is **half-filled and has never reclaimed a
row**; `rr_intervals` at 60 of 90 has not either. Both tables offered as evidence of steady state are
still filling — and that is the whole of the trend BF-55 chased for three weeks. **A window that has
not reached its cap reclaims nothing and grows at the full ingest rate.** The ~0.4 MB/day
expectation implicitly assumed a steady state that had not arrived.

| table | size | span | cap | MB/day | filled |
|---|---|---|---|---|---|
| `oura_heartrate` | 33 MB | 90.6 d | **180 d** | 0.36 | 50% |
| `rr_intervals` | 23 MB | 60 d | 90 d | 0.38 | 67% |
| `oura_raw_packed` | 24 MB | 33.4 d | *none — archive* | 0.72 | permanent |
| **sum** | | | | **1.47** | |

Against a measured 1.71 MB/day that leaves **0.24** for small tables and index growth. The
attribution closes.

`oura_raw_samples` genuinely is at steady state: **7.4 days under a 31-day cap**, the packer
reclaiming into `oura_raw_packed`. That half of the old explanation was right.

## The falsifiable prediction, which is the point

Total growth should **step down twice**: around **late October**, when `rr_intervals` reaches 90
days, and around **2026-12-19**, when `oura_heartrate` reaches 180 (its oldest row is 2026-06-22).
It should settle near **~0.96 MB/day** — the archive plus the small-table remainder.

**A step that does not arrive is the signal**, and it is a far better one than a daily figure,
because it fails loudly in one direction only. That replaces the "7× trend" framing, which compared
a filling system against a steady-state expectation and could only ever read as alarming.

## What must not be "fixed"

`oura_raw_packed` at 0.72 MB/day is 42% of current growth and the single largest grower. It is the
archival source of truth — `body_hex` is never pruned on the server, because a decoder added later
can only back-fill by re-decoding stored hex. ~440 MB/year, permanent, on a 5 GB volume. BF-55 said
this and it bears repeating next to a table that makes it look like the problem.

## Cost, so nobody panics

At Railway's $0.15/GB/month the whole database is about **three and a half cents a month**. The
reason to watch it is that an unexplained trend compounds — and this one is now explained.

## Not exercised, and the honest gaps

- **`rr_intervals`' span is RV sweep 50's figure (2026-09-18), not mine.** There is no
  `claude_ro.rr_intervals` view, so I could not re-measure it from the admin endpoint; its 0.38
  MB/day and its "67% filled" therefore carry two days of drift. Everything else in the table was
  read today.
- **Sizes are exact; the spans are the owner's rows only.** `pg_stat_user_tables` size columns come
  off the filesystem, but the spans come from `claude_ro` views, which are row-scoped. A second
  account's rows would widen a span and change nothing about the caps.
- **The prediction is untested by construction** — its first checkpoint is about five weeks away.
  That is what makes it worth writing down rather than concluding.

<a id="2026-09-20-lane-a-la121-measured"></a>

# 2026-09-20 — LA-121 measured: four dead readiness branches, and an unreachable temperature ladder

**Branch:** `lane-a/la121-measure-dead-cloud-branches` · **Lane A** · docs-only.

LA-121 was filed an hour earlier, during BF-178, as a deliberately **unmeasured** observation: the
readiness availability branch still keys off `oura_daily.readiness_score`, which the re-key froze.
The entry said its first step was a query, not a patch. This is that query.

## What the measurement changed

| filed as | measured |
|---|---|
| one branch | **four** — `readiness-payload.ts:580, 610, 614, 751`, all on the same condition |
| "presumably false for post-re-key days" | **NULL on 35 of 35 days**, confirmed |
| "pre-re-key-only" | **permanently unreachable** — `buildReadinessPayload` takes no date, so `ouraToday` is always today |

The "pre-re-key-only" framing was the guess, and it was wrong in the direction that matters: there
is no historical path through this function at all, so the dead arms have not run since
2026-07-07 and cannot.

## What did not change

**Every fallback is correct.** Each live arm reasons from our own inputs, which is right when the
score is our own composite. Nothing user-visible is wrong today, and an implementer who "fixes"
this expecting a behaviour change will find none.

## The one thing worth someone's attention

`computeBlendedScore` has exactly one production call site — the dead arm — and it carries a
**temperature penalty ladder** that no longer runs. Its test measures it: from a base of 80,
deviation 0.4 → 70, 0.7 → 60, 1.2 → 40.

**The claim that would have made this urgent was checked and is false:** temperature has not
dropped out of readiness. `computeReadinessComposite` takes `tempZ`, and the composite is the live
path. The ladder and the `tempZ` contributor are two different mechanisms; the second survives.

Whether losing the first is a loss is a **calibration** question (TN-6, BF-13), so the entry now
asks the owner rather than answering it, and explicitly blocks removal of the four dead arms until
it is answered — a scoring-path diff whose mistakes silently re-score every stored day buys nothing
while the question is open.

## Method note

This is the second time today that a measurement inverted an entry rather than confirming it, and
the first time the entry was one I wrote myself. Filing it unmeasured, with "nothing here is
measured" stated twice in the body, is what made the inversion cheap — there was nothing to
un-believe. The alternative, asserting "pre-re-key-only" as fact because it sounded right, would
have had the next reader build against a premise that a single query disproves.

## Not exercised

Nothing to exercise — docs-only, no code touched.

<a id="2026-09-20-lane-a-la122-owner-question-ledger"></a>

# 2026-09-20 — LA-122: the five owner decisions Lane A is blocked on, written down

**Branch:** `lane-a/la122-owner-question-ledger` · **Lane A** · docs-only · filed at the owner's
request ("either state them here or file them for the orchestrator").

## Why

Five decisions had accumulated across the session, each raised in chat and each blocking a specific
queue item — BF-179 for a day, Q-29's destructive drop for longer, Q-28/BF-9/BF-7 indefinitely. A
chat transcript ends with the session; the queue does not. LA-122 is a `Reference:` entry, so
`next-item.js` prints it in its own section rather than at the head of the work list.

## What is in it

1. **BF-179** — is the 52% still on screen? The row regenerated at 23:10 on 09-19 and
   `session_periodization` keeps no history, so the earlier state is unreadable. One look settles
   whether this is live or a post-mortem.
2. **LA-121** — port `computeBlendedScore`'s temperature ladder onto the composite path, or accept
   `tempZ` as its successor? Either answer re-scores stored days.
3. **Q-28, BF-9, BF-7 carry no `Gate:` field.** They are held back only by an exclusion list inside
   a scheduled routine prompt. Gate them in the file or release them — a convention living in a
   prompt rather than in the file everyone reads is the kind that goes stale unnoticed.
4. **Q-29 Task 5** is a destructive drop of the server raw archive; confirm-first by rule.
5. **The `.size` conflict tax.** Every merging PR and every Lane A PR touch the same ratchet file.
   Today `main` took a commit roughly every 8 minutes against a ~6-minute CI run, and **Q-1a needed
   five rebases and four refused merges to land**. Recommended fix: BugFix batches a sweep into one
   PR. Also recorded: **GitHub auto-merge is unavailable on this repo** — `enable_pr_auto_merge`
   returns *"Protected branch rules not configured for this branch"* — so the CI/CD section's
   auto-merge suggestion does not apply here, which is worth knowing before someone else reaches
   for it.

## Shape

Written as a ledger with a `Keep:` line rather than five separate entries, because they share one
blocker (owner attention) and splitting them would put four more items at the head of a queue that
nobody can start. Each item names the entry it unblocks, so striking it is mechanical.

## Not exercised

Docs-only, no code touched.

<a id="2026-09-20-lane-a-la123-lock-assertion-scope"></a>

# 2026-09-20 — LA-123: a test asserting something about other people's tests

**Branch:** `lane-a/la123-lock-assertion-scope` · **Lane A** · filed and shipped the same day, from
a failure seen while gating LA-63.

## What it was

`migration-test-lock.test.ts` ended with:

```sql
SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'   -- expected 0
```

**`pg_locks` is scoped to neither database, session nor process.** `migrationTestLock` is used by
**15 other test files**; vitest runs files in parallel workers; every one of those workers takes the
same advisory key (`171_0164`) against the same Postgres. So the hook asked whether *somebody else*
happened to be inside their migration at the moment this file finished — which is nobody's
invariant, and is not something this file can do anything about.

It showed up as `Test Files 1 failed | 951 passed` against `Tests 9027 passed | 0 failed`: a file
failing while none of its tests do, which is the signature of a hook rather than an assertion.

## Proving it, rather than re-running until it went away

A second full-suite run was green, which settles nothing — that is what an intermittent failure
looks like from either side. The mechanism was reproduced directly instead: hold the key from one
connection, then evaluate both predicates from another.

| | value | expectation | |
|---|---|---|---|
| old, cluster-wide | **1** | 0 | **fails** |
| new, scoped to this process's pids | **0** | 0 | passes |

That is the observed failure exactly, produced on demand.

**One honest caveat carried over from LA-123's filing:** a second variable was present on the run
that failed and absent on the run that did not (a `pnpm dev` server for an E2E reproduction, on a
different database on the same instance). Those two runs cannot separate the causes. The
reproduction above does not need them to — it does not rely on either run.

## The fix

A pid is one live backend, and a backend belongs to one process's pool. `acquire()` now records the
backend pid it took the lock on; the hook asks Postgres about **those pids and that key**, which
keeps the real database evidence and drops the race.

```sql
SELECT count(*)::int AS n FROM pg_locks
 WHERE locktype = 'advisory' AND objid = $1 AND pid = ANY($2::int[])
```

Two sets, not one: `heldPids` for "did we leak" and `everHeldPids` because the assertion worth
making runs *after* release — *the locks we took are gone* — which a set emptied on release could
not express. The `objid`/`classid` encoding for `pg_try_advisory_lock(bigint)` was read off a live
backend rather than off the documentation (`classid 0, objid 1710164, objsubid 1`).

**The third test was fixed in the same way for the opposite reason.** Its
`toBeGreaterThan(0)` on the same unscoped query passed as readily on a sibling's lock as on its
own — weaker than it looked rather than broken, and it would have gone the same way as the hook
the moment it mattered. It now asserts exactly one lock, at its own pid. That test is also what
keeps the helper honest about not being a no-op, which is why the hook does not need to re-prove it.

## Verification

**Mutation pass — 3 mutations, each caught by its intended assertion:**

| mutation | caught by |
|---|---|
| `release()` stops calling `pg_advisory_unlock` | `postgres still shows our key held on a connection we used` |
| `release()` stops untracking the pid | `a lock this file took was never released` |
| `acquire()` stops recording the pid | the third test's `acquire must record the backend…` |

The first two matter most together: one catches a real leaked lock, the other catches bookkeeping
that has drifted from the database. Either alone would let the other pass silently.

**Equivalent control, green (3/3):** the helper's internal variable renamed, the poll interval moved
20 ms → 25 ms, and the predicate rewritten as `pid IN (SELECT unnest($2::int[]))`. The SQL half is
the one that mattered — it shows the assertion is about the state, not about the shape of the query.

All 15 files that use the helper: **13 passed, 2 skipped**. Full suite below.

## Not exercised

Nothing user-facing is touched — this is test-support code under `__tests__/`, with no route, no
component, no migration and no shipped behaviour. No device check applies and no changelog entry is
owed.

**What this does not fix:** the other 15 files have no such hook, so a lock leaked by one of them is
still caught only indirectly, by the next file in that worker hanging. Adding the hook to all of
them is not obviously worth it — the helper is one small function and its release path is now
asserted here — and it is not filed as follow-up work, on the grounds that a defect nobody has seen
does not need a queue entry to hold its place.

<a id="2026-09-20-lane-a-la63-zero-samples-never-sufficient"></a>

# 2026-09-20 — LA-63: the E2E failure count was nine, is one, and the one was a real bug

**Branch:** `lane-a/la63-zero-samples-never-sufficient` · **Lane A** · LA-63's residue.

## Why this was picked up at all

Every one of Lane A's six READY entries is blocked on an owner answer (LA-122). LA-63 sits under
`KEEP`, which tells the lane not to look — and its residue, *"nine real failures nobody had seen"*,
is buildable work with no owner gate. That is exactly the shape OR-100 is open about.

## The count was two weeks stale

Re-measured against `main` at `562ec1f2934`, on a database built the way CI builds one — `DROP` /
`CREATE`, all 277 migrations, then `seed.sql` — rather than against the session's shared dev
database and its 36 accumulated accounts. That distinction is the entry's own warning, and it is
load-bearing here: the seed defines what a zero-data account is.

Full suite, `CI=1`: **1 failed, 1 flaky, 1 skipped, 220 passed, 34.4 min.**

Eight of the nine had been fixed by other work and nobody re-ran the count. Four of the nine specs
had been edited since the entry was written. The entry's "one shared cause across seven nutrition
specs" theory was never tested and is now unfalsifiable — recorded so it is not re-derived.

**The one hard failure was not one of the nine.** `rv38-body-battery-no-data-badge` was written
2026-09-15, eight days after the entry.

## The defect

`GET /api/body-battery` for an account that has never worn anything:

```
hasData: false, confidence: { sampleCount: 0, wakingMinutes: 47, samplesPerHour: 0, sufficient: true }
```

`sufficient: true` on zero samples. The card shows its `Limited data` badge on `!sufficient`, so the
screen read **`Good / Steady / 50`, unqualified** — RV-38's defect, verbatim.

**RV-38 was never a complete fix, and this is not a regression against it.** The grace clause landed
2026-08-26 (`10d0ef9661a`); RV-38's card fix landed 2026-09-15 (`e81bbe8662b`). So the hole was
already there when RV-38 shipped, and RV-38's Known-Issues row states the payload returns
`sufficient: false` for the zero-data account — **true for twenty-three hours of the day and false
for the first one after waking.** It was verified at a time of day where the remaining hole was
invisible. That is worth naming on its own: an hour-scoped defect passes a careful check and a
careful review, because neither knows to ask what time it was.

The card was not at fault; its RV-38 condition is intact. `batteryConfidence` was:

```ts
sufficient: mins < MIN_WAKING_MINUTES_TO_JUDGE || samplesPerHour >= MIN_SAMPLES_PER_WAKING_HOUR
```

The first clause is sound reasoning — a rate measured over twenty minutes means nothing, so hold off
the verdict. What it gets wrong is that **zero readings is not a rate waiting to settle.** It is the
same nothing at 00:20 as at 23:59, and no amount of elapsed time makes it measured. Expressing "too
early to tell" as `sufficient: true` hands the card the opposite of the truth, and it is the same
shape as RV-38 itself: **a guard that gets weaker as the data gets worse.**

```ts
sufficient: sampleCount > 0
  && (mins < MIN_WAKING_MINUTES_TO_JUDGE || samplesPerHour >= MIN_SAMPLES_PER_WAKING_HOUR)
```

Narrowed to exactly zero, so the grace window still covers the sparse-rate case it exists for.

## It was also a clock-dependent test failure

The badge was withheld for the **first hour after waking**, so the spec was red between 00:00 and
01:00 Brisbane and green the other twenty-three — the Q-356 shape CLAUDE.md names, and a plausible
member of the original nine's flakiness. The zero-data account's wake anchor defaults to local
midnight, which is what puts its grace window there.

**The fix removes the clock dependence rather than papering over it**: zero samples is now
insufficient at every hour, so the spec's answer no longer depends on when it runs. The regression
test does not wait for the window either — `is the same answer on both sides of the boundary` reads
the boundary from `MIN_WAKING_MINUTES_TO_JUDGE` and fires on every run.

## Verification

Proven on the live failing condition rather than by reasoning: the spec failed **twice** at 00:47
Brisbane and passed at 00:48 with the fix, same database, same minute band.

`body-battery-inputs.test.ts`: 16 pass (was 13).

**Mutation pass — 2 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `sampleCount > 0 &&` (revert the fix) | the two new boundary cases + the changed divide-by-zero case |
| widen it to `sampleCount > 1` | `still grants grace to a sparse rate` — and nothing else, which is the point |

**Equivalent control, green (16/16):** the condition rewritten De Morgan'd as
`!(sampleCount === 0 || (mins >= … && rate < …))`.

One existing expectation was changed deliberately: `batteryConfidence(0, 0).sufficient` was `true`
and is now `false`. Its test is named for division by zero and that half is untouched; the
`sufficient` line was incidental to it and was the only assertion anywhere holding the zero-sample
grace window in place. The change is noted in the test itself so it is not silently re-flipped.

## Blast radius

`batteryConfidence` has **one** caller (`app/api/body-battery/route.ts:327`) and `sufficient` has
**one** product consumer (`components/body-battery-card.tsx:103`). Nothing is stored — the value is
computed per request — so no day is re-scored and no migration is involved.

## Not exercised

- **CI will not run E2E on this PR.** The job's gate matches `app/`, `components/`, `e2e/` and
  `playwright.config.ts`; this diff is `packages/shared/**` only, so the browser half is skipped.
  The spec was run locally instead, inside the band that reproduces the failure. Touching an `e2e/`
  file purely to buy the run would be gaming the gate.
- **Device unexercised.** No native, offline-first, safe-area or gesture surface is touched — one
  boolean in a shared pure function.
- The **owner's own** Body Battery is unaffected in the ordinary case: they have samples. What
  changes for them is a day on which the ring reported nothing at all, which now carries the badge
  from waking rather than from an hour after it.

## Still owed, and not claimed fixed

`meal-label.spec.ts:286` flaked on the `Ingredients · centred` style and passed on retry. **Ink was
0.0802, so the canvas was painted** — a decode failure, not a render one, matching LB-38's root
cause (zxing cannot read certain valid QR symbols upright) that `decodeQrRotating` was added for and
does not fully cover. Left in LA-63's `Keep:`. Note for whoever takes it: the kept-pixels `.bin`
lands in `test-results/`, which Playwright wipes at the start of the next run, so a local repro
destroys its own evidence unless the file is copied out first.

## Two things found while gating this, both filed rather than fixed here

**LA-123 — a test file asserting a cluster-wide condition.**
`migration-test-lock.test.ts`'s `afterAll` counts advisory locks with no database, session or
process filter, while **15 sibling files** take the same key in parallel vitest workers. The first
full-suite run read `1 failed | 951 passed` against `9027 passed | 0 failed` — a file failing while
none of its tests do, which is the shape of a hook. A second run on the same tree was green. **A
second variable was present on the first run and not the second** (a `pnpm dev` server for the E2E
reproduction, on another database on the same instance), so those two runs cannot separate the
causes; the mechanism is readable in the source and does not depend on them. Filed with a proposed
patch rather than widened into this PR.

**A local-only lint trap, added to LA-77.** `pnpm lint` reported **256 errors** here and **0** once
`playwright-report/` and `test-results/` were deleted: both are gitignored but not eslint-ignored,
so the HTML reporter's bundled JavaScript gets linted. CI never sees it — Lint and E2E are separate
jobs — so it lands only on someone who runs both locally, disguised as 256 errors in their own
change. (LA-77's own figure is stale too: 290 warnings when written, 743 today.)

## Gate

| gate | result |
|---|---|
| `pnpm test` | **952 files, 9027 tests, 0 failed** |
| `pnpm check:rules` | **Ran 75 of 75** |
| `check-test-typecheck.js` | 320 errors across 90 files, **none above baseline** |
| `pnpm lint` | **0 errors**, 743 warnings (see LA-77) |
| `pnpm e2e` (full, CI-shaped DB) | 1 failed → **fixed**; 1 flaky (LB-38 decoder); 220 passed |

<a id="2026-09-20-lane-a-la74-program-write-schema"></a>

# 2026-09-20 — LA-74: the program write path is typed, and the schema is pinned to the mapper

**Branch:** `lane-a/la74-program-write-schema` · **Lane A** · fourth KEEP-mined item of the session,
after LA-63, LA-123 and LB-27.

## What it was

`POST /api/workout-templates` spread `body.program` into `repo.saveProgram`. Not mass assignment —
the repository names every column it writes — but nothing typed or bounded a value, and the two
ownership checks the route carries (`phaseSetId`, `styleId`) read as validation while covering two
fields. The style half of this pair shipped 2026-09-07; the program half sat for three weeks behind
one sentence in its sibling's header: *"Strict there needs that enumeration checked against a
device, and getting one key wrong breaks the app's core write path."*

## Both halves of that sentence were wrong, and the entry's own text says so

**The device is not required.** No native code posts to this route. The poster is the WebView, which
ships with the Railway deploy rather than with the APK — so the payload on device is byte-identical
to the payload on web. That is the same reasoning `check-strict-request-schemas.js` uses to decline
exempting this route, and the opposite of `scale-ble/samples`, whose client is Kotlin in an APK that
does not update with a deploy. LA-74 stated this; the sibling's header did not carry it across.

**And there are three producers, not two.** The entry enumerated `config-screen.tsx`'s editor and
its activate button. `workout-builder/builder-review.tsx` is a third, and it is the one that would
have broken a schema checked against only the other two: it sends `userId: ''`, sends `createdAt` /
`updatedAt` / `totalWeeks`, and omits `timeBudgetMinutes` on every session and `supersetGroup` on
every exercise. A schema derived from the `Program` type — or from two of the three call sites —
400s every program the AI builder creates.

Every field in `program-write.ts` was read off a call site, not off the type. The type is what the
producers disagree with.

## The part that needed designing, not just care

The activate button posts the whole stored row back, and that row is exactly what `listPrograms`
mapped. **So the schema is permanently coupled to that mapper**: a column added there and not here
400s activation, on a path no test of the new column would touch. Getting the enumeration right
today does not keep it right.

`program-write-covers-types.test.ts` enforces it in CI. It reads the `Program`, `ProgramSession`,
`SessionExercise`, `Schedule` and `ScheduleDay` interfaces out of the type source — the only way,
since types are erased at runtime — and asks the schema, by parsing, whether each field name
survives. One-directional on purpose: every type field must be accepted, while the schema may carry
fields the type does not, because the producers send `userId` and JSON date strings the type models
differently.

**Its first version walked Zod's `_def` chain to reach each nested shape and broke on
`z.array(...).optional()`.** A test that knows that much about a dependency's internals fails on a
version bump rather than on the drift it exists for. Feeding a key in and looking for
`unrecognized_keys` asks the only question that matters and survives the bump.

## Verification

**Live, against the real route, repository and Postgres** — not a mocked repo:

| payload | result |
|---|---|
| the real `GET` output posted back (producer 2, byte-identical to activate) | **200** |
| editor save, weekly schedule | **200** |
| editor save, rotation schedule | **200** |
| editor save, `schedule: null` (how the editor clears one) | **200** |
| builder-review payload | **200** |
| a program key no column has | **400** |

The first row is the one that matters most: it is the mapper's own output, on real rows, through the
strict schema.

**Mutation pass — 3 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `.strict()` from the program level | `a program key no column has`, and the drift guard's own self-check |
| make `timeBudgetMinutes` required | `accepts sessions without timeBudgetMinutes…` — the builder producer |
| drop `earlyDeloadWeekStart` | the **drift guard**, plus both activate cases |

The third is the one the design was for: a column only the activate path ever carries, removed from
the schema, caught by the guard rather than by a lucky fixture.

**The equivalent control failed on its first attempt, and was right to.** Rewriting
`trainingGoal: z.string().optional()` as `z.union([z.string(), z.undefined()])` is not equivalent in
Zod — the union accepts an `undefined` value but leaves the key **required**, so two producers that
omit it started failing. Redone as renames only: 139/139.

## The Custom Rules gate caught something reading alone did not

`pnpm check:rules` failed on **"Numeric validators carry an upper bound"** (Q-164): seven numeric
fields had a `.min()` and no `.max()`. Every one now carries a named constant, and the comment above
them says what they are — a refusal of nonsense, never a product limit. A bound that could reject a
row already in the database would 400 the activate of a program that was fine yesterday, which is
the exact failure this schema exists to prevent, so each sits orders of magnitude above anything a
producer builds. Re-verified afterwards: all five stored programs round-trip at 200.

One wrinkle worth recording because it will catch the next person: the rule matches **text**, so the
comment introducing those bounds tripped it by naming the validator literally. The comment now says
so in place.

## One test fixture was changed, deliberately

`progression-style-write-schema.test.ts` called itself *"a tripwire for whoever does add that
schema"*, and it fired: all three of its program cases went red. **What they caught was the fixture,
not the schema.** Its `SESSION.exercises[0]` was `{ id, name, sets, styleId }`; a `SessionExercise`
has `exerciseName` and no `sets` at all, and both real producers send `exerciseName`. It was never
wrong in a way anything could notice, because its assertions are about passthrough, which a nonsense
key satisfies as well as a real one. Corrected once, with the reason recorded in the file so it is
not read later as the schema being loosened to fit a test.

## Not exercised

- **The editor UI was not driven end to end.** Reaching its save goes through a Review step that
  needs a Gemini key the sandbox does not have, and the click path dead-ends on *Try again /
  Close*. Producers 1 and 3 were verified by posting their transcribed payloads to the live route,
  repo and database — the real server path with the real shapes — but not by pressing the real
  button. Producer 2 **was** verified against real data, via the GET round-trip.
- **No device run**, and per the reasoning above none is needed for this route specifically. That
  argument is about which client posts here; it is not a general licence.
- **The residual risk is a producer I did not find.** Five POST/DELETE call sites were enumerated by
  grep and four POST shapes verified; if a sixth exists outside `app/`, `components/` and
  `packages/`, it is unguarded by everything above. The drift guard covers type drift, not a new
  caller.

<a id="2026-09-20-lane-a-lb27-refuted"></a>

# 2026-09-20 — LB-27: the hang has no mechanism and does not reproduce

**Branch:** `lane-a/lb27-refuted` · **Lane A** · docs-only. Third KEEP-mined item of the session,
after LA-63 and LA-123.

## What the entry said

Health's launch fires ~25 API requests in seven seconds. Adding one more — a
`PATCH /api/user/preferences` from a card's mount effect — left that PATCH **and a `GET` behind it
pending past sixty seconds**. Measured 2026-08-30 with Playwright's `requestfinished`, so genuinely
unresolved rather than slow.

Its hypothesis, and the whole of its `Keep:`:

> the pool is `max: 10` with `pg`'s default `connectionTimeoutMillis: 0`, which waits **forever**
> for a client rather than erroring

## That was never true in this repository

`lib/data/postgres/client.ts` sets **`connectionTimeoutMillis: 5_000`**, and `git log -S` over the
full history dates it to `6c072f9bfca`, *TrainingAI — initial public snapshot*, **2026-08-16** —
two weeks **before** LB-27 was filed. The `Keep:` asked for a decision that had already been made
before the entry existed.

(That the premise was stale was already known: **PS-38** has carried *"strike LB-27's
already-decided Keep"* since 2026-09-06, unactioned. What is new here is that it is not merely
stale — it is refuted, which is what retires the entry rather than one line of it.)

**And the mechanism is impossible for a different reason as well, which the entry could not have
seen while it was looking at the wrong number.** `statement_timeout` and
`idle_in_transaction_session_timeout` are both `15_000`. So a pool wait errors at 5 s, a running
query is killed at 15 s, and a transaction left open is reaped at 15 s. **Nothing in this pool can
produce a request pending past sixty seconds.** Whatever stranded those requests, it was not the
database layer.

## Measured, not merely argued

Re-run on current `main` against a CI-shaped database, instrumented the same way (`requestfinished`,
so a strand is distinguishable from a slow response), with a **75-second** observation window —
anything shorter measures route compilation rather than stranding, which is the mistake the first
attempt at this made.

| | in-burst PATCH | settled PATCH | API requests | Postgres peak |
|---|---|---|---|---|
| warm server | **200 in 771 ms** | 200 in 378 ms | 38 started, 37 finished | — |
| **cold server** (`.next` deleted) | **200 in 1741 ms** | 200 in 380 ms | 38 started, 37 finished | **1 active, 0 idle-in-transaction, 13 total** |

Sampled `pg_stat_activity` every 2 s throughout the cold run: the pool never came close to
saturation and never held a transaction open.

The one request that reads as unfinished in both runs is the instrumented PATCH itself — the same
URL and method as the control, so the two collide on the event key. It returned **200**, with a
measured duration, in both runs. It is a defect in my probe, not a strand, and it is stated here
rather than left to look like a surviving symptom.

## What still stands, so it is not lost

**The `FOR UPDATE` claim is correct.** `updateUserPreferences` (`adapter.ts:3077`) really does open a
transaction, take `.for('update')` on the `users` row and hold a pool client for the merge. That is
deliberate and documented — two devices on one account, and an unlocked read-modify-write drops
whichever key loses. Nothing here argues against it; it simply is not the cause of a sixty-second
hang, because it cannot outlive a 15-second reaper.

**The nine `networkidle` e2e failures the entry pointed at are also gone** — LA-63's full-suite
measurement the same day read 1 failed, 1 flaky, 220 passed, and none of it is `networkidle`.

## Why the entry is removed rather than re-scoped

The entry's own instruction was: *"Not reproduced in production, and it may be dev-server-specific
(route compilation under concurrency). Establish that first: it changes whether this is a bug or a
harness note."* That is now established — it does not reproduce on the one environment where it was
ever seen, cold or warm, on current `main`, and its named mechanism is ruled out by configuration.
Nothing is owed, so it does not sit in the queue.

## Not exercised — the honest limits of the refutation

- **The trigger is not byte-identical to the original.** The original PATCH came from a card's mount
  effect; mine is a `fetch` from `page.evaluate` immediately after `goto`. Same burst, same route,
  same method, but not the same call site.
- **Dev server only, as the original was.** No device run, and production was never affected (the
  entry says so itself).
- **Three weeks of unrelated change sit between the two measurements.** A non-reproduction today
  does not prove the 2026-08-30 observation was wrong — it proves there is nothing left to fix.

If a launch-time hang is ever seen again, it should be filed fresh from its own measurement rather
than reopened against this hypothesis, which is the part that has been disproved.

<a id="2026-09-20-lane-a-tn51-ambient-keeps-rr"></a>

# 2026-09-20 — TN-51: ambient wear kept one beat in thirty, so rMSSD was undefined

**Branch:** `lane-a/tn51-ambient-keeps-rr` · **Lane A** · seventh item of the session, straight after
TN-54 un-blocked the same device.

## What was wrong

`PolarStrapService` is built for all-day wear and runs overnight — its own header says so — and
`ambient` defaults to `true`. So a night in the strap goes through `thinAmbient()`, which kept one
buffered sample per `AMBIENT_GAP_MS` (30 s) and **dropped the rest whole, each discarded sample
carrying its own `rr` list.**

Confirmed live in production 2026-09-20 06:03–06:05 Brisbane: consecutive stored RR rows sat
**30.2 s, 30.2 s and 30.7 s apart** — `AMBIENT_GAP_MS` exactly — with **one RR interval per kept
sample**.

**That does not degrade rMSSD, it makes it undefined.** rMSSD is the root-mean-square of differences
between *adjacent* intervals; one interval every 30 s yields no adjacent pair at all. Which is why
this blocked PS-44's HRV comparison rather than merely weakening it: a disagreement measured that
way could not distinguish "the ring is drifting" from "the two devices sampled differently", and
that distinction is the entire question.

## What shipped — option (1), the entry's own preference

**Thin the HR samples; keep every RR interval.** The thinning is not the bug and is not removed —
it exists so all-day 1 Hz does not bloat `oura_heartrate`, and `rr_intervals` already spans 60 days
at 23 MB. What changed is that the dropped samples' beats ride forward onto the next kept sample.

**This is not an approximation.** `/api/hr-ingest` walks a sample's `rr` list *backwards* from
`sample.at`, subtracting each interval, so a kept sample carrying the whole window's beats lands
them across the window they actually occurred in. A test asserts that explicitly: 30 intervals of
1000 ms on one sample walk back ~29 s, they do not pile up on the timestamp.

**The server cap had to move with it.** `rr` was capped at 16 per sample; a 30-second carry holds
~30 beats at rest and ~100 at 200 bpm, so 16 would have rejected the very payload that fixes the
bug — and the client swallows a 400 and drops the batch, which is the same silent loss wearing a
different hat. Now 100, with the reasoning in place: **it is not the DoS bound and never was.**
`readJsonLimited` rejects at 512 KB before parsing, so total work is bounded by the body however it
is divided. A window above the cap **splits** into several samples rather than truncating.

## The part worth copying

The logic lives in **`PolarAmbientThinner`**, a pure object extracted from the service, with eight
unit tests — because this is the half no device check could isolate. A night of wear that produced
good data would not tell you whether the thinning or the mode was responsible.

The test that matters most is not "thinning happens" (it did before) but **no interval is lost**:
60 seconds of 1 Hz beats thin to 2 HR samples and must still carry 60 intervals.

One case the extraction surfaced that the old code would have kept losing: **a carry stranded by a
flush boundary.** The buffer flushes on a count threshold and on a timer, neither aligned to 30 s,
so a flush that keeps *nothing* is ordinary rather than exotic — and those beats would have been
dropped exactly as before. The pending carry therefore lives in the returned state, and a test
walks three flushes to prove it survives.

Two caps in two languages will drift, so a test reads the Kotlin constant and the route constant
and asserts they match. Nothing else compares them, and they sit in different toolchains.

## Verification

- **Server half:** 5 tests — the 30-interval accept, the backwards placement, the cap boundary both
  sides, and the cross-language guard.
- **Native half:** 8 Kotlin unit tests, run by CI's `Android (Kotlin tests + debug APK)` job —
  **green on the second push** (`7a534349444`), 80 tests completed, 0 failed. The first push
  went red on four of these; see below.
- Full suite, `pnpm check:rules`, lint and typecheck below.

## CI caught four of my own tests, and the cause was worth the round trip

The first push went red on `Android (Kotlin tests + debug APK)`: **80 tests completed, 4 failed** —
all four mine, the 76 existing ones green. The required checks were all passing, so merging on those
alone would have shipped it.

The cause was one line. `lastSentAt == 0L` was the "nothing sent yet" sentinel, and my fixtures use
`at = 0` as a real timestamp — so keeping the first sample set `lastSentAt = 0`, the sentinel fired
again on the next sample, and **every sample was kept**: the thinning silently stopped.

**That is a real collision in code I was already touching, not a bad fixture.** It is unreachable in
production because `at` is `System.currentTimeMillis()`, which is exactly why it survived — and why
it only appeared once the logic became testable. So the fix is `Long?` with `null` meaning nothing
sent, which cannot be confused with a timestamp, rather than changing the fixtures to dodge it.
Production behaviour is identical; one test now pins the collision directly so it cannot come back.

The service's own field moved to `Long?` with it, including the `setAmbient` reset that used `0L`
to mean "keep the next sample".

**Stated plainly: the re-verification after that fix was done by reading, not by running.** Gradle
cannot resolve the Android plugin here, so all eight cases were traced by hand against the corrected
loop. CI is the executor — and it since confirmed the reading: the Android job on `7a534349444`
completed 80 tests with 0 failures. The tracing was right, but it was not what made it true.

## Not exercised

- **Gradle cannot run here** — confirmed, not assumed: `./gradlew testDebugUnitTest --offline`
  fails to resolve `com.android.tools.build:gradle`, `google-services` and the Kotlin plugin,
  exactly as CLAUDE.md describes. So the Kotlin tests were **written but not run locally**; CI's
  Android job is what executes them, and **it is not a required check** — its conclusion has to be
  read deliberately, because six green required checks say nothing about it.
- **No strap, no night.** The entry's own pass test — a contiguous beat-to-beat series over the core
  sleep window, with `rmssdFromRr` comparable to the ring's figure — is owed and is in the `Keep:`.
  The logic is covered; the radio is not.
- **This needs a new APK.** Unlike the server half, `android/**` does not reach the device through a
  Railway deploy.
- **Two unverified native changes now stack.** TN-54 merged earlier in this same session and is also
  awaiting a device check. Both touch `PolarStrapService`, and the next night of wear exercises both at once — worth
  knowing when reading the result, because a bad night would not say which one.

<a id="2026-09-20-lane-a-tn53-hrr-separation-gate"></a>

# 2026-09-20 — TN-53 engine: HRR-60 now has to be a 60-second measurement

**Branch:** `lane-a/tn53-hrr-density-gate` · **Lane A** · Tuning filed it, Lane A implemented the
engine half. **The render half is Lane B and is NOT done** — see the Keep on the entry.

## The defect

`hrr1` means "the drop 60 s after the set". Nothing checked that the two readings it differences
were 60 s apart — only that each sat near its own target. `/api/health/trends` recomputes it live
from a raw `getHrForWindow` with no gate at all, while its sibling `exercise-hr-trend.ts` filters
every metric mean on `coverageOk`.

## What the entry got wrong, and why the fix is better for it

TN-53 quoted `nearestBpm(readings, target, windowMs = 90_000)` as applying to **both terms**. The
second term uses **45_000** (`hr-analysis.ts:73`). Re-deriving from the real code:

- `bpmAtLog` ∈ `log ± 90 s`
- `bpm60` ∈ `log + 60 s ± 45 s`
- so the pair spans **−75 s to +195 s**

That is *wider* than the entry's "150 s apart", and it includes the case that makes it obviously
wrong rather than merely imprecise: **one reading can satisfy both terms**, producing a drop of 0 —
a fabricated "no recovery" — from a single data point.

## Implemented as a separation check, not the proposed reading-count gate

The entry's first action was "require a minimum reading density in the window". The defect it
*names* is that the two readings are not checked to be 60 s apart. Those are not the same thing: a
count both over-rejects (a sparse set whose two readings happen to straddle 60 s genuinely can
measure HRR) and under-rejects (a dense set whose readings cluster on one side cannot). The gate is
therefore on the measurement — 45–75 s, ±15 s of the nominal 60 — with the constants exported so
the tests assert the boundary from them rather than restating it.

The density numbers are the *reason* the gate is needed, not the gate itself.

## The density claim reproduced exactly

Production, 2026-09-20, `set_hr_stats`:

| source | sets | `coverage_ok` | readings/set |
|---|---:|---:|---:|
| chest_strap | 220 | 91.4% | **111.8** |
| `ble` (ring) | 79 | 54.4% | **7.1** |
| NULL | 615 | 22.9% | 17.0 |
| mixed | 4 | 75.0% | 9.8 |

The 4-row `mixed` bucket was not in the entry. Everything else matches to the decimal.

## Where the gate went

Inside `analyseHrRecovery` — the single HRR formula — rather than in the route. All four `hrr1`
consumers (`oura/hr-data`, `health/trends`, `hr-recovery-by-exercise`, `progress-markers`) already
treat null as unknown, and `exercise-hr-trend.ts` does not read `hrr1` at all, so the already-gated
sibling is untouched. One formula, one place.

`peakBpm` and `bpmAtLog` still report when the HRR is refused: the gate is on the 60-second drop
only, and those two are measured rather than inferred.

## Verification

`packages/shared/src/workout/__tests__/tn53-hrr-separation-gate.test.ts`, 7 cases.

**Mutations:**

| mutation | result |
|---|---|
| gate removed (pre-TN-53 behaviour) | **5 of 7 fail** |
| **control — gate rejects everything** | **2 fail**, exactly the accept-cases |

The second is the one worth having. A gate that returns null unconditionally would satisfy every
"refuses" test; the dense-chest-strap case and the both-bounds case are what stop that passing.

**Equivalent control:** reordering the `&&` terms — green. **Neighbours:** all 115 HR/health test
files pass unchanged, 1248 tests.

## Not exercised

- **No browser or device check.** The engine emits nulls; how the sparkline *draws* a null run is
  unverified and is the Lane B half. A gap that renders as a broken chart is not an improvement
  over a wrong number, which is why that is written as a Keep rather than left implied.
- The owner's stated pass test — the sparkline showing a gap across the strap-dark period — is
  **unverified**.

<a id="2026-09-20-lane-a-tn54-strap-status"></a>

# 2026-09-20 — TN-54: the strap kept its own diagnosis in memory

**Branch:** `lane-a/tn54-strap-status` · **Lane A** · sixth item of the session, and the first from
READY rather than KEEP — TN-54 was filed at 20:23 and un-gated by #1353 twenty minutes later.

## What was wrong

The owner wore the strap overnight and asked whether it recorded what was needed. It had not, and
neither he nor the session could say why.

Measured: across `rr_intervals` **and** `oura_heartrate` the last chest-strap sample of any kind was
**2026-09-15 23:11 UTC** — five days, both tables, zero rows. The same night the ring wrote **455 HR
samples** through the same phone, app, network and `/api/hr-ingest`, so the ingest path was healthy
and only the strap contributed nothing.

**And nothing server-side recorded why.** `PolarStrapService` knew the whole story and kept it in
memory: `battery` is a `private var` written once per connection, the give-up path (`stopSelf()`
after six consecutive failures) logs *"strap not reachable"* to `onLog`, and `status()` — which
already carries state, battery, failure count and contact — goes to the **Capacitor event sink**.
That is the WebView, live. So a strap that died, ran flat, or never connected was indistinguishable
from one that was not worn, from every surface except having the app open at the moment it happened.

Ring battery readings persisted: **11,758**. Strap: **0**.

## What shipped

**Migration 278, `strap_status`** — one row per connection attempt or state change, shaped on
`oura_ble_battery_poll` (the reason the ring's 11,758 exist). `recorded_at` is server-stamped
because every row describes a state the service is in as it posts; **`last_sample_at` is the
exception** and comes from the device, because it is the figure that answers *did last night count*.

`state` is text, not an enum. The states belong to the service, and a state the table cannot
describe is exactly the failure it exists to catch.

**`POST`/`GET /api/strap-status`** — session-authenticated, matching `/api/hr-ingest`, which is the
path the strap's own poster already uses. Deliberately **not** admin-gated like
`oura-ble/battery-poll`: a status this route rejects is a status nobody ever sees, which is the
defect. `.strict()` Zod, structural bounds on the timestamp (the `hr-ingest` lesson — an unbounded
epoch makes `new Date()` Invalid and 500s the driver).

**`PolarStrapService` posts its own status.** Hooked to `emitStatus()` rather than to individual
call sites, because every transition worth recording already calls it — connect, ready, failure,
battery, give-up, and the final `onDestroy` — and a new transition that forgets to post is the
failure mode this removes. It is **not** on the sample path, so it cannot become per-beat traffic.
Posts on a change of the fields that explain reachability, plus a 15-minute heartbeat so hours of
healthy connection read as evidence rather than as silence.

## The part that needed more than plumbing

The give-up is the one event that must reach the server, and it runs `stopSelf()` → `onDestroy()` →
**`ingest.shutdownNow()`**, which cancels queued tasks that have not started. The final status and
the final flush are queued three lines above it. So the most important row was the one most likely
to be thrown away.

`onDestroy` now drains gracefully with a bounded 3-second wait before falling back to
`shutdownNow()`. Bounded, so a wedged POST cannot hold the service open.

## Verification

**Live against the real route, repository and Postgres** — not mocks:

| | result |
|---|---|
| before any post: has this device ever reported? | **`latest: null`** |
| give-up (state, battery, last sample, 6 failures) | **200**, row stored |
| minimal status — state only | **200** |
| a key no column has | **400** |
| battery 140 | **400** |

**Mutation pass — 3 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `.strict()` from the body schema | `refuses a key no column has` |
| drop `lastSampleAt` on the write path | `stores the give-up the service used to only log` |
| `getLatestStrapStatus` returns the oldest row | `returns the newest row, not the first` |

The third matters most: a stale `connected` is precisely the reading that reassured the owner on
2026-09-19, so a "latest" that is not the latest reproduces the bug inside the fix.

**Equivalent control, green 13/13:** the parsed binding renamed throughout the route.

`Ran 75 of 75` custom rules — after two the gate caught and I fixed: a zero-argument `vi.fn` with
indexed calls (LB-62, would have failed the Build job's typecheck after merge), and the backlog's
next-free-migration pointer, which I had not advanced.

## CI caught two things the local suite could not — and one of them is a documented claim being wrong

`Tests` went red on a branch whose local suite read 956 files / 9061 tests / 0 failed:

- `db-snapshot-integration.test.ts` — *"Snapshot drift: table strap_status has no claude_ro view"*
- `claude-ro-readonly-role.test.ts` — *"expected 96 to be 97"*

`claude_ro` is default-deny, so a NEW table is unreadable through `/api/admin/db-query` until the
views are rebuilt. Migration **279** is the regenerated twin; diffed against 277 it adds exactly one
view and nothing else, and the owner's id appears **zero** times (Q-456).

**The interesting half is why the local suite missed it.** Migration 277's header — and the Lane A
routine — say these two tests *"skip locally even with a DATABASE_URL, because local dev creates no
`claude_readonly` role"*, i.e. that CI is structurally the only place they can fire. **That is
wrong.** `claude-ro-readonly-role.test.ts` provisions the role itself. What it needs is a **TCP**
`DATABASE_URL`: it reconnects as `claude_readonly` by rewriting the URL's credentials, and on the
Unix-socket URL `scripts/local-db/setup.sh` writes, that rewrite silently reconnects as the
superuser — so the file skips loudly instead of reporting twenty false failures. Its own header
says so, and nobody had read it against the claim.

Measured, with 279 applied: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/…'` →
**2 files, 27 tests, all passed, none skipped.** So this class IS catchable before pushing, one URL
form away. Written into CLAUDE.md as a rule for the next migration that adds a table or column,
because the belief that it was CI-only is what made a red run feel unavoidable.

## Not exercised — and one of these is load-bearing

- **The Kotlin COMPILES, and I was wrong to say CI could not check it.** I claimed CI has no
  Kotlin step; it has an `Android (Kotlin tests + debug APK)` job, it ran on this PR and it
  **passed**, so the native half builds and its unit tests are green. What is still unexercised is
  the only thing that matters here: **no part of it has RUN against a strap.** The `onDestroy`
  drain in particular is the piece I am least willing to call proven — compiling proves the
  executor call is well-formed, not that the give-up row survives a real `stopSelf()`. The device
  check is owed and is in the entry's `Keep:`.
- **Nothing renders this yet.** The Devices screen still shows *"Connected"* with no battery figure
  and no last-sample time — the surface that actively reassured the owner. That is the Lane B half
  and it is what makes this visible to a human; until it lands, the data exists and nobody sees it.
- **No changelog entry or version bump**, deliberately: nothing here is user-visible yet. A
  changelog line would describe a screen that does not exist.

## What this does NOT fix, stated plainly

The service still stops itself after six failures and nothing restarts it until the app is
launched. **Recording that is not fixing it.** What changes is that the next five-day gap is visible
the next morning instead of never — which is what PS-44's seven-night window actually needs, since
it must not count a night until the night is in the table.

The entry also carries a finding worth not re-litigating: **an accurate battery percentage is not
achievable.** The H10 runs a CR2025 with a near-flat discharge curve, and the service's own comment
already says a dying cell presents as flaky connections long before it presents as a dead strap. A
constant 100% is the cell behaving normally. `last_sample_at` and connection reliability move days
before the percentage does, which is why they are what this table records.

<a id="2026-09-20-review-agent-sweep-51"></a>

# Review sweep 51 — efficiency: logic over AI, faster paint, faster save, better feel

**Branch:** `review/sweep-51-efficiency` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-20-sweep-51-efficiency.md`](../reviews/2026-09-20-sweep-51-efficiency.md).
**Filed:** RV-64 … RV-83 (20 entries, three batches).

The owner asked for a full efficiency review across four lenses: use logic where possible rather
than AI, speed up caching and saving, prioritise app efficiency, and use animation/UI to improve
look and feel. Four read-only lanes, with every load-bearing claim re-verified at source or against
production before filing.

## The AI question needed reframing before it could be answered

**49 LLM calls in 14 days** (`ai_call_log`, owner's rows) — about 3.5 a day across 12 sections, zero
failures. Cost is not the argument here, and a list ranked by spend would have been a list of things
not worth doing. What is left, ranked by what removing the model actually buys:

**RV-65** — the prescription prompt tells the model to pick numbers and, in the same paragraph, that
a deterministic layer will overwrite them: *"do NOT pre-emptively lower pct… a deterministic
autoregulation layer applies those cuts after you."* After the call, reps and sets are replaced
wholesale, accessory pct is recomputed from target RPE, sets are refit to the time budget, phase is
overridden on `stay`, and confidence is replaced by the engine score. The deload path already builds
a complete prescription with no model call. **But the entry does not ask for the model to be
removed** — only the reconciled prescription is stored, so nobody can say how far the model's
numbers sat from what the guards would have produced. Ship the raw-vs-final capture first; the two
possible answers point at different work. That is BF-110's lesson applied before rather than after.

**RV-66** — `calculateBaseline` computes calories, protein, fat, water and steps deterministically,
and the route then asks a model for its own versions. Probing the shipped clamp: against a computed
1,942 kcal the model may return anything in a **545 kcal band**, and whatever it returns is shown to
the user and written into their targets on Apply. That breaks one CLAUDE.md rule twice —
no LLM number may gate an action *or* be shown as fact. `recommendedCarbsG` is requested and then
discarded unconditionally.

An early framing of mine — "the prescription's 2.2s blocks every workout open" — was **wrong and is
not filed**: that path already has a dedup cache, a 30s cooldown, a once-per-episode guard, a rate
limit and a 1–7 day TTL.

## The biggest efficiency defect is not an AI one

**RV-64.** `/api/hr-profile` computes three numbers — two order statistics and a mean — by pulling
every heart-rate row in a 90-day window into JS and sorting the array. Measured in production:
**128,734 rows**. The same answer as a server-side aggregate is **one row in 54 ms**.

What makes it bite is where it is called. `LiveHrChart` fetches it in a mount-once effect and is
mounted only while resting, so it **remounts once per rest period** — roughly twenty full scans
during a 5×4 workout, on the same 10-connection pool as `log-exercise` and `complete-workout`, with
a 20/60s rate limit the chart can trip on itself. `cardio-week` (RV-73) then pulls the same window
twice more.

**RV-67** is the one a reader would never find: a comment at `health-content.tsx:338` states that
*"cachedFetch… honours its TTL, so re-firing a group on a tab revisit is a cache hit rather than a
request."* The TTL gate is opt-in (`if (freshWithinTtl)`), and counted across the app: **191 cached
read sites, 8 with the flag**. So Health re-fires 8–10 requests on every tab entry believing they
are free. The entry deliberately does not prescribe bulk-applying the flag — each key needs a
written invalidation proof first, and that proof *is* the work.

## Feel: mature layer, coverage gaps — and two corrections

Two things I reported mid-sweep were **wrong**. Reduced motion *is* handled globally
(`MotionConfig reducedMotion="user"`); my count missed the provider. And every bare `pb-safe` is
page-level scroll padding, which the rule permits — **no safe-area violation exists**.

The real gaps: the shared `Button` has `transition-all` and **zero `active:` states** while 45 files
hand-roll `active:scale`, so the most-tapped control in a touch-only app has no press feedback — and
Android WebView `hover:` can stick after a tap (RV-71). About ten progress bars animate `width`, a
layout property that reflows siblings, where `scaleX` composites; 26 more snap (RV-72). The health
hero's number counts up while its ring snaps (RV-74). Sheets open in 500 ms against the app's own
deliberately-tuned 180 ms tabs (RV-75). All four batch as `motion-polish` — batched on the device,
which is the scarce resource, not on CI.

## The runtime lane reported last and found the cheapest fix in the sweep

`computeMovedHours` constructs a `new Intl.DateTimeFormat(...)` **inside** its per-row loop with
loop-invariant options. Reproduced independently at **228.8 ms → 21.9 ms (10.4×)** on a real
2,831-row day; production HR volume peaks at **5,606 rows/day** and the path is warmed on every app
launch at a 5-minute TTL. Two lines, no behaviour change (RV-80). The contrast is what makes it a
finding: `formatInTimeZone` in a loop at 18 other sites costs ~11 µs a call because `date-fns-tz`
caches internally — **those 18 are not worth touching.**

Also RV-81 (the program editor renders the 156-row catalogue once per exercise row — 3,900 `<option>`
elements — and rebuilds them on every keystroke), RV-82 (two routes fetch the active program twice
per request), RV-83 (three sequential writes on a GET).

**One measured finding was deliberately not filed.** `/api/sync/pull` runs 26 statements every 5
minutes even when empty, and a watermark column would make it ~2 — but every table it touches is in
the hundreds of rows, and a watermark is a new write-path invariant every mutation must maintain.
Same for the missing `(user_id, updated_at)` indexes: the repo already dropped
`oura_heartrate_user_updated` in migration 249 after measuring **21 MB at `idx_scan` 0**. Filing
either would have been a web-scale fix for a single-user app.

## Clean, verified, do not re-sweep

Instant-paint seeding is complete but for one card. The fetch-once ratchet's "CAN BITE" group is
empty. Screen-level parallelism is already deliberate. `complete-workout` and `mood-checkin-sheet`
are the reference save paths and both hold up. No TTL divergence, no N+1 in the data layer, no new
dependency needed for anything proposed.

## Not established

Nothing device-verified — `getLocalStore()` is null off the APK, so every offline-first write path
was read rather than exercised, and RV-68 rests on source ordering plus the repo's own recorded
measurement of the identical shape. `claude_ro` is owner-scoped, so 128,734 rows and 49 AI calls are
both floors. No route was timed end-to-end. No token counts, so every AI cost statement is
call-count based. `app/api/coach` was outside the reviewed surface.

<a id="2026-09-20-rule-2-yield-and-the-bottleneck"></a>

# Two negative results, and the one piece of infrastructure that matters

**Tuning agent · 2026-09-20 · branch `tuning/tn52-rule2-yield-and-the-real-bottleneck` · docs-only**

Owner: *"what else can be done on the tuning front?"* The honest answer is less than it looks, and the
useful part is naming why.

## Rule 2 re-screened the known thresholds and found nothing new

TN-52's rule 2 — refuse a window narrower than ~2× the signal's own sd — looked like it should find
more, because the 2026-08-25 threshold sweep names this exact blind spot: it is *"blind to a score
that moves normally and is compared against the wrong number."* Re-screening its 27 decision
thresholds by width-vs-noise instead of coverage:

| threshold | window | input sd | width | verdict |
|---|---|---:|---:|---|
| `HR_REST_THRESHOLD` | ~6 bpm | 3.15 bpm | **1.9 sd** | too narrow — TN-2 |
| `ILLNESS_WATCH → ELEVATED` | 25 pts | 9.96 | **2.5 sd** | clean |
| `FEVER_TEMP_Z` | unreachable | — | — | broken input, not width — Q-506 |
| `ACWR_TAPER_START` | never reached | — | — | already filed inert |
| `chronic_stress_score` | — | NULL 75/75 | — | already filed, Q-525 |

One confirmation, no new finding. **That it discriminates is the point** — the illness bands pass at
2.5 sd while the charge window fails at 1.9 — so rule 2 earns its place as a guard on *new*
thresholds and not as a sweep. The entry says so, to stop the next session repeating it.

## The bottleneck is one endpoint, not more measurement

The August sweep listed **25 thresholds it could not measure at all**: 19 sleep-staging constants in
one file, plus `APNEA_THRESHOLD`, `MET_ACTIVE_THRESHOLD`, `RANGE_THRESHOLD`, `NIGHT_BAND_*`,
`CONSISTENCY_*` and `LOW_CONFIDENCE_THRESHOLD`. Their inputs are per-sample intermediates that are
never persisted. That is the largest unexamined block on the scoring surface, and it feeds the sleep
score — readiness's heaviest contributor at 16%.

They are blocked on precisely what TN-2's offset fit and TN-3a/TN-4's stress term are blocked on: a
context that can run the pipeline with the daytime-stress constants present. **One admin-gated,
owner-triggered replay endpoint unlocks three items at once.** TN-2 already sketches it and explicitly
leaves it unscoped. It is Lane A work; Tuning's contribution is the list of what it must expose.

TN-52's rule 1 removes TN-2's *own* need for that endpoint — a quantile has no offset to fit — but not
the other two, so it is still worth building.

## Also confirmed, not re-found

The owner's training is invariant: **5 sessions a week, 50 of 50 completed, ten weeks straight.** Every
signal keyed to frequency variation has almost nothing to work with, which is why `ACWR_TAPER_START`
has never been reached. Already filed.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no UI.
Row-scoped to the owner.

<a id="2026-09-20-size-the-window-not-the-drug"></a>

# Size the window, not the drug

**Tuning agent · 2026-09-20 · branch `tuning/tn52-correct-the-shift-and-size-windows` · docs-only**

The owner: *"How can we make the tuning dynamic so it works on reta and off reta?"* Answering it
meant correcting the premise first, and the correction is the useful part.

## The physiology moved much less than this agent reported

*"Resting HR +13 bpm, HRV down two thirds"* was repeated several times this week — in TN-46, in PS-44,
in three PR bodies, and in a suggestion that the owner raise it with whoever prescribes for him. It
described **2026-09-16/17 alone**. Window means, 28 pre-dose nights against 14 on the drug:

| | pre-dose | on reta | change |
|---|---:|---:|---|
| resting HR | 52.3 | 56.2 | **+3.9 bpm** |
| HRV | 58.8 ms | 44.6 ms | **−14.2 ms (−24%)** |

The 65 bpm and 19 ms readings were a two-day excursion; both have returned. The real sustained change
is about **a quarter** of what was reported. It is still a genuine shift — +3.9 bpm is 1.2× his own
pre-drug nightly sd — but the inflated version reached him attached to a medical suggestion, which is
the part that mattered to get right.

## Which makes the design answer better, not worse

Measured over 59 pre-drug nights: his nightly resting-HR **sd is 3.15 bpm**, mean night-to-night
change **2.40 bpm**. The Body Battery's charge window is **~6 bpm — 1.9 sd**. The sustained shift is
**1.2 sd**.

**A 1.2 sd shift closed a 1.9 sd window.** It did not need to be a big shift, and illness, a bad
sleep week, detraining or altitude would all have done the same. So "on reta / off reta" is the wrong
axis: the app is not fragile because the owner changed, it is fragile because its windows are narrower
than his ordinary noise.

The same shape has now appeared four times — TN-2's charge window, Q-506's fever threshold, TN-47's
±1.5σ rails, TN-46's circular check-in — and **three of the four had no medication involved when they
broke.**

## Filed as TN-52, three rules

1. **Define a threshold as a quantile of the quantity it gates**, not an offset or a fraction of a
   reserve. *"Below your own 10th-percentile waking HR over 28 days"* cannot close, by construction,
   follows any regime with no flag, and **needs no fit** — which also removes what TN-2 is currently
   blocked on, since its fitted offset needs constants that do not exist outside the Railway runtime.
2. **Size every window in units of the user's own sd and refuse one narrower than ~2 sd.** Arithmetic,
   not judgement. The rule worth writing down even if nothing else is built.
3. **Detect regime changes, not medications.** A changepoint on the baseline is general; the
   medication table then *labels* a regime rather than driving the maths.

With a guard against sweeping: max HR from a maximal test, a fever temperature and anything with an
external clinical meaning must stay absolute, because a quantile of your own distribution can only
say *"unusual for you"*, never *"abnormal for a human"*.

## Rule 1 backtested, and it corrected this entry too

The quantile was not left as an assertion. Backtested time-weighted over the same three regimes
(weighting each sample by its gap to the next, because the ring power-gates its PPG):

| | Jun30–Aug19 | Aug20–Sep06 | Sep07–20 |
|---|---:|---:|---:|
| time-weighted p10 of waking HR | **61 bpm** | **61 bpm** | **62 bpm** |
| % waking time under the shipped threshold | **20.43%** | **3.34%** | **2.03%** |
| % waking time under a fixed 61 bpm | **10.41%** | **13.23%** | **7.54%** |

A 61 bpm anchor keeps 7.5–13% of waking time chargeable throughout, where the shipped threshold
collapsed 10×.

**And it corrected the entry's own framing.** The per-sample p10 reads 69/68/72 bpm — 7–10 bpm above
the time-weighted 61/61/62 — and supports a *"the quantile follows him onto and off the drug"* story
that the correct measurement does not. The quantile is **stable** across regimes, not tracking. That
is the better property: it stays put while the broken threshold drifted 7 bpm the wrong way, and
stability is exactly what removes the need to refit.

This is TN-2's own per-sample-vs-time-weighted warning biting a third time in two days. It is now the
first thing in the Tuning baton's Method section.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no UI.
Row-scoped to the owner. The physiological figures are window means over ring data, not a clinical
measurement.

<a id="2026-09-20-the-strap-is-dark"></a>

# The strap is dark, and nothing says so

**Tuning agent · 2026-09-20 · branch `tuning/tn54-strap-silent-with-no-trace` · docs-only**

The owner wore the chest strap overnight and asked whether it captured what PS-44 needs. It did not —
and the finding is that neither of us could tell why.

## What the data says

Across `rr_intervals` **and** `oura_heartrate`, the last chest-strap sample of any kind is
**2026-09-15 23:11 UTC — 09:11 Brisbane on the 16th.** Five days, both tables, zero rows.

**The ingest path is healthy.** The same night the ring wrote **455 HR samples, 104 of them in core
sleep**. Phone, app, network and `/api/hr-ingest` all worked. Only the strap contributed nothing.

## The gap worth fixing

| | ring | chest strap |
|---|---:|---|
| battery readings persisted | **11,758** (today, 76%) | **0 — memory only** |
| connection/status rows | present | **none** |
| faults in `error_events` (48 h) | — | **none** |

`PolarStrapService` keeps `battery` in a `private var` written once per connection and never sent
anywhere. Its give-up path — `stopSelf()` after six consecutive failures, logged as *"giving up …
strap not reachable"* — reaches `onLog` and no table. **A strap that is flat, unreachable, or whose
service quietly stopped looks identical to a strap that was not worn**, from every surface except
opening the app while it is failing.

PS-44 needs seven paired nights and its own guard says not to count a night until it is in the table.
Without a status signal the owner cannot know in the morning whether last night counted. Managed that
way, a seven-night window takes far longer than seven nights — it has already cost one.

## Filed as TN-54

Persist what the ring already persists: a status row per connection attempt with battery, state and
`last_sample_at`, on the native HTTP path that already posts samples. `oura_ble_battery_poll` is the
shape to copy, so this is not new infrastructure.

**Deliberately not diagnosed.** A flat CR2025 (141,745 RR intervals of use, and Polar's own notes say
a dying cell presents as flaky connections), a service that gave up and was never restarted, and
Bluetooth being off are all consistent with what is stored. The entry is about not being able to tell
which, and says so rather than guessing.

**And not solved by a notification.** A low-battery channel already exists in the service and did not
prevent five silent days. A notification is not a record, and *"did last night count"* is asked the
next morning.

## Diagnosed live, an hour later

The owner replied with a screenshot of the Devices screen reading **"Polar H10 · Connected · on your
chest"** — and rows began arriving in the same minute, 06:03 Brisbane. Consecutive stored RR rows:

| Brisbane | rr_ms | gap |
|---|---:|---:|
| 06:03:28 | 802 | — |
| 06:03:58 | 1247 | **30.2 s** |
| 06:04:29 | 715 | **30.2 s** |
| 06:04:59 | 790 | **30.7 s** |

**Opening the app is what started it.** Not the cell, not the link, not the ingest path — the service
was not running, and nothing restarts it until the app is launched. Its own give-up path
(`stopSelf()` after six failures) is the likely cause.

That makes the observability gap the whole bug. The Devices card showed **"Connected"** with no
battery figure while the ring beside it showed 75% — so the one surface checked actively reassured
him. The revised ask is smaller and sharper: surface **last-sample-at**, which the app already has.
"Connected" is not the useful fact; *"last sample 5 days ago"* is.

**And it confirmed TN-51 is worse than estimated.** 30-second gaps with **one** RR interval per kept
sample, not the islands of 2–3 inferred from history. With one interval per island there are no
adjacent pairs, so rMSSD is not degraded — it is **undefined**.

## The battery indicator: do not build what was asked for

The owner wants an accurate strap battery reading because Home shows a constant 100%. **That is the
cell behaving normally.** The H10 runs a CR2025 — a primary lithium coin cell with a near-flat
discharge curve — and `PolarStrapService` already carries the comment *"a dying cell presents as
flaky connections long before it presents as a dead strap."* A truer percentage is not available
from this chemistry, and an APK cycle spent on it buys a number that still cannot warn.

**`last_sample_at` and connection reliability move days before the percentage does.** That is what
belongs on the card.

## And the indicator he needed already exists, hidden

The service runs a foreground notification reading **"Connected · N% battery"**, **"Strap unreachable
— retrying in Ns"**, or nothing at all when it is not running. Its channel is **`IMPORTANCE_MIN`**,
so Android collapses it into the silent section with no status-bar icon.

**That is a check that works today:** expand the silent section of the shade and look for *"Chest
strap"*. Absent means the service is down and no night will record. Raising the importance wholesale
would be wrong — `MIN` is right for an all-day service — so the entry asks for it only during a
declared sleep session, or mirrored into the app.

## What was not exercised

Stored production reads plus a source read, in the sandbox. No code changed, no device, no APK, no UI.
The strap's battery state is unreadable from here by construction — that is the finding, not a
limitation of the check.

<a id="2026-09-20-tn53-sparkline-gaps"></a>

# 2026-09-20 — TN-53's render half: the chart was drawing the gaps it was meant to show

**Lane B** · `feat/tn53-sparkline-gaps` · **v1.460.5**

## What the entry asked, and what was actually there

TN-53's engine half shipped earlier the same day (Lane A): `analyseHrRecovery` now returns `null`
unless the two readings behind `hrr1` are 45–75 s apart, so a day that cannot support the
measurement stops reporting one. Its `Keep:` named the follow-on and listed three things the
sparkline might do with a run of nulls — *"whether it interpolates across the gap, collapses the
axis, or renders an empty chart that reads as broken"* — under the heading **a gap that looks like
a bug is not an improvement over a wrong number**.

**It was the first of the three, and that is worse than the framing allowed for.**
`components/health/trend-sparkline.tsx` passed `spanGaps: true`, so Chart.js joined the last value
before the nulls straight to the first one after them and drew the missing days as a smooth,
tensioned line. There was no gap to look like a bug. The engine gate replaced a fabricated number
with an honest absence and the chart put the fabrication straight back — so on the one surface that
shows the trend, the gate changed nothing at all.

## Why this fixed eleven charts and not one

`TrendSparkline` is shared: resting HR, HRV, HR recovery, wear time, session duration, workout
density, protein per kg, steps, water, skin temperature, and the score details all render through
it. Every one of those fields is a daily measurement where `null` means *not measured*, so the
interpolation was making the same claim on all of them. Fixing only `hrr1Bpm` would have meant a
prop, two behaviours in one component, and the identical invention left on ten siblings. The
sibling-surface sweep rule says to do them together, and here it is the literal reading.

## The second defect, which only appears once you stop spanning

A line segment needs two adjacent points, and the chart drew no dot except on the last day. So
`spanGaps: false` on its own makes a reading with nothing either side of it render as **nothing at
all** — a sparse series can vanish while reporting no error. The sparse case is the normal one for
this metric: `ble` sessions carry 7.1 readings per set against the chest strap's 111.8. Hence a dot
on any stranded value, alongside the flag.

## Shape

`components/health/trend-sparkline-gaps.ts` holds the decision as a pure function, following the
repo's own convention for chart geometry (`stress-day.ts`, `sparkline-geometry.ts`) — the vitest
projects are node-only, so a React render test would need a DOM runner that is not configured, and
extracting the dataset fields makes the wiring node-testable instead. `gapDataset` returns
`pointRadius`, `spanGaps` and the coverage note together, with **`spanGaps` typed to the literal
`false`**: it is the flag whose reversion silently reinstates the invented line, and the type stops
that being a one-character edit in the component.

The note is phrased as **"3 days missing"** rather than "11 of 14". Leading nulls are trimmed before
drawing, so the denominator would not match the card's own "— 14 days" label and the reader would
be left working out which number was wrong. The header row also gained `flex-wrap gap-x-2`: the
note is new text in a row that already carries a delta chip, and at 412 px the two together are
close to the edge.

## Verification

- `components/health/__tests__/trend-sparkline-gaps.test.ts` — 15 cases, killed by five mutations:
  always isolate · `||` for `&&` · `!== null` so `undefined` counts as present · `!!v` so a zero
  drop counts as absent · print the note unconditionally.
- `e2e/tn53-sparkline-does-not-span-gaps.spec.ts` — seeds a real hole (an adjacent pair, a stranded
  reading, today) and asserts the note on `/health/heart-rate`, plus that no child overflows the
  header and the page does not scroll sideways. **Proven red against the pre-fix component:** *"the
  sparkline drew the gap without disclosing it"*, received `"Resting Heart Rate — 14 days"`.
- Gate: `Ran 75 of 75` Custom Rules · 7787 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline (320/90).

## The mistake worth keeping

The e2e was written against Postgres's `CURRENT_DATE` and failed at 21:30 UTC reading `4 days
missing` against an expected 3. The route builds its window from `todayInTz`, and after 14:00 UTC
that is already tomorrow in Brisbane — so an offset of 0 seeded the chart's *yesterday* and left the
window's last day empty. This is the exact shape `CLAUDE.md` describes under Q-356: **both sides
derived from a clock, but not the same clock.** Written the other way it would have passed for
fourteen hours a day and failed for ten. The fixture now anchors to the seeded user's own timezone,
read from `users.timezone`.

## Not exercised

The device look, which is the whole of what the entry still owes: a 3 px stranded dot and the
missing-days note at 412 px on the S25. The spec measures that nothing overflows; that is not the
same as it reading well. And the owner's pass test — *"the sparkline shows a gap across the period
the strap was not worn"* — needs production data. The local seed carries no `hrr1` at all, which is
why the e2e drives `rhrBpm` through the identical component path.

## Filing note

TN-53 printed as **UNCLASSIFIED**, not READY, because it carried no `Lane:` field — while its body
named the remaining half as Lane B in bold. Lane B's READY was 0 at the time. That is the same
class as LB-121 (an entry invisible to the lane meant to build it, for a reason that has nothing to
do with whether it is startable), reached by a different route: there a `⛔` used for emphasis, here
a missing field. The entry now carries `Lane: B`.

<a id="2026-09-20-what-we-record"></a>

# What we record, and what it can actually say

**Tuning agent · 2026-09-20 · branch `tuning/tn53-metric-inventory-and-hrr-gate` · docs-only**

Owner: *"Have a look at all metrics we record or what can be calculated/correlated. We need a very
strong system here."* 99 tables inventoried. One defect, one better instrument nobody is using, and a
tiering of what can carry an analysis at all.

## The richest table in the app is also the least exploited

`set_hr_stats` — 33 columns, 918 rows — computes per-set heart-rate recovery: `drop_30s/60s/90s/120s`,
`trough_bpm`, `sec_to_hrr50`, `pct_hrr_at_rest_end`. HRR is among the best-validated autonomic markers,
and unlike resting HR it is measured against a **controlled stimulus**, which is what makes it
comparable day to day.

Its quality is entirely a function of which device was worn:

| source | rows | `coverage_ok` | readings/set |
|---|---:|---:|---:|
| **chest_strap** | 220 | **91%** | **111.8** |
| `ble` (ring) | 79 | 54% | **7.1** |
| *NULL* | **615** | **23%** | 17.0 |

Sixteen-fold density difference, exactly as the Polar knowledge base predicts. Only 24% of the table
comes from the source dense enough to measure a 60-second recovery, and that source has been dark
since 2026-09-15.

## TN-53 — one HRR path is gated and the other is not

`exercise-hr-trend.ts` filters every mean on `coverageOk`. **`/api/health/trends` does not** — it
ignores `set_hr_stats` and recomputes live, where `hrr1 = bpmAtLog − bpm60` and both terms come from
`nearestBpm(…, windowMs = 90_000)`: nearest reading within 90 s, no density floor, no check the two
readings bracket 60 s. At 1 reading/sec that is harmless; at 7 readings per set the two values can be
the same reading or 150 s apart.

**So the HR-Recovery sparkline moves partly with sensor availability.** The fix is a density gate
returning `null` — a gap is honest where a computed value is not.

## The better instrument exists and was left half-used

`fitness_tests` has a `resting_hrr` test type **and** an `hrr1_bpm` column. One test was run
(2026-07-19) and **`hrr1_bpm` is null on it.** A repeated HRR test controls the stimulus in a way
neither resting HR nor ring HRV can — it is the durable answer to the medication question, and it
needs no new code.

**And a negative result stated so it is not quoted later:** HRR-60 reads 5.8 → 4.0 bpm pre-dose vs on
Retatrutide, but n = 229 against 23 with sd 12.9. That is 0.15 sd. It means nothing.

## Tiering, so the next correlation is built on solid ground

**Dense enough to trend:** `oura_heartrate`, raw samples, `rr_intervals`, `daily_zone_minutes`,
`colmi_readings` (3,830 — and **zero scoring modules touch it**).
**Dense enough to correlate:** `set_hr_stats`, `body_metrics`, `sleep_sessions`, `day_checkins`,
`mood_logs`, `personal_records`.
**Too sparse for anything:** `dexa_scans` (**1**), `measured_rmr` (**1**), `fitness_tests` (3).
**Empty:** `blood_panels`, `blood_analytes`, `dexa_scan_regions`.

That last tier matters for TN-48: its fat/water/lean decomposition rests on scale estimates with one
DEXA and one RMR to anchor them, so its numbers should read as scale-relative until there is a second.

## What was not exercised

Stored production reads plus source reads, in the sandbox. No code changed, no scoring touched, no
device, no UI. Row-scoped to the owner.

<a id="2026-09-21-docs-rv79-cachedfetch-caches-null"></a>

# RV-79 could not be built as written — `cachedFetch` caches a null over an optimistic save

**Branch:** `docs/rv79-cachedfetch-caches-null` · **Lane B** · docs-only

## What happened

RV-79 is a clean-looking rule fix: `app/session-select/session-select-content.tsx` reads today's
mood with a bare `fetch`, against the standing *"client GETs of `/api/*` use `cachedFetch` with a
`readCacheSync` seed, never bare `fetch`"*. The entry's fix says to route it through `cachedFetch`
and **preserve the existing null-guard by applying it in the `onData` callback**.

That cannot work, and applying it would reintroduce the bug the same bullet calls load-bearing.
`cachedFetchCore` (`lib/sqlite/cache.ts:366`) ends a successful fetch with an **unconditional**
`await setCached(key, toStored(data), ttlSeconds)`, outside every null check, with `toStored` the
identity for `cachedFetch`. `onData` runs before it and has no power over it. There is no
`shouldCache`/`skipNull` option — the only opts are `freshWithinTtl` and `onError`.

## Measured, not read off the source

A probe seeded `mood:<date>` with an optimistic log, then ran `cachedFetch` against a stubbed 200
returning `null`:

- `onData` fired **twice** — `[{logDate…, energyLevel:'high'}, null]`. So React state is clobbered
  too, not only the cache.
- `readCacheSync('mood:<date>')` afterwards read **`null`**.

`setCached` writes sessionStorage, localStorage *and* SQLite, and `readCacheSync` parses a stored
`"null"` back to `null` rather than treating it as a miss. So the seeds at
`session-select-content.tsx:211` and `:319` would call `setMoodLog(null)` on the next visit and the
check-in card would re-prompt — the session-167 bug, reached through the helper the cache rule tells
every client GET to use.

The probe was written to answer the question and deleted; it is not in this diff. The numbers above
are its output.

## What was filed

**LB-123** (`Lane: A`) — give `cachedFetch` an opt-in `opts.shouldCache?: (data: T) => boolean`,
defaulting to always, threaded into `cachedFetchCore` to guard that one `setCached`. Additive, so
every existing caller is unaffected, and it lands for **any** nullable-payload key rather than only
this one. A narrower `skipNull` boolean would also work; the predicate is preferred because the next
case will not be `null` — an empty array reads the same way to a `readCacheSync` seed.

**RV-79** keeps its lane and gains `Needs: LB-123`, so it stops printing as startable for Lane B. It
is one line once the option exists.

The `⛔` this entry first used to mark the block was removed before pushing: that glyph is exactly
what `next-item.js` reads as the legacy prose blocker (LB-121), and the same PR that shipped RV-72
had just cleared one. A `Needs:` field is the mechanism; an emphasis glyph is an accident.

## Why this was not just built anyway

`lib/sqlite/**` is Lane A's. The bare `fetch` is a rule violation; caching the null is a live bug.
Trading the first for the second is a loss, so the call site is deliberately left as it is.

## Not established

How many other GET routes can legitimately answer `null` or `[]` was **not** swept — this was found
from one call site. That sweep is worth doing when the option lands and is not a blocker for it.

LB-123 is filed at RV-79's own queue position rather than promoted. It unblocks a live-bug fix, so
an argument for moving it up exists, but cross-lane priority is the Orchestrator's call.

<a id="2026-09-21-fix-rv72-progress-bar-scalex"></a>

# RV-72 — progress bars composite instead of forcing layout

**Branch:** `fix/rv72-progress-bar-scalex` · **Lane B** · **v1.464.1**

## What shipped

`components/ui/progress-fill.tsx` — a primitive that renders a full-width fill at
`transform: scaleX(pct)` with `origin-left` and `transition-transform
motion-reduce:transition-none`. The five solid-fill bars that transitioned `width` now use it:
`health/contributor-chart.tsx`, `workout/time-summary-card.tsx`, `nutrition/meal-macro-bars.tsx`,
`nutrition/meal-plan-section.tsx`, `guided-walk/walk-pacer-bar.tsx`. Animating `width` forces
layout and paint every frame *and reflows the bar's siblings* — the target tick sharing a track on
the time-summary card, the label and numbers beside each macro row.

`nutrition/calorie-progress-bar.tsx` is deliberately left on `transition-[width]`, as the entry
directed, and now carries the comment saying why: its fill clips a gradient ramp with a
hand-computed `backgroundSize`, so scaling it would squash the ramp and change *which colour the
leading edge shows* — what the bar says about the day, not just how it moves. It is the only
remaining `transition-[width]` in the app.

## Two decisions worth not re-litigating

**The primitive renders the FILL, not the track.** Every call site's track already carries the
`role="progressbar"` and its ARIA values, a background often derived from the fill colour at low
alpha, a height varying from 1.5 to 2.5, and in one case an absolutely-positioned target tick.
Swallowing all of that would have meant a prop for each; owning the fill alone is the part that is
genuinely identical across the five.

**The radius stays on the track, and that is load-bearing.** `scaleX` scales the fill's horizontal
radius with it, so a `rounded-full` fill goes visibly oval at low percentages. All five tracks
already set `overflow-hidden rounded-full`, which clips a square fill to the same shape at every
value. A new caller without those two classes gets square ends — the spec asserts the fill's own
radius is 0 for exactly that reason.

## Testing

`e2e/rv72-progress-bars-composite.spec.ts` reads `transform`, `transformOrigin` and
`transitionProperty` off the live element — **computed style, not class strings**. That is not
stylistic: on the previous PR `duration-250` compiled to nothing (it is not in Tailwind's default
scale) and would have shipped as a convincing no-op, because a typo'd Tailwind class fails no gate.
The contributors are injected via a route intercept the way `score-gap-reason.spec.ts` does it —
whether the seeded user has readiness contributors today is a fact about fixtures, and a bar that
never rendered would pass every assertion vacuously.

**Mutation-checked, four ways.** Reverting `ProgressFill` to `width` fails it ("no progress fill is
using scaleX"); dropping `origin-left` fails it ("transform-origin is 85px 5px, not the left edge");
adding `rounded-full` to the fill fails it ("the fill kept its own radius — it will go oval under
scaleX"); converting the calorie bar to `scaleX` fails the exclusion guard.

**The exclusion guard lives in `e2e/calorie-progress-bar.spec.ts`, not in the RV-72 spec.** It was
written there first and passed vacuously: the gradient fill renders only when intake > 0 and the
seeded nutrition day is empty, so the selector matched nothing. That sibling spec is the only place
that seeds a non-zero intake, so it is the only place the guard can actually see the element.

## Not exercised

No device pass. No sandbox drives a Samsung WebView, and frame timing on that device is the entire
payoff of a compositing change — this is felt, not measured, and the `motion-polish` batch keeps one
on-device sitting for RV-71, RV-72 and RV-75 together. Nothing here was watched moving on hardware.

## Left undone, on purpose

The entry also names bars using a blanket `transition-all` over an inline `width`
(`metric-tiles-card.tsx:108`, `recommendation-card.tsx:224`, `goal-progress-bar.tsx:7`) and 26 bars
with no transition at all. Neither was converted — separate files, separate risk, and a large diff
is the one least likely to land under the current merge rate. The primitive they would use now
exists. RV-72 stays queued with a `Keep:` for those and for the device pass.

## Incidental

RV-72's `⛔` emphasis glyph — the fourth measured instance of LB-121 — is gone, so the entry no
longer parks itself in `next-item.js`.

<a id="2026-09-21-lane-a-bf7-duration-minutes"></a>

# 2026-09-21 — BF-7 PR 2b (engine): the duration ladder takes minutes, and the labels were persisted

**Branch:** `lane-a/bf7-duration-minutes` · **Lane A** · the engine half of PR 2b. The control is
Lane B's and is unchanged.

## What the owner asked for

2026-08-23, verbatim: *"id like to have the ability to choose a 45min session - maybe we have a
slider - and the default one is shown - but have the option to to slide to 15/30/45/60/90options?"*
Then, settling the shape: *"yes I agree lets anchor to session; dont need 15minutes"*.

So: absolute minutes **around** the session's own configured length, which stays the anchor and the
default. 15 is dropped, which leaves `MIN_PRESET_BUDGET_MIN = 20` and the `WARMUP_CEILING_FRACTION`
arithmetic that meets it exactly untouched.

## Why this is Lane A at all

The entry's `Lane:` field says A; the plan labels the remaining PR 2b "Lane B". Both are partly
right and the path rule settles it: PR 2b widens `DurationPreset`, the prescription's default test,
and **the route's Zod schema** — `app/api/**` is Lane A — while the control is `components/**` and is
Lane B. Standing rule for a change that spans both: **Lane A first**. This is that half.

## The plan's cheapest claim is the one that was wrong

Its §5 is titled *"What makes this unusually cheap"* and says:

> There is no `duration_preset` column in the Postgres schema, in the local SQLite tables, or in
> `lib/local-store/types.ts` … **It also means the type can change freely: there is no stored value
> to be compatible with.**

The first sentence is true. The conclusion is not. **`durationPreset` is a field on
`AiPrescription`**, and an `AiPrescription` is stored whole in `session_periodization.prescription`.
Measured in production 2026-09-21: **10 of 10 stored prescriptions carry one.**

So the plan's step 1 — *"`DurationPreset` becomes `number`"*, with `DURATION_PRESET_DELTA_MIN`
*"deleted rather than left as a stale constant"* — would have made every stored prescription's
duration unreadable by the code that reads it back, and removed the only thing that knows what the
stored word means.

**What shipped instead:** `DurationPreset = number | LegacyDurationPreset`. A number is the canonical
form and an absolute request; the three labels stay legal because they are what is stored and what
older clients send. Both resolve in exactly one place, `requestedBudgetMin`, so nothing downstream
learns that two forms exist. `DURATION_PRESET_DELTA_MIN` survives with a changed job — it is the
legacy decoder now, not the ladder's step, and its comment says so and names the condition for
deleting it.

**The labels are RELATIVE and the numbers are ABSOLUTE, which is why this is a data change and not a
rename.** On a 60-minute session they agree, which is what makes it easy to miss. On a 45-minute
session `'short'` means 15 and the number `30` means 30. A test pins that disagreement.

## One more label test that had to become a comparison

`generate-prescription.ts` decided whether to override the budget with
`durationPreset !== 'standard'`. That was the same question as "is this the anchor?" only while the
single way to say "the session's own length" was that word. A number equal to the anchor means it
too and must produce no override. It now compares the **requested** budget against the session's —
the unclamped half, which is the trap PR 2a split `requestedBudgetMin` out for, extended to numbers.

## Verification

- **13 new tests**, plus the pre-existing `duration-presets.test.ts` passing unchanged (29 together).
  They cover the plan's own §6 list — the 45-minute session anchoring at 45 and expanding at 60, the
  anchor never expanding, the direction surviving the floor clamp — plus the persisted-label cases
  the plan did not think were needed.
- **Mutation pass, three mutations:**
  - a number read as RELATIVE (the bug the union exists to avoid) → **7 of 29 red**.
  - the labels dropped, exactly as the plan instructed → **16 of 29 red**, including the
    pre-existing suite. That is the plan's own step 1 failing loudly.
  - an equivalent restructure of the same early return (the deliberate control) → **29 green**.
- `npx tsc --noEmit` clean — the four Lane B component files still compile untouched, because the
  labels they send are still legal.
- `pnpm check:rules` — **Ran 75 of 75**, all passed. The route's new numeric field needed real
  bounds to clear *"Numeric validators carry an upper bound"*.

## Not exercised

- **No control yet.** Nothing in the UI can send 45 until Lane B's PR 2b ships; this half only makes
  45 expressible and correct when it arrives. BF-7 stays queued for it.
- **Not device-verified**, and nothing here needs an APK — TypeScript only, so it ships via Railway.
- **The bounds are a request guard, not the model's floor.** `MIN_PRESET_BUDGET_MIN` still clamps
  what is achievable; the schema's 1..1440 only stops a nonsense minute count reaching the planner.
  The floor is deliberately 1 rather than 20 so an under-floor request is clamped with its direction
  intact rather than 400'd.

<a id="2026-09-21-lane-a-rv64-order-statistics-selection"></a>

# RV-64 — the fix was in the reduction, not in SQL, and the entry's own unread function is why

**Branch:** `lane-a/rv64-order-statistics-selection` · **Lane A** · no migration, no native change.

`computeObservedHr` needs three numbers — the k-th highest bpm, the k-th lowest, and the mean — and
got the first two by sorting the *entire* series descending. It now keeps two k-element windows in
one pass. **60.8 ms → 30.4 ms on the owner's 130,580-row window, identical output.**

That is not the fix RV-64 asked for. The entry asked for the reduction to move into SQL, and that
turns out to be wrong twice over.

## The entry's fix computes a different answer

RV-64 proposed *"a repo method returning the order statistics directly — `ORDER BY bpm DESC LIMIT k`
and its mirror"*, citing an aggregate that answered in 54 ms against the 130k-row pull.

But `getHrForWindow` does not return the rows it selects. It returns `preferStrapBuckets(rows)`,
which drops every ring row in a 10-second bucket the chest strap already covers. **The entry flagged
that function as unread** — *"`preferStrapBuckets` was not read, so its own per-row cost is
unquantified"* — and it is precisely the thing that makes the proposed aggregate unsafe. Measured
against production over the owner's 90 days:

- **1,350 of 130,580 rows** are dropped by the merge.
- The naive aggregate's **k-th lowest is 36**; the current code's is **37**.
- The k-th highest agreed at **175** — which is luck, not structure. Those 1,350 rows fall during
  strap-worn periods, i.e. workouts, which is exactly where the top of the distribution lives.

So a correct aggregate has to reproduce the bucket merge in SQL.

## And a merge-correct aggregate is not faster

Three formulations, all returning the right answer (k-th low 37), timed against production:

| formulation | production |
|---|---|
| raw scan + sort, rows discarded server-side | 20–55 ms |
| merged set, join + DISTINCT | 313–396 ms |
| merged set, window functions | 460–600 ms |
| merged set, NOT EXISTS | 623–790 ms |

**I got the conclusion wrong once on the way here and it is worth recording why.** Comparing 313–600
against 20–55 says the aggregate is a 6–20× regression. It is not, because the 20–55 ms is only the
server's share: it omits the pg driver building 130,580 row objects. Measured apples-to-apples on one
machine, same data, same pool:

| path | total |
|---|---|
| full pull + driver materialisation | **197.9 ms** |
| …plus the old JS reduction | ~260 ms |
| merge-correct SQL aggregate, one row back | **266.2 ms** |
| …plus this PR's reduction | **~228 ms** |

The aggregate is a **wash**, not a win and not a regression. The pull's real cost is row
materialisation in the driver, and no SQL rewrite removes it — which is why the useful change was
the 30 ms sitting in the reduction, not the 130k rows.

## What shipped, and what deliberately did not

**Shipped:** two k-element windows replacing the full descending sort inside `computeObservedHr`.
`topK` holds the k largest ascending (so `topK[0]` is the k-th highest, `topK[k-1]` the highest),
`bottomK` the k smallest descending. Pure function, no API change, no call site touched.

**Deliberately not shipped:** `preferStrapBuckets` ends with a `.sort()` by timestamp that
`resolveHrProfile` never uses — it maps straight to bpm. Dropping it too is **30.4 → 26.9 ms**, worth
3.5 ms, and it would mean a second variant of a shared helper whose other callers (`computeDayZoneSeconds`,
the live chart) genuinely need time order. Not worth the API surface; the number is recorded so the
next reader does not have to re-measure to decide that.

## RV-64 is re-laned, and RV-73's batch is dissolved

The reduction was never the order of magnitude. `live-hr-chart.tsx:46` fetches `hr-profile` in a
mount-once effect and `active-workout-screen.tsx:520` mounts it as
`{workoutPhase === "rest" && …}`, so it **remounts once per rest period** — ~20 times in a 5×4
workout, against the same 10-connection pool as `log-exercise`. Fixing the reduction took 30 ms off a
260 ms call; fixing the remount takes 19 calls off 20. That half is `components/**`, so **RV-64 is
re-laned to B** and stays queued with the remount as its `Keep:`.

**RV-73's `Batch: hr-window-aggregate` and `Needs: RV-64` are both removed.** Both rested on RV-64
moving the reduction into SQL — *"the same fix on the same helper"* — and that fix does not exist. Its
own fix (slice the two contained 30-day windows out of the 90-day pull that already happened) is
independent, still valid, and still Lane A's.

## Verification

- **5 new tests**, the load-bearing one being a **200-trial randomised equivalence check** against
  the old full-sort implementation, kept in the file as the oracle. Plus the adversarial shapes
  random data never produces: a monotonically rising series (every reading displaces the window), a
  falling series, an all-equal series, and a series shorter than the corroboration count.
- **Mutation pass — four mutations, one control.** max = highest rather than k-th highest → 7 failed;
  min = lowest → 5 failed; `highestPlausible` = k-th rather than top → 7 failed; window one element
  too small → 7 failed. The deliberately equivalent control (`>=` for `>` on the insertion test,
  where a tie replaces an equal value) → **28 passed**.
- The existing `observed-hr`, `hr-profile` and `hr-window-merge` suites pass unchanged.
- Full suite, `check:rules` and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** The route could not be authenticated against in production —
  the same gap the entry recorded — so its end-to-end wall time is still inferred from component
  timings rather than measured on the wire.
- **The 197.9 ms and 266.2 ms figures are from local Postgres**, seeded with 130,580 rows matching
  production's shape (97,901 strap / 32,679 ring). The production figures in the first table are real
  production timings. The two tables should not be read against each other.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner — the 1,350 dropped
  rows are the owner's, not a claim about every account.

<a id="2026-09-21-lane-a-rv66-baseline-is-the-recommendation"></a>

# RV-66 — the model was inventing numbers beside a function that had already computed them

**Branch:** `lane-a/rv66-baseline-is-the-recommendation` · **Lane A** · v1.463.0 · no migration, no
native change.

`/api/nutrition-goals/recommend` computed a full baseline — Katch-McArdle/Mifflin, a *measured* RMR,
goal offsets, lean-mass protein dosing, activity-scaled water and steps — quoted it to the model, and
then asked the model to return its **own** `recommendedCalories`, `ProteinG`, `CarbsG`, `FatG`,
`WaterMl`, `StepsGoal`. Those numbers were displayed as the recommendation and written into the
user's goals on Apply.

CLAUDE.md forbids precisely that, twice over: *no LLM self-reported number may gate an automatic
action **or be shown to the user as fact***. It was both.

**The model no longer returns any number.** The six fields are gone from the response schema, and the
recommendation is the computed baseline.

## The entry's unknown, measured — and it is worse than "strays inside the band"

RV-66 left open *"how far the model typically strays inside that band in practice is unmeasured"*,
because stored rows were never diffed against the baseline they came from. **They cannot be: the
baseline is not persisted alongside the recommendation.** So it was reconstructed instead — the
owner's profile on the day of the last applied recommendation (2026-09-14: 70.35 kg, 25.7% body fat,
measured RMR 1,325 kcal @ 51.5 kg FFM, recomp, moderate) run through the shipped `calculateBaseline`:

| field | computed baseline | model, stored **and applied** |
|---|---|---|
| calories | 1,410 | 1,618 (+15%) |
| protein g | 115 | 150 (+30%) |
| fat g | 39 | 55 (+41%) |
| water ml | 2,572 | 2,600 |
| **steps** | **10,000** | **5,000 (−50%)** |

**`clampRecommendation` altered none of it** — every value passed the safety band untouched, which is
the entry's *"a safety band, not a derivation"* confirmed rather than argued.

**The step goal is the cleanest evidence, because it needs no body-composition maths at all.**
`STEP_GOAL_BY_ACTIVITY` is a lookup that can only ever return 7,000 / 8,500 / 10,000 / 12,000. The
owner is `moderate` → 10,000. The model returned **5,000** while also returning
`recommendedActivityLevel: 'moderate'`, i.e. explicitly *not* proposing a different level. It halved
the step goal and the sheet wrote it in. Across all 13 stored rows the model produced six distinct
step goals — 5,000 / 6,000 / 7,000 / 7,500 / 8,000 / 8,500 — of which **four are values the formula
cannot produce**.

**Honest limit on the table above:** `body_fat_calibration` has no `claude_ro` view, so
`correctBodyFatPct` could not be reproduced and the raw 25.7% was used. That shifts lean mass and so
calories, protein and fat. **Steps and water do not depend on body fat at all**, so those two rows
hold regardless. Filed as LA-127.

## What stayed, and why it is not the same thing

`recommendedActivityLevel` stays. It is a **category**, not a number, and the figures that follow from
it are recomputed in code by a second `calculateBaseline` call on the new level. "Your logged
frequency says `active`, not `light`" is the question a model is actually equipped to answer; the
TDEE that follows is not. The prompt was rewritten to match: the model explains the figures, may
quote them exactly, and is told outright that it does not set them.

## Three findings this turned up, all filed rather than fixed here

- **LA-126 (owner-gated, LIVE).** The owner's live `nutrition_targets` are **1,660 / 150 / 141 / 55**
  — exactly the **2026-08-31** recommendation row. Model-invented numbers are in force right now,
  **+250 kcal and +35 g protein** over the formula. RV-66 stops future ones; it deliberately does not
  touch what is stored, because rewriting a user's goals is a production data write and the owner has
  been eating to those numbers for three weeks. **Not run for him.**
- **LA-125.** `calculateBaseline` sets fat at 25% of calories (39 g here); `clampRecommendation`
  floors it at 0.6 g/kg (42 g). So the recommendation is *the baseline made safe*, not the baseline
  byte-for-byte, and carbs come out at 143 rather than 150. The One Formula, One Place win this entry
  promised holds for calories, protein, water and steps and **not** for fat and carbs. The clamp
  cannot simply be deleted to close it — see below.
- **LA-127.** `claude_ro.user_goals` and `claude_ro.body_fat_calibration` do not exist, so the steps
  goal could not be read at all and the body-fat correction could not be reproduced.

## Why `clampRecommendation` was kept

It reads like a no-op once the input is a computed baseline, and it is not. `CALORIE_ADJUSTMENT_BY_GOAL`
subtracts **500** for `lose_weight`, and `bmr × 1.2 − 500 < bmr` for any BMR under **2,500** — which
is most people. Without the floor, every cutting user is shown a sub-resting-rate calorie target:
computed honestly, and still wrong to display. There is now a test for exactly that case, because I
had asserted it in a comment before asserting it in code.

## Verification

- **6 new tests**, behavioural and handler-importing, in the route's own `__tests__/`.

  **A correction worth carrying, because it changed what this PR had to do.** I first concluded the
  route's only test was a source-grep over its own text (`prompt-tdee-not-activity-scaled.test.ts`),
  on the strength of looking only under `app/api/nutrition-goals/**`. That was wrong: PS-39 had
  already written a 22-case behavioural suite at **`lib/__tests__/nutrition-goals-recommend-route.ts`**,
  under the heading *"the model never sets a number"* — the exact property this entry is about. It
  surfaced as **8 failures in the full suite**, not in any targeted run I had done.

  Those 8 are correct failures. That suite pinned the property via `clampRecommendation`: the model's
  number reached the route and was bounded. It no longer reaches the route, so every
  "model said 400 kcal → clamped to 1,780" case now reads "model said 400 kcal → 2,136, the
  baseline". **The property survived and the mechanism moved one layer earlier**, so the block was
  rewritten rather than deleted — the fixtures still hand back the old numeric shape on purpose, as
  proof the route ignores it.
  - the response equals the computed baseline, not the figures that were actually shipped;
  - **numeric fields are ignored even when the model volunteers them** (the load-bearing one: a
    schema is exactly what a later edit re-adds "for completeness");
  - the *persisted* row carries the baseline, since the sheet applies what was stored;
  - a suggested activity level recomputes every figure from the formula rather than being taken at
    its word;
  - the `lose_weight` calorie floor fires and says so in `dataQualityNote`;
  - the fat/carb clamp disagreement, pinned as current-behaviour-not-endorsed (LA-125).
- **Mutation pass — three mutations, one control.** Model numbers back in the schema and preferred →
  2 failed. Suggested activity level ignored when recomputing → 1 failed. `clampRecommendation`
  dropped entirely → 2 failed. The deliberately equivalent control (destructuring `clampBaseline`
  first) → **6 passed**.
  - **One mutation had to be thrown away and rerun**, which is worth recording: the first attempt at
    "skip the clamp" set `bmr: 0`, which only lowers the calorie floor to 1,200 — below this
    fixture's 1,410, so it was an *equivalent* mutation wearing a wrong-looking diff. It passed, I
    read that as a coverage gap, and the gap was real but different: nothing tested the floor. The
    floor test came from that, and only then did a real "drop the clamp" mutation fail.
- **PS-39's 22-case suite rewritten, not dropped**, plus one case in its "failure and context"
  block that used the protein clamp ceiling as a proxy for *which logged weight was used*: the
  property is unchanged, the proxy is now the baseline's own dosing, and it is derived from
  `calculateBaseline` and checked against the two weights it must not have picked so it cannot pass
  by coincidence.
- Response and stored-row shapes are unchanged, so `goal-recommendation-sheet.tsx` needs no change —
  checked, not assumed.
- Full suite, `check:rules` and `check-test-typecheck` below.

## A gotcha this item explained, belonging to no item

Earlier today RV-83's entry recorded `pnpm check:rules` failing once on `memo() call sites pass
stable props`, while the full suite ran concurrently, and filed it as unexplained. It is explained,
and the explanation was sitting in this run's working tree: `set-card.tsx` showed as modified with a
`// const X = memo(Y); <X style={{a:1}} />` line appended that I had not written.

`scripts/__tests__/check-comment-blindness.test.ts` proves each rule script actually *detects* its
violation by **appending that violation to a REAL source file** and restoring it in a `finally`.
Two files are used, `components/workout/set-card.tsx` and `app/api/user/goals/route.ts`. Run
`check:rules` inside that window and it reads a genuine violation the suite planted seconds earlier.

**So: do not run `pnpm check:rules` concurrently with the full suite.** It also explains the rule
script output that turns up inside vitest logs, which reads alarmingly like real violations in files
you never touched. RV-83's entry has been amended rather than left saying "unexplained".

## Not exercised

- **The model was never called.** `generateObject` is mocked throughout; what a real Gemini response
  looks like against the new schema and prompt is unverified. The schema is now four fields, three of
  them strings, so the failure mode if it drifts is a `NoObjectGeneratedError` caught by the existing
  try/catch into a 500 — not a wrong number.
- **No device check and no sheet render.** The sheet's own display of these figures was not exercised
  at the S25 viewport.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner: the 13 stored
  recommendations and the live targets are his, not a claim about every account.

<a id="2026-09-21-lane-a-rv73-slice-contained-hr-windows"></a>

# RV-73 — the two extra pulls were for rows already in memory

**Branch:** `lane-a/rv73-slice-contained-hr-windows` · **Lane A** · no migration, no native change.

`/api/cardio-week` called `resolveHrProfile` — which pulls 90 days of heart rate, the heaviest query
in the app — and then, in the same `Promise.all`, issued **two more** `getHrForWindow` calls for a
rolling 30-day window and the 30 days before it. Both of those windows sit **wholly inside** the 90
days already fetched. The route now slices the rows it was handed. **Three passes become one.**

## The entry's own unknown, answered

RV-73 said: *"how `hrRows`/`priorHrRows` are consumed further down the route was not read, so whether
an aggregate suffices is unverified — **establish that before assuming the aggregate fits**."*

Read: they are consumed at exactly two places, and nowhere else in the route's 145 lines —

```ts
const observed      = computeObservedHr(hrRows.map((r) => r.bpm))
const observedPrior = computeObservedHr(priorHrRows.map((r) => r.bpm))
```

Everything below line 100 reads `observed`/`observedPrior`, never the rows. So a reduced shape fits.

Also worth correcting: the entry hedged that *"prod data spans 88 days so the prior window is almost
entirely inside it too"*. That reasons from **data span**, which is the wrong quantity. The prior
window is `[t−60, t−30]` and the pull is `[t−90, now]` — containment is exact and a property of the
constants, not of how much data happens to exist.

## Why the rows come back from a separate export

`resolveHrProfileWithWindow` returns `{ profile, hrRows, from, to }`; `resolveHrProfile` delegates to
it and drops the rows, so its ten-plus call sites are untouched.

**The rows are deliberately not added to `HrProfile`.** `/api/hr-profile` serialises that interface
straight into its response body, so a 130,000-row array on it would ship the entire window to the
device.

## The one caveat, measured rather than argued

`getHrForWindow` applies `preferStrapBuckets`, which drops a ring row when a chest-strap row shares
its 10-second bucket. Merging over 90 days and *then* cutting is not identical to merging a fresh
30-day query: the wider merge can drop a ring row whose bucket-mate sits just outside the caller's
window. The difference is bounded to the rows in the single bucket straddling each boundary, and it
is always in the direction of dropping a ring reading the strap already covered — the slice is a
subset, never a superset.

Measured against production over the owner's current 30-day window, both paths give **57,998 rows,
mean 86, k-th highest 175, k-th lowest 37** — identical.

## The test that had to change, and why that is the proof

`lib/__tests__/cardio-hub-routes.test.ts` answered `getHrForWindow` *by which window was asked for*,
returning bare `{ bpm }` objects with no timestamps — a fixture shape that only works while the
repository does the splitting. Three tests broke immediately on `r.timestamp.getTime()`.

That break is the finding, not an obstacle to it: the split moved from the query to the timestamps,
so the fixture now places each reading in time (15 days back for the current window, 45 for the
prior — both well clear of a boundary). Four new tests pin what the slice has to preserve.

## Sibling sweep

The entry flagged `cardio-trends` and `zone-minutes` as unchecked for the same duplication. **Neither
calls `getHrForWindow`** — both call `getZoneMinutesRange(userId, from, to, tz, profile)`, so the
duplication is unique to `cardio-week`. And `getZoneMinutesRange` is not a hidden N+1 either: it is
backed by the `daily_zone_minutes` cache, serves past days from it when the profile matches, and
resolves the cold path with `Promise.all` — a comment records that the serial version was already
fixed (C-5). Nothing new to file.

## Verification

- **4 new tests**: one `getHrForWindow` call rather than three *and* that the one call is the 90-day
  window; distinct per-window values so a wrong slice shows as a wrong delta rather than a plausible
  number; a reading landing exactly on the shared boundary counting in **both** windows (pinning
  `gte`/`lte` behaviour, not endorsing it); and a reading inside the 90 days but outside both
  reported windows being excluded rather than folded in.
- **Mutation pass — three mutations, one control.** Exclusive lower bound → 1 failed; prior window
  taking everything before `observedFrom` → 1 failed; no slicing at all → 4 failed. The deliberately
  equivalent control (hoisting the two `getTime()` calls out of the predicate) → **27 passed**.
- The 23 pre-existing tests in that file pass unchanged once the fixture carries timestamps.
- Full suite, `check:rules` and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** Auth precedes validation, so a dev-server curl reaches 401
  rather than the handler; coverage is the handler-importing route tests above.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner, so the
  57,998-row equivalence is the owner's window rather than a claim about every account.
- **The saving is not timed end-to-end.** Two `getHrForWindow` calls stop being issued; what that is
  worth on the wire was not measured, because the route cannot be authenticated against in
  production — the same gap RV-64 and the entry both record.

## One thing noticed and deliberately not changed

`app/api/cardio-week/route.ts` defines a local `const OBSERVED_WINDOW_DAYS = 30` while
`packages/shared/src/health/hr-profile.ts` — which this route imports from — exports
`OBSERVED_WINDOW_DAYS = 90`. Same name, different value, one file apart. Not a bug (the local one
shadows nothing, since the route never imported the other), and renaming it is a readability change
outside this diff's remit. Recorded so the next reader is not caught by it.
