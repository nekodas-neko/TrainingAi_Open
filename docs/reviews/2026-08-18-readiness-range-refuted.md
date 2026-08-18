# Readiness range — the calibration approach is wrong here, and the tests are what proved it

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence + a small code change
**Supersedes:** the Q-504 plan in
[`2026-08-18-sleep-score-range-recalibration.md`](2026-08-18-sleep-score-range-recalibration.md) §6
**Shipped here:** a readiness `model_version` stamp (Q-273's readiness half). **No scoring change.**

Q-504 said readiness had the same problem as Sleep and the same fix was measured and ready. I
implemented it. **Two hypotheses failed in a row, and the honest outcome is that readiness should not
get this treatment at all.** This records both failures, because each one is a reusable result.

---

## 1. What was attempted, and what stopped it

The Sleep fix was a post-hoc `SCORE_CALIBRATION` on the weighted blend. Applied to readiness with
anchors fitted the same way, it produced exactly the target distribution: **mean 66.8, sd 19.1, range
17–99, 4 days ≥ 90, 6 below 50.** The five action thresholds were re-anchored to preserve their
firing rates (45→38, 60→48 at three sites, 75→80), following the `LOW_SLEEP_SCORE` precedent.

Then the suite failed on **7 tests across 4 files**, and three of those failures are not stale
fixtures. They encode invariants the readiness composite genuinely holds:

| invariant | test | why a calibration breaks it |
|---|---|---|
| **Contributions sum to the score** | `score-audit.test.ts` — *"contributions sum to the composite score"* | The audit panel explains the score by listing `weight × sub-score` contributions that add up to it. A transform applied *after* the sum makes them add up to the blend, not the displayed score (got 70, expected 67). |
| **All-neutral input → exactly 50** | `readiness-composite.test.ts` | Every contributor neutral blends to 50; the calibration mapped that to **35**. "Nothing known → neutral" stops being true. |
| **No check-in cannot reach 100** | `readiness-composite.test.ts` | Skipping the check-in caps the blend at 95; the calibration's 88→100 anchor let it reach **100** anyway, defeating a deliberate design property. |

The first is the one that should stop anyone. **The owner's original difficulty in this whole thread
was not being able to see what a change would do.** Shipping a readiness score whose own explanation
panel no longer adds up would make that permanently worse. A range gain is not worth an
explainability loss on the score that drives every training recommendation.

**These were reverted, not rewritten.** Three sleep tests *were* rewritten in v1.319.0, each for a
stated reason — the difference is that those encoded a curve's shape, which the recalibration
legitimately changed, whereas these encode structural properties of the model that nothing in the
brief asked to change.

---

## 2. The second hypothesis, also refuted

If a post-hoc transform is out, the in-model lever is `Z_POINTS_PER_UNIT` — the z→sub-score slope
(currently `50/1.5 ≈ 33.3`, so a contributor reaches 100 at +1.5σ). Raising it widens spread **and**
preserves all three invariants above, because `z = 0 → 50` holds at any slope. It looked like the
right answer.

It is not, and the contributor measurements say why:

| contributor | weight | mean | **sd** | min–max | implied \|z\| p50 / p90 |
|---|---|---|---|---|---|
| restingHeartRate | 0.15 | 62.5 | 21.1 | 0–99 | 0.57 / 1.23 |
| previousNight | 0.16 | 81.3 | 22.6 | 5–97 | — |
| **hrvBalance** | 0.15 | 76.2 | **27.1** | 0–100 | **1.26 / 1.50** |
| temperature | 0.10 | 70.5 | 17.3 | 40–95 | 0.34 / 0.81 |
| **sleepBalance** | 0.10 | 55.4 | **32.3** | 0–100 | 0.75 / 1.50 |
| prevDayActivity | 0.09 | 87.1 | 9.2 | 72–100 | — |
| **recoveryIndex** | 0.09 | **35.3** | 21.7 | 4–100 | — |
| activityBalance | 0.06 | 80.1 | 11.1 | 64–100 | — |
| checkin | 0.10 | 68.1 | 14.3 | 30–88 | — |

**The z-based contributors are already wide and already saturating.** `hrvBalance` has a median
implied |z| of **1.26** against a ceiling at 1.5, and both it and `sleepBalance` already reach the
0 and 100 rails. Raising the slope pushes more days *onto* the rails, which compresses the top and
bottom rather than spreading them.

---

## 3. So why is the composite narrower than its parts?

Individual contributors carry sd 17–32. The composite carries **sd ~11–13**. That is not a defect to
be fixed — it is what averaging nine partly-independent terms does. Taking the weighted sds as
independent gives an expected composite sd of **7.7**; the observed 11–13 is *higher* than that,
because good days really are good across several axes at once.

In other words **readiness is already extracting more spread than independence would give it.** There
is no compression bug here of the kind Sleep had, where a six-point interquartile range came from
curves that mapped every typical input to ~90.

**Measured against the owner's test, readiness is the healthiest of the three pillars:**

| pillar | range | sd | days ≥ 85 | days < 50 |
|---|---|---|---|---|
| Sleep (before v1.319.0) | 31–97 | 11.4 | 27 of 35 | 1 |
| **Readiness** | **29–87** | **13.0** | 1 | 4 |
| Activity | 56–91 | 7.3 | 1 | 0 |

It has genuinely low days (29) and a real spread. Its one weakness is the **ceiling**: 1 of 34 days
reaches 85.

---

## 4. What would actually raise readiness's ceiling — and it is already on the owner's desk

`recoveryIndex` has a mean of **35.3**, the lowest of the nine by 20 points, and it is the term
dragging the top of the distribution down. Raising a 9 %-weighted contributor's mean is worth about
`0.09 × Δmean` on every day.

**That is Q-500** — the Recovery Index anchor, 6 h → 5 h, measured against Oura's own contributor and
waiting on the owner since 2026-08-17. This session had downgraded it to "lower priority, Q-504 fixes
the range wholesale". **That was wrong and is corrected here: Q-500 is the readiness fix, not a
footnote to it.**

It is a modest change — roughly +0.7 points a day, 4 of 26 days crossing a threshold — and that is
the honest size of the readiness problem, once the range hypothesis is dropped.

Note also that readiness will shift on its own from v1.319.0: `previousNight` is 16 % of the weight
and the Sleep Score's mean fell from ~87 to ~70, so readiness's mean drops roughly **1.8 points**
without anything else changing. Re-measure before drawing conclusions from the new numbers.

---

## 5. What did ship here

**One code change: readiness now stamps a model version.**
`READINESS_MODEL_VERSION` in `readiness-composite.ts`, written to
`oura_daily_derived.model_versions.readiness` by the readiness payload.

Two details that matter:

- **It merges rather than replaces.** `model_versions` is one shared JSONB across every pillar on the
  row, and the upsert writes a provided column wholesale — writing `{ readiness: … }` alone would drop
  `bodyBattery`'s stamp. The payload already reads the row, so it spreads the existing object first.
- **This is the gap the Sleep ship left open.** v1.319.0 changed every sleep score with no version
  marker, so its trend chart has an unmarked step. Readiness will not have that problem the next time
  its model moves — which, if Q-500 is approved, is soon.

No version bump: nothing user-visible changed. Readiness scores are unchanged by this PR.

---

## 6. What was not exercised

- **Nothing on-device**, and no displayed value changed.
- **n = 26–34 days**, bounded by how many days carry a persisted readiness row with a full contributor
  set. Seven of 33 could not be reconstructed exactly (they predate the `checkin` contributor or hit
  the Q-501 drift).
- **The contributor table in §2 is the *realised* sub-scores**, so the implied |z| figures are
  back-derived through the current slope. They are exact for the two-sided contributors and are the
  right quantity for the saturation question, but they inherit any error in the stored values (Q-501).
- **The "expected sd 7.7 under independence" figure assumes independence** and is used only to show
  the observed spread is *above* it, which is the direction that matters. It is not a fitted model.
- Every number is **the owner's** (`claude_ro` is row-scoped).
