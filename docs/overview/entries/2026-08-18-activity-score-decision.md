## 2026-08-18 — Activity Score is scoring your last week, not your day (Tuning, docs-only)

Third of the three pillars in the owner's range-tuning pass, after Sleep (shipped, v1.319.0) and
Readiness (held as Q-504). Evidence:
[`docs/reviews/2026-08-18-activity-score-calibration.md`](../../reviews/2026-08-18-activity-score-calibration.md).
Filed as **Q-505, blocked on an owner decision** — not sign-off on a number, a decision about what
the score is for.

**Measured.** n=22, range 56–91, mean 74.6, **sd 7.2**, 11 of 22 days in the 70s. Against same-day
steps **r = +0.417**, and the pair that makes it concrete: **2026-08-12 scored 76 on 828 steps while
2026-08-16 scored 64 on 8,935.** Steps span 29× across the window; the score moves 25 points.

**Why.** `strengthFreq` (25) + `strengthVolume` (20) are 45 of 100 and both roll over 7 days — and
the owner has logged exactly one session per day for 27 consecutive days, so `strengthFreq` is
near-constant by construction. Meanwhile `activeCalories` is non-null on **1 of 47 days** and
zone-2+ minutes are **0 on 22 of 27**, so both get excluded and the weights renormalise to roughly
60% on the near-constant terms, leaving steps — the most variable input in the model — at ~24%.
Separately, `adjustment` is 0 on all 22 days: `ACWR_TAPER_START = 1.5` has never been reached, so the
only place ACWR enters this score is inert.

**The important negative result: the Sleep technique does not transfer.** A range calibration
preserves ranking, so stretching this score would make the "828 steps beat 8,935 steps" ordering
*more* emphatic. A score that compresses a correct ranking can be stretched; one whose ranking
disagrees with its most variable input cannot.

**The decision.** (a) score *today* — re-weight toward the same-day lane, accept volatility; or
(b) score *recent training* — keep the weights, accept that flatness is correct for a consistent
trainer, and fix the daily framing presentationally. Tuning recommends (a) and says why, but it
changes what the number means rather than how accurate it is, so it is the owner's call.

**Not exercised.** Nothing on-device, no code changed. n=22 is small and bounded by Q-278 (the score
is absent on over half of days). `moveHours` availability was not measured — if it is as sparse as
`activeCalories`, the strength lane's real share is higher and the finding understates the problem.
Contributor sub-scores are not persisted, so the weight arithmetic was derived from the constants
plus measured input availability rather than read back.
