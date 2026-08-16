# Oura BLE — Durable Background Sync (native rework)

> **Progress (2026-07-07, session 217):** shipped in two layers the same day the loss was
> confirmed live. **v1.117.5** (parallel session): the two-cursor model — in-memory
> `drainCursor` keeps the drain looping; the persisted resume cursor only advances via
> `confirmStored(ds)` after a server 2xx (JS-driven from the tester). **v1.119.0** (this
> plan's Chunk 1 + most of Chunk 3): native ingest — the service POSTs batches itself and
> drives `confirmStored` internally, auto-drain on connect + hourly, connection-priority
> tuning, status throttle, main-thread marshalling, the Android CI job, and
> `docs/oura-ble-operations.md` (the failure matrix + cadence policy this work must keep
> current). **Remaining: Chunk 2 in full** (boot receiver, CompanionDeviceManager,
> battery-optimization prompt, bonded-device reconnect experiment) **and Chunk 3's
> frame-batching item** (`ouraFrame` events still cross the bridge one per frame —
> display-only now). ⚠️ The shipped Kotlin is compile-gated by CI only — on-device
> verification (Full re-sync + ops manual §4 runbook) is owner-run after an APK rebuild.

**Source review:** `docs/reviews/2026-07-07-oura-ble-system-review.md` (BLE-1, -2, -6, -7,
-10, -12, -15). **Branch:** `feat/oura-ble-durable-sync`. **Almost entirely native Kotlin —
every chunk here requires an APK rebuild** (`npx cap sync android && cd android &&
./gradlew assembleDebug`), and none of it is verifiable in the web sandbox. Protocol
byte-facts come from the `oura-native-ble` skill / open_oura Rust source only.

**Goal:** make the pipeline genuinely set-and-forget. Today the ring records autonomously
and the service holds the connection, but drained events only reach Postgres while the
`/admin/oura-ble` tester is mounted in a foreground WebView, and the history cursor
advances whether or not ingest succeeded — a failed/absent POST permanently loses that
span (the ring will never be asked for it again). After this plan: the native service
drains on connect and periodically, POSTs batches itself, advances the cursor **only on
server ack**, restarts after reboot, and reconnects via CompanionDeviceManager presence
instead of a battery-hungry scan loop.

---

## Chunk 1 — Ack-gated cursor + native HTTP ingest (fixes BLE-1/BLE-2, the critical pair)

**The invariant this chunk establishes (also going into CLAUDE.md):** the persisted
history cursor may only advance past events that are durably stored server-side.

Tasks:

1. **Buffer drained events native-side.** In `OuraRingService`, collect history-event
   frames (`tag >= 0x41`) during a drain into an in-memory batch keyed by the batch's
   completion. Keep raw frame bytes (hex) — the server does the decoding, same as today.
2. **POST from the service.** On each `0x11` completion (or every N events), POST
   `{frames:[{hex}]}` to `/api/oura-ble/samples` using `HttpURLConnection`/OkHttp on a
   background thread.
   - **Auth:** the Capacitor WebView shares the system `CookieManager`, so
     `CookieManager.getInstance().getCookie(serverUrl)` yields the session cookie for the
     Railway origin (`capacitor.config.ts server.url`). Send it as the `Cookie` header.
     If the cookie is absent/expired, park the drain and log — do NOT advance the cursor.
     (Fallback option if cookie flakiness shows up on-device: a long-lived device token
     column checked by the route — decide only if needed.)
   - The route already accepts ≤2000 frames / 512 KB / 120 req/min — batch ≤500 frames
     per POST like the tester did.
3. **Advance the cursor only on 2xx.** Move the `history_cursor_ds` persist from the
   `0x11` handler to the POST-success callback: persist `maxTsSeen(batch)+1` only after
   the server confirms `stored+deduped == decoded` receipt (any 2xx counts — dedup means
   re-sends are free). On failure: keep the old cursor, retry the POST with backoff
   (bounded), and let the next drain re-request the same span. Re-drained duplicates are
   absorbed by the DB's unique constraint — that's the durability model working as
   originally described.
4. **Auto-drain.** Call `startDrain()` from `onReady()` (after the feature-enable writes),
   and re-check on each keepalive tick (every 5 min): if not draining and the last
   completion reported `bytes_left > 0`, or >6 h since the last successful drain, start
   one. Event/lifecycle-driven, no new timer layer (module-map §0 stays true — the
   keepalive tick already exists).
5. **Keep the tester's JS forwarding as display-only.** The tester keeps receiving
   `ouraFrame` events for its live counters, but its POST loop is deleted — the service
   owns ingest. Show "forwarded by service: N stored" from a new counter in `status()`.
6. **CI (BLE-10):** add an `android-test` job to `.github/workflows/ci.yml` (JDK 21 +
   gradle cache + `./gradlew :app:testDebugUnitTest`), plus an `assembleDebug` step
   uploading the APK as a workflow artifact so native rounds stop depending on the
   owner's local toolchain. Mark it required only if runtime proves stable (~2–4 min).
7. **Unit tests (JVM):** cursor-advance state machine (ack → advance; failure → hold;
   dedup re-send) extracted into a pure class so it tests without Android.

Not in scope: encrypting the key (SharedPreferences → Keystore is a product-stage
follow-up, noted in the review as BLE-14).

**Verify (owner, on device):** drain with airplane-mode-on → cursor holds, log shows
parked batch; re-enable network → batch lands, cursor advances; kill the app mid-drain →
reopen → the same span re-drains and dedups (stored 0, no gap). Tester's span/cadence
block shows a continuous overnight window afterwards.

## Chunk 2 — Reboot + reconnect resilience (fixes BLE-6)

1. **Boot receiver:** a `BroadcastReceiver` for `BOOT_COMPLETED` +
   `ACTION_MY_PACKAGE_REPLACED` that starts `OuraRingService` if a key is stored
   (`RECEIVE_BOOT_COMPLETED` permission; respect Android 15 FGS-from-BOOT rules for the
   `connectedDevice` type — if starting an FGS directly is disallowed on the S25's API
   level, fall back to scheduling connect on next unlock via CDM presence below).
2. **CompanionDeviceManager association:** one-time association flow from the tester
   (`AssociationRequest` with the mfr-id `0x02b2` scan filter), then
   `startObservingDevicePresence()` — the OS wakes us when the ring advertises; on the
   presence callback, start the service/connection attempt. Keep the existing scan loop
   as the fallback when no association exists. Associations survive reboots.
3. **Battery-optimization exemption:** one-time tester prompt via
   `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; add "add TrainingAI to *Never sleeping
   apps*" to `docs/device-smoke-checklist.md` (done in the review PR).
4. **Bonded-device reconnect experiment (time-boxed):** try `connectGatt` directly on the
   bonded device from `adapter.bondedDevices` (IRK resolves the rotating RPA) instead of
   a fresh scan; measure success rate in the service metrics. Keep scan-first if flaky —
   Samsung's stack already burned us on `autoConnect=true` (v1.116.4), so this ships
   behind the metrics, not as a leap of faith.

**Verify (owner):** reboot phone → service notification appears without opening the app;
overnight soak with the app swiped away → morning tester shows connects>0 and a full
sleep-window drain.

## Chunk 3 — Bridge + link efficiency (fixes BLE-7/BLE-15)

1. Batch `ouraFrame` emissions (arrays ≤100 frames) and throttle `emitStatus()` to ≥1 s
   between emits (dirty-flag) — today every event costs two bridge crossings.
2. `requestConnectionPriority(CONNECTION_PRIORITY_HIGH)` when a drain starts,
   `CONNECTION_PRIORITY_BALANCED` (or `LOW_POWER`) when it completes. Log the drain
   wall-time before/after for the metrics block.
3. Move GATT-callback frame handling onto the main handler (closes the benign
   `maxHistoryTsSeen`/`draining` cross-thread access noted in the review §5).
4. Tester: accept batched frame events; keep per-name counters cheap (one state update
   per batch).

**Verify (owner):** drain wall-time drops measurably (log timestamps); no ANRs; tester
counters still live during a drain.
