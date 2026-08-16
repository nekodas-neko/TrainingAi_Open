# Fix: cache-seed hydration-mismatch pattern + achievements spinner flash + index-key list

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §2.2–2.4. Branch:
`fix/cache-seed-hydration-batch`.

## Problem

Three components seed state by reading the cache inside a `useState` lazy initializer — the
pattern CLAUDE.md explicitly bans ("cache reads in initializers caused React hydration
mismatches, session 165"). A fourth component (achievements) seeds correctly but inside a plain
`useEffect` instead of `useLayoutEffect`, so it shows a one-frame spinner even with a warm cache —
defeating instant paint. A fifth, low-severity finding: a reorderable list keyed by array index.

## Root cause

- `components/more/friend-leaderboard.tsx:33-35` —
  `useState<LeaderboardEntry[]>(() => readCacheSync(...)?.entries ?? [])`
- `components/more/friend-feed.tsx:59-61` —
  `useState<FeedEvent[]>(() => readCacheSync(...)?.events ?? [])`
- `app/health/heart-rate/page.tsx:24-29` — `hrReadings`/`sleepWindow` seeded the same way (the
  `data`/`trends` fields in the same file are correctly seeded inside a callback — this fix is
  scoped to just the two wrong fields).
- `components/more/profile-tab.tsx:101,205` + `components/more/achievements-section.tsx:41-44` —
  `achievementsLoading` defaults `true`, cache read happens in a plain `useEffect`, so the
  `Loader2` spinner renders for a frame before the effect runs, even when `readCacheSync` would
  have returned data synchronously.
- `components/workout-builder/builder-review.tsx:504` — `session.exercises.map((ex, ei) => ...)`
  keyed by `ei` while `moveExercise`/`swapExercise` (`:559,568,596`) reorder rows in place.

## Fix

1. In `friend-leaderboard.tsx` and `friend-feed.tsx`: switch to empty initial state
   (`useState<T[]>([])`) + a `useLayoutEffect` that calls `readCacheSync` and sets state
   synchronously before paint — the reference pattern already used correctly in
   `app/nutrition/nutrition-content.tsx:95-114` and `components/config-screen.tsx:100-109`.
2. In `app/health/heart-rate/page.tsx`: apply the same fix to just the `hrReadings`/`sleepWindow`
   initializers (leave `data`/`trends` untouched — already correct).
3. In `profile-tab.tsx`/`achievements-section.tsx`: move the achievements `readCacheSync` call from
   its current `useEffect` into a `useLayoutEffect`, matching the reference pattern, so a warm
   cache paints synchronously with no spinner frame.
4. In `builder-review.tsx`: replace `key={ei}` with a stable key derived from the exercise's own
   identity (`ex.exerciseId` or a client-minted id if exercises can repeat in a session — check
   for duplicates before choosing the key source).

## Files touched

- `components/more/friend-leaderboard.tsx`
- `components/more/friend-feed.tsx`
- `app/health/heart-rate/page.tsx`
- `components/more/profile-tab.tsx`, `components/more/achievements-section.tsx`
- `components/workout-builder/builder-review.tsx`

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: visit the More tab (friends leaderboard, friend feed, achievements) and the Heart
  Rate page with a warm cache (second visit) — confirm no skeleton/spinner flash, and no React
  hydration-mismatch warnings in the console on first load.
- `pnpm dev`: in the workout builder, reorder/swap exercises in a session that has two entries of
  the same exercise (if custom exercises can repeat) — confirm no row's typed/local UI state
  bleeds into an adjacent row after reordering.
- No device-only behavior; web sandbox verification is sufficient for these fixes.

## Rollback

Each site is an independent, small, mechanical change — revert per-file if any regression
surfaces (e.g. a `useLayoutEffect` firing before a dependency is ready).
