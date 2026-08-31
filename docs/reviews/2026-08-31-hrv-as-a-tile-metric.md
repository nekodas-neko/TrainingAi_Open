# Is HRV reliable, is it a better tile metric than HR, and is there a stable band? — 2026-08-31

*Tuning · production data pulled 2026-08-31. Amends [`TN-13`](../implementation-backlog.md) with a
negative result. Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner: *"how reliable is HRV as a stat? would that be a better metric to show on the home screen
pillar instead of HR? do we have a pretty stable HRV band to depict deviation outside it?"*

Three questions, three measurements. **The answers are: reliable enough, no, and yes-with-a-caveat.**

---

## 1. How reliable is HRV here?

**Coverage is not the problem** — `hrv_avg_ms` is present on **57 of 58** summary nights.

| | overnight HRV | resting HR (low) |
|---|---|---|
| mean | 55.62 ms | 53.90 bpm |
| sd | 9.59 | 3.32 |
| **coefficient of variation** | **17.2 %** | **5.6 %** |
| night-to-night \|Δ\| | **7.42 ms** (13 % of mean) | 2.43 bpm |
| lag-1 autocorrelation | **+0.439** | +0.492 |
| \|Δ\| ÷ sd (1.13 = white noise) | **0.77** | 0.69 |

**HRV is real signal, not noise** — a white-noise series would give \|Δ\|/sd ≈ 1.13 and an
autocorrelation near zero; HRV reads 0.77 and +0.439, so roughly **19 % of tonight is predicted by
last night**.

**But it is the noisiest vital in the set.** A 17.2 % CV against resting HR's 5.6 % means a single
night's HRV is a weak reading — a 7 ms move is an ordinary night, not an event. **This is inherent to
overnight HRV and is not a defect in the app.**

---

## 2. Would it be better than HR on the tile? **No — and the comparison is not close**

Compared in **contributor form** (0–100, baseline-relative), which is the only fair test since
[the 2026-08-26 review](2026-08-26-hr-tile-and-activity-pacing.md) established that raw-vs-relative
matters more than the choice of metric. Against the owner's check-in — **negative r is correct**,
`provisional` rows excluded:

| contributor | vs `perceived_recovery` | vs `sleep_quality_feel` | vs the composite |
|---|---|---|---|
| **restingHeartRate** | −0.273 | **−0.478** | **−0.491** (n = 40) |
| hrvBalance | −0.286 | −0.274 | **−0.331** (n = 39) |

**And it is barely a choice between two signals at all**: the two contributors correlate **+0.751
with each other — 56 % shared variance**. Swapping HRV in loses about a third of the correlation and
buys very little that HR does not already carry.

**Recommendation: keep resting HR on the tile.** HRV earns a place on a detail screen, where a weak
single-night reading can sit next to a trend line that makes it meaningful. Recorded on TN-13 as a
closed question.

---

## 3. Is there a stable band? **Yes, and the app already maintains it — with one caveat**

`hrv_baseline_mean_x8` / `hrv_baseline_dev_x8` are live and, unusually for this codebase, **roughly
right**:

| | HRV | (temperature, for contrast) |
|---|---|---|
| stored baseline sd | 7.13 ms | 1.714 °C |
| true nightly sd | 8.66 ms | ~0.14 °C |
| **ratio** | **0.82×** | **~12×** |

So a usable band today is about **47–64 ms** (mean 55.6 ± 1 sd), and unlike the temperature object
the width does not need fixing.

### ⚠ The caveat: the baseline lags because the owner's HRV is genuinely rising

Measured over the window (2026-07-08 → 2026-08-31, 57 nights):

| | first half | second half | trend |
|---|---|---|---|
| HRV | 52.46 ms | 58.67 ms | **+6.21 ms** |
| resting HR (low) | 55.36 bpm | 52.49 bpm | **−2.87 bpm** |

**Both move the healthy way together, which is what makes this a real fitness gain rather than drift
in one sensor.** An EMA necessarily sits below a rising metric, so **77 % of the last 30 nights read
above the HRV baseline** and it lags the recent 30-night mean by **−3.35 ms (−0.39 sd)**.

**A naive "outside your band" alert would therefore fire high-side most nights.** Any band UI needs
either a trend-aware baseline or a two-sided band that treats "above" as unremarkable.

### This resolves an apparent contradiction with BF-13, in BF-13's favour

A first pass here read the HRV baseline as **+0.62 sd** off-centre, which would contradict BF-13's
finding that **only** the temperature baseline is measurably wrong (*"the other five are ≤0.28 sd"*).
Both are right; they measure different things. **BF-13's method — today's baseline against the
whole-history mean — gives HRV −0.01 sd and resting-HR-low −0.24 sd, so BF-13 stands.** The "+0.62"
is *% of nights above*, which on a trending metric measures the trend, not an error. **The baton's
existing rule already said this** and it was nearly re-filed as a defect anyway.

---

## A near-miss worth recording

The RHR baseline was first measured as **100 % of nights above, +9.33 bpm (+2.66 sd)** — which would
have been a temperature-scale defect in a second consumer. It was wrong: `daily-summary.ts:103` feeds
the baseline **`rhrLowBpm`**, not `rhr_avg_bpm`. Against the correct column the gap is **+0.53 bpm
(+0.16 sd)** — centred. **Read which column feeds a baseline before comparing anything to it**; this
is the same class as the `tempZ`-vs-`temp_dev_c` near-miss on 2026-08-31.

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. Every
correlation is same-day and single-subject (n = 39–51), and the check-in fields are 5-point ordinals
treated as continuous. **The trend is described, not tested for significance**, and a two-month
window cannot separate a training adaptation from a seasonal one.
