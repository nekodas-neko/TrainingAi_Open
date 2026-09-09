# 🎶 Tuning Agent — baton

> **Successor sessions are titled `🎶 Tuning Agent 🟢`** — exactly, both emoji. Leading emoji = role,
> trailing = this session's status, set by the session itself. See `docs/agents/README.md` §4.

**Updated:** 2026-09-09 · **By:** `session_01VVfZtbCftbwaUHtBLJoxVr` · **Next ID:** `TN-30`.
Find next free: `grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy `Q-` numbers
stay valid. **Rewritten in full, never appended** — narrative lives in the linked reviews.

**Compacted 2026-08-24 from 582 lines** (the PS-4 outlier). Everything cut is in the reviews below.

## Now

**Nothing is blocked on the owner.** Every decision the queue needed has been asked and answered —
2026-08-24 (TN-5/TN-6/TN-6a, history policy), 2026-08-26 (TN-9's intent, TN-15's redesign),
2026-08-31 (the step goal: **manual wins**), and **2026-09-09** (*"make all the changes you
recommend"* — TN-29 then TN-27 option 3). **TN-25 is the one open owner question**: three options for
the guided walk's fast target, filed 2026-09-08, not yet chosen.

**The owner's standing verdict, 2026-08-26:** *"Overall the pillars are not working great and not
very useful. Requires tuning."* The queue is long because the pillars were measured.

**⚠ The battery chain has still shipped nothing** and the owner has reported it twice. TN-15/18/6a/6/2
all carry sign-off and all sit unbuilt. That is a prioritisation question only the owner can answer —
say so plainly rather than re-measuring the pillar a fourth time.

**Filed 2026-09-08/09, the nutrition and cardio batches:**

| ID | What | State |
|---|---|---|
| **TN-24** | Zone 1 spans 52–122 bpm, so Zone 2 is unreachable on foot and the walk's zone bar carries nothing | supplies **Q-523's** mechanism; PR #998 |
| **TN-25** | the walk's fast target (≥133 bpm) met **0 of 44 times**; fast blocks average the slow target | **✅ decided** — varied prescribed patterns, 105–118 bpm band |
| **TN-26** | cadence and speed mean different things per surface; prescribe heart rate, demote the controls | rewritten after the owner declined treadmill tuning |
| **TN-27** | maintenance rejects its 28-day window and falls back to the noisy 14-day one → **2,245 kcal** | **owner chose option 3**, after TN-29 |
| **TN-28** | the one card that writes the calorie goal hides the `low confidence` its siblings show | Lane B, independent |
| **TN-29** | two independent maintenance estimates computed per request, never compared; gate on the activity factor | **owner-approved, build first** |

**Earlier batches, all still queued and none blocked:** TN-2 (battery charge window, offset unfitted)
· TN-5 (`SCORE_CALIBRATION` 8-fold gain) · TN-6/6a/8/18 (the temperature baseline and its four
consumers) · TN-9 (readiness final at first open — **two fixes, not one**) · TN-11/12/13 (move-hours,
the HR tile's smoothing) · TN-15/19 (Body Battery drain and recharge) · TN-17 (Activity pacing,
`Needs: Q-524`) · TN-20/21/22 (the stress and recompute persistence defects) · TN-23 (sleep's `hrv`
and `hr` are one signal scored twice).

Reviews: [maintenance 2,245](../../reviews/2026-09-09-maintenance-2245-is-too-high.md) ·
[walk intensity](../../reviews/2026-09-08-walk-intensity-calibration.md) ·
[why a good night scored 63](../../reviews/2026-09-03-why-a-good-night-scored-63.md) ·
[stress sign explained](../../reviews/2026-09-01-stress-sign-explained.md) ·
[recompute wipes completed days](../../reviews/2026-09-01-recompute-wipes-completed-days.md) ·
[four tiles at 55](../../reviews/2026-08-31-four-tiles-at-55.md) ·
[HRV as a tile metric](../../reviews/2026-08-31-hrv-as-a-tile-metric.md) ·
[measured stride](../../reviews/2026-08-31-measured-stride-from-cadence.md) ·
[HR tile + pacing](../../reviews/2026-08-26-hr-tile-and-activity-pacing.md) ·
[pillar review](../../reviews/2026-08-26-pillar-review.md) ·
[check-in lookback](../../reviews/2026-08-26-checkin-lookback.md) ·
[threshold sweep](../../reviews/2026-08-25-threshold-sweep.md) ·
[battery](../../reviews/2026-08-24-body-battery-charge-window-collapse.md) ·
[sleep](../../reviews/2026-08-24-sleep-score-volatility.md) ·
[temperature](../../reviews/2026-08-24-readiness-temperature-penalty.md) ·
[handoff](../../handoff-2026-08-24-readiness-scores-owner-batch.md).

## Next

1. **Re-measure after Lane A lands anything.** Every entry carries its own pass test; that is the work,
   not finding a new pillar.
2. **TN-25 needs the owner's pick** before the walk batch can go further. Ask once, do not re-measure.
3. **The threshold sweep and the check-in lookback are DONE** — see the do-not-re-litigate list.
4. **Activity volatility at n ≥ 20** — read 7.2 → 12.2 day-to-day on six deltas, which cannot tell a
   change of character from a run of unusual days. Deliberately not filed.
5. **Earlier open findings, none built:** illness radar cannot fire (Q-506) · resilience has emitted
   one value ever (Q-508/510) · BLE input drift (Q-509) · battery anchor flip (Q-511) · ACWR call-site
   windows (Q-512/513) · 64% of back-off cuts are a clamp artefact (Q-514) · rest/active boundary
   shrinks with fitness (Q-515) · `PEAK_BANDS` unreachable (Q-516) · **adaptive-TDEE below BMR
   (Q-517 — TN-29 is its other half)** · model stamp erased (Q-518) · manual bedtime (Q-519) ·
   partial-night flag (Q-520) · battery drain model (Q-527) · chronic stress (Q-525, TN-1).

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
- **A distribution screen is BLIND to "always fires" and "never crosses"** — run against the two known
  failures it catches neither. Pair every threshold with its input, or it reads clean on a score
  compared against the wrong number.
- **Measure coverage on a RECENT window, never all history.** `oura_daily_derived` holds pre-BLE rows
  back to 2026-05, so whole-history coverage reads 29–49% and looks like a defect while August is
  100%. A whole-history coverage number measures when the pipeline started.
- **~13 thresholds are not measurable from stored data** (sleep staging, `MET_ACTIVE_THRESHOLD`,
  `APNEA_THRESHOLD`, `NIGHT_BAND_*`, `RANGE_THRESHOLD`, `CONSISTENCY_*`) — per-sample intermediates
  nothing persists. They need a session that can run the pipeline, not more SQL.
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
- **TN-6a SHIPPED for one of its three consumers, and the queue did not notice** (TN-18, 2026-08-31).
  `readiness-payload.ts:386` gates the ladder on `isTemperatureBaselineCentred(...)`; `grep` finds
  that helper in **exactly one file**, so `ai-dynamic.ts:184`'s bare `> TEMP_ALERT_THRESHOLD_C` still
  fires. **Verify a shipped fix at every consumer its own entry named** — one grep would have caught
  this on the day it landed.
- **The tiles are NOT four independent readings, and this is by construction.**
  `previousNight.input` **is** the Sleep tile and `activityBalance.input` **is** the Activity tile, so
  **22% of readiness is the two tiles beside it** (`corr(readiness, sleep)` **+0.656** against
  `corr(sleep, activity)` **+0.139**), and Body Battery's morning anchor **is** readiness (**+0.838**,
  n=47). **Never read agreement between those numbers as corroboration.**
- **"All the scores are the same" is usually coincidence here — check the spread first.** They
  normally sit **20 points apart** (median 19, max 65); only **2 of 35 days** land within 3. And
  **the Heart Rate tile is bpm**, not a 0–100 score, so it shares a value with them by accident.
- **Reproduce a readiness score from its stored contributors before calling it wrong.** 2026-08-31
  came to **55.3** against a stored 55, with HRV and resting HR carrying 15.8 of an 18-point drop —
  a correct score on a genuinely low day. Two things qualified it and both were already queued
  (`recoveryIndex` at 100 flagged provisional, **Q-509**; `checkin` at the placeholder 50, **TN-9**).
- **`tempZ` and `temp_dev_c` are different units and will disagree — do not file that as a bug.**
  `0.519 °C / 1.714 °C sd = 0.303 z`, matching the stored contributor input to three decimals. The
  small z is **Q-506's inflated sd**, not a second temperature. This was nearly filed as "two
  temperature truths"; the real finding was the ungated banner.
- **⛔ "Show HRV on the tile instead of HR?" — ASKED AND ANSWERED 2026-08-31. No.** In contributor
  form against the check-in: **restingHeartRate −0.491**, **hrvBalance −0.331**, and the two
  correlate **+0.751 with each other (56% shared variance)**. Swapping loses a third of the
  correlation and buys almost no new information. HRV belongs on a detail screen.
  [`review`](../../reviews/2026-08-31-hrv-as-a-tile-metric.md).
- **HRV is the noisiest vital here but it IS signal** — CV **17.2%** against resting HR's **5.6%**,
  night-to-night 7.42 ms (13% of mean), yet lag-1 autocorrelation **+0.439** and |Δ|/sd **0.77**
  against 1.13 for white noise. Do not dismiss it as noise; do not read one night of it as an event.
- **The HRV baseline is the one baseline object that is roughly RIGHT** — stored sd 7.13 against a
  true 8.66 (**0.82×**, where temperature's is ~12×). Usable band ≈ **47–64 ms**. **But it lags**: the
  owner's HRV is genuinely rising (**+6.21 ms** across the window while resting-HR-low falls
  **2.87 bpm** — both healthy, together), so **77% of recent nights sit above it** and a naive
  out-of-band alert fires high-side. Any band UI needs a trend-aware baseline.
- **"% of nights above the baseline" measures the TREND on a trending metric, not an error.** This
  rule was already in this baton and HRV was still nearly re-filed as a defect at +0.62 sd. BF-13's
  method — today's baseline against the whole-history mean — gives HRV **−0.01 sd**. **BF-13 stands.**
- **⚠ The RHR baseline is fed `rhrLowBpm`, NOT `rhr_avg_bpm`** (`daily-summary.ts:103`). Compared
  against the average it reads 100% of nights above, **+2.66 sd** — a phantom temperature-scale
  defect. Against the right column: **+0.16 sd, centred.** Third near-miss of this class in two days
  (`tempZ` vs `temp_dev_c`, sleep ×60, now this): **read which column feeds a baseline before
  comparing anything to it.**
- **The HR tile's lever is RAW-vs-BASELINE-RELATIVE, not which metric.** Against `perceived_recovery`:
  waking-rest HR **+0.176 raw → +0.291 relative**, nightly resting HR **+0.129 → +0.278**. Expressing
  either as a delta from the owner's own baseline roughly doubles it; picking between them barely
  moves anything. **Do not re-run the "which HR number" comparison** — it was run.
- **⚠ `perceived_recovery` runs 1 = fully recovered … 5 = WRECKED** (`types/day-checkin.ts:17`). A
  positive r against it means *worse*. Half an hour went into a sign that was the scale, not the data.
- **⚠ `readiness_contributors` carries `provisional: true` rows with the score pinned at 50.** Filter
  them: including 4 of 39 drags the restingHeartRate correlation from **−0.553 to −0.395**. This
  applies to every future query against that JSON, not just this one.
- **The pillar review's +0.557 and the raw +0.129 are the SAME signal measured two ways** — the
  contributor score is baseline-relative. Neither is wrong; do not "correct" one to the other.
- **⛔ `step_live_windows` is effectively empty — 8 rows across 6 days, 7,745 steps total.** It is the
  obvious intraday step source and it reads a flat zero. `body_metrics.steps` is a **running daily
  total** (`updated_at` moves through the day), which is what any intraday step question should use.
- **A sleep score can be reproduced EXACTLY from its stored contributors — do this before theorising.**
  2026-09-02: the ten contributors blend to **76.04**, `SCORE_CALIBRATION` ships **63**. Two minutes of
  arithmetic separated *"the model is wrong"* from *"the display curve costs 11.9 points"*.
  [`review`](../../reviews/2026-09-03-why-a-good-night-scored-63.md).
- **⛔ The SLEEP score's autonomic baseline is NOT `hrv_baseline_mean_x8`.** `buildSleepAudit` calls
  `sleepScoreBaselines(prior, tz)` (`sleep-score.ts:359`) — a **trailing window over prior nights'
  own readings**, newest last, excluding the night being scored. Comparing a stored `hrv`/`hr`
  contributor against the `×8` EMA proves nothing; it nearly produced a false *"your best nights were
  inflated"* finding on 2026-09-03. **It is also the one baseline in this codebase built the RIGHT
  way** — self-correcting, excludes the night under judgement, untouched by BF-13's zero seed. The
  construction TN-6 wants for temperature already exists here; copy it.
- **⛔ `hrv` and `hr` in the sleep score are ONE signal (TN-23)** — `r = +0.869`, **75% shared
  variance** over 38 nights, carrying **28 of 110 = 25%** of the score. A single autonomic dip is
  charged twice. **Both curves are correct** (HRV 50 ms/0.85× → 42 and HR 63/1.035× → 58 are exactly
  what `HRV_RATIO`/`HR_RATIO` specify), so **do not delete a contributor** — collapse them or
  down-weight the pair to a joint ~14–18.
- **When the owner says a score is too low, the answer is usually the DISPLAY CURVE, not the model.**
  Twice now: a 73.15 blend shown as 57, a 76.04 blend shown as 63. **TN-5 is signed off and unshipped**
  and is the largest single factor in both. Quote the blend before quoting the contributors.
- **✅ Q-507 IS EXPLAINED, AND ITS CONCLUSION IS REVERSED (TN-22, 2026-09-01). The stress model was
  never the problem.** Recomputed from the model's own persisted buckets, `stress_high_minutes`
  correlates **−0.438** with readiness (**−0.699** waking-only, n=8) — the correct direction — while
  the **stored** scalar reads **+0.338**. **Stored disagrees with buckets on 8 of 9 days**, storing
  **zero** against 210–270 bucket-minutes on four, and **agreeing only on the newest day**.
  [`review`](../../reviews/2026-09-01-stress-sign-explained.md).
- **⛔ THREE mechanisms have now been proposed for Q-507 and two were wrong — stop proposing them.**
  Data-density (refuted 2026-08-26, r = −0.128 vs HR sample count) and TN-21's bucket-count
  (r = −0.784) both explained an **artefact of the stored value**, not a property of the model. The
  general lesson: **before explaining why a metric behaves strangely, check that the stored number is
  the number the model produced.**
- **⚠ Do NOT treat Q-507 as settled enough to build on. n = 8–9**, the waking window is a review
  choice not the app's, and the buckets come from the same pipeline as the scalar. **Re-test at
  n ≥ 30 after TN-22 lands.** TN-16 stays parked — but its blocker is now a persistence bug with a
  route, not open research.
- **⛔⛔ A STORED COUNTER IS A CLAIM ABOUT THE DATA, NOT THE DATA — and this agent published a wrong
  finding off one.** TN-19 cited 2026-08-26 as *"zero HR samples → zero drain"*; that day holds
  **1,954 raw samples in `oura_heartrate`**. The zero was **TN-20**. **Cross-check the raw table
  before quoting any zero**, and expect `body_battery_daily.hr_sample_count` in particular to lie.
  Q-521's wear-time conclusion survives on its own correlations; only the illustration fell.
- **TN-20: completed days are being overwritten with empty recomputes.** 2026-08-31 read 113 drained
  / 3,643 samples, the owner screenshotted it, and an hour later it stored **0 / 0 / end = anchor**
  with **3,815 raw samples** still present. The derived row went **55 → 25** readiness and
  **56 → 15** sleep against a normal **7.83 h / HRV 54.5** summary. **3 of the last 11 days.**
  **Nothing logs the prior value** — this is only visible by diffing stored counts against
  `oura_heartrate`. **Do a raw-vs-stored comparison before trusting ANY derived history.**
- **The stress series is NOT daytime-only — it is 55% night** (126 of 230 buckets between 22:00 and
  06:00, all 24 hours covered except 07:00). Night mean **+0.266**, day **−0.413** — **opposite
  signs, night in the majority**, so a daily aggregate tracks the night/day mix. That is TN-21 and a
  live candidate for Q-507's backwards sign.
- **⚠ The Q-507 candidate is the REVERSE of the refuted one — do not conflate them.**
  `corr(total buckets, stress_high_minutes)` = **−0.784** (n=9): *fewer* buckets → *more* high-stress
  minutes, because each bucket scores against the day's own median. The refuted hypothesis used **HR
  sample count** (r = −0.128). Different quantities; the bucket count is what the model divides by.
- **⚠ THE BATTERY CHAIN HAS SHIPPED NOTHING, and the owner has now reported it twice** (2026-08-26,
  2026-08-31 *"still not very usable"*). Verified on `main` 2026-08-31: TN-15/18/6a/6/2 all still
  queued, at **positions 75–83 of 235**. Nothing is blocked — TN-6a, TN-18 and TN-15 all carry owner
  sign-off. **Priority is queue position, so this is a prioritisation question and only the owner
  can answer it.** Say so plainly rather than re-measuring the pillar a third time.
- **The HOW IT MOVES card made the pillar read WORSE without changing a number** (TN-19). It states
  five testable claims beside the value; four are inert. **A wrong number the app explains is worse
  than a wrong number it does not** — the explanation converts a vague doubt into a demonstrated one.
  **⛔ Do not propose rewording the card**: it is TN-15's spec rendered, and softening it documents
  the defect instead of repairing it.
- **2026-08-26 is the cleanest Q-521 demonstration in the data** — **0 HR samples → 0 drained,
  0 charged, ends exactly at its anchor.** No wear, no change. Reach for that day rather than
  re-deriving the correlation when someone doubts that drain integrates wear time.
- **The recharge half produced 6 points across 8 days** (charged 0/1/0/3/0/0/1/1 against drained
  113/52/47/70/13/0/76/79; five of eight days end at 0 or 2). That is the `+0 charged` line on the
  owner's screenshot, and it is TN-2's charge window, not a new finding.
- **The owner's stride is MEASURED, 0.739 m — do not use `0.415 × height` (0.664), it is 10.1% short.**
  `activity_logs` stores `distance_km` + `steps` + `cadence_spm` + `duration_min` on one row and
  `segments` carries `distanceKm` + `avgCadenceSpm` per interval. Two extractions agree to **0.3%**
  (3 sessions, 16 segments) and `cadence × duration` reproduces recorded steps to **+0.13%**, so the
  cadence path is trustworthy where `steps` is null.
  [`review`](../../reviews/2026-08-31-measured-stride-from-cadence.md).
- **⛔ But one stride constant is still wrong: stride vs pace is r = −0.885**, −0.052 m per min/km —
  **0.83 m at 10:00/km, 0.62 m at 14:00/km**, a 33% spread. The measured sessions are deliberate
  walks (10–15 min/km); **incidental steps are slower and shorter**, so 0.739 over a whole day
  overstates distance. **The tracked walk is only 27–94% of a day's steps (median ~48%)** and nothing
  stored can measure the rest — `step_live_windows` and `body_metrics.steps` carry steps with no
  distance. State that half as an assumption; do not derive false precision from the walk data.
- **A stride estimate needs a freshness rule** — it is leg length *and* habitual pace, so it drifts
  with fitness. Same trap as `HR_REST_THRESHOLD` (Q-515). Trailing window, never stored once.
- **⚠ `activity_logs` 2026-07-01 is CORRUPT** — 4,970 steps over 3.30 km in **0.2 minutes**, and more
  steps than `body_metrics` holds for the whole day (1,358). Excluded from every stride figure. Any
  per-user derivation needs a sanity gate (plausible cadence, walk steps ≤ day steps).
- **✅ THE STEP-GOAL DESIGN IS FULLY DECIDED — nothing is gated on the owner.** Three sign-offs now:
  2026-08-19 *"use 1 number; the AI should define it and allow manual entry"*, 2026-08-30 *"the goal
  stays 7,000"*, and 2026-08-31 **MANUAL WINS** — a hand-set goal is authoritative, the AI may offer
  and may fill only while unset, accepting converts to manual, and **clearing must return to the
  derived path**. Q-524 and TN-17 both carry it. **Do not re-ask any of it.**
- **⛔ The step-goal design was DECIDED on 2026-08-19 and is unbuilt — do not re-open it, and do not
  recommend a number.** Q-524 carries the owner's words: *"we need to use 1 number here. The AI
  should be able to define the number and allow for manual entry."* `users.steps_goal` becomes the
  single source; `getDailyGoals()` reads it with the derived value as fallback. **A predecessor
  recommended "just set it to 7,000" and the owner rightly pushed back** — 7,000 is
  `STEP_GOAL_BY_ACTIVITY.sedentary`, a population constant from Paluch 2022, specific to nobody.
  **Check the entry for an existing owner decision before recommending anything.**
- **Manual and AI step goals write the SAME column, so "manual wins" cannot be evaluated today.**
  `/api/nutrition-goals/recommend:326` and the manual editor both write `users.steps_goal` with no
  provenance, so an AI review can silently overwrite a deliberate choice. Needs a
  `steps_goal_source` column — Lane A. **Not an observed loss** (`last_goal_review_at` 2026-08-25 vs
  newest `goal_recommendations` 2026-08-11); a code shape, not an incident.
- **A step is not equal work across people, which is the real argument for personalising the goal.**
  Owner is 160 cm → stride ≈ 0.66 m, so 10,000 steps is **6.6 km** for them and ~7.5 km at 180 cm —
  the same "goal", ~14% more work. Their numbers: BMR **1,553**, median day 4,649 steps ≈ **86 kcal
  net**, 7,000 ≈ **129**, 10,000 ≈ **184**. **The whole 7k-vs-10k argument is ~55 kcal/day** — hold
  the decision at that scale.
- **⛔ Do not derive a step goal that targets the whole `activeEnergyGoal`** (BMR × 0.24 = **373 kcal**
  here): 12,000 steps yields 221, so it would demand ~20,000 steps/day. And the Activity Score
  already scores `steps` (18) **and** `activeEnergy` (15) separately — an energy-derived step goal
  makes them count the same walking twice. Decide the double-count first.
- **The owner's step goals are not calibrated to the owner.** Median day **4,649**; 7,000 reached on
  **32%** of days, 10,000 on **15%**. Any change that makes the Activity score stricter (TN-17's
  pacing) turns that from invisible into a tile that reads red most days — which is why TN-17 is
  gated on Q-524 rather than filed as a straight improvement.
- **TN-3a's persistence half SHIPPED** (migrations 212/213; `oura_daytime_stress_buckets`, ~26
  buckets/day since 2026-08-24) **and its queue entry did not notice for two days.** The back-fill did
  not ship, so it keeps a `Keep:`. **Check production for the table before assuming an entry's state
  from the queue** — the queue lags the database.
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
- **⛔⛔ WHEN A MODEL COMPUTES THE SAME QUANTITY TWICE, THE DISAGREEMENT IS THE FINDING — AND THIS ONE
  NEVER COMPARES THEM.** `computeEnergyBalance` derives maintenance from intake-and-weight *and* from
  resting-rate-plus-measured-movement on every request, then lets the first silently override the
  second. Over one 28-day window they read **2,245** and **1,895**. They fail in unrelated ways, which
  is exactly what makes the second a free check on the first (TN-29). **Before proposing a new signal,
  check whether the app already computes a second answer and throws it away.**
- **Divide any expenditure number by the measured resting rate before believing it.** Maintenance ÷ RMR
  is an activity factor, and a factor is legible where a kcal figure is not: 2,245 / 1,345 = **1.67**,
  *hard exercise 6–7 days a week*, for an owner averaging **3,572 steps/day**. The three honest
  estimates sit at 1.23–1.41. **This is the cheapest sanity test in the nutrition pillar** — and
  Q-517's one-sided BMR floor is the same idea already half-built.
- **⛔ A coverage gate whose DENOMINATOR is the window length steers toward the noisiest window.** The
  maintenance estimator's `MIN_LOGGED_FRACTION` reads 71% at 14 days and 36% at 28 **with an identical
  mean intake of 1,612**, because complete-logging began on a fixed date and the numerator cannot grow.
  So it rejects 27 weigh-ins over 27 days, accepts 14 over 13, and lands on the window the module's own
  header calls *"dominated by water-weight swings"* — hardest exactly when logging is sparsest.
  **Check whether a ratio's numerator can move before trusting it as a quality signal.**
- **The gate protected the mean; the SLOPE was what moved.** Both windows shared their mean intake, so
  100% of a 591 kcal spread was the weight fit — which nothing gated at all. `MIN_WEIGH_INS` and
  `MIN_WEIGHT_SPAN_DAYS` check that a slope EXISTS, never that it is precise. **Report the standard
  error: 14 days gave [1,990–2,500], 28 gave [1,526–1,781], and the intervals do not overlap.**
- **A window sweep is the fastest proof that a fit is noise.** 10d → 2,414, 14d → 2,245, 22d → 1,774,
  28d → 1,654, with the intake identical from 14 days out. **A 760 kcal range produced by nothing but
  window length** says more in one row than any argument about the formula.
- **⚠ `activity_level` no longer touches the calorie path and overstating it would be wrong.** Q-401
  removed `ACTIVITY_MULTIPLIERS`. What it still reaches is small and worth naming exactly: the VO₂max
  **crosscheck only** (37.3 → 41.1 light→moderate; the Uth-Sørensen headline of 55.0 does not move),
  the step goal (moot — manual wins), the water goal (+250 ml), and the AI coach's context. **Measure a
  field's blast radius before proposing to fix it.**
- **⛔ Heart rate is the only walk control that transfers across surfaces (TN-26).** 120 spm is 4.0 km/h
  on a belt (0.556 m stride) and 5.3 km/h outdoors (0.739 m); % of heart-rate reserve is defined
  against the user's own resting and max, so it means the same thing everywhere. **Do not tune the
  guided walk to the treadmill** — the owner declined that directly on 2026-09-08, and was right.
- **⛔ Two speed points cannot extrapolate a walk prescription.** 2 km/h → 90.7 bpm and 4 km/h → 98.5
  gives ≈3.9 bpm/km/h, which puts 70% reserve at **~12.9 km/h**. The slope was measured in the flattest
  part of the curve; the response steepens toward the walk/run transition.
- **⚠ Read the column TYPES before writing the join.** The `date`/`log_date` columns in `claude_ro` are
  **text**, not `date`, so `generate_series` joins fail three different ways before landing. Three
  round-trips of `operator does not exist` cost more than one `information_schema` query would have.
- **⚠ A branch cut from a shallow clone has NO MERGE BASE after `git fetch --unshallow`.** PR #948 sat
  at `total_count: 0` looking like slow CI; the branch could never merge and no amount of re-merging
  fixes it. **Rebuild the content on a fresh `origin/main` branch and close the original** — for a
  docs-only PR that is ten minutes, and fighting the history is not.
- **⛔⛔ THE INTERVAL-WALKING PROTOCOL IS SOUND AND THE APP IMPLEMENTS IT CORRECTLY (TN-25, addendum
  5 — which CORRECTS addendum 4).** Nemoto/Masuki/Nose put the fast phase at ~70% of peak aerobic
  capacity and `hrReserveTarget(0.70, …)` renders exactly that: **133 bpm is the right number.** What
  does not transfer is the population — those cohorts were ~60–70, for whom brisk walking reaches 70%
  of peak; at 33 with a max of 168 it does not. **And the owner has already exceeded it on foot:**
  2026-07-24, a 9.2-min run at **145 bpm average = 80% reserve**. So the fix is to JOG the fast
  blocks, not to lower the target. **⛔ Do not lower 133 to match the copy — the target is right and
  the copy is wrong.** A predecessor (this agent, same day) recommended continuous walking over the
  protocol and had to correct it when the owner asked for the research.
- **The same two rows measure TN-26's surface effect:** an outdoor walk averaged **117 bpm** against
  the treadmill's **89–91** for the same activity. 27 bpm apart.
- **⛔⛔ THE ZONE MODEL IS SINGLE-SOURCED; THE MAX-HR ANCHOR IS NOT — FOUR RESOLVERS (TN-30).**
  `ZONE_DEFS` is the only set of fractions in the app and nothing re-bands HR anywhere. But
  `hrMaxFromAge` (**187**), `resolveMaxHr` (**187** — observed only if ≥ age), `targetAnchorMax`
  (**168** — walk and fitness tests) and `resolveBatteryHrMax` (**168** — Body Battery) are four
  answers to "what is this user's max", and **three are live at once**: the zone bar says the range
  ends at 187 while the walk and the Body Battery say 168. **⚠ They agree BY COINCIDENCE today** —
  the walk's fast target is `0.70 × 116 + 52 = 133` and the Zone-2 floor is `0.60 × 135 + 52 = 133`,
  same number, unrelated arithmetic, nothing holding them equal. **Always name WHICH max a zone
  number came from.**
- **⚠⚠ ADDENDUM 4'S "%HRmax vs %HR-reserve, two models" CLAIM WAS WRONG AND IS RETRACTED (addendum
  6).** The app does not mix zone models. This agent invented that framing, published it, and had to
  correct it a second time in the same thread. **The real two-model mismatch is in the framework
  PROSE** — `zone2-base.ts:6` says *"Zone-2 (60–70% HRmax)"* while the engine bands on %reserve, a
  ~20 bpm gap (TN-32). **Read the code before naming a model.**
- **⚠ TN-24's "Z1 = 52–122" WAS WRONG; it is 52–132**, because zone bands use `maxHr` (187) and the
  entry used the observed max (168). Corrected in place 2026-09-09, along with the cadence
  extrapolation (≈198 → **≈238 spm**, now consistent across TN-24 and TN-25). The conclusion held: Z1
  is 60% of the range and the fast blocks reach Z2 **0 of 44** against either anchor.
- **The owner's observed max of 168 is a FLOOR, not a test** (63 samples at 160+, so not an artefact;
  age-predicted is ~180–187). A higher true max moves classic Z2 up and makes the walks look easier —
  state that direction rather than treating 168 as measured.
- **Trend Z2 MINUTES, not target compliance.** Across 318 minutes walked in 11 sessions the owner gets
  **~13 min/week** at ≥101 bpm; brisk fast blocks would give ~29 and a 30-min continuous walk at 105+
  about **60**. **⛔ Continuous at the CURRENT fast pace gives zero** — 98.5 sits 3 bpm under the floor.
  Two sessions (2026-08-18, 2026-09-02) already produced 18–21 minutes in band, so this is an
  execution range and not a ceiling.
- **An interval protocol earns its structure only through CONTRAST.** Fast-minus-slow measures
  **7.7 bpm** here (4.4–10.0 per session), so the session is a continuous walk with a wobble, and a
  genuinely hard fast half needs 233 spm — a jog. **Do not defend an interval structure whose contrast
  is within noise of its own blocks.**
- **⛔⛔ DURATION WAS THE MISSING TERM, AND THE OWNER FOUND IT BY WALKING (addendum 7, 2026-09-09).**
  This agent told them cadence would buy ~3 bpm and they should not expect much. They walked 35 min
  at 5 fast / 2 slow: fast blocks **97 → 116 within the session (+19 bpm)** on **+11.7 spm**, session
  average **104 against ~90** across the previous ten. **82% of the movement was duration.** The
  reason it was invisible: every figure in that review was fitted **ACROSS blocks**, so a
  within-session effect could not appear in it by construction. **When a model says an input is
  exhausted as a lever, check what the model has no term for at all.**
- **⚠ And the mechanism was accumulated load, not interval contrast.** Per-set contrast ran +24, +8,
  +10, +2, +9 — it collapsed because the slow blocks stopped recovering (set 4's "slow" block, 108
  bpm, sat above the historical FAST average of 98.5). **A session that gets harder by having its
  recovery fail is a continuous effort, not better intervals** — which is evidence for the continuous
  option, not the interval one.
- **⚠ When the owner disputes a number, price the extrapolation before defending it.** The ≈238 spm
  figure was fitted over 76–132 spm, a 95% interval of 176–369, r = 0.512. It was quotable-looking and
  worthless, and it was the same error this agent had flagged one addendum earlier on the treadmill
  speed curve. **Owner scepticism about a modelled number has been right twice in this thread.**
- **✅ THE THREE CARDIO DECISIONS ARE MADE, 2026-09-09 — do not re-open them.** (1) **Max HR: a pinned
  50/50 blend, `(168 + 187) / 2 = 178`**, stored as a constant with `source: 'blended'`, replaced
  wholesale when the **Cooper 12-Minute Run** (already in `fitness-tests/protocols.ts`) gives a
  measured value. (2) **The Guided Walk keeps its intervals, varied and PRESCRIBED** — pattern chosen
  by the deterministic zone-gap selector, target an absolute **105–118 bpm band**, never a reserve
  fraction. (3) **The jog moves to Run as an assigned run type**; interval jog → `tempo`, and
  `recommendRunType` does the assigning.
- **⛔ 168 IS A FLOOR, NOT A MAX, AND THIS AGENT RECOMMENDED IT ANYWAY.** The argument was *"187 sits
  19 bpm above anything ever recorded"* — but nothing in the record is a maximal effort, so that was
  absence of evidence. **The refutation is in the data and took one query:** 2026-07-05 holds
  **156–168 bpm for 13 unbroken minutes**, and a hard 13-minute effort runs at ~92–95% of max, so the
  true max is **177–183**. **Before treating an observed maximum as a ceiling, find the longest
  sustained effort and divide.**
- **⚠ A BLENDED CONSTANT MUST BE PINNED, NEVER RECOMPUTED.** A live `(observed + predicted) / 2`
  drifts every time the observed max moves, so zones shift for reasons unconnected to fitness. Freezing
  the value answers the objection; arguing against the blend does not.
- **⚠ The anchor and the walk target are COUPLED and the sequencing bites.** Unifying at 178 raises the
  walk's `0.70` target from **133 → 140**, the opposite of the fix. TN-25's absolute band must land
  first or in the same PR — which is also why the band is stated in bpm rather than as a fraction.
- **⚑ THE PRESCRIPTION ENGINE ALREADY EXISTS — `recommendRunType(quota)`
  (`recommend-run-type.ts:26`).** It deterministically picks whichever session fills the week's biggest
  open zone gap, and its own comment says no LLM number gates it. The owner asked for *"decided
  scientifically based on my week/day"* for both walks and runs; that is this function extended, not a
  new engine. **⛔ Do not let a model pick the session** — that is a self-reported number gating an
  automatic action.
- **⚠⚠ THREE PUBLISHED RECOMMENDATIONS WERE WITHDRAWN IN ONE THREAD, EACH TO AN OWNER OBJECTION:**
  continuous-beats-intervals (wrong about the research), *"the app mixes two zone models"* (invented),
  and the observed-max anchor (wrong about what 168 means). Two numbers were corrected in place besides.
  **The findings that survived every round were measured, not modelled** — 0 of 44, Zone 1 at 60% of
  the range, four resolvers, +19 bpm in one session. **Model output is a hypothesis; state it as one.**
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
