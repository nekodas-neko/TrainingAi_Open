## 2026-07-30 — AI-adaptive phase labels + pre-workout prescription-card layout shift

Two owner-reported bugs from PR #587 (opened 2026-07-17, too far behind `main` to rebase —
reimplemented fresh against current code; #587 closed as superseded). The other two items in that
PR were already fixed independently: the food-sync FK failure (mutation-schema.ts already lists
`food_items`) and the timer status-bar chip extension to warm-up/bar-load phases
(`startRestChip(..., 'warmup')` already wired in `workout-screen.tsx`).

### "Cycle 1/1" meaningless for AI-adaptive programs

`ai_dynamic` programs have no fixed cycle count, but every `sessionPhaseStatus` construction site
in `app/api/workout-data/route.ts` hardcoded `cycleInPhase: 1, totalPhaseCycles: 1` — so every
render site showed a literal, unchanging "Cycle 1/1" regardless of how many sessions had actually
run in the phase.

Added `openEnded?: boolean` and `phaseSessionNumber?: number` to `PhaseStatus`
(`lib/workout/session-data.ts`), set at all four `ai_dynamic` construction sites (baseline ×2,
deload, normal). Updated all four render sites to show `"{phase} · Session N"` when `openEnded` is
set: `pre-workout-screen.tsx` (header + deload banner), `active-workout-screen.tsx` (in-workout
header), `workout-select-content.tsx`, and `recommendation-card.tsx` (which also skips the
cycle-progress bar for open-ended phases, since a bar that's always "0/1" conveys nothing).
Automatic (non-AI) programs are unaffected — they still get the real cycle/duration numbers.

### Pre-workout AI prescription card popping in ~2s after open

The cache-seeding infrastructure already existed — `loadPeriodization()` in `workout-screen.tsx`
calls `readCacheSync` and sets `periodization` synchronously before the network fetch even starts.
But `pre-workout-screen.tsx`'s render condition was `!loading && !periodizationLoading &&
periodization`, so the card stayed hidden for the whole fetch even when a valid cache seed was
already in state — the seed was doing nothing, and the card always popped in once the fetch
resolved. Now renders as soon as `periodization` is set; a loading skeleton only appears on a
genuine cold start (no cache seed at all yet).

### Tests

`pnpm exec tsc --noEmit` clean · `pnpm lint` 0 errors (same pre-existing warnings) · full `vitest`
suite green except the one confirmed-environmental `claude-ro-readonly-role.test.ts` failure ·
`check-doc-links.js` / `check-push-mutations.js` / `check-reconcile.js` all clean · local `pnpm dev`
smoke: server starts clean, `/workout-select`, `/session-select`, `/workout`, `/health` all respond
without a 500 (redirect to sign-in as expected, unauthenticated).

### Not verified

No `ai_dynamic` program was exercised end-to-end against a real session (would need a seeded
AI-periodization state) — the fix was verified by tracing the exact data flow from construction
site to render site, not by visually confirming the label on a live baseline/normal/deload session.
Worth a glance next time an AI-adaptive session is actually run.
