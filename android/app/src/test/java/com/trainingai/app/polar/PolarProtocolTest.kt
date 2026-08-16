package com.trainingai.app.polar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Mirrors lib/live-hr/__tests__/hr-measurement.test.ts — the Kotlin decoder must
 *  stay byte-for-byte identical to the JS one. */
class PolarProtocolTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun parses8BitHrNoContactSupport() {
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x00, 72))!!
        assertEquals(72, s.bpm)
        assertEquals(emptyList<Int>(), s.rr)
        assertNull(s.contact)
    }

    @Test fun parses16BitHr() {
        // flags=0x01, HR=300 (0x012C LE)
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x01, 0x2c, 0x01))!!
        assertEquals(300, s.bpm)
    }

    @Test fun contactTrueWhenSupportedAndDetected() {
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x06, 80))!!
        assertEquals(true, s.contact)
    }

    @Test fun contactFalseWhenSupportedButNotDetected() {
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x04, 80))!!
        assertEquals(false, s.contact)
    }

    @Test fun parsesRrIntervalsInMs() {
        // flags=0x10, HR=60, RR raw 1024 → 1000 ms
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04))!!
        assertEquals(60, s.bpm)
        assertEquals(listOf(1000), s.rr)
    }

    @Test fun parsesMultipleRrAndSkipsEnergy() {
        // flags: 16-bit off, contact supported+detected(0x06), energy(0x08), rr(0x10) = 0x1e
        // hr=50, energy=2 bytes (skipped), rr: 1024→1000, 512→500
        val s = PolarProtocol.parseHeartRateMeasurement(bytes(0x1e, 50, 0xff, 0xff, 0x00, 0x04, 0x00, 0x02))!!
        assertEquals(50, s.bpm)
        assertEquals(true, s.contact)
        assertEquals(listOf(1000, 500), s.rr)
    }

    @Test fun returnsNullForShortBuffer() {
        assertNull(PolarProtocol.parseHeartRateMeasurement(bytes(0x00)))
        assertNull(PolarProtocol.parseHeartRateMeasurement(bytes(0x01, 0x2c))) // claims 16-bit but only 1 hr byte
    }

    // ---- PMD control point ----

    private fun hex(b: ByteArray) = b.joinToString(" ") { "%02x".format(it) }

    @Test fun buildsAccStartCommandAtTheConfiguredRate() {
        // [op=02][type=02] then TLVs: rate=50 (0x0032), resolution=16 (0x0010), range=8 (0x0008)
        assertEquals(
            "02 02 00 01 32 00 01 01 10 00 02 01 08 00",
            hex(PolarProtocol.buildAccStartCommand()),
        )
    }

    @Test fun encodesTwoByteRatesLittleEndian() {
        // 200 Hz = 0x00C8 — proves the rate field is LE, not a single byte that would
        // silently truncate anything above 255.
        assertEquals("c8 00", hex(PolarProtocol.buildAccStartCommand(rateHz = 200)).substring(12, 17))
    }

    @Test fun buildsStopAndGetSettingsCommands() {
        assertEquals("03 02", hex(PolarProtocol.buildAccStopCommand()))
        assertEquals("01 02", hex(PolarProtocol.buildGetSettingsCommand()))
    }

    // ---- PMD ACC frame decoding ----

    @Test fun decodesRawAccFrame() {
        val f = PolarProtocol.parseAccFrame(bytes(
            0x02,                               // ACC
            0x01, 0, 0, 0, 0, 0, 0, 0,          // timestamp = 1 ns
            0x00,                               // raw frame type
            0x64, 0x00, 0x38, 0xff, 0xe8, 0x03, // 100, -200, 1000
            0x9c, 0xff, 0xc8, 0x00, 0x00, 0x04, // -100, 200, 1024
        ))!!
        assertEquals(1L, f.timestampNs)
        assertEquals(0x00, f.frameType)
        assertEquals(
            listOf(
                PolarProtocol.AccSample(100, -200, 1000),
                PolarProtocol.AccSample(-100, 200, 1024),
            ),
            f.samples,
        )
    }

    @Test fun decodesDeltaAccFrameCumulatively() {
        // Reference (1000, 0, -1000); one group bitWidth=4 count=1 with deltas (+1,+1,+1).
        // 4-bit values packed LSB-first: x=1,y=1 → 0x11; z=1 → 0x01.
        val f = PolarProtocol.parseAccFrame(bytes(
            0x02,
            0x02, 0, 0, 0, 0, 0, 0, 0,
            0x80,                               // compressed flag (bit 7)
            0xe8, 0x03, 0x00, 0x00, 0x18, 0xfc, // reference 1000, 0, -1000
            0x04, 0x01, 0x11, 0x01,
        ))!!
        assertEquals(0x80, f.frameType)
        assertEquals(
            listOf(
                PolarProtocol.AccSample(1000, 0, -1000),
                PolarProtocol.AccSample(1001, 1, -999),
            ),
            f.samples,
        )
    }

    @Test fun signExtendsNegativeDeltas() {
        // Reference (0,0,0); 4-bit deltas of -1 (0b1111) → packed 0xff then 0x0f.
        val f = PolarProtocol.parseAccFrame(bytes(
            0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x80,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x04, 0x01, 0xff, 0x0f,
        ))!!
        assertEquals(
            listOf(PolarProtocol.AccSample(0, 0, 0), PolarProtocol.AccSample(-1, -1, -1)),
            f.samples,
        )
    }

    @Test fun treatsLiteral0x02FrameTypeAsCompressed() {
        // The other convention in circulation uses a literal 0x02 rather than the bit-7 flag.
        val f = PolarProtocol.parseAccFrame(bytes(
            0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x02,
            0xe8, 0x03, 0x00, 0x00, 0x18, 0xfc,
            0x04, 0x01, 0x11, 0x01,
        ))!!
        assertEquals(2, f.samples.size)
        assertEquals(PolarProtocol.AccSample(1001, 1, -999), f.samples[1])
    }

    @Test fun readsBodyThatIsNotAWholeNumberOfRawSamplesAsDelta() {
        // 10-byte body: not divisible by 6, so decoding it as raw would silently drop the
        // tail. Must take the delta branch instead of producing truncated garbage.
        val f = PolarProtocol.parseAccFrame(bytes(
            0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x00,
            0xe8, 0x03, 0x00, 0x00, 0x18, 0xfc,
            0x04, 0x01, 0x11, 0x01,
        ))!!
        assertEquals(2, f.samples.size)
    }

    @Test fun accFrameDecoderIsInfallible() {
        assertNull(PolarProtocol.parseAccFrame(bytes(0x02, 0, 0)))                        // short header
        assertNull(PolarProtocol.parseAccFrame(bytes(0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 1, 2, 3, 4, 5, 6))) // not ACC
        assertNull(PolarProtocol.parseAccFrame(bytes(0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x00))) // header only, no body
        assertNull(PolarProtocol.parseAccFrame(ByteArray(0)))
        // Delta group claiming more packed bytes than the frame holds.
        assertNull(PolarProtocol.parseAccFrame(bytes(
            0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x80,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x10, 0x40, 0x00,
        )))
    }

    @Test fun magnitudeIsTheEuclideanNorm() {
        assertEquals(5.0, PolarProtocol.magnitude(PolarProtocol.AccSample(3, 0, 4)), 1e-9)
    }
}
