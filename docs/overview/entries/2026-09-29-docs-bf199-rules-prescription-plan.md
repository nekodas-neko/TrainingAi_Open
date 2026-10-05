# 2026-09-29 — BF-199 planned: the prescription's numbers from rules, the model kept for the prose

**Lane A · docs-only planning PR.**

- **Plan:** `docs/superpowers/plans/2026-09-29-rules-prescription-engine.md`. Three phases, each
  shippable alone:
  - `BF-199`: shadow the existing `buildRulesPrescription` beside every model call and measure,
    including how often the model's phase survives reconciliation, which nobody has measured.
  - `BF-199b` (`Needs: BF-199, BF-201`): rules own sets, reps, pct and rest; the prose call becomes
    non-blocking.
  - `BF-199c`: represcribe on the device with no round trip.
- **Why this shape:** the rules prescriber already exists (it is the model-failure fallback and
  BF-198's Full revert). Sets are already the budget fitter's (2 in all 33 stored tuples),
  reps/pct already follow a curve, and rest is the only free model output and the noisy one (23
  values from 68 to 300 s).
- **Deliberately not decided:** the rep→%1RM table's values. That is calibration, with Tuning under
  BF-201 decision 2; the plan recommends the observed curve so day one changes nothing.
