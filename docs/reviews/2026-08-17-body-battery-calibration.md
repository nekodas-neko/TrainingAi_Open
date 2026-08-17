# Body Battery calibration — the charge window, and why Q-272's ratio cannot be read at face value

**Date:** 2026-08-17 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Status: PARTIAL — the backtest Q-272 asks for is NOT done.** Filed as **Q-502**.
**Companion:** [`docs/reviews/2026-08-17-readiness-calibration.md`](2026-08-17-readiness-calibration.md) ·
methodology: [`docs/body-battery-tuning.md`](../body-battery-tuning.md)

This is a partial result published deliberately rather than held. It establishes two things Q-272
needs and refutes the approach Q-272 recommends taking first. It does **not** produce a tuned
constant, and nothing here should be implemented.

---

## 1. Q-272 re-measured, and it holds

Grouping `claude_ro.body_battery_daily` by `model_version` (49 days now, against the review's 40):

| model_version | n | charge/day | drain/day | ratio | hit 0 | ended at daily min |
|---|---|---|---|---|---|---|
| `v1:rest0.05:chg0.4:drn0.6` | 16 | 24.3 | 25.2 | 1.0× | 0 | 4 |
| `v2:…str0.2` | 1 | 1.0 | 30.0 | 30× | 0 | 1 |
| `v4:…chg0.4:drn0.6:str0.2:oura-rule` | 18 | 34.9 | 30.3 | 0.9× | 0 | 7 |
| **`v5:…chg0.2:…hrmax-observed`** | **14** | **9.7** | **54.5** | **5.6×** | **4** | **10** |

The finding stands and has got slightly worse with two more days (5.0× → 5.6×, 3 → 4 zero days).
`end_value == day_min` on **10 of 14** v5 days.

---

## 2. The charge window is barely reachable, and this is the part Q-272 misses

`app/api/body-battery/route.ts:283-288`:

```ts
if (hrr <= REST_THRESHOLD) delta =  CHARGE_RATE * (1 - hrr / REST_THRESHOLD) * dt
else                       delta = -DRAIN_RATE  * (hrr - REST_THRESHOLD)     * dt
```

The two arms are not symmetric in *reach*. Charging is confined to `hrr ∈ [0, 0.05]` **and** is
triangular inside it — full rate only at `hrr = 0`, zero at the threshold. Draining owns
`hrr ∈ (0.05, 1]`, twenty times the width, and grows linearly across all of it.

On v5 days `hr_max` is **168 on every single day** and resting HR is 53–55, so the reserve is ~114
and the charge ceiling is **~59–61 bpm**. Measured over every waking HR sample on the 14 v5 days:

| date | waking samples | % in charge window | mean `hrr` | charge ceiling |
|---|---|---|---|---|
| 08-04 | 3,991 | 4.2% | 0.318 | 60.7 bpm |
| 08-06 | 1,645 | 11.1% | 0.164 | 60.7 |
| 08-09 | 727 | 27.5% | 0.142 | 59.7 |
| 08-10 | 318 | 27.4% | 0.095 | 59.7 |
| 08-13 | 5,612 | 1.7% | 0.250 | 59.7 |
| **08-14** | 8,725 | **0.8%** | 0.262 | 58.8 |
| 08-17 | 2,436 | 4.6% | 0.249 | 58.8 |

Across all 14 days the charge window covers **0.8% – 27.5%** of waking samples, median ≈ 6.7%, and
mean `hrr` sits at 0.10–0.32 — an order of magnitude above the threshold.

**Consequence for Q-272's preferred direction.** Its direction #1 is *"raise `CHARGE_RATE` back
toward v4 and keep v5's `hrmax-observed` reserve"*. Raising `CHARGE_RATE` scales a term that is
active on a median 6.7% of samples and is triangular-weighted within even that. It cannot restore
daytime recovery on a day like 08-14, where 0.8% of waking samples qualify — there is almost nothing
for the larger constant to multiply. **The reachability of the window is the lever, not the rate
inside it**, and that means `REST_THRESHOLD` (or the reserve that defines it) is the constant to
examine first. Q-272 does not consider either.

This is a refutation of an approach, not a proposed replacement. Picking a threshold needs the
backtest in §4, which is not done.

---

## 3. The stored snapshots are partial days, so the ratio in §1 is not a clean measurement

`GET /api/body-battery` computes on read and writes through, so each day's row is **as of the last
time the app was opened that day** — a caveat `docs/body-battery-tuning.md` already records for
`end_value`. It applies to `total_charged` / `total_drained` too, and the spread is severe.

Comparing `body_battery_daily.hr_sample_count` against the samples actually present in
`oura_heartrate` for the same waking window:

| date | stored `hr_sample_count` | samples available | coverage |
|---|---|---|---|
| 2026-08-04 | 74 | 3,991 | **1.9%** |
| 2026-08-16 | 64 | 2,656 | **2.4%** |
| 2026-08-11 | 125 | 1,451 | 8.6% |
| 2026-08-05 | 3,673 | 4,151 | 88% |
| 2026-08-14 | 5,390 | 8,725 | 62% |

This is not `preferStrapBuckets` (`packages/shared/src/health/hr-window-merge.ts`) thinning the
series — that only drops ring rows inside a bucket a chest-strap row already covers, and cannot turn
3,991 into 74. It is capture time.

**Why this biases the ratio rather than just adding noise.** Draining is spread across the whole
waking day; the charge window is concentrated in genuine rest, which is back-loaded into the evening.
A snapshot taken at midday therefore captures a larger share of the day's drain than of its charge.
Two of the 14 v5 days carry under 3% of their available samples. **So the 5.6× is an upper bound of
unknown tightness, not a measured property of the model** — and the same objection applies to the
v1/v4 rows it is compared against, which were captured under the same read-through rule.

Q-272's table is still directionally right — §2 gives an independent structural reason for the
asymmetry that does not depend on capture time at all — but the specific multiplier should not be
quoted as if it were the model's behaviour over a complete day.

---

## 4. What is NOT done, and the harness failure that stopped it

**The backtest Q-272 asks for — replaying candidate constants over the stored HR series — is not
done, because the replay does not reproduce production and was not published on that basis.**

Replaying the documented walk against `oura_heartrate` predicted, for 2026-08-04, **65.4 points of
charge and 63.3 of drain**, against stored values of **7 and 10**. Two causes, one understood and
one not:

1. **Partial-day capture (§3).** The stored row saw 74 samples; the replay saw 3,991. This accounts
   for the bulk of the gap and means the two are not measuring the same interval.
2. **Unresolved.** Even after allowing for that, the replay's charge/drain *ratio* (≈1.03 on 08-04)
   is nothing like the stored 0.7. Whether the remainder is the stress-drain term
   (`STRESS_DRAIN_RATE`, which the replay omits — `total_drained` folds it in and it is not stored
   separately), the `GAP_HOLD_MIN` / `SAMPLE_CAP_MIN` handling, or the anchor/reserve inputs
   differing from the stored ones, was not established.

The method that *would* settle it is worked out and worth keeping: define per day
`C = Σ (1 − hrr/0.05)·dt` over charging samples and `D = Σ (hrr − 0.05)·dt` over draining ones, so
charge = `CHARGE_RATE · C` and drain = `DRAIN_RATE · D`, and the balancing rate is
`DRAIN_RATE · D / C`. Computed on the full series that gives 0.17–0.93 across 12 of 14 days
(2.29 on 08-17) — but those inputs are the ones §4.1 shows do not match production, so **the numbers
are not usable and are recorded only so the next session does not re-derive the algebra.**

**A replay must reproduce the stored values before any counterfactual built on it means anything.**
That check is what made the readiness work trustworthy; here it failed, and the honest outcome is a
partial document.

---

## 5. What the next session should do

1. **Establish why the replay diverges** before anything else — start by reconstructing a day with
   near-complete capture (2026-08-05, 88%) rather than a 1.9% day, and add the stress-drain term.
2. **Then test `REST_THRESHOLD` / the reserve, not `CHARGE_RATE` first** — §2 is the reason.
3. **Consider whether the read-through snapshot should be the tuning substrate at all.** §3 says it
   is a biased sample of each day. `docs/body-battery-tuning.md` already floats "a scheduled
   end-of-day recompute would remove this dependency if rigour demands it". Rigour now demands it:
   without it, every future Body Battery calibration inherits this bias, and no constant can be
   fitted against a target that moves with when the owner happened to open the app.
4. Per Q-273, **stamp a model version** before changing anything, or the before/after is
   uninterpretable. `MODEL_VERSION` already does this for Body Battery — it is the one pillar that
   does, and it is why §1 could be split by version at all.

## 6. What was not exercised

Nothing on-device; no code changed. Every number is **the owner's** (`claude_ro` is row-scoped),
over 2026-06-30 → 2026-08-17 for the version split and the 14 v5 days for everything else. The
stress-drain term was not modelled. `rr_intervals` and `daytime_stress_scaled` — Q-272's direction
#2 — were not touched at all. Fourteen days is a small sample for a per-day ratio, and two of them
carry under 3% capture.
