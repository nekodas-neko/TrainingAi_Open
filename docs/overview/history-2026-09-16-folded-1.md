# Session journal — batch folded 2026-09-16

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-12-lane-a-bf147-gif-review-status"></a>

# 2026-09-12 — BF-147 Lane A half: a verdict column for generated GIFs

**Branch:** `lane-a/bf147-gif-review-status` · **Agent:** Implementation Lane A

## What the owner asked for

From the Admin Console → Exercises tab: *"ui is bad and I also want a better way to make sure
everything has the right gif. Maybe a way for me to flag if its wrong so you we can decide how to
proceed."* BF-147 splits along the lane rule: the flag needs a column and a route (Lane A), the
screen that uses it is `components/admin/exercise-manager.tsx` (Lane B).

## What shipped

- **Migration 273** adds `review_status` and `reviewed_at` to `exercise_media`. `review_status` is
  `NOT NULL DEFAULT 'unreviewed'` with a CHECK constraint on the three values, and a **partial**
  index covers only the rows that are not `unreviewed` — the flagged set is the small one and the
  only one anything queries.
- **Migration 274** regenerates the `claude_ro` views so those two columns are readable through
  `/api/admin/db-query`. See the gotcha below — this was not foreseen, it was caught by CI.
- **`app/api/admin/exercise-media-review`** — `GET` returns the flagged set, `PATCH` writes one
  verdict. Keyed on `(exercise_name, gender)`, which is `exercise_media`'s own unique key, so a
  caller names the thing it is judging rather than a row id it had to look up first.

## Decisions, and why

- **The route imports no generation surface at all, and there is a test asserting that.** The entry
  was explicit that marking a GIF wrong must not fire an AI call — collecting the wrong ones is the
  point of collecting them. The assertion is load-bearing rather than decorative: the obvious
  "helpful" follow-up is to regenerate on a `wrong` verdict, and that would quietly destroy the set
  the owner asked to be able to decide about.
- **`PATCH` 404s rather than upserting.** A verdict about a GIF that does not exist is not a
  verdict, and creating a media row from a review call would invent provenance — `model_used` null,
  `generated_at` now — for a generation that never happened.
- **Clearing to `unreviewed` nulls `reviewed_at`** rather than leaving the old stamp, so "when was
  this judged" never outlives the judgement.
- **Rate-limited 60/60 s** to match the sibling media routes. It is cheap by comparison (no
  generation), but a runaway client loop is the same mis-click exposure and uniformity is free.

## The gotcha: a green local suite is structurally blind to the `claude_ro` drift check

Adding a column to a table the `claude_ro` views already cover leaves it invisible to
`/api/admin/db-query` until the views are rebuilt. `db-snapshot-integration.test.ts` fails the Tests
job on exactly that — and it did here, after a fully green local run.

**It skips locally even with a `DATABASE_URL` set**, because it needs the `claude_readonly` role and
the local dev setup does not create one. So this is not a case of having run the suite wrong; a local
suite cannot see it at all. Migration 272's header says this in as many words and it was still walked
into, which is the argument for the rule being mechanical rather than remembered: **any migration
adding a column to a viewed table needs its `claude_ro` twin in the same PR.**

## Verification

- Migration applied against the local DB; column, default, CHECK constraint and partial index all
  confirmed present by query, not by reading the SQL.
- 13 route tests, full suite green, lint separately green, `pnpm check:rules` green.
- **Mutation pass — 4 planted defects, 4 killed:** GET dropping the `unreviewed` filter; PATCH no
  longer 404-ing on a missing media row; `unreviewed` keeping a stale `reviewed_at`; the body schema
  losing `.strict()`. The equivalent control (`4 * 1024` rewritten as `4096`) survived, as it should.

## Not done, and not silently

- **No UI reads either verb.** That is Lane B's half and the entry stays in the queue re-laned,
  carrying the four UI defects plus the sweep screen.
- **The production S3 credentials were NOT checked.** BF-147 asks for that before writing code
  here. It was judged orthogonal to this half — a verdict column touches neither storage nor
  generation — but that judgement is recorded rather than assumed: the `SignatureDoesNotMatch (403)`
  still gates the Mirror / "AI all" paths and the six proxy-path media rows, and nobody has looked
  at prod.
- **Not exercised:** no device run (this is a server route with no device path), and the route has
  never been called by a client, because no client exists yet.

<a id="2026-09-12-lane-a-bf150-goal-anchored-budget"></a>

# 2026-09-12 — BF-150: the daily budget anchors to the goal the owner set

**Branch:** `lane-a/bf150-goal-anchored-budget` · **Agent:** Implementation Lane A

## What the owner asked

*"When is this going to be back to the expected number? The 1350+ excercsise?"* He wants to eat to a
number he chooses, plus whatever movement earns. The app instead computed the number: base 2,196 −
200 goal + 131 earned = **2,127**, while the 1,660 he stored took no part in it.

## What shipped

`budgetProvenance` — the one place the budget is derived, read by Home's nutrition card, Home's
energy-balance card and the Nutrition tab — now uses the **stored calorie target** as the
zero-movement base when one exists. `restingBaseKcal + targetNetKcal` remains the fallback for a
user who has never set a goal. The service carries the stored target onto the balance
(`goalKcal`) so every surface anchors to one number instead of re-deriving it.

## Decisions

- **The goal delta is not applied on top.** He set 1,660 *as* the target he eats to; subtracting the
  deficit again would re-introduce the double-deduction the ⓘ copy already has to explain away.
- **The estimator stays computed and stays visible.** BF-137 and TN-29 are about making it true and
  still need somewhere to show it. What changes is that it no longer sets the number he eats to.
- **The provenance line follows the arithmetic.** On the anchored path there is no
  resting-base-plus-delta split to name, so the line reads *"1,660 your goal + 131 earned from
  movement"*. Printing "base − goal" there would name two numbers that are not addends of what is on
  screen — BF-99's defect wearing the opposite hat.
- **BF-99's source guard was narrowed, not weakened.** It banned *destructuring* `base` from
  `budgetProvenance`, which was a proxy for the defect rather than the defect. The anchored path
  prints `base` legitimately, so the ban is now on the only thing that was ever wrong: that value
  printed beside the word "base". The positive assertion that `restingBase` is still what carries
  the word is kept.

## ⚠ The number is not settled, and the entry contradicts itself about it

**BF-150 prescribes "stored goal + earned" but verifies against ~1,481, and those disagree by 310
kcal/day.** Measured from production 2026-09-12:

| | value | source |
|---|---|---|
| `nutrition_targets.calories` | **1,660** | stored 2026-08-31 |
| `users.calorie_goal` | **1,660** | same |
| `measured_rmr.rmr_kcal` | **1,325** | measured 2026-08-27 |

So the rule as written gives **1,660 + 131 = 1,791** today. The entry's verification line says the
budget should read **~1,481**, which is 1,350 + 131 — the owner's *remembered* figure, not the stored
one. And BF-99's own record has him calling 1,350 *"the 1350 RMR value"*, so his "expected number" is
his **measured resting rate**, not a calorie goal he ever stored.

**This is deliberately not resolved in code.** The rule is structural and identical either way; which
number he eats to is data he owns. What the change does is make that stored number load-bearing, so
setting it to 1,350 makes the budget 1,481. The owner has to say which he wants — the entry's
verification line should not be treated as the acceptance test while it disagrees with the entry's
own rule.

## A claim that needed no code

The entry asks for the macro grams and the calorie budget to share a denominator. They already do:
the stored macros are 150p/141c/55f = **1,659 kcal** against a stored goal of **1,660**. Anchoring
the budget to that goal makes them agree by construction, so the second bullet needed no separate
change — verified by a test rather than assumed.

## Verification

- **Mutation pass — 6 planted defects, 6 killed:** the anchor ignored; the goal delta applied on top
  of the goal; a zero/negative goal treated as real; a non-finite goal treated as real; the service
  no longer passing the stored goal; the legacy `users.calorie_goal` fallback dropped. The equivalent
  control (`typeof` check rewritten as `!= null`) survived.
- **The fifth mutant survived the first pass and is why `lib/__tests__/bf150-budget-anchored-to-stored-goal.test.ts`
  exists.** Every formula test passed with the service's wiring removed — the screen would have shown
  the old number while the unit tests stayed green.
- Driven against `pnpm dev` with the owner's real profile seeded locally: `goalKcal` comes back
  1,660 and anchors the budget; clearing the stored target returns `goalKcal: null` and falls back to
  the old rule.
- Full suite green (8,430 tests) with a `DATABASE_URL`, lint green, `pnpm check:rules` Ran 74 of 74.
  One run failed first on the known `onUserConsoleLog` teardown flake with all 892 files passing; a
  clean re-run confirmed it.

## Not exercised

No device run — this is server-computed and reaches the APK through Railway, but the Home and
Nutrition cards have not been seen rendering the new line on the S25. The provenance wording is the
part a screenshot would catch.

<a id="2026-09-12-lane-a-la91-ci-job-timeouts"></a>

# 2026-09-12 — LA-91: every CI job gets a timeout, and a guard so the next one does too

**Branch:** `lane-a/la91-ci-job-timeouts` · **Agent:** Implementation Lane A

## The problem

A GitHub job with no `timeout-minutes` inherits the 360-minute default. One hung step — a Playwright
run that never exits, a webServer that never binds — holds a runner for six hours while the PR sits
`mergeable_state: unstable`, indistinguishable from a slow job.

## What shipped

`timeout-minutes` on all **eight** jobs across all three workflow files, plus
`scripts/check-workflow-job-timeouts.js` wired into Custom Rules as step 74.

| workflow | job | measured | limit |
|---|---|---|---|
| ci.yml | Custom Rules | 0:21 – 0:36 | 10 |
| ci.yml | Migration Check | 0:49 – 1:04 | 10 |
| ci.yml | Lint | 0:45 – 0:47 | 10 |
| ci.yml | Build | 4:10 – 4:54 | 20 |
| ci.yml | Tests | 6:15 – 6:17 | 20 |
| ci.yml | E2E | 26:14 – 27:43 | 45 |
| android.yml | Android | ~4:06 – 4:30 | 20 |
| android-emulator.yml | emulator | — | 45 (already had one) |

## Two things the entry got wrong, both in the same direction

- **It scoped itself to `ci.yml`.** Its own `Lane:` field says `.github/workflows/ci.yml`, and its
  evidence was `grep -n timeout-minutes .github/workflows/ci.yml` returning nothing — true, but the
  grep was narrower than the problem. `android.yml`'s job had no limit either. Per the
  sibling-surface rule, all three files are swept.
- **Its E2E sizing is measured against a run that has since moved.** The entry recorded 24:36 with
  the `pnpm e2e` step at 23:06 and argued 45 minutes "leaves real headroom". Re-measured on two runs
  from 2026-09-12: **26:14 and 27:43** at the job level, step 24:52 and 26:13. So E2E grew ~13% in
  three days, and the headroom is 62% rather than the ~83% the entry implies. 45 still holds — a run
  where thirty specs retry adds roughly ten minutes against a ~19 s average spec — so the number is
  kept, with the real figures recorded so the next person sizing it is not working from the old ones.
- **A detail the entry's step-level reasoning skips: `timeout-minutes` is a JOB limit, not a step
  limit.** It covers the ~1:15 of container init, checkout, install and migrations before `pnpm e2e`
  starts. Sizing from the step alone would understate what the limit has to cover.

## Decisions

- **The guard checks presence, not value.** A script asserting a particular number would go stale as
  the suite grows, or force every future job into one shape. The right limit is a property of what
  the job does; what must never happen is a job with no limit at all, which is silent.
- **The limits are sized from measured runs, not judgement.** The entry itself records why: a
  check-in once called 25 minutes "beyond plausible" for the E2E suite with no evidence, and the real
  run took 24:36. Acting on that guess would have killed a healthy run two minutes before it went
  green. That reasoning is quoted into the script's error message.
- **Parsed by indentation rather than with a YAML library.** These scripts carry no dependencies of
  their own — that is what keeps Custom Rules at ~25 seconds with no install step.

## Verification

- Every workflow re-parsed with PyYAML after editing: all eight jobs present, each limit on the
  intended job.
- **Mutation pass — 4 planted defects, 4 killed:** a `ci.yml` job losing its timeout; the *last* job
  in a file losing its timeout (the close-at-EOF path, which an indentation parser can miss); a job
  in a *different* workflow file losing its timeout; and a timeout indented as a STEP key rather than
  a job key — valid YAML, wrong meaning. The equivalent control (`missing.length` rewritten as
  `missing.length > 0`) survived.
- `pnpm check:rules` — **Ran 74 of 74**, all passed, the new rule reporting as step 74.
- Full suite green with a `DATABASE_URL` (8,411 tests), lint green separately.

## Not exercised

This change alters CI itself, so its real test is this PR's own run — the first one to execute under
the new limits. No device path is involved. The limits have not been observed actually firing on a
hung job, because nothing has hung since they landed; what is verified is that they are present,
correctly placed, and above every measured duration.

<a id="2026-09-12-lane-a-lb100-one-budget"></a>

# 2026-09-12 — LB-100: BF-150 left the Nutrition ring counting against the old budget

**Branch:** `lane-a/lb100-one-budget` · **Agent:** Implementation Lane A

## What happened, stated plainly

BF-150 (mine, merged earlier today) anchored the day's budget to the stored calorie goal in
`budgetProvenance`. It did **not** update `computeCalorieBalance`, whose `deviationKcal` was still
`net − targetNet` — that is, intake measured against `restingBase + active + goalDelta`, the old
expression. Everything the user reads about "left" and "over" comes off that deviation:
`remainingKcal`, the zone band, its label and its colour.

So Home's donut counted against `goal + earned` while the Nutrition ring's *"N kcal left"* counted
against the estimator — **469 kcal apart in the e2e fixture, ~336 for the owner**. That is the exact
defect Q-415/Q-417 fixed in v1.335.0, reintroduced.

**`e2e/one-calorie-budget.spec.ts` caught it on BF-150's own pre-merge run and I merged anyway.**
E2E is advisory rather than a required check, so nothing blocked the merge and nothing recorded that
it had gone red. Lane B found it on #1129's CI and filed LB-100.

## The entry named two candidate causes; it is the first

LB-100 deliberately refused to pick between "the surfaces disagree" (①) and "the spec is stale" (②),
and gave a discriminator. Reading the spec first suggested ②, and that reading was wrong — which is
why the entry's instruction to run it mattered:

- Reproduced locally on a tree containing BF-150: **1 failed, 4 passed**, matching the filing.
- The entry warned a `dialog "Morning Check-in"` might be occluding the donut. Probed directly: **no
  dialog was open**, so that explanation is ruled out rather than assumed away.
- `energy-card.tsx:83` is `const remaining = b ? b.remainingKcal : …`, and `remainingKcal` is
  `−deviationKcal`. That is the proof: the ring reads a number BF-150 never touched.

**Why the ring's own test kept passing** — the asymmetry the entry flagged — is that it asserts
`${earned} earned from movement`, a substring that survived the provenance rewording, and its
"kcal left" branch falls back to `Goal reached` when the figure goes non-positive. It agreed with the
stale expression by luck, not by measurement.

## The fix

`computeCalorieBalance` measures the deviation against `budgetProvenance(...).total` instead of
re-deriving a second expression. One budget, one formula — which is what Q-415/Q-417 concluded and
what got lost.

`expenditureKcal` and `netKcal` are untouched: they measure burn, not budget, and a test pins that.

## The spec had a second copy of the formula, and that is the deeper fault

`budgetFromRoute` transcribed `restingBase + targetNet + earned` rather than asking the shared
function. A second implementation cannot tell you which side is wrong when it drifts — it just goes
red and invites "the fixture is stale". It now calls `budgetProvenance`. Its discriminator assertion
was inverted for the same reason: it asserted the real budget must **differ** from
`BASE.calories + earned`, which anchoring made the correct answer, so it would have begun failing for
being right. It now separates from the pre-BF-150 expression instead.

## Verification

- The failing spec: **1 failed / 4 passed → 5 passed**.
- Six unit tests pinning the invariant in `packages/shared`, where they run on every commit rather
  than only when a browser job is green — including the 469 kcal drift as a named case, and a day
  that reads "over" against the real budget while the old expression called it "on target".
- **Mutation pass — 4 planted defects, 4 killed:** deviation reverted to `net − targetNet`; the
  anchor ignored; earned movement dropped from the budget; the sign flipped. The equivalent control
  (rounding intake via a local) survived.
- Full suite green (8,450 tests) with a `DATABASE_URL`; lint green.

## What I should have done differently

Merged on a green E2E rather than treating "not a required check" as "not a signal". The check run
was visibly red on my own PR before I merged it.

## Not exercised

No device run; server-computed and reaches the APK through Railway. The corrected "kcal left" figure
has not been seen on an S25.

<a id="2026-09-12-q112e-weekly-recap-trends"></a>

# 2026-09-12 — Q-112e: the weekly recap gets its numbers, by widening the day review rather than copying it

**Branch:** `feat/q112e-weekly-recap-trends` · **Lane B** · `components/week-trends-section.tsx`
(new), `components/nutrition/end-of-day/day-trends.ts`, `…/day-trends-section.tsx`,
`components/weekly-recap-banner.tsx`.

The recap said its piece in prose and showed none of the numbers it was talking about. The daily
review has had four trend rows since Q-112d; the weekly one was *"deliberately last, so the daily
version settles the layout first"*, then sat blocked on an engine half that LB-64 shipped on
2026-09-09. This is the half that was waiting.

## Widened, not forked

The two routes serve the same shape under different names — `days`/`sevenDayAverages` against
`weeks`/`priorAverages` — and the arithmetic between them is identical. A second copy of a formula
is a bug by definition in this repo, so the day review's module took a window instead of a response:

```ts
export interface TrendWindow { points: TrendPoint[]; priorAverages: TrendPoint }
export function trendRowsFor(window: TrendWindow): TrendRow[]
export function trendRows(data: WeekWindowResponse) =           // the daily caller, unchanged
  trendRowsFor({ points: data.days, priorAverages: data.sevenDayAverages })
```

