# Tuning Agent 🎶 — baton

> **Successor sessions are titled `Tuning Agent 🎶`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** `tuning/battery-range-clean` · **Q band:** 500–529 (next free: 512)

## Now
The owner's three-pillar range pass is done as far as Tuning can take it. Nothing waits on them.
Since then, working only scores no other lane holds:
- **Body Battery range — CLEAN, nothing filed.** Over 50 days: mean 51.5, **sd 29.2**, full 0–100
  range, bands Charged 28% / Good 26% / Low 26% / Drained 20%. **It already passes the owner's
  acceptance test** — the only pillar that did without work. Thresholds 75/50/25 sit right for this
  distribution. [`entry`](../../overview/entries/2026-08-18-battery-range-clean.md).
- **Sleep-scale consumer audit — CLEAN, plus one side effect worth protecting** (Q-511). Exactly
  **one** comparison threshold exists on the sleep scale codebase-wide (`LOW_SLEEP_SCORE`) and it was
  re-anchored in the recalibration PR, so nothing was missed. The audit did find that Body Battery's
  anchor takes the sleep score **raw**, and its sleep→readiness flip was worth **−17.7 points** (sd
  10.2, worst −51) — the owner's 2026-08-02 "the number visibly jumped" report, quantified. The
  recalibration cut ~82% of that systematic offset as a **side effect**. The symmetric readiness-scale
  audit found Q-500's threshold table listed **six of eight** — `ots.ts:151` and a `< 40` line inside
  an **LLM prompt string** were missing; the conclusion holds (checked, not assumed) and that review is
  amended in place. [`review`](../../reviews/2026-08-18-battery-anchor-discontinuity.md).
- **BLE-era input drift — MEASURED, propose-only** (Q-509, Q-510). The Recovery Index refit on 42
  BLE nights lands at **3.31 h** against the shipped anchor of 5 — and **the anchor must not move**:
  the refit anchor and the input distribution shrank by the *same* factor (0.715× vs 0.72–0.74×), which
  is a multiplicative bias in the estimator, not a change in the owner. This is the `devices` finding
  `readiness-composite.ts` pre-registered. Q-510 closes Q-508's open lead: all four `contributorsOk`
  gates pass 18/18 August days, so resilience is starved by the daytime-stress **coverage** check —
  which is not persisted anywhere, and `worn_hours_ble` is NULL on all 96 rows.
  [`review`](../../reviews/2026-08-18-ble-era-input-drift.md).
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
2. ~~Verify the two shipped recalibrations against production~~ — **DONE 2026-08-18, both are LIVE.**
   Readiness: 1 of 96 rows stamped `v3:ri5:2026-08-18`, and the shared JSONB **merge held**
   (`bodyComp` survived). Sleep has no stamp so it was verified by recomputation — 08-17 stores 78
   against a raw blend of 77.91 (old), 08-18 stores 92 against a calibrated 92 (new).
   **The trend step falls between 2026-08-17 and 08-18**, and history is not back-filled, so 95 of 96
   rows stay pre-recalibration. [`review`](../../reviews/2026-08-18-recalibrations-live-verified.md).
3. **Re-run the Q-509 refit after any HR-smoothing change.** The anchor-vs-input ratio (§1.3 of that
   review) is the pass test: if it goes to ~1.0 the estimator was fine and the input needed
   conditioning. Until then, `RECOVERY_INDEX_OPTIMAL_HOURS` stays at 5.
4. **Once Q-510's coverage is persisted, ask whether `minDaytimeStressHours` is too strict** for this
   wear pattern. That one *is* Tuning's — but it is unanswerable until the number is visible.
5. **Re-measure the illness radar once Q-506's baseline is corrected** — every biomarker z in that
   review's §2 table moves by ~19×, so the radar may then fire *too* often. That is a calibration
   question and it is Tuning's, unlike the fix itself.
6. **Re-measure resilience once the recalibrations reach stored rows** (Q-508). Its call site passes
   **our** sleep score *and* the Recovery Index contributor, so both v1.319.0 and v1.321.0 feed it,
   all 13 existing rows predate both, and the move is *downward* on the term that is saturating.
   **Every score in the app now has a calibration review** — there is no un-reviewed pillar left to
   pick up cold.
7. ~~Re-derive Q-500's anchor on BLE-era nights~~ — **DONE, and the answer was "do not"** (Q-509).
8. **Watch the shipped Sleep Score for two weeks.** If the new spread reads as jitter rather than
   signal, flatten `SCORE_CALIBRATION`'s 74–85 segment — it amplifies ~4 blend points into ~12
   displayed points around the median, which is the deliberate cost of range.

## The lane is drained — everything left is blocked or needs elapsed time
Every score in the app now has a calibration review, and both recalibrated scales have been audited
for missed consumers. What remains:
- **Blocked on Lane A:** Q-506 (temperature baseline), Q-509 (HR smoothing), Q-510 (persist stress
  coverage), Q-505 (build Activity), Q-502. Each of these must land before the Tuning follow-up on it
  can be measured.
- **Needs elapsed time:** watching the new Sleep distribution; re-measuring resilience and the
  post-recalibration anchor gap once enough new-model rows exist (there is currently **one**).
