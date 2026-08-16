# 2026-07-05 — Workout-Backlog Review (items 1, 5, 8, 21 + AI response pipeline + time recording)

Scope requested by the user: review the implementation backlog with focus on **workout
logic/flow** (nothing can break it — especially exercise times and set modification to
match time budgets), the noticed **AI response issue**, and **time management/recording
per exercise** (feeds future workout-time assignment). Method: every workout-touching
backlog item's plan was re-verified line-by-line against current `main` (post-PR #231),
the AI prescription pipeline and the full timing-recording chain were audited end-to-end,
and a full Push workout was driven live through the dev server via Playwright with DB
verification. 721 tests green on `main` at review time.

Verdict up front: **none of the queued plans is safe to implement exactly as written
except item 21.** Item 1 has a gate-condition blocker, item 8 has two should-fix
amendments, item 5 needs a PR-#231 ordering invariant added before anyone touches the
workout selector. Separately, the audit surfaced **two blockers in timing recording
that pre-date the backlog** (superset rest-times recorded as 0; editing a logged
exercise wipes all per-set timing) and a cluster of AI-response robustness gaps of
which the known "model drops an exercise" incident is only the worst case.

---

## 1 · Backlog item 1 — bodyweight reps fix (`2026-07-05-bodyweight-reps-ai-prescription-override.md`)

> **⚠️ Update — this shipped with the flawed gate.** PR #233 merged the fix using the
> session-level `!aiDrivesLoad` gate this section flagged as a blocker, so the predicted
> regression is now **live on `main`** (`route.ts:346`). It is re-queued as a follow-up
> fix — backlog **item 1**, `2026-07-05-bodyweight-reps-dropped-exercise-regression.md`.
> The analysis below is retained as the record of why.

**Plan diagnosis is correct and line numbers are current** (`app/api/workout-data/route.ts:314`
override, `:344` remap — verified). The extraction and tests are numerically right.

- **BLOCKER — the gate must be per-exercise, not session-level.** The plan adds
  `&& !aiDrivesLoad` to the remap. But the AI override only replaces `progressionStyle`
  when the prescription *contains* the exercise (`route.ts:315-317`), and the model
  **dropping** a `session_exercise_id` is a known live incident (projectOverview
  "Known gap"). With the plan's gate, a dropped bodyweight exercise falls back to the
  static style **and skips the remap** — raw stored style reps, meaningless for a
  bodyweight lift. That's a new regression on an observed failure mode. Fix: set an
  `aiStyleApplied = true` flag inside the `if (p)` branch and gate the remap on
  `!aiStyleApplied` instead of `!aiDrivesLoad`. Everything else in the plan survives
  unchanged. **This shipped uncorrected in PR #233 — now queued as the follow-up fix
  `2026-07-05-bodyweight-reps-dropped-exercise-regression.md` (backlog item 1).**
- **Should-fix — Step 7 must capture the numeric basis from prod.** With plausible
  inputs ("Last: 5,4,4,5", accumulation pct 65-80) the remap yields 2-3 reps, not 1.
  Collapse to exactly 1 on every set requires `basis ≲ 101` (a drifted/wrong-scale
  `estimated1rm`/PR row, or a stored fraction-scale `pct` from the pre-v1.104.6 Gemini
  bug). If that's the real cause, the static path still collapses after this fix ships.
  Step 7 should capture `lastLog.estimated1rm`, the `personal_records` value, and the
  stored prescription `pct` for the exercise — not just "check if reps are still wrong".
- Notes: (a) the fix also repairs an existing inconsistency where the deload
  `preDeloadStyle` was never remapped but the deloaded style was; (b) the plan's claim
  that AI reps are "already bodyweight-aware" is overstated — the prescription pipeline
  has no bodyweight concept (no `exerciseType` anywhere in `lib/ai-periodization/`);
  reps are phase-zone reps, sane but not bodyweight-derived — soften the comment it
  bakes into `lib/1rm.ts`, and consider a follow-up clamping AI bodyweight reps to
  `repMaxFromOneRm(basis)` as a sanity band; (c) give the extracted helper an
  `addedKg = 0` param now to avoid a later signature change.

