## 2026-08-18 — Readiness should NOT get a range calibration (Tuning; Q-504 refuted)

Follows the Sleep recalibration (v1.319.0) in the owner's range-tuning pass. Q-504 said readiness had
the same problem and the same fix was measured and ready. **It was implemented, and it is wrong.**
Evidence: [`docs/reviews/2026-08-18-readiness-range-refuted.md`](../../reviews/2026-08-18-readiness-range-refuted.md).

**The calibration produced the target distribution** (mean 66.8, sd 19.1, range 17–99) and then the
suite failed on 7 tests across 4 files. Three encode invariants the composite genuinely holds:
**contributions must sum to the displayed score** (the score-audit panel's entire job — it gave 70
against 67), **all-neutral input must give exactly 50** (it gave 35), and **skipping the check-in must
cap below 100** (it reached 100). The first is disqualifying on its own: readiness drives every
training recommendation, and the owner's difficulty throughout this thread was *seeing what a change
does* — shipping a score whose explanation no longer adds up makes that permanently worse. Reverted,
not rewritten.

**The in-model lever fails too.** `Z_POINTS_PER_UNIT` would widen spread while preserving all three
invariants, but the z-based contributors are already wide and already saturating: `hrvBalance` sd
**27.1** with median implied |z| **1.26** against a 1.5 ceiling, `sleepBalance` sd **32.3**, both
hitting the 0 and 100 rails. Raising the slope compresses the ends.

**There is no compression bug.** Contributors carry sd 17–32; the composite sd ~11–13, against **7.7**
predicted if they were independent — so readiness already extracts more spread than independence
gives. Against the owner's test it is the healthiest of the three pillars (range 29–87, sd 13, with
genuinely low days), unlike Sleep's 27-of-35 above 85.

**Its real weakness is the ceiling** — 1 of 34 days ≥85 — and the term dragging it down is
`recoveryIndex`, **mean 35.3**, lowest of the nine by 20 points. That is **Q-500**, which this session
had demoted to "lower priority". Corrected: Q-500 *is* the readiness fix.

**Shipped:** the readiness `model_version` stamp (Q-273's readiness half), merged into the shared
`model_versions` JSONB rather than replacing it so `bodyBattery`'s stamp survives. Sleep shipped
without one and left an unmarked trend step; readiness will not repeat that.

**Verification.** Full suite **3,352 passed**; `check:rules` 38/38; typecheck clean. No version bump —
nothing user-visible changed and readiness scores are unchanged by this PR (they do move ~1.8 points
on their own from v1.319.0's sleep change feeding `previousNight`).

**Not exercised.** Nothing on-device. n=26–34 days; seven of 33 could not be reconstructed exactly
(they predate the `checkin` contributor or hit the Q-501 drift). The implied-|z| figures are
back-derived through the current slope and inherit any error in the stored contributor values.
