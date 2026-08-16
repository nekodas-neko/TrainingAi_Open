# 2026-08-03 — the night's HRV and resting HR became a testable module

_Branch `feat/oura-rollup-on-device` · no version bump (no user-visible change) · domains `sleep` / `devices` / `platform`_

Groundwork for backlog **Q-29 / D2 Task 5** (port the deterministic rollup to the WebView). Not
Task 5 itself — see "What this is not" below.

## Why this had to come first

Task 5's Step 3 says to *"port the binning from `aggregateOuraRawSamples` verbatim in structure."*
Taken literally that produces a **second implementation** of HRV, resting HR and average HR — the
thing `CLAUDE.md` calls a bug by definition, on three numbers whose definitions are subtle enough
that the divergence would have been silent.

They were also untestable. Living inside a ~1,100-line repository method meant the only way to
exercise them was through Postgres, and the definitions they encode are exactly the kind that
regress quietly:

- **HRV is a quality-gated MEDIAN of the ring's own `0x5d` rmssd_ms** — never a mean, never a
  recompute from IBI (which gives a different, un-comparable number).
- **Resting HR is the lowest 5-minute BIN AVERAGE** — never the raw per-beat minimum. The decoder
  caps an interval at 2000 ms, i.e. exactly 30 bpm, so one missed beat yields a plausible-looking
  minimum that `min()` would seize on.
- **One MET exclusion feeds both.** If HRV and resting HR gate on different windows they disagree
  about when the night was at rest.

## What shipped

`packages/shared/src/health/night-vitals.ts` — `metExclusionWindows`, `rmssdSamples`,
`hrvMsFromSamples`, `nightlyHrvMs`, `nightlyHeartRate`, plus the named thresholds
(`HR_PLAUSIBLE_MIN/MAX`, `MIN_BEATS_PER_BIN`, the grid constants) that were bare literals inline.
`adapter.ts` calls it; nothing else changed.

Two details worth knowing:

- **`nightlyHeartRate` returns its bins.** The Recovery Index consumes exactly that series, and it
  was reaching into the inline `hrBins` map. Recomputing it would have been a second definition of
  "the night's HR curve". Note the returned bins include ones *disqualified* from resting HR — the
  recovery curve wants the shape of the whole night.
- **`rmssdSamples` is exported separately** from the median. The chronic-stress model takes the raw
  sample list, and it must be the same extraction pass as the headline, not a parallel one that
  could gate differently.

## Verification — an extraction is only as good as its equivalence proof

Passing tests prove nothing about a refactor unless they *would have* failed. Three layers:

**1. A fuzzed equivalence oracle.** `night-vitals-extraction-oracle.test.ts` holds a frozen,
verbatim copy of the pre-extraction algorithm and runs both over **400 randomised nights** whose
values deliberately straddle every threshold (the 35/150 band, MET 1.8, the 3-beat floor, zero
rmssd). They agree exactly. Confirmed discriminating: changing `MIN_BEATS_PER_BIN` from 3 to 2 fails
it at seed 2.

The duplicate implementation is deliberate and follows the repo's existing golden-vector pattern for
the vendored Oura ports. The file says, in its header, that it must be **deleted in the same PR** as
any intentional change to what these numbers mean — a frozen oracle nobody may change is a trap.

**2. 18 unit tests** on the definitions themselves — the first time these have ever been unit-tested.
One was rewritten after review: the MET-gating test originally used a fixture where gated and
ungated both returned 40, so it would have passed with the gate deleted. It now uses one where the
answers differ (120 → 40).

**3. A mutation, to find out what the existing tests actually cover.** Disabling the resting-HR
gating entirely:

| Test | Caught it? |
|---|---|
| `oura-hrv-median-rollup` | **yes** |
| `oura-ble-aggregate` | no |
| `oura-ble-decoded-from-hex` | no |
| `oura-ble-daily-summary` | no |
| `oura-ble-sleep-bedtime-fragment` | no |
| `night-vitals` unit + oracle | **yes** |

So one DB test does guard it — worth stating precisely, because an earlier read of this said none
did. Four of the five that touch the rollup would have shipped the regression.

Full suite green (384 files / 2965 tests), typecheck clean, lint at its 120-warning baseline.
Three DB tests reported single failures during the run and passed on isolated re-run — the
`trainingai_dev` connection-contention flake `CLAUDE.md` documents.

## What this is NOT

**Task 5 is not done.** This is Steps 1–3's prerequisite. Still to do: `rollup-device.ts` itself
(the bridge-read → decode → local-write orchestrator), the `getUnrolledRaw`/`markRolledUp` wiring,
the foreground trigger, and cache-group invalidation. None of that is verifiable in a sandbox —
`getLocalStore` returns null and there is no Capacitor bridge — so it belongs in a session that can
pair with a device.

**No device path was added**, so there is nothing new to verify on the S25 and no checklist item.
The server rollup behaves identically, which is the whole claim.

## Plan drift found

`2026-07-21-oura-raw-on-device-phase-1.md`'s Task 5 file map points at `lib/health/daily-medians.ts`
and `lib/oura-models/illness-radar.ts`. Both moved to `packages/shared/src/health/` some time ago.
Same staleness class as Q-34's plan. Corrected in the backlog entry rather than the plan, which has
other drift a Task-5 session will need to reconcile anyway.
