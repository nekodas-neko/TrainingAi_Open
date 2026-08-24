# 2026-08-24 — the sleep score's swing is real signal; its calibration gain is the actual defect

*Tuning · docs-only · branch `tuning/sleep-calibration-gain`*

Owner: *"the scores have been very varied lately"*. Correct, and it is sleep — stored day-to-day
|Δ| went **9.2 → 21.2** at the recalibration, while readiness moved 11.1 → 12.8 and barely changed.

Reconstructing the pre-calibration weighted blend for all 41 nights that store `sleep_contributors`
settles what caused it. **The blend's night-to-night movement is unchanged: 9.15 before, 9.27
after.** The sleep is genuinely that variable and the model reads it correctly. Two things landed
together on 2026-08-19: the calibration began applying at all (before it the stored score *is* the
raw blend — blend 88.3 → stored 88), and the blend mean fell 87.1 → 71.1, into the steep part of
the curve.

**The real defect is the curve's gain spread — 8-fold.** `SCORE_CALIBRATION` runs 4.00× at blend 79
and 0.50× at blend 92, so a one-point gain in actual sleep quality is worth eight times as much in
one place as another. Six of the last twelve nights landed on the 3.0×/4.0× segments. Filed as
**TN-5** with a uniform-gain replacement (spread 8.0× → 1.0×, displayed mean 87.0 → 85.5 so the
scale is not lifted back toward its old mean, `LOW_SLEEP_SCORE` firing rate unchanged at 2/41).

**The baton's standing advice on this was wrong and has been replaced.** It said to flatten the
74–85 segment if the spread read as jitter. Tested: night-to-night |Δ| goes **13.53 → 13.75**,
marginally worse — a calibration curve has to climb 0→100 across the blend's range, so flattening one
segment steepens another and total movement is conserved. TN-5 is filed explicitly as an
interpretability fix, not a jitter fix, so nobody sells it as the latter.

Readiness and activity both moved too (activity 7.2 → 12.2, which would be a real change of
character for the most compressed score in the app). **Deliberately not filed** — six deltas cannot
tell a change from a run of unusual days. Re-measure at n ≥ 20.

Review: [`docs/reviews/2026-08-24-sleep-score-volatility.md`](../../reviews/2026-08-24-sleep-score-volatility.md).

**Not exercised:** no code ran. SQL against production plus source reading. The blend reconstruction
is validated by matching the stored score to ±1 on every night in both regimes; the candidate curves
were evaluated in Python, not against the shipped TypeScript.
