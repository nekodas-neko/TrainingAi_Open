## 2026-08-17 — Body Battery: the charge window measured, and Q-272's substrate found biased (Tuning)

**Docs-only.** No code changed, no constant moved. Filed **Q-502**; annotated **Q-272**.

Second piece of Tuning work this day, after the readiness Recovery Index calibration. Deliberately
**partial**: the backtest Q-272 asks for is not done, and the document says so rather than shipping a
constant fitted on a replay that failed its own validation.

**Q-272 re-measured and it holds** — 5.6× drain:charge on 14 v5 days (was 5.0× on 12), ends at its
daily low on 10 of 14, hits zero on 4.

**Two findings that change how to work it:**

- **Direction #1 is refuted.** Q-272 recommends raising `CHARGE_RATE` first. The charge arm is
  confined to `hrr ∈ [0, 0.05]` and triangular within it, while drain owns the other 95% of the
  range. On v5 days `hr_max` is 168 every day, so charging needs HR at or below ~59 bpm: measured,
  the window covers **0.8%–27.5%** of waking samples, median ~6.7%. Raising the rate scales a term
  that is barely active. `REST_THRESHOLD`/the reserve is the lever.
- **The tuning substrate is a biased sample (Q-502).** `body_battery_daily` is written on read, so
  each row is as of the last app open. Coverage against the samples actually available ranges from
  **1.9%** (2026-08-04: 74 of 3,991) to 88%. Since rest is back-loaded into the evening and drain is
  spread across the day, a midday snapshot over-weights drain — so 5.6× is an upper bound of unknown
  tightness, and so are the v1/v4 rows it is compared against.

**What stopped it.** The replay of the documented walk predicted 65.4 charge / 63.3 drain for
2026-08-04 against stored 7 / 10. Partial-day capture explains most of it; the residual ratio
difference does not, and was not resolved. Per the rule that made the readiness work trustworthy — a
replay must reproduce stored values before any counterfactual on it means anything — the backtest was
withheld rather than published. The balancing-rate algebra is recorded so the next session does not
re-derive it, explicitly marked unusable.

**Not exercised.** Nothing on-device; no code changed. Every number is the owner's (`claude_ro` is
row-scoped). The stress-drain term was not modelled, and `rr_intervals` / `daytime_stress_scaled`
(Q-272's direction #2) were not touched.
