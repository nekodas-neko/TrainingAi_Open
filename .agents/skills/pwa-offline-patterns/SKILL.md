---
name: pwa-offline-patterns
description: Use this skill when building any screen, sheet, or card that fetches data from an API — choosing a loading/empty/error state, deciding whether a write needs offline queuing, or fixing a screen that's blank/stuck while data loads. Also trigger when the user mentions "offline", "loading state", "skeleton", "sync", "outbox", or reports a screen that flashes empty/old content before showing real data.
---

# Offline-First & Loading-State Patterns

TrainingAI is cache-first and must remain usable with no network (PWA "Add to Home Screen" + the Android APK both need this).

## Reading data — three-tier read order

1. **`readCacheSync<T>(key)`** (sessionStorage mirror, `ta_sscache:*`) — synchronous, used in `useLayoutEffect` to populate state *before first paint*, eliminating the loading flash on in-session navigation
2. **`cachedFetch<T>(key, url, ttl, onData)`** — async, returns cached data immediately (if any) then revalidates from the network
3. **`SyncProvider`** (`components/sync-provider.tsx`) — warms caches on app mount and mirrors hits into sessionStorage via `mirrorToSessionCache` so even a fresh tab benefits from step 1

New data-fetching components should follow this same three-tier order rather than a bare `useEffect(() => fetch(...))`.

## Loading / empty / error / offline states are all different — don't collapse them

| State | Pattern |
|---|---|
| **Loading** (no cache yet) | Skeleton matching the final layout's shape (see `WeatherChip`) — not a spinner-only placeholder |
| **Insufficient data** (fetch succeeded, not enough history) | "Not enough data yet" message (ACWR, Sleep vs Performance pattern, 1.20.7) — not an empty chart |
| **Error** (fetch failed, no usable cache) | Explicit error state with retry, not a blank panel (1.7.2: stats sheet shows error instead of blank sparkline) |
| **Offline** (network unavailable mid-feature, e.g. live activity tracking) | Inline offline message (1.31.0 activity map) — the feature keeps working locally where possible |

## Writes — outbox / sync pattern

Workout set logging queues writes locally and syncs via `/api/sync-workout` when the connection returns, listening for `@capacitor/network` connectivity-restored events (1.30.0: "Offline sync now resumes immediately"). Any new write that must succeed even when the user is mid-workout with flaky connectivity should follow this outbox pattern rather than a fire-and-forget `fetch` that silently fails offline.

## Stale-fetch races

When the "subject" of a fetch can change quickly (switching exercises, switching tabs), use an `AbortController` so a slow response for the previous subject can't clobber state for the current one (1.7.2 pattern in the exercise stats sheet).

## Before calling a feature done, ask

- Does this screen show *something useful* on a cold cache with no network (airplane mode, fresh install)?
- If the user edits something, does it reflect immediately without a manual reload? (cross-check `caching-conventions` skill for `invalidateCache`)
- If a fetch fails, does the user see an explicit error/retry rather than a permanently blank or stale view?
