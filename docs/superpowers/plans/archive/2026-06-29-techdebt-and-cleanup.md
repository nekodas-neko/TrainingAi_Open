# Tech Debt, Correctness & Docs (Track C)

Status: PLANNED · Created 2026-06-29 · Branch: feature branch (code), this doc → `main`

## Context

The backlog in `projectOverview.md` had drifted from reality — several "remaining" items are already shipped. This track re-baselines, clears tech debt, and ships a few small features. C1 + C2 are doc-only (commit straight to `main` per CLAUDE.md); C3 + C4 are code (feature branch).

## C1 — Re-baseline the overview (do first)

The "What's Left To Do" list lists work that's already done. Correct it:

- **Phase 10 (nav restructure + friends)** — listed "NOT started, ~24 tasks", but shipped: 5-tab nav (`components/shell/bottom-nav.tsx`), routes `/workout`, `/nutrition`, `/more`; friends API (`app/api/friends/route.ts`, `app/api/friends/[id]`, `app/api/friends/feed`, `app/api/friends/leaderboard`), `app/api/profile/[userId]`, `app/api/seasons`; `lib/data/postgres/slices/social.ts` (friend CRUD + seasons); `friendships`/`seasons` tables, `friendCode`/`equippedTitle` columns. **Action:** verify the friends UI (request/accept/feed/leaderboard, public profile, equippable title) is wired end-to-end on local dev, then tick Phase 10 ✅. Only the spec's deferred items (push-notification friend digest, activity-logging placeholder) may remain.
- **Phase 0.7 (AI SDK CVE)** — overview claims v2.x installed / lockfile out of sync, but `package.json` is `@ai-sdk/google@^3.0.86` / `@ai-sdk/react@^3.0.216` and the lock resolves `provider-utils@4.0.33` — no mismatch. **Action:** run `pnpm audit`; if clean, close the item.
- **Oura "unused fields"** — `sedentaryTimeSec`, `nonWearTimeSec`, `temperatureDeviation`, `vo2Max`, `resilienceLevel` etc. are already synced into `oura_daily`. The real gap is **UI surfacing** (C5), not sync. Re-word the item.

## C2 — `projectOverview.md` refactor ✅ DONE (this session)

Split the 497 KB / 5,423-line append-only journal into:
- `projectOverview.md` — lean index (current status, Known Issues & Risks, What's Left, Document Map).
- `docs/overview/history-recent.md` (Sessions ~105–154 + roadmap/version tables), `history-past.md` (~51–104), `history-early.md` (~1–50 + legacy architecture appendix).
- CLAUDE.md session start/end instructions updated to point at the lean index + history files.

## C3 — Repository-bypass cleanup

~12 `app/api/` routes import `lib/data/postgres/` directly instead of `getRepository()`. Prioritise the two that affect correctness/sync:
- **`app/api/log-exercise/route.ts`** — drop the `PostgresWorkoutRepository` cast (lands with Track A1).
- **`app/api/nutrition/food-logs/route.ts`** — uses `getPool` directly; route through the repository interface.
Lower priority (admin / read-only analytics), migrate opportunistically: `app/api/strength-trend`, `app/api/weekly-muscle-sets`, `app/api/program-week`, `app/api/profile/[userId]`, `app/api/friends/feed`, `app/api/friends/leaderboard`, `app/api/push/subscribe`, admin exercise-media routes.

## C4 — Exercise FK Phase B (migration 100)

Migration 099 added nullable `exercise_id` FK to `session_exercises` / `exercise_logs` / `personal_records` / `exercise_media`, backfilled by **exact case-sensitive** name match. Phase B adds `NOT NULL`.

**Gate on a null check first** — exact matching may have left rows unmatched (deleted exercises, casing/typo variants, custom exercises not in the library):
```sql
SELECT 'session_exercises' t, COUNT(*) FROM session_exercises WHERE exercise_id IS NULL
UNION ALL SELECT 'exercise_logs', COUNT(*) FROM exercise_logs WHERE exercise_id IS NULL
UNION ALL SELECT 'personal_records', COUNT(*) FROM personal_records WHERE exercise_id IS NULL
UNION ALL SELECT 'exercise_media', COUNT(*) FROM exercise_media WHERE exercise_id IS NULL;
```
Reconcile stragglers (case-insensitive re-match, or accept `SET NULL` for the orphans and DO NOT enforce NOT NULL on those tables). Only then `ALTER COLUMN ... SET NOT NULL` in **migration 100**. Verify against production data before enforcing — `ON DELETE SET NULL` means a deleted library row would violate NOT NULL, so confirm the admin delete path nulls safely or is blocked.

## C5 — Small features (after Tracks A/B)

- **Oura field surfacing** — UI cards for already-synced sedentary/non-wear time, temperature deviation, resilience, VO2 max in Health › Body (`components/health/oura-section.tsx`); write `daily_activity.steps` → `body_metrics.steps` in `app/api/oura/sync/route.ts`. Low effort (data already in DB).
- **Body Battery** — energy tank from `oura_heartrate` + `workout_sessions` + `sleep_sessions` + `body_metrics.hrv_ms`: opens at readiness score, drains on elevated HR/workouts, charges during sleep/rest. New migration + sync computation + a compact line-chart card on Home/Health. Medium effort; fully specced in the overview.
- **AI periodization Tier 5** — in `lib/ai-periodization/`: accumulation ceiling (hard cap at 8 `sessionsInPhase` forcing `transition_recommended`), auto-advance from deload after 2 sessions, exercise-swap suggestions (the `session_swap_recommended` action exists but lacks UI/logic).

## Verification

- C1/C2: doc-only, no runtime. Confirm `projectOverview.md` < 256 KB and all history files openable (done).
- C3: `pnpm dev`, hit each converted route, confirm identical responses to before.
- C4: run the null-count query against local Postgres (`pnpm db:local`), apply migration via `ensureSchema` cold start, confirm it applies cleanly and no insert path breaks. Do not enforce on production until the null count is 0 there.
- C5: per-feature `pnpm dev` smoke test on the affected screen.

## Sequencing

C1 + C2 first (fast, doc-only — clears noise). C3's `log-exercise` part lands with A1; food-logs part standalone. C4 after a production null-count check. C5 as capacity allows.
