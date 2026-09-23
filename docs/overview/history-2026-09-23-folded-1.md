# Session journal — batch folded 2026-09-23

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-21-lane-a-rv80-hoist-hr-formatter"></a>

# 2026-09-21 — RV-80: a two-line hoist, and the test that the existing suite could not have written

**Branch:** `lane-a/rv80-hoist-hr-formatter` · **Lane A** · no behaviour change.

## What it was

`computeMovedHours` built an `Intl.DateTimeFormat` **inside** a loop that runs once per heart-rate
row. Its options are loop-invariant — `tz` is a function input, the rest are literals — so the
constructor was doing the same work thousands of times per call.

It is on a hot path: `lib/health/readiness-payload.ts:402` (`/api/readiness-score`), which
`components/sync-provider.tsx:69` warms at **every app launch** at a 5-minute TTL, so up to twelve
recomputes an hour per active device. Production `oura_heartrate` runs 2,691–5,606 rows on the
owner's training days.

## Measured here, and the entry's single figure understates it

| rows | in-loop | hoisted | ratio |
|---:|---:|---:|---:|
| 2,831 | 161 ms | 21 ms | **7.6×** |
| 5,606 | 343 ms | 30 ms | **11.4×** |

The entry quotes 10.4× at 2,831 rows; I measure 7.6× there and 11.4× at 5,606. **The ratio grows
with row count**, so quoting one number understates exactly the training days that cost the most.
Same-work was asserted inside the benchmark rather than assumed.

## The entry's two "not established" items

- **The other caller is admin-only** — `buildDayAudit` reaches `computeMovedHours`, and its callers
  are `/api/admin/backfill-derived-scores` and `/api/admin/day-review`. Not per-request hot. But
  the backfill **loops over many days**, so the hoist helps it more than the readiness route, not
  less.
- **The real route still has not been run against a 5,606-row day.** A test now runs the
  *function* at that volume and checks the answer stays bounded by the goal window; that is not the
  same as running the route, and the entry's caveat stands to that extent.

## The hazard the fix introduces, which is the part worth keeping

Hoisting one level further — to module scope — would bind the **first** caller's timezone for the
life of the process. **Every one of the 10 existing tests passes under that mutation**, because they
all use a single zone. The suite that proves the behaviour is preserved is structurally blind to the
way the optimisation can go wrong.

So the new test is two calls in two zones in one process, plus a re-ask of the first to prove order
does not matter. Under the module-scope mutation it is the only thing that fails.

`formatInTimeZone` was not used despite being the repo's usual idiom: this needs the day **and** the
hour from one pass and `formatToParts` gives both. The 18 sibling sites that call it in a loop are
fine — `date-fns-tz` caches internally, ~11 µs a call — and are deliberately left alone.

## The sibling sweep found exactly one, and it is Lane B's (LA-124)

`new Intl.DateTimeFormat` appears in a loop in exactly **two** places across `lib/`, `packages/`,
`app/` and `components/`, and the second is `minutesIntoDay` in
`components/body-battery/stress-day.ts:44`, called once per bucket from `toSegments`. Same defect,
same one-line fix.

**Measured rather than assumed, because the number decides what to do with it:** a full day is 48
buckets, and hoisting takes that from **3.19 ms to 0.16 ms** — a 20× ratio worth **3 ms per chart
render**. RV-80's site runs 2,831–5,606 times on a path warmed at every app launch; this one runs 48
times when a chart draws. Three orders of magnitude apart in what it costs.

So it is filed as **LA-124** rather than folded in here, for two reasons and the second is the
binding one: it is worth 3 ms, and it lives in `components/**`, which is **Lane B's** under the lane
rule. Filed at mid-queue priority, which reflects its value rather than its kinship with this item.

Worth noting for whoever takes it: `minutesIntoDay` is exported and directly tested across two
timezones (`__tests__/stress-day.test.ts:16-17`), so the module-scope over-hoist that this entry had
to write a new test to catch is **already caught** there. The blindness was specific to
`hourly-movement.ts`, not general.

## Verification

- **12 tests**: the 10 existing ones unchanged (the behaviour-preservation proof) plus 2 new.
- **Mutation pass, two mutations:** hoisted to module scope → **only the new test fails**, 11 of 12
  still green, which is the finding above made concrete; the same formatter built via a local
  options const (the deliberate control) → 12 green.
- Full suite, `check:rules` and typecheck below.

## Not exercised

- **No route run and no device check.** This is a pure function with no I/O; the measurement is a
  microbenchmark in this sandbox, so the absolute milliseconds will differ on Railway. The ratio is
  what transfers, as the entry says.
- **No behaviour change is claimed beyond what the existing suite covers** — day exclusion, hour
  boundaries, the waking window, and the goal invariant.

<a id="2026-09-21-lane-a-rv83-merge-derived-persists"></a>

# RV-83 — three writes on a read path become one, and the entry's own fix was the second-best one

**Branch:** `lane-a/rv83-merge-derived-persists` · **Lane A** · 2026-09-21

`/api/readiness-score` ended every computation with three separately-`await`ed
`repo.upsertOuraDailyDerived(...)` calls — readiness, sleep, activity — on a read path. They are now
collected and drained as **one statement per distinct day**, which in the normal case is one
statement instead of three.

## Both of the entry's "not established" points are now established, and they both go the same way

The entry closed with two open questions. Production answers both:

- **"Whether the third block fires in production at all (its gate was not met on the local
  dataset)."** It fires. Every one of the last twelve days carries an `activity_score`.
- **Whether the blocks share a row.** They do. All twelve days carry readiness, sleep **and**
  activity on one row, so `latestSummary.date`, `lastSleep.date` and `todayIso` resolve to the same
  day whenever the rollup is current — which is the normal case, not the edge.

So the wasteful shape the entry described is the *usual* shape, not an occasional one.

## The entry proposed `Promise.all`. It works, and it is not the best fix

Measured on local Postgres over a socket — network latency excluded, so Railway should favour the
merge by more, not less:

| shape | ms/request |
|---|---|
| 3 sequential upserts (what shipped before) | 2.38 |
| 3 via `Promise.all` | 1.17 |
| **1 merged upsert** | **0.66** |

I expected `Promise.all` to be worthless here, on the reasoning that three concurrent
`INSERT … ON CONFLICT` statements against the *same* row would just queue on the row lock. **That was
wrong** — it is a real 2×; Postgres takes and releases the row lock fast enough that the saved
round-trips dominate. Worth recording because the reasoning was plausible and the measurement
disagreed.

It still loses, for two reasons. It is **1.79× slower than merging**, and it spends **three pool
connections** to get its 2× on a pool CLAUDE.md keeps deliberately small and calls load-bearing.
Merging gets more, on one.

## Why merging is safe by construction rather than by comment

The entry flagged this as the tempting version needing a check first, because the comments at
`:663-666`, `:685` and `:706` *claim* each block writes only its own columns — and this sweep is
built on comments that say the right thing while the code does another.

Read at source, the claim holds, and it holds structurally rather than by discipline:
`upsertOuraDailyDerived` builds its column list from `Object.keys(DERIVED_COLS).filter(k => patch[k]
!== undefined)`, so a patch can only write the keys it actually carries. The three key sets are
disjoint — `readiness_*` + `model_versions`, `sleep_*`, `activity_*` — so a merged patch writes
exactly the union with every column still sourced from exactly one pillar. `model_versions`, the one
column with `||` merge semantics rather than COALESCE, appears in **one** patch, so grouping cannot
change how it combines with what is stored.

**That disjointness is an invariant, so `mergeDerivedPersists` refuses a key two pillars both claim**
rather than letting `Object.assign` pick a winner. A future pillar that starts stamping
`model_versions` would otherwise silently drop another's stamp — precisely the clobber Q-273 removed
from this table. The refusal is caught by the caller, so it costs a logged lost write and never a
failed read.

## The one thing that genuinely got worse, stated rather than buried

Three try/catches became one per day-group. A merged statement that fails takes every pillar in its
group with it, where before a bad value in one block left the other two written. The log line
therefore names the pillars in the group (`readiness+sleep+activity`) instead of a single pillar, so
a persistent failure says what it is costing. The blast radius is bounded by the fact that these are
best-effort persists of values recomputed on every request, so a dropped write self-heals on the next
one unless the offending value is itself persistent — in which case the old code would have failed
that block persistently too.

## Verification

- **4 new tests** on `mergeDerivedPersists`: the three-pillar collapse carrying every key, a lagging
  `lastSleep.date` staying its own upsert, the collision refusal, and the empty case.
- **Mutation pass, two mutations and one control.** Dropping the collision refusal for a silent
  `Object.assign` → 1 failed. Ignoring the day key so everything merges into one group → 1 failed.
  Each caught by exactly one test. The deliberately equivalent control — a plain object keyed by day
  instead of a `Map` — → **4 passed**, as it should.
- **Behaviour preservation is the existing suites, and they assert real rows.** 11 files / 48 tests
  across `readiness-score`, `body-battery`, `activity-contributors-persist` and
  `backfill-derived-scores` pass unchanged; `activity-score-persist.test.ts` reads
  `SELECT activity_score, activity_contributors FROM oura_daily_derived` against the local database,
  so it is an end-to-end assertion that the merged write still lands, not a mock call count.
- Full suite, `check:rules` (Ran 75 of 75) and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** Auth precedes validation on this route, so a dev-server curl
  reaches 401 rather than the handler; the coverage is the handler-importing route tests above.
- **The measurements are local, over a Unix socket.** Absolute milliseconds will differ on Railway.
  The ordering is what transfers, and network latency can only widen the gap between three
  round-trips and one.
- **Production was read, not written.** The twelve-day check is `claude_ro`, which is row-scoped to
  the owner — it says all three pillars land on one row *for the owner*, not for every account.

## One observation, recorded here as unexplained and explained later the same day

`pnpm check:rules` reported `memo() call sites pass stable props` as failing **once**, while the full
suite was running concurrently; the check passed standalone and `check:rules` passed on re-run.

**Cause found while shipping RV-66, and amended here rather than left wrong:** it is not a flake and
not load. `scripts/__tests__/check-comment-blindness.test.ts` proves each rule script actually
*detects* its violation by **appending the violation to a REAL source file** — `set-card.tsx` and
`app/api/user/goals/route.ts` — and restoring it in a `finally`. Run `check:rules` inside that
window and it reads a genuine violation that the suite put there seconds earlier.

So: **do not run `pnpm check:rules` concurrently with the full suite.** A failure from that overlap
is real in the sense that the file really does contain a violation, and false in every sense that
matters. The same overlap explains the stray rule-script output that appears inside vitest logs.

<a id="2026-09-21-lane-a-tn20-empty-snapshot-guard"></a>

# 2026-09-21 — TN-20: the write that destroyed four days is a GET

**Branch:** `lane-a/tn20-empty-snapshot-guard` · **Lane A** · data integrity, shipped alone as the
entry requires.

## What the entry expected, and what is actually there

Its first action reads: *"find the writer. Candidates worth checking first are the same
delete-before-guard shape as Q-528 (`replaceOuraDailySummary`) and any `fullHistory` path — a
recompute that starts by clearing and then writes nothing when its input query returns empty."*

**There is no recompute and no delete.** `body_battery_daily` has exactly one writer:
`GET /api/body-battery`, which snapshots the row on every read *by design* — its own comment says
*"Every read updates today's row, so the last read of the day captures the end-of-day value."*

So the mechanism is last-read-wins with no emptiness guard. A read whose waking-hours HR query comes
back empty computes a whole day of nothing — `hrSampleCount` 0, charged 0, drained 0, `endValue`
back at the anchor — and wrote it straight over a correct row. **The destructive write is a `GET`,
which is why nothing looked suspicious.** The entry's warning *"do not fix this by re-running the
recompute"* was aimed at a path that does not exist; the caution behind it was right for a reason it
did not have, since here a read *is* a write.

## Two corrections from production

Measured 2026-09-21 against `body_battery_daily` (84 days) and `oura_heartrate`:

| date | stored count | raw samples | drained | end = anchor |
|---|---:|---:|---:|---|
| 2026-07-26 | 0 | 272 | 0 | yes |
| 2026-08-22 | 0 | 265 | 0 | yes |
| 2026-08-26 | 0 | 1,954 | 0 | yes |
| 2026-08-31 | 0 | 3,767 | 0 | yes |

1. **It is 4 of 84, not "3 of the last 11".** The extra day (2026-07-26) predates the entry.
2. **It is not "losing days now".** The newest is 2026-08-31 — three weeks before this was written.
   **The mechanism was never fixed**: the guard did not exist until this change, so the right
   reading is the one CLAUDE.md gives for `error_events` — *something that stopped is not something
   that was fixed*. It stopped firing; it stayed possible. That is also why the fix ships with a
   test rather than on the strength of the table looking calm.

All four carry the identical signature — `total_charged = total_drained = 0`, `end_value = anchor`,
`anchor_source = 'readiness'` — which is what a walk over zero samples produces.

## The guard, and the fix that was rejected

`setWhere: excluded.hr_sample_count > 0 OR stored.hr_sample_count = 0`, in the `ON CONFLICT` clause
so it is atomic rather than a read-modify-write.

**Not a monotonic `excluded >= stored`**, which is the obvious alternative and is wrong twice: it
would freeze a day at a bad value, and it would block a legitimate downward correction. The entry
itself draws the line — on healthy days a stored count sits *slightly below* raw because of
waking-hours windowing, and **"zero against thousands is a different failure"**. The guard tests for
that failure, not for direction. A mutation pins it: the monotonic version fails the control.

**It repairs as well as protects.** A later read of the same day that does see samples passes the
guard and overwrites the empty row, so a day flattened in the morning heals itself by evening. That
is the entry's pass test, met by the write path instead of a backfill.

## Verification

- **4 tests against real Postgres**, through the real repository and the real drizzle upsert: the
  production case, the self-repair, and two controls.
- **Mutation pass, three mutations:** guard removed (the bug) → the production case goes red;
  monotonic guard → **the control goes red**, which is the point of having it; the same condition
  rewritten as `NOT (excluded = 0 AND stored > 0)` (the deliberate control) → 4 green.
- Full suite, `check:rules` and typecheck below.

## Not exercised, and what is still owed

- **The four damaged days are NOT repaired.** The route only ever writes `todayIso`, so nothing
  re-reaches a past date; the guard stops the fifth day and heals the current one, and that is all.
  Rebuilding 2026-07-26 / 08-22 / 08-26 / 08-31 from the raw samples that still exist needs a
  backfill path that does not exist yet, and it is a production data write — **confirm-first, and
  owed to the owner rather than assumed.** TN-20 stays queued for it.
- **The triggering condition is not identified.** This fixes the damage the empty read causes, not
  whatever made a read see no waking samples on those four days. TN-55 measures the adjacent thing
  (`walkBodyBattery` filters to `>= wakeTime`), so a wrong or late `wakeTime` is the first place to
  look — recorded rather than investigated here.
- **No device check needed and no APK** — server-side only, ships via Railway.

<a id="2026-09-21-motion-polish-button-and-sheet"></a>

