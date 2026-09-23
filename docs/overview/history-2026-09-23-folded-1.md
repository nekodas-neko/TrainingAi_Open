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