`TrendRowCard` moved from private to exported and took three optional props. Everything that
genuinely differs between a day and a week is now named at the call site rather than branched on
inside: the sparkline domain (`TREND_WEEK_TIME_DOMAIN` `[0,4]` against the daily `[0,7]` — sharing
one would squash five weekly points into the left five-eighths of the chart), the phrase a delta is
measured against, and what to call a missing reading.

`trendSeries` also stopped taking `WeekWindowDay` and started taking a structural `TrendPoint`. The
`date` field it was carrying was never read by the maths, and it was the only thing making the
function daily.

## The route, and the one it is not

`GET /api/weekly-review/month-window`, not `/api/weekly-digest`. The digest computes these numbers
and throws them away, which makes widening it look cheaper — but it is a POST that runs an LLM,
rate-limited and cached as prose, and a chart wants freshness on a different clock from a paragraph.
LB-64's route note already argued this; the client half now honours it.

`useCachedValue`, not a fetch-once effect, because this renders inside Home — the persistent tab
shell, where `useEffect(…, [])` holds its first payload until the app is killed (Q-402) — and with
an `onError`, because `cachedFetch` swallows `!res.ok` including the route's own 429 (Q-499).

**The request only fires when the banner is opened, and that was checked rather than assumed:**
`dismissible-banner.tsx:81` renders children behind `expandable && expanded && children`, so the
section does not mount on a collapsed banner.

## Verification

Driven against the running app with **only the LLM half stubbed** — the trends read the real route
against the real database, because stubbing the half under test would prove nothing:

```
month-window status: 200
weeks: [… 2026-08-03 … 2026-08-31]   priorAverages: {rhr 58, steps 8550, volume 3240, weight 82.06}
rows: ["No reading this week", "↓ 8,550 below the last 4 weeks",
       "No reading this week", "↓ 0.3 kg below the last 4 weeks"]
sparklines drawn: 4
```

The arithmetic checks by hand: weight 81.767 against a prior mean of 82.061 is −0.294, printed at
the delta's one decimal as **0.3 kg below**. Resting heart rate and session volume have no reading
in the reported week and say so instead of drawing a gap as zero. Rendered at 412×915 and read back
from the DOM.

**Mutation-tested.** Making `trendRowsFor` read `points[0]` instead of the last point — the mistake
this window invites, since five ascending points look nothing like eight — fails **6** of the 19
tests, three of them the new weekly ones. One mutation breaking both surfaces is what "shared, not
forked" is supposed to mean.

`pnpm check:rules` **Ran 74 of 74** · `tsc --noEmit` and `eslint` clean · `pnpm test` **890 files /
8418 tests / 0 failed** by real exit code with `DATABASE_URL` set · `pnpm build` exit 0.

## Not exercised

The S25. This is a 412 dp harness measurement, not glass, and the recap is a banner on Home whose
expanded body now grows by four cards — worth a look on the phone. Carried as the entry's `Keep:`.

The weekly digest's own prose path was **stubbed**, so nothing here says the LLM route still works;
it was untouched and is covered by its own tests.

## One thing left for Lane A

The new cache key `weekly-review-month-window:` uses the shared `TTL_MEDIUM` tier rather than a
named constant. A named one belongs in `packages/shared/src/cache-ttl.ts` beside
`DAY_REVIEW_WEEK_WINDOW_TTL`, and that file is Lane A's. With one call site there is no divergence
for `check-cache-ttl-divergence.js` to find; the day a second site reads this key, promote it.

<a id="2026-09-13-bf152-rmr-anchored-budget"></a>

# 2026-09-13 — BF-152: the budget should anchor to a rule, not to a number (BugFix intake)

Docs-only. The owner read the budget the morning after BF-150 shipped and asked whether exercise had
stopped counting: *"So its showing 1660 now; does that mean that excercise doesnt get coutned now?"*

## Exercise was counting; there was nothing to add yet

`budgetProvenance` returns `base + earned` and always has. He had **374 steps** at the time — about
13 kcal — so the figure was sitting on its base. Yesterday, with 2,923 steps and a strength session,
it would have moved. Nothing was broken, which is worth recording because the report reads like a
regression and is not one.

## What he actually asked for, and why it is not what shipped

*"Rmr+body metabolism as base — Calories burned per day based on HR/excercise … It should start at
1350 - and as I walk/workout - move throughout the day to 1600."*

BF-150 anchored the budget to a stored **number** (`nutrition_targets.calories` = 1,660). He is
describing a **rule**. The distinction is the entry: a typed-in figure cannot track a body that is
changing, and his is — 72.1 kg at the RMR test on 2026-08-27, 70.2 kg on 2026-09-13.

## His two figures are his own physiology, measured

| | value |
|---|---|
| measured RMR (2026-08-27, FFM 51.5 kg) | 1,325 |
| Cunningham residual | −157 |
| FFM today (70.2 kg, 25.5% corrected) | 52.3 kg |
| **re-scaled RMR today** | **1,342** |
| `bmr × 1.2` (sedentary multiplier) | **1,611** |

*"Start at 1350"* is his measured resting rate to within 8 kcal. *"Move to 1600"* is that rate plus
the classic sedentary multiplier — which is exactly the overhead he went on to name himself: *"I know
1350 doesnt count some basic metabolic needs."* He described the textbook model without reaching for
it.

The value the fix needs is already computed one scope away: `energy-balance-service.ts` derives `bmr`
as `personalRmr(measured, todaysFfm)` (BF-42). **`restingBaseKcal` is the wrong one** — on the
calibrated path it is `maintenance − avgActive`, and that maintenance is the estimator BF-137 is
about.

## The one thing left to the owner

RMR excludes the thermic effect of food (~140 kcal at his volume) and non-step NEAT. The entry
recommends crediting that through movement rather than through a multiplier — the multiplier asserts
the overhead happened, the step credit observes it — and naming the residual in the ⓘ copy instead of
modelling it. Modelling TEF as an earned credit makes the budget grow as he eats, which the card then
has to explain, for a number inside food-logging error. The entry is buildable either way and says
so.

Filed at the top of the queue. Nothing else in BF-150 changes: one budget expression across three
surfaces, the goal delta still not applied on top, `deviationKcal` still measured against the budget.

## Not exercised

Docs only. The 1,342 and 1,611 figures are computed from production rows (`measured_rmr`,
`body_metrics`) against the shipped `cunninghamBmr`, not read off a running app.

## A correction made in the same PR

The first pass through this said Lane A should re-read **TN-27 and TN-29** because BF-152 moves the
ground under them again. It does not. Those two were downgraded to *informational* when PR #1128
stopped the budget following the maintenance estimate, and BF-152 keeps them there — the base becomes
the measured resting rate, and the estimator still takes no part in it either way.

**TN-28 is the one that reverses.** Its own amendment, written the same day, reads *"the stored
target … is now the thing everything else follows"* and concludes the card's one-tap write is
therefore **more** consequential. BF-152 takes the stored target back out of the budget, so that
escalation lasted a day. TN-28 now carries a second amendment saying so, rather than leaving the
contradiction for whoever picks it up.

<a id="2026-09-13-bf153-vial-sheet-legibility"></a>

# 2026-09-13 — BF-153: a screen with the right numbers that cannot be read (BugFix intake)

Docs-only. The owner had the Retatrutide vial sheet open, with correct values in every field, and
asked *"Can you explain how this works? Where am I meant to update the dose?"*

## The answer took reading the save path

There are three numbers on two screens and only two of them persist.

| what he sees | what it is |
|---|---|
| `Amount` in the manage sheet | **the dose.** `supplements.default_amount`, seeds every prompt |
| "How much did you take?" | a one-off override for that day only |
| `Dose (mg)` in the vial sheet | **a calculator input that is never saved** |

`save()` posts `{ ...draft, openedOn }` — `strengthMg`, `waterMl`, `syringeUnitsPerMl`. `doseMg` is
not in the body. It is seeded from the definition, converts mg to syringe units, and is discarded on
close. The field that says *Dose* is the one that cannot change the dose.

## Two dates, two objects, no label

`Opened on` defaults to **today** because the form creates a new vial — BF-136 made that deliberate
and its docstring explains why prefilling from the current vial would recreate the defect one vial
along. `VialOpenedNote` beneath it reads the vial he already has. On his screen: **13/09/2026** and
**10 Sept**, both correct, five lines apart, with the footer reading *Save as a new vial*.

That button is the reason this is not cosmetic. BF-136 established that a wrong opened-date can only
be fixed in place — `listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`,
so a corrective vial dated earlier sorts below the wrong one. A screen that invites a press to "save
my dose" sits on top of that.

## The recommendation says what NOT to build

Making the Dose field write the definition would reverse BF-112's separation of the definition from
the day's log, and would let a units calculation silently re-set every future prompt. The fix is
presentational: name the create-form as one, put the vial in use above it, and label the Dose field
for the arithmetic it does.

## What needed no fix at all

Today's log already reads **1 mg** — he entered it at the prompt, which is exactly the surface for a
one-off change. The definition still says 0.5, so the *next* prompt starts there again. That is the
system working as designed and the owner not being able to tell, which is the entry.

## Not exercised

Docs only. The save path was read rather than run; the 1 mg log and the two dates were read from
production rows.

<a id="2026-09-13-bf154-budget-breakdown-addends"></a>

# BF-154 — the budget's explanation now names the terms it was built from

**Branch:** `lane-a/bf154-budget-breakdown-addends` · **Lane A** · one component, one caller, one
docstring, two test files.

## What was wrong

The sentence under the macro row on Nutrition named the day's budget and then broke it into terms.
Those terms were the addends of the formula BF-152 retired — `restingBaseKcal`, `targetNetKcal`,
`activeKcal` — printed beside a budget the new formula produced. The owner's screenshot, the evening
BF-152 deployed: *"Today's budget is 1,294 — 2,278 resting burn, −200 for your goal, +0 moved."*
`2,278 − 200 + 0 = 2,078`. One sentence, naming a number and then contradicting it by 784 kcal.

The second half is the worse half. On the calibrated path `restingBaseKcal` is
`maintenance − avgActive`, which carries the estimator inflation BF-152 moved away from — so the card
printed **2,278 labelled "resting burn"** ten lines above the zone bar's **1,294 labelled "resting
rate"**. Two figures 984 apart, both named resting, one of them a number the app has stopped using.

## Why the existing guard did not catch it

`base-label-reconciles.test.ts` reads `calorie-zone-bar.tsx` and nothing else, and bans one
destructured value beside one word. This call site never asked `budgetProvenance` anything — it read
the balance fields off the payload directly — so there was nothing for that guard to match, on a file
it was not looking at. BF-150's own journal entry had already named this shape in the abstract
(*"printing base − goal there would name two numbers that are not addends of what is on screen"*);
what was missing was a check that could see a second surface.

## What shipped

`EnergyCard` gains `baseKcal` and `baseIsRestingRate`, passed down from the `budgetProvenance` call
`nutrition-content.tsx` already makes. **Deliberately not a `budgetProvenance` call inside the
card** — that file's whole discipline is that it derives no number, and three prior findings put it
there (Q-401's two budgets 274 apart, Q-417's third budget from a locally-composed sum, Q-323's
unscaled macro ring). A fourth computation of the same quantity is the thing the discipline exists to
prevent, so the values arrive as scalars beside the `earnedKcal` prop that was already doing this.

The sentence now branches the way the zone bar does: the resting rate on the anchored path, resting
burn plus a named goal delta on the unanchored one, then the earned term. It sums to the budget it
names on both.

**One judgment call, made rather than asked.** With nothing earned the budget *is* the base, and the
first cut printed *"1,815 — 1,815 resting rate"* — the same figure twice, three words apart, in a
sentence whose report opened *"There is so many numbers here."* That case now reads *"your resting
rate"* without repeating the number. Cheap to reverse; it is one ternary.

**Not done, deliberately — and the owner answered it while this was being gated.** The macro grams
still key off the stored goal while the budget follows the resting rate, so the printed gap moved
from ~295 to ~365 and does not close. That was left open here as his call, on the reasoning that
moving the grams changes what he is told to eat. **He decided the same day** (#1153, landing on
`main` mid-gate): *"Can we have it dynamically sized for my calories? I.e before excercise its 1
value and after its another if calories increase?"* The grams follow the budget.

The answer arrived attached to BF-154's backlog entry — the entry this PR was deleting. Resolving
that conflict by removing the entry would have removed the decision with it, which is the failure
this repo's backlog rule exists to prevent. **BF-154 stays queued** with the re-anchor named as what
is owed, carrying his words verbatim.

It was re-queued with a `Keep:` line first, and that was wrong — corrected immediately after. `Keep:`
marks an entry owing an owner or device *check*, and `next-item.js` files those under a KEEP bucket
headed *"shipped; only the stated residue is owed. Not new work."* This owes a code change the owner
has already approved, so the field hid startable work under a heading telling the lane not to look —
the exact failure OR-100 is filed about, reproduced within an hour of writing it. As a plain entry it
sits at #2 of Lane A's READY, which is where an answered, buildable item belongs. `macro-budget-gap.ts` now records that
the question is settled and that **the module itself should be deleted** when the re-anchor lands:
it exists only to measure a disagreement that will then be zero by construction, and so does the
paragraph this PR just fixed.

## Verification

| check | result |
|---|---|
| Mutation — retired addends restored | **killed** (3 assertions) |
| Mutation — anchored base labelled "resting burn" | **killed** (3) |
| Mutation — goal delta dropped on the unanchored path | **killed** |
| Mutation — `budgetProvenance` recomputed inside the card | **killed** |
| Control — `budget?.base ?? null` → `budget ? budget.base : null` | **survived**, as it should |

Driven through the real page with Playwright, both branches, numbers parsed out of the rendered
sentence rather than matched against an expected string:

- no movement → *"Today's budget is 1,815 — your resting rate, nothing moved yet."*
- with movement → *"Today's budget is 2,529 — 1,815 resting rate, +714 moved."* → `1,815 + 714 = 2,529`

**The spec was run against the defect before being run against the fix**, which is the only thing
that makes it evidence: with the old card restored it failed with *"Today's budget is 1,815 — 2,069
resting burn, +300 for your goal, +0 moved"* — `2,369` against a named `1,815`, the same class as the
owner's 784 and reproduced on a fixture.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean.

**Not exercised:** no device or APK run — this is a WebView-delivered JS change, so it reaches the
phone on the next Railway deploy with no rebuild, but the sentence has not been read on the S25 at
412 dp. The owner's own check is one look at the Nutrition tab: the terms beside the budget must add
up to it, and no figure labelled *resting* may appear twice with different values.

<a id="2026-09-13-bf154-budget-breakdown-contradicts"></a>

# 2026-09-13 — BF-154: the budget's explanation contradicts the budget (BugFix intake)

Docs-only. The owner opened the Nutrition tab the evening BF-152 deployed and sent a screenshot:
*"There is so many numbers here. I thought the base would be above 1350?"*

## The base is right; the sentence under it is not

**1,294 is correct.** BF-152's entry quoted 1,342, computed from the scale's raw 25.5% body fat. The
app uses the DEXA-corrected figure (BF-2) — about 28.7%, so fat-free mass of 50.1 kg rather than 52.3
— and `cunninghamBmr(50.1) − 157` gives 1,294. The measurement, its Cunningham residual and the
calibration are all doing their jobs. Only the number quoted at him came from the uncorrected input,
which is worth recording so the expectation is not refiled as a bug.

What is broken is the line beside it, verbatim from his screen:

> Today's budget is **1,294** — **2,278** resting burn, **−200** for your goal, **+0** moved.

`2,278 − 200 + 0 = 2,078`. The sentence names one number and then decomposes it into terms summing to
another, 784 kcal away.

## It prints the retired formula next to the new number

BF-152 made the budget `restingRate + earned`. `energy-card.tsx:195-201` still renders
`restingBaseKcal`, `targetNetKcal` and `activeKcal` — the addends of the expression that was
replaced — against a `goal` that no longer comes from them.

**BF-150's journal named this exact hazard the day before**: *"printing base − goal there would name
two numbers that are not addends of what is on screen — BF-99's defect wearing the opposite hat."*
The guard it narrowed bans destructuring `base` from `budgetProvenance`. This call site never asks
`budgetProvenance` anything — it reads the balance fields directly — so the guard could not see it.

## The number it prints is the one BF-152 was escaping

On the calibrated path `restingBaseKcal` is `maintenance − avgActive`, carrying the estimator
inflation BF-137 is about. So the card shows **2,278 "resting burn"** ten lines above **1,294
"resting rate"** — 984 kcal apart, both called resting, one of them retired.

## And the macro grams came unmoored

The grams still key off the stored 1,660 goal while the budget is 1,294, so the gap printed on the
card has gone from ~295 to **365**. BF-150's journal had recorded that the two *"already share a
denominator"* — 150p/141c/55f = 1,659 against a stored 1,660. BF-152 separated them and nothing
re-derived the grams. Which anchor the grams should take is a decision rather than a fix;
`macro-budget-gap.ts` says outright that choosing it is not its business.

## Not exercised

Docs only. The contradiction was read off the owner's screenshot and confirmed against the shipped
`energy-card.tsx` and `budgetProvenance`; 1,294 was reproduced by solving `personalRmr` backwards for
the fat-free mass that yields it.

<a id="2026-09-13-bf155-bf156-duration-and-accept"></a>

# 2026-09-13 — BF-155 and BF-156, and the owner settles the macro anchor (BugFix intake)

Docs-only. Three things from one exchange.

## BF-155 — the durations are wrong, and not for the reason reported

The owner: *"my amrap week all has under 5mins workout time."* The symptom is real and the scope is
wider: **every session since 6 September**, AMRAP or not.

| session | real | printed | set rows | with `set_end_ms` |
|---|---|---|---|---|
| 12 Sep | **12.0 min** | **3 min** | 5 | **0** |
| 10 Sep | **38.3 min** | **3 min** | 5 | **0** |
| 9 Sep | 33.3 min | 2 min | 5 | 0 |
| 7 Sep | 40.0 min | 2 min | 5 | 0 |
| 5 Sep | 63.4 min | 61 min | 10 | 5 |

