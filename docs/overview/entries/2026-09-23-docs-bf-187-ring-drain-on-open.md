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

## Amended the same day — the APK constraint came off, and the entry turned out to be a duplicate

The owner lifted the build cost: *"Happy for new apk builds if thats more effecient."* That flips
BF-187's recommendation. The entry had recommended a JS-side cooldown purely to avoid an APK; the
native answer is a `drainIfStale(maxAgeMs)` plugin method that makes the staleness decision inside
the service against the real `lastDrainCompletedAt`. A JS cooldown resets on WebView reload, cannot
see the autonomous hourly drains, and races the `draining` flag — three facts the service holds and
the web layer can only guess at. The JS version stays recorded as the fallback, since it is what
ships if this ever has to land without a build.

Sweeping the queue for other work shaped by that constraint turned up something the original filing
missed: **BF-187 duplicates link 1 of Q-529**, filed 2026-08-20, which already carries the owner's
requirement in his earlier words — *"Ideally I want the score and sleep time to be accurate on first
open of the day without needing time to 'adjust'"* — and already names "Drain on app open / wake
detection" as the dominant term, blocked on Kotlin. It has sat a month for exactly the reason that
was just removed.

Recorded rather than reconciled quietly. Q-529 keeps the display half and the re-score follow-on;
BF-187 owns the trigger, because a drain on open moves steps, HR, SpO₂ and temperature as well as
sleep. Q-529's link 1 now points at BF-187 and says why it left.

The two measurements are worth keeping side by side: Q-529's review found a **62.0-minute median
gap across 214 batches over 7 days**; this entry found **57–91 minutes over 40 hours**, a month
later and without having seen the first. Nothing drifted. That is the argument for building the
trigger rather than measuring the cadence a third time.

Four other entries were parked on the same constraint and are now unblocked as a batch: **BF-80**
(blank-screen handling in `MainActivity.java`), **BF-105** (spoken walk cues), **Q-111** (the scale
battery chip), and **TN-51** (overnight strap wear landing in ambient mode).
