# The BLE re-key moved two inputs, and both defects were sitting behind a scoring constant

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-509 (recovery-index hours) · Q-510 (resilience coverage gate) · **Lane:** A implements
**Scope note:** both items come off this agent's own follow-up list, not from another lane's queue.
Q-509 is the "re-derive Q-500's anchor on BLE-era nights" item; Q-510 closes the lead Q-508 left open.

Two findings, one theme. Neither is a scoring problem, and **the more useful result is that one of
them explicitly is not** — the readiness code pre-registered what a BLE-only refit would mean before
the data existed, and this is that refit coming back.

---

## 1. Q-509 — the BLE-era Recovery Index refit lands at 3.31 h against a shipped anchor of 5

### 1.1 The pre-registered rule

`readiness-composite.ts` says, above the constant it ships:

> *If a BLE-only refit lands well below 5, the input changed and that is a `devices` finding, not a
> scoring one.*

That was written when only 15 Cloud-era nights existed. There are now **42 BLE-era nights** of stored
`recovery_index_hours`, which is enough to run the refit the comment anticipated.

### 1.2 The refit

BLE-era `oura_daily_summary.recovery_index_hours`, n = **42** (2026-07-07 → 2026-08-18):
mean **2.657 h**, median **2.377 h**, sd 1.591, range 0.35 – 8.28.

Running the same zero-bias procedure Q-500 used — solve for the anchor at which our mean sub-score
equals Oura's 15-night mean of **69.0**, with the same clamping — gives:

| fit | window | n | anchor |
|---|---|---|---|
| Q-500 (shipped basis) | Cloud-era 2026-06-23 → 07-07 | 15 | **4.63 h** |
| this refit | BLE-era 2026-07-07 → 08-18 | **42** | **3.31 h** |

3.31 is *well below 5*. By the repo's own rule, **that is a devices finding, and the anchor should not
move.**

### 1.3 The internal check that makes it convincing

The refit anchor and the input distribution moved by the **same factor**:

| quantity | Cloud-era | BLE-era | ratio |
|---|---|---|---|
| mean hours | 3.59 | 2.657 | **0.74** |
| median hours | 3.28 | 2.377 | **0.72** |
| zero-bias anchor | 4.63 | 3.31 | **0.715** |

If the owner's actual overnight recovery had changed, the anchor and the input would **not** track each
other — a genuine physiological shift moves the hours while leaving the hours→score mapping's correct
anchor where it was. An anchor that has to shrink by exactly the factor its input shrank by is
absorbing a multiplicative bias in the estimator. Moving it would be compensating for a broken input
at the scoring layer, which is what the pre-registered rule exists to prevent.

The mechanism was already measured in the Q-500 review: at matched sampling density (median 107 vs
108 samples/night) the BLE series is about **twice as noisy** — median sample-to-sample |Δbpm| 1.0 →
2.0, mean 1.87 → 3.18.

### 1.4 It is a level shift, not a drift

| month | n | mean h | median h | nights ≥ 5 h |
|---|---|---|---|---|
| 2026-07 | 24 | 2.73 | 2.35 | 2 |
| 2026-08 | 18 | 2.56 | 2.48 | 1 |

Stable across both BLE months. The step happened at the re-key and has not moved since, which is what
a changed measurement looks like and not what a changing person looks like.

### 1.5 What it costs today

With the shipped anchor of 5, over the 42 BLE nights the contributor has mean **50.8**, median 47.5,
and reaches 100 on **3 of 42** nights. (At the old anchor of 6 it was mean 43.4 and 1 of 42 — so
**Q-500 did work**: it lifted this contributor by ~7.4 points, and nothing here argues against it.)

The contributor still sits low, and now there is a reason that is not the anchor.

### 1.6 Proposal

1. **Do not move `RECOVERY_INDEX_OPTIMAL_HOURS`.** Honour the pre-registered rule. A second anchor
   change inside two days, in the same direction, fitted to an input that moved for measurement
   reasons, is how a scoring constant gets quietly re-purposed into a bias correction.
2. **Treat the hours estimator's BLE behaviour as the work item** (`devices`). The estimator is a
   global argmin over an overnight HR series; at 2× the sample-to-sample noise it settles at a
   systematically different point. Smoothing the BLE series to Cloud-like noise **before** the argmin,
   and re-measuring the ratio, is the concrete first experiment — if the ratio goes to ~1.0, the
   estimator is fine and the input needed conditioning.