## 2 · Backlog item 8 — warm-up ramp-up timer (both plans, one PR)

**Both bugs were reproduced live in this review** (dev server, Playwright): every
exercise — Barbell Bench Press, Barbell OHP, cable Tricep Pushdown — shows the same
flat `x:xx / 2:00` ramp, and a mid-ramp page reload (the backgrounding stand-in named
in the plan) reset the ramp from `0:06` back to `0:02` while the header session clock
kept counting. The two plans compose cleanly (each carries a correct "if the other
landed first" note) and all line anchors are current.

- **Should-fix A — the persisted baseline leaks across hub round-trips and skips.**
  Today the component-local ref dies when `ActiveWorkoutScreen` unmounts (mode leaves
  `active`), which is the *de facto* reset mechanism. The persisted store field has no
  such reset: land on a ready screen, back out to the hub for 4 minutes, launch any
  exercise → the ramp renders already complete. Same for Skip (`advance()` flips
  `timerStarted` false→false — no effect re-fire). Amend Task 2: clear
  `readyElapsedBaselineSec` in `launchExercise` (next to the `exerciseStartMs: null`
  reset, `workout-screen.tsx:457`) and in `advance()`'s fresh-init branch. Remount with
  the same exercise never passes through those paths, so the backgrounding fix is
  preserved. **Amended in the plan doc (this review's PR).**
- **Should-fix B — unknown/empty equipment silently gets the 4:00 barbell worst case.**
  `equipment` is `NOT NULL DEFAULT []` in `exercise_library` and the seeded/user rows
  not covered by migrations 030/081/082 hit the `[]` → `TRANSITION_SEC_DEFAULT = 240`
  branch (e.g. seeded `Bicep Curl` has no equipment). Worst-case is right for *planning*
  (over-estimating protects the budget) but inverted for an on-screen countdown the
  lifter has to sit through — and it contradicts `weightStepFor` (`components/workout/utils.ts`),
  which treats missing equipment as non-barbell. Decide explicitly: fall back to
  `TRANSITION_SEC_STANDARD` (120s) for the *ramp display only*, or keep 240s and add an
  unmapped exercise to the manual verification so it ships knowingly.
- Notes: `// @vitest-environment jsdom` in the store test is required (global env is
  `node`); the test's `startWorkout('Push')` literal should be a neutral string per the
  no-hardcoded-session-names rule; an injury-swap mid-ramp changes `WARMUP_SECTION_SEC`
  live and re-buckets progress — acceptable, no data loss.

## 3 · Backlog item 5 — render + store discipline (workout screen)

The plan is directionally sound and nothing in it has been obsoleted, but it was
written the day **before** PR #231 and must not be followed blindly on the workout
screen:

- **BLOCKER — PR #231 ordering invariant.** `handleCompleteSet` now stamps
  `lastExerciseEndMs` from the set-end snapshot **before** `commitExerciseSummary`
  clears `setEndMsArray` (`workout-screen.tsx:825-842`). Any selector-narrowing that
  converts these reads to `getState()` *after* the commit, or reorders the two calls,
  silently regresses `inter_exercise_rest_sec` to the null-since-inception bug #231
  just fixed. Rule for the implementer: snapshot `useWorkoutStore.getState()` once at
  the top of `handleCompleteSet`; keep `setTimestamps({lastExerciseEndMs})` →
  `commitExerciseSummary` order; add a locking test.
- **BLOCKER — do not remove `workoutPhase`/`currentSet`/`restStartMs`/`lastSetRestSec`
  from the orchestrator pick.** They drive correctness effects, not just render: rest
  beep, rest-complete notification scheduling/cancelling, appStateChange re-sync, the
  PiP phase bridge. The genuinely hot per-detent fields are `perSetWeights`,
  `rpeValues`, and `reps` (which the plan omits).
- Should-fix: the `perSetWeights`/`rpeValues` consumer surface is much larger than the
  plan implies (sets grid, ready-screen bar-load cards, `Live1rmReadout`,
  `OneRmCalculatorDialog`, `PipView`, `handleLogCurrentSet`, PiP actions) — each needs
  its own selector or `getState()` before the field can leave the broad pick. Anchor
  drift: `useElapsedSec` now `:85-86`; `onRehydrateStorage` now `workout-store.ts:301-318`;
  `metric-tiles-card.tsx` lives under `app/session-select/components/`; the readiness
  leaf is `ScoreArc`, not "ScoreDisplay"; `[data-hscroll]` currently matches nothing.
- **Bonus pre-existing bug found while verifying:** `advance()` snapshots
  `[...store.sessionLog]` under deps `[store.currentIdx, effectiveExercises, store.soloMode]`,
  so on the final exercise the calendar-event payload (`handleAddToCalendar`) likely
  omits the last exercise (stale closure). Fixed for free if the implementer
  standardizes on `getState()` snapshots — worth a locking test in the same PR.

## 4 · AI prescription response robustness (the "issue with AI response")

The v1.104.6 pct-fraction fix is in and mostly right, but the **dropped-exercise gap
is worse than the Known Issues entry suggests, and nothing in the queue covers it**.
Full trace (all file:line refs verified on main):

- **BLOCKER — no response-coverage validation** (`prescribe/route.ts` post-parse). When
  the model omits an exercise: it's excluded from autoregulation, `fitToBudget` (so the
  *other* exercises get over-trimmed against a budget that ignores a lift that will
  still be performed), and the stored duration/volume estimates; the truncated
  prescription persists and renders with no gap flag; `workout-data` silently serves
  the static style — and for AI-dynamic programs with no `styleId`, `progressionStyle`
  is null and the exercise runs unguided at `defaultSets = 3`. **Worst case: the
  per-exercise deload override loop iterates the model's echo (`parsed.exercises`), so
  a dropped exercise that `computePerExerciseDeload` marked sore never gets its deload
  — full-load static style on the sore muscle.** Fix shape (one reconciliation pass):
  after parse, de-dupe by id, drop ids not in `signals.exercises` (they currently enter
  `fitToBudget` as protected `role: 'primary'` ghosts that steal budget and render as
  phantom card rows), backfill missing ids from the deterministic
  `intensityZone(goal, phase)` midpoints, apply deload overrides by iterating
  `deloadedIds` (not the echo), and add `.min(1)` to the exercises array (an empty
  `exercises: []` is currently schema-valid and can **auto-apply**). There is no test
  anywhere for omit/duplicate/invent-an-id responses.
- **Should-fix — pct has a floor but no ceiling.** `pct: 1` normalizes to **100%**
  (most dangerous reading of an ambiguous value); nothing clamps down to the phase
  zone's `pctMax` (≤95 everywhere), so a schema-valid 98 rides through to the bar; for
  bodyweight, pct→reps means pct 100 prescribes an all-out `repMax` effort **every
  set**. Clamp `ex.pct = min(ex.pct, zone.pctMax)` after autoreg and treat exact `1`
  as invalid. Also: for `phase_action === 'stay'` the model's `phase` is persisted
  unvalidated — force `parsed.phase = state.phase` (a hallucinated `deload`/
  `realisation` phase currently drives load with the wrong zone and card label).
- ~~**Should-fix — a Gemini failure after completing a workout silently re-serves the
  previous session's prescription.**~~ **Withdrawn on closer read** (confirmed while
  writing the item-3 plan): `lib/workout/complete-workout.ts` already marks the
  prescription `'consumed'` at completion (PR #221, predates this review), so a failed
  regeneration degrades to the static style rather than replaying stale numbers. No
  action needed; the item-3 plan does not include this.
- Notes: reps/sets are only globally bounded (1-30/1-10), never zone-clamped; the
  `preDeload` revert payload bypasses all clamps; `fitToBudget` itself is solid
  (cannot produce sets=0, cannot drop an exercise, cannot loop; trimmed sets always
  match the style length — verified against the MAV-aware trimming shipped in v1.104.6).

## 5 · Exercise-time recording (feeds future time-budget assignment)

Verified working end-to-end (payload captured live): `setTimes`, `restTimes`,
`setStartTimes`/`setEndTimes`, `interExerciseRestSec`, `warmupEndedAtMs` all ride the
`log-exercise` payload; the PR #231 fix is in the code and correct (snapshot before
buffers clear; first exercise null; refresh-safe; outbox `pushMutations` replays the
identical payload). Rest semantics are consistent (rest on set N = actual rest after
set N; last set's rest folds into the next exercise's transition). `warmup_ended_at`
is first-write-wins.

