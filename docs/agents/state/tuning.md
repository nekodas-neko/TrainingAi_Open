# Tuning Agent 🎶 — baton

> **Successor sessions are titled `Tuning Agent 🎶`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-20 · **By:** `claude/tuning-agent-0q9yl7` · **Next ID:** `TN-2`. **The band that ran out is gone** — IDs now count up from your own `TN-` prefix with no ceiling, so there is nothing to agree with the owner. Find the next free with `grep -rhoE '\bTN-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`.

## Now
The owner's three-pillar range pass is done as far as Tuning can take it. Nothing waits on them.
Since then, working only scores no other lane holds:
- **⛔ I RETRACTED MY OWN Q-528 ON 2026-08-20 — read this before trusting any row count in this baton.**
  I filed "`oura_daily_summary` holds **1 row**, a full-history rollup wiped the history". **It holds 45,
  and 43 of them were created 2026-08-17 07:50** — they existed continuously through the reading that
  said one. The count came from `pg_stat_user_tables.n_live_tup`, which is a **planner ESTIMATE, not a
  count**: `last_analyze`/`last_autovacuum` are NULL on every table here, and the same field reads **0**
  against `oura_raw_packed`'s **764** real rows. **To ask whether a table is empty, run `count(*)`.**
  Q-528 is rewritten as a latent hazard (the delete-before-guard shape is real, `fullHistory`-only, and
  **has not fired**); its "rebuild the summaries" half is deleted. **CLAUDE.md's session-start size read
  now carries the size-vs-counter split**, because that rule is what sent me wrong.
  - **Q-525 IS LIVE AGAIN** — the suspension it inherited was based on a phantom. And it is sharper:
    **both countable gates PASS.** The 2026-08-17 `fullHistory` pass built **43** summary rows against a
    threshold of 21, and **27 of 31** nights in the trailing window are complete at the summary level.
    That pass scored illness on all 23 derived rows it wrote and chronic stress on **0**. **The refusal
    is inside the granular layer** (`signalsByDate` → `computeNightIntermediates`), which is recomputed
    in memory by design and **persists no reason for a null** → filed **TN-1**.
  - **Q-522's half still stands** — `oura_bucket` is genuinely 0 rows (row-scoped view, re-checked).
    Only the `oura_daily_summary` line was misread; do not sweep the rest of that day's work away.
  [`review`](../../reviews/2026-08-20-daily-summary-wipe-retracted.md).
- **Owner acceptance criterion on Q-529: "accurate on first open, without needing time to adjust".**
  Measured the whole chain — **the cause is neither scoring nor rollup. The ring uploads about once an
  hour**: 214 batches over 7 days, **median gap 62.0 min**, p90 71, max 306. The owner opened in the
  gap between the 05:40 and 06:44 uploads, so their wake was still on the ring.
  - **Three links, ordered:** drain on app open (**native ⇒ new APK**, the dominant term) → rollup and
    re-score on that drain (~4 min today) → provisional state until both land (**the only part
    shippable without an APK**). **Doing the rollup alone makes the app faster at showing stale data.**
  - **Say the limit out loud:** open before the ring registers the night's end and nothing fixes it —
    session end was 06:47, screenshot 06:46. Target is *within seconds of the ring knowing*.
  - **⛔ The 62-min cadence is OBSERVED, not a documented setting.** Whether it is configurable and
    what it costs in ring battery is unknown, and the firmware is deliberately frozen — check before
    promising an on-open drain is cheap.
  [`review`](../../reviews/2026-08-20-accurate-on-first-open.md).
- **⚠️ Q-529 was OVERCLAIMED and corrected hours later — read before touching it.** I filed "the
  score is never recomputed". **It is** (47 → 55, `computed_at` 06:45:56 → **06:54:41**, after the
  session settled 06:51:03). The "near-twin" also failed: 08-17 matched on *duration and onset* and
  differs on **REM 1.42 vs 2.08 h** (contributor 63 vs **99**) and efficiency 86 vs 90 (**57 vs 82**) —
  the remaining 23 points are the score **working**. What survives is a **~9-minute window where a
  provisional score renders as final**; re-scoped Lane A → **Lane B** and merged with the range-label
  Known Issue.
  - **Two mistakes compounded, both avoidable:** a **three-minute** observation used to assert a
    *permanent* absence, and a twin chosen on the summary columns that happened to be in the query
    rather than on the contributor vector. **Compare contributors, not summary columns** — the
    hypnogram decode an hour later did it right and got the answer first time.