# 2026-09-21 — motion-polish: a press state, and a sheet that opens like the rest of the app

**Lane B** · `fix/motion-polish-button-and-sheet` · **v1.463.0** · RV-71 + RV-75

Two one-line changes to shared primitives, and most of what is worth recording is about how they
were verified rather than what they say.

**RV-71.** `components/ui/button.tsx` had **no `active:` anywhere** — every variant was `hover:`-only
— across 129 importers, on a touch-only product. A finger cannot produce hover, and on Android
WebView `hover:` either never resolves or sticks after a tap, so the most-tapped control in the app
gave no feedback and could be left looking permanently highlighted. Meanwhile 45 files hand-rolled
`active:scale`, so the house pattern existed everywhere except the shared control.

`transition-all` was narrowed in the same change, which is not tidying: it animates `width`,
`height`, `padding` and `margin`, so any Button whose size changes — a label swapping to a spinner —
silently got a layout animation.

**RV-75.** The sheet ran on shadcn's stock 500 ms open, untouched. 47 files render one, against a
tab transition the repo deliberately cut to 180 ms with the comment *"the whole point of this app is
to feel instant"*. Now 300 ms open, 250 ms close, on the M3 emphasized-decelerate curve
`globals.css` already uses — not a second easing invented for sheets.

## The mistake that justifies the whole test approach

I wrote **`duration-250`**. It is not in Tailwind's default scale (75/100/150/200/300/500/700/1000),
so it compiled to **nothing** and left the stock 300 ms close in place.

A typo'd Tailwind class fails no gate. Not tsc, not lint, not the custom rules — the string is valid
JSX either way. It reads as a shipped fix and does nothing. That is why the spec asserts
`getComputedStyle` values rather than class strings, and why the control had to be run: the assertion
`sheet opens in 500ms — the stock 500ms default is still in place` is the only thing standing between
a working change and a convincing no-op.

## A second locator mistake, same shape

The Button spec first grabbed `page.locator('button').first()`, which on `/more` is some other
control carrying `transition-colors`. It failed loudly — but had the page happened to put a real
Button first, it would have passed while testing nothing. It now targets `[data-slot="button"]`.

**Both controls were run and both named the right defect**: *"the Button still transitions every
property"* and *"sheet opens in 500ms"*.

## The batch shipped in two pieces, deliberately

`motion-polish` names four entries. **RV-74 is genuinely `Gate: device`**, so the batch could not
ship whole in one PR regardless. **RV-72 is parked by its own emphasis glyph** — no `Gate:`, no
`Needs:`, just a `⛔` used for emphasis that `next-item.js` reads as the legacy blocker. That is
**LB-121's fourth measured instance**, and it is why RV-71 and RV-75 printed under READY while a
batch-mate printed under PARKED.

