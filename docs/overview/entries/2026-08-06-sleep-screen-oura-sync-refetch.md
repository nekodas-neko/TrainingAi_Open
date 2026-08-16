# 2026-08-06 — Sleep screens now refetch when a BLE sync/redecode completes

**Domain:** sleep — v1.266.11, JS-only (no APK rebuild)

## The report

Q-91 (owner UI-bug batch): the sleep hypnogram has been missing for a while; prior sessions said
to redecode, but it seemed to do nothing — though the data showed up eventually.

## Measured first — the data was never actually missing

Queried `claude_ro.sleep_sessions` directly rather than guessing from prior journal entries: zero
nights with `duration_hours > 1` are missing `sleep_phase_5_min` going back ~10 weeks, including
the day of the report, with well-formed stage-string content spot-checked (not just null-checked).
So the real bug was downstream of the data, not the data itself.

## Root cause — a missing reactive refetch, wider than the plan's own trace found

`invalidateOuraSync()` correctly clears the `'sleep-sessions'` cache entry after a manual Redecode
or a BLE drain settling (`afterDrainSettles()`, which also dispatches a `ta:oura-ble-synced` window
event). But clearing a cache entry doesn't make an already-mounted component refetch — something
has to listen for the signal and re-fire the fetch. Tracing every reader of the `'sleep-sessions'`
cache key found the gap was bigger than the plan document's own trace: `session-select-content.tsx`
was the **only** subscriber to `ta:oura-ble-synced` anywhere in the app, but even its own listener
only bumped a `refreshTick` counter — and its `'sleep-sessions'` fetch effect depends on `[userId]`
only, never `refreshTick`. So the one place already listening for the signal didn't actually act on
it for this cache key either. `sleep-content.tsx` and `health-content.tsx` had no listener at all.

## The fix

- `app/session-select/session-select-content.tsx`: the existing `onBleSynced` handler now also
  fires a `cachedFetch('sleep-sessions', ...)` directly, alongside its `refreshTick` bump.
- `app/health/sleep/sleep-content.tsx`: new listener effect that refetches `'sleep-sessions'` on
  the same event.
- `app/health/health-content.tsx`: new listener effect that calls the existing `fetchMeta()`
  (which already includes `'sleep-sessions'` in its fetch set) on the same event.

All three now match the pattern: invalidate → refetch, for a screen that's already mounted when
the sync/redecode completes, not just on the next navigate-away/remount.

## Deferred, not fixed

The ingest route's own background rollup (`app/api/oura-ble/samples/route.ts`, the I20-documented
lag path) still emits no invalidation signal at all — it's intentionally fire-and-forget for
latency reasons, and the plan flagged that wiring a signal off its completion needs a scoped
design, not a quick add-on, to avoid reintroducing that timeout risk. Filed as
`docs/implementation-backlog.md` Q-91-followup rather than guessed at.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` missing-module error and
a handful of pre-existing warnings on the touched files, both confirmed via `git stash` diff).
Full suite: 401 files / 3,180 tests green.

Ran `pnpm dev` against the local DB and reproduced the exact reported sequence end-to-end with
Playwright, without any code that pretends this is a component test — real HTTP requests, real
DB writes, real browser: seeded a sleep session with no `sleep_phase_5_min`, opened `/health/sleep`
and confirmed no "Sleep Stages" section rendered; then, **without reloading or navigating away**,
updated the row to add hypnogram data and dispatched `window.dispatchEvent(new
Event('ta:oura-ble-synced'))` (the same event the real BLE drain-settle path fires) — the hypnogram
appeared live. Repeated for `health-content.tsx` and `session-select-content.tsx`, confirming via
the dev server's request log that each fired a genuine new `GET /api/sleep-sessions` only after
the event (0 or 1 baseline → +1 after dispatch, verified with the service worker blocked so a
cache-hit couldn't be mistaken for a live fetch).

**Not exercised:** the real BLE drain-settle and admin-Redecode code paths themselves (native
plugin, no BLE hardware in this sandbox) — verified the exact event contract they dispatch instead
of the full native trigger. No on-device (S25) confirmation.