`logExerciseFromPayload` stamps each row `lastSetEndMs ?? workoutStartedAt ?? now`. With no
`set_end_ms` on any set, every exercise falls to the second rung — and that is one value per session.
All five rows on 12 Sep read **`logged_at = started_at = 00:38:37.167`, identical to the
millisecond**. `day-log` then computes `end = max(loggedAt + timeToComplete)`, which is the start
plus the single longest exercise: 202 s, so 3 min. `completed_at` was correct on the session row the
whole time and is never read.

**The entry deliberately does not pick between two triggers.** Every broken session has exactly one
set per exercise and every good one has two or more; every broken session is also baseline-shaped.
The 5-of-10 ratio on the working sessions says `set_end_ms` was already sparse there, so "the last
set is missing one" does not explain it either. That needs the path walked rather than guessed.

**It is filed as Lane A because `logged_at` is not only a label** — it orders 1RM history and trend,
breaks PR ties, and keys per-set HR attribution. Five sessions now hold rows claiming one instant.
The fix is in two parts and the entry says so: prefer `completed_at` in `day-log`, *and* restore the
missing `set_end_ms`. Shipping only the first repairs the card and leaves everything else reading
collapsed timestamps.

## BF-156 — one button, two opposite consequences

*"What happens if I dont select to apply the session? Its pretty easy to miss that button."*

Two answers, and the card looks the same for both. `prescriptionDrivesLoad` splits the phase actions:
a pending `stay` or `transition_recommended` **already drives today's loads**, so skipping Accept
costs only the phase decision. A pending `deload`, `session_swap_recommended` or rest **does not** —
skipping Accept silently reverts to the program's base style.

He has a row at `pending` / `session_swap_recommended` right now, so this is live rather than
theoretical. The design itself is right and the entry does not reargue it; `apply-prescription.ts`
explains the split well. The defect is presenting a rule with two opposite outcomes through one
unlabelled button.

## BF-154's open question, answered

*"Can we have it dynamically sized for my calories?"* — the macro grams follow the budget.
`scaleMacrosForEarnedKcal` already grows them with earned movement; what changes is the base it
scales from. Recorded on BF-154 with the flag that protein is held constant by that function, so
re-basing from 1,660 to ~1,294 drops carbs and fat while 150 g protein stands.

## Not exercised

Docs only. Every figure above is from production rows; the mechanisms were read in the shipped
source, not run.

## BF-157 — the bodyweight ready screen has no clock, filed in the same PR

*"The body weight screens have no warmup timer or load time so its just infinite on this screen"* —
sent with the Pull-Up ready screen showing a session clock at 8:42.

```js
const set1 = workingWeight
if (!set1 || set1 <= 0 || soloMode) return null   // bodyweight is 0
```

`warmupSets` is null for a bodyweight exercise, which is **right** — 50/74/92% of nothing is not a
warm-up. But the on-screen ramp timer renders *from* that array, so dropping the ladder dropped the
clock. Two separate ideas behind one gate.

The intent is visible in what still works: the notification chip runs
`transitionSecForEquipment(equipment)` and `Pull-Up` carries `['bodyweight']`, so it counts down a
correct 60 seconds against a screen showing nothing. And `WARMUP_SECTION_SEC` is still computed one
line later, hitting the helper's `sectionCount <= 0 → 40` branch, consumed by nothing.

It reaches past the screen: `prepTimeSec` is measured from how long the lifter sat there and feeds
the transition estimate behind the *"~56 min of work"* budget on the session card.

<a id="2026-09-13-chore-or-108-nutrition-device-pass"></a>

# 2026-09-13 — the Nutrition tab's device pass: 14 cleared, 3 failed, 2 bugs nobody had filed

**Branch:** `chore/or-108-nutrition-pass` · backlog only. No product code.

## What the pass bought

Nineteen device checks sat on one tab. The owner worked through them in a sitting and the queue's
`Verify: device` debt went **58 → 44**.

**Cleared (14):** BF-101, BF-103, BF-104, BF-109, BF-26, BF-46, BF-52, **BF-57**, BF-72, BF-73,
BF-75, BF-76, Q-187, Q-406.

**BF-57 is the one worth naming** — the two-phone, two-account test, the only item on the whole
134-item list that could not be done alone. A friend scanned a `Share code` label from their own
account and the meal saved.

## Three failures

- **BF-74** — *"it gives me an undo option; but no warning before removal"*. The ✕ is reachable, so
  the corner fix worked; it destroys the photo on one tap and offers a toast afterwards. **The entry
  checked WHERE the control sits and never asked what hitting it costs** — which, on a photo just
  taken, is the whole risk.
- **BF-98** — the inverse of the original defect: a collapsed section holding a *grouped meal* shows
  no macro overview, while one holding loose items does. **Filed with both readings and neither
  chosen**, because they point at different components and `meal-card.tsx:90` suggests one of them
  should already work.
- **BF-99** — *not a failure of the app.* The checklist sent the owner to the Nutrition gear icon,
  which holds only meal-type names. **My error**, recorded in the entry so the re-ask names the real
  route first.

## Two bugs that were not in the queue at all

- **OR-108 (new)** — *"scanning barcodes still doesn't auto save an image for the food; or does
  taking a photo of the food save the image either."* Reported against LA-36 and **is not LA-36**:
  that entry says the column is written and read by nothing; this is the other end — two capture
  paths that both have an image in hand and discard it.
- **BF-134** — the owner specified the calorie model they want, for the **second** time verbally:
  open at base ± goal and *earn* exercise calories rather than forecasting them (~1300–1400 at rest,
  ~1600 after a session). **A requirement given twice with no entry is the finding.** It also
  contradicts LB-50/BF-102's measured activity factor, which is noted so the app does not ship two
  models.

## One check retired on the owner's instruction

**RV-35** needed the app left open across midnight. Owner: *"lets just make the best guess and file
it as a non issue till its reproduced."* Its `Verify: device` is removed — but the entry now says
what that buys: a fix landing without a device check **needs a test that fails before and passes
after**, because nothing else will catch a regression there.

## The pattern worth carrying into the next section

Three entries came back *"I don't know where this is"* and were nonetheless marked pass. **A check
whose location the owner cannot find collects false passes.** Locations were added to all 19 Nutrition
items mid-pass; the same is owed for every section before it is handed over, not after.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.

<a id="2026-09-13-chore-or-109-owner-answers"></a>

# 2026-09-13 — three owner answers, and two of them were filed as "Defer"

**Branch:** `chore/or-109-owner-answers` · two backlog entries amended, one checklist fixed. No product code.

## Where the answers came from

The S25 verification checklist (134 items) is backed by an artifact store, so answers read straight
back — no export, no copying. Four items were answered in the first sitting; three were decisions.

## E2E becomes advisory (LB-56)

Chosen over both alternatives. Two things are recorded beside it so they do not evaporate:

- **The re-require step is the closing condition, not an aspiration.** LB-56's own text warns that an
  advisory check decays unwatched — which is how it reached ten failures unnoticed. E2E returns to
  the required set once `main` is green.
- **The entry does not close on the toggle.** Dropping it from branch protection is a repository
  setting, the owner's click. What stays queued is fixing the four specs. **LB-54's baseline half
  (`Needs: LB-56`) unblocks the moment this lands.**

## The retention rule (Q-30) — read the notes, not the buttons

Both storage questions were tapped **Defer**. Their notes were not deferrals:

> *"Try use as much phone storage as possible. But if its only 21MB; we can keep it for now."*
> *"As long as its ONLY on the [device] storage — I don't want to use railway as a permanent
> solution; so we don't want to store too much on cloud."*

Together: **the phone holds the data; Railway holds the smallest thing that makes a lost phone
survivable.** That settles three of Q-30's four open questions — the server keeps a packed backstop,
the 14-day device window has to change now the device is the archive, and a wiped device restores
from that backstop.

**The condition is the part worth keeping.** 21 MB was *priced*, not exempted. If the packed tier
stops being about that size the decision is re-opened — an entry recording only "yes, keep a
backstop" would let a later session grow it without noticing it had changed the deal.

**One question the answer does not reach:** `error_events` is 52 MB, the second-largest object in the
database and bigger than the whole packed archive, currently holding BF-110 telemetry rather than
faults. Nobody asked about it, so nobody answered it.

## The checklist had a design bug and it produced a false answer

**ASK-4 asked the owner to *clear a field* and offered Works / Broken / Can't check.** They tapped
**Works** — reasonably, since the supplement does work — while the field sat untouched. Production
confirmed it: `dose = '10mg'`, unchanged since 2026-09-06.

A question that asks you to *do* something cannot be answered with a judgement. Four items are now
kind `action` with **Done / Couldn't / Skip**: ASK-4, BF-106 (press VACUUM FULL), Q-71 (the
historical redecode), LA-68 (restore 22 wear-time days).

**ASK-4 is also less urgent than it was filed.** OR-104 shipped in the meantime: the free-text field
now relabels itself to *"Note"* once an amount exists and says *"The amount above is the dose — it is
not counted."* The `10mg` is inert. Its code comment explains why it was relabelled rather than
hidden: *"a field you cannot see is a field you cannot correct."*

## Not done

- The branch-protection toggle (owner's click).
- The `CLAUDE.md` growth figure — still says ~0.4 MB/day against a measured 1.8. The owner's answer
  was about *where data lives*, not about that number, so it stays open rather than being read into.

**Surfaces not exercised:** none apply — docs and a checklist page; no runtime code, no schema.
`pnpm check:rules` **Ran 74 of 74**.

<a id="2026-09-13-chore-or-111-app-shell-pass"></a>

# 2026-09-13 — the app-shell pass: two "fixed" entries were fighting over the same 384 pixels

**Branch:** `chore/or-111-app-shell-pass` · backlog only. No product code.

## The finding worth the whole sitting

**BF-96 and BF-139 are one defect, and each has now been declared fixed once and failed once.**

- BF-96 requires the weather pill to stay on **one line**.
- BF-139 requires **three chips whole** at the right edge.

Both shipped. Both failed in the same sitting, with the same symptom — *"Day is cut off"* and
*"Its now squished the day of the week"*. The header row is a **fixed width budget and nothing in it
was defending the date**; each entry bought its own element room out of the only slack available.

They are now `Batch: header-row-width`, batched on the verification per this file's rule: one look at
the longest real date (`Wednesday 30 September`, 22 characters) **with `· UV n` present** settles
both, and fixing either alone re-breaks the other.

## Three more failures

- **BF-100** — *"Checked on more - and still doesnt work"*. Its **second** failure. **RV-36 passed in
  the same sitting**, which narrows rather than contradicts: scroll restoration largely works, and
  `/more` specifically does not. RV-36 also carries a second, separate requirement the owner named —
  **back from a tab with nothing to pop should land on Home, not exit.**
- **BF-95** — *"Still requires a little pause."* Reads like a near-miss and is not: the entry's bar
  was the confirmation appearing on the **first** press, so a shorter pause is the same defect. The
  note says so explicitly, to stop the next session tuning a constant down instead of fixing the
  sequencing.
- **BF-111** — failed with no note. The entry is flagged to **ask for the screenshot first**, because
  its difficulty is *which number is wrong where*, and a bare fail cannot say which of the three
  states broke.

## Six verified, with their complaints kept

BF-82, Q-531, Q-93, RV-37, RV-36, BF-145. Two passed *with* a complaint, and both are recorded as
complaints rather than converted into fixes: the More page is *"still not as organised as I would
like"* and the device consoles *"could be labeled better"*. **A pass with a grumble is not a defect,
and turning it into one invents work the owner did not ask for.**

## Two checks left the device queue

- **BF-86** — *"this is something i wont be able to test."* The re-prompt needs a morning already
  answered and then reset. Leaves on RV-35's terms: ships on code and a test, and **a fix needs a
  test that fails before and passes after.**
- **PS-35b** gained a **scope rule**, not an answer: *"Let's not do any testing for the web ui app;
  only the apk."* Its ① (the PWA `start_url`) is real but unobservable on the APK, which never reads
  the manifest. ②③④ stay — they run inside the WebView. **The general rule: a check only
  reproducible in a browser does not go in front of the owner.** That is `CLAUDE.md`'s Canonical
  Runtime policy with its checklist consequence made explicit.

## Result

Device debt **43 → 37**.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.

<a id="2026-09-13-fix-bf90-verify-guard-allows-verified"></a>

# 2026-09-13 — a sentence saying a gate was withheld was read as a gate, and it turned `main` red

**Branch:** `fix/bf90-verify-guard-allows-verified` · one guard amended, one backlog entry reworded,
one follow-up filed. No product code.

## The red

`scripts/__tests__/backlog-verify-field.test.ts` failed **11 of 34** on `main` and on every branch cut
from it, from #1136 onward. Nine failures were one assertion repeated; two were the end-to-end
classification.

**The cause is two things, and only their combination is visible.**

1. **The guard did not know about the third state.** It asserts that seventeen shipped entries carry
   `Verify: device` rather than `Gate: device` — BF-90's invariant, that finished work must never sit
   in PARKED beside work that genuinely cannot start. The owner's 2026-09-13 nutrition pass (#1136)
   verified nine of them on the S25, which correctly removes the `Verify:` bullet: there is nothing
   left to look at. So nine assertions went red **for device checks that had actually happened.**

2. **Underneath that, a real bug the guard was right to catch.** BF-46 came back as PARKED. Its
   `Keep:` block contains the sentence *"**The `Gate: device` above was deliberately withheld while
   they were unbuilt**"*, and `keep.js` reads a `Gate:` from anywhere in a Keep block — so a sentence
   **denying** a gate was parsed as asserting one. `next-item.js` had been cancelling it because the
   entry also carried `Verify: device` for the same value; removing the `Verify:` un-cancelled the
   phantom, and a verified entry went back to being parked.

The second is **the repo's own recurring class** — *"guards find their own documentation"*, in
CLAUDE.md and in Lane A's baton. Every previous instance was fixed by stripping comments before
scanning. A Keep block has no comment syntax to strip.

## What shipped

- **The guard now accepts the verified state, and accepts exactly one of the two.** An entry must
  carry `Verify: device` **or** record a device verification — not both, not neither — and in neither
  case may it carry a `Gate:`. `toBe(1)` on the count rather than an `||`, so a silently dropped
  `Verify:` and a verified entry that kept its bullet both still fail.
- **The end-to-end half reads which group an id is in off the FILE**, not off a second hardcoded list.
  The snapshot list drifted once already — that is this bug — and its job is now only to say which ids
  are in scope. "Not parked, never offered as startable" is asserted for all seventeen; the
  VERIFY-versus-KEEP split only for those that still owe a look.
- **BF-46's sentence no longer names the field**, which is what clears the red. The parser is
  untouched on purpose and is filed as **LA-103**, with the measurement and with the trap written
  down: anchoring the regex to a bullet start would lose the 7 legitimate inline mentions and silently
  un-park genuinely blocked work, which is worse than the bug.

## Verified

`node scripts/next-item.js --all` puts BF-46 in KEEP rather than PARKED, and the other sixteen are
unmoved. **Mutation pass: three mutants, all killed** — BF-46's prose gate restored (the exact
red-`main` cause), a real `Gate:` added to a verified entry, and a verified entry also claiming
`Verify:`. One deliberately equivalent control — rewording a verified marker's trailing note —
survived. All 26 script guard files pass, 251 tests.

**Not exercised:** nothing device or runtime; this is a backlog parser and its test.

<a id="2026-09-13-fix-food-capture-saves-image"></a>

# 2026-09-13 — a photographed or scanned food keeps its picture (OR-108)

**Branch:** `fix/food-capture-saves-image` · **Agent:** Implementation Lane B

Owner, from the nutrition device pass: *"images are working fine on my end; but scanning barcodes
still doesn't auto save an image for the food; or does taking a photo of the food save the image
either."*

## What was actually wrong

Nothing beneath the capture screens. `/api/nutrition/barcode` already fetches and caps Open Food
Facts' thumbnail, the food-items route already accepts `imageDataUri`, `createFoodItem` stores it,
and the outbox, pull delta and on-device mirror all carry it. **Three callers at the top dropped it**,
each by rebuilding a payload field by field:

| surface | what it did |
|---|---|
| `ingredient-picker.tsx` barcode scan | copied twelve fields off the lookup and not the thirteenth |
| `capture-actions.tsx` photo scan | the scan route returns no picture, and the user's own photo was discarded with `pendingPhoto` |
| `food-logger-sheet.tsx` refine | a correction is a text-only re-scan, so its absent image overwrote the one on the form |

`capture-actions`' **barcode** path never had the bug — it hands the whole response to
`onScanResult`. That contrast is the point: the paths that pass the object through were fine, the
paths that rebuild it were not.

## The 8 KB body cap — found by the test, not by reading

The camera half 413'd the first time it ran end to end. `POST /api/nutrition/food-items` caps its
whole body at **8 KB** — a constant written for *"a name, a brand and a dozen macro numbers"*, before
BF-35 gave the route a **16 KB** image field. Base64 costs a third more than the bytes it carries, so
an image at its own permitted cap is ~21 KB on the wire and the request is refused **before**
`rejectMealImage` runs: the user loses the food, not the picture.

Measured in the harness: a 128 px WebP of a detailed 600 × 400 source at q0.8 is **6,612 bytes =
8,816 base64 characters** — over. A smooth photo-like source is 1,410 and fits, which is why nobody
had hit it.

The route is Lane A's file, so it is filed as **LB-101** and the client works around it: the shared
thumbnail helper now walks a quality ladder (0.8 → 0.6 → 0.45) down to a wire budget, and
`thumbFromPhoto` drops the image rather than send a body that would 413. **Dropping the picture is
always the better failure than losing the food.** The workaround, and the two assertions pinning it,
come out when LB-101 lands.

## Also in the diff

- `THUMB_MAX_DIM` / `THUMB_QUALITY` / WebP moved out of `meal-photo-tile.tsx` into
  `lib/media/downscale-image.ts` as `downscaleToThumbDataUrl`. Three arguments, all silent when
  wrong — a JPEG at the same box is roughly twice the bytes against a cap nothing checks loudly.