- **Owner report 2026-08-20 — sleep score stamped mid-sync** (Q-529). *"That wake up time is way
  off, I woke up around 6am."* **The session was already right and the score was not.** `computed_at`
  **06:45:56** vs `sleep_sessions.updated_at` **06:46:19** — the score predates its input by 23
  seconds, and had not recomputed 3 minutes later. Session healed 4:52 am → **6:44 am**, 6.5 →
  **7.75 h**; score stuck at **47** while the 08-17 near-twin (7.58 h, 90%, 35 m) scores **78**.
  - **Check the cheap thing FIRST before anyone builds a recompute path:** re-read `computed_at` for
    2026-08-20 the next day. Confirmed over 3 minutes, **not** hours — a slower nightly pass may fix
    it, which would shrink this to surfacing provisionality.
  - **Not a duplicate of Q-520.** That is a genuinely incomplete night; this is a complete night
    scored against a partial copy of itself.
  [`review`](../../reviews/2026-08-20-sleep-score-computed-mid-sync.md).
- **~~`oura_daily_summary` holds 1 row against 198,223 raw samples~~ (Q-528) — ⛔ RETRACTED 2026-08-20,
  see the top of this section.** The table holds 45 rows and always did. The `replaceOuraDailySummary`
  delete-before-guard shape is real and `fullHistory`-only, but **it has not fired**; the "rebuild the
  summaries" instruction is withdrawn. **Its two knock-on claims split:** the correction it applied to
  **Q-525 is void** (that entry is live again, and sharper), while **Q-522's half stands** —
  `oura_bucket` carries `met_mean`/`motion_mad`, MET and motion do not drift with fitness, and it
  genuinely holds **0 rows**, so an HR-based fit still inherits the drift.
  [`retraction`](../../reviews/2026-08-20-daily-summary-wipe-retracted.md) ·
  [`original`](../../reviews/2026-08-19-daily-summary-replace-wipe.md).
- **Daily vs weekly windows — MEASURED, reshapes Q-505** (owner question, 2026-08-19). *"The goal
  being x heart minutes per day… but you also gotta count for weekly targets. How handle this?"* —
  correct, and bigger than it looks. `DEFAULT_ZONE_MINUTES_GOAL = 22` is **WHO 150/week ÷ 7**.
  **Rule: match each contributor's window to its guideline's unit** — applied across all six, exactly
  one is wrong (`zoneMinutes`). **Recommendation: split the Activity Score into Today and This Week.**
  - **This RETIRES the `strengthFreq`-ceiling framing I added the same morning.** 100 on 78% of days
    is a defect in a daily score and *correct* in a weekly compliance number. **Its scorecard was the
    problem, not its ceiling** — do not re-file it as a constraint.
  - **Q-522 rises in priority** — under the split, `moveHours` becomes half the daily number.
  - **Do NOT claim "the score is really a weekly number" from the 60%-rolling-weight figure.** I
    nearly did. The rolling terms saturate, so they set the LEVEL and carry almost no variance:
    score ↔ same-day steps **+0.324**, ↔ sessions7d +0.186, ↔ volume7d **+0.026** (n = 23).
  [`review`](../../reviews/2026-08-19-daily-vs-weekly-windows.md).
- **Body Battery drain model — FITTED, propose-only** (Q-521 closed out, **Q-527** filed). The owner
  resolved the contradiction between their two answers and added a term: *"the fitter we get, the more
  workout stimulus we should need for draining, outside of BMR draining which should naturally go up
  too."* → **goal-normalised + a BMR-proportional baseline.**
  `endValue = max(0, 100 − b − (100 − b) × c^2.0)`, `b = 25 × bmrToday/bmrReference`,
  `c = 0.5×workoutFrac + 0.5×stepsFrac`. Everything-hit **0** · workout-only **~30** · nothing **75** ·
  typical **~44**.
  - **A LINEAR split cannot satisfy the brief — do not let an implementer try it first.** Every
    allocation swept lands mean 26–34 / sd 16–22, because a typical day is ~58% of a full one. Not
    saturation: workout completion sd **0.403**, steps sd **0.346** — both vary well.
  - **Expect LESS spread than shipped and say so up front**: sd **~22.6** vs **30.1**, range 0–75 vs
    0–100. Today's spread is ring wear time. The 75 ceiling is inherent to having a baseline term.
  - **BMR is flat (r = +0.080 over 3.5 months)** — build for it, don't promise it in UI copy.
  [`review`](../../reviews/2026-08-19-body-battery-drain-model.md).
