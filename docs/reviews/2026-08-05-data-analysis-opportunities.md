# Data-analysis opportunity review — 2026-08-05

**Question asked:** with ~3 months of recorded production data, what further analysis or
recommendations can the app derive that it does not already?

**Method.** Every number below is production data via `POST /api/admin/db-query` (read-only,
owner-scoped `claude_ro` views). A 110-day daily matrix (2026-04-30 → 2026-08-05, 64 columns) was
joined across `sleep_sessions`, `workout_sessions`/`exercise_logs`/`set_logs`, `day_checkins`,
`body_metrics`, `oura_daily`, `oura_daily_derived`, `body_battery_daily` and `daily_zone_minutes`,
then analysed with Pearson correlation **plus** two controls the app's own engine does not apply:

1. **Time-trend control.** Overnight HRV correlates with the calendar date at r = 0.79 over this
   window. Any variable that also trends with date will correlate with HRV for free. Every result
   is reported both raw and as a partial correlation with day-index removed (`r|t`).
2. **Degenerate-row exclusion.** 14 of 66 sleep rows are under 4 h (13 under 3 h). They are naps or
   sensing artefacts, and they dominate several relationships.

Both controls changed the answer. Three of the strongest raw correlations did not survive them, and
one reversed direction. That is the review's most useful output.

---

## 1. What is actually there

| Table | Rows | Range |
|---|---|---|
| `oura_raw_samples` | 809,938 | 2026-07-06 → 08-04 |
| `oura_heartrate` | 39,277 | 2026-06-22 → 08-04 |
| `rr_intervals` | 28,476 | 2026-07-17 → 08-04 |
| `set_logs` | 902 | — |
| `set_hr_stats` | 582 | 2026-05-27 → 08-01 |
| `exercise_logs` | 313 | 2026-04-30 → 08-02 |
| `food_logs` | 170 | 2026-05-31 → **07-26** |
| `body_metrics` | 97 | 2026-05-01 → 08-05 |
| `workout_sessions` | 80 | 2026-04-30 → 08-02 |
| `oura_daily_derived` | 79 | 2026-05-07 → 08-05 |
| `sleep_sessions` | 66 | 2026-05-26 → 08-05 |
| `day_checkins` | 37 | 2026-07-02 → 08-05 |

Day-level coverage out of 110 days: steps 109, tonnage 68, weight 68, sleep 66, RHR 58, HRV 55,
zone minutes 59, body battery 45, morning check-in 39, **readiness 24**, session RPE 20,
**calories 14**, **macros 6**.

Already built and not re-proposed here: `/api/health-trends` carries seven correlation views
(`subjective-recovery`, `session-rpe`, `rest-adherence`, `recovery-vs-strength`, `meal-timing`,
`energy-balance`, `soreness-volume`), plus `/api/sleep-performance-correlation`,
`/api/training-load`, `/api/readiness-score`, `/api/body-battery` and the HR-recovery-profile stack.

---

## 2. Findings that survive both controls

`r` = raw Pearson, `r|t` = partial correlation with the date trend removed, degenerate sleep rows
excluded.

### F1 — Later bedtime costs sleep, and the effect is large

| pair | n | r | p | r\|t | p\|t |
|---|---|---|---|---|---|
| bedtime → sleep duration | 52 | −0.481 | 0.0003 | **−0.534** | **<0.001** |
| bedtime → deep sleep | 49 | −0.307 | 0.032 | **−0.301** | **0.038** |

Regression slope: **−0.70 h of sleep per hour later to bed** (p = 0.0003), and −0.12 h of deep
sleep. Bucketed, on nights ≥ 4 h:

| bedtime | n | mean duration | deep |
|---|---|---|---|
| before 22:00 | 13 | 8.15 h | 0.90 h |
| 22:00–23:00 | 33 | 7.74 h | 0.93 h |
| after 23:00 | 6 | 6.92 h | 0.79 h |

Wake time does not compensate — the lost hour is not recovered in the morning.

**⚠ This finding is only correct with minutes-from-noon coding.** Encoded as a raw clock hour,
bedtime wraps at midnight (22:30 → 22.5, 00:30 → 0.5), which puts the latest nights at the bottom
of the scale. That coding produces r = **+0.75** against sleep efficiency and reads as *"later
bedtime → better sleep"* — the opposite of the truth, at high apparent significance. The helper
that does this correctly, `minutesFromNoon`, already exists in
`packages/shared/src/health/sleep-consistency.ts`. Any implementation must use it.

### F2 — Overnight HRV predicts that day's training volume

| pair | n | r | p | r\|t | p\|t |
|---|---|---|---|---|---|
| night HRV → same-day tonnage | 30 | +0.562 | 0.001 | **+0.495** | **0.006** |

Split at the median (48 ms): **4,376 kg mean tonnage below, 5,799 kg above — a 33 % difference.**
Night RHR points the same way (r = −0.491) but does not clear the trend control (p|t = 0.079).

