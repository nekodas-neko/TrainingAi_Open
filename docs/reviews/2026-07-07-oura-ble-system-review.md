# Oura Direct-BLE System Review (2026-07-07)

Full review of the native BLE pipeline shipped across v1.116.0 → v1.117.4 (Phases 2–4,
results doc `docs/superpowers/plans/2026-07-07-oura-ble-phase-3-4-results.md`), covering:
data parity vs the old Oura Cloud path, the set-and-forget model, tester UI adequacy,
table/label/timestamp correctness, performance/production risk, efficiency, and
native-BLE techniques the pipeline should adopt. Every finding carries a file:line.

**Code reviewed:** `android/app/src/main/java/com/trainingai/app/oura/` (all 5 files),
`lib/oura-ble/{plugin,decode}.ts`, `components/oura-ble/oura-ble-debug.tsx`,
`components/capacitor-native-init.tsx`, `app/api/oura-ble/samples/{route,summary/route}.ts`,
migration 114, `adapter.ts` `insertOuraRawSamples`/`getOuraRawSampleSummary`, the
`oura-native-ble` skill, and the Cloud-path counterpart (`/api/oura/sync` wiring).

**Verdict up front:** the protocol layer is in excellent shape — decoders byte-pinned to
the Rust source with tests, infallible-decode + raw-hex archival, correct dedup, clean
auth/bond/reconnect logic with every on-device lesson encoded as a comment. The gaps are
all **pipeline plumbing above the protocol**: the drain cursor advances even when ingest
fails (BLE-1, real data loss), ingest only works while the admin tester screen is open
(BLE-2), and nothing maps raw samples into the product tables, so every health screen has
been silently frozen since the re-key (BLE-5). None of these are hard fixes; they are
queued as two plans (see §9).

---

## 1. Findings index

| ID | Severity | One-liner |
|---|---|---|
| BLE-1 | **Critical** | History cursor advances on ring completion, not on server ack — failed/absent ingest permanently loses drained events |
| BLE-2 | **High** | Ingest requires the `/admin/oura-ble` tester mounted in a live WebView — no background path exists |
| BLE-3 | **High** | Nothing maps `oura_raw_samples` → `body_metrics`/`sleep_sessions`; health screens frozen at re-key date |
| BLE-4 | **High** | Cloud sync still auto-fires 5+ places and reports "success" while structurally unable to return new data |
| BLE-5 | Medium | Wall-clock anchor is read-time and single-epoch; no `measured_at` stored per row |
| BLE-6 | Medium | No reboot recovery (no `BOOT_COMPLETED` receiver) and no CompanionDeviceManager — reconnect depends on app opens + a scan loop |
| BLE-7 | Medium | Per-frame Capacitor bridge emits + `emitStatus()` per frame — thousands of bridge crossings per drain |
| BLE-8 | Medium | Summary groups by `event_name`, so every undecoded tag collapses into one `unknown` row — can't see *which* tags need decoders |
| BLE-9 | Medium | `body_metrics` writes are `COALESCE` last-writer-wins with no `source` provenance — BLE-derived writes would fight manual/HC data (pre-existing Track-B finding, now load-bearing) |
| BLE-10 | Medium | Kotlin tests run nowhere in CI — the results doc's "they run in the Android CI check" claim is false; `ci.yml` has no gradle job |
| BLE-11 | Low | Tester lacks HRV/SpO₂/sleep tiles, a latest-decoded-payload inspector, cursor/`bytes_left` display |
| BLE-12 | Low | No drain-on-connect/periodic drain — "Sync now" is manual |
| BLE-13 | Low | Unbounded `oura_raw_samples` growth; `count(*)` summary polled every 2.5 s during a drain |
| BLE-14 | Low | Ring key in plain SharedPreferences (fine for spike; Keystore at product stage) |
| BLE-15 | Low | Connection priority never tuned — drain runs at the default ~50 ms interval; keepalive holds it there |
| BLE-16 | Low | SpO₂: `0x8b` r/PI stored but no Ring-5 → % coefficients; `0x6f` (direct %) decoder exists — confirm which the ring actually emits overnight |

---

## 2. Data parity — what the Cloud path gave us vs what BLE lands today

The ring is on our key (Option A): **the Oura Cloud stopped receiving data at the re-key**.
Parity therefore isn't "same fields, different transport" — the cloud's tier-2 outputs
(phone-computed scores) are *gone by design* and must be replaced by derivation from tier-1
raw events (skill §0). Current state, field by field:

| Old Cloud destination | Field(s) | BLE status today |
|---|---|---|
| `oura_daily` | readiness/sleep/activity **scores** + contributors | ❌ Gone (tier-2, computed by Oura's phone engine). Phase-5 `lib/health/*` scores are the replacement — by design, not a bug. |
| `oura_daily` | `temperature_deviation` | ⚠️ Derivable: temp events (`0x46/0x69/0x75`) decode fine; needs the personal-baseline state (nightly median − EMA baseline). Not built. |
| `oura_daily` | `active_calories`, activity times, MET minutes, steps | ❌ Blocked on undecoded tags: `0x50 activity_information`, `0x51/0x52 activity_summary`, `0x6b motion_period`. Raw bytes ARE being stored, so decoding later back-fills. |
| `sleep_sessions` | bedtime start/end, stage durations, efficiency, latency | ⚠️ Hypnogram decodes today (`0x4b/0x4e/0x5a` → deep/light/rem/awake). Session aggregation (stage nibbles → durations/efficiency/one row per night) not built; sleep summary tags `0x48/0x49/0x4c/0x4f` undecoded. |
| `sleep_sessions` / `body_metrics` | `hrv_ms` (avg rMSSD) | ⚠️ Derivable now — `0x5d hrv_event` decodes to `{hr_bpm[], rmssd_ms[]}` per 5 min. Mapping not built. |
| `body_metrics` | `resting_heart_rate` (lowest sleep HR) | ⚠️ Derivable now from sleep-window IBI/HR (`0x80/0x60`); `0x55 sleep_heart_rate` undecoded would make it cheaper. Mapping not built. |
| `body_metrics` | `spo2_pct` | ⚠️ `0x8b` r/PI decodes but Ring-5 r→% coefficients unknown (skill §8 has gen4/cooper only). `0x6f` decodes to direct % — **check overnight data for which tag the Ring 5 emits** (BLE-16). |
| `sleep_sessions` | `avg_heart_rate`, `lowest_heart_rate`, `restless_periods` | ⚠️ Derivable from IBI + motion events once sleep-session aggregation exists. |

**Format correctness of what IS decoded:** verified good. Decoders are ported byte-exact
from `open_oura`'s `events.rs` with 20 pinned vector tests (`lib/__tests__/oura-ble-decode.test.ts`);
IBI→HR uses the physiological 300–2000 ms guard; temps are range-validated i16 centi-°C;
HRV rmssd is u8 ms (0–255 — physiologically sufficient); sleep stages decode 2-bit nibbles
MSB-first. On-device verification saw HR 82 bpm / temp 37.00 °C — physiologically correct.
The unknown-tag path correctly stores raw hex with `decoded: null` (never throws), which
matters because **the raw `body_hex` column is now the only archival copy** — the ring's
history buffer is finite and the cursor only moves forward, so a decoder added later can
only back-fill via re-decode of stored hex, never by re-draining (see BLE-1's cousin rule
in the CLAUDE.md additions).

### The silent-staleness trap (BLE-4)

`/api/oura/sync` still auto-fires from `components/sync-provider.tsx:174` (≤1×/6h) and
manually from `health-content.tsx`, `session-select-content.tsx`, `more-content.tsx`,
`oura-section.tsx`, `exercise-detected-card.tsx`. Every call now succeeds (`200`, token
valid) but returns **zero new rows forever** — the cloud's data ends at the re-key. The
"Last synced N min ago" indicator in More therefore shows *fresh* while the underlying
readiness/HRV/sleep data is permanently frozen. Nothing tells the user their health
screens went blind on 2026-07-07. The fix (in the data-mapping plan): once BLE mapping
lands, stop scheduling the cloud sync when a BLE key is active, and re-point the freshness
indicator at the newest **measured** BLE sample.

---

## 3. Set-and-forget — the "rest and forget" model, audited step by step

What the user asked for: everything happens in the background, no interaction. Audit of
each link in that chain:

| Link | Status | Evidence |
|---|---|---|
| Ring records autonomously | ✅ | Features forced AUTOMATIC on every connect (`OuraRingService.onReady`, `OuraRingService.kt:194`) — the fix that made recording work. Ring buffers to its own history with no phone present. |
| Service auto-starts | ⚠️ Partial | Only on app open (`capacitor-native-init.tsx:79-92`). `START_STICKY` restarts after a system kill, but **nothing starts it after a reboot** — no `BOOT_COMPLETED` receiver exists (verified: no receivers in the manifest). Until the next app open, the phone doesn't even try to connect. |
| Reconnect when ring in range | ⚠️ Partial | Scan loop + backoff (5s→5min) + 15-min wedge cool-down works, but it's an app-driven scan loop, vulnerable to Samsung's aggressive battery management killing the foreground service overnight. CompanionDeviceManager is the sanctioned fix (§7). |
| History drains automatically | ❌ | `onReady()` never calls `startDrain()`; drain only fires from the tester's Sync-now/Drain buttons (`oura-ble-debug.tsx:150-156, 280`). |
| Drained events reach the server | ❌ | The **only** ingest path is the tester component's 2.5 s flush loop (`oura-ble-debug.tsx:117-132`) — it must be *mounted*, in a *foreground* WebView, with *network*. Any other screen, a backgrounded app, or a dead WebView = frames emitted to nobody (`notifyListeners` without listeners drops the event). |
| Failure recovery | ❌ | **BLE-1, the critical one.** The cursor persists forward on every ring `0x11` completion (`OuraRingService.kt:208-217`) regardless of whether anything was ingested. The tester also splices frames out of its buffer *before* the POST and drops them on failure (`oura-ble-debug.tsx:119`, catch at :131). The design claim "a failed POST just re-drains" is false today: the next drain starts from the already-advanced cursor and never re-sends the lost span. Concretely: tap Drain, navigate away mid-drain → cursor advances past thousands of events that no listener received. They remain on the ring until its ring-buffer overwrites them, but *we* will never request that span again. |

**Conclusion:** today the model is "wear and remember to open the tester screen daily".
The productionization plan's core move is to make the **native service** the whole
pipeline: drain on connect + periodically, POST batches itself (OkHttp; the WebView's
session cookie is readable via Android `CookieManager` since the WebView and app share the
cookie store — or a dedicated device token), and **advance the cursor only after a 2xx**.
That single change fixes BLE-1, BLE-2 and BLE-12 at once and removes the WebView from the
data path entirely — the phone syncs the ring even if the app UI is never opened.

---

## 4. Tables, labels, timestamps

- **Right table:** `oura_raw_samples` (migration 114) is the correct spike shape — one
  re-decodable row per event, raw hex + best-effort JSONB decode, deduped on
  `(user_id, ring_timestamp_ds, tag, body_hex)` so re-drains are idempotent (verified in
  session 216: re-POST stored 0). `user_id` scoping + `ON DELETE CASCADE` correct.
- **Labels:** `event_name` is stamped from the open_oura tag map at ingest and matches the
  Rust source. One flaw (BLE-8): the summary groups by `event_name`, so *all* unknown tags
  merge into a single `unknown` row (`adapter.ts:3301-3306`) — the tester can't show which
  tags still need decoders even though the `tag` column distinguishes them. Group by
  `(tag, event_name)` and label `unknown_0x77` style.
- **Timestamps:** the v1.117.4 anchoring is correct math (`measured_at = anchorUtc +
  (ring_ds − anchorDs) × 100ms`, slope fixed) and read-time derivation was the right
  no-migration call for the spike. Two hardening gaps (BLE-5), both already flagged in the
  results doc §4 and confirmed here:
  1. The anchor is valid **within one clock epoch** — a re-key or dead battery resets the
     ring clock and strands every older row (no way to distinguish epochs after the fact).
     Persist `(anchorDs, anchorUtcMs, epochId)` at connect time — right after SyncTime is
     acked is the ideal capture point, since that's when ring-clock ↔ wall-clock
     correspondence is freshest.
  2. No `measured_at` column: every consumer must re-derive from the anchor. Fine for one
     summary endpoint; wrong the moment product mapping (BLE-3) needs to bucket samples by
     user-local day. Stamp `measured_at` at ingest from the persisted anchor (keep
     `ring_timestamp_ds` as source of truth; `measured_at` is a derived convenience).
  3. Nit: `recorded_at` (ingest time) is honest as a name; keep it, don't overload it.
- **Timezone discipline:** nothing in the BLE path constructs local dates yet, so no
  `todayInTz()` violations — but the mapping work (BLE-3) will bucket by user-local day
  and must go through `lib/date-utils` from the start.

---

## 5. Performance & production risk

- **Bridge storm (BLE-7):** every history event crosses the Capacitor bridge as its own
  `ouraFrame` JSON event AND triggers a full `emitStatus()` (`OuraRingService.kt:234-237`)
  — a multi-thousand-event drain means ~2× that many bridge crossings + JSON
  serializations, plus a `setTagCounts` React state update per frame in the tester
  (`oura-ble-debug.tsx:98-101`). Works, but it's the slowest, most battery-expensive shape.
  Batch frames native-side (e.g. emit arrays of ≤100) and throttle status to ~1/s. Moving
  ingest native (§3) makes the bridge stream a debug-only concern anyway.
- **Drain throughput (BLE-15):** no `requestConnectionPriority` call anywhere. Android
  defaults to a ~50 ms connection interval; `CONNECTION_PRIORITY_HIGH` (7.5–15 ms) during
  a drain is a several-× throughput win, dropping back to `BALANCED`/`LOW_POWER` when
  idle-connected (battery). Cheap, standard, native-app table stakes.
- **Table growth (BLE-13):** IBI + HRV + SpO₂ + temp overnight ≈ thousands of rows/night,
  ~1–2 M rows/year at Ring-5 cadences. No retention. **Do NOT prune `body_hex`** — it is
  the archival protocol record (see §2). The pressure point is the summary's `count(*)` +
  two 200-row JSONB scans polled every 2.5 s during a drain; fine at spike volumes,
  wrong for a product screen. Product reads come from the mapped tables (BLE-3), keeping
  this summary admin-only; revisit retention only if raw volume becomes a real cost.
- **Ingest route:** properly guarded — admin-gated, Zod, 512 KB body cap, 120/min rate
  limit, ≤2000 frames/POST, server-side decode, batch insert with `onConflictDoNothing`.
  No issues found. (Rate-limit math: tester flushes ≤500 frames/2.5 s = 24 req/min max.)
- **Security:** key never leaves SharedPreferences and is never logged (`OuraBlePlugin.kt:31`
  comment holds — verified no log paths touch it). Plain-text SharedPreferences is
  acceptable for the spike (device-local, single user); move to Android Keystore /
  `EncryptedSharedPreferences` when this graduates (BLE-14). Auth fails closed
  (`authSucceeded` requires explicit `0x00`).
- **Concurrency:** the duplicate-start guard (`OuraRingService.kt:101`), stale-scan-result
  guard, `closed` flag, and the GATT op queue are all correct — the hard-won on-device
  lessons are properly encoded. One residual: `maxHistoryTsSeen`/`draining` are touched
  from GATT Binder threads and the main handler without synchronization; in practice
  callbacks arrive serialized enough, but moving frame handling onto the main handler
  would make it airtight (fold into the native-ingest rework, not its own fix).
- **CI gap (BLE-10):** `ci.yml` has no gradle job at all — `OuraProtocolTest.kt` runs only
  on the owner's machine, and the results doc §2's "they run in the Android CI check" is
  wrong. A protocol regression (e.g. someone re-orders `reqGetHistory` bytes) would merge
  green today. Add an Android CI job (JDK + `./gradlew :app:testDebugUnitTest`), and
  ideally an `assembleDebug` artifact upload so native changes stop depending on the
  owner's local toolchain for every rebuild.

---

## 6. Tester UI — is it good for verifying data?

Solid foundation: status pill, connect metrics, Sync-now one-tap, HR/temp/battery tiles,
per-metric cadence + wall-clock span (the data-quality proof), frame-name counters, and
the raw log behind Advanced. Gaps against the "show me what's being pulled, field names
and all" bar (BLE-11):

1. **No tiles for the other decoded metrics** — HRV (rmssd), SpO₂ (r/PI or %), sleep
   stages, wear state. If it's decoded, the tester should show its latest value.
2. **No decoded-payload inspector** — nothing shows an actual decoded JSON body
   (`{ibi_ms: […], hr_bpm: […]}`) with field names. A "latest sample per event type"
   expandable (tag, name, measured-at, decoded JSON, hex) turns the tester into the field
   verification tool the user is asking for.
3. **Unknown tags invisible** (BLE-8, server-side) — surface `unknown_0xNN × count`
   distinctly, ideally highlighted, since each is a decoder TODO.
4. **No cursor/drain progress** — `drainHistory()` returns the cursor but Sync-now
   discards it; `bytes_left` lives only in the log. Show "cursor → N · bytes left → M"
   during a drain, and the persisted cursor + anchor when idle.
5. **Session `sent` counters reset on remount** — fine, but label them "this visit" to
   avoid reading as totals.

---

## 7. Native-BLE techniques worth adopting (what a first-party ring app does)

- **CompanionDeviceManager (CDM)** — the headline one, already named in the results doc.
  Associate the ring once (`AssociationRequest` with the mfr-id scan filter), then
  `startObservingDevicePresence()`: the *OS* wakes the app when the ring's advertisement
  appears — no persistent scan loop, works through Doze, exempts the app from several
  background-execution limits, and is the mechanism Samsung's stack respects. This
  replaces most of the hand-rolled scan-loop/backoff machinery as the *trigger*; the
  existing GATT client remains the connector. Note CDM associations survive reboots,
  which pairs with the boot receiver (BLE-6).
- **Bonded-device reconnect without scanning:** after the RE8 bond, Android holds the
  ring's IRK and resolves its rotating RPA. `adapter.bondedDevices` yields a
  `BluetoothDevice` whose `connectGatt` works across address rotations — a scan-free
  reconnect path worth testing on the S25 (the "never by address" rule is about *scan
  filters* pre-bond, not bonded identity addresses). Caveat: Samsung's `autoConnect=true`
  misbehaviour is already proven on-device (v1.116.4), so test direct-connect-to-bonded
  first; CDM presence + direct connect is the conservative combo.
- **Connection-parameter tuning:** `requestConnectionPriority(HIGH)` for drains,
  `LOW_POWER` while idle-holding (BLE-15). Optionally `setPreferredPhy(2M)` on the S25.
- **Battery-optimization exemption:** Samsung's "sleeping apps" list will eventually kill
  any long-lived foreground service. One-time prompt via
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + a device-checklist entry ("add
  TrainingAI to Never sleeping apps") is the pragmatic pairing.
- **Keep-the-link discipline during testing** (already right, worth writing down): the
  ring's radio sleeps when worn-idle (RE4) — on-charger keeps it advertising; the 5-min
  battery keepalive is a link-liveness probe, not a battery cost; expect and tolerate
  drops (reconnect is the feature being tested, not an error).
- **HCI snoop log** (already recommended in v1.116.4) remains the diagnostic of record for
  any new connect-failure signature.

## 8. Efficiency opportunities (beyond the above)

- Auto-drain scheduling: drain on `onReady` (after the feature-enable acks) + re-drain on
  each keepalive tick if `bytes_left > 0` was last seen, instead of a user tap. The ring
  buffers regardless, so cadence is a freshness choice, not a durability one — **once
  cursor advance is ack-gated** (BLE-1 fix).
- Batch bridge emissions (BLE-7) even after native ingest lands — the tester's live frame
  view should survive, just cheaper.
- The summary endpoint's five queries could collapse to two (`byName` + one windowed
  scan) — only worth doing when the tester grows the inspector panel anyway.
- `pendingFrames` in the tester is unbounded while offline — after native ingest this
  buffer disappears; until then it's capped-by-drain-size, acceptable.

---

## 9. Where the fixes land

Two plans queued in `docs/implementation-backlog.md` (this session, docs-only PR):

1. **`2026-07-07-oura-ble-durable-background-sync.md`** — the native rework: ack-gated
   cursor, native-side HTTP ingest, auto-drain, boot receiver, CDM presence, connection
   priority, bridge batching. Fixes BLE-1, -2, -6, -7, -12, -15. Queue #1 — it's the
   difference between a demo and the product model the user asked for.
2. **`2026-07-07-oura-ble-data-mapping-and-tester.md`** — server/JS: persisted per-epoch
   anchor + stored `measured_at`, redecode path, unknown-tag surfacing, tester inspector +
   metric tiles, then the product mapping into `body_metrics`/`sleep_sessions` with
   `source` provenance and the cloud-sync cutover. Fixes BLE-3, -4, -5, -8, -9, -11, -13,
   -16.

BLE-10 (Android CI job) rides in plan 1 (it gates every native change the plan makes).
BLE-14 (Keystore) is noted in plan 1 as a product-stage step, deliberately deferred.

CLAUDE.md gains an Oura Direct-BLE section (same PR as this review) so the durable rules
— cursor-ack discipline, body_hex archival, source-of-truth-is-the-Rust-source, device-only
verification — outlive this doc.