3. **Re-run this refit after any change to the HR smoothing path**, since the ratio in §1.3 is the
   test for whether it worked.

### 1.7 The caveat that bounds it

The two fits are **different windows and different sizes** (15 Cloud nights against 42 BLE nights, six
weeks apart), so a real seasonal or behavioural change is not excluded by this data alone. What argues
against it is §1.4 — the level is flat across both BLE months — and §1.3, where the anchor tracks the
input rather than moving independently. Neither is proof. The decisive experiment is §1.6.2, which
does not depend on this comparison at all.

---

## 2. Q-510 — resilience's missing days are the stress-coverage gate, and the coverage is not persisted

Q-508 recorded resilience as dormant since 2026-08-05 and named the daily-index gate as the likely
cause, unconfirmed because `/api/admin/db-query` locked out mid-session. It has since recovered, so
this closes that lead.

### 2.1 It is not the contributor gate

`computeResilienceForDay` produces a daily index only when `contributorsOk` holds — sleep score,
recovery index, resting-HR contributor and a positive night-HRV baseline all present — **and** the
daytime stress series clears `preprocessStress`'s coverage check.

Over 2026-08-01 → 08-18, from `oura_daily_summary`:

| gate | days present |
|---|---|
| `recovery_index_hours` | **18 / 18** |
| `hrv_avg_ms` | **18 / 18** |
| `rhr_avg_bpm` | **18 / 18** |
| `hrv_baseline_mean_x8` | **18 / 18** |
| a daytime stress series at all | 14 / 18 (from 08-05) |
| **a resilience daily index** | **3 / 18** (08-09, 08-10, 08-16) |

**All four contributor gates pass on every single day.** So the blocker is inside `preprocessStress` —
either every stress sample fell within a sleep period, or `final_check_stress_coverage`
(`resolutionMinutes × nonNaN ≥ minDaytimeStressHours × 60`) failed. Given `daytime_stress_scaled` is
non-null on 14 of those days, the coverage check is the live candidate.

### 2.2 Why it cannot be confirmed from the database

Neither side of that inequality is persisted. `minDaytimeStressHours` is a vendored constant, and the
per-day non-NaN bucket count is never stored. The extreme-bucket counts that *are* stored do not
separate the cases — 2026-08-07, 08-13 and 08-17 all carry 90 minutes of extremes and produce no
index, while 08-16 carries the same 90 and does.

**`worn_hours_ble` — the field that would answer this — is NULL on all 96 rows**, and was already
recorded as 0 of 79 in the 2026-08-05 review. Thirteen days and seventeen rows later it is still
empty.

### 2.3 Proposal

1. **Persist the daytime-stress coverage on the derived row** — the non-NaN bucket count, or the hours
   it implies. It is one number, it is already computed inside `preprocessStress`, and without it
   "why did resilience not produce a value today" is unanswerable from data. This is the whole item.
2. **Populate `worn_hours_ble`, or drop the column.** A schema field that has never held a value on
   any row is worse than absent — it reads as an available signal in every audit that lists columns,
   and it is the natural place the answer to (1) would be looked for first.
3. Only after (1): decide whether `minDaytimeStressHours` is too strict for this wear pattern. **That
   is a real calibration question and it belongs to Tuning** — but it cannot be asked until the
   coverage is visible, and it must not be guessed at by lowering the constant until the radar fires,
   which is the Q-506 mistake.

---

## 3. What was not exercised

- **No code changed and nothing ran on-device.** No constant was altered.
- **§1's refit was not validated against ground truth**, because none exists after the re-key — Oura
  Cloud stops at 2026-07-07. The 69.0 target is carried over from the 15 Cloud-era nights on the
  assumption that the owner's long-run mean recovery did not step-change at the re-key. That
  assumption is the load-bearing one and it is stated rather than tested.
- **§1.6.2's smoothing experiment was not run** — it needs the raw overnight series and the estimator
  harness, which is a code task rather than a query.
- **§2.1's conclusion is by elimination**, not by observing the coverage check fail. The four
  contributor gates are measured; the coverage check is inferred as the remaining candidate.
- Every figure is **the owner's** (`claude_ro` is row-scoped), pulled 2026-08-18.
