## 2026-07-21 — Collapsible ACWR + Sleep-vs-Performance cards (v1.189.1)

**Branch:** `feat/health-info-cards-collapsible` — item #8 of the owner's Health/Training/Workout
UX batch (`docs/superpowers/plans/2026-07-21-health-training-ux-batch.md`).

The Body-tab "Training Load (ACWR)" and "Sleep vs Performance" cards were always fully expanded and
each ate a full screen. Extracted both into components with a collapse toggle (collapsed by default,
chevron, `aria-expanded`), keeping the accent-gradient card styling:

- `components/health/training-load-card.tsx` — collapsed shows the ACWR number + zone; expands to
  monotony/strain, the `TrainingStressLine` chart, and the explainer.
- `components/health/sleep-vs-performance-card.tsx` — collapsed shows the one-line insight; expands
  to a **bar chart** of the per-sleep-bucket %-change (diverging around zero, brand = above baseline
  / red = below) replacing the old flat number tiles, plus the explainer.

`health-sections.tsx` now renders these components instead of the inline JSX (removing the orphaned
`TrainingStressLine` + four lucide icon imports), trimming the hotspot file.

### Verification

- `pnpm exec tsc --noEmit`, `pnpm lint` (0 new errors), `pnpm test` (1793 passed) — green.
- `pnpm dev`, authed as `test@local.dev`: `/health` renders HTTP 200; `/api/training-load` and
  `/api/sleep-performance-correlation` both 200.

### NOT exercised

- No pixel/screenshot (Playwright not installed). Collapse/expand interaction and the bar-chart
  rendering are confirmed as compile + HTTP 200, not visually — verify on the S25.
- Branched off `main` (v1.188.1) in parallel with other unmerged batch branches; bumped v1.189.1.
  Expect a version re-bump on rebase depending on merge order.
