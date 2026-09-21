# Session journal — batch folded 2026-09-21

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-11-lane-a-rv42-meal-plan-child-ownership"></a>

# RV-42 — a plan meal could point at another account's rows

**Branch:** `lane-a/rv42-meal-plan-child-ownership` · **Lane A** · no migration, no native change.

## The defect

`meal_plan_meals` carries `meal_type_id` and `saved_meal_id`, both client-supplied, both reaching
tables whose FK proves only that the row exists. The table has no `user_id`, so the FK was the only
ownership link — and it links nothing about ownership. `ownedPlan` guarded the *plan* id and the
child ids went in unchecked. CLAUDE.md's write-path ownership discipline (c), exactly.

**Nothing leaked.** The meal-plan read joins neither table and returns raw ids. The cost ran the
other way: both columns are `ON DELETE SET NULL`, so the owner deleting their own saved meal
silently nulled a stranger's plan meal, with neither account able to see why.

## Where the entry was wrong

**Three write paths, not two, and no shared choke point.** RV-42 named
`replaceMealPlanStructure` "and the create path" and said *"the fix is one pre-check, not two."*
`createMealPlan`, `updateMealPlanMeal` and `replaceMealPlanStructure` each do their own insert or
update; there is nowhere that one check would have covered all three.

**And the one route the entry named is the one that was never exploitable.** The structure route's
`.strict()` schema accepts `mealsPerDay`, `trainingTime`, `retarget` and `order` — no meal fields at
all — and builds its variants by carrying the ids forward from the plan's *existing* rows. Driven
over HTTP it answers `Invalid body` before reaching the repository. **The live doors were the create
POST and the meal PATCH.** The guard on `replaceMealPlanStructure` is kept as defence-in-depth,
because it is a repository function that writes those columns and the discipline belongs at the
write path, not because it closed a hole.

## What shipped

One helper, `assertOwnedMealRefs`, on all three paths. It takes `Pick<Db, 'select'>` so two callers
can run it inside the transaction that does the insert — placed *before* the first write in the
create path, and before the delete in the replace path, so a refusal leaves the existing structure
intact. Meal types are checked with `isNull(deletedAt)` and saved meals without, matching
`writeSavedMeal`, whose shape the entry correctly said to copy; `saved_meals` has no `deleted_at`.

**The routes needed fixing too, and the entry did not mention it.** All three called the repository
with no try/catch, so a `UserFacingError` would have reached Next's default handler as a **500** and
landed in `error_events` — the opposite of the 400 the entry asked for. They now go through
`withRouteErrors`/`routeErrorResponse`.

The file header claimed *"every write in this file goes through `assertPlanOwned` or a user-scoped
predicate; none of them trust an id from the request."* True of the plan id, false of the ids a meal
points at. Corrected in place.

## Verification

Seven DB tests across all three paths, two accounts. Mutation pass: each of the three guards removed
separately and the user scope dropped from the saved-meal check — **four mutants, all killed**; one
deliberately equivalent control (`!==` → `<` on a de-duplicated set) survived as it should.

Driven end to end against `pnpm dev` with two accounts: the create POST and the meal PATCH both
answer **400** naming the field (`Unknown saved meal` / `Unknown meal type`), a create naming the
caller's own rows still returns **201** with both ids stored, and an explicit `null` still clears a
reference. `meal_plan_meals` holds zero cross-account rows after every probe.

## Not exercised

No device path and no APK — server-side write paths only. The structure route's refusal was proven
at the repository and by mutation, not over HTTP: its schema rejects the request first, which is the
finding above rather than a gap in coverage.

<a id="2026-09-17-bf175-assign-step-day-budget"></a>

# 2026-09-17 — BF-175: one day, one budget (`fix/bf175-assign-step-day-budget`)

**Lane B · v1.457.11**

## What the owner saw

Two screenshots taken in the same minute, with one line of commentary: *"2 different calorie goals
here."* The nutrition card read **1,355 OF 1,506**. The log-food sheet, two taps away, read **Today
after logging 1361 / 1660**.

The intake halves agreed — 1,355 plus the 6 kcal item is 1,361. Only the denominator diverged.

## Why it was not a cache bug

1660 is `nutrition_targets.calories`, which the sheet fetched for itself. That column is the
**rest-day floor**, not `restingBase + targetNet`. It is a different quantity that happens to be
measured in kcal, so no amount of invalidation would ever have closed the gap — the two surfaces
were answering two different questions.

`nutrition-content.tsx:423-441` already carries both the rule and the measurement behind it: three
budgets once appeared on one screen (zone bar 2,180, Home 2,451, ring 2,001), and the comment states
it outright. `home-nutrition-card.tsx:34` repeats it. The sweep that fixed the page did not reach
the sheet that logs into it.

## What shipped

One place resolves the day's budget, and every surface that prints a single day's denominator is
handed it:

- `app/nutrition/nutrition-content.tsx` → `<FoodLoggerSheet dayBudgetKcal={effectiveCalorieGoal}>`
- `components/nutrition/food-logger-sheet.tsx` → threads the prop through
- `components/nutrition/assign-step.tsx` → takes `dayBudgetKcal`; its `nutrition-targets` seed, its
  `cachedFetch`, the local `calorieTarget` state and the `NutritionTargets` import are all gone. The
  numerator, the `/ N kcal` and the green/orange flip read the prop. Null draws nothing.

`budgetProvenance` is deliberately **not** called in the sheet — `energy-card.tsx:50` records why a
second call site is the wrong shape: it becomes an independent number the moment its inputs differ.

## The second surface, which the entry's sweep could not see

The entry asked for a sweep of every `'nutrition-targets'` cache read. That sweep is clean:
`nutrition-content` (resolves the budget), `macro-targets-pane` (Profile, editing the goal itself),
the sync-provider warm list, the `cache-groups` invalidation. Only `assign-step` was misclassified.

But a cache-key sweep cannot see a value passed as a **prop**. Following `targets` down the page
found `EndOfDayReview` → `DaySummaryCard`, printing `eaten / target kcal` for ONE day off the same
stored row — and falling back to a flat `?? 2000` when no goal existed, a number nobody chose
rendered exactly like one they had. It now takes `effectiveTargets` (the earned-scaled value
`energy-card` above it already receives) and hides the ratio and bar entirely when no target is
known.

`WeeklyNutritionChart` was left alone, as the entry instructed: a seven-day reference line has no
single day's earned movement to add.

## The tests, and their controls

Both were run against unfixed `main` before being trusted. This is the fourth session in a row where
that step changed the outcome.

