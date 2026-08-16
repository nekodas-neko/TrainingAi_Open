# 2026-07-20 — W4: dead-route / dead-field cleanup (wiring/caching-perf audit §5, partial)

**Branch:** `fix/dead-route-field-cleanup` · **Version:** 1.184.2 (leaderboard streak is user-visible)

Fourth audit-batch item. Shipped the high-value + unambiguous subset (5 of 8); deferred 3 that are
UI/product judgment calls or need more tracing.

## Shipped

1. **Leaderboard "Streak" tab now shows real streaks (the user-visible bug).**
   `app/api/friends/leaderboard/route.ts` hardcoded `weeklyStreak`/`allTimeStreak` to `0`. Now a
   batched distinct-trained-days query (per user, exercise-logged days in the user's tz, matching
   `getRecentTrainedDays`) feeds the canonical One-Formula helpers: `longestWeeklyStreak(days)` →
   `weeklyStreak`, `computeStreak(days, tz, 1).best` → `allTimeStreak` (exported `computeStreak`
   from `lib/achievements.ts` rather than writing a second streak implementation).
2. **Deleted dead `app/api/sync-workout/route.ts`** (0 callers across app/components/lib/android;
   `sync/push`'s `workout_log` domain supersedes it) + fixed the 3 `docs/module-map.md` references.
4. **Deleted orphaned `app/api/program-phases/route.ts`** (every caller uses
   `repo.listProgramPhases()` directly; 0 client callers).
6. **Dropped 3 never-read readiness fields** — `ownReadinessContributors`/`recoveryIndexHours`/
   `baselineNights` were produced by `readiness-score` and only nulled by a client placeholder.
8. **Dropped dead workout-review `.phase`** response field + its `ReviewResponse` type entry.

## Deferred (annotated in the backlog W4 row)

- **(3) `running-plan/explain`** — a working Gemini-narration route that's never fetched. Wire (an
  extra AI call per running-plan view + device-gated UI) vs delete built value is a product call.
- **(5) `AiPrescription.weeklyVolumeContribution`** — computed+persisted, never rendered. The plan
  prefers *surfacing* it (a device-gated per-muscle delta card), and dropping it touches the
  sensitive prescribe route. Left for a focused pass.
- **(7) exercise-history `sessionName`/`isDeload`** — the plan called both dead, but `sessionName`
  IS referenced (`exercise-history-sheet.tsx:44`), so a drop needs careful state tracing first.

## Verification

- tsc + lint clean (0 errors). Achievements / readiness-composite / workout unit tests green (90);
  production build green (validates the two route deletions). Server/JS + UI only — no device gate.
