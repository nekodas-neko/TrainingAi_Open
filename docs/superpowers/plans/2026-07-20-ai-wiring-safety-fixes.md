# Fix: AI safety-gate leak + session-explain dead readiness source + next-session expiry gap

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §3. Branch:
`fix/ai-wiring-safety-batch`.

## Problem

1. The Workout Review "apply" endpoint lets the LLM's own self-reported confidence score drive the
   mandatory low-confidence-confirmation safety gate, violating CLAUDE.md's explicit rule that "no
   LLM self-reported number may gate an automatic action."
2. The "Why this?" session-explain page and its AI narration read a structurally-dead frozen Oura
   Cloud column for readiness, even though the actual prescription engine three lines away in the
   same function already reads the correct live-readiness composite — so the explanation
   contradicts the math it's explaining.
3. `next-session`'s dropped-exercise filter doesn't check prescription expiry the way `workout-data`
   does, so the home card and the workout screen can briefly disagree on exercise count after a
   7-day "drop this cycle" prescription expires.

## Root cause

1. `app/api/workout-review/session/[sessionId]/apply/route.ts:19,107` stores the client-supplied
   `body.confidence` (originating from the workout-review `generateObject` call's own
   `parsed.confidence`) straight into `AiPrescription.confidence` via `repo.storePrescription`.
   Compare `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:446-449`, which
   deliberately fills the same field with the deterministic `signals.confidence` computed by
   `lib/ai-periodization/confidence.ts:40` — with a comment explaining exactly why. The apply route
   never computes or uses that deterministic score at all, and never sets `confidenceReasons`.
   `components/workout/ai-prescription-card.tsx:59` reads `prescription.confidence` to gate the
   `confirmLow` checkbox — so this field controls a real user-facing safety confirmation.
2. `lib/data/postgres/adapter.ts:1628` — inside `getNextSession`'s ai_dynamic branch,
   `signals.ouraReadiness: ouraToday?.readinessScore ?? null` reads `this.getOuraDaily(...)`
   directly, while line 1612's `liveReadinessForDay(todayIso, derivedRows, ouraRows)` correctly
   feeds the scoring engine. Since the 2026-07-07 re-key, `getOuraDaily` returns no current-day
   rows, so `signals.ouraReadiness` is always null — flowing into
   `lib/session-explain/build-explain-data.ts:11` → `group-signals.ts:47-48` and
   `app/api/session-explain/insight/route.ts:60`.
3. `app/api/next-session/route.ts:18-27` gates its `droppedExerciseIds` filter only on
   `prescriptionDrivesLoad(p.phaseAction, state.prescriptionStatus)`, never on
   `state.prescriptionExpiresAt`, unlike `app/api/workout-data/route.ts:222-226` which checks both.

## Fix

1. In the workout-review apply route: compute (or accept from the review-generation step) a
   deterministic confidence signal for the review's proposed changes instead of trusting the
   model's self-report — or, if a genuinely deterministic score isn't cheaply available for this
   surface, don't gate `confirmLow` on it at all (default to always requiring confirmation, the
   safe default, rather than trusting an LLM number). Also populate `confidenceReasons` when the
   gate fires so the card isn't a bare unexplained percentage.
2. In `getNextSession`'s ai_dynamic branch: replace the direct `ouraToday?.readinessScore ?? null`
   read at `adapter.ts:1628` with the already-computed `liveReadinessForDay` result from line 1612
   (reuse the same variable, don't call it twice), so `signals.ouraReadiness` matches what the
   scoring engine actually used.
3. In `app/api/next-session/route.ts`: add the same `prescriptionExpiresAt` check
   `workout-data/route.ts:222-226` uses before applying `droppedExerciseIds`, so both routes agree
   on when a this-cycle drop prescription has expired.

## Files touched

- `app/api/workout-review/session/[sessionId]/apply/route.ts`
- `components/workout/ai-prescription-card.tsx` (only if `confidenceReasons` rendering needs a
  small adjustment — check first, it may already render an empty-array case gracefully)
- `lib/data/postgres/adapter.ts` (`getNextSession` ai_dynamic branch)
- `app/api/next-session/route.ts`

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: trigger a Workout Review apply and confirm the resulting prescription's stored
  confidence matches a deterministic value (or that the confirm gate is no longer influenced by
  the model's self-reported number) — add/extend a unit test on `storePrescription` call args.
  covering this route if none exists.
- `pnpm dev`: with BLE/live-readiness data present for today, open the "Why this?" explain page and
  confirm the readiness figure shown matches the composite actually used in the recommendation
  (not "no data"/"not connected").
- `pnpm dev`: apply a "drop this cycle" workout review, then simulate/verify the 7-day expiry
  window boundary in `next-session` and `workout-data` responses agree (unit test on the expiry
  check is sufficient; no need to wait 7 real days).
- No native/device-only behavior — server/JS only, no device-smoke gate required.

## Rollback

Each of the three fixes is independent and localized to one route/function — revert individually
if a regression surfaces. No schema/migration changes involved.