- The two capture file inputs are named (`food-photo`, `food-gallery`), for the reason BF-46 ①a
  records: a bare `input[type="file"]` reaches whichever comes first in the DOM.

## Verification

- `e2e/food-photo-saves-image.spec.ts` — drives the real flow (pick → scan → review → assign →
  save) and reads the stored `image_data_uri` **back out of Postgres**, asserting it is WebP, inside
  the cap and inside the wire budget. Mutation-proven: reverting the one-line writer fails it.
- `components/nutrition/__tests__/food-image-write-paths.test.ts` — source guards for the barcode
  payload and the refine, which need a camera to reach and so have no e2e (the same reason
  `builder-barcode-scan.spec.ts` gives). Mutation-proven on the barcode assertion.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean against the local database
  (the 11 `backlog-verify-field` failures seen mid-session were `main`'s, fixed upstream by #1137).

## Not verified

- **Not on the device.** The web `<input>` feeds the same `handlePhoto` and the same canvas
  re-encode the S25 runs, but the Capacitor camera's own capture — permissions, `CameraResultType`,
  the plugin's `width`/`height` hints — is not exercised here.
- **The picture will not appear on a food row on the device yet.** `LA-36` is still open: all three
  local-store read paths omit `image_data_uri`, so the canonical runtime reads the column back as
  null even now that it is written. The web path (`GET /api/nutrition/food-items`) does return it.
- **The barcode path is not driven end to end** — `BarcodeScanner` needs a camera in both runtimes.

<a id="2026-09-13-fix-vial-sheet-says-what-it-saves"></a>

# 2026-09-13 — the vial sheet says which vial, and which numbers it keeps (BF-153)

**Branch:** `fix/vial-sheet-says-what-it-saves` · **Agent:** Implementation Lane B

The owner, with the sheet open and the right figures on it: *"Can you explain how this works? Where
am I meant to update the dose?"*

## Why that was a reasonable question

Two things, both verified against the file before any change — the entry's account was accurate in
every particular:

- **`Dose` was a calculator input that `save()` never posts.** The body is `{ ...draft, openedOn }`
  and `draft` is `strengthMg` / `waterMl` / `syringeUnitsPerMl`; `doseMg` is not in it. It is seeded
  from the definition's `defaultAmount`, drives the mg → units arithmetic, and is discarded on
  close. The real dose lives on the definition and is edited in `manage-supplements-sheet.tsx` under
  **Amount** — another sheet, another word for the same quantity.
- **Two dates, five lines apart, both correct, nothing saying they belong to different objects.**
  The `Opened on` input defaults to **today** because the form creates a NEW vial — BF-136 made that
  deliberate and it must stay — while `VialOpenedNote` below it read `current.openedOn`, the vial he
  already had. On his screen: 13/09/2026 and 10 Sept, simultaneously.

The cost is not cosmetic. The footer said *Save as a new vial*, and a stray press restarts the
weight-response window — which BF-136 established can only be corrected **in place**, because
`listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`, so a corrective vial
dated earlier sorts below the wrong one.

## What changed — presentational throughout

| before | after |
|---|---|
| `VialOpenedNote` below the form, unheaded | first on the screen, under **The vial you're using** |
| form headed `This vial` | **Open a new vial** (`Your vial` when there is none) |
| section headed `Dose`, field `Dose (mg)` | **Work out the units**, field **Try a dose (mg)** |
| nothing said the dose was unsaved | *"Not saved — this only works out what to draw. Your saved dose is 0.5 mg, changed in Manage supplements, under Amount."* |
| footer button, no warning | a line above it: opening a second vial restarts the window, and Change fixes the current one |

**The Dose field deliberately does NOT write the definition.** That would reverse BF-112's
separation of the definition from the day's log, and let a units calculation silently re-set every
future prompt. The pointer is words rather than a link: both sheets are siblings in
`supplements-section.tsx`, so a link means threading a callback and cross-sheet navigation, which is
past what this entry is.

## Verification

- `e2e/vial-dose-calculator.spec.ts` gains a second test that **seeds a vial dated nine days back**
  — equal to today the defect would be invisible — then asserts both headings, that the note's date
  and the form's input hold different values, the not-saved sentence, and the footer warning.
  Mutation-proven: restoring the old `Dose` heading and label fails it.
- The existing calculator test was updated for the new label (sibling sweep) and still passes.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## Not verified

- **Not on the device.** BF-153's own check is owed on the S25: open the sheet with a saved vial and
  confirm the two dates can be told apart without reading code, and that pressing the footer button
  reads unmistakably as opening a second vial. Recorded as a Known Issue.
- The screen was measured at 412 dp in the harness, not on Samsung's WebView.

<a id="2026-09-13-la103-keep-gate-must-be-set-off"></a>

# 2026-09-13 — the measurement refuted the fix the entry proposed (LA-103)

**Branch:** `lane-a/la103-keep-gate-prose` · one parser, one new test file, backlog + journal. No
product code, no user-visible change, no version bump.

## What was wrong

`scripts/lib/keep.js` read a `Gate:` from **anywhere** in a `Keep:` block. BF-46's Keep contained the
sentence *"**The `Gate: device` above was deliberately withheld while they were unbuilt**"* — a
sentence **denying** a gate — and it was parsed as asserting one.

It hid for weeks because `next-item.js` skips a Keep's gate when the entry also carries `Verify:` for
the same value. The owner's 2026-09-13 nutrition pass verified BF-46 on the S25, which correctly
removes the `Verify:`; that un-masked the phantom, put a VERIFIED entry back into PARKED, and turned
`main` red on every branch. The red was cleared that morning by rewording the sentence (#1137); this
is the parser half it deliberately left.

## The entry proposed a discriminator, and measuring it proved it wrong

LA-103 wrote down a hypothesis from the single BF-46 case — *a mention preceded by a word character
is prose* — and then said, in its own text, that one case is not a population and the entry must not
be built on it. That instruction earned its place.

**Measured across all 164 Keep blocks: 18 yield a gate. LB-53 refutes the hypothesis outright** —
*"running it is a **`Gate: owner`** action"* is preceded by the word "a" and is a real gate that
parks real work. Seventeen of the eighteen follow a full stop; LB-53 and BF-80 are bolded.

**What actually separates them is whether the token is SET OFF from the prose** — it opens a clause,
or it is emphasised — versus sitting inside a sentence. That is `GATE_IS_SET_OFF`: look at what
precedes the token, after an optional backtick, and accept nothing, a clause boundary, or `**`.

Scanning per **line** rather than over the joined block, so a bare `Gate: device` opening a
continuation line is set off by the line break instead of hiding behind the previous sentence's last
word.

## What did not get built, and why that mattered

**Anchoring the regex to a bullet start** — the obvious fix, and the one the entry explicitly warned
off — **would have dropped all eighteen and silently un-parked genuinely blocked work.** That is
worse than the bug it fixes: the bug parks one finished entry loudly, the fix would release eighteen
unfinished ones quietly. It is pinned as a killed mutant rather than described.

## Verified

- **The rule is fitted to nineteen observed cases, so the real file is what protects it, not the
  reasoning.** The classification of `docs/implementation-backlog.md` is asserted **by id**, all
  eighteen, and it is byte-identical before and after the change.
- **Mutation pass: three mutants, all killed** — reading a gate from anywhere (the original defect),
  dropping the bold branch (loses LB-53 and BF-80), and anchoring to a bullet start (loses all
  eighteen). One deliberately equivalent control, `trimEnd()` rewritten as a regex, survived.
- Eight tests in `scripts/__tests__/keep-gate-set-off.test.ts`, plus the existing
  `backlog-verify-field.test.ts` re-run to confirm the PARKED/VERIFY/KEEP split is untouched.

**Not exercised:** nothing device or runtime — this is a backlog parser and its tests.

## Worth carrying

**An entry that records its own hypothesis as a hypothesis is what made this cheap.** LA-103 could
have said "anchor the regex" and been implemented in one line, wrongly. Instead it named the
discriminator it suspected, said it was drawn from one case, and demanded the population be measured
first. The measurement took ten minutes and changed the answer.

<a id="2026-09-13-la105-drop-thumb-wire-budget"></a>

# 2026-09-13 — the capture workaround dies with the cap that caused it (LA-105)

**Branch:** `chore/la105-drop-thumb-wire-budget` · **Agent:** Implementation Lane B

## The whole life of a workaround, in one day

Shipping OR-108 this morning, the camera path 413'd the first time it ran end to end:
`/api/nutrition/food-items` capped its whole body at **8 KB** while permitting a **16 KB** image, and
base64 costs a third more than the bytes it carries. A 128 px WebP of a detailed source is 6,612
bytes — **8,816 characters** — so the request was refused *before* `rejectMealImage` ever ran. The
user lost the food, not the picture.

That route is Lane A's, so it was filed as **LB-101** and worked around in the client: a
`THUMB_WIRE_BUDGET = 7 * 1024`, a quality ladder walking 0.8 → 0.6 → 0.45 to fit it, and a
`tooBigForTheBody` guard that dropped the image rather than send a body that would fail. Both the
entry and the code said the same thing — this exists only because of LB-101, delete it when the cap
moves.

**LB-101 shipped hours later.** `MAX_BODY_BYTES` is now
`Math.ceil(FOOD_ITEM_IMAGE_MAX_BYTES * 4 / 3) + 4 * 1024` — **25,942 bytes**, derived rather than
restated, so the two cannot drift again. Lane A filed LA-105 to collect the debt.

## What was removed

- `THUMB_WIRE_BUDGET` and the `tooBigForTheBody` guard in `capture-actions.tsx`.
- The quality ladder and the `maxEncodedChars` parameter in `downscaleToThumbDataUrl` — no caller
  passed it once the guard went, and a three-rung re-encode nothing exercises is dead weight.
  **The downscale itself stays**: shrinking a capture before upload is right regardless of what the
  route accepts, which is what LA-105 warns against removing.
- The two source assertions pinning them, replaced by one asserting their **absence** — a workaround
  that outlives its cause reads as deliberate to the next person.

## Verified by measurement, which is what the entry asked for

`e2e/food-photo-saves-image.spec.ts` stores the same fixture and reads it back out of Postgres. Its
wire assertion is **inverted rather than deleted**: it now requires the stored image to be *larger*
than the old 7 KB budget, so it fails if the ladder ever returns. The saved thumbnail is 8,816
characters — the exact size that 413'd this morning, now stored at its natural quality.

- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## Not verified

- **Not on the device.** The web `<input>` feeds the same handler and the same canvas re-encode, but
  the Capacitor camera's own capture is not exercised here. OR-108's device check still stands.

<a id="2026-09-13-lane-a-bf151-bodyweight-rep-max"></a>

# 2026-09-13 — BF-151: the bodyweight rep max is read, not reconstructed

**Branch:** `lane-a/bf151-bodyweight-rep-max` · **Agent:** Implementation Lane A

## The defect

For a bodyweight exercise the rep max *is* the reps performed, and `exercise_logs.avg_reps` stores
that figure exactly. The exercise-summary card recovered it instead by inverting a stored 1RM
estimate — reconstructing, lossily, a number the database already holds.

**One collision no inverse can resolve, which is what made this worth doing.** Verified by running
the formulas rather than trusting the entry: at bodyweight 70, `calcAmrap1RM` returns **80.25 for
both 5 and 6 reps** — the rep-factor gain from the extra rep is exactly cancelled by
`amrapScaleFactor`'s 1.0 → 0.97 step. `repMaxFromAmrapOneRm` returns the lower of the tie, which is
the most the stored number supports.

## What shipped

- **`getLastRealOneRmBatch` carries `avg_reps`** alongside the 1RM, and `LastRealOneRm` gains the
  field. The reps travel **with that 1RM** rather than coming from `lastLogs` — that map is the
  genuinely most recent log and can be a different, deloaded session, so pairing its reps with this
  1RM would describe two sessions as one.
- **`resolveWorkingBasisWithSource`** reports which input won; `resolveWorkingBasis` delegates to it
  so the usable-value predicate stays in one place, which is the whole point of that function being
  the single definition for every weight path.
- **`WorkoutExercise.prevRepMaxReps`**, populated only when the basis came from a logged set. A seed
  the user typed and an older program's PR have no reps behind them.
- **`bodyweightRepMax`** in `1rm.ts` — prefers stored reps, falls back to the inverse. The card calls
  it for both figures; this session's comes from the reps just logged.

## Decisions

- **The inverse is kept, not deleted.** A seed-derived basis and a historical series both arrive with
  no reps to hand, exactly as the entry's scope note says.
- **The choice lives in `1rm.ts`, not the card.** Both vitest projects run in a `node` environment
  and cannot parse JSX, so arithmetic inside a `.tsx` cannot be asserted at all — the condition that
  produced Q-401's two budgets on one screen, 274 kcal apart, both labelled "left".
- **The offline assembler gets `null`**, consistent with its `estimated1rm: null`: the local mirror
  has neither until the network fetch fills them.

## Verification

- **Driven against `pnpm dev` on both route paths** (`?tab=all` and the single-session tab). Bench
  Press returns `est1rm=98, prevRepMaxReps=8`, matching its stored `avg_reps`. **Deadlift returns a
  basis of 160 with `prevRepMaxReps: null`** — checked against the database rather than assumed: it
  has no logs at all, only a seed and a PR, so that null is the source guard working.
- **Mutation pass — 9 planted defects, 8 killed**, and the survivor is understood rather than
  ignored: dropping the SQL `estimated_1rm > 0` filter survives because a second JS-side `> 0` guard
  in the same function still excludes the row. Mutating **both together is killed**, so the test
  bites and the redundancy is real. Two equivalent controls survived as intended.
- **Two mutants survived the first pass and produced tests.** The source guard was never exercised,
  because the seed/PR cases left `lastRealOneRm` empty — the discriminating case is a log that
  exists but whose 1RM is unusable. And `Number.isFinite` was untested: `NaN > 0` is already false,
  so only **Infinity** reaches that guard.
- Full suite green (8,468 tests) with a `DATABASE_URL`, lint green, `pnpm check:rules` Ran 74 of 74.

## Not exercised

**No device run.** The two rep-max values render only under `isBodyweight`, so the check the entry
asks for is a bodyweight set on the S25 at a rep count other than 5 or 6 — the previous-session value
is the one that exercises the new payload field. Server and client both reach the device through
Railway with no APK rebuild.

<a id="2026-09-13-lane-a-bf152-resting-rate-anchored-budget"></a>

# 2026-09-13 — the calorie budget anchors to a rule, not to a number (BF-152)

**Branch:** `lane-a/bf152-budget-anchors-measured-rmr` · 1 shared formula, 1 service, 4 components,
2 new test files, 4 rewritten. No migration, no schema change, no APK.

## What changed

`budgetProvenance`'s zero-movement base was the user's **stored calorie target** (BF-150, yesterday).
It is now their **resting rate** — the clinically measured RMR re-scaled onto today's fat-free mass
when there is one, the predicted BMR otherwise. The earned half is untouched.

The owner's spec was a rule rather than a figure: *"Rmr+body metabolism as base — Calories burned per
day based on HR/exercise … It should start at 1350 - and as I walk/workout - move throughout the day
to 1600."* BF-150 gave him a number that happened to be close; this gives him the rule, which keeps
being right as the number moves.

## Why the stored target was the wrong anchor even though it fixed a real problem

BF-150 was escaping a resting base the maintenance estimator had inflated — it climbed 2,150 → 2,196
in a day and reached 1.44 × his Mifflin BMR in a field labelled *resting* (BF-137). That escape was
correct. What it cost was an anchor a human typed once, and his body is moving under it: **72.1 kg at
the RMR test on 2026-08-27, 70.2 kg on 2026-09-13.**

The number he asked for was already computed, one scope away. `energy-balance-service` derives `bmr`
as `personalRmr(measured, todaysFfm)`:

| | value |
|---|---|
| measured RMR (2026-08-27, 51.5 kg FFM) | 1,325 |
| Cunningham residual, `1325 − (51.5 × 21.6 + 370)` | −157 |
| FFM today (70.2 kg at 25.5%) | 52.3 kg |
| **re-scaled RMR today** | **1,342** |

His *"start at 1350"* is his own measured resting rate to within 8 kcal, and it tracks the weight loss
on its own. **`restingBaseKcal` is not that number and must not be mistaken for it** — on the
calibrated path it is `maintenance − avgActive`, so it carries exactly the inflation BF-150 fled. The
service passes `bmr`, and the mutant that passes `restingBaseKcal` instead is pinned by a test.

## What the entry got right, and the one thing it did not have to settle

Every arithmetic claim in BF-152 survived contact with the code, which is unusual here — the
Cunningham constant, the residual, the 1,342, the observation that the earned half needed no work.

Its one overrulable line was how to treat the residual: RMR excludes the **thermic effect of food**
(~10% of intake) and **non-step NEAT**. `bmr × 1.2` is **1,611** on his figures — his own *"1600"* —
and the entry recommended crediting that overhead through observed movement rather than asserting it
with a multiplier. Kept as specified: a multiplier asserts the overhead happened, the step credit
observes it, and modelling intake-linked TEF as an earned credit makes the budget grow as the user
eats. **That leaves the copy owing an explanation, which is filed as LA-102 (Lane B) rather than left
implicit.**

## Verified

- **Mutation pass: six mutants, all killed; two deliberately equivalent controls survived.** The one
  worth naming is M1 — the service handing `restingBaseKcal` instead of `bmr`, which every formula
  test passes through while the screen shows the inflated figure. BF-150's own service test existed
  because that shape survived its first pass, so this PR replaced it rather than deleting it. The
  surviving controls were `> 0` written `>= 1` (not equivalent in principle, equivalent for every
  reachable kcal) and a tautological re-spelling of the same guard.
- **Live on `pnpm dev`, both surfaces, one number.** `GET /api/nutrition/energy-balance` returns
  `restingRateKcal: 1815` for the seeded profile (no measured RMR, so the predicted path), and the
  rendered line reads `1,815 resting rate — no movement recorded yet today` on the Nutrition tab and
  on Home, where the donut reads `1,815` and the ring `1,815 kcal left today`. The pre-change budget
  for that fixture was `2069 + 300 = 2,369`.
- `pnpm check:rules` ran every Custom Rules step; full suite green with `DATABASE_URL` set.

**Not exercised:** no device, no APK — this is JS/server only, so Railway delivers it. The owner's own
figures (1,342 from a real measurement) are asserted in tests against production-read values but were
not observed on his account; the seeded profile exercises the *predicted* branch, and the measured
branch is covered by unit and service tests only.

## One thing worth carrying, and it cuts both ways

**`one-calorie-budget.spec.ts` needed no edit, and that is the whole argument for LB-100's shape.** It
asks `budgetProvenance` for the budget instead of transcribing it, so re-anchoring twice in two days
cost it nothing.

**Its sibling did need one, and CI is what found that.** `calorie-progress-bar.spec.ts` still carried
the transcription — `restingBase + targetNet + earned` — so it went red on this PR's first E2E run:
fill read **44.74%** against an expected **41.46%**, a correct bar measured against a stale formula.
Fixed by asking the shared function, with the sibling's discriminator copied across so a reverted
`budgetProvenance` cannot pass. Reverting that one line reproduces CI's failure locally — both tests,
same assertion — which is what says the fix is the fix rather than a number that now agrees.

**LB-100 did the right thing to one file and the sibling-surface sweep was not done.** The repo has a
standing rule for exactly that and it did not fire, because nothing connects the two specs by name. Two
copies of a formula is two places to re-anchor.

**And the job that caught it is advisory.** That is the other half of BF-150's lesson: waiting for E2E
is why this was found before it merged rather than after.

**Not fixed here:** `preferences-survive-reinstall.spec.ts` failed in the same run with
`net::ERR_ABORTED at page.goto('/')`. It is one of **LA-63's nine**, already recorded there as failing
in the full run and flaky when run alone, and nothing this diff touches.

<a id="2026-09-13-lb101-food-body-cap"></a>

# 2026-09-13 — the route capped its body below the image it permits (LB-101)

**Branch:** `lane-a/lb101-food-item-body-cap` · one constant, one test file, docs. No user-visible
change of its own — the workaround that hid it is still live, and removing that is LA-105.

## The defect

`/api/nutrition/food-items` carried `const MAX_BODY_BYTES = 8 * 1024`, with the comment *"One food
item: a name, a brand and a dozen macro numbers"* — written before BF-35 gave the route
`imageDataUri` and a 16 KB image cap of its own.

**Base64 costs a third more than the bytes it encodes**, so an image at its own permitted size is
~21.8 KB on the wire. `readJsonLimited` runs at line 31 and `rejectMealImage` at line 55, so the
request was refused with a **413 before the image check ever ran**. The user did not lose the
picture; they lost the food.

Lane B measured it driving the real capture flow: a 128 px WebP of a detailed 600 × 400 source at
q0.8 came back **6,612 bytes = 8,816 base64 characters** and the save 413'd, while a smooth
photo-like source came back 1,410 and fitted. It bit detailed photos, not every photo — which is why
BF-35's own testing missed it.

The cap is now **derived** — `Math.ceil(FOOD_ITEM_IMAGE_MAX_BYTES * 4 / 3) + 4 * 1024` = 25,942 —
rather than restated, so raising the image cap raises this by construction. Restating it is what let
the two drift in the first place.

## Two things checked that the entry asked about

**The offline push branch has no such mismatch.** `app/api/sync/push/route.ts` caps at 4 MB, which is
three orders of magnitude clear of an image. The entry asked for this to be checked rather than
assumed, and the answer is that only the interactive route was wrong.

**A smaller thing turned up at the boundary, and is deliberately left alone.** `mealImageBytes` is
`ceil(base64Length * 0.75)`, which **ignores base64 padding** — so an image whose decoded size is
exactly 16,384 measures as 16,386 and `rejectMealImage` refuses it. The effective cap is about two
bytes under the advertised one. It errs strict rather than permissive, so it is harmless; what it
changes is the test, which asserts just under the cap and says why. The exact-cap boundary belongs to
the image validator, not to the body cap this entry is about, and asserting on it here would have been
testing the wrong thing while looking thorough.

## Verified

**Mutation pass: four mutants, all killed** — the flat `8 * 1024` restored (the original defect), the
4/3 base64 overhead dropped, the 4 KB of headroom for the food's own fields removed, and the cap
effectively lifted altogether. One deliberately equivalent control — `4 * 1024` written as `4096` —
survived.

Five tests, including the measured 6,612-byte case, and two that hold the cap still a cap: an
oversized image is refused with a message rather than a silent 413, and an enormous body is still
413'd.

`pnpm check:rules` and the full suite green.

**Not exercised:** no device, and the capture flow itself was not re-driven — Lane B's Playwright
measurement is what established the failing size, and the workaround that currently prevents it is
still in place.

## What is still owed

**LA-105 removes the workaround**, and it is Lane B's: `THUMB_WIRE_BUDGET = 7 * 1024`, the quality
ladder that re-encodes down to fit it, the `tooBigForTheBody` guard and the two assertions pinning
them exist **only** because of this cap. LB-101's entry said to leave them until the cap moved. It has
moved. The downscale itself stays — what is dead is re-encoding to 7 KB to sneak under a limit that is
now 25,942.

<a id="2026-09-13-lb102-stress-day-read-path"></a>

# 2026-09-13 — the stored stress buckets get a read path, and a second metric turns up (LB-102)

**Branch:** `lane-a/lb102-stress-day-read` · one new API route, one test file, docs. No product code
renders it yet; no user-visible change, no version bump.

## What was wrong

`/api/body-battery` takes no parameters — `export async function GET()` — and computes its stress
series live from today's ring dHRV. TN-3a's `oura_daytime_stress_buckets` has persisted 30-minute
buckets since **2026-08-24** and **nothing published them**, so a past day was unreachable from any
surface.

That blocked TN-3b's owner-approved pass test: *"open a past day, read a stressed window off the axis,
and say whether it matches what you were doing"* — his recall being the ground truth, since TN-33
found no independent target with variance (`perceived_recovery` reads 3 on all 17 days). Today-only
answers half the question he approved.

`GET /api/body-battery/stress-day?date=YYYY-MM-DD` now serves the stored buckets for a day.

## The entry proposed `?date=` on the existing route; the code said otherwise

Two reasons, and the second is the one worth carrying.

**The battery response is a live model anchored to `now`** — the HR walk, the reserve, the label —
and none of it can be computed for a finished day. A parameter that changes a response's *shape* is
one endpoint behaving as two. Hence a sibling route, which the entry explicitly allowed for.

**And the two series are not the same number.** The rollup builds the persisted buckets from
`latest.rhrLowBpm` + `nightHrvMs`; the live route builds its own from `restingHr` + a 28-day HRV mean.
TN-3a chose to store only the rollup's, and said why in `run.ts`:

> *"Writing from one place also settles the two-baselines hazard … persisting both would put two
> numbers behind one metric. The rollup wins because it is the only one that can reach history."*

**So a chart reading today live and a past day from storage would put two metrics on one axis** — and
the owner's pass test is a comparison *across days*, exactly the dimension two baselines destroy. The
route therefore serves **every** day from storage, today included, rather than special-casing today.
One chart, one baseline, days that are comparable with each other.

The cost is real and is reported rather than hidden: today's stored series ends at the last rollup
rather than at this minute, so the response carries `throughMs` and a surface can say where the day's
data stops instead of implying the day stopped. **Which source TN-3b's chart should read for today is
Lane B's call and is filed as LA-104**, with the instruction not to answer it by persisting the live
series — that is the thing TN-3a rejected.

## Verified

- Eight database-backed tests. **Mutation pass: five mutants, all killed** — the day window built in
  the server's timezone instead of the user's, a dash-only date guard (which would reject everything
  `localDateString()` emits), ignoring `?date=` altogether (the original defect), `throughMs` pinned
  null, and the auth check removed.
- **One deliberately equivalent control, and the honest version of what happened:** widening the
  window's end from `23:59:59` to `23:59:59.999` was first reported KILLED by a harness running the
  mutants back to back, then **survived** on an isolated re-run. The isolated run is the authoritative
  one; the back-to-back harness most likely carried fixture state from the preceding auth mutant,
  which is the trap CLAUDE.md already records about interrupted local runs. Worth knowing: a control
  that "dies" may be indicting the harness rather than the test.

**Not exercised:** no device, nothing renders this yet, and production's 478 stored rows were not read
— the local database has none, so the tests seed their own.

## Worth carrying

**Data that persists with no read path is invisible to every surface and to CI both.** LB-98 cost a
card its verifiability; this cost an approved feature its pass test. Same shape, two days apart — and
in both cases the write had been correct and shipping for weeks.

<a id="2026-09-13-lb103-movement-pattern-taxonomy"></a>

# 2026-09-13 — the push/pull/legs grouping Q-305 was blocked on (LB-103)

**Branch:** `lane-a/lb103-movement-pattern` · one shared module addition, two new test files, docs.
No product code renders it yet, no user-visible change, no version bump.

## Why it existed as a sentence and not an entry

Q-305's `Keep:` said the push:pull half *"belongs in `packages/shared` … which is Lane A's"* — and
there was **no Lane A entry for it**. It lived only inside a Lane B entry, so
`next-item.js --lane A` had never listed it and never would. Lane B filed LB-103 after finding it
while scanning PARKED; this is that entry built.

Q-305 had already rejected computing the grouping inside `weekly-muscle-sets-card.tsx`, and for the
right reason — a private second copy in `components/` is exactly the divergence One Formula One Place
exists to stop. So this is not a re-litigation of that call; it is the module that call implies.

## What shipped

`movementPattern(muscle)` and `CLASSIFIED_MUSCLES` in `packages/shared/src/muscles.ts` — beside
`normalizeMuscle`, because the grouping is a property of a muscle's **name** rather than of anyone's
volume table. Synonyms fold first, so the catalogue's own `core` resolves to `abs`.

**Two genuine judgement calls, written into the module rather than buried in a lookup table:**

- **`shoulders` is push.** The vocabulary has one shoulder name and the muscle does not split that
  way — anterior and lateral heads press, the rear head rows. Splitting it properly needs `rear delts`
  as its own catalogue name, which is a data change, not this one.
- **`lower back` is neither.** It loads on deadlifts, rows, squats and carries alike, so counting it
  as pull would inflate pull on leg days and counting it as legs would inflate legs on pull days.

## The part worth copying

**`other` is a real bucket, which makes an unmapped muscle invisible.** Abs, obliques and the lower
back belong there deliberately — so a muscle nobody classified lands in exactly the same place and
looks identical from the output. A unit test asserting a hardcoded vocabulary is a **snapshot**: add a
muscle to `exercise_library` tomorrow and it keeps passing while the new name silently joins them.

So the coverage assertion reads the **database** — every distinct muscle name the real catalogue
stores must have a pattern, and the failure message names the file to edit. Measured 2026-09-13: 146
exercises, 18 distinct names, all classified. It is the same shape as LA-103 earlier today: a rule
fitted to the data it was written against is only safe while something checks the data.

## Verified

- **Mutation pass: four mutants, all killed** — `shoulders` flipped to pull, `lower back` folded into
  pull (the two judgement calls), the synonym fold dropped (the catalogue's `core` stops resolving),
  and `hip flexors` deleted from the table, which is the one that proves the database-backed coverage
  test actually bites. One deliberately equivalent control — reordering the push block, same map,
  different source order — survived.
- 57 unit tests plus 3 database-backed ones. `pnpm check:rules` and the full suite green.

**Not exercised:** nothing device or runtime, and **nothing renders this yet** — Q-305's card section
is Lane B's and is now unblocked.

## Deliberately not done

**The shared-treatment question stays open.** Whether Q-278 / Q-302 / Q-305 want one common "computed
and discarded" surface has been untouched since 2026-08-25 and belongs to the owner or the
Orchestrator. Answering it inside this taxonomy would have prejudged it exactly as answering it inside
one card would have — which is the objection that produced this entry in the first place.

<a id="2026-09-13-lb98-rest-card-server-fallback"></a>

# 2026-09-13 — the Rest-vs-plan card can be seen off the device (LB-98 ①)

**Branch:** `fix/lb98-rest-card-server-fallback` · **Agent:** Implementation Lane B

## The gap LB-98 named, and why it is a verification bug rather than a product one

`planned_rest_sec` is the snapshot taken when a set was logged — the honest number, because a later
style edit would rewrite what "prescribed" meant for a past set. It lives in the local store, so
`rest-prescription-card.tsx` returned `null` whenever `getLocalStore` did. On the canonical runtime
the card worked; **in every browser, and therefore in CI, it was simply absent.** Its rendering path
— two-column rows, signed deltas, a conditional compression sentence — had never executed anywhere
but the S25, and the card arrived owing a device check it could not discharge.

Lane A shipped the read half on 2026-09-09: `/api/health-trends?view=rest-adherence` emits
`restSets`, per-set `{ plannedRestSec, restTimeSec }` from the **logged** columns, shaped as the
card's own `RestSet`. LB-98's remaining residue was one line of Lane B wiring — *"nothing consumes it
yet, so the verification gap is not closed until that lands."*

## What changed

`RestPrescriptionCard` takes `serverSets` and renders `local ?? fromServer`. Three things about that
shape are deliberate:

- **Local still wins.** The device's store is the source of truth and needs no network. The prop is
  consulted only when there is no store, or when the store holds nothing to summarise.
- **It is a swap, not a second aggregate.** Both paths run the identical `restByPrescription` over
  the identical field names. LB-98 warns explicitly against moving the computation server-side —
  that is how one metric acquires two numbers — and this keeps it in one place.
- **No new request and no new cache key.** `trends-section.tsx` already fetches this exact response
  for this exact view, so `restSets` is a prop, not a second fetch. That also sidesteps the one-TTL-
  per-key rule entirely.

## Verification

`e2e/rest-vs-plan-card.spec.ts` — the first run of this rendering path outside the device. It asserts
the header, the set count, both rows' means (75 s at a 60 s prescription, *exceeded*; 110 s at 120 s),
both signed deltas, and the compression sentence with its range. A second test pins the honest
negative: no pairs must leave the card **absent**, not a heading over blank space, while the bars
above still draw so the assertion cannot pass against a screen that failed to load.

**Mutation-proven:** reverting `local ?? fromServer` to `local` fails the positive test on its own
message — *"the card is still absent off-device"* — and correctly leaves the negative one green.

**The response is stubbed, and the reason is worth recording.** A real fixture would need far more
than this card: the parent hides everything behind the *correlation's* `hasSufficientData`, which
wants paired sessions carrying a progression style and a 1RM baseline — conditions about the bars
above, not about these rows. The local seed also has 27 set logs and **zero** carrying either rest
column, so the data would have to be built regardless. Lane A's emit site is already pinned by five
mutants including one that swaps the logged snapshot for the live style, so what the stub leaves
untested is not the query.

- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## What this does and does not settle

- **Q-300's device check is narrower now, not gone**, and its entry has been corrected to say so: its
  `Keep:` asserted the card "is absent in a browser and cannot be verified in CI", which stopped
  being true today. What the S25 still owes is the **local** path — `getLocalStore` reading the
  device's own set logs — which no harness can reach.
- **LB-98 itself stays open** on residue ②, the `body_metadata` half (LB-96), still parked behind
  `Needs: OR-102b`.
- **Not device-verified.** The device path is unchanged by construction — `local` is preferred and
  computed exactly as before — but "unchanged by construction" is an argument, not an observation.

<a id="2026-09-13-rv-35-nutrition-rollover-regression-test"></a>

# 2026-09-13 — the Nutrition rollover fix gets the test it was shipped on (RV-35)

**Branch:** `fix/rv-35-nutrition-rollover-test` · **Agent:** Implementation Lane B

## The entry was stale in the half that matters, and not in the way that lets it be deleted

RV-35 said the Nutrition tab never asks what day it is on resume, so a breakfast logged after
midnight files against yesterday — measured in review sweep 41 as five dated requests before the
boundary and **zero** after. It prescribed the fix: *"the hook that already exists"*,
`useDayRolloverRefresh` from `components/shell/local-day-provider.tsx`.

**That fix is already in the tree.** `app/nutrition/nutrition-content.tsx:334` calls
`useDayRolloverRefresh(catchUpToToday)`, one line below `useRefreshOnTabShow(catchUpToToday)`. The
entry's description of the guard as reachable only through `tabEpoch` describes code that has since
changed. Re-verifying before implementing is what caught it — the standing rule, earning its keep for
the second time today.

**But this is not a "already done, remove the entry" case**, and reading only the first half would
have made it one. The owner directed on 2026-09-13: *"This is a hard one to check; lets just make the
best guess and file it as a non issue till its reproduced — ideally you can be confident in your
fix."* Checking by hand needs the app left open across local midnight. The entry converts that
directive into an obligation in its own words: **a fix landing without a device check needs a test
that fails before it and passes after, because nothing else will catch a regression here.**

No such test existed. `e2e/day-rollover-checkin.spec.ts` drives the clock across midnight but covers
Home — the check-in prompt (BF-86) and Home's day-scoped reads (BF-117). Nothing covered Nutrition.
So the code shipped carrying an unmet condition, which is the thing that was actually missing.

## What this adds

`e2e/nutrition-day-rollover.spec.ts`, on the clock recipe BF-86 established: install at 23:55
Brisbane, load `/nutrition`, fast-forward ten minutes, dispatch `visibilitychange`.

- **The assertion is a dated request, not the header.** After the fix the header reads `Today` — it
  read `Today` while broken too, because `formatDateLabel` prints it whenever `selectedDate` and
  `todayStr` agree and both were frozen at the launch day. Only the date the tab asks the server for
  separates the two. Requests are recorded **by day**, not counted: a count cannot tell a re-read of
  the stale day from a read of the new one, which is the exact failure.
- **A precondition assertion before the boundary.** Without it, a spec seeing no new-day request
  cannot distinguish a stuck tab from a page that never loaded. BF-100 records four traps of that
  shape in `scroll-restoration.spec.ts`.
- **A negative case**, because `LocalDayProvider` seeds the day synchronously: an effect keyed on
  `useLocalDay()` alone fires once at mount and double-fetches every launch, invisible in use.
  `useDayRolloverRefresh` holds a ref so the first run is a no-op by construction; this pins that.

**Mutation-proven, which is the whole point of the entry.** Commenting out line 334 turns the
positive test red with its own message — *"Nutrition stayed on the launch day across midnight — a log
written now lands on the finished day"* — while the negative test correctly stays green.

## Not verified

- **No device check, deliberately, and that is the owner's decision on the record.** The symptom
  needs the app open across midnight on the S25. This test is what stands in for it, and RV-35
  returns only if the symptom is seen in the wild.
- No user-visible change ships here, so there is no version bump or changelog entry: the behaviour
  was already correct on `main`, and what lands is the guard against losing it.

<a id="2026-09-13-tn-3b-stress-by-hour"></a>

# 2026-09-13 — stress gets a clock (TN-3b, the today half)

**Branch:** `feat/tn-3b-stress-by-hour` · **Agent:** Implementation Lane B

Owner, approving the entry on 2026-09-10: *"Can we have this displayed on a widget or chart so we can
see when the stress occurs. I will be able to match it up based on time to what I was doing around
then."*

## Why this was sitting unstarted

TN-3b reads as PARKED to `next-item.js`, so it never reached the READY list — but the park is a
**legacy prose marker**, and the entry itself carries `⚑ UNPARKED 2026-09-10`, the owner's approval,
and a note that its stated blocker (TN-3a's persistence) has shipped. The tool cannot see any of
that, because it is prose rather than a field. That is the exact failure the standing rules name —
*"`Needs:` / `Gate:` / `Reference:` are fields, not prose"* — and it cost the entry three days.
Lane B's READY has been 0 throughout.

## What shipped

A 24-hour local-time axis in the Body Battery card, **beside** `stress-strip.tsx` rather than
replacing it: the strip carries the current state and the "high ~N min" figure, this answers *when*.
Each design constraint in the entry came from measured data, and each is implemented:

| constraint | how |
|---|---|
| local-time axis, 30-min resolution | `minutesIntoDay` via `Intl` in the **user's** zone, one viewBox unit per minute |
| **never interpolate a gap** | `toSegments` splits at 75 min; one path per run, so a hole is drawn by nothing being there |
| shade the night band | 22:00–06:00, both halves — the series wraps midnight and one rect cannot span it |
| mark zero and ±0.5 | ruled, and **named in a caption** — see below |
| no score, no verdict | nothing on the surface judges the day |

**The caption is there because the screenshot demanded it.** Rendered, the chart was an amber line
between three unlabelled rules: a reader could see *when* something happened and not *what*. One
sentence names the upper line as the same "High" the strip already says, the shading as night, and
the blanks as unrecorded — a description of the axis, not a verdict, and it reuses the strip's own
vocabulary rather than inventing a second one.

**Why no verdict, explicitly.** Q-507 — whether this metric's sign means what it claims — is open,
and TN-33 established there is no independent target with variance to settle it (`perceived_recovery`
reads 3 on all 17 days, untouched across 29 check-ins). The owner's recall *is* the ground truth,
which is what makes a plain chart the right instrument: it makes no claim that can be wrong, and that
is what keeps it shippable while the question stands. **TN-16's warning and prompt stay parked.**

## Verification

- `components/body-battery/__tests__/stress-day.test.ts` — 9 node tests over the geometry: the
  timezone (13:15 Brisbane vs 22:15 in `Etc/GMT+5` for one instant), midnight placed at 0 rather than
  1440 (`en-GB` renders it `24:00`), the **measured 06:45 → 13:15 hole** splitting into two runs, one
  dropped reading *not* splitting, out-of-order input sorted first, and coverage counting half a
  bucket at each end while excluding gaps.
- `e2e/stress-by-hour.spec.ts` — renders the real 2026-09-08 shape and asserts **two** polylines, the
  labelled hours, and `3.5 h measured`. A second test pins that no series draws no chart.
- **The card is collapsed on arrival, and the first negative test passed without opening it** —
  asserting absence inside a section nobody expanded is a test that cannot fail. Both tests expand
  now, and the negative one first proves the expanded content is there.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean, `pnpm build` clean.

## What is not done, and why

- **Past days are unreachable, and that is TN-3b's own pass test.** `/api/body-battery` is
  `export async function GET()` — no parameters — so only today is served. The buckets persist
  (`oura_daytime_stress_buckets`, from 2026-08-24) and nothing publishes them. Filed as **LB-102**
  for Lane A; the chart takes a plain array and `toSegments` sorts before segmenting precisely so
  stored rows drop straight in.
- **The HR-chart overlay and the across-days aggregate** are the entry's other two surfaces, still owed.
- **Not device-verified.** Rendered and measured at 412 dp in the harness, not on the S25.

<a id="2026-09-14-bf110-second-viewport-log"></a>

# 2026-09-14 — a second look at the resume viewport, before any fix (BF-110)

**Branch:** `feat/bf110-second-viewport-log` · **Lane B** · instrumentation only, no version bump

## The state of the evidence

`error_events` now holds seven days of `bf110 resume dom-intact` breadcrumbs, and they separate
**perfectly** on viewport height — across six different routes, with the same route appearing on both
sides:

| viewport | DOM children | reading |
|---|---|---|
| **667** | 1–2 | blank |
| **826** | 7–8 | rendered |

The S25's real CSS viewport is **826**. **384×667 is the classic default a WebView falls back to
before it has been told the real size.** So the shape is not *"the renderer died and painted
nothing"* — it is *"the WebView resumed at a fallback viewport and the app rendered almost nothing
into it"*. Cheaper to test, and a different bug.

## What the data cannot separate, and why that matters

A viewport genuinely **stuck** at the fallback, versus a breadcrumb that simply fired **before** the
WebView resized. Same 667 either way.

**Those two answers point at different files** — one is the native layer, the other is when the app
decides to render — which is why the entry insists nothing be fixed until the reading exists.

## What shipped

`handleResume` reads the shell box again **500 ms into the same resume** and files
`bf110 resume recheck stuck|resized h1=… h2=… w2=… children2=…`.

Three decisions worth keeping:

- **It re-reads the element**, rather than closing over the first sample for both halves. That
  mistake produces a row that always says `stuck` and looks like an answer. There is a test that
  fails on exactly that shape.
- **It rides the first row's budget.** The recheck fires only when the first sample was worth
  filing, so a reported resume costs two rows and an unreported one costs none. `error_events`
  prunes at 30 days and is the second-largest object in the database; a recheck on every resume
  would double the cost the once-per-launch cap exists to avoid.
- **The verdict is a word, not two numbers.** Whoever reads that table will be looking for `stuck`
  or `resized`, not diffing heights.

`defer` is an optional parameter so the first half's call and tests are untouched — which makes it
exactly the kind of thing that can be added and never passed, so a test asserts the real
`setTimeout` is wired at the call site.

## Verification

17 tests in `lib/__tests__/bf-110-resume-repaint.test.ts`, up from 12. **The two load-bearing ones
were falsified, not assumed:**

| Break I introduced | Which test caught it |
|---|---|
| report the first sample twice instead of re-reading | *reads the element AGAIN…* |
| schedule the recheck outside the row budget | *rides the first row budget…* |

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors (two
pre-existing Lane A warnings) · `vitest run lib/` **4697 passed**.

## The entry was parked on a gate that was wrong

The Orchestrator removed it the same day, and the reasoning is worth carrying: `Gate: device` parked
the whole entry, but **the next step needs no device at all** — a log line in the shell, shippable
here. What needs the device is the verdict on a *fix*, which is a `Verify:` after something ships.
**The owner sat on this item twice in device passes with nothing he could usefully do**, because the
question was never his.

That is the **fifth** instance this session of a field's job being done in prose — and the second
found by someone else. Here a gate scoped by prose to one paragraph parked an entry whose other
paragraph was ready to build, and `next-item.js` cannot see the scoping.

## What was NOT done

- **No fix.** Deliberately, and the entry is emphatic: the two possible readings point at different
  files, so writing a fix now means picking one at random.
- **Not seen on the device.** The 500 ms window is the entry's number, not a measured one. If the
  readings come back ambiguous that is a finding about the window, not a licence to keep raising it.
- **The recheck has never fired against a real blank resume** — only against fixtures. It is
  scheduled on a resume that files a row, and whether the owner's next blank resume is one of those
  is not something the sandbox can establish.

<a id="2026-09-14-bf154-macros-follow-the-budget"></a>

# 2026-09-14 — the macro grams follow the budget, and the gap module goes with them (BF-154)

**Branch:** `lane-a/bf154-macro-rebase` · **Lane:** A · Entry **BF-154**, build half. The arithmetic
half shipped 2026-09-13 in #1155; this is the change the owner actually asked for.

## The decision, and the defect under it

Owner, 2026-09-13: *"Can we have it dynamically sized for my calories? I.e before excercise its 1
value and after its another if calories increase?"*

The stored grams were entered against the stored calorie goal. BF-152 moved the day's budget onto the
measured resting rate, and the two then disagreed permanently — ~1,660 kcal of grams against a ~1,294
budget on his figures.

**The gap was constant, and that is what made it a design fault rather than a rounding one.** The old
code grew the grams by `earned` and the budget by the same `earned`, so the difference never moved
however far the day was walked. `macro-budget-gap.ts` existed only to measure a number no arithmetic
was ever going to close. Both properties are now pinned as tests, in both directions.

## What shipped

`macrosForKcal(base, totalKcal)` in `packages/shared/src/nutrition/calorie-balance.ts` — hold
protein, fit carbs and fat to what is left, preserving the carbs:fat **energy** ratio.
`scaleMacrosForEarnedKcal` now delegates to it, so "hold protein, move the rest on the ratio" has one
implementation rather than two that can disagree at the edges. The 466 existing nutrition tests
passed unchanged across that refactor, which is what makes it a refactor.

`energy-balance-service.ts` fits both halves to the budget: `base` at `budgetProvenance(...).base`,
`scaled` at `base + earned`, from the **same inputs** `computeCalorieBalance` was handed rather than
a second derivation. The missing-profile path passes `null` and keeps the stored grams — there is no
budget to fit to when the BMR the anchor needs cannot be computed, and a target a human typed beats
one fitted to a number that does not exist.

**Protein holds, and the reason is arithmetic.** It is dosed per kg of bodyweight, so neither a walk
nor a smaller budget changes what the body is made of. When protein alone would exceed the whole
total, carbs and fat go to zero rather than negative.

## Measured on the running app, not argued

| | grams cost | budget | gap |
|---|---|---|---|
| at rest | 1,816 | 1,815 | **1** |
| after a run earning 187 kcal | 2,005 | 2,002 | **3** |

Protein held at 150 g on both. One to three kcal of gram-rounding where several hundred used to
stand, and the grams move with movement — which is the sentence the owner wrote.

**⚠ The sandbox cannot show what his account will do.** The seeded user's budget base is *above* its
stored goal, so its carbs went up (166 → 178). His is below, so **his carbs and fat will visibly
drop** while 150 g protein stands. Right for a cut, and the thing to look at on the first day.

## What was deleted, and why nothing was lost

`macro-budget-gap.ts`, its test, the card's breakdown paragraph, and three props that fed it
(`storedGoalCalories`, `baseKcal`, `baseIsRestingRate`) plus their call sites. A gap that is zero by
construction needs no module to measure it and no sentence to explain it.

**The budget's provenance survives.** `CalorieZoneBar`, rendered by this same card, prints
`{base} resting rate` on the anchored path and is now the only surface that does — so BF-152's owed
device check still has something to check, and the duplication the report opened with (*"There is so
many numbers here"*) is settled rather than kept in sync.

**Two guards were re-pointed rather than deleted**, which is the part worth being careful about.
`bf154-budget-breakdown-addends.test.ts` lost four assertions whose subject is gone; its arithmetic
block is untouched and its "no figure labelled resting twice" test now reads the surviving surface.
`e2e/bf154-budget-breakdown-reconciles.spec.ts` follows the same property to `CalorieZoneBar`'s
sentence, stripping the earned parenthetical so `earned`'s own addends are not counted as terms of
the budget. Both pass locally.

## Verification

**Mutation pass, real exit codes:** dropping the protein floor (1 failed), scaling protein instead of
holding it (12 failed), swapping the carb/fat shares (6 failed). One deliberately equivalent control
— `carbShare` computed as `1 − fatKcal/splittable` — survived, as it should.

Full suite **911 files / 8,647 tests, 0 failed** by real exit code; `pnpm check:rules` 75 of 75; lint
0 errors; build clean; the re-pointed E2E spec green locally.

**Not exercised:** the device. JS-only, so it reaches the phone on the next Railway deploy with no
APK, but nothing has read the macro row at 412 dp — and the figure that matters there is his, which
this machine cannot produce.

<a id="2026-09-14-bf155-session-duration-fallback"></a>

# BF-155 — the last set of every exercise has been losing its end time since July

**Branch:** `lane-a/bf155-session-duration-fallback` · **Lane A** · two one-line reads, one guard,
two test files.

## What the owner saw

*"my amrap week all has under 5mins workout time."* A 38.3-minute session printing as 3 minutes.

## What the entry got right, and the one thing it got wrong

Right: the mechanism end to end. `logExerciseFromPayload` stamps an exercise as
`lastSetEndMs ?? workoutStartedAt ?? now`; with no `set_end_ms` on any row every exercise fell to the
second rung, so all five carried `logged_at = started_at` identical to the millisecond, and
`day-log`'s `max(loggedAt + timeToComplete)` returned start-plus-the-longest-exercise. Verified line
by line against current `main`.

**Wrong: the dating, and it mattered.** The entry says *"every session since 6 September"*. Measured
in production instead of assumed:

| shape | sessions | range |
|---|---|---|
| all `set_end_ms` missing | 20 | 2026-04-30 → 2026-06-16 |
| **none missing** | 42 | 2026-05-28 → **2026-07-27** |
| **exactly one missing per exercise** | 33 | **2026-07-30** → 2026-09-13 |
| other | 1 | 2026-07-30 (the transition day) |

`count(set_end_ms)` equals `sets − exercises` on all 33 — one missing per exercise, every session,
for six weeks. **The defect is six weeks old; only the symptom is September's.** What changed in
September was one set per exercise: on a two-set exercise losing one of two is invisible, and on a
one-set exercise it is the only one, which is the case that reaches the fallback.

That also disposes of the entry's two candidate triggers — *"whether the single set never reaches
`appendSetEndMs`, or the baseline path submits without it"*. Neither. It is one mechanism, universal,
and the entry read its own best evidence backwards: it cited the 5-of-10 ratio on good sessions as
proof this was *not* "the last set is missing one", when 5 exercises × 2 sets with the last of each
missing is exactly 5 of 10.

## The root cause

`handleLogCurrentSet` appends the set's end time and then calls `handleCompleteSet`
**synchronously in the same tick**. That function snapshotted `store.setEndMsArray` from the
component's reactive pick, which has not re-rendered — so it copied the pre-append value and dropped
the last set every time.

**The file already documents this hazard, nine lines above, for a different field.**
`currentSet` is read through `useWorkoutStore.getState()` with a comment naming the exact cause:
*"handleLogCurrentSet now calls this synchronously in the same tick … this component hasn't
re-rendered."* The timing arrays sat two lines below, still reading reactively. The auto-advance
change that introduced the synchronous call is dated **2026-07-28** in its own comment; the first
broken session is **2026-07-30**.

## What shipped

**(b) the cause** — `snapSetStartTimes`/`snapSetEndTimes` read from `hot` (the live `getState()`)
like every other snapshot in that block. `setStartMsArray` is not currently reachable in the same
tick (its append fires on "Start Set", a separate interaction) but sits on the same line and would
fail identically; fixed together rather than left as the next one. Both dropped from the dependency
array, where listing them implies the reactive read that was the bug.

**(a) the display** — `day-log` prefers `completed_at`, the measured end, over reconstructing one.
Kept as a fallback rather than a replacement: a session still in progress has no `completed_at` and
the reconstruction is all there is. Guarded on `completedMs >= startMs` so a backward clock step
cannot render a negative duration.

**(a) alone would have closed this on the visible half**, as the entry warned — `logged_at` also
orders 1RM history, breaks PR ties and keys per-set HR attribution, and those stay collapsed on the
33 historical sessions whatever the card shows. Those rows cannot be reconstructed; the information
was never written. Their `completed_at` is intact, which is why (a) repairs the display without a
backfill.

## Verification

| mutant | result |
|---|---|
| revert the stale `setEndMsArray` read (the exact defect) | **killed** |
| revert `setStartMsArray` only | **killed** |
| `day-log` ignores `completed_at` again | **killed** |
| drop the `>= startMs` guard | **killed** — *survived the first pass; see below* |
| control — `>= startMs` → `!(completedMs < startMs)` | **survived**, as it should |

**The guard mutant survived the first mutation pass**, which is the pass earning its keep: I had
written a guard and nothing proved it did anything. Production says the case has never occurred
(0 inverted `completed_at` in 110 sessions), but it is not impossible and this codebase already
clamps for a backward clock step in `handleLogCurrentSet`. Kept and tested rather than deleted.

**Driven over HTTP against `pnpm dev`**, signed in as the seeded user, with the production shape
seeded — five exercises sharing one `logged_at`, `completed_at` 38 minutes out:

| code | printed |
|---|---|
| before | **3 min** (`10:00pm → 10:03pm`) |
| after | **38 min** (`10:00pm → 10:38pm`) |

Same row, same request — the owner's symptom reproduced and then fixed, rather than inferred. Probe
rows deleted afterwards (`DELETE 1`, 0 remaining).

An existing test moved with the fix: `day-log-duration-session-identity.test.ts` seeds
`completed_at` at start + 45 min while logging its one exercise at + 40, so it asserted the
41-minute reconstruction and now asserts 45. The fixture was never written for this — it just
happens to carry a real end four minutes past its last exercise, which is what a real session looks
like. Nothing it guards changed.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean.

**Not exercised:** no device or APK run. The `workout-screen.tsx` half is the one that matters on
device and it cannot be driven here — vitest is node-only with no JSX transform, so its guard is a
source assertion plus store-level tests of the same-tick semantics the fix relies on. **The owner's
check is the real one:** log a single-set session on the S25 and confirm the printed duration matches
the wall clock and that the exercise rows carry distinct `logged_at` values. Until then, (b) is
verified by mechanism and not by observation.

<a id="2026-09-14-bf156-accept-consequence"></a>

# 2026-09-14 — the AI card says what skipping Accept costs (BF-156)

**Branch:** `fix/accept-cost-disclosure` · **Lane B** · v1.456.3

## What it was

Owner: *"what happens if I dont select to apply the session? Its pretty easy to miss that button."*

There are two answers. `prescriptionDrivesLoad` splits the five phase actions:

| pending `phaseAction` | drives today's load? | skipping Accept costs |
|---|---|---|
| `stay` | yes | the phase decision only |
| `transition_recommended` | yes | the phase decision only |
| `deload_recommended` | **no** | the whole recommendation |
| `session_swap_recommended` | **no** | the whole recommendation |
| `rest_day_recommended` | **no** | the whole recommendation |

On the opt-in half, starting the workout without answering silently reverts to the program's base
progression style, and what is on screen is simply not what you train. This is live on the owner's
account now: `session_periodization` holds a pending `session_swap_recommended`.

## What the entry missed, and why it mattered

BF-156 says *"the card looks identical for both"*. It does not — and that is worse, because the way
it differs is misleading. The card has two action blocks, and **they split on a different axis than
the rule**:

- **"Move to …" / "Skip"** — `transition_recommended` and `deload_recommended`. One drives load, one
  does not.
- **"Accept" / "Dismiss"** — `stay`, `session_swap_recommended`, `rest_day_recommended`. One drives
  load, two do not.

So the buttons are not a signal in either direction. A reader who learned "the Move card means my
numbers are live" would be right for a transition and wrong for a deload. Fixing only the Accept
block, as the entry's wording implies, would have left the transition/deload pair unlabelled.

One `ConsequenceLine` component now renders in **both** blocks, reading `prescriptionDrivesLoad`
once from the shared module — never a second copy of the split. Muted grey on the driving half,
bold amber on the opt-in half, which is the one where doing nothing discards the advice.

The opt-in line is bold text rather than a second amber panel: the low-confidence warning already
owns that shape in the Accept block, and two stacked panels read as one thing to scroll past.

## Verification

`e2e/prescription-accept-consequence.spec.ts` seeds a pending prescription and swaps its
`phaseAction` in place, so both cases are the same card in different states. Both are from the
**Accept** block deliberately — same two buttons, opposite sentence, which is the claim.

Each test asserts the right line is present **and the other is absent**: a sentence that appeared in
both states would be worse than none, because it would read as a fact about the card rather than
about this prescription. Both tests fail against unpatched `components/` — falsified, not assumed.

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `deload-visible.spec.ts` still green
on the same seeded row.

## Not in scope

Per the entry: changing which actions drive load, and auto-applying the opt-in half. Both are the
owner's calls and neither is needed to make the button honest.

Also **not** done: making the opt-in half genuinely harder to scroll past — a blocking confirm, or
refusing to start until answered. The entry raises it and it is a real design change, not copy.

## What was NOT exercised

- **No device.** 412 dp in Chromium only. The owner's live `session_swap_recommended` is the case to
  look at, and it is the one this was written for.
- **`transition_recommended` and `deload_recommended` were not driven** — the two that share the
  "Move to …" block, and the pair that proves the axes cross. They take the same `ConsequenceLine`
  from the same boolean, so they are covered by construction rather than by test; the seeding cost
  is a `phase_mode` change plus a transition-eligible phase state, which the two Accept-block cases
  already establish the pattern for.
- **The bold-amber line was not checked against the low-confidence panel** stacked above it. That
  combination needs a low-confidence pending swap, which the fixture does not build.

<a id="2026-09-14-bf157-bodyweight-get-ready-clock"></a>

# 2026-09-14 — the bodyweight ready screen gets its clock back (BF-157)

**Branch:** `fix/bodyweight-getready-countdown` · **Lane B** · v1.456.2

## What it was

Owner, on the Pull-Up ready screen with the session clock at **8:42**: *"The body weight screens have
no warmup timer or load time so its just infinite on this screen."*

One expression explains it:

```js
const warmupSets = (() => {
  const set1 = workingWeight
  if (!set1 || set1 <= 0 || soloMode) return null   // ← bodyweight is 0
  return [{ pct: 50, … }, { pct: 74, … }, { pct: 92, … }]
})()
```

Dropping the ladder is right — 50/74/92% of nothing is not a warm-up. But the on-screen clock was
rendered *from* that array, so removing the ladder removed the clock. Two separate ideas behind one
gate.

## The entry named one case; there are four

BF-157 was filed as a bodyweight bug. The render gate reads
`warmupSets && !isBaseline && !isBodyweight`, so the screen loses its clock whenever **any** of these
holds: bodyweight, an AMRAP baseline, solo mode, or an exercise with no working weight.

`workout-screen.tsx:711` calls `startRestChip` for all of them, unconditionally, on
`transitionSecForEquipment` — and its own comment says that is *"the same total the on-screen ready
bar uses"*. That comment was false in all four. Fixing only the bodyweight case would have left it
false in three, so the fix is the negative branch rather than a bodyweight special case.

## What shipped

`GetReadyProgress` in `workout-clocks.tsx`: one bar, same elapsed derivation as the ramp, running to
`transitionSecForEquipment(equipment)`. `active-workout-screen.tsx` renders it as the `else` of the
ramp condition, so exactly one bounded clock is on screen at all times and both run to the same
total. The ramp for weighted exercises is untouched.

Colours come from `--accent-green` rather than the `#22c55e` the ramp beside it uses —
`check-hex-literals.js` caught the copied literal, which is the right catch: the ratchet is
shrink-only and the ramp's three baselined literals are not this change's to churn.

## Verification

`e2e/get-ready-timer.spec.ts` repoints every session's opening exercise at **Pull-Up**
(`{bodyweight}`) in `beforeAll`, restores it in `afterAll`, drives to the ready screen, and asserts a
`Get ready` bar reading `m:ss / 1:00` that ticks.

**Getting that spec right took three attempts, and both failures are the same mistake in different
clothes — reading the sandbox instead of creating the state.**

1. It assumed the seed's exercises were unweighted, because none carries an `exercise_id`. The ready
   screen came up at **73.75 kg** with a full ramp; the spec proved nothing and passed.
2. It then looked a real `Pull-Up` row up in the sandbox and hardcoded its uuid. CI builds its own
   `exercise_library`, so the `UPDATE` died on `session_exercises_exercise_id_fkey` —
   *"Key (exercise_id)=(d94e8afd…) is not present in table exercise_library"* — green locally, red on
   CI. **Only the Postgres service-container log named the cause**; the Playwright failure was a
   missing element, which reads like a UI regression.
3. It now inserts its own row **by name** (`exercise_library.name` is UNIQUE, which is the one thing
   both databases agree on), upserting so an aborted run leaves nothing behind, and tears down in
   order: `session_exercises` first, the probe row second — the other way round leaves
   `ON DELETE SET NULL` to blank the ids it is about to rewrite.

Teardown verified by reading the tables back after a local run: zero probe rows, all three opening
exercises restored to their original names and null ids.

| Assertion | Status |
|---|---|
| `Get ready` bar present | **falsified** — fails against unpatched `components/` |
| total reads `1:00`, and ticks | **falsified** — same run |
| no `Warm-up ramp-up` on bodyweight | **not falsified** — already true before this change |

The third is a regression guard against someone rendering the ladder at zero weight later, not
evidence about this fix. Recorded as such rather than counted as proof.

Also: `pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors ·
`vitest` 842 passed · `workout-set-loop` and `baseline-not-a-failure` still green.

## What was NOT exercised

- **No device.** The whole point is a screen the owner watches on the S25, and it has only been seen
  at 412 dp in Chromium. The entry asks for a bodyweight ready screen *and* a barbell one, checking
  the bar agrees with the notification chip — and the chip is native, so that agreement is
  **unverifiable in the sandbox** and is the single thing most worth checking.
- **`prepTimeSec` was not measured end to end.** The argument that a bounded screen improves the
  duration model's input is reasoning about `handleStart`, not an observation of a submitted value.
- **Solo mode and the zero-weight case were not driven**, only the bodyweight one. They share the
  branch, so they are covered by construction rather than by test.

<a id="2026-09-14-bf158-bf159-cooper-and-baselines"></a>

# 2026-09-14 — BF-158 and BF-159, found by a pre-flight check (BugFix intake)

Docs-only. The owner asked for the Cooper 12-minute run to be checked before running it for the
first time. Most of it is right; one thing would have ruined the result, and the check itself exposed
a second problem.

## What is correct, recorded so it is not re-checked

720 s duration with an auto-finish on expiry; `(distanceM − 504.9) / 44.73`, the real Cooper 1968
equation; 0.85 HR-reserve effort target; and a genuinely good guard — `test-result.tsx` skips the
VO₂max when a fixed-duration protocol ends under 90% of its window, saving HR and distance anyway,
because *"the Ross/Cooper equations are calibrated to the FULL protocol"*. The previous-test lookup
filters on `testType`, so his July 6MWT will not be compared against a Cooper.

## BF-158 — the one equation in the file with no clamp

```ts
const clampVo2 = (v: number) => round1(Math.max(10, Math.min(100, v)))
// sixMwtVo2max: both branches clamp
export function cooperVo2max(distanceM: number) {
  return round1((distanceM - 504.9) / 44.73)     // no clamp
}
```

At zero distance that is **−11.3**, saved into the fitness snapshot. **Zero is the realistic input**:
`test-active.tsx` reads distance from `startGpsWatcher` and nothing else — no treadmill toggle, no
manual entry, unlike the guided walk which has an explicit *"Treadmill — skips GPS"* switch. The
conversation immediately before this one was about treadmill walks, so he was one tap from doing
exactly that.

**The entry argues against the obvious fix.** Clamping turns −11.3 into a plausible **10.0** that
nothing flags. The right shape is already in the file: treat an implausible *distance* the way the
early-stop guard treats an implausible *duration* — no score, and say why.

## BF-159 — the card is in the wrong list, and it is the only door

`TRAINING_ORDER` puts **Cardio Baselines** between *Muscle Volume This Week* and *Workout Density*.
Everything around it is lifting; this card holds VO₂max and HR recovery. And `/baselines` has exactly
one entrance — `grep -rn "/baselines"` returns only `latest-baseline-card.tsx` — so a card filed
under the wrong heading is the entire discoverability story for all three protocols.

The owner's words after being told where to click: *"That section should be moved to cardio hub."*
The destination already holds `HeartProfileCard`, `ZoneQuotaCard`, `StepsQuotaCard` and
`ModalityPicker`; the entry recommends directly under the heart profile, above the zone quotas —
what the heart is doing lately, then what it was measured at.

## Not exercised

Docs only. Both mechanisms were read in the shipped source; the −11.3 is arithmetic on the published
intercept, not an observed row. His `fitness_tests` table holds two rows, both from 2026-07-19.

<a id="2026-09-14-bf158-fitness-test-distance-guard"></a>

# BF-158 — a fitness test with no distance withholds its score instead of inventing one

**Branch:** `lane-a/bf158-fitness-test-distance-guard` · **Lane A** · one shared guard, one consumer,
one test file.

## What the owner asked

A pre-flight check before running the Cooper test for the first time. He nearly ran it on a
treadmill — the session immediately before was about single-speed treadmill walks.

## What the entry found, verified line by line

`cooperVo2max` is the only VO₂ equation in the file that is not clamped, so `distanceM = 0` writes
**−11.3** into `fitness_tests.vo2max_est` and the fitness snapshot. Confirmed against current `main`:
the intercept guarantees it, and `test-active.tsx` takes distance from `startGpsWatcher` and nothing
else — no treadmill toggle, no manual entry, unlike the guided walk. An indoor run therefore produces
a full-length, correctly-timed capture with a distance near zero.

## What the entry did NOT find, and it is worse

The entry named Cooper. **The 6MWT has the same defect wearing the clamp**, and its capture comes
from the same GPS-only screen. Measured at zero distance:

| protocol | scores | why it is bad |
|---|---|---|
| Cooper | **−11.3** | unclamped; announces itself |
| 6MWT (Ross) | **10.0** | clamped up from 4.9 — a floor presented as a reading |
| 6MWT (Burr) | **34.8** | *the owner's own profile*; the distance term contributes nothing |

**The Burr case is the one that would never have been caught.** A negative is obviously wrong; 34.8
is a completely plausible VO₂max for a 33-year-old, and nothing marks it invalid. It would have
entered the fitness snapshot as a real reading. This is exactly why the entry said *"clamping alone
is the wrong fix and would be worse than the bug"* — and the clamped sibling was already living that
outcome.

Found by the sibling-surface sweep, which BF-155 got wrong the day before.

## What shipped

The guard is on the **distance**, before any equation runs — because the Burr branch proves the
output cannot be trusted to reveal a bad input. `MIN_SCOREABLE_DISTANCE_M` is **derived, not
chosen**: for each protocol it is the distance at which that protocol's *distance-only* equation
reaches `clampVo2`'s existing floor of 10, so the two protocols agree on what counts as a reading.

- Cooper: `10 × 44.73 + 504.9` = **952.2 m** (4.8 km/h over 12 min)
- 6MWT: `(10 − 4.948) / 0.023` = **219.7 m** (2.2 km/h over 6 min), from the Ross fallback

Both sit below the worst genuine effort, so no real test is withheld — the owner's own 6MWT (603 m)
still scores 18.8, matching his stored `ross_2010` record exactly.

`test-result.tsx` gates on it the same way it already gates on `endedEarly`, withholds `method` along
with the score (a row claiming `cooper_1968` with a null VO₂max would say a method ran that did not),
and says why. `endedEarly` wins the wording when both are true: a truncated capture explains a short
distance, and naming the distance there would send the reader after a GPS fault.

**Not done, deliberately:** manual distance entry so a treadmill's readout can be typed in. The entry
calls it "worth considering alongside, not required — owner's call", and the safety half stands on
its own. The screen now says the test needs GPS rather than silently failing.

## Verification

| mutant | result |
|---|---|
| remove the guard from the result screen (the exact defect) | **killed** |
| clamp Cooper instead of guarding (the fix the entry rejected) | **killed** |
| derive the 6MWT threshold from something other than Ross | **killed** (4 assertions) |
| `>=` → `>` at the threshold | **killed** |
| control — `>=` → `!(<)` | **KILLED, and correctly so** |
| control — commute the addition in the Cooper derivation | **survived**, as it should |

**The first control was not equivalent and the test proved it.** `!(x < y)` looks like a pure
rewrite of `x >= y` and is not: for `NaN` the first is `true` and the second `false`, so that
"harmless" rewrite would have let a NaN distance through to be scored. The NaN assertion was written
on general principle and earned its keep within the hour. A second, genuinely equivalent control
(commuting `VO2_FLOOR * 44.73 + 504.9`) survived.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean. Driven on `pnpm dev` signed in: `/health` and `/api/fitness-tests` both 200, no compile
errors.

**Not exercised:** the capture flow itself. A fitness test needs a real 6- or 12-minute GPS capture,
which the sandbox cannot produce, so the guard is verified by unit test and source assertion rather
than by running a protocol. **The owner's check:** run a protocol to full duration with GPS
unavailable and confirm no VO₂max is saved and the screen says why, and confirm an outdoor run is
unchanged.

## A queue defect found on the way in

BF-160 declared `Needs: BF-158` as ``- **`Needs:` BF-158**``. `next-item.js` parses
`\*{0,2}Needs:\*{0,2}` — asterisks, not backticks — so **BF-160 printed as READY #1 while the entry
it needs sat at #2.** Corrected in place; the `Needs:` count went 49 → 50, which is how the fix was
confirmed.

The same regex governs `Gate:`, and that is the case worth preventing: a backticked
``**`Gate: owner`**`` would park nothing, handing an agent owner-gated work as the top of its queue
with no sign anything was wrong. `Needs:` mis-orders; `Gate:` crosses a line the owner drew. Filed as
**LA-106** with the fix shape — fail CI on a field name that does not parse, rather than widening the
parser to accept backticks, which would reward the ambiguity.

<a id="2026-09-14-bf159-cardio-baselines-placement"></a>

# 2026-09-14 — Cardio Baselines moves to the Cardio tab (BF-159)

**Branch:** `fix/cardio-baselines-to-cardio-tab` · **Lane B** · v1.456.1

## What it was

Owner, immediately after having to be told where the Cooper test lives: *"That section should be
moved to cardio hub."*

`LatestBaselineCard` sat in the Health tab's `TRAINING_ORDER`, between *Muscle Volume This Week* and
*Workout Density*. Every card around it is about lifting; this one holds VO₂max and heart-rate
recovery.

The placement mattered more than a misfiled card usually would, because **`/baselines` has exactly
one entrance in the whole app** — `grep -rn "/baselines"` returns only this card. So a card in the
wrong list was the entire discoverability story for all three protocols: the 6-minute walk, Cooper,
and resting HR + recovery.

## What shipped

- `LatestBaselineCard` renders in `cardio-content.tsx`, **under `HeartProfileCard`, above
  `ModalityPicker`**. The heart profile is what the heart is doing lately; the baseline is what it
  was measured at, so the two read as a pair — and putting it above the picker means it is seen
  while deciding what to do today, which is when taking a test is a live option.
- `CardioContent` takes `userId`, threaded from `app/cardio/page.tsx`'s session. Without it the card
  falls through to `cachedFetch` instead of `getLocalStore`, which would have quietly downgraded a
  local-first read to a server-only one on the device.
- **Moved, not duplicated.** The `TRAINING_ORDER` entry and the `baselineTests` case in
  `health-sections.tsx` are both gone in the same commit.

## Verification

`e2e/cardio-baselines-placement.spec.ts` asserts the card is on Cardio, that its `/baselines` link
came with it, and that Health no longer renders it — the last one guarded against a Training panel
that actually rendered, so an empty screen cannot pass it.

**Both halves were proven to fail without the change**, which is the part worth recording:

| Half | How it was falsified |
|---|---|
| present on Cardio | ran against clean `main` (source changes stashed) — failed |
| absent from Health | ran against a build with the card deliberately in *both* places — failed |

The second run is the one that mattered. The first assertion fails first, so a single negative run
never exercises the Health half at all — it would have shipped unproven, guarding precisely the
two-entrances failure the entry warns about.

## What was NOT exercised

- **No device.** Playwright at 412 dp on `pnpm dev`. The entry's own verification asks for the S25:
  the card on the Cardio tab, gone from Health, and its link still working from the new position.
- **No local store.** `getLocalStore` returns null in the sandbox, so the card was only ever seen
  taking its `cachedFetch` fallback. The `userId` prop threaded here is exactly the path that only
  runs on the APK.
- **No populated baselines.** The local database has no fitness tests, so the card rendered its
  "Take a fitness test to set your baseline" state throughout. The populated layout — up to three
  protocols wrapping in a flex row — is unseen at 412 dp in its new column.

<a id="2026-09-14-bf160-fitness-test-not-credited"></a>

# 2026-09-14 — BF-160: the Cooper run saved correctly and still went uncredited (BugFix intake)

Docs-only. The owner ran the Cooper test after the pre-flight check and asked whether it saved. It
did, cleanly: `cooper12`, **1,975 m**, **720 s** exactly, VO₂max **32.9** via `cooper_1968`, avg HR
156, peak 175, synced to Postgres. The formula reproduces independently —
`(1975 − 504.9) / 44.73 = 32.9`.

## What the check turned up instead

No `activity_log` row exists for the day. Told that, the owner said *"Yes it should count."* Measured:

| surface | credited? | evidence |
|---|---|---|
| Zone minutes | **yes, already** | 581 strap samples ≥80% of max ≈ **9.7 min** in the top zone |
| Calorie budget | **no** | not a workout, not an activity; `computeActiveEnergy` has no third source |
| Cardio history | **no** | `activity_logs` for 2026-09-14: **0 rows** |

**The steps path does not rescue it.** `body_metrics.steps` reads **894** for the day — fewer than a
1,975 m run produces by itself. So the hardest twelve minutes of his week contribute essentially
nothing to earned calories, on the very screen BF-152 and BF-154 have just made anchor to measured
movement.

The underlying split: HR-derived credit flows automatically (the strap reaches the zone quota with no
activity row), event-derived credit does not. A test therefore looks partly credited, and the missing
half is invisible until the budget is checked.

## What the baseline actually changed, measured

The run's 794 strap samples moved the **corroborated observed max from 167 to 175** (the 5th-highest
reading over 90 days, `computeObservedHr`'s order statistic).

That moves `targetAnchorMax` — the anchor for *reachable* targets in guided-walk blocks and
fitness-test protocols — up 8 bpm. It does **not** move `maxHr`: that adopts an observed max only
when it is at least the age-predicted value, and 175 < 187, so the zone ceiling is unchanged. The
resolver's own comment explains why, and it is right — a low observed max must not drag the ceiling
down and make ordinary efforts read as maximal.

## What VO₂max does not do, recorded so it is not assumed

`grep` for consumers of `vo2max_est` returns three display surfaces and nothing else: the Cardio
Baselines card, the test picker's previous-result line, and the More → performance overview. No
scoring, no recommendation, no AI tool reads it. The value of this baseline is a trend line against
the next Cooper, not changed app behaviour.

## Not exercised

Docs only. Every figure is a production read; no code changed.

<a id="2026-09-14-bf161-builder-adds-saved-meals"></a>

# 2026-09-14 — BF-161: the meal builder can add a saved meal, flattened

**Lane B.** Branch `fix/bf161-meal-builder-add-saved-meals`. v1.456.8.

## What was asked, and what the queue did with it

Owner: *"For the meal builder it should let you add meals/saved items as part of the meal builder."*

The builder's search had **three** sources — your own foods, an AI estimate, the food database — and
none of them was a meal. Log Food, one screen back in the same sheet, has had a `meals` tab since it
shipped; the capability existed and simply did not reach one screen deeper.

The entry framed a real decision rather than an implementation, and the owner answered it:
*"Okay lets go with flatten for now."*

## Why flattening is not a shortcut

`saved_meal_items.food_item_id` is **NOT NULL**. A meal item *is* a food item, so there is no column
a nested meal could occupy. Real nesting costs a migration, **recursive macro computation in every
consumer of `saved_meal_items`**, and cycle prevention (meal A contains B contains A) — a class of
bug with no cheap guard, for an account holding 15 saved meals averaging 1.9 items each.

**What it gives up, stated because it is a choice:** a meal built from a saved meal is a snapshot.
Editing the source later does not change it. Nothing on screen implies otherwise — there is
deliberately no *"from &lt;meal&gt;"* provenance chip, because that reads as a live link.

## Two things that made this smaller than it looked

- **No new fetch, no schema change.** `SavedMeal` already carries `items`, each with its `foodItem`
  and `quantityMultiplier`, and the sheet already loads them for its own list. The new source is
  therefore instant and works offline, like the own-foods source beside it.
- **The mapping already existed.** `openBuild` built the same `{ item, qty }` rows inline to load a
  meal for editing. Both now go through `savedMealToEntries`, which **settled the quantity question
  by agreement rather than argument**: editing an existing meal already loads at the stored
  whole-recipe multiplier, which is exactly what makes BF-161's own check — that the result matches
  the sum of the sources — true as written.

## Where the code went, and why not into the obvious file

`saved-meals-sheet.tsx` was **788 lines against a hard 800-line ceiling**, and the size rule is
explicit that a new feature goes into an extracted child rather than onto the hotspot. So the source
list is `saved-meal-results.tsx` and the arithmetic is `saved-meal-flatten.ts`; the sheet gained a
four-line handler and two props. It ends at **791**, net +3, because routing the recipe import
through the shared `addEntries` removed eight lines from it.

## Verified

- `pnpm check:rules` **Ran 74 of 74**, all passed · `tsc --noEmit` clean · `pnpm lint` 0 errors.
- `components/nutrition/__tests__/saved-meal-flatten.test.ts` — 7 tests, including a guard that **no
  nesting column appeared** alongside the flatten, since avoiding that migration is the decision.
- `e2e/bf161-builder-adds-saved-meals.spec.ts` — reachability, which the unit test cannot cover: a
  source that exists and cannot be reached from the builder is the exact bug being fixed.

**Two spec failures worth recording, both mine and neither in the feature.** The first version used
`.click()` and timed out on the Nutrition screen without opening the sheet — `.click()` never lands
there (Q-354), a trap already written down in this repo and hit earlier the same day. The fix was to
take `builder-barcode-scan.spec.ts`'s opener verbatim rather than write a new one; it reaches the
same ingredient search for the same reason. The second was a strict-mode violation on
`getByText('Your meals')`, which matches **both** the tab and the list heading — the match being
ambiguous was the render working, which is a confusing way to read a red run.

## Not exercised

**The device.** `Keep:` on the entry: on the S25, build a meal from two saved meals and confirm the
ingredient rows, their quantities and the macro total match the sum of the sources. Recorded in
`projectOverview.md` as not device-verified.

<a id="2026-09-14-bf161-flatten-decided"></a>

# 2026-09-14 — BF-161's gate lifted: flatten (BugFix intake)

Docs-only, a one-bullet change. The owner answered the question BF-161 was filed with:
*"Okay lets go with flatten for now"*.

`Gate: owner` is removed. `next-item.js --lane B` now prints BF-161 at the **top of READY**, where it
was invisible while parked.

## What the decision fixes in the entry

The entry carried both options and a recommendation. It now carries an instruction: build the flatten
path, add no nesting column. That matters because *"for now"* invites a middle road — a nullable
`food_item_id` left in place against a future that may never arrive — and the whole reason flatten
wins on these numbers (15 saved meals, 1.9 items each) is that it needs no migration at all. If
propagation is wanted later it is a new entry with its own migration, not a half-measure designed in
now.

## The consequence, restated in the entry rather than left implicit

A meal built from saved meals is a **snapshot**. Editing the source afterwards does not change it.
The entry now says nothing on screen should imply otherwise — in particular, no "from <meal name>"
provenance chip, which would read as a live link to the thing that is deliberately not linked.

## Not exercised

Docs only.

<a id="2026-09-14-bf161-meal-builder-saved-meals"></a>

# 2026-09-14 — BF-161: the meal builder cannot see your meals (BugFix intake)

Docs-only. Owner: *"For the meal builder it should let you add meals/saved items as part of the meal
builder."*

## Three ingredient sources, none of them a meal

`ingredient-search.tsx` names them in its own header — the user's own **foods**, the **AI estimate**,
and the **food database** (Open Food Facts). `saved_meals` is absent, and the placeholder says so
out loud: *"Search your foods or the food database…"*.

`food-list.tsx` already carries a `meals` tab, so **Log Food** can log a saved meal in one tap. The
builder, one screen deeper in the same sheet, cannot reach them. The capability exists; it does not
reach here.

## The schema is the interesting part

```ts
savedMealItems: { savedMealId → savedMeals, foodItemId → foodItems (NOT NULL), quantityMultiplier }
```

A meal item **is** a food item. There is no column a nested meal could occupy, so this is not a UI
oversight that a dropdown fixes — it is a design question about what "a meal inside a meal" means.

## The recommendation, and what it costs

**Flatten on add.** Picking a saved meal expands its items into the builder as ordinary ingredients
with their multipliers. No migration, no recursion, Lane B alone. Measured on his account: **15 saved
meals averaging 1.9 items** against **304 foods** — the ingredient lists stay short, so the obvious
objection does not bite at his scale.

**What it gives up, stated rather than glossed:** no link back. Editing the source meal later will
not change a meal built from it. Arguably right — a built meal is a recipe you fixed, not a live
reference — but it is a real difference and the owner decides.

The alternative is a nullable `food_item_id` plus `nested_saved_meal_id`: real composition, edits
propagate, and it costs a migration, recursive macro computation in **every** consumer of
`saved_meal_items`, and cycle prevention (A contains B contains A). Not worth it for 15 meals of 1.9
items unless propagation is specifically wanted.

Filed `Gate: owner` — flatten versus nest is a product decision, and a one-line answer unblocks it.

## Not exercised

Docs only. The three sources were read from the component's own documentation, the constraint from
the Drizzle schema, and the counts from production.

<a id="2026-09-14-chore-or-112-workout-pass"></a>

# 2026-09-14 — the workout pass: a premise that expired when the owner changed programs

**Branch:** `chore/or-112-workout-pass` · backlog only. No product code.

## BF-59 — the owner handed the call over, and the data retired half the entry

Owner: *"You should have all the data to see my prescribed sets; you can make the decision here."*

BF-59 is written around a **flat 14/10 binary** in `program_volume_targets`. Measured in production:

| program | active | distinct values | range |
|---|---|---|---|
| **Bankai** | ✅ | **6** | 5–13 |
| Shikai | no | **2** | 10–14 |
| AI-Phase1 | no | 2 | 8–12 |

**The `14/10` pair is Shikai's, and Shikai stopped being the active program on 2026-09-06** — when the
owner rebuilt their training around less lower-back work. Bankai's stored targets are already a
sixteen-muscle gradient: abs/chest/lats/shoulders 13 · biceps/calves/quads/upper-back 11 ·
hamstrings/triceps 10 · glutes/traps 8 · forearms/lower-back 6 · adductors/hip-flexors 5.

**So item 1 is still worth doing and its stated symptom is not reproducible.** `signals.ts:399` does
still read `vt.targetSetsPerWeek` rather than the phase-scaled `weeklyVolumeTarget`, and that
engine/screen inconsistency is real. What is gone is the consequence the entry sells it on. Re-scoped
as the architectural fix it is, with a warning not to "fix" it by regrading Bankai — those numbers are
the owner's deliberate choice, and phase scaling multiplies them rather than replacing them.

## Two decisions, both settled

- **BF-94 — yes, build the swipe.** *"Yes I would rather be able to swipe the start button to reveal
  the rest."* Its `Gate: device` is discharged **by the answer, not by a look**: it was waiting on a
  preference. BF-61's fast-tap concern survives as an implementation constraint, not a blocker.
- **PS-10 — do not build.** *"Dont build"*, against the owner's own original idea. The entry leaves
  the queue, **recorded rather than silently deleted**, because a later session finding the idea in an
  old journal would otherwise re-file it.

## A third kind of answer: the conditional close

**BF-64 and LB-47** both came back *"Will let you know when it comes up. Happy to treat as fixed if I
dont raise it again."* Each needs a specific program state to arrive on its own.

Their `Verify: device` is removed so they stop printing as debt — but the note says plainly that
**nothing has confirmed the fix works.** If either symptom is reported again it is a **regression
report against an unverified fix**, not a fresh bug, and the next session starts from the original
diff. That distinction is the whole reason the note is longer than "owner says treat as fixed".

## Verified (3)

BF-135, BF-141, BF-65.

## Result

Device debt **37 → 32**. Workout is clear.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.

<a id="2026-09-14-chore-or-113-shell-pass"></a>

# 2026-09-14 — the app-shell pass, and fifteen entries that had been finished for days

**Branch:** `chore/or-113-shell-pass` · backlog + one queue-tool check. No product code.

## The finding worth the sitting: a verification and a `Keep:` ten lines apart

Nineteen entries carried a `✅ VERIFIED ON THE S25` line **and** a `Keep:` still claiming that device
check was owed. They were spread across all three device passes — nutrition, workouts, app shell —
and none of them is wrong when read on its own. Recording the owner's answer and striking the residue
are two edits; only the first one feels like progress.

The cost was that `next-item.js` kept printing finished work as debt, which is the exact failure
`Keep:` was introduced to fix (OR-100) wearing the other hat.

**Fifteen were fully done and left the queue. Four owed something else and were narrowed:**

| entry | what is genuinely left |
|---|---|
| BF-145 | ② the sheet question — a decision, not an implementation |
| BF-109 | (a) a real barcode scan of `9350167000490`; the camera is the part no harness reaches |
| Q-531 | the drain → re-sync → verify walk; only findability was checked |
| Q-187 | the design question — spread vs next-meal-only, which only use can settle |

Three removals kept a `>` note rather than vanishing, on the rule that a note survives where the entry
held knowledge nothing else pins: **BF-76** (the `vh` hypothesis is not the safe-area mechanism — a
bottom sheet is `fixed inset-x-0 bottom-0`), **BF-57** (`shared-meal` carries the recipe and works
cross-account; `meal-id` is a 22-character pointer that only resolves for its owner, and six of seven
label styles are pointers), **BF-46** (a `fetch()` of a `data:` URL is governed by `connect-src`).

**It is checked now.** `keepIsSettled` in `scripts/lib/keep-kind.js`, six tests, advisory in
`check-backlog-pointers`. It is **suppressed by the word DONE** in the residue — the four narrowed
entries above all say which half is done, and a rule that fires on the entries someone handled
correctly is a rule people scroll past.

## A failure filed under the wrong entry for a day

**BF-100's device failure was written into RV-36's entry.** For a day the entry that FAILED read as
shipped-and-awaiting-a-look, and the entry that PASSED carried a failure note contradicting its own
verification a few lines lower. Moved. Both are about the same hook, which is what made it invisible
from either one alone.

BF-100's `Verify:` now says **start with `/more`**, which is where it failed, and carries the second
requirement the owner named: **back from a tab with nothing to pop should land on Home, not exit** —
inherited from Q-93-followup, which asked the same thing for `/health/day` and has left the queue.

## Two gates that were never the owner's

- **BF-110** — `Gate: device` parked it while the next step it asks for is **one line of code**: log
  the viewport a second time ~500 ms into the same resume, to separate a genuinely stuck WebView
  viewport (native fix) from a measurement taken too early (render-gate fix). The device is the
  verdict on a *fix*, which is a `Verify:` after something ships. The owner sat on this item in two
  device passes with nothing they could usefully do.
- **Q-1b** — `Gate: owner` against the entry's own instruction *"Do not re-put this to the owner"*.
  Settled twice already; the field kept it printing in every owner-decision sweep. `Keep:` alone
  holds it out of the work list.

Both are the defect **PS-35b** names: a gate that prose scopes to one paragraph parks the whole entry,
and the runner cannot see the scoping.

## Three answers

- **BF-126 — build the artwork.** *"Yes we need to create artwork for these."* Two things the answer
  did not settle are now written into the entry: the **brief** (~12 assets, against nine glyphs
  covering the three ladders today) and the **32 px constraint**, which is a real risk to the answer
  rather than a footnote — an emoji is drawn to read at that size and a detailed sprite is not.
  **Ship one tier and compare it against its glyph before commissioning twelve.** The glyph map stays
  as the fallback; a missing asset must not leave an empty tier.
- **Q-147 — removed, and no number was ever taken.** *"Seems good now."* The entry existed because
  cold app start had never been measured, and it closes on a judgement rather than the measurement it
  asked for. That is recorded plainly: **there is no cold-start baseline in this repo**, so a future
  regression has nothing to be compared against.
- **Q-51 — the premise softened.** *"Its mostly fine; I'd still like it to be faster if possible."*
  This entry was placed high because it was the owner's **stated felt pain**. It is now a want, and
  the placement should follow. Its own instruction to measure before refactoring is more binding, not
  less: a large refactor is a poor trade against "mostly fine".

Q-147 and Q-51 together also prop up Q-1b's hold, which says to reopen only if *"the app starts
feeling slow to open"*.

## Result

Queue **347 → 332**. Backlog **21,598 → 21,095 lines**, the largest single drop recorded — the
baseline is ratcheted down rather than left as slack.

`check-backlog-pointers` clean on 332 entries · `pnpm check:rules` **Ran 74 of 74** · `keep-kind`
15 tests green.

**Surfaces not exercised:** none apply — backlog and one Node check script. No product code, so
nothing reaches the APK from this PR.
