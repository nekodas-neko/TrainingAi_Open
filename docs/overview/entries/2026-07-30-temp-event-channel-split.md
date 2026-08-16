# 2026-07-30 — Nightly temperature: one sample per frame, 0x75 only (Q-2)

Branch: `fix/temp-event-channel-split` · v1.243.0

Q-2 from the backlog, taken after Task 3 of Q-1 was deferred by owner decision (see below).

## The bug

`nightlyTemperatureCentiC` (`lib/health/temperature-baseline.ts`) is a *temporal* pipeline — median-7,
then 30-sample windows, then min-of-window-maxima — so it assumes one chronologically ordered series.

The rollup fed it something else. It concatenated the `temps_c` arrays of tags `0x46`, `0x69` and
`0x75` and stamped **every value** with its frame's single `ds`. But a frame's values are probes read
at the same instant, not successive readings: 631 real frames became 2,398 "samples" sharing 631
timestamps, and the algorithm read probe *position within the array* as elapsed time.

Two independent corrections were needed, and only doing one wouldn't have worked:

1. **Collapse each frame to one sample.** New `temperatureFrameSeries` takes the median of a frame's
   probes and gives it a single timestamp, instead of N values sharing one.
2. **Drop `0x46`/`0x69`.** Per the plan's measurements, `0x46` frames hold three values with
   `f0 ≤ f1 ≤ f2` in 99.86% of 30,135 rows, the middle one on an exact 0.5 °C grid in 98.3% — so any
   median-based collapse inherits that quantisation. Over 21 nights, 19 landed on exact whole degrees
   (σ = 0.743 °C), leaving `tempZ` and readiness's `bodyTemperature` contributor with no
   discriminative power. `0x75` also fires only while asleep, which is the algorithm's domain.

The decoder is untouched and correct — `open_oura` decodes all three tags with one shared
variable-length i16 decoder, and `lib/oura-ble/decode.ts` matches it exactly. This is a rollup fix.

## Two corrections to the plan, found by checking rather than assuming

- **No redecode pass is required.** The entry said the remedy "needs a redecode pass over archival
  `body_hex`". `lib/oura-ble/decode.ts:490` already routes `0x75` to `decodeTemperatures`, so archival
  rows already carry `temps_c`, and `ROLLUP_TAGS` (`adapter.ts:4693`) already fetches `0x75`. What is
  actually needed is a **re-aggregation** — past nights recompute the next time
  `aggregateOuraRawSamples` runs. Nothing owner-run against prod.
- **`tempSamples` has a second consumer.** It also feeds `chronicStressSignalsByDate` (`tempSkin`,
  `tempSkinTimestamps`, `highestTemperature`) — the "resilience-averaging compounds it" note in the
  entry. That consumer is fixed by the same change, and gains a real one-timestamp-per-sample series
  instead of N duplicates. `highestTemperature` now maxes over frame medians rather than raw probes,
  which is deliberate: one hot probe no longer sets a night's peak.

## Verified

- 6 new unit tests on `temperatureFrameSeries`: one sample per frame (not per probe), odd-length takes
  the middle, even-length averages the two middles rounded to centi, a wild probe is resisted, output
  is ds-ordered, empty frames are skipped rather than emitting a `0` (the pipeline's invalid sentinel).
- `oura-ble-daily-summary.test.ts` reworked: it seeded `0x46`, the tag now excluded. It seeds `0x75`
  at the expected temperature **and** `0x46` at a deliberately wrong one (+5 °C). If the streams are
  ever re-merged, `tempMeanC` moves off the expected value and the test fails — the exclusion is
  pinned, not incidental.
- `pnpm tsc --noEmit` clean · `pnpm lint` 0 errors (119 pre-existing warnings) · 2799 tests pass.

## Not verified

- **The real 35.91 °C figure could not be reproduced.** The plan's comparison table came from 631
  real frames of prod data; the sandbox has no reachable prod data and the local seed has no
  `oura_raw_samples`. The median convention here (odd → middle, even → rounded average of the two
  middles) is the standard one, but whether it reproduces the plan's exact number is unconfirmed.
  The first real re-aggregation is the check: nightly values should stop landing on whole degrees.
- **Which stream the ring itself consumes remains unanswerable** — `nightly_temperature_calculate @
  0x203520` is an address in the Oura app binary, not covered by `open_oura`. This ships as a
  defensible measurement, not as a claim about the ring's own behaviour. Carried forward as a
  Known-Issues row.

## Task 3 of Q-1 deferred (owner decision)

Its "READY, not blocked by Task 4" note was too broad. The bearer token is a prerequisite under all
three build-split options, but Task 3 also converts 19 pages plus `tab-page.tsx` away from
server-side `await auth()` + redirect, and its Step 4 removes `middleware.ts` route protection —
both only safe once a static export means no middleware runs, and pure loss under option C. Owner
chose to defer rather than weaken the auth boundary for an uncommitted architecture. Annotated ⛔ in
the backlog; unblocks when Task 4 picks A or B.
