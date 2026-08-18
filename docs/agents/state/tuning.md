# Tuning Agent 🎶 — baton

> **Successor sessions are titled `Tuning Agent 🎶`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** `tuning/stress-resilience-calibration` · **Q band:** 500–529 (next free: 509)

## Now
The owner's three-pillar range pass is done as far as Tuning can take it. Nothing waits on them.
Since then, working only scores no other lane holds:
- **Daytime stress + resilience — MEASURED, propose-only** (Q-507, Q-508). The last two scores with
  no calibration review, and now none remain. `STRESS_HIGH_DAY_THRESHOLD_MIN = 120` fires at a
  healthy-looking 16% but on the **wrong days** (high-stress minutes correlate **+0.40** with
  readiness; the four firing days average readiness 79 against 65). **Resilience has emitted exactly
  one value ever** — level 5, granular at the 5.99 clamp, all 13 rows — because
  `longTermSleepRecovery` is a window *sum* where its siblings are means, carrying 70% of the
  recovery weight. It is **also dormant** — 13 rows on 2026-08-05, the same 13 today.
  [`review`](../../reviews/2026-08-18-stress-resilience-calibration.md).
- **Illness radar — MEASURED, propose-only** (Q-506). It has never produced an action-bearing flag in
  46 days, and the cause is a **cold-start-poisoned temperature baseline** (stored dev 253.7 vs a true
  nightly sd of 13.5 — **18.7×**) on the biomarker carrying **40%** of the weight. Same `tempZ` also
  makes readiness's temperature contributor near-constant.
  **Fix the baseline, not the thresholds** — Lane A implements.
  [`review`](../../reviews/2026-08-18-illness-radar-calibration.md).
- **Sleep — SHIPPED** (v1.319.0, Q-503): mean 84.1 → 69.5, sd 15.9 → 16.6, range 32–99, every band
  populated. [`review`](../../reviews/2026-08-18-sleep-score-range-recalibration.md).
- **Readiness — SHIPPED** (v1.321.0, Q-500): Recovery Index anchor 6 h → 5 h, fitted against Oura's
  own contributor. `READINESS_MODEL_VERSION` now stamped (`v3:ri5:2026-08-18`).
  **Q-504 (a range calibration) was REFUTED** — implemented, then reverted: it breaks three
  invariants the composite holds, and the z-slope lever fails because those contributors already
  saturate. [`review`](../../reviews/2026-08-18-readiness-range-refuted.md).
- **Activity — SPECIFIED, not built** (Q-505). All three decisions resolved; ready for Lane A.
  [`plan`](../../superpowers/plans/2026-08-18-activity-score-redesign.md) ·
  [`review`](../../reviews/2026-08-18-activity-score-calibration.md).

## Next
1. **Q-505 — build the Activity redesign** (Lane A). Decisions and sequencing are in the plan's §4.
2. **Verify the two shipped recalibrations against production.** Checked 2026-08-18 and **nothing has
   landed yet**: production runs 1.321.1, but **0 of 96 `oura_daily_derived` rows carry a `readiness`
   model version** and every stored score is still pre-recalibration. Stored scores are only rewritten
   when the route recomputes (on app open), and every existing row predates the deploy. Re-check after
   the owner next opens the app; the first stamped row is where the trend step falls.
3. **Re-measure the illness radar once Q-506's baseline is corrected** — every biomarker z in that
   review's §2 table moves by ~19×, so the radar may then fire *too* often. That is a calibration
   question and it is Tuning's, unlike the fix itself.
4. **Re-measure resilience once the recalibrations reach stored rows** (Q-508). Its call site passes
   **our** sleep score *and* the Recovery Index contributor, so both v1.319.0 and v1.321.0 feed it,
   all 13 existing rows predate both, and the move is *downward* on the term that is saturating.
   **Every score in the app now has a calibration review** — there is no un-reviewed pillar left to
   pick up cold.
5. **Re-derive Q-500's anchor on ~15 BLE-era nights.** The shipped fit is Cloud-era and BLE overnight
   HR is ~2× noisier, so 5 h is conservative for current data rather than wrong.
6. **Watch the shipped Sleep Score for two weeks.** If the new spread reads as jitter rather than
   signal, flatten `SCORE_CALIBRATION`'s 74–85 segment — it amplifies ~4 blend points into ~12
   displayed points around the median, which is the deliberate cost of range.

## Blocked
- **Nothing is blocked on the owner.** They delegated all open decisions on 2026-08-18
  (*"whatever your recommendation is… best practice + future proof"*). Q-500 shipped; Q-505's three
  decisions are resolved in its plan.
- **Q-505** (Activity Score) — decisions resolved, **ready for Lane A to build**. Not blocked.
- **Q-501, Q-502** queued, not blocked — neither is a scoring change.

