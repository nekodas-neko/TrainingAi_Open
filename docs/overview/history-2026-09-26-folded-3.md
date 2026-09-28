# Session journal — batch folded 2026-09-26

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-25-rv177-phase-set-schemas"></a>

# RV-177 — the three phase-set writes had no schema at all

**Branch:** `fix/rv177-phase-set-schemas` · **Lane A** · `[platform][workouts]`

Three more of RV-177's nine gaps. Three remain, none re-verified.

The claim held exactly: `POST /api/phase-sets`, `PUT /api/phase-sets/[id]` and
`POST /api/phase-sets/clone` each did `const body = (read.body ?? {}) as { … }` — a cast, not a
check. `durationCycles` reached the driver unvalidated, `phaseType` could be any string, and a
malformed body answered with a bodiless 500.

`PhaseSetWriteBody` and `PhaseSetCloneBody` now live in
`packages/shared/src/validation/phase-set.ts`, beside the other write validators.

## The bounds came from production, not from the obvious precedent

`generated-program.ts` already bounds `durationCycles` at `z.number().int().min(1).max(52)`, and
copying that was the first move — the repo's own rule is to reuse the existing formula.

It would have been wrong. The phase editor's stepper floors at `Math.max(0, …)`, and
`program_phases` holds **8 rows at `duration_cycles = 0`** today. A `min(1)` here would have
answered 400 when the owner re-saved a phase set that is already in his database — a validator
"hardening" a route by breaking it.

So the bound is `min(0)`, and **whether 0 should be reachable at all is left open**: the AI path
forbids it, the editor allows it, 8 rows have it. That is a product question, and this change is
about stopping unchecked input reaching the driver, not about changing what the app accepts.

`phaseType` was checked the same way before choosing an enum over the looser
`z.string().max(60)` the AI path uses — all five values in production are inside the six-value
union, so the enum refuses nothing real. 52 and 100 are taken from `generated-program.ts` rather
than invented, and every bound is a named constant (Q-164).

## `.strict()`, and why the first draft was not

The first draft left `PhaseInput` non-strict so Zod would silently drop the three editor-only keys
the client sends — `localId`, `position` and `primaryStyleName`. `check-strict-request-schemas`
refused it, and the check was right: a silent drop hides a client/server mismatch, so a renamed or
typo'd field vanishes without a word.

The keys are now **declared** instead. The app's payload stays valid, an unknown key is a 400, and
a case pins both halves.

## Verification

20 cases in `packages/shared/src/validation/__tests__/phase-set.test.ts`. Most of them pin what the
schema must **not** reject: a validator added after the fact is far likelier to break a payload the
app already sends than to miss an attack.

| mutation | killed |
|---|---|
| `min(0)` → `min(1)`, the bound production forbids | 1 of 20 |
| drop the integer constraint on `durationCycles` | 1 of 20 |
| `phaseType` enum → free string | 1 of 20 |
| remove the clone override's ceiling | 1 of 20 |
| **control:** raise the phase-name ceiling 100 → 120 | **0 — survived, as intended** |

**The override mutation first read as surviving and did not.** The shell quoting meant the replace
never matched, so nothing was mutated — a green run proving nothing. Re-run with an asserted match
count it kills its case. A mutation that does not assert it applied is not a mutation.

Gates: `tsc --noEmit` clean · **`typecheck:tests` at baseline (88 files)** · lint 0 errors ·
**Ran 79 of 79 Custom Rules steps** · `app/api/__tests__` 32 files / 265 tests · full suite green.

## Not exercised

Server-side validation only — no schema change, no migration, no local-store change, no device path.
The routes were not driven by hand on `pnpm dev`; the schemas are pure and tested directly, and the
32-file route suite covers the handlers around them. No user-visible behaviour on any payload the
app actually sends, so no version or changelog bump.

<a id="2026-09-25-rv177-rate-limits"></a>

# RV-177 — two routes anyone could call as often as they liked

**Branch:** `fix/rv177-rate-limits` · **Lane A** · `[platform][nutrition]`

Two more of RV-177's nine gaps. Two remain, neither re-verified.

## The meal PATCH reaches a model

`PATCH /api/nutrition/meal-plans/meals/[mealId]` has a `scaleToTarget` branch that calls
`scaleWithTopUp`, which is a `generateObject` call against the real model. It had no cap, while both
its siblings have one — `meal-plans/generate` at 10/h and `generate/meal` at 40/h.

Limited at **40/h**, matching `generate/meal` because it is the same per-meal granularity, and
placed **inside the branch** rather than at the top of the handler. The same route serves a plain
rename or reorder, which costs nothing; throttling those to protect a model call would be the wrong
trade.

## The calendar route had neither a limit nor a schema

`POST /api/log-calendar-event` writes to Google Calendar. Its body was an untyped cast guarded by
`if (!sessionType || !startMs || !endMs)` — which passes **any truthy value**. So a string, a float
or `1e20` went straight into `new Date(startMs).toISOString()`, which throws `RangeError` on
anything outside the Date range: a client error surfacing as a bodiless 500.

It now takes a `.strict()` Zod body with `startMs`/`endMs` bounded to 2000–2100 rather than to
Date's own ±8.64e15 (which would still accept the year 200000), a refinement that `endMs` cannot
precede `startMs`, and a 30/h limit. Thirty is far above real use — a handful of sessions a day —
but it bounds a client stuck in a retry loop, which is what the rule asks for.

## Verification

11 cases in `app/api/__tests__/rv177-rate-limits.test.ts`, including a control that a valid body
reaches the external call, so the 400 cases are known to be about the body rather than about
anything upstream. Run together with `lib/__tests__/feedback-calendar-scale-routes.test.ts`, which
pins the truncation property from the other side — 30 cases in total.

