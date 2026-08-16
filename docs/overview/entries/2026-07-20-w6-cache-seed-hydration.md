# 2026-07-20 — W6: cache-seed hydration fixes (wiring/caching-perf audit §2.2–2.4)

**Branch:** `fix/cache-seed-hydration-batch` · **Version:** 1.184.4

Sixth audit-batch item — the banned "seed state in a `useState` lazy initializer" pattern (cache
reads in initializers caused hydration mismatches, session 165) plus an achievements spinner flash.

## What landed

- **friend-leaderboard.tsx / friend-feed.tsx** — replaced `useState(() => readCacheSync(...))` with
  empty initial state + a `useLayoutEffect` that seeds synchronously before paint (the reference
  pattern in `nutrition-content.tsx`), setting `loading=false` on a cache hit.
- **health/heart-rate/page.tsx** — same fix for `hrReadings`/`sleepWindow` only; `data`/`trends`
  were already correctly seeded in the `loadReadiness` callback (left untouched).
- **profile-tab.tsx** — the achievements `readCacheSync` seed ran in a plain `useEffect`, so
  `AchievementsSection` flashed its `Loader2` for one frame even with a warm cache. Moved to
  `useLayoutEffect` so the seed lands before first paint (async fetches unchanged).

## Deferred

- **§2.4 builder-review `key={index}`** — the review-state exercises carry no stable id (one is
  minted only at save time via `crypto.randomUUID()`), so a correct key would require minting
  client ids upstream when the review session is built — out of scope for this mechanical batch, and
  the plan rates it LOW ("no uncontrolled per-row input state", fix opportunistically). Left as-is,
  annotated in the backlog W6 row.

## Verification

- tsc + lint clean (0 errors). Production build green. Pure client render polish — no server logic,
  no device-only behavior; web-sandbox verification is sufficient (per the plan).
