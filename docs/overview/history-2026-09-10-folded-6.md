# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-02-q529-provisional-sleep-score"></a>

# Q-529 — a still-syncing night now says so, on all three surfaces that show it

**Branch:** `fix/mark-provisional-sleep-score` · **Lane:** B · **Domain:** `[sleep]` `[app-shell]`

The owner, 2026-08-20: *"that wake up time is way off, I woke up around 6am"* — a screenshot at 06:46
Brisbane showing a night the ring had not finished uploading, scored **47**, rendered exactly as a
finished night would be.

## The entry was stale, and that made the job smaller

Q-529's central claim: *"sleep stores no equivalent [provisional flag], so partial and finished
scores are indistinguishable."* True when it was written. **`lib/sleep/provisional.ts` shipped for
BF-83 on 2026-09-01**, and `/api/sleep-sessions` has returned a per-night `provisional` flag ever
since — computed per request from the rollup's coverage watermark rather than stored, because what it
describes changes without the row changing.

So the flag was already reaching the client in the JSON. **Four separate local `SleepRow` interface
declarations dropped it on the floor** — `health-content.tsx`, `health-sections.tsx`,
`session-select-content.tsx` and `sleep-content.tsx` each restate the payload, and none declared the
field. `provisional` was rendered for readiness contributors and the body-battery anchor, and for no
sleep surface at all.

The entry's own "first action" (build a recompute path) was therefore the wrong half, and the fix it
listed third — *"do not render a number that will change"*, marked as the only part shippable without
an APK — was the whole of the remaining work.

## What shipped

Three surfaces, because a mark on one of them is worse than none: the number the owner sees first is
the Home chip, and marking only the detail screen would leave the reported failure untouched.

- **The Home score chip** already had a qualified-number mechanism — a `TriangleAlert` glyph plus an
  aria-label suffix, driven by `lowWear` and `limited`. `provisional` joins it rather than inventing
  a second visual language. **The predicate was written out at three sites** (label glyph, band
  layout, compact layout), so a third qualifier had to find all three; it is now
  `components/health/score-qualifier.ts`, which is also what makes it testable — the chip row is
  `.tsx` and both vitest projects run `environment: 'node'`.
- **The Body tab's sleep card** gets a "Still syncing" pill. Once, not per figure: the duration, the
  score and all six stat chips move together, so badging each would say one thing six times.
- **The `/health/sleep` detail screen** gets the caveat in full, because that is where the chip's
  glyph leads and the glyph has no room for words.

**The aria phrase reads every qualifier that applies**, not the first. They are independent — a night
can be both short on wear and still syncing — and a listener who hears only one takes the number as
settled.

**An absent flag reads as settled.** The local-store seed has no rollup watermark to compute it from,
so offline the field is `undefined`; `?.provisional === true` is what stops that badging every
historical night as still-filling. That matches `isNightProvisional`'s own treatment of null
coverage.

## A hotspot, and the way out of it

`session-select-content.tsx` is shrink-only at 1448 lines, and adding the field pushed it to 1452 —
the same gate that caught LB-47. Rather than trim a comment to squeeze under, its local `SleepRow`
(a strict subset of the canonical one, and the fifth copy in the repo) became a `Pick<>` of the real
type. That removes lines from the hotspot instead of adding them, and the `Pick` is the honest
shape: it names the fields Home actually uses, and keeps the local-store seed's narrow object literal
assignable.

## What the caveat turned up, which is not this entry's

Q-529 said to re-read `computed_at` for 2026-08-20 before building anything. It has moved and the
score now reads **62**, so this is latency rather than a missing recompute — the alternative the
caveat named.

But the wider read is worse than the entry assumed. **`oura_daily_derived` holds four distinct
`computed_at` stamps in its entire history**, with a **nine-day gap** (2026-08-24 → 2026-09-02) in
which nothing was written, and the most recent pass rewrote 85 rows minutes after a Railway deploy.
If deploys are what recompute scores, the refresh cadence is release frequency. Filed as **LB-53**
for Lane A. It makes this change more load-bearing rather than less: the provisional state may
persist for far longer than the ~9-minute window Q-529 measured.

## Verification

11 unit tests, the predicate and the aria phrase driven directly, with **nine mutations killing
them**: provisional not counted as a qualifier, an empty cell marked, the provisional phrase silent,
only the first qualifier spoken, the oldest night read instead of the newest, an absent flag not
forced false, the sleep cell dropping the flag, and the card and detail screen each unmarked.

Two e2e specs in a real browser, stubbing the payload in both directions — a provisional night shows
the badge and its explanation, a settled night shows neither. Stubbed rather than seeded because the
real flag needs the ring's clock anchors and a rollup watermark, neither of which the seed database
has: against it every night reads final and the marked case is unreachable.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised

**A real still-syncing morning.** The flag is only true while the rollup has not read past a night's
end, which needs the ring mid-upload — the sandbox has neither. So the badge has been seen in a
browser against a stubbed payload and never against a genuine one; the device check is opening the
app during the morning upload window and confirming the mark appears, then clears once the night
settles. Also unexercised: the offline path, where `getLocalStore` returns null off the APK, so the
`undefined`-reads-as-settled branch has never run on a device.

<a id="2026-09-02-recent-food-items-unscoped"></a>

# 2026-09-02 — `Recent` gets an unscoped source, and the migration it was said to need does not exist (LB-18)

**Lane A · branch `lane-a/saved-meal-last-used` · no version bump**

The owner settled this on the device on 2026-08-30: *"Recent doesnt need to be scoped to current
meal bracket; I think it should just be all recently entered foods/meals."* Lane A owns "the
source"; Lane B does the swap.

## The entry's central claim was false, and checking it removed a migration

LB-18 says a saved meal has no last-used timestamp, that this is why `My Foods` can only order by
`createdAt DESC`, and that a recency ordering across foods and meals therefore **needs a Lane A
schema change, not a Lane B sort** — *"say so in the plan rather than discovering it mid-PR."*

`listSavedMeals` already derives `lastUsedAt` from `max(food_logs.logged_at)`, orders by
`lastUsedAt DESC NULLS LAST, createdAt DESC`, and reads `idx_food_logs_saved_meal_recent` from
migration 238. Its own comment explains the choice: *"a 'last used' column… needs a write on every
log, an un-write on every delete, and it is wrong forever if either is missed"* — the Stored
Counters rule, applied correctly by whoever built it.

So the planned work — a migration, a local SQLite version, `RECONCILE_COLUMNS`, the sync chain —
was **the whole of it, and none of it was needed.** What was actually missing is one line: a query
without a `WHERE meal_type_id`.

I had already mapped that migration's chain in detail before finding this, including establishing
that `saved_meals` is not in `getSyncDelta` and pulls as a full list rather than a delta. That
mapping is correct and was wasted, which is the argument for reading the code *before* the plan
rather than after.

## What shipped

- `listRecentFoodItems(userId, limit)` — repository, adapter, and `slices/nutrition.ts`.
- `getRecentFoodItems(limit)` — the local store, so it works offline exactly as the scoped one does.
- `mealTypeId` is now **optional** on `GET /api/nutrition/recent-for-meal`. Absent means every
  bucket, and returns 12 rather than 5 — a global list drawn from every meal of the day would
  otherwise cut off mid-breakfast.

**Both scoped and unscoped share one body on each side.** The de-duplication and the 100-row scan
window are the parts that would drift silently if copied, and the window is load-bearing: the query
reads the last 100 *logs* and collapses them to distinct items, so a bucket where the same three
things are eaten repeatedly still yields three items rather than one.

**The route keeps its name rather than gaining a sibling.** A second near-identical route for the
same concept is how two recency rules end up disagreeing, and the owner's answer makes the unscoped
list the default rather than a variant. The name reads slightly stale; the alternative is worse.

## What is not done

Lane B's swap — dropping the query param in `RecentFoodsPanel`. That component's comment already
predicted the shape: *"the swap is this component's fetch and nothing else."* LB-18 stays queued
with a `Keep:` for it.

Mixing saved **meals** into the `Recent` list, which the entry also mentions, is a surface decision
about what that tab contains, not a missing query — `listSavedMeals` can already order them by
recency.

## Verification

- Full suite: **6,290 passed / 59 skipped / 744 files**. `pnpm check:rules` — **Ran 67 of 67**.
  `tsc` clean.
- Five assertions against a real Postgres: items come from every bucket most-recent-first (asserted
  as an **absolute list**, since a bug dropping one bucket would still satisfy an ordering-only
  check); the scoped query still sees only its own bucket; a food eaten in two buckets appears once;
  deleted logs are excluded; and the query is user-scoped.
- **Mutation-tested**: making the unscoped path keep the meal filter fails four of the five.
- **Against `pnpm dev`** with a real session: no `mealTypeId` returns 4 items across buckets and a
  200 where it used to be a 400; with one it returns 3, correctly excluding the dinner item.

**Not exercised:** the local-store half runs only on the device — `getLocalStore` returns null under
vitest and in the web sandbox — so `getRecentFoodItems` is verified by mirroring the server's shape
and by typecheck, not by execution. No UI calls it yet.

<a id="2026-09-02-recommend-prompt-tdee"></a>

# 2026-09-02 — the recommend prompt claimed an activity-scaled TDEE it never had (LB-50)

**Lane A · branch `lane-a/recommend-prompt-tdee` · no version bump**

`app/api/nutrition-goals/recommend/route.ts` built its baseline line as
*`Baseline (Katch-McArdle, lean mass Xkg, activity level "moderate"): BMR X, TDEE X…`*, which parses
as *this TDEE was computed for a moderate activity level*. It was not.

## The premise, checked rather than taken

`calculateBaseline` computes `tdee = Math.round(bmr * SEDENTARY_MULTIPLIER)`
(`packages/shared/src/nutrition/goal-recommendation.ts:188`) — 1.2, unconditionally. Q-401 deleted
`ACTIVITY_MULTIPLIERS` on purpose, so a self-reported level cannot double-count against the measured
movement the prompt supplies separately as steps and active calories. The level still reaches
`waterMl` and `stepsGoal`, and nothing else.

So the model was being handed a number and a false description of how that number was made, next to
an activity level and a step count — everything it needs to "correct" for a multiplier that is not
there.

This is the first entry of the session whose stated premise survived contact with the code.

## What shipped

The level is out of the baseline parenthesis, and the prompt now says outright that the TDEE is
BMR × 1.2, is not activity-scaled, and must not have a multiplier added. **Saying it beats merely
removing the false claim:** the model is still told the activity level on its own line and still
given steps and active calories, so silence would leave it to infer the relationship — which is what
it was doing wrong in the first place.

## What is deliberately not done

The second half of the entry — exposing the measured activity factor (`maintenanceKcal / bmr` on the
calibrated path) with its window, so BF-102's picker can render *"Calibrated · 1.38×, from your last
14 days"* — is not built. It needs the same not-enough-data state the maintenance figure already has,
and a calibrated factor that silently falls back to a guess is a worse picker than the one it
replaces. The entry stays queued with a `Keep:` naming it. The entry itself says the prompt fix
should ship on its own, and it is a one-string change with no feature attached.

## Verification

- Four assertions, one of which pins the **premise** rather than the fix: if `ACTIVITY_MULTIPLIERS`
  is ever reintroduced, the test fails rather than quietly protecting a statement that has become
  false in reverse. The others check the level is gone from both baseline lines (Katch-McArdle and
  Mifflin-St Jeor), that the correction is stated, and that the level still drives water and steps —
  so the correction is not itself an overstatement.
- **Mutation-tested**: putting the activity level back into the baseline line turns it red.
- `tsc` clean. Source-level assertions because the prompt is assembled inline and the only other way
  to see it is to call the model.

**Not exercised:** no LLM call was made, so this does not demonstrate the model's output changing —
only that it is no longer told something untrue. The APK, safe-area and Samsung WebView are
untouched; this is one string in a server route.

<a id="2026-09-02-tn1-chronic-stress-count"></a>

# 2026-09-02 — TN-1: the chronic-stress refusal now leaves a number behind

**Branch:** `claude/la-tn1-chronic-stress-count` · **Agent:** Implementation Lane A

`chronic_stress_score` has been NULL on every `oura_daily_derived` row since the model shipped — the
third dormant score, after the illness radar and resilience. Both gates countable from stored data
have been measured and both pass: a `fullHistory` pass built 43 summary rows against a threshold of
21, and 27 of 31 nights in the trailing window are complete at the summary level. That pass wrote 23
derived rows, scored illness on all 23, and chronic stress on **none**.