| mutation | killed |
|---|---|
| raise the calendar limit past what the loop spends | 1 of 30 |
| raise the meal PATCH limit past its loop | 1 of 30 |
| `.max(50)` on the exercise array (the regression below) | 2 of 30 |
| drop `.strict()` from the calendar body | 1 of 30 |
| `startMs` loses its bounds | 5 |
| drop the `endMs >= startMs` refinement | 3 |
| **control:** `MAX_EXERCISES` 500 → 400, both far above any body sent | **0 — survived, as intended** |

**Two process failures worth recording, because both produce a false green.**

The first mutation pass reported all four surviving. It hadn't run: the shell helper never passed
its arguments to python, so every "mutation" was a no-op. The assert inside it turned that into a
loud `IndexError` rather than a quiet pass — which is the only reason it was caught. This is the
**third** time in one session that a mutation silently failed to apply. A mutation that does not
assert its match count is not a mutation.

The meal-PATCH case then failed for a reason that had nothing to do with the limit: the ingredient
fixture used `grams`/`calories` where `NutritionIngredientSchema` wants `weightG`/`caloriesPer100g`,
so every request 400ed before reaching the rate limiter and no 429 ever arrived. Probing the real
status and body settled it in one run; guessing would not have.

Gates (real exit codes): `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0, **79 of 79** · pointers 0 ·
doc-size 0 · full suite green.

## Not exercised

Server-side only — no schema change, no migration, no local-store change, no device path. The
calendar route's **actual Google write was never exercised**: the test's refresh token is fake, so
the valid-body control asserts only that validation passed and the external call was reached. A real
event has still never been created from a test, and that is the same gap OR-166's `Keep:` records.

## Two things the full suite caught that the file's own tests did not

**The schema turned truncation into rejection.** The first draft capped the exercise array at
`.max(50)`. The route has always *truncated* a long session into the calendar description, and
`feedback-calendar-scale-routes.test.ts` pins that — so a 60-exercise body went from an accepted
event to a 400. The cap is now `MAX_EXERCISES = 500` on the body (well past any real session; the
16 kB body limit is the binding one) with the description still sliced at 50, and the property is
pinned from inside this file too. A validation schema added to a route that already had *behaviour*
can remove behaviour, and only the pre-existing test saw it.

**The file passed once and then failed for the rest of the hour.** Two cases deliberately spend the
hourly budget, and this corrects a claim written in the first draft of this entry: `rateLimit` is
**not** an in-process store. It flushes into a shared Postgres `rate_limits` table and treats the
DB count as authoritative (`flushKey`, `lib/rate-limit.ts`), so a spent budget outlives the process
and poisons the next run — a case unrelated to limits (`refuses an unknown key`) came back 429
instead of 400. The file now clears both halves in `beforeAll`, the pattern
`weekly-review/month-window` already uses; it is green on two consecutive runs. The multi-replica
caveat the first draft drew from that wrong reading does not hold either: the shared table is what
makes the limit hold across replicas.

<a id="2026-09-25-rv178-client-gaps"></a>

# 2026-09-25 — RV-178: a vanishing card, two unguarded buttons, two defeated memos, two blank lines

**Branch:** `lane-b/rv178-client-gaps` · **Lane:** Implementation B

Six client-side gaps from review sweep 58. All six verified against the source before any were
built — two had the wrong path (`components/ai-insight-card.tsx` does not exist; it is
`components/health/`, and `saved-meals-sheet.tsx` is under `components/nutrition/`) — and all six
turned out to be real.

## What shipped

**Home's timeline no longer vanishes on a failed load.** `useCachedValue` had no `onError`, and
`cachedFetch` swallows `!res.ok`, so a failure and an empty day were the same `null`. An empty day
still renders nothing — there is genuinely no timeline — but a failure says so.

**Two buttons that fired twice now fire once.** `clonePhaseSet` made a second copy of a phase set
on a double tap and had no try/catch; the AI insight card's Refresh spent the route's
10-per-hour budget on however many times you tapped it. Both go through a new
`useGuardedAction` (`lib/hooks/use-guarded-action.ts`) rather than two hand-rolled refs. Its latch
is a plain closure with a unit test, because the case it exists for — two taps in one frame — is
exactly the case a guard held in React state fails: both handlers read the same stale `false`
before either re-render lands.

**Two `memo()`s that were doing nothing.** `SoreMusclePicker` and `MealBuilderHeader` are both
`memo()`-wrapped and both were handed a handler re-created every render. `saved-meals-sheet` had
already done this sweep for its other five handlers (Q-357, in a comment thirty lines above), and
this one was missed.

**Two blank lines that waited on the network.** More's Oura card read `/api/oura-ble/freshness`
with a bare `fetch`, so "Ring synced 4m ago" — the card's whole job — was blank on every open. The
public profile page did the same, showing a spinner for a profile opened a minute ago. Both now
seed from cache and revalidate.

## A regression I introduced and caught on re-read

Wrapping `fetchInsight` in the guard also guarded the **mount effect**, which is a different thing
from guarding the button. Switching Health section while a load was in flight would have had the new
section's fetch dropped and the previous section's insight left on screen, with no retry queued —
the effect had already run for the new deps. Only the tap is guarded now; the effect is driven by
its deps, not by how fast someone can tap, and the test asserts the split in both directions.

`clonePhaseSet` has no equivalent hazard: nothing calls it but the button.

A second one from the same re-read: `useCachedValue`'s `onError` fires on a **revalidation**
failure too, not only the first load. So a profile that painted from cache and then failed a
background refresh would have shown an error banner stacked on top of perfectly good data — the
error branch is gated on `!profile` now. Worth knowing for any other card adopting `onError`: it is
not an initial-load callback.

## Three things the gate caught that a reading would not have

**The fetch-once ratchet rejected my first profile-page fix.** I converted a bare `fetch` in a
`useEffect` into a `cachedFetch` in a `useEffect`, which is the exact Q-402 shape the check
freezes. The right answer is `useCachedValue`, which also refetches when `public-profile:` is
invalidated.

**That conversion would have flattened the route's error messages**, because `useCachedValue`'s
`onError` took no argument and `cachedFetch` never surfaces a response body. Rather than accept
"Could not load profile" for a friends-only profile, the hook's `onError` now receives the
`CacheFetchErrorInfo` it already had internally — a source-compatible widening, since a handler
taking no argument ignores it. `lib/hooks/**` is this lane's, so the fix went where the gap was.

**`components/config-screen.tsx` is a size-capped hotspot**, and the first version of the guard
pushed it 12 lines over. Wrapping with the shared hook instead is net zero, and merging two
adjacent imports from the same module paid for the one line the import cost. "Extract, do not
append" is what the check says, and it was right.

**RV-84's guard caught a dead `.catch`** I added on a `cachedFetch` — it never runs, because
`cachedFetch` swallows `!res.ok`.

## One cross-lane line, declared

Two new cache keys (`oura-ble-freshness`, `public-profile:`) are registered in `lib/cache-groups.ts`,
which is Lane A's file. Shipping a cache key without its group entry is the single most repeated
bug class in this project, so the alternatives were to register it or not add the key at all. Both
registrations are asserted in `lib/__tests__/cache-groups.test.ts` rather than left to review.

## Verification

`components/__tests__/rv178-client-gaps.test.ts` (8) and `lib/hooks/__tests__/use-guarded-action.test.ts`
(5), plus two extended assertions in `cache-groups.test.ts`. **Control-run: 10 of them fail against
the pre-fix source.**

Gate: `pnpm lint` 0 errors and **808 warnings, the same count as the base** (a diff of the two
lists, after the first run came back +2 — one was a dead helper in my own test) · `pnpm check:rules`
**Ran 78 of 78** · doc-size OK · `pnpm test` · `pnpm build`.

**The e2e run is inconclusive and is recorded as such.** 97 specs passed, then the dev server died
and 132 failed on `ERR_CONNECTION_REFUSED` — self-inflicted, because the full vitest suite was
running against the same box. Not a code failure, and not a pass either.

Not exercised: the device. These are all WebView-reachable JS changes so they ship on a Railway
deploy with no APK, but none of the six surfaces was opened on the S25.

<a id="2026-09-25-rv181-observed-hr-sql-aggregate"></a>

# 2026-09-25 — RV-181: the observed HR profile is a SQL aggregate, not 90 days of rows

**Branch:** `rv181-observed-hr-sql-aggregate` · **Lane A**

## What this was

`getHrForWindow`'s range select was **565 s of 1,117 s of all database time — 50.6%** over 25.2
days, on 12,591 calls returning 212 M rows. The great majority of that was `resolveHrProfile`: seven
callers, each dragging 90 days of raw heart rate back to read six numbers off it.

It now computes those six numbers in SQL. `repo.getObservedHrProfile(userId, from, to)` returns one
row; `resolveHrProfile` never touches a row again.

## The entry's headline held; its evidence line did not

Re-measured against production before writing anything, because RV-181's whole value is a number:
**565 s, 50.6%, 12,591 calls, 44.84 ms mean, 16,843 rows a call** — unchanged in substance from
sweep 51 three weeks earlier.

But the fix it proposed was sized from a measurement of the wrong thing. Sweep 51's *"the same
statistic as a SQL aggregate at 54 ms"* was a plain aggregate over the raw window, with **no
chest-strap merge**. `preferStrapBuckets` drops a ring row when a strap row shares its 10-second
bucket, and the strap is 78% of the rows — reproducing it is the entire cost of the aggregate.
Measured on production, 2026-09-25:

| | DB time |
|---|---|
| plain aggregate, no merge (what "54 ms" measured) | **67 ms** |
| merge-preserving aggregate, `NOT EXISTS` index probe — shipped | **225–260 ms** |
| …same, hash anti-join | 317–333 ms |
| …same, `bool_or` window function | 394–438 ms |
| the 90-day row fetch it replaces | **~354 ms** (inferred: 2.66 µs a row from the mean) |

All three aggregate formulations returned identical values, which is the cross-check that the merge
semantics were reproduced rather than approximated.

**So the database-time saving is about a third, not the seven-eighths the 54 ms implies**, and the
entry now says so. The rest of the win is real but different in kind: 133,041 rows stop crossing the
wire and stop being materialised in Node on every resolve.

## What shipped

- **`getObservedHrProfile`** (`lib/data/postgres/slices/oura.ts`) — one statement reproducing every
  rule `computeObservedHr` applies: the strap-bucket merge (with the window bounds carried into the
  subquery, because the bucket set is built from rows *inside* the window), the plausibility band,
  `min`/`max` as k-th order statistics **with multiplicity** via `ORDER BY … OFFSET k-1 LIMIT 1`
  (which `percentile_disc` does not give), and the reliability and corroboration gates. The mean
  comes back unrounded and TypeScript rounds it, so the rounding rule stays in one language.
- **`resolveHrProfile`** reads the aggregate. **`resolveHrProfileWithWindow` is deleted** — RV-73
  added it so `/api/cardio-week` could slice its two 30-day windows out of the profile's 90 days,
  and it carried a documented boundary caveat because slicing a merged 90-day set is not quite the
  same as merging each window. With no rows to share, cardio-week queries each window directly and
  the caveat goes with it.
- **`EMPTY_OBSERVED_HR`** in `observed-hr.ts` — one definition of the no-data profile, which
  `computeObservedHr` now returns from its own zero branch and the two degrading call sites reuse.

## Two things the tests caught that reading would not have

1. **cardio-week lost a failure guard.** Its two windows used to come out of the profile's one
   `.catch`ed fetch, so a database fault left the card painting with an empty heart section. Calling
   the aggregate directly reinstated the 500 the *"still paints when the guarded reads fail"* test
   exists to prevent. Both direct calls now degrade to `EMPTY_OBSERVED_HR`.
2. **A mutation survived, and it was my test that was weak.** Removing the window bounds from the
   strap subquery — which would let a strap row outside the window thin a ring row inside it —
   passed. The case I had written put *both* rows past the end, where the ring row was excluded for
   its own sake anyway. Rewritten on the straddling bucket (window ends at 600 s, buckets are ten
   seconds, so 600 is the last row in and 605 the first row out) it kills the mutant.

## Verification

- `observed-hr-sql-equivalence.test.ts` — 14 cases, each running **both** paths over the same rows
  and comparing field for field. Nothing asserts a hand-written expected profile: an expectation
  copied from one side would pass while both sides were wrong together.
- **Mutation pass:** five real mutations (k-th → (k+1)-th, strap subquery loses its window bounds,
  band edge exclusive, corroboration off-by-one, window end exclusive) all killed; two deliberately
  equivalent controls (bucket arithmetic rewritten, reliability gate negated) both survived.
- **`pnpm dev`, logged in, against a 60-day seeded window mixing 17,281 ring rows with 42,912
  chest-strap rows:** `/api/hr-profile`, `/api/cardio-week`, `/api/cardio-trends`,
  `/api/zone-minutes`, `/api/health/hr-recovery-profile` and the SSR of `/baselines`,
  `/activity/guided-walk` and `/cardio` all 200, no errors in the server log. The merge dropped
  **exactly 288** ring rows — the number of 5-minute ring bins inside the one strap-covered day,
  which is the arithmetic being right rather than merely plausible.
- Cross-checked at scale on that window: both paths returned
  `{min:58, max:170, avg:127, sampleCount:59905, outOfBandRejected:0, highestPlausible:170}`.
- Full gate: `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1051 test files / 9798
  tests passed**, **Custom Rules 78 of 78**, `pnpm build` green.

**Not exercised:** nothing device-, native-, safe-area- or notification-shaped is touched — this is
a server-side query change reaching the APK through a normal Railway deploy, with no APK needed. The
production timings above are reads against the live database, not a deployed run of this code.

## What is still open on RV-181

The entry stays in the queue with two parts. The **memo** is the one that holds the other two
thirds: the 90-day shape ran ~1,460 times in 25.2 days because a ring drain during a workout
refetches `hr-profile`, and the aggregate does not touch that count. It was not shipped here because
it needs a freshness call rather than a mechanism, and `use-hr-profile.ts` already argues at length
against pinning this key — that argument deserves an answer, not a detour. It should also be
re-measured first: with the row fetch gone, `pg_stat_statements` reports the small-window callers
only, so the saving is measurable instead of modelled. The second part, `/api/health/trends`
re-deriving HRR that `workout_hr_stats.hrr1_best` already stores, needs a per-day agreement check
against production that has not been done.

<a id="2026-09-25-rv182-clock-offset-sql"></a>

# 2026-09-25 — RV-182 ②: one number per epoch, not the whole anchor log

**Branch:** `rv182-anchor-offset-sql` · **Lane A**

`getOuraClockAnchors` was **2,190 calls × 9,736 rows, 106 s, 9.4% of all database time**, and every
caller but one reduced those rows to a single scalar per epoch and threw the rest away.
`robustOffsetMs` takes the 10th-percentile lag — an order statistic — so the database can produce it
directly.

`getOuraClockOffsets` returns one row per epoch. Five adapter read paths that only convert
timestamps now take it (`getWorkoutSensorProbe`, `getSleepCoverageEnd`, `getDaytimeTagCoverage`,
`getOuraDaytimeSignals`, `getOuraBatteryEvents`). The rollup and three others keep the series,
because they genuinely need the observations — `run.ts` reads `anchor.anchorDs` for its watermark.

## Two corrections, one of them to my own first attempt

**The entry's attribution was wrong.** It read the cost as one number across three functions and
proposed `ORDER BY epoch DESC, anchor_ds DESC LIMIT 1` plus an index on `(user_id, anchor_utc DESC)`.
Measured separately on 2026-09-25:

| function | calls | mean | total | share |
|---|---|---|---|---|
| `getOuraClockAnchors` (full series) | 2,190 | 48.45 ms | **106 s** | **9.4%** |
| `getOuraClockEpochHead` (the `GROUP BY`) | 4,942 | 1.80 ms | 9 s | 0.8% |
| `getNewestOuraClockAnchorByUtc` (unindexed `anchor_utc`) | 4,942 | 1.71 ms | 8 s | 0.8% |

The two the fix targeted are already cheap. It would have bought at most 1.6%, left the 9.4%
untouched, and — applied literally — undone LA-139, which moved four call sites onto the full series
that same day because a single newest anchor was the wrong offset.

**And my own first formulation was a regression.** Expressing the order statistic with
`row_number() OVER (PARTITION BY epoch ORDER BY lag)` measured **53–67 ms** against the series
read's ~48 ms, because the window sorts all 12,591 rows. Counting per epoch first and taking a
top-N with `OFFSET` is **19–27 ms** warm. Both return the identical offset; only one is worth
shipping. That is the second time in two days a "replace the fetch with an aggregate" instinct has
had to be measured rather than assumed — RV-181 was the first.

## Getting the rank right

`floor(n * LAG_PERCENTILE)`, zero-based, matching `Math.floor(lags.length * LAG_PERCENTILE)` — **not
`percentile_disc`**, whose rank rule disagrees at small n. `LAG_PERCENTILE` is now exported from
`clock.ts` and interpolated into the SQL, so one constant serves both languages.

Two details that cost a run each and are worth stating:

- **`${LAG_PERCENTILE}::float8` is load-bearing.** Bound beside a bigint `count(*)`, the parameter is
  inferred as bigint and Postgres rejects `0.1` outright. The cast also makes it the same IEEE
  double multiply as the JS, so the two floors cannot part company.
- **`floor(extract(epoch FROM anchor_utc) * 1000)`** truncates to whole milliseconds, because the JS
  path reads `new Date(anchor_utc).getTime()`, which does the same.

## A defect the test found in my own helper

`offsetsFromAnchors` first returned `memoFor(anchors)` directly. That memo fills **lazily**, as
`offsetForEpoch` is asked — so it hands back an empty map, and the offset-based resolvers read
`undefined` and answer null. Every equivalence case failed on the JS side while the SQL was right.
It now populates eagerly, one entry per epoch present, which is the shape the database returns.

## Verification

- `clock-offset-sql-equivalence.test.ts` — 7 cases running **both** paths over the same anchors: no
  anchors, one anchor, n straddling every rank boundary to 31, a tie at the chosen rank, several
  epochs at once, one epoch with a single anchor beside one with many, and another user's rows
  present.
- **Mutation pass:** rank off by one, `ceil` for `floor`, lag sign flipped, `ORDER BY … DESC`, and
  the epoch predicate dropped — all five killed. An equivalent control (equality operands swapped)
  survives. **Two further "controls" I wrote were themselves broken** — both alias renames left one
  reference behind, making them syntax errors rather than rewrites, which is a lesson about writing
  controls rather than about this code.
- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1055 test files / 9825 tests passed**,
  Custom Rules 78 of 78, build green.
- **`pnpm dev` against 600 seeded anchors**, logged in: `/api/oura-ble/daytime-coverage` returns
  `hasAnchor: true` — the epoch resolved through the new path — plus `/api/sleep-sessions`,
  `/api/body-battery`, `/api/training-stress` and `/api/oura-ble/battery-analytics` all 200, and
  `/api/oura-ble/workout-sensors` reaching its "no completed workout" branch past the anchor
  resolution. No errors in the server log.

**Not exercised:** no device, native or safe-area surface. The production timings are reads against
the live database, not a deployed run of this code, and **the saving is not yet confirmed in
production** — `pg_stat_statements` counters are cumulative, so the drop will show as the
series-read share falls over the coming days rather than immediately.

## What is left

RV-182 ③, the rollup's delete-and-reinsert of ~880 HR rows per pass (535k deletes against 137k live
rows, `oura_heartrate_pkey` with 0 scans). And the anchor table still grows 150–300 rows a day: this
change stops most readers caring, but the seven remaining series callers still pay for it, so
thinning the inserts is worth its own look — noting it would move the offset value, where this
change provably does not.

<a id="2026-09-25-rv182-hr-rollup-churn"></a>

# 2026-09-25 — RV-182 ③: the upsert was already right; the delete in front of it wasn't

**Branch:** `rv182-hr-rollup-churn` · **Lane A**

Every rollup pass ran `DELETE … WHERE source = 'ble' AND timestamp >= cutoff` and then upserted the
window back. Measured on production before changing anything:

- **628,197 inserts · 574,974 deletes · 140,181 live rows** — 4.5× churn
- **95 updates.** Not a typo: the upsert path essentially never fired.

## The entry's fix was already shipped, which is why the churn survived it

RV-182 proposes *"upsert with `IS DISTINCT FROM`"*. `upsertOuraHeartrate` has done exactly that
since review B1/R1:

```sql
ON CONFLICT (user_id, timestamp) DO UPDATE SET … updated_at = now()
WHERE bpm IS DISTINCT FROM excluded.bpm OR source IS DISTINCT FROM excluded.source
```

with a comment saying why — *"so an idempotent re-roll of unchanged points does not churn the
timeseries sync"*. The guard was correct and had no effect, because the delete immediately before it
removed the very rows it was written to match. No conflict, no guard, every row a fresh insert, and
`updated_at` re-stamped on ~880 points per pass — which the Track-B timeseries sync uses as its
cursor, so each pass re-sent a window that had not changed.

**So the fix is not the upsert. It is the order and the scope of the delete**: upsert first, then
remove only the window's `ble` rows whose timestamps are no longer in the series. Same end state,
without destroying the rows to rebuild them — and it restores behaviour the code already had on
paper.

Deleting second also closes a smaller thing: the old order left a window in which the rows were
simply absent.

## The test that would have caught it

Nothing about the row *values* was ever wrong, so a test comparing rows would have passed against the
broken version. `rollup-hr-churn.test.ts` asserts **`updated_at` does not move on an unchanged
re-roll**, which is the only visible difference, plus: `updated_at` moves for exactly the one point
whose bpm changed, a point that left the window is removed, chest-strap rows in the window are
untouched, and rows before the cutoff are untouched.

Mutation pass: restoring the old delete-then-upsert order fails the two `updated_at` cases; dropping
the `source` filter, dropping the cutoff filter, `notInArray` → `inArray`, and inverting the
empty-`keep` guard all fail. An equivalent control (reordering the `and()` operands) survives.

## One thing spelled out rather than left to inference

`notInArray` with no values is not obviously a no-op either way, and reading it wrongly would strand
rows the rollup had dropped. An empty `keep` means the window is genuinely empty, so everything in it
goes — the old blanket delete's behaviour, which is right here. The code says so at the call.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1056 test files / 9830 tests passed**,
  Custom Rules 78 of 78, build green.
- `deleteBleHeartrateFrom` has exactly one implementation and one caller, both changed; there is no
  second `RollupIO` to update.

**Not exercised:** the rollup itself is not run end to end here — the new behaviour is tested at the
`RollupIO` boundary against real Postgres, and the pass that drives it runs on the server against
real ring frames. **The churn reduction is not yet confirmed in production**: `n_tup_ins`/`n_tup_del`
are lifetime counters, so it will show as their growth rate falls over the coming days, not as a
step change.

## Left alone, deliberately

`oura_heartrate_pkey` is **7 MB with 0 scans**, against 792,453 on the `(user_id, timestamp)` unique
key — dead weight on every insert and delete. Dropping a primary key is a migration and ships alone,
so it is noted in the entry rather than bundled here.

<a id="2026-09-25-rv182-noop-backfill"></a>

# 2026-09-25 — RV-182 ①: 8% of the database doing nothing, and a correction to the other 9%

**Branch:** `rv182-ingest-work` · **Lane A**

## What shipped

An idempotent `UPDATE oura_raw_samples SET measured_at = … WHERE measured_at IS NULL` ran on every
ingest batch. Its comment called it *"cheap no-op once caught up"*. Re-measured against production
before removing it:

- **4,932 calls · 90 s · 8.0% of all database time · 0 rows updated.**
- `measured_at` has **0 nulls** in ~192,772 rows.

No index serves that predicate, so each call seq-scanned the hot window to find the nothing it was
always going to find — and it is most of why `oura_raw_samples` shows a billion sequential tuple
reads.

**Deleting it is safe because a NULL can no longer be written**, and the argument is short enough to
check: `oura_raw_samples` has exactly one insert path (`insertOuraRawSamples`); `anchor` there is
non-null by construction, because having no anchors forces `epochNow == null`, which forces
`shouldObserve`, which writes one before the insert; so `measuredAt()` always returns a Date. The
only other writer sets `decoded`, and migration 190 sets `epoch`.

**The column is NOT dropped.** That is a data-dropping migration and the owner's call.

## An argument nothing checks is a comment

The deletion rests entirely on that invariant, so it is now pinned by
`lib/data/postgres/__tests__/oura-raw-sample-measured-at.test.ts` — five cases over real Postgres,
covering the paths a NULL could come from: an ordinary batch, **the very first batch a user ever
sends** (no anchor exists yet, which is the case the backfill genuinely served once), a batch that
opens a clock epoch, a history re-drain whose ds values sit far below the epoch high-water mark, and
a mixed sequence including a byte-identical re-send.

Mutation pass: writing `measuredAt: null` at the insert kills all five; an equivalent control
(arrow → function expression) survives. A third mutation — taking the anchor from the pre-batch read
rather than the one this batch just wrote — **also survived, and that is correct rather than a gap**:
it produces a differently-*dated* row, not a NULL one, and the statement being deleted only ever
touched NULLs. The test header says so, so nobody later mistakes it for a dating-accuracy test.

## The correction: the other 9% is not where the entry put it

RV-182's second item reads the clock-anchor cost as one number across three functions and proposes
`ORDER BY epoch DESC, anchor_ds DESC LIMIT 1` plus an index on `(user_id, anchor_utc DESC)`.
Measured separately:

| function | calls | mean | total | share |
|---|---|---|---|---|
| `getOuraClockAnchors` (full series) | 2,190 | 48.45 ms | **106 s** | **9.4%** |
| `getOuraClockEpochHead` (the `GROUP BY`) | 4,942 | 1.80 ms | 9 s | 0.8% |
| `getNewestOuraClockAnchorByUtc` (unindexed `anchor_utc`) | 4,942 | 1.71 ms | 8 s | 0.8% |

The two the proposed fix targets are **already cheap** — 1.7–1.8 ms against a 12,582-row table — so
the index and the `LIMIT 1` would buy at most 1.6% and leave the 9.4% exactly where it is. Worse,
the expensive one cannot become `LIMIT 1`: **LA-139 (#1602, merged earlier today) deliberately moved
four call sites onto the full series** because a single newest anchor was the wrong offset. Applying
the entry as written would undo a correctness fix to chase a saving it would not make.

**What the 9.4% actually is turns out to be RV-181's shape again.** `resolveDsToMs` needs *one
scalar per epoch* — the 10th-percentile lag from `robustOffsetMs` — and rebuilds it from every
anchor row on every request: 2,190 calls × 9,735 rows to produce one number, against **1 distinct
epoch** in 12,582 rows. So the fix is the order statistic in SQL, using
`ORDER BY lag OFFSET floor(n*0.1) LIMIT 1` rather than `percentile_disc`, which disagrees with
`Math.floor(n*0.1)` at small n — the same trap RV-181 hit and documented.

`resolveMsToDs` is the genuine hold-out: it interpolates between the anchors *bracketing* an instant,
so it wants a two-row windowed query, not an aggregate. Six call sites in total, plus thinning the
inserts (4,942 anchors, one per ingest batch, all describing one linear clock) as the complementary
half.

**That is a second substantial change and it is not in this PR.** Shipping the deletion alone gets
8% back now at low risk; starting a six-call-site refactor on the end of it would have been a
speculative push. The design above is written into the entry so the next session starts from it
rather than re-deriving it — and, more to the point, does not build the version that was written
down.

## Verification

- `tsc` clean, **1054 test files / 9816 tests passed**, Custom Rules 78 of 78, lint 0 errors.
- The production measurements above are reads against the live database, not a deployed run.

**Not exercised:** nothing device-, native- or safe-area-shaped is touched. The ingest path itself is
only exercised against local Postgres — the real path runs from the ring over BLE, and the on-device
half of it is unchanged by this diff.

<a id="2026-09-25-rv183-fetch-half-is-lane-a"></a>

# 2026-09-25 — RV-183's remaining fetch half is Lane A's, and the "today" envelope is Brisbane-keyed (LB-150)

**Branch:** `lane-b/rv183-fetch-half-is-lane-a` · **Lane:** Implementation B · **Docs only**

Lane B picked RV-183 back up expecting to remove the three resume-time fetches that duplicate
Home's. Reading the code first, as the entry's own retracted exercise-catalogue claim argues for,
turned up two things that changed what the work is.

## The remaining half cannot be done in Lane B, and should not be forced

All four reads — `next-session`, `readiness-score`, `body-battery`, and the warm list's own — are
`cachedFetchToday`. Plain `cachedFetch*` paints from cache and then **always** revalidates, so each
resume spends a GET on an entry that is already fresh. `freshWithinTtl` is exactly the flag for
that, and **`cachedFetchToday` hardcodes `undefined` for it** (`lib/sqlite/cache.ts:604`, 7th
positional argument), so it is unreachable from every today-envelope key. Exposing it is one line
in Lane A's file, and it composes: the today-check is in the unwrap, the TTL check in
`isFreshWithinTtl`.

Two Lane-B-only shapes were examined and both rejected:

- **`getCached()` first, fetch on miss** — the warm-list runner's own shape, 300 lines up in the
  same file, and TTL-aware. But it returns the raw `{date, data}` envelope and neither
  `unwrapToday` nor `TodayEnvelope` is exported, so three call sites would hand-roll a date
  comparison. That comparison is defective (below), so this would have copied the defect three
  times to keep the item in this lane.
- **`readTodayCacheSync()`** — keeps the unwrap in one place, but is not TTL-aware. A health-alert
  reconcile would act on a reading up to a Brisbane day old.

The structural call: ask Lane A for the one-line enabler rather than hand-roll. Reversal cost is
nil — once the flag is exposed the call sites gain one argument each.

## LB-150 — the envelope rolls over at Brisbane midnight for everyone

`unwrapToday` compares `envelope.date !== todayInTz()` (`cache.ts:546`) and the writer stamps
`todayInTz()` (`:603`). Both are the bare Brisbane default, so they agree with each other — which
is why no test catches it and why the sync-provider's recent writer/reader fix, which corrected a
genuine *disagreement*, left it alone.

Server routes compute "today" in the user's zone. The envelope rolls in Brisbane's. Between the
user's midnight and Brisbane's, a reading from the user's previous day still satisfies the guard
and is served as current — 14 hours a day in New York, the same window Q-478 measured for the two
guards commented immediately below this function. The comment there already states the rule;
`unwrapToday` is the one that takes no `tz` at all.

~10 keys write the envelope and ~14 read it, including readiness, body-battery, next-session,
supplements, weekly-stats, training-load and training-stress. Filed `Lane: A` — both sides have to
move together, because changing one leaves writer and reader disagreeing, which makes an entry
unreadable the moment it lands.

## Not done

No code changed. Nothing here was verified on device; it is a source reading, and the claims that
matter (the `undefined` argument, the two bare `todayInTz()` calls) are line-cited so the next
reader can check them in one grep rather than trusting this note.

<a id="2026-09-25-rv67-closed-three-disqualified"></a>

# 2026-09-25 — RV-67 closes: three of five candidates cannot take the flag at all

**Branch:** `lane-b/rv67-corrections-and-meta` · **Lane:** Implementation B

RV-67 listed five keys as candidates for `freshWithinTtl`. Two shipped. **The other three are
disqualified — each for a different structural reason, none of which an invalidation proof could
have fixed.** So the entry is closed rather than left with work that cannot be done.

## The three disqualifications

**`health-trends-summary` — wrong fetch variant.** Both read sites are `cachedFetchToday`, which
passes `undefined` for `freshWithinTtl` and has no such option. Unreachable by construction. It could
only be converted by moving the key to the plain variant, which would discard the today-envelope that
exists to stop yesterday's data rendering after midnight — trading a real protection for a saved
request.

**`workout-data:meta` — a derivation that includes `today`.** `phaseStatus` is computed from
`countAllSessionsSinceStart` *and* `todayInTz(tz)`. Completing a workout changes it, and so does
midnight passing. Under a 6-hour flag the phase status computed yesterday would survive into today —
the session-52 class, where a TTL happily serves yesterday's data across the boundary.

**`muscle-recovery` — it decays with the clock.** `computeMuscleRecovery` takes `now = Date.now()`
over a rolling 7-day window. The payload changes continuously **with no writer at all**, so there is
nothing an invalidation group could be made to catch; a flag would simply freeze the recovery
percentages for six hours while they should be climbing. This is the cleanest of the three: there is
no proof to write, because there is no write.

## The criterion the entry was missing

All five candidates were chosen because they were **already `TTL_LONG` and already in a group**. That
says nothing about the thing that actually decides it:

> **The payload must be a pure function of stored rows.**

Derived, date-dependent, or clock-decaying payloads are disqualified before any invalidation proof is
attempted — and the two that shipped are exactly the two that pass: `nutrition-meal-types` and
`nutrition-targets` are both stored rows. That criterion is now in CLAUDE.md beside the proof rule,
because the ordering matters: checking it first would have saved the whole candidate list.

## A correction to a number I called verified

In #1631 I wrote that RV-67's figures — **191 cached read sites, 8 flagged** — *"reproduce exactly"*.
They do not. Measured against that same commit with a fixed scanner: **198 read sites, 8 flagged** —
so the flagged count was right and the site count was not. My scanner skipped each call's type
argument with a paren-free character class, so every `cachedFetch<{ x: import('…').T }>` was
invisible; the entry's author evidently had the same blind spot, which is why we agreed.

**Two scanners agreeing is not corroboration when they share a blind spot** — "reproduces exactly"
meant "reproduces the same error", and I presented it as the one entry that had held up. The
conclusion is unharmed (190 of 198 did not opt in) but the figure was wrong and was published as
checked. The then-figure was recovered by running the fixed scanner in a worktree at that commit,
rather than reasoning back from today's count — which would have conflated two moments, and did in
my first attempt at this correction. Both scanners now skip the type argument by balancing angle brackets; #1631's journal entry
carries the correction inline.

That is the **fifth** distinct scanner trap in one day, each a different mechanism: a regex cannot
balance parens; requiring `(` right after the name misses generics; `{ method }` shorthand has no
colon; a same-line grep misses multi-line calls; and a generic can contain parens. Every one produced
a number that looked authoritative. One of them, this turn, also had me briefly conclude
`muscle-recovery` had no fetch sites at all — it has four.

**Not exercised:** nothing renders differently; this PR removes an entry, corrects two figures and
sharpens a rule.

<a id="2026-09-25-rv67-meal-types-ttl-gate"></a>

# 2026-09-25 — RV-67: the TTL the comment promised, and the proof one key needed to earn it

**Branch:** `lane-b/rv67-meal-types-ttl-gate` · **Lane:** Implementation B

A comment in `health-content.tsx` said `cachedFetch` "honours its TTL, so re-firing a group on a tab
revisit is a cache hit rather than a request". It does not, unless the call site opts in — and 183
of 191 cached read sites do not. This fixes the comment and earns the flag for exactly one key.

## The entry's numbers are right, and my first scan was wrong

**191 cached read sites, 8 with `freshWithinTtl`** — reproduced exactly. Worth recording how nearly
I "corrected" a correct entry: my first count returned **7 and 0**, because call sites are
`cachedFetch<MealType[]>(…)` and my regex required `(` immediately after the name. Generics. That is
the fourth scanner trap this session, and the first one where the scanner's answer would have
discredited the entry rather than the code.

> **Corrected later the same day.** Measured against this very commit with a fixed scanner, the
> figures were **198 read sites and 8 flagged** — so the *flagged* count was right and the *site*
> count was not (198, not 191). My scanner skipped each call's type argument with a **paren-free**
> character class, so every `cachedFetch<{ x: import('…').T }>` was invisible to it, and the entry's
> author evidently had the same blind spot, which is why we agreed. **"Reproduces exactly" meant
> "reproduces the same error": two scanners agreeing is not corroboration when they share a blind
> spot.** The conclusion is unaffected — 190 of 198 did not opt in. Both scanners now skip the type
> argument by balancing angle brackets, and the then-figure above was recovered by running the fixed
> one in a worktree at that commit rather than by reasoning back from today's count.

## The proof, which is the actual work

`freshWithinTtl: true` means a read inside the 6-hour TTL never touches the network, so a missed
writer turns a stale flash into six hours of hard staleness. CLAUDE.md requires a written proof per
key. For `nutrition-meal-types`:

- **Server writers** are four repository methods — `createMealType`, `updateMealType`,
  `deleteMealType`, `reassignAndDeleteMealType` — reached from exactly two routes,
  `/api/nutrition/meal-types` and `.../[id]`.
- **Those routes are called from exactly one client file**, `meal-type-manager.tsx` (lines 99, 123,
  157, 182, 221), and every one is followed by `invalidateMealTypes()` (105, 116, 193, 230, 236),
  whose group holds the key.
- **No sync writer**, which is the bullet that nearly sank it. There *is* an offline mirror,
  `replaceMealTypes` — but it has one non-test caller, and that caller hydrates the store **from**
  this cached response. It is downstream of the cache, not independent of it, so no pull-delta path
  can change meal types behind the cache's back.

## Two things the entry did not know

**`useCachedValue` had no `freshWithinTtl` option at all**, so one read site could not be flagged
without widening the hook. Done — `lib/hooks/**` is Lane B's — with the flag ignored when `today` is
set, since `cachedFetchToday` has no such parameter.

**The writer screen is deliberately left unflagged.** `meal-type-manager.tsx` edits meal types, is
visited rarely, and a network read there costs nothing anyone notices — whereas being wrong about
the writer set costs six hours of a stale list on the one screen where it would be obvious. Every
write there does invalidate before reloading, so the flag would be safe; this is defence in depth.

## What bounds cross-device staleness, and why two sites stay unflagged

A flagged read is cleared by any local write, so the residual risk is a change made on **another**
device: this one would not see it until the TTL lapsed. Two sites deliberately keep revalidating and
between them close that window.

`components/sync-provider.tsx` holds both — the warm-list entry at :85, and a real `cachedFetch` of
the key at :276 inside the notification-scheduling path. Neither is flagged, so a sync pass refetches
the list unconditionally and refreshes the entry every other read then hits. That is the design:
**flag the component read paths, not the warming ones.** Flagging the warm pass would be the actual
mistake here, because warming exists precisely to go and look.

## The guard

`components/nutrition/__tests__/rv67-meal-types-ttl-gate.test.ts` pins the fragile half — a new
mutating caller outside the manager would break the proof with no crash, just a stale list. Its
first cut had a bug worth keeping in mind: it anchored a fixed 700-character window on the key, and
the flag sat at 720 because my own explanatory comment pushed it out, so it reported a missing flag
that was present. It now extracts the whole brace-balanced call. A fixed window is the same class of
error as a regex that cannot balance parens.

Control-run: the flag assertion fails against `origin/main`; the two writer-set assertions pass
there, correctly — they pin a premise that predates this change.

**Not exercised:** no device, no browser. The behavioural claim here is "fewer requests on a warm
cache", which the sandbox cannot demonstrate end to end; what is verified is that the flag reaches
`cachedFetchCore`, that invalidation still clears a flagged key (the group deletes the entry, so the
freshness check misses), and that the writer set is complete.
