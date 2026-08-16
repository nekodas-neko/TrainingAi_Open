## 2026-07-20 — Generate the next AI prescription at session END, in-process

**Branch:** `claude/workout-screen-loading-jank-l5efu6` · **Version:** 1.185.3 (patch)

### Problem (owner report)
On the Health → Training "AI Periodization" card, the session you just trained lost its **"Auto"**
chip and sat blank, while an untrained session still showed "Auto". Owner ask: *"the auto workout
prescription should be loaded at the end of the session rather than the start of it — at every point
it should always have auto."*

### Root cause
Completing a session flips its prescription to `consumed` (`complete-workout.ts`), and the card
renders `consumed` as a plain dot (no chip). The next prescription was only (re)generated **on the
next open** of that workout — and the completion-time attempt that *did* exist was a fire-and-forget
**self-origin `fetch(.../prescribe)`** from the complete-workout route, the exact container→own-origin
hop the codebase documents as unreliable in prod (it silently never arrives). So the session stayed
`consumed`/chip-less until reopened.

### Fix
Regenerate the next prescription **at completion, in-process** (no HTTP hop):
- **New shared module `lib/ai-periodization/generate-prescription.ts`** — extracted the entire
  generation/validation/persistence core from the `/prescribe` route into
  `generatePrescriptionForSession(userId, programSessionId, repo, tz)` (request-free; returns a
  discriminated result). The route (`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`)
  is now a thin wrapper: auth + rate-limit + delegate. Also exports `regenerateNextPrescription`, a
  fire-and-forget completion wrapper that resolves the repo + user tz itself and swallows all errors.
- **`lib/workout/complete-workout.ts`** now returns a `regeneratePrescription` flag (true for an
  ai_dynamic session past baseline on a first, non-replayed completion). It stays pure — the actual
  fire-and-forget is kicked off by the two edge callers, so no floating Gemini promise leaks past a
  unit test's teardown and replays can't double-fire.
- **Both completion callers** — `app/api/complete-workout/route.ts` and the offline-outbox
  `complete_workout` branch in `lib/data/postgres/adapter.ts` — replaced their unreliable
  `fetch(.../prescribe)` with `void regenerateNextPrescription(...)` gated on the new flag. The
  offline path no longer needs a request `ctx` to regenerate, so a workout completed offline also
  refreshes its prescription once it syncs.
- The on-open trigger in `/api/workout-data` is untouched and remains the **fallback** if a
  completion-time regeneration ever drops (status stays `consumed`).
- **Merge reconciliation with the W5 change** (`excludeSessionId`, landed on `main` in parallel):
  `generatePrescriptionForSession` / `regenerateNextPrescription` now take an `excludeSessionId` and
  thread it to `aggregateSignals`, and both completion callers pass the just-completed workout session
  id — so the completion-time regeneration can't let that session's `completedAt ≈ now` spuriously
  self-trigger the emergency deload via the hoursSinceLastSession gap (W5 §4.2).

Behaviour note: it still shows **"New"** (not "Auto") when the fresh prescription recommends a phase
change or comes back low-confidence — those legitimately need review and are never auto-applied. The
fix removes the silent chip-less *gap*, not the review path.

### Verification
- Full test suite green: **1787 passed / 107 skipped**. `tsc --noEmit` clean; eslint clean on changed
  files (pre-existing adapter unused-import warnings only). `scripts/check-push-mutations.js`: OK
  (the adapter change goes through the shared fn, not `this.db`/`sql`).
- Extended `lib/workout/__tests__/complete-workout.test.ts`: updated the return-shape assertions and
  added cases for `regeneratePrescription` true (ai_dynamic past baseline) and false (incomplete
  baseline).
- Local `pnpm dev`: the refactored `/prescribe` returns a clean **400 "Baseline not complete"** for
  the manual seed program (proves the extracted validation path runs, not a 500); `program-overview`
  (the card's data) is 200; the `/api/complete-workout` and prescribe routes compile.

### Not exercised
- **The Gemini generation path itself is not runtime-testable in the sandbox** — the local seed is a
  `manual` program (no ai_dynamic state, gated out before the LLM call) and there's no Gemini key. The
  extraction is a faithful move (verified by tsc + the full suite + the route returning the correct
  guard result), but the end-to-end "complete an ai_dynamic session → new prescription lands →
  card shows Auto" flow **needs on-device / real-data confirmation** on the S25 APK against the prod
  ai_dynamic program.
- A dev-only 500 was observed from `lib/observability.ts`'s `reportServerError` (Turbopack
  namespace-binding quirk on `getRepositoryAsync`) when completion threw the expected auth error —
  **pre-existing, in an untouched file, dev-only** (production uses webpack); the completion logic
  itself ran correctly.