Do not manufacture work here. If a successor finds nothing actionable, say so rather than
re-measuring a settled score — the "do not re-litigate" list below exists to make that cheap.

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
- **Body Battery's range is settled and healthy** — sd 29.2 over 50 days, all four bands 20–28%, full
  0–100. Do not re-open it as a range problem. Its open questions are Q-272 (charge/drain), Q-276
  (does it agree with readiness at all) and Q-511 (the anchor), none of which are about the spread.
  Note its stored charge/drain now read 23.1/36.0 where the 2026-08-17 review measured 7/10 — nobody
  changed the model, so that is an **unexplained** change in the data, not a fix.
- **A scale-consumer audit misses thresholds inside LLM prompt strings.** Grepping for numeric
  comparisons against a score variable will never find `external_readiness < 40` written as prose in
  `ai-periodization/prompt.ts` — yet it is a real threshold on our own score
  (`externalReadiness = liveReadinessForDay(...)`). When auditing a scale, grep the prompt builders
  too. This is how Q-500's table came to list six of eight.
- **⚠️ DO NOT lift the sleep scale back toward its old mean.** It will look tempting — the new
  distribution reads harsh. But the sleep and readiness scales being within a few points of each other
  is now **load-bearing for Body Battery**: its anchor takes the sleep score raw, and the
  sleep→readiness flip was worth −17.7 points before the recalibration and ~−3 after (Q-511). Lifting
  sleep re-opens an owner-reported bug in a different pillar. Also: the scores agreeing *on average* is
  not the same as agreeing, so **the anchor's freeze-once rule stays load-bearing** (per-day sd is
  still 10.2).
- **When a refit's anchor moves by the same factor its input moved, the input is what changed.** That
  is the Q-509 test, and it is reusable for any anchored contributor: a real physiological shift moves
  the data while leaving the correct anchor put. Do not ship a constant that is silently absorbing a
  measurement bias — and note the readiness code pre-registered this exact conclusion before the data
  existed, which is why it was easy to honour. Pre-register the interpretation next time too.
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
- **The sleep recalibration's band consequences are settled, not open.** `scoreBand()`'s 50 boundary
  moved 1 → 6 days and the 70 boundary 12 → 15, measured and deliberately accepted at ship time — more
  days reading "Low" is the point. Do not re-open it as a finding.
- Q numbers come from the band above, not the backlog's next-free pointer. No migration numbers.

## Gotchas that cost time
- **A replay must reproduce the stored values before any counterfactual on it means anything.** It
  made the readiness work trustworthy; on Body Battery it failed (predicted 65/63 against stored
  7/10) and the honest outcome was a partial document. For sleep, the design harness was validated
  to mean-abs-error 4.3 first, and the final distribution was re-run through the **shipped
  TypeScript**, not the harness.
- **An unstamped model's LAST stage is still verifiable: is the stored score the plain combination of
  its own persisted inputs, or the post-processed one?** That is how the sleep recalibration was
  confirmed live without a stamp (08-17 → raw blend 77.91, 08-18 → calibrated 92, differing by 8 and
  6 points). **It sees post-processing only, never changes upstream of the persisted intermediate** —
  persisted contributors are already whatever curves that row's model used. Applying
  `SCORE_CALIBRATION` to *historical* contributors to ask "what would the new model have scored?"
  gives a hybrid (new post-processing over old curves) that reads as the recalibration *raising* the
  mean — backwards. Tried it this session; it is a trap worth naming.
- **A recalibration is not a uniform reduction.** 2026-08-18's sleep score went *up* under the new
  model (blend 86.07 → 92) even though the recalibration dropped the mean 84.1 → 69.5 —
  `SCORE_CALIBRATION` lifts the upper-middle. Checking "did it land?" by looking for a lower number on
  a good night gives the wrong answer.
- **`updated_at` does NOT tell you which model wrote a row.** On 2026-08-18 a bulk job bumped
  `updated_at` on ~every `oura_daily_derived` row at 03:55:01 without rewriting a single score. Auditing
  "did the recalibration land?" by timestamp gives the wrong answer — check the `model_version` stamp,
  or recompute from inputs.
- **Production data moves under you mid-session.** 2026-08-13's summary was re-rolled while a review
  was being written (`recovery_index_hours` 1.20 → 5.78, a Q-274 fragment night self-healing).
  Re-pull before quoting, and record the pull time.
- **`/api/admin/db-query` truncates at 1000 rows** (paginate) and can return a spurious 401 under
  burst (retry with backoff). **It can also lock out for minutes at a time** — on 2026-08-18 it
  refused *every* query including `SELECT count(*)`, survived several retries with backoff, then
  recovered on its own. (An earlier version of this line called that a distinct, sustained failure;
  it was not — same transient, longer.) Budget the queries a session needs rather than iterating
  against it, and when it locks out, write up what you measured and come back — Q-508's per-gate
  coverage was deferred this way and closed as Q-510 an hour later.
- **The 30-day prune applies to `error_events`, not to the Oura tables** — check each view's real
  date range rather than assuming.
- **The 2026-06-23 → 07-07 window is the only place Oura's own contributors sit beside our raw
  inputs** — the sole external ground truth for any Oura-derived score. Reach for it.
