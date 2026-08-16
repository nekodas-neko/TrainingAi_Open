## 2026-07-30 — Scale: early-data watchdog for a stalled first connection

Follow-up to v1.243.2 (#937, merged). The owner rebuilt and ran the same `chrome://inspect` test
used to verify that PR, and found a third, distinct scale bug on top of it.

### The symptom
Right after an app reload, the owner jumped on the scale and stood there the full time (the scale
has its own on-device countdown/loading bar). The log ran cleanly through `scan hit` → `connecting`
→ `connectionStateChange status=0 newState=2` → `preparing` → `waiting` — meaning the GATT
connection succeeded and the measurement-request write (`FFE3`) succeeded — and then **nothing**.
Not an unstable reading, not a timeout log, just silence for the observed window. Trying again
immediately (still the same app session) worked on the very first attempt: `unstable reading` then
`stable reading` within a couple of seconds.

This ruled out the first two hypotheses in order: it isn't "didn't stand long enough" (the owner
watched the scale's own countdown finish both times), and it isn't a hardware settling-period thing
either — the first attempt is always the one that fails, and it fails identically on every fresh
session, never mid-session.

### Root-cause theory (log-inspection only — not yet independently confirmed)
`ScaleGattClient.onDescriptorWrite` never checks whether the `FFE1` CCCD (notify-subscribe) write
actually succeeded before moving on to write the `FFE3` measurement-request command:

```kotlin
override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
    if (status != BluetoothGatt.GATT_SUCCESS) log("descriptor write status=$status")
    opDone()   // proceeds regardless
}
```

If that subscribe silently fails to take on a freshly-created GATT session — a documented class of
Samsung-BLE-stack flakiness in this exact codebase (`oura-native-ble` skill: "Samsung's stack does
not honour `autoConnect=true`... direct connect + bounded same-device retry is the pattern") — the
scale still accepts the measurement-request write and (presumably) transmits, but the phone's own
OS never delivers those notifications to the app. That produces exactly the observed signature:
clean connect, clean request-write, then total silence until the 30s timeout, with a fresh GATT
session on the next attempt working normally.

### Why didn't this show up before?
`ScaleGattClient.kt` (the connect→subscribe→request→wait state machine) hasn't changed since the
original integration (#848, v1.229.0) — neither #929 nor #937 touched it. What changed is the
*frequency and context* of connections. Before #929's stale-scan fix, `ScaleScanReceiver` was
replaying stale `ScanResult`s and triggering a real `connectGatt()` roughly every 3 minutes,
continuously, for hours — which incidentally kept the phone's BLE/GATT stack "warm." #929 correctly
stopped those spurious wakes, so the service now only connects on a genuine weigh-in — meaning a
true **cold first connection** (long idle, or right after an app/session restart) went from "rare,
stack usually already warm" to "the normal case again." This isn't a regression from either of the
last two scale PRs; fixing the stale-wake bug just stopped masking a pre-existing first-connection
quirk that was always there.

### Fix
Added a bounded early-data watchdog in `ScaleGattClient.kt` (`EARLY_DATA_TIMEOUT_MS`, 8s), started
alongside the existing 30s `WEIGH_IN_TIMEOUT_MS` the moment the `FFE3` write succeeds. Any `FFE1`
notification at all — even one `parseWeightPacket` fails to decode — cancels it, since receiving
anything at all proves the subscribe worked. If nothing arrives within 8s, treat it as a failed
subscribe: close the connection and report failure, so `ScaleBleService`'s existing retry policy
(`MAX_ATTEMPTS`/`RETRY_GAP_MS`) reconnects with a fresh GATT session almost immediately, instead of
sitting out the full 30s for a wake that per this theory was never going to produce data.

This reuses the service's existing retry machinery rather than adding a new one — the failure just
surfaces ~22s sooner than it used to.

### Why this wasn't chased further before shipping
Confirming the actual GATT status code of the failed CCCD write (rather than inferring it from the
symptom) needs a BLE sniffer/nRF Connect capture, which isn't available in this sandbox and would
have cost another owner round-trip. The 8s watchdog is a safe fix even if the theory is wrong: a
genuine weigh-in's first packet lands within a couple of seconds per the Phase 0 protocol capture
(`docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`), so 8s of true silence is already
anomalous regardless of cause, and the fallback (reconnect and retry) is harmless either way.

### Version bump
1.243.3 (patch — bug fix).

### Not yet confirmed
Compile-reviewed only — no Android SDK/Bluetooth hardware in this sandbox, and the CI Android job
compiles but doesn't exercise real BLE hardware. This is a theory built from device logs the owner
captured, not an independently-verified root cause. Needs the owner to rebuild and repeat the
first-connection-after-reload test to confirm it now recovers within ~8-16s instead of failing
silently for 30s+.
