# Workout Review — Design Spec

**Date:** 2026-07-12
**Status:** Approved (brainstormed with owner) — implement in-session, front of queue.
**Scope:** v1 = drop + adjust. Swap, whole-week rebalancing, permanent sets/reps edits, and adding
exercises are explicitly out of scope (fast-follows).

---

## 1. Problem & motivation

The owner has a pre-existing program session budgeted at 60 min whose exercises overrun it. The
automatic time-budget system (session 279, v1.135.0) already targets finishing ~5 min early — it
computes a **45-min working budget** for a 60-min session (`workingBudgetMin`, 60 × (1 − 15% warmup
− 10% finish-early)) and deterministically trims sets via `fitToBudget` — **but it only trims sets,
it never drops an exercise** (role floors keep primary/secondary ≥ 2 sets, accessory ≥ 1). When a
session has more *exercises* than fit even at floor sets, the system cannot bring it under budget; it
only appends a note to the prescription reasoning ("even at minimum sets this session is estimated at
X min… consider removing an accessory or raising the budget", `prescribe/route.ts:366`).

That is exactly the owner's situation, and it's the gap this feature fills: a **forced AI review**
of a chosen session that can **drop** an exercise (which the automatic path cannot) and **adjust**
sets/reps/%/rest, landing the session under budget while honouring the app's periodization rules.

## 2. Goals / non-goals

**Goals (v1)**
- A "Review this workout" button that audits one session against the owner's real training data.
- The review can propose **drop** and **adjust** actions per exercise, with a human-readable reason.
- A **diff UI** where each proposed change is accepted **This cycle** (reversible overlay) or
  **Permanent** (drop only), or **Rejected**.
- Changes show "across every page" (workout screen, home recommendation, session-explain) — this is
  inherent because overlay/permanent changes flow through the existing render paths.
- Honour existing rules: weekly muscle-group targets, time budget, phase intensity,
  soreness/injury, role floors.

**Non-goals (v1)**
- **Swap** (replace an exercise with a different library exercise) — fast-follow.
- **Whole-week rebalancing** across sessions — separate, larger capability.
- **Permanent sets/reps edits** — the data model stores no per-exercise sets/reps (they come from a
  shared progression style); a permanent per-exercise number change has no clean home without new
  schema, and cycle-dynamic is the correct home for a sets/reps tweak anyway. See §5.
- **Adding** new exercises.

## 3. Data the review consumes — already built

The review route calls the existing **`aggregateSignals`** (`lib/ai-periodization/signals.ts`), which
already computes everything the owner asked the review to "look at":

- Measured per-set/rest **timing** per exercise (`timeProfile`) + `avgSetDurationSec`.
- **RPE-vs-expected** trend (`rpeTrend`, per-exercise `rpeDelta`) and **rep-completion**.
- Muscle **soreness** (`soreMusclesInSession`) + active **injuries**.
- **Weekly volume vs targets** (`weeklyLogged`, `weeklyTargets`, `volumeBudgetPerMuscleGroup`).
- Current **phase** + `sessionsInPhase`, **ACWR**, **1RM trend/plateau** ("growth"), morning
  check-in, external (Oura) readiness.
- The **45-min working budget** (`effectiveTimeBudgetMin`).

No new signal computation is required — the review prompts differently against the same signals.

## 4. Architecture — a new, separate flow

The existing `prescribe` route cannot express a drop: `reconcile-prescription.ts` backfills any
missing session-exercise id, guaranteeing every exercise is re-inserted. Rather than fork that
guarantee, the review is a **new route + new schema**.

### 4.1 New AI schema (`generateObject`)
Per exercise, the model returns an **action**:
- `keep`
- `adjust { sets, reps, pct, restSec }`
- `drop { reason }`

Plus session-level `reasoning`, per-drop `reason`, and a model `confidence`. The proposal is
**reconciled deterministically** (mirroring the prescribe route): unknown ids dropped, `%`-clamped
30–100, role floors enforced on adjusts, and — critically — the **projected duration recomputed by
`estimateSessionDurationSec`** (using measured time profiles) so the model cannot claim a fit the
math doesn't support. The server, not the model, computes the final projected minutes and the
weekly-volume impact of each drop.

### 4.2 Rules enforced in the prompt + deterministic backstops
- Never drop the **last** exercise covering a muscle that is **under** its weekly target.
- Prefer dropping/trimming a muscle already **over** its weekly target.
- Respect phase intensity bands; keep the main lift.
- Land the session **under the 45-min working budget**.
- Deterministic backstops: role floors, `%`-clamp, budget re-check — same as `prescribe`.

## 5. The Hybrid diff — with one data-model constraint

Each proposed change is a diff row (before → after + reason). Per row the owner chooses **This
cycle** / **Permanent** / **Reject**. The data model forces an asymmetry:

- **Drop** → **This cycle** (overlay: a new per-cycle "dropped exercise ids" list that the render
  paths skip) **or** **Permanent** (remove the `session_exercises` row via the existing
  program-edit delete path).
- **Adjust (sets/reps/%/rest)** → **This cycle only.** `session_exercises` has **no** per-exercise
  sets/reps; those come from a shared **progression style** (`styleId`) other exercises/sessions may
  reference. "Permanently" bumping one exercise's sets has no clean home without a new per-exercise
  override column, and would be misleading since the next periodization cycle re-derives the
  numbers. Cycle-dynamic *is* the correct home for a sets/reps tweak.

**Net:** "Permanent" applies to **drop** only; every **adjust** rides the reversible cycle overlay.

## 6. Apply paths

- **Overlay apply** (adjusts + this-cycle drops): writes to the periodization prescription state
  (adjusts as prescription exercise overrides; this-cycle drops as a new `droppedExerciseIds` field
  on the stored prescription). Follows the existing accept/dismiss ("respond") write pattern.
  Requires the program to be in **AI-dynamic mode** (that's where prescriptions live).
- **Permanent drop**: reuses the existing config/program-editor delete path for a
  `session_exercises` row + its cache invalidation. Works in any program mode.

Both invalidate via the named cache groups (`invalidateProgramStructure` +
`invalidateWorkoutSummaries`) — never hand-rolled key lists — so every page repaints. If program
structure is a synced offline domain, the permanent drop mirrors into the outbox/`pushMutations` in
the same change (confirmed during implementation mapping).

## 7. Render sites a this-cycle drop must skip

The dropped-exercise-id filter is applied wherever a session's exercise list is rendered from the
prescription/program:
- `app/api/workout-data/route.ts` (the workout screen).
- The home "next session"/recommendation card + its route.
- `session-explain`.
Each reads `programSession.exercises`; the overlay's `droppedExerciseIds` filters that list (marked
"dropped this cycle" where a visible indication helps).

## 8. Entry point & UI

- **Button:** "Review this workout" on the **pre-workout screen** (top of the exercise list) and
  **session-select**, defaulting to the currently-selected/next session; a small picker allows any
  session in the active program.
- **Review sheet:** per-exercise diff rows (before → after, reason), per-row **This cycle /
  Permanent / Reject** control, header showing **projected new duration vs the 60-min budget** and
  the **weekly-volume impact**, and an **Apply** action.
- Rate-limited like sibling AI routes. Follows safe-area / token / touch-target rules.

## 9. Testing & verification

- Pure functions (proposal reconciliation, budget re-check, weekly-impact calc, diff building) are
  unit-tested.
- Verified end-to-end on the local dev DB with a **real Gemini call**: an over-budget session yields
  a drop proposal that brings projected minutes under 45; overlay-apply repaints the workout screen;
  permanent-drop removes the row.
- **Not verifiable in-sandbox:** on-device (S25 APK) rendering, offline behaviour of the permanent
  drop — flagged as Known Issues if the offline mirror is in play.

## 9a. v1.1 addendum (2026-07-12, owner feedback after first on-device use)

- **Entry point moved to More → Workout.** The trigger is no longer on the Home recommendation
  card; each session in the **active** program now has a per-session **Review** button in
  `config-screen.tsx`, so you review a chosen workout with its full exercise list in view.
- **Guard-protected drops are now shown.** The first build folded exercises the AI wanted to drop
  but a guard kept (only coverage of an under-target muscle) into "kept unchanged", so the diff
  looked like it only touched one exercise while the reasoning named several. The sheet now renders
  those as explicit "AI wanted to drop this — kept to protect your training" rows. This is also the
  answer to the ACWR/training-load concern (**owner chose option A — keep load honest**): the guards
  already refuse to drop below weekly targets, so only excess volume is shed; nothing special is done
  to the analytics.
- **Time reframed against the full budget.** The header shows `≈{warmup+working} of {total} min` with
  a `~{warmup} min warmup + {working} min working` breakdown instead of a bare "45-min target".
- **Finish-early buffer removed** (`lib/workout/duration-model.ts`): `workingBudgetMin` now carves out
  only the 15% warmup (60 → **51 min** working, was 45). The margin comes for free from conservative
  rest/set estimates (generous during baseline, measured-and-faster once history exists) rather than a
  reserved 10%. This changes every AI prescription's time budget, not just the review.
- **Safe-area:** the sheet is now a fixed header + scrollable body + pinned footer so Cancel/Apply
  always clear the gesture bar.

## 10. Out-of-scope backlog seeds (record as follow-ups)
- **Swap** exercise (muscle-matched candidate selection + picker UI + permanent-swap path).
- **Whole-week rebalance** review.
- **Permanent sets/reps** via a per-session-exercise style override column.