- `e2e/bf175-one-day-budget.spec.ts` — drives the real sheet and reads the figure it prints. The
  fixture forces `nutrition_targets.calories` to `budget + 154` (the owner's own gap), because a
  seeded goal that happened to equal the budget would pass against the unfixed sheet. On `main` it
  fails at the denominator assertion: **printed 1964 against a budget of 1810** — the injected
  offset exactly. The locator is anchored on the sheet's own "Today after logging" row, not the
  first `/ N kcal` on the page, since the card behind the sheet prints one too and reading that one
  would pass against the bug.
- `components/nutrition/__tests__/bf175-day-budget-single-source.test.ts` — pins the shape. **9 of
  its 10 assertions go red on `main`**; the tenth (`budgetProvenance` is not called in the sheet) is
  a forward guard against the obvious wrong fix and is annotated in the file as such, so it is never
  read as evidence.

## Gate

`Ran 75 of 75` Custom Rules · 932 test files / 8,847 tests passed · `tsc --noEmit` and
`tsconfig.tests.json` both clean (no new baseline entries) · `next lint` 0 errors · `pnpm build`
green · e2e spec green on the fix, red on `main`.

## Not exercised

**Device.** The arithmetic is pinned by the e2e, but the green/orange flip at the S25 width — the
half that made the wrong number believable — has not been looked at on the phone. BF-175 therefore
stays in the queue with a `Keep:` line rather than being removed, and carries a Known-Issues row.

Also untouched here: native SQLite / Capacitor paths, safe-area insets, drifted production data
(the local seed is fresh), Samsung WebView rendering.

## What the CI run cost, and what it was worth

E2E went red twice and neither failure was this PR's. Getting to that took two runs, four local
runs of one spec and three of another, and it turned up two things worth more than the merge.

**Run 1** lost `diary-nested-meal:231` and `:207` to `browser.newContext: Target page, context or
browser has been closed` — chromium had taken SIGSEGV, so no test body ran — and
`la109-back-from-subroute:87` to a real 30-second `toBeVisible` timeout on Home's greeting. That
last one has the shape of a genuine regression on a PR that touched UI. It passed the re-run
untouched and passed **four** consecutive local runs, and its path (`/health` → Home →
`/health?tab=training` → back) never visits `/nutrition`.

**Run 2** failed on something else entirely: `rv38-body-battery-no-data-badge:30` — the spec I filed
**LB-114** about yesterday, as red 07:00–08:00 Brisbane. This run was 00:06–00:40 Brisbane, outside
that window, so the entry did not excuse it.

**My own entry was wrong, and checking rather than citing it is the whole lesson.** `batteryConfidence`
clamps with `Math.max(0, wakingMinutes)`, and before 07:00 local the 07:00 default wake time is *in
the future* — so the future-wake guard at `app/api/body-battery/route.ts:172` falls back to
`firstHrTime ?? todayMid`, and an account with no data has no HR rows. It lands on **local
midnight**. There is a second red window at **00:00–01:00**, with a different cause in a different
file. Confirmed by natural experiment on one checkout: red at 00:41, 00:46 and 00:50, green at
01:06; and CI's own split, 23:36–00:01 green against 00:06–00:40 red on the identical commit.

LB-114 had told the next session *"Do not verify outside that window"* — which would have sent them
to verify a fix in the one window that cannot show the other half working. Corrected, with the
verification step now naming both.

The browser crash is filed as **LB-119**: it has now appeared three times across two days with an
identical faulting address, and the expensive half is not the obvious crashes but `la109`, which was
indistinguishable from a real regression until the one permitted re-run was spent finding out.

## Filed, not fixed

`LB-118` (Lane A) — the explain page's `signals` block omits sore-tick provenance, which is what
parks `LB-117`. The LB-117 entry claimed *"the data is there"*; true of the repository, false of the
payload the page renders. The Lane-B-only workaround (`GET /api/mood`) is recorded in both entries
as the **wrong** answer: `next-session` is cached and the check-in can be edited after the score was
computed, so a separate fetch can explain a recommendation with inputs it never used.

<a id="2026-09-17-chore-or-119-journal-fold"></a>

# 2026-09-17 — the compaction sweep, and the owner gate that was guarding a settled question

**Branch:** `chore/or-119-journal-fold` · docs only. No product code.

## LA-100's premise was stale, and it was holding an owner gate

The entry blocks the compaction sweep on a documentation-structure decision: there is *"nowhere
obvious to fold them TO"*, because the batched history files are *"era-based, not date-based"* while
the per-entry convention is dated, and *"nothing bridges the two"*.

**Measured before acting: 28 of the 32 history files are dated** — `history-2026-07-16.md` through
`history-2026-09-10-folded-6.md`. Four carry era names (`-newest`, `-recent`, `-newer`, `-past`), and
LA-100 itself calls those **frozen**. `scripts/fold-journal-entries.js` has written
`history-<date>-folded-<part>.md` since LA-80, rolling a new part near 250 KB.

So the entry's option 1 — a dated batch — is not a decision anyone needs to take. **It is what the
repo has done for two months and what the tooling already implements.** The owner was gated on
choosing a convention that precedent and the code had chosen for them.

`Gate: owner` removed, and the sweep ran on that basis.

**Its "BLOCKING, not blocking-ish" upgrade is stale too.** That was written when the entries ceiling
was a hard CI failure every lane's next PR would hit. It is an advisory note now — *"Not a failure;
sweep it when convenient"* — so the +1-per-PR treadmill it describes cannot happen.

## The sweep

**91 entries → 51.** Forty folded into `history-2026-09-17-folded-1.md` (163 KB, inside the roll
threshold), **five held back because an agent baton cites them**, citations rewritten across nine
files. `check-doc-links` clean on 823 files.

What is left open is smaller than the entry and is not the owner's: whether the four era-named files
are ever renamed. Nothing cites them by scheme and they are frozen, so probably never — a judgement
for whoever next touches them, not a blocker on folding.

## The gate I skipped on Tuesday, written into the baton

PR #1247 turned `main` red for every lane. Restructuring Q-305's `Keep:` removed a `Gate: device`
that `keep-gate-set-off.test.ts` **pins by name**, and no documentation check can see that.

**`pnpm ci:local` already existed and would have caught it** — it runs lint, `check:rules`,
typecheck, typecheck:tests **and the test suite**. I ran `check:rules` alone. No new tooling was
needed; I skipped the gate the repo already had, on the reasoning that a backlog-only change could
not break code.

The Orchestrator baton said *"`pnpm check:rules` is the only custom-rules gate"* — true, and it reads
as sufficient. It now says plainly that `check:rules` is **not** the pre-push gate, with the
sentence that generalises: **a queue restructure is a code change to the tests that pin the queue.**

## Result

`docs/overview/entries/` **91 → 51**. Queue **350**, one owner gate removed.

`check-doc-links` OK on 823 · `check-backlog-pointers` clean on 350 · `pnpm ci:local` green
(**Ran 75 of 75** Custom Rules steps).

**Surfaces not exercised:** none apply — documentation only. No product code, so nothing reaches the
APK from this PR.

<a id="2026-09-17-fix-bf172-session-fit-not-readiness"></a>

# 2026-09-17 — `fix/bf172-session-fit-not-readiness`

**BF-172** — the "Why <session>?" screen called the session-**fit** score "readiness". v1.457.9.

`overallScore` is `recovery·w + balance·w + freshness·w` from `computeAiDynamicNextSession`: how well
this session fits today, given what is recovered and what is overdue. Nothing about it measures the
lifter. The ring captioned it *"Overall readiness for this session"* and ran it through `scoreBand`,
so the owner's screenshot reads **84 HIGH** in green directly above `SignalSections` printing *Oura
readiness 37 · Low*, *HRV well below your usual*, *Deload: strong deload advised*, energy *drained*.

Same class as BF-154: a number correct in its own terms, under a caption belonging to the quantity
it replaced. Nothing is miscomputed, and the arithmetic is untouched.

## The fix

Caption is now *"How well this session fits today"*, and the ring prints **Strong fit / Fair fit /
Poor fit**.

**The fit words are mapped from `scoreBand`, not derived from the score.** CLAUDE.md bans
re-deriving the 70/50 thresholds with local label strings — two divergent copies have been found that
way — so `scoreBand(score)` still owns the thresholds and the colour and only the vocabulary is
remapped (`High → Strong fit`, `Moderate → Fair fit`, `Low → Poor fit`). `scoreBand` itself is
untouched, and its ~15 other callers are all scoring real readiness and are correct.

## Two of the entry's instructions were adjusted, both for rules it had not checked against

- It offered *"either no band word or a fit-specific one"*. **No band word is not available here.**
  The ring and the number are band-coloured, and `score-ring.tsx`'s own comment records that the
  label exists so the band is not carried by colour alone — dropping it would reintroduce exactly the
  colour-only state that comment was written to prevent. Shipped with the fit-specific word.
- It said change the band *"at this call site, not inside `ScoreRing`"*. That caution is right about
  `scoreBand`, which has ~15 callers. But **`ScoreRing` is session-explain's own component with
  exactly one caller** — `app/session-explain/components/score-ring.tsx`, used only by
  `session-explain-content.tsx`. The `ScoreRing*` symbols in `components/more/home-widgets-section.tsx`
  and `components/oura-score-chip-row.tsx` are an unrelated home-preference type, which is what makes
  a bare grep for "ScoreRing" look like a shared component. The vocabulary lives in the component,
  where it cannot leak, and a comment says so.

## What was verified

- `app/session-explain/__tests__/bf172-fit-not-readiness.test.ts` — **4 of 6 assertions fail against
  `main`**. The other two are pins: `scoreBand`'s three bands are unchanged, and there is no local
  threshold arithmetic. One assertion walks every band so a new one cannot render `undefined`.
- `e2e/bf172-session-fit-not-readiness.spec.ts` — **passes**, and **fails against the unfixed
  screen**. It stubs `/api/next-session` with the owner's screenshot: fit 84 over readiness 37 with a
  strong deload advised. The entry said browser is enough, and this is that.
- Full suite **7583 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**No `Verify: device` field.** The entry judged the browser sufficient and the browser now holds the
reproduction; nothing here is native, offline-first, safe-area or gesture. What the stub does not
cover is a real recommendation payload — the numbers on screen came from a fixture, so the screen has
been proved to *label* correctly rather than to label real data correctly.

<a id="2026-09-17-fix-lb116-checkin-sends-suggested-sore"></a>

# 2026-09-17 — `fix/lb116-checkin-sends-suggested-sore`

**LB-116** — the check-in sheet knew which sore ticks it had suggested and threw it away. v1.457.10.
Also removes **BF-172** from the queue, which #1268 shipped and left sitting with a ✅.

BF-173 shipped the engine: `mood_logs.suggested_sore_muscles` (migration 276), the repository write,
and a scorer that clamps only ticks *not* in that list. The sheet computes the list already — it is
the `suggested` state the pills are drawn from — and never sent it.

`suggestedSoreMuscles: suggested` now goes on `leanPayload`, which is what reaches all three writes:
`store.upsertMoodLog`, `store.queueMutation` and the `/api/mood` fallback POST. The optimistic
`MoodLog` carries it too, so the card behind the sheet does not flash a different shape.

## It touched a Lane A path, deliberately and narrowly

`MoodFieldsSchema` (`packages/shared/src/validation/mood-log.ts`) had to gain the field. The schema
has **no `.strict()`**, so Zod drops an unknown key rather than rejecting it — without that edit the
sheet's value would have been silently stripped on both the route and the outbox branch, and the fix
would have shipped inert with a green test suite and a 200 response.

One optional field, bounded like its sibling, named by the entry and delegated by the lane that owns
the file. Unlike OR-118 — where the missing piece was a whole route and the work was parked — this is
a single key with the column, the write and the scorer all already shipped. Flagged here rather than
done quietly.

## The e2e was written, run against `main`, and deleted

A browser test that saves a check-in and reads `mood_logs.suggested_sore_muscles` back **passes
against unfixed `main`**. `saveMoodLog` derives the list when the caller sends none, so the column is
non-null either way and the assertion cannot tell the sheet's value from the server's guess.
Distinguishing them needs control of the recovery feed the harness does not have.

Deleted rather than shipped green. A vacuous test is worse than none because it answers. The unit
test carries the proof instead: **4 of its 6 assertions fail against `main`**, including a real
`MoodFieldsSchema.parse` round-trip — exactly the strip this fix is about — plus bounds checks and an
assertion that the field stays optional so `saveMoodLog`'s fallback keeps working for older clients.

**Three harness traps cost time here and are worth naming**, because each reads as "the sheet did not
open": the morning check-in is a separate Radix modal that marks everything behind it `aria-hidden`
(suppressing it does *not* seed a mood row, so the readiness card still appears); the sheet
auto-opens when there is no mood row, so the "Log Readiness" card is a fallback path rather than the
way in; and **the muscle pills are `role="checkbox"`, not `button`**, so a button query finds nothing
at all.

## What was verified

- `components/__tests__/lb116-checkin-sends-suggested-sore.test.ts` — 4 of 6 fail against `main`.
- Full suite **7607 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**NOT exercised: the two cases that motivate the entry.** Neither the volunteered-muscle-that-would-
have-qualified case nor the offline check-in is covered by any test — the first needs a controlled
recovery feed, the second needs the device. The engine half's own tests
(`sore-muscle-provenance.test.ts`) pin what the scorer does with each input; what is untested is the
sheet producing the right input in those two situations.

<a id="2026-09-17-lane-a-bf171-muscle-name-matching"></a>

# 2026-09-17 — BF-171: the session picker was the one consumer matching muscle names raw

**Branch:** `lane-a/bf171-muscle-name-matching` · **Lane A** · no migration · shipped behind BF-173, which its `Needs:` required

## What was wrong

`sessionRecoveryScore` compared muscle names with exact lowercased equality, on both sides. Two limbs:

**A sore "Back" clamped nothing.** The check-in offers **Back** as a pill. The exercise library has
no muscle called `back` — it has `lats`, `upper back` and `traps` — so the comparison matched none of
them. Measured before the fix: adding `Back` to the sore list moved **every** session score by zero.
A lifter whose back is wrecked was recommended Pull and Upper at full confidence.

**`core` never found its own recovery.** `computeMuscleRecovery` keys its output through
`normalizeMuscle`, which folds `core` → `abs`; the assignments it was matched against say `core`. The
lookup missed, and a miss returns **100** — so a synonym mismatch was indistinguishable from a fully
rested muscle, while the real value sat in the same payload at 86.

**This was the seventh consumer, and the only one matching raw.** `moodMuscleMatches` exists in
`packages/shared/src/muscles.ts` for exactly this job and is used by `per-exercise-deload`,
`signals` (twice), `soreness-volume`, `suggested-soreness` and `workout-data` (twice). The one that
*picks the session* was the exception.

## What shipped

`recoveryPct` compares `normalizeMuscle` on both sides. The sore test becomes
`lifterAdded.some(label => moodMuscleMatches(muscle, label))` — a list rather than a set, because a
pill is a broad **region** covering several catalogue muscles, so membership was never the right
question.

No synonym list was hand-rolled here. `muscles.ts`'s own header records cleaning up exactly that
divergence once already.

## It composes with BF-173, and that needed checking rather than assuming

BF-173 (merged hours earlier) had just made the clamp fire only for **lifter-added** ticks. BF-171
changes which muscles a tick *reaches*. Shipped in the wrong order this entry would have made the
recommendation worse — every newly-matched muscle would have been fed into a live double count,
which is what its `Needs: BF-173` was protecting. A test pins the composition: a **suggested** `Back`
tick still does not clamp, even though it now matches three muscles it previously matched none of.

## The both-directions check the entry demanded

The entry refused to be done until the fix was measured moving scores in both directions, because
its two limbs cancelled in one place. Eight of the nine cases lower a score or leave it. **The one
that raises came from somewhere the entry did not anticipate** — normalising the BF-173 provenance
filter, not the name matching. Stored provenance saying `Core` against a tick saying `Abs` were two
different strings under the old lowercased comparison, so an accepted suggestion read as
lifter-added and clamped to 40. They are one muscle; it now falls through to its real 86. A mutant
reverting just that comparison kills the case, so it is load-bearing rather than incidental.

## Verification

- 9 unit tests; **5 of 9 fail against `main`** — checked by running them against `origin/main`'s
  version of the file, not by reasoning about it.
- **Mutation pass: 5 mutants, all killed** — each limb reverted separately, the provenance filter
  dropped, the secondary multiplier turned into the clamp, and the provenance comparison returned to
  `toLowerCase`. **Equivalent control** (`some(f)` → `!every(!f)`) stayed green.
- One case pins that matching stayed *specific*: `moodMuscleMatches` falls back to a substring test,
  so a `Quads` pill reaching a back session is a real risk and is asserted against.

**Not exercised:** the entry's production deltas (Legs 59 → 62, Lower 74 → 77) were **not
re-measured** — they came from a scratch harness against the owner's rows, and the fixtures here are
synthetic. No device: pure shared math, as the entry says. What is proved is the behaviour, not the
new numbers on his screen.

<a id="2026-09-17-lane-a-bf173-sore-provenance"></a>

# 2026-09-17 — BF-173: a sore tick only penalises when the lifter put it there

**Branch:** `lane-a/bf173-sore-muscle-provenance` · **Lane A** · migrations **276** + **277**, local SQLite **v39**

## What was wrong

The app pre-ticked soreness from its own recovery model and then penalised the same muscle a second
time for it.

`suggestedSoreMuscles` auto-selects any muscle trained within 48 h and under 85% recovered — reading
the recovery feed. `sessionRecoveryScore` then read **both** that feed **and** the resulting tick,
and applied `pct = Math.min(pct, 40)`. One fact — *"you trained legs 47 hours ago"* — counted twice,
with the second pass overwriting the model's own figure with a harsher flat one.

The owner confirmed the premise rather than it being inferred: *"It auto picked muscles for me i
didnt choose them manually."* That makes the double count the normal path, not an edge case.

Measured on his 2026-09-17 rows: quads scored **69** became **40**, chest **49** became **40**. The
flat floor also destroyed the ordering the recovery model had just computed — the very thing he was
asking about, that his legs were fresher than his push muscles. It changed the recommendation:
Lower 74 / Upper 84 as shipped, Lower **85** / Upper 84 with the leg ticks removed.

## What shipped

`mood_logs.suggested_sore_muscles text[]` (migration 276, `claude_ro` twin 277, local SQLite v39),
and `sessionRecoveryScore` now clamps only ticks that are **not** in it. An accepted suggestion falls
through to its own recovery pct, which already encodes the same fact.

**Provenance is recorded at WRITE time, never re-derived at score time.** Re-deriving is the option
the owner weighed and rejected — it suppresses the clamp whenever a muscle happens to be
under-recovered, discarding exactly the case the check-in exists for, the lifter telling the model it
is wrong. Recorded once, a muscle he volunteered keeps clamping even after its recovery later falls
below the threshold. A test pins that difference rather than a comment claiming it.

**NULL means "unknown", not "none".** A row written before the column existed cannot say which of its
ticks were suggestions, so it is scored the pre-BF-173 way rather than reinterpreted. An empty array
is a different and meaningful answer: *checked, none were suggestions*.

## The decision inside the decision

The owner chose provenance over suppression. **How** provenance is captured was mine, and it is the
one thing here worth arguing with later: the check-in sheet knows exactly what it drew, but
`components/` is the surface lane's. Rather than ship an engine with no caller — the TN-25 shape,
where a selector landed and nothing invoked it — `saveMoodLog` **derives** the list server-side when
the caller sends none, through the same shared function the sheet calls.

So the fix is live now, with a limit that is stated rather than hidden: a muscle the lifter
volunteered that *also* meets the suggestion conditions is indistinguishable from an accepted one at
the server, and for an offline check-in the derivation runs whenever the mutation reaches the server,
against a recovery feed that has moved on. Both are why the caller's own list wins when present, and
why **LB-116** is filed to send it.

## Expect the clamp to go quiet — that is correct

With provenance in place and an owner who accepts the pre-selection, no tick is lifter-added, so
`Math.min(pct, 40)` stops firing. Do not "repair" it. The recovery pct already carries the same fact.
The soreness-driven deload is untouched and this was verified rather than assumed:
`computePerExerciseDeload` takes `soreMusclesInSession` straight from the mood log and never reads
`sessionRecoveryScore` or the clamp.

## Verification

- 9 unit tests on the scorer, 6 DB tests on the write path. Full suite and `pnpm check:rules` green.
- **Mutation pass: 4 mutants, all killed** — the fix reverted, NULL treated as "all suggested",
  case-insensitivity dropped, and the clamp constant moved. **Equivalent control**
  (`!has(x)` → `has(x) === false`) stayed green.
- **A test caught a real gap rather than confirming intent:** `getMoodLog` did not map the new
  column, and `listMoodLogs` did not either — the "missed row→object mapper" class CLAUDE.md names,
  which fails silently as *"the save doesn't persist"*. Found by the read-back case, not by reading.
- The `claude_ro` twin was diffed against 274: the two differ by exactly
  `mood_logs.suggested_sore_muscles`, nothing else moved.

**Not exercised:** no device, no APK. The local SQLite v39 upgrade path is checked by
`check-local-column-upgrade-path.js` and the reconcile row, not by running on a phone. The
production figures quoted above are BF-173's own measurements and were not re-measured here.

## Filed, not left

- **LB-116** — the sheet sends the list it actually displayed (the accuracy and offline halves).
- **LB-117** — the explain screen will now list sore muscles that no longer lower the score, which is
  the Q-105 reads-as-broken shape. Filed rather than discovered later.
- **BF-171** was blocked on this entry (`Needs: BF-173`) and is now startable — correctly, since
  normalising more muscle names into a fixed double count is what made it worse.

<a id="2026-09-17-lane-a-tn46-baseline-already-retained"></a>

# 2026-09-17 — TN-46: the snapshot it called urgent was already on disk

**Branch:** `lane-a/tn46-baseline-already-retained` · **Lane A** · docs-only · no migration, no code

## What happened

TN-46 was filed as urgent: the owner's resting HR and HRV have moved sharply against two Retatrutide
doses, and the entry argued the pre-intervention baseline was being erased by the rolling EMA, so a
snapshot had to be captured before the comparison became unanswerable. Its recommended fix led with
a schema change to store that snapshot.

**The arithmetic was right and the conclusion did not follow.** `updateBaseline` does move ~1/32 per
night once mature — `ageDays > 14` takes `ashrRound(delta + bias, 5)` — so the live baseline is
genuinely being dragged from ~53 toward the new resting HR. What the entry missed is where baselines
live: **`oura_daily_summary` stores them per night, per row**, alongside `n_history`. Every historical
night keeps the baseline as of that night. Later drift cannot reach the 2026-09-06 row.

Verified against production **before** writing any code:

| row | stored RHR baseline | stored HRV baseline |
|---|---:|---:|
| 2026-09-06 (night before dose 1) | **52.875** | **56.125** |
| 2026-09-18 | 54.250 | 51.750 |

74 rows back to 2026-07-07, 73 carrying baselines, nothing pruning them. The snapshot a migration
would have created is already there with a date on it.

## What the entry keeps

The half that was never about storage: **join `supplement_logs` into the score audit and the
advisory**, so a flagged day names the medication and the most recent dose instead of implying
illness, and plot dose against vitals with a 2–4 day lag. No schema change, no deadline. That is now
the whole entry.

## The generalisable form

**A rolling aggregate that is checkpointed per period has no erasure problem, however fast it
adapts.** Before adding storage to preserve a value, check whether the value is already written down
somewhere with a date on it.

This is the **fifth** entry this session whose measurements were true and whose conclusion was not —
after LB-110, LA-110, TN-44, TN-37 and BF-137. The pattern is consistent enough to be worth naming:
the measuring is reliable, the inference from measurement to cause is not, and the cheapest guard is
to re-verify the *conclusion* against the code before building to it. That guard cost one production
query here and saved a migration.

## One correction carried forward

The entry's dose-response table ends at 09-17. The 09-18 row reads RHR **59.4** (from 64.9) and HRV
**47** (from 19) — the 1 mg excursion has begun to turn at day 5, matching how 0.5 mg behaved. The
entry's *"still falling at day 4"* was accurate when written and is no longer current. Recorded
because a stale trajectory about someone's own physiology is worth correcting explicitly rather than
letting the next reader infer it.

**Not exercised:** no code changed, so nothing to run beyond the queue checks. The production figures
are reads, not re-derivations — `rhr_baseline_mean_x8/8` as stored, not recomputed from raw nights.

<a id="2026-09-17-medication-blind-baselines"></a>

# Correlating vitals against dose, and the baseline that is erasing the chance

**Tuning agent · 2026-09-17 · branch `tuning/tn46-medication-blind-baselines` · docs-only**

Following the HRV collapse TN-45 surfaced, the owner named the cause — *"Id imagine its due to the
retatrutide"* — and then the actual ask: *"The idea was to be able to correlate change in vitals
with reta"*.

## A correction this agent had to make first

An earlier draft read `supplements.dose = '10mg'` as the administered dose and remarked that it
looked high against the trial protocols. **That was wrong. 10 mg is the vial strength** —
`supplement_logs` carries `vial_strength_mg 10, vial_water_ml 3, vial_units_per_ml 100`. The real
doses are **0.5 mg on 2026-09-07 and 1 mg on 2026-09-13**, a titration that starts *below* the
published protocols rather than above them. The remark is withdrawn. The trap stays on the entry:
anything reading `supplements.dose` for a dose gets a 20× overstatement, and
`supplement_logs.amount` is the real one.

## The dose-response was already in the data

| date | resting HR | HRV | dose |
|---|---:|---:|---|
| 09-04 → 09-06 | 52.6 / 52.5 / 51.7 | 59 / 50 / 56 | pre-dose |
| **09-07** | 48.4 | 63.5 | **0.5 mg** |
| **09-09** | **56.3** | **39** | peak, 2 days after |
| 09-10 → 09-12 | 53.8 / 55.0 / 54.5 | 43.5 / 49 / 45 | partial washout |
| **09-13** | 55.4 | 48 | **1 mg** |
| **09-16 → 09-17** | **65.1 / 64.9** | **28 / 19** | still falling at day 4 |

Doubling the dose roughly tripled the resting-HR excursion (+4 bpm, then +13) and took HRV from ~55
to 19. A 2–4 day lag to peak, partial washout after the smaller dose, no turn yet after the larger.
**The app holds the doses, holds the vitals, and plots neither against the other.**

## The decision, taken under delegation

Filed as **TN-46**, no gate. Retain a **pre-intervention reference baseline**; annotate, do not
correct.

The live baseline keeps adapting, because freezing it means a permanently depressed score and a radar
crying wolf nightly. But a **snapshot at the intervention date is kept as a reporting reference**, so
the delta stays computable after the live baseline has moved on. `supplement_logs` joins into the
score audit and advisory so a flagged day names the medication and the most recent dose. The overlay
is plotted **with a lag** — a same-day correlation finds nothing on data that plainly shows an effect.

> **⚠ CORRECTED 2026-09-18 — the paragraph below is WRONG, and it was this agent's error.** Lane A
> checked before building and found the pre-intervention baseline is **already on disk**:
> `oura_daily_summary` stores the baselines **per night, per row**, so the 2026-09-06 row still
> carries `rhr_base 52.875 / hrv_base 56.125` and later drift cannot reach back to it. Verified
> independently — 74 rows back to 2026-07-07 and nothing prunes the table. The EMA arithmetic was
> right; the conclusion did not follow, because drift only moves the *latest* baseline. There is no
> erasure, no deadline and no schema change. The sting is that this agent had the evidence in hand —
> it read historical baselines via `lag(rhr_baseline_mean_x8)` to compute the z-scores and still
> argued they were being lost. **The general rule, now in the readiness domain index: a rolling
> aggregate checkpointed per period has no erasure problem however fast it adapts — before adding
> storage to preserve a value, check whether it is already written down with a date on it.** See
> [`lane-a: the baseline was already retained`](#2026-09-17-lane-a-tn46-baseline-already-retained).
>
> **Also superseded:** the dose-response table ends at 09-17. The 09-18 row reads **RHR 59.4** (from
> 64.9) and **HRV 47** (from 19) — the 1 mg excursion turned at day 5, matching the 0.5 mg washout.
> *"Still falling at day 4"* was true when written and is not current.

**Why the snapshot is urgent.** `updateBaseline` moves ~1/32 per night, so the resting-HR baseline is
being dragged toward 65 and HRV toward 20. Within 30–60 nights every z returns to ~0 — `watch` stops
firing, readiness recovers, nothing physiological has changed, and the recovery reads as progress.
After that, *"what did this do to my vitals"* is no longer answerable from the baselines at all.

Cross-linked from TN-45 (copy must name what moved, never imply infection) and PS-44 (the strap week
now separates real physiology from ring drift).

## What was not exercised

Read-only queries against stored production rows, row-scoped to the owner. No code changed, no
scoring touched, nothing run on device. The physiological reading is an observation about data in the
app, not a clinical judgement.

<a id="2026-09-17-observed-max-175"></a>

# 2026-09-17 — a new observed max, and the owner's blend was right

**Tuning.** Docs-only. Checking whether the guided-walk changes (#1262, #1263) had landed turned up
no walks since they shipped — but it did turn up a **run on 2026-09-14 peaking at 175 bpm**, which
answers a question the owner parked by name.

## What was parked

He pinned the zone anchor at 178 — a 50/50 blend of his observed max (168) and the age estimate
(187) — over this agent's recommendation to use the observed max, and said: *"when the cooper 12
minute run is done and a new max is gotten; we can assess whats better."*

## The new evidence

**212 samples at ≥ 165 bpm across a nine-minute span** (11:05–11:14 Brisbane), 5 of them at 175, 13
at 174, 6 at 173. Corroborated by volume and duration, not a single spike.

| anchor | Zone 2 floor (RHR 52) | error vs 175 |
|---|---:|---:|
| observed 168 — the option rejected | 122 bpm | **−4 bpm** |
| **pinned 178** | 128 bpm | **+2 bpm** |
| age-predicted 187 | 133 bpm | +7 bpm |

**The blend was the better call, and the option this agent recommended would have been twice as
wrong.** A true max of at least 175 means 168 was never a ceiling — it was the highest he had
happened to reach, which is exactly the objection he raised at the time.

## What did not change

TN-30 stays open. The four anchors still disagree; the spread moved from 168-vs-187 to
**175-vs-178-vs-187**. `targetAnchorMax` and `resolveBatteryHrMax` should resolve to 175 rather than
168 once the new peak ages into their windows — **not verified here**, and worth checking before
anything is unified, because it shifts the walk targets and the Body Battery reserve on its own with
no code change at all.

The Cooper test still earns its place: 175 is a floor from a 21-minute run that was not a maximal
effort, not a measurement of the true max.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. The Zone 2 floors are
computed from the reserve formula at RHR 52, not read from the app. Every figure is the owner's own
rows through `claude_ro`, row-scoped to one user.

<a id="2026-09-17-rederive-would-fire-fever"></a>

# The re-derive nobody ran, and what it would do if they did

**Tuning agent · 2026-09-17 · branch `tuning/rederive-would-fire-fever` · docs-only**

Four owner decisions came back in one sitting, and answering the first one opened the largest
finding of the run.

## The four decisions, recorded

- **TN-45 — surface the illness `watch` band, quietly.** A calm line under the readiness score, not
  a banner. `Gate: owner` lifted. The lane was also wrong: the copy lives in `illnessAdvisory()`
  under `packages/shared`, so it is **Lane A then B**, not Lane B alone.
- **TN-30 — re-pin max HR at 181.** The owner ruled 175 the floor and the age-calculated 187 the
  ceiling, and asked for a number in between.
- **PS-44 — the overnight chest-strap window is on.** Seven nights of strap-and-ring overlap.
- **TN-44 / PS-41 — do not block on a Health Connect tester.** Build against synthetic data; the
  untested surface is recorded as open rather than silently assumed.

## The finding: Q-506's remedy is built, owner-gated, and would misbehave if fired today

`POST /api/admin/rederive-baselines` was built for exactly this defect on 2026-08-24 and has never
been fired. That is deliberate — BF-13's `Keep:` records the run as the owner's to fire, since it
writes production data. What is new is that it has sat a month, and what it would do. The stored
baseline confirms it has not run: temperature's deviation is **166** centi-°C against a true
nightly spread of **10.8** — still **15.4×** too wide, down from 18.7× when Q-506 filed it. Thirty
nights moved it 196 → 166, which extrapolates to about **fifteen more months** of waiting.
Temperature is the only one of five baselines that is wrong; the other four sit inside the normal
range for an EMA deviation.

That dead 40% weight is a complete explanation of TN-45's table. It is arithmetic, not bad luck:
resting HR and HRV **both maximally bad score 39**, one point under `watch`, and stay 39 at absurd
inputs because both saturate. All three non-temperature biomarkers maxed reach **64**, one point
under `elevated`.

**The part to act on:** replaying the fold cold and re-running the real radar per night, a corrected
baseline produces `normal` 51 · `watch` 3 · **`fever` 6** over sixty nights — and **four of the six
fever nights have healthy or neutral HRV**. A corrected deviation of 0.077 °C puts `FEVER_TEMP_Z`
at 0.19 °C above baseline when ordinary night-to-night spread is 0.128 °C. One night scores **37,
below `watch`, and is still flagged `fever`**, because `isFever` short-circuits the thresholds.

So: run it, but re-scale the threshold in the same PR, or the owner gets six fever banners and
25-point readiness penalties on nights he was fine. Working:
[`what the temperature re-derive would do`](../reviews/2026-09-17-what-the-temperature-rederive-would-do.md).

This does not block TN-45 — under a corrected baseline the two real `watch` days score **61 and 60**
rather than 41 and 36, so the band fires more decisively, not less.

## A correction to my own earlier note

I recorded the 175 bpm reading as coming from "a run". It was the **Cooper test** — `fitness_tests`
holds a `cooper12` on 2026-09-14, 1975 m in 720 s, avg 156, peak 175. That matters because the owner
had explicitly parked the anchor question until the Cooper was done. It was already done when I
wrote that the question was still open.

I also carried "the pinned 178" as the live ceiling. It is not: all 101 cached days in
`daily_zone_minutes` use **187**, the age-predicted value. The 178 is a queued decision that has
never shipped.

## What was not exercised

Everything is a replay against stored production rows in the sandbox. The re-derive route was not
run, not even in `dryRun`. No device, no APK, no UI. All row-scoped to the owner's own account.

<a id="2026-09-17-the-anchor-moved-itself"></a>

# 2026-09-17 — the anchor moved itself, and the guardrail did not notice

**Tuning.** Docs-only. Earlier today this agent amended TN-30 with a new observed max of 175 and
wrote that two resolvers "should now resolve to 175 rather than 168 … **not verified here**".
Discharging that flag is the whole of this entry, and it found more than it went looking for.

## The verification

`computeObservedHr` takes the **5th-highest** reading (`CORROBORATION = 5`) over
`OBSERVED_WINDOW_DAYS = 90`. Against production the top twelve readings are **175 ×5, 174 ×7**, so
the 5th highest is 175. **`targetAnchorMax` resolves to 175 today.** Not "will"; does.

## What that did on its own

With a 28-day mean resting HR of 54, the guided walk's 0.70 fast target:

| anchor | fast target |
|---|---:|
| 168 — what the entry assumed | 134 bpm |
| **175 — live now** | **139 bpm** |
| 178 — the pinned anchor | 141 bpm |

**TN-30 carries `Needs: TN-25` precisely to stop this**: unifying the anchor "raises the walk's 0.70
target from 133 to 140, so it must not land before the walk stops using it". **Five of those seven
bpm have already landed** — no code change, no PR, no announcement.

## The general lesson

**Sequencing a code change does not sequence a data-derived constant.** `Needs:` expresses "this
entry waits for that entry", and there is no way in the queue's vocabulary to say "this threshold
will move on its own when the user does something". The guardrail was written correctly and was
bypassed by a run.

## And it makes TN-25 worse

That entry's complaint is that the walk's fast target has never been met in 44 attempts. The target
rose from 134 to 139 while the owner's measured fast-block HR on the 35-minute walk ran **97 → 116**.
The gap widened by 5 bpm with nobody touching it.

## Why no new entry

The actionable work is already queued — TN-25 owns the walk target and carries a live `Keep:` from
#1263; TN-30 owns the anchors. A new entry would be queue noise for a fact two entries already need
to know. Both were amended instead.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. The resolver value is
computed by applying `CORROBORATION = 5` to production readings rather than by running
`computeObservedHr` itself, and the fast targets are computed from the reserve formula rather than
read from the app — **neither was observed in the running product**. Figures are the owner's own rows
through `claude_ro`, row-scoped to one user.

<a id="2026-09-17-the-app-saw-it-and-said-nothing"></a>

# 2026-09-17 — the app detected a real event and showed nothing

**Tuning.** Docs-only. A routine production read after TN-34/BF-13/TN-39 shipped turned up a live
physiological signal in the owner's data, and the tuning question it raised was not whether the
metric works — it does — but whether anything reaches the user. It does not.

## The finding

The illness radar's `watch` band has fired **twice in 72 days**, and on those days readiness averages
**32 against 64** on normal days. It is inert in two places at once: `ILLNESS_READINESS_PENALTY.watch
= 0`, and the Home banner returns `null` for anything below `elevated`. So the band described in its
own comment as *advisory-only* carries no advisory.

**The two bands that would produce UI — `elevated` (65) and `fever` — have never fired.** As far as
72 days of data show, the illness banner has never rendered. The only band that fires is the silent
one. Filed as **TN-45**, `Gate: owner`, because what appears on Home about the owner's health is his
wording to choose.

Two fixes are explicitly ruled out in the entry: raising the `watch` penalty (readiness already fell
to 31 on its own, so penalising again double-counts the same physiology — the gap is visibility, not
weight) and moving the thresholds (n=2 cannot support it).

## The correction that made the finding trustworthy

Reporting this yesterday, this agent also told the owner his **sleep had collapsed to 3.1 h**. That
was wrong. `sleep_sessions` holds sessions rather than nights, and five of the last thirteen days
record a **midday Brisbane fragment** as the day's only session — averaging a nap with a night
describes neither. That is PS-17, already 🔴 LIVE; it gains the current numbers and the consequence
the entry did not state: **any multi-day sleep average is unusable while it is live.**

**The physiological finding survived the correction because it was tested rather than assumed.** The
obvious confound — that short records mechanically depress overnight HRV — is false here: HRV
averages **50 ms on fragment nights against 45 ms on real ones**, and the two lowest readings in the
window (28 and 19 ms) both sit on genuine ~7-hour nights.

## TN-42 amended

Its "temperature is the binding constraint on readiness" framing was true structurally and wrong
about the present. Temperature has recovered to 84–96 and is now the healthiest contributor; the
current drag is `hrvBalance` (87 → 0 over six weeks) tracking the real event above. Amended rather
than rewritten, because both halves are true and only the emphasis misled.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. Every figure is the
owner's own rows through `claude_ro`, row-scoped to one user, and the most recent week is four days.
**No cause was diagnosed** — respiratory rate falling argues mildly against a respiratory infection
and the training taper argues against acute overreaching, but the data does not settle it and the
owner was given the measurement rather than a conclusion.

<a id="2026-09-17-tn22-retest-fails"></a>

# 2026-09-17 — TN-22's re-test fails, and the obvious explanation is wrong

**Tuning.** Docs-only. TN-22 sat at #5 in Lane A's ready list with its storage half already shipped
and its second half — *"on a re-test at n ≥ 30 the metric correlates negatively with readiness at
|r| ≥ 0.3"* — never run. Running it is Tuning's job, and it is cheaper than an implementer opening
the entry to find out.

## The result

| window | n | corr(`stress_high_minutes`, readiness) |
|---|---:|---:|
| since 2026-09-01 | 17 | **+0.562** |
| since 2026-08-20 | 29 | **+0.134** |
| TN-33's original | 18 | +0.072 |

The test wants **≤ −0.3**. Every window is positive, and the magnitude swings with the window — the
signature of a metric carrying little signal rather than one with an inverted sign.

## The explanation that was wrong

LA-112 shipped the day before, having found **41% of stress buckets were recorded during sleep**.
That makes contamination the obvious cause, and it would have been an easy story to write down.

**It is false.** `corr(stress_high_minutes, hours slept) = −0.133` over the same 29 days. Stress
minutes do not rise with sleep, so removing sleep buckets will not flip the sign on its own.

Worth recording because the plausible story and the true one point at different next steps: one says
*re-measure after LA-112 and it will resolve*, the other says *the scalar may not be about recovery
at all*.

## What does not change

**TN-33's autocorrelation result still stands.** The stress *series* has real temporal structure —
lag-1 +0.637 against a night-preserving null of +0.454. The daily *scalar* not predicting readiness
is a different claim. A signal can be real and not be about recovery.

**And this vindicates TN-34**, unwired the day before for firing off a number measured as carrying no
signal. This is that measurement on more data, still failing.

## What is owed

One re-test after ≈ 30 days of post-LA-112 data (≈ 2026-10-16), because every window above prices the
*old* metric. If it is still positive then, the honest next step is retiring the scalar rather than
re-tuning it — stated now so that conclusion is not treated as a surprise later.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. All correlations are
the owner's own rows through `claude_ro`, row-scoped to one user, and n is 17–29 — below the entry's
own threshold of 30, which is why the amendment narrows the `Keep:` rather than closing the entry.

<a id="2026-09-18-checkin-trend-and-method-traps"></a>

# Seven weeks of "ok", and two traps that nearly shipped as findings

**Tuning agent · 2026-09-18 · branch `tuning/tn50-checkin-trend` · docs-only**

Following the calibration sweep, the owner asked for whatever was learned to go into the backlog.
Two things did: one finding about him, one about how this agent works.

## TN-50 — the "self-report" is auto-filled from the score it feeds

Chasing why the `checkin` contributor under-delivers (TN-47 measured 6.5% of the score's movement
against a 10% weight), the first read of the stored `energy_level` column looked like a seven-week
slide: no `good` since 2026-07-30, `pumped` never logged, `low` the modal answer over 30 days.

**The owner corrected it before that reached a conclusion:** *"I dont really choose them; I let it
auto select … It should choose neutral by default. This was more a way to tune based on my response.
Not infer."*

He is right, and the code says so plainly. `mood-checkin-sheet.tsx:86` seeds the energy state from
`readinessToEnergy(readiness)` — its own prop comment reads *"Oura readiness score — sets energy
default"* — and `readiness-payload.ts:492` scores **today's** mood into **today's** readiness. The
loop closes inside a single day. Measured over the 62 days carrying both, the saved level is exactly
what the auto-select would have produced on **45 of them, 73%**, against roughly 20–25% by chance.
**So about 10% of the readiness weight is a re-reading of readiness on three days in four.**

`pumped` has never been logged because `readinessToEnergy` has **no branch that returns it** — not
because he never feels good. And `CHECKIN_ENERGY_SCORE.pumped = 100` is the only route to a readiness
of 100, which is why the ceiling is 87 across 65 days.

The 27% he *did* override is the only genuine signal in the column, and it disagrees in both
directions — readiness 37 saved as `good`, readiness 65 saved as `drained`. Exactly the independent
subjective reading the term is for, drowned out on the rest.

**The first draft of this entry drew the wrong conclusion from the same column**, and TN-50 keeps that
visible rather than quietly fixing it: anything else reading `energy_level` as a self-report will make
the same mistake. It also means TN-47's 6.5% figure is not independent and needs re-measuring.

Owner decision recorded: **default to neutral, do not infer.**

## PS-44 — the overnight window has not started, and the strap has never recorded at night

Binned by hour in Brisbane time over the whole of `rr_intervals`: **zero chest-strap samples between
22:00 and 05:00**, ever. Its mass sits 07:00–11:00, peaking at 53,685 samples at 08:00. The last
sample of any kind is 2026-09-15, two days before the decision was recorded. Night one is still owed,
and the entry's own "do not start the clock until the first night is in the table" guard held.

## Method — two traps, one mistake

Both went into the Tuning baton, because a baton carrying only *where I got to* lets the next session
repeat the *how*.

**Replay the shipped function; do not re-derive it in SQL.** Rebuilding the illness-radar z-scores by
hand got four things wrong at once — wrong column, wrong unit, wrong scale, and the same night's
baseline where the code uses the prior night's — and produced a temperature z of −25 that looked like
a live defect. Bundling the real module with esbuild and feeding it stored rows reproduced the
recorded score exactly, first try. A number that matches the stored one proves the replay is
faithful; a hand-rolled query has no such check.

**Bin by hour in the user's timezone, even in a throwaway query.** `rr_intervals.at` is UTC and
Brisbane is +10, so a chest-strap span printed as `00:00 → 02:04` reads as overnight and is actually
midday. That nearly became "the strap window has already started" in a report to the owner. The
repo's timezone rule reads as being about shipped code; it applies just as hard to the query you are
about to draw a conclusion from.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no
UI. Row-scoped to the owner throughout. TN-50 reports what he typed into a check-in sheet; it is not
a mood assessment.

<a id="2026-09-18-docs-rv57-remove-shipped-entry"></a>

# 2026-09-18 — RV-57 is finished, and its last open question is answered

**Lane B.** Branch `docs/rv57-remove-shipped-entry`. Docs-only.

## Why this exists: I left a shipped entry in the queue

RV-57's code merged in **#1299** and the entry stayed in `READY`. It surfaced on the end-of-session
re-scan, printing as the top item of a lane I was about to report as device-blocked.

**This is the third time today**, and the pattern is worth naming rather than just fixing: LB-116 and
BF-172 were both cut to their residue in earlier PRs of this same session, and the baton already
carries the lesson. Shipping the code and clearing the queue are two acts, and the second is the one
that gets dropped, because the PR feels finished when CI goes green. **The re-scan is what catches
it** — `next-item.js` after the merge, not before it.

## The question the entry was still carrying, now settled

RV-57's last bullet read: *"Not established: whether `getRecentTrainedDays(userId, 365, tz)` returns
365 or 366 calendar keys — the off-by-one at the far edge is unverified in either direction, and
importing the constant does not settle it."* Correct: the import did not settle it. Reading both
sides does.

**Supplier** (`lib/data/postgres/adapter.ts:1197`) queries
`startedAt >= todayMidnight − 365 days` and `startedAt < todayMidnight + 1 day`. That window spans
`ago = 0 … 365` inclusive — **366 calendar days**.

**Consumer** (`app/session-select/session-select-content.tsx`) credits `ago = 0` separately, then
walks `for (let ago = 1; ago < STREAK_LOOKBACK_DAYS; ago++)` — `ago = 1 … 364`. Together that is
`ago = 0 … 364` — **365 calendar days**.

**So they differ by one, and the direction is the safe one.** There is no `ago` the loop asks for
that the payload does not contain. That matters because it is precisely BF-176 inverted: there the
loop walked 365 while the route sent 90, so every lookup past the window read as a *rest day* rather
than as missing data, and the streak became a property of the window edge — the owner's count went
90 → 89 on a day he trained. Here the payload is the larger of the two, so no absent key can be
misread as rest.

**Deliberately not changed.** The only observable consequence is that an unbroken streak of 365 days
reports 365 rather than 366. Widening the loop to `<=` would make a constant named
`STREAK_LOOKBACK_DAYS = 365` drive a 366-day walk, trading a harmless cap for exactly the kind of
off-by-one ambiguity the constant exists to remove — and the case it would fix requires a year
without three consecutive rest days.

Nothing is owed, so the entry is removed rather than kept.

<a id="2026-09-18-feat-tn25-wire-walk-pattern-selector"></a>

# 2026-09-18 — TN-25: the guided walk's block structure is prescribed, not reopened

**Lane B.** Branch `feat/tn25-wire-walk-pattern-selector`, v1.458.0.

## What shipped

`recommendWalkPattern` landed on 2026-09-16 and **had no caller at all**, so the owner's ask —
*"I'd like the fast/slow rates to be varying and assigned to me"* — was not actually met by it: the
walk screen still opened on whichever preset was used last. This wires it.

- **`lib/walk/walk-pattern-config.ts`** (new) — maps a `WalkPattern` to `sets`/`fastSec`/`slowSec`.
- **`components/guided-walk/walk-config.tsx`** — reads the week's zone quota through the shared
  `cardio-week` key and applies today's pattern on open.

## The two things the selector could not supply

`recommendWalkPattern` deliberately returns block lengths and nothing else, so an HR-band change
cannot move the prescription. That leaves a gap the wiring has to close:

1. **No set count.** `WalkPattern` is `{id, label, fastMin, slowMin}` — a shared test pins that key
   list. Sets are derived from a fixed total: `round(30 / (fastMin + slowMin))`.
2. **No way to express a pattern with no alternation.** `steady_brisk` and `easy_steps` are
   **byte-identical in the table** (both `0/0`) and differ only in which block they are. One set with
   the other half at zero gives exactly that, because `buildIntervalPlan` drops zero-length segments
   — `steady_brisk` becomes one 30-min `fast` segment, `easy_steps` one 30-min `slow`. Collapsing
   them would turn a step-volume walk into a graded one, so a test pins the two apart.

**Duration is held at 30 minutes on purpose.** TN-25's own `⛔ One session, three variables` warning
is that 2026-09-09 changed block length, recovery and total at once, so nothing in the record
separates their effects. A prescription that also moved duration would repeat that confound; holding
it fixed makes block structure the single variable the selector moves.

## The decision TN-25 delegated to Lane B: pre-set, not suggest

The owner asked to have it *"determined for me"*, which argues for pre-setting — but the entry
flagged the hazard: `walk-config.tsx` autosaves `customConfig` on **every** config change, so a
prescription applied on open could silently overwrite the walker's own saved setup.

Handled rather than accepted. `Today` is a **fixed carousel slot at index 0**, reserved whether or
not the recommendation has arrived — so indices never shift under the selection when the fetch
resolves, and the autosave branch that writes `customConfig` never fires for it. Custom survives
untouched; swipe to it and it is exactly as it was left.

Auto-apply is guarded on a `touchedRef`, not on config content: a prescription that happens to equal
what is already showing is still the app's choice, and a walker who has already swiped has made
theirs.

## Verification, and what it cannot cover

- `lib/walk/__tests__/walk-pattern-config.test.ts` — 4/4. Pins the arithmetic, the two continuous
  patterns staying apart, and duration staying fixed across all four.
- `e2e/tn25-walk-prescription.spec.ts` — 2/2. Asserts the prescription reaches the steppers the walk
  actually runs from, and that Custom survives. Deliberately does **not** pin *which* pattern: that
  depends on the seeded week's Zone-2 gap, and pinning it would test the fixture.
- **Mutation-tested, both halves.** Dropping `setPresetIndex(TODAY_INDEX)` from the auto-apply turns
  both specs red; making `Today` autosave like `Custom` turns the second red at its flip-to-Custom
  assertion. Neither guard is decorative.
- `Ran 75 of 75` Custom Rules · tsc clean · tests-typecheck at baseline (320 errors, 90 files) ·
  lint 0 · component-size OK.

**Not exercised:** the S25 itself — GPS, cadence and the chest strap are unreachable from the web
harness, and a continuous (one-block) prescription has never been walked. `getLocalStore` returns
null on web, as always. That check is what TN-25's remaining `Keep:` line asks for.

## A correction to my own first attempt

The quota read was written as a hand-rolled `useEffect(… cachedFetchToday …, [])`, copied from
`running-plan-content.tsx`. That is one of the 36 sites frozen by `check-fetch-once-effects.js`, and
copying a frozen debt site is exactly what the check exists to stop — it failed the local gate.
Converted to `useCachedValue(..., { today: true })`, which is the rule: `cardio-week` is evicted by
four separate write groups and a fetch-once effect would never hear any of them.

<a id="2026-09-18-fix-la109-greeting-window"></a>

# 2026-09-18 — `la109-back-from-subroute` was red on `main` for three hours a day

**Lane B.** Branch `fix/la109-greeting-window`. Test-only; no app code changed.

## What was wrong

`e2e/la109-back-from-subroute.spec.ts:118` waited for
`getByRole('heading', { name: /Good (morning|afternoon|evening)/ })`.

`getGreeting` (`app/session-select/greeting.ts`) has **four** periods, not three — `night` from
21:00. So the assertion was red between 21:00 and 23:59 in the seed user's Brisbane
(11:00–13:59 UTC) and green the other twenty-one hours. It first bit on a CI run that started at
**12:34 UTC — 22:34 Brisbane**.

This is the hour-dependent trap CLAUDE.md's date-arithmetic rule names, and `greeting.ts`'s own
comment warns about it in the same words: *"a test that reads the real clock can only exercise
whichever period CI happens to run in."*

## How it was established, not assumed

The failure surfaced on an unrelated PR (#1299, RV-57), which touches
`app/session-select/session-select-content.tsx` — the component that renders the greeting. That is
close enough that "not mine" needed proving rather than asserting:

- **Control run on clean `origin/main` (8bf12172b7): the same spec, same failure.** So `main` itself
  was red on E2E, and the PR was not the cause.
- The failure page snapshot shows Home rendered **correctly** — `heading "Good night, Test User."
  [level=1]`, the URL `/`, the full Home tree beneath it. LA-109's behaviour was never wrong; only
  the regex was.
- After the fix, green in the **same night window** that had just failed.

## A red herring, chased and closed

The CI logs also carried a React hydration mismatch on Home — server `Tuesday 10 March`, client
`Friday 18 September`, inside `HeaderMetaRow`. That reads like a live SSR bug and is not one:
`e2e/day-rollover-checkin.spec.ts` installs a fake **client** clock at `2026-03-10 23:55` Brisbane,
deliberately, and the server keeps real time. Expected artifact of `page.clock.install`. Recorded
here so the next reader of those logs does not re-open it.

## The fix

Match the greeting by **shape** (`/^Good \w+, /`) rather than adding `night` to the list. Spelling
the periods out restores the same trap the moment a fifth is added, and pinning one period would
need the seed user's timezone — re-opening it from the other direction. The assertion only has to
prove Home's own tree rendered rather than the stale tab's, which is what the shape says.

<a id="2026-09-18-fix-lane-b-emphasis-markers-park-entries"></a>

# 2026-09-18 — two entries I wrote today were hidden by their own emphasis

**Lane B.** Branch `fix/lane-b-emphasis-markers-park-entries`. Docs-only.

## What was wrong

`next-item.js:97` treats a `⛔` **anywhere** in an entry as the legacy prose blocker. `TN-25` and
`OR-116` — the two entries I edited today — each gained one as *emphasis*, so both dropped out of
KEEP and into PARKED, printing:

```
unmigrated marker — length the app already uses (30 min) **deliberately** — this entry's own `⛔ One …
unmigrated marker — *⛔ So the obvious fix was the dangerous one:** passing a real resting HR would …
```

**The bucket is not the damage; the lost residue is.** A parked entry prints the first 90 characters
of whichever line held the glyph, in place of its `Keep:`. TN-25's residue is a device walk *and* a
month of compliance data, and none of that was visible. A session scanning PARKED for what is owed
would have seen a sentence about session duration.

Removing the two markers put both back: **PARKED 46 → 44, KEEP 28 → 30**, residue legible again.
One of the two was a `⛔` *inside backticks, quoting the name of another warning* — the parser does
not care about backticks.

## Why this is worth more than a fix

**The baton warned about exactly this, in a line I wrote myself earlier the same day**, and I then
did it twice within the hour. That is the argument for `LB-121` (filed here, for the Orchestrator
since `scripts/**` is theirs): knowing the rule is demonstrably not enough to follow it.

The asymmetry is the bug. A `Gate:` or an unmet `Needs:` already overrides the legacy marker; a
`Keep:` does not — though the script's own comment says *"a structured field is authoritative"*, and
`Keep:` is one. The recommendation is one clause, and it cannot hide a real block, because a residue
that is genuinely gated says `Gate:` inside its `Keep:` line and parks through the existing path.

## Found by reading PARKED

Not by a check — nothing fails. The baton's instruction *"also read PARKED (the console truncates
it)"* is what surfaced it, on a queue check whose expected outcome was "nothing to do". Four
occurrences so far: LB-116, TN-3b, TN-25, OR-116.

**TN-3b is left alone** — its `⛔` carries a real parking rationale, it is Tuning's entry, and
clearing it is the Orchestrator's sweep.

<a id="2026-09-18-fix-or116-lowest-hr-prop-name"></a>

# 2026-09-18 — OR-116 ②: the heart card's prop was misnamed, not miswired

**Lane B.** Branch `fix/or116-lowest-hr-prop-name`. No behaviour change.

## The suspicion, and why it inverts

OR-116 ② had stood open as a possible data bug, and the entry said so in the strongest terms:
*"Someone should establish whether `hrMin` is a deliberate proxy or an oversight before it is
'fixed'."* `/health/heart-rate` passes `data.hrMin` into `HrFactorsCard`'s `restingHr` prop, and
`hrMin` reads 50 where resting HR is 60.

It is neither a proxy nor an oversight. The card prints:

```
Lowest recorded today: {restingHr} bpm
```

`hrMin` **is** today's lowest recorded heart rate. The value, the sentence and the data always
agreed. Only the prop name lied.

**So the obvious fix was the dangerous one.** Passing a real resting HR would have left the card
printing a true number under a false sentence — a worse bug than the one being chased, and a less
visible one, because afterwards the name would finally match while the output quietly stopped being
true. The entry's instruction to establish the facts first is what stopped that.

## What changed

`restingHr` → `lowestHrToday`, in the component and its single caller, with the finding written into
the prop's own doc comment so the trap cannot be re-entered from the name alone.

## Checked, not assumed

- Exactly **two files** reference `HrFactorsCard` — the component and `app/health/heart-rate/page.tsx`.
  No other caller and no test pinning the old name (grepped across the repo).
- The nearby comment in `page.tsx` that mentions `data.hrMin` describes a different gate; left alone.
- `Ran 75 of 75` Custom Rules · tsc clean · lint 0 · component-size OK.

## Also filed here: LB-120

Five rebases of one PR in one afternoon, all conflicting on a single stored number, made the cause
worth writing down rather than absorbing: **the backlog's doc-size baseline collides on every pair of
concurrent implementer PRs**, because the protocol has each of them delete its own entry and so
change the file's line count. LA-33 already removed this class for documents in general; the backlog
is the one file where "two PRs touching the same document" means *every* implementer PR. Filed for
the Orchestrator with two options and the argument against the tempting non-fix (telling implementers
to skip the recompute — the check fails on slack, so that is just a red CI).

## Not exercised

The screen on the S25. OR-116 ③ is a device check and stays owed; nothing rendered changed here, so
there is nothing new for the device to show. OR-116 ① — what each of the three surfaces showing
resting HR is *for* — remains an owner decision and is untouched.

<a id="2026-09-18-four-rulers-and-body-composition"></a>

# What the score can and cannot say about this person

**Tuning agent · 2026-09-18 · branch `tuning/four-rulers-and-body-composition` · docs-only**

A calibration sweep against the owner's ask: make the results genuinely personal, using all the data
already being collected.

## The headline is a negative result, and it changes what to fix

The readiness composite is **robust**. Half its weight is baseline-relative, every one of those
denominators is wrong by a different factor, and correcting all of them moves the score by a **mean
of 0.4 points, max 4, with zero days moving more than 5** across 65 days. The nine weights average
the distortion away.

What the distortion wrecks is the **explanation**. `Z_POINTS_PER_UNIT = 50/1.5` rails a contributor
at ±1.5σ, and the personal baseline divides by a **mean absolute deviation** rather than a standard
deviation — MAD ≈ 0.798σ, so even a working baseline inflates every z by ~1.25×. Measured against the
true spread of the same rows: HRV **1.7× too hot**, sleep **1.6×**, resting HR roughly right,
temperature **17× too cold** (Q-506). Result: **hrvBalance reads exactly 0 or exactly 100 on 46% of
days**, sleepBalance on 29%. A rail cannot tell "a bit low" from "catastrophically low".

Split at the first Retatrutide dose, the ratios hold either side — HRV 0.67 pre / 0.65 during — so
this is the formula, not the physiology.

Filed as **TN-47**, scoped explicitly as an explainability fix carrying the 0.4-point measurement, so
nobody ships it as a re-score.

## The clearest win was not in the scoring at all

`body_metrics` carries a full bioimpedance suite on 49 of the last 90 days. Those columns appear in
18 files and **zero analysis modules** — stored, rendered as bare numbers, never interpreted.

Taken raw over the medication window: weight **−1.10 kg**, fat **+0.33 kg**, lean **−1.43 kg**. That
reads as *every kilo lost was lean, and then some*, which is alarming and is what the card shows.

It is mostly wrong, and the app already holds the column that shows why. Body water fell **1.04 kg**
across the same window, so **lean minus water is −0.38 kg** — inside scale noise. **Water explains
73% of the apparent lean loss.** The last eight readings move the right way: fat 25.7% → 25.2%,
muscle 39.4% → 39.6%.

Filed as **TN-48**, first in the recommended order, because it is the only one of the three that adds
an answer the user cannot get today and it needs no scoring change. Its guardrails are inline and
load-bearing: never show a lean-mass change without the water decomposition, show the reading count,
state the noise floor.

## Also found

**Seven days show a score that contradicts its own breakdown** (TN-49) — all consecutive, 2026-07-16
→ 07-22, off by −4 to −6, predating the 2026-07-22 weight rebalance. Their contributors were
re-derived; their score was not. And 40 of 65 rows carry no model stamp, with stamped and unstamped
ranges overlapping. This is a follow-on to Q-501, not a regression of it — storing the inputs is what
made it checkable.

**Two contributors are a floor with a label.** `prevDayActivity` has never scored below 57 in 65
days, `activityBalance` never below 51; together 15% of the weight supplying 7.4% of the movement.
Noted inside TN-47 rather than split out.

**A stale comment worth correcting.** `readiness-composite.ts`'s header still says Recovery Index is
*"always neutral/provisional … never scored"*. It has been scored since Q-500 fitted its 5-hour
anchor, and it is the 5th-largest driver of score movement.

## Checked and deliberately not filed

DB growth reads 224 MB against a 171 MB baseline — 1.7 MB/day against an expected 0.4. Already
attributed: `oura_raw_packed` is the archive, grows ~1.2 MB/day, is never pruned, and postdates the
baseline (BF-55, Q-283). No new entry. SpO₂, which looked like unused data at 98% coverage, is used —
sleep staging and the intraday curve.

## What was not exercised

Reads of stored production rows and replays of the shipped scoring functions, in the sandbox. No code
changed, no scoring touched, no device, no UI. Row-scoped to the owner throughout. The bioimpedance
figures are what the scale reported, not a clinical measurement.

<a id="2026-09-18-lane-a-bf176-streak-window"></a>

# 2026-09-18 — BF-176: the streak was a property of the window, not of the training

**Branch:** `lane-a/bf176-streak-window` · **Lane A** · no migration

## What the owner saw

*"My streak went from 90 → 89? Can we check to see what it should be and why it went down"* — **on a
day he trained.** His real streak is **102 days**, unbroken since 2026-06-08 under the app's own rule
(two rest days allowed, the third breaks).

## The mechanism, which is worse than a clipped number

`app/api/streak-data/route.ts` sent **90** days of `trainedDays`. The loop consuming it
(`session-select-content.tsx:1008-1030`) walks back **365**. Past day 90 every lookup returns
`undefined` — and the loop reads `undefined` as a **rest day**, not as missing data. Three of those
and it breaks.

So the count was pinned to the window edge. **Once the real streak exceeds the window, the number
stops describing the lifter and starts describing where the edge lands.** It went 90 → 89 because the
edge slid off a rest day (2026-06-20) onto a trained one (06-21), and the day that dropped out of the
payload was trained. It would have oscillated between ~88 and 90 indefinitely.

That is why a supplier sending less than the consumer walks does not under-report by the difference.
It reports a property of the window.

## What shipped

`STREAK_LOOKBACK_DAYS = 365` in `packages/shared/src/workout/streak-window.ts`, imported by the
route. The number is shared **because the two files have to agree and nothing made them** — the old
shape had a local `90` in one file and a literal `365` in another, with no path between them.

## Tests state the defect as an experiment

The useful assertion is not "the number is bigger". It is that the number stops being a property of
the window:

- The same **300-day unbroken history** reports **90, 120 and 200** at three different window sizes.
  The lifter did not change.
- **The entry's pass test:** slide the window a day and the count must not move (it advances by
  exactly the one new trained day).
- A genuine break still breaks it — widening a window is not the same as never breaking.
- Two rest days stay *inside* the streak and are counted, pinning that the home loop measures
  **calendar days spanned** rather than training days.

The loop is **transcribed** into the test rather than imported: it lives in a component this lane does
not own, and the mismatch between it and the route is the thing being pinned. Importing it would
still have required modelling the window separately, and the copy is what makes the disagreement
visible.

## Filed, not fixed — LA-117

`app/api/friends/leaderboard/route.ts` computes **`allTimeStreak`** over its own
`STREAK_WINDOW_DAYS = 90`. Same defect, louder name: a field called all-time that structurally cannot
exceed 90.

The entry invited fixing it in this PR and it is one line. **It was kept out on purpose:** different
surface, nobody reported it, it changes a number other people see on a shared board, and this PR's
value was a one-constant fix whose verification surface should stay one screen. LA-117 carries the
two candidate fixes and the warning that the two streak implementations are **different quantities**
and must not be unified to make them agree.

## Verification

Full suite green by real exit code; `pnpm check:rules` 75 of 75; typecheck clean. 9 unit tests.

**Not exercised:** the streak card itself was not rendered — `/session-select` needs a session and
credentials login does not complete in this sandbox. The route returns a larger `trainedDays` map;
the arithmetic on top of it is pinned by the transcribed loop, not by a screen. **The `trainedDays`
payload is cached (`streak-data`, `TTL_LONG`) and stamped optimistically on workout completion**, so
the owner's card may show the old number until that cache turns over.

<a id="2026-09-18-lane-a-keep-parser-warning-prefix"></a>

# 2026-09-18 — LA-120: the queue tool offered three entries it should not have

**Branch:** `lane-a/keep-parser-warning-prefix` · **Lane A** · one PR · no migration · unversioned

Three defects in the same surface — what `node scripts/next-item.js --lane A` says you can start —
found by using it rather than by reading it. They share one shape: **an entry whose own text blocks
it, with nothing saying so in a field the tool reads.**

## How they were found

`next-item.js` offered **LA-76** as Lane A's next item. Re-verifying it against `main` (the protocol
step before implementing) turned up its own instruction: *"put that to the owner before writing the
migration."* An entry that tells you to stop was at the top of a list whose entire job is to answer
"what can I start now". The same run offered **LA-118** at #4 — whose code I had shipped that
morning.

## Defect 1 — a Keep prefixed with ⚠ did not parse

`keepFromLines` matched `- **Keep:`, `**Keep:`, and `- **Keep — …:`, but not `- **⚠ Keep:`. Four real
entries write that form — TN-49's three and LA-118's one — and all four were invisible to it, so they
kept their original (high) priority and read as unstarted work.

That is precisely the failure `scripts/lib/keep.js` was written to end, for the third time: the file's
own history records it happening to the colon requirement (Q-420) and then to the em-dash form (TN-3a
and TN-4 at #1 and #2 of READY). Each time the parser was narrow in a way nobody noticed until a
shipped entry was offered as buildable.

**Measured before widening, because that file's comments argue the case both ways** — anchoring too
tightly would "silently un-park genuinely blocked work, which is worse than the bug". Across all 144
`Keep:` bullets in the backlog, **140 matched and 4 did not, and all four were that one shape.** So
the widening is `[^\w\n]{0,3}` between the asterisks and the word: **non-word only**, which is what
keeps the two documented false positives still refused — Q-420's `**Keep the stored field on 1–10**`
and any prose `The Keep:` both contain a letter before the word and still return null. Both are
asserted.

After the fix: LA-118 moves from READY to KEEP, and Lane A's READY list drops from 12 to 11.

## Defect 2 — LA-76's gate was removed for the right reason and never replaced

The owner settled LA-76's **rule** on 2026-09-14 (*"A deload week or session should still count as an
exercise so it wont decay cats"*), and the `Gate: owner` was removed on that basis. Correct as far as
it went. What the decision did not settle is the question the entry's own ⚠ raises: whether a deload
span becomes **first-class stored state**, which is what a dated `program_phases` interval commits to
and what the migration would build.

So the gate is back, saying which question it is waiting on — a different one from the answered one.
LA-76 now parks, and READY drops from 11 to 10.

**Written canonically rather than by widening a second regex.** The first attempt wrote
``- **`Gate: owner`, and it is…`` and the tool still called the entry READY: `next-item.js:76` anchors
the top-level gate to `^\s*[-*]\s*\*{0,2}Gate:`, and a backtick between the asterisks and the word
defeats it. Measured the same way — across the whole file, exactly **two** lines look like a Gate
field and are not parsed as one: mine, and a *continuation* line in BF-80 which the Keep path already
reads correctly (BF-80 parks). One instance is not a population, so the bullet was rewritten to the
form the parser expects instead of loosening a second matcher on a single example.

## Defect 3 — Q-220 was deferred with a written warning, and the warning did not work

Q-220 (*every session pays ~194,000 tokens of orientation*) carries a ⚠ added on 2026-09-15 by Lane A,
recording a deliberate deferral **specifically** *"so the next implementer does not re-derive the
reasoning and defer it again silently"*. Three days later Lane A reached it again — this session — and
re-derived exactly that reasoning, because prose at the bottom of an entry cannot reach a tool that
reads fields. It was #3 of READY with LA-76 parked, and #4 before that.

The deferral itself is sound and is not disturbed: what is queued there is Lever 2, a bulk move of
~207 open entries out of the one file five concurrent agents append to every session. Its failure
mode is not a merge marker but a silently dropped entry — the shape that put LB-4, Q-454, Q-455 and
Q-465 back into the queue three times — and Lever 1 already showed the specific hazard, with **19 of
72 ✅-marked entries still owing something**.

So it has `Gate: owner` now, with what would lift it. That is the honest field rather than a stretch:
the blocker is **a quiet window** (only the owner decides whether five agents are writing to
`projectOverview.md` while 207 entries move out of it) and **a structural decision** (where the open
Known Issues live changes what every session reads at orientation, with the multi-tag visibility risk
the entry already names). Neither is an implementer's to take. After the owner says yes it is the
Orchestrator's sweep, not this lane's.

**No new vocabulary was invented for it.** "Wants the Orchestrator" has no field — `Gate:` takes only
`owner` or `device`, `Reference:` means read-not-build, and `Needs:` names an entry that does not
exist. Adding a lane value would have meant changing `next-item.js`, `check-backlog-pointers.js` and
the six-agent contract in `docs/agents/README.md` from inside one lane, mid-flight, which is a
contract change rather than a fix. `Gate: owner` is true on the merits and costs nothing to revisit.

READY 11 → 10 with LA-76, and 10 → 9 with this.

## Verification

`scripts/__tests__/backlog-keep-residue.test.ts`, three new cases. Against `keep.js` as it stands on
`main`, **exactly one fails** — the ⚠ form — and the two refusal controls pass, as they must: the
original was stricter, so a test that only asserted refusals would prove nothing about this change.

The real check is the tool's own output, which is in the diff's effect rather than in an assertion:
**READY 12 → 9, KEEP 74 → 75** — one entry reclassified as shipped-with-residue and two parked.

## Not exercised

- **The S25 device.** Repository tooling and a backlog edit; nothing ships to the app.
- **Whether the other 140 Keeps still classify identically.** The widening can only match *more*, and
  what it newly matches is bounded by the non-word prefix — but no before/after diff of all 359
  entries' buckets was taken, only the READY and KEEP counts.
- **LA-76 and Q-220 themselves**, both now the owner's call and between them the reason this exists.
- **Whether `Gate: owner` is the right long-term field for "this is the Orchestrator's".** It is
  accurate for Q-220 on its own merits, but if a third entry wants the same thing, the answer is
  probably a lane value rather than a third stretched gate — and that is a contract change for the
  Orchestrator to make, not a lane.

<a id="2026-09-18-lane-a-la100-close-and-fold"></a>

# 2026-09-18 — LA-100 closed by running the sweep it said was impossible, and 40 entries folded

**Branch:** `lane-a/la100-close-and-fold` · **Lane A** · docs-only · no code, no migration ·
unversioned

## Why this was picked up at all

LA-100 sits on a standing do-not-take list that a scheduled routine carries. That list was compiled
**2026-09-12**; OR-119 resolved LA-100's blocker on **2026-09-17**. The exclusion was stale, and the
entry's own text said so outright — *"What stays open is smaller than the entry and **is not the
owner's**"*, with `Gate: owner` explicitly removed. Checking the entry rather than trusting the list
is the whole reason this was startable.

## What LA-100 claimed, and why none of it is true any more

**Claim 1 — "there is nowhere obvious to fold them TO",** because the batched history files are
era-based (`history-newest.md`, `-recent`, `-newer`, `-past`) while entries are dated. Measured:
**28 of 32 history files are dated**, and `scripts/fold-journal-entries.js` has been writing
`history-<date>-folded-N.md` since LA-80. Only those four carry the old scheme, and the entry itself
calls them frozen. The convention the owner was being asked to choose had already been chosen by
precedent and by the tool.

**Claim 2 — the file-count ceiling is "BLOCKING, not blocking-ish"** and every lane's next PR would
fail CI. It is an **advisory note** now (*"Not a failure; sweep it when convenient"*), so the
+1-per-PR treadmill it describes cannot happen.

Both were already recorded as stale by OR-119. What was missing was the last step: **the entry was
still in the queue**, which the protocol forbids for finished work, so every lane kept being offered
it.

## What shipped

**The sweep, run rather than described.** `node scripts/fold-journal-entries.js` — dry-run first —
folded **40 entries into `history-2026-09-18-folded-1.md`**, rewrote citations in four files
(`docs/domains/heart-rate/README.md`, `docs/domains/readiness/README.md`,
`docs/implementation-backlog.md`, `projectOverview.md`), and held back **5** an agent baton cites,
which is the tool's one deliberate refusal: rewriting those means one lane writing into another's
live state file. `docs/overview/entries/` went **80 → 40** files, 50 foldable → 21.

`check-doc-links` clean on **816 files**, run after the fold as the script's own output instructs —
not reasoned about, which is the trap its header documents: a link inside a folded entry loses a
directory level in both `../` and `../../` forms.

**LA-100 removed from the queue** (62 lines), and its one genuine residual moved to
[`docs/overview/entries/README.md`](entries/README.md) rather than deleted: whether the four era-named files
are ever renamed. Nothing cites them by scheme and nothing new lands in them, so the answer is
probably never — it is a judgement for whoever next touches them, which is why it belongs next to the
convention and not in a queue.

## Verification

Custom Rules **75 of 75** — and it caught something on the way: removing 62 lines from the backlog
failed `Orientation docs stay within their baselines` until `pnpm fix:baselines` was re-run. The
ratchet is shrink-only, so a *reduction* moves the baseline down and a stale one fails. Worth knowing
because the instinct on seeing that name is to assume the document grew.

`check-doc-links` OK (816) · `check-backlog-pointers` OK (358 entries).

## Not exercised

- **The S25 device.** Docs only; nothing reaches the app.
- **A second sweep to get under the 20-file threshold.** 21 foldable remain and the note is advisory.
  Folding again immediately would take this week's entries, which are the live reading window — the
  sweep is oldest-first by design and there is no value in emptying the window.
- **The four era-named files themselves.** Untouched, as intended.

<a id="2026-09-18-lane-a-la110-two-refutations"></a>

# 2026-09-18 — LA-110: two candidates tested and refuted, and the mechanism named

**Branch:** `lane-a/la110-two-refutations` · **Lane A** · docs-only · no code, no migration ·
unversioned

The earlier entry today measured LA-110's window (09-07 → 09-12, five sessions, one set per exercise
instead of two) and listed three untested hypotheses rather than guessing. This tests two of them.
**Still no cause** — what changed is that the search space is smaller and two answers that looked
right are off it.

## Refuted — it was not a baseline block

This was the strongest candidate, because a baseline phase produces the observed signature **by
design**. `app/api/workout-data/route.ts:265`:

```ts
const aiPrescription = isAiDynamic && !isBaselinePhase && aiPeriodizationState?.prescription ? … : null
```

`isBaselinePhase` forces the prescription to null, and an AMRAP baseline is a single set with no
prescribed percentage — one set, no `planned_pct`, no style name. Exactly the fingerprint.

**Production says it did not happen.** Every `session_periodization` row carries
`baseline_complete = true`, and not one is in a `baseline` phase — across the window the phases are
`deload`, `realisation` and `accumulation`. `isAiDynamicBaseline` was false throughout.

## Refuted — it was not BF-148 (#1117)

It looks decisive at first: it landed **2026-09-12 10:31 AEST**, inside the window, and it is about
the very flag above. It runs **the wrong way**. BF-148 *removed* a name-keyed term that had been
**vetoing** the baseline, so its effect is to turn one-set/no-pct behaviour **on**. The data has that
behaviour *ending* around then.

Worth keeping as a refutation rather than dropping quietly: the date coincidence is strong enough
that the next reader will find it too, and the temptation is to stop there.

## The mechanism, which is now specific

The pct, the style and the set count all descend from `aiPrescription`, which is null whenever
`session_periodization.prescription` is absent; `buildWorkoutExercises` turns that into what the
screen shows.

**All five sessions transitioned into `accumulation` between 09-09 22:24 and 09-12 00:50 UTC**, and
their replacement prescriptions were generated **09-13 → 09-16** (`prescription_generated_at`). That
brackets the broken/clean boundary at the **end** of the window exactly.

**It does not explain 09-07 and 09-08**, which precede every one of those transitions. Whatever left
those two days unprescribed either started earlier or is a second cause. That is the remaining
question and it is now a narrow one.

## The limit that cost an hour, recorded so it costs nobody else one

**`session_periodization` stores only CURRENT state.** There is no history of `prescription`,
`prescription_status` or `phase`. `prescription_generated_at` and `phase_started_at` are the only
dated columns and they describe the row's *latest* values, not what it held on 09-08. The window
cannot be reconstructed by query; confirming the mechanism needs a reproduction or a log.

## Not exercised

- **The S25 device.** Docs only.
- **The third hypothesis.** The outbox replay path (`sync-helpers.ts:113` omits `progressionStyle`
  unless every set has planned fields) is consistent with the data and causally silent. Untested.
- **A reproduction.** Which is, per the limit above, what this now needs.

<a id="2026-09-18-lane-a-la110-window-remeasure"></a>

# 2026-09-18 — LA-110: the missing-prescription window is five sessions, and the set count is the tell

**Branch:** `lane-a/la110-window-remeasure` · **Lane A** · docs-only · no code, no migration ·
unversioned

Lane A reached LA-110 as the first genuinely startable item after LA-76, Q-220 and Q-1a were gated.
Its own ⚠ from 2026-09-16 already says the entry's diagnosis is wrong and that what is owed is *"find
why seven sessions were written with no prescription"*. This is that measurement, taken fresh — and
it stops there, deliberately.

## What the fresh read says

Per user-local day over 30 days, live logs and live sets only:

| day | logs | no `style_name` | sets | no `planned_pct` |
|---|---:|---:|---:|---:|
| 09-04 · 09-05 · 09-06 | 5 each | 0 | **10** each | 0–2 |
| **09-07** | 4 | **4** | **4** | **4** |
| **09-08 · 09-10 · 09-11 · 09-12** | 5 each | **5** | **5** each | **5** |
| 09-14 → 09-17 | 5 each | 0 | **10** each | 0–2 |

**Five consecutive sessions, totally affected, clean on both sides.** 09-06 clean, 09-14 clean. Not a
drift, not a formula property — a state that began and ended.

## The part that is new, and it changes where to look

**The set count is the discriminator, not the nulls.** Every affected day logged **one set per
exercise**; every clean day logs **two**. A prescription that merely failed to persist would leave
two sets with null columns. Half the sets missing too means the exercises were presented with no
resolved style at all — `plannedPct`, `plannedReps` and the set count all descend from the same
`ex.progressionStyle` (`components/workout-screen.tsx:1270` →
`packages/shared/src/workout/log-exercise.ts:263`).

**And "no style id" is a red herring.** On **09-17**, a clean day, all five logs carry `style_id`
NULL while `style_name` is present and 8 of 10 sets have a pct. A null style id is ordinary here —
RV-32 drops an unowned one rather than refusing the whole log — so it cannot be the signature, and an
investigation keyed on it would chase a normal state.

## What I deliberately did not conclude

Three hypotheses fit the data and **none was tested**: that the program's session exercises lost
their styles for that week; that those five sessions came through the outbox replay path
(`sync-helpers.ts:113` omits `progressionStyle` unless *every* set has planned fields, which is
self-consistent with the observation and says nothing about cause); or that something else presented
the workout unprescribed.

Writing one of them into the entry as a cause is exactly the mistake LA-110 already documents twice —
it was filed with a rep-band diagnosis that a later measurement refuted, and its first proposed fix
turned out not to be implementable because `workout_sessions.phase_type` is NULL on every production
row. A third wrong cause is worse than none.

## Why the rest of LA-110 was not attempted

The entry's remaining work splits in two and **the second half is explicitly the owner's**: whether
those stored `estimated_1rm` values get recomputed. That rewrites history the app's PRs and
`target_80` read from the same column, so it is not confined to a trend line. The first half — the
cause — is what this narrows, and the fix shape is still undecided by the entry's own account
(*"a genuinely new like-for-like rule … a design decision rather than a wiring change"*).

## Not exercised

- **The S25 device.** Docs only.
- **Any of the three hypotheses.** That is the point of the section above, not an omission.
- **Whether the window recurred before 08-19.** The read is 30 days; the entry's own 60-day count is
  not re-derived here.

<a id="2026-09-18-lane-a-la117-leaderboard-all-time-streak"></a>

# 2026-09-18 — LA-117: a field called `allTimeStreak` could only ever report 90

**Branch:** `lane-a/la117-leaderboard-all-time-streak` · **Lane A** · no migration

## What it was

BF-176's defect, on a second surface, under a louder name. `app/api/friends/leaderboard/route.ts`
bounded its trained-days query at `STREAK_WINDOW_DAYS = 90` and then computed `allTimeStreak` from
the result. The owner's real best is **102**, so the board could not report it — and, as BF-176
established, a streak longer than its window does not under-report by the difference: it reports a
property of the window.

I filed this entry myself while shipping BF-176 and deliberately did not batch it, because it is a
different surface nobody reported and it changes a number other people see on a shared board.

## The sibling the entry did not name

`weeklyStreak` on the same route reads the **same clipped day list** (`longestWeeklyStreak(days)`),
so it was capped at ~14 weeks by the same bound. The entry named only `allTimeStreak`. Reading the
route rather than the entry is what found it, which is the sibling-surface sweep doing its job —
and it is fixed for free by the same one-line removal.

## What shipped

The 90-day `gte` is gone from the streak query; both fields now read every trained day. The route
carries a comment saying the cost was measured rather than assumed, and what to do instead if the
app ever grows a real user base (bound on rows and rename the field — do not quietly reinstate a
day window under a name that promises all-time).

## The measurement, because option 1 required one

The entry offered two fixes and made the cheap one conditional: *drop the window* only if the
unbounded scan measures cheaply, otherwise *rename the field* to `recentStreak`. Measured against
production on 2026-09-18:

- `pg_stat_user_tables` — `workout_sessions` is **133 rows / 96 kB** across the whole database.
  These are the physical-size and estimate columns respectively; the size is exact, the row count
  is a planner estimate, so it is quoted as the *shape* of the table rather than as a row total.
- `claude_ro.workout_sessions` — **113** exact rows for the owner, 2026-04-30 → 2026-09-16. That
  view is row-scoped, so this is the owner's history only.

Either way the table is small enough that dropping the bound is free, and the index is already
`(user_id, started_at)`. So option 1, on evidence rather than on preference.

## What was deliberately NOT done

**The two streak implementations were not unified**, per the warning the entry inherited from
BF-176. `computeStreak` counts **training days** with a rest allowance; the home loop counts
**calendar days spanned**. Both are defensible and they answer different questions — making them
"agree" would silently redefine what the owner's 102 means. `streak-window.ts` now says outright
that the leaderboard does not read `STREAK_LOOKBACK_DAYS`, so the next session does not unify them
by accident: 365 would cap an all-time field just as 90 did.

## Verification

`lib/data/postgres/__tests__/friends-leaderboard-route.test.ts`, 13 passing (was 10). Three new
cases, and the mutation pass ran against the unfixed route to prove each one earns its place:

| Case | Unfixed route | Fixed route |
|---|---|---|
| 121 consecutive days → `allTimeStreak` | **90** — exactly the number the entry predicted | 121 |
| …and `weeklyStreak` (probed separately, with the first assertion stubbed out) | **14** | 18 |
| 30 consecutive days → `allTimeStreak` (**deliberately equivalent control**) | 30 | 30 |
| two 10-day blocks 200 days apart | 10 | 10 |

The last two are the controls and they pass either way by design. Removing a filter is only safe if
it changes nothing for the rows the filter never excluded — and a fix that returned the *total
count* of trained days rather than the longest run would pass the first case and fail the last.

**Not exercised:** the S25 device. This is an engine-half change reaching the phone through a
Railway deploy with no APK, and `components/more/friend-leaderboard.tsx` was not touched — but the
number it renders changes, and nobody has looked at the card at 121 rather than 90.

<a id="2026-09-18-lane-a-la118-muscle-attribution-extract"></a>

# 2026-09-18 — LA-118: four copies of one query, and the decision none of them stated

**Branch:** `lane-a/la118-muscle-attribution-extract` · **Lane A** · no migration · unversioned

## What shipped

`weightedSetsByMuscle(db, { userId, from, toExclusive, dateColumn, programId? })`, private to
`periodization.ts`. `getWeeklySetsByMuscleGroup`, `getSetsByMuscleInWindow` and the
`weekly-muscle-sets` route are callers now rather than copies — three of the four gone, one left on
purpose.

The two things the copies disagreed about are **parameters**, which is the whole design. A caller
has to state its date column and its programme scope rather than inherit whichever one it was
copied from.

## The part that was not a refactor

`weekly-muscle-sets` had **no upper bound at all** — `el.logged_at >= weekStart` and nothing else, so
a log dated in the future counted toward this week forever. It has one now. That is the single
behaviour change in the diff and it is the defect the entry named. Nothing writes future logs today;
the sync path takes a client-supplied `logged_at`, so nothing structurally stopped one.

Everything else is intended to move no numbers, which is why the existing suites passing unchanged
is the actual verification rather than a formality.

## The date column had nothing holding it, in either direction

`getWeeklySetsByMuscleGroup` keys on `ws.started_at`; the other three key on `el.logged_at`. The
entry called this "the decision inside the extraction" and recommended keeping `started_at` only for
the programme-scoped caller, because its unit is a programme session and its two callers grade a week
against that programme's targets.

**No test pinned that.** Every fixture in the repo — mine from this morning included — set
`started_at` and `logged_at` to the same instant, so the parameter could have been flipped in either
direction and the suite would have stayed green. Extracting the copies into one function makes that
worse, not better: before, changing a date column meant editing one query in one file; now it is a
one-word argument at a call site.

So there is a test: a session **started 22:00 yesterday** with its sets **logged 00:30 today**. A
window covering only today sees the set through `getSetsByMuscleInWindow` and does not see it through
`getWeeklySetsByMuscleGroup`. It asserts that the two answers differ and that each is the intended
one.

## What was deliberately left

**`muscle-tonnage-trend` is still its own copy**, exactly as the entry instructed for a first pass.
It sums `weight_kg * reps` and buckets by week, so it shares the attribution half and nothing else —
folding it in means the shared function returns rows for the caller to aggregate rather than a
finished total, which changes the shape for the two callers that are already using it. That is its
own diff and its own gate. LA-118 stays queued with a `Keep:` for it, and notes the trap: the tonnage
route buckets on a local-date **string**, so a fold has to preserve that or its week boundaries move.

Until then the honest count is **two implementations, not one.**

## Verification

| Suite | Result |
|---|---|
| `muscle-sets-window-route.test.ts` | 13 passing (12 → 13, the new date-column case) |
| `weekly-volume-phase-target.test.ts` | 8 passing (6 → 8) |

Mutation pass — three mutations, one per decision the extraction had to preserve, each killed by
exactly the case written for it:

| Mutation | Killed by |
|---|---|
| `programId` scope ignored | *is not what getWeeklySetsByMuscleGroup would have returned* |
| `dateColumn` forced to `logged_at` | *attributes a set by logged_at, where the programme-scoped read uses started_at* |
| route's upper bound removed | *does not count a log dated in the future toward this week* |

The two **deliberately equivalent controls** survived, as they should: *counts sets logged today*
(so a bound that excluded today as well would not pass) and *defaults to the same 90-day window an
explicit request would name*.

Gate: Custom Rules **75 of 75**, `tsc --noEmit` clean.

**A local-run note worth recording:** running the two DB suites together produced
`Hook timed out in 10000ms` on **both** files while all 18 tests passed. Run separately, both are
green. That is local pool contention, the documented `docs/local-dev-database.md` gotcha, not a
result — and "2 files failed, 18 tests passed" is a shape worth recognising rather than debugging.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **The weekly card's own rendering.** `weekly-muscle-sets` now returns a bounded week, and while no
  production row should be affected — that needs a future-dated log to exist — nobody has looked at
  the card since the route changed.
- **`muscle-tonnage-trend`** is untouched and unread by this diff.

<a id="2026-09-18-lane-a-lb111-muscle-sets-window"></a>

# 2026-09-18 — LB-111: sets per muscle over a window, and the premise that had to be checked first

**Branch:** `lane-a/lb111-muscle-sets-window` · **Lane A** · no migration · unversioned (nothing calls it yet)

## What shipped

`GET /api/muscle-sets?from=&to=` → `{ from, to, muscles: [{ muscle, sets }] }`, backed by a new
repository method `getSetsByMuscleInWindow(userId, from, to, tz)`. Both params optional (default: the
trailing 90 days ending today in the user's timezone), both accept slashes or dashes, `to` is
inclusive, 400-day cap, `private, no-store`. Canonical muscle keys, secondary muscles at 0.5.

This is the engine half of OR-118's movement-balance card. Nothing served the number before: every
existing muscle-set route computes the current week server-side and takes no parameters, and
`muscle-tonnage-trend` is windowed but returns tonnage, which is not a substitute — legs move far
heavier loads, so a tonnage share overstates them and hides the pull-set deficit the card exists to
show.

## The entry's premise was wrong in the one place that decides the shape

LB-111 said the work was *"an exposure, not a derivation"*: widen `getWeeklySetsByMuscleGroup`, which
already takes arbitrary dates, and note that *"every route that calls it throws that away —
`weekly-muscle-sets`, `ai-periodization/weekly-volume`, and nothing else reaches it."*

`weekly-muscle-sets` **does not call it.** It carries its own inline SQL and only names the method in
a comment. The method's real callers are `ai-periodization/weekly-volume` and
`packages/shared/src/ai-periodization/signals.ts` — the second of which the entry does not mention.

That matters because of what else the method does: it scopes to **one `programId`**. LB-111 flagged
the `programId` decision as *"the reason this is not a one-liner"* and recommended counting across
programme changes. Widening the method to do that would have changed what its two existing callers
mean — both grade a week against *that* programme's targets, where scoping is correct. So the
honest answer is a second method, not a widened one.

## Measured rather than argued

The decision is pinned by a test that runs **one fixture through both reads**: two programmes, sets
logged under each, one 60-day window.

| | lats |
|---|---|
| `getWeeklySetsByMuscleGroup(…, newProgramId, …)` | **3** — the previous programme's sets are gone |
| `getSetsByMuscleInWindow(…)` | **7** |

It asserts the old method's behaviour rather than treating it as a defect, because it is correct for
its callers. It is in the file because the next session to read LB-111 will have the same idea.

## The finding underneath it: four copies

Checking the premise turned up the real state of this query. The same "weighted sets per muscle,
library rows by role and non-library rows by tag" SQL is written out **four** times and the copies
disagree:

| | date column | upper bound | programme scope |
|---|---|---|---|
| `getWeeklySetsByMuscleGroup` | `ws.started_at` | yes | **one `programId`** |
| `weekly-muscle-sets` (inline) | `el.logged_at` | **none** | none |
| `muscle-tonnage-trend` (inline) | `el.logged_at` | yes | none |
| `getSetsByMuscleInWindow` (new) | `el.logged_at` | yes | none |

The divergence is invisible from any one file, which is how it lasted: each copy carries a comment
saying it uses the *same main/secondary role weighting as* one of the others, and that part is true —
the 1.0/0.5 is identical everywhere. What differs is which timestamp a set is attributed to and
whether a previous programme counts, and no comment mentions either.

**Filed as LA-118 rather than fixed here**, deliberately, the same call as LA-117 during BF-176: the
extraction touches three live routes and one of them feeds a card, so folding it in would have put
this PR's verification surface across three screens to save one queue entry. LA-118 carries the table
above, the recommendation (extract parameterised on window + optional `programId`, keep
`ws.started_at` only for the programme-scoped caller) and the one thing not to do on the first pass.

`weekly-muscle-sets` having **no upper bound** is the copy that could bite: a log dated in the future
counts toward this week forever. Nothing writes future logs today, and the sync path accepts a
client-supplied `logged_at`, so nothing structurally prevents one. Recorded in LA-118 with a test to
add, not fixed here.

## Verification

`lib/data/postgres/__tests__/muscle-sets-window-route.test.ts`, **12 passing**, against real
Postgres. Mutation pass on the new helper — three mutations applied at once, and exactly the four
predicted cases went red:

| Mutation | Caught by |
|---|---|
| `to` made exclusive | *includes both named days…*, *accepts the slash form…* |
| secondary weight 0.5 → 1.0 | *weights a secondary muscle at half a set* |
| `normalizeMuscle` dropped | *folds synonyms to one canonical muscle* |

The suite also pins 400 on a date-shaped non-day (`2026-02-31`, which reaches the driver as
`[pg 22008]` and is otherwise recorded as a server fault), on a reversed window, and on a span over
the cap; and it accepts the slash form the client's `localDateString()` actually emits, which a
dash-only Zod regex would have rejected before the handler ran.

The **deliberately equivalent control** is *defaults to the same 90-day window an explicit request
would name*: it passes either way by design, and without it a change that broke the defaulting would
still pass every other case, since they all pass dates.

## Not exercised

- **No client calls this route**, so nothing user-visible changed and no version was bumped. The
  render is OR-118's, Lane B's, now unblocked.
- **The S25 device.** Server-only; it reaches the phone through a Railway deploy with no APK.
- **Drifted production data.** The fixtures are locally seeded. The one case worth naming: an
  exercise whose name is absent from `exercise_library` falls to the `muscle_groups` branch, where
  every tagged muscle counts at whole weight because there is no role to weight by. That is the
  existing behaviour of all three sibling queries, copied deliberately, but the local catalogue is
  smaller than production's.

<a id="2026-09-18-lane-a-q1a-bearer-session-engine"></a>

# 2026-09-18 — Q-1a (server half): a session resolved from `Authorization: Bearer`

**Branch:** `lane-a/q1a-bearer-session-engine` · **Lane A** · one PR · no migration · unversioned ·
**nothing user-visible changes**

Q-1a's scope is "the bearer-token client + an `apiUrl()` indirection". This ships the **server half
only**, which is the lane rule for a both-lanes entry (engine first) and, as it turned out, the only
half that can ship without an owner decision. The rest is gated — see the end.

## What the entry got right, and the two things it got wrong

Right, and it is the whole point: **`middleware.ts`'s deactivation gate reads `req.auth`, which is
the cookie session, and structurally cannot see a bearer.** So a bearer path cannot inherit that
enforcement and has to carry its own.

**Wrong (a): the failure mode.** The entry says a deactivated bearer holder would reach *"every
`/api` route"* with the 403 never firing. The 403 indeed never fires — but **PS-24 moved the real
enforcement into `auth()` itself**, which re-reads the users row and returns `null` for
`isActive === false`. Measured: **222 route files import `auth` from `@/auth` and none construct
NextAuth themselves.** So the answer is 401 rather than 200 — *provided the bearer resolves through
that wrapper*. Resolving it anywhere else is what would produce the bypass the entry describes, which
is exactly why the fallback was put inside the wrapper rather than in a helper each route calls.

**Wrong (b): the size.** `getToken` from `@auth/core/jwt` **already reads `Authorization: Bearer`**
(`jwt.js:92-94`), already prefers the cookie, and already returns `null` instead of throwing on a
malformed, re-signed or expired token. So the server half is a wiring job, not a crypto one, and no
token parsing was written by hand.

## The shape

`lib/auth/bearer-session.ts` resolves the token, runs `refreshIsActiveClaim` against the row, and
builds the session by calling **`authConfig`'s own `session()` callback** rather than a second copy of
the claim→session mapping — so a claim added there reaches a bearer caller without anyone remembering
a list. `auth()` calls it only when the cookie path yielded nothing, so a browser request is resolved
exactly as before.

Three details that are load-bearing and would be silent if wrong:

- **The salt is the cookie NAME.** `secureCookie` has to track `NODE_ENV` the same way
  `exchange-mobile-token` does; get it wrong and the derived key differs, so every valid token reads
  as invalid — a failure that looks like "bearer auth just doesn't work". A test mints under the
  other salt and asserts the refusal.
- **An inactive cookie session is a final answer**, not a reason to consult the header.
- **`headers()` throws outside a request scope**, and `auth()` is called from places that are not
  handling one. The chokepoint answers "not signed in" there; it never throws.

## Verification

`lib/auth/__tests__/q1a-bearer-session.test.ts`, **18 passing**. The tokens are **really encoded and
really decrypted** — `encode` from the module the app decodes with, same secret, same salt. A mocked
decode would pass against an implementation that verified nothing.

Three mutations, because "the file exists" is not a result:

| mutation | outcome |
|---|---|
| delete the module entirely | 13 fail — the weak one, listed for completeness |
| **drop the `refreshIsActiveClaim` call, keep everything else** | **4 fail**, including the deactivated-holder case — the security defect is caught specifically |
| weaken cookie precedence to `session.isActive !== false` | **17 passed — a gap** |

**The third mutation found a real hole and the suite grew because of it.** No case sent a bearer
*alongside* a cookie, so a rewrite that let an inactive cookie session fall through to the header left
everything green — and would have served a deactivated browser session as whatever identity the
bearer named. There is a case for it now, and re-running the mutation fails exactly that one.

Two cases also failed on first write and both were the fixture, not the code: `isAdmin` came back
`false` because the refresh takes it from the **row** (the rule
`admin-claim-not-authoritative.test.ts` already pins for cookies, inherited here for free). Both
directions are asserted now, since a resolver ignoring the lookup would satisfy either alone.

Gates: `tsc --noEmit` exit 0 · Custom Rules 75 of 75 · `check-test-typecheck` · full suite.

## What is deliberately NOT done, and why the rest is owner-gated

- **`apiUrl()` is not here.** It is an indirection for client fetch sites; with no callers it is dead
  code that reads as done.
- **The exchange route still returns only a cookie.** That step is where the exposure actually
  changes: the session token is httpOnly today, so XSS in the WebView can act as the user but cannot
  *take* a 30-day credential — once it is in JS and Capacitor storage, it can. **And there is no
  consumer yet:** the APK is a WebView on the same origin using cookies, and Q-1b, the separate
  origin that makes a bearer necessary, is the half the owner deferred. That is a decision worth
  making deliberately rather than inheriting from a scope line written in August, so the remainder
  now carries `Gate: owner`.
- **The server half stands on its own and adds no exposure**, which is what makes it separable:
  sending a bearer requires already holding the JWT, and today that means reading an httpOnly cookie.

## Not exercised

- **The S25 device.** No client change, no native change, no APK — a Railway deploy reaches it.
- **A real bearer request against production.** Nothing issues a bearer yet, by design, so the path
  is exercised by tests and by nothing else.
- **`__Secure-` cookie naming under a real `NODE_ENV=production`.** The salt branch is asserted by
  minting under the wrong salt and checking the refusal; the production *name* itself is inherited
  from `exchange-mobile-token` rather than re-derived, and has not been observed end to end.

<a id="2026-09-18-lane-a-rv51-merged-duplicate-exclusion"></a>

# 2026-09-18 — RV-51: the two exercises that looked hidden were duplicates, and two that were leaking went unnoticed

**Branch:** `lane-a/rv51-excluded-exercises` · **Lane A** · **no migration** · unversioned

## What the entry asked for

RV-51 found that `equipmentEligible`'s header justifies excluding an unlabelled exercise with *"an
empty list should not occur"*, and that production holds **two rows that do**: `Cable Lat Pulldown`
and `Dumbbell Lunges`. Since `equipmentEligible` is `.some(...)`, and `.some()` on `[]` is always
false, it concluded those two exercises are invisible to every program generator for every user, and
prescribed a **migration to label them**, with the pass test *"a generated full-gym program can offer
both names."*

Both measurements are correct. The conclusion inverts the situation, and the prescription would have
made it worse.

## Both rows are merged duplicates

One column the entry did not select settles it:

| row | equipment | `merged_into` |
|---|---|---|
| `Cable Lat Pulldown` | `[]` | → **Cable Pulldown** |
| `Dumbbell Lunges` | `[]` | → **Dumbbell Lunge** |

They are not hidden exercises. They are duplicates that migration 269 deliberately merged — 269's own
comment says so for `Dumbbell Lunges`, in the section below the backfill: *"a duplicate of `Dumbbell
Lunge`, so it wants a merge rather than an equipment value."* Their canonical rows are offered, and
the lifter loses nothing. Labelling them would have **un-hidden two duplicates**, and the entry's
pass test — offering both names — is the outcome to avoid.

## The real defect is the mirror of the reported one

`listExerciseLibrary` is **deliberately unfiltered**: `exercise_library` is global, and other
consumers resolve metadata for rows another user may still have logged. `mergedInto` is exposed so
each **picker** filters it. `components/workout-builder/builder-review.tsx:178` does. **`generate-program`
and `builder-chat` did not** — they were excluding merged rows only by the accident that these two
carry an empty equipment list.

Production holds **four** merged rows, and the accident covers only half of them:

| merged row | equipment | canonical | status before this PR |
|---|---|---|---|
| `Cable Crunch` | `['cable']` | Cable Crunch Abs | **being offered** |
| `Straight Arm Pulldown` | `['cable']` | Cable Pulldown | **being offered** |
| `Cable Lat Pulldown` | `[]` | Cable Pulldown | hidden, by accident |
| `Dumbbell Lunges` | `[]` | Dumbbell Lunge | hidden, by accident |

So the review noticed the two rows that were **harmless** and missed the two that were **live**. The
same query that produced the finding would have shown all four; it was one column short.

## What shipped

`if (ex.mergedInto) return false` in `app/api/generate-program/route.ts`, and `!ex.mergedInto` added
to the filter in `app/api/builder-chat/route.ts` — matching `builder-review.tsx`, which already had
it. **No migration.** The two unlabelled rows stay unlabelled, which is correct for a merged
duplicate.

## The open question the entry raised, answered

RV-51 asked whether migration 269 **missed** these two or something **wrote** them afterwards, noting
that `exercise_library` has no `created_at` — and that if it is the latter, the `POST /api/exercises`
guard has a hole and labelling two rows fixes nothing.

Neither. The guard is at `app/api/exercises/route.ts:39` and reads
`if (!body.mergeWithId && body.equipment.length === 0)` — **a merge request is deliberately exempt
from requiring equipment**, and both rows are merge-path rows. The guard is sound and the rows are
behaving as designed. No hole, nothing written around it.

## The header that caused this

`equipmentEligible`'s comment claimed *"an empty list should not occur"*. Two do. That sentence is
what sent the review looking for a data defect, and it is now corrected in place — it states the
counter-examples, says they are merged duplicates, and says outright that **a merged row is not this
function's job to exclude**, so nobody relies on the accident again.

A justification stated more strongly than its data supports is worse than no justification: this one
aimed a review at the wrong target and would have had it ship a migration that un-hid two duplicates.

## Verification

Two new files, **4 tests each**, asserting on the **prompt the model actually receives** — the shape
the sibling `injury-exclusion.test.ts` in both directories uses, and for its stated reason: an
instruction not to program a duplicate would pass a helper-level test and still let the model return
one.

The merged fixture row **carries equipment on purpose**. An unlabelled one passes against the unfixed
route and proves nothing — which is precisely the trap the production data laid.

| case | against unfixed route |
|---|---|
| merged duplicate that IS equipment-eligible is not offered | **fails** |
| the canonical row it was merged into is still offered | passes |
| merged duplicate with no equipment stays excluded (**deliberately equivalent control**) | passes |
| an ordinary exercise is still offered (**over-filtering guard**) | passes |

Mutation pass run separately per route; each killed exactly the first case. Both pre-existing
`injury-exclusion` suites still pass unchanged — **17 tests across the four files**.

Gate: Custom Rules 75 of 75, `tsc --noEmit` clean.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **A real generation against production data.** The fixtures mirror the four production rows but no
  program was generated against the live catalogue; the change can only remove names from a list, so
  the failure mode would be over-filtering, which the fourth test guards.
- **`Cable Crunch` and `Straight Arm Pulldown` disappearing from a live program.** They will stop
  being offered. Nothing re-writes existing programs, so anything already containing them keeps them
  — which is correct, and is why `listExerciseLibrary` stays unfiltered.

<a id="2026-09-18-lane-a-rv52-54-cache-eviction-gaps"></a>

# 2026-09-18 — RV-52/53/54: three cache keys that no write evicted

**Branch:** `lane-a/rv52-54-cache-eviction-gaps` · **Lane A** · batch `cache-eviction-gaps-sweep50` · one PR · no migration · unversioned

## What shipped

Three registrations in `lib/cache-groups.ts`, all verified against `main` before writing:

| key | groups before | groups now | argument |
|---|---|---|---|
| `weekly-review-month-window:` | **0** | 3 | its sibling `day-review-week-window:` was in 3 |
| `stress-day:` | **0** | 4 | `body-battery`, rendered by the same card, was in 4 |
| `collection` | not in `invalidatePrescriptionChanged` | added | that route computes its answer from the deload this group fans out |

RV-54 is the sharpest because the dependency is written out in the route:
`app/api/collection/route.ts` computes `pausedDays = [...restDays, ...earlyDeloadWeekDays(program)]`,
and `handleEarlyDeloadConfirm` (`session-select-content.tsx:887`) calls **only**
`invalidatePrescriptionChanged()`. Verified both ends rather than taking the entry's word.

For RV-52 and RV-53 the sibling is the whole argument: nothing distinguishes the two payloads' write
sensitivity, and one was registered while the other was not.

## A claim of mine that was wrong, corrected before it shipped

My first version of the RV-54 comment said the gap meant *"the collection ladder kept decaying
across a week the lifter had just marked as a deload."* That overstates it, and Q-262 exists exactly
to stop this being assumed.

Checked: both readers — `components/home/collection-card.tsx` and
`app/collection/collection-content.tsx` — use `useCachedValue` with **no `freshWithinTtl`**, and
neither is seed-only. `cachedFetchCore` always revalidates, so an unregistered key can only settle
stale in those two cases. **The real symptom was a briefly-stale first paint, not a week of decay.**

The registration still ships, for the reason Q-262 gives itself: a key that is inert today becomes
load-bearing the moment someone adds `freshWithinTtl` to a card reading a deload-sensitive number,
and that is not a change anyone would think to check this against. RV-52 and RV-53 carried the same
caveat in their own text and it holds for them too.

That is the difference between *registering a key because the rule says so* and *claiming a bug that
was not happening.* Both keys get registered either way; only one of those is honest in a comment.

## Verification

`lib/__tests__/cache-groups.test.ts`, **39 passing** (was 36). Against unregistered `cache-groups.ts`,
**exactly the three new cases fail** and the guard passes:

| case | unfixed |
|---|---|
| `invalidatePrescriptionChanged` clears `collection` | **fails** |
| `weekly-review-month-window:` is evicted wherever `day-review-week-window:` is | **fails** |
| `stress-day:` is evicted wherever `body-battery` is | **fails** |
| an unrelated group (`invalidateFriends`) gains neither key (**over-eviction guard**) | passes |

The two sibling cases assert a **pairing**, not a list of group names — the property that must hold
is that the keys travel together, which is what was untrue. A list of names would go stale the first
time a group is renamed or a fourth writer is added, and would then have to be edited to stay green,
which is the signal that a test is describing the code rather than constraining it.

RV-54 is asserted with **no session id**, because that is how the deload path calls it — the same
detail RV-49 turned on.

Gates: Custom Rules **75 of 75** · `tsc --noEmit` clean · `check-test-typecheck` none above baseline.

## Not exercised

- **The S25 device.** Client cache code, delivered through a Railway deploy with no APK — but the
  eviction runs in the WebView and nobody has watched a card repaint on the phone.
- **The live repaint.** The tests assert which keys a group evicts, not that a screen re-renders;
  those are different things, and the distinction is the one Q-402 was filed about.
- **Whether any of the three is load-bearing in practice** — checked for `collection` (it is not);
  RV-52 and RV-53 were left unchecked on that axis, as their own entries said.

<a id="2026-09-18-lane-a-rv55-56-route-input-500s"></a>

# 2026-09-18 — RV-55/56: two ways a client error became a server fault

**Branch:** `lane-a/rv55-56-route-input-500s` · **Lane A** · batch `route-input-500s-sweep50` · one PR · no migration · unversioned

Both entries describe the Q-496 shape: input the route should have refused reaches the driver, which
answers **500 with an empty body** and writes an `error_events` row. The caller learns nothing and
the fault table fills with client mistakes.

## RV-55 — the vial `id`, dropped rather than conflict-scoped

`POST /api/supplements/[id]/vials` accepted `id: z.string().uuid().optional()` and the adapter
inserted it unguarded. The **parent** was ownership-checked; the id was not — so re-posting another
user's vial UUID raised `23505`. No cross-user write occurred, but it was an existence oracle plus
fault-table noise.

The entry left the shape of the fix open: *"Decide first whether `id` should be accepted at all… If
it does, scope the conflict… If it does not, drop the field."* Answered by reading the callers:

- The only client POST is `components/nutrition/reta/vial-sheet.tsx`, sending `{ ...draft, openedOn }`
  where `draft` is `{ strengthMg, waterMl, syringeUnitsPerMl }` — **no `id`**.
- The local vial mirror is **read-only** (`lib/local-store/index.ts:155`, OR-102a) and there is no
  outbox push for vials, so **no replay needs to choose an id**.

So the field is gone, from the schema, the adapter and the repository interface. **Dropping beats
scoping** because it removes the oracle rather than changing its status code — with `.strict()`, a
request carrying `id` is now a 400 before anything runs.

## RV-56 — shape is not calendar validity

Three routes carried the correct **separator** regex `^\d{4}[-/]\d{2}[-/]\d{2}$` and no calendar
check. Verified: `grep -c` for `isCalendarDate` or `normalizeDateParam` returned **0** in all three.
`2026-02-31` is the sharper case — a real month with a plausible day, which any hand-rolled guard
would wave through; `2026-13-45` is the one people think of.

All three now `.refine(isCalendarDate, …)` after the regex. `isCalendarDate` normalises separators
itself, so the regex stays for the clearer shape error and the two compose.

## The fixture bug, and why it is the part worth recording

The first run of the mutation pass showed **4 failures, not 6** — both manual-bedtime cases passed
against the *unfixed* route. Not a sign the fix was unnecessary: my test sent `sleepStart`, and the
route's body key is `at` under a `.strict()` schema, so those cases were getting their 400 from an
**unknown key** rather than from the date.

A test that is right for the wrong reason is worse than a missing one, because it reads as coverage.
Fixed the fixture, and added the control that proves the point: a **real** day with the same body
returns **404** — validation passed and the handler ran on to the missing-night branch. 404 rather
than 400 is what separates "the date was accepted" from "the body was rejected".

This is the third fixture of the day that passed for the wrong reason, all caught by running the
mutation pass rather than by reading. The pattern: a fixture that does not reach the code under test
still produces a plausible-looking result.

## Verification

`app/api/__tests__/rv55-56-route-input-500s.test.ts`, **10 passing**. Against the unfixed routes,
**6 fail and 4 pass** — and the four are the controls:

| passes either way | why it is there |
|---|---|
| a vial with no `id` is still created (201) | a change that broke creation outright would pass the id case |
| a real day `2026-09-10` is still accepted | the refine must not reject real days |
| the slash form `2026/09/10` is still accepted | `localDateString()` emits slashes; the separator regex stays for a reason |
| manual-bedtime 404s on a real day | proves the date passed validation rather than the body being rejected |

Gates: full suite, Custom Rules **75 of 75**, `tsc --noEmit` clean (real exit code captured — an
earlier `&& echo TSC_OK` in this session reported success off `head`'s exit status, not `tsc`'s),
`check-test-typecheck` none above baseline.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **`error_events` in production.** The claim that these no longer write fault rows follows from
  answering 400 before the driver is reached; no production row was re-counted to confirm it.
- **The other 68 routes the entry swept.** RV-56 states only these three matched and that
  `app/api/water-log` clamps its `localDate` instead; that sweep was not re-run here.

<a id="2026-09-18-lane-a-rv58-60-shared-module-drift"></a>

# 2026-09-18 — RV-58/59/60: three shared modules whose contract and behaviour had drifted

**Branch:** `lane-a/rv58-60-shared-module-drift` · **Lane A** · batch `shared-module-drift-sweep50` · one PR · no migration · unversioned

Batched because they share exactly one property: each is a pure shared function whose defect is only
visible by calling it. One test file, no fixtures, no database.

## RV-58 — case folded on one side only

`equipmentEligible` lowercases the exercise's labels; `buildEquipmentSet` lowercased neither the
owner's selections nor the `full_gym` shorthand. So `equipmentEligible(['Barbell'],
buildEquipmentSet(['barbell']))` was **true** and its mirror was **false**, and
`buildEquipmentSet(['FULL_GYM'])` returned the shorthand unexpanded.

Not reachable today — the one producer emits lowercase ids and 0 of 156 catalogue rows carry a
non-lowercase value — but both API schemas take a bare `z.array(z.string())`, so nothing constrains
the next producer. Both sides fold case now.

**The entry's sharpest point is about the test, not the code:** the shipped
`catalogue-equipment-guard.test.ts` exercises only the exercise side, which is exactly what makes
half-coverage read as case-insensitivity. The new cases assert the **mirror**, and the mutation pass
shows why that matters — against the original, "exercise upper, owned lower" **passes** while its two
mirrors ("exercise lower, owned upper" and "both upper") **fail**. The asymmetry is demonstrated
rather than asserted, and a suite that held only the passing direction would have reported the module
as case-insensitive.

## RV-59 — summing mixed units and labelling by row order

`summariseSupplementDay` added every amount and took the first non-null unit as the label, so
`1 mg + 2 g` reported **`3 mg` or `3 g` depending only on which row the loop saw first**.

The entry said to decide the semantics before coding: convert to a canonical unit, or refuse. The
data settles it — **`unit` is free text** (`string | null`) and the vocabulary in use includes `ml`
and "1 scoop" beside `mg`/`mcg`, which have no conversion to a mass. There is no canonical unit to
convert to, so refusing is the only option that cannot be wrong.

A mixed day now reports `amount: null`, `unit: null`, and a new optional `mixedUnits: true`. The
field is **optional on purpose**: `applyManualToggle` in `components/nutrition/` also constructs this
type and is **Lane B's file**, so a required field would have broken another lane from mine.

`amount: null` now has two causes, and `mixedUnits` is what tells them apart — the other being "no
contribution carried a number", which is a tick meaning *taken*, not *took none of it*.

**A flaw in my own first version, found by reasoning rather than by a failing test:** a tick with no
amount still increments `contributions`, so counting those as "a previous contribution" made the next
real number compare against a unit nobody had set, and an ordinary day came out mixed. The guard is
"first NUMBERED contribution", and there is a test for exactly that case — it passes against the
original code too, because the original never set the flag, which makes it a regression guard for the
fix rather than a proof of the defect.

**A second flaw, found by a test I had not written — and the narrowing it forced.** My first version
treated a **null** unit as disagreeing with a named one, which turned `5` + `3 g` into a mixed day.
That broke `components/nutrition/__tests__/supplement-day-totals.test.ts`'s *"takes the unit from the
first contribution that HAS one"* — a case whose comment shows it was decided deliberately: a missing
unit **inherits** from a sibling. RV-59's evidence is `mg` versus `g` and says nothing about null, so
overriding that decision would have been a change on no evidence. The fix now refuses only on
**named** units that disagree, and I corrected my own test, which had asserted the opposite.

**One pre-existing test legitimately had to change.** In that same file, *"keeps the FIRST unit any
contribution supplies, not the last"* pinned `5 mg + 3 g → 'mg'` — the exact tiebreak RV-59 calls the
one option that cannot be right (that day is 3.005 g, so either label is wrong by three orders of
magnitude). It is now *"refuses to total a day whose contributions name DIFFERENT units"*, asserting
the refusal, with the original comment's point kept: a day whose contributions disagree is what
separates the options, and the single-unit case above it cannot.

## RV-60 — a branch that could not fire, telling the user the wrong thing

The module ships two strings that exist to tell two cases apart: *"Zone 2 is done for the week"* and
*"No Zone 2 target set this week"*. It chose between them on `zone2 == null` — but
`computeZoneQuota` represents "no target" as a **row** with `status: 'not-required'`, never as a
missing row, and `zone-quota.test.ts` pins that distinction deliberately.

So the null branch was unreachable from real data and a user with no target was told their target was
**done**. It now tests `zone2 == null || zone2.status === 'not-required'`; the old shape still works,
though nothing produces it.

Impact today is zero — `recommendWalkPattern` has no production caller yet (that is TN-25's residue,
re-laned to B this morning). Fixed before the first consumer lands rather than after.

## Verification

`packages/shared/src/__tests__/rv58-60-shared-module-drift.test.ts`, **18 passing**. Against the
three original modules restored from `main`, **6 fail and 12 pass**; the rewritten case in
`components/nutrition/__tests__/supplement-day-totals.test.ts` fails against the original too, so the
mutation pass across both files is **7 fail / 27 pass**.

| passes against the original | why it is there |
|---|---|
| `exercise upper, owned lower` | the direction that already worked — its two failing mirrors are what show the asymmetry |
| still refuses equipment the lifter does not have | folding case must not make unrelated kit match |
| still totals a single-unit day | a fix that simply stopped summing would pass every mixed case |
| an earlier tick with no number does not make a day mixed | regression guard for the first-numbered flaw above |
| no amount and no mix when nothing carried a number | "taken, quantity unknown" is not zero |
| still says the target is done when it was set and met | the other half of RV-60's distinction |
| no target when the zone is absent entirely | the shape the old branch was written for |
| three pattern-threshold cases (15 / 44 / 45) | the boundaries must not move |

Both row orders are asserted for RV-59, because "depends on row order" is the defect and one order
alone cannot show it.

Gates: `tsc --noEmit` real exit 0, Custom Rules 75 of 75, `check-test-typecheck`, full suite before
committing.

## Not exercised

- **The S25 device.** Pure shared functions, no UI change, Railway deploy, no APK.
- **A mixed-unit day in production.** There is none: `claude_ro.supplement_logs` holds 5 rows, all
  `manual`, units `mg`/null, and no day has more than one contribution — *the owner's rows only*.
  So RV-59 is a latent defect fixed before it could be observed, not a reported one.
- **Any caller of `recommendWalkPattern`.** There still is none.
- **`supplementSubtitle`'s rendering of a mixed day.** It reads `loggedAmount` and lives in
  `components/`, which is Lane B's; it branches on `amount == null`, so it renders a mixed day
  exactly like an amountless tick — the one thing it is not. `mixedUnits` exists to separate them and
  nothing reads it yet. Filed as **LA-119** rather than fixed across the lane boundary.

<a id="2026-09-18-lane-a-rv61-equipped-title-unlock-check"></a>

# 2026-09-18 — RV-61: the equipped title was gated on the catalogue, not on having earned it

**Branch:** `lane-a/rv61-equipped-title-unlock-check` · **Lane A** · one PR · no migration · unversioned

## What was wrong

`PATCH /api/user/equipped-title` checked one thing: that the id existed in `TITLES`. Unlock state was
never consulted. The filter that enforces it lives in `components/more/title-picker-sheet.tsx:21`,
which takes `unlockedAchievementIds` as a prop and filters the list — the **client's** copy of a rule
only the server can hold. A direct PATCH skipped it, and the stored value renders on
`friend-leaderboard.tsx`, `friend-feed.tsx` and `app/profile/[userId]/page.tsx`.

Review reproduced it live at sweep 50: a user at `bestStreak: 9` equipped `iron_will`
(`unlockedBy: 'streak_60'`), got a 200, and read it back from Postgres as stored.

## The fix, and why it calls the expensive function

The route now resolves `TITLES[titleId].unlockedBy` and asks `computeAchievements` whether that
achievement is unlocked for the **session** user, refusing with **403** if not.

`computeAchievements` is fifteen parallel queries plus a `reconcileUserStats` write, which is a lot
for a PATCH. **Re-deriving the one rule cheaply here is the thing not to do** — it is the only
implementation of unlock state, read by `/api/achievements` and `/api/profile/[userId]`, and a second
answer that could disagree with the picker is how the client/server split produced this defect in the
first place. Equipping a title is a rare, deliberate, user-initiated action; `/api/achievements`
already runs the same work on every profile paint and carries no rate limit, so the PATCH is not the
cheapest path to abuse and gating it alone would be theatre. **No rate limit added**, matching both
existing callers.

**Clearing a title (`titleId: null`) is not gated and does not call it** — removing a claim is not
making one, and it must not pay fifteen queries.

**400 and 403 stay distinct.** An id outside the catalogue is still a 400, checked first; 403 means
the id is real and the caller has not earned it. The pre-existing `hasOwnProperty` guard (which stops
`constructor`/`__proto__` reaching the column) runs before any unlock work.

## Verified before writing the check

Every one of the 16 `unlockedBy` values in `TITLES` resolves to a real id in `lib/achievements.ts`
(47 achievements). Checked mechanically rather than by eye, because a title whose requirement did not
resolve would now 403 for a user who had genuinely earned it — the failure mode of this fix is
locking someone out, not letting them in.

**Sibling sweep: there is exactly one writer.** `updateEquippedTitle` (`slices/social.ts:97`) is
called only from this route, and `updateUserGoals` — the one generic `users` `.set()` — builds its
object from an explicit key whitelist, so `equipped_title` cannot ride in through a raw body.

## Verification

`app/api/__tests__/rv61-equipped-title-unlock.test.ts`, **12 passing**. Against the route as it
stands on `main`, **4 fail / 8 pass**.

The failing four are the defect and its edges: a locked title refused with nothing written; the
unlocking achievement absent from the list rather than present-and-false (an implementation using
`find(...)!.unlocked` would throw there); an unlocked achievement that merely *shares the title's id*
not satisfying the gate; and the unlock being computed for the session user and timezone.

The eight that pass against the original are deliberate controls — a fix that refused every title
would pass all four failures above, so the suite pins that a legitimately unlocked title still
equips, that clearing still works without touching achievements, that four non-catalogue ids
(including `__proto__` and `constructor`) still 400 before any unlock work, and that an
unauthenticated caller still gets 401.

The `unlockedBy` indirection is asserted in both directions, because an implementation comparing the
achievement id against the **title** id would look correct on the obvious case.

**One pre-existing case changed**, in `lib/__tests__/year-review-and-identity-routes.test.ts`:
*"equips a known title and echoes what was stored"* is now *"equips a known **and unlocked** title"*,
with `computeAchievements` mocked. It was not asserting anything that stopped being true — "known" is
simply no longer sufficient, which is the whole point of the change. Its file header now says so and
points at the new file for the refusals; the other seven title cases there (the null unequip, the
400s, the prototype keys, the 413, the 401) are untouched and still pass.

Gates: `tsc --noEmit` exit 0 · Custom Rules 75 of 75 · `check-test-typecheck` · full suite.

## Not exercised

- **The S25 device.** A server-side authorization check; no UI change, Railway deploy, no APK.
- **A live 403 against production.** The reproduction in the entry was a production *write* by the
  Review sweep; re-running it to confirm the refusal would be another one, so this was verified
  against the route in tests rather than against the deployed instance.
- **Revocation of a title already equipped.** Out of scope deliberately: the gate is on new equips.
  Unlock state is effectively monotonic (`bestStreak` is a best-ever; the counters only fall when
  `reconcileUserStats` heals a delete), so a stored title going un-earned is possible but rare, and
  nothing in the entry asks for it.
- **The owner's own titles.** On a single-owner deployment there may be no adversary at all — the
  entry says as much and rates it low priority on its merits. The reason to do it is that the server
  is the only place the unlock rule can live.

<a id="2026-09-18-lane-a-rv62-mood-checkin-ms-window"></a>

# 2026-09-18 — RV-62: the banned ms-offset window was mine, and it is not hygiene

**Branch:** `lane-a/rv62-mood-checkin-ms-window` · **Lane A** · no migration · unversioned

## What it was

`deriveSuggestedSoreMuscles` built its recovery window as
`new Date(Date.now() - 7 * 86_400_000)` — the exact form CLAUDE.md's Date Arithmetic rule names:
*"Range/window starts anchor at the user's local midnight, never `now − N×86400000`."*

I wrote that line this morning, in BF-173. Review sweep 50 caught it the same day, and correctly
noted it is new rather than inherited debt.

## The question the entry left open, and the answer

RV-62 flagged as **not established** whether the day-boundary skew can actually flip a provenance
verdict, and said it was *"worth constructing rather than assuming — it changes whether this is
hygiene or a live scoring defect."* Constructed:

**It cannot flip one directly.** `suggestedSoreMuscles` only considers muscles whose latest bout is
within `SORENESS_EXPECTED_WITHIN_HOURS` (48). A session at the seven-day edge is ~168 hours old, so
it is never eligible on its own. The obvious worry — a workout drops out of the window and its
muscle stops being suggested — is not reachable.

**It can flip one through the median.** `computeMuscleRecovery` takes the MEDIAN bout volume per
muscle as `typical`, and `tau = min(48, max(16, 24 × latest.volumeKg / typical))`. An old, heavy
bout entering the window raises the median, lowers the ratio, lowers `tau`, and therefore *raises*
the recovery percentage of a recent bout — across the 85 line if it was near it.

Pinned deterministically: a chest bout 40 hours old at 1,000 kg reads **81 → suggested**; add a
167-hour bout at 3,000 kg and the same recent bout reads **92 → not suggested**.

So: a live scoring defect, not hygiene — but narrow, and only for a muscle already sitting near the
threshold. Worth stating precisely so it is not re-derived later as either.

## What shipped

- The window anchors at `dateStrMidnightInTz(shiftDateStr(logDate, -7), timezone)`. **Keyed on the
  check-in's own date**, which is stricter than the entry asked: a check-in saved for a particular
  day reads the seven days ending on that day, not the seven ending now. Normally the same day, and
  it costs nothing.
- `saveMoodLog` takes `timezone` (defaulted to `DEFAULT_TZ`, the repo's own pattern for day-window
  helpers). One caller — `app/api/mood/route.ts` — passes the session tz.
- The entry's second half: `listExerciseLibrary()` selected every column of the whole catalogue on
  every check-in save. `computeMuscleRecovery` takes `Pick<ExerciseLibraryEntry, 'name'|'muscles'>[]`,
  which is exactly what `listExerciseMuscleMap()` already returns — a narrower query, same result.

## The tests, and what they do not prove

**Three DB tests** (`rv62-provenance-window-anchoring.test.ts`) run in a zone computed from the
current UTC hour so local time is ~01:00 on every run, per `local-day-fixture-anchoring.test.ts` —
a test that waits for the real clock to enter the hazardous band fires two hours a day and passes
the rest of the time, which is how this class survives. Verified: at UTC 13:00 the helper yields
`Etc/GMT-12`, local hour 01.

**They all pass against the old code too, and that is stated rather than glossed.** They assert the
anchoring's shape — the call succeeds at 01:00, two days are keyed independently, an empty check-in
short-circuits — not the numeric flip. Building a DB fixture that lands a bout between the
UTC-anchored and local-midnight-anchored window starts would depend on the hour the suite runs, which
is the fragility this class already has.

The flip is proved instead by **three deterministic unit tests**
(`rv62-window-edge-can-flip-a-verdict.test.ts`), which need no database and no clock: 81 → 92 when
the old bout joins, and a third case asserting the half that is *not* reachable, so the narrow claim
is not mistaken for a broad one.

**A fixture bug worth recording.** The first draft built sessions with a `sets` array.
`computeMuscleRecovery` reads `ex.volume` and never sums sets, so every bout carried zero volume,
the ratio fell back to 1, tau was flat at 24, and the test reported 81 in both cases — hiding the
exact mechanism it was written to show. The assertion was right and the fixture was wrong; I fixed
the fixture.

## A gate my local routine was missing

CI's **Build** job failed on this PR while `tsc --noEmit -p tsconfig.json` was clean locally. The
failing step is `scripts/check-test-typecheck.js`, which typechecks **test files** against
`tsconfig.tests.json` and a per-file baseline — a different project from the one the app typecheck
uses, so test-only type errors are invisible to it.

The error was a wrong import path in the new unit test: `WorkoutSession` comes from
`@trainingai/shared/types/log`, not `.../types/workout`. Vitest ran the file happily because the
import is `import type`, erased at runtime — so a green test run proves nothing about it.

Fixed by correcting the import, **not** by raising the baseline: the baseline exists for files that
legitimately grew, and this file is new and had no entry. The gate now reports 320 errors across 90
files, none above baseline.

**The routine changes:** `npx tsc --noEmit -p tsconfig.tests.json` (or `node
scripts/check-test-typecheck.js`) belongs in the local gate alongside `pnpm check:rules` whenever a
PR adds or edits a test file. `pnpm check:rules` does not cover it — the step lives in the Build job,
not Custom Rules.

## Verification

`tsc --noEmit` clean · Custom Rules **75 of 75** · the pre-existing BF-173 suite
(`mood-sore-provenance.test.ts`) passes **6 of 6 unchanged**.

## Not exercised

- **The S25 device** — server-side only, reaches the phone through a Railway deploy with no APK.
- **A real check-in at a real day boundary.** The DB tests place the *user* near 01:00; they do not
  wait for the server's own clock to cross a boundary mid-write.
- **The median flip against production data.** Demonstrated on constructed volumes; no production
  check-in was re-derived to see whether any real day changes.

<a id="2026-09-18-lane-a-rv63-collection-bounds-rate-limit"></a>

# 2026-09-18 — RV-63: the only unbounded route, narrowed and limited — but not floored

**Branch:** `lane-a/rv63-collection-bounds-rate-limit` · **Lane A** · no migration · unversioned

## What the entry found, all verified

`/api/collection` pins `HISTORY_START = '2000-01-01'`, issues five parallel all-history reads, has
**no rate limit** (`grep -c 'rateLimit('` → 0), and the home card re-fetches it on every paint —
`cachedFetch` revalidates regardless of TTL (Q-262). Two of the reads were full-width for one field
each: **36 columns** of `body_metrics` and **25** of `sleep_sessions`, immediately projected to
`.map(x => x.date)`.

## The half I did not take, and why

The entry prescribed *"a date floor and two projected selects."* **The date floor is not taken**, and
the route's own comment already said why: *"The collection is a replay over ALL history, so there is
no window to bound the reads with."* `replayCollection` walks every recorded day forward from the
beginning, so a floor silently changes what the ladder reports for anyone with history behind it —
a behaviour change wearing a performance fix's clothes.

The growth the entry is right to worry about is real, and narrower rows address it honestly: the
reads went from 176 and 144 bytes a row to one `date` column, so the width no longer grows with the
schema. Seeing less history is not the same fix as reading less per day.

## The rate-limit norm, decided rather than matched

The entry flagged that there is no sibling norm to appeal to, and left it open explicitly:
*"Decide the norm once rather than matching whichever sibling is read first."*

Checked, and the entry is literally right — the split tracks nothing. `weekly-muscle-sets` has **five**
repo calls and no limit; `muscle-tonnage-trend` has two and none; `weekly-review/month-window` and
`oura-ble/rollup-state` have one each. Call count does not predict it.

What does separate them: **every one of those routes is windowed, and `/api/collection` is the only
route in `app/api` that reads all history.** So the rule established here is about the read rather
than the folder — *an unbounded replay gets a limit; a windowed read does not* — and it has no
counter-example in the codebase, because there is no other unbounded route. 30 per 60 s, matching
`weekly-review/month-window`, the nearest aggregate in shape.

That is a rule stated for one route on a stated principle, not a norm retro-fitted onto six.

## Two route tests changed, and that is the part to read

Pushing the `> 0` predicate into SQL took it out of the route's reach. Two existing cases asserted
that a **low** day still spawns a cat — 400 steps, 3.5 hours — which encodes a measurement: only 35
of the owner's 130 step-days reach 8,000, so a threshold would decay the steps ladder most weeks.

The route can no longer prove that, because it no longer sees the value. **The guarantee moved with
the code rather than being dropped**: `lib/data/postgres/__tests__/rv63-collection-day-keys.test.ts`
asserts it against a real Postgres. What the route test still proves is narrower and true — it spawns
one cat per day it is given and invents no bar of its own.

Editing a test to go green is normally the signal that behaviour changed. Here behaviour did not
change, only its location, and the replacement is stronger: the old assertion ran against a mock
returning whatever it was told, and the new one runs against the SQL that now owns the decision.

## Verification

| suite | result |
|---|---|
| `lib/__tests__/collection-route.test.ts` | 10 passing |
| `lib/data/postgres/__tests__/rv63-collection-day-keys.test.ts` | **8 passing** (new) |

Mutation pass on the moved predicate — drop `gt(..., 0)` from both reads and **exactly the four
"drops" cases fail**. The four survivors are the controls: a low step count and a short night must
*not* be dropped, the `from`/`to` bounds must still apply, and another user's rows must not appear.

Two fixture bugs, both mine, both fixed rather than worked around: `sleep_sessions` has `sleep_start`
**and** `sleep_end` NOT NULL, so a night fixture carries a window even when only the duration is
under test — and that window is deliberately not derived from the duration, because these cases are
about the stored column rather than anything recomputed from the timestamps.

Gates: Custom Rules, `tsc --noEmit` with the real exit code, `check-test-typecheck`, and the full
suite before committing.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **The rate limit against a real client.** 30/60 s is generous for a home card, but nobody has
  navigated the app hard enough to see whether a legitimate burst reaches it — the failure mode would
  be a 429 on a card that otherwise paints.
- **The width saving, measured.** The column reduction is arithmetic from the schema, not a timing.
  The entry was explicit that nothing is slow today and this is filed as growth, not latency.

<a id="2026-09-18-lane-a-tn25-residue-is-lane-b"></a>

# 2026-09-18 — TN-25's residue is Lane B's, and Lane B could not see it

**Branch:** `lane-a/tn25-residue-is-lane-b` · **Lane A** · docs-only · no migration

## What this is

Not a fix — a routing correction, found while picking the next Lane A item rather than by looking
for it. TN-25 sat at the **top of Lane A's READY list** with both of its engine halves already
shipped (#1262's selector, #1263's band). The only work left is wiring the selector to a surface,
and that touches no `app/api/**` route and no storage.

## Why it was Lane A, and why that expired

The entry was filed `Lane: A` for the correct reason at the time — *"both (1 engine, 1 surface) → A,
engine half first"*, which is exactly what the rule in `docs/agents/README.md` §3 prescribes for a
two-half entry. The lane was right when it was written and became wrong when the engine halves
landed. Nothing re-reads a lane line after a partial ship, so it stayed.

## Checked, not assumed

The claim "this is a surface change" is the kind that is easy to assert and wrong often enough to be
worth three greps:

- `recommendRunType` — the selector TN-25's module deliberately mirrors — has exactly **one caller**,
  and it is a client component: `components/running/running-plan-content.tsx:133`, reading the quota
  from the existing `/api/cardio-week` through `cachedFetchToday`. So the walk's wiring is the same
  shape against the same route, and there is no exposure for Lane A to build.
- The walk's block structure lives in `useGuidedWalkStore`'s config and `walk-config.tsx` —
  `lib/stores/**` and `components/**`, both Lane B by the path list.
- `recommendWalkPattern`'s `hadHardDayYesterday` / `shortOnTime` are **optional**, so they cannot
  quietly drag an engine half back in.

## Why it mattered more than one queue position

Lane B's READY list held **two** entries. Lane A's held twelve, and TN-25 was first. So the entry
Lane B could actually build was the one it could not see, while it headed the list of the lane that
could not build it. A mis-laned entry does not merely sort wrong — it is invisible to the lane that
can ship it, and it blocks the head of the other lane's queue at the same time. After the
correction, TN-25 is **#1 in Lane B's READY**.

That is the same failure BF-175 hit from the other direction on 2026-09-17: cutting an entry down
dropped its `Lane:` line, `next-item.js` printed it `⟨lane unstated⟩`, and it landed in **both**
lanes' lists. A lane line that is stale is worse than one that is missing, because nothing prints a
warning about it.

## What was added beyond the lane

The `Keep:` line now carries the shape to copy (`running-plan-content.tsx:113-133`, and the
instruction to **reuse the `cardio-week` cache key** rather than adding a second one for the same
payload), and one genuinely open question left to Lane B: whether the recommendation **pre-sets**
the walk config or is offered as a suggestion. The owner asked to have it *"determined for me"*,
which argues for pre-setting — but `walk-config.tsx` persists a custom config on every edit, so
overwriting it silently needs care the running plan never had to take, since it only displays.

## Not verified

Nothing was run, because nothing executable changed. `pnpm check:rules` covers the backlog's
structural rules and is the only gate this diff can fail.

<a id="2026-09-18-lane-a-tn45-watch-names-what-moved"></a>

# 2026-09-18 — TN-45: the only band that ever fires now says what moved

**Branch:** `lane-a/tn45-watch-names-what-moved` · **Lane A** (engine half of an A-then-B entry) · no migration

## What was wrong

`watch` is the only illness band that has ever fired — **2 days in 72**, against **0** for `elevated`
and `fever` — and it was inert twice over. `ILLNESS_READINESS_PENALTY.watch = 0` is deliberate
("advisory-only"), and the Home banner returns `null` for anything that is not `elevated`/`fever`.
**So the band is named advisory-only and there is no advisory.**

Worse, its copy named nothing: *"Some biomarkers are drifting from your baseline."* The data behind
that sentence already knew which ones — `IllnessResult.biomarkers` carries `{ z, contribution }` per
biomarker, commented in the source as *"the 'why', for the advisory"* — and the advisory did not read
it.

## What shipped

`illnessAdvisory(flag, biomarkers?)` names the one or two biomarkers actually driving the score:

> **Resting HR and HRV are drifting from your baseline — worth keeping an eye on.**

**Ranked by `contribution`, not by raw `z`** — that is what the number in front of the reader was
made of. Temperature holds 40% of the weight, so a small z can out-contribute a larger one, and a
test pins that ordering. Biomarkers contributing zero are never named: on a `watch` day most are at
zero, and listing them describes the metric set rather than the event. Capped at two, because the
owner asked for one calm sentence.

**The second parameter is optional**, so every existing caller keeps the previous wording. Nothing
else moved: no threshold, no readiness penalty, `watch = 0` intact. The entry's two "do not"
warnings are both still true of the code.

## The copy constraint, and why it is not cosmetic

Both firings were caused by something other than illness — the owner started Retatrutide on
2026-09-07 and resting HR and HRV track the doses with a 2–4 day lag (TN-46). A line hinting at
infection would have been wrong on **100% of the occasions this feature has ever appeared**. So the
wording names the measurement and nothing about what it might mean, and a test asserts the string
never matches `/fever|infection|fighting|sick|unwell|ill\b/i`.

## A test was rebuilt rather than tuned

The first version of the production-day case reconstructed the z-scores from the entry's prose and
scored **`normal`**, one band below what it was asserting. The fix was not to nudge the numbers until
they passed — it was to read the **persisted** biomarker maps out of
`oura_daily_derived.illness_biomarkers` and test against those. Both real firings are now fixtures:
2026-09-16 (score 41) and 2026-08-27 (score 57). A fixture fitted to its own assertion proves the
assertion, not the code.

## Filed, not left

**The 2026-08-27 firing has no explanation.** It predates the first dose by eleven days and carries an
HRV z of **−4.26** — a bigger move than the medication days. TN-46's *"the cause is now known"* covers
09-16 and cannot cover this one. Recorded on TN-45 so it is not assumed settled.

## What is still owed

**The render — and it is the whole ask from the owner's side.** The guard at
`components/home/illness-advisory-banner.tsx:15` still returns `null` for `watch`, and the owner chose
a quiet line under the readiness score rather than reusing the amber banner (the loudest UI on the
quietest signal is how a banner gets ignored). **Until Lane B ships that line, nothing renders and the
pass test is not met.** TN-45 stays queued with a `Keep:` saying exactly that.

## Verification

Full suite green by real exit code; `pnpm check:rules` 75 of 75; typecheck clean. 11 unit tests.
**Mutation pass: 5 mutants, all killed** — ranking by z, the zero-contribution filter dropped, the cap
raised to three, the verb forced plural, and the fallback path removed. **Equivalent control**
(`> 0` → `!== 0 && > 0`) stayed green.

**Not exercised:** nothing renders this string yet, so it has not been seen on a screen. No device.
The production figures are reads of stored columns, not re-derivations.

<a id="2026-09-18-lane-a-tn49-rederivation-missing-key"></a>

# 2026-09-18 — TN-49: the audit contradicted its own evidence, and the entry believed it

**Branch:** `lane-a/tn49-rederivation-missing-key` · **Lane A** · no migration · no data write · unversioned

## What the entry asked for

TN-49 measured that **7 of 65** `oura_daily_derived` rows carry a `readiness_score` that does not
reproduce from their own stored contributors, all consecutive (2026-07-16 → 07-22), all 4–6 points
low. It attributed this to the 2026-07-22 weight rebalance — contributors re-derived under the new
model, scores not — and prescribed: *"recompute and rewrite the seven rows from their stored
contributors."*

**That would have overwritten seven correct scores with values 4 to 6 points too low**, writing into
production exactly the defect the entry exists to remove. The measurement was right. The diagnosis
was not.

## What it actually is

`READINESS_WEIGHTS` has **nine** contributors summing to exactly 1.00.
`rederiveReadinessFromStored` skipped any key absent from the stored map — dropping that key's
weight from a sum defined to total 1, so the result came out low by about `weight × 50`. A weight of
0.09–0.10 at a neutral 50 is −4.5 to −5, which is the band TN-49 reported.

Production, 2026-09-18:

| | |
|---|---|
| rows that disagree with their stored score | **7** |
| rows storing eight contributors instead of nine | **7 — the same seven** |
| key-count histogram | `{8: 7, 9: 58}` |
| the missing key, on all seven | **`checkin`** (weight 0.10) |
| nine-key rows that reproduce exactly | **58 of 58** |

The 1:1 match is what settles it. Nothing about the weight rebalance is involved.

## The surface was asserting the opposite of its own evidence

This is the part worth carrying forward, because the false finding was *generated* rather than
guessed. On those rows `drifted` and `uncheckable` are both empty, so `buildReadinessAudit` took the
branch that prints:

> The stored score **IS** reproducible from its own stored inputs (**42**) … the model has not moved
> — the difference is an INPUT change.

against a stored **48**. It claims reproducibility and then prints a number that is not the stored
score, in the same sentence, and hands the reader a wrong diagnosis. The Tuning agent read that
sentence and filed it in good faith.

## What shipped

`ReadinessRederivation` gains `missing`, distinct from `uncheckable`:

- **`uncheckable`** — the key is *present* but carries no `input`: a pre-Q-501 row whose score is
  known and cannot be re-derived.
- **`missing`** — the key is *absent entirely*. There is no score at all.

An absent key now contributes the model's own NEUTRAL 50 — what `computeReadinessComposite` uses for
a contributor with no input, so it is the closest the stored row supports — and the audit refuses to
make a reproducibility claim while `missing` is non-empty.

No production row was written. The fix is entirely in `packages/shared/src/health/`.

## What the fix does NOT explain, stated rather than fitted

With the neutral 50 standing in, **four** of the seven reproduce exactly (07-18, 07-19, 07-20,
07-22). **Three keep a 1-point residual** (07-16, 07-17, 07-21), and no value in
`CHECKIN_ENERGY_SCORE` — 30/50/72/88/100 — reproduces them, so it is not a logged check-in either.

I first back-solved the missing contributor as 60/50/40 by differencing two independently-rounded
numbers, noticed those are not values the check-in map can produce, and re-queried at full precision
rather than publishing the reconstruction. The residual is recorded as unexplained. It is 1 point on
three days and nothing on screen depends on it.

## Left for the owner

Two production data writes, both owner-gated under the confirm-first carve-out, both kept on the
entry:

1. **Back-fill the missing `checkin` key** into those seven contributor blobs. Only the four
   exactly-reproducing rows can be reconstructed with confidence (`checkin = 50`); **do not write a
   value to the other three.**
2. **Back-stamp `model_versions.readiness`.** The entry's second finding is confirmed untouched: 40
   of 65 rows carry no stamp, and the stamped and unstamped ranges overlap (08-22 → 08-25), so a row
   cannot say which it is.

## The correction I nearly shipped

The first version of this fix collapsed two different cases and **broke a pre-existing test**, which
is the part of this worth carrying forward.

`packages/shared/src/health/__tests__/readiness-stored-inputs.test.ts` — 19 tests I did not find,
because I grepped `__tests__` for `rederiv|readiness-comp|score-audit` and the file is named for the
stored *inputs* — contains *"skips a contributor whose stored score is not a finite number"*, whose
comment states the intent outright: *"checkin carried 0.10 of the weight and is now absent from the
sum entirely."* Someone decided that on purpose.

My first pass treated **absent** and **present-but-unusable** as the same thing and stood the neutral
50 in for both. It went green on my own new tests and turned that one red, on a full-suite run I
started *after* committing.

The two cases are genuinely different:

- A key **absent** has no score. Standing the model's own neutral in reproduces what
  `computeReadinessComposite` did, so it is not an invention.
- A key **present with a corrupt score** is a value that cannot be read. Inventing 50 for it asserts
  something the row does not say — which is what the enclosing describe block, *"it refuses to invent
  a verdict"*, exists to prevent.

So the present-but-unusable path is unchanged and still skipped, which means **it keeps the
low-by-`weight × score` trap**. That is accepted rather than overlooked: no production row has ever
been in that state, and the alternative is overturning a deliberate decision on no evidence. It is
stated in the code and pinned by its own test so the asymmetry is visible rather than incidental.

**The lesson is the grep, not the logic.** A test file named for the thing it tests rather than the
function it calls is invisible to a search built from the function name. Running the full suite
before committing, not after, is what would have caught it.

## Verification

`packages/shared/src/health/__tests__/tn49-rederivation-missing-key.test.ts`, **10 passing**, and
the 19 pre-existing tests in `readiness-stored-inputs.test.ts` still pass **unchanged** — 29 in
total. Run against the original from `main`, **6 of the 10 new ones fail and all 19 old ones pass**,
which is the result that matters: the change is additive and moves nothing that was already pinned.

Which four of the new ones pass against the original is the other half:

| Survives on both sides | Why it is there |
|---|---|
| *leaves a complete map exactly as it was* | the deliberately equivalent control: score, `drifted` and `uncheckable` unchanged for a nine-key map |
| *still detects a contributor whose stored score does not follow from its stored input* | drift detection is the other behaviour the fix was not allowed to move |
| the weights-sum-to-1.00 check | the premise the whole defect rests on |
| the null-input case | unchanged |

The first draft had a single "control" that asserted `missing: []` alongside the unchanged
behaviour, so it failed against old code too — which makes it a test of the new field, not a
control. Splitting it is what made the mutation result mean anything.

Also pinned: the real production row of **2026-07-20** (eight contributors weighting to 43.26, stored
48) resolves to 48 rather than 43.

Gate: Custom Rules **75 of 75**, `tsc --noEmit` clean.

## Not exercised

- **No device, no APK** — shared engine code only.
- **The audit screen itself.** The note text changed; nobody has looked at it rendered.
- **The three unexplained rows.** Not diagnosed, only bounded.
