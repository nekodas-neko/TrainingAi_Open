# Readiness — domain index

**Owns:** the readiness composite, Body Battery, daytime stress, stress resilience and chronic
stress, temperature deviation and its baseline, the illness radar, and recovery bands.

**Does not own:** the sleep metrics it consumes ([`sleep`](../sleep/README.md)) or HRV capture
([`heart-rate`](../heart-rate/README.md)). Readiness *publishes* a score built from other pillars'
inputs — a bug in an input belongs to that input's pillar.

## Code

| Area | Where |
|---|---|
| Composite & bands | `lib/health/readiness-composite.ts`, `live-readiness.ts`, `recovery-band.ts`, `recovery-index.ts`, `score-band.ts` |
| Stress | `lib/health/daytime-stress.ts`, `daytime-stress-thresholds.ts`, `stress-resilience.ts`, `chronic-stress-assembly.ts` |
| Temperature | `lib/health/temperature-baseline.ts`, `intraday-temp.ts` |
| Illness & baselines | `lib/health/illness-radar.ts`, `personal-baseline.ts`, `wear-confidence.ts` |
| Source availability | `lib/health/score-availability.ts` — which readiness inputs a user has for a day, the confidence band that follows, and `trailingBaselineZ` for building a baseline from a generic series |
| Body Battery UI | `components/body-battery/`, `components/body-battery-card.tsx` |
| Body Battery inputs | `packages/shared/src/health/body-battery-inputs.ts` — `resolveBatteryHrMax` (reserve ceiling from observed daily peaks, **not** `resolveMaxHr`) and `batteryConfidence` (is the day's HR series dense enough to mean anything) |
| Tables | `oura_daily`, `oura_daily_derived`, `body_metrics` |

**Score bands come from `scoreBand()` only** — never re-derive the 70/50 thresholds, and always
render the band's label/icon alongside its colour (CLAUDE.md, One Formula One Place).

## Reference docs

- [`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md)
  — **the first review to measure all five scoring pillars together, on the same production days.**
  Readiness is structurally blind to training load (Q-275); readiness and Body Battery share no
  variance (Q-276); and only Body Battery stamps a `model_version`, so mixed-model correlations are
  undetectable elsewhere (Q-273). Start here before touching any score — **but read its §1.3 against
  the calibration doc below, which found that finding (Q-271) was measured over eight days and does
  not hold over the series.**
- [`docs/reviews/2026-08-17-score-presentation-audit.md`](../../reviews/2026-08-17-score-presentation-audit.md)
  — **how the five pillars are actually presented (Q-281), 2026-08-17.** Read it before planning
  **Q-278**: it contradicts two of that entry's premises with measurement. Absent scores are already
  handled consistently everywhere (`—`, muted, band label suppressed — **never 0, never carried
  forward**), so what is missing is only the *why*; and **daytime stress and resilience have no score
  surface at all**, so "five pillars" may be three pillars and two derived values. Also:
  `scoreAvailability` has exactly one consumer, and the `score-audit/` layer has **zero** user-facing
  ones.
- [`docs/reviews/2026-08-17-readiness-calibration.md`](../../reviews/2026-08-17-readiness-calibration.md)
  — **the Recovery Index contributor, calibrated against Oura's own contributor** on the 15 nights
  where both exist (2026-06-23 → 07-07, the only ground truth this metric has). Three things to carry
  out of it: the shipped argmin estimator is **sound** (r = +0.712, better than every alternative
  tested — do not change it); the **6 h anchor is ~1 h too high** and the zero-bias fit is 4.63 h,
  proposed as 5 (**Q-500, ⛔ owner sign-off**); and Q-271's headline numbers ("never above 50, ever",
  "2.2 pts/day") are an 8-day artefact — over 41 days it is 12 days above 50 and 0.71 pts/day. Also
  files **Q-501**: persisted readiness rows drift from the summaries they derive from.
- [`docs/body-battery-tuning.md`](../../body-battery-tuning.md) — how the Body Battery model is
  tuned against physiology; the reasoning behind its constants. **Read the v5 section before
  touching any constant**: the v5 values were set by backtesting for distributional plausibility,
  not fitted to an outcome. **The "r = −0.06, no validated target" figure this list used to quote is
  superseded** — it pooled four model versions. Split by version, **v5 alone is r = +0.67 (n = 11)**
  for end-of-day battery → next-day readiness (2026-08-15). v5 does carry outcome signal; its
  in-day *shape* is the problem (drains 5× faster than it charges — Q-272).
- [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)
  — Q-57: the v4 → v5 input fixes, and the two prescriptions backtesting proved wrong.
- [`docs/reviews/2026-07-27-prod-data-audit-2-derived-metrics.md`](../../reviews/2026-07-27-prod-data-audit-2-derived-metrics.md)
  — which derived columns actually have producers and values in prod.
- [`docs/reviews/2026-08-05-data-analysis-opportunities.md`](../../reviews/2026-08-05-data-analysis-opportunities.md)
  — Body Battery validated against subjective recovery (r|t = −0.414, p = 0.010, **Q-79 shipped
  2026-08-05, v1.264.0** as an admin calibration panel — note the pairing is **same-date**, since the
  next-morning lag was measured and finds nothing; see
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md));
  overnight
  HRV predicts same-day training volume, +33 % across the median (**Q-78 shipped 2026-08-05,
  v1.263.0** as the `hrv-volume` trends view — observation only, **not** wired into the prescription
  engine until it is re-measured at n ≥ 60; see
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md));
  and a re-confirmation that
  seven `oura_daily_derived` columns are still 0/79, with `/api/training-stress` gating itself off
  permanently (Q-7b).
- [`docs/superpowers/plans/2026-08-02-health-connect-first-class-tier.md`](../../superpowers/plans/2026-08-02-health-connect-first-class-tier.md)
  + [`docs/../overview/history-2026-07-30.md`](../../overview/history-2026-07-30.md)
  — Q-43: the composite is no longer reachable only through the ring's rollup. Without an
  `oura_daily_summary` row it runs off `body_metrics`/`sleep_sessions` with the same
  `updateBaseline`, persists under `readiness_source: 'generic-derived'`, and the response carries
  `limited`/`scoreConfidence`/`inputsAvailable`. **The ingest side has never run against a real
  Health Connect provider** — see the `projectOverview.md` Known-Issues row.
- Plans: `ls docs/superpowers/plans/*readiness*` (3 today).
- [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
  — Workstream C (**shipped**, #996 / v1.250.2, see
  [`docs/../overview/history-2026-07-30.md`](../../overview/history-2026-07-30.md)):
  the Body Battery anchor was re-picked on every read, so it flipped from the sleep score to the
  readiness score part-way through the morning and shifted the whole day's curve. The rule now
  lives in `app/api/body-battery/anchor.ts` — a readiness anchor is frozen for the day, a sleep
  anchor is provisional and upgrades exactly once. The shared-composite refactor that would remove
  the fallback entirely is still open as Q-42.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-452 insight-over-no-data, Q-453 `/api/training-stress` accepts a malformed date). Findings Q-450…Q-455; four areas recorded **clean**.

## Open issues

```bash
grep -n '^### .*\[readiness\]' projectOverview.md   # 9 entries today
grep -n '\[readiness\]' docs/implementation-backlog.md   # 3 queue items today
```

Live at the time of writing (2026-07-30):

- ✅ **The "Fatigue detected" early-deload card explains itself** (Q-173, 2026-08-09, v1.277.0).
  `ReadinessScoreResponse.earlyDeload` carries the score/ACWR that tripped it and the thresholds
  they crossed; the card renders them in `DeloadExplanation`'s language. Note
  `EARLY_DELOAD_ACWR_MIN` (1.2) is deliberately below `ACWR_THRESHOLDS.optimalMax` (1.3). See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- 🔴 **Nightly temperature treats one frame's simultaneous probes as consecutive samples** —
  open, and it is backlog item Q-2.
- **The readiness composite is persisted under the wrong day** — found via Admin → Day Review,
  open and not yet fixed.
- 🟡 **Eight device-owned `oura_daily_derived` columns have no producer** (backlog Q-7b) —
  shared with `devices`.
- Chronic-stress rollup and stress-resilience are wired but compute null in the sandbox; neither
  is device-verified end to end.
- ~~Logging Exercise Readiness on Home could show "saved" while the screen stayed on the pre-save
  prompt~~ **fixed 2026-08-15 (Q-248, v1.317.1)** — the callback that flips `moodLog` was gated
  behind an awaited local-store write already documented as able to stall for minutes under sync
  contention; a new `onOptimisticSave` callback now fires on the same beat as the toast/close, while
  `onSaved` (the prescription refetch) deliberately stays behind the write to protect the
  session-164 cache-ordering rule. **⚠️ Not device-reproduced** — the fix addresses the cause the
  code evidences; if readiness later goes missing from the server under real sync contention, that
  is a second, still-open cause. See
  [`docs/overview/history-2026-08-15.md`](../../overview/history-2026-08-15.md).
- 🔴 **Q-310 (open, shared with `workouts`) — an ai_dynamic deload phase reached via the generic
  fallback branch never actually reduces load or gates PRs**, despite the header correctly labeling
  it "Deload." See the `workouts` domain entry for the traced root cause; readiness-relevant because
  the underlying signal that triggers the AI's deload decision never gets resolved, so another
  deload gets recommended right after.

## History

- Handoffs: `ls docs/handoff-*-readiness-*.md` — plus
  [`docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md`](../../handoff-2026-08-02-cross-owner-bug-batch-investigation.md)
  (Q-39 — the Body Battery anchor flipping source mid-day, **fixed in #996**), filed under `cross`
  because it spans five pillars and so is not matched by the glob above.
- Journal: `grep -rl 'readiness\|body.battery\|resilience' docs/overview/entries/` — including
  [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-113 — Morning Check-in no longer pre-fills Recovery/Sleep-quality from the very scores they're
  meant to independently validate; Motivation replaced with an illness/context flag feeding the
  shared `selfReportedSick` signal).
  Also [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)
  (Q-108 — the Body Battery chart's right-edge label was a hardcoded `"now"` literal, unrelated to
  the real last-sample time; now derived from it).
  Also [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-105 — the "Body temp elevated" explainer now shows the real deviation/threshold/baseline-nights
  numbers instead of a fixed qualitative sentence).
  Also [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)
  (Q-103 — the "How it moves" panel now reads the real `anchorSource` instead of unconditionally
  claiming Readiness, matching the two sibling lines on the same card that already did).

## Gotchas specific to this domain

- **The Body Battery anchor is frozen once readiness-derived** (`app/api/body-battery/anchor.ts`).
  Re-picking it on every read is what made the whole day's curve jump mid-morning; a later
  readiness *recompute* must not move it either, or the same bug returns through a smaller door.
- **An evening nap once threw away the whole day's Body Battery** — nap-vs-night resolution is a
  readiness concern too, not only a sleep one.
- **Temperature deviation is withheld until its baseline is mature** — an absent value here is
  correct behaviour, not a bug.
- **A partial day is not a full day.** Cumulative per-day fields (wear hours, active calories)
  read as anomalies if today's partial total is compared against completed days.
- **A check-in's `useState` initializer must not be score-derived.** The Morning Check-in's
  Recovery/Sleep-quality scales pre-filled from `scoreToScale(readiness/sleepScore)` for months —
  an unedited Save stored that guess as real self-report, silently contaminating any later
  correlation against the same score (Q-113). Any new subjective input that's meant to *validate* a
  computed score must default neutral, never from the score itself, and needs a persisted "was this
  actually touched" signal if it feeds calibration work later.
- **A signal like `selfReportedSick` that can be reported from more than one check-in needs exactly
  one shared resolver.** Before Q-113 it was computed independently at three call sites
  (`signals.ts`, the ai_dynamic home-recommendation path, the same-day reevaluate path) — now
  `resolveSelfReportedSick()` (`packages/shared/src/ai-periodization/signals.ts`) is the only place.
  A caching fingerprint gating expensive recomputation (`reevaluationKey()`) must include every
  input the signal it gates depends on — it covered only the mood log, so filling in the illness
  flag from the OTHER check-in after the mood log was already cached would have been silently
  ignored until the next full regeneration.
