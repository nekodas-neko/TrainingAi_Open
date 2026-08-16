## 2026-07-21 — Readiness detail enrichment + owner UX batch plan (v1.188.0)

**Branch:** `claude/readiness-tab-scoring-details-ncjeyp`

Owner walked the app on-device (S25) and filed **14 UI/detail/bug items** across Health, Training,
Progress, Workout, Nutrition and More, with screenshots. This session (a) wrote the master plan for
all 14, (b) queued the 13 not-built-here as backlog PRs, and (c) implemented item #1 (Readiness).

### Planning (docs)

- **`docs/superpowers/plans/2026-07-21-health-training-ux-batch.md`** — one section per item, each
  self-contained enough to be its own PR: current state (file:line-verified via six parallel research
  sweeps), target, files, device gate, and open questions. Owner decisions captured up front: #5 uses a
  **goal-based energy-budget ring**; #14 is a **3-card workout screen** (Workout large / Run large /
  Activity small), not tabs.
- **`docs/implementation-backlog.md`** — a "Health/Training/Workout UX batch" block at the top of the
  Queue with a per-item table (branch, scope, gate), ordered quick web-verifiable fixes first
  (#12 nutrition bucket, #13 More cache-seed, #11a reorder, #10b avg-duration) then device-gated /
  net-new work (#4/#5/#7/#9/#14).

Notable research corrections vs the owner's hypotheses: the avg-duration undercount (#10b) is **not** a
÷7 bug — duration is measured as the first→last logged-set span, which excludes warm-up/final rest; the
nutrition bucket bug (#12) is specifically the **saved-meals** `quickLog` path (`preselectedMealTypeId`
never forwarded to `SavedMealsSheet`), not the regular add-food path (already guarded); the detail-screen
back button (#2) exists but its fallback is hard-coded to `/health` while the pills open from **Home**;
and the score pills + Body Battery live on the **Home/session-select** screen, not the Health tab.

### Shipped — Item #1: Readiness detail (v1.188.0, user-visible)

The Readiness screen previously showed a dial + flat contributor bars + one sparkline, with no
explanation of how the score is built. Added, readiness-only (Sleep/Activity detail unchanged), via
new optional props on the shared `HealthScoreDetail`:

- **`components/health/readiness-breakdown.tsx`** (new, shared) — "how this score is built": the
  Oura-path formula (base → training-load/ACWR adj → body-temp penalty → final) OR, on the composite
  path (Oura Cloud score frozen post-BLE-re-key), the weighted factors the app's own composite is built
  from (`READINESS_WEIGHTS`, sorted by weight). The Home `readiness-card` keeps its own compact inline
  breakdown — the two contexts differ enough that this is presentation, not a shared formula.
- **`components/health/contributor-chart.tsx`** (new) — a labelled, band-coloured contributor graph
  (human labels via the now-exported `labelFor`), sorted weakest-first, with a neutral-50 reference line
  and a band legend. Replaces the flat bars on readiness only. Pure HTML/CSS (no canvas → theme-safe).
- **Average context chip** — today's readiness vs the trailing 14-day average (from `/api/health/trends`),
  shown under the score. Degrades to nothing when there's <2 days of history.
- `HealthScoreDetail` gained `breakdown` / `contributorChart` / `averageContext` optional props; wired
  on in `app/health/readiness/readiness-content.tsx`. `lib/oura/contributors.ts` `labelFor` exported.

### Verification

- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1793 passed) — all green.
- `pnpm dev` against the local seed, authenticated as `test@local.dev`, both score paths exercised by
  seeding `oura_daily`:
  - **Oura path** (`source: oura+acwr`, score 70): `/health/readiness` HTTP 200; API returns
    `ouraScore` + 8 contributors + a 14-day trend series; average-chip math confirmed "−12 vs 13-day
    average (82)".
  - **Composite path** (`source: custom`, `ouraScore: null`): HTTP 200; composite weights breakdown
    renders; contributor chart + average chip correctly render nothing (no fake data) when contributors
    and trend history are absent.

### NOT exercised / caveats

- **No pixel-level visual check** — Playwright isn't installed in this sandbox (installing it would touch
  the lockfile), so verification is server-render (HTTP 200 on both paths) + API-shape + client-logic
  math, not a screenshot. The change is presentational content under the existing `DetailHero` (which
  already owns `pt-safe`), with no new bottom-anchored controls, so there's no new safe-area surface — but
  the `DetailHero` hero art and final contributor-graph appearance are only truly confirmable on-device.
- Local seed has no Oura data by default; the Oura path was exercised only after manually seeding
  `oura_daily` rows into the local dev DB (not committed).
