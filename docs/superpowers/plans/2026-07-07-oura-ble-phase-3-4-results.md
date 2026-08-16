# Oura Direct-BLE — Phase 3+4 Results & Handoff (2026-07-07)

**Status: WORKING END-TO-END on the S25 Ultra APK.** The ring is read directly over
Bluetooth (no Oura Cloud, no official app), its history events are decoded, and HR / HRV /
SpO₂ / temperature / battery land in Postgres with real wall-clock timestamps. This document
is the pick-up point for the next agent/session.

> Source-of-truth reminder: the protocol was reverse-engineered from **`Th0rgal/open_oura`
> (Rust)** and the skill `.agents/skills/oura-native-ble/SKILL.md`. When a byte layout or
> command is uncertain, read the Rust source / skill — **not** Oura's public docs, which
> don't cover the BLE protocol.

---

## 1. What this is

A direct-BLE pipeline that treats the ring as the source of raw biometric samples:

```
Oura Ring 5  ──BLE notify──▶  Android foreground service (Kotlin)
   │ (history events)              │ decode cursor drain
   │                               ▼
   │                        Capacitor plugin ──event──▶ WebView JS (tester)
   │                                                        │ POST hex frames
   │                                                        ▼
   │                                        /api/oura-ble/samples  (decode server-side)
   │                                                        ▼
   └───────────────────────────────────────────▶  oura_raw_samples (Postgres)
                                                            ▼
                                              /api/oura-ble/samples/summary ──▶ tester UI
```

It is an **admin-gated spike** (only a user with `isAdmin` can ingest/read). It is **not**
offline-first and has **no outbox** — durability comes from the ring's own history buffer +
a persisted deciseconds cursor: a failed POST just means the next drain re-sends. This is
deliberate and correct for a server-side ingest (like the Oura Cloud sync path), and is
distinct from the app's offline-first domains.

---

## 2. File inventory