RV-72 was left out on a size judgement rather than the glyph: it is a new shared primitive plus ~33
conversions, and with `main` landing a PR every ~8 minutes against a ~7-minute check cycle, the
largest diff is the one least likely to land (#1365 took six merge attempts). It is next, and still
wants the same device pass.

## A queue error of mine, corrected here

**RV-81 was left in READY after it shipped.** I annotated the entry as `✅ SHIPPED` instead of
removing it — and since nothing was owed, the protocol is that it leaves the queue. It printed as
the top of READY on the next scan. `check-backlog-pointers.js` did not catch it because the ✅ was in
a bullet rather than the heading, which is the shape the check looks at. Removed.

## Verification

`e2e/rv71-rv75-motion-polish.spec.ts` — two tests, both asserting computed style: the Button's
`transitionProperty` excludes `all` and every layout property while including `transform`, at
≤120 ms; the sheet's `animationDuration` is ≤300 ms and its timing function is the app's shared
curve. Both proven red against the pre-fix primitives.

Gate: `Ran 75 of 75` Custom Rules · 7861 vitest passed, 0 failed · tsc clean · lint 0 errors.

## Not exercised

**How any of it feels**, which is the entire point of the batch. No sandbox drives a Samsung
WebView. The sticking `hover:` this guards against is a documented Android trait, not something
reproduced here. Both entries keep a device item.

**The sibling `transition-all` sites RV-71 lists** — `set-card.tsx:305`, `pre-workout-screen.tsx:342,351`,
and `home-sortable-section.tsx:26`'s `transition-[padding]` — are **not** done. Separate files,
separate risk; left rather than swept blind, and recorded on the entry.

<a id="2026-09-21-perf-la124-stress-day-formatter"></a>

# LA-124 — the stress chart's clock formatter is hoisted out of its per-bucket map

**Branch:** `perf/la124-stress-day-formatter` · **Lane B** · no version bump (see below)

## What shipped

`components/body-battery/stress-day.ts` built a fresh `Intl.DateTimeFormat` on every
`minutesIntoDay` call, and `toSegments` called it once per bucket inside a `.map`. Constructing the
formatter is the expensive part, and it was loop-invariant the whole time — `tz` is a parameter and
every other option is a literal.

The formatter now comes from a `clockFormat(tz)` helper that `toSegments` calls **once**, with a
private `minutesFrom(fmt, t)` doing the read. `minutesIntoDay(t, tz)` keeps its exported signature
and its per-call semantics exactly — it is not in a loop, and it is directly tested.

**Measured here, not carried over from the entry:** a full day's 48 buckets went **3.02 ms → 0.18
ms, 16.7×**. The entry's own figure was 3.19 → 0.16 ms; same order, and the difference is machine
noise. This is the last raw `Intl.DateTimeFormat` construction in `lib/`, `packages/`, `app/` or
`components/` — RV-80 took the other one, and the sweep is now complete.

## The test, and why the existing ones were not enough

`stress-day.test.ts` covers the behaviour — the timezone, midnight-as-0, gap splitting, coverage —
and passes unchanged, which is what says the hoist is behaviour-preserving. What it does not cover
is the hazard the hoist *introduces*: a formatter cached one level too far out, at module scope,
binds the first caller's zone for the life of the process.

The entry predicted the existing `Etc/GMT+5` case would catch that. **Measured: it catches the broad
version and misses the narrow one.**

- Mutating `clockFormat` itself to a module-scope singleton → 4 tests fail across three files,
  including the existing `Etc/GMT+5` case. The entry is right about this one.
- Mutating **only `toSegments`** to hold a module-scope formatter, leaving `minutesIntoDay`
  untouched → **27 of 28 pass**. Every pre-existing test is blind to it, because no existing test
  calls `toSegments` in two zones.

`la124-hoisted-formatter.test.ts` is the control for that second mutation, in RV-80's shape: two
`toSegments` calls in two zones in one process, plus a re-ask of the first zone so ordering cannot
hide it.

## Not exercised

No device pass, and none is owed — the entry says so explicitly (*"do not batch this with a
device-gated item; it needs no APK and no owner check"*). The saving is ~3 ms per chart render,
which is real but not felt.

## No version bump, deliberately

The rule bumps the version for **user-visible** changes. Three milliseconds off a chart render is
not perceivable, and a changelog line claiming otherwise would be the kind of number-as-fact the AI
guards exist to stop. Nothing about what the chart shows has changed.

<a id="2026-09-21-review-agent-sweep-52"></a>

# Review sweep 52 — what the owner actually sees

**Branch:** `review/sweep-52-visual` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-21-sweep-52-what-the-owner-sees.md`](../reviews/2026-09-21-sweep-52-what-the-owner-sees.md).
**Filed:** RV-84 … RV-102 (19 entries, two new batches).

The owner asked for another review on this line, angles of my own choosing, weighted toward things
that visually affect him. Four read-only lanes — number/unit formatting drift, 384px layout
integrity, empty/zero/error states, colour semantics and contrast — with every load-bearing claim
re-verified at source or against production before filing.

**Findings are ranked by where the owner actually is.** The resume telemetry in `error_events` gives
**Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2**, so a drift on Home outranks a tidier
fix elsewhere by evidence rather than taste. That ordering is worth reusing.

## The systemic finding

`cachedFetch` **cannot reject** — its network section is wrapped in `try/catch/finally`, so a 500, a
429 and an offline throw all resolve a boolean. Every `.catch()` chained onto it is dead code, at
**16 sites**, and the error states built on them are unreachable: Coach's option picker sits on
"Loading your options…" forever, the Profile achievements grid spins forever. One rule, one-line
test, so RV-84 asks for a check script rather than a sweep that has to be repeated.

## Home carries three failure-vanish bugs

The score row disappears entirely on a failed fetch — no row, no skeleton, no message (RV-85). A
failed streak fetch paints a confident **0-day streak, 0 sessions this week** (RV-86). Profile
invents *Level 1 · Novice · 0 XP* and all-zero lifetime stats (RV-87).

RV-85 is the one worth reading: `fetchWithRetry`'s own header says it exists so a blip doesn't leave
"the readiness/sleep widgets blank until the app is restarted" — and it retries three times, then
gives up silently through `.catch(() => {})` and a `void` return with no error channel. It fixes the
transient case, quietly accepts the persistent one, and lands on exactly the blank widget it was
written to prevent.

**The app already owns the right patterns** — `observed-hr-card.tsx` for measured-vs-missing,
`oura-section.tsx` for `onError`, `nutrition-activity-trends-card.tsx` which even carries a comment
explaining that `cachedFetch` never rejects. These are unevenly applied, not absent.

## One stored 1RM renders four different numbers

For a stored 92.25: **92.5** (ready screen) · **92.25** (summary) · **~92** (pre-workout) ·
**92.3** (strength trend, stats sheet). Four numbers, three unit spacings. Four of the five sites
call the shared `displayOneRm` for the *bodyweight* branch of the same ternary and hand-roll the
weighted branch — the helper is imported and half-used (RV-89).

`mround125` doing display duty is the sharp edge: it is a barbell-plate rounder, and
`projectOverview.md` records **BF-127**, where applying it to a bodyweight 1RM index told the owner
to load 82.5 kg on a pull-up. Same class, lower down: body weight renders five ways across seven
sites with no shared formatter (RV-90), and `kcal` appears 154 times against a single `Cal` (RV-91).

## Layout: a real CSS bug, measured against real content

`pre-workout-screen.tsx:354` puts `truncate` on a **flex container**, where `text-overflow` cannot
apply — so the name hard-clips with no ellipsis *and* the green "done today" tick is clipped out of
existence, making a completed exercise read as unlogged (RV-92). It is the only such site in
non-admin code; the other 17 are correctly on flex items.

The rest are measured against production, not invented worst cases: the injury chip is `shrink-0` at
176 of 352px and the owner has a **live unresolved lower-back injury**, squeezing the mid-set title
to ~15 characters (RV-93); the food diary gives a name 22 characters while **130 of 337 real items
are longer**, with a genuine collision between two "Up & Go Protein Energi…" rows (RV-94); the
weekly Volume tile wraps for every non-zero week (RV-95).

## Colour: a number painted the wrong band's colour

`training-load-card.tsx:71` hard-codes `#f59e0b` for the ACWR value — exactly what `acwrBand()`
reserves for **"High"** — while the word beside it comes from the real interpretation. An ACWR of
1.05 shows "✓ Optimal zone" in warning amber, above copy saying the green zone is 0.8–1.3.
`acwrBandByKey()` exists for that caller and is not imported (RV-97).

"Deload" is green on the phase card and red/orange/amber on the banner (RV-100). Good/warning/bad
exists as two parallel palettes — a raw-hex triad copy-pasted **173 times** and a token triad — so
only half the app can follow the theme (RV-99). And `scripts/check-contrast.js` has no opacity
handling, so `/60` and below are unguarded: the calendar's 7px "rest" marker sits at **2.97:1**, and
it is the only thing distinguishing a past rest day from an untracked one (RV-98).

## Clean, verified

Steps and `bpm` are uniform everywhere. `scoreBand()` is genuinely one place and its consumers ship
the word with the colour — the ACWR card is the single exception. Touch targets are floored to 48px
globally. Segmented tabs, the activity grid, walk summary and sets grid all fit 384px with real
content. 1RM deltas agree across all three sites. Core dark pairs are comfortable (foreground on
card 17.78:1).

## Not established

**Nothing was rendered** — no device, no WebView, no screenshot. Widths are computed from classNames
plus font advance-ratio estimates (±10% moves the marginal cases); contrast is computed from
resolved tokens. No layout break and no colour was observed. Contrast composites assume an opaque
`--card`, and several screens render wallpaper gradients under semi-transparent cards — that layer
was not modelled. OS font-scale is unaccounted for and makes every layout finding worse. `claude_ro`
is the owner's rows only. Macro grams, water, sleep-stage durations and HRV were not swept.

<a id="2026-09-21-rv81-shared-exercise-datalist"></a>

# 2026-09-21 — RV-81: one exercise catalogue, not one per row

**Lane B** · `fix/rv81-shared-exercise-datalist` · **v1.462.1**

The program editor's `<datalist>` of exercise names sat **inside** `sess.exercises.map(...)` with a
per-row id, so a 25-exercise program against a 156-row library rendered **3,900 `<option>`
elements** where 156 would do — and because the editor's state is lifted to its parent, every
keystroke in any exercise-name input re-rendered the sheet and rebuilt all of them.

One `<datalist id="ex-lib">`, memoised on `[exerciseLibrary]`, every input pointing at it. On the
seeded library that is **145 options** (146 rows, one merged) against 3,900.

**A shared list is exactly equivalent, not a trade.** `datalist` ids are document-global and the
per-row content was byte-identical — the same `filter(l => !l.mergedInto)` every time.

## The gate was right and my first instinct was wrong

I hoisted the memo and the element into `program-editor-sheet.tsx`, which took it from 956 to
**984** lines. `check-component-size.js` failed it against a 963-line baseline on a file it names a
known hotspot, with the instruction *"extract, do not append"*.

Extracting it to `components/config/exercise-library-datalist.tsx` left the sheet at **953** — below
where it started — and gave the shared element a home a second consumer can find, which is the
point of exporting `EXERCISE_LIBRARY_LIST_ID`. A ratchet that only ever blocks is an annoyance; this
one pointed at the better design.

## The control's message was wrong before it was right

The spec waited for `datalist#ex-lib` to have options. Against the pre-fix code that wait failed
with *"the shared datalist never filled — exercise_library did not reach the sheet"* — a true red
for a false reason. There is no `#ex-lib` at all before the fix; the ids were `ex-lib-<si>-<ei>`.

Split into two assertions, the control now says *"no shared datalist — the list is still being
rendered per exercise row"*. **Reading where a control goes red is not enough; read what it claims
while it is there.** A future failure on a genuinely empty library would otherwise have been
diagnosed as the defect this entry fixed.

## Verification

`e2e/rv81-one-exercise-datalist.spec.ts` opens the editor straight from `/program?new=program` (no
navigation through the tab shell), adds three exercise rows — the duplication is invisible with one
— and asserts exactly one `<datalist>`, that every `input[list]` targets it, that no orphaned
options exist anywhere else, and that the input's `list` **property** resolves to a populated
element. That last one is the real risk of sharing an id: the count can be right while the binding
is broken.

Gate: `Ran 75 of 75` Custom Rules · 7855 vitest passed, 0 failed · tsc clean · lint 0 errors ·
tests-typecheck at baseline · `check-component-size` clean.

## Not exercised

**The millisecond cost, which was never claimed.** Nothing in the sandbox drives a Samsung WebView,
so how much input lag 3,900 rebuilt elements were worth is still unknown. The entry filed this as an
element-count finding and it ships as one. **Do not quote it as a latency improvement.**

The device look is unaffected — no visual change, the list is hidden by definition.

<a id="2026-09-21-tn35-stress-against-events"></a>

# 2026-09-21 — TN-35's overlay: reading the day's stress against what he was doing

**Lane B** · `feat/tn35-stress-against-events` · **v1.462.0**

## How this came to be startable

TN-35 was parked on `Needs: TN-3b` — *"do not build the join before the axis exists"*. The axis
existed twice over by this point, but TN-3b stays in the queue for a `Keep:`, and `Needs:` clears
only when its target *leaves*. So a satisfied dependency went on blocking.

That was filed as #1362 rather than edited away: unparking your own next item is how a queue stops
being a queue. **The owner then said to continue with the backlog, which is the authorisation this
build ran on.** The structural question — whether `Needs:` should clear on buildable work, or
whether a residue-only entry should stop counting as a blocker — is still open and still the
Orchestrator's. This entry shipping is not an answer to it.

## What it does

The day screen already rendered TN-3b's stress chart for whatever day you swiped to. It now also
fetches that day's timeline and places the events on the same axis: a thin tick where each one sits
on the clock, and beneath the chart a list of `time · title · level`.

**The negative case is the feature.** Coverage averages 26.6 buckets a day — **13.3 of 24 hours** —
with real multi-hour holes, so events routinely fall where nothing was measured. The entry is
explicit: *"Render that as absent, never as calm."* An event with no bucket within half a
bucket-width prints **`no reading`**, never `0.00`. A zero there would be the single invented number
the owner would act on. The list header carries `N of M with a reading` for the same reason — a
sparse day must not read as an uneventful one.

**No verdict, and none should be added.** Ranking causes needs many marked instances per event type;
one month of one user will not support it, and an automatic *"X stresses you"* is TN-16's shape,
which is parked.

**The `tag` lane is excluded in code.** `oura_tags` holds zero rows and its feed was removed on
2026-08-13. Rendering it would promise a marker mechanism that does not exist.

## Two decisions worth not re-litigating

**Marks in the SVG, labels in HTML.** The chart's viewBox is `0 0 1440 200` with
`preserveAspectRatio="none"` — one unit per minute, stretched to the container. Any text inside it
is drawn horizontally distorted. So the ticks are SVG lines with `vectorEffect="non-scaling-stroke"`
and every label is HTML beneath.

**The cache key is a child of Home's prefix, and that is the important line in the diff.**
`invalidateCache` matches `key LIKE 'prefix%'`, and six write groups in `lib/cache-groups.ts`
already clear `home-day-timeline`. `home-day-timeline:<date>` is therefore cleared by all six for
free. A fresh `day-timeline:` prefix would have been a *second* invalidation contract that every one
of those writers had to remember — and the day one did not, a deleted meal would sit beside a stress
reading looking like data. It also kept the change inside Lane B: adding a group entry means editing
`lib/cache-groups.ts`, which is Lane A's.

`stress-day-timeline-key.test.ts` pins both halves — that the key is a child of the prefix, and that
the groups still clear it *as* a prefix. Either changing alone breaks the guarantee silently, and
missed invalidation is this repo's most repeated bug class.

## Verification

- `components/body-battery/__tests__/stress-at-events.test.ts` — 14 cases, killed by six mutations:
  drop the gap guard · first-match instead of nearest · absence reads as `0` · render the `tag`
  lane · unsorted · a measured zero counted as absent.
- `e2e/tn35-stress-against-events.spec.ts` — drives a **past** day, which is the entry's own pass
  test, and seeds one event inside a measured run and one inside a gap. Proven red with the prop
  unwired, failing at the join assertion.
- Gate: `Ran 75 of 75` Custom Rules · 7841 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline · `check-cache-ttl-divergence` and `check-fetch-once-effects` clean.

## Two mistakes, both caught by running things rather than reading them

**The nearest-bucket mutation survived the first draft.** My test claimed to pin "picks the nearest
of two buckets in reach" and could not: buckets are nominally 30 minutes apart and the window is
±15, so at most one is ever in reach and first-match and nearest are indistinguishable. The test now
uses irregular spacing — which is the real case, since a back-filled day is assembled from stored
rows and nothing enforces the interval. **A mutation that survives is the test telling you it is
describing something other than what it claims.**

**The e2e fixture guessed the schema and wrapped the guess in a fallback.** It inserted
`activity_logs.started_at` as a timestamptz; the real column is `start_time time`, and `title` is
NOT NULL. Worse than the guess was the `.catch()` retry I put around it — a second wrong query
standing by to hide the first. Removed. A fixture that cannot insert must fail loudly.

## Not exercised

- **The marker half, which is Lane A's and unbuilt.** A timestamped moment row is a migration.
  Meetings, commutes, arguments, caffeine and screens remain invisible to the app, and they are most
  of what the owner means by "events". This half attributes stress only to training, food, walks and
  sleep.
- **The device look** — a list of the day's events under the chart at 412 px.
- **The pass test itself**, which only the owner can run: open a past day and say whether a stressed
  window matches what he was doing — **or say it does not**, which is an equally valid result and
  the one that would retire the metric.

<a id="2026-09-21-tn3b-stress-on-hr-chart"></a>

# 2026-09-21 — stress on the heart-rate charts, and a recommendation the owner overruled

**Lane B** · `feat/tn3b-stress-on-hr-chart` · **v1.461.0**

## The entry I recommended striking turned out to be live work

TN-3b's remaining text promised *"overlaying stress on the HR charts"*. I read that as leftover
prose: the 2026-09-10 conversation reshaped the entry and moved the overlay onto the **day timeline**
as TN-35, every buildable claim in TN-3b was discharged, and `hr-day-chart.tsx` drew sleep and
workout bands and no stress. Three earlier sessions had reached the same reading and filed it as a
scope call.

Put to the owner with a recommendation to strike, the answer was **no — he still wants stress on the
HR charts**. Both surfaces, not one.

**The reasoning that produced the wrong recommendation is worth naming: I treated the reshape as
superseding the original ask.** It did not. The reshape added the day-timeline overlay as a second
deliverable; it never withdrew the first. A later decision that expands scope reads identically to
one that replaces it, and nothing in the entry distinguished them. **Asking cost one turn. Striking
it would have deleted a live request and left no trace of what was lost.**

## What shipped

The day's stress series is drawn on `hr-day-chart.tsx` against the same clock as the heart rate.

**A second hidden scale, not a second chart.** The question is *what was my heart doing while this
happened*, which needs one x axis. The stress axis is `display: false` and fixed to [−1,+1]: a tick
reading `−0.4` beside one reading `62 bpm` invites two scales to be compared as if they shared
units, and fitting the axis to the day would stretch a flat ±0.1 day into violent swings.

**The measured series, not "stressed" bands.** Shaded windows would read better on a phone. They
would also require inventing the number that decides what counts as stressed — a calibration, and
calibration belongs to Tuning and the owner, not to the lane drawing the chart. A display threshold
is still a claim about someone's day. The line states the measurement and stops.

**Gaps are `toSegments`', not a second copy.** The runs are re-joined with an explicit `null` so
Chart.js breaks the line. Coverage averages 13.3 of 24 hours and one measured day jumps 06:45 →
13:15 — a joined line would draw a stress level for six hours nobody recorded. That is the same
defect fixed hours earlier on the trend sparklines (TN-53), reached from the other direction: there
a flag spanned the gaps, here the data arrives in runs and had to be kept in them.

**Two surfaces, and one deliberately left out.** `/health/heart-rate` and `hr-day-card.tsx` get the
overlay. **Home's compact widget does not**: its legend is hidden in compact mode, so the line would
be an unexplained second stroke on a glance card, and it would add a GET to Home's first paint. That
is a judgement, not an oversight — revisit if the owner wants it there.

## Two things fixed on the way through

`lib/hooks/use-stress-day.ts` now owns the key, URL and TTL for `stress-day:`. The standalone strip
was swept onto it in the same PR — with the HR chart there were two readers and two copies of the
same three constants, which is what `check-cache-ttl-divergence.js` exists to catch.

`app/health/heart-rate/page.tsx` derived its whole day from `todayInTz(DEFAULT_TZ)`, keying the page
to Brisbane for every user. Fixed here rather than filed, because the feature needs it: placing
buckets in one zone while asking for another zone's date is the exact split that renders a Brisbane
morning as an afternoon.

## Verification

- `components/health/__tests__/hr-stress-overlay.test.ts` — 10 cases: local minute-of-day rather
  than the device's, the real 06:45 → 13:15 hole, a 60-minute tolerance under the 75-minute
  threshold, no leading or trailing null, out-of-order back-fill sorted, level 0 kept as a reading
  rather than a gap.
- `e2e/tn3b-stress-on-hr-chart.spec.ts` — seeds both series and asserts the legend on
  `/health/heart-rate`. **Proven red with the props unwired, and it failed at the stress assertion
  with the chart still rendering** — *"the HR chart did not pick up the day's stress series"*. Where
  it goes red is the point: a control that failed at the chart-exists assertion would have proved
  only that the page was broken.
- Gate: `Ran 75 of 75` Custom Rules · 7825 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline (320/90).

**The spec had to seed HR readings as well**, because `seed.sql` records nothing for today and the
chart returns null without them — so the first run asserted the absence of a chart rather than the
presence of an overlay, and said so out loud rather than passing.

## BF-185: answered, and still not mine

The owner also chose **an editable time control** for BF-185, whose engine half shipped the same
night (#1358) and removed the only way to correct a wrong dose time.

**It is still not startable by Lane B, and the blocker is the same field that was wrong the first
time.** The entry says *"the server already honours an explicit `takenAt`"*. That is true of the
repository and false of the route in front of it: `SupplementLogSchema` is `.strict()` with exactly
`amount`, `unit` and `doseText`, so a client sending `takenAt` gets a **400 before the handler
runs**. The control would ship unable to save. The schema and the route are Lane A; the entry now
says so, with the sequencing.

The general lesson, which is not about this entry: *"the server honours X"* is a claim about a
repository method, and what a client talks to is the route's schema. **Read the schema, not the
repository, before believing a UI can send a field.**

## Not exercised

The device look, which is what the entry still owes: an amber stress line over the HR line with
sleep and workout bands behind both, at 412 px on the S25. Four things in one chart is exactly what
a browser cannot judge.

And the **cross-day stress aggregate** — the other pre-reshape promise in TN-3b. The owner was asked
about the HR-chart overlay only and answered that. It is recorded as a `Keep:` with an instruction
not to assume it is wanted.

<a id="2026-09-21-tuning-battery-rate-balance-and-unpark"></a>

# 2026-09-21 — the tuning queue had nothing reachable in it, and the battery fix I recommended was wrong

**Branch:** `tuning/battery-rate-balance-and-unpark` · **Agent:** Tuning · **Docs-only.**

A review of the tuning front, asked for by the owner. Two findings, one structural and one
substantive, plus four owner decisions.

## Structural: 52 tuning entries, zero reachable

`node scripts/next-item.js` put **none** of the 52 `TN-` entries in READY. The breakdown was 19
parked on a prose `⛔` marker, 12 on `Needs:`, 3 on `Gate:`, 13 under `KEEP`, 5 under `REFERENCE`.

The 19 are the interesting ones. `next-item.js` parks any entry containing `⛔` when no structured
field explains it, and the marker is doing two different jobs across the file: *"this entry cannot
start"* and *"do not implement it this way"*. Reading all 25 marker lines in those entries, **17 of
19 were the second kind** — "do not fix this by lowering the zone boundaries", "do not widen the mean
by counting part-logged days". Design guidance, parked as if it were a blocker. One (TN-3b) said in
its own text that the parking rationale no longer applied.

Converted those 25 lines to `⚠`, which the parser does not treat as a block. **READY went 6 → 21
overall, and Lane A's list went to 14 topped by tuning work.** Two entries stay parked because their
markers are real: TN-2 (the fit cannot run in the sandbox) and TN-33, which now carries a proper
`Gate: owner` instead of prose.

This is the same defect as yesterday's TN-51/TN-54 filing, one layer up — a queue tool nobody reads
the output of. The lesson is in the baton: run the tool after filing, read the bucket.

## Substantive: I recommended a Body Battery fix that measurement overturned

The owner approved *"replace the fixed charge threshold with a rolling 28-day p10 of waking HR"* on
my framing that the threshold sitting below his quietest waking hour was **the whole of** "it's
pretty much useless". Then I measured it, and it is not.

Time-weighted, binned in `Australia/Brisbane`, against production:

| date | mins below charge ceiling | of which awake | charge stored |
|---|---:|---:|---:|
| 2026-09-18 | 220 | 104 | **0** |
| 2026-09-19 | 255 | 55 | 5 |

**220 minutes below the ceiling produced zero charge.** Widening the ceiling to the quantile moves it
60.1 → 61 bpm and buys 2.8% → 3.7% of the day. It is not the lever, and TN-2 and TN-52 both frame the
problem as if it were.

Three multiplicative losses, measured rather than reasoned:
1. **Sleep is excluded** — `walkBodyBattery()` filters to `tsMs >= wakeTime`, so the longest low-HR
   stretch cannot charge. Whole-day vs waking-only, same formula: 12.7 → 6.1 on 2026-09-18.
2. **The charge ramp zeroes at the ceiling** — full rate only at or below resting HR, and the owner
   logs ~0 minutes below his own resting HR, which is near-tautological. Mean multiplier 0.30–0.50.
3. **`DRAIN_RATE` is 3× `CHARGE_RATE`**, on top of both.

Over 84 days: **mean charge 14.3/day, mean drain 44.1, net −29.8.** Ends at exactly zero on 24 days
and charges nothing at all on 17. That is a countdown, not a battery, and it is what the owner has
reported twice.

Filed as **TN-55** at the top of the queue: calibrate so a median day nets ≈ 0, fitting the three
levers jointly. Pass test is distributional — median net within ±5 of zero, days-at-zero under ~10%,
**and the day-to-day spread preserved**, because a fix that flattens every day to 50 has destroyed
the signal rather than calibrated it. TN-2 is marked superseded in its central claim; TN-52's
quantile is demoted from "the fix" to "worth having anyway" (it stops the ceiling drifting with
resting HR, which it did — 57.8 → 60.1 across the window).

## Also filed

**TN-56 — the replay endpoint.** TN-52 already called it *"the highest-leverage single item on the
tuning front"*, and it sat as a paragraph inside a `Reference:` entry, which prints under *read, do
not build*. Extracted as its own buildable entry: run a named scoring function across a parameter
bracket server-side, return the distribution, **write nothing**. It unblocks the 25 thresholds the
August sweep could not measure at all — 19 of them sleep-staging constants feeding readiness's
heaviest contributor.

## Owner decisions, 2026-09-21

- **Body Battery** — approved the direction; the mechanism is replaced by TN-55 per the above.
- **Baseline rebuild** — he will fire it. Clears TN-6's −16 pt penalty on 89% of days.
- **Titration** — *"dose will not change; but ideally it has a calibration period. Do what's best."*
  My call, written into the backlog protocol as the **calibration-period rule**: fit only on data
  from 21 days after the last dose change, require ≥28 days, and state the window's start date in the
  proposal. Self-referencing thresholds are exempt, which is the argument for preferring them.
- **Owner actions** — he took the `0x73` capture retrieval and declined the admin sitting and the
  three-week recovery log. The declines are recorded on their entries with the consequence stated:
  the stress branch (TN-16, TN-34, TN-21) stays blocked behind TN-33's unvalidated sign.

## Not exercised

Nothing runs — documentation and queue ordering only. `pnpm check:rules` **Ran 75 of 75**, all
passed. The production measurements are read-only queries through `/api/admin/db-query` and are
**row-scoped to the owner**, which is the right scope here since every claim is about his own data.
TN-55's proposal is **not** validated against a re-run of the model — the pass test names what a
correct fix looks like, and only an implementer with the replay path (TN-56) can confirm it.

<a id="2026-09-21-tuning-body-battery-cure"></a>

# 2026-09-21 — the Body Battery cure, fitted offline; and the blocker that wasn't there

**Branch:** `tuning/body-battery-cure` · **Agent:** Tuning · **Docs + one script.**

Earlier today I filed TN-55 saying the Body Battery nets −30/day and that validating a fix needed the
replay endpoint (TN-56) that doesn't exist. The owner asked for a cure. The blocker was not real.

## `walkBodyBattery` is a pure function, so the fit runs offline

TN-2 asserts the fit *"cannot be done from an agent sandbox"*. That was true when the arithmetic was
welded into a 200-line route with eight DB reads — and Lane A extracted it into
`packages/shared/src/health/body-battery-walk.ts` **for exactly this reason**, with a header saying
so. Bundling that module and driving it with production reads gives a full replay with no server
work. TN-56 remains worth building for the 25 sleep-staging constants, whose inputs are never
persisted, but it does not gate TN-55.

Harness committed at `scripts/tuning/body-battery-replay.cjs`.

## The harness was wrong twice before it was right

Both caught by validating against stored values rather than trusting the replay.

1. **Wake time from `max(sleep_end)` per day picks up naps** — it put wake at 15:05, 19:00, 13:01, so
   the whole day's HR fell before `wakeTime` and was discarded. Zero drain on days with 3,000
   samples. That is the Q-17 shape, reproduced by accident. Fixed by using the repo's own
   `nightSessions()` classifier, which needs `date` and `durationHours` on each row or it silently
   returns zero nights.
2. **The stress term cannot be replayed** — it needs the persisted dHRV model. The residual
   (stored drain − replayed HR drain) implies a mean |stressLevel| of **0.14–0.62 on every day**, all
   inside [0,1], which is what makes the reconstruction credible. The `--validate` step now asserts
   that range, because a residual outside it means a harness bug, not stress.

Equivalence was then asserted before any sweep: the candidate model configured as the shipped one
reproduces `walkBodyBattery` on **70 of 70 days, max absolute difference 0**.

## What is actually wrong — four defects, and the ceiling is not one

| # | defect | measured |
|---|---|---|
| 1 | the stress term dominates | **61% of all drain**, exceeds HR drain on 49/65 days, **−0.61** correlation with day end |
| 2 | sleep cannot charge | the walk starts at `wakeTime` |
| 3 | the charge ramp zeroes at the ceiling | mean multiplier **0.30–0.50** |
| 4 | drain is 3× charge | 0.60 vs 0.20 |

Full-day replay with shipped constants: **median net −85/day, 66% of days end at zero.** The stored
rows read −30 instead of −85 because they are partial-day snapshots — `hr_sample_count` ranges from
**11 to 4,676** depending on when the route last ran.

The charge ceiling, which TN-2 and TN-52 both name as the problem, is not among the four — the
correction I already made this morning, now with the mechanism measured.

## The cure

Charge through sleep, flatten the charge ramp, de-weight stress, and scale the rates by one gain.
At gain 0.5: **median net −0.2, mean end 59.2, sd 28.0, days-at-zero 5%** (from 66%). Gain is a clean
dial — 0.3 takes railing to 5% at sd 23.9 — so Lane A can move within the range without refitting.
Plan: [`2026-09-21-body-battery-rate-balance.md`](../superpowers/plans/2026-09-21-body-battery-rate-balance.md).

**The finding that outranks the arithmetic:** the Body Battery is mostly a rendering of the
daytime-stress metric, whose sign TN-33 says is unvalidated and which the owner declined to validate
today. So the proposed `STRESS_DRAIN_RATE = 0.05` is a **de-weighting of an untrusted input**, not a
calibration of a trusted one, and the plan says not to raise it back until TN-33 settles.

## Not done, deliberately

**The constants are not final and must not be shipped as final.** The dose stepped 0.5 → 1 mg on
**2026-09-13**; the calibration-period rule I wrote this morning puts the earliest honest fit at
**2026-10-04**. The four structural changes don't depend on the window and can ship now. The implied
stress level runs 0.56–0.62 in the last four days against 0.14–0.41 before the step, so fitting
against the current window would encode the titration as normal.

## Not exercised

Nothing shipped to production. The replay is read-only against `/api/admin/db-query`, **row-scoped to
the owner**, which is the right scope since every claim is about his own data. The stress term's
*shape within a day* is not established — one mean level per day is inferred, not replayed. Whether
5% railing survives in production is unknown, because the route persists partial days.
`pnpm check:rules` **Ran 75 of 75**, all passed.

<a id="2026-09-21-tuning-checkin-label-has-no-answers"></a>

# 2026-09-21 — the self-report has never been answered, and that is why tuning cannot be accurate

**Branch:** `tuning/checkin-label-has-no-answers` · **Agent:** Tuning · **Docs-only.**

The owner asked what would make tuning more accurate. The answer turned out to be measurable in one
query, and it explains why every calibration in this repo has been fitted to internal consistency.

## Measured, 96 check-ins over 81 days

| | |
|---|---|
| rows with a `perceived_recovery` value | **77** |
| rows where `perceived_recovery_touched` is true | **0** |
| distinct values ever | **2** (2 and 3) |
| standard deviation | **0.29** |
| `sleep_quality_feel_touched` | **3 of 96** |

The control that scores 10% of readiness, and is the only candidate ground truth in the app, has
**never once been answered** — exactly as the owner said unprompted a fortnight ago (*"I dont really
choose them; I let it auto select"*). The column that distinguishes answered from unanswered already
exists, is populated correctly, and reads zero.

## The defect is not what I first wrote down

I drafted this as circularity — the control pre-filled from readiness, feeding the model its own
output. **It is not.** `components/morning-checkin-sheet.tsx:21` seeds from a neutral constant
(`NEUTRAL_SCALES = { perceivedRecovery: 3 }`), tracks `touched` correctly, and posts both. The
circular one is the separate *energy* check-in, `readinessToEnergy()` in `mood-checkin-sheet.tsx`
(TN-50). Two sheets, two defects; filing them as one would have sent an implementer to the wrong file.

**The real defect: an untouched default is persisted and then read as an answer.** Three consumers,
none of which checks the flag in the same row:

1. `app/api/admin/battery-recovery-calibration/route.ts:83` — a **calibration** route builds
   `recoveryByDate` from it. It is being calibrated against 77 values nobody gave.
2. `app/api/health-trends/route.ts:136` — filters `!= null`, then correlates against readiness.
   A correlation against a series with sd 0.29 is not a coefficient, and it is shown as one.
3. `app/api/body-battery/stress-day/route.ts:17` — its own comment already says
   *"`perceived_recovery` reads 3 on all 17 days"*. The observation was made; the flag was not used.

Q-465 already closed the adjacent case (an empty body writing all-null). This is the case a
**non-empty** body carrying an unanswered value slips through.

## Why it is the root cause rather than one bug

TN-33 cannot validate the daytime-stress **sign** without an independent target that varies. That
blocks TN-16's warning, TN-34's re-wire, and the stress weight TN-55 measured at **61% of all Body
Battery drain** — which is currently de-weighted precisely because the sign is unknown. One missing
label holds up the whole chain.

## Filed

- **TN-57** (Lane A, top of its queue) — make the three readers require the `*_touched` flag, then
  store `null` for an untouched scale. **No migration and no data write**: the flag already separates
  the two populations, so backfilling buys nothing and destroys the record of how long this ran.
  Expect the health-trends correlation to *disappear* rather than change; there are zero answered rows
  to plot, and that is the correct outcome, not something to fix by relaxing the filter.
- **TN-58** (Lane B, its only READY item) — replace the absolute 1–5 with a comparative
  *better / same / worse than yesterday*, no default and no pre-selection. Three taps on a sheet he
  already sees. Comparative judgments produce variance by construction, and **pairwise orderings are
  enough to validate a metric's sign and ranking** — which is exactly what TN-33 needs, without
  calibrated absolute values. The owner declined a three-week daily log this morning; that decline is
  the design constraint this works within, not an obstacle to argue with.

Its pass test is falsifiable in a fortnight: ≥3 distinct values and a touched-rate above zero. If it
fails, the finding is that self-report is not available from this owner at all — worth knowing, and
cheap to learn.

## Not exercised

Nothing runs; documentation only. The production read is one query through `/api/admin/db-query`,
**row-scoped to the owner**, which is the right scope since the claim is about his own answers. I have
**not** verified that no fourth consumer reads `perceived_recovery` without the flag — the three named
came from a grep of `app/`, `components/`, `lib/` and `packages/`, and TN-57's implementer should
re-grep before calling it complete. `pnpm check:rules` **Ran 75 of 75**, all passed.

<a id="2026-09-22-chore-or-122-ungate-unbuilt-work"></a>

# 2026-09-22 — `chore/or-122-ungate-unbuilt-work` (OR-122)

**Orchestrator.** A read of the queue for what could be combined or unblocked. It found two circular
parks and one detector bug, and the three turned out to be the same shape.

## The state that prompted it

`next-item.js` reported **Lane A 21 READY, Lane B 0**. Lane B was not out of work — 38 KEEP,
48 PARKED, nothing startable.

## Five entries parked by the wrong field

`Gate: device` means **shipped, awaiting a look**. Five entries used it to mean *"this will need a
device at the end"*, which parks unbuilt work.

- **RV-68**, **RV-74** — unbuilt, filed 2026-09-20, both gated. RV-68's fix is three statements
  moved above a `try`; RV-74's is one CSS transition. Now plain **Verification** lines.
- **BF-165** — a **live owner-reported bug** (*"when I try click the treadmill… nothing actually
  happens"*), root cause fully measured, design constraints written out, and gated since
  2026-09-17 with the exit condition *"ungate it the moment the fix lands in a branch needing only
  the S25 look"*. A gated entry never prints as READY, so nobody starts the fix, so the condition
  cannot arrive. Ungated and added to the `back-gesture-sitting` batch, which needs the same
  Android back gesture it does.
- **LB-116** — shipped, owes a check → `Verify: device` (which does not park), per BF-90.
- **BF-111** — shipped, then **FAILED on the S25**. A device gate there describes debt that is
  settled and hides what is actually blocking: the owner's screenshot, because a bare fail does not
  say which of the card's three states was wrong. Re-gated `Gate: owner`.

## LA-49 was parked by the bug it describes

The deeper cause. `next-item.js` treated **any `⛔` in an entry body** as a blocked marker. Measured
today: **28 entries parked by it, ~7 meaning blocked.** The other 21 use `⛔` as an emphasis glyph
for a warning to whoever *builds* the entry — *"⛔ Do not extend this to the conic-gradient rings"* —
which is the opposite of a reason not to build it.

**LA-49 measured exactly this on 2026-09-01 (34 entries, 7 real) and specified the fix in two
ordered steps. It then sat for three weeks — because it quotes three of those emphasis markers as
evidence, so the detector parked it too.** Nothing about the measurement decayed; it never printed
in a READY list.

Both steps shipped here, in LA-49's own order, because its caution was correct — narrowing the
detector first would have put two entries whose headings open *"REFUTED"* at the top of an
implementer's work list.

1. **Triage.** The genuinely blocked got fields: `Gate: owner` on **TN-2** (the `.constants.json`
   set Q-49 removed from the repo does not exist in a container), **Q-49**, **Q-72**, **Q-85**,
   **Q-1b**; `Needs: BF-92` on **Q-252**. **Q-538**'s bound was *"blocked, and not by anything in
   this queue"* — it had no target to point a `Needs:` at, so **OR-123** was filed for the WebView
   rollup consumer and Q-538 now needs it. The refuted ones — **BF-14**, **LA-57**, both of which
   say outright *"do not implement"* — got `Reference:`. **Q-48** was parked by a glyph inside a
   struck table row whose whole content is that the block was released; the glyph is elided from
   the quotation now, with a note saying why.
2. **The detector** now matches `⛔ block…` rather than the bare glyph — the file's own documented
   convention (`⛔ blocked: <reason>`), not a new heuristic.

**Result: Lane A 21 → 33 READY, Lane B 0 → 4.** LA-49's verification criterion holds — no entry in
READY has a heading saying it is refuted, shipped or superseded. Three entries still park on the
narrowed marker, all correctly.

## Worth carrying

**Two circular parks in one read, with one shape: a condition for becoming visible that can only be
met by someone who can already see it.** BF-165's gate could only be lifted by work the gate
prevented starting; LA-49 could only be fixed by an implementer the bug hid it from. When writing a
park of any kind, check that something *outside* the entry can lift it.

And the narrower rule it is an instance of: **`Gate:` is for what blocks starting. Unbuilt work
gets a Verification line, however certain it is that the device will be needed at the end.**

## Not done

- **47 device checks are still unbatched** (68 owed, 21 in the seven existing batches). Clustering
  them by the screen each needs is the next aggregation pass, and it is the one that costs the
  owner's attention rather than CI.
- The `legacyBlocked` code path was **narrowed, not deleted** — LA-49's step 2 said to delete it.
  Q-1b's `⛔ blocked because` is a real marker doing real work, so the path stays.

<a id="2026-09-22-chore-or-124-batch-device-checks"></a>

# 2026-09-22 — `chore/or-124-batch-device-checks` (OR-124)

**Orchestrator.** Intended as the device-check batching pass that OR-122 deferred. It turned into
two other things, because the batching pass is forbidden and the top of the READY list was stale.

## The batching pass does not happen, and should not have been promised

CLAUDE.md:118: *"Assign batches when an entry is next touched, not in a bulk pass."* OR-122 closed
by naming a bulk batching sweep as the next pass. That was wrong against a standing rule, and the
rule is right: a batch decided without re-reading the entry is a grouping made from a 150-character
residue, and it goes stale silently where nobody re-reads it.

**What the owner actually wanted from it is a view, not a field.** `node scripts/next-item.js
--sittings` now prints every entry owing a device check, grouped by primary domain tag, with each
one's lane and existing batch. It counts both shapes — a `Verify: device` **and** a `Keep:` naming
the device — because BF-90 found eleven entries writing the same debt in both places, so keying on
either alone undercounts.

Measured on this commit: **104 owed, 27 already batched, 77 loose.** app-shell 27 · nutrition 19 ·
workouts 15 · devices 13 · platform 9 · readiness 7 · body 5 · sleep 4 · activity 2 · heart-rate 2 ·
cardio 1.

Domain tag is the proxy for screen: already on every heading, mechanical, and it freezes no
judgement into the file. The view cannot go stale. A `Batch:` written today could.

**The count corrects twice.** OR-122 said 47, then 62. Both were low — the first predated review
sweep 52, and the second used a narrower residue test and skipped batched entries.

## TN-59 was at the top of READY with a superseded premise

Tuning filed TN-59 on the morning of 2026-09-22: `next-item.js` parked any entry containing the
no-entry glyph, 28 entries were parked that way, and LB-124 had been filed and parked the same
morning, taking Lane B's READY list to zero. It specified a Custom Rules check with a 28-entry
shrink-only baseline.

**#1390 landed hours later and narrowed the detector. Entries parked by a prose marker alone: 0.**
An implementer taking the top of the list would have built a check against a backlog that no longer
exists, and baselined it at a number three weeks out of date.

Reconciled in place rather than removed, because the preventive half survives: someone can still
write `<no-entry sign> blocked: <reason>` in prose where a `Gate:` belongs. That check is much
smaller — **baseline 0**, no triage to precede it, the same shape as
`check-aest-midnight-timezone.js`. The 2026-09-22 morning record is kept below a rule, marked as a
record.

One claim in the reconciliation was written and then corrected before pushing: it asserted that the
new text parks TN-59 under the narrowed rule. Running the tool says it does not — the caution
carries no *block* within 40 characters of the glyph. Asserting a tool's output without running it,
inside an entry about a tool's output, is the same mistake in miniature.

## Worth carrying

**TN-59 and OR-122 are one finding, reached independently on the same day from opposite ends** —
Tuning from having swept 17 markers by hand and watched a new one arrive; the Orchestrator from Lane
B having nothing to start. Neither session saw the other. The common cause is `LA-49`, which
measured the whole thing on 2026-09-01, specified the fix, and sat for three weeks because it quotes
the glyph as evidence and was parked by the bug it describes.

**A self-parking finding does not stay found. It gets re-found, and each re-finding pays the
investigation again.** That is a better argument for the check TN-59 still proposes than the count
it was written against.

## Not done

- **No `Batch:` fields were written.** They get assigned when each entry is next touched, per the
  rule. `--sittings` is what makes that cheap — an implementer touching an entry can see in one
  command which sitting it belongs with.
- `--sittings` has **no test**. It is a read-only view over a parser the existing tests already
  cover, and its output is advisory by construction; a test pinning its grouping would pin the
  domain tags rather than the logic.

<a id="2026-09-22-chore-or-125-owner-decisions"></a>

# 2026-09-22 — `chore/or-125-owner-decisions` (OR-125)

**Orchestrator.** The owner answered six questions in one sitting. This records them where the work
is, and closes five dead PRs.

## The six

| # | question | answer |
|---|---|---|
| 1 | Five PRs open with nothing live in them | **Close all five** — #1250, #608, #265, #10, #6 |
| 2 | Q-28 / BF-9 / BF-7, held by a prompt not a field | **Release all three** |
| 3 | LA-121 — port the temperature ladder, or let `tempZ` stand? | **`tempZ` stands; delete the ladder** |
| 4 | Q-29 Task 5 — drop the server raw archive? | **Show the case first** |
| 5 | The `.size` conflict tax | **A filing sweep ships as ONE PR** |
| 6 | BF-111's failing About card | **Owner will send a screenshot** |

## What each one changed

**The five PRs are closed.** #1341 had merged on its own since LA-122 listed it. Three remain open
and all three are live. LA-122 item 6's own point stands and is why it was written down: CLAUDE.md
exempts pushing, opening and merging-when-green from confirm-first and deliberately does not exempt
**closing** — so an agent that proves a PR dead still cannot clear it. That is correct, and it is
also how six accumulated. The fix is a list an owner will actually see.

**Q-28, BF-9 and BF-7 are released**, recorded on each entry. The Lane A scheduled prompt's
exclusion list should stop naming them. The owner took the item's own argument: a rule living in a
prompt rather than in the file every agent reads goes stale unnoticed.

**LA-121 was answered TWICE on the same day, by two sessions, and the other one's answer is
better.** Both reached `tempZ` stands. Mine argued from reversibility — the ladder has not run since
2026-07-07, so deleting it changes nothing and it stays in git. The version already on `main` argues
from a measurement: **TN-6 has the temperature baseline 0.36 °C too low**, so porting a *sharper*
penalty on top of a wrong baseline amplifies the error rather than adding signal. That is a reason;
mine was an absence of risk. On the merge, `main`'s text was taken whole and mine discarded, and the
caveat I had added — do not delete `temp-penalty-suspension.test.ts` with the ladder — turned out to
be redundant: the entry already carried it as its own last bullet.

**That other session also filed something I would have missed: item 2a.** Four entries each rewrite
stored readiness days (TN-60, TN-6, BF-13, LA-121), and shipping them separately would visibly shift
the owner's history four times with no way to attribute what he was looking at. The recompute fires
**once**, after the last of them — and deliberately **not** as a `Batch:`, because that means one PR
and one PR here would bundle three code changes with an owner-fired production data write.

**Worth recording rather than smoothing over:** two sessions put the same question to the owner on
the same day and got the same answer, which is benign here only because the answers agreed. Both
were reading LA-122, which is the ledger that exists so questions reach a human — it has no way to
show that one is already in flight.

**Q-29's ball came back to us**, which is the right outcome. Declining to answer a one-line summary
of an irreversible change is not indecision. `OR-126` is filed for the brief: what is dropped, what
survives in the device's deliberate 14-day window, what becomes permanently unrecoverable (the
history buffer only moves forward, so a later decoder fix can back-fill only from stored hex), and
what keeping it actually costs — measured, against a ~227 MB database billed at $0.15/GB/month.
The entry carries an instruction not to write it as an argument for the drop.

**CLAUDE.md gains one rule:** a filing sweep ships as one PR. Review sweep 53 was twenty entries;
as twenty PRs that is nineteen guaranteed conflicts on a single line of one `.size` file. Also
recorded there: `enable_pr_auto_merge` does not work on this repo, so the CI/CD section's
auto-merge escape is unavailable and every merge is hand-driven against a moving base. The better
long-term fix — generating the baselines in CI — was named and is unfiled.

## Worth carrying

**Four of the six had sat between one and nine days. A fifth had been noticed in an earlier
session, recorded nowhere, and re-derived from scratch.** None was a hard question. They were
questions nobody had been asked, because each lived in a session transcript that ended. Writing
them into one entry an owner could read was the whole of the work; the answers took one sitting.

The same day produced the exact inverse. **`LB-121` is now the third independent filing of the ⛔
parser bug** — after `LA-49` (2026-09-01) and alongside `TN-59` and `OR-122`, four sessions across
three weeks, no two aware of each other. LA-49 had the complete diagnosis and a two-step fix on day
one and never surfaced, because it quotes the glyph as evidence and was parked by the bug it
describes. It is rewritten here as a `Reference:` on that pattern rather than deleted.

**A finding that reaches a human gets answered. A finding that hides itself gets re-derived, and
each re-derivation pays the investigation again.**

## Not done

- **OR-126 is not written** — that brief is the next Orchestrator task, and Q-29 stays gated until
  it exists. Do not re-ask the owner before then; asking twice for the same yes with no new
  evidence gets a decision made on fatigue.
- **BF-111 stays `Gate: owner`** until the screenshot arrives.
- **Generating `.size` baselines in CI** is named in LA-122 item 5 and has no entry. It removes the
  conflict class rather than reducing it, but it is a real change to the ratchet.
- **The Lane A prompt still names Q-28/BF-9/BF-7** in its exclusion list — that is outside the repo
  and cannot be edited from here.

<a id="2026-09-22-chore-or-127-device-cdp-harness"></a>

# 2026-09-22 — `chore/or-127-device-cdp-harness` (OR-127)

**Orchestrator, owner-requested.** The owner asked whether they could plug the S25 into a computer
and have an agent drive it through devtools. The answer is yes, with one refinement, and the
harness for it ships here — **unrun**.

## The refinement

The owner's instinct was to point a browser-based session at the `chrome://inspect` page. That is
the right destination reached through the wrong door: `chrome://inspect` is a GUI over the DevTools
protocol, and a GUI is a poor control surface for an agent. `adb forward` plus the protocol itself
gives the same access with nothing in the way.

The session also has to be **local**. This one runs in an ephemeral cloud container; a phone on a
USB cable on the owner's desk is not reachable from it, and no amount of tooling changes that.

## It was already possible, and that was checked rather than assumed

`android/app/src/main/java/com/trainingai/app/MainActivity.java:519` calls
`setWebContentsDebuggingEnabled(true)`, gated on the manifest's own debuggable flag, and the APK is
built with `assembleDebug`. The installed app is inspectable now — nothing needs rebuilding, and
the rolling `apk-latest` release is already the right build.

## What it removes

`playwright.config.ts` states its own ceiling in its header: *"it drives the **web** build, where
`getLocalStore` returns null… A green run is evidence about the web path only."* Three classes of
check are unreachable from any sandbox as a consequence, and the backlog is full of all three:

| class | why no sandbox reaches it |
|---|---|
| offline-first reads | `getLocalStore` returns null off the APK; the device branch never runs |
| safe-area clearance | `env(safe-area-inset-bottom)` is `0` in desktop Chromium, so the floored-utility rule is uncheckable |
| what is actually painted | the Samsung WebView compositor is where the SVG/gradient faults live |

Plus the one `back-gesture-sitting` exists for: the **Android system back**, which Playwright
cannot fire because it arrives over a Capacitor channel. `adb shell input keyevent 4` is the real
thing, and `systemBack()` is a separate export precisely because it is an `adb` call rather than a
protocol one.

## What shipped

`scripts/device/cdp.js` — device discovery, socket discovery (the pid changes on every app start,
so it is found rather than assumed), the port forward, target selection, and a minimal CDP client
on Node 22's global `WebSocket`, so there is no dependency to install. `session.evaluate`,
`session.screenshot`, `session.tap`.

`scripts/device/probe.js` — the read-only first run. Reports whether Capacitor says this is really
native, what `env(safe-area-inset-*)` actually resolves to, and a screenshot from the compositor
itself. It changes nothing, and it prints the path it was taken on so a reading is never orphaned
from its screen.

`scripts/device/README.md` — the runbook, including the two setup conditions that silently
invalidate results: the APK must be the debug build, and **gesture navigation must be on** or every
inset reads `0` and a broken clearance looks correct.

## Decisions

**Raw CDP rather than `chromium.connectOverCDP`, and this is the first thing to revisit.**
connectOverCDP would be less code and would let the **existing `e2e/` specs run unchanged against
the device** — a far bigger prize than any bespoke check. It was not taken because it needs a
*browser* target and an Android WebView commonly exposes only page targets (`/json/version` with no
`webSocketDebuggerUrl`). From a sandbox that can test neither path, shipping a harness that might
not connect at all was the worse risk. Once a device confirms the forward works, try connectOverCDP
against the same port before writing a second bespoke check.

**`tap` enforces an actionability assert, and BF-165 paid for it.** It scrolls the element into
view and requires `elementFromPoint` to land on it before dispatching. That entry spent three
rounds of confident wrong conclusions because a raw coordinate tap has no such check: two controls
sat below the fold at 412×915, their taps hit nothing, and *"both failures share the `/activity`
prefix"* read as a real differential when it was a coordinate artifact.

## The screenshot was a gap, and the owner found it

The first draft captured a **single** frame. The owner clarified they meant `chrome://inspect`'s
mirrored phone screen — and that mirror is `Page.startScreencast` plus `Input.dispatchTouchEvent`,
the same protocol this harness already speaks. The `tap` half was built; the frames half was not.

The mirror exists so a human can watch and click, and for deciding whether something is *right*,
reading the DOM beats looking at a picture of it. **What the mirror has that a screenshot does not
is time** — and the entire `motion-polish` batch is timing questions no still frame can answer:

| | the question |
|---|---|
| **RV-74** | the hero's number eases over 600 ms while the ring snaps — do they end together? |
| **RV-75** | is the sheet 300 ms or the stock 500? `duration-250` was written for the close and **is not a Tailwind class**, so it compiled to nothing and left the stock value — a typo'd class fails nothing, and only a measurement finds it |
| **RV-72** | do the bars animate a compositor property, or a layout one? |

`record.js` writes each frame named by its offset from the start, plus an `index.json`, and takes
`--tap` so the tap lands *inside* the window rather than before it. It prints the longest gap
between frames, because **the phone drops frames under load and a sparse recording reads as a fast
transition**. The timestamps are the evidence; the frame count never is.

## Two corrections the owner made, and one standing change

**The ring and the scale are reachable, and saying otherwise was wrong.** Three places in the first
draft said the harness "does not reach the ring or the scale — real BLE needs real hardware". The
owner's point: *"then you get the exact app that has the devices connected."* Correct. This drives
the app on **the phone they are paired to**, so every app-side BLE surface is reachable — what the
pipeline has actually ingested, what the admin consoles read, whether a sync button does anything.
That is most of the `devices` group and all of `admin-console-sitting`, about 17 checks written off
by a sentence. **The real limit is on making the hardware PRODUCE** — wearing the ring overnight,
waking a radio that power-gates when worn-idle, standing on the scale. Reading is not producing,
and the first draft conflated them. Corrected in `probe.js`, the README and the entry.

**Structural questions are the agent's now** — owner, this session: *"I'd like it if you could take
a lot of these structural questions."* Written into CLAUDE.md as a standing narrowing of the
decisions section. Architecture, tooling, process, layout, naming, how to test something: decide,
state the call in one line, continue. What stays theirs is short — data destruction, money, auth
and secrets, scoring calibration, and genuine product preference. **A delegated call still gets
written down**, with its reason and its reversal cost: the trade is *being asked* for *being able
to read it later*, and the second half is what makes the first safe.

## The testing order, decided rather than asked

Acting on that rule immediately. **Not by group size — by how unambiguous the answer is.** A check
whose result is a number or a boolean is worth ten whose result is an opinion.

1. **Prove the pipe** (`probe.js`, once) — the only step needing the owner.
2. **Try `connectOverCDP` before writing any bespoke check.** If it attaches, the ~100 existing
   `e2e/**` specs run against the real device on a config change alone. That is a multiplier no
   hand-written check matches, and it is the highest-leverage unknown in the plan.
3. **Offline-first reads** — binary, mechanical, and never exercised anywhere.
4. **Safe-area clearance as one sweep**, not N checks: walk every bottom-anchored action row and
   assert computed padding ≥ the measured inset.
5. **Devices and the admin console** (17), reachable for the reason corrected above.
6. **`motion-polish` via `record.js`** — measurable rather than judged.
7. **Look-and-feel stays the owner's.** Automation is the weakest evidence for exactly those.

Writing this onto OR-127 rather than into `docs/superpowers/plans/` is itself a structural call: a
seven-line order of attack for tooling that already exists is not a plan document, and putting it
where the tool is described keeps it from going stale separately.

## A finding filed and retracted the same day

A DevTools screencast showed the address bar reading `/more` above a rendered Home screen — LA-109's
recorded symptom word for word, on a fix that shipped 2026-09-15 with its device check owed. It was
filed as an observation within minutes.

**The owner then reported that the bar never updates for them at all; it is stuck at whatever it
held when DevTools attached.** So it says nothing about the app's route, and the observation was
retracted the same day.

**The mechanism is worth more than the false alarm.** DevTools updates its address bar on
`Page.frameNavigated`. This app's tab flips are `history.replaceState`, which fires no such event —
so on a Capacitor WebView doing client-side routing the bar is *expected* to go stale, and is never
a reliable read. **A shipped fix was nearly recorded as failing on device on the strength of a
stale widget.** `probe.js` and `tour.js` both read `location.pathname` in the page, and the rule is
now in the runbook and the module map: never read the route from an inspector's address bar.

## How a remote session reviews the running app

The owner asked what, short of pasting screenshots by hand, would let a session review live pages.
Decided rather than asked, per the standing rule: **the channel is git.** `tour.js` walks a set of
screens and writes a folder; it is committed to a throwaway `device-captures/<date>` branch and
pushed; the reviewing session pulls and reads it, then the branch is deleted. It never merges —
this puts images in a repository, accepted only because it is bounded and auditable.

**The digest is the part that matters, not the image.** Each screen carries a DOM summary taken in
the page: the real route, the active tab, visible error text, the button count, whether the page
scrolls horizontally, and the lowest action row's computed bottom padding against the measured
safe-area inset. **A remote reviewer pays for every image and reads text for free**, and most
"is this working" questions fall out of the digest alone.

Rejected: hand-pasted screenshots (works, does not scale, and is what prompted the question), and a
live view (impossible — the reviewing session is a container with no path to a USB device).

## Worth carrying

**The harness ships unrun, and says so everywhere it can be read.** No sandbox in this project has
`adb` or a phone, so every line was reasoned from the protocol rather than observed — including the
claim that it connects. OR-127 carries a `Keep:` naming that first run as the outstanding work, and
both source files carry the warning in their headers. This is the opposite of the usual failure
mode here, which is a fix documented from intent; the point is that "written carefully" is not
"observed working", and the distinction has to survive into the next session that reads it.

**Automatable is not the same as owed.** These are behavioural checks — did the row disappear, did
back land on Home, is the computed padding above the gesture bar. A large share of the 104 device
checks in the backlog are look-and-feel, where an automated pass is the weakest possible evidence.
The honest expectation is that this clears the unambiguous ones and leaves a shorter, harder list.

## Not done

- **Never run.** That is OR-127's `Keep:`.
- **No check suite** — one probe, not a sweep. What the second check should be is a question for
  after the first run, and it may be "point the e2e suite at it" rather than anything bespoke.
- **The device-verification gate is unchanged.** No Known-Issues row may cite this as a substitute;
  it narrows what the gate has to cover, it does not retire it.

<a id="2026-09-22-docs-colmi-handover-reconcile"></a>

# 2026-09-22 — the Colmi after handover: what was verified, what was filed, what went stale

**Branch:** `docs/colmi-handover-reconcile` · docs only, no code

The ring went to a second wearer. This session checked whether the pipeline actually works for
someone who is not the owner, and reconciled the durable docs against what the check found.

## Verified, so a Known Issue moved to the archive

**PS-21 Stage A has now run on a device, in production.** The row asking for that check was written
around `decodedBy`, which is a response field and therefore invisible once the sync is over. The
stronger evidence turned out to be the ordering column: `colmi_raw_frames` holds **200 rows with
`seq > 0`, max 157**, and `seq` is written only by the route that shipped with migration 263. A
WebView holding an older bundle cannot produce it. Moved to `known-issues-resolved.md`.

**A second user's data is landing.** `pg_stat_user_tables` counts the whole database rather than one
user, and it records **37 readings and 23 frames inserted since 8 September** while the owner wrote
**zero** over the same window. The mechanism was then proved directly: a brand-new user with no rows,
posting real archived frames as bytes only, got `decodedBy: "server"` and **119 readings stored on
their own id and nothing else's**.

## Amended rather than struck, because the check cannot be run

**Colmi auto-sync is still not device-verified, and now says why.** 16 syncs over 3–8 September at a
scatter of hours no one presses by hand, three of them evening — consistent with the timer working,
and not proof. Nothing distinguishes an automatic sync from a pressed one once it arrives:
`attemptAutoSync` records its last run in `localStorage` and the ingest route stores no trigger. The
row now names the cheapest fix (a `trigger` field on the ingest body) instead of waiting on an
observation that cannot be made.

Striking it on the sync scatter would have been the easy call and would have recorded an inference as
a fact.

## Filed: PS-47, the battery

Unfiled until now, and it cost two days of the baseline week. The stored series gives **~19
points/day, about five days from full**; the ring hit **1% on 4 Sept** and returned **no sensor data
at all between 5 Sept 19:35 and 7 Sept**. A flat ring presents exactly like a broken one — same
`reason: 'silent'`, same copy — which is the part a second wearer would misread. Also records an
unexplained **40 hours pinned at exactly 70%**.

## Went stale: PS-16's gate

`Gate: device` read as "the owner has not got round to it". The ring is no longer with the owner, so
the counted walk is blocked on whoever holds it. PS-15's steps half waits behind it via `Needs:`.

## Not done

No code. The Colmi still has **no native layer** — the manifest declares foreground services and
boot receivers for Oura, Polar and Scale, and `grep -rli colmi android/` returns nothing — so it
syncs only while the app is open, unlike the Oura. That is PS-21 Stages B and C, and it needs an APK.

<a id="2026-09-22-fix-rv84-rv88-error-state-onerror"></a>

# RV-84 + RV-88 — error states that could never fire

**Branch:** `fix/rv84-rv88-error-state-onerror` · **Lane B** · batch `error-state-onerror` · no version bump

## The rule

`cachedFetchCore` wraps its whole network section in `try/catch/finally` and resolves a **boolean**:
a `!res.ok` returns after calling `onError`, a network throw is caught. **The promise cannot
reject.** So `.catch(() => setFailed(true))` chained onto `cachedFetch` is dead code and the state
is never set. `onError` is the only channel that fires.

## RV-84's count was wrong three ways, and the real shape is narrower

The entry said **16 sites**. Measured with balanced-paren matching rather than a grep — two naive
greps disagreed at 8 and 59, which is what prompted counting properly:

| | count |
|---|---:|
| chained `.catch` on `cachedFetch`/`cachedFetchToday` | **81** |
| `.catch(() => {})` — dead but harmless | 68 |
| redundant — `onError` already wired beside it | 4 |
| **broken — a handler, no `onError`** | **9** |

The four "redundant" include `health/oura-section.tsx`, which the entry names as **its own
reference for the correct pattern** — it has `onError` wired and a belt-and-braces `.catch` beside
it. So a site is only broken when it has a handler *and* no `onError`, which is the distinction the
entry's count missed.

Both consequences the entry confirmed — the Coach picker stuck on *"Loading your options…"* and the
Profile achievements grid spinning — are in the nine. Its diagnosis was right; only its arithmetic
was not.

**The nine, all moved to `onError`:** `week-day-sheet`, `coach/choice-list`,
`fitness-tests/latest-baseline-card`, `more/details/performance-overview-section`,
`more/profile-tab`, `nutrition/my-meals-picker`, `nutrition/recent-foods-panel`,
`nutrition/reta/weight-response-card`, `workout/exercise-stats-sheet`.

**The 68 no-ops are deliberately left.** A `.catch(() => {})` satisfies a floating-promise lint and
hides nothing. Sweeping them would be 68 files of churn for no behaviour change; they are frozen
shrink-only instead, because a *new* one is a fair signal that somebody still believes this promise
can reject.

## RV-88

**Cardio Trends** rendered `!data ? <pulsing block>` with no `onError`, so a 429 left a grey
skeleton that never resolved under three tab buttons that changed nothing. **Time in Zone** took its
*empty* branch and printed *"wear the ring or strap during a workout"* — blaming the owner for a
server failure on a day he had worn it. Both now distinguish failure from empty.

## RV-88's second defect is not one, in this file

The entry flags `const profile = data?.profile ?? { maxHr: 190, restingHr: 60 }` as an invented
number shown as fact. **Checked, and it does not reach the screen here.** `computeHrZones` takes
`id`, `name` and `color` straight from the fixed `ZONE_DEFS`; only `minBpm`/`maxBpm` vary with the
profile. This card renders `z.id`, `z.name` and `z.color` in its legend and takes the minutes
themselves from the server's `data.days`, so the fabricated 190/60 changes nothing visible.

A first pass at "fixing" it produced `data ? (data.profile ?? d) : d` — **identical to the original**
and carrying a comment claiming a fix. That is the shape the repo's own rule warns about, so it was
reverted and the reasoning written next to the line instead, to stop the next sweep re-filing it.
**The entry's reasoning is right in general** — it would be a real defect in any card that prints a
zone's bpm range.

## Testing

`rv84-catch-on-cachedfetch-is-dead.test.ts`, structural for the same reason RV-64's was: no React
render harness, and the property is "which call may do this". Two assertions, both mutation-checked
— reverting one site to `.catch` fails the first by name and file; adding a new `.catch(() => {})`
fails the frozen count at 69 against 68.

## Not exercised

**No device pass**, and no e2e for the two RV-88 cards. One was written for Time in Zone against the
established 429-routing idiom in `card-429-error-state.spec.ts` and **removed rather than
weakened**: the card is a configurable Health section and is not in the seeded user's saved set, so
the anchor never appeared. Reaching it needs a section-preference fixture like `enableHomeCards`,
which does not exist yet. The other seven cases in that file still pass.

So the nine fixes are covered structurally and by type, not by a rendered failure. What a failed
fetch *looks like* on each of those nine surfaces is unverified.

## No version bump

Error states that could never fire now can. Nothing else about what the app shows has changed.

<a id="2026-09-22-lane-a-la128-strict-checkin-body"></a>

# 2026-09-22 — a dropped key is now a 400 that names it, and the outbox deliberately stays lenient

**Branch:** `lane-a/la128-strict-checkin-body` · **Agent:** Implementation (Lane A) ·
**Code + docs.** No user-visible change, so no version bump.

`POST /api/day-checkin` built its `Body` with `.extend()` and never called `.strict()`, so Zod
dropped a key it did not know instead of refusing the body: a sheet posting a field whose server
half had not landed got **201 and wrote nothing**. LB-124 was filed rather than attempted over
exactly this — it would have burned TN-58's two-week pass test and reported "no self-report
available" when the truth was a dropped field.

## The entry's open question, answered before touching anything

It said plainly: *"Not established: whether any current client actually sends an unknown key. Nobody
looked — the shape was found by reading the schema, not from a failure. Start there: it decides
whether this is a one-line change or a three-file one."*

Checked key by key. **No current client sends one.** The morning sheet sends 13 keys, the evening
review 9, all known. The three "retired scales" look like the obvious landmine and are not:
`motivation`, `restingSoreness` and `wakeMood` are retired from the UI but still in
`DayCheckinScalesSchema`, and the sheet sends them as null on purpose so a re-save clears a
historical value. So: one line, and the entry's blast-radius warning does not materialise.

## The outbox is the opposite of what the entry assumed

The entry treats `pushMutations` as the **risk** of stricting — *"on the outbox path that is a
no-retry poison pill"*. Measured, the outbox never touches the route's `Body` at all. It is
`lib/data/postgres/adapter.ts`, which `safeParse`s `DayCheckinScalesSchema` and
`DayCheckinExtrasSchema` **separately and non-strictly**, then calls `saveDayCheckin` with a
hand-written field list. An unknown key there is dropped by the explicit mapping — the same silence,
on the path the device actually uses, since the POST only fires when the local write fails.

So my first instinct was to strict both. **That is wrong, and the reason is worth keeping.** An
outbox item is rejected per-item and never retried, so a strict failure there does not surface a
mistake — it deletes a check-in the user already wrote, turning a partial save into no save. Worse
on a queue that may hold an older payload shape from before an app update.

And the asymmetry is justified rather than merely tolerable: the outbox path is **already gated**.
A new field must pass `store.upsertDayCheckin` and the local SQLite column list before it can reach
the server, which is why LB-124 needed a local migration. It cannot arrive unnoticed the way a POST
body can. The route has no such gate, which is why the route is the half that needed `.strict()`.
That reasoning is written into `adapter.ts` beside the lenient parse, because the next reader will
see the mismatch and want to "fix" it.

Stricting either shared schema on its own would also reject everything outright: each is parsed
against the whole payload, so the scales schema sees `journal`/`soreMuscles`/`phase` and the extras
schema sees the ten scales. The entry's fear was real, just attached to the wrong change.

## The 400 names the key

`Invalid body` alone sends the developer looking at the values they sent rather than the key they
added. Zod 4 reports `unrecognized_keys` with the names, so the response is
`Unknown field(s): moodAfterCoffee`. A value failure still reads `Invalid body`, and there is a case
pinning that the strict branch did not swallow the ordinary validation errors.

## Verification

- 7 route tests, including both live client payloads copied verbatim — so if someone adds a field to
  a sheet without the server half, these go red rather than the field vanishing.
- **4 mutations caught, 1 equivalent control** (reordering the two `.extend()` lines — correctly not
  caught).
- **Driven over HTTP against `pnpm dev`** with a real session, which is the part the unit tests
  cannot prove:

| probe | result |
|---|---|
| unknown key | **400** `Unknown field(s): moodAfterCoffee` |
| two unknown keys | **400** `Unknown field(s): alpha, beta` |
| bad *value*, not key | **400** `Invalid body` |
| morning sheet payload verbatim | **201** |
| evening review payload verbatim | **201** |
| `phase` omitted | **201**, defaulted to `evening` |
| empty body | **400** `Check-in carries no answers` (Q-465 intact) |

- **The defect was observed, not just asserted.** With `.strict()` removed the same unknown-key body
  returned **201** and the row came back with the key absent. (`perceivedRecovery` also read null
  there, which is *not* a bug — I omitted its `touched` flag, so TN-57's guard correctly refused to
  store a seeded value as a self-report.)
- `pnpm check:rules` **75 of 75** · `tsc --noEmit` clean · full suite **9,326 passed, 87 skipped**.

**Not exercised:** the outbox path itself was read, not run — no queued mutation was pushed through
`pushMutations` in this session, because nothing in the diff changes its behaviour. Nothing was
verified on device.

<a id="2026-09-22-lane-a-lb124-vs-yesterday-column"></a>

# 2026-09-22 — Lane A · LB-124: the column TN-58's control writes to

TN-58 asks *"is today better or worse than yesterday?"* instead of an absolute 1–5, because the
absolute scale produced **two distinct values in 81 days**. Lane B took it off READY, found the
field did not exist anywhere, and filed this rather than attempting it. The reason that mattered:
`Body` in `app/api/day-checkin/route.ts` is not `.strict()`, so Zod **strips** an unknown key rather
than rejecting it — a sheet posting `vsYesterday` would have got **201 and written nothing**. A
control that looks like it works and stores nothing would have burned TN-58's two-week pass test and
reported "no self-report available from this owner" when the truth was a dropped field.

## What shipped

`day_checkins.vs_yesterday text`, nullable, **no default** — migration **280**, `claude_ro` twin
**281**, local SQLite **v40**. Carried end to end: the Drizzle schema, the shared `DayCheckin` type,
the Zod schema, the route, `saveDayCheckin`'s insert and its `ON CONFLICT` set, **all three** row
mappers, `pushMutations`, the local table (CREATE body + ALTER + `RECONCILE_COLUMNS`), the local
upsert, the local read, and the pull-delta.

## The type choice, which the entry left to build time

Text enum, not a signed integer. Both were open and the entry named the trade (*"the integer is
easier for TN-33 to correlate and the enum is harder to misread"*). **This table decides it:** every
other scale here stores **1 = best … 5 = worst**, a direction the codebase has to keep restating —
`build-day-audit.ts` carries *"Stored 1 = slept great … 5 = terrible (the on-screen selector
reverses this)"*. A `-1/0/+1` column where +1 means BETTER puts the opposite polarity in the same
row as those, which is the misreading LB-124 warns about. `illness_context` already stores a text
enum on this table, so this follows a shape proven here rather than adding a second convention.
TN-33 gets its number from one shared mapping at read time, not from the storage.

## NULL is the point, so there is no default

The bug TN-57 fixed *this morning* is a neutral value stored as though it were an answer. A default
here would recreate it on the very question meant to escape it. This control needs no `*_touched`
twin either, and that is a property of the question rather than an omission: unlike a slider seeded
at the midpoint, there is no position to accept by leaving it alone — not answering is simply
absence.

## Two things the compiler found that no test would have

1. **`app/api/food-logging-complete/route.ts` re-saves the evening row** to flip one flag, and
   `saveDayCheckin` overwrites every column it is given a value for. A route that omitted
   `vsYesterday` would have **cleared the answer every time the food log was marked complete** —
   silently, and only on days the lifter had answered. Making `DayCheckin.vsYesterday` required
   rather than optional is what surfaced it; there is now a test.
2. **Three row mappers, not two.** `getDayCheckin`, `listDayCheckins` and `saveDayCheckin`'s own
   return. An assertion on the count caught the third.

## The claude_ro twin, and the trap in generating it

The generator reads the **live database**, not the migration files. Running it before applying 280
locally produced a file byte-identical to 279's body — the column did not exist yet, so it could not
be listed, and the "regenerate the twin" step silently produced a no-op that would have shipped.
**Apply the column migration first, then generate, then diff.** Done in that order the file differs
from 279 by exactly one line, `t.vs_yesterday`, and the owner's id does not appear (Q-456).

`claude-ro-readonly-role.test.ts` and `db-snapshot-integration.test.ts` were run over the **TCP**
URL, as the rule requires: **2 files, 27 tests, all passed, none skipped.** On the socket URL that
`scripts/local-db/setup.sh` writes they skip and say nothing.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. It caught the live-pointer table still reading migration
  280 / SQLite v39.
- Full suite — **9,366 tests / 990 files**, green. `check-test-typecheck` none above baseline after
  a fixture gained the field.
- **Mutation pass: 6 caught, 2 equivalent controls passed.** The caught ones: dropping
  `vsYesterday` from `dayCheckinHasAnswers` (a check-in whose only answer is this one would 400),
  from the adapter insert, from `pushMutations` (web/outbox divergence), from
  `food-logging-complete` (the erase trap), removing the v40 ALTER (fresh installs fine, every
  upgraded device broken), and dropping one placeholder from the local upsert — which
  `insert-arity.test.ts` catches, and which is otherwise an on-device-only runtime error.
  **One intended control was not equivalent and that is worth recording:** adding whitespace inside
  the ALTER string failed, because the sibling assertions in `migrations.test.ts` match the DDL text
  exactly. The convention is stricter than it looks.
- **`pnpm dev` against the local database.** `vsYesterday: "worse"` POSTed and read back as `'worse'`
  through the GET mapper; a skipped day stored and read back **NULL**; `"much better"` answered
  **400** rather than being stripped to a silent 201; and the value was visible through
  `claude_ro.day_checkins`, which is what the twin exists for.

## Not exercised

The local SQLite path is **not executed anywhere** — `getLocalStore` returns null off the APK, so no
test in this sandbox can run those statements. That is exactly why `insert-arity.test.ts` is a
source-text check, and it is the guard that covers the change here. The v40 upgrade itself lands on
the device at next launch and has not been observed there.

## Deliberately not done

`Body` is still not `.strict()`. Making it strict would fix the silent-strip hazard for the *next*
field as well, but it would also start rejecting bodies that currently succeed with extra keys, and
that is a behaviour change well outside this entry. Filed as a note here rather than smuggled in:
**the hazard is closed for `vsYesterday` because the key is now known, not because the shape
changed.**

<a id="2026-09-22-lane-a-lb125-date-display-styles"></a>

# 2026-09-22 — the comment that got quoted as evidence, and the two counts under it

**Branch:** `lane-a/lb125-date-display-comment-and-weekday` · **Agent:** Implementation (Lane A) ·
**Code + docs.** No user-visible change, so no version bump.

LB-125 exists because RV-91 read `formatDateDisplay`'s header comment and reported its strings as
what a screen rendered. The entry's instruction was to correct the comment and add a `weekday`
style. Both done — and since the entry's own premise is "somebody quoted this instead of running
it", I ran everything, which turned up three more things.

## The comment was wrong, and so was its neighbour

Measured on node 22 with full ICU, resolved locale `en-AU`:

| | claimed | actual |
|---|---|---|
| `formatDateDisplay(_, 'short')` | `Jan 5` | `15 Sept` |
| `formatDateDisplay(_, 'long')` | `Monday, 5 January` | `Tuesday 15 September` |
| `formatDayShort('2026-07-06')` | `Jul 6` | `6 July` |

**The third row is not in the entry.** `formatDayShort` sits directly below, carries a
byte-identical copy of the `'short'` option bag, and its docstring made the same two errors against
its own example date. Fixing one comment and leaving the other is the half-done sibling sweep this
repo keeps relearning, so it is folded in — and rather than correct a duplicate implementation,
`formatDayShort` is now a named alias that delegates. That is the entry's own subject: a
hand-rolled option bag sitting beside the shared formatter, in the shared file itself.

## Why the strings are wrong in a way that is hard to guess

Three properties of `en-AU`, each pinned in a test:

- **Day-first.** The month never leads, so `Jan 5` was never reachable.
- **`month: 'short'` is not a uniform three-letter abbreviation.** Across twelve:
  `Jan | Feb | Mar | Apr | May | June | July | Aug | Sept | Oct | Nov | Dec`. June, July and Sept
  are four characters — so a column of these labels is ragged-width, which is worth knowing before
  putting one in a `tabular-nums` layout.
- **It emits a comma after a SHORT weekday and none after a long one.** `Tue, 15 Sept` but
  `Tuesday 15 Sept`. This is almost certainly where `Monday, 5 January` came from: the comma is
  real, just not on the style the comment attached it to.

## The open question, answered from the call sites rather than left open

The entry asked whether a `weekday` style should thread `DEFAULT_TZ` like the other date helpers or
stay device-local. **Device-local, and adding a `timeZone` would be actively wrong here.** Every
call site passes a date *string* — a calendar day already resolved in the user's timezone by
whoever produced it — not an instant, so there is nothing left to convert. Re-rendering the
component-wise local `Date` under an explicit zone would reintroduce Q-130 rather than prevent it:
on a device ahead of that zone, local midnight falls on the previous day there. Written into the
function's header so the next reader does not re-open it.

## Two corrections handed to Lane B

LB-126 owns the call sites and inherited LB-125's counts, which do not survive measurement:

- **Two sites are a bare `{ weekday: 'short' }`, not three.** The two the entry filed as
  unrelated one-offs are the same shape at different weekday widths, and each now has a style.
- **`calendar-widget.tsx:109` is not convertible at all.** It is a `{ month: 'long', year:
  'numeric' }` month-and-year label built from `(viewYear, viewMonth)` numbers;
  `formatDateDisplay` takes a `YYYY-MM-DD` string and renders a day. Routing it would mean
  inventing a day-of-month to discard. So LB-126 is four sites, not five, and its entry now says
  so rather than leaving Lane B to discover it mid-PR.

## Verification

- 5 new test cases, all styles pinned to exact strings. Suite: **9,319 passed, 87 skipped**.
- Re-run under `TZ=America/New_York`, `Pacific/Auckland` and `Australia/Brisbane` — 48/48 in each.
  The Q-130 guard only bites west of UTC, so a UTC-only run proves nothing about it.
- **4 mutations caught, 1 equivalent control** (reordering keys in the options record — correctly
  not caught). The Q-130 mutation, parsing as UTC instead of component-wise, fails 4 cases under
  New York and none under UTC, which is the point of running it there.
- `pnpm check:rules` **75 of 75**; `tsc --noEmit` clean; test-typecheck none above baseline.

**No user-visible change ships here.** The delegation newly accepts slash-separated input and
passes a non-date through, and no current caller does either; the new styles have no call site
until LB-126. Nothing was verified on device, and nothing in this diff reaches one.

<a id="2026-09-22-lane-a-rv105-fetch-once-stable-deps"></a>

# 2026-09-22 — the fetch-once ratchet could only see an empty dep array; now it sees the shell-stable ones

**Branch:** `lane-a/rv105-fetch-once-stable-deps` · **Agent:** Implementation (Lane A) ·
**Code + docs.** Tooling only — no app behaviour changes, so no version bump.

`check-fetch-once-effects.js` gated on `}, [])` and nothing else. Its comment gave the reason:
*"a non-empty one re-runs when its deps change, which is a different (and usually correct) shape."*
True in general, false inside the persistent tab shell, where `[userId]`, `[tz]` and `[today]` never
change either — so those effects re-run never, and the component holds its first payload until the
app is killed. That is the Q-402 shape this ratchet exists to catch.

**⛔ The entry says "four of the five freshness findings are that shape". Two are.** Checked after
the fact, prompted by a Review Agent note that listed a different four: **RV-106**
(`hr-day-card.tsx:39`, `[today]`) and **RV-109** (`activity-history-card.tsx:72`, `[userId]`) are
this shape and the widened check does find both. **RV-104 and RV-107 are not, and cannot be**
without undoing an earlier correction — both are `nutrition-content.tsx:318`,
`useEffect(() => { fetchMountData(); }, [fetchMountData, userId])`, where the fetches live in a
`useCallback` and the effect body contains no `cachedFetch` at all. That is the exact shape the
script's header records as deliberately excluded: counting it is what inflated the baseline by 11 of
25 in the first version, and `health-content.tsx` carried a baseline of 2 with no fetch-once effect
in it. So the widening is worth doing for two real findings, not four — and the number mattered
enough to check, because "four of five" is the entry's whole argument for urgency.

## The entry's open question, answered with a scan

It said the four were *"found by hand, not by a candidate scan"* and that the number of new sites was
not established. Scanned, reusing the script's own brace-matching so the counts are comparable:

| dep shape | count |
|---|---:|
| `[]` — what the check saw | **11** |
| stable-only (`userId`, `tz`, `today`) | **+14** |
| any other dep — still invisible, correctly | 40 |

Widening **more than doubles** the tracked population, 11 → 25 across 20 files. That is the fact
that reframes this as a re-baseline rather than a one-line tweak, and it is why the baseline block
carries the new sites grouped by what they are instead of appended as a flat list.

## Where the entry contradicts itself, and which half is right

Its diagnosis names `[userId]`, `[today]` **and `[trendsProp]`** as deps that never change. Its
*Fix, narrowly* lists only `userId`, `tz`, `today` — no `trendsProp`. Three sites turn on it.

**The narrow list is right.** `trendsProp` is a prop the parent resolves from `undefined` to a value,
so it genuinely changes — `oura-section.tsx` carries a second effect whose entire job is to adopt it
when it lands, and the fetch-once effect guards on `trendsProp !== undefined`. Counting it would
flag three sites that are already handling the change correctly. It is excluded, with the reason in
the code rather than only here.

## What this change does NOT do

**It widened the lens; it did not audit what the lens revealed.** All 14 predate it, so none is a
regression, and every one went into the baseline rather than being converted. Two groups are called
out in that block rather than left to look uniform:

- **`sync-provider.tsx` is 4, and is deliberate** — the warm pass the header already describes as a
  sanctioned exception. It was recorded as *one* site in the 2026-08-19 correction, which was
  looking only at `[]` deps and could not see these. Converting them would add refetches with no
  reader waiting.
- **`workout-screen` still needs judging by where it MOUNTS.** It is not one of the five tab
  screens, so it plausibly unmounts — and "plausibly" is precisely the reasoning that group has
  been got wrong three times.

**Two of the fourteen are already gone, and that is the check working.** `hr-day-card` and
`activity-history-card` went into the baseline here; Lane B converted both in #1422 while this
branch sat open, and on the first run after merging `main` the shrink-only rule **failed the check**
and demanded their rows be deleted. Both were `[today]`/`[userId]` deps — invisible to the
`[]`-only gate, which is why RV-106 and RV-109 had to be found by hand. The baseline is now 23
across 18 files rather than 25 across 20.

RV-104, RV-106, RV-107 and RV-109 have all since shipped (#1416, #1422), so the four findings that
motivated this entry are fixed. The gate's value from here is the next one, not those.

## Verification

- **Mutation-checked in both directions**, as the file's header records was done for the brace
  matching: a new site with `[userId]`, with `[]`, and with `[userId, tz]` each fail the check; a
  site with `[date]` (the `week-day-sheet.tsx` counter-example the entry names), one with
  `[trendsProp]`, and one with stable deps but no `cachedFetch` each pass. Six cases, all as
  intended.
- The empty-array case is a **special case** of the new test rather than a branch beside it
  (`[].every(...)` is true), so the original behaviour cannot drift away from it.
- `pnpm check:rules` **75 of 75** · `check-comment-blindness` 11 passed (it carries a fixture for
  this check) · the check itself reports **25 known across 20 files, none new**.

**Not exercised:** no app code changed, so nothing was run on `pnpm dev` or on device. The regex
window grew from 30 to 200 characters to fit a dep list; a dep array containing a nested `]` still
fails to parse and is skipped, which errs toward under-counting rather than over — the safe
direction, and the same one the 2026-08-19 correction was cleaning up after.

<a id="2026-09-22-lane-a-rv69-rv70-ai-degrade-and-bound"></a>

# 2026-09-22 — Lane A · RV-69 + RV-70: AI calls are bounded, and prose routes degrade to their own facts

Batch `ai-degrade-and-bound`, one PR, both `platform`.

## What shipped

**RV-69 — four prose routes answered an error while holding the answer.** `daily-digest`,
`weekly-digest`, `ai/health-insight` and the workout recap each assemble a complete fact block from
the user's own logs *before* calling the model; the model only writes the sentences about it. On the
catch path all four discarded it — 502 for the three digests, 500 for the recap. They now return the
facts with `degraded: true` and status 200, which is what `running-plan/explain` has always done.
`lib/ai/degrade.ts` holds the one helper.

**RV-70 — no AI call carried a wall-clock ceiling.** Every route passes `maxRetries: 0`, which takes
the SDK's own timeout handling out of the picture, and nothing replaced it. `lib/ai/deadline.ts`
applies one at the chokepoint, so every call site is bounded without opting in.

## Four things the entries got wrong, found by re-verifying before writing code

1. **"The fix is one place, since every call routes through `lib/ai/instrument.ts`" (RV-70).** The
   chokepoint wraps a *thunk*, not the SDK's params — it could not inject `abortSignal` into
   anything. The thunk now takes the signal (`AiCall<T> = (signal) => Promise<T>`) and all 17 call
   sites pass it through. A zero-argument thunk still satisfies that type, so wiring alone would be
   a silent guarantee; `runWithDeadline` also **races** the attempt, which is what makes the bound
   hold for a call site that ignores the signal — including one added later.
2. **"Sized per section" (RV-70).** Not supported by the data. Measured over the owner's
   `ai_call_log`, the slowest call of *any* section ever recorded is **4,786 ms** and every section's
   p95 is under 4 s; the spread between the fastest and slowest section is an order of magnitude
   under any ceiling worth setting. One budget, **30 s**, ~6× the worst on record.
3. **"`recap/route.ts:236` answers 502" (RV-69).** It answers **500**, from a catch covering the
   whole handler — the session lookup, three repo reads and `buildRecapFacts` as well. Degrading
   there would have answered 200 with a recap for a request that never built one, including the
   malformed-id case (22P02) behind Q-483. That route got its own catch, scoped to the model call,
   and the outer one still answers 500. `lib/__tests__/recap-route-degrade.test.ts` pins both halves.
4. **"Every route passes `maxRetries: 0`" (RV-70).** All but one: `running-plan/explain` did not, so
   the SDK's own default retries were multiplying with the shared one-retry policy rather than
   deferring to it — the exact doubling the entry was written about, in the route it held up as the
   reference. Fixed in the same change.

## The entry's own open question, answered

RV-69 flagged *"not established: how each client renders a 502 — it may already show a tolerable
empty state"*. Checked: all four do. So this was never a broken-looking UI; it was a card saying
nothing where it could have said the user's figures. **The answer changed the shape of the fix** —
the clients cache, which the entry did not account for:

- `done-screen.tsx` reads the recap through `cachedFetch` at `WORKOUT_RECAP_TTL` (24h) and the only
  retry the card offers is a refetch;
- `ai-insight-card.tsx` `setCached`s the insight for 6h;
- `weekly-recap-banner.tsx` writes the digest to `localStorage` keyed on the week and returns early
  on a hit.

A degraded 200 into any of those is **stickier than the failure it replaces**. So nothing degraded is
stored: the routes skip `upsertAiHealthInsight`, and each client is guarded on `degraded`.
`cachedFetch` gained a `shouldCache` predicate for the one that caches through it — a response can be
worth painting and not worth keeping.

## What only the dev server found

The helper's parameter was a bare noun (`'the day'`, `'the readings'`) and the lead read *"so here
is …"*. Against a running server the heart-rate section answered **"here is the readings as
recorded"** — the one subject that is plural. Every test passed, because each asserted the fact lines
and the "could not be generated" clause, and none read the joint. The parameter is the whole clause
now (`'here are the readings as recorded'`), and there is a test for it.

That is the entire argument for the pre-merge dev-server pass: it was not a logic bug, so nothing
that checks logic could see it.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, all passed.
- Full suite — **9,304 tests, 976 files**, green. It caught what targeted runs could not:
  `lib/__tests__/weekly-digest-window.test.ts` pinned `expect(502)`. Its real property is *the error
  text must not reach the body* (the `[ERROR]: ${error}` leak); that assertion is kept and
  strengthened, since a degraded answer is a wider body than a bare error.
- `node scripts/check-test-typecheck.js` — none above baseline.
- **`pnpm dev` against the local database, both paths, all four routes.** With the real key: real
  prose from `daily-digest`, `weekly-digest`, `ai/health-insight` and the recap, no `degraded` flag,
  and a `generateObject` site (`exercises/generate`) confirming the threaded `abortSignal` does not
  disturb the SDK's object path. With a deliberately invalid key: all four answered **200 with their
  own figures and `degraded: true`** — e.g. the recap returned *"Duration: 55 min · Total volume:
  1440 kg · New personal records: 1"*. `ai_health_insights` was read afterwards and holds **only the
  real answer**; not one degraded run wrote a row. The recap's non-model failures are unchanged: 400
  on a malformed id, 404 on an unknown one, and `Cache-Control: private, no-store` on the degraded
  response.
- **Mutation pass: 11 mutations, all caught; 2 deliberately equivalent controls, both passed**
  (`>=`→`>` in the deadline comparison; budget 30s→28s). The mutations that bit include per-attempt
  instead of total budget, dropping the retry's deadline skip, dropping the race, persisting the
  degraded value at each of two routes, dropping `shouldCache`, degrading from the full prompt rather
  than the measured lines, and degrading from the context including same-day AI prose.

## Not exercised

Sandbox only. Not run on the device: nothing here is native, offline-first, safe-area or gesture
work — it is server behaviour plus three client cache guards, all reachable in the WebView through a
normal Railway deploy with no APK. **The degraded path itself has not been seen in production**,
because the model has not failed since the logging existed; it is exercised by tests at all four
routes and by the helper's own unit tests.

## Deliberately not done

`ai-periodization/session/[id]/prescribe` has the same catch-path shape and is **not** changed. It
degrades to a *prescription the user trains on*, not to text, and its backlog entry already carries
the larger question of whether the model belongs on that blocking path at all. A cross-reference was
added there.

Streaming calls (`loggedStreamText` — Coach, session-explain) are **not** bounded. Aborting a stream
mid-answer is a user-visible truncation, and a stream sends bytes as they arrive, so a stalled one is
visible in a way a stalled await is not. Worth revisiting if a stall is ever observed.

<a id="2026-09-22-lane-a-rv85-report-exhausted-fetch"></a>

# 2026-09-22 — Lane A · RV-85: the helper that prevented a blank widget could not say it had failed

## The defect

`{readiness && <OuraScoreChipRow …>}` gates Home's whole score row, and with it the illness advisory
and the early-deload banner. On a failed fetch there was **no row, no skeleton and no message** —
`showHomeSkeleton` requires `refreshing`, so a persistent failure rendered nothing at all on the
owner's most-used screen (22 of 56 resumes in the telemetry window).

`/api/readiness-score` has no null-payload path — it answers a payload or an error status —
re-verified against `main`. So an absent value there is always a failure, never "nothing to say".
This was a failure-vanish, not a hide.

**And the helper meant to prevent it is the one that permitted it.**
`packages/shared/src/fetch-with-retry.ts` says in its own header that it exists because a blip
*"silently yields nothing and never retries, leaving the readiness/sleep widgets blank until the app
is restarted"*. It retries three times (2.5s/5s/7.5s) and then returns `void` with a
`.catch(() => {})` — fixing the transient case and quietly accepting the persistent one, landing on
exactly the blank widget it was written to prevent.

## What shipped

An `onExhausted` channel on `fetchWithRetry`, and a one-line *"Scores didn't load — pull to
refresh."* in the row's slot. The retry ladder is unchanged: same three retries, same delays.

**The distinction is the whole feature.** An absent value means "still trying" until the attempts
are spent and only then means "failed", so the message cannot appear under a request that is about
to succeed. It is cleared on every refresh, so pulling to refresh retries and the message goes away
rather than sticking.

## What the entry left open, and what checking it changed

- **The `.catch(() => {})` it flags as "RV-84's dead shape" is load-bearing here and was kept.**
  Without it the chained `.finally` returns a rejected promise and the failure becomes an unhandled
  rejection. RV-84's finding is about sites that swallow an error *beside a wired `onError`*; this
  one has no `onError` to reach, because `fetchWithRetry`'s `fetchFn` parameter is four positional
  arguments with no options bag. Passing one through would be a wider change than this entry, and
  `onExhausted` covers the user-visible need either way.
- **The line numbers had drifted** — `:1128` is now the early-deload card; the row is at `:1110`.
  Each site was found by grep rather than by the cited line.
- **No sibling to sweep.** `fetchWithRetry`'s other caller is the sleep fetch, and `sleepData` only
  feeds a `provisional` flag and one prop — it gates no row, so it has no failure-vanish of this
  shape. Checked rather than assumed.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, including the two e2e-specific rules (a stub must block the
  service worker; a stub must not hand the app a literal date).
- Full suite — **9,375 tests / 991 files**, green. `check-test-typecheck` none above baseline.
- **There were no tests for `fetch-with-retry.ts` at all.** There are now nine, and they pin the
  shipped retry count and ladder as well as the new channel, since the exhaustion point is derived
  from them.
- **Mutation pass: 5 caught, 1 equivalent control passed.** Firing on every failed attempt instead
  of the last; firing when cancelled; firing when a retry succeeded; an off-by-one in the attempt
  cap; dropping the `responded` guard.
  **One gap was found and closed by the pass rather than by writing more tests up front:** the
  "cancelled" case passed against a deliberately weakened guard, because cancelling at attempt 0 —
  and even between attempts — never reaches the exhaustion branch at all; the timer's own
  `isCancelled()` check stops it first. The case that separates them is an unmount while the **last
  attempt is in flight**, which is the realistic one: the ladder runs about fifteen seconds. That
  test now exists and the mutation fails against it.
- **The e2e spec was run locally, and mutation-checked.** `e2e/rv85-scores-say-they-failed.spec.ts`
  fails the route persistently and asserts the slot is still **empty partway through the ladder**
  before asserting the message appears — 18.3s, matching the ladder. Disabling the render branch
  fails it. It carries a control case (a working fetch leaves no message), because a test that only
  asserts the message appears would also pass against a build that showed it unconditionally, which
  is a worse bug than the blank it replaces.

## Not exercised

Not seen on the device. It is a WebView-reachable change (no `android/**`, no plugin), so it arrives
through a normal Railway deploy. The **real-world trigger** — the route's 20/60s rate limit being
exceeded by the mount + tab-show + pull-to-sync fan-out — was **not reproduced**; the entry lists
that as not established and it still is. What is verified is that when the fetch does fail, the
screen says so.

<a id="2026-09-22-lane-a-rv90-shared-display-formatters"></a>

# 2026-09-22 — one weigh-in, four spellings: a shared formatter for kg, minutes, h/m and pace

**Branch:** `lane-a/rv90-shared-display-formatters` · **Agent:** Implementation (Lane A) · **Code + docs.**

RV-90 said body weight renders five ways across seven sites with no shared formatter. The helper now
exists — `packages/shared/src/format/units.ts` — and the call sites route through it. Two things the
entry did not know turned up on the way, and one of them is a real bug that shipped in every pace
formatter in the tree.

## What the entry got right, and where its count does not match the tree

The premise holds: rounding and unit spacing were each decided per site, so the same stored value
printed differently on adjacent surfaces. For a weigh-in of **82.45**, the home card and Health › Body
read `82.45 kg`, the day detail `82.5 kg`, the week-day sheet `82.45kg` — raw **and** no space — and
the stats grid `82kg`.

**The "seven sites / five ways" count does not match the tree, and the difference matters for how
much this was worth doing.** What is actually there is **three** body-weight renders that genuinely
disagreed, plus six already sitting on `.toFixed(1)` and agreeing with each other. So this was mostly
latent drift — four of the sites would only diverge once a value with more than 1dp of precision
arrived from Health Connect or a hand-log — with three live disagreements on top. The entry's own
"Not established" bullet said as much about the scale's resolution; the site count overstated it.

## The bug my own tests found, which is not the one I was sent for

`formatPaceValue(359.6)` returned **`5:60`**.

Every pace formatter in the tree splits into minutes and seconds first and rounds the seconds after,
so anything in `[5:59.5, 6:00)` rounds 59.6 up to 60 and prints it in the seconds slot. It was in the
shared `formatPace` in `vdot.ts` and in all three hand-rolled copies, which is why routing them
through one helper did not fix it by itself. The helper rounds the **total** before splitting:

```ts
const total = Math.round(secPerKm)
return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
```

Pinned over `[59.5, 59.9, 119.6, 359.5, 359.99, 3599.7]`.

Second one, same pass: `formatKg(1.005, { decimals: 2 })` gave `1.00`. `toFixed` inherits the binary
representation of the multiply, and **`toPrecision(15)` does not help** — I tried it, because the
usual advice says it does; the artefact is already in the product, not in the printing. Exponential
shift (`Number(\`${x}e${d}\`)` → round → shift back) is what works.

## What routed where

- **kg** — `formatKg` through home-card-widget, week-day-sheet, day-sections (with `{ unit: false }`,
  because that surface renders value and unit as separate elements), scale-pairing ×3,
  capacitor-native-init ×3.
- **minutes** — `done-activity-screen.tsx:329`'s `.toFixed(1)` → `formatMinutes(…, { unit: false })`,
  which is the 42.4-then-42 disagreement the entry filed alongside.
- **pace** — two local `formatPace` copies deleted, three inline hand-rolls routed, `formatPaceValue`
  added for the sites that render their own `/km`.
- **h/m** — four of five converted to `formatHoursMinutes`.

**The fifth h/m is a deliberate exception, documented in the file it stays in.**
`components/health/hypnogram.tsx` keeps its own, because the shared helper pads (`2h 00m`) — right in
the `tabular-nums` columns the other four sit in, wrong on a chart stage label where an exact two
hours reads better as `2h`, and stages round to the minute so the zero case is common. The
consistency rule exists to stop the *same* quantity rendering two ways on adjacent cards; this
quantity appears on no card that uses the helper.

## Verification — and the half that was not achieved

- 17 new unit tests; **4 mutations caught, 1 deliberately-equivalent control** (whitespace inside a
  format string, correctly not caught).
- `pnpm check:rules` — **Ran 75 of 75**. `check-test-typecheck` — nothing above baseline.
- Full suite — **9,401 tests green**.

**The rendered output was not observed.** The e2e seed user has no weight data, so a probe spec
returned `KG_RENDERS: []` and the kg path was never painted in a browser during this work. The
formatter is unit-tested and the call sites typecheck; what is untested is that each site passes the
value I think it passes. Not device-verified either — no safe-area, native-SQLite or Samsung-WebView
surface was exercised, though none of these changes touch one.

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