- **THREE OWNER DECISIONS ANSWERED 2026-08-19, and TWO of my asks withdrawn.** Read this before
  asking the owner for anything.
  - **Q-523 — no labels needed after all.** The owner's *"use current recorded high, % off it,
    dynamic"* pointed at `targetAnchorMax`, which `resolveHrProfile` **already computes** (observed
    **167** vs age-predicted **187**; `maxHr` deliberately refuses to drop below the age value). That
    alone only moves zero-days 53→38 of 59. The real defect: **`activeMinutesFromZoneSeconds` is one
    band off the WHO convention it documents** — it calls ≥60% reserve "moderate" when WHO moderate
    is **40–59%**, so **moderate intensity maps to no zone and earns nothing.** Fixed rule takes the
    contributor to **6/59 zero days, sub-score sd 38.7 — the highest-variance input in the score.**
    [`review`](../../reviews/2026-08-19-active-minutes-who-threshold.md).
  - **Q-524 — one goal: `users.steps_goal` wins**, `getDailyGoals()` reads it, derived value is the
    fallback. The AI-recommend + manual-entry half **already exists** and needs no work.
  - **Q-276 — Body Battery = "energy left"; Readiness = a morning starting number.** Different
    questions, so **+0.12 is not a defect**. Readiness needs **no model change** — all nine weights
    are overnight/previous-day, nothing reads today. **Presentation only → Lane B, unblocked now**;
    the "wait for Q-272" instruction no longer applies.
  - **Q-72 — the ask to spread the sleep ratings is WITHDRAWN.** `sleep_quality_feel` is the **most**
    variable **live** self-report (only `perceived_recovery`, sd 0.36, is still collected alongside it) and
    tracks efficiency at **+0.316**. Volume (+0.03) and RPE (−0.02) are **structurally disqualified** —
    volume is prescribed by the app, RPE has a 1.5 dead band. **Fix the yardstick, not the rating.**
    [`review`](../../reviews/2026-08-19-sleep-validation-targets.md).
- **Score-audit trail — MEASURED** (Q-525, Q-526). Whether each score leaves enough behind to be
  calibrated retrospectively. Over 96 rows: **sleep, readiness and illness are fine** (readiness is
  the reference — sub-scores *plus* `provisional` flags; illness's stored biomarkers are what let
  Q-506 diagnose a poisoned baseline from history). **Activity stores the blend wrapper**
  `{base, adjustment, trained}` instead of its six components, which are in memory on the same
  request — that is why the contributor audit could only report a *predicted* sd ceiling, since the
  goals changed underneath on 2026-08-11. **Q-526 is sequenced BEFORE Q-505** or the old model's
  history is lost. **`chronic_stress_score` is NULL on all 96 rows** — third dormant score (Q-525);
  its gate needs 21 granular nights **in one pass**, so an incremental rollup can never satisfy it.
  [`review`](../../reviews/2026-08-19-score-audit-trail.md).
- **Activity Score contributor audit — COMPLETE, and it ANSWERS Q-277** (Q-524 filed, Q-277 removed).
  All six contributors measured over 90 days. **Only `steps` (sd 33.4) and `strengthVolume` (sd 23.8)
  carry information.** `strengthFreq` is at 100 on **78%** of days; `moveHours`, `zoneMinutes` and
  `activeEnergy` carry none. After renormalisation **51% of effective weight is informative, 49% is
  not**, and the largest effective weight (strengthFreq, 33%) is one of the inert ones. Q-137/Q-190
  **did** work — stored sd **5.0 → 7.4** across 2026-08-11 — but history is not back-filled.
  **Q-524:** the Goals Progress card and daily digest grade steps against **7,000** while the Activity
  Score and its own progress bar use **10,000**; the derived 10,000 contradicts the Paluch 7–8k
  plateau `daily-goals.ts` cites, while the 8,000 fallback matches it. Owner decision.
  [`review`](../../reviews/2026-08-19-activity-contributor-audit.md).
- **Zone minutes + movement-per-hour coverage — MEASURED, propose-only** (Q-522, Q-523). The check
  Q-521 deferred, asked for directly by the owner. **Both inputs are unusable, failing in opposite
  directions.** `moveHours` is **saturated** — 856 of 857 waking hours with data count as "moved",
  **48 of 59 days score exactly 100**, so its only variance is ring-off hours. `zoneMinutes` is
  **floored** — **0 on 53 of 59 days**, because Zone 2 starts at 133 bpm and the chest strap's p99
  during workouts is **121**. Plus a third defect: `DEFAULT_MAX_GAP_SEC = 120` against the ring's
  **exact 300 s cadence** truncates 80.1% of its intervals, so ring days keep 35% of elapsed time and
  strap days 84%. **Q-521's first slice must be steps + workout load only.**
  [`review`](../../reviews/2026-08-19-zone-minutes-move-hours-coverage.md).
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
2. ~~Verify the two shipped recalibrations against production~~ — **DONE 2026-08-18, both are LIVE**
   — **but see Q-518: the readiness stamp is erased within hours by the bodyComp backfill**, so the
   "merge held in production" half of that verification is **retracted**.
   Sleep was verified by recomputation (no stamp): 08-17 stores 78 against a raw blend of 77.91 (old),
   08-18 stores 92 against a calibrated 92 (new). **The trend step falls between 08-17 and 08-18** and
   history is not back-filled, so 95 of 96 rows stay pre-recalibration.
   [`review`](../../reviews/2026-08-18-recalibrations-live-verified.md).
