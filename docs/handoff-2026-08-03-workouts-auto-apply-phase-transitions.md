# Handoff — 2026-08-03 · Auto-apply never moved the phase

_Domain: `workouts` · Branch: `claude/exercise-deload-scoping-1wy79m` (reset to `main` after the merge) · PR: [#1025](https://github.com/nekodas-neko/TrainingAI/pull/1025) **merged**, v1.252.0_

> **Read first:** `projectOverview.md` (status + the three new `[workouts]` Known-Issues rows), then
> [`docs/domains/workouts/README.md`](domains/workouts/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md) (Q-52). The session journal entry
> ([`docs/overview/entries/2026-08-03-exercise-deload-scoping.md`](overview/history-2026-07-30.md))
> has the full narrative; this file covers what to do next.
>
> Adjacent prior work on the same card:
> [`docs/handoff-2026-07-30-workouts-ai-prescription-no-auto-expiry.md`](handoff-2026-07-30-workouts-ai-prescription-no-auto-expiry.md)
> (auto-expiry and generation timing — a different mechanism in the same surface).

## Goal

Started as a design question: could deload — then *phase* — be scoped per exercise rather than per
session? Investigating it against production data instead surfaced a shipped defect that mattered
far more, and the session pivoted to fixing that.

## Current status

- **Build/test:** full suite `2928 passed / 0 failed`, typecheck clean, lint 0 errors — run on the
  rebased base immediately before push. CI green on all six checks (Android included; it ran
  because `package.json` changed, not because Kotlin did). Merged to `main` as `d37f696`.
- **Dev server:** exercised. `POST /api/ai-periodization/session/:id/prescribe` verified end-to-end
  against the local DB: `accumulation → intensification`, status `auto_applied`, **phase actually
  moved in the DB**.
- **Device-verified:** **no.** No device this session. The new rationale banner and the amended card
  header line are unverified on the S25 (Samsung WebView, safe-area). This is a JS/server-only
  change, so it reaches the device via the Railway deploy — **no APK needed**.

## What shipped (PR #1025, v1.252.0)

| Change | Where |
|---|---|
| Auto-apply now calls `advancePhase` for a model-earned transition — previously it set `prescriptionStatus = 'auto_applied'` and moved nothing | `packages/shared/src/ai-periodization/generate-prescription.ts` (~line 600) |
| `canAutoApplyTransition()` — a transition auto-applies only when the model chose it, never when a ceiling forced it | `packages/shared/src/ai-periodization/phase-guards.ts` |
| `buildTransitionRationale()` — deterministic, evidence-cited explanation built from the same thresholds the engine gates on | `packages/shared/src/ai-periodization/transition-rationale.ts` (new) |
| `transitionRationale?: string` on the prescription | `packages/shared/src/types/ai-periodization.ts` |
| Rationale banner at the top of the card; header no longer says "transition suggested" after one was applied | `components/workout/ai-prescription-card.tsx` |
| Toggle copy now states what auto-apply covers and that deloads always ask | `components/config/program-editor-sheet.tsx` |
| 13 unit tests | `packages/shared/src/ai-periodization/__tests__/transition-rationale.test.ts` |

**No migration.** `transitionRationale` lives inside the existing prescription JSON.

## The production evidence (do not re-derive)

Read-only prod access works from the sandbox — `CLAUDE_DB_QUERY_SECRET` is set as a real env var;
`CLAUDE_DB_READONLY_URL` lives server-side on Railway and is *not* needed locally. Call
`POST https://trainingai-production.up.railway.app/api/admin/db-query` with
`Authorization: Bearer $CLAUDE_DB_QUERY_SECRET` and `{"sql": "..."}`. `GET` on the same route lists
the 71 readable `claude_ro` views. **This session initially reported prod access unavailable — that
was a misread of an `env | grep` output, not a real gap.**

What the audit found (2026-08-03):

- Legs, Push and Upper each carried a pending "move to intensification" for up to a week (generated
  Jul 27–30). Pull carried a pending deload. Only Lower had ever transitioned.
- **The prescriptions were already written at intensification loads** — powerbuilding primaries at
  82.5 / 82.5 / 83% against an intensification band of 80–87.5%. Push had already *trained* them
  (`last_session_ran_prescription = true`) with its stored phase still reading accumulation.
- 22 of 26 exercises are progressing; several implausibly (+45.8% bent-over row, +38.7% incline
  bench over seven weeks).
- Exactly **one** primary/secondary compound is genuinely stalling: Cable Pulldown (Upper, −7.7%).
- The active program (`Shikai`, powerbuilding) has `auto_apply_prescriptions = true`.

## Deliberately NOT done

- **Deloads still ask.** Owner call: cutting to ~50% for 2 sets is disruptive enough to be a
  decision, not a surprise. Do not "finish the job" by extending auto-apply to them.
- **Ceiling-forced transitions still ask.** Not an oversight — see the decision below.
- **Q-52 (per-exercise phase hold) was planned but not built.** Plan is in
  `docs/superpowers/plans/2026-08-02-per-exercise-phase-hold.md`, backlog entry Q-52.
- **The already-pending prescriptions were not retro-fixed.** The fix acts at generation time and
  cannot reach rows already stored as `pending` (the "seeds don't fix drifted prod rows" class).

## Key decisions (with rationale)

- **A ceiling-forced transition must not auto-apply.** Exercise percentages are clamped against the
  *model's* `parsed.phase`, and the ceilings (`applyAccumulationCeiling` et al.) rewrite
  `phase`/`phaseAction` **afterwards**. So when a cap forces the transition, the prescription still
  carries the *old* phase's loads — auto-applying it would advance the phase into a session
  prescribed a zone too light. A forced transition also means a cap broke an ambiguous tie, which is
  exactly when the lifter should decide. This ordering is the whole reason the predicate exists.
- **The rationale is built in code, not taken from the model.** It has to quote the thresholds the
  engine actually gates on; model prose varies run to run and cannot be relied on to quote a number
  it was never given. Building it from the same constants means explanation and decision cannot
  disagree.
- **`advancePhase` runs BEFORE `storePrescription`.** It nulls the stored prescription and resets
  the status as a side effect — the `respond` route already carried this trap in a comment.
- **A manual/default per-exercise phase offset was rejected by the owner** — *"I don't want it to
  DEFAULT behind. I'd want it to only be in a different session if it needed to be."* Q-52's plan
  was rewritten around an engine-derived hold. Do not reintroduce a configuration field as a
  "simpler" substitute.

## Gotchas / what did NOT work

- **`parsed` uses snake_case** (`parsed.phase_action`), the prescription uses camelCase
  (`prescription.phaseAction`). Typecheck catches it; worth knowing before you write it.
- **`reconcileSessionsInPhase` will silently undo a hand-seeded `sessions_in_phase`.** It derives
  the count from real sessions and requires `EXISTS (SELECT 1 FROM exercise_logs …)` — a
  `workout_sessions` row with no exercise logs does not count. To set up a phase-ceiling scenario
  locally you must insert completed sessions **and** their exercise logs (`logged_at` is NOT NULL).
- **The auto-apply confidence gate is 0.6**, and confidence is `0.3 + 0.1 × min(recentSessions, 3)`
  plus two `+0.1` tiers (`confidence.ts`). Fresh local seed data sits at 0.5, so auto-apply silently
  won't fire until you add recent sessions and a mood log. This confounded a test run before it was
  spotted.
- **`pnpm test` needs `DATABASE_URL` exported.** Without it you get an unattributed
  `Error: DATABASE_URL is not set` from `getPool` plus an apparently-failing
  `implausible-cadence.test.ts`. Both vanish with
  `export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/trainingai_dev"`. Also run
  `pnpm install` first, or ~100 files fail on unresolved `@trainingai/shared/*` subpaths.
- **The ceiling-forced branch cannot be tested end-to-end** — you cannot make the model answer
  "stay" on demand while a cap is tripped. It is covered by `canAutoApplyTransition`'s unit tests.

## Files to look at

- `packages/shared/src/ai-periodization/generate-prescription.ts` — the status/advance decision, ~line 600.
- `packages/shared/src/ai-periodization/phase-guards.ts` — `canAutoApplyTransition` + the ceilings it guards against.
- `packages/shared/src/ai-periodization/transition-rationale.ts` — thresholds and mechanism text.
- `app/api/ai-periodization/session/[sessionId]/respond/route.ts` — **still only handles `deload_recommended` on accept.** Accepting a *transition* here marks it `accepted` and never advances the phase; the working path is the separate `transition/route.ts`. Left as-is (the card sends transitions to the right route), but it is a live trap for anyone adding a new accept path.
- `packages/shared/src/ai-periodization/role-plausibility.ts:53` — `capLoadToAnchor`, the invariant behind the "offset can only go backwards" reasoning in Q-52's plan.

## Open questions / blockers

- **Owner: look at the new banner on the S25.** Unverified on device; Known-Issues row filed.
- **Owner: rotate `GOOGLE_GENERATIVE_AI_API_KEY`.** It was printed into the 2026-08-03 session transcript.
- **"Lower" has no primary exercise** (3 secondaries, 2 accessories). `capLoadToAnchor` resolves the
  anchor from roles, so a secondary is acting as the anchor on that day. Probably a program-config
  slip — needs an owner decision on whether to fix the program or harden the helper.
- **Estimated-1RM growth is implausible on several lifts** and it gates transition eligibility and
  autoregulation. Bodyweight movements also carry meaningless absolute values (Pull-Up "118 kg"),
  so their trend is unreadable. Both are Known-Issues rows, neither has a queue entry yet.
- **Q-52's priority is undercut** — re-measure before building it. It would today apply to one
  exercise, and could not have fired for it anyway because holds compute at a transition and Upper
  had never had one. Now that transitions actually apply, blocks may start cycling and the picture
  may change.

## Pickup prompt

```
Work in the TrainingAI repo on branch `claude/exercise-deload-scoping-1wy79m` (start it fresh:
`git fetch origin main && git remote prune origin && git checkout -B claude/exercise-deload-scoping-1wy79m origin/main`).

Read in this order:
1. `projectOverview.md` — status, and the three `[workouts]` Known-Issues rows dated 2026-08-03.
2. `docs/domains/workouts/README.md` — the pillar index.
3. `docs/handoff-2026-08-03-workouts-auto-apply-phase-transitions.md` — the previous session's
   handoff, including its Gotchas section (test-env setup traps that will cost you an hour).
4. `docs/implementation-backlog.md` — the queue.

Context: PR #1025 (v1.252.0, merged 2026-08-03) fixed auto-apply so it actually calls
`advancePhase` for a model-earned phase transition. Before it, four of five session types had sat
in accumulation since June against prescriptions already written at intensification loads.

First concrete action: re-run the production audit to see whether transitions are now actually
applying. Read-only prod access works from the sandbox — `CLAUDE_DB_QUERY_SECRET` is set as an env
var (the readonly URL lives server-side on Railway and is NOT needed locally):

  curl -sS -X POST https://trainingai-production.up.railway.app/api/admin/db-query \
    -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H "Content-Type: application/json" \
    -d '{"sql":"SELECT ps.name, sp.phase, sp.sessions_in_phase, sp.prescription_status, sp.prescription->>'"'"'phaseAction'"'"' AS action FROM claude_ro.session_periodization sp JOIN claude_ro.program_sessions ps ON ps.id=sp.program_session_id JOIN claude_ro.programs p ON p.id=ps.program_id WHERE p.is_active ORDER BY ps.name"}'

If Legs/Push/Upper have moved off accumulation, the fix is working in production — say so and
strike the Known-Issues row. If they are still pending, diagnose before building anything new.

Constraints you would otherwise rediscover:
- Everything reaches `main` through a PR with all CI checks green. Never commit to `main`.
- `pnpm test` needs `pnpm install` first AND
  `export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/trainingai_dev"`, or ~100
  files fail on unresolved `@trainingai/shared/*` and you get a phantom cadence-test failure.
- Device-verification gate: no device in-session. Any offline-first / native / safe-area / gesture
  / notification change needs an on-device smoke run OR a Known-Issues row marking it unverified.
  Note JS/server changes reach the phone via the Railway deploy — no APK needed.
- Deloads must keep asking before they apply. That is an explicit owner decision, not an oversight.
- Do NOT reintroduce a user-configurable per-exercise phase offset (Q-52) — the owner rejected a
  default-behind setting; the plan is built around an engine-derived hold.

Waiting on the owner: an S25 look at the new prescription-card rationale banner; rotation of
GOOGLE_GENERATIVE_AI_API_KEY; and a decision on the "Lower" session having no primary exercise.
```
