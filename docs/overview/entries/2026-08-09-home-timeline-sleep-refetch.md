# 2026-08-09 — Home's "Today's Timeline" sleep card had the same stale-refetch gap Q-91 fixed elsewhere

**Domain:** sleep · app-shell — v1.270.32, JS-only (no APK rebuild)

## The report

Owner reported last night's bed/wake time looked ~30 minutes off on first opening the app, then
showed the correct time after a restart.

## What actually happened — not a clock bug

Investigated the BLE clock-anchor conversion first (the documented, already-known extrapolation
skew in the backlog) and confirmed it's a real but separate, smaller issue — it doesn't explain
this report. The owner's own recalled times (22:30 bed / 07:20 wake) were *closer* to the currently
stored value (22:28 / 07:33) than to an alternative resolution method tried during the
investigation, which ruled out "the math is wrong" as the explanation for what was actually seen.

The real signature — correct data existed, wrong data displayed, restart fixed it — is the same
class of bug Q-91 (#1107, 2026-08-06) just fixed for the Sleep and Health screens: a cache entry
gets correctly invalidated when a BLE sync completes, but nothing tells an already-mounted screen
to refetch it.

## Root cause — Q-91 didn't cover this reader

Q-91's fix added a `ta:oura-ble-synced` listener to three readers of the `'sleep-sessions'` cache
key: `sleep-content.tsx`, `health-content.tsx`, `session-select-content.tsx`. It didn't touch
`components/home-day-timeline.tsx` — the "Today's Timeline" widget on the Home screen, almost
certainly the first thing the owner saw. That component reads a **different** cache key
(`'home-day-timeline'`, backed by `/api/day-timeline`) that Q-91's trace never covered.

The cache entry itself was already being invalidated correctly — `'home-day-timeline'` is already
in the `invalidateOuraSync()` group (`lib/cache-groups.ts`). The gap was purely the missing
listener: an already-mounted Home screen never learned to refetch after the invalidation, so it
kept showing whatever was cached before the night's sync finished. A full app restart bypasses the
stale in-memory mount and refetches fresh, which is exactly why that "fixed" it.

## The fix

Mirrors Q-91's pattern exactly (same event, same invalidate-then-refetch shape), applied to the
fourth reader: `home-day-timeline.tsx` now listens for `ta:oura-ble-synced` and re-fires its
existing `cachedFetchToday('home-day-timeline', '/api/day-timeline', ...)` call on that event, same
as its initial-mount fetch.

## Not exercised

Verified server-side (typecheck, lint, the home page and `/api/day-timeline` both render/respond
cleanly against the local seeded DB via `pnpm dev`). **Not verified**: the actual client-side
event-triggered refetch in a live browser (no Playwright/browser-automation tooling available in
this session) — the fix is a line-for-line mirror of Q-91's already-verified pattern, but that
specific behavioural claim rests on code-reading, not an observed live refetch. No on-device (S25)
confirmation either.
