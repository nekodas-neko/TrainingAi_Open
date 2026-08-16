# B6 — Data-store follow-up fixes

> Source: `docs/planned_upgrades.md` § B6 (session-178 audit, verified post-#99). Three PR-sized chunks, in order — chunk 1 is the user-visible one. Every item has file:line detail in the B6 section; this plan adds sequencing, shared design decisions, and verification. Re-grep anchors before editing.

## Chunk 1 — Invalidation & cache-layer semantics (one PR)

1. **`invalidateNutritionWrite()` group** in `lib/cache-groups.ts` covering `nutrition-food-logs-<date>` (today's date key), `nutrition-weekly-summary`, `body-metadata`; call it from `lib/nutrition/log-food.ts` (both branches) and `log-meal.ts`. Mirror what the delete path in `nutrition-content.tsx` invalidates so the two lists can't drift — the group is now the single list, so delete/edit call sites switch to the group too.
2. **Date-guard the six date-less "today" keys** (`readiness-score`, `body-battery`, `training-load`, `weekly-stats`, `progress-summary`, `health-trends`). Decision: apply the existing `body-metadata` seed-guard pattern (drop a non-today seed at read) rather than renaming keys — renaming would require legacy-key cleanup at every seed site per the CLAUDE.md rule, a bigger diff for the same effect. Implement the guard once as a helper (`readTodayCacheSync(key)` storing `{date, data}`) and convert the six keys' seed+write sites.
3. **One canonical TTL per key.** Create `lib/cache-ttl.ts` exporting `TTL_FOR: Record<key, ms>` (or per-key constants) and fix the divergent sites: `readiness-score` (SHORT vs MEDIUM vs LONG today), `muscle-recovery` (MEDIUM vs LONG). Coordinate with B5 bundle-splits Task 7 (TTL constants moving out of `sync-provider`) — if that shipped first, extend its module; do not create a second home.
4. **Fan out in-flight dedup results.** `cachedFetch` (`lib/sqlite/cache.ts:160-167`): keep a per-key list of awaiting `onData` callbacks; on resolve, invoke all. Add a unit test: two concurrent `cachedFetch` calls on a cold key → both callbacks receive the payload.

**Verify:** `pnpm dev` → log a meal → home calorie/macro tiles and nutrition weekly chart update without waiting on TTL; simulate next-day open (set device clock or temporarily shrink the guard) → no yesterday readiness/battery seed.

## Chunk 2 — Server-side read efficiency (one PR)

5. **`exercise-history` filters in SQL.** New repo method mirroring `getLastExerciseLogsBatch` (`adapter.ts:1068`): `WHERE exercise_name = ? ORDER BY logged_at DESC LIMIT 20` against the existing `idx_el_name_date_ws` index; route drops the 90-day tree build.
6. **`muscle-recovery` stops loading the full library.** Add `listExerciseMuscleMap()` (name + muscles only) plus a module-scope memo with a modest TTL (the library is global/near-static; invalidate on the admin exercise-edit path).
7. **`admin/pending-count`** becomes `SELECT COUNT(*) … WHERE is_active = false`, and the three bare-fetch call sites (`bottom-nav`, `profile-tab`, `session-select`) share one `cachedFetch('admin-pending-count')` gated on `isAdmin`.
8. **SWR headers on the 12 listed routes** (`exercise-history`, `health/trends`, `weekly-muscle-sets`, `strength-trend`, `sleep-performance-correlation`, `workout-sessions/day`, `oura/hr-day`, `injuries`, `supplements`, `program-week`, `user/goals`, `seasons`) — same recipe as PR #99; `body-battery` gets `max-age=15` or none.
9. **`workout-sessions/day`** returns its 3 summary fields from a session-columns-only query instead of hydrating full set trees.

**Verify:** each route returns identical JSON before/after (curl-diff against the local DB); time `exercise-history` and `muscle-recovery` before/after and note the delta in the PR.

## Chunk 3 — Redundant fetches + sync backoff (one PR)

10. **Consolidate home's overlapping fetch effects** — the five keys fetched in both `refetchAll` and standalone mount effects fire once. Do this *after* the B5 render-fixes home work if both are pending, so the diffs don't fight.
11. **Route the stragglers through the cache**: `overview-screen.tsx` "Train" tap (`workout-card:<id>`), `done-activity-screen.tsx` profile fetch (`more-user-profile`), `friends-tab.tsx` seed, and `sync-provider`'s reminder reconcilers (`meal-types`, `food-logs`, `next-session` — copy the supplements reconciler's shape at `:212`).
12. **Pull-failure backoff**: failing `pullPage` sets a short `pullBackoffUntil` mirroring `push5xxUntil` (`sync-engine.ts`), so a dead network doesn't retry the pull on every mount trigger.
13. *(Optional, same PR if trivial)* Scope post-sync invalidation to domains present in the delta instead of the full ~24-prefix `invalidateWorkoutSummaries` storm.

**Verify:** DevTools network on home mount — each endpoint fetched exactly once; airplane-mode open → one pull attempt then backoff, not one per navigation.

## Wrap-up (per chunk)

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; chunk-specific manual passes above on `pnpm dev` against the local DB.
- Not exercisable in sandbox: native SQLite cache layer (web fallback only), on-device timing.
- Version: patch bump + changelog per shipped chunk; tick the B6 bullets in `planned_upgrades.md` as each lands.
