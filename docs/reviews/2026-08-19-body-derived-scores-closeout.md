# Closing out the body pillar: two derived scores checked, nothing to tune, one useful byproduct

**Date:** 2026-08-19 · **Agent:** Tuning · **Type:** calibration evidence (clean results), docs-only
**Filed as:** no new Q — **an addendum to Q-517** · **Lane:** A implements that addendum

The body pillar was marked ✅ on the strength of the Body Battery range and anchor work (Q-511). That
was a **pillar-level** tick, and two derived scores inside it had never been examined. Both are checked
here. **Neither has anything for Tuning to calibrate**, and saying so is the point — it stops a
successor re-measuring them.

---

## 1. `bdi_derived` — breathing disturbance index. Nothing to tune.

Persisted on **46 of 96** rows, written by `adapter.ts`'s `bdi_derived` step as a byproduct of the
SleepNet staging pass's apnea head, keyed by wake date.

| | value |
|---|---|
| min | 1.10 |
| p25 | 2.70 |
| **median** | **4.15** |
| p75 | 5.10 |
| max | **10.10** |
| mean | 4.29 |
| nights ≥ 5 | 14 (30%) |
| nights ≥ 15 | **0** |

Read against the clinical AHI convention (normal < 5, mild 5–15, moderate 15–30, severe > 30), the
median sits in *normal*, about a third of nights fall in *mild*, and nothing reaches *moderate*. That
is a plausible distribution for someone without sleep apnoea.

**There is no threshold to calibrate, because there is no threshold.** The only consumer in the tree is
`components/oura-ble/sleepnet-dump-console.tsx` — a debug console — and it labels the value
*"observational, not a diagnosis"*. `validation/oura-summary.ts` classes it with the *"open-ended
research metrics"*. It is being accumulated, not acted on, and that is the correct treatment for a
clinical-adjacent number produced by an ML head.

**Recommendation: leave it exactly as it is.** If it ever gains a user-facing band, *that* is when it
needs calibrating — and the band should not be invented from this owner's 46 nights.

---

## 2. `body_comp` — deterministic, and not ours to tune

Persisted on **71 of 96** rows. Latest snapshot:

```json
{"ffm_kg": 53.4, "bmr_kcal": 1524, "weight_kg": 71.5, "fat_mass_kg": 18, "body_fat_pct": 25.2}
```

Every field is a deterministic derivation from a logged weight and body-fat percentage, and the one
formula involved — `cunninghamBmr = ffm × 21.6 + 370` — is a **published equation deliberately matched
to Oura's `atlas` postprocessor**, per `body-composition.ts`'s own comment.

**Same category as cardio's `RIEGEL_EXPONENT` and the VDOT coefficients**: a published constant chosen
for external consistency. Re-fitting it to one person would break the match it exists to maintain.
**Nothing to calibrate.**

The stored value checks out against the formula: `53.4 × 21.6 + 370 = 1523.4 ≈ 1524`.

---

## 3. The useful byproduct — an addendum to Q-517

Q-517 proposes replacing `MIN_PLAUSIBLE_MAINTENANCE = 1000` with the user's own BMR, on the grounds
that a maintenance below BMR is impossible by definition.

**That BMR is already persisted.** `body_comp.bmr_kcal` carries it per day on 71 of 96 rows, computed
by the same `cunninghamBmr` the proposal would otherwise call. So the floor can **read the stored
value for the day** rather than recompute from a profile snapshot.

Two things that makes better:

1. **It is the day's own BMR**, not a window mean. The stored series moves with weight and body fat —
   1,522 and 1,524 on consecutive days — so the floor tracks the person instead of a fixed number.
2. **It cannot drift from what the rest of the app believes**, because it is the same stored number the
   body-composition card renders.

**Fallback still needed:** 25 of 96 rows have no `body_comp` (no body-fat reading that day), and
`bodyComposition()` deliberately returns `null` rather than fabricating. On those days the floor should
fall back to computing from the most recent snapshot, **not** to the universal 1,000 — a stale BMR is
far closer to the truth than a number 500 kcal below it.

---

## 4. What was not exercised

- **No code changed and nothing was written to production.**
- **The BDI values were not validated against anything.** There is no reference measurement — no sleep
  study, no second device — so "plausible" here means *consistent with the clinical convention*, not
  *verified*. A systematically wrong apnea head would produce a plausible-looking distribution too, and
  this review could not tell the difference.
- **The SleepNet apnea head itself was not examined** — not its inputs, not its calibration, not how
  `perHour` is derived. Only the persisted output distribution.
- **`body_comp`'s inputs were not audited.** The formula was checked against one stored row; whether
  the `body_fat_pct` feeding it is accurate is a scale-measurement question, not a formula one.
- **The 46 and 71 row counts are the owner's alone** (`claude_ro` is row-scoped), and 46 nights is a
  small sample for any distributional claim.
- §3's fallback recommendation is **reasoning, not measurement** — the 25 rows without `body_comp` were
  counted, but no replay was run showing what a stale-BMR floor would pass or block.