So the refusal is below the summary layer, in the granular one — and it was invisible by
construction. `computeNightIntermediates` runs on signals recomputed in memory by design ("no stored
intermediate that could drift"), and a night with no stash, or with an empty hypnogram, rMSSD series
or skin-temp run, contributes all-NaN and simply vanishes into a null score with no reason recorded.

`usableGranularNights` counts the nights in the model's own 31-night window that carry all three
series non-empty, and `oura_daily_derived.chronic_stress_granular_nights` persists it. Migrations
**258** (column) and **259** (regenerated `claude_ro` views — without which the number is invisible
to the audit endpoint that is the whole reason for it), local SQLite **v36**.

**The gate is untouched, deliberately.** `CHRONIC_STRESS_MIN_DAYS` does not move and nothing consults
the count. Relaxing a threshold before knowing its input distribution is the Q-504 mistake, and
Q-506 is the same class — there a two-point nudge would have hidden a biomarker whose baseline was
18.7× wrong. The count exists to make that question answerable, not to answer it.

**What the entry did not say, and it decided the shape of the change.** The step skipped the write
entirely on `score == null` — which is *always* — so the count had to be written on a path that
previously wrote nothing at all. The upsert COALESCEs, so writing the count alone can never clobber
a prior good score, and the existing `summaryRows.length < CHRONIC_STRESS_MIN_DAYS` early return
still keeps a routine incremental pass (window ~3 nights) from recording a meaningless one. NULL
therefore means *not evaluated*, never *zero usable nights*.

**One stale reference corrected:** the entry points at `adapter.ts:5706`; the chronic-stress step
moved to `lib/oura-ble/rollup/run.ts` when the rollup was extracted.

**⚠ This needs the owner to produce its number, and that is the whole remaining item.** Only a
hand-triggered `fullHistory` pass reaches the model, so until one runs the column stays NULL on
every row — the expected state, not a defect. When a number does appear: **≥ 21 with the score still
null puts the fault inside the vendored model**, and TN-1 has done its job by proving it; **< 21
names the granular stash as the constraint**, and what to do about it is Tuning's question and then
the owner's.

**Not exercised:** the device path. Local SQLite v36 is a plain ADD COLUMN, but it now lands behind
v35 and v34's table rebuild, so a device upgrading from v33 runs three migrations in one pass —
still unopened. No `fullHistory` pass was run, so the new column has never held a value anywhere.

<a id="2026-09-03-acwr-ewma-day-shift"></a>

# 2026-09-03 — measuring the ACWR switch before writing it (Q-279)

**Branch:** `claude/la-q279-ewma-measurement` · docs-only.

Q-279's piece 2 calls the uncoupled-EWMA switch *"a contained change to one shared function with an
existing test suite"*. That is true of the code and not of the consequence — ACWR drives the
early-deload card and the over-exertion taper — so the standing rule applies: **a proposal is
incomplete until it states how many other days it moves.** This measures that first.

## The result that keeps it small

| 95 comparable days | mean | median | max |
|---|---|---|---|
| coupled (current) | 0.919 | 0.955 | 1.594 |
| uncoupled EWMA | 0.955 | 0.967 | **1.512** |

**The scales agree, and that was not obvious in advance.** A formulation change that shifted the mean
would have forced `lowMax`, `EARLY_DELOAD_ACWR_MIN` and `ACWR_TAPER_START` to be recalibrated
together — a far larger proposal than the entry describes. They don't move.

## What does change

| threshold | coupled | uncoupled | days that change |
|---|---|---|---|
| early-deload 1.2 | 12/95 | 15/95 | **19** |
| taper 1.5 | 4/95 | **1/95** | 5 |
| band floor 0.8 | 67/95 | 74/95 | 13 |

~20% of days flip at the deload boundary, in both directions — a net of +3 firings hides 19
individual changes. **The sharpest question is the taper: 4 firings become 1.** The EWMA's maximum is
1.512 against 1.594, because its weighting damps exactly the single-heavy-session spike the taper
reacts to. Whether that is the fix or the loss is not decidable from the data, so the entry is now
`Gate: owner` with the numbers attached.

⚠ Recorded on the entry so it cannot be over-read: the uncoupled form removes the **mathematical
coupling**, the one criticism not in dispute. It does nothing for ACWR's predictive validity and is
**not** evidence the card should fire more or less often.

## Premise refinement

The entry says *"naive 7:28"*. Chronic divides by the **observed data span in weeks**, not a flat 4 —
the flat ÷4 was retired for inflating ACWR ~2× on new programs — and the 28-day bound comes from the
caller (`readiness-payload.ts:339`). The coupling criticism is unaffected, but there is no `/ 4` to
find.

## A process note

`check-backlog-pointers.js` caught an inline `**Gate:** owner` written inside a blockquote, where the
parser ignores it and the entry would have stayed READY. **Second time this session.** The field has
to start its own bullet. Worth the reminder that the check is what caught it both times, not review.

## Limits

One user (`claude_ro` is row-scoped). The simulation is day-granular where `computeVolumeAcwr` works
in timestamps, and its `minSessions >= 6` gate was applied to days-with-sessions rather than
sessions — both make the gate marginally stricter than production, and neither moves the comparison
since both formulations get identical input. The EWMA is seeded from the first observed day, hence
the 28-day offset before comparison begins. No code changed; nothing ran on a device.

<a id="2026-09-03-bf-110-resume-repaint"></a>

# BF-110 — the blank resume was never a dead renderer

**Branch:** `fix/bf-110-resume-repaint` · **Lane:** B · **Domain:** `[app-shell]` `[platform]`

The owner: *"this screen still happens when tabbing back. I noticed it fixes itself if you just
scroll on it. but would like to fix."*

## One detail overturns the standing diagnosis

**A scroll fixes it.** A killed WebView renderer has no document left to scroll — the process is
gone, the layer tree with it, and the only recovery is `recreate()` plus a reload. Content that
reappears when you drag it was there all along and simply was not painted. That is a compositor
failure, not a process death, and the two want opposite fixes.

Production agrees: `error_events` holds **zero** rows matching `renderer` / `reclaimed` /
`RenderProcess` across every blank screen since 2026-08-31. **That silence is weaker evidence than it
looks**, and the entry is right to say so — BF-80's handler is native, and the newest published APK
is v1.414.1 against a v1.436.x web app, so it cannot be assumed the installed build even contains it.
The scroll is what carries the argument.

**BF-80 is not wrong and its handler stays.** `onRenderProcessGone` returning `true` is correct
either way, and `check-render-process-recovery.js` should keep failing CI if it goes. What changes is
that BF-80 no longer explains *this* symptom. Two causes, one appearance.

## What shipped

Both halves, in the order the entry insists on, because the cheap fix and the wrong fix look
identical until the measurement exists.

**Measure.** `handleResume` reads the shell root's bounding box and child count on every resume.
Intact means a real box with real children; anything else would put a renderer death back in play and
make a repaint the wrong fix.

**Repaint.** Promote a layer, flush layout, release it on the next frame — the same instruction the
manual scroll gives the compositor. **Not a scroll nudge:** BF-100's restoration hook lives on this
same container and listens for scroll, and a programmatic scroll there is a needless interaction with
a fix that took six documented traps to get right. **Not a permanent `will-change`:** that buys
memory on every screen forever to fix a moment lasting one frame.

On `pull-to-sync.tsx`'s container, where BF-100 already sits, because the report says *"pages often"*
rather than naming a screen — fixing this in a component would look like a fix and hold for a day.

## The entry asks for a row per resume; that was not built

Three reasons, and the third decides it. `error_events` prunes at 30 days and is the second-largest
object in the database. The owner resumes many times a day. And **JS cannot tell whether the screen
was actually blank** — the DOM is intact either way, which is this entry's own thesis — so a row per
resume records nothing about the failure it is meant to evidence.

What ships instead: a **`dom-lost` sample always**, because that is the observation which would
*disprove* this entry and it must never be lost to a cap; and a **`dom-intact` sample once per
launch**, which is all the positive case needs. The repaint runs on every resume; only the row is
capped. Written into the entry so a later session does not restore the flood.

## Verification

12 unit tests, **seven mutations killing them**: a zero-sized root counting as intact, a lost DOM
silenced by the cap, a row on every resume, the layer staying promoted, no promotion at all, the
repaint tied to the report cap (which would fix the first resume of a launch and leave every later
one blank), and the hook not wired into the shell.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised — and here that is the whole verdict

**Samsung's WebView compositor, which is the only place this bug exists.** Chrome and `pnpm dev`
cannot show it; the repo has met this compositor before, in the SVG-wipes-sibling-gradients note in
[`docs/mobile-ui-and-performance.md`](../mobile-ui-and-performance.md), with the same signature —
correct DOM, absent paint, invisible outside the APK. **So the suite proves the effect RUNS and
nothing about whether it FIXES anything.**

The device check: background the app long enough to reproduce (the original report had battery at
**10%** with Messenger running, and low memory is the likeliest trigger), then resume and confirm the
screen paints on its own. Afterwards, read `error_events` for `bf110 resume` — a `dom-intact` row is
the measurement this entry wanted, and a `dom-lost` row would mean the diagnosis here is wrong and
BF-80 is back in play.

<a id="2026-09-03-bf-111-version-labels"></a>

# BF-111 — About stops looking like it contradicts itself

**Branch:** `fix/bf-111-version-labels` · **Lane:** B · **Domain:** `[app-shell]`

The About screen showed the app as **v1.436.2** and, two rows below, a green tick reading **"Up to
date — v1.414.1 is the newest build."** Both numbers were right, which is what made it a bug: the
first is the web app, advanced by every Railway deploy; the second is the newest published APK, and
"up to date" was a true statement about it. Nothing on the screen said either of those things, so a
green tick appeared to vouch for the smaller number.

## The date was already in the payload

`/api/version` has returned `nativeBuiltAt` — the release's publish time — alongside `nativeVersion`
and `nativeBuildSha` all along. The card read `nativeVersion` and dropped the rest.

**That is the third entry today with this exact shape**: a value computed and served, and no screen
reading it (Q-529's per-night `provisional` flag, Q-516's `informativeShare`, now this). Worth noting
as a class rather than three coincidences — the server half tends to ship with its consumer assumed.

## What shipped

**Every state now names the INSTALLED build**, which is the half that answers the question the card
exists for. Previously the update state named the *newest* version — a build the phone does not
have — and said nothing about the one it does, so a user on an old APK could not tell what they were
running. `App.getInfo().version` was already being fetched for the comparison and then discarded.

- up to date → `Up to date — v1.414.1, built 31 Aug`
- update available → `New Android build — v1.414.1 (31 Aug)` over `You have v1.400.0 — tap to download`
- lookup failed → `Could not check for a newer build — you have v1.400.0`

The section header is **Android build**, not "App build" — that name is what let the tick read as a
claim about the chip above it. The chip is labelled `App v1.436.2` with one line saying the app
updates itself, which is the reason the two numbers differ at all.

**The three-state shape is unchanged and deliberate.** "Could not check" is still not "up to date":
a false all-clear is the same class of mistake as a false alarm.

## The date has a timezone trap, so it is a helper

`formatBuildDate` (`components/more/build-label.ts`) goes through `toAestDay` + `formatDayShort`
rather than `toLocaleDateString`. A bare locale format renders in the *device's* zone, which is the
repo's recurring date bug wearing a different hat — invisible while the phone sits where the data
came from. A release published at 15:30 UTC on 31 August is **1 Sept** in Brisbane and **31 Aug** in
London, and the test asserts both.

It also returns `null` rather than a label for a missing or unparseable timestamp — the same path
that produces "could not check" — so the card never renders `built Invalid Date`.

## Verification

9 unit tests, **seven mutations killing them**: a device-local date, an unguarded `NaN`, an
unguarded null, the header reverting to "App build", each of the three states dropping the installed
version, and the chip losing its label.

**One mutation reported `applied=yes` and changed nothing that mattered** — it replaced the first
occurrence of "Android build", which is inside a comment the test strips before matching. Re-run
against the JSX, it failed correctly. That is the "verify the mutation applied" rule needing its
sharper form: verify it changed *the thing under test*, not merely that the file differs.

Full unit suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint
clean.

## Not exercised

**The whole card, on a device.** `UpdateCheckCard` returns early unless `Capacitor.isNativePlatform()`,
so on web and in every e2e harness it renders nothing at all — none of the three states has been on a
screen. The assertions are over source and over the pure date helper. The device check is the one in
the entry: on a phone whose APK is behind the web app, About names both numbers, says which is which,
and the tick refers unambiguously to the Android build.

<a id="2026-09-03-la56-late-redecode-result"></a>

# 2026-09-03 — LA-56: a redecode that finishes late can now say so

**Branch:** `claude/la56-late-result` · **Agent:** Implementation Lane A

The owner ran the `fullHistory` pass three docs had been waiting on. It was reaped as "abandoned"
after exactly 30 minutes having written nothing — the second such failure in four days. LA-56 filed
the blocker; this ships the half of it that could be verified in the sandbox.

**`finishRedecodeJob` discarded late results.** It filtered `isNull(finishedAt)`, which the reaper
has already set. So a run completing after the staleness window could not record its outcome: the
work would land while the record still said it had been abandoned. Given that *every* full-history
redecode ever attempted was reaped that way, a late success has never had anywhere to go.

**Letting it through alone would have traded one blind spot for another.** A late result would
overwrite the abandoned error and hide that the run exceeded the window at all. `reaped_at`
(migration **261**, views regenerated in **262**) keeps both facts — when the reaper gave up, and
what eventually came back. NULL means never reaped.

**An existing test caught a first, broader attempt, and it was right to.** Removing the guard
outright also removed the guarantee that finishing twice cannot overwrite a good result. The
predicate is now precise: an open row, or a reaped row that never got an outcome. A job that
genuinely finished and recorded a result stays immutable.

**The gating on LA-56 was too wide and that is corrected.** `oura-redecode-job.test.ts` already ran
the reaper against a real local Postgres, so these storage semantics were verifiable here all along
— only the worker's heartbeat stamping needs the device. Saying otherwise parked work that did not
need parking.

**Still owed, and it is the risky half:** `reapStaleRedecodeJobs` remains a pure `startedAt` age
check, so slow and dead still look identical. A `last_beat_at` the worker stamps, reaped on beat age,
is what separates them — and it stays `Verify: device` because if beats do not stamp in production
every job stays `running` forever and the one-at-a-time index blocks every future redecode. It wants
a total-runtime ceiling shipped with it.

**A migration-number collision, caught before it landed.** Another lane took 260 mid-session; these
renumbered to 261/262 above it. Worth recording because the regenerated views are built from the
local DB, so a lane's migration missing locally would silently drop its columns from the view
definitions — checked here, and main's 260 is a data delete with no schema change.

**Not exercised:** the device, and the failure this ultimately serves. No redecode was run — the
route needs an admin session this environment cannot mint. The new column has never held a value in
production, and will not until a full-history pass both outruns the window and finishes.

<a id="2026-09-03-q516-hr-recovery-honesty"></a>

# Q-516 — the HR Recovery Profile now says how much of it is signal

**Branch:** `fix/q516-hr-recovery-honesty` · **Lane:** B · **Domain:** `[heart-rate]`

Found by auditing the queue for Lane B work rather than by picking the next READY item, because it
was not in READY — or in any other lane's list.

## It was unreachable from either queue

Q-516 carried two bare lane mentions that disagreed. Its `Keep:` said *"the honesty half, and it is
now **Lane B's**"*; eleven lines below, a line left over from when the re-banding was a Tuning
proposal still read *"Lane A implements; Tuning proposes only"*.

`laneFromLines` refuses to guess between conflicting bare mentions and returns `?` — deliberately,
because a wrong lane sends work to the wrong agent silently. So `next-item.js` filed the entry under
UNCLASSIFIED, where neither lane's list shows it. **That is the exact failure the lane module's own
comment documents**, and it had left real work invisible for a day.

The stale line is struck and the lane is a field now.

## What was actually missing

`aggregateHrRecoveryProfile` has returned `informativeShare` since the re-banding shipped — the
fraction of banded episodes whose peak clears the low-signal threshold. Its own doc comment says why
it exists: *"the honest version of Q-516 is not the re-banding: it is saying out loud that HR
recovery informs a MINORITY of lifting sets… a caller that renders them without this number is the
failure mode the entry named."*

Nothing rendered it. Verified before building, rather than taken from the entry: computed at
`hr-recovery-profile.ts:178`, returned by the route (`NextResponse.json({ ...profile, trend })`),
typed into the card's own response at `hr-recovery-profile-card.tsx:24`, and read by no component.

The card already carried a dimmed-band note — *"HR barely elevated — recovery there is mostly noise"*
— but that says **which rows** are noise, not **how much of your training** lands in them. Four
populated buckets read as a working feature either way.

## What shipped

The share, stated under the table, and **emphasised once the informative rests are a minority**:
below half it stops being a footnote about the dimmed rows and becomes the headline about the whole
table, so it takes the amber treatment and says to read the table as a partial picture.

**A share of 1 renders nothing.** A "100% of your rests are informative" line on a table that is
entirely fine is noise, and noise is what trains a reader to skip the line that matters. A null share
means no banded episodes, where the card already renders nothing at all.

`components/health/hr-recovery-honesty.ts` holds the threshold and that silence rule — a `.ts`
beside the component, matching `score-qualifier.ts` and `sparkline-geometry.ts`, because the card is
`.tsx` and both vitest projects run `environment: 'node'`.

## The mutation that survived, and what it was hiding

Six mutations were run and five killed tests. `Math.round` → `Math.floor` passed, and it was a real
defect rather than a gap in coverage: `informativeShare` is stored to two decimal places, and
`0.29 * 100` is `28.999999999999996` in binary floating point. Truncating renders **28% for a share
of 29%** — off by one, silently, and only on some values. A case pinning 0.29 and 0.58 was added and
the mutation now fails.

That is the argument for running the sweep rather than trusting a green suite: the test that caught
it did not exist until the mutation showed nothing was watching.

## Two queue corrections in the same PR

- **Q-516** — the stale lane line struck, the honesty half recorded as shipped, and `Gate: owner`
  left on the one thing still open: whether the feature is targeted correctly at all, given the
  range it wants lives in cardio rather than strength sets.
- **BF-94** — its `Needs: BF-84` is **discharged**. The stated reason was that BF-84 rewrites what
  `onRestDay` does, so rebuilding how it is invoked would touch the same call site twice; that
  rewrite shipped 2026-09-01 with migration 247. What still blocks BF-94 was written only in prose —
  *"do not ship this until BF-61's fast-tap check has been done on the device"* — so the queue could
  see an expired blocker and not the live one. It is a `Gate: device` field now.

## Verification

12 unit tests, the threshold driven directly **and through the real `aggregateHrRecoveryProfile`**,
so a change to the low-signal threshold moves this test rather than slipping past it. Six mutations
kill them: a note on a clean 100% table, silence on the zero case, the boundary flipped to
inclusive, truncation instead of rounding, the card never reading the field, and the card rendering
with no note.

Full unit suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint
clean.

## Not exercised

**A real profile with a minority share.** The seed database has no `set_hr_stats` history, so the
card renders nothing there and the amber branch has never been on a screen — it is proven by the
aggregate and by source, not by pixels. The owner's own profile sat at **39%** when Q-516 was
written, so the emphasised branch is the one they will actually see; whether amber at that size is
legible on the S25 is a device question. Also unexercised: whether the copy reads as useful rather
than as the app apologising for itself, which is a judgement only the owner can make.

<a id="2026-09-03-sentry-client-tunnel"></a>

# 2026-09-03 — Sentry hears the browser again (BF-92, Lane A)

**Branch:** `fix/sentry-client-tunnel`

## What was wrong

Sentry was connected, correctly configured, scrubbed, and receiving **nothing from the browser** —
for 13 days. `connect-src` in `lib/security/csp.ts` never named the ingest host, so every client
event was refused before it left the page. The natural experiment was already in the app's own data:
over the same window the homegrown reporter, which POSTs **same-origin** to `/api/client-error`,
recorded 9 client faults from the same device, while Sentry held zero browser events. Same app, same
errors, different origin, opposite outcome.

`instrumentation-client.ts` had predicted this failure in its own comment — *"a `connect-src` that
does not include the ingest host silently drops every client event"* — and the host was never added.
**A comment describing a hazard is not a guard against it**, which is the durable lesson and the
reason this change ships with a test rather than a better comment.

## What shipped

- **`next.config.ts`** — wrapped in `withSentryConfig` with `tunnelRoute: '/monitoring'`. The browser
  POSTs same-origin, which `connect-src 'self'` already permits, and Next rewrites it on to
  `*.ingest.sentry.io`. **No CSP edit**, deliberately: the header's comments show it has been
  reasoned about host by host, and tunnelling cannot be silently broken by the next edit to it.
  A fixed path rather than `true` (a random path per build) because the path has to be *named* in
  the middleware matcher and the service worker, and a name that changes every deploy cannot be.
- **`middleware.ts`** — `/monitoring` excluded from the matcher. It was inside it and in no
  `PUBLIC_PATHS`, so an unauthenticated report would have been 307'd to `/sign-in`: the identical
  silent drop, relocated from the CSP to the auth gate.
- **`public/sw-template.js`** — the tunnel path handed to the browser untouched. The catch-all branch
  `cache.put()`s any ok response and the Cache API **rejects a POST Request**, so every successful
  error report would have raised an unhandled rejection inside the service worker.
- **`sentry.server.config.ts`** — one line at boot naming whether **each** DSN was found. The server
  process can read the `NEXT_PUBLIC_` one too, so a single server log covers the path that has no log
  of its own. The DSN value itself is never printed.
- **`lib/security/__tests__/sentry-tunnel-reachability.test.ts`** — six assertions over all three
  gates, plus one that no Sentry host reappears in `connect-src` (which would mean somebody had
  reverted to the shape that broke). Both behavioural assertions were mutation-checked: reverting
  the matcher or the worker branch fails the file.

## The finding that was not in the entry

BF-92 named one gate. There were **three**, in series, each invisible from the layer above:
the CSP, the auth matcher, and the service worker. Only the first had been found by reading; the
other two turned up by following the request end to end through the built artefacts and then through
a running server. That is the argument for tracing a path rather than fixing the layer that was
reported.

## Verification

- `pnpm build`: the tunnel rewrite lands in `routes-manifest.json` (**`afterFiles`** — the first read
  of this said it had not landed, because it looked in `beforeFiles`, which is empty), in both region
  and non-region variants; `_sentryRewritesTunnelPath="/monitoring"` is baked into the client chunks;
  the built `middleware-manifest.json` regex carries the exclusion.
- `pnpm dev`, runtime: `POST /monitoring?o=1&p=2` reached **Sentry's own nginx** — HTTP 401 with
  `x-sentry-error` among the exposed headers — proving the rewrite proxies rather than 404s locally.
  Controls in the same run: a gated page 307s to `/sign-in`, `/sign-in` returns 200.
- Full suite 6410 passed / 86 skipped, Custom Rules **67 of 67**, lint clean, typecheck clean.

## Not verified, and it is the whole gate

**That an event actually arrives in the dashboard.** That needs the APK, signed in, with a deliberate
throw, and it is BF-92's `Gate: device`, unchanged. Nothing here was exercised in the Samsung WebView:
not the service-worker branch (the SW does not run in the sandbox at all), not the safe-area or
rendering paths, and not a real DSN — `enabled` is false outside production, so no SDK call was made
end to end in any of the above.

## Owner decision left open

Excluding `/monitoring` from the auth gate is a genuine **widening**: the path is reachable without a
session. It buys the errors most worth having — the sign-in path has no session by definition, and
`/api/client-error` requires auth, so it has never captured one of them — and it costs a relay that
could forward an envelope to some other Sentry project via this domain. No data of ours, no auth
surface, no database, and the destination host pattern is fixed by the SDK. One line to revert.

## No version bump

Nothing here is user-visible; it changes what the operator can see, not what the app does.

<a id="2026-09-04-bf-113-bmi-dexa-label"></a>

# 2026-09-04 — the BMI band says what it was computed from (BF-113)

**Branch:** `fix/bf-113-bmi-dexa-label` · Lane B · labelling only, no arithmetic changed, no APK.

The owner: *"bmi doesnt say its scaled to match dexa."* He is right, and the card was one word short
of true. The band it draws (*High fat* at 27.9) is chosen from `displayBodyFat`, which returns the
**DEXA-corrected** figure — and the only thing the card said about it was *"via body fat %"*. The
info popover was no better: *"Category is based on your body fat % — more accurate for muscular
builds."* Nothing named the calibration.

## The part that was not a string change

`latestBf` was derived as `metaRecentReversed.map(displayBodyFat).find(v => v != null)`. That gets
the number right and **throws away which row produced it**, so nothing downstream could say whether
the band rested on a corrected reading. It genuinely varies row to row: two thirds of the owner's
history is on instruments the calibration does not cover.

So the value and the flag now come out together, in `latestDisplayedBodyFat(rows)` beside
`correctedSpan` in `body-fat-display.ts`. The entry's warning is the reason it is a helper rather
than two expressions at the call site — **never `bodyFatCorrected !== bodyFat`**, because an offset
can round to zero and *"corrected by 0.0" and "not corrected" are different claims*. The authority is
`bodyFatIsCorrected` on the row actually shown.

The caption reads `via body fat % (DEXA-calibrated)` when that row was corrected, and is unchanged
when it was not. The popover gains one sentence on the same condition.

## Verification

**Six unit cases on the helper, two mutations killing them:** taking the flag from the newest row
instead of the row the value came from (1 failure), and inferring the correction by comparing the
two numbers (3 failures). The cases that carry the weight are the ones where those differ — a newest
row with no body fat above a corrected one, an uncorrected newer reading above a corrected older one,
and a correction whose offset rounds to zero.

**Three call-site cases** added to `body-fat-display-sites.test.ts`, already this domain's guard,
with two mutations killing them: dropping the calibration clause from the caption, and reverting to
the row-losing `map(displayBodyFat).find(...)`.

`tsc`, lint (0 errors), `pnpm check:rules` **Ran 68 of 68**, full unit suite **6,452 passed / 0
failed**, `check-test-typecheck` at baseline.

## Not exercised — and this is the whole of the visual claim

**The caption and popover were never seen on a screen.** The attempt is worth recording rather than
skipping: Health was loaded authenticated against `pnpm dev` using the e2e storage state, and the BMI
card rendered its **"No data"** branch — `metaRecent` does not reach the client for the seeded user,
so `bmi` is null and neither the caption nor the popover is on the page at all. Seeding a body-fat
row did not change it. The corrected case needs more still: `bodyFatIsCorrected` is computed
server-side from a DEXA calibration, so it cannot be produced by inserting a reading.

What that leaves: the flag proven by unit test, the wiring by source guard, and the rendering by
neither. **The device check is the real one** — on the S25, a corrected reading must show
`via body fat % (DEXA-calibrated)` under a band that is unchanged, and an uncorrected one must not
claim calibration.

<a id="2026-09-04-bf-117-rollover-refetch"></a>

# 2026-09-04 — the screens follow the day, not just the check-in (BF-117)

**Branch:** `fix/bf-117-rollover-refetch` · Lane B · no engine change, no migration, no APK.

The owner, re-reporting something he had flagged once already: *"when opening the app after a day
has been completed it doesnt reset the screens (I flagged this before) so I need to close and reopen
app to get a fresh view."*

## What was actually wrong

BF-86 fixed the morning check-in on this exact mechanism and deliberately stopped there, writing a
scope line rather than guessing: *"whether any [today-scoped read] is both persistently mounted and
never re-read is the Q-359 question… subscribing all of them blind would be a large diff justified
by a guess."* That caution was right, and the evidence has now arrived, so the guess was unnecessary.

Home reads `useLocalDay()` at two places — the mood read and the check-in prompt. **Everything else
on the screen is gated on `refreshTick`**, which is bumped by `refetchAll`, by a saved check-in, and
by the BLE-drain-settled listener. A day change bumps none of them, and the tab shell never unmounts,
so those payloads are the ones fetched at app launch and they stay until the process is killed. The
owner's screenshot splits exactly along that line: today's greeting and *"Morning check-in saved"*
above a *"Rest Day"* card and a Partial Recovery card that were yesterday's.

## Health and Nutrition had the same gap for a different reason

Both refresh on `tabEpoch`, and reading `tab-shell.tsx` settles what that signal is: the epoch is
bumped when the shell **re-shows** a tab. Navigating back to a tab bumps it; the app resuming onto a
tab the user never left does not. So a phone left open on Health across midnight keeps yesterday's
readiness, trends and training load, and BF-86's note that *"most sit behind the `tabEpoch` re-show
pass"* was true without being sufficient.

Nutrition is the interesting one: it **already knew how to follow midnight**, with a handler that
moves the selected date to today when the user was sitting on "today". It was wired to one of the two
signals. It needed the other, not new logic.

## What shipped

`useDayRolloverRefresh(fn)` in `components/shell/local-day-provider.tsx`, beside the signal it
consumes — the day-rollover counterpart to `useRefreshOnTabShow`, and named to say so.

**The trap it exists to close:** `LocalDayProvider` seeds the date synchronously, so an effect merely
keyed on `useLocalDay()` fires once at mount and refetches on every launch. That is invisible in use
— it reads as an app that is slightly slow to settle — so the guard belongs inside the hook rather
than in a flag each caller has to remember. The ref holds the day the caller last refreshed for,
seeded at mount, which makes the first run a no-op by construction.

Home passes `refetchAll`, the pass pull-to-sync already runs, so nothing new is introduced and
`sleep-sessions` — which is **not** one of the tick-gated reads, per the Q-91 note in that file — is
re-taken with the rest. Nutrition's hand-rolled `if (tabEpoch === 0) return;` guard became the
existing `useRefreshOnTabShow`, so its catch-up now runs from both signals and from one definition.

`getGreeting` moved to `app/session-select/greeting.ts` with an injectable clock. It is the other half
of the reported symptom — the *correct* "Good morning" sitting above yesterday's cards — and the
file it came from is a shrink-only hotspot, so a fix that only added lines could not land at all.

## Verification

**The e2e case is the real one**, added to `day-rollover-checkin.spec.ts` because BF-86 already built
the harness this needs: Playwright's clock is installed just before local midnight and fast-forwarded
past it, so the case fires on every run rather than once a day. It counts requests to
`/api/readiness-score` rather than reading card text — the cards' content depends on seeded data, but
*"were these reads taken again"* is precisely the defect. It asserts both directions: a **same-day**
resume must not refetch (the mount double-fetch trap), and a **cross-midnight** resume must.

Proven by mutation: with the hook call commented out the rollover assertion fails and the same-day
assertion still passes, which is the right shape — a negative case that fails when the fix is removed
would be testing the wrong thing.

`check-e2e-api-stub-sw.js` caught a real defect in the first draft: the spec counts requests with
`page.route`, and the service worker re-issues every `/api/` fetch where Playwright cannot see it, so
the stub would have applied or not depending on whether the worker had claimed the page. `test.use({
serviceWorkers: 'block' })` was the fix. That rule earned its place here.

Unit: `getGreeting` gets 10 cases pinning every period boundary and one proving it reads the user's
zone rather than the runner's. Two mutations kill them — shifting the afternoon boundary (1 failure)
and ignoring the injected clock (8).

Full suite **6,453 passed, 0 failed**; `pnpm check:rules` **Ran 68 of 68**; `tsc`,
`check-test-typecheck` (320 errors across 90 files, none above baseline), lint (0 errors) clean.

**One thing pinned rather than endorsed:** `getGreeting` treats 00:00–11:59 as "morning", so a resume
at 00:30 — the BF-117 window — reads *"Good morning"*. Pre-existing, odd, harmless, and noted in the
test rather than changed under cover of a different fix.

## Not exercised

**The device.** BF-117's own verification is an overnight one: leave the app open on the S25 and
resume after midnight — the scores, the rest-day card and the recovery card all show today, with no
reload, spinner or blank frame; resume again ten minutes later and nothing refetches; an in-progress
workout and a queued outbox both survive untouched. The e2e case drives the same sequence in a
browser, which is real evidence about the mechanism and none about the native resume path.

Also not exercised: Health's and Nutrition's rollover, in any harness. Only Home has the e2e case;
the other two take the identical hook and were read, not run.

<a id="2026-09-04-hrv-ramp-not-step"></a>

# 2026-09-04 — I filed LA-57 yesterday and it is wrong (Q-509 candidate 3)

**Branch:** `fix/la57-hrv-ramp-not-step` · **Lane:** A · **Domain:** readiness / devices

Docs-only, and the deliverable is a retraction plus the measurement that forces it.

## What I got wrong

LA-57, filed 2026-09-03 by this same agent, said night HRV **doubled at the 2026-07-07 re-key** —
`body_metrics.hrv_ms` 26.9 (Cloud, n=14) → 55.9 (BLE, n=59), with per-night ranges of 20–39 before
and 40–56 after, *"no return and no overlap to speak of"* — and concluded **"a doubling within days
is a measurement-definition change, not physiology."**

Both observations are what a **monotonic ramp** produces when it is cut in the middle.

## The measurement that settles it

Night HRV **inside the BLE era alone** — one device, one decoder, where a definition change is not
possible:

| week | n | night HRV (ms) |
|---|---|---|
| 2026-07-06 | 5 | 45.5 |
| 2026-07-20 | 7 | 52.9 |
| 2026-08-03 | 7 | **63.0** |
| 2026-08-24 | 7 | 56.6 (one night at **26.5**) |

**+38% within a single device era**, then a plateau. A change in which statistic is computed gives a
step and a new stable level; it cannot make values keep climbing for five weeks under an unchanged
decoder. And the ranges overlap after all — that 26.5 ms night sits inside the 20–39 band the entry
attributed to Cloud-era measurement.

Weekly daily-HRV means across the boundary run 21.8 → 31.1 → **41.6 (the re-key week)** → 46.4 → 52.9
→ 59.2 → 68.0. The boundary week sits on the line between its neighbours, and the ramp continues four
weeks past it. RHR does the same in reverse: 68.3 → 50.0.

## What is still open, narrowly

Whether a definition change *also* sits underneath the ramp. Nothing here excludes it. What is
excluded is the evidence LA-57 offered — pre/post means and non-overlapping ranges, both of which a
ramp produces unaided. Testing it properly means modelling the trend and fitting a discontinuity
against it, on about **two weeks** of pre-boundary HRV. That is thin, and it is different work from
what the entry describes. The RMSSD-vs-SDNN check is still worth doing on its own terms.

## Q-509's candidate 3 closes, the other way up

The 2026-09-03 measurement stands: `recovery_index_hours` is flat over 58 BLE nights. Its reading was
wrong. **It is not that nothing was changing** — night HRV rose 38% and RHR fell 6 bpm across exactly
those nights, steps rose 5,618 → 7,558 and weight 68.35 → 71.45 kg. The metric named for recovery did
not respond to any of it.

So candidate 3 does not close as "no physiological change to find". A large one happened and the
metric ignored it — **independent corroboration of Q-509's own estimator-bias conclusion**, reached
without the anchor-ratio argument.

## A caveat I raised and discarded

`oura_daily_summary` holds no rows before 2026-07-07, which suggested the Cloud-vs-BLE refit might
compare **two different estimators** rather than one estimator on two inputs. It does not:
`oura_heartrate` carries Cloud-sourced series from 2026-06-22 to 07-06 and `ble` from 07-06, so our
estimator ran on both. Q-509's framing is sound. Written down because the next reader will notice the
same empty table and should know it was checked, not missed.

## The pattern, third instance in one session

A before/after mean across a trending series manufactures a step. The other two: mixing
`pg_database_size` with a user-table sum on BF-55, and reading `computed_at` as a per-score stamp on
LB-53. All three are the same mistake — comparing two things that are not the same measurement and
attributing the difference to the subject.

## Not exercised

Production was read only, through `claude_ro`, which is row-scoped to the owner — one person's data,
which is the right scope for this question. No code changed. Weekly means, no smoothing; the
2026-07-06 week straddles the re-key and is reported as-is.

## Gates

`pnpm check:rules` 68 of 68 · `check-backlog-pointers` OK, 290 entries.

<a id="2026-09-06-bf-112-dose-entry"></a>

# 2026-09-06 — BF-112: a dose you can actually type in

**Branch:** `fix/bf-112-dose-entry` · **Lane B** · v1.436.13

The storage for dosed substances shipped on 2026-09-01 (migrations 254 + 255, local SQLite v34) and
nothing in the app could write to it. Production held two supplements with `default_amount`, `unit`,
`dose_prompt` and `started_on` all empty, and one supplement log of any kind, from June. The owner
starts dosing on **2026-09-06**, which is what made this the queue's top Lane B item.

## What shipped

- **`components/nutrition/manage-supplements-sheet.tsx`** — amount + unit beside the existing
  free-text dose, an "ask me each time" switch (`dose_prompt`), and the started/stopped window. The
  five values are derived once into a `doseFields` object and spread into all four write paths (the
  local SQLite row, the outbox payload, the optimistic `Supplement`, the API body), because a field
  present in three of them is this repo's "saves but does not persist".
- **`components/nutrition/supplements-section.tsx`** — the titration prompt. A supplement with
  `dose_prompt` asks for the number when it is ticked, pre-filled with the definition's amount. The
  dialog collects a number and re-enters `toggleLog`; it does not write anything itself, so there is
  still one write path, not two.
- **`components/nutrition/supplement-subtitle.ts`** — the row's second line: what today's log
  recorded, falling back to the definition's amount, falling back to the free-text dose. The log's
  number wins, which is the whole point of BF-3's stamp.
- **`components/nutrition/supplement-day-totals.ts`** — the day's exposure derived from local log
  rows, and the optimistic adjustment for the page's own tick.
- **`app/nutrition/nutrition-content.tsx`** — the local-first branch now carries the dose fields.

## Two defects found while verifying, both fixed here

**The device path dropped every new field.** The nutrition page's local-first branch builds its
`SupplementWithStatus` objects by hand and returned early once the local store had definitions — so
`defaultAmount`, `unit`, `dosePrompt`, `startedOn`, `stoppedOn` and `loggedAmount` were all absent on
the APK and present in the browser, where `getLocalStore` is null and the server's own mapping is
used. The prompt would never have fired on the device. This is the sandbox trap the Canonical
Runtime section names, arriving from the other direction: the *browser* was the surface that worked.

**The tick left the previous log's number on screen.** `onChanged` flipped `loggedToday` alone, so
un-ticking a 5 mg dose still read "5 mg today", and re-ticking it at 7.5 mg still read 5 until the
next pull. Measured in the browser, then fixed with `applyManualToggle` and re-measured.

## Verified

Live round trip against a dev server, exercising the entry's own verification list:

| | |
|---|---|
| create with amount 2.5 mg, prompt on, started 2026-09-06 | 201 |
| prompted log of 5 mg while the definition said 2.5 | 200 |
| definition then patched to 10 mg + stopped 2026-12-01 | 200 |
| list | `defaultAmount: 10`, `loggedAmount: { amount: 5, unit: 'mg', contributions: 1 }` |

The earlier log still reads what it recorded after the definition moved — BF-3 gap 1, which is the
reason the stamp is on the log rather than read from the definition.

In the browser at 412 dp: the row rendered "5 mg today" against a definition of 10; un-ticking and
re-ticking opened the prompt pre-filled with 10; entering 7.5 wrote 7.5 to the server and the row
read "7.5 mg today" immediately.

Gates: `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 68 of 68** · lint clean ·
`check-test-typecheck` no errors above baseline · full unit suite 5,423 passed (the one file-level
failure is `recent-food-items-unscoped.test.ts` skipping on an unset `DATABASE_URL` in this shell,
not a code failure).

## Not exercised

**Not verified on device.** Native SQLite does not run in the sandbox, so the local-store write path,
the local-first read that this entry fixed, and the outbox replay were all reasoned about and
typechecked rather than run. That is exactly the surface the second defect above was hiding on, which
is the argument for the on-device pass rather than against it. Safe-area, Samsung WebView rendering
and real sync were likewise not exercised.

## Left behind

- **LB-57** — the day-exposure derivation now exists twice, once per lane. The single home is
  `packages/shared`, which Lane B may not write; filed for Lane A with the three behaviours that must
  stay identical.
- Stages 3 (meal attachment) and 4 (the trends overlay) of BF-69 are unchanged. Stage 4 needs about
  four weeks of real amounts, which this entry is what makes possible.

<a id="2026-09-06-bf-120-lone-row-macros"></a>

# 2026-09-06 — BF-120 / OR-101: a meal section with one loose food shows its macros again

**Branch:** `fix/bf-120-lone-row-macros` · **Lane B** · v1.436.18

The owner, twice, from two device checks: *"1 meal doesnt show the calorie total; but 2 meals do"*
and *"No double; but not even a single one on my last logged meal."* A section holding one loose food
printed no protein, carbs or fat anywhere, while the section above it printed all three.

## The gate was a count and the question is a kind

`meal-card.tsx` suppressed the totals footer on `entries.length > 1`, and stated the reason twice —
at `:87` and `:148`:

> *"a single row already states its own macros, so a footer would repeat it"*

**True of a group row, false of a loose one.** `diary-meal-group.tsx` renders calories *and* P/C/F;
`food-row.tsx` renders name, a grey secondary line, calories, chevron — and nothing else, ever since
**Q-406** moved the per-item macros into the detail sheet so one row component could serve the diary,
the library and both search lists. The file holds the true statement and the false one that depends
on it, ten lines apart.

The decision moved to `components/nutrition/meal-card-footer.ts` as `mealFooter(kinds)`, which asks
what the only entry *is* rather than how many there are.

## Two reports, one defect, and the disagreement is worth keeping

BF-120 and OR-101 (filed by another session in the still-open #875) describe the same screen and
**disagree about the cause**. BF-120: *"This is a consequence of BF-98, not an unrelated
regression."* OR-101: *"It is not a regression from BF-98 — and that is the useful half."*

**OR-101 is right, and it is checkable.** BF-98's own case table lists *"one loose row → no footer
(unchanged)"*. It moved the gate from `logs.length` to `entries.length` to stop a single **group**
drawing its macros twice, which it did correctly and still does — asserted by the first test in
`diary-nested-meal.spec.ts`, which passes before and after this change. This case never had a footer.

**BF-120 is the better statement of the fix**, though, and is what shipped: render the macro row for
any section with content, keep the calorie total gated at two or more. With one entry the section
total *is* that row's number and the header prints it already, so a footer repeating it is the
redundancy BF-98 set out to remove.

## A third shape neither report names

`groupDiaryEntries` **demotes a group holding exactly one log back to a `'log'`** (`diary-groups.ts`
`:86`). So a saved meal with one ingredient arrives as a loose row and is treated as one — correctly,
because that is what gets rendered and it states no macros. "One saved meal" is not reliably a
`'meal'` entry, which is why the gate follows what is rendered rather than what was logged.

## Verified

`diary-nested-meal.spec.ts` gains the one-loose-food case, as BF-120 asked (*"extend that spec to the
one-loose-item case, which is the shape now visibly wrong and is reproducible"*). **6 passed**,
including the three pre-existing tests that pin BF-98.

The assertion is `toHaveCount(1)` on each macro rather than `toBeVisible`, because the count fails on
**0** (this defect) *and* on **2** (BF-98's duplication), so one assertion holds both directions.
Mutation-tested: restoring the old count gate fails the new test and leaves the other three passing.

Ten unit cases on `mealFooter`, two of which guard the **premises** rather than the behaviour — that
`food-row.tsx` still renders no macros, and that `diary-meal-group.tsx` still does. If macros ever
return to the diary row this footer becomes the duplication it was written to avoid, and the guard
fails instead of the screen.

**BF-98's own source guard failed, and updating it was the point.** It pinned the literal
`{entries.length > 1 && <MealTotals`, which this change replaces — so it caught the edit exactly as
intended. It now asserts the mechanism (`mealFooter(entries.map(e => e.kind))`) plus the *behaviour*
BF-98 protects, by calling the helper: one `'meal'` entry gets no footer. A guard on an expression
goes stale when the expression is refactored; a guard on the outcome does not.

Gates: `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 68 of 68** · lint clean ·
`check-doc-links` OK · full unit suite **6,562 passed / 0 failed**.

## Two environment findings, both of which cost time

**`zero-data.setup.ts` fails only on a cold `.next`.** It dies with a React Server Components manifest
error (*"Could not find the module … global-error.js#default"*) on the first run after the build cache
is cleared, and passes in **8.9 s** on the next. It presents as a broken sign-in page — the form never
renders, so `getByRole('button', …)` finds nothing — which is nothing like the cause. Worth knowing
while diagnosing a red E2E (LB-55).

**A dev server that survives many branch checkouts serves 500s with empty bodies.** After ~10
checkouts in one session, `/api/nutrition/meal-types` answered `200` with **0 bytes**, then `500` with
an FK violation. Restarting it fixed the first symptom; the second was a session cookie minted against
a different local database.

## Not exercised

**Not verified on device.** The change is a rendering condition, so the e2e run at 412 dp is close to
the real check — but the report came from the S25 and that is where it should be confirmed. Recorded
in `projectOverview.md`.

## Left behind

**#875 merged while this branch was open**, so OR-101 reached the queue as a live entry and is
removed here on shipping — which is tidier than the alternative this entry first proposed (closing
#875 as superseded). The queue now records that the defect was filed twice, from two device checks,
and fixed once.

**RV-49 was re-laned to A** on picking it up. The entry says Lane B, but the whole fix is in
`lib/cache-groups.ts`, which CLAUDE.md's path list names as Lane A's *and* which the lane rule
independently sends there — it is reached from `app/api/coach/apply/`. The call site the entry also
names needs no change, so there is no Lane B half to ship first.

<a id="2026-09-06-bf-121-per-portion-macros"></a>

# 2026-09-06 — BF-121: the meal builder divided the calories and not the macros

**Branch:** `fix/bf-121-per-portion-macros` · **Lane B** · v1.436.27

The owner: *"for the meal creator when adding in serving size it would be good to see the macros per
serve."* His screenshot — *Protein Pancakes*, 4 portions — read
`BATCH 983 kcal · 52 P · 103 C · 39 F` and, at the far right, `246 / portion`.

## One row, two denominators, one of them labelled

`Math.round(batchKcal / servings)` produced the `246`. The three macros beside it printed raw batch
figures. So a reader dividing 52 P by 4 in their head was doing arithmetic the footer already did for
the number next to it.

**And the same meal's detail sheet reads the other way round**, which makes this a consistency bug
rather than a missing feature: `meal-detail-sheet.tsx` states outright that its *"macro columns are
per portion — that is what `Log this meal` writes."* The builder's own body text was the third voice:
*"Logging this meal… takes one portion — 246 kcal of the 983 below."*

## Both denominators, each labelled

Two lines — `Batch` and `Per portion` — rendered through **one** `MacroLine` component. Two
instances rather than two copies, because two copies drifting apart in format is the shape of the bug
being fixed.

**A second line, not six more numbers on the first.** That row already carried a label, a kcal figure
and three macros. The entry flags width as the real constraint and names the precedent: **BF-116**,
one screen over, where Home's header chips overflowed into the action buttons once a third chip
arrived. Squeezing is how that happened.

The batch total stays. It is what the ingredient list sums to and is the useful figure while a whole
tray is being entered, so replacing it would trade one confusion for another.

## Divide, then round

`perPortion` divides and the render rounds. Rounding first would make the footer disagree with the
diary row the log later writes, which is the number the owner actually compares against.

Dividing the batch sum is **exact**, not an approximation of the canonical path: `oneServingItems`
scales each ingredient's `quantityMultiplier` by `1 / servings`, and the totals are a linear sum of
those, so `batch / servings` and `sum(perPortionRows)` are the same real number. A test drives both
routes over the same fixture and compares them rather than asserting that from the comment.

`servings` of 0 or less falls back to the batch — the same guard `oneServingItems` uses.

## Verified

Ten unit cases: the owner's own figures (983/4 → 246 kcal, 13 P, 26 C, 10 F), that the calorie number
already on screen does not move, that dividing precedes rounding, the one-portion and
cannot-divide fallbacks, and the equality with `oneServingItems` above. Three source guards: the
inline `batchKcal / servings` is gone, both lines are labelled, and `MacroLine` is defined once.

`tsc` clean · lint clean · `pnpm check:rules` **Ran 68 of 68** · full unit suite green.

**CI's Build failed first, and the reason is worth carrying.** `npx tsc --noEmit` was clean and said
nothing, because `tsconfig.json` excludes `**/__tests__/**` — the whole point of LB-37 and of
`scripts/check-test-typecheck.js`, which runs inside the Build job. A **new** spec is checked
immediately rather than baselined, and this one had five errors in one hand-written `reduce`
callback. Local `next build` passed too, since the typecheck is a separate step after it.
**The gate to run before pushing a new test file is `node scripts/check-test-typecheck.js`, not
`tsc`** — and the fix was to type the fixture as `SavedMeal` rather than `any`, so a shape that
drifts from the real type fails here instead of passing by being untyped.

## The width question, answered — by a spec that already existed

**`e2e/edit-meal-batch-footer.spec.ts` covers this footer**, and it was asserting the old one-row
form: `${BATCH_KCAL / 2} / portion`. So this change broke a spec, and the repo-wide E2E redness would
have hidden that — which is the trap in treating a red job as uniformly not-mine.

Updating it turned the gap into coverage. It now runs at **412 × 915** and asserts, after scrolling
the ingredient list to its end, that **both** `Batch` and `Per portion` are `toBeInViewport()` along
with the Save button, that each macro letter appears exactly **twice** with the batch and per-portion
values both visible (`59 P` and `30 P`, `48 C` and `24 C`, `13 F` and `7 F`), and that the old
one-row form is gone. A second line that wrapped or pushed the Save button off screen fails it. **4
passed.**

That is the width check this entry warned about, and it is now permanent rather than a screenshot.

## What learning to drive this surface cost

`page.touchscreen.tap` on a bounding box inside a `toPass` loop (`empty-meal-library.spec.ts`), not
`.click()`; the harness and its stored session cookie belong to port **3100**
(`playwright.config.ts:23`), not 3000; a cold route needs 30–60 s, not the 8 s an ad-hoc script tends
to allow. All three were mistaken for application defects earlier today before being run down — one
published as a wrong cause and retracted. **The lesson is to reach for the existing spec rather than
an ad-hoc script**: the harness solves all three, and it did here.

## Not exercised

**Not verified on the device.** The emulated viewport is the layout check; the S25 is still the
canonical runtime, and the per-portion figures should be read against the detail sheet and a logged
portion in the diary there.

<a id="2026-09-06-deactivation-takes-effect"></a>

# Deactivation takes effect on the next request (PS-24)

**Branch:** `fix/ps24-inactive-session-refused` · **Lane:** A · **Domain:** platform
**Version:** 1.436.11

LA-58 (#884) put a 403 gate in the middleware so a deactivated account could not reach the API. The
checkpoint then found the gate reads a claim that never moves: `middleware.ts` builds its own
NextAuth instance from the Edge-only `auth.config.ts`, whose jwt callback has no refresh, so it
gates on whatever was stamped at sign-in — and re-signs it with a fresh 7-day expiry on every
request. The gate worked. The value did not.

## The fix is free, and that is the argument for its shape

`isActiveCheckedAt` lives only in the token, the token never persists, so `refreshIsActiveClaim`'s
once-a-day throttle never engages: **the users row is already re-read on every authenticated
request**, and the true value has been sitting in `session.isActive` with nothing consulting it.
`auth()` now consults it and returns `null` when the row says inactive.

That inverts the checkpoint's third finding. "Every authenticated request performs the once-per-day
read" was filed as a cost; it is now the mechanism, and making the stamp persist would restore
`ISACTIVE_RECHECK_MS` of staleness and quietly undo this. Pinned by a test that fails if the read
stops firing per request.

## Why `null` and not a session with the id removed

Stripping `user.id` closes the 81 routes that guard on `session?.user?.id` and leaves the other 132
reading `undefined` into a query — unscoped or malformed, which is a worse failure than the
staleness being fixed, and the exact class three PRs this week were spent removing. `null` is the
not-signed-in state every caller already handles, so this adds no new state to the app.

## Measured, both directions, on a real session

Signed in with credentials against local Postgres and kept the cookie:

| step | `GET /api/friends` | `GET /` |
|---|---|---|
| active (control) | `200` | app shell |
| `is_active=false`, **same cookie** | `401` ×3 | redirect to `/sign-in` |
| `is_active=true`, **same cookie** | `200` | — |

The response headers on that middle row also confirm the mechanism the entry describes:
`set-cookie: authjs.session-token=…; Expires: Sun, 13 Sep 2026`, the Edge middleware re-signing the
stale claim with a fresh week.

A 401 rather than 403 sends the caller to re-authenticate, which **terminates** rather than loops:
the `signIn` callback returns `/pending` for an inactive account and mints no session.

## A sub-claim of the entry is refuted

*"Same mechanism: an `isAdmin` revocation never reaches a live session."* False for every Node
consumer. `UPDATE users SET is_admin=true` and re-reading `/api/auth/session` on the same cookie
returned `isAdmin: true` with no re-sign-in — the same per-request refresh updates that claim too.
It is stale only in the Edge middleware, which never reads it. Corrected in the entry rather than
left to be inherited.

## Checked rather than assumed

`handlers` is deliberately not wrapped, so `/api/auth/session` still describes a deactivated
account. That would matter if the client believed it — this app has **zero** `useSession` and
`SessionProvider` call sites, so nothing consumes that endpoint; the shell takes its session as
props from a server component that redirects first.

## What is still owed

The middleware gates on a claim it cannot verify. PS-24 stays queued with both routes to closing it
written out: the **Node.js middleware runtime**, which is genuinely available in the pinned Next
15.5.22 (`loadNodeMiddleware` is gated on the functions-config manifest, not an `experimental` flag)
and would keep LA-58's 403 at a single authoritative enforcement point — at the cost of moving every
request in the app onto Node middleware and voiding `auth.config.ts`'s "no bcrypt, no pg" contract;
or accepting `auth()` as the authoritative point, which is where this PR leaves it.

That is not a queue-pass decision, which is why the entry records the options instead of taking one.

## Verification

- `tsc --noEmit` clean · **762 passed | 5 skipped (767 files), 6477 tests** · `pnpm check:rules`
  68 of 68
- New `lib/auth/__tests__/inactive-session-is-refused.test.ts` — 5 cases including fail-open on an
  absent claim, since `refreshIsActiveClaim` swallows a lookup failure so a database blip cannot
  sign everyone out
- Mutation-verified: removing the one-line refusal fails exactly the two tests that assert it
- The live before/after above, on `pnpm dev` against local Postgres

**Not exercised:** the APK. Same routes, but a deactivated account hitting the Custom Tab sign-in
flow has not been walked through on hardware — the entry carries `Verify: device` for it. No
production data was read; the probe user was created and deleted locally.

<a id="2026-09-06-deload-not-a-crash"></a>

# A deload is not a crash (PS-26)

**Branch:** `fix/ps26-deload-not-a-crash` · **Lane:** A · **Domain:** workouts
**Version:** 1.436.18

A deloaded exercise stores `estimated_1rm = 0` deliberately — deload work is submaximal and must not
read as a max. Q-298 taught `listPrevious1rm` that the 0 is a sentinel rather than a value. Nothing
taught the layer above it: `/api/weights-summary` took `estimated1rm` off the newest log whatever it
was, so an exercise whose last session was a deload published `0` beside a real
`previousEstimated1rm`, and the strength card rendered the difference — an empty bar and a drop equal
to the lifter's entire 1RM, in red. Live on **16 of the owner's 34 exercises**, every one flagged
deload.

Prescription was never affected: `resolveWorkingBasis` already skips deload rows, and the checkpoint
held that control. Nothing lifted was ever wrong; only what was drawn.

## The fix is a definition, not a guard

`listRecent1rm` returns the two most recent estimates that **are** estimates — same `> 0` filter
Q-298 established, `rn <= 2` instead of `rn = 2`. `listPrevious1rm` becomes a thin wrapper over it,
so there is one ranked query rather than two copies of the same CTE, and its two existing callers and
their tests are untouched.

That makes `estimated1rm` mean "the most recent real estimate" rather than "the newest row's value".
For an exercise that was not deloaded those are the same number. For one that was, the card now shows
the last real strength and a delta against the one before it — two comparable numbers — instead of a
sentinel subtracted from a real value.

## One predicate, because guarding half of it leaves the reported half

`strength-progress.ts` carries the same `> 0` check as defence, since the route is not the only thing
that could ever populate the field. The first version guarded `computeTrend` alone, which killed the
delta and left the bar at 0% — the empty bar being exactly what was reported. Both now read one
`currentOneRm(ex)` helper.

## The repository test did not catch the actual fix

Mutating the display guard failed a test. Mutating **the route line that is the fix** — back to
`log?.estimated1rm` — left every test green, because the repository test exercised `listRecent1rm`
directly and nothing asserted the route used it.

That gap is the reason `app/api/__tests__/weights-summary-deload.test.ts` exists: it drives `GET` for
a seeded exercise whose newest log is a deload and asserts the published number. Re-run against the
same mutation, it fails two cases by name — and its non-deload control stays **green**, which is what
distinguishes a control from a duplicate.

The transferable part: a repository test and a route test are not interchangeable, and the way to
find out which one you actually have is to mutate the line you changed rather than the line you
understand.

## Verification

- `tsc --noEmit` clean · **771 passed | 5 skipped (776 files), 6561 tests** · `pnpm check:rules`
  68 of 68 · lint 0 errors
- Four new repository cases: the PS-26 shape, a run of consecutive deloads, one real estimate with no
  previous, and an exercise that has only ever been deloaded (which publishes null, not 0)
- Three new route cases, mutation-verified as above
- `/api/weights-summary` loads and fails closed (401) on `pnpm dev`

**Not exercised:** the rendered card on device. This changes what the route publishes and what
`computeBarMetric` returns; the S25 rendering of the corrected values has not been looked at. No APK
is needed — server and shared code only, so a Railway deploy delivers it. No production data was
read; the 16-of-34 figure is the checkpoint's, not re-measured here.

<a id="2026-09-06-guard-repairs"></a>

# Seven guards that fired on the textbook shape and missed the common one (PS-34)

**Branch:** `fix/ps34-guard-repairs` · **Lane:** A · **Domain:** platform

Every one of these rules passed. That was the problem: each was written against one example and
pinned an incidental of it, so the shapes people actually write fell outside and the run reported
green over code it had never read.

## The correction that matters most

**PS-34 says "no live violation exists behind any of them today (re-scans with widened patterns:
0 hits)". That is wrong.** Widening the icon-button scan surfaced **eighteen** live accessibility
defects — icon-only controls announced by a screen reader as "button" and nothing else. Filed as
**LA-62** and frozen shrink-only, because every one is in Lane B's files.

The body-fat widening produced a finding too. That one *is* clean, but only after reading the
caller: `components/profile/goal-baseline.ts` documents its input as already corrected, and
`goals-section.tsx:276` does pass `displayBodyFat(...)`. Exempted with the verification recorded,
not with the comment quoted back.

So the entry's own claim held for five rules of seven. A re-scan that reports zero is worth exactly
as much as the pattern it re-scanned with.

## The seven

1. **PPL session names.** `grep -v 'push\|pull'` dropped any line containing lowercase push or
   pull — and ran *before* the real match. Since the first `grep` already requires the capitalised
   quoted literal, the filter could only ever produce false negatives. Harnessed: a line reading
   `{ name: "Push", sync: "pushMutations" }` was invisible to the old rule and is caught by the new
   one.
2. **Icon-button names.** `(\s[^>]*?)?>` ends the opening tag at the first `>`, which in
   `onClick={() => …}` is the arrow's. Replaced with a walk that tracks brace depth and string
   state. This is the one that had eighteen live findings behind it.
3. **Capacitor plugin proxies.** The import pattern pinned `'` and the return pattern required no
   semicolon. Either variant bound nothing and the file fell out at the "no bindings" guard —
   silently, since that looks exactly like a clean file.
4. **Doc-size ratchet.** `if (lines <= limit) continue` meant the ratchet only pointed one way:
   CLAUDE.md sat **429 lines** under baseline, so the most-read file in the repo could grow by more
   than half its own length with nothing complaining. `verdict()` now returns `'slack'` and three
   stale baselines are lowered to reality.
5. **Test-user UUID collisions.** `git ls-files '*.test.ts'` omits untracked files — so a test
   written this session is invisible to the local gate and only collides in CI, where nobody is
   looking — and omits `.tsx` entirely. Proved with a probe: 777 files before, 778 after.
6. **Vendored constants.** The skip guard covered the directory being *gone*. What happened is that
   it stayed, holding a README and no `.json`, so the skip never fired, the vendor set was empty,
   and the run printed `OK (0 vendor values, no inlined copies)` forever. Zero values is the same
   state as no directory and now gets the same answer.
7. **Body-fat correction.** Never walked `components/`, and `DERIVERS` omitted `calculateBaseline`
   — which `app/api/nutrition-goals/recommend` calls twice, so that route was never examined.

## `verdict()` is shared, and eight other checks call it

Adding `'slack'` changes a function eight other rules use. Audited: every one branches on
`'inherited'` and `'fail'` alone, so `'slack'` falls through to no action exactly as `'ok'` did —
and that is correct, because each already enforces shrink in its own second loop. Written into the
function's doc comment so nobody "finishes the job" and makes them double-report.

## What a baseline is for here

The icon-button baseline freezes debt, but the mutation run showed it does something better:
breaking the brace-aware walk makes files read as **zero** against a non-zero number, and the
shrink-only half fails for that. So the list pins the scanner's *reach*, not just the count. A guard
that goes blind again cannot pass.

## Verification

- `tsc --noEmit` clean · **772 passed | 5 skipped (777 files), 6577 tests** · `pnpm check:rules`
  **68 of 68**
- Three previously-missed shapes added to `plugin-proxy-scan.test.ts`; the `verdict` test updated
  for `'slack'` with the old expectation's reason recorded rather than flipped
- Mutation-verified: reverting the import quoting fails two proxy cases by name; removing `'slack'`
  fails two verdict cases; breaking the brace walk fails the icon-button check
- The PPL and UUID repairs were harnessed against a violating snippet — the only way to show a
  widened grep catches what the old one missed

**Not exercised:** nothing runtime. These are CI scripts and one workflow file; no application code
changed, so there is nothing to see on device and no APK involved.

<a id="2026-09-06-la-59-reorder-status"></a>

# 2026-09-06 — LA-59: the meal-type reorder reads the status it is given

**Branch:** `fix/la-59-reorder-status` · **Lane B** · v1.436.20

`handleDragEnd` in `meal-type-manager.tsx` fired the reorder as:

```ts
fetch(...).then(() => invalidateMealTypes()).catch(() => toast.error('Failed to save order'))
```

**A `fetch` promise does not reject on a 4xx.** So the `.then` ran for every response the server
sent — including a refusal — and the `.catch` only ever saw a transport failure. RV-48 gave this
route a 404 for a reorder it declines to apply; nothing on this surface read it.

## What shipped

`await` + `if (!res.ok) throw`, then **a refetch, not just a toast**. That distinction is the entry's
and it is the substance of the fix: a 404 here means the list the drag was computed from is stale — a
meal type deleted on another device is the realistic route — so re-reading the list is what resolves
it. Restoring the previous *local* order would only put back a different wrong one, and a toast alone
leaves the screen showing an order the server rejected.

`saveEdit` in the same file is the pattern copied: optimistic, `if (!res.ok) throw`, recover on
failure. This was the last of the four surfaces RV-45/RV-47/RV-48 touched; the two admin ones and the
exercise manager already checked. The two Oura `PATCH` callers are deliberately fire-and-forget and
are untouched.

## Verified

**The premise, live against the dev server** — this is what the old code was swallowing:

| request | response |
|---|---|
| reorder with the six real ids, reversed | **200** |
| reorder with one id replaced by a stale UUID | **404** `{"error":"Meal type not found"}` |
| restore the original order | **200** |

**Three source guards**, mutation-tested — removing the `if (!res.ok) throw` fails two of them. They
pin the three properties separately: no bare `.then`/`.catch` on a fetch, an `if (!res.ok)` for every
`await fetch` in the file, and `invalidateMealTypes().then(load)` inside the drag handler's catch.

`tsc` clean · lint clean · `pnpm check:rules` **Ran 68 of 68** · full unit suite green.

## Not exercised — and this is the honest gap

**The toast and the refetch were never watched happening.** What is proven is that the route returns
the 404 and that the code now reads it; what is not proven is the two things the user would see.

**⚠ The cause first written here was wrong.** It said the settings sheet did not render, which reads
as a defect in the manager. It is not one. The ad-hoc scripts waited 8 seconds for a page the dev
server had not finished compiling — the e2e specs use 30–60 s for the same page — and one of them
pointed at port 3000 while the harness, and the session cookie in `e2e/.auth/`, belong to **3100**
(`playwright.config.ts:23`). Given a long enough wait on the right port the page renders in full.
Recording the wrong cause is worse than recording none, because the next session goes looking for a
bug that was never there.

**Closing that properly needs a `@dnd-kit` drag simulated in Playwright** with the PATCH stubbed to
404 — `empty-meal-library.spec.ts` has the route-stubbing shape (`serviceWorkers: 'block'`, a
per-page `page.route` with `route.fallback()` for the methods it does not want), and it taps a
coordinate via `page.touchscreen.tap` inside a `toPass` loop rather than calling `.click()`, which is
the third thing an ad-hoc script gets wrong on this surface. That is more work
than the twelve-line fix and is worth doing; it is not worth blocking the fix on. Recorded as a
Known-Issues row rather than left implied.

**Not verified on device**, for the same reason as every UI change this session.

<a id="2026-09-07-bf-127-bodyweight-baseline-unit"></a>

# 2026-09-07 — BF-127: the app told him to load 82.5 kg on a pull-up

**Branch:** `fix/bf-127-bodyweight-baseline-unit` · **Lane B** · v1.436.28

The owner, on a Pull session: *"pull up = weight"*. The baseline banner listed **Pull-Up — 82.5 kg**
under *"Suggested starting weights (≈70% of PR)"*.

## The number was never kilograms

`personal_records` holds `Pull-Up estimated_1rm = 118.25`, and `exercise_library.exercise_type` is
`bodyweight`. A bodyweight 1RM is computed against **`BW_REF = 100`** — a fixed stand-in for the
lifter's body weight, so the value is an index driven by reps and added load. The owner weighs
**70.65 kg**. Seventy percent of 118.25 is 70% of nothing physical.

**The repo already forbade this**, in a comment written after Q-12 found the same class:

> *"bodyweight strength is measured in REPS, never kilograms … Rendering it as kg is what let a
> change of the BW_REF constant read as a +40% strength gain … Every surface that shows a stored 1RM
> resolves its unit here rather than hardcoding 'kg'."*

`displayOneRm()` / `oneRmUnit()` are that resolver. The banner called neither — while the exercise
card **six lines below it** rendered `5 × 0kg · 5 RM` correctly for the same exercise.

## What shipped

`components/workout/baseline-hints.ts` returns a union — `load` (kg), `bodyweight` (with the rep max
when known), or `unknown` — and the banner renders each case instead of formatting one number three
ways. The heading no longer promises a weight for every row: *"Suggested starting point"*, with the
70% basis moved into the explanatory paragraph where it is true only of weighted movements.

**A bodyweight row offers no number to load and does not invent one.** 70% of a rep max is not a
prescription — reps do not scale that way — so it says `Bodyweight` and reports the rep max beside
it as the reference an AMRAP is measured against.

## The entry's stated fix does not work, and the reason is worth keeping

BF-127 says *"`signals.exercises[]` already carries `exerciseType` (signals.ts:277); the banner's
`.map()` simply does not read it."* That line is real, and it is on the **wrong shape**.

There are two exercise signals in that file. `ExerciseSignal` (`:25`) carries `exerciseType` and
exists **for the LLM prompt** — its own comment says so (Q-19b). `CardExerciseSignal` (`:116`) is
what reaches the client, and it has six fields, none of them the type. Threading it from there would
have meant editing `packages/shared/**`, which is **Lane A's**.

It was not needed. The component's `exercises` prop, from workout-data, already carries
`exerciseType` — it is the source the card below the banner uses — so the fix joins on
`sessionExerciseId` and stays entirely in Lane B. Keyed by id rather than name, because one session
can hold two exercises with the same name. A separate map from the existing `exerciseTypeById` is
needed because that one is only populated when a prescription exists, and the baseline banner runs
before there is one.

## The sibling sweep the entry asked for, and its result

*"Any other surface multiplying or formatting `current1rm`/`estimated_1rm` without going through
`oneRmUnit`."* Five candidates, and **the banner was the only unguarded one**:

| site | verdict |
|---|---|
| `active-workout-screen.tsx:288` | guarded — `isBodyweight ? displayOneRm(…) : "… kg"` |
| `active-workout-screen.tsx:345` | guarded — the whole block is `!isBodyweight &&` |
| `active-workout-screen.tsx:354` | guarded — `isBodyweight ? null :` above it |
| `workout-screen.tsx:76,80` | guarded — `computeInitialWeights` returns zeros for bodyweight |
| `exercise-stats-sheet.tsx:83` | not a display — `workingWeight` feeds `calc1RM`, and the bodyweight branch handles `BW_REF` explicitly |

Q-12 built the resolver and this is the one caller that escaped it. The sweep is worth recording as a
result rather than a to-do: nothing else needs changing.

## Verified

Twelve unit cases, including the owner's live figures — `baselineHint(118.25, 'bodyweight')` produces
no `82.5` anywhere in its output — that a weighted row's number is unchanged (92.5 → 65 kg), the
no-history and unknown-type fallbacks, and three source guards on the banner and its call site.

Two cases guard the **premise**: that `BW_REF` is still 100 (if it ever becomes the real body weight,
the basis of this fix changes and the guard fails), and that the shared resolver still answers `RM`
for bodyweight and `kg` otherwise.

`tsc` clean · lint clean (the one warning in `components/workout/` is pre-existing, in
`exercise-stats-sheet.tsx`) · `pnpm check:rules` **Ran 68 of 68** · `check-test-typecheck` at
baseline · full unit suite green.

## Not exercised

**Not seen on a screen.** The banner renders only in the `baseline` phase with
`baselineComplete === false`, which the seeded dev user is not in; reaching it means driving a
program into its first session. The unit logic is unit-tested against the owner's own stored figures
and the render path is pinned by source guard.

**Not verified on device.** The owner sees this on the S25, on a real Pull session — the row should
read `Bodyweight` with his rep max beside it, and no kilograms anywhere on it.

<a id="2026-09-07-collection-ladder"></a>

# The collection ladder, and a rest-day allowance the app already knew (BF-122a)

**Branch:** `feat/bf122a-collection-ladder` · **Lane:** A · **Domain:** app-shell / platform
**Version:** 1.436.25

The engine half of the cat collection: a pure fold over day series the app already stores, plus the
decay window the owner asked for. No migration, no table, no route.

## ⚠ This changes an existing streak

`computeStreak(dates, tz, maxRestGap)` had `1` hardcoded at two call sites — `lib/achievements.ts`
and `app/api/friends/leaderboard` — for exactly the question the new helper answers. Per **One
Formula, One Place** they now read it off the schedule.

**That moves the workout streak for anyone not on a rotation.** A user training Mon+Tue is two
sessions a week with a five-day hole in it, and was following their plan for every one of those days
while a literal `1` broke their streak weekly. The fallback is 1 when there is no schedule, so an
unscheduled user is unaffected. This is the only behaviour change in the PR and the entry asked for
it to be said out loud.

The leaderboard needed each user's schedule; it already batches every other query with
`inArray(userId, allIds)`, so this is **one more batched query**, not an N+1 over the friends list.

## Why the count helper next door is the wrong input

`getScheduledSessionsPerWeek` collapses both schedule shapes to a number for Home's "This Week X/Y"
chip. **A count cannot see where the hole is.** Mon+Tue and Mon+Thu are both two a week; the first
tolerates five rest days and the second three. `maxCompliantRestGap` sits beside it and the count is
left alone.

The wrap-around term is the part a pairwise scan of a sorted list misses: Sat+Sun's real hole is
Sun→Sat, which never appears as a difference between adjacent entries.

## The fold

`replayCollection` walks distinct days: each spawns a bottom-tier item, merges settle to a **fixed
point** (five slimes making a scout can complete a tank in the same step — one pass would leave the
collection a merge behind its own rule), and each gap beyond the allowance decays once per day.

Two owner rules, both in the code and both pinned:

- **Smallest first.** Loose stock is the buffer, so a missed day costs the thing you were about to
  merge.
- **A big item breaks into its components, never vanishes.** Losing a scout costs the merge, not the
  five workouts under it.

Days the app itself recommended as rest are excused, so a deload week decays nothing.

## The test that did not test what it claimed

"Takes the smallest item first" **passed with the rule reversed.** The gap in my fixture was followed
by a spawn, and the spawn re-merged what the decay had broken apart — so smallest-first and
largest-first both landed on `[1, 1, 0]`.

Rewritten with a **trailing** gap so nothing follows the decay: smallest-first leaves `[0, 1, 0]`,
largest-first leaves `[5, 0, 0]`. Same total, different truth about what was lost. It now fails by
name under the mutation.

That is the second time today the same lesson landed — mutate the line you changed, not the line you
understand.

## Two of my own expectations were wrong, not the code

`Mon+Thu` is 3 rest days, not 2 (Fri/Sat/Sun is wider than Tue/Wed). And a decay that cannot happen
is not counted, so a two-decay assertion on a collection holding one item reads 1. Both were my
arithmetic; both corrected in the test rather than the source.

## A rule matched my comment

`No UTC date slicing` flagged a comment explaining that the module deliberately does **not** use the
banned expression. Third instance of that shape today — filed as **LA-64**, with the note that the
costly direction is the false *negative* (a scan reporting clean over code it never read, which is
how PS-34's icon-button rule stayed green against a fully reverted fix), not this loud false
positive.

## Verification

- `tsc --noEmit` clean · **779 passed | 5 skipped (784 files), 6640 tests** · `pnpm check:rules`
  **68 of 68**
- 8 cases on the gap helper, 15 on the fold
- **Mutation-verified:** deleting a big item instead of breaking it down fails two by name;
  reversing smallest-first fails the rewritten one

**Not exercised:** nothing renders this yet — BF-122b is the widget, the models and the in-app
explanation. The streak change is server-side and reaches the device through a normal deploy; no APK.
No production data was read, and the 120-day calibration in the entry is the owner's measurement,
not re-run here.

<a id="2026-09-07-feat-bf-122b-cat-collection-surface"></a>

# 2026-09-07 — the cat collection has a surface, and glyphs instead of art (BF-122b)

**Branch:** `feat/bf-122b-collection-surface` · **Lane B** · v1.437.0

## What shipped

BF-122a built the fold and deliberately no route; LB-60 (#933) gave it one. This is the surface:
all four of the entry's deliverables, with the fourth — the art — shipped as glyphs on purpose.

- **`components/home/collection-summary.ts`** — the decisions, as pure functions, because this
  project's vitest is `environment: 'node'` and a `.tsx` cannot be imported. 18 tests.
- **`components/home/collection-card.tsx`** — the home widget, a tenth `CardWidgetKey`, off by
  default (`DEFAULT_CARD_WIDGETS` is empty) and toggled in More → Home Widgets.
- **`app/collection/`** — the full collection and the rules, in plain words.
- **`components/home/collection-sprites.ts`** — tier → glyph, isolated so replacing it is one file.
- **`e2e/collection-screen.spec.ts`** — read-only, and checked against a broken heading to confirm
  it discriminates.

## The one decision worth recording: nearest merge is measured in DAYS

The card shows the ladder nearest its next merge. The obvious ranking is how full a rung looks, and
it is wrong. A ladder holding 3 of the 4 scouts a Tank costs is 75% of the way there — but each
remaining scout is another 5 workouts, while 3 of the 5 slimes a scout costs is **2 workouts**.
Ranking on fraction picks the Tank and then has to tell the user *"1 more cat scout"*, a unit nobody
can spend a day earning.

Ranking on faucet days — `(need − have)` multiplied up through every rung below — gives one number,
always a count of the thing the user actually does, comparable across tiers and across ladders.

A consequence found while testing rather than while designing: **on these three ladders a higher
rung can only ever TIE the bottom one, never beat it**, because one more of tier N costs a full merge
of tier N−1. So the tie-break — same effort, higher prize — is the entire mechanism by which a Tank
is ever offered rather than a courtesy. There is a test pinning that, which is where it will show if
a new ladder breaks the property.

I got this wrong twice before getting it right: the first implementation took the lowest short rung
and justified it in a comment, and the first test asserted the opposite. Both are gone.

## The art, deferred rather than dropped

The entry's brief is one cat silhouette with props by tier, ~12 drawn assets, and it calls that art
*"the only unrecoverable spend"*. Nothing here spends it: `collection-sprites.ts` maps each tier to
an emoji, and swapping to images changes that file and the two components reading it.

That is the order the entry's own reasoning implies — the owner sees the mechanic working, then
decides whether the assets are worth drawing. Filed as **BF-126**, `Gate: owner`. The binding
constraint is unchanged and cuts against drawing: they must read at ~32 px, which is what an emoji
is designed for and a detailed sprite is not.

## Found and fixed in passing: `CardWidgetKey` lived in three places

`lib/home/home-prefs.ts`, `components/home/home-card-widget.tsx` and
`components/more/home-widgets-section.tsx` each declared the same union, so adding a slot meant
editing three lists and a missed one fails silently as a card that can never be switched on. The
other two now import the canonical one (type-only, so the cycle with `home-prefs` is erased). The
compiler then found both `Record<CardWidgetKey, …>` maps that needed the new key, which is the point.

## Verified

- 412 dp harness: the card renders **380×135** under the week strip — `Cat ranger · 4 more days with
  steps · ●●●○○○○` — and the collection screen lists all three ladders with the rules below.
- `pnpm test` **6,845 passed** · `pnpm build` clean · `pnpm lint` 0 errors ·
  `check-test-typecheck` at baseline · `pnpm check:rules` **Ran 69 of 69**.
- Two copy defects the screenshot caught and the tests would not have: the card's line repeated the
  title above it, and the decay note summed all three ladders into a lifetime total. Both fixed.

## Not verified, and one honest limit

**Not run on device.** No APK needed. The device check the entry names is owed and specific: glyph
legibility at ~32 px, and whether the card pushes the fold with several widgets enabled.

**The decay note is a LIFETIME count.** `replayCollection` reports how many decays fired across all
history and carries no recency, so the card says "11 have wandered off over long gaps" and that
number only ever grows. Wording it as anything more recent would be a claim the engine cannot
support. If it becomes noise, the fix is in the engine, not the copy.

## Deliberately not built

The weekly encounter. The entry parks it as phase two and says outright: do not build a battle
system.

<a id="2026-09-07-fix-bf-123-tap-floor-sweep"></a>

# 2026-09-07 — the 48 px tap floor's opt-out, finally swept (BF-123)

**Branch:** `fix/bf-123-tap-floor-sweep` · **Lane B**

## What the owner saw

A screenshot of the program editor sheet — *"noting this UI is really bad and needs adjustment"* — in
which the muscle chips render as large filled circles with a 10 px label floating in the middle.

## What it was

`app/globals.css` sets `button, [role="button"] { min-height: 48px; min-width: 48px }` under 640 px.
Every control that declares a smaller box loses to it: a `rounded-full` chip asking for `h-5 px-1.5`
comes out as a 48×48 circle, and a short label (`lats`) also loses the min-width, so it is perfectly
round. `components/ui/switch.tsx` has carried this diagnosis verbatim since the floor shipped, along
with the fix — `tap-dense` plus an invisible touch box. CLAUDE.md's **No global element-selector
styling** rule required the sweep in the same PR as the rule. It never happened; this entry is that
sweep, arriving as an owner bug report rather than an audit.

## What shipped

**48 call sites across 24 files** now carry `tap-dense` plus a restored touch area — `.tap-target-44`
everywhere except the icon-picker grid, whose 5 columns sit on a 36 px pitch and take `.tap-target-dot`
so the box extends only in the unconstrained axis. Six wrapped chip rows also grew their real ink
(`py-0.5` → `py-1.5`, the muscle chips `h-5` → `h-7`) so the 44 px box overflows by ~2 px into a
neighbour rather than ~10.

Measured in the harness at 412 dp, after: the muscle chips render **47×28 / 89×28** where they were
48×48, the time-budget steppers **24×24**, the exercise icon buttons **38×34**.

**The sweep found more than the entry estimated — 48 product sites, not ~20.** The extra are
padding-sized pills (`px-3 py-1.5 text-xs`) that the floor stretches from 28 px to 48 px: the same
defect, less dramatic because they are wide enough that only the height is wrong. Deliberately **not**
touched, with reasons: `components/more/trophy-case.tsx` (`aspect-square`, height comes from the grid),
`components/workout-builder/goal-spectrum.tsx` and `builder-review.tsx:660` (full-width option card and
a send button — 48 px is right for both), `config-screen.tsx:629/639` (two-line cards, already taller
than the floor), everything under `components/admin/` and `components/oura-ble/` (debug consoles), and
every site that already declares its own `min-h-*`, which is a floor its author chose.

## Found in passing, measured, and fixed: `.tap-target-44` was overriding `absolute`

`.tap-target-44 { position: relative }` sat **unlayered** in `globals.css`. Unlayered CSS beats every
cascade layer regardless of specificity, so it beat Tailwind's own `.absolute` utility — and
`components/more/profile-tab.tsx:217` combines the two to pin the avatar edit badge to the picture's
corner. Measured on `/more` at 412 dp: `getComputedStyle(el).position` read **`relative`** and the
badge sat at **x=162**, flowed inline below the avatar. Moving the declaration into `@layer components`
(the `::before` boxes stay unlayered, nothing conflicts) makes the utilities layer win: **`absolute`**,
**x=226**. Both readings are from the running app, not the stylesheet.

## The guard

`components/__tests__/carousel-dot-hit-area.test.ts` gained a source guard: **no `tap-dense` control
without a restored touch area**, across every `.tsx` under `app/`, `components/`, `lib/`. Three sites
are listed with the reason they are exempt — two inline underlined text buttons (the case the opt-out
was written for) and the Deload pill, which grew its ink instead because Q-176 measured that a box
there would swallow the stats button's taps. Shrink-only. A second test pins the `@layer components`
placement with the measurement above.

`e2e/touch-target-size.spec.ts` passes on all five screens — it honours `.tap-target-44` /
`.tap-target-dot` by `classList`, which is why the sweep uses those classes rather than the `before:`
utilities `switch.tsx` uses.

## Not verified

**Not run on device.** This is CSS and class changes reaching the WebView through a Railway deploy, no
APK — but 41 of the 48 sites are on screens the e2e gate does not open (sheets, pickers, the config
editor), so their rendering is verified in the harness at 412 dp rather than on the S25.

## What this unblocks

**BF-124** (`Needs: BF-123`) is now startable, and the screenshot above shows both of its symptoms
plainly: the *Main Compound · Secondary Compound · Accessory* row still cannot fit — `Accessory` is
clipped at the right edge — and the selected pill is a white slab that reads as disabled.

<a id="2026-09-07-fix-bf-124-125-role-vocabulary"></a>

# 2026-09-07 — one word per role, and the review screen can finally set it (BF-124, BF-125)

**Branch:** `fix/bf-124-125-role-vocabulary` · **Lane B** · shipped together because each entry says
to: they disagree about the same three words, and settling it in one place is most of both fixes.

## What the owner saw

Two reports off the same generated program. *"why does one of these have 2 compounds?"* then *"so how
would i change its badge?"* — and, from the BF-123 screenshot, a role row on the program editor sheet
with `Accessory` clipped at the right edge and the selected pill rendering as a white slab.

## The vocabulary

`components/workout/exercise-role-labels.ts` (new) owns the three words. Review said **Main /
Compound / Accessory**; the editor said **Main Compound / Secondary Compound / Accessory**. Same
three enum values, two wordings, and a user meets both doing one thing — spot a bad role on review,
go to the editor to change it.

The short set wins, and neither of the two existing sets was it: **Main / Secondary / Accessory**.
*Main* and *Compound* are not parallel — a main lift **is** a compound, so the old review labels read
as two different axes rather than a ranking — and the long set is what overflowed the editor's row.
The type stays the canonical `ExerciseRole` from `packages/shared/src/types/program.ts`; this module
names the words the user reads, not the values the app stores.

## BF-125 — the role is editable where it is visible

`builder-review.tsx` rendered the badge read-only. It is now a button that discloses the three
options inline, copying the file's existing `swapOpen` disclosure shape rather than adding a new
one — `roleOpen` beside it, `setExerciseRole` beside `swapExercise`.

Only `exerciseRole` moves. The progression style is derived from the role server-side at save
(`generate-program/route.ts:428` overrides the model's choice for `primary`/`secondary`), which is
exactly what the editor's own role control relies on, so the review screen does not need to — and
must not — set a style of its own.

## BF-124 — the row fits, and the chosen option looks chosen

Measured against the tokens rather than the screenshot: `--primary` is `oklch(0.922 0 0)` in dark —
near-white, near-black text. `bg-primary text-primary-foreground` on a chip therefore paints a white
slab that reads as disabled beside its own `bg-muted` siblings. Every other chosen state on this
sheet uses `bg-brand`, which is why the schedule-mode buttons read correctly and this one did not.
Now `bg-brand text-brand-foreground border-brand font-semibold`, plus `aria-pressed`, which the row
never had.

`components/config/phase-editor.tsx:191` carried the identical pair for its phase-type chips —
same defect, same sheet, fixed in the same PR per the sibling-surface rule. No `bg-primary
text-primary-foreground` selected state remains outside `ui/button.tsx`, `ui/input.tsx` and the
chat bubble, where it is correct.

The row is `flex flex-wrap gap-1.5` and the `Role` caption moved onto its own line instead of
sharing the chips' flex line. **Measured at 412 dp after: nothing is clipped** — `Main` 55×30,
`Secondary` 86×30, `Accessory` 82×30, `aria-pressed` correct on each. It still wraps `Accessory` to
a second line inside the deeply-indented exercise card, which is what the entry asked for
(*"It needs to wrap, or the labels need to be short"*) rather than a residual bug, but it is two
lines, not one.

## The guard

`components/workout/__tests__/exercise-role-labels.test.ts` pins the three words and the fallback,
and holds the single-source rule by **search** rather than by a file list — a third screen showing
roles is exactly what the guard is for and would not be in any list written today. A decoy file
was planted to confirm the search actually matches a re-declaration; it did.

Two source guards cover BF-124, because both halves are layout and token choices with no runtime
behaviour to assert and this project's vitest is `environment: 'node'`, so a `.tsx` cannot be
rendered.

## Not verified

**Not run on device.** No APK — these are component changes reaching the WebView through Railway.
The editor's role row was opened and measured in the Playwright harness at 412 dp. **The review
screen's new control was not**: reaching it needs a generated program, which is a live Gemini call
the harness does not make. Its logic is the file's own disclosure pattern and its state setter
mirrors `swapExercise`, both unchanged in shape — but the rendering is unexercised, which is the
weaker half of this PR's evidence and the first thing to look at on device.

## Found, not fixed

`components/ui/switch.tsx:16` marks its on state with `data-[state=checked]:bg-primary` — the same
near-white token, so every Radix switch in the app is white-when-on for the same reason the role
pill was. It is a shadcn default used app-wide and recolouring it is a far wider visual change than
either entry asks for. Filed as **LB-61** rather than folded in.

<a id="2026-09-07-fix-oura-nonwear-overwrite"></a>

## 2026-09-07 — Wear time: a complete day overwritten by the sliver the rollup window left of it (PS-30)

**Branch:** `fix/oura-nonwear-overwrite` · **Lane A**

### What was wrong

`oura_daily.non_wear_time_sec` recorded the ring worn 15–90 minutes on **22 consecutive days**
(2026-08-14 → 09-04) that each carry a 7–10 h scored night with HRV — physically impossible. The
backlog entry (PS-30) filed the mechanism as *not established*, and two of its details were off:
the span is 22 days ending **09-04**, not 20 ending 09-02, and the column lives in `oura_daily`,
not `oura_daily_summary`.

### The mechanism

`wornBinsByDay` is built only from the raw frames inside the run's window, but a wear row is
written for **every** day that has at least one bin — including the day the window floor lands
part-way through. An incremental run's floor is `effectiveSinceDs − 3 days`, which is a wall-clock
instant, not a midnight, so that day contributes only the frames after it. Because the floor
advances monotonically, that partial write is also the **last** write the day ever receives.

Three pieces of production evidence pin it, none of which needed a code read:

- Every bad day's `synced_at` is **exactly the 3-day margin after its own date** — 08-14 last
  written 08-17T20:03Z, 09-04 last written 09-07T14:20Z, and so on for all 22.
- The stored non-wear values are all `86400 − n × 900` for **n = 1…6**: whole 15-min bins, 15 to
  90 minutes, which is the sliver between a late-evening floor and midnight.
- The two edges are the same fact, not two. On the left, 08-05→08-13 all share one `synced_at`
  (08-17T07:50:13.919Z) — a single full pass that repaired them and then left them permanently
  outside the 3-day window. On the right, 09-05→09-07 share 09-07T16:38:32.683Z: they are simply
  **not yet three days old**. The fault had not stopped; 09-05 was one run away from being
  clobbered like the rest.

### What shipped

`lib/oura-ble/rollup/run.ts` drops the day containing `rollupCutoffDs` from `wearRows`, unless the
cutoff falls exactly on that day's local midnight (where the day *is* fully covered and the run may
be the only one able to write it). Nothing else is dropped: earlier days have no frames in the
window, and the two runs before this one already wrote the floor day in full, so the day keeps a
complete value rather than losing one.

`lib/data/postgres/__tests__/oura-ble-wear-window-floor.test.ts` seeds an unbroken on-finger frame
per 15-min bin across four fixed days and runs the rollup with a floor at 22:00 on the middle day.

### Verification

- New test: 3/3 against local Postgres. **Mutation-checked both branches** — removing the filter
  fails with `expected 79200 to be +0`, which is the production signature exactly (8 bins = 2 h);
  removing the midnight exemption fails the third case with `"no row"`.
- Neighbouring rollup suites (incremental-window, sleep-fallback, aggregate, daily-summary,
  step-rollup, spo2-daykeying): 28 passed, 1 skipped.
- `pnpm check:rules` — **Ran 68 of 68**, all passed. `tsc --noEmit` clean, ESLint clean.

**Not exercised:** on-device. This is server-side rollup code reached through Railway, so no APK is
involved, but the fix's effect is only observable on the next real BLE ingest — nothing here was run
against the ring. The corrective for the 22 stale days was **not** shipped (below).

### Deliberately not done

The 22 days stay wrong. No incremental window reaches back that far again, so only a **fullHistory**
Redecode rewrites them — and that needs an admin session, which this environment does not have. The
alternative, a migration nulling the column for those dates, is data-dropping under the standing
rule and would leave a gap where a Redecode restores the real numbers. Filed as **LA-68**,
`Gate: owner`, with the exact console action.

### Docs

`docs/oura-ble-operations.md` §1 gains failure row **I29**. Backlog: PS-30 removed, LA-68 added.
`projectOverview.md` carries a Known-Issues row for the stale span until the owner's Redecode.

**Version:** 1.436.36 (patch).
