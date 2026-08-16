# Performance + UI Uplift Batch (Track B)

Status: PLANNED · Created 2026-06-29 · Branch: feature branch (code), this doc → `main`

## Context

Continuation of the ongoing perf/UI uplift work. These items are independent and shippable in small batches — no cross-dependencies with the local-first rework (Track A) beyond the health-content breakup overlapping the long-standing Phase 8 CB-4. Ranked by impact × effort. Findings from a full-codebase scan (session 164).

Match existing patterns: `components/health/`, `components/home/` (extracted in session 162–163), `React.memo` + `useShallow` already used in `components/workout-screen.tsx`.

## B1 — Component breakup (also tech debt)

Mega-components re-render their whole subtree on any state change. Extract into focused children + hooks.

- **`app/health/health-content.tsx`** (~1,937 lines, ~62 `useState`) → `HealthBodyTab` / `HealthTrainingTab` / `HealthProgressTab` / `DayOverlayPanel`, plus hooks `useWeightTrend` / `useEnergyBalance` / `useBmiClassification`. This is Phase 8 CB-4. All the per-card components already exist under `components/health/`; this extracts the tab orchestration and state.
- **`app/session-select/session-select-content.tsx`** (~1,489 lines) → recommendation section / metric-widgets section / card-widgets section / action bar. (Home cards `MiniSparkline`, `EarlyDeloadCard`, `GoalsCheckinCard`, `HomeCardWidget` already extracted in session 162.)
- **`components/config-screen.tsx`** (~950 lines) — split style/program/phase/schedule editors; scope Zustand with `useShallow` so editing one style doesn't re-render the whole screen.
- **`components/chat.tsx`** (~787 lines) — split message rendering; see B4.

## B2 — Memoization of hot paths

- `health-content.tsx` day overlay builds `new Map(activityTypes...)` / `new Set(...)` every render (≈ lines 1760–1762) → `useMemo`. Extract `DayExerciseSession` as `React.memo` so expanding one day doesn't re-render all sessions.
- Memoize SVG chart point computations: `components/exercise-history-sheet.tsx` (1RM trend `chartPoints`), `components/health/hr-day-chart.tsx`, `components/workout/hr-recovery-chart.tsx`.
- Wrap health cards in `React.memo` (`strength-progress-card`, `strength-trend-card`, `goals-progress-card`, `ai-weekly-volume-card`, `activity-history-card`) so sibling state changes don't re-render them.

## B3 — `next/image` migration

~15 raw `<img>` tags bypass the AVIF/WebP + lazy-load already configured in `next.config.ts`. Convert (provide explicit width/height):
`components/admin/exercise-manager.tsx`, `components/more/profile-tab.tsx`, `components/nutrition/capture-step.tsx`, `components/workout/warmup-screen.tsx`, `components/workout/exercise-stats-sheet.tsx`, plus friend/profile avatars. Note: exercise GIFs may need `unoptimized` if served from an external mirror — verify the domain is in `next.config.ts` `images.remotePatterns`.

## B4 — Dynamic imports for heavy modal/sheet content

Extend the `next/dynamic` pattern already used in `health-content.tsx` (lines 9–80), each with a skeleton fallback and `ssr: false`:
- `components/chat.tsx` — ChartMessage / Markdown renderer.
- `components/workout-builder/builder-review.tsx` — `WeeklyMuscleSetsCard`.
- `components/workout/active-workout-screen.tsx` — `MuscleHeatmap`.
- `components/config-screen.tsx` — editor sheets loaded upfront.

## B5 — List virtualization

Long lists render every item. Virtualize (lightweight windowing, or `@dnd-kit` is already present but not a virtualizer — prefer a small `react-window`-style approach) for lists that can exceed ~20 rows:
`components/health/activity-history-card.tsx`, `components/stats/program-exercise-list.tsx`, `components/nutrition/saved-meals-sheet.tsx`, `components/exercise-history-sheet.tsx`.

## B6 — UI polish quick wins

- **Touch targets <44px** on the curved-edge S25 display: `components/workout/set-card.tsx` voice button (`h-3.5 w-3.5`) and similar — bump to `min-h-[44px]` / larger hit area.
- **Missing states:** loading skeletons / empty / error on data-fetching cards. Several `.catch(() => {})` swallow errors silently (nutrition sheets, some health cards) — surface a toast on failure.
- **Accessibility:** aria-labels on icon-only buttons; raise contrast on low-opacity toggle text (`strength-progress-card.tsx` mode toggle at 40% opacity); `autoFocus` first input when sheets open.

## Verification

Per batch: `pnpm exec tsc --noEmit` + `pnpm exec eslint`, then `pnpm dev` and exercise the affected screen for no regression in the same flow. For B1/B2, spot-check re-render reduction with React DevTools Profiler (expand a day in the health overlay; confirm only that row re-renders). For B3, confirm images still load and are served as AVIF/WebP (Network tab). Target device viewport: Samsung Galaxy S25 Ultra.

## Sequencing

B1 + B2 first (biggest perceived-perf win; B1 health-content overlaps CB-4). Then B3 → B4 → B5 → B6 as independent batches, each its own commit.
