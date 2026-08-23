package com.trainingai.app.oura

import org.junit.Assert.*
import org.junit.Test

class OuraProtocolTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun documentedCommandBytes() {
        assertEquals("2f012b", hex(OuraProtocol.reqNonce()))
        assertEquals("0c00", hex(OuraProtocol.reqBattery()))
        assertEquals("0803000000", hex(OuraProtocol.reqFirmwareVersion()))
        assertEquals("1803080010", hex(OuraProtocol.reqSerialNumber()))
        assertEquals("1c013f", hex(OuraProtocol.reqEnableAllNotifications()))
        assertEquals("160101", hex(OuraProtocol.reqBleFastHrMode(true)))
        assertEquals("160100", hex(OuraProtocol.reqBleFastHrMode(false)))
    }

    @Test fun authenticateWrapsEncryptedNonce() {
        val enc = ByteArray(16) { 0xAA.toByte() }
        val req = OuraProtocol.reqAuthenticate(enc)
        assertEquals("2f112d" + "aa".repeat(16), hex(req))
    }

    @Test fun syncTimeIsLittleEndianU64WithTrailingZero() {
        // 0x0102030405060708 LE = 08 07 06 05 04 03 02 01
        val req = OuraProtocol.reqSyncTime(0x0102030405060708L)
        assertEquals("1209" + "0807060504030201" + "00", hex(req))
    }

    @Test fun parsesSimpleFrame() {
        val f = OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x02, 0x55, 0x01))!!
        assertEquals(0x0d, f.tag)
        assertNull(f.subOp)
        assertEquals("5501", hex(f.payload))
    }

    @Test fun parsesExtendedFrameWithSubOp() {
        // nonce response: 2f 10 2c <15 bytes>
        val raw = byteArrayOf(0x2f, 0x10, 0x2c) + ByteArray(15) { it.toByte() }
        val f = OuraProtocol.parseFrame(raw)!!
        assertEquals(0x2f, f.tag)
        assertEquals(0x2c, f.subOp)
        assertTrue(OuraProtocol.isNonceResponse(f))
        assertEquals(15, OuraProtocol.nonceFrom(f).size)
        assertEquals(0x00, OuraProtocol.nonceFrom(f)[0].toInt())
        assertEquals(0x0e, OuraProtocol.nonceFrom(f)[14].toInt())
    }

    @Test fun recognisesAuthResult() {
        val ok = OuraProtocol.parseFrame(byteArrayOf(0x2f, 0x02, 0x2e, 0x00))!!
        val bad = OuraProtocol.parseFrame(byteArrayOf(0x2f, 0x02, 0x2e, 0x01))!!
        assertTrue(OuraProtocol.authSucceeded(ok))
        assertFalse(OuraProtocol.authSucceeded(bad))
    }

    @Test fun malformedFramesReturnNull() {
        assertNull(OuraProtocol.parseFrame(byteArrayOf()))
        assertNull(OuraProtocol.parseFrame(byteArrayOf(0x0d)))
        assertNull(OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x05, 0x01))) // declared len > actual
    }

    // ---- ported builders (Task 5), pinned to open_oura's oura-protocol crate ----

    @Test fun setFeatureModeMatchesRustBuilder() {
        // req_set_feature_mode(DAYTIME_HR=0x02, CONNECTED_LIVE=0x03) = 2f 03 22 02 03
        assertEquals("2f03220203", hex(OuraProtocol.reqSetFeatureMode(
            OuraProtocol.FeatureId.DAYTIME_HR, OuraProtocol.FeatureMode.CONNECTED_LIVE)))
        // AUTOMATIC restore
        assertEquals("2f03220201", hex(OuraProtocol.reqSetFeatureMode(
            OuraProtocol.FeatureId.DAYTIME_HR, OuraProtocol.FeatureMode.AUTOMATIC)))
    }

    @Test fun featureStatusMatchesRustBuilder() {
        // req_feature_status(0x02) = 2f 02 20 02
        assertEquals("2f022002", hex(OuraProtocol.reqFeatureStatus(OuraProtocol.FeatureId.DAYTIME_HR)))
    }

    @Test fun liveHrStartSequenceIsAggressive() {
        // DAYTIME_HR live, EXERCISE_HR live, fast-HR on.
        assertEquals(listOf("2f03220203", "2f03220303", "160101"),
            OuraProtocol.liveHrStartSequence().map { hex(it) })
    }

    @Test fun dhrBurstUsesSubOp0x26() {
        // open_ring "measure now": 2f 03 26 02 02 (sub-op 0x26, DAYTIME_HR, sub-mode 2).
        assertEquals("2f03260202", hex(OuraProtocol.reqDhrBurstSubMode()))
        // Full trigger: enable DHR live (2f 03 22 02 03), then the 0x26 burst write.
        assertEquals(listOf("2f03220203", "2f03260202"),
            OuraProtocol.dhrBurstSequence().map { hex(it) })
    }

    @Test fun liveHrStopSequenceRestoresState() {
        // fast-HR off, then EXERCISE_HR + DAYTIME_HR back to AUTOMATIC.
        assertEquals(listOf("160100", "2f03220301", "2f03220201"),
            OuraProtocol.liveHrStopSequence().map { hex(it) })
    }

    @Test fun getHistoryMatchesRustBuilder() {
        // req_get_event(0, 255, -1) = 10 09 00000000 ff ffffffff
        assertEquals("100900000000ffffffffff", hex(OuraProtocol.reqGetHistory(0)))
        // cursor 10 (deciseconds) = LE 0a000000
        assertEquals("10090a000000ffffffffff", hex(OuraProtocol.reqGetHistory(10)))
    }

    @Test fun enableMeasurementSetsHrSpo2AndStepsAutomatic() {
        // set_feature_mode(DAYTIME_HR|SPO2|REAL_STEPS, AUTOMATIC) = 2f 03 22 <feat> 01.
        // REAL_STEPS (0x0b) is what makes the ring emit the 0x7e/0x7f step events.
        assertEquals(listOf("2f03220201", "2f03220401", "2f03220b01", "2f03220301", "16010100"),
            OuraProtocol.enableMeasurementSequence().map { hex(it) })
    }

    @Test fun enableMeasurementUndoesTheLiveHrLevers() {
        // Q-388: a live-HR session that never reaches liveHrStopSequence() leaves EXERCISE_HR in
        // CONNECTED_LIVE and BLE fast-HR mode on, permanently — the ring keeps that state across
        // reconnects and service restarts. Connect is the only path guaranteed to run, so the two
        // resets have to be here. Asserted as "the connect sequence contains the stop sequence's
        // resets" rather than as literal hex, so it still holds if either builder's bytes change.
        val connect = OuraProtocol.enableMeasurementSequence().map { hex(it) }
        assertTrue(connect.contains(hex(OuraProtocol.reqSetFeatureMode(
            OuraProtocol.FeatureId.EXERCISE_HR, OuraProtocol.FeatureMode.AUTOMATIC))))
        assertTrue(connect.contains(hex(OuraProtocol.reqBleFastHrMode(false))))
    }

    @Test fun enableRealStepsMatchesRustBuilder() {
        // req_set_feature_mode(REAL_STEPS=0x0b, AUTOMATIC=0x01) = 2f 03 22 0b 01 — the exact
        // frame the tester's "Enable steps" lever fires via setFeatureMode(0x0b, 0x01).
        assertEquals("2f03220b01", hex(OuraProtocol.reqSetFeatureMode(
            OuraProtocol.FeatureId.REAL_STEPS, OuraProtocol.FeatureMode.AUTOMATIC)))
        assertEquals(0x0b, OuraProtocol.FeatureId.REAL_STEPS)
    }

    @Test fun setRealtimeMatchesRustBuilder() {
        // req_set_realtime(ACM=0x20, 1, 0) = 06 07 20000000 0100 00
        assertEquals("060720000000010000", hex(OuraProtocol.reqSetRealtime(OuraProtocol.Realtime.ACM, 1, 0)))
        assertEquals("060400000000", hex(OuraProtocol.reqRealtimeOff()))
    }

    @Test fun accelSequencesMatchRust() {
        // stream_accelerometer writes SetRealtime(ACM, minutes, 0); OFF on exit.
        // (Live-HR start/stop sequences are covered by their own tests above — they
        // intentionally deviate from the pure Rust single-command mirror now.)
        assertEquals(listOf("060720000000050000"), OuraProtocol.accelStartSequence().map { hex(it) })
        assertEquals(listOf("060400000000"), OuraProtocol.accelStopSequence().map { hex(it) })
    }

    @Test fun parsesBatteryPercentAndCharging() {
        val charging = OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x03, 0x59, 0x01, 0x00))!!
        val b1 = OuraProtocol.parseBattery(charging)!!
        assertEquals(89, b1.percent)
        assertTrue(b1.charging)
        val idle = OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x03, 0x59, 0x00, 0x00))!!
        assertFalse(OuraProtocol.parseBattery(idle)!!.charging)
        // wrong tag / short payload → null
        assertNull(OuraProtocol.parseBattery(OuraProtocol.parseFrame(byteArrayOf(0x0e, 0x03, 0x59, 0x00, 0x00))!!))
    }

    @Test fun parsesHistoryCompletion() {
        // 11 06 <events=5> <sleep=0> <bytes_left=3742 -> 9e 0e 00 00>
        val f = OuraProtocol.parseFrame(byteArrayOf(0x11, 0x06, 0x05, 0x00, 0x9e.toByte(), 0x0e, 0x00, 0x00))!!
        val c = OuraProtocol.parseHistoryCompletion(f)!!
        assertEquals(5, c.eventsReceived)
        assertEquals(3742L, c.bytesLeft)
    }

    // The vectors below were produced by running the server-side authority
    // (`historyEventFromHex` in lib/oura-ble/decode.ts) over the same hex, so a native row
    // and a server row for one frame are byte-identical and dedup against each other on
    // (ring_ts, tag, body_hex). Change the split here and the two stores stop agreeing.
    @Test fun splitsHistoryEventsExactlyAsTheServerDoes() {
        val hrv = OuraProtocol.historyEventFromHex("5d06e80300001234")!!
        assertEquals(1000L, hrv.ringTs)
        assertEquals(0x5d, hrv.tag)
        assertEquals("hrv_event", hrv.name)
        assertEquals("1234", hrv.bodyHex)

        val ibi = OuraProtocol.historyEventFromHex("8008102700000a0b0c0d")!!
        assertEquals(10000L, ibi.ringTs)
        assertEquals("green_ibi_quality_event", ibi.name)
        assertEquals("0a0b0c0d", ibi.bodyHex)

        // A padded frame parses to exactly `len` bytes — the trailing 0x41 is not body.
        val start = OuraProtocol.historyEventFromHex("41040100000041")!!
        assertEquals(1L, start.ringTs)
        assertEquals("ring_start", start.name)
        assertEquals("", start.bodyHex)

        // Timestamp with no body is still a valid event with an empty body.
        assertEquals("", OuraProtocol.historyEventFromHex("5d04e8030000")!!.bodyHex)
    }

    @Test fun historyEventDecodeIsInfallible() {
        assertNull(OuraProtocol.historyEventFromHex("zz"))       // not hex
        assertNull(OuraProtocol.historyEventFromHex("5d0"))      // odd length
        assertNull(OuraProtocol.historyEventFromHex("0d03640001")) // command response, not history
        assertNull(OuraProtocol.historyEventFromHex(""))
        assertNull(OuraProtocol.historyEventFromHex("5d02e803")) // payload too short for a timestamp
    }

    @Test fun unmappedTagsGetAName() {
        assertEquals("unknown", OuraProtocol.eventName(0x8f))
        assertEquals("spo2_r_pi_event", OuraProtocol.eventName(0x8b))
    }

    @Test fun readsHistoryEventTimestamp() {
        // history event tag 0x80, timestamp 0x01020304 deciseconds -> LE 04 03 02 01
        val f = OuraProtocol.parseFrame(byteArrayOf(0x80.toByte(), 0x04, 0x04, 0x03, 0x02, 0x01))!!
        assertEquals(0x01020304L, OuraProtocol.historyEventTimestamp(f))
        // command-response frame (tag < 0x41) -> null
        assertNull(OuraProtocol.historyEventTimestamp(
            OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x02, 0x55, 0x01))!!))
    }
}
