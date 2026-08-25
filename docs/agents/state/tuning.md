# 🎶 Tuning Agent — baton

> **Successor sessions are titled `🎶 Tuning Agent 🟢`** — exactly, both emoji. Leading emoji = role,
> trailing = this session's status, set by the session itself. See `docs/agents/README.md` §4.

**Updated:** 2026-08-26 · **By:** `session_01VVfZtbCftbwaUHtBLJoxVr` · **Next ID:** `TN-17`.
Find next free: `grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy `Q-` numbers
stay valid. **Rewritten in full, never appended** — narrative lives in the linked reviews.

**Compacted 2026-08-24 from 582 lines** (the PS-4 outlier). Everything cut is in the reviews below.

## Now

**Nothing is blocked on the owner, and nothing is blocked on you.** Every decision these batches
needed was asked plainly and answered — 2026-08-24 for TN-5/TN-6/TN-6a and the history policy,
2026-08-26 for TN-9's intent and **TN-15's redesign**. TN-2's offset is the only thing still open,
and it is a fit Lane A must run, not a decision.

**The owner's standing verdict, 2026-08-26:** *"Overall the pillars are not working great and not
very useful. Requires tuning."* Read that as the frame for everything below — the queue is long
because the pillars were measured, not because they are fine.

Filed this session, all propose-only, all in the queue:

| ID | What | State |
|---|---|---|
| **TN-2** | Body Battery charge window is below the owner's 5th-pct waking HR; floors by ~12:30pm | direction signed off, offset unfitted (**+8…+12**) |
| **TN-3a/b** | per-bucket stress series is computed then discarded — no hour-of-day question is answerable | 3b `Needs: 3a` |
| **TN-4** | `/api/body-battery` 500s on a stress-model failure | **SHIPPED** #415; root cause still open |
| **TN-5** | `SCORE_CALIBRATION` gain varies 8-fold | **signed off** — build it |
| **TN-6** | temp baseline 0.363 °C low → −16 pts/day on 89% of days | **signed off**; batched with Q-506 + **BF-13** |
| **TN-6a** | suspend the temperature penalty until the baseline is centred | **signed off**, ships alone, outside the batch |
| **TN-7** | TN-4's catch only `console.error`s, disarming LA-20's verification | one line, Lane A |
| **TN-8** | chronic-stress fever mask = a **fourth** consumer of the broken temp baseline | batched with BF-13; fixed by that seed fix |
| **TN-9** | readiness moves when the check-in is logged; owner wants it final at first open | intent signed off — drop `checkin`, renormalise |
| **TN-10** | `TOTAL_SLEEP`'s comment and curve disagree by ~15 pts on the heaviest contributor | `Gate: owner`; sequence after TN-5 |
| **TN-11** | "moved this hour" = one reading over a resting boundary → **99.8%** of waking hours qualify | answers Q-522's open half; **TN-2 does not fix it** |
| **TN-12** | no hourly-movement surface worth having; the one that exists is pinned at full | Lane B, `Needs: TN-11` |
| **TN-13** | the HR tile shows a 7-day average and discards 84% of the movement in the best predictor there is | Lane B, one field |
| **TN-14** | 2026-08-19's 3.50 h night still stored, still feeding every baseline | `Needs: Q-520`; decode the frames first |
| **TN-15** | Body Battery: drain ignores exercise, no recharge at all | **signed off**; `Needs: TN-2`; supersedes the old "do not redesign" line |
| **TN-16** | prolonged-stress warning + calm-down prompt | **parked** `Needs: Q-507` — the metric points the wrong way |

**Owner decisions, 2026-08-24 — all recorded on the entries, nothing left gated on them.** TN-5 and
TN-6 signed off; **TN-6a** added (suspend the temperature penalty on a self-clearing condition, ships
outside the batch, must cover all three consumers). **History policy: leave stored days alone and
stamp the new model** — which leans on a stamp Q-518 says gets erased, so **Q-518 is now load-bearing**.
On **BF-13** (BugFix's entry, whose root cause supersedes TN-6's): re-derive the baselines, fix the
seed for all six, re-derive only what is measurably wrong. **Measured: only `temp` is** (gap +2.80 sd,
100% of nights above; the other five are ≤0.28 sd).

**BF-14 refuted 2026-08-24** — the breathing baseline is fed `rpm × 10` deliberately, so rpm =
`meanX8 / 80`, not `/8`; corrected it reads 9.250 against 9.400, **+0.27 sd, clean**. Reasoning is on
the entry.

Reviews: [pillar review](../../reviews/2026-08-26-pillar-review.md) · [check-in lookback](../../reviews/2026-08-26-checkin-lookback.md) · [threshold sweep](../../reviews/2026-08-25-threshold-sweep.md) · [battery](../../reviews/2026-08-24-body-battery-charge-window-collapse.md) ·
[sleep](../../reviews/2026-08-24-sleep-score-volatility.md) ·
[temperature](../../reviews/2026-08-24-readiness-temperature-penalty.md) ·
[handoff](../../handoff-2026-08-24-readiness-scores-owner-batch.md).

**Lane A is already working from these** — #415 shipped TN-4, #417 landed a TN-2 enabling refactor,
and `426cbfbb` records that TN-2's fit **cannot run from a session container** (vendored constants
Q-49 removed; `oura_raw_samples` holds ~7 of the 56 days needed; `decoded` NULL on those).

## Next

1. **Re-measure after Lane A lands any of TN-2/5/6 or Q-506** — each carries its own pass test.
2. **The threshold sweep is done** — see the do-not-re-litigate list. What it left is the ~13
   thresholds whose inputs are never persisted; those need the pipeline, not SQL.
3. **Activity volatility at n ≥ 20.** It read 7.2 → 12.2 day-to-day, which would be a real change of
   character for the most compressed score in the app. **Six deltas cannot tell that from a run of
   unusual days** — deliberately not filed.
4. **Earlier open findings, none built:** illness radar cannot fire (Q-506) · stress override fires
   on the *best* days (Q-507) · resilience has emitted one value ever (Q-508/510) · BLE input drift,
   anchor must not move (Q-509) · battery anchor flip (Q-511) · ACWR call-site windows (Q-512/513) ·
   64% of back-off cuts are a clamp artefact (Q-514) · rest/active boundary shrinks with fitness
   (Q-515) · `PEAK_BANDS` unreachable (Q-516) · adaptive-TDEE below BMR (Q-517) · model stamp erased
   (Q-518) · manual bedtime (Q-519) · partial-night flag (Q-520) · battery drain model (Q-527) ·
   `replaceOuraDailySummary` delete-before-guard (Q-528) · chronic stress (Q-525, TN-1).

## Pillar coverage

Every pillar with a scoring surface is measured except **cardio**, deliberately skipped (~13
run/treadmill sessions, newest 2026-07-24 — too thin to fit five boundaries to).
sleep ✅ · readiness ✅ · activity ✅ · body ✅ · devices ✅ · workouts ✅ · heart-rate 🟡 · nutrition ✅.
**So do not go looking for a pillar to measure.** The useful work is re-measuring after a fix lands.

## Do not re-litigate

- **The threshold sweep is DONE (2026-08-25) — do not re-run it.** 246 constants → 42 guards, 8
  maturity gates, 196 candidates → **27 decision thresholds**. Yield: **one** new finding (TN-8),
  **one** cleared (`EARLY_DELOAD_SCORE_MAX` fires 4.9% — healthy, deliberately not filed), one
  amendment (a dormant third step goal on Q-524). Every DEAD/STUCK column mapped to a filed entry, so
  the queue is comprehensive on that class. The four-for-four record that motivated the sweep held for
  the *investigated* thresholds and did not generalise.
  [`review`](../../reviews/2026-08-25-threshold-sweep.md).
- **The Body Battery does NOT charge overnight — the anchor IS the whole overnight story.**
  `walkBodyBattery` filters to `tsMs >= wakeTime`, and `resolveAnchor` sets the start to the
  readiness score. So a morning battery value is a readiness score wearing a battery label, and the
  temperature penalty lands directly on the number the owner reads at 7 am. Measured 2026-08-26 over
  35 days: removing that penalty moves the mean morning anchor **64.8 → 76.8** and mornings waking
  "Charged" (≥75) from **7/35 to 21/35** (conservative — the 6 clamped days count as unchanged).
  **⚑ Amended 2026-08-26: the old "do not propose overnight charging or an anchor redesign" line is
  RETIRED.** The owner asked for that redesign directly and signed it off — **TN-15**. What survives
  is the *sequencing*, and it still binds: **TN-6, then TN-2, then TN-15.** A recharge model landed on
  a boundary that calls 98% of waking time "draining" cannot be evaluated, and TN-6 alone lifts the
  anchor 12 points, so measuring before it lands attributes its gain to the wrong change.
- **The Activity Score at 7 am is a PARTIAL DAY, not a low day.** Its daily-movement lane (55 of 100)
  is near-empty first thing while the strength lane (45) already carries yesterday's session, so a 63
  at 7 am is the score working. **Do not file "activity reads low in the morning"** — Q-505.
- **Removing a 10% contributor normally moves a score; `checkin` does not** (TN-9) — mean 69.9 → 70.4,
  no day moving ≥5. **The reason first given here was wrong and is corrected**: it is because the
  weight is 10% *and* it correlates with the rest, not because it is redundant.
- **The check-in lookback is DONE (2026-08-26, n=33) — do not re-run it.**
  [`review`](../../reviews/2026-08-26-checkin-lookback.md). Correlates restingHeartRate **+0.557**,
  previousNight **+0.520**, sleepBalance +0.470, temperature +0.463; yesterday's training **+0.028**.
  **Best honest model is 2 predictors, LOO R² 0.293**; all eight reach R² 0.541 with **LOO 0.047**.
  **⛔ Do NOT impute the check-in on unlogged days** — 5% out-of-sample is a fabricated number with a
  model's authority. **r ≈ 0.5 is ~25% shared variance, so ~75% of the check-in is information
  nothing else has** — it is worth using more elsewhere, not less.
- **On n≈30, always report LEAVE-ONE-OUT R², never plain R².** Here R² rose monotonically to 0.541
  with eight predictors while LOO collapsed to 0.047 — the in-sample number would have sold a model
  with no predictive power at all.
- **"Final at first open" needs TWO fixes, not one.** Besides the check-in, `activityBalance`
  (weight 0.06) is **today's** activity score (`readiness-composite.ts:49`), which is a partial day
  that fills all day — so readiness drifts ~1 point continuously with no user action.
  `prevDayActivity` already uses a completed day and is settled. Ship only the check-in half and the
  owner will read the fix as not working.
- **HR alone cannot answer "did you move" — MET can, and the app already decodes it.** The owner
  raised this and was right. `getOuraDaytimeSignals` (`adapter.ts:4959`) decodes MET from raw frames
  (**tag `0x50`**) and `MET_ACTIVE_THRESHOLD = 1.8` is Oura's own constant (`daily-medians.ts:51`).
  HR rises for stress, caffeine, heat and standing, so an anxious hour at a desk scores the same as a
  walk. **Before fitting any MET run-length, measure the hourly MET distribution** — it is decoded
  from raw frames, not a column, and `decoded` is NULL on the hot tier, so SQL cannot reach it.
  **Do not use daily `met_avg` as a stand-in**: it is an average (n=51, 1.004–1.636, mean 1.360) and
  "0 of 51 days exceed the 1.8 sample threshold" is expected arithmetic, not evidence.
- **`HR_REST_THRESHOLD` is read by TWO metrics asking DIFFERENT questions, and one fix cannot serve
  both.** Body Battery wants the boundary between *resting and not* (TN-2); `computeMovedHours` wants
  the boundary between *sedentary and moving* (TN-11). At TN-2's most generous proposed offset,
  move-hours still qualifies **97.6%** of waking hours against 99.8% today. **Do not close TN-11 as a
  side effect of TN-2**, and do not raise the shared constant to fix move-hours — that breaks the
  charge window the other way.
- **"Does move-hours count sleep?" — no**, by two guards: a hardcoded `[7, 22)` window and overnight
  HR below the bar. But that window is **hardcoded** — `readiness-payload.ts:324` never passes the
  `wakeHour`/`sleepHour` the function accepts — so a 6 am wake loses real waking time at both ends.
- **A distribution screen is BLIND to "always fires" and "never crosses".** Run against the two known
  failures it catches neither — `temp_dev_c` has a healthy range, `illness_score` looks merely sparse.
  It finds stuck and dead scores only. Pair every threshold with its input, or the screen reads clean
  on a score compared against the wrong number.
- **Measure coverage on a RECENT window, never all history.** `oura_daily_derived` holds pre-BLE rows
  back to 2026-05, so whole-history coverage reads 29–49% and looks like a defect; August is 100% for
  readiness, sleep, activity and illness. A whole-history coverage number measures when the pipeline
  started.
- **~13 thresholds are not measurable from stored data** (sleep staging, `MET_ACTIVE_THRESHOLD`,
  `APNEA_THRESHOLD`, `NIGHT_BAND_*`, `RANGE_THRESHOLD`, `CONSISTENCY_*`) — their inputs are
  per-sample intermediates nothing persists, the same shape as TN-3a. They need a session that can
  run the pipeline, not more SQL.
- **A calibration curve cannot reduce displayed volatility — its total rise is conserved.** Uniform
  gain moved night-to-night |Δ| 13.53 → **13.75**. Diagnose "the score jumps around" by
  reconstructing the pre-calibration blend first; if its |Δ| is unchanged, no curve change helps.
- **Any coverage/percentile measurement on the BLE HR series must be TIME-weighted.** The ring
  power-gates its PPG, so a per-sample percentile read ~20% where the time-weighted answer was 1.6%.
- **+18 bpm overshoots Body Battery** into a permanently-full tank (mean 90.8, a third of days at 100)
  — a full tank carries no information (Q-57).
- **Get a fixed-point factor from the CALL SITE, never by inference.** Inferring each baseline's
  scale as the best-fitting power of ten is right for temp (×100) and wrong for sleep (**×60**), and
  produced a phantom "sleep baseline 4.768 h against a true 8.010" that would have caused an
  unnecessary production data change. `daily-summary.ts:102-112` has all six, four lines apart.
- **To ask whether a baseline is centred, use `% of nights above it`, not the raw gap** (100% for
  temperature, near 50 when healthy), paired with gap/nightly-sd — hrv reads 87.8% above on a 0.04 sd
  gap, an EMA lagging a rising metric, not a defect.
- **⛔ `pg_stat_user_tables` row counters are planner ESTIMATES** (`last_analyze` NULL on every table);
  its size columns are exact. To ask whether a table is empty, run `count(*)` — a predecessor filed a
  data-loss incident (Q-528) off `n_live_tup` that had never happened.
- **`claude_ro` views are row-scoped to ONE user** and `error_events` prunes at 30 days. Write every
  count as "the owner's, recently", never "the system's".
- **A hardening fix can delete the evidence another open investigation needs** (TN-7). When a fix
  turns a 500 into a fallback, check what was waiting on that 500.
- **A refuted hypothesis is a result — record it, do not replace it.** Stress pointing the wrong way
  invited an obvious explanation (better sleep → denser HRV → more buckets scored). Measured:
  **r = −0.128** against HR sample count. Q-507 now carries the refutation, so the next session does
  not spend itself there. **Nothing replaced it**, and TN-16 is parked rather than built on a guess.
- **Q-507 REPLICATES at n = 33 and gets stronger.** Stress-high minutes vs readiness **+0.386**; vs
  the **sleep score +0.477** — stronger than the readiness one and untested in the original entry.
  Also unresolved: vs overnight HRV **−0.258**, weakly the *right* way. **Do not build the overlay
  (TN-3b), the warning or the ritual (TN-16) until the sign is explained.**
- **A "7-day average" tile can be the least informative form of the most informative signal.** Nightly
  resting HR moves 2.11 bpm; its 7-day average moves 0.33. Before proposing a *different metric* for a
  tile, check whether the metric is fine and the **smoothing** is the defect (TN-13).
- **Activity's 100 is not reachable by behaviour, and saying "train harder" would be wrong.**
  `zoneMinutes` floored on 53/59 days (Q-523), `activeEnergy` present on 8/51, `moveHours` meaningless
  (TN-11). Three of six contributors are structurally broken; the ceiling is a data problem.
- **The threshold is usually right and the input usually wrong** — Q-506, Q-512, Q-514, now TN-6.
  Check the input's distribution before touching any constant.
- **Do NOT lift the sleep scale toward its old mean** — sleep/readiness agreeing is load-bearing for
  the Body Battery anchor (Q-511).
- **A threshold on a display scale is calibrated to that scale's distribution.** Re-anchor in the
  same PR as a range change, preserving the firing *rate*.
- **Contributor curves set the RANKING; a calibration on the blend sets the RANGE.** Do not fix a
  range problem with curves.
- **A range calibration transfers to neither Readiness** (breaks three composite invariants) **nor
  Activity** (its ranking disagrees with its most variable input).
- **Do not assert a permanent absence from a short observation** (Q-529 claimed a score is never
  recomputed; it recomputed nine minutes later).
- **A constant value is as often a retired question as a broken one** — check the last write date
  *and* the write site before filing.
- **A replay must reproduce stored values before any counterfactual on it means anything.**
- **Production data moves under you mid-session.** Re-pull before quoting; record the pull time.
- **`/api/admin/db-query` truncates at 1000 rows**, can 401 under burst, and can lock out for
  minutes. Budget queries rather than iterating.
- **SQL integer division silently zeroes a ratio** — cast to numeric. It made every HR sample read
  as "resting" in a replay here before it was caught.
- **`git log` cannot date anything before 2026-08-19** — history was cut at the public-repo migration.

## Claimed paths

**Nothing claimed.** Every entry above is docs-only and propose-only.
