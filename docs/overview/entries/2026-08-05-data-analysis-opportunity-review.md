# 2026-08-05 — What else the recorded data can tell us (analysis review, no code)

**Branch:** `claude/data-analysis-opportunities-w4k4b6` · **Domain:** platform · sleep · readiness ·
**Docs only — no code changed, no version bump**

## The question

With ~3 months of production data recorded, what further analysis or recommendations can the app
derive that it does not already? The answer had to be grounded in the data rather than in what
sounds plausible, so every claim below is measured through `POST /api/admin/db-query`.

## Method, and why the method is the finding

A 110-day daily matrix (2026-04-30 → 08-05, 64 columns) joined across `sleep_sessions`,
`workout_sessions`/`exercise_logs`/`set_logs`, `day_checkins`, `body_metrics`, `oura_daily`,
`oura_daily_derived`, `body_battery_daily` and `daily_zone_minutes`, analysed with Pearson
correlation plus two controls:

1. **A date-trend control.** Overnight HRV correlates with the calendar at **r = 0.79** over this
   window. Anything else that trends with time correlates with HRV for free.
2. **Degenerate-row exclusion.** 14 of 66 sleep rows are under 4 h and are not nights.

**Both controls changed the answer**, and that turned out to be the most valuable result. Of the five
strongest raw correlations found: three vanished under the trend control, one was entirely an
artefact of the degenerate rows, and one **reversed direction** under correct variable coding. The
app's own `correlationInsight` applies none of these checks — so it would have shipped all five.

## What survives

- **Later bedtime costs sleep.** r|t = −0.534, p < 0.001, n = 52. Slope **−0.70 h of sleep per hour
  later to bed**; deep sleep −0.12 h (p = 0.038). Wake time does not compensate. Queued as **Q-77**.
- **Overnight HRV predicts that day's training volume.** r|t = +0.495, p = 0.006, n = 30. Split at
  the median (48 ms): 4,376 kg vs 5,799 kg mean tonnage — **+33 %**. Queued as **Q-78**.
- **Body Battery agrees with subjective recovery.** r|t = −0.414, p = 0.010, n = 39, correct sign.
  Model validation rather than a user-facing insight; the bucketed gradient is modest. Queued as
  **Q-79**.

## The midnight-wrap trap, recorded so it is not repeated

Encoded as a raw clock hour, bedtime **wraps** (22:30 → 22.5, 00:30 → 0.5), which puts the latest
nights at the bottom of the scale. That coding gives r = **+0.75** against sleep efficiency and reads
as *"later bedtime → better sleep"* — the opposite of the truth, at high apparent significance.
`minutesFromNoon` in `packages/shared/src/health/sleep-consistency.ts` already handles this.

## Measured, and deliberately not built

Recorded in the review so a future session does not re-derive and ship them: workout start hour →
night HRV (p|t = 0.263), steps → night HRV (p|t = 0.177), bedtime regularity → efficiency (collapses
from p = 0.006 to p = 0.474 once the degenerate rows go), training tonnage → any overnight recovery
marker (all p|t > 0.20), set-to-set rest → next-set performance (reverse causation), weekday effects.

## What blocks the rest

- **21 % of the sleep table is not usable as nights**, and no consumer filters it — queued as
  **Q-76** (consumer side; distinct from Q-10's storage side). **Corrected after the owner asked
  whether these were one night split into pieces:** it is three populations, not one. 11 are a real
  evening bout beside a **complete** night, 1 is a genuinely split night (2026-05-29, the same
  failure `denseSensingSpan` fixed on 08-03 — future rollups only), and 2 are truncated with nothing
  stored to recover. **A naive under-4 h filter is right for 11 and destroys half a real night on the
  12th**, so the fix has to merge before it filters. The first draft of this entry called all 14
  "naps or artefacts" and was wrong for three of them.
- **Set-level HR physiology is data-starved** — `pct_hrr_at_rest_end` is present on 122 of 582 rows
  and only 92 rows join to a following set. Noted on **Q-11**, which this promotes from cleanup to
  prerequisite. Side-check recorded there: `rest_adequate` is `true` on all 245 non-null rows.
- **Seven `oura_daily_derived` columns are still 0/79** — re-confirmed on **Q-7b**, with a new
  detail: `/api/training-stress` computes and persists an OTS, yet `training_load_ots` is empty
  across the entire history, so that route is gating itself off permanently.
- **Nutrition analysis is structurally dead** — `food_logs` stops at 2026-07-26; 14 days of calories,
  6 of macros. `energy-balance` can essentially never fire. Owner decision, filed under "not yet
  queued".

## The highest-value item is not a new view

**Q-75**: `correlationInsight` backs all seven `/api/health-trends` views plus
`/api/sleep-performance-correlation`. It compares the best and worst bucket at `count >= 3` and
renders a confident sentence whenever they differ by more than **1 raw unit** — no significance test,
no sample size, and a unit-blind threshold (one percentage point in one view, one whole scale point
in another). Making it honest raises the trustworthiness of eight surfaces at once and is a
precondition for Q-77/Q-78/Q-79, which would otherwise inherit the same flaw.

## Caveats stated in the review

Correlational, single subject, ~3 months. Small samples (n = 30 and n = 39 for two of the three
findings). No multiple-comparison correction across ~60 pairs tested — only the bedtime finding
survives Bonferroni; the other two are reported as suggestive. Nothing was verified on device
because nothing was built.

**Full evidence:** [`docs/reviews/2026-08-05-data-analysis-opportunities.md`](../../reviews/2026-08-05-data-analysis-opportunities.md)
