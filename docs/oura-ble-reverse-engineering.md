# Oura ring over Bluetooth: how we reverse engineered it

_Written 2026-10-14, as the owner's ring moves from our direct Bluetooth link to the Oura Cloud API
(#2808). It is for whoever wants direct ring access back after the Bluetooth code has left `main`.
Every path named below exists at tag **`v1.490.1`** (§6)._

> **This is a map, not a protocol write-up.** The detailed write-up, the `oura-native-ble` skill,
> was taken out of this public repository by owner decision on 2026-08-10. It is archived in object
> storage and in the archived private repository (`scripts/private-paths.json`, entry
> `.agents/skills/oura-native-ble/`). Do not restore it here, and do not grow this file into a
> substitute for it. The code that implements the protocol is ours and stays public: read it at the
> tag.

## 1. Where the protocol knowledge came from

**`open_oura`, the primary source.** [`Th0rgal/open_oura`](https://github.com/Th0rgal/open_oura) is
a community Rust CLI and library for the ring. We never vendored it: no submodule, no checkout in
the tree, only links. We took byte layouts from:

- `crates/oura-protocol/src/events.rs`, `decode_body` — the per-tag event decoders.
  `lib/oura-ble/decode.ts` is a byte-exact port. The re-audit against commit `c5106bd` found every
  upstream arm matched ([`oura-ble-open-oura-audit-2026-07-08.md`](oura-ble-open-oura-audit-2026-07-08.md)).
- The `oura-protocol` request builders and parsers (`req_set_feature_mode`, `req_get_event`,
  `req_set_realtime`, `req_sync_time`, `Battery::parse`, `EventBatchSummary::parse`), transcribed
  into `OuraProtocol.kt` with each source named in its KDoc.
- `crates/oura-link` (`ble.rs`, `client.rs`) for the scan/connect/auth sequence, and `oura-cli`'s
  `pair` command for installing a key.
- Its docs (`data-recovery-map.md`, `ring-features.md`, `ring-5-observations.md`) for which tags
  exist and which features must be switched on.

**Second sources.** [`LogosIsLife/open_ring`](https://github.com/LogosIsLife/open_ring)'s
`PROTOCOL.md` supplied the on-demand heart-rate burst that made live HR work
([ops §1 R7](oura-ble-operations.md)). `ringverse/protocol` was checked when cracking tags. The
reading order is the escalation list in [`oura-ble-feature-playbook.md`](oura-ble-feature-playbook.md).

**Captures.** We never sniffed the official app's traffic with our ring: the playbook forbids
re-onboarding our ring to capture it. Everything captured came off our own link:

- the Phase-0 corpus, 7,604 history events pulled by `open_oura` into its local SQLite on
  2026-07-07 and used as the ground truth for the decoder port
  ([phase-0 results §4, §8](superpowers/plans/2026-07-07-oura-direct-ble-phase-0-results.md));
- raw frame hex copied from the tester's diagnostics panel and pinned as unit-test vectors;
- Android HCI snoop logs, the diagnostic of record for connect-layer failures (ops §1 L2, §3 item 5).

**What was proven on the real ring.**

| What | When | Where it is recorded |
|---|---|---|
| Factory reset, our own key, auth, incremental history drain, decode (7,597 of 7,604 events, firmware 2.1.3) | 2026-07-07 | [Phase-0 results](superpowers/plans/2026-07-07-oura-direct-ble-phase-0-results.md) §1, §3.4 |
| The same protocol inside the APK on the S25: auth, MTU 247, held connection, auto-reconnect | 2026-07-07 | [Phase-2 results](superpowers/plans/2026-07-07-oura-ble-phase-2-results.md) §1–2 |
| Live HR through the burst command | 2026-07-09, v1.122.11 | ops §1 R7 |
| The ring emits no sleep stages or sleep summaries on this firmware | 2026-07-09 | [`oura-ble-sleep-staging-findings.md`](oura-ble-sleep-staging-findings.md) |

The decoders were validated against firmware 2.1.3 only. The firmware stayed frozen because
updates arrive through the official app (ops §1 R5, §3 item 1). Re-pairing with the Oura app may update
it.

## 2. Pairing and the key

- **Factory reset.** Done from the official Oura app; it needs no key and no protocol opcode
  (Phase-0 RE1; ops §3 item 3). It wipes anything not yet synced off the ring and restarts the ring's
  clock. A reset ring advertises a factory-state name; after pairing it shows the friendly name
  again (RE3), which makes a quick success check.
- **Setting the key.** Our app never writes a key to the ring. `open_oura pair`, run on a desktop
  with Bluetooth, installs a 16-byte key (the `SetAuthKey` operation) and saves it as `key.hex`,
  32 hex characters ([Phase-0 runbook](superpowers/plans/2026-07-06-oura-direct-ble-phase-0-runbook.md)
  Steps 0–4). On Windows the build needed three local patches (D1/D2 scan filter, D3 RNG; Phase-0
  results §3.1), never sent upstream.
- **Putting it on the phone.** Paste into `/admin/oura-ble` → **Ring key** → Save.
  `OuraBlePlugin.setKey` checks it is 32 hex (`OuraAuth.parseKeyHex`) and writes SharedPreferences
  file `oura_ble`, entry `key_hex`. Replacing it takes a native confirm; deleting it takes a typed
  `DELETE` plus a native confirm (RV-196, `ring-key-danger-zone.tsx`).
- **Challenge and response, on every connection.** After service discovery and notification
  subscription, `OuraGattClient.startAuth` asks for a nonce. The ring sends 15 bytes;
  `OuraAuth.encryptNonce` encrypts them with the key (AES/ECB/PKCS5, one 16-byte block) and the app
  sends the result back. The ring answers success or reject (`OuraProtocol.authSucceeded`). A wrong
  key logs `auth REJECTED — wrong key?`.
- **What the key does not do.** History frames travel unencrypted once the session is open; the
  key only gates the session. The server has decoded the whole archive without ever holding the key
  (ops §0), so re-reading stored data never needs it.
- **Where it lives.** Only on the phone (ops §0), excluded from Android backup since OR-160
  (`res/xml/backup_rules.xml`, `data_extraction_rules.xml`), never logged, never sent to the
  server. An uninstall on 2026-08-17 destroyed it and the ring stayed dark until the original
  `key.hex` turned up.
- **Backup.** `/admin/oura-ble` → Ring key → **Show key for backup** → **Copy** (`revealKey`, Q-537)
  into the owner's password manager. The owner confirmed holding `key.hex` on 2026-08-25
  ([`canonical-runtime-android.md`](canonical-runtime-android.md)).
- **The OS bond is a separate thing.** Android needs a "Just Works" bond before the encrypted
  notification subscription. On insufficient-authentication the client calls `createBond()` once
  (RE8, ops §1 L5). The first bond needs the ring awake on its charger, and the ring appears to hold
  one bond slot (RE7).

## 3. The protocol, as implemented

Read `OuraProtocol.kt` (pure, JVM-tested in `OuraProtocolTest.kt`), `OuraGattClient.kt`,
`OuraRingService.kt` and `lib/oura-ble/decode.ts` at the tag. In outline:

- **Finding the ring.** Scan on Oura's manufacturer id `0x02b2` plus the name, never on an address:
  the ring rotates its address every one to two minutes (RE2). Never add an OS service-UUID filter
  (D1/D2). The radio sleeps while worn and idle; movement or the charger wakes it (RE4). On Samsung,
  connect directly; `autoConnect=true` fails every time (ops §1 L3).
- **GATT.** One vendor service with a write characteristic and several notify characteristics, UUIDs
  at the top of `OuraProtocol.kt`. Request MTU 247, subscribe every notify/indicate characteristic
  in the service, and queue writes one at a time.
- **Framing.** Commands and responses are tag–length–payload with little-endian integers. Extended
  operations share one outer tag and carry a sub-op in the first payload byte (`parseFrame`). A tag
  of `0x41` or above is a history event: a 4-byte little-endian decisecond timestamp, then the body
  (`historyEventTimestamp`, `parseHistoryEvent`).
- **On connect** (`OuraRingService.onReady`): SyncTime in UTC seconds → enable notifications →
  battery → `enableMeasurementSequence()` (daytime HR, SpO₂, steps and exercise HR to automatic,
  fast-HR off) → drain three seconds later. After a re-key every measurement feature is off and the
  ring records only system events until this runs (ops §1 R3).
- **Time.** Events carry a decisecond counter since the ring's own epoch, not UTC (RE9, RE10). The
  server keeps `(ringDs ↔ utc)` anchors per epoch in `oura_ble_clock_anchors` (migrations 115, 161)
  and resolves wall time with `resolveDsToMs` in `lib/oura-ble/clock.ts`. A re-key or a dead
  battery starts a new epoch, which must be declared (`oura_ble_rekey_declarations`, migration 194).
- **History drain.** `reqGetHistory(cursor)` asks for up to 255 events after a cursor. The ring
  streams them, then a completion frame giving the bytes left, and the service loops until zero
  (`onDrainBatchComplete`). Each batch goes into the phone's `oura_raw.db`, rows and cursor in one
  transaction (`OuraRawDb.insertBatchAndAdvance`), and is then POSTed to `/api/oura-ble/samples`
  as a backup; a 2xx marks those rows `synced`. The service re-drains hourly and polls every five
  minutes.
- **Why the cursor moves only past stored events.** The ring's buffer is finite and the cursor only
  goes forward, so a span the cursor skips is never served again except by a full re-sync from
  zero, and not at all once the buffer wraps. The 2026-07-07 system review found the first build
  advancing on the ring's own batch completion, which loses the drained span
  ([BLE-1](reviews/2026-07-07-oura-ble-system-review.md)).
  The fix gated the cursor on the server's 2xx. Since 2026-07-27 (D2 Task 2) the gate is the local
  commit, with the server's 2xx kept only for a phone whose `oura_raw.db` cannot open (ops I22).
  `CLAUDE.md` and [`rules/oura-ble.md`](rules/oura-ble.md) still word it the older way; the ops doc
  is current. After one failed batch, later batches of that drain never advance it (ops I18).
  Re-sending costs nothing: the server dedups on `(user_id, ring_timestamp_ds, tag, body_hex)`.
- **Battery.** `reqBattery()` on connect and on every five-minute keepalive, which doubles as the
  drop detector. Polls land in `oura_ble_battery_poll` (migration 133).
- **Live streams.** The heart-rate burst (`dhrBurstSequence`, re-sent every 10 s by
  `lib/live-hr/oura-ring-source.ts`) and the accelerometer stream (`accelStartSequence`).
- **Decoders.** `decodeEventBody(tag, body)` handles about forty tags: temperatures, beat intervals
  and HR, HRV, the raw SpO₂ ratio (turned into a percentage by `lib/oura-ble/spo2.ts`), motion,
  activity and MET, sleep motion periods, bedtime period, wear and state text, feature sessions, and
  step features. A set marked `_status: "unvalidated"` matches upstream's own markers. It never
  throws: a try/catch returns `null`. The tag-to-name map is duplicated in Kotlin and
  `event-names-kotlin-parity.test.ts` fails CI on drift. Vectors are in
  `lib/__tests__/oura-ble-decode.test.ts`.

**The server archive.**

- `oura_raw_samples` (migration 114): one row per event, hex `body_hex`, unique on the dedup key.
  It is now a 7-day hot window; `decoded` is NULL by design (ops I15).
- `oura_raw_packed` (migration 191): one sealed `bytea` blob per `(user_id, epoch, tag, ds_bucket)`,
  where `ds_bucket` is one day of ring time (`ds / 864000`), with a `body_sha256`. The codec in
  `lib/oura-ble/frame-pack.ts` writes a version byte, a varint count and a varint base ds, then per
  frame a varint ds delta, a varint length and the body. The packer
  (`lib/data/postgres/slices/oura-raw-pack.ts`) deletes hot rows only after re-reading and unpacking
  the blob.
- Read frames only through `lib/data/postgres/slices/oura-raw-frames.ts`, which spans both tiers.
- Ingest drops a short list of debug and telemetry tags (`RAW_STORAGE_DROP_TAGS` in
  `lib/oura-ble/raw-storage.ts`).
- Never pruned or rewritten. The owner decided to keep it on 2026-09-28
  ([retention brief](oura-raw-archive-retention-brief.md)). A protocol fix ships as a decoder change
  plus a Redecode (`POST /api/oura-ble/samples/redecode`, always full history), never a re-drain.

## 4. What we built on top

The rollup (`aggregateOuraRawSamples` in `lib/oura-ble/rollup/run.ts`, run in a worker by
`lib/oura-ble/rollup-worker.ts`) turns raw frames into `sleep_sessions`, `body_metrics`,
`oura_heartrate` and `oura_daily`, stamped `oura_ble` in the ranked per-field merge
(`packages/shared/src/health/source-rank.ts`).

| Model | Code | Findings |
|---|---|---|
| Sleep window and stages | `packages/shared/src/health/sleep-staging.ts`; neural stager wrapper `lib/oura-models/inference/sleepnet.ts` | [`oura-ble-sleep-staging-findings.md`](oura-ble-sleep-staging-findings.md), [`domains/sleep/README.md`](domains/sleep/README.md) |
| HR series, HRV (rMSSD), resting HR | rollup; `packages/shared/src/health/hrv-5min.ts` | [`oura-ble-remaining-work.md`](oura-ble-remaining-work.md) |
| SpO₂ estimate | `lib/oura-ble/spo2.ts` | ops §4 step 5 |
| Steps, MET, activity | `packages/shared/src/health/step-estimate.ts`, `lib/oura-ble/step-*` | [steps plan](superpowers/plans/2026-07-09-oura-ble-steps.md) |
| Daytime stress, Body Battery | `lib/health/daytime-stress.ts`, `lib/health/body-battery-day.ts` | [`module-map.md`](module-map.md) |
| Breathing rate, wear time, temperature | `packages/shared/src/health/breathing-rate.ts`, rollup | [`domains/devices/README.md`](domains/devices/README.md) |

The models under `lib/oura-models/` load their assets from object storage
([`oura-asset-architecture.md`](oura-asset-architecture.md)); what those assets are and where they
came from is deliberately not recorded in this repository. What direct access gives that the API
does not is in [`architecture/scoring-layers-and-data-inputs.md`](architecture/scoring-layers-and-data-inputs.md) §11.

## 5. Lessons from the incidents

- **A decoder must never throw.** One bad frame once returned 500 for every later batch and wedged
  the cursor (ops I13). Unknown bytes return `null` and the raw row is kept.
- **Take byte layouts from the source, never memory.** A wrong byte decodes to plausible garbage.
  Count a feature done only when a non-null value lands in the database.
- **An ack is not proof.** The live-HR mode change acked and streamed nothing; the missing piece was
  a second write on another sub-op (ops R7, playbook stage 2).
- **Never re-onboard the official app while on Bluetooth.** It re-keys the ring and can update the
  firmware the decoders depend on (ops §0, §3 item 1). #2808 does exactly this, on purpose.
- **The key has one home.** Back it up before any uninstall or phone change (ops §0).
- **The cursor never jumps a hole** (ops I18), and **a re-drain looks like a clock reset.** Inferring
  re-keys from the counter re-timed the whole sleep history twice, by +12.17 h and +14.16 h (Q-314,
  Q-536). Declare re-keys instead.
- **Resolve time at read, through anchors.** Times stamped mid-drain were hours off (ops I14, I25).
- **Keep heavy work off the ingest request.** An inline rollup starved the connection pool and set
  off 499 retry storms (ops I19, I20, I26). Insert raw rows first; the rollup runs in a worker.
- **A hot-only frame read returns seven days** and looks like data loss (ops §5).
- **Mass `UPDATE`s on the raw table doubled it** and filled the disk on 2026-08-17; that is why the
  packer exists (migration 191 header).
- **Reset live-HR levers on connect.** A session killed mid-workout left fast HR on for good until
  connect started resetting it (ops R8, Q-388).
- **Samsung kills background services.** The battery exemption, `START_STICKY` and the boot receiver
  keep the service alive (ops L9, L10). After six failed connects, wait 15 minutes: a wedged radio
  recovers only with time (RE6, L4).
- **Kotlin changes need a new APK** and compile-check only in the sandbox. Only the device proves
  Bluetooth behaviour.

## 6. Where the code lives after it is removed

**Tag `v1.490.1`** (commit `0127b9d6`, 2026-10-14, the production release when this was written).
Every path below was checked with `git ls-tree -r --name-only v1.490.1`. Restore with
`git checkout v1.490.1 -- <path>`. Git history here starts at the 2026-08-16 public snapshot;
anything earlier is in the archived private repository.

- **Android plugin** — `android/app/src/main/java/com/trainingai/app/oura/`: `OuraProtocol.kt`,
  `OuraAuth.kt`, `OuraGattClient.kt`, `OuraRingService.kt`, `OuraRawDb.kt`, `OuraBlePlugin.kt`,
  `OuraBootReceiver.kt`. Tests: `android/app/src/test/java/com/trainingai/app/oura/`
  (`OuraProtocolTest.kt`, `OuraAuthTest.kt`, `OuraRawDbTest.kt`). Wiring: `MainActivity.java`
  (`registerPlugin`), `AndroidManifest.xml` (service and boot receiver),
  `res/xml/backup_rules.xml`, `res/xml/data_extraction_rules.xml`, `IngestUrlPolicy.kt`.
- **Bridge and app shell** — `lib/oura-ble/plugin.ts`, `lib/oura-ble/sync.ts`,
  `components/capacitor-native-init.tsx` (auto-start on open), `components/pull-to-sync.tsx`,
  `lib/live-hr/oura-ring-source.ts`.
- **Decoders and time** — `lib/oura-ble/decode.ts`, `clock.ts`, `spo2.ts`, `frame-pack.ts`,
  `raw-storage.ts`, `rollup-consumed-tags.ts`; tests `lib/__tests__/oura-ble-decode.test.ts` and
  `lib/oura-ble/__tests__/`.
- **Server ingest and archive** — `app/api/oura-ble/samples/route.ts` with `redecode/`, `pack/`,
  `raw/`, `summary/`; `app/api/oura-ble/rekey/`, `battery-poll/`, `rollup-watermark/`;
  `lib/data/postgres/slices/oura-raw-frames.ts`, `oura-raw-pack.ts`, `oura.ts`;
  `lib/data/postgres/adapter.ts` (insert and anchors); `lib/oura-ble/rollup/run.ts`,
  `rollup-worker.ts`, `rollup-debounce.ts`; migrations 114, 115, 133, 161, 184, 191, 194, 196.
- **Admin console** — `app/admin/oura-ble/page.tsx`; `components/oura-ble/oura-ble-debug.tsx`
  (key, Start/Stop, drains), `raw-store-status-console.tsx`, `rekey-declaration-card.tsx`,
  `ring-key-danger-zone.tsx`.
- **Docs** — [`rules/oura-ble.md`](rules/oura-ble.md), [`oura-ble-operations.md`](oura-ble-operations.md),
  [`oura-ble-feature-playbook.md`](oura-ble-feature-playbook.md),
  [`oura-ble-open-oura-audit-2026-07-08.md`](oura-ble-open-oura-audit-2026-07-08.md),
  [`oura-raw-archive-retention-brief.md`](oura-raw-archive-retention-brief.md), and
  `superpowers/plans/2026-07-06-oura-direct-ble-*` and `2026-07-07-oura-*` (feasibility, Phase-0
  runbook and results, Phase-2 results, Phase 3–4 results).

The tables stay in the database whatever happens to the code: `oura_raw_samples`,
`oura_raw_packed`, `oura_ble_clock_anchors`. Dropping any of them deletes data and needs the owner's
confirmation first.

## 7. How to do it again

Going back re-keys the ring. The official app loses the ring, Oura's cloud gets no new data from
it, and the Oura API connection goes stale: the reverse of the #2808 move. The firmware may by then
be newer than 2.1.3, so treat it as a full protocol re-validation (ops §3 item 2).

1. **Bring the code back.** Restore §6 from `v1.490.1` (or revert the removal PR) and the rules in
   `CLAUDE.md` and `docs/rules/oura-ble.md`. The Kotlin half needs a new APK. If the phone runs the
   native app in `mobile/` by then, port the plugin into it first: that app has no ring Bluetooth
   ([`native-testing.md`](native-testing.md)).
2. **Sync, then reset.** Let the Oura app sync fully so Oura's cloud holds everything up to the
   switch. Factory-reset the ring from the Oura app and remove it there.
3. **Build `open_oura`** on a computer with Bluetooth (Phase-0 runbook Steps 0–2). On Windows,
   reapply D1–D3 or boot Linux bare-metal. `oura scan` should list the ring under its
   factory-state name. Close the Oura app or turn off phone Bluetooth: the ring takes one central.
4. **Pair.** Run `oura pair`, following its `--help` and `crates/README.md` (the reset step is
   danger-gated). Save `key.hex` to the password manager at once. Check with
   `oura --key-file key.hex info`: it should report authenticated.
5. **Declare the re-key** before the phone drains anything: `/admin/oura-ble` step 6, re-key
   declaration (`POST /api/oura-ble/rekey`).
6. **Load the key on the phone.** Ring on its charger for the first bond, then `/admin/oura-ble` →
   Ring key → paste → Save → Start. Any older key is useless; replace it. Grant the battery
   exemption when the console asks.
7. **Verify auth.** Status reads Connected and the log shows `auth: SUCCESS`; `auth REJECTED` means
   the wrong key. **Feature status** queries daytime HR, SpO₂ and steps; the raw replies appear in
   the log as `feat resp` lines.
8. **Verify the drain.** Press **Full re-sync** and wait for the "Ring re-sync complete" notification.
   Then `/admin/oura-ble` step 3, **Verify what landed**: delivered and stored counts agree per
   biometric tag, `rawStoreOpen` is true, `lowDisk` is false, and the cursor advances (ops §4,
   steps 1–4).
9. **Check decoding against the archive.** Compare the fresh capture with the pre-switch frames
   (read through `oura-raw-frames.ts`): the per-tag mix, the share of unknown tags, nulls on tags
   that used to decode, and plausible HR and temperature (ops §3 item 2). Fix any drift in `decode.ts`
   with a captured-vector test, then Redecode.
10. **Turn the data back on.** Decide `oura_ble` against `oura_cloud` in `source-rank.ts`, disconnect
    or demote the API connector, run a full-history Redecode, and check the next morning's sleep,
    HRV and HR on Health (ops §4 step 5).
