# 2026-08-23 — Three ring-service fixes on one APK, and one entry that was already done (Q-537, Q-533, Q-388)

**Branch:** `feat/ring-service-device-pass` · **Lane A** · **native — needs a new APK**

The `ring-service-device-pass` batch existed so three `android/…/oura/` changes cost one APK and
one ring sitting rather than three. Two shipped; the third turned out to be half built already,
which retired the batch.

## Q-537 — the ring key had exactly one copy

The 32-hex key lives only in Android SharedPreferences, deliberately (*"the key never leaves
SharedPreferences; never logged"*). That is right for a credential and wrong as the only copy: an
uninstall destroys it, the service then logs `no key stored` and refuses to start, and the Devices
card keeps reporting a healthy ring because it reads server data. The intuitive recovery is worse
than the loss — re-onboarding the official Oura app re-keys the ring and can force a firmware
update that changes the BLE event encoding, turning a credential problem into a protocol
re-validation. That happened on 2026-08-17 and was survived only because the original `key.hex`
still existed on a machine somewhere.

`OuraBlePlugin.revealKey()` returns the key, and `/admin/oura-ble` → Ring key now shows **Show key
for backup** with copy, under a warning saying what an uninstall costs. The revealed value is held
in component state only — never persisted, never cached, cleared on Hide.

**It adds no attack surface.** Every caller is already JS in this app's WebView, and that caller
can today call `setKey` to replace the key or `clearKey` to destroy it. Reading is strictly weaker
than either. What stays true: never logged, never sent to the server, never leaves the device
except through someone asking for it here.

**Two things deliberately not built.** The entry asked for a confirm-before-`clearKey` guard —
`clearKey` has **no caller anywhere** in the app, so the destructive path in practice is uninstall,
which no in-app dialog intercepts; a guard on a method nothing calls is ceremony, and the warning
now sits where the key is. And the "key present" indicator on the Devices card is a pure Lane B
surface with no storage involvement, so it is **LB-5** rather than reached into from here.

## Q-533 — the drain ran unattended and only told a screen nobody watches

The premise was half wrong and that was the finding: `OuraRingService` already drains on connect,
re-drains hourly, and POSTs each batch itself. Only the *ending* was missing — `onDrainBatchComplete`
just `log()`ged, so a full re-sync of a months-old backlog could only be confirmed by watching the
admin log.

A full re-sync now posts *"Ring re-sync complete · N batches pulled and saved"*, or *"finished with
errors"* when a batch failed to commit. Incremental drains deliberately stay silent — hourly is too
often to be worth a notification and nobody is waiting on one.

**The decision worth not re-litigating:** the notification is queued on the ingest executor, not
fired when the BLE loop ends. That executor is single-threaded and in order, so it runs only after
every batch this drain queued has committed — which is what makes "and saved" a fact rather than a
guess. Firing at the end of the BLE loop would announce completion while batches were still
writing, which is precisely what the `uploads may still be finishing` log line beside it warns
about.

## Q-388 — one item shipped, one was already done a month ago

**Item (2), the fast-HR trap, shipped.** `liveHrStartSequence()` puts EXERCISE_HR into
CONNECTED_LIVE and turns on BLE fast-HR mode; only `liveHrStopSequence()` undid them. Any session
that never reached it — app killed mid-workout, service killed by Samsung battery management, or
the tester's **Live HR** pressed without **Stop HR** — left continuous fast-HR sampling on
permanently, healed by no reconnect, app restart or service restart. `enableMeasurementSequence()`
now ends with both resets, because connect is the one path guaranteed to run. Recorded as **R8** in
the operations doc's failure matrix.

**Item (3), "persist the battery poll", was already shipped — and the entry's central claim was
false.** It read *"it is never stored, so drain cannot be measured at all today"*.
`OuraRingService.postBatteryPoll` has fired on every keepalive tick into
`POST /api/oura-ble/battery-poll` → `oura_ble_battery_poll` (migration 133) since **2026-07-19**.
Production holds **6,346 polls**, still arriving.

So the evidence the entry called missing has existed the whole time. Measured from it, overnight
22:00→08:00 Brisbane on nights with no charging in the window:

| night | start | end | drop over ~9.8 h |
|---|---|---|---|
| 22 Aug | 56% | 34% | −22 |
| 20 Aug | 79% | 55% | −24 |
| 19 Aug | 99% | 77% | −22 |
| 16 Aug | 72% | 34% | −38 |
| 11 Aug | 27% | 12% | −15 |

That confirms the owner's ~20%/night report from the ring's own telemetry, and it means the SpO₂
A/B the entry says decides everything needs two nights of wear and one query — no code and no APK.
Q-388 stays open on the SpO₂ decision itself, which is the owner's.

## Verified

- **JVM protocol tests** extended: the pinned `enableMeasurementSequence()` hex now covers five
  frames, plus a case asserting the connect sequence contains the stop sequence's two resets —
  written against the builders rather than literal bytes, so it survives a layout change.
- Full suite and `pnpm check:rules` green; Kotlin compiles in the Android CI job.

**Not exercised — and this is most of it.** Everything here is native. The reveal affordance has
not been used on the ring's phone, the notification has not been seen firing, and the connect-time
resets have not been confirmed against the ring's real feature state. Both entries stay in the
queue with `Gate: device` and a `Keep:` line naming exactly what is owed, rather than being struck.
Until that APK is installed the ring key still has one copy.
