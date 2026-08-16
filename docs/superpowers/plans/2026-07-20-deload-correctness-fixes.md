# Fix: early-deload doesn't reduce load + emergency-deload can self-trigger

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §4. Branch:
`fix/deload-correctness-batch`.

## Problem

1. Confirming "early deload" from the home card never actually reduces prescribed weights/reps —
   it only suppresses PR writes and shows a banner. The UI copy ("Take deload week now") promises
   real load reduction the code doesn't deliver.
2. The emergency-deload trigger can fire immediately after a session completes, because
   `hoursSinceLastSession` is computed from a session list that includes the just-finished session
   itself, making `hoursSinceLastSession ≈ 0` at prescribe-time by construction (deep-review E2-3,
   deferred at the time, re-confirmed still live).

## Root cause

1. `isDeloadActive()` (`lib/phase-engine.ts:109-118`) returns true for either a real
   `phaseType==='deload'` phase OR the 7-day `program.earlyDeloadWeekStart` window (set by
   `POST /api/confirm-early-deload`, `app/api/confirm-early-deload/route.ts:26`). But
   `currentPhase` — the value `resolveStyleForExercise` actually uses to pick a prescribed style
   (`lib/phase-engine.ts:120-140`, consumed via `app/api/workout-data/route.ts:167-172`'s
   `sessionPhaseStatus.phase`) — comes purely from `getCurrentPhase`'s natural phase resolution and
   is never adjusted when `earlyDeloadWeekStart` is set. Every current consumer of
   `isDeloadActive()` (`workout-screen.tsx:1148`, `active-workout-screen.tsx:241-243`,
   `pre-workout-screen.tsx:148-166`, `log-exercise.ts:117`) only uses it for PR-suppression and
   banner rendering — none of them feed it into style resolution.
2. `getRecentSessionsOfType` (`lib/data/postgres/slices/periodization.ts:299-317`) orders by
   `startedAt desc` with no exclusion of the session whose completion triggered the current
   `/prescribe` call; `complete-workout/route.ts:44-52` fires `/prescribe` immediately after
   marking that session complete, so `signals.ts:235-238`'s `last5.find(s => s.completedAt != null)`
   picks up the just-completed session itself as "last session," yielding
   `hoursSinceLastSession ≈ 0`, which can satisfy `shouldTriggerEmergencyDeload`'s `<36h` condition
   (`lib/ai-periodization/emergency-deload.ts:28-32`) unintentionally.

## Fix

1. When `earlyDeloadWeekStart` is active for the program, resolve a genuinely lighter style for
   the session the same way a real `phaseType==='deload'` phase does — the cleanest approach is
   having `getCurrentPhase` (or the call site that builds `currentPhase` for
   `resolveStyleForExercise`) check `program.earlyDeloadWeekStart` and, if the current date falls
   inside that window, apply the phase's deload-style resolution logic even though the underlying
   `ProgramPhase.phaseType` is still the natural (non-deload) one. Scope this narrowly: don't
   change the phase object's persisted `phaseType`, only how style resolution treats it for the
   duration of the confirmed window. Update `early-deload-card.tsx` only if the copy needs
   adjusting once the real behavior matches it (it may already be accurate once this ships).
2. Exclude the triggering session from `hoursSinceLastSession`'s computation — either have
   `getRecentSessionsOfType` accept an `excludeSessionId` param (the session id that's mid-completion
   right now) that `/prescribe` passes when called from `complete-workout`'s post-completion hook,
   or compute `hoursSinceLastSession` from the *second*-most-recent completed session when the
   most recent one is the one currently completing. Prefer the explicit `excludeSessionId` param —
   it's less fragile than positional skip logic.

## Files touched

- `lib/phase-engine.ts` (early-deload-aware style resolution)
- `app/api/workout-data/route.ts` (if `currentPhase` construction needs the early-deload check
  threaded through)
- `components/home/early-deload-card.tsx` (copy check only, likely no change needed)
- `lib/data/postgres/slices/periodization.ts` (`getRecentSessionsOfType` excludeSessionId param)
- `lib/ai-periodization/signals.ts` (pass the excluded session id through)
- `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` or
  `app/api/complete-workout/route.ts` (wherever `/prescribe` is invoked post-completion, pass the
  just-completed session id as excluded)

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: confirm an early deload on a test program, then generate/view the next session's
  prescribed sets and verify weights/reps are genuinely reduced (not just the banner showing) —
  add a unit test asserting `resolveStyleForExercise` returns the lighter style when
  `earlyDeloadWeekStart` covers today.
- `pnpm dev`: complete a workout session and verify the emergency-deload check does not fire based
  on the just-completed session's own `hoursSinceLastSession ≈ 0` — add/extend a unit test on
  `shouldTriggerEmergencyDeload`/`aggregateSignals` covering this exact sequence (complete session
  N, immediately check hoursSinceLastSession excludes N).
- No native/device-only behavior — server/JS logic only, no device-smoke gate required, though the
  home card's banner text is worth a quick visual check in `pnpm dev`.

## Rollback

Both fixes are logic-only changes to existing functions (no schema/migration) — revert per-commit
if a regression in phase/style resolution or deload-trigger timing surfaces. Given
`resolveStyleForExercise` is on the hot path for every session render, land task 1 behind careful
review of its diff size (CLAUDE.md flags `phase-engine.ts`/`adapter.ts` as sensitive shared code).