3. **Do NOT propose a Zone 2 floor for Q-523 without the owner's labels.** Fitting a threshold needs
   days the owner would call "active" to fit against; guessing a number into the code is how the
   current one got there. Ask for the labels, then fit — that half *is* Tuning's.
4. **Re-run the Q-509 refit after any HR-smoothing change.** The anchor-vs-input ratio (§1.3 of that
   review) is the pass test: if it goes to ~1.0 the estimator was fine and the input needed
   conditioning. Until then, `RECOVERY_INDEX_OPTIMAL_HOURS` stays at 5.
5. **Once Q-510's coverage is persisted, ask whether `minDaytimeStressHours` is too strict** for this
   wear pattern. That one *is* Tuning's — but it is unanswerable until the number is visible.
6. **Re-measure the illness radar once Q-506's baseline is corrected** — every biomarker z in that
   review's §2 table moves by ~19×, so the radar may then fire *too* often. That is a calibration
   question and it is Tuning's, unlike the fix itself.
7. **Re-measure resilience once the recalibrations reach stored rows** (Q-508). Its call site passes
   **our** sleep score *and* the Recovery Index contributor, so both v1.319.0 and v1.321.0 feed it,
   all 13 existing rows predate both, and the move is *downward* on the term that is saturating.
   **Every score in the app now has a calibration review** — there is no un-reviewed pillar left to
   pick up cold.
8. ~~Re-derive Q-500's anchor on BLE-era nights~~ — **DONE, and the answer was "do not"** (Q-509).
9. **Watch the shipped Sleep Score for two weeks.** If the new spread reads as jitter rather than
   signal, flatten `SCORE_CALIBRATION`'s 74–85 segment — it amplifies ~4 blend points into ~12
   displayed points around the median, which is the deliberate cost of range.

