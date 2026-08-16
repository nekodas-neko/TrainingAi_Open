# Batch O Phase 1 — Post-session recap · Rest-day guidance · Body measurements

**Branch:** `feat/batch-o-phase-1` · **One PR** (three independent features; tasks ordered so a partial PR is still coherent). Selected from the 2026-07-03 review's Batch O candidates as the three with the best value-per-effort on data that already exists. **Not planned** (remain candidates in `planned_upgrades.md`): progress photos, warm-up customization, voice logging, mesocycle retrospective.

**Migration claim: 110** (`110_body_measurements.sql`, Task 3). 107/108/109 are claimed by Batch I / time-model / Batch N — verify against directory + plans before applying.

Key current-state facts (verified 2026-07-03):
- Done screen order: success header → phase banner → PR card → XP card → stats grid → **session-RPE card (F3)** → HR recovery card → actions. Insight caching pattern to copy: `session-explain/insight` → `repo.getAiHealthInsight`/`upsertAiHealthInsight` keyed `section` + date (`ai_health_insights`, migration 097).
- Rest day writes nothing (`/api/log-rest-day` is a no-op signal); it's a client-side overlay in `session-select-content.tsx` (~252–271, `handleRestDay` ~1016). `readiness-score` response already carries `score`, `recommendedBedtimeStart/End`, `stressHigh/recoveryHigh`; `muscle-recovery` is a warmed cache key.
- `body_metrics` has **no** circumference fields; it is a fully-synced local domain (delta + applyDelta + `RECONCILE_COLUMNS` all wired), and additive local columns ship via `RECONCILE_COLUMNS` alone (Batch F pattern — no version bump). Manual weight/body-fat logging lives inline in `components/overview-screen.tsx` (`WIDGET_DEFS` + log sheet → `POST /api/body-metadata`).

---

## Task 1 — Post-session AI recap (done screen)

**Shape:** deterministic stats in code, one short LLM narrative, cached forever per session.

1. `lib/workout/session-recap.ts` (TDD, pure): `buildRecapFacts(session, setLogs, recentSessions)` → `{ durationMin, durationVsMedianPct, totalVolumeKg, prCount, rpeDrift (first-set vs last-set RPE delta per exercise, averaged), restAdherencePct (reuse lib/workout/rest-adherence.ts), sessionRpe }`. No LLM numbers — every figure computed here.
2. `GET /api/workout-sessions/[id]/recap`: auth + ownership; cache key `section = 'session-recap:' + sessionId` via `getAiHealthInsight` (date = session date; cache hit skips the rate limit, mirroring `session-explain`); on miss `rateLimit` 20/hr, build facts via `getWorkoutSessionById` + `getSetLogsForSessions([id])` + `getRecentSessionsOfType`, then one `generateText` call (gemini-3.1-flash-lite, `withAiRetry`) with the facts pre-formatted as labeled lines (contributors pattern) and a ≤3-sentence instruction: what stood out, one thing to watch next session. Persist via `upsertAiHealthInsight`. Standard SWR header.
3. Done-screen card after the RPE card: a "Session recap" card with a one-tap **Generate** button (never auto-fires — the user is leaving this screen; CLAUDE.md forbids blocking round-trips here). Once generated it renders the cached text instantly on any revisit (also fetchable later from the same endpoint).

**Verify:** dev server — complete a seeded workout, tap Generate, recap renders and a second load hits the cache (no rate-limit consumption); unit tests cover `buildRecapFacts` incl. missing-RPE/missing-rest rows.

## Task 2 — Rest-day active-recovery guidance (deterministic, no LLM)

1. `lib/health/rest-day-guidance.ts` (TDD, pure): `restDayGuidance({ readinessScore, soreMuscles, sleepScore, consecutiveRestDays })` → one of three bands with title/body/suggestions: **≥75 & no soreness** → "Recovered — optional light zone-2 (30–45 min) or mobility work"; **60–74 or localized soreness** → "Partial recovery — easy walk + mobility for <sore muscles>"; **<60** → "Rest fully — prioritize sleep" (+ surface the existing `recommendedBedtimeStart` when present). Null-safe: with no readiness data, return the neutral middle band flagged `lowConfidence`.
2. `components/rest-day-card.tsx` rendered in `session-select-content.tsx` **only** when the day is a rest day (the existing `isRestDay` overlay or a schedule rest day) — extract, don't inline; the orchestrator is over budget at 1598 lines. Reads the already-warmed `readiness-score` + `muscle-recovery` + `mood` cache keys via `readCacheSync` seed + `cachedFetch` (reuse existing keys and their canonical TTLs — no new fetches on non-rest days). Lucide icons, theme tokens, no hex.

**Verify:** unit tests for all three bands + null input; dev server — mark today a rest day, confirm the card renders the band matching the seeded readiness; confirm zero extra network requests on a training day.

## Task 3 — Body measurements (waist/chest/arm/thigh/hip/neck)

**Decision:** extend `body_metrics` (already synced end-to-end) rather than a new domain — measurements are sparse per-date numerics exactly like weight/body-fat. Photos are explicitly out of scope for phase 1.

1. **Migration 110:** `ALTER TABLE body_metrics ADD COLUMN` × 6: `waist_cm, chest_cm, arm_cm, thigh_cm, hip_cm, neck_cm` (numeric, nullable).
2. **Full-chain wiring in the same commit** (CLAUDE.md sync rule — every link or the field silently vanishes): Drizzle schema + every `rowToBodyMetrics`-style mapper/SELECT list; `BodyMetadataPostSchema` (+ sane clamps, e.g. 10–300 cm, in `lib/validation/body-metrics.ts`); `upsertBodyMetrics` COALESCE columns; `getSyncDelta` output; `pullDelta` mapping; `applyDelta` upsert columns; local SQLite columns via `RECONCILE_COLUMNS` (additive — no version bump, Batch F pattern); the `pushMutations` `body_metrics` branch. Diff the web route vs `pushMutations` as part of review.
3. **UI:** add the six fields to `WIDGET_DEFS` in `overview-screen.tsx` (unit `cm`) behind a "Measurements" group so the widget grid isn't flooded — follow however `WIDGET_DEFS` grouping/visibility already works (user-toggleable widgets); reuse the existing log sheet unchanged (it already POSTs `{ localDate, [key]: value }`). Trend rendering comes free if the widgets use the shared `<Sparkline>`.

**Verify:** log a waist measurement on the dev server → row lands in Postgres with the value; GET returns it; unit test the clamp; sync chain spot-check = push a `body_metrics` mutation containing `waistCm` through `pushMutations` and confirm parity with the web route (feeds Batch N Task 3.2's suite). ⚠️ On-device: local-store round-trip for the new columns (native SQLite not exercisable in-sandbox).

---

**Done when:** all three tasks verified, tests/lint/tsc green, dev-server pass complete, version bump (minor — user-visible features) + changelog entry, queue entry removed in the same PR. State the standard unexercised surfaces (native SQLite, Samsung WebView, live Gemini narrative quality) in the PR.
