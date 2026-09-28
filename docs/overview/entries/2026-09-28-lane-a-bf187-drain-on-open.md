# 2026-09-28 — BF-187: opening the app asks the ring for its data

Removing the Oura Cloud sync on 2026-08-13 also removed the only open/resume trigger. Since then,
opening the app never asked the ring for anything, and freshness was bounded by the hourly drain:
a median 25-minute lag after waking, measured on the resident nights. The owner asked for the sync
to happen "as soon as the app is opened", and he lifted the APK cost so the cooldown could live in
the native service.

`OuraRingService.drainIfStale(maxAgeMs)` starts a drain unless one finished within `maxAgeMs`, or
one is in flight, or the ring isn't ready. The service is the only thing that can see the hourly
autonomous drains and survive a WebView reload. `sync-provider.tsx` calls it through
`syncOuraRingIfStale()` on mount and on Capacitor `resume`, with a 10-minute cooldown. When a drain
starts, the same settle-then-announce path as pull-to-refresh runs, so cards refill when the rollup
lands (~10–40 s), not on first paint. The changelog says so, so the owner knows what to expect.

Verification: Kotlin compiled locally (a typo in the new code fails the build), and there are JS
tests for started, fresh, older APK and wiring (the always-settle mutant is killed). The device
check is owed and recorded as `Verify: device` and a Known-Issues row.
