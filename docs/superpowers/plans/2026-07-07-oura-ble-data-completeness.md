# Oura Direct-BLE — Data Completeness Audit (2026-07-07)

**This is an audit/reference, not a new plan.** The implementation work it points to is
already queued: **backlog item 1** (`2026-07-07-oura-ble-durable-background-sync.md`, capture
durability) and **backlog item 2** (`2026-07-07-oura-ble-data-mapping-and-tester.md`, decode +
product mapping). This doc answers "do we have access to everything the ring produces?" and
gives item 2 its concrete decoder TODO list (the event-type inventory).

---

## Answer: are we capturing everything?

**Raw capture — yes (after the durability fix).** The tester forwards every history event
(`tag >= 0x41`) and — as of the ack-gated-cursor fix (this session) — the ring's resume cursor
only advances past events the server has durably stored, with a **Full re-sync** to re-pull the
whole ring buffer. So the raw bytes of every event the ring emits land in
`oura_raw_samples.body_hex`, re-decodable, nothing silently dropped.
*(The set-and-forget endgame — native-side HTTP ingest so it works without the tester screen
mounted — is the rest of backlog item 1.)*

**Decoding — partial.** We structure ~13 of ~44 event types into `decoded` JSONB. The rest are
captured raw but unparsed, including **steps / activity / MET, sleep summaries, and sleep-HR**.
Because raw is stored, decoders can be added later and backfilled via a `redecode` pass without
re-syncing the ring (backlog item 2, Chunk 2/3).

**Blocker for the remaining decoders:** the byte layouts are not in any doc — they live in
open_oura's Rust `oura-protocol::events::decode_body` (skill §8). `Th0rgal/open_oura` is not in
this repo; adding it (or the decompiled `.so`) is the prerequisite for item 2's decode work.
Guessing layouts is disallowed (verify-against-source rule).

---

## Event-type inventory (the decoder TODO for backlog item 2)

✅ decoded · ⬜ captured raw, decoder TODO · 🔒 likely gated/unreachable over BLE · ⚙️ system.

| tag | event | status | feeds |
|---|---|---|---|
| 0x42 | time_sync | ✅ | clock anchor |
| 0x46 / 0x69 / 0x75 | temp_event / temp_period / sleep_temp_event | ✅ | temperature |
| 0x5d | hrv_event | ✅ | HRV (RMSSD) |
| 0x60 / 0x80 | ibi_and_amplitude / green_ibi_quality | ✅ | heart rate |
| 0x6f / 0x8b | spo2_event / spo2_r_pi_event | ✅ | SpO₂ |
| 0x4b / 0x4e / 0x5a | sleep_phase_information / _details / _data | ✅ | hypnogram |
| 0x45 / 0x53 | state_change / wear_event | ✅ | wear state |
| 0x43 / 0x61 | debug_event / debug_data | ✅ | diagnostics, battery |
| **0x55** | **sleep_heart_rate** | ⬜ | **sleep HR** |
| **0x49 / 0x4c / 0x4f** | **sleep_summary_1 / _2 / _3** | ⬜ | **sleep efficiency / latency / durations** |
| **0x48** | sleep_period_information | ⬜ | sleep timing |
| **0x76** | bedtime_period | ⬜ | bedtime window |
| **0x4d** | ring_sleep_feature_information | ⬜ | sleep features |
| **0x50** | **activity_information** | ⬜ | **activity / steps** |
| **0x51 / 0x52** | **activity_summary_1 / _2** | ⬜ | **steps, MET, calories** |
| **0x5f** | **raw_acm_event** | ⬜ | **raw accelerometer (MET/steps source)** |
| **0x6b / 0x72 / 0x74** | motion_period / sleep_acm_period / ehr_acm_intensity | ⬜ | **MET / intensity** |
| **0x47** | motion_event | ⬜ | motion |
| **0x54** | recovery_summary | ⬜ | recovery |
| **0x59** | eda_event | ⬜ | EDA / stress |
| 0x44 / 0x6e / 0x71 | ibi_event / spo2_ibi_and_amplitude / green_ibi_and_amplitude | ⬜ | HR / SpO₂ variants |
| 0x4a | ppg_amplitude | ⬜ | signal quality |
| 0x5c | user_information | ⬜ | profile |
| 0x41 / 0x5b / 0x82 / 0x83 | ring_start / ble_connection / scan_start / scan_end | ⚙️ | — |
| 0x81 | cva_raw_ppg_data | 🔒 | raw PPG (entitlement-locked) |
| 0x0b / 0x0c | REAL_STEPS / EXPERIMENTAL | 🔒 | server-gated |

**Decode priority (feeds backlog item 2):** ① sleep summaries + sleep-HR (0x49/0x4c/0x4f/0x55/0x48/0x76);
② activity/steps/MET (0x50/0x51/0x52/0x5f/0x72/0x74/0x6b/0x47); ③ recovery/EDA/HR-SpO₂ variants.

**Steps caveat:** true step count may be gated behind `REAL_STEPS` (0x0b, 🔒). If so, we derive
activity ourselves from `raw_acm_event` (0x5f) motion — the Phase-5 "our own scores" path
(skill §9), not a decode.

---

## Related docs
- Pipeline/architecture + file inventory: `2026-07-07-oura-ble-phase-3-4-results.md`.
- Capture durability (item 1): `2026-07-07-oura-ble-durable-background-sync.md`.
- Decode + product mapping (item 2): `2026-07-07-oura-ble-data-mapping-and-tester.md`.
- System review that first flagged the cursor bug: `docs/reviews/2026-07-07-oura-ble-system-review.md` (BLE-1..4).
