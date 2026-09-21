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
