# Session journal — batch folded 2026-09-24

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

<a id="2026-09-23-device-sweep-2"></a>

# 2026-09-23 — Device sweep 2: nine entries closed, an outage, a stuck deploy, and a food that came back

**Branch:** `device/sweep-2b` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, APK 1.460.4, owner's account, **three-button navigation** (`navigation_mode` 0, so every
gesture-inset check was void). Stations C–G ran on web v1.465.10. Station A and the rechecks ran on
**v1.465.16** after production caught up and the app was restarted. Plan: `docs/device-sweep-2-plan.md`.
The phone showed 🔴 throughout and 🟢 at the end.

## The pause: production went down, then turned out not to be deploying

- **DV-13.** Opening `/admin/oura-ble` left four admin requests (`device-metrics`, `samples/summary`,
  `rollup-state`, `samples/pack`) unanswered for more than 90 s. The public `/api/version` then timed
  out from a separate PC from **20:04 to 20:12 AEST**. The sweep stopped and the endpoints were not
  re-requested. The cause is **not proven**.
- **DV-14.** While re-checking, production was found on **v1.465.10** while `main` was at 1.465.16:
  six merges since 18:16 had not deployed, one of them at 20:03, a minute before the outage. By
  ~20:27 production had **caught up on its own**. Why is unknown; Railway's deploy log is the first
  step. Something that stopped is not something that was fixed.

## Results