### Native (Kotlin) — `android/app/src/main/java/com/trainingai/app/oura/`
| File | Role |
|---|---|
| `OuraProtocol.kt` | **Pure** protocol: frame parse (tag-len-payload), command builders (`reqSyncTime`, `reqEnableAllNotifications`, `reqBattery`, `reqGetHistory`, `reqSetFeatureMode`, `reqFeatureStatus`, `enableMeasurementSequence`, live-HR/accel sequences), parsers (`parseBattery`, `parseHistoryCompletion`, `historyEventTimestamp`). Unit-tested on the JVM. |
| `OuraAuth.kt` | AES/ECB/PKCS5 nonce challenge-response (the `key.hex` → encrypted nonce). |
| `OuraGattClient.kt` | Scan (match by name + mfr-id `0x02b2`, **never address** — RPA rotates ~1–2 min), connect, **native bond** (RE8), MTU 247, subscribe **every** notify/indicate characteristic (Ring 5's `…0004/0005/0006` roles are uncharacterised), auth handshake, write queue. |
| `OuraRingService.kt` | Foreground `connectedDevice` service. Scan loop w/ backoff, RE6 wedge cool-down, keepalive battery poll. **`onReady()` = SyncTime → enable notifications → battery → `enableMeasurementSequence()`.** History **auto-loop drain** (`startDrain()` + the `0x11` completion handler re-requests until `bytesLeft==0`), persists cursor `history_cursor_ds` in SharedPreferences. Metrics + ring-buffer log exposed to the plugin. |
| `OuraBlePlugin.kt` | Capacitor bridge. Methods: `setKey/hasKey/clearKey`, `ensurePermissions`, `startService/stopService`, `getStatus/getLog`, `readBattery/readInfo/syncTime`, `startLiveHr/stopLiveHr`, `startAccel/stopAccel`, `drainHistory`(→`startDrain`), `enableMeasurement`, `featureStatus`. Emits `ouraLog`/`ouraStatus`/`ouraFrame` events. |
| `src/test/.../OuraProtocolTest.kt` | Protocol builder/parse tests (pinned to the Rust builders). **Cannot run in the web sandbox** (Gradle distro download is proxy-blocked) — they run in the Android CI check. |

### JS / TS
| File | Role |
|---|---|
| `lib/oura-ble/plugin.ts` | Typed guarded wrapper. `getOuraBle()` returns `{ plugin }` (NOT the raw proxy — a `registerPlugin` proxy is thenable and hangs the promise; see the long comment there). Returns `null` off-native or on an old APK. |
| `lib/oura-ble/decode.ts` | **Pure** decoders, ported from the Rust `decode_body`. `parseFrame`, `parseHistoryEvent`, `decodeEventBody` (switch by tag), `historyEventFromHex`, `eventName`, `frameLabel` (history + command + `0x2f` sub-op names), `measuredAtMs` (ring-ds → wall-clock), `cadenceSecFromDs` (median inter-event gap). |
| `lib/__tests__/oura-ble-decode.test.ts` | 20 tests (decode + label + anchor + cadence). Runs in `pnpm test`. |
| `components/oura-ble/oura-ble-debug.tsx` | The tester UI (status pill, Sync now/Start/Stop, "Recorded to server" tiles + cadence/timing block, Advanced raw-protocol panel, frame counter by name, log console). Forwards `tag >= 0x41` frames to the ingest route every 2.5 s. |
| `components/oura-ble/log-console.tsx` | Log view. |
| `components/capacitor-native-init.tsx` | **Auto-starts the service on app open** if a key is stored + service stopped (guarded no-op otherwise). |
| `app/admin/oura-ble/…` | The admin page shell hosting the tester. |

### Server / DB
| File | Role |
|---|---|
| `app/api/oura-ble/samples/route.ts` | POST ingest. Admin-gated, Zod-validated, rate-limited (120/min). Decodes each hex frame server-side via `historyEventFromHex`, inserts to `oura_raw_samples`. Returns `{received, decoded, stored, byTag}`. |
| `app/api/oura-ble/samples/summary/route.ts` | GET summary (admin-gated, SWR headers). |
| `lib/data/postgres/schema.ts` | `ouraRawSamples` table (`id` BIGSERIAL, `userId`, `ringTimestampDs` bigint, `tag`, `eventName`, `bodyHex`, `decoded` jsonb, `recordedAt` default now). UNIQUE `(userId, ringTimestampDs, tag, bodyHex)` for re-drain dedup. |
| `lib/data/postgres/migrations/114_oura_raw_samples.sql` | The table + index. |
| `lib/data/repository.ts` | `OuraRawSampleInput`, `OuraRawSampleSummary`, `OuraRawSampleMetricTiming` types + method signatures. |
| `lib/data/postgres/adapter.ts` | `insertOuraRawSamples` (dedup insert, returns stored count), `getOuraRawSampleSummary` (totals, by-name, latest HR/temp/battery, **wall-clock anchor + span + per-metric cadence**). |

---

## 3. Protocol essentials (the load-bearing facts)

- **Match by name / mfr-id `0x02b2`, never MAC** — the ring advertises a rotating RPA.
- **The ring radio/PPG sleeps when worn-idle** (RE4). It wakes on the charger, or worn **+
  moving**, or during detected sleep. This is why live HR shows nothing while sitting still —
  it's a firmware power gate, not a bug. Sleep HR/HRV/temp record continuously once asleep.
- **Native bond is required** (RE8) — the first connect needs the ring awake (on charger) to
  bond; afterwards it reconnects worn without the charger.
- **Order on connect (RE10):** SyncTime (`12 09 <u64 UTC s> 00`) → enable notifications
  (`1c 01 3f`) → battery → **enable measurement features**.
- **Enabling measurement (THE fix that made HR/temp record):** after a key-only re-key the
  measurement features are **OFF**, so the ring writes only system/debug events. Set them to
  AUTOMATIC: `enableMeasurementSequence()` = `set_feature_mode(DAYTIME_HR=0x02, AUTOMATIC=1)`
  + `set_feature_mode(SPO2=0x04, AUTOMATIC=1)`. Feature modes: `OFF=0, AUTOMATIC=1,
  REQUESTED=2, CONNECTED_LIVE=3`. `set_feature_mode` wire = `2f 03 22 <feature> <mode>`; the
  ring acks with `2f … 23`. Live HR = `CONNECTED_LIVE` (continuous, battery-heavy).
- **History drain (RE9):** `reqGetHistory(cursor)` = `10 09 <cursor u32 LE> ff ff ff ff ff`
  (max_events=255, all types). The ring returns ≤255 events then a `0x11` completion packet
  with `events_received` + `bytes_left`. **Auto-loop:** advance the cursor to `maxTs+1`,
  persist it, and re-request until `bytes_left==0`. Cursor is **deciseconds (100 ms)**.
- **History event framing:** tag `>= 0x41`, first 4 payload bytes = LE deciseconds timestamp,
  rest = body. Decoders are **infallible → return null** on unknown/short bodies (never throw).
- **HR sources:** `green_ibi_quality_event (0x80)` and `ibi_and_amplitude_event (0x60)` decode
  IBI → `hr_bpm` array; `hrv_event (0x5d)` → `hr_bpm` + `rmssd_ms`. IBI is **not** server-gated.
  Raw PPG waveform (`0x81`) **is** entitlement-locked and unreachable over BLE — we use IBI.

---

## 4. Wall-clock anchoring (why timestamps are correct)

The ring's `ring_timestamp_ds` is a **monotonic deciseconds counter since the ring's own
epoch** (reset on a re-key — a UTC value wouldn't fit the 4-byte field). `recorded_at` is
**ingest** time, which is only ≈ measurement time for live data; a backfilled night would
otherwise be stamped at drain time.

**Anchor (read-time, no migration):** the newest drained event is measured ~seconds before
ingest, so the row with `max(ring_timestamp_ds)` gives `(anchorDs ↔ anchorUtc)`. The slope is
fixed at 100 ms/decisecond, so:

```
measured_at(event) = anchorUtc + (event.ring_ds − anchorDs) × 100 ms
```

Implemented in `measuredAtMs()` and applied in `getOuraRawSampleSummary`. Because raw
`ring_timestamp_ds` is stored per row, this back-dates existing rows with **no re-sync**.

**Caveat / next-step:** the anchor is only valid within one clock epoch. If the ring's clock
resets (re-key, fully-dead battery) the epoch shifts and old rows can't be re-anchored — so a
**persisted per-epoch anchor** (capture `(ringDs, utc)` at connect and store it) is the
hardening step if this graduates from spike to product. For now the battery stays charged and
no re-key is planned, so the single read-time anchor is accurate.

---

## 5. Verified on-device this session (2026-07-07)

- Clean connect: scan hit `Oura Ring 5`, bond, MTU 247, auth SUCCESS, READY ~4.7 s.
- `enabled measurement features (DAYTIME_HR + SPO2 → automatic)` on connect; ring acked
  (`set_feature_mode_ack×2`).
- Full drain auto-loops: cursor climbs, `bytes_left` trends to 0, thousands of events.
- Real biometrics decode + store: **HR 82 bpm, temp 37.00 °C**, plus `green_ibi_quality`,
  `ibi_and_amplitude`, `hrv_event`, `spo2_r_pi_event`, `temp_event`, sleep/motion/wear.
- Auto-start on app open (no manual Start).
- Frames render by name (`battery`, `set_feature_mode_ack`, `ibi_event`, …).

**Not exercised / unknown:** a full overnight sleep drain end-to-end (the immediate goal —
wear tonight, drain tomorrow); Ring-5 SpO₂ decode coefficients (marked unknown in the skill —
the SpO₂ % may be approximate); behaviour across a ring clock reset.

---

## 6. Version / PR trail (all merged to `main` today unless noted)

- **#320** (v1.117.2): enable measurement features on connect + full-drain auto-loop.
- **#321** (v1.117.3): auto-start service on app open + frame-name labels.
- **#322** (v1.117.4): wall-clock anchoring + cadence/timing in the tester. *(open at time of
  writing — auto-merge on.)*
- Earlier: Phase-2 spike (native plugin + on-device reconnect soak), Phase-3/4 MVP
  (decode + `oura_raw_samples` + ingest route). See
  `2026-07-07-oura-ble-phase-2-results.md`, `2026-07-07-oura-ble-phase-3-4-mvp.md`,
  `2026-07-07-oura-direct-ble-phase-0-results.md`.

---

## 7. Next steps (for the next session)

1. **Confirm an overnight sleep cycle records + drains correctly** (the reason this was rushed
   in). Check the tester's cadence/span block the morning after: HR should span the sleep
   window with a sensible cadence.
2. **Decode the `unknown×N` tags** — a handful of event tags have no decoder yet (stored raw
   in `body_hex`, so nothing is lost). Add decoders in `decode.ts` and re-decode without
   re-syncing (build a `redecode` path that re-runs decoders over stored `body_hex`).
3. **Persist a per-epoch clock anchor** (see §4 caveat) so a ring clock reset can't strand
   old rows.
4. **Derive Ring-5 SpO₂ coefficients** (skill §8 notes gen4/cooper coeffs; Ring 5 unknown).
5. **Graduate from spike to product:** map `oura_raw_samples` into `body_metrics` /
   `sleep_sessions` (HR, HRV, temperature, SpO₂) so the health screens use direct-BLE data;
   add a periodic background sync (there is **no cron layer** — see `docs/module-map.md` §0;
   the sync is event/lifecycle-driven from the foreground service, not a timer).
6. **CompanionDeviceManager** for bulletproof background reconnect (Phase-2 follow-up).

---

## 8. How to test / verify

**Rebuild (only needed for native Kotlin changes):**
```bash
git pull origin main
npx cap sync android
cd android && ./gradlew assembleDebug   # install android/app/build/outputs/apk/debug/
```
TS/UI changes ship from Railway (WebView) — no rebuild.

**On device (`/admin/oura-ble`, admin user only):**
1. Open the app → land Connected (auto-start). Advanced log shows `enabled measurement
   features…`.
2. Wake the sensor (move / wear) → HR flows. `Live HR` forces `CONNECTED_LIVE`; `Stop HR`
   restores `AUTOMATIC`.
3. `Sync now` / `Drain history` → watch `bytes_left → 0`, `drain complete`.
4. "Recorded to server" tiles fill (HR/Temp/Battery); the timing block shows measured cadence
   + wall-clock span — that's the data-quality proof.

**Gate:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` (JS/decode). Kotlin tests run in
Android CI (Gradle download is proxy-blocked in the web sandbox). The web sandbox can't run
native SQLite/BLE — device is authoritative.