## Owner reports handled
- **2026-08-19 — "body battery still doesn't seem that good… id like granular drain."** Measured and
  the owner is right: **drain tracks ring WEAR TIME, not exertion** — `corr(hr_sample_count,
  total_drained)` = **+0.518** while `corr(steps, total_drained)` = **−0.153**, and a workout moves
  `end_value` by **0.6 points** (50.6 vs 50.0). The four days that hit 0 had **828–4,152 steps**.
  Filed **Q-521** with an exertion-integrated design brief.
  **Their other two asks are already done or specified:** sleep's 90–100 band is delivered by Q-503
  (7 of 65 replayed nights in the 90s — it just isn't visible because stored history is pre-recalibration),
  and Activity's "everything hit = 100" is Q-505, unbuilt.
  [`review`](../../reviews/2026-08-19-body-battery-drain-and-roadmap.md).
- **2026-08-19 — ring not worn until 4 am.** Filed **Q-519** (manual bedtime entry, writes exactly one
  column) and **Q-520** (partial-night flag, sequenced second and deliberately manual). The owner
  proposed manual bedtime and it is smaller and better-targeted than the flag I had suggested.
  [`review`](../../reviews/2026-08-19-partial-night-manual-bedtime.md).

## Pillar coverage — this is the real scoreboard, not "every score has a review"
The owner asked on 2026-08-18 whether **all pillars** had been tuned against historical data. The
answer was **no**, and the previous baton wrongly said the lane was drained. It was drained of
*health-score* work. Track pillars, not scores:

| pillar | calibration coverage |
|---|---|
| sleep | ✅ recalibrated (Q-503) + consumer audit (Q-511) |
| readiness | ✅ Q-500 shipped, Q-504 refuted, threshold table completed (Q-511) |
| activity | ✅ **fully audited 2026-08-19 — nothing left to measure here.** All six contributors: only `steps` (sd 33.4) and `strengthVolume` (sd 23.8) carry information; `strengthFreq` 78% at ceiling **by design**; `moveHours` saturated (Q-522), `zoneMinutes` floored (Q-523), `activeEnergy` absent (Q-521). **49% of effective weight cannot vary.** Q-277 answered and removed; Q-524 filed (two step goals). Build (Q-505) is Lane A's |
| body | ✅ battery range clean; anchor measured (Q-511). **Derived scores closed out 2026-08-19**: `bdi_derived` (46 rows, median 4.15, nothing ≥ 15, **no threshold exists** — only consumer is a debug console labelled *"observational, not a diagnosis"*) and `body_comp` (71 rows, deterministic, published formula matched to Oura's `atlas`). **Nothing to tune in either.** [`review`](../../reviews/2026-08-19-body-derived-scores-closeout.md) |
| devices | ✅ illness (Q-506), stress + resilience (Q-507/508), BLE drift (Q-509/510) |
| **workouts** | ✅ **swept 2026-08-18** — ACWR (Q-512/513), RPE autoregulation (Q-514). **Clean:** Foster monotony, and prescription adherence (actual 73.6% vs planned 73.1%, reps +0.25 — so `INTENSITY_ZONES` is realised, and calibrating those zones would be circular since the program was generated from them). Only Q-514 and the two ACWR call sites are open. **Foster monotony CLEAN** — mean 1.29, the 2.0 gate fires on 1 of 102 windows; rest days are properly seeded at 0, which is what makes it meaningful. 1RM's `amrapScaleFactor` is **unreachable from production** (tests only) — do not spend time on it |
| **heart-rate** | 🟡 **swept 2026-08-18, extended 2026-08-19** (Q-522/Q-523 are the Activity-side continuation of Q-515 and Q-516 — same boundary, same banding, second consumer) — `HR_REST_THRESHOLD` (**Q-515**: shrank 3× in a month because the owner got fitter; no fraction fixes it, the *anchoring* is the defect) and `PEAK_BANDS` (**Q-516**: observed set-peaks are 59–132, so 2 of 5 bands are **structurally unreachable** and 72% of episodes land in the band the spec de-emphasises — one usable bucket). **Karvonen zone boundaries checked and deliberately NOT filed** — they are consumed on *cardio* surfaces only, and the history holds ~13 run/treadmill sessions (newest 2026-07-24). Fitting five boundaries to that is fitting noise. **Do not re-open by measuring all-day HR** — that gives a 99% Zone 1 figure that reads like a finding and is the wrong denominator |
| **nutrition** | ✅ **swept 2026-08-18.** Movement goals were already calibrated (Q-137/Q-190, [`docs/activity-goal-calibration.md`](../../activity-goal-calibration.md)); step/zone-minute goals are deliberate population anchors. TDEE outcome check done (**Q-517**: the food log captures **~45%** of intake, and `adaptive-tdee`'s gates hold 75% of windows but let through values as low as **1,052 kcal** — below the owner's own BMR of 1,547) |
| **cardio** | ❌ none, and **deprioritised**: `RIEGEL_EXPONENT 1.06` and the VDOT coefficients are published population fits, and there is too little running history here to beat them |
| app-shell, platform | n/a — no scoring surface |

**Next unblocked MEASUREMENT work: none.** Workouts, heart-rate and the nutrition TDEE check were
completed 2026-08-18, and the zone-minutes / movement-per-hour coverage check 2026-08-19. Every pillar with a scoring surface
is measured except **cardio**, which is deliberately skipped for lack of data (~13 run/treadmill
sessions, newest 2026-07-24), not for lack of time.

**Measured is not fixed.** Two changes have shipped (Q-500, Q-503). **Twenty-three findings are open —
Q-506…Q-528 — all propose-only, none built.** They are Lane A's queue. Ranked by consequence:
1. **Q-518** — the model-version stamp is erased within hours, which blocks the measurement
   infrastructure the rest depend on. One conflict-arm expression.
2. **Q-517** — a maintenance below the owner's own BMR is one tap from becoming their calorie goal.
3. **Q-514** — ~64% of the engine's back-off load cuts are a clamp artefact.
4. **Q-506** — the illness radar has never been able to fire.
5. **Q-515** — the rest/active boundary shrinks as the owner gets fitter.

**So a successor should not go looking for a pillar to measure.** The useful Tuning work now is
re-measuring *after* Lane A lands one of the above — each fix has a stated pass test in its entry.

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
- **`sleep_sessions` duration/efficiency are STORED columns, not derived from `sleep_end − sleep_start`**
  — and Q-519's whole design depends on that staying true. Writing only `sleep_start` at source
  `manual` (rank 5) fixes a wrong bedtime while leaving the ring's duration/HRV/HR at `oura_ble`
  (rank 3), because the health-source merge is **per field, not per row**. **If anything ever
  recomputes duration or efficiency from the span, that design silently yields a 9-hour night at 34%
  efficiency.**
- **A single positive reading of a shared mutable field proves the WRITER, not the invariant** (Q-518).
  I verified the `model_versions` merge by observing one readiness write and published that it "held in
  production"; **5h40m later a sibling writer had erased the key**. `COALESCE(excluded, existing)` on a
  `jsonb` column replaces the document whole, so the merge lives in each caller and only one of two
  does it. **When checking a shared field, the thing to observe is the NEXT write by someone else.**
- **Body Battery's drain does not respond to activity AT ALL** (Q-521) — do not re-measure this, and
  do not try to fix it by tuning `DRAIN_RATE`. Drain is `-DRAIN_RATE × (hrr − REST_THRESHOLD) × dt`,
  purely HR-driven, and with Q-515's boundary down at ~60 bpm nearly every waking sample drains, so
  **drain ≈ rate × time worn**. **Q-521 is downstream of Q-515** — a new drain model built over a
  boundary that moves with fitness inherits the drift.
- **`active_calories` cannot be a load-bearing input anywhere** — present on **8 of 51** days. Steps
  are on all 51. Any design needing calories silently degrades. Check an input's coverage before
  designing around it. **Then it happened twice more:** `moveHours` (Q-522) and `zoneMinutes` (Q-523)
  are both present on every day and both **carry no information** — one pinned at 100, one at 0.
  **Coverage is not enough; check the input's SPREAD too.** An input that is always there and always
  the same reads, in code review, exactly like a working term. Steps are still the only movement
  input that is both present and variable.
- **Do not assert a PERMANENT absence from a THREE-MINUTE observation.** Q-529 shipped saying a score
  is never recomputed; it recomputed nine minutes after the read. If a claim is "X never happens",
  the observation window has to be long enough for X to have happened. Where it is not, say what was
  actually observed — the hedge was written and the conclusion ignored it.
- **When a score looks wrong, compare `computed_at` against the input row's `updated_at` BEFORE
  reaching for calibration.** Q-529 looked like a sleep-score tuning problem and was a 23-second
  ordering bug. A near-twin day from the same week is the fastest sanity check — 7.58 h scoring 78
  against 7.75 h scoring 47 settled it in one query.
- **A column with rows is not a live field — check the last write date AND the write site.** I asked
  the owner to reword or drop `resting_soreness` because it read exactly 3 in all 20 entries. It had
  been **retired on 2026-07-23**, and `morning-checkin-sheet.tsx` says so in a comment two lines long:
  *"Retired scales — always null so a re-save clears any historical value."* The owner caught it
  (*"I thought we removed this?"*). **A constant value is a symptom of a retired question at least as
  often as a broken one**, and `SELECT ... WHERE col IS NOT NULL` cannot tell them apart. One
  `max(log_date)` per column would have.
- **⛔ `pg_stat_user_tables` is NOT row-scoped, and that does NOT make its row counts true.** This
  rule used to end *"use it to check whether a table is empty"* and that is how Q-528 was filed against
  a table that was never empty. Its **size** columns are exact (filesystem reads); its **`n_live_tup`
  / `n_dead_tup` are planner estimates**, and `last_analyze` is NULL on every table here, so they can be
  arbitrarily stale — measured 2026-08-20: **0** against `oura_raw_packed`'s **764** rows, **1** against
  an `oura_daily_summary` holding **45**. Use `count(*)`. Where the worry is that a `claude_ro` view
  hides other users' rows, write the finding as **"none of the owner's"** — the counter cannot see them
  either.
- **Check a goal's WINDOW against its source, not just its value.** A weekly guideline divided by
  seven is a different guideline. `zoneMinutesGoal = 22` is WHO 150/week ÷ 7 and had been read as a
  daily target for months. The strength lane in the same file already does this correctly, which is
  what made the inconsistency findable.
- **A saturated contributor is not automatically broken — check which scorecard it belongs in.**
  `strengthFreq` at 78% ceiling was filed as an unremovable constraint in the morning and turned out
  to be correct behaviour in the wrong place by the afternoon. Ask what question the number answers
  before concluding it cannot discriminate.
- **A dormant data-quality bug becomes live the moment a new model reads that column.** One
  `body_comp` row (2026-07-29: 3% body fat, BMR 1,890 against ~1,520 around it) has sat harmless for
  weeks because nothing keys a visible number off stored BMR. Q-521 makes BMR drive baseline drain, so
  it turns into a day that drains a quarter faster (Q-527). **When proposing a model, check the input
  column's data quality — not just its coverage and spread.**
- **Before asking the owner for labels, check whether a PUBLISHED threshold answers it.** Q-523's
  ask for "days you'd call active" was unnecessary: WHO/ACSM already defines moderate intensity, and
  the code's own comment claimed to implement it. Asking the owner to hand-label data so a constant
  could be fitted would have replaced a published number with a bespoke one — worse, and slower.
- **Low self-report variance is not the same as no information, and asking for more spread is a
  trap.** A rating consciously stretched to fill a scale stops measuring what it measured before and
  invalidates the history already collected. Use a rank measure over the extreme entries instead.
- **A target the app PRESCRIBES cannot validate a number the app produces.** Training volume looked
  like the obvious outcome to predict from sleep; it is dictated by the program (adherence 73.6% vs
  73.1% planned), so its ~0 correlation is structural, not evidence of no effect. Same for RPE
  (`RPE_DEAD_BAND = 1.5`). Check whether a candidate yardstick is free to move before using it.
- **`chronic_stress_score` (vendored cumulative model) is NOT Q-507's daytime stress.** Same word,
  different mechanism — Q-507 is `STRESS_HIGH_DAY_THRESHOLD_MIN` in minutes, and it fires. Merging
  them loses the fact that one has never produced a value at all (Q-525).
- **Check the persist SITE, not the column name.** A `%contributor%` column grep said illness stored
  no trail; it stores one as `illness_biomarkers`, on 46 of 46 scored rows. Caught before filing, and
  it narrowed the finding from "two scores keep no trail" to "one keeps the wrong one".
- **Do NOT propose raising `strengthFreqGoal` or extending `STRENGTH_FREQ_CURVE` past ratio 1.0.**
  It sits at 100 on 78% of days and looks like the obvious next calibration. `daily-goals.ts` sets
  the goal *at* the owner's typical deliberately — the ACWR taper handles over-reach, and *"a goal
  of 6 would have one part of the model rewarding what another punishes."* That reasoning holds.
  **Measured-and-deliberately-not-filed is a valid outcome**; filing it would be manufacturing a
  finding.
- **The per-contributor breakdown is NOT persisted.** `oura_daily_derived.activity_contributors`
  holds `{base, adjustment, trained}` — the blend wrapper, not `computeActivityScore`'s six
  components. Any contributor-level question must be **reconstructed** from stored inputs with the
  shipped formulas. Budget for that; do not go looking for a column that holds it.
- **A contributor fix can be undone from the other half of its own fraction.** Q-188 fixed
  `moveHours` for being pinned at 100 by correcting the **denominator**; the **numerator** now
  saturates for an unrelated reason and the contributor is pinned at 100 again. `hourly-movement.ts`
  carries a comment describing the first failure, which reads as protection and is not. **When
  re-checking a metric with a recorded past fix, re-measure the OUTPUT, not the thing that was
  fixed.**
- **Range is a first FILTER, not a verdict — and the cross-pillar table already exists.**
  [`2026-08-19-cross-pillar-score-ranges.md`](../../reviews/2026-08-19-cross-pillar-score-ranges.md)
  has every pillar's spread side by side; do not re-derive it. Headline: **only Body Battery genuinely
  spans** (sd 29.6, though 5 of 51 days sit exactly on a clamp bound), **activity is the most
  compressed thing in the app** (sd **6.0**, zero days under 50), and **sleep's stored 85.3 is the OLD
  model** — the shipped one replays to 69.5.
  **Range catches the stuck-score class instantly** (resilience's one value, illness never firing,
  `strengthFreq` at exactly 100 on 91 days) **and cannot see a score that moves the wrong way** —
  Q-507's stress metric has a fine spread and correlates **+0.40** with readiness. Always pair it with
  a correlation against a signal the score did not come from, and count days sitting on a clamp bound.
- **`bdi_derived` and `body_comp` are checked and have nothing to tune — do not re-measure them.**
  BDI has **no threshold anywhere**; its only consumer is a debug console that labels it observational,
  and `validation/oura-summary.ts` classes it an open-ended research metric. `body_comp` is a
  deterministic derivation whose one formula is deliberately matched to Oura's `atlas` — same category
  as cardio's Riegel/VDOT constants. If BDI ever gains a user-facing band, **that** is when it needs
  calibrating, and not from 46 nights of one person.
- **The app's BMR is `ffm × 21.6 + 370`, NOT the textbook Cunningham `500 + 22 × LBM`.**
  `body-composition.ts` deliberately matches Oura's `atlas` postprocessor, and the nutrition-goal
  baseline imports the same function. I used the textbook form from memory in Q-517 and published a
  BMR 152 kcal too high, which propagated into TDEE, the under-logging percentage and the floor test —
  corrected 2026-08-19. **The repo's "verify against the pinned source, not memory" rule is written
  about external field names; it applies to formulas too.**
- **A universal plausibility floor cannot protect a per-person quantity** (Q-517).
  `MIN_PLAUSIBLE_MAINTENANCE = 1000` is 52 kcal below where this owner's under-logging artefact lands
  (1,052), and the module's own comment had predicted the failure at 1,200. **Floor it at the user's
  own BMR** — below-BMR maintenance is impossible by definition, not implausible by taste. Measured:
  blocks 10 of 23 passing 14-day windows and tightens the range to 1,592–2,219 (at the app's real BMR
  of **1,547** — see the formula note above).
- **Coverage gates that count logged DAYS cannot see within-day incompleteness.** The owner's log is
  ~45% complete per day yet sails through a 70%-coverage gate, because a day with breakfast logged and
  nothing else counts as fully logged. **Do not respond by raising `MIN_LOGGED_FRACTION`** — it already
  refuses 75% of windows and would drop good ones while keeping bad ones.
- **Never scale logged intake by a factor inferred from the weight trend.** Maintenance is *derived*
  from that trend, so it is circular and reproduces the assumed TDEE as if measured.
- **Check what population a constant is asked to classify before measuring it.** The Karvonen zone
  boundaries look catastrophic against all-day HR (99.8% of BLE samples in Zone 1) and that denominator
  is simply wrong — they are consumed on cardio surfaces only. The fair denominator (~13 run/treadmill
  sessions, newest 2026-07-24) is too thin to fit five boundaries to, so **nothing was filed**. Two dead
  ends, both recorded so they are not walked again.
- **A "for stable bucket sizes" comment is an EMPIRICAL claim — measure it** (Q-516). `PEAK_BANDS`
  says exactly that and is false here: observed set-peaks are 59–132, so the 150–169 and 170+ bands are
  **structurally unreachable**, 130–149 holds 2 episodes, and 72% land in the `<110` band the spec tells
  callers to de-emphasise. **And the de-emphasis is correct** (mean `drop_60s` 3.0 below 110 vs 14.9
  above), so re-banding recovers no hidden signal — peak HR in a lifting set mostly does not reach the
  range where HR recovery means anything. **Re-banding without saying so converts a visibly-empty
  feature into an invisibly-noisy one.**
- **A boundary pinned to resting HR moves ~2× as fast as waking HR** (Q-515). Resting HR is the more
  responsive fitness marker: over one month the owner's resting fell 8.5 bpm while waking HR fell 4.2,
  so the rest/active boundary dropped 8.9 and the charge window collapsed 26.5% → 8.2%. **Every input
  was correct** — a real fitness gain plus `resolveHrProfile` maturing `hr_max` from the age formula to
  an observed ceiling. Sweeping `HR_REST_THRESHOLD` narrows the July/August gap from 3.2× to 1.4× but
  never closes it, so **the constant is not the lever; the anchoring is.**
- **A self-referential boundary is fine for a pure classifier and wrong for anything feeding a score.**
  The tempting fix for Q-515 — a percentile of the owner's own waking HR — is stable by construction
  and therefore makes Body Battery charge near-constant, so a genuinely restful day cannot read as one.
  That is "the treadmill" the repo already removed from the activity-goal volume lane (Q-190).
- **Foster monotony is clean — do not re-open it.** 7-day monotony over 102 windows: mean 1.29,
  median 1.34, sd 0.31, range 0.41–2.32; `HIGH_MONOTONY = 2.0` fires on **1 window (1.0%)**, which is
  right for a risk flag. `assemble-plan-context` seeds all 7 days at 0 so rest days count, which is the
  correct Foster definition — that detail is what makes the threshold meaningful, so do not "optimise"
  it to training days only.
- **Exercise names map to MORE THAN ONE role** (`Barbell Shrug` is accessory *and* secondary, 20+ others
  too). Any `session_exercises`-by-name join fans out and its per-role aggregates are unsound. Cost me
  one measurement this session; the finding was re-derived without role attribution.
- **Q-514's 64% is a ratio over RPE-gate windows, NOT over load cuts.** A cut also needs a falling 1RM
  or missed reps, and the owner misses reps on only **7.1%** of sets (mean completion 1.046). So the
  absolute number of cuts prevented is well below 25. Quote the ratio, never "64% of your load cuts".
- **Prescription adherence is clean** (actual 73.6% vs planned 73.1%, reps +0.25 over). That is why
  `INTENSITY_ZONES` was deliberately **not** calibrated: the program is generated from those zones, so
  checking them against work they produced is circular. Adherence is the non-circular question.
- **`RPE_DEAD_BAND = 1.5` is RIGHT — do not tune it** (Q-514). It sits on a flat part of the
  sensitivity curve (1.25→20.7%, 1.5→17.5%, 2.0→14.9%) and the delta distribution is centred. The bias
  is in the input: `expectedRpe`'s **floor** clamp binds on 6.5% of sets (the ceiling never binds),
  giving them a **+1.89** mean delta against **−0.34** for everything else, which fires the back-off
  arm. Excluding them removes **64% of back-off triggers and zero push triggers** — the asymmetry is
  the proof it is bias, not sensitivity. **Third instance today of "the threshold is right, the input
  is wrong"** (Q-506, Q-512, Q-514). Check the input's distribution before touching any constant.
- **ACWR's thresholds are RIGHT — do not tune them** (Q-512/513). Over 77 sessions the
  decision-driving variant reads mean 0.99, median 1.05, sd 0.32, bands 18/69/13/0%. The `> 1.5`
  emergency deload has **never fired** (max 1.48) and that is **correct** — an emergency deload that
  fires often is not an emergency. **This near-miss is the opposite call to Q-506's**, and the
  difference is the input: there one biomarker's baseline was 18.7× wrong, here the distribution is
  healthy. *A near-miss is a symptom, not a diagnosis — check the input first.* The bugs are the
  call-site windows, not the constants.
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