| verdict | entries |
|---|---|
| **Verified, removed from the backlog** | Q-112e, BF-99, BF-162, RV-39, Q-317, BF-133, BF-186, BF-45, BF-47 (+ 5 Known-Issues rows archived: BF-162, Q-112e, BF-133, RV-39, BF-47) |
| **Device half passes, other work still owed** | TN-35, Q-519, OR-116 (both labels), Q-274, BF-163, BF-167, Q-538, BF-5 (page half), BF-175, BF-170, BF-98, RV-108 (2 of 3 keys), DV-11 (names present; TalkBack not run), DV-6 (controller works; the look is the owner's) |
| **Fails on the device** | **BF-177** (still, after #1467 deployed: 8 s with no change until the next action), **RV-103** (blocked refetch shows a stale number, no failure line), **RV-111** (one back from the scanner closes the whole Log Food flow), **TN-53** (0-value HRR points), **RV-127** (~33 px touch area) |
| **Could not check** | Q-281 (no "Final readiness" row), RV-37 (three-button nav), PS-35b failure state, RV-38 (SW fetch), Q-544 / Q-316 / BF-10 (admin requests never answered; DV-13) |
| **Not reproduced** | BF-179: that morning's 52% was a fresh prescription with a check-in reason |

## New: DV-15, a deleted food came back as `synced`

A test food logged and deleted within ~10 s reappeared locally: `deleted_at NULL`, `sync_status
'synced'`, and an `updated_at` stamped as a pull was being applied. Meanwhile the server's list no
longer held it. It stayed on screen through tab swaps. A second, traced delete worked. Filed for
Lane A with the suspected race (a pull applied after the push confirmed the delete) marked as **not
established**.

## Writes (all undone)

Cocoa powder logged and deleted four times (online and offline); Fish Oil ticked and unticked; a
same-value weigh-in (69.4 kg). The weigh-in leaves today's weight **manual-sourced**, which outranks
a later scale reading today.

## Harness

- `recordNetwork({ bodies: true })` now works (it threw before).
- Runbook: `food-logs` returns a bare array; use CDP `Network.setBlockedURLs` for SW-fetched
  requests; `/health/day` query artifact; check `navigation_mode` first; restart the app after a
  deploy before re-checking a fix.

## Not exercised

Gesture-nav insets, TalkBack, the light theme, the admin console after DV-13, and the station A–H
items listed as carried forward in the baton (`docs/agents/state/device-verification.md`).

<a id="2026-09-23-docs-bf-187-ring-drain-on-open"></a>

# BF-187 — opening the app never asks the ring for anything

**Branch:** `docs/bf-187-ring-drain-on-open` · docs-only · BugFix intake

The owner asked whether sleep data can sync as soon as the app opens, noting the official Oura app
did it. It can, and most of the machinery is already built: `syncOuraRing()` drains the ring,
waits for the server rollup watermark, invalidates the Oura caches and tells mounted screens to
refetch. It has two callers — the pull-to-refresh gesture and the Refresh button on session-select
— and neither is app open. Between gestures the ring is drained on a 60-minute timer.

Measured before filing, against production:

- **Drain cadence**, 40 h of `oura_raw_samples.recorded_at` to 2026-09-24 06:19 Brisbane: scheduled
  gaps of **57–91 min**, matching `DRAIN_INTERVAL_MS` plus the 5-min keepalive granularity.
- **Post-wake lag**, the seven nights still resident in the raw table: first batch after `sleep_end`
  arrived **4–34 min** later, median **25**. Older nights read as multi-day lags and were discarded
  as an artifact of the ~8-day packer window rather than recorded as a finding.

The screenshot that prompted the report is not itself the defect, and the entry says so: it was
taken at 06:57 and the night it shows landed with the 03:08 drain. The window bites when the app is
opened within about half an hour of waking, and all day for metrics that keep accumulating.

Two things the trace turned up that the report did not ask about. Home mounts no `PullToSync`, so
the tab the app opens on is the one screen with no way to request a drain at all. And the trigger
this entry asks for used to exist: the Oura *Cloud* sync removed on 2026-08-13 fired on app open and
native resume. Removing it was right — it could not succeed on our own BLE key — but nothing
replaced its trigger, and the comment recording the removal is still in `sync-provider.tsx`.

Filed as Lane A: the listener belongs in `sync-provider.tsx`, but the cooldown guarding it is
ring-radio policy in `lib/oura-ble/**`. The entry recommends a JS-side cooldown (no APK) over
exposing `lastDrainCompletedAt` from the plugin, and states plainly that "as soon as the app opens"
will mean ten to forty seconds, because `afterDrainSettles` waits for the rollup rather than
invalidating early.

## Amended the same day — the APK constraint came off, and the entry turned out to be a duplicate

The owner lifted the build cost: *"Happy for new apk builds if thats more effecient."* That flips
BF-187's recommendation. The entry had recommended a JS-side cooldown purely to avoid an APK; the
native answer is a `drainIfStale(maxAgeMs)` plugin method that makes the staleness decision inside
the service against the real `lastDrainCompletedAt`. A JS cooldown resets on WebView reload, cannot
see the autonomous hourly drains, and races the `draining` flag — three facts the service holds and
the web layer can only guess at. The JS version stays recorded as the fallback, since it is what
ships if this ever has to land without a build.

Sweeping the queue for other work shaped by that constraint turned up something the original filing
missed: **BF-187 duplicates link 1 of Q-529**, filed 2026-08-20, which already carries the owner's
requirement in his earlier words — *"Ideally I want the score and sleep time to be accurate on first
open of the day without needing time to 'adjust'"* — and already names "Drain on app open / wake
detection" as the dominant term, blocked on Kotlin. It has sat a month for exactly the reason that
was just removed.

Recorded rather than reconciled quietly. Q-529 keeps the display half and the re-score follow-on;
BF-187 owns the trigger, because a drain on open moves steps, HR, SpO₂ and temperature as well as
sleep. Q-529's link 1 now points at BF-187 and says why it left.

The two measurements are worth keeping side by side: Q-529's review found a **62.0-minute median
gap across 214 batches over 7 days**; this entry found **57–91 minutes over 40 hours**, a month
later and without having seen the first. Nothing drifted. That is the argument for building the
trigger rather than measuring the cadence a third time.

Four other entries were parked on the same constraint and are now unblocked as a batch: **BF-80**
(blank-screen handling in `MainActivity.java`), **BF-105** (spoken walk cues), **Q-111** (the scale
battery chip), and **TN-51** (overnight strap wear landing in ambient mode).

## A note on the fold this PR originally carried, and why it is gone

The first commit folded the ten oldest journal entries, because the foldable-entries gate sat at
exactly its limit and one new entry tripped it. While this branch was open another agent folded
**41** entries into a history file of the same name, and the merge conflicted.

The conflict was resolved by rebuilding rather than splicing — and the rebuild exposed something
worth recording: **`fold-journal-entries.js` writes its history file with `writeFileSync`, not an
append**, so re-running the fold on top of a same-named file produced by a concurrent fold silently
**discards** the other agent's work. Anchors went from 41 to 11 with no error. Splicing the conflict
hunks by hand would have looked like it worked.

With the other fold merged, the count is 24 foldable against a limit of 60, so this branch's fold
was no longer needed and was dropped entirely. The ten entries stay loose and the history file is
main's, untouched.

<a id="2026-09-23-docs-bf-189-session-content-vs-budget"></a>

# BF-189 — the sessions are the right length and half the volume

**Branch:** `docs/bf-189-session-content-vs-budget` · docs-only · BugFix intake

The owner asked two things about a 52-minute Push session: whether the duration was right, and how
much of it was actual working time rather than warm-up and bar-loading. Then the real question —
*"Id like to know if sessions have enough content. Time wise its pretty good."*

`DURATION` is wall clock, `workoutEndMs - workoutStartMs`, so 52:00 is correct and counts
everything. Decomposed from the timers:

| band | min | |
|---|---|---|
| warm-up | 10.5 | |
| setup / bar-load | 14.9 | Σ `inter_exercise_rest_sec` |
| **work** | **9.8** | Σ `set_time_sec` |
| rest | 12.0 | |
| unaccounted | 4.3 | |

Across the last 14 completed sessions, work is a median of **8.6 min — 19% of wall clock** — and
setup is consistently larger than work.

On content, the app's own numbers answer it. All five exercises ran **2 sets**, which is the floor
`fitToBudget` never goes below; the program's stored styles prescribe 14 sets for Push and 10 were
logged. Against `program_volume_targets` over 35 days, **13 of 16 muscle groups are under target and
the total is 102.2 sets against 154 — 66%**. Chest 48%, lats 52%, quads 48%, calves 27%. The three
groups at or above target are all ones that accumulate as secondary work.

The obvious suspect was cleared rather than assumed: `resolveTransitionSec` prefers a measured
per-exercise transition over the 240 s equipment default, and the owner has months of measurements,
so the budget is computed against his real transition times. The model is right and the time
genuinely goes there.

What is left is a conflict between two correct numbers that no screen compares — a 60-minute budget
and a 154-set weekly target. Filed `Lane: O` with three levers and a recommendation: fewer exercises
at more sets each, which spends the same time on fewer transitions. That is the position the repo
already argues in its own code (*"two token sets each is worse training than doing fewer exercises
properly"*), and `dropToBudget` exists to do it — it just only runs when the duration preset is
shorter than the session, so at the normal budget the engine trims to a floor instead of dropping an
exercise, which is the wrong half of its own rule.

<a id="2026-09-23-lane-a-dv7-sleep-consistency-timezone"></a>

# 2026-09-23 — DV-7: a helper that read the device's clock, and a test that only passed in UTC

**Branch:** `lane-a/dv7-sleep-consistency-tz` · **Lane A** · `packages/shared/**`. No migration, no
schema change, no API change.

## The entry was accurate, and I checked it rather than assuming

`minutesFromNoon(iso, tz?)` computed `d.getHours() * 60 + d.getMinutes()` when `tz` was omitted —
the **device's** clock, which is what CLAUDE.md's Timezone section bans for anything user-facing.
Reproduced before touching anything:

```
TZ=UTC                 → 6 passed
TZ=Australia/Brisbane  → 2 failed
    expected 690 not to be 690
    expected 1312.5 to be close to 712.5, difference 600
```

600 minutes is the UTC↔Brisbane offset exactly. CI runs in UTC, so this never went red there — and
the owner's phone sits in the zone the data was recorded in, so it never showed on the device
either. The test encoded the same assumption it was meant to catch: it compared the explicit-tz
result against the **no-tz** result and asserted they differ, which is only true when the runner
is not in Brisbane.

## The fix, and why a default rather than a required parameter

`tz` now defaults to `DEFAULT_TZ` and the device-local branch is **gone** — there is no code path
left that reads the machine's clock.

Making `tz` required was the other option and would be stricter. It was rejected because it forces
edits to `app/health/sleep/sleep-content.tsx` and `components/health/sleep-timing-trend-utils.ts`,
both **Lane B** files, and **DV-9 already exists** to thread the session timezone into the first of
them. The default removes the wrong behaviour immediately for every caller; DV-9 then upgrades the
caller from *the owner's zone* to *the user's zone*. This matches the repo's existing shape
(`aestMidnight`, `getCalendarData`), with the caveat CLAUDE.md attaches to it: a default every
caller overrides is a safety net, and it is what makes forgetting silent.

Both **server** callers already passed `tz` — `app/api/user/bedtime-estimate` and
`app/api/health-trends`. Only the two client callers omitted it.

## The tests now pin their own zone on both sides

Every case names `Australia/Brisbane` or `America/New_York` explicitly, and two new cases assert
the default is the user's zone rather than the machine's. Verified across four runners:

| TZ | result |
|---|---|
| `UTC` | 8 passed |
| `Australia/Brisbane` | 8 passed |
| `America/New_York` | 8 passed |
| `Etc/GMT-13` | 8 passed |

`Etc/GMT-13` shares an offset with none of the fixtures, which is the point — a fixture that reads
the ambient clock is not a weaker test, it is a test of the runner.

## Mutation pass

| # | mutation | UTC | Brisbane |
|---|---|---|---|
| 1 | restore the device-local fallback | **4 failed** | **2 failed** |
| 2 | apply `tz` to only the first sleepStart | **1 failed** | **1 failed** |
| C | parse `H:m` in one `formatInTimeZone` call | 8 passed | 8 passed |

Mutant 1 is the measure of the improvement: the **old** suite passed under UTC with that exact bug
present. The new one fails in both zones, so the defect can no longer hide behind the runner.

## The surface half, which a red test forced and the lane rule already required

`components/health/sleep-timing-trend-utils.ts` plotted bedtime through `minutesFromNoon` and wake
through its own `d.getHours()`. With the helper no longer reading the device, those two halves of
one chart would have sat in two different zones on any phone outside Brisbane.

I first filed that as a Lane B entry and moved on. **The consumer test then went red** —
`expected '9:30 AM' to be '11:30 PM'` — because its fixtures were bare local-time strings that
`new Date` parses in the runner's zone. That is not a Lane boundary question any more: a red test
cannot ship, and CLAUDE.md's own rule for a change that is both engine and surface is Lane A, engine
half first.

So `timingPoints` now takes `tz = DEFAULT_TZ` and resolves **both** modes through
`minutesFromNoon`, deriving wake as `(fromNoon + 720) % 1440` rather than re-reading the clock —
one clock implementation in the file, not two (One Formula, One Place). Its fixtures carry explicit
`+10:00` offsets, and two new cases assert that changing the zone moves *both* modes by the same
offset and that the default is the user's zone rather than the runner's:

| TZ | result |
|---|---|
| `UTC` | 10 passed |
| `Australia/Brisbane` | 10 passed |
| `America/New_York` | 10 passed |
| `Etc/GMT-13` | 10 passed |

Mutation pass on that half: reverting wake to the device clock kills 3 cases in both zones;
accepting `tz` but not forwarding it kills 1; undoing the noon shift as `(x - 720 + 1440) % 1440`
instead of `(x + 720) % 1440` — arithmetically identical — survives.

**LB-131 was rewritten rather than closed.** What remains is genuinely a Lane B job: the card calls
`timingPoints(nights, mode)` and takes the default, so every user gets *Brisbane* rather than their
own zone. That ships with DV-9, which threads the same value into `computeSleepStartConsistency`
one component above.

## Not done

- **`packages/shared/src/utils.ts`'s `localDateString`/`localDatetimeString` were left alone.** They
  are device-local by design and CLAUDE.md names them as one of the two sanctioned client "today"
  sources; changing them is a separate decision, not a drive-by.
- **`app/api/day-log/route.ts:190` looked like the same pattern and is not** — it calls
  `toZonedTime(ws.startedAt, tz)` first, so `.getHours()` reads the target zone. Checked, not
  assumed.
- **Failure surfaces not exercised:** the Sleep screen on the device. This is pure shared-package
  math with no UI, but the number it feeds is user-visible, and the sleep-timing chart above is now
  the subject of LB-131.

<a id="2026-09-23-lane-a-e2e-test-path-filter"></a>

# 2026-09-23 — a vitest file under `app/` was buying a 34-minute browser suite

**Branch:** `lane-a/e2e-test-path-filter` · **Agent:** Implementation (Lane A) · **CI + docs.**
No app behaviour changes, so no version bump.

Three things, all fallout from a session that spent most of its time not shipping.

## The change: `__tests__/` no longer gates the browser suite

`ci.yml`'s E2E gate ran the full Playwright suite for any changed path under `app/` (minus
`app/api/`) or `components/`. That includes `__tests__/` directories — vitest files that no browser
ever loads and that therefore cannot change what Playwright sees.

**Measured, not reasoned:** PR #1405 touched exactly **one** such file,
`app/session-explain/__tests__/bf172-fit-not-readiness.test.ts`, and bought **four** full ~34-minute
runs. It reached all-six-green on the fourth and still could not merge, because `main` had moved
during the run each time.

The exclusion is the same shape, and the same argument, as the `app/api/**` drop already in that
line (LA-63: *"a migration and four API routes used to buy the full ~25-minute suite"*). `e2e/`
specs are not under a `__tests__/` directory — checked, zero — so the browser suite still gates on
itself. Verified by simulating the three cases against the real pipeline: a test-only change skips,
a component change runs, an `e2e/` spec change runs.

**This is a structural call made rather than asked**, per the owner's 2026-09-22 delegation. Reversal
is deleting one `grep -vE` from one line.

## The rule: a plain `git fetch` here produces PRs that CI silently skips

The expensive half of the session. The sandbox's git proxy **returns a shallow pack on every
`git fetch origin main`**, grafting the fetched tip as a root — `.git/shallow` ends up holding
`origin/main` itself. The fetched branch then has no ancestry, `git merge origin/main` fails with
*"refusing to merge unrelated histories"*, and a merge computed against that view produces a tree
GitHub reads as genuinely conflicted.

**A conflicted PR is never given a workflow run.** So the symptom is `get_check_runs` returning
`total_count: 0` indefinitely while CI runs normally for every other branch — which is
indistinguishable, from the outside, from the stale-base tell already in CLAUDE.md. Chasing the
wrong one cost four PRs with sound diffs (#1426, #1428, #1430, #1435).

Two cheap discriminators are now written down: `git rev-list --max-parents=0 HEAD | wc -l` above 1,
and an empty `git merge-base HEAD origin/main`. And the decisive test is
`update_pull_request_branch` — it merges server-side with GitHub's full history, so if *it* also
refuses, the conflict is real rather than a reporting lag. That call is what finally settled it.

The remedy is `--unshallow`/`--deepen` on **every** fetch, and a plain `git clone` into the
scratchpad when a repo is already poisoned (`pnpm install --frozen-lockfile` there takes 30 s).

> **⚠ Corrected the same day by LA-130 — the fetch was innocent.** `pnpm check:rules` replays the
> Custom Rules job, one step of which was `git fetch --depth=1 origin main`; that is what
> re-shallowed the clone, on every run, immediately before every push. A bare fetch cannot *deepen*
> a shallow clone, which is all it was ever doing. See
> `docs/overview/entries/2026-09-23-lane-a-la130-unshallow-once.md`.

## The entries: one orphaned finding, one for the Orchestrator

**LA-129** files what owner decision item 5 explicitly left unfiled — generating the `.size`
baselines in CI rather than committing them, which the owner named as *"the better long-term
answer"* while knowingly taking the cheap one. Per **No orphaned findings** it should exist as a
queue entry rather than a sentence inside a resolved decision. It carries this session's measurement
(three Lane A PRs needing four, three and two re-merges) and the open design question that decides
its size: whether the ratchet can read its baseline from `origin/main` at run time without losing
the shrink-only property.

**OR-132** hands the Orchestrator the five dead PRs. Closing a PR needs the owner's authorisation,
which is why this is `Lane: O` and not something I did — item 6 set that precedent on 2026-09-22.

## Verification

`pnpm check:rules` **75 of 75** · `check-backlog-pointers` OK, 430 entries, no duplicates. The
pipeline change was simulated against the three real path cases rather than assumed; its true test
is the next PR that touches only a test file under `app/`, which should now report E2E in seconds.

**Not exercised:** nothing ran on `pnpm dev` or on device — there is no app code in this diff.

<a id="2026-09-23-lane-a-la125-fat-floor-in-baseline"></a>

# 2026-09-23 — LA-125: one fat rule, and it is the floor

**Branch:** `lane-a/la125-fat-floor-in-baseline` · **Lane A** · one shared module and its two
callers' tests. No migration, no schema change, no route change.

## The measurement held exactly

`calculateBaseline` set `fatG = round(calories × 0.25 / 9)`; `clampRecommendation` floored fat at
`round(0.6 × weightKg)`. Both verified against current `main` at the stated lines. For the owner
that is **39 g and 42 g**, with carbs falling out of the remainder at **143 instead of 150**. So
RV-66's claim — the recommendation *is* the baseline — was true of calories, protein, water and
steps and false of the two macros a person actually adjusts.

## What shipped

The floor moved **into** `calculateBaseline`, as the entry's decided structural call says. Both
bounds are now one pair of helpers — `fatCeilingG(calories)` and `fatFloorG(weightKg, calories)` —
used by the baseline and by the clamp, so there is one expression rather than two copies of the
same two numbers. The clamp keeps them as a redundant guard over a figure it did not compute.

**It resolves in favour of 42 g, not 39.** That is worth stating plainly because `LA-126` was
written expecting the opposite, and it is the entry LA-125 was blocking.

## What the entry did not say, and it is the reason the clamp's shape had to be copied exactly

`clampRecommendation` does not floor at `0.6 × weightKg`. It floors at
`min(round(0.6 × weightKg), fatMax)` — for a very heavy, short or older person the weight-based
floor can exceed the 40%-of-calories ceiling, and an existing test pins that case at 150 kg. A
floor written into the baseline without that cap would have pushed fat past 40% of the budget for
exactly those users, and the clamp would then have pulled it back down — re-creating the
disagreement at the other end of the range. `fatFloorG` carries the cap, which is why it takes
`calories` as well as weight.

## The blast radius, which is a real change to a number

One baseline fixture moved: an 80 kg cutting profile at 1,636 kcal computed **45 g fat / 164 g
carbs**, under its own 48 g floor. It is now **48 / 157**. That is the defect, not a regression —
the route would have raised that user to 48 g anyway, and the sheet was showing them 45.

`components/profile/goal-baseline.ts` (the recommendation sheet) reads `calculateBaseline`
directly, so it now shows the same number the route serves. That is the point of the change, and
it is also where the owner sees the figure before he taps apply.

## `LA-126` was amended in this PR, because it quotes figures this change moves

It states the numbers the owner is moving to "so nobody has to re-derive them" — **1,359 / 111 /
143 / 38**. Its 38 g fat is the pre-floor value; his floor is 42 g whichever body-fat reading is
used, so the expected figures are now **1,359 / 111 / 134 / 42**. That is arithmetic from the
entry's own numbers and is flagged in it as such, **not** a fresh measurement — the RV-66 re-run is
what settles it. Left unamended it would have handed the next session a stale target.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | baseline drops the floor (the defect restored) | killed — 2 tests |
| 2 | `fatFloorG` loses its ceiling cap | killed — the 150 kg case |
| 3 | baseline takes `min` of target and floor instead of `max` | killed — 6 tests |
| 4 | clamp stops using the shared floor (`fatMin = 0`) | killed — 2 tests |
| C | the three constants inlined as `0.25` / `0.4` / `0.6` literals | **survived** (correct) |

The control is the one that matters here: extracting named constants must not change a number, and
it did not.

## Not done

- **The clamp is still called, and must be.** Its *calorie* floor is load-bearing for every cutting
  user — `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500, and `bmr × 1.2 − 500 < bmr` for any BMR under
  2,500. The entry warns against closing this by deleting the clamp; that warning is correct.
- **No re-run of the owner's recommendation, and no write to his targets.** `LA-126` is explicit
  that the write is his one tap, and a decision recorded in a backlog entry is not a hand on the
  database.
- **Failure surfaces not exercised:** the device, and production data. The change is pure
  arithmetic in a shared module, but the sheet that renders it has not been looked at on the S25.

<a id="2026-09-23-lane-a-la129-fix-withholds-tolerated-slack"></a>

# 2026-09-23 — LA-129: the conflict was self-inflicted, by `--fix`

**Branch:** `lane-a/la129-fix-does-not-lower-tolerated-slack` · **Lane A** · one script and its
existing test file. No product code, no migration, no user-visible change.

## The entry told me to measure before building, and the measurement killed the premise

LA-129 proposed generating the doc-size baselines in CI to remove a conflict class, and carried a
`⚠ RE-VERIFY` block saying RV-134 had shipped a cheaper half hours earlier and that the tax should
now be *"mostly gone — measure it again before assuming the class still exists"*.

It does not exist. Take current `main`, strike forty lines from the backlog, touch no `.size` file,
and run the plain check:

```
check-doc-index-size: 1 file(s) carry slack within their band — not a failure:
    docs/implementation-backlog.md: 40 lines of slack (band 546) — lower it when you are next
    editing this file anyway.
exit 0
```

**No edit is needed.** RV-134's band already did that.

## So where were today's conflicts coming from? From me

`check-doc-index-size.js --fix` lowered the baseline for **any** non-ok verdict — including slack the
check tolerates. Running `--fix` after every edit is a habit, not a rule (it appears nowhere in
CLAUDE.md), and it meant every PR that struck a backlog entry — nearly every PR — rewrote
`docs/doc-size/docs/implementation-backlog.md.size`. Two concurrent PRs then collided on a one-line
file that neither of them actually needed to change.

This lane paid that three times on one branch inside forty minutes today, each costing a full local
gate, and wrote it up twice as evidence *for* LA-129. It was evidence for a one-line bug in `--fix`.

## What shipped

`--fix` now withholds when the gap is within the file's band, and **says what it withheld** — a
silent withhold would read as the flag doing nothing:

```
check-doc-index-size --fix: left 1 baseline(s) alone — slack within band (LA-129):
  • docs/doc-size/docs/implementation-backlog.md.size: left at 27313 (file is 27273, within its 546-line band).
```

`--tighten` lowers deliberately, which is the compaction sweep's job. Two things deliberately
unchanged, because they are what the ratchet is *for*:

- **growth still raises** the baseline, and
- **slack over the band still lowers** it — there the check genuinely fails, so a `--fix` that
  withheld would leave the gate red and look broken.

Verified all four paths against the real repo before writing the tests.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | withholding removed (the old behaviour) | killed |
| 2 | withholding widened to swallow growth too | killed — 3 tests |
| 3 | `--tighten` ignored | killed |
| C | `limit - lines <= slackBand(limit)` written as `slackBand(limit) >= limit - lines` | **survived** |

The control passed first time, which is worth noting only because the previous three did not: on
TN-60, RV-82 and DV-13 the control failed because the assertion pinned syntax rather than the
contract. This one compares a value.

## LA-129 is rerouted, not deleted

Every cost argument in it was a conflict cost, and that cost is gone. What CI-generation would still
buy is not carrying `docs/doc-size/**` at all — against the ceiling it removes, which **the entry
itself** named as the part worth keeping, and against a design question nobody has answered (how
growth is caught from a derived baseline).

That is no longer an implementer's call, so the entry moves to **`Lane: O`** with the measurement
recorded and an explicit *do not build this on the old justification*. The owner named CI-generation
as "the better long-term answer" and it is his to keep or strike; deleting the entry would have
thrown away his intent, and building it would have been acting on a premise that no longer holds.

## Not done

- **No sweep of the existing slack.** Several tracked files now carry tolerated slack that nothing
  will lower until someone runs `--tighten`. That is the compaction chore, and it is deliberate —
  doing it here would have written to exactly the files this change exists to stop writing to.
- **Failure surfaces not exercised:** none that matter here — this is a build-time script with no
  device or production path. It was run against the real repo in all four states as well as in the
  sandbox.

<a id="2026-09-23-lane-a-la130-unshallow-once"></a>

# 2026-09-23 — LA-130: the gate was re-shallowing the clone

**Branch:** `lane-a/la130-unshallow-once` · **Lane A** · one CI step, the session-start hook, and the
CLAUDE.md Git Workflow rule. No product code.

## The cause is `pnpm check:rules`, and it is deterministic

```
before:             shallow=absent   count=1445
pnpm check:rules
after check:rules:  shallow=PRESENT  count=2
```

`check:rules` exists to run **every step** of the Custom Rules job against the local clone — that is
the whole point of it, and it is why the gate is trustworthy. One of those steps was:

```yaml
run: git fetch --depth=1 origin main || true
```

which is correct in CI, where `actions/checkout` is depth-1 and `origin/main` genuinely is not
there. Replayed against a developer's own clone it truncates that clone to two commits, every run.

**And `check:rules` is run immediately before every push.** So the clone was freshly shallow at
exactly the moment its ancestry mattered: the branch loses its history, `git merge origin/main`
fails with *"refusing to merge unrelated histories"*, GitHub reads the PR as conflicted, and **a
conflicted PR is never given a workflow run** — `get_check_runs` returns `total_count: 0` forever
while CI runs normally for everything else. Four PRs (#1426, #1428, #1430, #1435) were abandoned to
this with sound diffs.

## Two wrong diagnoses, and the same reason both survived

`LA-130` — which I filed this morning — said a bare `git fetch origin main` **re-shallows the clone
every time**, "four separate times". CLAUDE.md carried it as a rule: unshallow on *every* fetch.

The first attempt at this entry then went the other way and claimed the opposite: that one
unshallow immunises a clone permanently. That was measured on purpose-built `--depth=1` clones —
0 re-shallows in 16 bare fetches across two clones, including fetches of branch tips never seen —
and it was **also wrong**, because those clones never ran `check:rules`. The working clone was
re-shallowing between observations, just not from the command being blamed.

What let both stand is one detail worth keeping: **`git fetch --unshallow origin` fatals** on an
already-complete repository — *"--unshallow on a complete repository does not make sense"*. Every
invocation today was piped through `tail -1` beside a second command, so a fatal and a success read
identically, and the conclusion that follows is "the unshallow worked, so something undid it"
rather than "it never ran".

A fetch cannot *deepen* a shallow clone. That is all the bare fetch was ever guilty of.

## What shipped

**The CI step is guarded on the ref being absent:**

```yaml
run: git rev-parse --verify --quiet origin/main >/dev/null || git fetch --depth=1 origin main || true
```

In CI the ref is absent, so it fetches and nothing about the gate changes. Locally it is a no-op.
Verified both ways: `check:rules` afterwards still reports **Ran 77 of 77** and leaves the clone at
1,445 commits; with `refs/remotes/origin/main` deleted, the guarded command fetches it back.

**The session-start hook does one repair** for `$CLAUDE_PROJECT_DIR`, guarded on `.git/shallow`
because running `--unshallow` blind on a whole repository is an error rather than a no-op. It is
deliberately last in the hook and non-fatal: the hook runs under `set -euo pipefail`, and the
`unset DATABASE_URL` / `unset DATABASE_SSL` writes above it are what keep `pnpm dev` off the
production database — a fetch that aborted the hook before those writes would be a far worse
failure than a shallow clone.

## Mutation pass

Behaviour against real clones; a YAML step and a bash hook have no suite to run.

| # | mutation | observed |
|---|---|---|
| 1 | CI guard removed (the original step) | `check:rules` takes the clone 1,445 → 2 again |
| 2 | guard inverted (fetch only when the ref EXISTS) | CI case never fetches — the ratchets lose their base and degrade to baseline-only |
| 3 | hook's `test -f .git/shallow` guard removed | prints `fatal: … does not make sense` and fires the warning every session on a complete clone |
| 4 | hook's `\|\| echo …` fallback removed | `set -e` aborts the hook; the line after never runs, which is why the block is last |
| C | hook guard written `[ -e … ]` instead of `[ -f … ]` | identical in both clone states (correct) |

## Not done

- **No wrapper, alias or git config for fetching.** The entry floated all three; with the real cause
  found there is nothing for a per-fetch mechanism to protect against. There is also no `fetch.depth`
  config in git, so the option the entry preferred never existed.
- **The other batons still carry the old rule** (`bugfix.md`, `review.md`, `tuning.md`,
  `implementation-lane-b.md`). Those files belong to those roles; CLAUDE.md is the shared authority
  and it is corrected. Lane B's note — that `--unshallow` does not update `origin/main` on an
  already-unshallowed repo — is the same fatal seen from the other side, and is right.
- **Failure surfaces not exercised:** the hook was run as an extracted block against real clones,
  not by starting a session end-to-end; that happens on the next session start. The CI branch of the
  guard was exercised by deleting the ref locally, not by a real depth-1 `actions/checkout` — this
  PR's own Custom Rules run is the first real test of it.

<a id="2026-09-23-lane-a-lb128-revalidate-error"></a>

# 2026-09-23 — LB-128: the failure a caller could not be told about

**Branch:** `lane-a/lb128-revalidation-error` · **Lane A** · `lib/sqlite/cache.ts`,
`packages/shared/src/fetch-with-retry.ts`, plus the one caller the entry was written for. No
migration, no schema change.

## The entry held up at source, both halves

`cachedFetchCore` gates `onError` on `cached === null` in **both** failure branches — the `!res.ok`
one and the network-throw one — and joined waiters skip on `hadCached`. So a failed revalidation of
a key that painted from cache reached nobody.

`fetchWithRetry` has the mirror-image blind spot, and it is the one that makes the first
unavoidable: `responded` is set by **any** `onData`, and a cached paint is an `onData`. The ladder
stops on attempt 0 and `onExhausted` never fires. From inside the helper, a cached paint plus a
dead network is indistinguishable from success.

Together: no caller could report a failed refresh of a key holding a cached value — exactly the
post-write case RV-103 was about, whenever the write's invalidation had not yet cleared the entry.

## The fix is a complement, not a relaxation

`onRevalidateError` fires **only** when a cached value *was* painted. `onError` and it are mutually
exclusive by construction, which is what the tests pin.

The entry's warning was the design constraint and it is right: **ungating `onError` would have been
wrong.** Every existing caller reads it as *"I have nothing to show"*, and `useCachedValue` renders
an error state from it — so ungating would have replaced good cached data with error cards across
the app.

It stays gated on being **online**. Offline with saved data is the sanctioned offline-first case,
the outbox carries the write, and an error card there would be a lie about what happened.

`fetchWithRetry` forwards it, guarded on `isCancelled()` for the same reason `onExhausted` is. It
can fire on more than one attempt, so a caller rendering from it must be idempotent — which the one
caller is, because `refetch` clears the flag first.

## The caller was wired, and that was not scope creep

`app/nutrition/use-energy-balance-refetch.ts` carried a long comment ending *"needs
`lib/sqlite/cache.ts` to offer an ungated failure channel, which is Lane A's, and is filed as
LB-128"*. That sentence becomes false the moment this ships, so the file had to be touched
regardless; wiring `onRevalidateError` beside `onExhausted` is one line on top of that.

The two channels cover different halves of one failure. `onExhausted` covers the post-write norm —
the invalidation emptied the key, the retries run against nothing. `onRevalidateError` covers the
residue — a stale entry survived the invalidation and painted. RV-103 measured that residue as a
flake: the same code reported or stayed silent on consecutive runs, decided only by whether the
entry happened to be in the cache. **The flake was the finding.**

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `!res.ok` branch never fires the new channel | killed |
| 2 | network-throw branch drops the online gate | killed |
| 3 | waiters with cached values skipped again | killed |
| 4 | `fetchWithRetry` accepts the option, never forwards it | killed |
| 5 | caller takes `onExhausted` only | killed |
| C | fire via a named local instead of inline | **survived** (correct) |

Mutant 2 is the one worth keeping: it would make the app report a failure every time the user is
simply offline, which is the opposite of what this codebase is built for, and nothing else in the
suite would have caught it.

## Not done, and one thing I am flagging rather than fixing

- **`cachedFetchCore` now takes ten positional parameters.** That is one too many to read, and the
  honest fix is an options object — deliberately not done here, because it touches every call path
  and would bury a behavioural change in a signature refactor. Worth a separate entry if anyone
  adds an eleventh.
- **RV-103's `Keep:` was updated rather than struck.** Its reporting path now has a working channel,
  but the **device check is still owed** — the failure line and its Retry at S25 width, in the card
  that carries "kcal left".
- **Failure surfaces not exercised:** the device. These are jsdom tests against localStorage,
  because `isSQLiteAvailable()` is false there; the native SQLite cache path is not run, and neither
  is the real offline transition (`navigator.onLine` is stubbed).

<a id="2026-09-23-lane-a-rv77-reverified-not-built"></a>

# 2026-09-23 — RV-77: the structure is real, the duplicate is not, and the path has never run

**Branch:** `lane-a/rv77-reverify` · **Lane A** · docs only. No code changed — that is the finding.

## Why nothing was built

RV-77 reached the top of Lane A's READY list and says meal-plan generation *"can fire the same
top-up model call twice for one meal"*, with a fix: key the top-up on (meal name, rounded shortfall).
Three checks against current `main`:

**1. The structure is real.** `generate/route.ts` does `Promise.all` over day-variants and then over
meals within each, calling `scaleWithTopUp` per (variant × meal). `loggedGenerateObject` takes a
`fingerprint`, but `lib/ai/instrument.ts` hashes it for the log row and **never dedups on it** — its
own comment says a fingerprint is *"a diagnostic, not a payload"*. So nothing collapses two calls.

**2. The two calls are not duplicates.** The rest variant subtracts `REST_DAY_CARB_REDUCTION` (0.15)
of carbs and `carbShift × 4` calories, so the two variants scale the same ingredient list toward
**different targets** and reach **different shortfalls**. The proposed key would collapse them only
when the shortfalls happen to round together. **A fix built to the entry's description would be a
near-no-op that reads as done** — the worst outcome available here.

**3. The comment it cites agrees with the code.** `:376` says *"One ingredient list serves both
variants"*, and that is what happens: `names[i].ingredients` is shared, and the *scaling* is
deliberately per-variant, which the same comment spells out (*"same meal, more rice on a training
day"*). The entry read a contradiction into a comment that does not contain one.

## And the measurement that settles it

The entry flagged *"no `meal-plan-top-up` row in `ai_call_log` at all"*. Re-measured three days
later:

| section | calls, all time | last |
|---|---|---|
| `meal-plan-top-up` | **0** | — |
| `meal-plan-generate` | **2** | 2026-09-01 |

The whole feature has run **twice, ever**, three weeks ago, and the call site this entry optimises
has **never executed**. The measured saving is nothing.

## What shipped instead

- **RV-77 rewritten in place** with all three findings and moved from position 1 to 8 — below the
  entries whose code paths actually execute. It rose to the top only because everything above it
  shipped, which is the queue working correctly rather than a signal to build it. If it is ever
  built, the honest fix is the entry's *second* option (top up once on the training variant, re-scale
  its merged list for the rest variant), which changes plan output and so needs a before/after on a
  real plan — which needs the feature to be in use.
- **LA-131 filed**, found while reading: `REST_DAY_CARB_REDUCTION = 0.15` is declared **twice**, in
  `generate/route.ts` and `[id]/structure/route.ts`, and so is the three-line derivation around it.
  Those are the generate and restructure paths for the same plan, so if one copy is ever tuned and
  the other is not, restructuring silently re-targets every rest-day meal against a different
  definition of a rest day. They agree today, which is the cheap moment to merge them.

## The pattern this is the ninth instance of

Nine entries were worked today. **One — DV-7 — was accurate as filed.** The rest were right about a
measurement and wrong about the conclusion drawn from it, or already fixed by another entry, or
pointed at the wrong component. Two were mine, and one of those was my own correction of an earlier
mistake. The re-verify step is not ceremony; it is where most of the value has been.

## LA-132, found by the merge this PR needed, and fixed here

Raising the backlog's baseline printed a warning nobody had seen resolved before:

```
base-ref: could not read docs/implementation-backlog.md at origin/main after 3 attempts.
          git said: spawnSync git ENOBUFS
```

`docs/implementation-backlog.md` is **2,112,034 bytes** and node's default `maxBuffer` is 1 MB, so
`git show <base>:<file>` failed and the base read was treated as **absent** — which `base-ref.js`
documents as the STRICT path. The consequence is precise: the Q-424 `inherited` escape hatch, which
exists so a branch is not blamed for growth that `main` already carries, **had silently stopped
working for the single file most likely to be grown by someone else's merge.**

`base-ref.js`'s own comment says of this failure that *"the mechanism behind this failure has never
been reproduced, so the next occurrence has to identify itself"*. It has: it is a file crossing a
megabyte, and it arrives without warning on the day that happens. `maxBuffer` is now 256 MB, and the
same run then reported `33 of which this branch added` — the attribution working again.

Fixed in this PR rather than filed, so there is no orphaned finding.

## Not done

- **No code change, deliberately.** Building the entry as written would have produced a fix that
  collapses almost nothing on a path that does not run.
- **Failure surfaces not exercised:** none apply — nothing executable changed.

<a id="2026-09-23-lane-a-rv82-program-double-fetch"></a>

# 2026-09-23 — RV-82: the second fetch, and the trap in removing it

**Branch:** `lane-a/rv82-program-double-fetch` · **Lane A** · the repository type, the adapter and
three API routes. No migration, no schema change, no client change.

## The measurement held

Both routes called `repo.getActiveProgram(userId)` in the same `Promise.all` as `getNextSession`,
and `getNextSession` calls `getActiveProgram` itself. It is a fixed **5-query composite**, so
`programs`, `program_sessions`, `schedules`, `schedule_days` and `session_exercises` each ran twice
per request — 5 wasted statements of 22 on `/api/next-session/prescription`, and of 19 on
`/api/progress-summary`. Verified at both call sites and in the adapter.

## The entry's two suggested fixes are not equivalent, which it does not say

> *"have `getNextSession` accept an already-fetched program, or have those two routes call
> `getNextSession` alone and read the program off its result."*

**Passing one in would serialise what currently runs in parallel.** Today `getActiveProgram` and
`getNextSession` are both in the routes' `Promise.all`, so the wall-clock cost is the slower of the
two. Fetch the program first and hand it in, and the route pays `getActiveProgram` *then*
`getNextSession` — fewer queries, more latency.

**Reading it off the result keeps the parallelism**, because `getNextSession` already fetched it
inside its own `Promise.all`. That is what shipped.

## What the entry also does not mention, and it would have been a regression

`NextSessionRecommendation` did not carry the program, so the fix means adding a field — and
**`/api/next-session/route.ts` serialises that object WHOLESALE** with
`NextResponse.json(recommendation)`. Left alone, the home card's most-fetched response would have
grown by the entire active program: every session, every exercise, the schedule.

That route now strips it. Checked the other two consumers rather than assuming:
`session-explain/insight` and `lib/ai-chat/tools.ts` both pick named fields and needed no change.
There is also only one repository implementation, `PostgresWorkoutRepository`, so no second copy to
keep in step.

## The trap that nearly shipped

`getNextSession` builds a `rem` object — the reminder pair — spread into most of its returns. The
obvious move was to add `program` to it, rename it `common`, and be done.

**`...common` is also spread into `computeAiDynamicNextSession`'s INPUT**, and that function
destructures named fields and rebuilds its own result:

```ts
const { sessions, …, reminderEnabled, reminderTime, … } = input
const rem = { reminderEnabled, reminderTime }
```

So the program was silently dropped on the **ai_dynamic path** — the live one for a program with
`phaseMode === 'ai_dynamic'`, which is exactly what the prescription route branches on. Both routes
would have read `undefined`, fallen back to `null`, and behaved as though the user had no active
program.

**TypeScript cannot see this**: `program` is optional, so every path compiles. It was found by
reading the scorer, not by the compiler and not by any existing test.

The fix separates the two concerns by name: `reminders` is what the scorer is given (its actual
input), `common = { ...reminders, program }` is what this method's own returns spread, and the one
ai_dynamic return — the scorer's object, not ours — attaches `program` explicitly.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | ai_dynamic return drops `program` (the bug above) | killed |
| 2 | `...common` fed to the scorer instead of `...reminders` | killed |
| 3 | `/api/next-session` stops stripping before serialising | killed |
| 4 | a route re-fetches with `getActiveProgram` | killed |
| C | `common`'s key order swapped | **survived** (correct) |

**The control failed first time, and was right to.** The assertion pinned the literal string
`const common = { ...reminders, program }`, so a reorder that changes nothing — the two share no
keys — failed it. Same slip as TN-60's control earlier today. It now matches the contract:
`common` contains the reminders spread and the program, in any order.

## Not done

- **No per-user memo of `getActiveProgram`.** The entry forbids it explicitly, and the reason is
  good: the same launch reads the program 8 times across 22 warm routes, and collapsing that trades
  against config-save freshness. That is a decision, not a cleanup, and it needs its own entry.
- **No latency figure, still.** The entry could not produce one (dev wall times are flat ~350 ms
  regardless of query count, from compile overhead) and neither can this: the cost against
  Railway's private network is unmeasured. This is filed as shape, not as a speed fix.
- **Failure surfaces not exercised:** the device, and production. The tests are source-level scans
  for the reason stated in the file — the invariant they pin is one the compiler cannot express.

<a id="2026-09-23-lane-a-tn60-compressive-tail"></a>

# 2026-09-23 — TN-60: the rail was where the information went

**Branch:** `lane-a/tn60-compressive-tail` · **Lane A** ·
`packages/shared/src/health/readiness-composite.ts`. No migration, no schema change. **The history
recompute was NOT fired** — it is batched behind TN-6, BF-13 and LA-121 per the owner's 2026-09-22
decision, so stored days keep their old scores until that single `rederive-baselines` run.

## I nearly skipped this, and checking is what stopped me

My own check-in said TN-60 was owner-gated scoring work Lane A must not take. The entry says
**"✅ OWNER DECIDED 2026-09-22 — build option 1, the compressive tail. The gate is lifted; this is
startable."** Skipping it would have been enforcing a gate the owner had explicitly removed. The
lesson is the ordinary one: re-read the entry, do not act on a summary of it — including my own.

## What the entry measured, and what it could not have known

Over 69 days, `hrvBalance` — the largest single source of movement in readiness at 22.8% — sat on a
rail on **26 of them (38%)**. The z values scoring 0 spanned **−1.63 to −4.37**: 2.7σ rendered as
one number, so a mildly poor night and the worst in the record were indistinguishable.

The entry said the fix needed no constant — *"nothing needs re-fitting, it is a shape change rather
than a constant change"*. **That is not true, and the reason is integer rounding.** The tail has to
be paid for out of the linear region, and how much you reserve decides whether the tail does
anything at all:

| band | linear kept to | worst days separated | still railed |
|---|---|---|---|
| 5 | z = 1.35 | 3 of 7 | 3 |
| 10 | z = 1.20 | 4 of 7 | 0 |
| **20** | **z = 0.90** | **6 of 7** | **0** |
| 30 | z = 0.60 | 7 of 7 | 0 |

Today's hard clip separates **1 of 7**. Put to the owner with that table; he chose **20**.

## Two calls I made myself

**Algebraic tail, not exponential.** An exponential is the obvious smooth saturation and it fails
the one job here: it decays fast enough that integer rounding re-ties the extreme days. At a
5-point band it separates 2 of 7 and leaves 8 values pinned at a rail. This is now enforced by a
test rather than a comment — swapping in an exponential makes ±10σ round back to exactly 100.

**The tail lives in score space, not z space.** `compressTails(raw)` takes a value already in linear
points, so one implementation covers `higher-better`, `lower-better` and the double-slope
`closer-better` without a second formula to keep in step. Value and first derivative both match the
linear region at the knee, so there is no kink.

## The cost, stated plainly: readiness can no longer reach 100

A saturating curve and a reachable ceiling are the same thing — the ceiling **is** the rail. So:

- a contributor at ±1.5σ scores **90 / 10**, not 100 / 0;
- a 1.5σ-on-everything day with a good check-in reads **95**; without one, **90**;
- an integer 100 would need roughly **23σ** past the knee.

This partially re-creates what the 2026-07-22 recalibration was written to remove — that note calls
the old ±2.5σ rail's *"capping readiness ~86 even on a perfect day"* a defect. 95 is much milder
than 86, and it follows necessarily from the shape the owner chose, so it shipped rather than going
back for a third decision. **It reverses with one constant** (`TAIL_BAND_POINTS`).

## Mutation pass — and the one that survived first time

| # | mutation | result |
|---|---|---|
| 1 | exponential tail instead of algebraic | killed |
| 2 | band narrowed to 5 | killed |
| 3 | lower tail removed (floor hard-clips again) | **survived → new test → killed** |
| 4 | upper tail removed | killed |
| 5 | knee offset `100 - W` → `100` | killed |
| C | `W/(1+x/W)` rewritten as `W·W/(W+x)` | **survived** (correct) |

**Mutant 3 is the find.** Deleting the lower tail outright — so the floor rails at 0 exactly as
before — passed all 1004 tests in the package. Every case I had written exercised the *ceiling*,
while TN-60's entire measurement is about days scoring **zero**. There is now a case for the floor,
and it kills it.

**The control earned its keep too.** It failed on first run, and it was right to: I had asserted a
*strict* decrease across all seven worst days when the design delivers 6 distinct of 7 — the number
the width was chosen on. Float noise moves which adjacent pair ties. The assertion now pins the
contract (non-increasing, ≥6 distinct, none at 0) instead of pinning noise.

## Not done

- **`READINESS_MODEL_VERSION` bumped to `v4:tail20:2026-09-23`** so a stored score can be attributed
  to the model that produced it. Rows written before this keep the old stamp and the old numbers.
- **The history recompute is deliberately not run here** (owner decision — batched).
- **Failure surfaces not exercised:** the device, and production data. The 69-day figures are the
  entry's, re-used; I did not re-query them. The pass test's *"share-of-movement table moves toward
  the declared weights"* cannot be confirmed until the batched recompute runs — so it is **not
  claimed**, only the per-contributor resolution is.

<a id="2026-09-23-review-device-probe-entries"></a>

# 2026-09-23 — a probe checklist for the device agent, and the ten entries behind it

**PRs:** #1418 (checklist + RV-124…RV-133), and this branch (RV-134).
**Docs-only.** No code changed; nothing was run against a device.

## What the owner asked for

A device-verification agent that drives the S25 APK's WebView over DevTools now exists, and he asked
what the Review Agent would want it to check. The answer is
[`docs/device-agent-probe-checklist.md`](../device-agent-probe-checklist.md) — ten probes, each
naming the open entries it settles.

**It is deliberately not a tap-list.** Two device docs already exist and both are written for a human
holding the phone. An agent with CDP is a different instrument, and asking it to re-run a smoke test
wastes it. So every probe is something only instrumentation can answer: counting requests after a
write, enumerating computed styles across every route, capturing transition frames, reading the local
store that returns null in the sandbox.

## The thing the checklist got wrong within hours of being written

The Device Verification role landed in #1417 **after** the checklist was drafted, and the checklist
contradicted it: it said a probe returns *"never a verdict"*, while the role requires exactly one of
VERIFIED / FAILED / COULD NOT CHECK. The verdict stands; what the checklist adds is that it must
carry the measurement that produced it. Corrected in the same PR, and recorded here because it is a
clean example of two docs drifting inside one night.

Reconciled at the same time: `scripts/device/` already covers part of the spec — `probe.js` is P4's
anchor measurement, `record.js` is P5, `tour.js` is P9 plus a padding digest — so the genuinely new
asks are P1, P2, P3, P7, P8 and P10.

## Two constraints that came from the DV baton, not from reading code

- **The phone is on three-button navigation.** Every clearance measurement is meaningless there — the
  inset is generous and a broken floored utility passes anyway. RV-127's clearance half is COULD NOT
  CHECK until the owner switches to gesture nav, which the DV baton independently names as the single
  owner action unblocking its largest group.
- **The phone is signed into production.** P1 and P3 are built on real writes to the owner's real
  data, so RV-124 and RV-126 say to get his go-ahead per write type and prefer the reversible ones.

## Filing them took three attempts, and that is the durable lesson

These are the first entries whose **only** work is the device check — before the role existed, no
such thing could be filed. Neither field fits cleanly:

| field | why it is wrong here |
|---|---|
| `Gate: device` | parks the entry as unstartable **and** is not selected by `--sittings` — it would hide them from the one agent that can run them |
| `Verify: device` | reads as *shipped*, and the protocol warns against that misuse twice |

`Verify: device` won because it is the only field `--sittings` selects on, and the warning is aimed
at **unbuilt work that still needs implementing**. These have no build half, so nothing is hidden and
nothing is blocked — and each entry says so in its first bullet so no later reader mistakes it for
shipped code.

**Checked rather than assumed**, after a first test gave a false positive (a `grep -A200` spilled past
the READY heading into later sections): 10 of 10 reach `--sittings`, 0 leak into either lane's READY.
Two were parked by their own emphasis glyph — `next-item.js` reads `⛔ …block` within 40 characters as
the legacy blocked marker, and *"⛔ The clearance half is BLOCKED"* matches exactly. Same trap that
parked eight entries in sweep 52. Swapped to `⚠`; LB-121 still owns the systemic half.

## RV-134 — the `.size` conflict tax, with its mechanism named

Three of three merges this session conflicted on
`docs/doc-size/docs/implementation-backlog.md.size`, matching Tuning's independent five-of-seven.
Tuning measured the cost and said it *"needs its own entry"*; this is that entry, and it adds the
mechanism: the ratchet's growth direction has an `inherited` escape and **the slack direction
deliberately does not**, so every implementer PR that completes an entry shrinks the backlog and the
next branch is required to lower a number it did not move. The fix is to give slack the same escape.
Filed as a structural call rather than an owner question, per the 2026-09-22 narrowing.

## Not established

Nothing in the checklist has been run. It is a specification, and the first pass against a real device
is what turns it into findings.

---

# Sweep 54 — reading the instruments (same PR)

Write-up: [`docs/reviews/2026-09-23-sweep-54-reading-the-instruments.md`](../reviews/2026-09-23-sweep-54-reading-the-instruments.md).

A different angle from 50–53, which all read source: this one reads what the app and its guards have
already **recorded**, and asks whether anyone acted on it. Both findings are the same shape — an
instrument gave its answer and the document directing people still states the question.

- **RV-135.** `lib/resume-repaint.ts` shipped a measurement pass to decide native-vs-JS and wrote the
  criterion into its header. The answer is **25 `recheck stuck`, 0 `resized`, 0 `dom-lost`** — native,
  unambiguously. BF-110's body already records that (sweep 50, 2026-09-18); its **`Keep:` still says
  the reading is what is owed**, and `next-item.js` reads the `Keep:`, so the entry sits in KEEP under
  *"not new work"* while the native fix is unowned. Re-measured: `stuck` at `h=667` has gone 3 → 9 and
  first readings at `h=667` 22 → 28 since sweep 50, so it is growing, not fading.
- **CLAUDE.md corrected in place, not queued.** Its cache-invalidation rule claimed
  `check-fetch-once-effects.js` freezes 36 sites with **19 that can bite**. The script's baseline says
  **11 across 9 files** and `CAN BITE … 0 sites. Emptied 2026-08-19` — wrong for five weeks, in the
  file every session reads first, inside the project's most repeated bug class.
- **It had already propagated.** RV-125, filed earlier in this same session, quoted the stale split
  and called it *"reasoned, never observed"* — itself wrong, since it **was** re-observed and that
  observation is what emptied the group. Amended. Its premise stands: the script skips non-empty dep
  arrays by design, so `useEffect(…, [userId])` inside the persistent shell is still invisible to it.

**Healthy, and recorded so a later change has a baseline:** DB **232 MB**, **1.53 MB/day** over three
days against the ~1.71 expectation; `error_events` 52 MB behind 172 rows, unchanged bloat, already
owner-gated; the other three shrink-only ratchets clean with current baselines; and no fault of the
owner's in seven days that is not `bf110 resume` — phrased that way because `claude_ro` is row-scoped
and cannot support the stronger claim.

**Not established:** nothing was rendered or run on a device. Why a 384×667 resume paints two children
instead of seven is the module's reading of its own data, not an observation — which is what RV-130
asks the device agent for.

<a id="2026-09-23-review-dv-performance-probes"></a>

# 2026-09-23 — the performance half of the device-agent brief

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## What prompted it

The owner asked whether the Device Verification agent had been given a sweep of the checks it can
*really* test — page-load efficiency, timing, path structure. **It had not.** Of the ten probes filed
in #1418, only P6 (warm-visit paint) and P10 (heap and listener accumulation) touched timing; the
other eight are correctness — invalidation reachability, the local store, offline, computed styles.
That is a real gap and the answer was "no", not "partly".

## Why it is worth filing rather than just running

The repo already has a perf thread, and it is **stalled on exactly this measurement**:

- **Q-51** softened to the owner's *"Its mostly fine; I'd still like it to be faster if possible"*,
  and its own conclusion is that *"measure before refactoring" is now **more** binding, not less* —
  a large refactor is a poor trade against "mostly fine".
- **The whole queue's perf evidence is one observation**: `/workout` visited five times in a session,
  four at ~100 ms and one at **1086 ms**, all warm. Read as a first-mount cost. The remaining
  file-splitting work rests on that reading.
- **BF-22** is an owner report already narrowed to in-memory client state — *"everything is loading
  very slowly"*, then *"actually its running a lot better after a force restart"* — with the
  server-distance theory measured and found wrong.
- **RV-110** counts 37 cross-tab `router.push` sites that tear down the tab shell, and has **no
  number for what a teardown costs.**

So each entry is aimed at an open question that already exists, rather than at producing a fresh pile
of numbers nobody asked for.

## The six

| | probe | what it settles |
|---|---|---|
| **RV-137** | P11 — cold start + per-tab TTI | gives the perf thread its first baseline; Q-51 and Q-147 both closed on impressions |
| **RV-138** | P12 — the 1086 ms outlier as a distribution | whether Q-51's file-splitting work is justified or the reading was noise |
| **RV-139** | P13 — network waterfall, chain depth | serial request chains, which no source-reading sweep can see |
| **RV-140** | P14 — main-thread long tasks | RV-113's asserted cost; and whether `animationiteration` still takes 21.3% |
| **RV-141** | P15 — path structure | RV-110's missing cost-per-teardown |
| **RV-142** | P16 — does a long session slow down | the timing half of RV-133; together they decide BF-22 |

**Cold start is measurable now and was not before**, which is why this did not exist. A recording
cannot span an app kill — the WebView dies with it. But `performance.getEntriesByType('navigation')`
and `('paint')` survive for the life of the page, so a harness that attaches *after* a normal cold
start loses nothing. `device-perf-profiling-checklist.md` had already worked that out and had no
agent to run it.

## Routing, checked rather than assumed

6 of 6 reach `next-item.js --sittings`; **0 leak into either implementer lane's READY list.** Same
`Verify: device` filing as RV-124…RV-133, with each entry stating in its first bullet that there is
no build half — these are measurements, not shipped work awaiting a look.

## Not established

Nothing was run. Every threshold in the entries (300 ms warm, 1.5 s FCP, 50 ms long task, chain depth
2, 20% drift over a session) is a **stated expectation to be falsified**, not a measured budget — the
app has never had one. A probe that comes back green against these is as useful as one that fails,
because it is the first baseline either way.

## A fifth datapoint for RV-134, collected by accident

This PR conflicted on `docs/doc-size/docs/implementation-backlog.md.size` and the append-only
history file — **five of five merges tonight**, after RV-134 recorded four of four and Tuning
recorded five of seven. That entry argues the mechanism is the ratchet's missing `inherited` escape
on the *slack* direction, and this merge is another instance: `main` had shrunk the backlog below
the number on this branch, so the branch was required to lower a figure it never moved.

Not re-filed — RV-134 already holds it. Recorded here because the count is the evidence, and a PR
that demonstrates the defect it is not even about is worth one line.

<a id="2026-09-23-review-sittings-misses-gate-device"></a>

# 2026-09-23 — the device agent could not see the work that is blocked on it

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## The question, and the honest answer

The owner asked whether everything the Device Verification agent needs had been backlogged. **It had
not.** Checking rather than asserting found a gap that is structural rather than an oversight in any
one entry.

`next-item.js --sittings` is the device agent's work list. Its filter:

```js
if (e.verify?.value === 'device') return true;
return /\bdevice\b|\bS25\b|\bAPK\b|on-device/i.test(e.keep?.text ?? '');
```

**`Gate:` is never consulted.** Measured on `main`: 29 entries carry a `Gate: device` field and
**24 of them do not appear in `--sittings`**.

## Why that is worse than "missing"

A `Gate:` **parks** an entry. So those 24 are skipped by both implementer lanes *because* they need
the device, and are invisible to the one agent that has the device. Nothing surfaces them to anybody
— they are in a dead zone, and they include **Q-51**, the perf entry this session built six probes
around, and **BF-22**, the owner's own *"a lot better after a force restart"* report.

## The cause is a role that changed the meaning of a field

`--sittings` was built around *shipped work owing a look* — BF-90 found eleven entries writing the
same debt in both `Verify:` and `Keep:`, which is what the filter reads. Before 2026-09-23 a
`Gate: device` meant **wait for the owner to pick up the phone**, so leaving it out of a "what could
one sitting clear" view was correct.

The Device Verification role changes what that gate means: it now reads **the DV agent can unblock
this**. And a gated entry is *more* urgent for that agent than a `Verify:` one — one blocks work, the
other is a look owed on work already shipped. The field's meaning moved; the selector did not follow.

## What RV-143 asks for

Select `Gate: device` in `sittingsOnly` too, and print which field each row came from so a reader can
tell *blocked-on-this* from *look-owed-on-this*. About three lines.

The entry carries a triage of all 24 so the fix does not simply dump them on the device agent:
roughly **13 runnable now**, **5 needing the Colmi R09 in hand**, **2 needing a production write or
the owner physically present**, and **4 that look mis-gated** and are really design specs.

**⚠ The entry states one thing not to do:** bulk-converting `Gate: device` → `Verify: device` to make
them visible. `Verify:` means shipped, the protocol warns against that misuse twice, and applying it
to 24 unbuilt entries would file them under *"done; a look is owed, nothing is blocked"* — worse than
the present silence, because then a reader in either place stops looking. The selector is the defect.

## Not established

The triage was read from entry headings and each entry's own gate reasoning, **not** from re-verifying
against the code. Whoever takes RV-143 should re-read each of the 24 rather than trusting the split —
that caveat is in the entry.

<a id="2026-09-23-rv106-rv107-rv109-stale-surfaces"></a>

# 2026-09-23 — RV-106 / RV-107 / RV-109: three surfaces that never asked again (`fix/rv106-rv107-rv109-stale-surfaces`)

Batch `stale-surface-subscribe`, all three from Review sweep 53, all three the Q-402 shape: the
write group cleared the key and nothing re-rendered. **No fix here adds an invalidation** — every
key involved was already being cleared, and was verified to be, in the same PR.

Each card is a `cachedFetch` inside an effect with stable deps, mounted inside the persistent tab
shell. That shape never re-runs, so the value it painted at launch is the value it keeps.

## What changed

| Entry | Surface | Keys now subscribed | Cleared by |
|---|---|---|---|
| RV-106 | `components/health/hr-day-card.tsx` | `oura-hr-day:`, `workout-sessions-day:` | `invalidateOuraSync`, `invalidateWorkoutSummaries`/`invalidateExerciseLogged` |
| RV-107 | `app/nutrition/use-nutrition-targets-refresh.ts` (new) | `nutrition-targets` | `invalidateGoalRecommendations` |
| RV-109 | `components/health/activity-history-card.tsx` | `activity-logs`, `activity-types` | `invalidateActivityWrites`, `invalidateActivityTypes` |

All five keys were checked against `lib/cache-groups.ts` rather than assumed, and the test asserts
both halves — the surface subscribes it **and** a group clears it. Either alone is a subscription to
something that never fires, or an eviction nobody listens for.

## Three things worth keeping

**RV-106's open question is answered.** The entry left it untraced whether `useStressDay(today)` in
the same card shared the gap. It does not: it goes through `useCachedValue`, which already
subscribes. That makes it the reference for why the other two reads in that file were the broken
ones, and it is asserted so it stays that way.

**RV-107 had two identical fetch expressions for one key.** `TdeeAdaptationCard`'s `onApplied`
refetched `nutrition-targets` by hand — one write path fixed site-by-site while its siblings were
not, the same pattern BF-177 was patched with three times. Both now go through the hook, so the key
has one expression (the TTL-divergence rule) and future write paths are covered without being
remembered.

**RV-109's `activity-types` passes `freshWithinTtl: true`,** which makes its invalidation
load-bearing in the strict Q-262 sense: the cached entry is a *settled* value that survives until
something clears it, not a first-paint accelerator the next revalidation would correct anyway.

The hook kept for targets is deliberately separate from RV-104's `useNutritionDerivedRefresh`:
that one belongs to `invalidateNutritionWrite`, this one to `invalidateGoalRecommendations`.
Bundling them would make a food log refetch the targets and a target edit refetch the weekly chart,
and would hide which write each subscription protects against.

Two dead `.catch(() => {})` chains on `cachedFetch` went with the restructuring (RV-84 — it never
rejects). The local-store `.catch` in the activity card stays: `store.getActivityLogs` genuinely can
reject, and the test asserts the `cachedFetch`-specific shape rather than "no empty catch anywhere",
which is what a first, too-broad assertion got wrong.

## Why there is no e2e spec here

Driving a real targets write means navigating to Profile — and **whether that navigation unmounts
the tab shell is itself an open finding (RV-110: 37 cross-tab `router.push` sites tear it down).**
A green spec could pass for the wrong reason (the shell remounted, which is exactly how RV-109
describes `/activity` self-healing) and a red one would not say which defect it had found. So the
pins here are unit-level, and **RV-124 — #1418's device probe — is the thing that settles this
class by measurement**, RV-106, RV-107 and RV-109 among them.

What was exercised: `Ran 75 of 75`, tsc clean, 652 tests across the touched areas, and both Health
and Nutrition rendered authenticated under the e2e harness with `/api/activity-logs`,
`/api/activity-types` and `/api/nutrition/targets` all answering 200 from the restructured reads.
RV-104's spec still passes against RV-107's edits to the same file.

## Not exercised

Native SQLite / Capacitor (the web path takes the API fallback), safe-area, Samsung WebView,
drifted production data, real ring sync. **No device sitting** — and per #1417 those are the Device
Verification agent's to run; this PR's job is to record them so `next-item.js --sittings` finds them.

<a id="2026-09-23-rv110-rv112-tab-nav-shell"></a>

# 2026-09-23 — RV-110 / RV-112: tab navigation and the shared scroll slot (`fix/rv110-rv112-tab-nav-shell`)

Batch `tab-nav-shell`, both from Review sweep 53.

## RV-110 — 15 sites, not 37, and that distinction is the work

The entry counts **37** `router.push('/health'|'/nutrition'|'/more'|'/workout')` sites and reads
them as cross-tab navigations that tear the shell down. The grep is exact; the implication is not.
Classified against `tabKeyForHref` (`components/shell/tabs.ts`), which matches an **exact** path and
explicitly excludes `/workout?session=`:

- **15 are genuine tab destinations** — converted to `navigateToTab`.
- **22 are not tabs at all**: sub-routes (`/health/day`, `/health/sleep`, `/health/week`,
  `/more/details`, `/more/settings/…`) and the full-screen `/workout?session=…`. `tabKeyForHref`
  returns null for every one, so `navigateToTab` would only forward them to `router.push` while
  *reading* as a tab flip. Converting them would be misleading, not safer. They stay.

`scripts/check-tab-navigation.js` holds the 15 at zero and encodes that boundary, so a later sweep
cannot "finish the job" by converting the other 22. It runs in the Custom Rules job —
**`Ran 76 of 76`**, up from 75. The check was verified to fail: a reintroduced `router.push('/health')`
in `walk-summary.tsx` was caught by name and line, then passed again once reverted.

## RV-112 — Home and More shared one scroll slot

The key is `keySuffix ? ${pathname}#${suffix} : pathname`. Health passed three suffixes; Home and
More passed none, and both stay mounted, so both wrote and restored one slot with no owner check on
the restore. Fixed with `scrollKey="home"` and `scrollKey="more"`.

**The suffix is what separates them, not the path** — `usePathname()` reads the route tree, which a
tab flip leaves stale (LA-109), so the pathname half of that key cannot be relied on to differ
between two mounted tabs. That reasoning lives in `more-content.tsx`; Home carries a one-line
pointer, because `session-select-content.tsx` is a size-ratcheted hotspot and the full comment put
it over. `e2e/scroll-restoration.spec.ts` — which RV-112 notes was never run — passes, 5 of 5.

## The premise I could not verify, stated plainly

RV-110's mechanism is that a push to a tab href unmounts `TabShell`. That is consistent with the
code (each tab's `page.tsx` renders its own `TabPage` → `TabShell`), but **this PR ships no e2e
proving it.** A first attempt marked a DOM node and asserted it survived a flip; the marker then
also survived what was supposed to be a teardown, so the spec was not discriminating and was
deleted rather than shipped. The reason was my own error — the "teardown" control dispatched
`ta:tab-navigate` with a non-tab href, which `onNav` ignores *without* `preventDefault`, so
`navigateToTab` (the thing that calls `router.push`) was never involved and nothing navigated at
all. A valid control has to drive a real push through the UI.

## A wrong turn worth recording, because it nearly cost 37 files

Reading the source, I concluded `useSearchParams` cannot see a tab flip — `show()` ends in raw
`window.history.replaceState`, and the shell's own LA-109 comment says Next re-injects its stale
tree. Plausible, and **false**. Measured under the harness: `/health?tab=body` from Home lands on
`Body=true` at first mount, and `/health?tab=training` into an already-mounted Health lands on
`Training=true`. Next's patched `replaceState` does update search params; LA-109's stale-tree
problem is real and does not extend to them. Had I not probed, the next step would have been a
shell-carrier mechanism plus a 37-file sweep on a false premise.

A separate probe found `/nutrition?review=day` not opening the review sheet on a first flip into an
unmounted Nutrition, reproduced twice — but instrumenting the reader showed `searchParams` arriving
**correct** (`review=day`) at both the initializer and the effect. So it is not a param-delivery
problem and not RV-110's subject. Filed as LB-129 rather than chased here.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, drifted production data. **No device
sitting** — recorded so `next-item.js --sittings` finds it. The shell-teardown premise itself is
untested end-to-end, as above.

<a id="2026-09-23-rv120-remove-superseded-volume-card"></a>

# RV-120 — the volume card that was already merged away

**Branch:** `fix/rv120-remove-superseded-volume-card` · **Entry:** RV-120 (Review sweep 53)

## What was wrong

`AiWeeklyVolumeCard` was imported into `health-sections.tsx` and had a live `case "aiVolume"`
render arm, but `aiVolume` appeared in no order array, so nothing ever mounted it. A comment
above `TRAINING_ORDER` explained the omission and promised the card would return "once it's
merged into a single volume card" — and that promised merge had no backlog entry anywhere,
which is what Review filed it for.

## What the entry left open, and how it resolved

RV-120 deliberately did not pick between merging the card in and deleting it. Reading the two
data sources settles it, and not in the direction the code comment implies.

`app/api/weekly-muscle-sets/route.ts:81-88` already does the merge:

> Overlay the active program's per-muscle weekly targets so this single card shows progress
> toward the program's real targets (replacing the separate "Weekly Volume vs Target" card).

So the deferral finished some time ago and nobody updated the comment that promised it. The
shipped `WeeklyMuscleSetsCard` carries the programme's targets already, and carries them
*better* — scaled by the week's actual phase mix (BF-59), with `listVolumeTargets`' stored
numbers read only as the roster of muscles the programme trains.

Rendering both would also have been a defect rather than a feature. `/api/weekly-muscle-sets`
takes no `programId` and counts the week outright; `/api/ai-periodization/weekly-volume` scopes
its logged sets by `programId`. The two would print different numbers for the same muscle in the
same week — the shape RV-117 describes as two different answers to one question.

Deleted, therefore: the component, the import, the render arm, the now-false comment, and the
component's row in `check-hex-literals.js`'s baseline.

## No version bump

The card mounted nowhere, so nothing a user can see changed. No changelog entry, no version bump.

## Follow-up filed, not swept in

`LB-137` (Lane A). The deleted card was the only client consumer of the `weekly-volume-target`
cache key and of `/api/ai-periodization/weekly-volume`; `lib/cache-groups.ts` still clears that
key at two sites for a reader that no longer exists. Both files are Lane A's, so it is an entry
rather than part of this diff. The route is not simply dead — `getWeeklySetsByMuscleGroup` stays
live through `signals.ts` — so the open question is whether the HTTP surface still earns its
place, which the entry states rather than presumes.

## Verification, and what was not exercised

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** ·
`check-hex-literals` clean against the reduced baseline · 45 tests across the 6 files touching
these modules · `pnpm build` succeeded, 245 static pages.

`/health` is auth-gated, so a dev-server GET redirects to `/sign-in` and never compiles the
changed files — the full build is what actually exercised them, and that is the claim being made
here. **Not exercised:** the S25 APK, Samsung WebView rendering, safe-area insets, native SQLite,
drifted production data. No device check is owed: the deleted card was unreachable on every
runtime including the device, so there is no on-device behaviour for it to change.

<a id="2026-09-23-rv135-bf110-keep-reassign"></a>

# 2026-09-23 — RV-135: the entry that parked itself waiting for data it already had (`fix/rv135-bf110-keep-reassign`)

Docs-only. Two lines of BF-110 changed; no code.

BF-110 opens with *"✅ THE READING IS IN, and it says NATIVE — measured 2026-09-18. This entry is no
longer waiting on data."* Its `Keep:` line, further down, still read *"the READING, and only that …
Still do not write a fix before that row exists."*

`next-item.js` reads the `Keep:`, not the body. So the entry sat in the **KEEP** bucket — whose
heading is *"shipped; only the stated residue is owed. **Not new work.**"* — and the `✅` was visible
only to someone who opened the entry and read past its status line. **The native fix was owned by
nobody for five days.**

Two changes, which is all RV-135 asked for:

- The `Keep:` is gone, replaced by a paragraph saying the reading arrived and why the entry is READY
  work rather than residue. The old text is quoted there rather than deleted, because *what it said*
  is the finding.
- `Lane: B` → `Lane: A`. The old lane line reasoned *"the DOM is alive, so the fix is a paint
  invalidation in the shell, not native. No APK needed"* — correct until the measurement landed, and
  now retracted in place rather than removed, since it is the reasoning a future reader would
  otherwise repeat.

Verified by running the tool rather than reading the file: BF-110 now prints at **#21 of Lane A's 37
READY** entries and does not appear in Lane B's list at all.

Nothing else about BF-110 changed — RV-135 is explicit that its analysis is right, which is exactly
what made the filing error expensive. The re-measured counts it carries (25 rechecks, 25 `stuck`,
0 `resized`, `dom-lost` never fired in 62 reported resumes) are folded into the replacement
paragraph so the entry states its own evidence.

## Why this shipped alone rather than in the next batch

`Batch:` aggregates on what has to be *verified*, and this needs no verification — so batching it
behind `tab-nav-shell` (a 37-site sweep) would only have delayed a native fix that currently has no
owner. Timeliness is the entire value of the change.

## Not exercised

Nothing to exercise — no code, no user-visible change, so no version bump. The claim that the entry
moved lanes was checked by running `next-item.js` for both lanes.

<a id="2026-09-23-tuning-reconcile-q272"></a>

# 2026-09-23 — TN-55 was Q-272's missing proposal, and Q-272's acceptance test does not replicate

**Branch:** `tuning/reconcile-q272-and-file-lanes` · **Agent:** Tuning · **Docs-only.**

Asked to file what was buildable into the lanes and route owner-input items to the Orchestrator. The
first thing the sweep turned up was a duplicate of my own making, which was worth more than the filing.

## TN-55 never checked for an existing entry

**Q-272 — *"Body Battery v5 drains 5× faster than it charges"*, filed 2026-08-15** — is the
pre-existing entry for the defect TN-55 describes. It says in its own text that *"the next action is
Tuning's, not theirs"* and that **no proposal exists**; it had been waiting a month. TN-55 is that
proposal and I filed it without looking. The two are now linked and Q-272's gate is lifted.

Reading it changed the recommendation twice.

## Overnight charging is out, and the fit is better without it

Q-272 argues that *"overnight recharge here is handled by the morning anchor reset rather than
accumulated charge, which is a defensible difference"*. That is right, and my proposed
`SLEEP_CHARGE_RATE` would have counted the night twice — against an anchor already derived from
readiness and sleep. It showed in my own numbers as 13–14% of days pinned at 100 and I read it as a
tuning problem rather than a double-count.

Re-fitted with no overnight term, strictly better on every axis:

| | shipped | first proposal | **revised** |
|---|---:|---:|---:|
| median daily net | −85.1 | −0.2 | **+0.5** |
| mean end value | 14.8 | 59.2 | **61.4** |
| sd of end value | 26.4 | 28.0 | **25.3** |
| days ending at 0 | 66% | 5% | **0%** |
| days pinned at 100 | 0% | 8% | **9%** |

Revised constants: `CHARGE_RATE` **0.120**, `DRAIN_RATE` **0.080**, `STRESS_DRAIN_RATE` **0.020**, no
overnight term, `REST_THRESHOLD` unchanged. Gain 0.30 takes railing to 6% if the pinning shows in use.

## Q-272's acceptance test does not replicate, and it was about to sign off the change

Q-272 records **r = +0.67 (n = 11)** for end-of-day battery against next-day readiness, and instructs a
later session to re-run it after the change. Re-measured over **70 days**: **r = +0.252** — against
readiness's own day-to-day autocorrelation of **+0.361**, which is higher. The battery's end value
predicts tomorrow's readiness *worse than yesterday's readiness does*.

So the conclusion built on it — *"v5's level carries real signal; its shape within the day is wrong"* —
keeps its second half, because the four defects are independently measured, and **loses its first**.
The distributional pass test stands; a change cannot be validated against a relationship that is not
there. Both entries now say so.

## Q-502 and TN-55 disagreed about the lever; both were right about different things

Q-502 refuted raising `CHARGE_RATE` alone — the window is active on ~6.7% of waking samples — and
concluded `REST_THRESHOLD` is therefore the lever. The refutation stands and this plan does not raise
`CHARGE_RATE`. The conclusion goes further than the evidence: widening the threshold to TN-52's p10
quantile buys 2.8% → 3.7% of the day. The window is barely active for a different reason than its
width — sleep is excluded and the ramp zeroes at the ceiling — so flattening the ramp makes the
*existing* window productive, which is what Q-502 was reaching for.

## One caveat the plan cannot settle

`DRAIN_RATE` falls 7.5×. Q-521 already measured that drain tracks **wear time** rather than exertion
(`corr(hr_sample_count, drained)` **+0.518** vs `corr(steps, drained)` **−0.153**), so weakening it
could make a hard session even less visible. The plan tells Lane A to confirm a workout day still
separates from a rest day — and that if it does not, that is a *separate* defect (drain keyed on the
wrong input), not a reason to raise `DRAIN_RATE` back and restore the countdown.

## Filed for the lanes

**TN-61 (Lane O, now its READY #1)** — `next-item.js` prints ten rows of a thirty-one-row bucket and
says nothing about the rest. Two entries I had just edited appeared nowhere in its output, which reads
exactly like *removed from the queue*. One line of output, not a behaviour change; the cap is right,
the invisible truncation is not.

## Routed to the Orchestrator's ledger (LA-122), needing the owner

- **2b — is a contributor worth 2.8% of readiness's movement worth keeping?** `activityBalance` carries
  2.8% on a 0.06 weight; the two activity terms together are 7.4% of the number on 15% of the weight.
  Keep, re-weight or drop — each re-scores history. **Deliberately not asked yet:** the rail fix
  (TN-60) will move the table, so asking now would answer a question whose numbers are about to change.
- **2c — the `.size` conflict tax, now measured.** Five of seven PRs this session hit a baseline
  conflict, two also needing the append-only history file resolved by hand. Item 5's cheapest fix does
  not help, because the conflicts came from *other agents'* PRs landing between mine; the one that does
  is generating baselines in CI, which changes the ratchet and needs the owner's yes.

## Not exercised

Nothing runs. The re-measurements are read-only queries through `/api/admin/db-query`, **row-scoped to
the owner**, and the re-fit used the committed harness on data already pulled. **Not established:**
whether the revised constants keep a workout day distinguishable from a rest day — flagged in the plan
as Lane A's check, not asserted here. `pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates
at 417 entries.

<a id="2026-09-24-chore-or-140-device-sweep-handover"></a>

# 2026-09-24 — acting on the device agent's sweep 2/3 handover

Orchestrator. Docs-only. Branch `chore/or-140-device-sweep-handover`.

The Device Verification agent finished sweeps 2 and 3, released the phone, and handed over a list.
Most of it needed nothing: `DV-15`/`DV-16`/`DV-17`/`DV-18` were already filed and correctly laned,
and the six deployed-but-still-failing fixes carry their FAILED measurements on the entries. Four
things were wrong, and one request is declined with its reason.

## Four corrections

**`RV-111` — a gate that outlived its answer.** It carried `Gate: device` reading *"the hardware
back path only exists on the APK"*. True when written; sweep 2 then **CONFIRMED the defect on the
S25**, which also settles the open question OR-137 raised — whether the native barcode activity
swallows back before the JS listener runs. It does not, so the written fix is the right fix. Gate
removed; this is Lane B work, not a check.

**`RV-127` — a failed probe filed as shipped.** It carried `Verify: device — no build half`, which
files an entry under *shipped, a look is owed*. Sweep 2 ran it and the inputs came back at **21 px
of ink, ~33 px of touch area** against the 44 px floor — so there is a build half. Removed. A
FAILED is work, and leaving the field on reads as finished to everyone who scans the queue.

**`RV-144` filed, Lane B.** `RV-127`'s one actionable finding, handed to the lane that owns the
surface: three inputs on `/more/details`. Measured twice — the first pass said *"not judged; whether
their row or label widens the target is the next question"*, and sweep 2 asked that question and got
~33 px. The `tap-target-dot` session dots it also found are **by design** (44 in the axis that
matters) and must not be "fixed"; the horizontal overflow was looked at on screen and overlaps
nothing.

**`RV-127` re-laned `O` → `DV`.** It was held in `O` to get its findings to the right lanes; that
filing is now done, and the only thing left is the clearance half, which three-button navigation
cannot answer.

## One request declined, with the reason

The handover asked: *"Q-168 is tagged Lane DV but isn't a device check; please re-lane it."*
**It is staying, and the argument is on the entry** so it outlives the exchange.

Read literally, the claim does not hold: `Q-168`'s *What is actually left* section has **one** item,
and it is running the AI Coach section of the smoke checklist on two navless full-screen routes.
Sending it to `B` would give Lane B **nothing to build** — the cardio-goals half was dropped rather
than deferred — so it would sit there unstartable, which is worse than sitting in `DV`.

**What is true is the constraint the same message supplied**, and it explains the entry better than
the re-lane would: the phone is on **three-button navigation**, where every safe-area inset reports
`0`. A bottom-anchored control clears the bar trivially in that mode and a broken floored utility
passes anyway, so running this now would manufacture a **false VERIFIED** — worse than not running
it. That is already why `RV-37` and `RV-127`'s clearance half were held for sweep 4. `Q-168` belongs
in that group; it was not a fourth kind of thing.

So it is held for sweep 4, not re-laned. **This is a disagreement resolved by a fact the device
agent supplied, not by seniority** — and it is written down because the last one (Q-168 again, this
morning) was left standing and cost a second round.

## Not done

- **No product code**, no device run.
- **`#1465` is still open and still carries value** — the `BF-92`/`BF-24`/`Q-395` re-lanings never
  landed, and `main` has no test pinning `LA-132`'s ENOBUFS fix. Its own `maxBuffer` line is now
  redundant (LA-132 fixed it independently) and its `RV-111` routing is obsolete (see above). It
  needs salvaging, not merging as-is. Separate PR.
- **Sweep 4's list is started, not finished** — `Q-168`, `RV-37` and `RV-127`'s clearance half are
  the gesture-nav group. The rest of the tagging pass is still owed.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-141-salvage-1465"></a>

# 2026-09-24 — salvaging #1465: what was still true, and what two sessions found twice

Orchestrator. Docs + one test. Branch `chore/or-141-salvage-1465`.

`#1465` sat open for fourteen hours and `main` overtook most of it. Rather than merge it stale or
close it whole, this carries across the two parts that are still true.

## What was still true

**Three re-lanings that never landed.** `BF-92`, `BF-24` and `Q-395` all still carried
`Gate: device` with their original lanes:

- **`BF-92` → `Lane: O`, `Gate: owner`.** The code half shipped; the check that remains is a
  **deliberate client-side throw in production**, and the device agent's own sweep plan says *"ask
  first — it may page someone"*. Consent is the next act, not the phone.
- **`BF-24` and `Q-395` → `Lane: O`, `Gate: owner`.** Both are artboard parity. Every buildable item
  under them is closed with a reason, so what remains is whether a shipped screen matches a drawing
  — a judgement about whether it looks right, which the phone cannot settle. **`RV-143` had already
  read both as mis-gated rather than device-blocked**, and both sweep plans exclude them for that.

**A regression test with no fix attached.** `LA-132` shipped the `maxBuffer` fix on `showAtBase`;
nothing pinned it. The test is now on `main`, using the real backlog as its witness rather than a
synthetic fixture — what regressed is *the repo's largest tracked doc is readable at base*, not a
buffer size — and asserting the witness exceeds 1 MiB so it cannot quietly stop pinning anything.
Mutation-checked: removing `maxBuffer` fails it with `base read failed: spawnSync git ENOBUFS`.

## What was dropped, and why

**The `maxBuffer` fix itself.** `LA-132` fixed it independently, hours apart, from the other end —
Lane A from the ratchet's wrong line count, this session from the ENOBUFS line in a CI log. Two
sessions diagnosing one defect in a day is the argument for the test, which is the half that did
not exist.

**The `RV-111` → `DV` routing.** Obsolete. Sweep 2 confirmed the defect on the S25, which also
answered the question that routing existed to ask — whether the native barcode activity swallows
back before the JS listener runs. It does not, so `RV-111` is Lane B work and `#1494` removed its
gate.

## The thing worth remembering

**A PR left open across a busy day is not a PR waiting to merge; it is a claim decaying.** Of
`#1465`'s four routings one was wrong within hours, and its headline fix was overtaken by a
concurrent session. Nothing in it was unsound when written. The lesson is not "work faster" — it is
that a long-lived branch needs re-reading against `main` before merge, not just re-merging, because
`git` will happily carry a correct-when-written claim into a tree where it is false.

## Not done

- **`#1465` is still open.** Its content is now here or obsolete, so it should be closed — that
  needs the owner, since closing PRs is confirm-first.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-142-review-sweep-3"></a>

# 2026-09-24 — reviewing device sweep 3: the bookkeeping is clean, the filing is not

Orchestrator. Docs-only. Branch `chore/or-142-review-sweep-3`.

The owner asked for a review of the finished device sweep. Sweep 3 (#1491) is the latest; there is
no sweep 4.

## The sweep's own bookkeeping is exact

Every claim was checked against the queue rather than read off the summary:

| claim | result |
|---|---|
| closed: `RV-128` `RV-129` `BF-95` `BF-161` `OR-118` | all five absent from the queue ✓ |
| filed: `DV-16` `DV-17` `DV-18` | all three present, all `Lane: B` ✓ |
| kept: `BF-12` `BF-49` `BF-147` `Q-300` `RV-125` `DV-8` `DV-12` `BF-22` `BF-61` `Q-305` | all ten present ✓ |

Both observations that could have been dropped — `Q-305`'s colour-only rows and `BF-61`'s
swipe-to-Yesterday side effect — are written on their entries. **No orphaned findings.** For a sweep
this size that is a good result, and it is worth saying plainly before the rest.

## What the review found instead: five entries filed as finished while failing

The defect is not in the sweep. It is in what happens to an entry *after* a device check fails.

An entry ships a fix, carries `Keep:`/`Verify: device` meaning *shipped, a look is owed*, the device
runs that look and it **FAILS** — and nothing clears the field. The failure is recorded faithfully in
the text while the entry keeps printing to its lane under **"shipped; only the stated residue is
owed. Not new work."**

| entry | state |
|---|---|
| `BF-61` | failed 2 of 2 in sweep 3; titled *"fixed; device check owed"*; **`BF-94` blocked on it** |
| `BF-139` | shipped 09-12, failed on device 09-13, nothing since, still titled *"fixed"* |
| `BF-96` | same, its batch partner — owner: *"Day is cut off"* |
| `RV-103` | sweep 2 ran the exact check its `Keep:` asked for, and it failed |
| `TN-53` | same — HR recovery still plots 0-value points |

All five are corrected: fields removed, titles fixed, acceptance criteria written. **Lane B's READY
list gained five real defects that were invisible to it.**

**`BF-61` also gained a third acceptance clause.** Sweep 3 found that after the swallowed tap the
next rightward swipe moved Nutrition to **Yesterday**, 2 of 2. It is downstream of the same cause,
so one fix may clear both — but the old acceptance text would have **passed with the day still
jumping**, which is the more alarming half for the user.

**`BF-96` had a second, quieter problem:** three bullets reading `- **Keep — …**` that meant *keep
this knowledge*, not the residue field. The parser read the first as the field. That is `TN-59`'s
class — a prose sentence starting with a field's name.

## Deliberately not built

The durable fix is a check: an entry recording a device failure must not also carry
`Keep:`/`Verify:`. Filed as **`OR-139`** rather than written here, because it needs a baseline —
**`BF-98` is a legitimate counter-example**: it failed on 09-13, was fixed, and sweep 2 **passed** it,
so its later `Verify:` is correct. The text alone cannot order those events, so the check is
shrink-only with `BF-98` baselined. Building that carefully is worth more than building it tonight.

## The handoff warning, which is not ours to remove

The owner asked for the context-pressure warning to be taken out of the repo docs so every agent
stops getting it. **It is not in the repo.** Checked: no `Stop` hook in `.claude/settings.json`, none
in `settings.local.json`, none at user level; the only hooks are the repo's `SessionStart` and a
user-level git check. The phrase *"invoke the handoff skill"* appears in no config — only in an old
folded journal.

It is **Claude Code's own** context warning, printed at ~90% and ~95% of the window, and it cannot be
edited away from here. What *can* be fixed is agents obeying it: CLAUDE.md already says to rely on
automatic compaction, but the harness explicitly instructs a handoff, and an agent will follow the
louder voice. So CLAUDE.md now names the warning and says to ignore it, with the reason — handing off
at 90% throws away a warm cache to solve a problem the tool has already solved.

The window itself is a launch flag, `claude --autocompact <auto|100k–1M>`, set when a session starts.
That is the owner's lever, not a repo setting.

## Not done

- **No product code**, no device run.
- `OR-139`'s check is filed, not built.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-143-process-owner-gate-triage"></a>

# 2026-09-24 — the Orchestrator's job is the owner-gated queue

Orchestrator. Docs-only. Branch `chore/or-143-process-owner-gate-triage`.

The owner set the process out explicitly. Recorded here because a role definition that lives only in
a chat is a role definition the next session does not have.

## The process, as he stated it

- **BugFix** is the intake. Reports arrive from him directly, **and it reads the app's feedback
  feature** so a user-reported error lands the same way a spoken one does. It files and lanes them.
- **Review** sweeps on its own, **or commissions a sweep** — handing the device agent a question and
  reading the answer back.
- **Orchestrator** reorganises, cleans and aggregates the backlog. **Its main job is the entries that
  need his input**: work out which genuinely do, put those to him, and **assign to a lane once
  unblocked**.
- **DV, Tuning, Lane A and Lane B** are unchanged.

**One ownership move:** the in-app feedback read shipped as the Orchestrator's in `#1486`. It is
BugFix's now — a report is intake, and intake is BugFix's. The Orchestrator keeps the read as a
backstop for when BugFix is not running rather than as the owner of it.

## First triage pass: 78 entries carry `Gate: owner`

By lane: **65 Lane A, 7 O, 6 B**. Read in one pass; the shape is what matters before the detail.

**Roughly 29 are scoring or calibration** — `expectedRpe`'s dead band, ACWR's windows, the Zone 2
floor, resilience, chronic stress, the Body Battery charge window, 1RM's non-monotonicity. These are
genuinely his by CLAUDE.md's rule, **but they should not reach him as bare gates**: Tuning proposes a
calibration with the number of other days it moves, and he signs off on that. A gate with no proposal
attached is a question he cannot answer.

**Roughly 25 are engineering calls wearing an owner gate** — a missing unique key, a route with no
callers, a dead column, an AI call with no data gate. Those are mine to decide under the standing
narrowing, not his.

**Three are already answered or deferred and should not be re-asked:**
- **`Q-547`** says so in its own field: *"Gate: owner — a READING, not a decision."* It wants a
  Railway CPU/RAM sample during a quiet window, and it feeds `Q-551` rather than asking anything.
- **`BF-106`** is *acknowledged and deferred* by him, 2026-09-15, deliberately still gated because
  `VACUUM FULL` cannot run from the app.
- **`Q-297`**'s first residue is done.

**The rest are genuine product preferences** — sharing meals with a partner, the cat collection's
art, battery chips on Home, an Apple HealthKit connector, the admin surface's unused buttons.

## What goes to him first, and why it is one question

`LB-52` and `Q-297`'s second residue were already batched as **`owner-branch-protection`** (OR-117,
2026-09-16): *"the same settings page … one trip, two toggles. Do not put them to the owner
separately."* That batching was right and this pass did not improve on it — it surfaced it.

It is also the highest-value thing on the list, for a reason this session demonstrated rather than
argued: **auto-merge does not work on this repo**, so every merge is hand-caught against a base that
moves every few minutes. One PR tonight lost **five** merge races; another lost two and had to be
split onto a zero-conflict branch to land at all.

## Not done

- **74 of the 78 are untriaged in detail.** The pass above is a shape, not a verdict on each entry,
  and it is deliberately labelled that way — an estimate of "how many are really his" was wrong by a
  factor of twenty-five earlier in this session, so the number stays a shape until each is read.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 814 test files passed.

<a id="2026-09-24-docs-bf-190-walk-autosave-planned-duration"></a>

# BF-190 — a 27-second walk logged as a complete 40-minute session

**Branch:** `docs/bf-190-walk-autosave-planned-duration` · docs-only · BugFix intake

The owner asked why the calories tile on his walk summary read `—`. Tracing it turned up a larger
problem underneath.

**The tile question is unresolved and the entry says so.** The stored row carries **133 kcal**,
derived server-side at insert, so the server half works. But that row was created at 09:59:28
Brisbane and the phone clock in the screenshot reads 9:59 — the shot was taken within about half a
minute of the save, and the tile is designed to start as a dash and fill when the forced pull
returns. A dash at +30 s may be the documented pre-arrival state. BF-107 is reopened with the check
that separates the two cases: re-open the walk from the activity list and see whether the tile fills.

**What the trace found instead.** `activity_logs` holds **two** rows for that walk, both claiming 40
minutes and 133 kcal:

| id | created | start–end | steps | avg HR | kcal |
|---|---|---|---|---|---|
| `b8083d04` | 09:18:27 | 09:18 → 09:58 | — | — | 133 |
| `d0231b08` | 09:59:28 | 09:19 → 09:59 | 3190 | 92 | 133 |

The first was written **27 seconds after its walk started** and claims a 40-minute end time that had
not happened yet. `walk-summary.tsx:130` saves on mount, and the duration and end time it saves come
from `plan.totalSec` — the planned walk, not the clock. So anything that puts the lifter on that
screen early writes a finished session. Calories follow duration (`deriveActivityKcal` uses activity
type and minutes, no HR or steps), which is why both rows read exactly 133.

The day now holds 80 minutes and 266 kcal of treadmill walking against 40 and 133 actually done.

Filed Lane B with the three-line fix (read the clock, not the plan) and a flagged follow-on decision:
whether a sub-minute walk should be saved at all. Recommended a minimum-duration floor matching the
`MIN_SESSION_SEC` pattern `time-audit.ts` already uses for workouts, rather than a confirm dialog.

## Amended after the owner confirmed the trigger

*"I started a walk; then closed it - I guess it didnt fully close it? that should be looked at
too."* So the phantom row came from **End walk**, not a crash — reproducible on demand, and the
defect sits earlier than the mount-save the entry first blamed.

In `walk-active.tsx` the two exits are the same call with the same two arguments. Finishing
naturally at `e >= plan.totalSec` (:142) and confirming **End walk** (:279) both invoke
`onFinishRef.current(samples, cadence)`. `WalkSummary` receives `config`, `samples`, `cadence` and
`startedAtMs` — nothing that says whether the walk ran out or was stopped after 27 seconds. It
cannot tell, so it assumes the plan. The elapsed seconds are in the same component and are dropped
at the boundary.

That makes this an instance of a class CLAUDE.md already names — *"completion callbacks must carry
the written entity"* — and the fix earns that rule another example rather than rediscovering it.

The dialog also already promises what the data does not keep: *"Ending now will stop it early."* The
lifter is told the walk is recorded as stopped early and it is recorded as a full planned session.
Making that sentence true is the acceptance criterion.

The mount-save stays in the entry as the secondary half: with the duration fixed there is still no
beat at which a 27-second walk could be declined, which is why the minimum-duration floor is part of
the fix rather than a nicety.

<a id="2026-09-24-docs-owner-questions-to-orchestrator"></a>

# A question for the owner is a task, not a chat message

**Branch:** `docs/owner-questions-to-orchestrator` · docs-only

Owner, 2026-09-24: *"Questions that I need to answer should be assigned a task and sent to
Orchestrator to be completed there."*

The channel already existed — `Lane: O` — and the failure was in how it was being used, not in the
mechanism. Three things came out of checking rather than assuming:

**The obvious encoding is the wrong one.** `Gate: owner` reads like the right field and inverts the
instruction: `Gate:` parks an entry in `next-item.js`, so a question gated on the owner drops out of
the Orchestrator's READY list and nobody is tasked with putting it to him. Getting the answer is
itself the work, so it is `Lane: O`, ungated. The rule now says this outright.

**Filed entries were reaching the queue, contrary to a first reading.** BF-188 and BF-189 parse
correctly as `Lane: O` and sit at ranks 15 and 16 of 29 READY — below `TOP_N = 10`, which prints
only the top ten per lane. They were never invisible, and the rule now notes that an owner question
filed at rank 15 is in the queue and in nobody's view, so it belongs near the top.

**Two entries were genuinely mis-routed, and both were mine.**

- **BF-107** was `Lane: B` and was reported back to the owner as *"your five-second check"*. The
  next action — open the walk, does the calories tile fill — is a measurement with an objective
  pass/fail, which §3 assigns to the device agent, not a judgement waiting on him. Re-laned `DV`,
  with the three answers it may return and where each one sends the entry next.
- **BF-190** was `Lane: B` and carried two owner decisions in its body, where the lane field routed
  them to an implementer. Split into **BF-191** (`Lane: O`): whether a sub-minute walk should be
  saved at all once the duration is truthful, and what happens to the phantom row already in the
  history. BF-190 keeps the half that needs no decision and does not wait.

BF-191 carries a caveat worth keeping: only 2026-09-24 was checked for phantom rows. The signature
to sweep for is a row whose `duration_min` equals the plan while `avg_hr` and `steps` are both null.
No count is claimed until that runs.

<a id="2026-09-24-dv16-completed-workout-leave-prompt"></a>

# DV-16 — a finished workout that reopened as an unfinished one

**Branch:** `fix/dv16-completed-workout-leave-prompt` · **Entry:** DV-16 (Device Verification, sweep 3) · **Version:** 1.465.24

## The report

The owner finished Push, restarted the app, and every tab tap from `/workout` raised *"Leave
workout? Your workout is in progress. Leaving now will end the session and unsaved sets will be
lost."* — 2 of 2 on the S25. The Workout card showed COMPLETED at the same time. Answering *Leave*
would have called `resetSession` on a workout that was already saved.

The entry left the cause open, and was right to: it offered two possibilities and marked them
**not established**.

## Cause

Neither guess was right as framed. The in-memory `mode` does not drift from the persisted one by
accident — it is rewritten deliberately:

```ts
if (state.mode === 'exercise-summary' || state.mode === 'done') {
  state.mode = 'pre'   // so DoneScreen cannot replay its confetti on reopen
  state.summaryData = null
}
```

`isWorkoutActive` was `!!workoutStartMs && mode !== 'done'`, so that rewrite removed the only term
saying the workout had finished. `workoutStartMs` survives the reopen — the staleness branch clears
it only past four hours, and `dateRolledOver` is always false in production because
`onRehydrateStorage` passes `today: null` on purpose (Q-477). The card still read COMPLETED because
that comes from `workoutEndMs`, which nothing had touched.

Two pieces, each correct alone: a confetti guard that owns `mode`, and a nav guard that read `mode`
as durable state.

## Fix

`isWorkoutActive` now also requires `!workoutEndMs`. That stamp is the durable fact the transient
mode is not — written once at completion in `workout-screen.tsx`, and nulled by both `startWorkout`
and `resetSession`, so the guard re-arms on Start Again.

A **third term was added rather than either existing one altered**. An existing test pins that
`pre` must never be excluded, because `pre` is also the mid-workout hub; that constraint is intact,
and the test now asserts the two original terms plus the absence of a `mode !== 'pre'` exclusion,
read from comment-stripped source so the new explanatory comment cannot satisfy it.

Both object-literal call sites (`bottom-nav.tsx`, `tab-swipe-navigator.tsx`) now select
`workoutEndMs` too; the rest pass whole store state.

## Verification, and what was not exercised

Four new tests in `lib/stores/__tests__/workout-store.test.ts` drive the real store: the rewrite
still happens, the finished state is no longer active, a mid-workout state still is, and the guard
re-arms after `startWorkout`. **Control-run against the pre-fix predicate — exactly one goes red**,
so the suite discriminates rather than passing either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · 58 tests
across the four files touching this surface · `pnpm build` succeeded.

**Not exercised:** the reported path itself. It needs the APK, a real completed day and an app
restart, none of which the sandbox has — `/workout` is auth-gated, so a dev-server GET only
redirects to sign-in. DV-16 keeps its device pass test for exactly that reason, and the entry says
so rather than reading as finished.

<a id="2026-09-24-dv17-meal-plan-skeleton"></a>

# DV-17 — a skeleton for an answer the cache already had

**Branch:** `fix/dv17-meal-plan-skeleton-on-warm-visit` · **Entry:** DV-17 (Device Verification, sweep 3) · **Version:** 1.465.25

## The report

A per-frame scan of the active panel over three warm rounds of each tab: Health, More and Home
painted no skeleton in 9 of 9. **Nutrition painted one on every visit, 3 of 3** — a 338×108 pulse at
y=512, from ~85 ms to 392–543 ms after the tap. The owner has no meal plan.

## Where it actually was

The entry pointed at `meal-plan-section.tsx:99`:

```tsx
if (loading && plan == null) return <div className="… animate-pulse" … />
```

That line is correct given its props. The defect is one level up. `nutrition-content.tsx` passed:

```tsx
loading={loading && mealPlan === null}
```

For an account with no plan, **`null` is the settled answer** — the synchronous cache seed at mount
already read `meal-plans`, found `plans: []`, and set `mealPlan` to `null`. That is indistinguishable
from "no answer yet", so every warm visit re-pulsed for as long as the background refetch ran.

This is the second entry in a row whose stated location was downstream of its cause (DV-16's two
candidate causes were both wrong as framed). Reading the code before the entry is paying for itself.

## Fix

`planLoaded` tracks whether the plan has been **answered**, by cache or by network, rather than
whether it happens to be non-null:

- set by the synchronous seed when the cache had an entry — the only thing that runs before first
  paint, so settling it any later cannot prevent a flash that has already happened;
- set by the fetch, but **only on a defined payload**: `cachedFetch` swallows `!res.ok` and calls
  back with `undefined`, and treating that as an answer would replace a skeleton with "Build a meal
  plan" for someone who may well have one.

The presentational guard is untouched and pinned by a test, since it was never the defect.

## Verification

4 tests, control-run against `origin/main`: **3 of 4 go red** without the change. The fourth pins
the component as unchanged and correctly passes either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · the whole
nutrition suite, **337 tests across 37 files**.

**Not exercised:** the device. DV-17 keeps its pass test — three warm Nutrition visits on an account
with no plan, zero skeleton frames — which needs the APK and a per-frame scan.

## A ceiling reached, and filed rather than absorbed

The six-line fix took `nutrition-content.tsx` from 795 to **exactly the 800-line limit**
`check-component-size` enforces. It passes; the next line anyone adds does not. Extracting a section
of a 795-line screen to make room for six lines would have been a larger and riskier change than the
fix it carried, shipped unreviewed inside a device-reported defect — so the extraction is filed as
**LB-139** instead of improvised here.
