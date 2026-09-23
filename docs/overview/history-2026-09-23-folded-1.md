# Session journal — batch folded 2026-09-23

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-22-lane-a-rv99-score-band-tokens"></a>

# 2026-09-22 — one good/warning/bad palette, and the silent bail that was guarding it

**Branch:** `lane-a/rv99-score-band-theme-tokens` · **Agent:** Implementation (Lane A) ·
**Code + docs.** Half of RV-99; the rest stays queued with corrected numbers.

RV-99 found the same good/warning/bad triad implemented twice: `score-band.ts` returned raw hex,
while `recovery-band.ts` and `body-battery-band.ts` returned theme tokens for the identical concept.
Only the token half can follow the theme, so the tokens win.

## The premise is right, and I checked it rather than repeating it

Resolved in dark, these are different colours rather than shades:

| | hex | token | Δ contrast vs dark bg |
|---|---|---|---|
| green | `rgb(34,197,94)` | `rgb(86,238,102)` | 8.68 → 13.02 |
| amber | `rgb(245,158,11)` | `rgb(239,175,0)` | 9.21 → 10.18 |
| red | `rgb(239,68,68)` | `rgb(255,100,103)` | 5.26 → 6.85 |

Computed by converting the `oklch()` tokens in `globals.css` to sRGB. The entry quoted 4.93 and 6.42
for the reds against my 5.26 and 6.85 — a different background assumption, same ~1.6:1 gap, so its
conclusion stands.

## The hazard it named is not the hazard that was there

The entry warned that Chart.js paints on a canvas, which resolves no `var()` and silently fills
black, and said callers must go through `resolveColor()`. I checked all eleven `scoreBand` consumers:
**every one is DOM or SVG.** No `resolveColor()` call was needed anywhere.

**The real blocker was `accentCardStyle`**, which the entry does not mention. It takes a hex, slices
it into components, and for anything not starting with `#` returned a bare muted background — no
gradient, no border, no error. `health-sections.tsx` feeds `scoreBand`'s colour straight into it for
the HRV-baseline card, so moving to tokens would have removed that card's tint silently. It now has
a `color-mix` path.

**The hex branch is deliberately untouched.** `rgba()` built from parsed components and
`color-mix(in oklch, …)` are not the same colour, and about thirty cards render through that branch;
converting them all would have been an unrequested repaint. `transparent` keeps its bail too — it is
the card picker's "no accent" choice, not a colour, and mixing it paints a grey wash exactly where
the user asked for nothing.

## What is left, and why it did not all ship

**The entry welds two jobs together and mis-sizes the second.** The `scoreBand` consumer set is 11
files. The hardcoded-hex population is **183 occurrences across 68 files** — not the entry's "173
across ~25". That 2.7× difference in file count is the whole reason one half shipped this afternoon
and the other is still queued.

The remaining hex sites are not interchangeable, which is the entry's own "do not migrate blind"
warning re-confirmed by measurement rather than inherited. Four shared modules have genuine band
semantics and are Lane A's (`acwr.ts`, `calorie-balance.ts`, `strength-progress.ts`,
`day-checkin.ts`), each needing its own consumer check. Four more are legitimate one-offs that must
keep their hex: `rarity-colors.ts`, `hr-zones.ts`'s deliberate blue→red ramp, `macro-colors.ts`
(protein's identity colour) and `home-prefs.ts` (per-metric identity colours). The check script
banning the three literals comes last, after both halves — adding it now would fail CI on 183 sites
that are legitimate until migrated.

## Verification

- 3 new `accentCardStyle` cases, `score-band.test.ts` rewritten to assert against the exported
  constants rather than literals, so it cannot pin a stale value again.
- **4 mutations caught, 1 equivalent control** (renaming the local parameter — correctly not
  caught). Two of the four target the branch that silently bailed.
- Two existing tests pinned the old hex and were updated to the constants, not weakened.
- `pnpm check:rules` **75 of 75** · `tsc --noEmit` clean · lint 0 errors · test-typecheck none above
  baseline · full suite **9,325 passed, 87 skipped**.

**Colours are the one thing a test cannot confirm, and none of this was seen rendered.** Every
assertion here is on the string a function returns; that the resulting cards look right — and in
particular that the `color-mix` gradient reads like the `rgba()` one beside it — was not observed in
a browser or on the device. Samsung WebView was not exercised, though `color-mix(in oklch)` was
already used by both branches of this function before the change.

<a id="2026-09-22-lane-a-tn57-untouched-scales-are-not-answers"></a>

# 2026-09-22 — Lane A · TN-57: an untouched scale is not an answer

Tuning filed this answering the owner's *"what is your suggestion to get better tuning and have it be
more accurate"*. It is the answer: every calibration to date was fitted partly to a number nobody
gave.

## The defect

The morning check-in sheet seeds `perceivedRecovery` and `sleepQualityFeel` from a neutral constant,
tracks whether the lifter actually moved each one, and posts both the value and the flag. The route
stores both. **The row has always been honest. Every reader was not.**

The schema said what to do about it when the columns were added (Q-113): *"a calibration query must
filter on these before trusting perceivedRecovery/sleepQualityFeel as real self-report."* Nothing
ever did.

Re-measured on production 2026-09-22, the owner's rows (`claude_ro` is row-scoped), 97 morning
check-ins since 2026-07-02:

| | |
|---|---|
| rows carrying a `perceived_recovery` | **78** |
| of those, ever touched | **0** |
| distinct values | **2** · standard deviation **0.286** |
| `sleep_quality_feel` touched | **3 of 97** |

The entry measured 96/77 the day before; it is 97/78 now, so the untouched population is still
growing — which is the pass test it set.

## Five corrections to the entry, one of which would have broken production

**1. The write-path instruction, as written, drops the check-in.** The entry says *"a body carrying
only untouched defaults now counts as carrying no answers."* Traced: the morning sheet posts these
two scales, `illnessContext`, an empty `soreMuscles` and a null journal — nothing else that
`dayCheckinHasAnswers` counts. So nulling before the guard makes an untouched save carry no answers
at all. On the web route that is a 400. In `pushMutations` the same guard rejects the mutation
**per-item with no retry** — the poison-pill path — so the row never reaches the server. And
`session-select-content.tsx` re-opens the sheet until a row exists for the day. The owner has never
touched the control, so **every one of his daily check-ins would have stopped syncing.** The guard
now reads the submitted body and the nulling applies to what is stored. Submitting the sheet is an
act worth recording; what it is not is a self-report.

**2. "Three readers" is two readers and a comment.** `body-battery/stress-day/route.ts:17` does not
read `perceivedRecovery` — the only occurrence in the file is a docblock sentence observing that it
reads 3 on all 17 days. Nothing to change there.

**3. A sibling sweep found three more consumers the entry did not name.** `admin/sleep-feel-
calibration` (the exact twin for the other scale), `score-audit/build-day-audit.ts` (displays the
value and a derived label), and `ai-periodization/signals.ts` → `prompt.ts`, which tells the model
*"Morning check-in (1=best, 5=worst): recovery 3"* as the lifter's own report. All five now resolve
through one helper.

**4. `recap`-style line numbers had drifted**, so each reader was located by grep rather than by the
cited line.

**5. My own claim that the sleep-feel route had no test was wrong.** It has one —
`lib/__tests__/admin-report-calibration-routes.test.ts`. I had run a file selection that excluded it
and read the pass as coverage; the full suite found both its fixture and the battery route's,
neither of which set a touched flag. Both moved, each with a new case pinning the untouched
semantics beside the date-keying they were written for. A targeted run still cannot tell you what
you broke.

## What shipped

`packages/shared/src/health/self-report.ts` — `answeredMorningScales(row)`, one place that decides
whether a scale was answered. Five readers and both write paths go through it.

**No migration, no data write, and the 78 rows are deliberately not backfilled** — the flag already
tells them apart, so a write buys nothing and destroys the record of how long this ran.

**On the periodization prompt:** no weight, threshold or formula moved. The only change is that a
value the lifter never supplied is no longer stated to the model, which is the same rule
`PROSE_GUARDS` applies to output.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. It caught two real defects in my own test code: a
  `toISOString().slice(0, 10)` in a fixture, and a zero-arg mock declaration on `saveDayCheckin`
  whose `.mock.calls[0][1]` reads as `undefined` — a test that looks like it inspects the write and
  cannot.
- Full suite green; `check-test-typecheck` none above baseline.
- **Mutation pass: 6 mutations caught, 2 equivalent controls passed.** The load-bearing one is
  correction 1: nulling before the guard fails four cases, including the pre-existing Q-465 test
  *"accepts what the morning sheet sends"*. The repo's own suite already guarded the trap the entry
  walked into.
- **`pnpm dev` against the local database.** An untouched morning POST returned **201** with
  `perceivedRecovery: null` — the row still writes. A touched one stored **5**. The battery
  calibration then showed `rating: 5` on the touched day and `rating: null` on the untouched one;
  sleep-feel showed `feel: null` throughout (nothing has ever been touched); health-trends answered
  *"Not enough paired data yet"* with no buckets; and `/api/admin/day-review` returned
  `perceivedRecovery: 5` for the touched day and `null` for the untouched one, with the sleep-feel
  label nulled alongside its value.

**Expect the correlations to EMPTY rather than shift.** That is the correct outcome and must not be
rescued by relaxing the filter: three answers that are real beat 78 that are not.

## Not exercised

Sandbox only; nothing native, offline-first at the UI layer, safe-area or gesture. The outbox half
is covered by the web/push parity integration test against the local Postgres, not on the device.

`ai-periodization/signals.ts` is the one reader **not executed** — `aggregateSignals` needs a full
program fixture, and stubbing it was judged out of proportion. It is covered by the shared helper's
unit tests, by typecheck, and by a new prompt test pinning the consequence (an unanswered scale
renders as an em dash, never as a number or the word "null"). Reviewing the diff is how the wiring
itself was checked.

<a id="2026-09-22-layout-384-truncation-batch"></a>

# 2026-09-22 — `layout-384`: five places a 384px screen cut the wrong thing

**Branch:** `feat/layout-384-truncation-batch` · **Lane:** Implementation B · **Version:** 1.464.6

Five entries, one PR, one verification — the batch's whole point. All five are a class combination
whose effect is geometric.

## What shipped

- **RV-92** `pre-workout-screen.tsx` — `truncate` sat on a **flex container**. `text-overflow`
  applies to inline content of a *block* container; on a flex container the name became an anonymous
  flex item at `min-width:auto`, so it never shrank, no ellipsis painted, and the green "done today"
  tick after it was **clipped out of existence — a completed exercise read as unlogged.** The name
  is its own `truncate` span now, inside a `min-w-0` flex parent.
- **RV-93** `injury-notice.tsx` — the chip was `shrink-0` at `max-w-[11rem]`, taking 176 of 352px
  whatever the title needed. Mid-set, "Single Leg Romanian Deadlift" read `Single Leg Roma…`.
- **RV-94** `food-row.tsx` — 162px of name column is ~22 characters against **130 of 337 real items
  longer than that**. `line-clamp-2`, which the row's existing `min-h-12` already accommodates.
- **RV-95** `weekly-stats-hub.tsx` — the unit rode with the value in a 74px cell, so `kg` wrapped to
  a second line for **every non-zero week**, dropping the VOLUME caption ~22px below its three
  neighbours. It moves to the `unit` line the other three tiles already use.
- **RV-96** `done-screen.tsx` — name and `· 3/4 sets` shared one truncating span, so the caveat on
  the HRR number was always cut first, and cut **precisely on the longest names**.

## All three "not established" questions settled, two of them against the entry

- **RV-93 asked whether the chip fires on a specific exercise.** It does, and on the entry's own
  example: the single unresolved injury is `lower back`, and **"Single Leg Romanian Deadlift" carries
  `lower back` as a secondary muscle** (ten library exercises do). Not hypothetical.
- **RV-94 said "check first, it may make the fix unnecessary" —** whether the grey secondary line
  disambiguates the colliding pair. It *does* differ: both are Sanitarium, at **350 g and 258 g**.
  But it differs **at the tail**, which is exactly what truncation removes, and the secondary line
  truncates too. So it never disambiguated them, and the fix stands. One refinement to the entry:
  the rows are not quite "indistinguishable" — the calorie column already shows 259 against 208 —
  but nothing tells you *which* is the Choc Hit.
- **RV-95 asked whether `/api/weekly-stats` rounds `totalVolumeKg`.** It does, at `:115`. The
  fractional-widening worry is unfounded.

## The test caught a branch my own fix missed

`injury-notice.tsx` has two variants — a `button` when `onSwap` is given and a `role="status"` div
when it is not. The first pass fixed the button and left `shrink-0` on the div beside it. The
assertion is on `${shell} shrink-0`, so it failed, and the sibling was fixed before it shipped.

## Also in this PR: LB-125 split

LB-125 was filed an hour earlier, out of RV-91, **spanning two lanes in one entry** — the helper is
Lane A's, the five call sites Lane B's. `next-item.js` has no way to know that, so it printed at the
top of Lane B's READY while its first half was unstartable here. Split per the repo's own rule: the
helper keeps **LB-125** (Lane A), the call sites become **LB-126** with `Needs: LB-125`. Three of
those five are a bare `{ weekday: 'short' }` and cannot be converted until the helper has a style
for it, so starting LB-126 first would convert two of five and make the other three look deliberate.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean (one pre-existing warning).
- **Controlled: all five cases go red against the unfixed files**, each naming its own defect.
- Source-shape by necessity — jsdom has no layout engine, so a rendering test would assert nothing
  about geometry.

**Not exercised:** ⚠ **no device sitting, and this batch is the kind that wants one.** Every fix is
a pixel claim at 412px. The arithmetic behind each is in the entries and re-checked here, but the
ellipsis, the two-line food row and the Volume tile's single line are unconfirmed on the S25.

<a id="2026-09-22-lb126-shared-date-styles"></a>

# 2026-09-22 — LB-126: four weekday labels onto the shared formatter

**Branch:** `feat/lb126-shared-date-styles` · **Lane:** Implementation B · **Version:** 1.465.4

## What shipped

LB-125 (#1404, Lane A) gave `formatDateDisplay` the `weekday`, `weekday-date` and
`weekday-date-long` styles. These are the call sites that were spelling those option bags
themselves — the four RV-91 closed with as *"noted, not filed"* and that LB-126 was filed to carry:

| site | was | now |
|---|---|---|
| `weekly-nutrition-chart.tsx:50` | `{ weekday: 'short' }` | `formatDateDisplay(date, 'weekday')` |
| `recommendation-card.tsx:36` | `{ weekday: 'short' }` | `formatDateDisplay(maxDate, 'weekday')` |
| `week-day-sheet.tsx:13` | `{ weekday: 'long', day, month: 'short' }` | `'weekday-date-long'` |
| `nutrition-content.tsx:88` | `{ weekday: 'short', day, month: 'short' }` | `'weekday-date'` |

**Equivalence was checked before the swap, not after:** `Tue`, `Tue, 15 Sept` and
`Tuesday 15 Sept` come out byte-identical, and the helper accepts either separator — so
`recommendation-card`'s own `.replace(/\//g, "-")` went with its option bag.

## The fifth site the entry named is not one

`calendar-widget.tsx:109` renders a **month and year** from `(viewYear, viewMonth - 1, 1)`.
`formatDateDisplay` takes a `YYYY-MM-DD` **string** and has no month-year style, so it cannot take
this at all; converting it would need a new style, which is Lane A's. **I wrote that entry, and it
was wrong to list the site** — the test now asserts the calendar keeps its option bag, so the next
sweep does not re-file it.

## An unpredicted consequence, caught by CI rather than by me

All four converted files were `REVIEWED_BENIGN` rows in `scripts/check-timezone-rendering.js` —
triaged in 2026-08-08 as benign because each built its Date from calendar components or a
local-noon string. Routing them through the helper means they **no longer call `toLocale*String` at
all**, so the check failed with *"These files no longer call toLocale*String without a timeZone —
remove them from GRANDFATHERED"*. That is the script's own shrink-only rule working exactly as
designed, and it means this change also removes four sites from the timezone bug class that CLAUDE.md
devotes a section to. `calendar-widget` keeps its row, now annotated with why it was left.

## Verification

- `pnpm check:rules` — **Ran 75 of 75** (it was step 18, *No device-local date/time rendering*, that
  failed until the four rows came out). `tsc --noEmit` clean; lint clean apart from a pre-existing
  warning.
- **Controlled: 2 of the test's 4 cases go red** against the unfixed tree — the two source-shape
  ones. The other two assert the shared styles' literal output and that the calendar is *not*
  converted; both hold either way by design, and the first is what justified the swap at all.
- The repo-wide sweep filters the extension in JS and skips `__tests__`, for the two reasons RV-98
  wrote down the hard way: `git ls-files a b -- '*.tsx'` unions its pathspecs rather than filtering,
  and a test stating a rule has to quote the thing it bans.

**Not exercised:** no device sitting. Four label strings whose output is asserted identical to what
they replaced, so there is nothing new to see at 412px.

<a id="2026-09-22-perf-rv64-hr-profile-remount"></a>

# RV-64 — the HR profile is read by the screens, not by the chart that remounts

**Branch:** `perf/rv64-hr-profile-remount` · **Lane B** · no version bump (see below)

## What shipped

`LiveHrChart` read `hr-profile` in a mount-once effect, and `active-workout-screen.tsx` renders it
on `workoutPhase === "rest"`. So it remounted **once per rest period**: a 5×4 workout paid a
~230 ms route around twenty times *during the workout*, against the same ten-connection pool as
`log-exercise` and `complete-workout` — and `/api/hr-profile`'s 20-per-60s limit meant a dense rest
cadence could make the chart 429 itself.

The chart now takes `profile` as a prop. The two screens that render it and outlive it —
`active-workout-screen` and `exercise-summary-screen` — own the read through a new
`lib/hooks/use-hr-profile.ts`, which wraps `useCachedValue` and owns the key, URL and TTL for the
workout flow. The active screen stays mounted for the whole active phase, so its ~20 reads become
one.

## The entry offered two fixes and one of them is wrong

RV-64 also proposed `freshWithinTtl: true`, and said the written invalidation proof that flag
requires was *"available rather than owed"* because `HR_PROFILE_TTL` is 6 h and two groups in
`lib/cache-groups.ts` already clear `hr-profile`.

**The proof does not hold.** The flag needs *every writer of the payload* to sit in a group that
clears the key, not two of them. `resolveHrProfile` computes from `repo.getUserById`,
`repo.listBodyMetrics` and `repo.getHrForWindow` over **90 days** — and live BLE samples land inside
that window *during the workout*, ingested natively and server-side, with nothing in
`lib/live-hr/**` invalidating anything. The two groups are `invalidateOuraSync` and
`invalidateBodyMetricWrite`; neither fires for live ingest. So the flag would have pinned a profile
for up to six hours **across workouts**, where hoisting bounds the staleness to one screen's
lifetime. Checking which groups contain the key is not the same check as which writers change the
payload.

## What the test can and cannot see

`lib/hooks/__tests__/rv64-hr-profile-read-is-hoisted.test.ts` is **structural**, and deliberately so
rather than as a shortcut: the repo has no React render harness, and
`use-invalidation-refetch.test.ts` is the established shape for "which module is allowed to do
this". No spec drives the active workout through a rest period, so counting real requests would
have meant building that fixture first.

**Mutation-checked three ways**, one per claim: putting the fetch back in the chart fails it;
calling the hook but dropping the prop at the call site fails it; adding a third mount site — which
compiles and renders and would silently draw no zones, since the prop has no default — fails it.

One assertion was wrong on the first draft and the test caught it rather than the code: matching
`/hr-profile/` failed on the chart's legitimate `import type { HrProfileResponse } from
'@/app/api/hr-profile/route'`. A second matched this file's own comment naming `useHrProfile`.
Assertions now match the URL, and read source with comments stripped — a test that cannot tell prose
from a call punishes documenting the change.

**What it cannot see: the request count on a running app.** "One call per workout instead of ~20"
follows from the chart not fetching plus the owner outliving it, and the second half is read off the
source rather than observed.

## A stale annotation, corrected

`live-hr-chart` was in `check-fetch-once-effects.js`'s frozen list annotated *"inside
exercise-summary-screen"* — only half its mounts, and the wrong half. `active-workout-screen`
renders it on the rest phase, which is the whole of RV-64's cost. The list's judgement ("nothing
writes those keys during that window") was about **staleness** and was right; the cost was never the
question that list asks. Its row is removed, because the check itself fails and says to remove it
when a site goes, and the note now says to judge a site by *every* place it mounts.

## Not exercised

**No device pass**, and the entry keeps one. The measured claim is a request count, and this was
verified structurally plus by four e2e runs of the workout screens.

`bf163-intensity-chip-load-only` failed once on the branch and then passed four times — alone and in
the same two-spec pairing, on the branch and on clean `main`. It is in the same flaky set CI
reported on #1377. **Recorded as unexplained rather than closed:** it was not reproduced, and one
red that will not come back is not the same as one understood.

## What blocked this PR was not this PR

Its `Tests` check went red on `lib/__tests__/cardio-hub-routes.test.ts` — nothing in this diff.
Reading it rather than re-running found `main` red for every lane: the test asserted
`Math.round(spanDays) === 90` against a window that runs from **local midnight** ninety days back to
`now`, so the span is 90.0–91.0 and `Math.round` tips at local **12:00**. It had been failing for
roughly half of every day, on every branch. Fixed test-only in **#1387**, which merged first.

**The sweep that PR listed as not established is now done, and it was the only one.** Three other
tests assert an exact day span — `oura-ble-device-routes.test.ts` ×3 — and all of them inject the
clock with `vi.setSystemTime`, so both sides are fixed, which is the shape the date rule prescribes.
`ai-periodization-program-routes.test.ts` compares two fixed ISO dates. No other assertion in the
suite divides a live `Date` delta into days and pins the result.

## No version bump

Nothing user-visible changed. The chart draws the same zones from the same profile; what changed is
how many times the app asks for it.

<a id="2026-09-22-review-agent-sweep-53"></a>

# Review sweep 53 — stale surfaces, movement, and what should be one thing

**Branch:** `review/sweep-53-user-visible` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-22-sweep-53-stale-surfaces-and-movement.md`](../reviews/2026-09-22-sweep-53-stale-surfaces-and-movement.md).
**Filed:** RV-103 … RV-122 (20 entries, five new batches).

The owner asked for more user-visible sweeps and named the angles: animations and page swaps,
caching — with a live example, *"nutrition calorie macro not updating on screen when food added -
requires page swap"* — and which widgets or pages could merge. Three read-only lanes plus a
coordinator investigation of his report. Ranked by traffic (Home 22 · Nutrition 14 · Health 11 ·
More 7 · Workout 2).

## His report is a re-report

`app/nutrition/use-energy-balance-refetch.ts` exists because of BF-177, and its docblock opens by
quoting him saying the same thing: *"The kcal left in the top right; doesnt load on the same page:
it requires page switching to show."* So BF-177 did not close it.

The mechanism is `cachedFetch(...).catch(() => {})` with no `onError` — and per RV-84 `cachedFetch`
never rejects, so that catch is dead. Any failure and the refetch silently does nothing, leaving the
pre-meal object in place with no retry and nothing on screen saying so. A page swap re-runs
`fetchData`, which is exactly what he describes, twice. Eviction was never the problem and BF-177
already said so; Home's copy of the card is fine because Q-402 gave it `useCachedValue` (RV-103).

## The asymmetry that proves the class is wide

**Deleting a food refetches the weekly calorie chart. Adding one does not** — same screen, same
quantity, and the delete site's comment calls itself *"BF-177's third site, which that entry did not
name"*. Patched site-by-site, so a fourth was always likely (RV-104). Four more of the shape: a ring
sync leaves Health's HR card behind Home's (RV-106); macro-target edits leave Nutrition banding
against the old number (RV-107); on-device a weigh-in invalidates almost nothing while its sibling
does it right two files away (RV-108); Activity History never shows an activity confirmed from Home
(RV-109).

**Why the guard missed four of them.** `check-fetch-once-effects.js` matches only `useEffect(…, [])`
— its comment calls a non-empty dep array *"a different (and usually correct) shape"*, which is true
in general and false inside a shell where `[userId]` and `[today]` never change. Widening it is not
trivial: the file records that its first version inflated its own baseline by 11 of 25 (RV-105).

## Movement

**37 cross-tab `router.push` sites against 5 `navigateToTab`** — a push tears down the whole tab
shell, every panel's state and scroll. Home does both on adjacent lines (RV-110). Home and More
share one scroll-restoration key while Health correctly passes three (RV-112). The tab switch hides
the outgoing panel in the same commit the incoming one starts transparent (RV-113). And back while
the barcode scanner is open discards the entire Log Food flow, because the scanner replaces the
sheet's body rather than taking its own back-stack entry (RV-111).

## Consolidation

Home offers **two widgets answering one question from one cache key** — the shape that already
produced Q-401/Q-415, two budgets 271–274 kcal apart both labelled "left" (RV-116). Health → Body
shows two different energy answers nine cards apart, from one payload that was unified after they
disagreed once (RV-117). "Weight Trend" exists twice, and the card with that title has no trend
number (RV-118). Seven banners stack above Home's first content (RV-119) — filed with an explicit
⛔ against collapsing the illness and deload ones into a dismissible strip.

Two housekeeping items: `aiVolume` is built, has a live render arm, is in no order array, and has
**zero** backlog entries despite a comment promising the merge — orphaned by the repo's own rule
(RV-120). `/collection` has one in-app link behind an off-by-default widget, so a fresh install
cannot reach it (RV-121).

The design lane also found and reported the cases the repo has **already decided** to keep separate
— OR-116's HR naming, Q-239's six single-entry screens, Q-112a's end-of-day merge — and did not
re-propose them.

## Not established

Nothing was rendered or reproduced: no device, no WebView, no `pnpm dev`. RV-108 is **device-only**
— the misbehaving branch is the local-store one, which does not run off the APK. RV-113 turns
entirely on two device questions that decide whether it is worth doing at all. Whether the owner has
both energy widgets enabled is unknowable from the repo.

<a id="2026-09-22-rv100-phase-colour-language"></a>

# 2026-09-22 — RV-100: a training phase painted in the state colours

**Branch:** `fix/rv100-deload-colour` · **Lane:** Implementation B · **Version:** 1.465.5

## What shipped

`PHASE_COLORS` in `ai-periodization-status-card.tsx` mixed two colour languages:

- **`realisation: "text-red-500"`** — the *peak-output* phase, in the app's failure colour.
- **`deload: "text-green-500"`** — while Home's `DeloadBanner` paints a deload *recommendation*
  `#ef4444` / `#f97316` / `#fbbf24` by strength.

The five phases now use a cool ramp — `baseline` neutral, then blue, indigo, purple, cyan — so
green, amber and red are left to mean state. Home's banner also carried a **third** amber beside
`#f59e0b` and `--accent-amber`; the soft tier takes the token now, and `check-hex-literals.js`
drops that file 3 → 2.

## The open question, answered before sizing the work

The entry says to establish whether both surfaces are actually reachable — *"if the phase card only
shows `deload` while the banner is suppressed, the collision is theoretical."* Measured against
production: the active program **is** `ai_dynamic`, so the card renders, and
`session_periodization` carries **2 sessions in `deload` and 2 in `realisation`** right now. Both
are live.

## The entry's suggested fix would have moved the collision, not ended it

RV-100 says to *"give `PHASE_COLORS` a non-semantic set (`packages/shared/src/session-palette.ts` is
already the repo's categorical palette)"*. **That palette contains `green` and `red`.** It is
indexed by session *position*, so borrowing it would have assigned a phase whichever hue its index
landed on — including the two reserved ones. A cool ramp chosen explicitly against the state hues is
what the entry wanted; its named source is not it, and the test asserts that palette still carries
green and red so the suggestion cannot be quietly retried.

## A distinction the entry overstates, kept in mind rather than acted on

The entry frames the two surfaces as the same concept — *"neither is wrong alone; the pair cannot
both be right."* They are not quite the same thing: the chip is a **program phase** (this session is
in its deload block) and the banner is a **recommendation** (you have trained eight days running,
rest). Green for "you are in the easy week" and amber for "you should take one" can both be correct
readings. What is *not* defensible is a category borrowing the state language at all, which is why
the fix still stands — and `realisation` in red needs no such argument.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean.
- **Controlled: 3 of the test's 4 cases go red** against the unfixed files. The fourth characterises
  `SESSION_PALETTE` and correctly does not move; it exists to stop the entry's suggestion being
  retried.
