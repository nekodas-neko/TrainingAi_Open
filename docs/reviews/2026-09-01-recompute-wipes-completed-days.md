# A recompute overwrote a completed day with an empty result — 2026-09-01

*Tuning · production data pulled 2026-09-01. Files **TN-20** and **TN-21**, and **corrects a claim
this agent published on 2026-08-31** in TN-19. Propose-only. Counts are the owner's account only
(`claude_ro` is row-scoped).*

Owner: *"is the battery + stress system working correctly?"*

**No — and the most serious problem is not calibration. A completed day was recomputed into garbage
after the owner had already seen it correct.**

---

## 1. TN-20 — 2026-08-31 was rewritten, and the inputs to rebuild it still exist

**This agent observed both states within 24 hours**, which is what makes it provable rather than
inferred:

| `body_battery_daily` for 2026-08-31 | read 2026-08-31 ~02:00 UTC | read 2026-09-01 |
|---|---|---|
| anchor | 55 | 55 |
| end_value | **0** | **55** |
| total_drained | **113** | **0** |
| hr_sample_count | **3,643** | **0** |

The owner's own screenshot at 21:45 Brisbane on 2026-08-31 shows *"+0 charged · −113 drained"*, so
**the correct value was computed and displayed.** The row's `updated_at` is 2026-08-31 12:43 UTC —
about an hour after that screenshot — and it now stores a day that never happened.

**The raw data was never missing.** `oura_heartrate` holds **3,815 samples** for 2026-08-31.

### The derived row went the same way, and further

| `oura_daily_derived` for 2026-08-31 | earlier | now |
|---|---|---|
| readiness_score | **55** | **25** |
| sleep_score | **56** | **15** |

**A sleep score of 15 is not defensible against its own stored summary**: `oura_daily_summary` for
that night holds **7.83 h**, HRV **54.5**, RHR **63.9**. Its neighbours calibrate it — 2026-08-30
(7.92 h, HRV 72) scored **69**, and 2026-09-01 (7.50 h, HRV 65) scored **54**. A normal night is
stored as the worst night on record.

All four recent derived rows were rewritten in one pass on **2026-09-01 03:58–05:13 UTC**. Two came
out sane; 08-31 came out at 25/15.

### It is not a one-off — 3 of the last 11 days

Raw samples against what the battery row stored:

| date | raw HR samples | stored count | drained | end vs anchor |
|---|---|---|---|---|
| 2026-08-22 | **265** | **0** | **0** | 72 = 72 |
| 2026-08-26 | **1,954** | **0** | **0** | 53 = 53 |
| 2026-08-31 | **3,815** | **0** | **0** | 55 = 55 |
| (every other day) | 167–3,572 | 93–3,378 | 13–79 | drops |

On every healthy day the stored count sits slightly **below** the raw count, which is expected —
the walk windows to waking hours. **Zero against thousands is a different failure.**

> ### ⚑ This retracts evidence published in TN-19 on 2026-08-31
>
> TN-19 states: *"2026-08-26 is the cleanest Q-521 demonstration available: zero HR samples → zero
> drain, zero charge, ending exactly at its anchor. No wear, no change."*
>
> **That is wrong. 2026-08-26 has 1,954 raw HR samples.** The zero was this bug, not an absence of
> wear, and it was used as evidence *for* the wear-time story. **Q-521's wear-time finding still
> stands on its own correlations** (`corr(hr_sample_count, drained)` = +0.518 over a longer window) —
> what falls is the illustration, not the conclusion. The lesson is the one this repo already
> records and this agent still walked into: **a stored counter is a claim about the data, not the
> data.** Cross-check against the raw table before quoting a zero.

---

## 2. TN-21 — "daytime stress" is 55% night, and night and day carry opposite signs

`oura_daytime_stress_buckets` has been persisting since 2026-08-24 (TN-3a's half that shipped), so
the per-bucket series is testable for the first time: **230 buckets over 9 days.**

**It covers all 24 hours.** Buckets exist for every hour except 07:00, and **126 of 230 (55%) fall
between 22:00 and 06:00.**

| window | buckets | mean level |
|---|---|---|
| night (22:00–06:00) | 126 | **+0.266** (recovered) |
| day (06:00–22:00) | 104 | **−0.413** (stressed) |

**The two halves point in opposite directions, and the night half is the majority.** Any daily
aggregate over this series is therefore governed by the night/day *mix* — which varies with sleep
duration and ring wear — as much as by stress. The daytime hours are also thinly sampled (2 buckets
at 08:00, 6 at 09:00) because the ring power-gates its PPG when worn-idle, while sleep is sampled
densely.

### A mechanism candidate for Q-507, and it is the reverse of the one already refuted

| | r (n = 9) |
|---|---|
| **total buckets ~ `stress_high_minutes`** | **−0.784** |
| day buckets ~ `stress_high_minutes` | −0.543 |
| night fraction ~ mean level | −0.578 |

**Fewer buckets produce MORE "high stress" minutes.** 2026-09-01 has the fewest buckets (21) and the
most high-stress minutes (150); 2026-08-26 has the most buckets (29) and zero. Each bucket is scored
against *the day's own median*, so a sparse day computes that median from fewer points and more
buckets land far from it.

**⚠ This is a candidate, not a conclusion, and n = 9.** It is worth recording because it is
**opposite in direction to the data-density hypothesis this agent tested and refuted on 2026-08-26**
(r = −0.128 of stress minutes against *HR sample count*). Sample count and bucket count are not the
same quantity, and the bucket count is the one the model actually divides by.

---

## 3. So: is it working correctly?

**Body Battery — no, on three separate counts**, in descending severity:
1. **Completed days get overwritten with empty recomputes** (TN-20). New; not previously filed.
2. Drain integrates **wear time**, not exertion (Q-521), and there is **no overnight recharge at
   all** (TN-15).
3. The anchor inherits readiness's **−16 pt/day temperature penalty** (TN-6/TN-6a).

**Daytime stress — no.** It is 55% night data under a daytime label (TN-21), and its daily scalar
still correlates the wrong way with readiness and sleep (Q-507), now with a coverage-artifact
candidate to test.

**Nothing in the chain has shipped** — TN-15, TN-18, TN-6a, TN-6, TN-2 were all still queued as of
2026-08-31.

---

## Failure surfaces not exercised

No code ran — SQL against production, source reading, and the owner's screenshot. No `pnpm dev`, no
device, no APK. **The before/after for 2026-08-31 comes from two reads by this agent 24 hours apart,
not from an audit log** — nothing stores the prior value, so the mechanism that rewrote it is
**not identified**, only its effect. `n = 9` days for every stress correlation here, which is small
enough that the −0.784 should be treated as a lead rather than a result.
