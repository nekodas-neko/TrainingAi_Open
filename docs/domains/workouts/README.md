# Workouts — domain index

**Owns:** programs and their sessions/exercises, progression styles, set logging, personal records
and 1RM, the AI prescription engine and role ordering, Exercise Readiness, deload, phase tracking,
the in-workout screen and its timers, and workout history/stats.

**Does not own:** cardio sessions ([`cardio`](../cardio/README.md)) or per-set HR interpretation
([`heart-rate`](../heart-rate/README.md)).

**Hard rule:** no hardcoded session names, cycles, or rest-day logic anywhere — session identity is
the DB id, never the name. See CLAUDE.md, "No Hardcoded Session Names or Training Structure".

## Code

| Area | Where |
|---|---|
| Orchestrator + children | `components/workout-screen.tsx`, `components/workout/`, `components/workout-builder/`, `components/exercises/` |
| Write path (one function per domain) | `lib/workout/log-exercise.ts` — used by both the API route *and* the `pushMutations` branch |
| Formulas | `lib/1rm.ts`, `lib/health/soreness-volume.ts`, `workout-density.ts`, `workout-energy.ts`, `strength-progress.ts`, `strength-projection.ts`, `workout-activities.ts` |
| Prescription / AI | `lib/ai-periodization/`, `lib/session-explain/` |
| UI routes | `app/workout/`, `app/workout-select/`, `app/session-select/`, `app/history/`, `app/config/`, `app/stats/` |
| Tables | `programs`, `program_sessions`, `session_exercises`, `progression_styles`, `style_sets`, `schedules`, `workout_sessions`, `exercise_logs`, `set_logs`, `personal_records`, `exercise_library` |

Mode flow and the orchestrator pattern are documented in [`CLAUDE.md`](../../../CLAUDE.md)
(Architecture → Workout flow).

## Reference docs

- [`docs/reviews/2026-08-16-deferred-measurements.md`](../../reviews/2026-08-16-deferred-measurements.md)
  — the measurements four entries deferred. **Rest is NOT the confound behind Q-289** (the error
  survives in all four rest bands), **Q-304's escape hatch did not fire** (28 of 29 high-rep sets
  carry no `planned_pct`), and **Q-298 is a one-line fix** (`log-exercise.ts:264` stores only the AI
  deload flag while `:196` also zeroes on the phase). Root cause under Q-289/Q-299/Q-304 is shared:
  prescribed sets score r=0.50 vs unprescribed r=0.30 — **get a style onto more than 28% of sets**.
- [`docs/reviews/2026-08-16-multi-user-load-test.md`](../../reviews/2026-08-16-multi-user-load-test.md)
  — **Q-298 RESOLVED**: the unexplained zero-1RM rows were a `Pull` session whose phase entered
  `deload` that day; the estimate was zeroed by design and `exercise_deloaded` was never stamped,
  which is why Q-228's filter misses them. Also §2: the emergency-deload RPE trigger (`> 2.0`) sits
  0.07 inside Q-289's measured +1.93 error — blocked on Q-289 (Q-306). Phase engine reviewed: **clean**.
- [`docs/reviews/2026-08-15-workout-model-round-3.md`](../../reviews/2026-08-15-workout-model-round-3.md)
  — round 3. **Corrects Q-298**: five of its ten zero-1RM rows are zero by design (`estimateOneRm`
  returns 0 when `deloaded`); the surviving issues are the `0`-vs-`null` sentinel and three rows that
  should compute and do not. Plus the high-rep AMRAP gap (Q-304, carries a qualifier that may close it)
  and volume landmarks computed but never surfaced (Q-305). §5 lists what is still unreviewed.
- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — round 2. Ten `exercise_logs` store `estimated_1rm = 0` and Q-228's `exercise_deloaded` filter
  misses half of them (Q-298); autoregulation reads missing prescription data optimistically on the
  add-load path (Q-299); 37% of sets are rushed and `expectedRpe` has no rest term (Q-300).
  **Progressive overload is working** — 10 of 12 lifts improving. §7 lists what is still unreviewed.
- [`docs/reviews/2026-08-15-uncovered-lenses-review.md`](../../reviews/2026-08-15-uncovered-lenses-review.md)
  — **the first review of whether the training model is sound, not just correct.** `expectedRpe`
  measured against 569 real production sets: r = 0.348, and its systematic error at expected RPE 5
  (+1.93) and 10 (−2.19) **exceeds the `RPE_DEAD_BAND` of 1.5 that autoregulation triggers on**
  (Q-289). Logged RPE itself has sd 0.87 (Q-290). `MUSCLE_LANDMARKS` and the `repFactor`-inversion
  method both came out sound — read §1.1 before changing either.
