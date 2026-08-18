# Tuning Agent 🎶 — baton

> **Successor sessions are titled `Tuning Agent 🎶`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** `claude/tuning-agent-role-x9jg4r` · **Q band:** 500–529 (next free: 506)

## Now
The owner's three-pillar range pass is complete as far as it can go without them.
- **Sleep — SHIPPED** (v1.319.0, Q-503): mean 84.1 → 69.5, sd 15.9 → 16.6, range 32–99, every band
  populated. [`review`](../../reviews/2026-08-18-sleep-score-range-recalibration.md).
- **Readiness — HELD** (Q-504): fix measured and ready (mean 66.8, sd 19.3, range 15–99); blocked on
  blast radius, not the owner. Five action thresholds need re-anchoring first.
- **Activity — BLOCKED ON THE OWNER** (Q-505): needs a decision about what the score means, not a
  number. [`review`](../../reviews/2026-08-18-activity-score-calibration.md).

## Next
1. **Q-504 — Readiness range calibration.** Analysis is done and in the review's §6; it is held only
   on blast radius, not on the owner. Re-anchor the five action thresholds to preserve firing rates
   before shipping the calibration, and land **Q-273 (model versioning) first**.
2. **Q-505 — Activity Score.** Analysed; waiting on the owner to choose between "score today"
   (re-weight toward the same-day lane) and "score recent training" (keep weights, fix the daily
   framing). Q-277 is the older discrimination finding this supersedes.
3. **Watch the shipped Sleep Score for two weeks.** If the new spread reads as jitter rather than
   signal, flatten `SCORE_CALIBRATION`'s 74–85 segment — it amplifies ~4 blend points into ~12
   displayed points around the median, which is the deliberate cost of range.

## Blocked
- **Q-500** (`RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5) — still awaiting the owner, and now **lower
  priority**: it was a ~1-point correction aimed at the same range problem Q-504 fixes wholesale.
  Re-measure it *after* Q-504 rather than stacking them.
- **Q-505** (Activity Score) — needs an owner *decision*, not sign-off. Tuning recommends "score
  today" and the entry says why.
- **Q-501, Q-502** queued, not blocked — neither is a scoring change.

## Claimed paths
**Claimed 2026-08-18, released when Q-503's PR merged** — Lane A territory, written under the owner's
explicit instruction (*"free reign; tune as needed"*), which overrides the standing propose-only rule
for this work:
`packages/shared/src/health/sleep-score.ts` · `packages/shared/src/health/rest-day-guidance.ts` ·
`packages/shared/src/changelog.ts` · `package.json`.
**Q-504 will need the same claim plus** `readiness-composite.ts`, `lib/health/readiness-payload.ts`,
`ai-periodization/ai-dynamic.ts`, `lib/oura-models/inference/ots.ts` — check Lane A's baton first.

## Do not re-litigate
- **Contributor curves set the RANKING; a calibration on the blend sets the RANGE.** Re-shaping all
  nine sleep curves moved the mean 84.1 → 73.6 and left sd at 14.9 (from 15.9). A blend of ~10 terms
  shrinks spread by ~1/√10 — its IQR was **6 points**. Do not try to fix a range problem with curves.
- **A threshold on a display scale is calibrated to that scale's distribution.** Re-anchor every one
  in the same PR as a range change, preserving the firing *rate*. `LOW_SLEEP_SCORE` 60 → 42 is the
  worked example; left alone it would have fired 26% of nights instead of 6%.
- **Sleep's ceiling is still reachable** (the `93` anchor). The owner's best real night blends to 91,
  so 100 is reserved, not routine. Three tests assert this — don't "fix" them by lowering it.
- **The Recovery Index estimator stays as it is** (r = +0.712 vs Oura's own, beating every
  alternative tested). Q-500 is the anchor only.
- **Q-271's headline numbers are dead** — measured over eight days; over 41 the contributor exceeds
  50 on 13 days and costs 0.55 pts/day. Superseded by Q-500.
- **Q-272's direction #1 is refuted** — the Body Battery charge window is reachable on a median 6.7%
  of waking samples, so `CHARGE_RATE` scales a term that is barely active. `REST_THRESHOLD`/the
  reserve is the lever (Q-502 doc §2).
- **A range calibration does NOT transfer to Activity.** Stretching preserves ranking, and Activity's
  ranking disagrees with its most variable input (828 steps scored 76; 8,935 scored 64; r = +0.42).
  A score that compresses a correct ranking can be stretched; one whose ranking is wrong cannot.
  Fix the weights first, measure, and only then consider a calibration.
- Q numbers come from the band above, not the backlog's next-free pointer. No migration numbers.

## Gotchas that cost time
- **A replay must reproduce the stored values before any counterfactual on it means anything.** It
  made the readiness work trustworthy; on Body Battery it failed (predicted 65/63 against stored
  7/10) and the honest outcome was a partial document. For sleep, the design harness was validated
  to mean-abs-error 4.3 first, and the final distribution was re-run through the **shipped
  TypeScript**, not the harness.
- **Production data moves under you mid-session.** 2026-08-13's summary was re-rolled while a review
  was being written (`recovery_index_hours` 1.20 → 5.78, a Q-274 fragment night self-healing).
  Re-pull before quoting, and record the pull time.
- **`/api/admin/db-query` truncates at 1000 rows** (paginate) and can return a spurious 401 under
  burst (retry with backoff).
- **The 30-day prune applies to `error_events`, not to the Oura tables** — check each view's real
  date range rather than assuming.
- **The 2026-06-23 → 07-07 window is the only place Oura's own contributors sit beside our raw
  inputs** — the sole external ground truth for any Oura-derived score. Reach for it.
