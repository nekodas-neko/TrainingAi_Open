package com.trainingai.app.scale

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/** Test vectors are the REAL packets captured via nRF Connect against the owner's actual
 *  Renpho ES-20M during Phase 0 (2026-07-27) — see
 *  docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md "Phase 0 RESULTS". Not
 *  synthetic; every assertion here is checked against genuine on-device data, including the
 *  checksum formula (independently verified by hand against all 4 captures before being
 *  written into the decoder). */
class ScaleProtocolTest {
    private fun hex(s: String): ByteArray {
        val clean = s.replace("-", "")
        return ByteArray(clean.length / 2) { clean.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    @Test fun parsesUnstableReading1() {
        val p = ScaleProtocol.parseWeightPacket(hex("10-0B-15-1B-9E-00-00-00-00-00-E9"))!!
        assertEquals(70.70, p.weightKg, 0.001)
        assertFalse(p.stable)
        assertEquals(0, p.impedanceOhmsA)
        assertEquals(0, p.impedanceOhmsB)
    }

    @Test fun parsesUnstableReading2() {
        val p = ScaleProtocol.parseWeightPacket(hex("10-0B-15-1B-B2-00-00-00-00-00-FD"))!!
        assertEquals(70.90, p.weightKg, 0.001)
        assertFalse(p.stable)
    }

    @Test fun parsesUnstableReading3() {
        val p = ScaleProtocol.parseWeightPacket(hex("10-0B-15-1B-B7-00-00-00-00-00-02"))!!
        assertEquals(70.95, p.weightKg, 0.001)
        assertFalse(p.stable)
    }

    @Test fun parsesFinalStableReadingWithImpedance() {
        val p = ScaleProtocol.parseWeightPacket(hex("10-0B-15-1B-B7-01-01-F9-01-F7-F5"))!!
        assertEquals(70.95, p.weightKg, 0.001)
        assertTrue(p.stable)
        assertEquals(505, p.impedanceOhmsA)
        assertEquals(503, p.impedanceOhmsB)
        assertEquals("100b151bb70101f901f7f5", p.rawHex)
    }

    @Test fun rejectsWrongPacketMarker() {
        // The automatic handshake-identification packet observed on subscribe — byte 0 is
        // 0x12, not 0x10, and must never be mistaken for a reading.
        assertNull(ScaleProtocol.parseWeightPacket(hex("12-0F-15-07-B4-ED-38-C1-A4-38-01-38-00-07-F3")))
    }

    @Test fun rejectsBadChecksum() {
        val corrupted = hex("10-0B-15-1B-B7-01-01-F9-01-F7-00") // last byte should be F5
        assertNull(ScaleProtocol.parseWeightPacket(corrupted))
    }

    @Test fun rejectsTooShortPacket() {
        assertNull(ScaleProtocol.parseWeightPacket(hex("10-0B-15")))
    }

    /** SYNTHETIC vectors, unlike every WeightPacket test above — no real stored-record capture
     *  exists yet against our own hardware (see ScaleProtocol.parseStoredRecord's doc comment).
     *  These only verify the decode arithmetic itself (bit layout, epoch math) is correct for the
     *  byte layout as currently guessed; they do NOT verify that guess matches what the scale
     *  actually sends. Bytes [1],[2],[15-18] are arbitrary filler — parseStoredRecord doesn't
     *  validate them. */
    @Test fun parsesSyntheticStoredRecord() {
        // count=3, index=0, timestamp offset=1,000,000s, weight=70.95kg, resistance1=505, resistance2=503
        val p = ScaleProtocol.parseStoredRecord(
            hex("23-13-00-03-00-40-42-0F-00-1B-B7-01-F9-01-F7-00-00-00-00"))!!
        assertEquals(70.95, p.weightKg, 0.001)
        assertEquals(505, p.resistance1Ohms)
        assertEquals(503, p.resistance2Ohms)
        assertEquals(3, p.count)
        assertEquals(0, p.index)
        assertEquals(946_656_000L + 1_000_000L, p.measuredAtEpochSeconds)
    }

    @Test fun rejectsStoredRecordWithWrongMarker() {
        // Byte 0 is 0x10 (a live-packet marker), not 0x23 — must never be mistaken for a stored record.
        assertNull(ScaleProtocol.parseStoredRecord(
            hex("10-13-00-03-00-40-42-0F-00-1B-B7-01-F9-01-F7-00-00-00-00")))
    }

    @Test fun rejectsTooShortStoredRecord() {
        assertNull(ScaleProtocol.parseStoredRecord(hex("23-13-00-03-00")))
    }
}
