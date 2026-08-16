# 2026-08-02 — sleep staging learns that REM comes back round (Q-34 item 2)

_Branch `feat/sleep-staging-ultradian-prior` · PR #1013 · v1.251.1 · domain `sleep`_

Plan: [`docs/superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md`](../../superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md),
item 2. Its own section says to ship it as its own small, easily-revertible PR rather than bundled —
so it is separate from item 3 (#1012) despite touching the same file.

## What was missing

`W_TIME` applies `1 − 2·pos`: a straight ramp favouring deep early and REM late. Real sleep
architecture is *periodic*. NREM→REM cycles run roughly 85–120 minutes and REM concentrates at the
**end** of each cycle, growing cycle over cycle rather than climbing smoothly through the night. A
linear term cannot express recurrence at all.

That matters for the specific place the heuristic has been stuck: the findings doc's session-250 dump
showed the ~22:48–04:13 stretch — prime REM-cycle territory — reading as "moderate everything", with
no single-epoch signal decisive. A prior that *expects* REM to recur on a grid is different
information from one that only knows "later is more REM-ish", which is why this counts as a new lever
rather than another nudge of a flat knob.

## What shipped

`ultradianRemBias(minsSinceOnset) = cos(2π·m / 95) × min(1, m / (4 × 95))` — peaks on the cycle grid,
troughs mid-cycle, amplitude ramping from 0 at onset to full by cycle 4.

The cos also peaks at minute 0, which alone would favour REM at sleep onset, where sleep is actually
deep. The amplitude ramp is what suppresses it — and the ramp is independently justified: REM is short
or absent in cycle 1 and dominant by cycle 4–5. One mechanism, two reasons.

Added **alongside** `W_TIME`, not replacing it, so the correct coarse trend survives. `W_CYCLE = 0.15`
sits under `W_TIME = 0.25` so the periodic term modulates rather than overrides.

## The plan was wrong about the anchor

It says to anchor the cycle clock to `onsetEpoch`. **That value does not exist yet at that point in
the pass** — the onset trim is step 4, the scoring loop is step 3. The anchor used is `sleepIdx[0]`,
the first epoch that survived the wake pass, which is also where the trim itself starts refining from.

## No stager-level behavioural test ships with this, deliberately

`ultradianRemBias` is unit-tested directly: peaks beat the troughs on either side of them at every
cycle (the periodic shape a monotonic ramp cannot produce), the ramp grows cycle over cycle from zero,
it saturates rather than diverging on a long night, and degenerate input returns a neutral 0.

I tried three stager-level tests and threw all three away because none could fail:

- A **flat** synthetic night stages entirely light — the Viterbi switch cost (`REM_SWITCH = 0.5`)
  swallows the prior's per-epoch advantage, so nothing crosses.
- Any night with enough contrast to cross the cutoffs saturates: the Viterbi makes a contiguous
  candidate run all-or-nothing, so the REM block is 10/10 at every parameter value.
- Shifting sleep onset by half a cycle does restage the night, but it **also passes with
  `W_CYCLE = 0`** — leading wake epochs change the z-score population too, so the difference proves
  nothing about this term. I checked, rather than assuming the isolation held.

A test that cannot fail is worse than no test, and the honest position is that the term's behavioural
effect is a real-night question — which is exactly how the plan says all four items must be judged.

## Not verified

The behavioural effect on a real night. Like item 3, this needs a Redecode on device; the verdict
belongs in [`docs/oura-ble-sleep-staging-findings.md`](../../oura-ble-sleep-staging-findings.md),
which now carries the entry for it.

**The failure mode the plan names is real**: a fixed period is an approximation (individual cycles
vary 85–120 min and lengthen across the night), and it can fight the Viterbi decoder's own transition
structure on a fragmented night. **The revert is two addends** — delete `− W_CYCLE * cycleBias` from
`depth` and `+ W_CYCLE * cycleBias` from `remScore`. That is the whole change.