## Claimed paths
**Claimed 2026-08-18, released when Q-503's PR merged** — Lane A territory, written under the owner's
explicit instruction (*"free reign; tune as needed"*), which overrides the standing propose-only rule
for this work:
`packages/shared/src/health/sleep-score.ts` · `packages/shared/src/health/rest-day-guidance.ts` ·
`packages/shared/src/changelog.ts` · `package.json`.
**Nothing is claimed now** — Q-506/507/508 are all docs-only and propose-only.
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
- **The zone HRmax is NOT a One-Formula-One-Place violation** — I claimed it was, shipped the claim,
  implemented a "fix" and reverted it. `resolveHrProfile` deliberately returns `maxHr` (ceiling) and
  `targetAnchorMax` (reachable targets), with `resolveBatteryHrMax` a third for the battery reserve;
  three named answers to three questions is the design. **Read a resolver's own comment before calling
  it a duplicate.**
- **Re-anchor thresholds for a SCALE change, not a BIAS correction.** `LOW_SLEEP_SCORE` moved with the
  sleep recalibration because the scale moved. Q-500 corrected one contributor's bias, so the days
  that cross a threshold are the fix working — cancelling them out would undo the change.
- **A range calibration does NOT transfer to READINESS either, and for a different reason than
  Activity.** It breaks three invariants the composite holds — contributions summing to the score
  (the audit panel), all-neutral → 50, and no-check-in capping below 100. The z-slope alternative
  fails because those contributors already saturate (hrvBalance median |z| 1.26 vs a 1.5 ceiling).
  Readiness has no compression bug: contributors sd 17–32, composite sd ~12, against 7.7 expected
  under independence.
- **A range calibration does NOT transfer to Activity.** Stretching preserves ranking, and Activity's
  ranking disagrees with its most variable input (828 steps scored 76; 8,935 scored 64; r = +0.42).
  A score that compresses a correct ranking can be stretched; one whose ranking is wrong cannot.
  Fix the weights first, measure, and only then consider a calibration.
- **A golden vector proves a port computes the same function; it says nothing about scale.** The
  resilience golden's `dailySleepRecoveryList` is 13 *identical* values of 0.6, two orders of magnitude
  below what production produces, so it pins the arithmetic while never exercising the summation that
  saturates the score. When a pinned port misbehaves in production, check the fixture's input
  *magnitudes* against real ones before doubting the port.
- **A healthy firing rate is not evidence a threshold is right.** The stress override fires on 16% of
  days, which is exactly what you would choose — and on the four *best* days, while staying silent on
  readiness 29. Always check *which* days a threshold selects, not just how many.
- **A threshold is not the lever when the input feeding it is broken.** The illness radar peaks at 38
  against a `watch` threshold of 40, which is exactly the shape that tempts a two-point threshold
  nudge. The z it is built on is divided by ~19× too much. Lowering the threshold would have hidden a
  dead biomarker behind a firing radar — the Q-504 mistake in a new costume. Check the input's
  distribution against the thing it summarises **before** touching a constant.
- **The other lanes' territory is off-limits by the owner's instruction (2026-08-18):** *"Only pick up
  new tuning opportunities that the other lanes don't have."* Q-502 (Body Battery), Q-505 (Activity)
  and Q-501 are Lane A's to build. Check all four batons before picking a score to measure.
- Q numbers come from the band above, not the backlog's next-free pointer. No migration numbers.

## Gotchas that cost time
- **A replay must reproduce the stored values before any counterfactual on it means anything.** It
  made the readiness work trustworthy; on Body Battery it failed (predicted 65/63 against stored
  7/10) and the honest outcome was a partial document. For sleep, the design harness was validated
  to mean-abs-error 4.3 first, and the final distribution was re-run through the **shipped
  TypeScript**, not the harness.
- **`updated_at` does NOT tell you which model wrote a row.** On 2026-08-18 a bulk job bumped
  `updated_at` on ~every `oura_daily_derived` row at 03:55:01 without rewriting a single score. Auditing
  "did the recalibration land?" by timestamp gives the wrong answer — check the `model_version` stamp,
  or recompute from inputs.
- **Production data moves under you mid-session.** 2026-08-13's summary was re-rolled while a review
  was being written (`recovery_index_hours` 1.20 → 5.78, a Q-274 fragment night self-healing).
  Re-pull before quoting, and record the pull time.
- **`/api/admin/db-query` truncates at 1000 rows** (paginate) and can return a spurious 401 under
  burst (retry with backoff). **A sustained `Forbidden` is different** — on 2026-08-18 it began
  refusing *every* query including `SELECT count(*)`, and stayed refusing across retries with backoff.
  That is not the burst 401; budget the queries a session needs rather than iterating against it, and
  when it locks out, write up what you already measured rather than blocking (Q-508's per-gate
  coverage was lost this way).
- **The 30-day prune applies to `error_events`, not to the Oura tables** — check each view's real
  date range rather than assuming.
- **The 2026-06-23 → 07-07 window is the only place Oura's own contributors sit beside our raw
  inputs** — the sole external ground truth for any Oura-derived score. Reach for it.
