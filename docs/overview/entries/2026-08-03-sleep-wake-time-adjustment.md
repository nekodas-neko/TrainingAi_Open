# 2026-08-03 — a phone call at midnight was erasing two hours of real sleep

_Branch `claude/sleep-wake-time-adjustment-jp39mz` · v1.252.8 · domain `sleep`_

## What was reported

Owner: phone calls woke them up partway through last night, and the app now shows a bedtime hours
later than when they actually went to sleep. Ask: find out what the data actually shows, and fix it
so an interruption shows as more awake time rather than a later bedtime.

## Finding the real timeline

Used the two production admin endpoints (`GET /api/admin/day-review`, `POST /api/admin/db-query`
against the `claude_ro` read-only schema) to pull the 08-03/04 night's `sleep_sessions` row:
`sleep_start` **00:59**, `sleep_end` 07:39, only 20 min total awake, 5 min onset latency.
`oura_heartrate` for the evening showed a suspicious pattern — HR settled into the mid-50s/low-60s
(near resting baseline) from ~22:00, then spiked to 66→81→74 bpm around 00:30–00:52 (almost
certainly the calls), then dropped back down. That's the shape of an interrupted sleep, not a late
bedtime — but it wasn't proof by itself.

Went one level deeper: pulled the actual raw BLE IBI samples (`oura_raw_samples`, tags `0x80`/`0x60`)
for the night and decoded them **with the repo's own decoder** (`lib/oura-ble/decode.ts`, run
directly via `node --experimental-strip-types`, no build step needed) to reproduce the exact
per-5-min beat-density array the rollup computes. That confirmed it precisely: a real dense-sleep run
**22:32–00:42** (up to 623 beats/epoch), a **15-minute gap** during the calls, then a second dense run
**00:57 onward** for the rest of the night. Feeding those exact beats into the production
`denseSensingSpan` function reproduced the bug exactly — it returned only the second run, discarding
the first.

## Root cause

`lib/sleep/sensing-span.ts`'s `denseSensingSpan` selects which dense-HR runs count as "the sleep
window." It already had logic to span two runs of *comparable length* (a genuine mid-night wake
split) and to drop a short run *far in time* from the main sleep (an evening-activity burst,
07-21's case). This night fell in the gap between those two rules: the first run (26 epochs, 130 min)
was only ~0.33× the second (80 epochs) — below the `minNeighborRatio` (0.5) floor — so it got
dropped outright, even though the two runs were only 15 minutes apart.

## Fix

Added a second admission rule alongside the length-ratio one: a substantial run within
`maxBridgeGapEpochs` (12 epochs / 1h) of an already-kept run is now always bridged in, regardless of
length ratio. A real interruption sits far under the 2h `GAP_DS` that splits nights into separate
`sleep_sessions` rows at the clustering stage (`adapter.ts`), so proximity alone rules out a distant
evening burst — which the existing ratio test still correctly rejects (07-21's ~4h gap stays
excluded). Selection now chains: keep the longest run, then repeatedly pull in any other substantial
run that's either close-in-time or comparable-in-length to something already kept, so more than two
fragments in one interrupted night still merge into one span.

## Verification

- New unit test (`lib/sleep/__tests__/sensing-span.test.ts`) built from the real decoded beat shape
  of this exact night — 26-epoch bout, 3-epoch gap, 80-epoch bout — asserting the span now covers
  both. All 9 tests in the file pass, including the four pre-existing calibration cases (07-14,
  07-15, 07-21, the 07-09 split-night) — none regressed.
- Re-ran the actual production beats (fetched + decoded from `oura_raw_samples` for this specific
  night) through the patched function directly: window start moved from **00:57 → 22:32**, matching
  the real onset.
- `oura-ble-sleep-mid-blip-fold`, `oura-ble-sleep-phases`, `oura-ble-sleep-staging-rollup`,
  `oura-sleep-push-sync`, `sleep-session-source-merge`, `merge-sessions`, `actual-window` — all green
  against the local dev DB, run in isolation.
- `tsc --noEmit` clean, no lint issues introduced.

## What this deliberately does NOT do

**Last night's own `sleep_sessions` row is still wrong.** The fix is a pure function of already-decoded
input — it changes what future rollups produce, not what's already stored. `body_hex` for this night
is untouched (archival, per the Oura BLE rules), so the row is recoverable via a Redecode/backfill
pass, but that re-run did not happen in this session. Flagged in `projectOverview.md` Known Issues
rather than silently left stale. Any other historical night with a similar asymmetric interruption
has the same stale `sleep_start` until the same backfill runs — no sweep for other affected nights
was done.

Also out of scope: the interior-wake-bout staging inside the newly-widened window (i.e., whether the
15-minute gap epochs render as "awake" in the hypnogram correctly) — `stageSleepDetailed`'s existing
brief-interior-wake folding (`packages/shared/src/health/sleep-staging.ts`) already handles this class
of gap for every other night's hypnogram, and this PR relies on that rather than adding new staging
logic, but it wasn't independently re-verified against this specific gap width.