- The assertions parse the `PHASE_COLORS` object body rather than grepping the file, and fail loudly
  if that parse returns nothing — a passing vacuous assertion is the failure mode here.

**Not exercised:** no device sitting. This is a hue change on two surfaces and wants an eye on the
S25 — particularly whether indigo and purple read as distinct at chip size.

<a id="2026-09-22-rv103-rv104-nutrition-freshness"></a>

# 2026-09-22 — RV-103 / RV-104: nutrition freshness (`fix/rv103-rv104-nutrition-freshness`)

Batch `nutrition-freshness`, both entries from Review sweep 53. Both are the Q-402 shape — the
eviction lands and nothing asks for a new value — so neither fix adds an invalidation. Every key
involved was already in `invalidateNutritionWrite()` and always had been.

## RV-104 — the weekly chart and adherence, subscribed rather than remembered

`nutrition-weekly-summary` and `nutrition-adherence` were fetched **only** from `fetchMountData`,
whose effect deps are stable, on a screen the tab shell never unmounts. So the 7-day calorie chart
and the adherence percentages held their launch-time values until the app was restarted; a tab
switch did not help, because `useRefreshOnTabShow` re-runs `fetchData` (logs + balance), never
`fetchMountData`. The asymmetry that made it visible: the delete path had learned to refetch the
weekly summary by hand and the add path had not.

Fixed as a shape, not a site — `app/nutrition/use-nutrition-derived-refresh.ts` owns both fetches
and subscribes both keys through `useInvalidationRefetch`, so every write path present and future
refreshes them. The delete path's hand-rolled refetch is gone. BF-177 was patched site-by-site
three times; a fourth site was always going to appear.

**Verified on the running app**, not inferred: `e2e/rv104-weekly-refetch-after-log.spec.ts` logs a
food and asserts both endpoints are requested without navigating. It was confirmed to **fail with
the subscription disabled and pass with it** — and the dev server's own log shows
`POST /api/nutrition/food-logs 201` followed by `GET …/weekly-summary` and `GET …/adherence`,
which the add path never produced before.

## RV-103 — the refetch that could not report its own failure

Three defects, all in `app/nutrition/use-energy-balance-refetch.ts`:

1. `void cachedFetch(...).catch(() => {})` — per RV-84 `cachedFetch` never rejects, so that was
   dead code standing in for error handling. Now `fetchWithRetry`, whose `onExhausted` (RV-85) is
   the one moment a caller can tell a slow load from a failed one; `EnergyCard` renders a failure
   line and a Retry.
2. `d => setBalance(d ?? null)` wrote **null** on an empty payload, and `balanceForDate` is gated on
   the payload's date — so the budget and the macro targets *disappeared* rather than going stale.
   Now `if (d) setBalance(d)`.
3. **Found while reproducing it, and it would have made the whole mechanism inert:** the unmount ref
   was set in a cleanup and never reset, so StrictMode's simulated unmount latched it `true` for the
   life of the screen and `isCancelled()` killed every retry. Driving the real screen with the
   balance route aborted counted **one** request where four were due.

### What is NOT established, and why the spec for it was deleted rather than shipped

`cachedFetchCore`'s network-throw branch computes `const online = cached === null && navigator.onLine`
and fires `onError` only when `online`; its `!res.ok` branch is gated the same way. **So no caller
can be told that a revalidation failed whenever a cached value was painted** — and `fetchWithRetry`
has the mirror-image blind spot, counting a cached paint as a response. Together they mean RV-103's
suggested fix, *"pass `onError`"*, cannot reach the case it was written for.

