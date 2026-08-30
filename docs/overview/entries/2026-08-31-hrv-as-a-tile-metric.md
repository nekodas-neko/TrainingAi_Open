# 2026-08-31 — HRV is reliable enough, is not a better tile metric than HR, and has a usable band that lags

**Tuning · docs-only.** Three owner questions about HRV, each measured.
Full working: [`docs/reviews/2026-08-31-hrv-as-a-tile-metric.md`](../../reviews/2026-08-31-hrv-as-a-tile-metric.md).

## Reliable enough, and the noisiest vital in the set

Present on **57 of 58** nights. **CV 17.2%** against resting HR's **5.6%**; night-to-night swing
**7.42 ms**, 13% of the mean. It is **real signal, not noise** — lag-1 autocorrelation **+0.439** and
a \|Δ\|/sd of 0.77 against 1.13 for a white-noise series, so ~19% of tonight is predicted by last
night. A single night's HRV is simply a weak reading, which is inherent to the measure.

## Not a better tile metric — TN-13 keeps resting HR

Compared in contributor form (the only fair test) against the check-in, negative r correct:
**restingHeartRate −0.491** against **hrvBalance −0.331**. And the two contributors correlate
**+0.751 with each other — 56% shared variance** — so it is barely a choice between two signals.
Recorded on TN-13 as a **closed question** rather than left for someone to re-run.

## The band exists and is the right width, but it lags a real improvement

Stored HRV baseline sd is **7.13 ms against a true 8.66 — 0.82×**, which is sound (temperature's
equivalent is ~12×). A usable band is **47–64 ms**.

**It lags because the owner's HRV is rising**: +6.21 ms across the window while resting HR falls 2.87
bpm — both moving the healthy way together, which is what makes it a fitness gain rather than sensor
drift. So 77% of recent nights sit above the baseline and **a naive out-of-band alert would fire
high-side most nights**.

## Two corrections that went the other way

**BF-13 stands.** A first pass read the HRV baseline as +0.62 sd off-centre, contradicting BF-13's
*"only temperature is measurably wrong"*. Both measurements are right and measure different things —
BF-13's method (today's baseline vs whole-history mean) gives HRV **−0.01 sd**. The +0.62 is *% of
nights above*, which on a trending metric measures the trend.

**A near-miss:** the RHR baseline first read as 100% of nights above, +2.66 sd — a temperature-scale
defect in a second consumer. Wrong: `daily-summary.ts:103` feeds it **`rhrLowBpm`**, not
`rhr_avg_bpm`. Against the correct column it is **+0.16 sd — centred.**

## Verification

`pnpm check:rules` — see PR. `check-backlog-pointers` OK. **Failure surfaces not exercised: all of
them.** No code ran — SQL against production plus source reading; no `pnpm dev`, no device, no APK.
Correlations are same-day, single-subject, n = 39–51, on 5-point ordinals treated as continuous. **The
trend is described, not significance-tested**, and two months cannot separate a training adaptation
from a seasonal one.
