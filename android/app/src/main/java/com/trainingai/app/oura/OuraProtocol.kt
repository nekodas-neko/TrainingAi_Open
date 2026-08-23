package com.trainingai.app.oura

import java.util.UUID

/** Wire protocol for the Oura Ring (skill §2–§5 + open_oura's oura-protocol crate).
 *  Pure — no Android imports — so every builder/parser is unit-testable on the JVM.
 *  Frames are tag–length–payload, multi-byte integers little-endian; extended ops
 *  use outer tag 0x2f with the first payload byte as the sub-op. */
object OuraProtocol {
    val RING_SERVICE: UUID = UUID.fromString("98ed0001-a541-11e4-b6a0-0002a5d5c51b")
    val WRITE_CHAR: UUID = UUID.fromString("98ed0002-a541-11e4-b6a0-0002a5d5c51b")
    val NOTIFY_CHAR: UUID = UUID.fromString("98ed0003-a541-11e4-b6a0-0002a5d5c51b")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val MANUFACTURER_ID = 0x02b2
    const val PREFERRED_MTU = 247 // Ring 5 (skill §2)

    /** First tag value carried by ring history events (`0x41`); everything `>=`
     *  this is a history-event frame rather than a command response. */
    const val HISTORY_EVENT_PREFIX = 0x41

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    fun reqNonce() = bytes(0x2f, 0x01, 0x2b)
    fun reqAuthenticate(encryptedNonce: ByteArray): ByteArray {
        require(encryptedNonce.size == 16)
        return bytes(0x2f, 0x11, 0x2d) + encryptedNonce
    }
    fun reqBattery() = bytes(0x0c, 0x00)
    fun reqFirmwareVersion() = bytes(0x08, 0x03, 0x00, 0x00, 0x00)
    fun reqSerialNumber() = bytes(0x18, 0x03, 0x08, 0x00, 0x10)
    fun reqEnableAllNotifications() = bytes(0x1c, 0x01, 0x3f)

    /** BLE fast-HR mode (`16 01 01` / `16 01 00`). Documented in the Ring-3
     *  cheatsheet (skill §5) but NOT present in open_oura's Rust request builders
     *  — its live-HR path uses only `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)`.
     *  Kept as an optional lever to test on-device; not part of any auto sequence. */
    fun reqBleFastHrMode(fast: Boolean) = bytes(0x16, 0x01, if (fast) 0x01 else 0x00)

    /** SyncTime `12 09 <u64 LE UTC seconds> <tz>` — MUST precede any stateful op
     *  (RE10). Trailing byte is the timezone in half-hours; 0 = UTC, matching
     *  open_oura's `sync_time()` (`req_sync_time(now, 0)`). */
    fun reqSyncTime(utcSeconds: Long): ByteArray {
        val out = ByteArray(11)
        out[0] = 0x12; out[1] = 0x09
        for (i in 0 until 8) out[2 + i] = ((utcSeconds ushr (8 * i)) and 0xff).toByte()
        out[10] = 0x00
        return out
    }

    data class Frame(val tag: Int, val subOp: Int?, val payload: ByteArray)

    /** One notification → one frame; null on malformed input (infallible-decoder rule, RE11).
     *  Deviation from open_oura's lenient `Packet::parse` (which salvages a truncated frame's
     *  trailing bytes): we return null when the declared length exceeds the buffer, treating a
     *  truncated frame as malformed. Padded frames (extra trailing bytes) still parse — we slice
     *  exactly `len`. */
    fun parseFrame(raw: ByteArray): Frame? {
        if (raw.size < 2) return null
        val tag = raw[0].toInt() and 0xff
        val len = raw[1].toInt() and 0xff
        if (raw.size < 2 + len) return null
        val payload = raw.copyOfRange(2, 2 + len)
        val subOp = if (tag == 0x2f && payload.isNotEmpty()) payload[0].toInt() and 0xff else null
        return Frame(tag, subOp, payload)
    }

    fun isNonceResponse(f: Frame) = f.tag == 0x2f && f.subOp == 0x2c && f.payload.size >= 16
    fun nonceFrom(f: Frame): ByteArray = f.payload.copyOfRange(1, 16)
    fun authSucceeded(f: Frame) =
        f.tag == 0x2f && f.subOp == 0x2e && f.payload.size >= 2 && f.payload[1].toInt() == 0x00

    // ---- transcribed from open_oura crates/oura-protocol (Task 1) ----

    object FeatureId { const val DAYTIME_HR = 0x02; const val EXERCISE_HR = 0x03; const val SPO2 = 0x04; const val REAL_STEPS = 0x0b }
    object FeatureMode { const val OFF = 0x00; const val AUTOMATIC = 0x01; const val REQUESTED = 0x02; const val CONNECTED_LIVE = 0x03 }