This is a stronger and cleaner signal than the existing `recovery-vs-strength` view, which scores
HRV against mean 1RM-percent rather than volume. Volume is where the response actually shows.

### F3 — Body Battery is validated against subjective recovery

| pair | n | r | p | r\|t | p\|t |
|---|---|---|---|---|---|
| body battery end-of-day → perceived recovery | 39 | −0.400 | 0.012 | **−0.414** | **0.010** |

Negative is the correct direction (`perceivedRecovery` is 1 = fully recovered … 5 = wrecked). The
model tracks how the owner actually reports feeling. Bucketed the gradient is modest — 3.00 / 3.00 /
2.65 across battery bands < 40 / 40–60 / > 60 — so this is worth surfacing as **model validation and
an ongoing regression check**, not as a headline insight.

Derived readiness is weaker on the same target: r = −0.420 (p = 0.041) raw, but p|t = 0.131.

---

## 3. Findings that died under scrutiny — do not build these

Recorded so they are not re-derived and shipped as features.

| Candidate | Raw | After controls | Verdict |
|---|---|---|---|
| Workout start hour → night HRV | r = −0.517, p = 0.004 | p\|t = 0.263 | Start time trends with the date; no independent effect. |
| Steps → night HRV | r = +0.452, p = 0.002 | p\|t = 0.177 | Same trend confound. |
| Bedtime regularity (\|shift vs prev night\|) → sleep efficiency | r = −0.375, p = 0.006 | r = −0.112, p = 0.474 | Driven **entirely** by the sub-4 h rows. Vanishes on real nights. |
| Training tonnage → that night's HRV / RHR / duration | up to r = −0.392 | all p\|t > 0.20 | No measurable overnight cost of a session in this data. |
| Session RPE → that night's HRV | — | r\|t = +0.512, p = 0.036, **n = 18** | Significant but n = 18 and direction is counter-intuitive. Re-test at n ≥ 40 before believing it. |
| Set-to-set rest → next set performance | r = −0.241 (reps) | — | Reverse causation: rest is taken *because* the set was hard. Volume ratio r = −0.061. |
| Weekday effects | — | — | No sleep pattern. Tonnage varies (Fri 3,807 kg vs Thu 5,268 kg) but weakly. |

---

## 4. What blocks further analysis

### B1 — 21 % of the sleep table is not usable as nights, and every consumer eats it

14 of 66 rows are under 4 h; 13 under 3 h.

**Corrected 2026-08-05** after the owner asked whether these are one night being split into pieces.
The first draft of this section called them all "naps or sensing artefacts". That was wrong for 3 of
the 14. Checking every short row against the other rows on its own date splits them three ways:

| Group | n | What it is | Right response |
|---|---|---|---|
| **A — real bout beside an intact night** | **11** | A genuine evening/daytime bout with the **full night already stored separately and complete**. 2026-06-25: `19:14–19:42 (0.1 h)` **+** `22:11–06:49 (7.6 h)`. Same shape on 06-26, 06-28, 06-30, 07-02, 07-04, 07-07, 07-10, 07-16, 07-21, 07-26. | Filter at read time — nothing is lost. |
| **B — one night genuinely split** | **1** | 2026-05-29: `22:06–00:38 (2.5 h)` **+** `02:23–06:24 (4.0 h)`, ~1 h 45 m gap. One ~6.5 h night stored as two rows. | **Merge, not filter.** |
| **C — truncated, no remainder** | **2** | 2026-06-01 `22:14–23:41 (1.5 h)` and 2026-06-04 `22:13–02:03 (3.8 h)` are the **only** rows on their dates. | Unrecoverable at read time. |

Group B is the same failure `denseSensingSpan` addressed on 2026-08-03 (v1.252.8) — a real night
split by an interruption — and that fix only changes future rollups, so the historical row still
carries the split. Groups B and C are also the only three rows with **no `oura_id`**, while all 11 of
group A came from Oura Cloud, so fragmentation is specific to our own pipeline.

**The practical consequence: a naive "drop everything under 4 h" is right for 11 rows and destroys
half a real night on the 12th.** The fix has to merge before it filters.

Nothing does either today. `/api/sleep-performance-correlation`, the `meal-timing` view and the
`subjective-recovery` view all consume `listSleepSessions` unfiltered, so a fifth of every published
sleep correlation is computed over rows that are not nights. Q-10 already tracks the *storage* of
these rows; this is about every *consumer*, which is separable and much cheaper.

**Separate gap found in passing:** 2026-06-02 and 2026-06-03 have no sleep row at all — missing
outright, not fragmented.

### B2 — set-level HR analysis is data-starved

