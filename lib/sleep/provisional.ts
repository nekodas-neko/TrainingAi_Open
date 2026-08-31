// Whether a night's numbers can still change — the difference between "you slept 6 h 15 m" and
// "you have slept 6 h 15 m so far".
//
// The ring's history buffer drains in batches and the rollup derives a night from whatever has
// drained. Both lag the wake, and neither says so: on 2026-09-01 the same night read
// 10:03 pm – 4:46 am / 6 h 15 m at 6:44 and 10:03 pm – 6:08 am / 7 h 40 m four minutes later, with
// every derived number moving — including the 30-night average it was being compared against
// (BF-83). Nothing distinguished the first reading from a finished one.
//
// **The measure is the ROLLUP's coverage, not the raw table's.** Two different lags produce the
// same symptom and only one of them is visible in the raw frames: at 6:44 the batch covering
// 4:46 → 6:38 had already been ingested (recorded 6:42) — the row was stale because the rollup had
// not re-derived from it yet. A test against `max(oura_raw_samples.measured_at)` would have called
// that night settled. The rollup watermark only advances when a run COMPLETES, so it answers the
// question actually being asked: how far has the derivation reached?
//
// This is the repo's partial-day rule (CLAUDE.md: a cumulative per-day field from an external
// source must treat today as partial) on a new surface — a part-drained night compared against a
// 30-night average is exactly the anomaly that rule describes.

import { DEFAULT_EPOCH_DS, DEFAULT_MAX_BRIDGE_GAP_EPOCHS } from './sensing-span';

/**
 * How far past a night's end the rollup must have reached before that night is called final.
 *
 * Derived from the sensing-span bridge gap rather than picked: `clampToDenseSensing` spans out to a
 * neighbouring substantial dense run separated by up to `DEFAULT_MAX_BRIDGE_GAP_EPOCHS`, so while
 * coverage sits closer than that to the current end, a run arriving in the next drain can still be
 * bridged in and the night grows. Beyond it, a later run is a separate window instead (the 2 h
 * cluster gap), so the end cannot move. Importing the constant is what stops the two drifting: a
 * change to the bridge gap that left a hardcoded 60 minutes here would silently start calling
 * still-growing nights final.
 */
export const PROVISIONAL_COVERAGE_MARGIN_MS =
  DEFAULT_MAX_BRIDGE_GAP_EPOCHS * DEFAULT_EPOCH_DS * 100;

/**
 * True when the rollup has not yet processed ring data far enough past this night's end to call it
 * finished, so its duration, efficiency, HRV and stage split can all still move.
 *
 * A null coverage end means there is no usable watermark — no ring data in this clock epoch, or the
 * watermark predates a re-key. That is "we cannot tell", and the honest reading of it is NOT to
 * badge every historical night as still-filling, so it resolves to final.
 */
export function isNightProvisional(sleepEndMs: number, coverageEndMs: number | null): boolean {
  if (coverageEndMs == null) return false;
  return coverageEndMs - sleepEndMs < PROVISIONAL_COVERAGE_MARGIN_MS;
}
