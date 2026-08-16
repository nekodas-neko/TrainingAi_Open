# 2026-08-07 — Deloaded sets no longer inflate the 1RM estimate or mint bogus PRs

**Domain:** workouts — v1.267.9, JS-only (no APK rebuild) + one data-correction migration

## The report

Q-115 (owner UI-bug batch): a deload-flagged Incline Bench Press session produced a false "New
Personal Record" and a 1RM jump from 78.75kg to 85.75kg off two light sets (42.5kg × 8, 42.5kg ×
11) — "those numbers don't look right." Widened the same day: a sore-muscle check-in that promised
only bench-press-adjacent exercises would be lightened instead deloaded the entire session, and 4
of 5 completed exercises got flagged "Personal Records."

## Root cause

`prescriptionStyleForExercise()` (`packages/shared/src/ai-periodization/apply-prescription.ts`)
unconditionally set `useFor1rm: true` on every prescribed set regardless of `presc.deloaded`, so a
deliberately submaximal deload set (`DELOAD_LOWER_PCT` ≈ 50%) ran through `calculate1RM`'s
`prescriptionFactor` as if it were a genuine max-effort top set. Not just a display bug: the
inflated number gets stored as the exercise's estimated 1RM, and `resolveWorkingBasis()` takes the
max of last-log/seed/all-time-PR across every prescription path — a bogus deload-session number can
push a future real session's prescribed weight above what the lifter has actually earned.

## The naive fix wasn't enough

The obvious fix — `useFor1rm: !presc.deloaded` — turned out to be necessary but not sufficient.
`calculate1RM`'s own selection logic:

```ts
const indices = style?.some(s => s.useFor1rm)
  ? reps.map((_, i) => i).filter(i => style![i]?.useFor1rm)
  : reps.map((_, i) => i)
```

treats "not a single set in this style is marked `useFor1rm: true`" as "no preference — use them
all," not "exclude everything." That fallback is load-bearing for real, unrelated styles: the
"General" progression style has every set stored as `useFor1rm: false` in production and is
*supposed* to still produce a normal estimate from all of them (confirmed via a regression test
that would otherwise have broken it). Flipping a deload's sets to all-`false` lands in exactly the
same shape as "General" and would have silently kept computing the inflated estimate — proven with
a scratch test against the exact reported numbers before committing to this approach.

## The real fix

Added an unambiguous `deloaded` option to the shared `estimateOneRm()`
(`packages/shared/src/1rm.ts`) that short-circuits to `{ estimated1rm: 0, target80: 0 }` before
either formula path runs, sidestepping the `useFor1rm` ambiguity entirely rather than trying to
encode "exclude everything" through it:

- `packages/shared/src/1rm.ts`: `estimateOneRm` gains `opts.deloaded` (default false); when true,
  returns a zero estimate immediately.
- `packages/shared/src/workout/log-exercise.ts`: passes
  `deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline)` — covers both the AI
  per-exercise/whole-session deload signal and the static program's deload-phase/early-deload
  signal, with the same baseline carve-out `shouldCountTowardPr` already uses.
- `components/workout-screen.tsx`: the client computes the same estimate optimistically (shared
  estimator, mirrors the server) — moved `isAnyDeload`'s definition earlier in `handleCompleteSet`
  and passed the equivalent `deloaded: ex.deloaded === true || (isAnyDeload && !isBaseline)` so the
  exercise-summary screen never shows the inflated number in the first place.
- Zero is already a safe sentinel throughout: `resolveWorkingBasis()` filters `v > 0`,
  `shouldCountTowardPr()` gates on `<= 0`, and `computeIntensityPct()` returns `null` for a
  non-positive 1RM — no downstream consumer needed a change to handle it correctly.
- `packages/shared/src/ai-periodization/apply-prescription.ts`: kept `useFor1rm: !presc.deloaded`
  alongside the real fix — still accurate metadata, harmless now that the actual exclusion runs
  through `deloaded` instead.

## The whole-session gap

