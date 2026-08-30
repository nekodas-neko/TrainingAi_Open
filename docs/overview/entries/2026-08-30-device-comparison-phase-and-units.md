# 2026-08-30 — Two rings that were never compared, reported as two rings that disagree

**Lane A · branch `fix/device-comparison-phase-and-units` · PS-15 (phase + units halves)**

`GET /api/admin/device-comparison` returned `overlap: 0` for the two rings' daytime stress, which
reads as total disagreement. They had never been placed on the same axis.

## The cause, measured before it was fixed

Production, over the window PS-15 was filed from: Oura's daytime-stress buckets land at **:15 and
:45** (`oura_daytime_stress_buckets`, 173 rows); the Colmi's at **:00 and :30**
(`colmi_readings`, 95 rows). Permanently fifteen minutes apart. The route bucketed at a hardcoded
`DEFAULT_BUCKET_MINUTES = 5`, so no pair could form at any point in either device's history.

`lib/health/device-comparison.ts` has said, in its own header, since the day it was written:

> Bucket to the COARSEST cadence among the devices being compared, not the finest.

Nothing implemented it. The sentence was true, prominent, and inert — which is the whole reason
this took a backlog entry to notice rather than a reading.

## What shipped

**The width is measured.** `coarsestCadenceMinutes(series, fallback)` takes each series' **median**
inter-sample gap and returns the coarsest. Median, not mean: one overnight gap in an otherwise
five-minute series drags a mean past 25 minutes and would bucket a whole day into one row. An
explicit `?bucket=` still wins — a caller may want the whole-day view — and the response now carries
`bucketMinutes`, `bucketSource` (`derived-from-cadence` | `requested`) and `derivedMinutes`, so a
hand-set width is always comparable against the measured one. `DEFAULT_BUCKET_MINUTES` survives as
what to do when a series is too short to have a cadence at all.

**Zero overlap has three causes and `pairSummary` now names which.** `verdict` is `no-data` (one
device reported nothing), `out-of-phase` (both reported all window and never shared a bucket — a
grid problem, not a device problem) or `compared`. The old output could not distinguish "they
disagree" from "they were never compared", and those call for opposite next actions.

**Mixed units suppress the magnitudes.** Oura's stress is normalised **−1..+1**; the Colmi's is raw
**0..100** (measured range 30–65). A mean bias across those scales is not a weak measurement, it is
not one — and it prints exactly as confidently as a real number. `NamedSeries.unit` declares the
scale; where two differ, `meanAbsDelta` / `maxAbsDelta` / `meanBias` come back `null` with
`unitsDiffer` naming both, and `spearman` is what is left. Omit `unit` and nothing changes, so the
heart-rate pairings (all bpm) are untouched.

**`stress` became a metric.** It is what makes the other two useful rather than theoretical, and it
needed one new read: `getOuraDaytimeStressBuckets` (user-scoped, read-only). At the derived
30 minutes the two rings agree at **rho = 0.64** over the eight afternoon buckets of 2026-08-27 —
the number PS-15 was filed with, computed by hand, now reachable from the endpoint.

## Adding rank correlation removed a duplicate

`spearman` went into `packages/shared/src/health/correlation.ts` beside `pearson`, and
`averageRanks` — which `model-report-calibration.ts` had kept private — moved there with it and is
now imported. So the module that owns correlation owns all of it, and the count of rank
implementations went from one-in-the-wrong-place to one-in-the-right-place rather than to two.

`spearman` was written with its own `if (points.length < 3) return null`. Mutation testing showed
that line could not change an outcome — `pearson`, which it delegates to, already refuses under 3 —
so it was **deleted rather than tested around**. Two copies of one threshold is how the two drift.

## Steps are still not a metric, on purpose

PS-15's third half is steps: Oura writes a daily scalar, the Colmi an hourly series, and pairing
them means summing the Colmi side to a day. **PS-16 has not settled whether those buckets are
cumulative** — and its own words are the reason to stop: *"summing a cumulative counter gives a
number that is badly wrong and still looks plausible."* Building the summation now would put
precisely that number in front of a reader, under a heading that says the two devices were compared.
`METRICS` rejects `steps` with a 400 naming what it accepts, rather than falling back to heart rate.

PS-15 therefore stays in the queue with `Needs: PS-16` and a `Keep:` line naming only the steps half.

## Verification

- Full suite: **642 files, 5321 tests passed** (3 files / 57 tests skipped).
- `pnpm check:rules` — **Ran 61 of 61**, all passed. `tsc --noEmit` clean, lint 0 errors.
- **14 mutations, every anchor asserted before running, all 14 caught.** Among them: reverting the
  bucket width to the constant (the shipped bug), taking the finest cadence instead of the coarsest,
  median → mean, dropping the `out-of-phase` verdict, disabling the unit suppression, letting
  `maxAbsDelta` escape it, withholding `spearman` where it is the only usable statistic, and four
  route-wiring mutations. Two survived a first pass — both in the newly-shared `correlation.ts`,
  whose tie handling had been untested in *both* homes — and were closed with real tests rather than
  waved through.
- New route-level tests (`app/api/admin/device-comparison/__tests__/`) use a **fixed** UTC fixture
  day named by the window params: both sides fixed, so this is not a rolling-window time bomb.

**Not exercised:** the S25 and the APK — this is an admin JSON endpoint with no UI, reached in a
browser, and nothing here touches the local store, safe-area, gestures or notifications. Not
exercised against **production** data either: the phase and range figures above were measured
earlier from production, but the code paths ran only against fixtures and the local seed.

## Filed, not fixed

**LA-35** — `docs/module-map.md` points at `lib/health/…` for **34** modules that live in
`packages/shared/src/health/`, the exact Q-153 trap `CLAUDE.md` sends readers to that map to avoid.
It survives because `scripts/check-index-doc-paths.js` ends its `resolves()` with a
`'packages/shared/src/' + p.replace(/^lib\//, '')` fallback — so the one error class the map exists
to prevent is the one the check whitelists. Found while correcting that map's row for this change.
