## 2026-07-30 — Fix scale scan re-triggering on stale, replayed BLE results

Follow-up to the retry-storm cooldown fix (#923, v1.242.0) and its device-verification PR (#927).
The owner rebuilt the APK and confirmed the cooldown fix via a `chrome://inspect` capture — but
kept watching, and the same "connecting…" → "Retrying…" cycle recurred indefinitely on a steady
~3 minute cadence for well over an hour, with nobody near the scale. That contradicted the "some
scales wake on any nearby vibration" theory from #923 (which the owner also pushed back on
directly: "it usually turns on when you stand on it... no one is standing on it") and my
alternative "post-weigh-in tail window" theory (this kept going long after any real use, not just
for a few minutes after).

### Diagnosis
Asked the owner to run an independent test: install a neutral BLE scanner (nRF Connect) and watch
for the scale's advertisement directly, bypassing our own app entirely. **The scale only appeared
in that scan while someone was actually stepping on it** — it does not wake or re-advertise on its
own. That flips the whole diagnosis: the scale was never the problem. Our own `ScaleScanReceiver`
was firing every ~3 minutes regardless of the scale's real state.

### Root cause
`ScaleScanReceiver.kt`'s `onReceive()` treated any broadcast delivery from the registered
`PendingIntent`-based scan as proof the scale had just started advertising — "any callback here
means the scale just started advertising. No need to inspect the ScanResult extras beyond that,"
per its own comment. That assumption was wrong: Android's `BluetoothLeScanner.startScan(filters,
settings, PendingIntent)` API can redeliver a `ScanResult` well after the underlying advertisement
actually stopped (each `ScanResult` carries its own `timestampNanos`, precisely so a receiver can
tell a fresh sighting from a stale/replayed one — which this code never checked).

### Fix
`ScaleScanReceiver.onReceive()` now extracts the `ScanResult` list from
`BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT` in the intent extras (typed
`getParcelableArrayListExtra` on API 33+, the deprecated untyped overload below that — minSdk is
26) and only proceeds to start `ScaleBleService` if at least one result's `timestampNanos` is
within `MAX_RESULT_AGE_MS` (5 seconds) of `SystemClock.elapsedRealtimeNanos()`. A stale/replayed
delivery is logged (`Log.d`) and dropped before the service is ever started — no foreground-service
notification flash at all for these, unlike the cooldown-ignore path in `ScaleBleService` (a
`BroadcastReceiver` isn't subject to the "must call startForeground within 5s" constraint that
applies to a `Service` started via `startForegroundService()`, so this can just no-op cleanly).

The retry/cooldown state-machine fix from #923 (`cycleActive` guard + 2-minute post-give-up
cooldown) is unaffected and stays — it was solving a real, separate bug (a scan match arriving
mid-cycle incorrectly resetting the attempt counter) and remains correct regardless of what feeds
the scan in the first place.

### Caught by CI, not review
The first push used `BluetoothLeScanner.EXTRA_LIST_OF_SCAN_RESULTS`, a plausible-looking but
non-existent field name written from memory — exactly the failure mode this project's CLAUDE.md
warns about for external API names. The Android CI job (`compileDebugKotlin`) failed with
`Unresolved reference`, which is the whole reason that job exists as the authoritative Kotlin
check in this sandbox (no local Android SDK to catch it earlier). Verified the real constant
against the actual AOSP source (`EXTRA_LIST_SCAN_RESULT`, singular "RESULT") before pushing the
correction, rather than guessing a second time.

### Version bump
1.242.4 (patch — bug fix; renumbered from 1.242.3 on rebase to avoid colliding with #928's own 1.242.3).

### Not yet confirmed
Compile-reviewed only, same as every native change this session — no Android SDK/Bluetooth
hardware in this sandbox. Needs the owner to rebuild and watch `chrome://inspect` again to confirm
the spurious "scan hit" / "Retrying…" cycle actually stops recurring, ideally over an extended
period (the previous, incomplete confirmation only watched a few minutes right after a real
weigh-in and missed that the problem kept going for hours).