- [`docs/prescription-intensity-matrix.md`](../../prescription-intensity-matrix.md) — the intensity
  reference computed from the live engine; what the engine actually prescribes.
- [`docs/reviews/2026-07-10-workout-system-review.md`](../../reviews/2026-07-10-workout-system-review.md)
  and [`docs/reviews/2026-07-05-workout-backlog-review.md`](../../reviews/2026-07-05-workout-backlog-review.md).
- Plans: `ls docs/superpowers/plans/*workout*` (7 today) and `*prescription*`.
- [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
  — Workstream D (**shipped**, #995 / v1.250.1, see
  [`docs/../overview/history-2026-07-30.md`](../../overview/history-2026-07-30.md)):
  accepting a phase transition emptied the prescription card permanently, because `advancePhase`
  writes `prescriptionStatus: 'none'` and every recovery path (the "Preparing" placeholder, the
  bounded poll, the client-side regeneration trigger) keys on `'consumed'`. The status a transition
  leaves behind now lives in one named constant,
  `app/api/ai-periodization/session/[sessionId]/transition/status.ts` — change it and the whole
  recovery chain goes dark, so it carries its reasoning with it.
- [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md)
  — 3 workouts findings (Q-53/54/55), all queued: prescription-flow cache staleness after a
  mutation, a prescription-generation write race under concurrent triggers, and a third unfixed
  instance of the bodyweight-1RM-as-kg bug (`overview-screen.tsx:484`).
- [`docs/superpowers/plans/2026-08-02-per-exercise-phase-hold.md`](../../superpowers/plans/2026-08-02-per-exercise-phase-hold.md)
  — **planned, Q-52.** Phase is per session type, so every compound in a session transitions
  together; a stalled secondary gets dragged into a heavier zone by a progressing primary. Adds a
  backwards-only `phase_offset` on `session_exercises`, **derived by the engine at transition time
  and never user-configured** (an owner steer — a static offset handicaps a lift whose problem is
  temporary). Records why real per-exercise phase state was rejected (transition signals, the
  multiplied transition flow, and no single phase left to render), and why the offset cannot go
  forwards (`capLoadToAnchor`).
- [`docs/superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md`](../../superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md)
  — **planned, Q-83.** Once a per-lifter warmup median is learned, it's a fixed absolute minute
  count subtracted from every Quick/Normal/Long preset budget with no scaling — so Quick loses
  proportionally far more of its budget to warmup than Normal/Long do, which is why a 30-min Quick
  session can get trimmed to just 1 main + 1 secondary exercise.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-451 — a no-program account's Workout tab is an empty card with a dead "Start Workout" button). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-18-workout-write-path.md`](../../reviews/2026-08-18-workout-write-path.md) — **the workout write path, driven live and probed cross-user, 2026-08-18** (Q-460 the session-RPE route reports success for a write that matched nothing and the outbox then discards it, Q-461 the Start Set bounce makes the core flow un-automatable, Q-462 an ownership refusal reported as a 500). Findings Q-460…Q-462; **cross-user write protection holds across the whole workout surface** (verified against a second live account, with a control for every probe), plus three more clean results.

- [`docs/reviews/2026-08-18-coach-apply-path.md`](../../reviews/2026-08-18-coach-apply-path.md) — **the AI Coach's write path, reviewed for the first time, 2026-08-18** (Q-468 — Coach `undo` writes `beforeState` back without checking the target still holds what the change set; undoing two stacked swaps leaves an exercise nobody chose). Findings Q-467/Q-468; the **apply** path came back clean and is documented at length as the reference for LLM-initiated writes.

- [`docs/reviews/2026-08-18-ai-double-trips.md`](../../reviews/2026-08-18-ai-double-trips.md) — **the AI-usage screen's double-trips traced to cause, 2026-08-18** (Q-470 — `regeneratePrescriptionInBackground` is fire-and-forget from two sites in `GET /api/workout-data` with a rate limit but no in-flight guard). Findings Q-469…Q-471; corroborates **Q-295** exactly and confirms **Q-170's latency fix is holding** (7-day Coach average 2,307 ms).
- [`docs/reviews/2026-08-18-acwr-calibration.md`](../../reviews/2026-08-18-acwr-calibration.md) — **the first calibration review of this pillar, 2026-08-18.** `ACWR_THRESHOLDS` **is correctly placed and must not be tuned** — over 77 sessions the decision-driving variant reads mean 0.99, median 1.05, bands 18/69/13/0%, and the `> 1.5` emergency deload has never fired (max 1.48), which is correct behaviour. The bugs are the call sites: **Q-512** — `health-insight` passes a 7-day list into a helper gating on a 21-day span, so its ACWR is null on **110/110** days; **Q-513** — `build-day-audit` passes the *full history*, making chronic a lifetime average, so the score-audit panel and the engine land in a **different band on 38% of days** (and the gap widens with any sustained volume increase).

- [`docs/reviews/2026-08-18-rpe-autoregulation-calibration.md`](../../reviews/2026-08-18-rpe-autoregulation-calibration.md) — **RPE autoregulation calibrated, 2026-08-18** (Q-514 — `RPE_DEAD_BAND = 1.5` is correctly placed and must not move; the bias is in the input. `expectedRpe`'s **floor** clamp binds on 6.5% of sets — ordinary 50–67% × 7–13-rep accessory work, not warm-ups — giving them a **+1.89** mean delta against **−0.34** for everything else. Excluding them removes **64% of back-off triggers and zero push triggers**, so two thirds of the engine's 5–10% load cuts were a clamp artefact. Also: `calcAmrap1RM`/`amrapScaleFactor` have **no production call site**).

- [`docs/reviews/2026-08-18-production-verification.md`](../../reviews/2026-08-18-production-verification.md) — **this run's own findings checked against production, 2026-08-18** (Q-460 cannot be adjudicated from production — 74% of completed sessions lack an RPE, which is consistent with both a dropped write and a skipped prompt). Filed Q-472; **amended Q-460, Q-465, Q-467, Q-468** — one refuted, two re-scoped to zero exposure, one shown unprovable either way.

## Open issues

```bash
grep -n '^### .*\[workouts\]' projectOverview.md   # 39 entries today — the largest pillar
grep -n '\[workouts\]' docs/implementation-backlog.md   # 3 queue items today
```

Live at the time of writing (2026-07-30):

- 🔴 **`personal_records` is not the all-time best, and "starting weights" never reach the bar** —
  open and enlarged since first found; a corrective migration is written but awaiting the owner.
- ~~Workout tab card didn't show "trained today" right after finishing~~ **fixed 2026-08-05 (Q-89,
  v1.266.7)** — a stale `useMemo` in `workout-select-content.tsx`, not a missed cache-invalidation
  key.