Driving `/nutrition` with `/api/nutrition/energy-balance` aborted, the same code both reported and
stayed silent on consecutive runs, decided by whether the entry happened to be in the cache when the
refetch ran. **The flake was the finding.** Exhaustion was observed firing once in five runs. A spec
that green-lights a mechanism half the time is a tax on every future session, so it was dropped
rather than retried into submission; the report path is wired and strictly additive (absent the
flag nothing renders, which is today's behaviour) and is recorded as unproven rather than done.

Filed as **LB-128** for Lane A, which owns `lib/sqlite/cache.ts`: an ungated `onRevalidateError`
for the case where the caller knows the cached value is out of date because it just wrote. The
entry carries the warning not to simply ungate `onError` — every existing caller reads it as "I
have nothing to show", and `useCachedValue` renders an error state on it.

## Not exercised

Native SQLite / Capacitor (the web path takes the API fallback throughout), safe-area insets,
Samsung WebView rendering, drifted production data, real Oura/Health Connect tokens. **No device
sitting** — the failure line and its Retry at the S25 width are owed, and RV-103 keeps that.

<a id="2026-09-22-rv86-rv87-absence-not-zero"></a>

# 2026-09-22 — RV-86 + RV-87: a failed read is not a measured zero

**Branch:** `fix/rv86-rv87-absence-not-zero` · **Lane:** Implementation B · **Version:** 1.464.2

## What shipped

Two screens rendered a failed fetch as a confident number.

- **RV-86 — Home's Streak card.** `/api/streak-data` failing left `calendarDays` at its `{}` initial
  value, and the card painted that as fact. It now takes a `loaded` prop, raised only by the cache
  seed and by `onData`, and the streak figure, the week count, the week progress bar and the ten-day
  dot strip all render an unknown state until it is true.
- **RV-87 — the Profile tab.** Every lifetime figure was a `?? 0` default handed straight to
  `StatsGrid` and `AchievementsSection`. A failed `/api/achievements` read as a genuine
  *Level 1 · Novice · 0 XP* with an all-zero lifetime, **best streak included**. `StatsGrid` and
  `AchievementsSection` now take a gate prop, the hero reads `Level —`, and one
  "Couldn't load your stats — pull to refresh." line appears.

## Two of the entries' claims did not survive contact

- **RV-86 said the streak number itself had "no unknown representation".** It already did —
  `streak-card.tsx:82` rendered `streak > 0 ? streak : "—"` before this change. The confident zeros
  were the *week* count ("0 / 5 · sessions done", with an empty progress bar) and the ten-day dot
  strip, which the entry does not mention. The fix went where the defect was.
- **RV-86 also implicated the rest-day banner** ("Resting today breaks your streak"). It is driven
  by `recommendation?.consecutiveRestDays`, from `/api/next-session` — a different fetch, guarded by
  `consecutiveRestDays != null && >= 1`, so a failed streak read cannot produce it. Not touched.
- **RV-87's "the grid below spins forever (RV-84)"** was already fixed, in #1391 the day before:
  `achievements-section.tsx` renders "Could not load achievements" on a null payload. Only the
  header's `0 / 0` and the figures above it were left.
- **RV-86's open question — can `pendingDays` independently populate a nonzero streak offline?** Yes,
  the outbox overlay merges into `trainedDays` regardless of the fetch. It is deliberately *not*
  treated as raising the gate: one unsynced workout does not make a 365-day history known, so the
  card still reads "—" and the pending day still lights its dot.

## The size ratchet forced an extraction, which is what it is for

`session-select-content.tsx` sits on a 1448-line baseline that may not grow, and the change added 11
lines. Rather than shave comments, the streak walk moved to `app/session-select/compute-streak.ts`
(1459 → 1431). The move is mechanical and `computeStreak` now has its own test pinning the rest-gap
rule — two rest days are bridged and credited, the third breaks the walk — which nothing asserted
while it was inline.

The move turned `lib/__tests__/rv57-streak-lookback-contract.test.ts` red, which is the right
behaviour and was left as-is rather than loosened: RV-57 asserts the consumer of
`STREAK_LOOKBACK_DAYS` imports it instead of walking to a literal, and naming a path is how that
test notices the consumer has gone somewhere it is no longer watching. It was repointed, not
relaxed.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, all passed (it was the component-size step that failed
  before the extraction).
- `tsc --noEmit` clean; lint clean on the changed files (the warnings it prints are pre-existing).
- **e2e, `rv86-rv87-absence-is-not-zero.spec.ts`** — intercepts each endpoint with a 500 and asserts
  the rendered text, at the 412 px S25 viewport. **Both specs were run against the unfixed components
  as a control**, not just against the fix.
- Two unit files, both mutation-checked rather than merely green: raising the gate inside a `.catch`
  handler, and making a gate prop optional, each turn the source-shape test red.

**Not exercised:** no device sitting. These are render-only changes in no device-gated class
(no offline-first write path, native plugin, safe area, gesture or notification), and the e2e run is
the web build, where `getLocalStore` returns null — so the `pendingDays` overlay interaction with the
new gate is reasoned about above, not observed on the device path.

<a id="2026-09-22-rv89-one-rm-display-helper"></a>

# 2026-09-22 — RV-89: one stored 1RM, one number

**Branch:** `fix/rv89-one-rm-display-helper` · **Lane:** Implementation B · **Version:** 1.464.3

## What shipped

A stored `estimated_1rm` sits on a 0.25 grid, and five surfaces each rounded it their own way. For
a stored **92.25**, in one session: ready screen **92.5 kg**, pre-workout list **~92kg**, stats
sheet **92.3 kg**, Strength Trend **92.3 kg**, exercise summary **92.25 kg**. All of them now call
`displayOneRm(oneRm, exerciseType)`.

Four of the five already imported that helper and called it for the **bodyweight** branch of the
same ternary while hand-rolling the weighted branch beside it, so most of the diff is deleting the
hand-roll and letting the ternary collapse.

**The ready screen's rounder was `mround125`** — the 1.25 kg plate grid, clamped 5–250. It is a
*prescription* rounder, and applying it to a bodyweight 1RM index is what told the owner to load
**82.5 kg onto a pull-up** in BF-127. Its import is gone from that file. The two remaining calls in
the stats sheet are prescription weights and are correct.

## Three sites the entry does not name

**The Strength Trend card carries three, not one** — the headline, the 90-day low and the peak all
used `.toFixed(1)`. The low is now taken from the **raw** history rather than from the
already-converted `values` series: `bodyweightRepMax` is monotonic in the stored 1RM, so the minimum
is the same either way, and that version cannot double-convert a bodyweight figure.

## Two things left alone on purpose

- **The exercise summary's bodyweight branch** passes `storedReps` to `bodyweightRepMax`, which
  `displayOneRm` does not accept (BF-164 / BF-149). Only its weighted branch moved.
- **The trend card's footer says "reps" where the helper's `.text` says "RM".** Those sites take
  `.value` and keep the card's own wording — the defect is the number, not the noun.

## Both of the entry's open questions are answered

- **Was the pre-workout `~` a deliberate approximation signal?** No. It is `Math.round` with a tilde
  in front, the fourth of four hand-rolled roundings, and nothing in the repo records it as a
  decision. Dropped.
- **Does any site read a differently-rounded server field?** No. `strength-trend` passes
  `getExercise1rmHistory` straight through, and that SQL is
  `MAX(el.estimated_1rm)::double precision` — no rounding anywhere on the path.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, all passed. `tsc --noEmit` clean; lint clean on the five
  changed files (its warnings are pre-existing, `labels` in the trend card among them).
- `components/workout/__tests__/rv89-one-rm-renders-one-number.test.ts` — run against the unfixed
  files as a control, **5 of its 7 cases go red**, each naming its own defect.
- **Its blind spot is written into its header rather than left implied:** `exercise-summary-screen`
  stays green on that control, because its hand-roll was a bare template literal with no rounding
  call in it. Numerically it was the one site already right; routing it through the helper is
  robustness against an off-grid value, not a fix, and only the import assertion holds it.

**Not exercised:** no device sitting. Render-only changes in no device-gated class. The e2e runs the
web build.

<a id="2026-09-22-rv91-shared-date-and-energy-label"></a>

# 2026-09-22 — RV-91: a raw ISO date on two screens, and one `Cal` among 155 `kcal`

**Branch:** `fix/rv91-raw-iso-date-and-cal-label` · **Lane:** Implementation B · **Version:** 1.464.5

## What shipped

- **`components/health/activity-history-card.tsx:142`** and
  **`components/activity/activity-detail-sheet.tsx:148`** rendered `{log.date}` — the raw
  `2026-09-15` — on the line directly above a correctly formatted `formatTime12h()`. Both now call
  `formatDateDisplay`, the history row at `'short'` and the sheet header at `'long'`.
- **`components/home-day-timeline.tsx:117`** said `Cal` where the rest of the app says `kcal`.
  Re-counted on the day: **155 `kcal`, exactly 1 `Cal`**. A food Calorie *is* a kilocalorie, so
  neither label was wrong and the defect was the disagreement — 155 to 1 decides it.
- **A sibling the entry does not name:** `app/health/day/day-detail-content.tsx:186` hand-rolled the
  same long-form date. Its noon-UTC anchor rendered in UTC was correct — that pairing is what kept
  the day from shifting — and `formatDateDisplay` reaches the same string by constructing
  component-wise, which is the Q-130 fix. Routed through the helper here, per the sibling-surface
  rule.

## The entry quoted a comment instead of running the function

RV-91 says the same day reads *"Monday, 15 September"* in the day detail. **That string does not
exist anywhere.** It is the wording of `formatDateDisplay`'s own header comment, which is wrong
twice: `en-AU` is **day-first** and puts **no comma** before the day. Measured — `'short'` returns
**`15 Sept`** (not `Sep 15`) and `'long'` returns **`Tuesday 15 September`**. The day detail was
rendering the comma-less form all along.

Both facts are now pinned by assertions rather than left in prose, and the comment itself is in
`packages/shared`, which is Lane A's — so it is **filed, not edited**.

## Filed rather than dropped: LB-125

RV-91 closes with *"Also noted, not filed: four hand-rolled `toLocaleDateString` option bags sit
beside the shared helper."* Removing the entry would have dropped that, so it is now **LB-125**:
five remaining call sites (the count after this PR absorbs two), of which **three are a bare
`{ weekday: 'short' }`** that one new `style` variant would take, plus the wrong comment above. The
`style` half is Lane A's; the call sites are Lane B's.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean on the changed files.
- `components/health/__tests__/rv91-shared-date-and-energy-label.test.ts` — run against the unfixed
  files as a control, **4 of its 5 cases go red**. The fifth is a characterisation test of the pure
  formatter and correctly does not move; it is what caught the wrong comment.
- The `Cal`/`kcal` half is asserted as a **repo-wide count over `git ls-files`**, not against one
  file, because the defect *was* the count: one site disagreeing with 155 is invisible from inside
  that file. It also asserts `kcal` is still the majority, so the rule cannot be inverted quietly.

**Not exercised:** no device sitting. Render-only string changes in no device-gated class. No e2e —
the two assertions are a source shape and a pure function, and neither needs a browser.

<a id="2026-09-22-rv97-acwr-band-colour"></a>

# 2026-09-22 — RV-97: the ACWR number was the "High" colour in every band

**Branch:** `fix/rv97-acwr-band-colour` · **Lane:** Implementation B · **Version:** 1.464.7

## What shipped

`components/health/training-load-card.tsx` painted its headline `style={{ color: '#f59e0b' }}` — a
hard-coded literal that is **exactly** what `acwrBand()` reserves for the `high` band. The band
*word* beside it came from the real `interpretation`, so an ACWR of **1.05** rendered
*"✓ Optimal zone"* with the number in warning amber, directly above body copy at `:91` calling
0.8–1.3 the green zone. The card contradicted itself twice on one line.

`acwrBandByKey()` had existed at `acwr.ts:90` for this exact caller and was not imported. It is now.
The card's `accentCardStyle('#f59e0b')` identity is unchanged — only the *value* takes the band.

## The entry's open question, and why its fix does not compile

RV-97 asks whether `interpretation` can carry a key outside `AcwrBand['key']`. **It can.** The
route's union has **six** members (`optimal | high | very_high | low | insufficient_data |
baselining`) and `acwrBandByKey` takes four. The entry reasons that the coloured branch is
unreachable for the other two because earlier branches handle them — which is true at runtime, and
irrelevant to the compiler: `insufficient` and `baselining` are **booleans, not type predicates**,
so they cannot narrow the property for the branch below. `acwrBandByKey(trainingLoad!.interpretation)`
as written is a type error.

So the key is narrowed explicitly into its own `bandKey`, and the unreachable arm inherits the text
colour rather than inventing one — a lookup miss that returns `undefined` and then reads `.color`
is a crash, which is a worse failure than the wrong colour this entry is about.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean.
- **Controlled, and the count is stated rather than implied: 1 of the test's 4 cases goes red**
  against the unfixed card. The second guards a *wrong* fix — re-banding the raw number at the call
  site, which is what `acwrBand` was extracted to end — and passes on the unfixed card because it
  does not band at all. The last two characterise the shared helper and would pass either way; they
  are there because the card's body copy makes a promise about 0.8–1.3 that nothing else checks.

**Not exercised:** no device sitting. A colour change on one number, in no device-gated class.

## Also in this PR: the baton, rewritten in full

`docs/agents/state/implementation-lane-b.md` had fallen **four merged PRs behind** — #1392, #1395,
#1396 and #1398 shipped with only its Next ID bumped. It is rewritten rather than appended, per its
own rule. Two lessons were merged to stay inside the 65-line ratchet: the vacuous-guard rule folded
into the control rule it is a case of, and the Morning Check-in modal into the Playwright bullet
beside it. The new material worth carrying is the control-run lesson from RV-89 — **a control that
stops at the first failed assertion never exercises the ones below it** — and the RV-91 one, that a
repo-wide source scan must exclude the file making the claim.

<a id="2026-09-22-rv98-opacity-contrast"></a>

# 2026-09-22 — RV-98: opacity-modified text was below AA, and the check could not see it

**Branch:** `fix/rv98-opacity-contrast` · **Lane:** Implementation B · **Version:** 1.465.3

## What shipped

`scripts/check-contrast.js` validated ten **bare token pairs** and had no opacity handling at all,
so everything from `text-muted-foreground/60` down was unguarded. Measured over `--card`: **70%
opacity is 4.64:1 and passes; 60% is 3.73, 50% 2.97, 40% 2.34, 30% 1.83** — against an AA floor of
4.5:1 for body text.

- **45 call sites raised to 70%** across 30 files.
- **Four exempted, each read in context and each with its reason written into the script**: a
  *future* day in the week strip (WCAG 1.4.3 exempts inactive components), two progress-ring
  **tracks** where `text-muted-foreground/30` is a `currentColor` fill behind a mask rather than
  text at all, and the `·` separator in the weather chip, where the values either side carry the
  meaning.
- **The calendar's `rest` marker went to FULL opacity, not the floor.** It is `text-[7px]` and the
  only thing distinguishing a past rest day from a past *untracked* one in the month grid, so it
  gets 8.36:1 rather than the 4.64:1 that merely clears AA.
- The check now parses `text-<token>/<n>`, composites, and fails with the measured ratio beside the
  file and line.

## The compositing was wrong on the first pass

`alphaRatio` initially blended the **linear** sRGB values. That put 40% opacity at **3.93:1** where
it is really **2.34:1** — an error that would have shipped a number in the failure message that
nobody could reproduce in a browser. CSS alpha-composites in the **gamma-encoded** space, so the
round trip has to be linear → encoded → blend → linear → luminance.

**What caught it was RV-98's own numbers.** The entry measured 1.83 / 2.34 / 2.97 / 3.73 and my
first output disagreed with all four. After the fix: **1.82 / 2.33 / 2.96 / 3.73** — independent
agreement to ±0.01. Given that twelve entry claims failed to survive contact across this sweep, an
entry whose measurements reproduce exactly is worth recording as such.

## Also fixed: `projectOverview.md` had three stacked version headers

Current Status opened with `**Version:** v1.465.2`, `v1.465.1` and `v1.465.0` on consecutive lines,
and carried a stray `**Version:** v1.464.8` + `**Last updated:**` pair buried mid-section. All four
are conflict-resolution residue, and **this lane's own recipe is how they got there**: *"keep BOTH
Current Status paragraphs"* is right about the paragraphs and wrong if it also keeps the header
above them. The baton now says to delete the loser's header explicitly. This is the file every
session reads first, so three contradictory version numbers at the top of it is worse than a stale
one.

## The RV-91 trap, repeated — with a second one under it

This test went red locally before it shipped, on **its own header**, which quotes the banned token
to state the rule. That is RV-91's `Cal`/`kcal` failure exactly, and **the lesson was already
written in this lane's baton** when I wrote this test. Writing a lesson down is not the same as
applying it.

Underneath it was a second bug in both tests: **`git ls-files app components -- '*.tsx'` does not
filter.** Git unions the three pathspecs, so `app` and `components` match every file beneath them
and `.ts` comes back too. RV-91's sweep has the same construction and survived only because its
`__tests__` filter happened to catch the file that would have tripped it. Both are now filtered on
the extension in JS, with the reason written beside them.

## A note on lane ownership

The entry scopes both halves to Lane B — the call sites *and* extending the script — while this
lane's baton says `scripts/**` is the Orchestrator's. Both were done here, because a guard that
ships separately from the fix it guards is a guard that arrives after the regression, and precedent
is clear: `check-cache-ttl-divergence.js` (Q-242) and `check-aest-midnight-timezone.js` (LA-19) both
shipped with the fixes they enforce. The baton's line is about the **queue tooling** — `next-item.js`,
`check-backlog-pointers.js` — not about every script in the directory.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; the new check passes and reports the
  floor in its summary line.
- **Mutation-checked**: re-introducing a single `/40` makes the script exit non-zero and name the
  file, line and measured ratio. Stepping one site through 30/40/50/60 reproduced the whole table.
- **Controlled: all 3 unit cases go red** against the unfixed tree. One of them runs the script and
  asserts its summary mentions the floor — the vacuous case is a script that silently stops
  scanning, which would leave the rule intact while enforcing nothing.
- The test reads the exempt list **out of the script** rather than restating it, so the two cannot
  drift.

**Not exercised:** no device sitting. Contrast is computed from the tokens, not sampled from a
screen, and the 412px rendering is unchanged — but the whole point of the calendar fix is legibility
at low brightness on the S25, which only the device can confirm.

<a id="2026-09-22-tn58-comparative-checkin-control"></a>

# 2026-09-22 — TN-58: ask whether today is better or worse than yesterday

**Branch:** `feat/tn58-vs-yesterday-control` · **Lane:** Implementation B · **Version:** 1.465.0

## What shipped

The absolute "perceived recovery" 1–5 produced **two distinct values across 96 check-ins**, sd 0.29,
and **not one of them was touched**. A question with no variance cannot be a target for anything,
which is what blocks TN-33. People order two things more reliably than they score one, so the sheet
now asks for the comparison: **better / about the same / worse than yesterday**, three taps.

`components/checkin/vs-yesterday-picker.tsx` is new; `morning-checkin-sheet.tsx` holds the state,
restores a saved answer, and posts `vsYesterday` straight through. LB-124 had shipped the column,
the Zod schema, both write paths and the local store, and left `vsYesterday: null` in the sheet's
local write with a comment pointing at this entry — that placeholder is gone, because with the real
value in the payload spread beside it, key order would have decided silently which won.

**No default and no pre-selection.** The column has no default for the same reason: a neutral stored
as though it were an answer is precisely the defect TN-57 fixed, and shipping one on the question
written to escape it would recreate it under a new name. There is no `touched` flag either — unlike
the 1–5 scales there is no seeded position for an untouched save to accept, so NULL already carries
"not answered". Tapping the selection again clears it, so a mis-tap returns to unanswered.

It sits **above** the two scales. It is the question this check-in actually wants answered, and one
placed below two the owner has skipped for 81 days inherits their fate.

## The decision the entry left ambiguous

TN-58 says *"replace the absolute scale with a comparative one"* in its proposal and *"keep
`perceived_recovery` as-is and add the comparative field beside it"* in its warnings. **Added, not
replaced** — three reasons: the entry's own scope line says the control "and nothing else";
`perceivedRecovery` feeds `signals.morningCheckin` and shapes the prescription, so retiring its
control silently changes what the engine receives, which is Lane A's surface; and `sleepQualityFeel`
is a different question untouched by the finding. **Retiring the absolute control is a separate
entry conditional on the pass test**, to be filed with the measurement in hand rather than now.

## What is owed, and why it is a `Keep:` rather than a tick

**The two-week pass test cannot be run for a fortnight.** `vs_yesterday` must show **≥3 distinct
values and a touched-rate materially above zero**; the baseline to beat is 2 values in 81 days.
**If it fails, that is the finding, not a defect** — self-report is not available from this owner at
all, which settles TN-33/TN-16/TN-34/TN-55 by a different route. The backlog carries this as TN-58's
`Keep:`, with an explicit "do not quietly re-tune the control and restart the clock".

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean.
- **Unit: 2 of 5 cases discriminate**, stated in the header. Three characterise a component that did
  not exist and Lane A's schema — they pass either way and are there because the design depends on
  them: a 201-that-stores-nothing, or a three-tap check-in rejected as empty, would each stop this
  question producing the variance it exists for.
- **e2e `tn58-vs-yesterday-no-default.spec.ts`** drives the real sheet at 412px and asserts all three
  options open `aria-checked="false"`, that selecting one excludes the others, and that re-tapping
  clears it. It **deliberately does not call `suppressMorningCheckin`** — every other spec suppresses
  this sheet and this one needs it open.

**Not exercised:** no device sitting. The sheet is a daily native surface and this changes what it
asks, so the S25 pass is worth having before the fortnight's clock is trusted.

<a id="2026-09-22-tuning-four-owner-decisions"></a>

# 2026-09-22 — four owner decisions recorded, and three gates lifted

**Branch:** `tuning/record-four-owner-decisions` · **Agent:** Tuning · **Docs-only.**

The owner asked for the open questions as a prompt with recommendations. All four came back as
recommended. Recorded here and on their entries, because the whole reason LA-122 exists is that a
decision living only in a chat transcript dies with the session.

## The decisions

**1. The readiness history is re-derived ONCE, not per change.** Four entries each rewrite stored
readiness days — TN-60 (the rail), TN-6 and BF-13 (the temperature baseline), LA-121. Shipped
separately his history would visibly shift four times over a few weeks with no way to attribute any
change to the fix that caused it. So the code lands in normal separate PRs and
`POST /api/admin/rederive-baselines` fires **once**, after the last of them, dry-run first.

Recorded as LA-122 item **2a**, deliberately **not** as a `Batch:` field: `Batch:` means one PR, and
one PR here would bundle three code changes with an owner-fired production data write, which the
standing rules forbid batching. The shared thing is the recompute run, not the diff. Whoever ships the
last of the four says in its PR that the recompute is now owed.

**2. TN-60 — build the compressive tail.** Keep the linear region as it is; replace the hard clip at
±1.5σ with a curve that keeps compressing, so the 38% of days currently pinned at a rail keep their
ordering instead of collapsing onto 0/100. Gate lifted; it is now Lane A's READY #1. The
per-contributor-quantile option is recorded as considered and not chosen.

**3. TN-55 — ship the Body Battery structure now, re-sweep after 2026-10-04.** He accepted two
re-scores as the price of not leaving the battery a countdown for another fortnight. The four
structural changes take days-ending-at-zero from 66% to about 5% and do not depend on the exact
constants. **This is not in the batch above** — it writes `body_battery_daily`, a different table.

**4. LA-121 — do not port the temperature ladder; let `tempZ` stand.** The reason is the part worth
keeping: TN-6 has measured the temperature baseline **0.36 °C too low**, so porting the *sharper*
penalty on top of a wrong baseline amplifies the error rather than adding signal. Temperature already
reaches readiness through `computeReadinessComposite`. If it looks under-weighted after TN-6's rebuild
lands, that becomes a fresh question with data behind it.

LA-122 item 2 is struck as answered; its `Keep:` stands for the remaining items.

## What this changes in the queue

Three gates lifted — TN-60, TN-55 and LA-121 all carry no blocking field now and all three are
startable. LA-121's remaining work should be **behaviour-preserving** dead-code removal (the four dead
branches keep the fallback arm that already runs; the fifth site's dead disjunct simplifies away), and
the entry says Lane A confirms that rather than assuming it — if it does move a stored value it joins
the batched recompute instead of firing its own.

## Noted while checking

`next-item.js` prints only the top 10 of a bucket without `--all`, and lane A's READY is now 31. Two
entries I had just edited appeared nowhere in the output, which reads exactly like "removed from the
queue" until you check the fields directly. Worth knowing before concluding an entry has vanished.

Also seen landing from other lanes: **LA-128**, the check-in route stripping an unknown key instead of
rejecting it — the `.strict()` defect LB-124 found, now its own entry. That is the one that would have
burned TN-58's two-week pass test.

## Not exercised

Nothing runs; this records decisions and lifts gates. No measurement was taken today beyond confirming
which entries carry a recompute — the four decisions rest on measurements already filed
(`hrvBalance` railing on 38% of days, the battery's −29.8/day net, the 0.36 °C baseline offset).
`pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates at 398 entries.

<a id="2026-09-22-tuning-hrv-rail-and-marker-guard"></a>

# 2026-09-22 — the rail is where readiness loses its information, and the marker defect reappeared overnight

**Branch:** `tuning/unpark-lb124-and-guard` · **Agent:** Tuning · **Docs-only.**

## The update: a correct catch against yesterday's filing

Lane B took TN-58 off READY and filed **LB-124**, because TN-58 said *"add the comparative field
beside `perceived_recovery`"* and that field exists nowhere — no column, neither Zod schema, not the
route. TN-58 named TN-57 as its engine half; TN-57's own entry says it ships **no migration**. So the
two entries I filed together left the chain unbuildable, and LB-124 says so plainly: *"Read TN-57's
scope rather than TN-58's description of it."* That is the lane system working, and the catch is right.

LB-124 also found something I would have burned two weeks on: `Body` in the check-in route is **not**
`.strict()`, so a sheet posting an unknown `vsYesterday` gets **201 and writes nothing**. TN-58's
pass test would have read "self-report is not available from this owner" when the truth was a dropped
field.

**And LB-124 was itself parked on arrival**, by a prose marker reading *"the failure mode is SILENT,
which is why this is filed rather than attempted"* — an explanation of why it was written up, not a
statement that it cannot start. Lane B's entire READY list went to zero. Unparked here; it is now
Lane A's #2, and the TN-58 chain is alive again.

## TN-60 — the readiness composite's weights are not what it says

Variance decomposition of 69 stored days (2026-07-16 → 2026-09-22), weighted sd of each contributor's
score as a share of all movement in the final number:

| contributor | declared | sd | share of movement |
|---|---:|---:|---:|
| **hrvBalance** | 0.15 | **35.8** | **22.8%** |
| previousNight | 0.16 | 23.6 | 16.0% |
| restingHeartRate | 0.15 | 24.7 | 15.7% |
| sleepBalance | 0.10 | 32.6 | 13.8% |
| recoveryIndex | 0.09 | 28.0 | 10.7% |
| temperature | 0.10 | 16.6 | 7.0% |
| checkin | 0.10 | 15.2 | 6.5% |
| prevDayActivity | 0.09 | 12.1 | 4.6% |
| activityBalance | 0.06 | 11.1 | 2.8% |

`hrvBalance` carries half again the influence its weight says; `activityBalance` half of its. Nobody
chose that distribution — it falls out of the contributors being measured on rulers of different widths.

**The mechanism is the rail.** `Z_POINTS_PER_UNIT = 50/1.5` floors and ceilings the score at z = ±1.5.
`hrvBalance` is railed on **26 of 69 days (38%)** — and the z values landing on score **0** span
**−1.63 to −4.37**. A 2.7σ spread renders as one number. On more than a third of days the biggest
contributor to readiness says "as bad as possible" and cannot say which kind of bad.

Recommendation is a compressive tail rather than a hard clip: the linear middle is unchanged, extreme
days keep their ordering, and nothing needs re-fitting. Filed `Gate: owner` because it re-scores
history.

## Two things I checked before believing them

**`recoveryIndex` is `provisional: true` on 69 of 69 days** — which looked like a contributor the app
itself flags as unsettled while scoring it at 9%. It is not a defect: `provisional` there means *the
curve is an approximation*, deliberate and documented, and Q-278 exists because that sense used to be
conflated with "input missing". Dropped before filing.

**`checkin` scores 50 on 19 days with `gap: null`** — which looked like the neutral colliding with a
real `low` reading. It does collide numerically, but the `gap` field separates them correctly (only 2
days are true `no_input`). No defect; the field does its job.

## TN-59 — the marker defect needs a check, because the sweep did not hold

Two days ago a sweep converted 17 prose markers by hand and took READY from 6 to 21. Today: **28
entries still parked by a prose marker alone**, and LB-124 filed and parked within hours. Filed for
Lane O: fail when an entry's only block is a prose marker, baseline the 28 shrink-only.

Its own drafting hit the trap twice, both recorded in the entry because they are the argument for it:
writing the marker character inside backticks parked the entry describing it, and using the
`Reference:` field for background reading filed it under *read, do not build*. **Third field-semantics
slip of the day in my own filings** — TN-56 had the same `Reference:` mistake yesterday. The pattern
is mine, not the tool's, and it is why the check is worth more than another sweep.

## Not exercised

Nothing runs; documentation and queue ordering. The decomposition is read-only over
`oura_daily_derived`, **row-scoped to the owner**, correct here since the claim is about his composite.
**Not established:** whether the rail's cost shows up in any decision the app makes — a railed
contributor loses resolution, but whether that changes a recommendation is unmeasured, and TN-60's
pass test deliberately asks only about the score's own distribution. `pnpm check:rules` **Ran 75 of
75**, all passed.

<a id="2026-09-23-chore-or-129-lane-channel"></a>

# 2026-09-23 — `chore/or-129-lane-channel` (OR-129)

**Orchestrator.** The owner asked for a working system where agents feed off each other's updates,
described precisely: *"Tasks are assigned to an agent's backlog… the agent reads whatever is in its
lane and works off it… Review agent or other agents can assign tasks to device verification agent."*

That is what implementers already do. What was missing was making the lane field able to express it.

## `Lane:` becomes the channel

`DV` joins `A`, `B` and `O` as a value, so **any agent hands work to any other by writing a field**.
Review finds something only the phone can settle → `Lane: DV`. The device agent finds a real defect
→ `Lane: B`. Anyone hits a question needing the owner → `Lane: O`. No message, no handoff doc, no
two sessions awake at once. **The queue is the channel, and an entry outlives the session that
wrote it.**

**`O` and `DV` are strict where `A` and `B` are not.** An unstated lane means *"§3's path rule
answers it"*, and that rule only ever resolves to an implementer — so untagged work showing in both
implementer lanes is the safe failure it was designed as, and the same 400 entries shown to the
Orchestrator or the device agent would bury the few genuinely theirs.

**The letter and the lane are different things**, and `DV-1` is the example that makes it concrete:
found by the device agent, carries `Lane: O`, because the work is the Orchestrator's. The letter
records who found it and never changes; the lane records who builds it.

**A device check is not a lane assignment**, and keeping them apart is the part most likely to be
got wrong later. A shipped entry owing a look keeps its own lane and carries `Verify: device` or a
`Keep:`; `--sittings` gathers those by screen and now orders groups by **queue position**, so
moving one entry up promotes a whole sitting. Merging the two would put a hundred entries in one
lane and tell it nothing about order.

**Cadence** is documented per role: hourly for the implementers and the Orchestrator, on demand for
Device Verification (it needs the phone and the owner present; a timer would fire into an empty
room). **A quiet wake-up is silent** — an agent reporting "nothing to do" every hour trains everyone
to stop reading it.

## Most of this session's other PR was already on `main`

`#1417` landed while this was being written, carrying the harness from `#1411` **plus a real device
sitting**. So a first draft of the standing-role registration was duplicated work and was dropped
rather than merged: `main`'s baton is `docs/agents/state/device-verification.md`, not the
`device.md` written here, and `DV-1` was already taken by a genuine finding (`pnpm ci:local` cannot
pass on Windows, which is where that role always runs).

What survived the reconciliation is what `main` did **not** have: the `Lane: DV` value, the strict
lanes, the `--sittings` ordering, the two README sections, and CLAUDE.md's seven-agent update.
Three planned `DV-` entries were **not** filed — the back-gesture sitting they described had already
run.

## Worth carrying

**The same prefix bug fired twice in one day, and its own file had predicted it.**
`scripts/lib/entry-id.js` opens with the story of `OR-` being added as a role whose letter never
reached the shared list, failing as *"silent deletion, not a wrong label"*. `DV-` did exactly that:
three entries written, the queue total identical with and without them, `--lane DV` printing
*"nothing startable"* while the headings sat in the file. The lane parsed and the id did not — every
piece correct on its own. CLAUDE.md now says outright that a new role's letter goes in that file in
the same PR as the role.

**And the reconciliation itself is the argument for the lane channel.** Two sessions built
overlapping answers to the same request because neither could see the other's unmerged work. A lane
entry is visible the moment it merges, to every session that reads the queue afterwards — which is
the failure mode this PR exists to reduce.

## Not done

- **Gesture navigation is still off on the phone**, which invalidates every safe-area check — the
  single owner action unblocking the largest group of owed checks.
- **`DV-1`** (Windows `ci:local`) is `Lane: O` and unstarted; it blocks the device agent's local
  gate, leaving CI as its only one.
- **The `e2e`-on-device decision is open** — `connectOverCDP` attaches, but the specs write into
  the production account.

<a id="2026-09-23-chore-or-131-drop-handoff-nag"></a>

# 2026-09-23 — `chore/or-131-drop-handoff-nag` (OR-131)

**Orchestrator, Lane O.** The `Stop` hook that warned about context usage is gone, on the owner's
call: *"I don't think we need the handoff hook anymore; this is deprecated."*

## It contradicted the rule it was built to serve

`.claude/hooks/context-usage-warn.mjs` fired at each context threshold with:

> *Wrap up soon: invoke the handoff skill to write `docs/handoff-<date>-<title>.md` (commit + push
> it), then start a fresh session and read that doc first.*

CLAUDE.md now says the opposite, in the session-start rule: **a standing agent is meant to run as
one continuous session per role** — *"rely on Claude Code's automatic context compaction rather than
writing a handoff and spawning a successor just because context is getting long; that keeps cached
tokens working for you instead of resetting them."* Handing off is the exception now — an owner
reset, or a session lost outside anyone's control — not the routine end of a generation.

So the hook was instructing every long-running session to do the thing the contract tells it not to.
A warning that fires correctly and recommends the wrong action is worse than none: it is credible.

## What it was reporting, which is its own small lesson

The message read **"~231% (461k/200k tokens)"**. The hook's own default window is **1,000,000** —
raised from 200k on 2026-08-17 precisely because the smaller number *"reported ~111% at 222k tokens
(22% of the real window) and fired the wrap-up warning while there was still most of a session
left."* Nothing in this repo sets `CONTEXT_WINDOW_TOKENS`, so the 200k came from outside it.

**The hook could not see the number it was dividing by.** A monitor whose denominator is supplied by
an environment it cannot inspect will eventually report a confident percentage of the wrong thing —
and this one did, twice, in opposite directions.

## Removed

- `.claude/hooks/context-usage-warn.mjs`
- the `Stop` entry in `.claude/settings.json` (the `SessionStart` hook that provisions the local
  Postgres is untouched and still the only one)

## On a compaction hook — it would not do anything

The owner asked whether a hook could instead compact the conversation to save tokens while it is
cached. **A `Stop` hook cannot**: it receives the transcript path on stdin and can print, and
nothing more — it cannot invoke `/compact` or any other slash command, which are the CLI's own.

More to the point, **the thing it would trigger already happens.** Automatic compaction is a harness
behaviour and is exactly what the session-start rule tells a standing agent to rely on. A hook here
would be a second mechanism racing the first.

## Not done

Nothing is left behind for a successor to find. The two historical docs that mention the hook
(`docs/handoff-2026-08-17-platform-context-warning-window.md` and the 2026-08-15 history) are
records of when it was tuned and stay as they are — an archive that describes a thing that existed
is not stale.

<a id="2026-09-23-chore-or-132-owner-decisions"></a>

# 2026-09-23 — OR-132a: four owner answers, and a date that was already in the database

**Branch:** `chore/or-132-owner-decisions` · **Lane:** O · docs and queue state only

**⚠ This is `OR-132a`, not `OR-132`.** Lane A filed a real queue entry as `OR-132` the same day
(*"five PRs are dead from the shallow-fetch defect"*) while this work was in flight under the same
number. Theirs is the canonical one — it is in the queue, this never was — so this takes the letter
suffix per CLAUDE.md's duplicate rule. The branch name keeps the old spelling because renaming it
would cost a second PR for nothing.

**`check-backlog-pointers.js` could not catch this**, and that is the point worth carrying: it fails
on a duplicate ID *inside the backlog*, and this collision was between a queue entry and a PR that
never filed one. Two sessions of the same role, neither able to see the other's unmerged work —
the exact shape CLAUDE.md warns about, in the one place the check does not reach.

The owner turned gesture navigation on, which revalidated the largest group of owed device checks,
and asked what else needed unblocking. Four questions went out; all four came back the same sitting.

| # | question | answer |
|---|---|---|
| 1 | DV-6 — a scrim behind the status bar on scroll? | **Gradient, in the shell, once** |
| 2 | LA-126 — the live nutrition targets, or the computed ones? | **"the corrected/calculated numbers only"** |
| 3 | BF-137 — the vial predates its own first dose; which is true? | **Vial opened the same day as dose 1** |
| 4 | How long should a device sitting be? | **45–60 min, clear a whole area** |

`Gate: owner` count: **104 → 102**.

## What changed

**DV-6 released.** A gradient rather than a solid strip, so the app stays edge-to-edge; in the shell
rather than per screen, because a per-screen rule is one every future screen can forget — which is
how this reached a device sweep in the first place.

**LA-126 released, with a constraint the answer created.** The owner wants the computed targets, and
**LA-125 now has to ship first**: the recommendation route serves 42 g fat / 143 g carbs where
`calculateBaseline` computes 39 / 150, so applying today would hand him the clamp's numbers while
telling him they are the baseline's — the one thing he did not ask for. Sequence is LA-125 → RV-66
re-run → he applies.

**The decision does not authorise a write to his data, and the entry's own instruction stands.** He
chose the outcome, not the mechanism. `nutrition_targets` is production data; the apply is one tap
in the sheet and it is his. He is moving 1,660 → 1,359 kcal and 150 → 111 g protein, which is a real
cut of three weeks' eating, not a correction.

**LA-125's own gate released too.** It existed so the owner saw the fat number before it shipped;
he now sees it at the point that matters — the sheet shows 39 g before the tap. A gate whose
protection is already built into the flow it guards is ceremony. The structural half (which formula
is authoritative) was taken here rather than put to him: **move the 0.6 g/kg floor into
`calculateBaseline`**, so the baseline is already safe and the clamp becomes a redundant guard
rather than a second opinion. Deleting the floor instead is rejected outright — the calorie floor
beside it is load-bearing for every cutting user. Reversal: one function, one test file.

**BF-137 released, and it did not need him for the part it was blocked on.**

## The part worth carrying

**BF-137 had been asking the owner for a date the database already held.** The entry estimated the
first Retatrutide dose at *"around 2026-09-04"* from a window count and named correcting it as the
owner action blocking the build. One query:

| dose | log_date | taken_at (Brisbane) | amount |
|---|---|---|---|
| 1 | **2026-09-07** | — NULL — | 0.5 mg |
| 2 | 2026-09-13 | 20:00 | 1 mg |
| 3 | 2026-09-20 | 20:46 | 1 mg |

The drug start is 2026-09-07, exactly, and was all along. Reading the table before writing the
prompt replaced a three-day-wrong guess with a fact and turned a blocking owner action into a
non-blocking one.

The owner's answer then earned its place on the question the data genuinely could not settle:
`opened_on` said 2026-09-10, three days *after* dose 1, so either the vial date was the auto-set
artefact BF-136 was filed about or dose 1 came from a different vial. He says same day — so the
field is wrong, and BF-184's "dose 1 predates the vial" observation resolves with it.

**Ask for the fact nobody has, not the fact nobody looked up.**

**The durable half:** build the exclusion on the **dose log**, never on `opened_on`. The exclusion
wants when the drug started; the vial field answers when this vial was mixed. They coincide here and
will not on the next vial — and the dose log gave the right date while the vial field was three days
out, which is the argument in one line.

## Not done

- **No code shipped.** DV-6's scrim is Lane B's, LA-125 and LA-126 are Lane A's. This PR records
  decisions; it does not act on them.
- **Dose 1's `taken_at` is still NULL** and nobody knows why the first log took the no-time path.
  That stays open in BF-184 as a code question, not an owner one.
- **The vial's `Opened on` is still 2026-09-10 in production.** Correcting it is one tap in the app
  and it is the owner's; nothing is blocked on it.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, unpiped. Docs and queue state only;
no product code, nothing to exercise on the device.

<a id="2026-09-23-chore-or-134-device-gate-triage"></a>

# 2026-09-23 — OR-134: `Gate: device` was doing three different jobs

**Branch:** `chore/or-134-device-gate-triage` · **Lane:** O · queue state only

The owner asked whether device-testing items had actually reached the DV agent. `OR-133` made them
*visible*; this asks whether the ones now visible are really the device agent's to run.

They are not all the same kind of thing. **`Gate: device` is carrying three meanings that lead to
opposite next actions**, and nothing in the field distinguishes them:

1. **A check the phone can settle** — the entry has shipped or reproduces on the APK. This is the
   Device Verification agent's work and the gate is correct.
2. **A build that has to happen first**, where the phone is how the result is *verified*. The gate
   parks buildable work behind its own verification, so nothing can ever discharge it.
3. **Hardware that is not in the building** — a Colmi R09, not the S25. No sitting and no lane can
   hurry it, and the DV agent cannot touch it.

## Kind 2 — two circular gates released

Same shape as `BF-165` and `LA-49` earlier this month: *a condition for becoming startable that can
only be met by someone who can already start it.*

**`LA-115`** read *"needs a new APK and an on-device Health Connect permission grant"*. Both true,
neither blocking — the fix is a patch to the pinned plugin's `RecordConverter`, Kotlin, compile-gated
in the sandbox like every other `android/**` change. The APK and the grant are how it is **verified**,
and they can only follow the build.

**`TN-44`** read *"every new type needs a plugin patch and a new APK"* — which is a description of
the **work**, not a reason it cannot start. Worse: this entry carries an owner decision from
2026-09-17, eight lines below the gate, **not to block** and to build against synthetic data. A gate
contradicting a decision recorded on its own entry is the clearest possible case of a field nobody
re-read.

Both now carry what is genuinely owed — a `Verify: device` after the build, where the
external-field rule applies: a wrong key reads as `undefined`, so a green build proves nothing.

Gates: **102 → 100.**

## Kind 3 — marked, not released

`PS-8`, `PS-9` and `PS-16` are gated on the **Colmi R09**, which is with a second wearer. The gate is
correct and the entry is genuinely blocked; what was wrong is that it read as owed *device-check*
work, which invites the DV agent to pick it up and the owner to feel it is theirs to clear. Each now
says outright that it is not an S25 sitting and is waiting on hardware returning.

## The finding I did not act on, and why

**Three entries carry a bare `Gate: device` with no reason after it** — `Q-168`, `Q-7b`, `PS-12`. A
gate with no clause cannot be evaluated: it does not say whether the phone is needed to build, to
check, or because hardware is missing, and those lead to three different next actions.

**Deliberately not released.** Two of their neighbours turned out to be circular and one guards
hardware that is not here — so un-gating on the assumption that this one is circular too would be
exactly the unchecked move that created the problem. They are flagged where the next person to touch
them will read it: write the reason or remove the gate.

That is the general rule worth keeping: **a gate is a claim, and a claim with no reason attached
cannot be discharged by anyone except the person who wrote it — who is gone.**

## And the half of OR-130 I missed, found by its fourth occurrence

The gate run for this PR failed on `app/api/user/goals/route.ts` — byte-identical to `main`, named
as this branch's new violation. That is OR-130's bug, whose fix shipped this morning.

**The fix did not fire, and the log proved why: no warning appeared.** So the base read did not
fail. OR-130 instrumented `fileAtBase`, the path where a *per-file* read fails. **That is not the
path that fires.** When no base ref resolves at all, `fileAtBase(null, …)` returns `null` without
consulting git — so no per-file warning can exist — and `verdict` turns that `null` into `'fail'`.

The ratchet then runs in **absolute mode** while its output still reads as a judgement about the
branch. Four occurrences, and every one of them spent its diagnosis on the wrong half.

`resolveBaseRef` now says so when it comes up empty, naming the refs it tried. **No verdict changes**
— absolute mode is stricter than the base-aware one and stays exactly as it is. What changes is that
a reader can tell which mode produced the answer in front of them, which is the whole of the defect.
The ref list is injectable so the path is testable; callers pass nothing.

**This does not belong in a docs-only triage PR** and is here because it blocked it: the gate could
not go green without it. Said plainly rather than filed as a tidy coincidence.

### Then the flake hit a fifth time, and the reason no warning ever fired is measured

`execFileSync`'s return value is **stdout only** — verified: a child writing to stderr does not
appear in it. The ratchet scripts are spawned that way by their own tests, and
`strict-schema-inert.test.ts` asserts on exactly that return value. **So a warning written to
stderr cannot appear in anything that test sees or reports.**

Across five occurrences, *"no warning fired"* was taken as evidence **three times** — including the
conclusion earlier in this very entry that the no-base path must be the one firing. It was never
evidence. The diagnostic was being written where the observer structurally could not look.

Both warnings move to stdout, with two tests pinning it: one proving `execFileSync` drops stderr,
one proving a spawned `base-ref` run reports its warning. **No verdict changes** — this is where the
message is written, not what the ratchet decides.

**A diagnostic in the wrong stream is worse than none, because its silence reads as information.**
That is the lesson of OR-130 and OR-134 together: OR-130 built the warning and this is the first
occurrence where anyone could have read it.

**The flake itself is still undiagnosed** at five occurrences. What changes is that the sixth will
say something.

## Not done

- **The other 18 of the 24 are not individually classified.** The three kinds are now named and the
  clearest cases of each are fixed; the rest need the same read and it is real work, not a sweep.
- **No product code**, no device run, nothing to exercise on the S25.

## The compaction sweep rode along, because the gate said it was mine

The entries directory hit **61 against a 60-file runaway limit**, and the check named the reason
this PR had to deal with it: *"This branch adds 1 of them, so the sweep is yours: you are already
here."* A threshold that lands on whoever happens to cross it is the right design — it cannot
accumulate into a chore nobody owns.

`node scripts/fold-journal-entries.js --limit=25` (dry-run first) folded 25 entries into
`history-2026-09-23-folded-1.md`, held back 6 cited by an agent baton, and rewrote citations in two
domain indexes. 73 → 48 loose entries.

The script's closing instruction is worth repeating because it is the right instinct: *"now run
`check-doc-links.js` and fix what it names — do not reason about which links moved."* Run: **OK, 838
files checked.**

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps. Full log kept, not tailed.

<a id="2026-09-23-chore-or-135-assign-every-entry"></a>

# 2026-09-23 — OR-135: the DV lane has work in it for the first time

**Branch:** `chore/or-135-assign-every-entry` · **Lane:** O · queue state + one rule

The owner asked for everything to be assigned to an agent, with device work reaching the DV agent.
`node scripts/next-item.js --lane DV` now prints **9 READY**. It printed 0 before.

## The rule, in his words

> *"Only device testing that can be done by DV goes to DV; if its device testing based on
> looks/design that should stay in orchestrator waiting for user input."*

So a lane names who acts **next**, and for the device that means what the phone can **answer** —
a measurement or reproduction with an objective pass/fail — rather than everything the phone is
involved in. A judgement about looks or layout goes to the Orchestrator and waits for him, even
though the phone is where he will look at it. `DV-6`'s status-bar scrim was correctly his call.

## What actually moved, and it is smaller than the first plan

**16 entries carried no lane at all** — every one a `DEVICE PROBE`. They split:

- **9 outstanding → `DV`.** Each states it has no build half and names its own method. The
  measurement is the deliverable.
- **7 already run on the S25 → `O`.** Their results are recorded in the entry; the device is no
  longer what they need, their findings need filing. **Re-running a probe that has answered is the
  device agent's time spent on a question nobody is asking.**

`Q-253` (a paid real-hardware device farm) is **struck** — owner: *"Drop it — the real S25 is
better."* It was filed before the DV agent existed; breadth across devices he does not own loses to
the one device he does.

`PS-8`, `PS-9`, `PS-12`, `PS-15`, `PS-16` stay queued, marked **waiting on hardware, not on the
device agent**. They name the Colmi R09, not the S25, and the owner confirms it is coming back.

## Three traps, each of which mis-assigned real entries

**(a) "The agent can run the check" is not "the entry belongs to DV".** `RV-143` — Review's
independent filing of this same finding, hours earlier — listed ~13 entries as runnable by the
agent. **Three of three I sampled should not go to DV:** `Q-418`'s remaining work is Kotlin and an
APK, `LA-36`'s is a local-store read mapper, and `BF-49` was already reproduced on device pass A2,
so its next act is Lane B's fix. Bulk-applying that list would have mis-assigned about a dozen
entries — and RV-143's own text says to read each against its entry rather than trust the split.
It was right.

**(b) A probe that has already run is no longer DV's.** Seven of sixteen, which nothing in the
queue distinguished.

**(c) The `Verify:` field was doing the opposite of its job on these entries.** It means SHIPPED,
so the 9 outstanding probes filed under *"done; a look is owed, nothing is blocked"* — which is
exactly why the DV lane read 0 while holding its entire queue. The field is replaced with plain
prose naming the measurement as the deliverable. **This is the mirror of RV-143's warning** (never
convert a gate into a verify to gain visibility) and rests on the same reasoning: that field is a
claim that work has shipped, and applying it to unbuilt work hides the work.

## One mistake worth recording

The first pass at this corrupted seven entries: I built a list of regex matches and then mutated
the string inside the loop, so every insertion after the first landed at a stale offset — one
spliced into the middle of the word MEASURED. Reverted and redone iterating in reverse. **It was
caught by reading the result rather than by any check**, which is the argument for looking at what
a bulk edit actually produced.

## The DV lane gaining entries broke a test, and the test was the wrong one

`next-item-visible-silence.test.ts` — written this morning for TN-61 — asserted that `--lane DV`
output *"does not contain `showing`"*, using DV as its everything-fits case **because DV was empty
at the time**. The moment it held 9 entries the assertion failed, on this: `RV-128` is titled
*"does the tab switch drop a frame **showing** neither panel?"*

A substring assertion over a report that prints **user-written titles** is a false positive waiting
for someone to write the word. It now matches the truncation line's actual shape and checks the
READY count is genuinely under the cap, so it tests the behaviour rather than a word.

Worth noting against the entry it came from: TN-61 was about a tool whose silence could not be
distinguished from absence. Its test then made the mirror error — asserting on a token that could
appear for an unrelated reason.

## Not done

- **The remaining ~107 device checks still sit on their building lanes.** That is correct for most
  of them by trap (a) — the next act is a fix, not the phone — but each needs its own read, and
  that is real work rather than a sweep.
- **`RV-143` is not struck.** Its tooling half shipped in OR-134; its triage stays as reference,
  now with the caveat that its axis is not the lane axis.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 76 of 76** Custom Rules steps. Full log kept, not tailed.

<a id="2026-09-23-chore-or-136-device-gate-reasons"></a>

# 2026-09-23 — OR-136: the three gates with no reason, and a gate that blocked its own lane

**Branch:** `chore/or-136-device-gate-reasons` · **Lane:** O · queue state only

`--lane DV` goes **9 READY → 11 READY, 0 PARKED.** Three entries carried a device gate with no
reason after it; none of the three turned out to mean the same thing.

## The three

**`Q-168` — the reason was written, just not beside the field.** Its own *What is actually left*
section says it plainly: `/coach` and `/coach/confirm/[toolCallId]` are navless full-screen routes
with bottom-anchored controls, the shape that has regressed 11+ times, and the AI Coach section of
the smoke checklist is what settles it. **Reassigned from `B` to `DV`** — that check is one the
phone answers, because a bottom-anchored control either clears the gesture bar or it does not and a
safe-area inset is a number rather than a matter of taste. The cardio-goals half was dropped rather
than built, so nothing waits on Lane B. A FAILED result goes back to B with what reproduces it.

**`Q-7b` — the gate was simply wrong.** Nothing in it is a question the phone answers: ten
`oura_daily_derived` columns have no producer, which is engine work, and the producer they wait for
is the on-device rollup — `Q-545`'s build. Recorded as a dependency on Q-545 instead of a gate
nobody could discharge.

**`PS-12` — already answered.** OR-135 had written its reason the day before (it waits on the Colmi
R09, not the S25). The flag was stale.

## The shape that kept appearing: a gate naming its own lane

Removing Q-168's gate surfaced `DV-8` sitting under PARKED with `Lane: DV` and `Gate: device` — the
device agent's own work, hidden from the device agent by a gate naming the device agent. **A gate
names what someone ELSE must do first. When the lane and the gate name the same actor there is
nothing to wait for**, and the entry is simply that actor's work.

Filed by the device agent itself, which is how easily this hides. Q-168 acquired the same shape the
moment it moved to DV, and removing it there was the fix rather than a second thought.

## And then a decorative glyph parked it

With the gate off, Q-168 moved to **UNMIGRATED MARKER**. Its line opened `⛔ Device verification —
the blocking one`, and the queue parser reads that glyph followed by *block* within forty characters
as a real marker. The glyph was decorative; *"the blocking one"* was prose.

That is **`TN-59`'s class caught live** — an entry parked by a prose marker alone, invisible to
everyone. Reworded rather than left: say what blocks in words, keep the glyph for a field.

## Worth carrying

Three entries, one symptom, three different causes: a reason written in the wrong place, a gate that
was factually wrong, and a flag that was already stale. **Bulk-releasing them on the assumption they
were all circular would have been wrong twice**, and OR-134 said so when it declined to guess. That
restraint is what this entry spent.

## The same test broke again, for the same underlying reason

`next-item-visible-silence.test.ts` failed a second time in two passes. This morning it asserted the
DV output *"does not contain `showing`"* and went red when `RV-128` — *"does the tab switch drop a
frame **showing** neither panel?"* — entered the lane. I fixed that by matching the truncation
line's shape, **and left the other half of the mistake in place**: it still used DV as its
everything-fits case, hard-wiring the fact that DV was small. Today DV reached 11 and it went red
again.

Both failures are one error: **the test encoded a fact about the data rather than the behaviour.**
It now asserts the invariant across every lane — the truncation line appears if and only if the cap
hid something, and its total matches that lane's READY count. **A test that names a lane is a test
that expires.**

## The finding I was about to file already existed

Q-7b's body carries a paragraph reading *"New detail worth chasing separately: `/api/training-stress`
does compute and persist an OTS, yet `training_load_ots` is empty across the entire history"*. It
reads as an unfiled finding, and the No-orphaned-findings rule says an unfiled finding is a dropped
one — so the plan was to open an entry for it.

**It is `Q-270`, and Q-270 is far past that note.** 🔴, re-measured **0 of 104 days** on 2026-08-30,
with all four gates ruled out individually *and* the MET gate shown to clear by ~12:07 local rather
than late evening. A new entry would have been a worse duplicate of a well-developed one.

**The only thing that stopped it was grepping the column name before writing.** Q-7b now points at
Q-270 outright, so the next reader does not make the same move. **A paragraph that reads like an
orphan is not evidence of one** — the rule says file what is unfiled, not file what looks unfiled.

## The prose-marker scan (TN-59), run but not acted on

Scanning for the shape OR-136 caught live — the block glyph followed by *block* within forty
characters — returns **5 entries**: `RV-99`, `Q-538`, `Q-1b`, `Q-34`, `PS-7`.

They are **not one class**, which is why the first pass stopped at the scan.

**⚠ That scan was wrong in two places, and re-running it before acting is what caught it.** It named
five entries; the regex actually matches **seven locations, five of them queue entries**, and the
membership differs. `PS-7` is **not** among them — the fifth is the `▶ Oura on-device models
program`, whose *"activity detection (P3) ⛔ blocked — needs daytime raw motion"* is a genuine
block. Two further hits are in the `## Protocol` and `## Queue` prose, where the marker is being
**documented** rather than used, and must stay.

**More importantly, the remedy count was wrong.** Only **one** of the five was actually parked *by
the marker*: `Q-538`, `Q-1b` and `Q-34` each already carry a real `Gate:`/`Needs:`, so the tool
never reported their glyph at all, and their prose is honest — `Q-538` and `Q-34` genuinely are
blocked, and `Q-1b` is parked twice over (`Gate: owner`, plus a genuine marker further down; its
meta mention is an accurate description, not a defect). **None of those three needed an edit.**

The earlier reading came from `grep -B2`, which showed a `Gate: device` belonging to the *preceding*
entry as though it were `RV-99`'s. Reading one entry's own output settled it.

## TN-59, built

`RV-99` was **a false park**: its only reason was *"⛔ The blocking hazard was NOT the one the entry
named"* — a **correction** recording that the hazard the entry had originally named was the wrong
one, which is the opposite of a reason not to build it. No `Gate:`, no `Needs:`. It had been
startable the whole time, sitting in Lane B's PARKED list. Reworded to *"The real hazard"*; Lane B's
READY went **23 → 24**.

One entry is not worth a check on its own. What is, is that the shape regenerates: line 23892 of the
backlog already predicted *"[the entry drops] under UNMIGRATED MARKER the moment its gate came
off"* — which is exactly what `Q-538`, `Q-1b` and `Q-34` will do, since each is held today only by a
gate that will one day clear. So the check earns its place on the three entries that are **currently
passing**, not on the one that failed.

- **`scripts/lib/backlog-entries.js`** — the queue parser, extracted from `next-item.js`. The tool's
  own comments make this argument: `lane.js`, `keep.js`, `reference.js` and `queue-buckets.js` were
  each pulled out to be testable, and the same file records the lane rule being briefly
  re-implemented inline and drifting within a day. A second copy of the `⛔ block…` regex would fail
  more quietly still — an entry parked in one reader and ready in the other.
- **`scripts/check-prose-parked-entries.js`** — fails on an entry parked by the prose marker with no
  `Gate:` and no unmet `Needs:`. **Baselined at zero**, the strongest baseline a shrink-only check
  can have. It reports the *shape* and refuses to guess which kind of marker it is reading — TN-59's
  own load-bearing caution, and the reason the bare-glyph rule was retired at a 75% false-positive
  rate. Wired into Custom Rules: **Ran 77 of 77**.
- **8 tests**, against synthetic queues, because the real backlog is at zero and therefore cannot
  exercise a single judgement the check makes. The offender rule lives in the lib and is *imported*
  by both the check and its tests — the first draft restated it in the test, which is the drift the
  extraction existed to prevent.
- Verified by reverting `RV-99`'s wording and watching the check fail with that entry named, then
  restoring it. A check never observed failing is not a check.

## The goals-route flake — occurrence six, and the first hard evidence

`strict-schema-inert.test.ts` failed again mid-gate, reporting
*"`app/api/user/goals/route.ts` has 1 non-strict request schema(s) and is not in the baseline"*. Run
directly, seconds later, the same check printed **OK — 38 non-strict across 24 files (baseline
held)**.

**Why five occurrences produced nothing.** `execFileSync` returns stdout on success, but on a
non-zero exit it throws an error carrying only the command and stderr — `err.stdout` is a separate
property, and the test printed the error. The base-ref helpers warn on **stdout** by design, so if a
warning had fired it would have been discarded. *"No warning fired"* was used as evidence in three
of the five diagnoses, against a stream nothing was reading. This is the second time in two days
that this property of `execFileSync` has produced a false finding.

`run()` now re-throws with **both** streams labelled. It fired on this run — and the result
**refuted the hypothesis it was added to confirm**:

> **stdout was empty.** No base-ref warning at all.

That eliminates the leading theory. `resolveBaseRef()` returning null warns; `fileAtBase` exhausting
its retries on an unreadable read warns. Neither happened, so the base ref resolved and was read
cleanly. What reached `verdict()` was therefore either **the file reported absent at base** or **a
base count of 0** — and `verdict()` collapses absent, zero and a real number into one word, which is
precisely why six occurrences could not be told apart.

So the check now **reports what it saw**: `(base origin/main: 2 non-strict)` or `(base …: file
absent)` on every failure. Measured immediately after, on a quiet tree: base ref `origin/main`,
file present at 3,870 bytes, byte-identical to the working copy, check green.

**Still undiagnosed, and the trigger is still unconfirmed.** What changed is that occurrence seven
cannot be ambiguous: it will name the base ref and the count that produced the verdict. Two
hypotheses remain open and the evidence does not yet separate them — a concurrent `git fetch` from
another agent moving `origin/main` mid-run, or a genuine transient path-absent from `git show`.

## Not done

- **The remaining ~105 device checks stay on their building lanes.** Most correctly so.
- **`Q-7b`'s separate finding is untouched**: `/api/training-stress` computes an OTS yet the column
  is empty across all history, so its gating conditions are never met in practice — a live route
  returning gated forever, which is a different failure from "no producer exists". It stays in the
  entry, unfiled, and should become its own item.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps (76 before this branch added
`check-prose-parked-entries`). Full log kept, not tailed.

<a id="2026-09-23-device-bf166-mid-workout"></a>

# 2026-09-23 — BF-166 verified in full on the S25, and the leave-workout prompt's *Leave* does not leave

**Branch:** `device/bf166-mid-workout` · **Agent:** Device Verification · **Docs only.**

Second sitting of the day, after #1417. The owner switched the phone to gesture navigation and OK'd
starting a workout on his account for BF-166's last check, on condition it was deleted afterwards.

**What I was on:** S25 Ultra, Android 16, APK 1.460.4, web v1.465.4, portrait, **gesture navigation**
(`navigation_mode` 2 — `probe.js` now reads a **15px** bottom inset, against 48px under three-button),
system back via `adb shell input keyevent 4`, route from `location.pathname`.

## BF-166 — ✅ VERIFIED ON THE S25, and it leaves the queue

Workout → *Start Workout* → session screen → *Start Workout* → countdown → store `mode: "warmup"`:

| step | result |
|---|---|
| back | *"Leave workout?"* raised, route unchanged |
| back again, prompt open | prompt **stays** — the ordering the listener's comment requires |
| *Stay* | prompt closes, still `warmup` |
| back, then *Leave* | store resets to `pre` — and see DV-2 |

With the first sitting's sheet checks (#1417) that is every part of the entry's `Keep:`. Its
Known-Issues row moved to `known-issues-resolved.md`.

## DV-2 — ❌ *Leave* keeps you on the abandoned session's screen

`onLeave` resets the store and calls `history.back()`, but the dialog pushed its own surface entry
when it opened and only **one** pop happens, so the back meant to leave the screen is spent on that
entry. Traced twice with `history` instrumented. BF-165's mechanism in a dialog instead of a sheet,
so it is batched with BF-165 (`back-gesture-sitting`, Lane B). The walk and activity leave dialogs
carry the same `onLeave` and were not device-checked.

## Production data — nothing to delete

Starting a workout is a store-only action; the server hears about a workout only when a set is
logged (`workout_log`) or it completes (`complete_workout`). A `fetch` wrapper logged every non-GET
for the whole test: the only one was `POST /api/ai-periodization/session/<id>/prescribe`, which
opening any session screen sends. `GET /api/workout-sessions/day?date=2026-09-23` returned
`sessions: []` afterwards. Side effect worth knowing: *Start* also calls `cancelWorkoutReminder()`
three times over this test; `reconcileWorkoutReminder` re-arms today's reminder on its next pass.

## Also

- **Node upgraded on the device machine** to 22.23.2 (winget `OpenJS.NodeJS.22`), at the owner's
  instruction; `pnpm exec vitest run` now starts. DV-1's Node half is done here.
- **My first attempt pressed back during the start countdown**, before anything was active — back
  then correctly left the screen. Recorded in the baton so it is not mistaken for a failure again.
- PR #1411 is left for the Orchestrator to close, per the owner.

## Not exercised

The walk and activity leave dialogs, the `active` phase (only `warmup`), any set logging, landscape,
light theme, and every safe-area check (valid now, not yet run).

<a id="2026-09-23-device-first-run"></a>

# 2026-09-23 — First sitting on the real S25: three shipped fixes verified, one bug reproduced, and the harness works

**Branch:** `device/first-run` · **Agent:** Device Verification (new, local) · **Docs + `scripts/device/**`.**

The owner plugged the S25 into a local Claude session and asked for an agent that tests the APK
alongside the Orchestrator. The Orchestrator had already written the harness (OR-127, PR #1411)
without ever seeing a phone, plus a prompt for the role. This session became that role, ran the
harness for the first time, and worked the `back-gesture-sitting` batch plus BF-111.

**What I was on for every result below:** Samsung SM-S938B, Android 16, WebView Chrome 152, APK
**1.460.4** (debug), web **v1.465.4** (production Railway), portrait, **three-button navigation**,
signed in as the owner. System back sent as `adb shell input keyevent 4`. Route read from
`location.pathname` in the page, never an inspector's address bar.

## Outcomes

| entry | outcome | evidence |
|---|---|---|
| **LA-109** | ✅ VERIFIED ON THE S25 | Home → More tab → *Profile details* (`/more/details`) → back → `/more`, More tab active (`text-brand`); screenshot matched |
| **LB-107** | ✅ VERIFIED ON THE S25 | back from `/health`, `/workout`, `/nutrition`, `/more` → `/` each time; back from `/` → focus on the Samsung launcher; relaunch "brought to the front", same pid 5517, same `performance.timeOrigin` — minimised, not finished |
| **BF-100** | ✅ VERIFIED ON THE S25 | `/more` scrolled, *Profile details*, back: 675→675 and 1075→1075, with the system back **and** the page's own back button; repeated after `am force-stop` (1075→1075). Details opened at the top each time |
| **BF-166** | ✅ VERIFIED, except one part | back closed the sheet and left the route alone on `/nutrition` (*My Foods*, *Add food*), `/` (mood check-in — app **not** minimised) and `/program` (*New Program*, where the first back closes the keyboard the autofocused field raised). **COULD NOT CHECK** the mid-workout leave prompt: it needs a workout started on the production account |
| **BF-165** | ❌ REPRODUCED ON THE S25 | Cardio → *Other activity* → *Treadmill*: `pushState(/activity)` at 1754 ms, the sheet's `back()` at **1761 ms**, `popstate` → `/cardio`. The harness saw a 415–428 ms gap; the device gives 7 ms |
| **BF-111** | ❌ the screenshot it waited on | About: `App v1.465.4` ✓, "Up to date — v1.460.4" ✓, **"built 23 Aug" ✗** — the rolling `apk-latest` release's `published_at`; the APK asset was uploaded 2026-09-20 |

LA-109, LB-107 and BF-100 left the queue. BF-165 stays READY for Lane B with the device trace and a
sibling close-then-push site (`components/cardio/time-picker-sheet.tsx`, unreachable on the owner's
account because it only renders without a running plan). BF-111 lost its owner gate and is Lane A
work now (`lib/github-release.ts:86`). Device checks owed: 104 → 100.

## What the protocol-only harness got wrong

It connected first time; the rest is recorded in `scripts/device/README.md` → *What the first run
corrected*. The ones that change what anyone does next:

- **Playwright's `connectOverCDP` attaches** to the WebView (98 ms, `/json/version` exposes a browser
  websocket). So `e2e/**` could run on the real APK — **but the phone is on the owner's production
  account and those specs write**. That is an owner decision, filed in the baton as blocked.
- **Three-button navigation reads a 48 px inset, not 0**, so "non-zero inset" had been taken as
  proof of gesture nav. `probe.js` now reads `navigation_mode` from Android. The phone is on
  three-button, so **no safe-area check is valid yet**.
- **The capture workflow would have published the owner's data.** The runbook said to push
  screenshots to a `device-captures/*` branch; the repo is public and every capture shows the
  owner's account (the first one showed his email). Changed to text-only; `device-probe/` is
  gitignored; `tour.js` says so when it finishes.

## Two traps I walked into, both caught before they became findings

- **`tap()` centres its target, which pins the scroll offset** — my first BF-100 run measured 825→825
  three times because 825 is where centring put the row. It proved nothing. Shift the scroller after
  centring, then tap without re-scrolling.
- **A focus check read `.stdout` off a helper that returns a string** and reported the app as
  backgrounded while it was on screen — which briefly looked like "back from `/health/readiness`
  both navigates and minimises". It does neither wrongly; the check was broken.

## Also

- Windows could not check out `main` at all: a stray file named `ord.endsWith('ss')||` (added by
  accident in #672) has a `|` in it. PR #1414 deleted it (merged the same day, before this
  PR), so a fresh Windows clone checks out cleanly now.
- New role written into `docs/agents/README.md`, `prompts/device-verification.md` and a baton at
  `state/device-verification.md`, with the `DV-` prefix. It runs locally, so its successor is opened
  by the owner, not by `create_session`.

## The local gate, stated exactly

`pnpm ci:local` on this Windows machine: **lint** 0 errors; **`check:rules` — `Ran 75 of 75`, 4 FAIL**
(steps 27, 30, 50, 68), every one a Windows path or shell problem in files this diff does not touch;
**typecheck** clean; **typecheck:tests** `spawnSync npx ENOENT`; **test** could not start
(`rolldown` needs Node ≥ 22.12, this machine has 22.9). Filed as **DV-1** (Lane O). So the test
gate for this PR is CI, and the doc checks were run individually: `check-backlog-pointers` OK
(416 entries), `check-doc-index-size` OK.

## Not exercised

Gesture navigation (the phone is on three-button), safe-area clearance anywhere, offline/airplane
mode, the local SQLite reads, any write path, the mid-workout back, landscape, `record.js` and
`tour.js` (not run yet), and light theme (everything above is dark).

<a id="2026-09-23-device-probe-sitting-2"></a>

# 2026-09-23 — Probe sitting 2: stopped by an incident the harness caused, and the guard that follows

**Branch:** `device/probe-sitting-2` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

Short sitting after the owner reconnected the phone (gesture nav, inset 15 px, web v1.465.4, APK
1.460.4). It was meant to finish BF-61's immediate-tap check and RV-133's 30-minute idle. It did
neither, and the reason is the most important thing in it.

## The incident

To test BF-61 — a swipe-to-delete tray whose first tap used to miss — I sent **raw `adb shell input`
taps and swipes**, which are real touches wherever the coordinates point. During those runs the app
left the Nutrition tab twice (to `/health/activity`, then to `/`) without the scripts noticing,
because the hidden Nutrition panel kept answering their DOM reads. Later raw taps landed **outside
the app**: the owner reported the app closed and another app (Tasks) opened on his phone, and he had
to reopen it himself. Nothing was written to his data — the only raw inputs were swipes and taps on a
diary row and a Cancel — but it was his phone, mid-use, and the harness had no guard against it.

**The fix is structural, not a note to be careful:** raw input now goes only through `rawTap` /
`rawSwipe` in `scripts/device/pw.js`, which refuse unless the app holds the foreground **and** is on the
expected path, checked immediately before sending. The runbook and the baton both say never to call
`adb shell input tap|swipe` directly.

## What was still learned

- **BF-61 is still COULD NOT CHECK**, and the entry now says why the three "failed" immediate taps were
  not evidence: the tray was already open before the swipe, and the tap aimed at the row, not Delete.
  A 1.5 s control tap opened *Edit Serving*, which is how that was caught.
- **Back from the *Edit Serving* sheet is correct** — one push, one pop, still `/nutrition` 3 s later.
- **A second swipe on an already-open tray does not change tab.**
- **Sitting 2's idle census never ran**: after the cold reload, `nav a[href="/"]` matched **two**
  elements and Playwright's strict mode threw. Tab-bar locators are scoped to the visible one now;
  whether the shell really mounts two tab bars after a reload is the first check of sitting 3.

## Not exercised

Everything the sitting set out to do: the idle measurement, BF-61's immediate tap, the remaining
write types, frames and the route census.

<a id="2026-09-23-device-probe-sitting"></a>

# 2026-09-23 — Probe sitting 1 on the S25: BF-177 fails on the device, and why the browser said it passed

**Branch:** `device/probe-sitting` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

First run of the Playwright-over-CDP tooling (#1424) against the phone, working Review's probe
checklist (`docs/device-agent-probe-checklist.md`, RV-124…RV-133). Web v1.465.4, APK 1.460.4,
portrait, **gesture navigation** (bottom inset 15 px), signed in as the owner, with his approval for
five write types, each undone straight after. The phone disconnected before the last steps.

## The finding that matters: BF-177 is FAILED on the S25

Logging a food from the Nutrition tab updates the diary and the ring, and **"kcal left" does not
move** — for 6 s sampled every second, and still a minute later — while the server already has the
right number. With response bodies captured the mechanism is plain: the hook's one-shot balance
refetch fires at the **local** write and reaches the server **~60 ms before the outbox push**, so it
gets the old figure; the correct post-push response arrives ~500 ms later on another subscriber's
request, and the card never takes it. The browser e2e is green because on the web path the write is
an awaited POST. That is the Canonical Runtime rule in one bug: *green on web, wrong on the device.*
BF-177 is back in Lane B's READY with the trace and a fix direction (subscribe the card to the key).

## The rest of the sitting

| probe | outcome |
|---|---|
| P4 layout sweep (RV-127) | Clean on clearance, `truncate`+flex, nesting. Spills looked at and benign. Three 21 px-tall inputs on `/more/details` left unjudged. Found **DV-4**: the Sleep card's Deep hours in `#1e3a70` ≈ 1–1.6:1 contrast |
| P7 console (RV-130) | 0 failed requests. **499+** *"Rendering was performed in a subtree hidden by content-visibility"* — layout forced inside hidden tabs, unattributed |
| P10 long session (RV-133) | Walk half flat by round 3 on heap, listeners, nodes, timers. Idle half not run |
| P3 local store (RV-126) | First read of the on-device SQLite. Tombstones present, food renders offline. Found **DV-5**: pushed rows left `pending` (33 food tombstones, one set) |
| P8 offline (RV-131) | Offline write on screen in 256 ms, queued, pushed 2.0 s after reconnect. No tab blank. No offline banner (probably not reachable by page emulation) |
| P1 invalidation (RV-124) | Food log and delete only → BF-177 |
| P2 fetch-once (RV-125) | Baseline without writes; not a verdict yet |
| BF-61 swipe-delete | Slow tap works; the immediate tap is still owed |
| P5/P6/P9 | Not run |

**DV-6** (owner-gated): scrolled content passes under the status bar's clock with nothing behind it.

## Harness, as used

Four fixes, all in `scripts/device/`, and each recorded in the README's new section: `home()` returns
through the router (four back presses after a sweep landed on `/cardio`); the sweep measures the
touch box, not the ink, and compares clearance with a 0.5 px tolerance; `census.js` records metrics
per round; `recordNetwork({ bodies })` keeps response bodies. `selftest.js` still 18/18.

## Production data

Five food writes over the sitting — log, delete, log, delete, offline log, delete — **all deleted**.
Afterwards the server returned **no Cocoa logs** for 2026-09-23 and intake back at **434 kcal**.

## Not exercised

The other four write types, every surface off the Nutrition tab except Home's card, the 30-minute idle,
the offline restart, frames (P5/P6), the route census, and light theme.

<a id="2026-09-23-device-probe-tooling"></a>

# 2026-09-23 — The probe tooling, built and self-tested while the phone was unplugged

**Branch:** `device/probe-tooling` · **Agent:** Device Verification · **`scripts/device/**` + docs.**

The owner asked what was waiting. Nothing was assigned in `Lane: DV`, but **111 device checks are
owed** (`--sittings`) and Review had filed **RV-124…RV-133** with a full method doc,
`docs/device-agent-probe-checklist.md` (P1–P10). Most of those probes need the network layer, the
local store, offline switching or long-session counters — none of which the harness had. So this
session built them, with the phone unplugged, and the owner approved all five write types the
write-based probes need (each deleted straight after).

## What was built

- **`pw.js`** — Playwright's `connectOverCDP` on the WebView socket, as the probes' driver. `tap`
  keeps the hit-test-before-touch rule and drops the centring that pinned BF-100's first
  measurement. Adds `recordNetwork` (over CDP, for initiator stacks), `recordConsole`,
  `watchAfter` (P1), `offline` (P8), `metrics` + `instrumentTimersAndReload` (P10), and a
  read-only `localQuery` against the app's own SQLite (P3).
- **`sweep.js`** — P4: bottom clearance against the real inset, horizontal overflow, sub-44px
  targets, `truncate` on flex, nested interactives. Reads the nav mode and refuses to vouch for
  clearance off gesture nav.
- **`census.js`** — P2, P7 and P10 in one tab walk: per-endpoint request counts by visit, every
  non-2xx and console message grouped, heap/listener/timer counts at start, end and after idle.
- **`selftest.js`** — all of the above against a local fixture in desktop Chrome, through the same
  `connectOverCDP` path. **18 of 18 pass.**

## The e2e question, answered

The owner asked whether running `e2e/**` on the phone was worth it. **Not as it stands**: 62 of
121 specs read or write the local test database, ~80 assume the seeded account, and the suite signs
in — which on the phone means signing the owner out, and sign-out wipes the device's local data.
What *is* worth it is Playwright as this role's driver, which is what `pw.js` is. A small
read-only phone regression pack stays optional, after the probes.

## Not exercised

Everything on the phone: none of `pw.js`, `sweep.js` or `census.js` has run against the WebView.
`localQuery` has only been seen refusing a write and reporting a missing plugin; whether the
plugin answers a query on the app's open connection is unknown. Whether `offline(true)` reaches the
service worker's requests on this WebView is unknown.

<a id="2026-09-23-device-sweep-1"></a>

# 2026-09-23 — Device sweep 1: the performance baseline, the approved writes, and a slowdown that builds with use

**Branch:** `device/sweep-1` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, web v1.465.10, APK 1.460.4, gesture navigation, owner's account. Run on his go-ahead with
his decisions recorded in `docs/device-sweep-1-plan.md`: weigh-in and mood overwrite accepted, only
the writes the checks need, the owner-present OS block skipped. The phone showed 🔴 throughout and 🟢
at the end.

## Performance — the first baseline this app has had

| probe | result |
|---|---|
| **P11 cold start** (RV-137) | first contentful paint **1020 ms**; tabs show content 61–103 ms after it, settle ≤ 1.4 s (Workout) |
| **P12 distribution** (RV-138) | **90 warm visits, no outlier** — every first visit ≤ 1.3× its route's median, slowest 164 ms. Q-51's 1086 ms did not recur, so by its own rule Q-51 should be re-placed, not built |
| **P13 waterfall** (RV-139) | Home fetches `/api/workout-data` twice per visit; Home and Health each have one 2-deep chain; the rest are flat |
| **P14 long tasks** (RV-140) | **every tab tap = one 68–118 ms task** in React's delegated click handler; scrolling produces none; `animationiteration` no longer shows at all |
| **P15 paths** (RV-141) | back stack correct in 2 presses; **RV-110 and RV-112's fixes hold** (same document across a cross-tab jump; separate scroll offsets) |
| **P16 + P10 long session** (RV-142, RV-133) | tab paint **61–103 ms → 126–434 ms after ~2 h of use, 134–449 ms after 30 idle minutes**; listeners 608 → ~2,200, flat while idle. Evidence for BF-22 |

## Writes (all undone, server checked after)

- **Food log + delete:** **DV-5's fix verified** — the new tombstone is `synced` straight after the push.
  **BF-177 still reproduces** on v1.465.10.
- **Weigh-in (RV-108):** logged today's own 69.4 kg. A weigh-in clears **3 of 202** cache keys. The
  local row kept every other column — `upsertBodyMetric` merges, so CLAUDE.md's warning about
  `metric-log-sheet` is stale.
- **Supplement tick (BF-185):** a re-ticked dose gets **`taken_at: null`**, not a rewritten time.
- **RV-45 verified and removed:** supplement and injury deletes, online and offline, no error toast.
  Filed alongside: **DV-10** (supplement deletes never tombstone locally) and **DV-11** (Manage
  Supplements' switches have no accessible name).
- **Mood (LB-116):** could not check — the sheet is unreachable once today's check-in is logged.
- **DV-4 verified and removed:** the Sleep card's hours now print in the foreground colour.

## Corrections I owe

- **DV-8's two headline claims were my misreading in sitting 1**: the session is in the local table,
  and the "server id" was the program session that `/api/workout-sessions/day` returns as
  `sessionId`. Corrected on the entry. A first pass today repeated the same misreading across 12
  sessions and was caught before it was filed — the repeating ids gave it away.

## Harness

`perf.js cycles` now saves per route and records a mid-visit reload instead of crashing (the first 70
visits were lost to that). Git Bash rewrites `/`-leading arguments — use `MSYS_NO_PATHCONV=1`. Both in
the runbook.

## Not exercised

The 53 automatable screen checks (block 4), admin (6) and resume (7), frames/paint (3) — next sitting.
Light theme, landscape, real airplane mode, and anything needing hardware.

<a id="2026-09-23-device-sweep-2-plan"></a>

# 2026-09-23 — Sweep 2 planned as stations: one visit, many entries

**Branch:** `device/sweep-2-plan` · **Agent:** Device Verification · **Docs only.**

The owner asked what could be combined into a larger device pass. Re-reading the queue against sweep
1's table: of the checks the phone alone can settle, **~45 automatable and 8 write checks** group into
**eight stations** — one screen and at most one write cycle each — in `docs/device-sweep-2-plan.md`.
The largest is Nutrition: about sixteen entries share one visit and one food + one saved-meal
log/delete. About 3 h 45 min in all. Everything that needs a morning before check-in, the owner
changing phone settings, hardware, a declined write or a design judgement is listed as out of the
pass, with what each needs.

**Queue hygiene in the same PR.** RV-137, RV-138, RV-140, RV-141, RV-142 and RV-133 were fully measured
in sweep 1 and RV-139 all but its byte half (invisible through the service worker), so all seven
leave the queue; their numbers are in `2026-09-23-device-sweep-1.md` and on Q-51 and BF-22. The one
result with no other home — **every tab tap is a 68–118 ms long task** — is filed as **DV-12** (Lane B).
The removal refused any entry whose span held a `## ` line, the shape that split BF-165 in sweep 2.

<a id="2026-09-23-device-sweep-3-plan"></a>

# 2026-09-23 — Device sweep 3 plan

**Branch:** `device/sweep-3-plan` · **Agent:** Device Verification · **Docs only.**

`docs/device-sweep-3-plan.md`: six stations, about 2 h 30 min. They cover the three shell probes and
DV-12's profile, RV-125's write half, DV-8, the sweep-2 nutrition leftovers (BF-95, BF-61, BF-12,
BF-161, BF-49), the workout cards (Q-300, OR-118, Q-305) and BF-147. `/admin/oura-ble` stays closed
until DV-13 is closed. The phone is on three-button navigation, so inset checks are left out rather
than failed.

<a id="2026-09-23-device-sweep-prep"></a>

# 2026-09-23 — Sweep 1 prepared: the performance probes built, every owed device check read

**Branch:** `device/sweep-prep` · **Agent:** Device Verification · **Docs + `scripts/device/**`.** The
phone was unplugged throughout; nothing here touched it.

The owner asked for everything needed to run one large sweep, and to wait for his go-ahead.

## The plan — `docs/device-sweep-1-plan.md`

Every one of the **116** entries `next-item.js --sittings` lists was read against its backlog text
and bucketed by what the sitting can actually settle: **53 automatable, 9 pre-approved writes, 9
writes needing the owner, 18 hardware, 6 owner judgement, 21 not really device checks** (a diff
against the runner's list: none missing, none extra). Plus Review's Part B, P11–P16. Ordered into
ten blocks, about three hours, with the owner-present block optional.

**Two writes are riskier than "approved" suggested**, and the plan asks rather than assumes: a manual
weigh-in **overwrites the day's real weight** and outranks the scale afterwards, and a mood check-in
is one per day, so a test would overwrite the owner's real answers if he has already checked in.

Found while building it, recorded in the plan for the Orchestrator: BF-107 and LA-57 still print as
owed though one is closed and one refuted; BF-95's failure note reads like BF-61's symptom; BF-99's
line lives in `calorie-zone-bar.tsx`; BF-139/BF-96 would only repeat a failure nothing has fixed.

## The tooling — `scripts/device/perf.js`

`coldstart` (navigation and paint entries after a real cold start, then each tab's first visit),
`tti`, `cycles` (the full list of mount durations per route, never a mean — RV-138 decides Q-51 on
it), `longtasks` (long tasks plus long-animation-frame script attribution, for the old
`animationiteration` finding) and `backstack` (guarded; stops at Home). Every visit is measured the
same way — ms to content (no loading block, real text) and to settled (no `/api` in flight for
400 ms) — and carries its request waterfall and long tasks, so an outlier can be read as network,
thread, both or neither.

**One thing the self-test caught before the phone could:** the serial-chain detector compared a
request's start with the previous one's *load end*, but `fetch` resolves on headers, so a chained
request starts before the body finishes and the chain was invisible. It now chains on
response-received. `selftest.js`: **22 of 22**.

`pw.js` also gained request timings and bytes, and **`back()` now refuses when the app is not in the
foreground** — KEYCODE_BACK goes to whichever app holds the screen, the same hazard as sitting 2's
blind taps.

## Not exercised

All of it on the phone. `perf.js` has only run against the desktop fixture.

<a id="2026-09-23-docs-lb135-mockup-back-to-orchestrator"></a>

# 2026-09-23 — LB-135: hand the IA mockup back to the Orchestrator, and undo a deletion I caused

**Branch:** `docs/lb135-mockup-back-to-orchestrator` · **Lane B** · docs-only

## The correction that unblocked this

LB-135 was filed saying the 2026-09-22 mockup was lost. **The owner corrected that: it is in the
Orchestrator's chat.** So it is an EXPORT gap, not a design to redo — that session still holds what
he approved, and the recovery is cheap.

RV-117, RV-118 and RV-119 are re-channelled **`Lane: O`**, asking the Orchestrator to save the
mockup under `docs/design/` and set the lane back to `B`. The queue is the channel between agents;
there is no messaging and no two sessions awake at once, so the `Lane:` field *is* the handover.

The proposed rule stands and is worth more, not less: a mockup living only in one session's
transcript is invisible to every other agent and to the owner later. The repo is the only shared
memory.

## ⚠ A deletion I caused, found and undone here

**PR #1481's auto-merge of `docs/implementation-backlog.md` silently deleted RV-117 and RV-118** —
two Review-filed entries carrying owner-approved gates. Present at `ef199122700`, gone at
`5ed93e4b1a9`.

Both are restored from `ef199122700`, with the handback bullet applied. Verified by heading parity:
the only difference from the pre-damage file is the intended addition of LB-135.

**Why my verification missed it.** After that merge I counted the headings I had *touched* —
RV-116, RV-119, LB-135 — and all three were present, so it read as clean. Counting what you edited
cannot see a neighbour that vanished. The check that does:

```
diff <(git show origin/main:docs/implementation-backlog.md | grep "^### " | sort) \
     <(grep "^### " docs/implementation-backlog.md | sort)
```

Every line of that diff must be an add or a remove you intended. Recorded in the Lane B baton.

This is the class CLAUDE.md already warns about from the other direction — a backlog conflict is
usually two deletions, and "keep both" resurrects shipped entries. The mirror case is just as real:
an auto-merge that keeps one side drops the other side's entries with no marker to notice.

## Also here

- **RV-116 removed from the queue.** It shipped in #1481 and its own `Keep:` says nothing is owed,
  so leaving it was wrong — a finished entry must not still print as READY.
- **Doc-size baseline raised back**, with the reason in `docs/doc-size-baseline-history.md`: the
  baseline had ratcheted DOWN to match my deletion, so restoring the entries is an undo rather than
  growth.

## Verification

`pnpm check:rules` **Ran 77 of 77** · backlog-pointers clean · doc-size clean · full heading diff
shows exactly the three intended changes (+RV-117, +RV-118, −RV-116). Docs-only: no code touched.

<a id="2026-09-23-docs-or-126-raw-archive-brief"></a>

# 2026-09-23 — OR-126: the raw-archive brief, and the premise it found had moved

**Branch:** `docs/or-126-raw-archive-brief` · **Lane:** O · docs only

Q-29 Task 5 proposes dropping the server-side Oura raw archive. It was put to the owner as a
yes-on-principle; he asked for the case first, which made the missing brief our debt rather than his
indecision. This is that brief —
[`docs/oura-raw-archive-retention-brief.md`](../oura-raw-archive-retention-brief.md).

**It recommends keeping the archive**, and OR-126 explicitly allowed that outcome: the entry's own
instruction was *"do not write this as an argument for the drop"*.

## The brief answered a question that had changed underneath it

Q-29 Task 5 names `oura_raw_samples.body_hex` as *"the archival source of truth"*. That was true
when written and stopped being true when the packer shipped (Q-541 Task 4). Measured 2026-09-23:

| | rows | role | payload | span |
|---|---|---|---|---|
| `oura_raw_samples` | 189,263 | **7-day hot window** | 4.5 MB hex | 8 days |
| `oura_raw_packed` | 1,467 | **the archive** | 25 MB blob | 1,811,765 frames |

**So Task 5 as written would drop a week-long scratch buffer.** The packer moves each sealed bucket
into one compressed blob and proves it first — insert, read back out of the database, unpack, prove
the frames equal, and only then delete. Readers span both tiers, so nothing outside the packer knows
which side a frame is on.

## Two more load-bearing facts had moved

**The device's 14-day window has not shipped.** `pruneRaw` has no caller anywhere in the app, and
its predicate needs `rolled_up = 1`, which only D2 Task 5 sets. On-device 2026-08-18: **209,326
rows, 0 rolled up, 31.2 MB**, growing ~3.4 MB/day and past Android Auto Backup's 25 MB quota, so
none of it is backed up. The "what survives on the device" half of the trade does not presently
exist. This was already in `projectOverview.md`; nothing had connected it to Q-29.

**The 76 MB that makes `oura_raw_samples` look expensive is 45 MB of index plus bloat against 4.5 MB
of payload.** That is BF-106's `VACUUM FULL` — a *larger* lever than this one that loses nothing,
and one the owner has already deferred rather than declined.

## The cost, so nobody re-derives it

Railway bills on use at $0.15/GB/month. The archive is 25 MB = **$0.004/month**, growing 0.72
MB/day, so **$4.66 a year ten years out**. Reversal cost of dropping: none, ever — the ring's
cursor only moves forward and cannot be rewound. The brief says outright that this is not a cost
problem rather than implying a saving.

## What changed beyond the brief

- **`CLAUDE.md`'s raw-archive rule was wrong** and had been since the packer shipped. It named
  `body_hex` as the server's source of truth, which pointed every session at a 7-day scratch buffer.
  Corrected, with the device half beside it: do not cite the device as a surviving copy until the
  window lands.
- **Q-29 now carries a reconcile rather than a question.** Per the backlog protocol's re-verify
  rule, a task whose three load-bearing facts have all moved is reconciled before anyone builds from
  it. Asking against a stale premise is worse than not asking, because the answer would not mean
  what either side thought it meant.
- Linked from the devices domain index, positioned ahead of the older docs that still describe the
  single-tier model.

## Not done

- **Q-29 Task 5 is not rewritten or struck** — that is a decision about the task, and it belongs
  with whoever next touches the D-track, not to a docs PR that happened to notice.
- **The owner has not been re-asked**, deliberately. The brief exists so he can answer; the
  reconcile has to happen first or he would be answering about the wrong table.
- **No production write, no code change.** `BF-106`'s `VACUUM FULL` remains deferred and untouched.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,063 tests passed**. Docs only.

**⚠ The first run of that gate exited 1 and its evidence was lost**, because the output was piped
to `tail -5` — five lines cannot show which file failed. Two subsequent runs of the identical tree
exited 0. Recorded as a **third occurrence on OR-121** rather than dropped, with the instruction
that a gate run is kept whole (`> /tmp/gate.log 2>&1; echo $?`) rather than tailed. Nothing is
diagnosed from it and it is not evidence for any cause — including OR-130's, which shipped earlier
the same day and whose own warning did not appear.

<a id="2026-09-23-fix-dv1-windows-ci-local"></a>

# 2026-09-23 — `fix/dv1-windows-ci-local` (DV-1)

**Orchestrator, Lane O.** The Device Verification agent runs on Windows by definition — next to the
phone — and its prompt makes `pnpm ci:local` the pre-push gate. On 2026-09-23 it could not produce a
clean run for reasons that had nothing to do with its diff, so it shipped on CI alone.

## Three of the four failures were one bug wearing three names

`check-sign-out-clears-device`, `check-e2e-stub-dates` and `check-strict-request-schemas` each walk
the tree with `path.join` and then use the result as a **key** into a table hand-written with
forward slashes. On Windows the walk yields `app\api\x`, the lookup misses, the allowance is not
found, and a baselined file reports as a new violation.

**It is invisible to CI, which is why it survived.** CI is Linux, where `path.sep` is already `/`,
so all three are correct there and always have been. They fail only for a human on Windows — and a
check that cannot pass on the machine that must run it is worse than no check, because it trains
that session to treat its own gate as noise.

One helper now, `scripts/lib/repo-path.js`, used by all three.

## The helper's own test caught the helper

DV-1 specified `.split(path.sep).join('/')`. That is correct for the actual use — normalising a path
*this* platform just produced — and wrong as a helper: on Linux it returns a Windows path unchanged,
so it can only be tested on Windows.

The first draft did exactly that and `scripts/__tests__/repo-path.test.ts` failed on two of five
cases. It now replaces backslashes unconditionally, and the test feeds the Windows shape in
**literally** rather than deriving it from `path.sep` — a test built from this runner's separator
would pass against the broken code. The trade (a POSIX file whose *name* contains a backslash would
be mangled) is documented: these are lookup keys, not paths handed back to the filesystem.

## The fourth could not run on Windows at all

Step 68 shelled out to `grep -rl … | grep -v …`, which under `cmd.exe` dies with *"The system cannot
find the path specified."* It is a Node walk now, **verified to find the identical 28 files** — set
diffed against set, because a rewrite that quietly narrowed the scan would be worse than the bug it
replaced.

Plus `npx` → `npx.cmd` on win32 (named explicitly rather than `shell: true`, which would re-parse
the argument list), and `engines.node` raised to `>=22.12` so a Node mismatch fails at install with
a message rather than at test time with a missing rolldown binding.

## A real defect found while fixing it — OR-130

A full gate run failed once on `app/api/user/goals/route.ts`, a file **byte-identical to `main`**.
The run was not piped, per OR-121's own instruction, so the diagnostic survived and was decisive.

`fileAtBase` in `scripts/lib/base-ref.js` returns `null` for **two different facts** — *"the file
does not exist at the base"* (the branch added it: a real violation) and *"I could not read the
base"* (nothing is known) — and `verdict` maps `atBase === null` to `fail`. This clone is shallow,
so `git show origin/main:<path>` fails transiently, and a read failure is reported as an accusation.
Confirmed by direct call, not inferred.

That matters more than one red run: `base-ref.js` exists so a branch is judged on what it *changed*,
and its own header records the earlier version reading as *"your change was too big"* when the change
was eleven lines. This reintroduces that failure non-deterministically, which is worse — a gate that
accuses at random teaches the reader to stop believing it.

Filed as **OR-130** with the fix and one warning attached: **decide the CI case first.** CI checks
out at depth 1, so if the base is unreadable there too, "do not fail on unreadable" disables the
ratchet everywhere rather than just locally.

## It is also OR-121's second occurrence — and does not close it

OR-121 asked for exactly this: *"the next occurrence settles it."* This one is diagnosed. But it is
a **different script** — the first instance was `check-tz-aware-cache-guards.js`, which does not use
`base-ref` at all. Two flakes of similar shape are not evidence of one cause, and recording them as
one would retire an open question on a resemblance. **The first instance stays unexplained.**

## The device machine answered while this was being written

Two things landed on `main` from that side, and both change the picture:

**The Node half is resolved by the owner** — 22.23.2 via winget, so `vitest` starts. The
`engines.node` floor still ships: the point is that the *next* machine fails at install with a
message rather than at test time with a missing rolldown binding.

**With the tests actually running, two more failures surfaced.** One of them —
`strict-schema-inert.test.ts` — shells out to `check-strict-request-schemas.js` and inherits its
path bug, so **the work here fixes it**. The other does not: `check-hex-literals` times out at 30 s,
three full scans of `app/` + `components/` against a filesystem that makes them slower. That stays
open on DV-1, with the instruction attached — **measure before raising the timeout.** A scan three
times slower than it needs to be is the finding, and a bigger number would hide it.

## Not done — and this is the honest headline

**None of this is verified where it matters.** Three of the four bugs are invisible on Linux by
construction, and Linux is all this session has. Every fix is reasoned from the reported failure and
confirmed only where confirmation proves little. DV-1 keeps a `Keep:` naming the one thing that
settles it: `pnpm ci:local` on that Windows machine, unpiped, exiting 0. That is the Device
Verification agent's run, not this one's.

The local machine is also on Node 22.9 against a `>=22.12` floor — the upgrade is the owner's.

<a id="2026-09-23-fix-dv11-switch-accessible-names"></a>

# 2026-09-23 — DV-11: 17 of 25 switches had no accessible name

**Branch:** `fix/dv11-switch-accessible-names` · **Lane:** B · eleven files, one guard, one test

Device Verification found one unnamed switch on the supplements sheet — a `role="switch"` button
with no `aria-label` and no labelled-by, announced as "switch, on" with nothing to say what it
controls. The sweep that followed found the same defect on **17 of the app's 25 switches**, across
settings, meal types, goal recommendations, the workout builder and the admin activity manager.

All 25 have a name now.

## The entry named one sheet; the class was app-wide

Each of those switches sits beside a visible `<p>` that names it perfectly well on screen and to
nothing else. That is why the class survives: it looks right, and only a screen reader disagrees.
The device sweep found the supplements sheet because that is the screen it was on.

## Why the existing check did not catch them

`scripts/check-icon-button-names.js` walked `<button>` and `<Button>` opening tags and **skipped
self-closing ones outright**, because a self-closing button has no body and the icon-only shape
cannot apply. A `<Switch />` is the opposite: self-closing is its only shape, so it was never
examined.

Extended rather than duplicated — Custom Rules stays at **`Ran 76 of 76`**. The tag walker is now
parameterised, which matters because PS-34's comment on that walker exists precisely to stop anyone
hand-rolling a second `[^>]*` version that ends the tag at the `>` of an inline arrow.

**Unlike the icon-button half, this pass is not a heuristic.** A `Switch` renders a thumb and no
text child, ever, so "no naming attribute" means "no accessible name" with nothing to trade against
under-reporting. The baseline stays **empty**: an unnamed switch is a regression, not a debt row.

## The first measurement was wrong, and that is the reusable part

Matching `<Switch` a line at a time reported **26 of 28**. The truth is **17 of 25**. Nine were
false positives — three were the primitive's own definition, and six were multi-line switches whose
`aria-label` sat on a later line.

That is the same mistake made earlier the same day, on a three-line call whose timezone argument sat
on line 3. **Read the tag to its balanced close, not the line.** It is now a baton lesson.

`scripts/__tests__/switch-accessible-name.test.ts` drives the exported detector directly and pins
nine shapes: same-line and later-line names, a genuinely unnamed multi-line switch, an inline arrow
(PS-34's shape), a `>` inside a quoted attribute, `aria-labelledby`/`title`, `<SwitchGroup>` not
being mistaken for the primitive, and several in one file at their own lines.

The CLI half is now behind `require.main === module`, so importing the detector has no side effect.
The sibling `check-admin-guard-catch.js` exports without that guard, and importing it runs a full
repo scan that can `process.exit(1)` on an unrelated regression.

**Control runs:** removing the name from a self-closing switch and from a multi-line one each fail
the check at the right file and line; both restore green.

## Not done, and not claimed

**`Verify: device` + `Keep:`** — the pass test is a screen reader on the S25 announcing each switch
with its name. The sandbox proves the attribute is present; it cannot prove what TalkBack says. Two
labels are worth a second look on device: the supplement row uses the supplement's own name, and
the goal-recommendation rows use `row.label`.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

## Also in this PR

The **Lane B baton** was rewritten in full — owed for three PRs. It is shrink-only, so making room
for three new lessons (the test-typecheck gap, the two fetch traps, and balanced-close matching)
meant cutting older narrative and moving LB-129's ruled-out candidates into LB-129's own entry,
where they belong. It came back to exactly 55 lines rather than raising the ratchet.

<a id="2026-09-23-fix-dv4-sleep-legend-contrast"></a>

# 2026-09-23 — DV-4: the Sleep card's stage hours were printed in the stage colour

**Branch:** `fix/dv4-sleep-legend-contrast` · **Lane:** B · one line of product code, one test

Home's Sleep card coloured each legend value with its own stage colour. Deep's `#1e3a70` against the
page root measured **≈1.6:1**, and against the card's own purple paint in the device screenshot
**≈1:1** — the number was there and could not be read. Device Verification found it on the S25
during the P4 sweep. The hours now inherit the foreground; the stage colour stays on the dot and the
stacked bar.

## The entry named the fix, and the sibling sweep changed which fix it was

DV-4 proposed rendering the hours in a foreground token, and flagged that `hypnogram.tsx` also
imports `STAGE_COLOR` and "was not read". Reading all four consumers turned that loose end into the
argument for the change:

| consumer | how it uses `STAGE_COLOR` | |
|---|---|---|
| `hypnogram.tsx` | SVG `fill`, and a legend dot's `background` | fill |
| `sleep-phase-trend-card.tsx` | Chart.js `backgroundColor` | fill |
| `health-metric-sheet.tsx` | bar + dot `background`; **hours in the inherited foreground** | fill |
| `home-card-widget.tsx` | dot + bar `background`, **and the hours as `color`** | the bug |

So the sleep detail sheet already renders the *identical* legend the right way. This was not a
design decision to make — it was one surface out of step with three, and the shape to copy was
fifteen lines away in a file the entry had not opened. Nothing else needed changing.

## Why a palette fix could not have worked

The card's background is owner-customisable (`ColorSwatchPicker`, `cardColors.sleepWidget`), so
there is no card colour for which all four stage colours clear 4.5:1 — and stage colours are picked
to read against *each other* in a stacked bar, not against a background. REM, Light and Awake passed
only because they happen to be light. Darkening Deep would trade one unreadable pair for another the
first time the owner picks a dark card.

`accentCardStyle` (`packages/shared/src/utils.ts`) is what makes the foreground token safe: every
card paints a translucent `--muted` base under a 30%→12% accent wash, so the card's own 2xl hours
figure already relies on the foreground reading against exactly this background. The legend value
now sits on the same footing as the number above it.

## The test is the rule, not the line

`components/home/__tests__/dv4-stage-colour-is-never-text.test.ts` sweeps every `STAGE_COLOR`
consumer for the palette reaching a CSS `color` inside a `style` object. Three things make it worth
more than an assertion on one span:

- It **guards the siblings**, which are correct today and have no other protection.
- It asserts the dot and the bar are **still coloured**, so it cannot be satisfied by deleting the
  palette.
- It pins the contrast ratio, so the premise is checked rather than quoted.

Control run: with the colour put back it fails naming `home-card-widget.tsx:166`.

A first draft flagged two false positives — `{ label: 'Deep', color: STAGE_COLOR.deep }` in both
`home-card-widget.tsx` and `health-metric-sheet.tsx`, which are data fields that happen to be named
`color`. Scoping the check to lines containing `style=` separates them, and lowercase `color:`
excludes `backgroundColor:` on its own.

## Not done, and not claimed

**The device look is owed** — the entry keeps a `Verify: device` and a `Keep:`, so
`next-item.js --sittings` lists it. The sandbox can compute the ratio and does; it cannot see the
card, and it cannot see a custom card colour at all.

**DV-6 was considered for this PR and deliberately left out.** It is the next Lane B item and both
would be checked in one look at Home, which is the batch rule's own axis. It turned out to carry a
design question this diff should not smuggle: the app scrolls five independent inner containers
rather than the document (`PullToSync`, plus Nutrition's own), so a shell-level "fade in on scroll"
needs a capture-phase `scroll` listener and a rule for which panel counts — and the scrim's colour
has to compose with `DynamicBackground`, which sets `--page-bg: transparent`, so the obvious
`var(--page-bg)` gradient would be invisible exactly when it is needed. `--pt-safe-value`
(`max(1rem, inset + 0.5rem)`) is the right height and already floors the three-button-nav case where
insets read 0. Recorded so that work starts from here.

<a id="2026-09-23-fix-dv6-status-bar-scrim"></a>

# 2026-09-23 — DV-6: a gradient behind the status bar, once, in the shell

**Branch:** `fix/dv6-status-bar-scrim` · **Lane:** B · one component, one controller, one wire-up

On Home, scrolled, the energy bar's caption ran behind the status bar's clock with nothing between
them. The owner was offered a solid strip and chose the fade, so the app stays edge-to-edge and
nothing loses the ~28 px a flat backing costs. It fades in on scroll and is absent at rest.

## Why one listener in the shell, and why it has to be capture

The owner's constraint was "in the shell once, not per screen" — a per-screen scrim is a rule every
future screen can forget, which is how this defect reached a device sweep in the first place.

That is harder than it sounds here, because **this app has no document scroll**. Every tab scrolls
its own inner container: three through `PullToSync`, and Nutrition owns a separate one. `scroll`
does not bubble, so a listener on an ancestor sees nothing — unless it registers in the **capture**
phase, which does reach it. One `document.addEventListener('scroll', h, true)` in `TabShell` covers
all five panels with no screen opting in.

The shell marks the panel on show with `data-tab-active`, and the controller scopes each event with
`closest()`. Without that, a hidden panel or a sheet scrolling would paint over the screen you are
actually looking at.

## The open question the entry recorded, and its answer

A panel keeps its scroll offset while hidden, so flipping back to a tab left scrolled down fires no
scroll event and a naive implementation shows nothing until you touch it.

The controller keeps a `Set` of every element it has seen scroll — bounded by the number of
scrollers in the app, a handful — and on each activation re-reads the ones inside the newly active
panel. A tab never scrolled is absent from the set and correctly shows nothing. Detached nodes are
dropped on the way past, so a torn-down screen cannot pin the scrim on.

## The logic is not in the component, and that is not a style choice

**Every vitest project in this repo is `environment: 'node'` and cannot transform `.tsx` at all** —
measured: importing the component fails at parse, first with JSX in the test and then with JSX in
the component itself. That is why there are no component-rendering tests here, and it is a hard
constraint rather than a convention to argue with.

It matters because of how this fails on device: a dead scrim and a mis-scoped one look identical —
nothing there. So logic left inside the component is logic nothing can drive, and the device check
cannot isolate it either. The decision moved to `lib/shell/status-bar-scrim-controller.ts`, a plain
`.ts` module with **12 tests** (jsdom through a per-file `@vitest-environment` docblock, which needs
no config change). The component is the div.

Its four wiring constraints are pinned by reading its source, since the tests register the listener
themselves and so would otherwise prove the controller's logic while saying nothing about whether
the component asks for capture.

**Control runs, because a green test that cannot fail proves nothing:** with `reevaluate` neutered
the tab-flip test fails; with the component's `true` capture flag removed the wiring test fails.
Both restore green.

## Two things measured rather than assumed

**`var(--page-bg)` is the wrong colour to fade from.** `DynamicBackground` sets it to `transparent`
when active, so a gradient built from it is invisible in exactly the case the scrim exists for. It
fades from `var(--background)`, which holds the theme base either way.

**The height is the `pt-safe` utility, not a hand-written `--pt-safe-value`.** An empty `pt-safe`
div is exactly inset-height and the gradient paints over the padding box. Referencing the variable
directly **fails** the Custom Rules check that every safe-area utility be a defined class — the run
reported `pt-safe-value` as used-but-undefined, which is the check doing its job on a name that
merely looks like a utility. The utility floors at 1rem, which matters because three-button
navigation reports the inset as 0.

## Not done, and not claimed

**The device look is owed** (`Verify: device` + `Keep:`). The sandbox cannot judge the one thing
most likely to need tuning: how the gradient composes with `DynamicBackground`'s sky, in both
themes. Also not exercised: Samsung WebView compositing of a fixed, animated-opacity layer.

Also filed: **LB-130** — `docs/doc-size-baseline-history.md` is now the guaranteed-conflict file
that `.size` used to be, on the same append-to-one-shared-file shape LA-33 and RV-134 already
fixed twice. Measured across five re-merges of #1449 in an hour.

## The compaction sweep was run, and then handed back

Merging `main` took `docs/overview/entries/` past the 60-foldable limit, and since BF-36 that guard
fails only a branch that **adds** an entry — which every feature PR does, so it lands on whoever is
holding the door. This branch ran `scripts/fold-journal-entries.js`, folded 40 entries, and both
link checks came back clean.

**None of that is in this diff, because #1447 ran its own sweep at the same time and landed first.**
The two folds collided as an add/add conflict on `history-2026-09-23-folded-1.md`, each holding a
different set of entries. Hand-merging two folds is precisely how a journal entry gets silently
duplicated or dropped, so this branch discarded its own fold, took `main`'s state wholesale, and
re-checked: `main`'s sweep had already cleared the guard, so nothing was owed. The only file this PR
adds under `docs/overview/` is its own journal entry.

**The reusable part is the resolution, not the sweep.** Two sessions folding on the same day write
the same `history-<date>-folded-N.md`, and `git` surfaces it as add/add rather than as anything
resembling "you both did the chore". Take one side whole and re-run the script; never splice.

## Two things the first CI run caught that the local gate did not

**`npx tsc --noEmit` does not typecheck test files.** The Build job runs
`scripts/check-test-typecheck.js` against `tsconfig.tests.json`, a separate project with its own
per-file baseline (320 errors across 90 files, recorded). A clean `tsc --noEmit` says nothing about
a spec, and this PR went red on one line in its own new test —
`let paint: ReturnType<typeof vi.fn>` erases the signature, so passing it where a
`(shown: boolean) => void` is wanted does not typecheck. **The local command is
`node scripts/check-test-typecheck.js`**, and it belongs in the gate beside `check:rules`.

**Fixing that surfaced a defect the mock had been hiding.** Replacing `vi.fn` with a plain counter
turned "paints only on a change" from green to `expected 6 to be 1`: every case's controller was
still attached to `document`, because nothing detached it, so six controllers painted on one
scroll. A per-test spy hides this by construction — each assertion reads only its own mock — and
the shared counter is what made it visible. The listeners are detached in `afterEach` now.

Worth stating plainly: the earlier "12 passed" was partly luck. The leaked controllers all saw the
same DOM and computed the same answer, so `shown` agreed and every other assertion held. The four
control runs were re-done against the fixed harness for that reason — neutering `reevaluate`,
zeroing the threshold, removing the active-panel scoping, and dropping the component's capture flag
each fail their own test and restore green.

<a id="2026-09-23-fix-home-ia-merge-part1"></a>

# 2026-09-23 — home-ia-merge, part 1: the APK banner and the picker's duplicate question

**Branch:** `fix/home-ia-merge-part1` · **Lane B** · v1.465.22

## What shipped

**RV-116 — the widget picker offered two entries for one question.** `nutritionDonut` and
`energyBalanceWidget` both read `energy-balance:${today}` through the same hook, and the pair has
already shipped two budgets 271–274 kcal apart, both labelled "left" (Q-401/Q-415). The picker now
says under its heading that Energy Balance is an **alternative** to Nutrition, not an addition, and
the Energy Balance chip dims while Nutrition is on and it is off.

Dimmed, never disabled: it is a real choice, just not one to make *on top of* Nutrition. Disabling
would hide the alternative rather than rank it.

**Deviation from the entry's letter.** It said "relabel the picker entry". The chips sit in a
wrapping row built for 384 px and a label long enough to carry "alternative to Nutrition" wraps that
row, so the sentence went under the heading where it has room to say the whole thing. Same intent,
better fit; reversal is moving one `<p>`.

**RV-119, first half — the APK banner is gone**, along with its `apkBannerDismissed` state, its
`apk-banner-dismissed` key, and the `Download` and `X` imports it was the last user of. No design
judgement was involved: the canonical runtime *is* the APK, and the same download row already sits
at More → About.

## Why the rest of RV-119 did NOT ship

The entry says *"Owner gate SATISFIED 2026-09-22 — mockup shown at 384 px dark … Build to it; a
departure from it needs a fresh yes."*

**The mockup was not preserved.** Nothing in `docs/design/` from that date; the sweep write-up
describes the problems, not the approved layouts. So "build to it" cannot be followed — an
implementer either invents a collapse layout, which is the precise departure the gate exists to
prevent, or re-asks the owner something he already answered.

The banner split itself is written down and unambiguous (illness advisory and early deload stay
full-width; exercise-detected, goals check-in, day-review and weekly recap collapse). What is missing
is what a "collapsed strip" LOOKS like, which is exactly what a mockup carries and prose does not.

Filed as **LB-135**: an owner gate recorded as satisfied without preserving the artefact is not
actionable, and the same wall is waiting in RV-117 and RV-118, which carry the identical line.

## Verification

- Full suite **811 files / 8231 tests / 0 failed** (exit 0) · `pnpm build` clean · `tsc --noEmit`
  clean · `pnpm check:rules` **Ran 77 of 77** · lint clean on both changed files (the `X` import
  warning my own deletion created is fixed, not baselined).

## Not exercised

Device. Both changes are visual — a removed banner and a dimmed chip — and the sandbox can only
prove the code paths changed. Also not exercised: native SQLite, safe-area, Samsung WebView.

<a id="2026-09-23-fix-lb129-day-review-cold-flip"></a>

# 2026-09-23 — LB-129: the day review on a cold flip into Nutrition

**Branch:** `fix/lb129-day-review-cold-flip` · **Lane B** · v1.465.19

## What shipped

`EndOfDayReview` is now a **static** import in `app/nutrition/nutrition-content.tsx` rather than a
second `dynamic({ ssr: false })` nested inside the tab's own lazy chunk. The screen is already
code-split and warmed on idle by the shell, so the inner boundary kept almost nothing out of the
initial bundle while adding a chunk that has to be fetched at the moment the sheet opens.

**This is a plausible fix, not a demonstrated one, and the entry says so.** Reversal is one line.

## What was actually measured

Instrumented in the Playwright harness, driving the real app:

- **The param is not the problem.** At the failing timing the effect reads
  `sp=review=day loc=?review=day` and `reviewOpen` goes `false → true`. No error, no `pageerror`.
- **`EndOfDayReview`'s component body never runs** while `reviewOpen` is true — its chunk had not
  resolved. The defect is downstream of the param, in chunk loading.
- **It is a race with a clean bracket:** flip the instant `settleRouteBoundary` returns and the
  sheet does not appear within 12 s; wait 1500 ms and it opens; 6000 ms, sooner.

## Why this is not closed

**The harness cannot separate this from a dev-compiler artefact.** It drives `pnpm dev`, where a
cold chunk is compiled on demand — seconds, visible in the server log. With the fix reverted and the
window widened to 20 s the sheet *did* appear, so the chunk resolves late rather than never. In a
production build it is prebuilt.

A production-mode run would settle it and is **not available in this sandbox**: `next start` sets
`NODE_ENV=production`, which turns the pg pool's SSL on, and the local Postgres speaks none, so every
request dies. Only the device or a Railway preview can tell the two apart. `Gate: device`.

## Two traps, both of which cost a pass

- **The obvious probe gives a false pass.** Flip, then read `[role="dialog"]` — Home auto-opens the
  Morning Check-in for a user who has not done one, so the role is satisfied before the flip and the
  assertion passes without the day review ever appearing.
- **The spec was deleted rather than committed.** It passed with the fix *and* with the fix
  reverted, so it was a green tick proving nothing — the same failure LB-133 was about. A regression
  guard for this needs a control run showing it red first, and on this evidence none can be written
  in the sandbox.

## Also ruled out

The **back-dismiss machinery**, the most tempting candidate because `sheet-back-stack.ts` carries a
documented bug where *"the dialog closed on the frame it opened"* (BF-34). `handlePop` runs only on
a `popstate`, and a tab flip emits none — `tab-shell.tsx:103` uses `replaceState`. The timeline also
shows the sheet never opening rather than opening and closing.

## Not exercised

Device, native SQLite, safe-area, Samsung WebView, drifted prod data — and, unusually, **the
production build itself**, which is the one surface that would make this conclusive.

<a id="2026-09-23-fix-lb131-dv9-sleep-timezone"></a>

# 2026-09-23 — LB-131 + DV-9: two sleep surfaces took Brisbane by default

**Branch:** `fix/lb131-dv9-sleep-timezone` · **Lane:** B · two call sites, one test

`computeSleepStartConsistency(starts, tz = DEFAULT_TZ)` and `timingPoints(nights, mode, tz =
DEFAULT_TZ)` both already accepted a zone. Nothing on the client passed one, so the Sleep screen's
consistency figure was computed in the **device's** clock and the timing chart's axes in Brisbane —
correct for the only user today, wrong the moment a phone and a profile disagree.

This is the shape CLAUDE.md names outright: *a default every caller overrides is a safety net, and
it is what makes forgetting silent.* Neither surface looked broken, and neither would until someone
travelled.

## Shipped as one PR, because the entry asked for it

LB-131 said "ships with DV-9 — one tz resolved once per screen, not twice", and they touch the same
screen, so they batch on the axis that matters: one device look clears both.

## Built differently from the plan, deliberately

The entry prescribed threading the session timezone from the screen through into the card. The card
is rendered by `sleep-trend-toggle-card.tsx`, which has no other use for a zone — so a threaded prop
is a parameter a future render site can omit, which is **the same hazard as the default**, moved one
level up. The card reads `useUserTimezone()` instead: a context fed from the root layout's `auth()`
call, present in the first server render, so the card is correct wherever it is mounted.

Reversal cost is a prop and two edits. Recorded in the entry as well as here, per the standing rule
that a structural call gets written down with its reason.

## The sweep found the intermediary, and no third site

Neither entry mentioned `sleep-trend-toggle-card.tsx`; grepping the render chain did. Between `app/`
and `components/` each helper has exactly two call sites, and the API route's
(`app/api/user/bedtime-estimate`) was already passing a zone — which is what made the client half
look deliberate rather than missed.

## The test guards the call sites, not the maths

DV-7 already pinned the helpers themselves with explicit `+10:00` fixtures passing under UTC,
Brisbane, New York and `Etc/GMT-13`. What had no guard is whether anything *passes* a zone, which is
exactly what regressed. `components/health/__tests__/lb131-dv9-sleep-tz-call-sites.test.ts` sweeps
every client call site of both helpers and also asserts the value comes from `useUserTimezone()`
rather than a hardcoded string or an `Intl` read — either would typecheck and be the bug.

**A first draft matched one line at a time** and reported the API route's three-line call as having
no zone. That is a false positive, not a find: the `tz` was on the third line. The check now reads
each call to its balanced closing paren.

**Control runs:** reverting either call site fails the sweep; hardcoding `'Australia/Brisbane'`
fails the session-source assertion. All three restore green.

## Not done, and not claimed

**Both keep a `Verify: device`.** DV-9's pass test is the one assertion the sandbox structurally
cannot make — override the device timezone (CDP `Emulation.setTimezoneOverride`), leave the profile
alone, and the consistency figure must NOT move. That needs two clocks that disagree. LB-131's is
the owner setting a profile zone far from Brisbane and watching both chart axes follow the profile.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.