But the measurement layer the future work will depend on has real holes — **fix these
before accumulating the measurement window**, exactly as #231 was:

1. **BLOCKER — supersets record `rest_time_sec = 0` for every switched-back set.**
   `handleLogCurrentSet` sets `restStartMs = now`, but `restoreExercise` hardcodes
   `restStartMs: null` (`workout-store.ts:266`) and it isn't part of `ExerciseBuffer`,
   so the next `handleStartSet` computes 0. The admin time-audit filters `> 0` (superset
   sessions silently show n=0) while `restAdherencePct` *includes* the zeros (drags
   adherence toward 0). Fix: carry `restStartMs` through stash/restore.
2. **BLOCKER — editing a logged exercise destroys all per-set timing.** `PATCH
   /api/workout-entry` does `DELETE FROM set_logs` + re-INSERT with only
   `(set_number, weight_kg, reps, intensity_pct)` — `set_time_sec`, `rest_time_sec`,
   `set_start_ms`, `set_end_ms`, `rpe`, `use_for_1rm` are wiped by any post-hoc
   weight/rep correction, and re-minted ids duplicate sets on-device via the pull.
   Fix: UPDATE in place by `set_number`, carry timing/rpe through, delete only
   truncated tail sets.
3. Should-fix — superset `inter_exercise_rest_sec` can go **negative** (B starts
   mid-A; B.start − A.end < 0); `decomposeSessions` sums it via `?? 0` including
   negatives. Omit for grouped exercises or clamp ≥ 0 at both ends.