The owner's widened report traced to `buildWholeSessionDeloadPrescription`
(`packages/shared/src/ai-periodization/generate-prescription.ts`), which builds a fresh deload
prescription for the >50%-of-exercises-sore escalation path and **never set the per-exercise
`deloaded` flag** — only a prescription-level `AiPrescription.deload` boolean nothing downstream
actually reads. Every exercise built this way bypassed every gate: the estimate, the client PR
flash, and the server's `shouldCountTowardPr`. Fixed by stamping `deloaded: true` on each exercise
at construction, giving every consumer one consistent signal instead of two.

This also surfaced a latent UX dead-end: `pre-workout-screen.tsx`'s "Deload" pill now correctly
shows for whole-session-deloaded exercises (it never did before), but its revert dialog
(`DeloadInfoSheet`) always rendered a "Use full weights" button — which does nothing for a
whole-session deload, since only the per-exercise escalation path stamps `preDeload` (the numbers
to revert to). Fixed by gating the button on `exercise.preDeloadStyle` existing.

## Sibling-surface check

The static-progression-style deload path (`deloadAwareStylePhase`, program-configured deload-phase
styles) was checked against production: every deload-phase style set is stored with
`use_for_1rm: false` in production, already correctly configured. Since the new `deloaded` gate is
driven by `isAnyDeload` (which already covers this path via `currentPhaseType === 'deload' ||
sessionIsEarlyDeload`), this path is now doubly protected rather than needing a separate fix.

## Production data correction

Confirmed via a read-only `claude_ro` query that the whole-session-deload gap had already written 4
inflated PRs on 2026-08-06 (the owner's own reported session): Cable Pulldown 37.25→36.00, Barbell
Overhead Press 60.50→57.50, Barbell Skull Crusher 48.00→46.00, Cable Preacher Curl 19.25→17.00 — each
corrected value verified against that exercise's own real prior log history, not guessed. Presented
the finding and asked before acting (production data, inferred values); confirmed to proceed.
Shipped as `168_q115_whole_session_deload_pr_correction.sql`: idempotent, expressed generically over
users (matches on exercise name + the exact corrupted value, not a hardcoded user id), correcting
both the `personal_records` rows and the source `exercise_logs` rows (stamping
`exercise_deloaded = true`, `estimated_1rm = 0` on them) so history matches what the fixed code would
have written, and so a future reconciliation pass can't re-derive the bad numbers from them. Verified
by applying it directly against the local dev DB (no-op there, no matching rows) and by running it
twice to confirm idempotency, plus a dry run through the same `migrate.js` CI uses.

## Verification

Added `packages/shared/src/ai-periodization/__tests__/apply-prescription.test.ts` and a new
`describe` block in `packages/shared/src/__tests__/1rm.test.ts` covering the `deloaded` gate,
including a regression test proving the "General" style's all-`false` sets still compute normally
(the exact case the naive fix would have broken). Typecheck and lint clean on all touched files
(the pre-existing `voice-log-button.tsx` missing-module error is unrelated). Full suite: 402 files /
3,183 tests green.

Ran `pnpm dev` against the seeded local DB and exercised the real path via `POST
/api/log-exercise`: the owner's exact reported numbers (42.5kg × 8, 42.5kg × 11, deloaded) returned
`estimated1rm: 0, isPR: false`, and the corresponding row's `estimated_1rm` in Postgres is `0`, not
85.75 — confirmed directly via `psql`. A control case with genuine working sets (60kg × 8 × 2,
`useFor1rm: true`) returned `estimated1rm: 79, isPR: true` unaffected. Test rows cleaned up
afterward.

**Not exercised:** the `DeloadInfoSheet` revert-button guard (code-reviewed, not visually
screenshotted — reconstructing a live whole-session-deload scenario in the UI was out of scope for
this pass). No on-device S25 verification — this is a pure computation/data fix with no
native/offline-store/safe-area involvement.

## Remaining scope

The sore-muscle-picker's "will be lightened" banner still doesn't account for the whole-session
escalation rule — split off as Q-115-followup, needs per-exercise muscle-role data threaded through
several component layers to reuse the shared `computePerExerciseDeload` client-side.
