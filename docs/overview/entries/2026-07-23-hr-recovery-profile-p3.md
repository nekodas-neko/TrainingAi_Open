## 2026-07-23 — HR Recovery Profile, Phase 3 — trend + AI tool (v1.205.0)

**Branch:** `feat/hr-recovery-trend-ai` — final phase of the backlog item, closing out the spec
(`docs/superpowers/plans/2026-07-22-hr-recovery-profile.md`) started earlier the same session.

### What shipped
- **`lib/health/hr-recovery-trend.ts`** — `aggregateHrRecoveryTrend(episodes, tz)`: rolls episodes up
  to one median recovery-rate point per (peak-HR band, local calendar month), oldest first. Uses the
  session's timezone (`formatInTimeZone`, not UTC) so a late-night episode lands in the correct local
  month. The low-signal `<110` band is always excluded — a noise trend isn't worth showing.
- **`lib/health/compute-hr-recovery-profile.ts`** — extracted the fetch-set-rows + fetch-workouts +
  detect-cooldown-episodes + aggregate orchestration (previously inline in the route) into
  `computeHrRecoveryProfile(repo, userId, tz, days)`, returning both the current-snapshot `profile`
  and the new `trend`. The route is now a thin wrapper; the new `getHrRecoveryProfile` AI-chat tool
  calls the exact same function — one path, so the two surfaces can never drift (mirrors the
  `computeWorkoutHr` shared-compute precedent).
- **`getHrRecoveryProfile`** chat tool (`lib/ai-chat/tools.ts`) — returns `{bands, totalEpisodes,
  trend}`. Description explicitly differentiates it from the existing `getWorkoutHrTrends` (per-lift
  comparison) — this tool is for effort-LEVEL comparisons regardless of what caused it ("how does my
  recovery from 150bpm compare to 180bpm", "is my cardio fitness improving"). System-prompt nudge
  updated to mention it alongside the per-exercise tool.
- **Card**: gained a "Recovery rate over time" section — one sparkline per band with ≥2 months of
  trend data, using the shared cyan accent + existing card conventions.

### Verification
- `tsc` + `eslint` clean. Full suite: **295 files / 2032 tests passing** (9 new: trend aggregator
  incl. local-vs-UTC month boundary, low-signal exclusion, empty/no-rate skip; orchestration function
  with a stubbed repo covering both episode sources; the AI tool).
- **Live dev-server pass** with real inserted multi-month data: `GET /api/health/hr-recovery-profile`
  correctly returned a 2-point trend for the `170+` band (June median 19 bpm/min → July median 13.3).
  **Playwright screenshot** confirms the card renders the trend sparkline with the correct downward
  slope matching the underlying numbers. Test data cleaned from the local dev DB afterward.
- Not device-verified — standing gate, no new risk class (read-only, no schema change). The AI tool's
  live `/api/ai-chat` path wasn't exercised (no Gemini key in this sandbox) — covered by the stubbed
  unit test instead, same caveat as the original `getWorkoutHrTrends` tool.

### Backlog status
All three phases of the HR Recovery Profile spec are now shipped. Only **HRP-2b** (within-run
interval-rep detection — deliberately deferred in Phase 2 as out of scope) remains open in
`docs/implementation-backlog.md`.