4. Should-fix — `completed_at` is server-receipt time (`new Date()` server-side,
   overwritten even when already completed); an offline completion replayed hours
   later inflates duration and pollutes `sessionLoad = rpe × durationMin`. Send
   `completedAtMs` in the payload and make it first-write-wins like `warmup_ended_at`.
5. Should-fix — `getAvgSetDurationPerExercise` (feeds the AI prompt) is a raw
   `AVG(set_time_sec)` with no outlier handling — the "timer left running" 6-minute
   set the admin audit's `robustStats` deliberately excludes inflates the AI's
   `avg_set_duration` signal. Reuse the robust median.
6. Should-fix — the stranded-workout rebuild path (`buildWorkoutLogPayload`) omits
   `setStartTimes`/`setEndTimes`/`warmupEndedAtMs` and zero-fills nulls; replay against
   an existing server row **overwrites good timing with nulls/zeros** (unconditional
   `EXCLUDED`). Include the arrays and omit-instead-of-zero-fill.
7. Notes: a solo re-log after `resetSession` mints a session with `started_at =
   local midnight` (workoutStartMs null → `aestMidnight` fallback); abandoned
   workouts leave no server trace (invisible to planned-vs-actual analysis);
   `exercise_logs.time_to_complete` has dual semantics (lap-sum vs wall-clock
   fallback).

## 6 · Item 21 (avg-reps floor) and cross-item coordination