- ~~The "trained today" state itself was too subtle~~ **fixed 2026-08-05 (Q-97, v1.266.8)** — a
  full-width "Completed Today" banner replaces the 12px inline icon+text. Not confirmed on-device
  against clipping/overflow at the S25 viewport.
- ~~The exercise-summary/rest screen showed nothing about what's coming next~~ **fixed 2026-08-06
  (Q-87, v1.267.2)** — an "Up Next" card (name + planned starting weight via the shared
  `computeInitialWeights` formula) now renders on the rest countdown, null-safe at the last
  exercise of a session. Outcome:
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
- ~~The header refresh button on the pre-workout screen flashed "done" while an AI regeneration
  was still in flight underneath it~~ **fixed 2026-08-06 (Q-86, v1.267.3)** — a decoupled-feedback
  bug, not a caching bug: the button was bound only to its own unrelated re-fetch's loading flag.
  Now bound to `prescriptionPending` too, so it stays disabled/spinning for the whole generation
  window. Outcome:
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
- 🟡 **Q-11 (shared with `heart-rate`)** — the two attribution-timing defects are fixed (v1.257.2,
  v1.266.1); a device-side coverage-quality question remains, to be re-measured now that new
  sessions attribute same-day.
- **Role ordering** ships with the clamp observed firing but two knobs untuned.
- The **local `exercise_library` mirror shipped in v1.234.2**, so offline bodyweight exercises now
  type correctly. Backlog Q-20 still asks for a confirming read — treat that entry as "verify",
  not "build".
- **`active-workout-screen.tsx` has grown past the 800-line guidance** — extract into
  `components/workout/` children rather than appending.
- Exercise Readiness rework, the AI prescription review batch, and most rest-timer work are
  shipped but **not device-verified**.
- **`ai_dynamic` phase labels now show "Phase · Session N" instead of a meaningless "Cycle 1/1"**
  (v1.246.5) — traced end to end from `workout-data`'s `PhaseStatus.openEnded` through all four
  render sites, but not yet visually confirmed against a live AI-adaptive session. See the journal
  entry below.