`set_hr_stats` has 582 rows across 45 of 80 workouts, but the fields needed for per-set physiology
are mostly null: `peak_bpm` 210, `drop_60s` 160, `pct_hrr_at_rest_end` 122, `sec_to_hrr50` 74,
`coverage_ok` 138. Only 92 rows join to a following set, and only 13 sets carry `planned_reps`.

The most interesting unbuilt question — *does how physiologically recovered you were at the end of
rest predict the next set?* — cannot be answered until coverage improves. **Q-11 is a prerequisite
for this analysis, not an independent cleanup.** Also note `rest_adequate` is non-null 245 times and
**true 245 times**, which is either a genuine finding or a stuck predicate and is worth one query.

### B3 — nutrition analysis is structurally dead

`food_logs` stops at 2026-07-26. Only 14 of 110 days have calories and 6 have macros. The
`energy-balance` view requires food and workouts on the same day and can essentially never fire; the
`meal-timing` view is nearly as thin. Either prompt nutrition logging or retire those two views —
leaving them rendering "not enough paired data" indefinitely is the worst option.

### B4 — derived columns with no producer (confirms Q-7b)

Out of 79 `oura_daily_derived` rows: `training_load_ots` 0, `night_hrv_baseline_ms` 0,
`chronic_stress_score` 0, `recovery_index_hours` 0, `vascular_age` 0, `pwv` 0, `worn_hours_ble` 0.
Partially populated: `body_comp` 57, `illness_score` 29, `bdi_derived` 29, `resilience_level` 13,
`daytime_stress_scaled` 11.

`/api/training-stress` computes and persists an OTS, and the column is empty across the whole
history — the route's gating conditions are never being met in practice.

### B5 — `rr_intervals` is written but barely read

28,476 RR intervals since 2026-07-17. `hrv-frequency.ts` (LF/HF) and `tachogram.ts` exist in shared;
the only consumer is a breathing-rate signal inside the adapter. Frequency-domain HRV over a
28k-interval corpus is the largest untouched analytical asset in the database.

---

## 5. The highest-value fix is not a new view

`correlationInsight` (`packages/shared/src/health/correlation.ts`) backs all seven `health-trends`
views and `sleep-performance-correlation`. It takes the highest-average and lowest-average bucket,
requires `count >= 3` per bucket, and renders a confident sentence whenever they differ by more
than **1 raw unit**.

There is no significance test, no sample-size reporting, and the threshold is unit-blind — one
percentage point in a percent-of-baseline view, one whole point on a 1–5 scale. With three data
points per bucket and seven live views, the engine is structured to manufacture confident sentences
out of noise.

This review is the demonstration: of the strongest raw correlations found, three vanished under a
trend control, one reversed under correct variable coding, and one was an artefact of unfiltered
rows. The existing engine applies none of those checks and would have shipped all five.

Making the engine honest raises the trustworthiness of eight surfaces at once and is a precondition
for adding any of the new views below.

---

## 6. Proposals, ranked

Queued in `docs/implementation-backlog.md` as Q-75 … Q-79.

| | Proposal | Evidence | Cost |
|---|---|---|---|
| **Q-75** | Significance-gate the correlation engine: report n, Pearson r and p, apply a date-trend control, refuse to render below a confidence bar | §5 — 5 of 5 strongest raw findings failed a control the engine lacks | S, shared lib + 8 call sites |
| **Q-76** | One `isAnalysableNight()` predicate, applied at every sleep-analysis read site | §4 B1 — 21 % of rows are not nights | S |
| **Q-77** | New view: bedtime → sleep duration and deep sleep, minutes-from-noon coded | §2 F1 — r\|t = −0.534, p < 0.001, −0.70 h per hour later | S, reuses `minutesFromNoon` |
| **Q-78** | Surface the HRV → training-volume coupling; candidate input to the prescription engine | §2 F2 — r\|t = +0.495, p = 0.006, +33 % across the median | M |
| **Q-79** | Body-Battery-vs-subjective validation panel (model check, not a user insight) | §2 F3 — r\|t = −0.414, p = 0.010 | S |

Not queued as features, deliberately: everything in §3 (measured, no effect), B2 (blocked behind
Q-11), B3 (needs an owner decision on nutrition logging, not code), B4 (already Q-7b).

---

## Caveats

- **Correlational, single subject, ~3 months.** None of this establishes causation. F1 is the only
  finding with an obvious mechanism (going to bed later with a fixed wake time shortens sleep).
- **Sample sizes are small** — n = 30 for F2, n = 39 for F3. Both should be re-tested at n ≥ 60
  before anything automated acts on them.
- **No multiple-comparison correction was applied.** Roughly 60 pairs were tested; at p < 0.05 about
  three false positives are expected by chance. F1 (p < 0.001) survives Bonferroni; F2 and F3 do
  not, and are reported as suggestive.
- **Not verified on device.** This is analysis over production data through the read-only endpoint.
  No app code was changed and nothing was exercised on the S25.
