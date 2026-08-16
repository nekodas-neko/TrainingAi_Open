## 2026-07-21 — Workout screen 3-card redesign (v1.193.0)

**Branch:** `feat/workout-select-three-card` — item #14 (final item) of the owner's Health/Training/Workout
UX batch. Closes the batch: all 14 items now shipped.

Rewrote `app/workout-select/workout-select-content.tsx` from a full-100dvh single-card **vertical-swipe
carousel** (one session filling the screen, dot indicators, a separate Log Activity button) into a
scrollable **three-card** layout:

1. **Workout card (large)** — a compact session picker (horizontal chip row, recommended marked) drives
   which session shows; the selected session renders a compact `MuscleHeatmap` (max-w-200), phase/last-trained
   info, exercise count/duration, the recovery strip, and Start. Replaces swipe-to-change with tap-a-chip.
2. **Run card (large)** — new `components/workout-select/run-card.tsx`: fetches `/api/running-plan`, shows
   the goal + next prescribed run (the "cool metric") with an animated drifting glow, tapping to `/running`;
   robust empty state ("Tap to set up your running plan") when no plan is configured.
3. **Activity card (small)** — opens the existing `LogActivitySheet` (activity-type grid → `/activity`).

Removed: the hand-rolled vertical touch-swipe gesture (non-passive `touchmove`, velocity/flick math), the
dot indicators, and the `100dvh` fixed height. Kept all data fetching (sessions, library, recovery,
recommended, phase), `buildMuscleActivations`, and `handleStart` unchanged.

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors; one harmless unused-read warning on `hasSeeded`, whose
  setter still gates one-time seeding), `pnpm test` (1793 passed), `pnpm build` — green.
- `pnpm dev`: `/workout` renders HTTP 200 with the Push/Pull/Legs chip picker; `/api/running-plan` returns
  its empty state, so the Run card shows the set-up prompt.

### NOT verified on device (Known-Issues row added)
Safe-area of the scrollable layout + Start button, the compact muscle-map SVG on Samsung's WebView
compositor, chip-picker touch behaviour, and the **Run card's populated state** (goal + prescribed-run
metric + animation) — the local seed has no running plan configured, so only the empty state was
exercised. Run `docs/device-smoke-checklist.md` on the S25.

### Batch closed
This PR also reconciles the ledgers: `docs/implementation-backlog.md` marks the whole UX batch ✅ ALL 14
SHIPPED, and `projectOverview.md` current status → v1.193.0 with the outstanding-work = on-device
verification only.