    /** Real-time measurement bitmask flags for `req_set_realtime` (`realtime` mod). */
    object Realtime { const val ACM = 0x20 }

    /** SetFeatureMode: `2f 03 22 <feature> <mode>` (open_oura `req_set_feature_mode`). */
    fun reqSetFeatureMode(featureId: Int, mode: Int): ByteArray = bytes(0x2f, 0x03, 0x22, featureId, mode)

    /** GetFeatureStatus: `2f 02 20 <feature>` (open_oura `req_feature_status`). */
    fun reqFeatureStatus(featureId: Int): ByteArray = bytes(0x2f, 0x02, 0x20, featureId)

    /** DHR on-demand burst sub-mode write: `2f 03 26 02 02` — the "measure now" step.
     *  Same `2f 03` extended-write frame as SetFeatureMode but a DIFFERENT sub-op (`0x26`,
     *  not `0x22`): writes DAYTIME_HR (`0x02`) sub-mode `0x02`. Per open_ring's PROTOCOL.md
     *  (static RE of the official app), this is what actually starts the ring bursting HR;
     *  `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)` alone acks but does not stream. The ring
     *  auto-reverts after ~20 s, so the burst is re-triggered on a ~15 s cadence. Emits
     *  `0x80`/`0x60` IBI events (decoded to HR). Unvalidated on our ring until on-device. */
    fun reqDhrBurstSubMode(): ByteArray = bytes(0x2f, 0x03, 0x26, FeatureId.DAYTIME_HR, 0x02)

