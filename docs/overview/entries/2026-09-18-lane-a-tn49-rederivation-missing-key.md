# 2026-09-18 — TN-49: the audit contradicted its own evidence, and the entry believed it

**Branch:** `lane-a/tn49-rederivation-missing-key` · **Lane A** · no migration · no data write · unversioned

## What the entry asked for

TN-49 measured that **7 of 65** `oura_daily_derived` rows carry a `readiness_score` that does not
reproduce from their own stored contributors, all consecutive (2026-07-16 → 07-22), all 4–6 points
low. It attributed this to the 2026-07-22 weight rebalance — contributors re-derived under the new
model, scores not — and prescribed: *"recompute and rewrite the seven rows from their stored
contributors."*

**That would have overwritten seven correct scores with values 4 to 6 points too low**, writing into
production exactly the defect the entry exists to remove. The measurement was right. The diagnosis
was not.

## What it actually is

`READINESS_WEIGHTS` has **nine** contributors summing to exactly 1.00.
`rederiveReadinessFromStored` skipped any key absent from the stored map — dropping that key's
weight from a sum defined to total 1, so the result came out low by about `weight × 50`. A weight of
0.09–0.10 at a neutral 50 is −4.5 to −5, which is the band TN-49 reported.

Production, 2026-09-18:

| | |
|---|---|
| rows that disagree with their stored score | **7** |
| rows storing eight contributors instead of nine | **7 — the same seven** |
| key-count histogram | `{8: 7, 9: 58}` |
| the missing key, on all seven | **`checkin`** (weight 0.10) |
| nine-key rows that reproduce exactly | **58 of 58** |

The 1:1 match is what settles it. Nothing about the weight rebalance is involved.

## The surface was asserting the opposite of its own evidence

This is the part worth carrying forward, because the false finding was *generated* rather than
guessed. On those rows `drifted` and `uncheckable` are both empty, so `buildReadinessAudit` took the
branch that prints:

> The stored score **IS** reproducible from its own stored inputs (**42**) … the model has not moved
> — the difference is an INPUT change.

against a stored **48**. It claims reproducibility and then prints a number that is not the stored
score, in the same sentence, and hands the reader a wrong diagnosis. The Tuning agent read that
sentence and filed it in good faith.

## What shipped

`ReadinessRederivation` gains `missing`, distinct from `uncheckable`:

- **`uncheckable`** — the key is *present* but carries no `input`: a pre-Q-501 row whose score is
  known and cannot be re-derived.
- **`missing`** — the key is *absent entirely*. There is no score at all.

An absent key now contributes the model's own NEUTRAL 50 — what `computeReadinessComposite` uses for
a contributor with no input, so it is the closest the stored row supports — and the audit refuses to
make a reproducibility claim while `missing` is non-empty.

No production row was written. The fix is entirely in `packages/shared/src/health/`.

## What the fix does NOT explain, stated rather than fitted

With the neutral 50 standing in, **four** of the seven reproduce exactly (07-18, 07-19, 07-20,
07-22). **Three keep a 1-point residual** (07-16, 07-17, 07-21), and no value in
`CHECKIN_ENERGY_SCORE` — 30/50/72/88/100 — reproduces them, so it is not a logged check-in either.

I first back-solved the missing contributor as 60/50/40 by differencing two independently-rounded
numbers, noticed those are not values the check-in map can produce, and re-queried at full precision
rather than publishing the reconstruction. The residual is recorded as unexplained. It is 1 point on
three days and nothing on screen depends on it.

## Left for the owner

Two production data writes, both owner-gated under the confirm-first carve-out, both kept on the
entry:

1. **Back-fill the missing `checkin` key** into those seven contributor blobs. Only the four
   exactly-reproducing rows can be reconstructed with confidence (`checkin = 50`); **do not write a
   value to the other three.**
2. **Back-stamp `model_versions.readiness`.** The entry's second finding is confirmed untouched: 40
   of 65 rows carry no stamp, and the stamped and unstamped ranges overlap (08-22 → 08-25), so a row
   cannot say which it is.

## Verification

`packages/shared/src/health/__tests__/tn49-rederivation-missing-key.test.ts`, **9 passing**. Run
against the pre-fix code, **5 fail and 4 pass** — and which four pass is the point:

| Survives on both sides | Why it is there |
|---|---|
| *leaves a complete map exactly as it was* | the deliberately equivalent control: score, `drifted` and `uncheckable` unchanged for a nine-key map |
| *still detects a contributor whose stored score does not follow from its stored input* | drift detection is the other behaviour the fix was not allowed to move |
| the weights-sum-to-1.00 check | the premise the whole defect rests on |
| the null-input case | unchanged |

The first draft had a single "control" that asserted `missing: []` alongside the unchanged
behaviour, so it failed against old code too — which makes it a test of the new field, not a
control. Splitting it is what made the mutation result mean anything.

Also pinned: the real production row of **2026-07-20** (eight contributors weighting to 43.26, stored
48) resolves to 48 rather than 43.

Gate: Custom Rules **75 of 75**, `tsc --noEmit` clean.

## Not exercised

- **No device, no APK** — shared engine code only.
- **The audit screen itself.** The note text changed; nobody has looked at it rendered.
- **The three unexplained rows.** Not diagnosed, only bounded.