Sound as written; the three-way coordination between #2 Task 4, #12/U9's export, and
#21 is already handled in the plan/spec text. No findings.

## 7 · Bookkeeping / process findings

- **The workout time-model plan (`2026-07-03-workout-time-model-accuracy.md`) has fully
  shipped** (PR #136 / session 186: `lib/workout/duration-model.ts`, `time-audit.ts`,
  `known-styles.ts`, migration 108, admin time-audit card all on disk) but the plan
  still sat in the active plans directory. **Archived to `archive/` in this review's
  docs PR** (along with the now-shipped `bodyweight-reps-ai-prescription-override.md`).
- **projectOverview's migration ledger was stale:** it said "Next Postgres migration
  number: 111 … 106 last on disk", but 107, 108 **and 111** are on disk. Given
  `migrate.js` applies in filename sort order and the tree already carries two
  historical number collisions, corrected to next free = **112** (109/110 remain
  reserved by Batch N / Batch O plans) in this review's docs PR.
- **The dropped-exercise AI gap is now queued** — as backlog **item 3**
  (`ai-prescription-response-reconciliation`), which backfills dropped exercises, plus
  **item 1** (`bodyweight-reps-dropped-exercise-regression`), which covers the shipped
  bodyweight-gate half of the same failure mode.
- Local sandbox note: `node_modules` drifted from the lockfile in this container
  (`web-push` missing → `pnpm build` failed until `pnpm install --frozen-lockfile`).

## 8 · Live-testing discovery — `/api/log-exercise` 500s under `next dev --turbopack`

Driving a full Push workout through the dev server surfaced this: **every
`POST /api/log-exercise` returns 500** with
`TypeError: (0, …lib/data/index.ts…getRepository) is not a function` at
`log-exercise.ts:85`. Reproduced deterministically: fresh dev server, first request,
clean `.next`, lockfile-complete `node_modules`, and at every commit in this clone's
available history (v1.96.0 → v1.104.7). **The production build is unaffected** —
`next build` + `next start` against the same DB returns 200 and every timing column
lands correctly (verified: `started_at`, `warmup_ended_at`, `inter_exercise_rest_sec`,
`set_time_sec`).

Mechanism (from the emitted chunks): `lib/data/postgres/client.ts` compiles as a
Turbopack *async module*, making `lib/data/index.ts`/`adapter.ts` async; and
`lib/workout/log-exercise.ts` is imported **both** statically (by the route) and
dynamically (by `pushMutations` in `adapter.ts:3113`) — its dynamic async-loader stub
resolves in-place (`Promise.resolve()`) instead of loading a chunk, and the route's
static namespace binding for `@/lib/data` comes up empty. `complete-workout.ts`, with
the same dual-import shape but its own chunk, works.

Consequences worth internalizing:
- **The mandated "test on `pnpm dev` before merging" gate is broken for the app's
  single most important write path.** Worse, the failure is *silent* in the UI: the
  workout POST is fire-and-forget, the web sandbox has no outbox
  (`getLocalStore` → null), so a full Playwright walkthrough sails to the Done screen
  with **zero rows persisted**. Any past or future "verified the workout flow on the
  dev server" claim that didn't check the DB directly is unreliable.
- Fix directions (needs a small plan): resolve the repository lazily inside
  `logExerciseFromPayload` (`const { getRepository } = await import('@/lib/data')`) or
  pass `repo` in from callers — either breaks the static-import-of-async-module edge;
  alternatively drop `--turbopack` from the dev script (blunt, slows dev). Verify the
  fix with a dev-mode `curl` smoke of `/api/log-exercise` and consider adding that
  smoke to the session-start checklist.

## Not exercised in this review

Native/on-device surfaces (Capacitor SQLite outbox, real backgrounding, safe-area,
Samsung WebView), real Oura data, real production DB values (the item-1 numeric
root-cause remains unconfirmed against prod), and a real Gemini prescription
round-trip (the AI-response findings are from code audit, not live 502 reproduction).