- **A pending AI prescription can no longer silently auto-dismiss after 7 days** (v1.247.0) — found
  via a real production "Upper" session that had been auto-flipped to `dismissed` with no user
  action. Generation also moved from session-completion to pre-workout-open, so a prescription is
  never more than minutes stale by the time it drives load.
- 🔴 **Q-310 (open) — an ai_dynamic deload phase that fell into the generic `workout-data` fallback
  branch is a deload in name only.** `phaseName` correctly title-cases `aiPeriodizationState.phase`
  into `"Deload"` for display, but `isDeloadActive`/`phaseType` are hardcoded `false`/`'normal'` in
  that same branch (two identical copies) — so weight prescription stays full-intensity and the
  `shouldCountTowardPr` PR gate never engages, meaning a genuine `personal_records` row can be
  written from what should be submaximal work. Owner-reported 2026-08-17. This is a third,
  distinct gap in the same area as the two entries below it — not a duplicate of either.
- ~~The warm-up timer's denominator always read "10:00" regardless of the session's real
  budget-scaled warm-up goal~~ **fixed 2026-08-15 (PR #1350)** — a hardcoded literal string in
  `warmup-screen.tsx`, one line, `formatTime(warmupGoalSec)`. The numerator and completion state
  were already correct; only the label lied.

## History

- **[`docs/overview/entries/2026-08-17-workout-select-empty-state.md`](../../overview/entries/2026-08-17-workout-select-empty-state.md)**
  — 🆕 Q-451: `/workout-select` with no program rendered the carousel anyway (position-0's palette
  emoji standing in for absent content) under a **Start Workout** button that short-circuited on the
  missing `currentSession` and did nothing. Now three states, not one — the new `programLoaded` flag
  is what separates "no program" from "still loading", and it is deliberately never set in a
  `finally`, so a failed load holds the skeleton rather than claiming the account has no program.
  **Observed working but not guarded**: the E2E harness has one seeded account and it has a program.
  That gap is **Q-352**. The sweep also cleared Home's `recommendation-card.tsx:281`, which has the
  same `x && f(x)` shape but is inside a `displaySession ?` branch — redundant, not a bug.

- Cross-domain, but the deload work lives here:
  [`docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md`](../../handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md)
  (Q-175 — a confirmed deload **week** never reached the AI-dynamic prescription, the second of the
  app's two deload entry points; and **Q-185**, still open, which the fix exposed: the reduction
  lives inside `if (aiDrivesLoad)`, so an exercise the prescription does not name is not reduced by
  either entry point).
- Handoffs: `ls docs/handoff-*-workouts-*.md` — most recently
  [`docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md`](../../handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md)
  (Q-310 root-caused and queued — the ai_dynamic generic fallback's hardcoded `isDeloadActive:
  false`; also shipped the warm-up timer label fix, PR #1350. Q-245/246/247/248, filed earlier in
  the same owner-bug-batch thread, were picked up and shipped by other sessions before this handoff
  was written — see #1375/v1.317.0 and v1.317.1). Before that,
  [`docs/handoff-2026-08-05-workouts-measured-warmup-preset-scaling.md`](../../handoff-2026-08-05-workouts-measured-warmup-preset-scaling.md)
  (Q-83 **built** — the measured warmup median is now capped at 20% of the budget, but only when
  today's budget is below the session's own configured length; carries the sandbox traps for probing
  the AI time-budget path, and why an ungated cap is wrong. Produced **Q-85**: rest, not warmup,
  dominates a short budget). That superseded
  [`docs/handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md`](../../handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md)
  (the same work, triaged and queued but not yet built). Before that,
  [`docs/handoff-2026-08-03-workouts-auto-apply-phase-transitions.md`](../../handoff-2026-08-03-workouts-auto-apply-phase-transitions.md)
  (auto-apply set a status but never called `advancePhase`, so four of five session types sat in
  accumulation since June against prescriptions already written at intensification loads — fixed in
  #1025 / v1.252.0; carries the prod-audit evidence, the local test-env traps, and why deloads and
  ceiling-forced transitions still ask). Plus
  [`docs/handoff-2026-07-29-ai-prescription-engine.md`](../../handoff-2026-07-29-ai-prescription-engine.md)
  and [`docs/handoff-2026-07-29-ingest-and-records.md`](../../handoff-2026-07-29-ingest-and-records.md),
  both written before the domain went into handoff filenames.
  Also [`docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md`](../../handoff-2026-08-02-cross-owner-bug-batch-investigation.md)
  (Q-38 — a phase transition emptying the prescription card permanently), filed under `cross` because it spans five pillars.
  Also [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-63 — skip button needs a confirm; Q-64 — voice logging dead on the APK; Q-65 — PiP missing the
  rest countdown on the exercise-summary screen), same reason.
- Journal: `grep -rl 'workout\|prescription\|1RM' docs/overview/entries/` — including
  [`docs/../overview/history-2026-07-28.md`](../../overview/history-2026-07-28.md)
  and [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-115-followup — the sore-muscle check-in now predicts and warns about a whole-session deload
  escalation instead of always promising a narrow one).
  Also [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-109 — Home's manual Deload choice now actually reduces the prescribed load on an AI-dynamic
  session instead of only tagging cosmetic metadata).
  Also [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-106 — the home "Recommended Today" card's memo now recomputes once the `workout-data:all`
  batch actually populates its `workout-card:<id>` cache entry, instead of freezing on "Last: —").
  Also [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)
  (Q-117 — confirming an early deload and logging an injury both now invalidate the caches that
  hold today's plan, and the injury fingerprint reaches the server-side re-evaluation skip check
  too; previously up to 6 hours stale on both counts).

## Gotchas specific to this domain

- **Bodyweight exercises have bitten repeatedly** — two incommensurable 1RM eras produced a
  phantom +40% Pull-Up PR; sets counted as zero volume; a prescription was recorded that was never
  given. Any load maths must ask whether the exercise is bodyweight.
- **A stored `estimated_1rm` is not always kilograms.** For a bodyweight exercise it is a
  `BW_REF`(100)-relative index — a monotone function of reps and added load. Two consequences that
  are easy to get backwards, and both have shipped as bugs:
  1. **Never `max()` across records without filtering by basis.** In production a pull-up (118) and
     a hanging leg raise (128) outrank a real 96 kg bench press, so a plain max picks the wrong
     exercise, not merely the wrong label. Use `pickHeadlinePersonalRecord`
     (`@trainingai/shared/1rm`).
  2. **Render through `displayOneRm`/`describePersonalRecord`, never a hardcoded `kg`.** Every
     surface that shows a stored 1RM resolves its unit there. **Sweep the derived fields too** —
     `target80` is `estimated1rm * 0.8` and inherits the same basis; v1.252.4's sweep grepped only
     for `estimated1rm` and missed a third site (`overview-screen.tsx:484`, fixed in v1.252.5).
     Note two `target80` sites are guarded by an earlier `isBodyweight ? null :` short-circuit in
     the same ternary chain rather than an explicit check — grep alone will read them as unguarded.
  The *trend* is fine and must stay in stall/trend judgement — more reps reads as up. Only the
  absolute value needs the basis. ([`2026-08-03-year-review-bodyweight-1rm.md`](../../overview/history-2026-07-30.md))
- **1RM lives in `packages/shared/src/1rm.ts` only.** Divergent client/server/edit-path copies once
  inflated PRs.
- **`useFor1rm: false` on every set of a style is ambiguous on its own — don't rely on it to mean
  "exclude everything."** `calculate1RM`'s selection logic falls back to "use all sets" whenever
  none is marked `true`, because some real progression styles (e.g. "General") store `false` on
  every set and are still supposed to compute a normal estimate from all of them. A deload needs to
  exclude its sets unconditionally, which `useFor1rm` alone cannot express — use `estimateOneRm`'s
  explicit `deloaded` option instead (short-circuits to a zero estimate before either formula runs).
  Found because the obvious `useFor1rm: !presc.deloaded` fix silently didn't work (Q-115,
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)).
- **A deload signal set on `AiPrescriptionExercise` needs to reach `estimateOneRm`'s `deloaded`
  option at every construction site** — `buildWholeSessionDeloadPrescription` once built exercises
  with no per-exercise `deloaded` flag at all (only a prescription-level boolean nothing downstream
  read), silently bypassing the 1RM gate, the client's PR-flash gate, and the server's
  `shouldCountTowardPr` simultaneously. New deload-construction paths must stamp `deloaded: true` on
  each exercise, not just at the prescription level.
- **A manual UI toggle (`aiDeload`) is not automatically wired into an AI-driven prescription's
  actual numbers just because a static-progression-style equivalent exists.** Home's manual Deload
  choice set `sessionPhaseStatus.isDeloadActive`, which `deloadAwareStylePhase()` reads — but that
  function is bypassed entirely once `aiDrivesLoad` is true, so `buildWorkoutExercises` applied the
  stored AI prescription unconditionally with zero reference to the manual flag, silently no-op'ing
  the toggle on every AI-dynamic session (the normal state for this program). Fixed by reading
  `aiDeload` inside the `aiDrivesLoad` branch and applying `deloadOverrideForGoal()` directly, skipped
  when the exercise is already auto-deloaded (`p.deloaded`) so the two reductions don't compound
  (Q-109, [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)).
  Any future manual override of AI-driven behaviour needs the same check: does the flag actually
  reach the branch that's live, or only a parallel mechanism that AI-dynamic mode bypasses?
- **…and there are TWO deload-confirmation entry points, so fixing one leaves the bug alive.** The
  Q-109 fix above covered the pre-workout toggle (`?aiDeload=1`) only. Home's "Take deload week now"
  writes `programs.earlyDeloadWeekStart` and passes no param — and `isDeloadActive()` needs a
  `ProgramPhase` to consult, which an `ai_dynamic` program does not have — so a confirmed deload
  *week* still produced full-intensity numbers for seven days. `isEarlyDeloadWeek()` now answers the
  window without a phase, both `workout-data` paths surface it, and the builder reads
  `aiDeload || isDeloadActive` (Q-175,
  [`docs/../overview/history-2026-08-08.md`](../../overview/history-2026-08-08.md)).
  **Q-185 is closed** (this line previously said "still open"): the un-prescribed branch below the
  `if (aiDrivesLoad)` block reduces an exercise the prescription does not name — every accessory,
  and every session with an expired prescription — verified in source and on the dev server
  2026-08-17.
- **…and there is a THIRD deload path, which no user confirms at all.** The two above are both
  things the owner *chose*. The AI periodization engine also picks `phase: 'deload'` itself off
  accumulated fatigue, and because nobody confirms it, it reaches neither branch — it lands in
  `/api/workout-data`'s ai_dynamic catch-all, which hardcoded `isDeloadActive: false` while
  title-casing the *same* `aiPeriodizationState.phase` field into the header label "Deload". So the
  session announced a deload and prescribed full weights, and the fatigue that triggered it never
  cleared, so another deload kept being recommended. Both copies of that branch now call
  `aiDynamicFallbackPhaseStatus()` (Q-310,
  [`entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md`](../../overview/entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md)).
  Two lessons worth carrying: a **catch-all branch whose comment says what it cannot see** is where
  to look first — the comment above this one read "not baseline, not deload" — and a phase **label**
  derived from the same field as a phase **flag** will not disagree visibly, so the label is not
  evidence the flag is right.
- **The server's PR gate does not depend on `/api/workout-data` being right.** `logExerciseFromPayload`
  reads `session_periodization` itself and stamps `currentPhaseType = 'deload'` independently, so a
  wrong `isDeloadActive` on the route corrupts the **client's** optimistic 1RM/PR badge and the local
  SQLite copy, not `personal_records`. When triaging a "phantom PR" report, check which of the two
  you are looking at before reaching for a corrective migration — Q-310's production check found the
  server side clean.
- **A `memo`'d component that does its own `readCacheSync('workout-card:<id>')` read inside render
  goes stale the moment `workout-data:all`'s batch fetch seeds that cache key — three independent
  sites have shipped this exact bug (Q-89 `workout-select-content.tsx`, Q-91 a sibling card, Q-106
  `RecommendationCard`).** `setCached` is a side effect outside React state; a memo compares props,
  not cache contents, so a card whose first render lands before the batch resolves freezes on
  whatever it read at that first render (usually "—") for the rest of the visit. The fix is always
  the same shape: an epoch counter (`dataEpoch`/`workoutCardEpoch`) bumped in the batch's `onData`
  callback, threaded in as a prop, and added to a `useMemo` wrapping the cache read (with an
  `eslint-disable-next-line react-hooks/exhaustive-deps` on the deps line, since the epoch is a
  proxy dependency the linter can't infer). Any new card doing a raw `workout-card:<id>` read needs
  this pattern from the start, not bolted on after an owner report.
- **Submit/complete needs an in-flight guard** — five rapid taps once fired four
  `complete-workout` POSTs.
- **Never delete-and-reinsert program rows** — `ON DELETE SET NULL` wiped session identity on every
  config save across four deploys. Upsert in place and round-trip DB ids.
