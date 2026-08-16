# 2026-07-20 — W3: AI wiring safety batch (wiring/caching-perf audit §3)

**Branch:** `fix/ai-wiring-safety-batch` · **No version bump** (server-only, no user-visible behavior change)

Third item of the wiring/caching-perf audit batch — three independent, localized server-side fixes.

## What landed

1. **Workout-review apply stops trusting the LLM's self-reported confidence.** The apply route was
   persisting the client-supplied `body.confidence` (sourced from the review `generateObject`'s own
   `parsed.confidence`) into `AiPrescription.confidence`, which `ai-prescription-card.tsx` reads to
   gate the mandatory low-confidence confirm checkbox — a direct violation of CLAUDE.md's "no LLM
   self-reported number may gate an automatic action." Since a Workout Review apply is a
   user-authored change that the route immediately **auto-accepts**, the correct deterministic value
   is `confidence: 1.0` (+ empty `confidenceReasons`), matching the deload "never gate" convention.
   Dropped `confidence` from `ApplySchema` so the model number is never accepted.

2. **`getNextSession` signals read the live readiness, not the dead Cloud column.** The ai_dynamic
   branch fed the scoring engine `liveReadinessForDay(...)` but its returned `signals.ouraReadiness`
   read the raw `oura_daily` Cloud column (`ouraToday.readinessScore`) — null since the 2026-07-07
   re-key. That value flows to the "Why this?" explain page + its LLM narration, so the explanation
   always said "no data" even when a real BLE composite drove the recommendation. Now computed once
   (`const liveReadiness`) and reused for both the engine input and the signals block.

3. **`next-session` honours prescription expiry.** Its dropped-exercise filter checked only
   `prescriptionDrivesLoad(...)`, not `prescriptionExpiresAt`, unlike `workout-data/route.ts`. After
   a 7-day "drop this cycle" prescription expired, the home card kept hiding the dropped exercises
   while the workout screen had reverted. Added the same expiry guard so both agree.

## Verification

- tsc + lint clean (0 errors). Periodization/next-session unit tests (reevaluate, emergency-deload,
  prescription — 24) green; full Postgres DB-integration cluster (34 files, 103) green.
- Server/JS only — no native/device behavior, so no device-smoke gate (per the plan). Each fix is
  independent and localized to one route/function; revert individually if needed.
