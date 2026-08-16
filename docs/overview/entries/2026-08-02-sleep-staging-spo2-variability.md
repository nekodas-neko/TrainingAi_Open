# 2026-08-02 — a fourth sleep-staging signal, read off the oximeter (Q-34 item 3)

_Branch `feat/sleep-staging-spo2-var` · PR #1012 · v1.251.0 · domain `sleep`_

Plan: [`docs/superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md`](../../superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md),
item 3 — the cheapest of its four, and the one it says to do first.

## The plan was stale in two ways

**Item 1 (LF/HF HRV) is already on `main`.** `packages/shared/src/health/hrv-frequency.ts`, the
`lfhf` epoch field, `W_LFHF = 0.5` and its tests all shipped earlier. The plan still describes it as
work to do. Nothing to build; the sequencing note now reads item 3 → item 2 → item 4.

**Every path in the plan's file map moved.** The sleep modules live in `packages/shared/src/health/`
now, not `lib/health/`. Worth checking before trusting a file map from July.

## What shipped

`spo2VariabilityFromSamples` (`packages/shared/src/health/spo2-variability.ts`) — the within-epoch
SpO₂ standard deviation in percentage points, gated at five valid readings, with implausible values
(outside 70–100%) dropped before the spread so a single artefact cannot dominate an epoch whose real
spread is a fraction of a point.

Wired as `SleepEpoch.spo2Var`, z-scored per night like every other refinement term, weight
`W_SPO2 = 0.2`. Populated in `aggregateOuraRawSamples` with the same source precedence the SleepNet
input and the `body_metrics` rollup already use: the firmware percentage (`0x6f`) when the ring emits
any, else derived from raw R (`0x8b`) — which is all the Ring 5 ever emits. The admin debug dump
gains a `spo2V` column.

## Why this is not just another re-weighting

Every REM term the stager already carries comes off the tachogram — `hrv` and `hrVar` are its
time-domain moments, `breathVar` its respiratory oscillation, `lfhf` its spectrum. They are
correlated by construction, which is why session after session of raising one of them failed to move
REM. `spo2Var` is read off the **oximeter**, so it can disagree with all four. That independence is
the whole argument for it; the weight is almost beside the point until a real night says whether the
column separates anything.

## Choosing SD over CV

The plan said "SD (or CV)". SpO₂ sits in a narrow band (~92–100%), so a CV would be the SD divided
by a near-constant mean — the same number rescaled, and the per-night z-score makes any monotone
rescaling irrelevant to the score anyway. SD is the interpretable one: a debug column in percentage
points can be read directly.

## The test that proves the wiring, and the one I deleted

I first wrote the "a high-SpO₂ block grows REM" test the plan implies, mirroring the existing `lfhf`
one. **It was vacuous.** Probing it showed the REM block scored 10/10 REM at *every* `spo2Var` value
including the baseline — the Viterbi bout decoder makes a contiguous candidate run all-or-nothing, so
the fixture saturates and the assertion (`toBeGreaterThanOrEqual`) can never fail. The same weakness
very likely applies to the `lfhf` test it was copied from; noted, not changed here.

What replaced it asserts something that can actually fail: on a deliberately low-contrast night where
many epochs sit near the cutoffs, a night differing **only** in its `spo2Var` column stages
differently. **Checked against a zeroed weight** — setting `W_SPO2 = 0` fails it, and 0.2 passes.

It deliberately does not assert a *direction*. The z-score is relative, so raising one block's
variability pushes every other epoch's down, and on a synthetic night the time-of-night prior can
dominate either effect — I measured both signs depending on where the high block sat. Asserting the
window where it came out favourably would have been writing the test around the result.

## What is NOT known — both device questions

1. **Whether the column is populated at all.** The gate needs ≥ 5 valid SpO₂ readings inside one
   5-minute epoch, and the ring's oximeter cadence over BLE has never been measured against that bar.
   If `spo2V` reads mostly blank the term is inert — self-neutralising by construction, so nothing
   regresses, but nothing improves.
2. **Whether it discriminates.** Weakly bimodal values would be the same negative result `brVar`
   produced in session 246: record it and leave the weight alone rather than forcing it up.

Neither is answerable in the sandbox — `aggregateOuraRawSamples` needs real `oura_raw_samples` rows,
and this database has none. Both are on the owner device checklist, and the reasoning is in
[`docs/oura-ble-sleep-staging-findings.md`](../../oura-ble-sleep-staging-findings.md), which is where
the verdict belongs.

Full suite green (2906 tests). One earlier run reported a single failure I could not capture before
it cleared; two subsequent full runs were clean, and CI is the arbiter.
