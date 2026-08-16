## 2026-07-21 — Body-tab muscle hero + Training stats merge (v1.189.0)

**Branch:** `feat/body-muscle-hero-and-stats-merge` — items #9b and #10a of the owner's
Health/Training/Workout UX batch (`docs/superpowers/plans/2026-07-21-health-training-ux-batch.md`).

- **#9b muscle hero** — the Body tab previously rendered no muscle card. Added
  `components/health/body-muscle-card.tsx`: a compact front/back `MuscleHeatmap` (volume-tinted
  from this week's `weekly-muscle-sets`) + the live `MuscleRecoveryCard` strip, with a top-worked
  summary and a fade-in. Pinned as the **first** Body-tab card by rendering it explicitly at the
  top of the body panel (outside the reorderable `BODY_GROUPS`), rather than adding it to the card
  order — the saved-order helper appends new keys at the *end*, so a group entry wouldn't have put
  it first for existing users (and would have collided with the parallel quick-wins branch's edit
  to `health-card-order.ts`). Hideable via the existing `hiddenCards` gate. New `muscleMap` case in
  `renderBodySection`.
- **#10a training-load + stats merge** — `WeeklyStatsHub` rendered two separate stacked cards (the
  per-day load bars, then a 2×2 Sessions/Sets/Volume/Avg-Duration grid). Merged into one card: the
  bars on top, the four headline stats as a divided 4-col footer strip inside the same card, so the
  week reads as a single unit.

### Verification

- `pnpm exec tsc --noEmit`, `pnpm lint` (0 new errors), `pnpm test` (1793 passed) — green.
- `pnpm dev`, authed as `test@local.dev`: `/health` renders HTTP 200; `/api/weekly-muscle-sets`
  returns worked muscles (chest:3, shoulders:1.5, triceps:1.5) so the hero heatmap lights up.

### NOT exercised

- No pixel/screenshot (Playwright not installed). The muscle-map SVG rendering, the fade-in, and
  the merged-card layout are confirmed as compile + HTTP 200 + data-present, not visually — and the
  Samsung WebView SVG-in-card-grid compositor caveat (CLAUDE.md) means the heatmap gradient is only
  truly verifiable on the APK.
- Branched off `main` (v1.188.1) in parallel with unmerged Readiness (#1) and quick-wins branches;
  bumped to v1.189.0. Expect a version re-bump on rebase depending on merge order.