    /** Full "measure now" trigger: enable DHR live mode, then the `0x26` burst sub-mode.
     *  Idempotent — safe to re-send every ~15 s to keep the ring engaged. */
    fun dhrBurstSequence(): List<ByteArray> = listOf(
        reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.CONNECTED_LIVE),
        reqDhrBurstSubMode(),
    )

    /** GetHistory `10 09 <cursor u32 LE> ff ff ff ff ff` — `req_get_event(cursor, 255, -1)`
     *  (start = leading u32 LE, max_events = 255, flags = -1 = all types). open_oura's
     *  `drain_events` uses 255 per request; the service loops until bytes_left == 0. */
    fun reqGetHistory(cursorDeciseconds: Long): ByteArray {
        val out = ByteArray(11)
        out[0] = 0x10; out[1] = 0x09
        for (i in 0 until 4) out[2 + i] = ((cursorDeciseconds ushr (8 * i)) and 0xff).toByte()
        out[6] = 0xff.toByte() // max_events = 255
        for (i in 7..10) out[i] = 0xff.toByte()
        return out
    }

    /** Enable background measurement recording — set DAYTIME_HR, SPO2 and REAL_STEPS to
     *  AUTOMATIC so the ring measures on its own schedule and writes HR/temp/SpO₂ and step
     *  events to its history. After a key-only re-key these features are OFF, so the ring
     *  records only system/debug events until this runs (open_oura's `features --enable-hr
     *  --enable-spo2` = `set_feature_mode(DAYTIME_HR|SPO2, AUTOMATIC)`). REAL_STEPS (`0x0b`)
     *  is server-gated off by default and is what makes the ring emit the `0x7e`/`0x7f` step
     *  events at all — open_oura enabled it over the wire on their Ring 5 (SUCCESS). Passive
     *  (no sensor power cost, unlike the DHR burst), so it rides the AUTOMATIC connect enable
     *  alongside HR/SpO₂. Idempotent.
     *
     *  The last two entries are **resets, not enables** (Q-388). `liveHrStartSequence()` puts
     *  EXERCISE_HR into CONNECTED_LIVE and turns on BLE fast-HR mode; only `liveHrStopSequence()`
     *  undoes them, and any live-HR session that never reaches it — app killed mid-workout, the
     *  service killed by Samsung battery management (failure L9 in `docs/oura-ble-operations.md`),
     *  or the admin tester's **Live HR** pressed without **Stop HR** — leaves continuous fast-HR
     *  sampling on **permanently**. The ring holds that state across reconnects, app restarts and
     *  service restarts, so nothing heals it. Connect is the one path guaranteed to run, which is
     *  why the reset belongs here rather than in more stop paths. Both writes are idempotent and
     *  cost one BLE frame each on a connection that is already sending three. */
    fun enableMeasurementSequence(): List<ByteArray> = listOf(
        reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.AUTOMATIC),
        reqSetFeatureMode(FeatureId.SPO2, FeatureMode.AUTOMATIC),
        reqSetFeatureMode(FeatureId.REAL_STEPS, FeatureMode.AUTOMATIC),
        reqSetFeatureMode(FeatureId.EXERCISE_HR, FeatureMode.AUTOMATIC),
        reqBleFastHrMode(false),
    )

    /** Start a time-boxed real-time stream: `06 07 <bitmask u32 LE> <minutes u16 LE> <delay u8>`
     *  (open_oura `req_set_realtime`). */
    fun reqSetRealtime(bitmask: Int, durationMinutes: Int, delay: Int): ByteArray {
        val out = ByteArray(9)
        out[0] = 0x06; out[1] = 0x07
        for (i in 0 until 4) out[2 + i] = ((bitmask ushr (8 * i)) and 0xff).toByte()
        out[6] = (durationMinutes and 0xff).toByte()
        out[7] = ((durationMinutes ushr 8) and 0xff).toByte()
        out[8] = (delay and 0xff).toByte()
        return out
    }

    /** Stop all real-time measurements: `06 04 00 00 00 00` (open_oura `req_realtime_off`). */
    fun reqRealtimeOff(): ByteArray = bytes(0x06, 0x04, 0x00, 0x00, 0x00, 0x00)

    data class Battery(val percent: Int, val charging: Boolean)
    /** Battery response `0d <len> <percent> <charging_progress> <charging_recommended> …`
     *  (open_oura `Battery::parse`: percent = payload[0], charging_progress = payload[1]). */
    fun parseBattery(f: Frame): Battery? {
        if (f.tag != 0x0d || f.payload.size < 3) return null
        return Battery(f.payload[0].toInt() and 0xff, (f.payload[1].toInt() and 0xff) > 0)
    }

    data class HistoryCompletion(val eventsReceived: Int, val bytesLeft: Long)
    /** History-batch completion `11 <len> <events_received> <sleep_progress> <bytes_left u32 LE> …`
     *  (open_oura `EventBatchSummary::parse`). */
    fun parseHistoryCompletion(f: Frame): HistoryCompletion? {
        if (f.tag != 0x11 || f.payload.size < 6) return null
        val p = f.payload
        val bytesLeft = (p[2].toLong() and 0xff) or
            ((p[3].toLong() and 0xff) shl 8) or
            ((p[4].toLong() and 0xff) shl 16) or
            ((p[5].toLong() and 0xff) shl 24)
        return HistoryCompletion(p[0].toInt() and 0xff, bytesLeft)
    }

    /** A history-event frame carries a 4-byte little-endian deciseconds timestamp
     *  as the first payload bytes (skill §8). Used to advance the sync cursor
     *  (RE9). Null for non-history frames or a short payload. */
    fun historyEventTimestamp(f: Frame): Long? {
        if (f.tag < HISTORY_EVENT_PREFIX || f.payload.size < 4) return null
        val p = f.payload
        return (p[0].toLong() and 0xff) or
            ((p[1].toLong() and 0xff) shl 8) or
            ((p[2].toLong() and 0xff) shl 16) or
            ((p[3].toLong() and 0xff) shl 24)
    }

    /** Tag → event name, mirroring `EVENT_NAMES` in `lib/oura-ble/decode.ts`. Duplicated
     *  across the language boundary only because the native store has to name a row before
     *  any JS runs; `lib/oura-ble/__tests__/event-names-kotlin-parity.test.ts` reads this map
     *  out of this file and fails CI if the two ever drift. The TS map stays the authority —
     *  add a tag there first. */
    private val EVENT_NAMES: Map<Int, String> = mapOf(
        0x41 to "ring_start", 0x42 to "time_sync", 0x43 to "debug_event", 0x44 to "ibi_event",
        0x45 to "state_change", 0x46 to "temp_event", 0x47 to "motion_event", 0x48 to "sleep_period_information",
        0x49 to "sleep_summary_1", 0x4a to "ppg_amplitude", 0x4b to "sleep_phase_information",
        0x4c to "sleep_summary_2", 0x4d to "ring_sleep_feature_information", 0x4e to "sleep_phase_details",
        0x4f to "sleep_summary_3", 0x50 to "activity_information", 0x51 to "activity_summary_1",
        0x52 to "activity_summary_2", 0x53 to "wear_event", 0x54 to "recovery_summary", 0x55 to "sleep_heart_rate",
        0x56 to "alert_event", 0x57 to "ring_sleep_feature_information_2", 0x58 to "sleep_summary_4",
        0x59 to "eda_event", 0x5a to "sleep_phase_data", 0x5b to "ble_connection",
        0x5c to "user_information", 0x5d to "hrv_event", 0x5e to "self_test_event", 0x5f to "raw_acm_event",
        0x60 to "ibi_and_amplitude_event", 0x61 to "debug_data", 0x62 to "on_demand_meas",
        0x63 to "ppg_peak_event", 0x64 to "raw_ppg_event", 0x65 to "on_demand_session",
        0x66 to "on_demand_motion", 0x67 to "raw_ppg_summary", 0x68 to "raw_ppg_data",
        0x69 to "temp_period", 0x6a to "sleep_period_information_2", 0x6b to "motion_period",
        0x6c to "feature_session", 0x6d to "meas_quality_event", 0x6e to "spo2_ibi_and_amplitude_event",
        0x6f to "spo2_event", 0x70 to "spo2_smoothed_event",
        0x71 to "green_ibi_and_amplitude_event", 0x72 to "sleep_acm_period", 0x73 to "ehr_trace_event",
        0x74 to "ehr_acm_intensity_event", 0x75 to "sleep_temp_event", 0x76 to "bedtime_period",
        0x77 to "spo2_dc_event", 0x79 to "self_test_data_event", 0x7a to "tag_event",
        0x7e to "real_step_event_feature_1", 0x7f to "real_step_event_feature_2",
        0x80 to "green_ibi_quality_event", 0x81 to "cva_raw_ppg_data", 0x82 to "scan_start",
        0x83 to "scan_end", 0x84 to "ambient_event", 0x86 to "aohr_event", 0x87 to "atlas_metadata",
        0x88 to "atlas_raw_bioz_data", 0x8b to "spo2_r_pi_event",
    )

    fun eventName(tag: Int): String = EVENT_NAMES[tag] ?: "unknown"

    /** Hex → bytes; null on odd length or a non-hex character (infallible-decoder rule, RE11). */
    fun hexToBytes(hex: String): ByteArray? {
        if (hex.length % 2 != 0) return null
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(hex[i * 2], 16)
            val lo = Character.digit(hex[i * 2 + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** A history event split the same way the server splits it (`parseHistoryEvent` in
     *  `lib/oura-ble/decode.ts`): the leading 4 bytes are the deciseconds timestamp and
     *  `bodyHex` is everything after them, so a native row and a server row for the same
     *  frame are byte-identical and dedup against each other. */
    data class HistoryEvent(val ringTs: Long, val tag: Int, val name: String, val bodyHex: String)

    /** Frame hex → history event, or null when the frame is malformed or is a command
     *  response rather than a history event. Never throws — an undecodable frame is skipped,
     *  it does not fail the batch it arrived in. */
    fun historyEventFromHex(frameHex: String): HistoryEvent? {
        val raw = hexToBytes(frameHex) ?: return null
        val frame = parseFrame(raw) ?: return null
        if (frame.tag < HISTORY_EVENT_PREFIX) return null
        val ts = historyEventTimestamp(frame) ?: return null
        return HistoryEvent(ts, frame.tag, eventName(frame.tag), bytesToHex(frame.payload.copyOfRange(4, frame.payload.size)))
    }

    /** Live-HR start. open_oura's `OuraClient::live_heart_rate` sends ONLY
     *  `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)` — but on our re-keyed Ring 5 that
     *  acks (`0x2f`) and then streams zero HR frames (confirmed on-device 2026-07-09:
     *  Frames=1/tag 0x2f, HR frames=0, worn+moving). So this "aggressive" sequence
     *  adds the two remaining grounded levers to coax the ring into streaming:
     *  EXERCISE_HR (`0x03`, the workout HR trace) also into CONNECTED_LIVE, and the
     *  Ring-3-cheatsheet BLE fast-HR mode (`16 01 01`). All three builders are pinned
     *  to the skill/open_oura layouts; only their *effect* on this ring is unproven —
     *  the admin tester exposes each lever individually to isolate which one works. */
    fun liveHrStartSequence(): List<ByteArray> = listOf(
        reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.CONNECTED_LIVE),
        reqSetFeatureMode(FeatureId.EXERCISE_HR, FeatureMode.CONNECTED_LIVE),
        reqBleFastHrMode(true),
    )
    /** Restore the ring to its normal recording state (reverse of the start sequence). */
    fun liveHrStopSequence(): List<ByteArray> = listOf(
        reqBleFastHrMode(false),
        reqSetFeatureMode(FeatureId.EXERCISE_HR, FeatureMode.AUTOMATIC),
        reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.AUTOMATIC),
    )
    fun accelStartSequence(): List<ByteArray> =
        listOf(reqSetRealtime(Realtime.ACM, 5, 0))
    fun accelStopSequence(): List<ByteArray> =
        listOf(reqRealtimeOff())
}
