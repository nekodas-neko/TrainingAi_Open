# BF-187 — opening the app never asks the ring for anything

**Branch:** `docs/bf-187-ring-drain-on-open` · docs-only · BugFix intake

The owner asked whether sleep data can sync as soon as the app opens, noting the official Oura app
did it. It can, and most of the machinery is already built: `syncOuraRing()` drains the ring,
waits for the server rollup watermark, invalidates the Oura caches and tells mounted screens to
refetch. It has two callers — the pull-to-refresh gesture and the Refresh button on session-select
— and neither is app open. Between gestures the ring is drained on a 60-minute timer.

Measured before filing, against production:

- **Drain cadence**, 40 h of `oura_raw_samples.recorded_at` to 2026-09-24 06:19 Brisbane: scheduled
  gaps of **57–91 min**, matching `DRAIN_INTERVAL_MS` plus the 5-min keepalive granularity.
- **Post-wake lag**, the seven nights still resident in the raw table: first batch after `sleep_end`
  arrived **4–34 min** later, median **25**. Older nights read as multi-day lags and were discarded
  as an artifact of the ~8-day packer window rather than recorded as a finding.

The screenshot that prompted the report is not itself the defect, and the entry says so: it was
taken at 06:57 and the night it shows landed with the 03:08 drain. The window bites when the app is
opened within about half an hour of waking, and all day for metrics that keep accumulating.

Two things the trace turned up that the report did not ask about. Home mounts no `PullToSync`, so
the tab the app opens on is the one screen with no way to request a drain at all. And the trigger
this entry asks for used to exist: the Oura *Cloud* sync removed on 2026-08-13 fired on app open and
native resume. Removing it was right — it could not succeed on our own BLE key — but nothing
replaced its trigger, and the comment recording the removal is still in `sync-provider.tsx`.

Filed as Lane A: the listener belongs in `sync-provider.tsx`, but the cooldown guarding it is
ring-radio policy in `lib/oura-ble/**`. The entry recommends a JS-side cooldown (no APK) over
exposing `lastDrainCompletedAt` from the plugin, and states plainly that "as soon as the app opens"
will mean ten to forty seconds, because `afterDrainSettles` waits for the rollup rather than
invalidating early.
