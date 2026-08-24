# 2026-08-24 — the owner's decisions, and which of the six baselines actually needs re-deriving

*Tuning · docs-only · branch `tuning/baseline-seed-scope`*

The owner asked to be told plainly when their input was the blocker. Two rounds of that, both
answered, and the second produced a measurement worth keeping.

**Round one — the three scoring decisions.** TN-5 and TN-6 signed off. TN-6 also gets an interim,
**TN-6a**: suspend the temperature penalty while the baseline is demonstrably uncentred, gated on a
self-clearing condition rather than a date or a comment, and deliberately outside the
`temperature-baseline` batch so it ships first. History policy across all three: **leave stored days
alone and stamp the new model.** That policy leans on a stamp Q-518 says a sibling writer erases
within hours — so Q-518 stopped being a tidy-up and became load-bearing.

**Round two — BF-13's owner gate.** BugFix's entry carries the real root cause (`updateBaseline`
seeds the mean at literal zero) and was gated because re-deriving stored baselines is a data change.
Asked and answered: **re-derive**, on the reasoning that a baseline is a corrupted intermediate
rather than a record of what the app displayed — a different act from re-scoring history, so it does
not contradict the policy set an hour earlier. Scope: **fix the seed for all six baselines, re-derive
only what is measurably wrong.**

**So it was measured, and only one is wrong.** Converting each baseline to native units with the
factors at its own call site (`daily-summary.ts:102-112`):

| metric | gap / nightly sd | % nights above | verdict |
|---|---|---|---|
| **temp** | **+2.80** | **100.0%** | **re-derive** |
| rhr | +0.28 | 36.7% | leave |
| breath | +0.27 | 77.6% | leave |
| sleep | +0.06 | 57.1% | leave |
| hrv | +0.04 | 87.8% | leave |
| met | −0.09 | 44.0% | leave |

That confirms BF-13's own hypothesis by measurement rather than assumption: the zero seed leaves a
similar absolute gap in fixed-point units everywhere, and only temperature's nightly sd (0.140 °C) is
tight enough for it to land 2.8 sd out.

**A near-miss worth copying.** The first pass inferred each fixed-point scale as the best-fitting
power of ten. Right for temp (×100), **wrong for sleep, which is ×60** — it produced a "baseline
4.768 h against a true 8.010, 98% of nights above" that read exactly like a second severe defect.
Acting on it would have meant an unnecessary production data change to the sleep baselines, which is
the single category of mistake that owner gate exists to prevent. **Read the factor at the call site;
never infer it.** All six are within four lines of each other.

**Not exercised:** no code ran — SQL against production plus source reading. No `pnpm dev`, no
device. The re-derivation itself is Lane A's to build and verify.
