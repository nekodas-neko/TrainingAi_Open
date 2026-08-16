# 2026-08-03 — auto-apply never moved the phase; per-exercise phase parked

Branch: `claude/exercise-deload-scoping-1wy79m`. Started as a design question about scoping
deload/phase to individual exercises; a production audit redirected it to a shipped defect.

## What shipped

**Auto-apply now applies phase transitions.** `generatePrescriptionForSession` set
`prescriptionStatus = 'auto_applied'` and never called `advancePhase`, so the stored phase stayed
put while the prescription was already written in the new phase's zone. Auto-apply was additionally
gated on `phaseAction === 'stay'`, so a transition could never qualify in the first place.

- `canAutoApplyTransition` (`phase-guards.ts`) — a transition auto-applies **only when the model
  chose it**. The exercise percentages are clamped against the model's own `phase`, and the ceilings
  rewrite `phase`/`phaseAction` *afterwards*; a ceiling-forced transition therefore carries the old
  phase's loads, and applying it would advance into a session prescribed a zone too light. A forced
  transition also means a cap broke an ambiguous tie — the lifter should decide.
- `advancePhase` runs **before** `storePrescription` (it nulls the stored prescription and resets
  the status as a side effect).
- **Deloads stay manual** (owner call): cutting to ~50% for 2 sets is disruptive enough to be a
  decision, not a surprise.
- `transition-rationale.ts` — deterministic, evidence-cited explanation built from the same
  thresholds the engine gates on, so the explanation and the decision cannot disagree. Rendered at
  the top of the prescription card, since an auto-applied transition changes the bar load without
  the lifter pressing anything.
- Card no longer says "Phase transition suggested" after one has been applied; the config toggle
  now states what it covers and that deloads always ask.

13 unit tests. Full suite 2928 passed / 0 failed.

## What the production audit found

Read-only prod access (`/api/admin/db-query`) — the session initially reported it unavailable,
which was a misread of the env check, not a real gap. `CLAUDE_DB_QUERY_SECRET` is set; the
readonly URL lives server-side.

- **Three sessions had a pending "move to intensification" for up to a week** (Legs, Push, Upper —
  generated Jul 27–30). Pull had a pending deload. Only Lower had ever transitioned.
- **The prescriptions were already written at intensification loads** — powerbuilding primaries at
  82.5 / 82.5 / 83% against an intensification band of 80–87.5%. Push had already *trained* them
  (`last_session_ran_prescription = true`) while its stored phase said accumulation.
- **22 of 26 exercises are progressing**, several implausibly (+45.8% bent-over row, +38.7% incline
  bench over seven weeks) — consistent with the known "starting weights never reach the bar" issue
  rather than real adaptation.
- **Exactly one compound is genuinely stalling**: Cable Pulldown (Upper, secondary, −7.7%). The
  other apparent stalls are artifacts — bodyweight movements whose estimated 1RM is meaningless
  (Hanging Leg Raise, Pull-Up), a 0.5 kg move on a light isolation (Lateral Raise), and an exercise
  dropped from the program in July (Front Squat).
- **"Lower" has no primary exercise** — 3 secondaries, 2 accessories, no anchor for
  `capLoadToAnchor`.

## Q-52 (per-exercise phase) — planned, then parked

The plan went through two revisions before the data killed its priority:

1. A manual per-exercise `phase_offset` setting — **rejected by the owner**: *"I don't want it to
   DEFAULT behind. I'd want it to only be in a different session if it needed to be."*
2. An engine-derived hold, recomputed at each transition from the exercise's own signals.

Then the audit showed the feature would apply to **one exercise** in the whole program, and could
not have fired for it anyway — holds are computed at a transition, and Upper had never had one.
Left in the queue at 🟡 with the evidence recorded.

## Not verified

No device this session. Not exercised: the new rationale banner and the amended header line on the
S25 (Samsung WebView, safe-area), and the ceiling-forced branch end-to-end — the model cannot be
made to answer "stay" on demand, so that branch is covered by `canAutoApplyTransition`'s unit tests
and reasoning rather than a live run. The auto-apply path itself **was** verified end-to-end against
the local dev server: `accumulation → intensification`, status `auto_applied`, phase moved in the DB.
