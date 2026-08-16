package com.trainingai.app.polar

import java.util.UUID

/** Standard Bluetooth Heart Rate Service wire format (0x180D / 0x2A37) as emitted
 *  by the Polar H10. Pure — no Android imports — so the 0x2A37 parser is unit-testable
 *  on the JVM (mirrors the JS `lib/live-hr/hr-measurement.ts`, kept byte-for-byte in
 *  sync). Unlike the Oura ring this is unauthenticated and notify-only: no nonce
 *  handshake, no write characteristic. */
object PolarProtocol {
    val HR_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    val HR_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val PREFERRED_MTU = 247

    // Standard Battery Service — the H10's CR2025 coin cell. Same UUIDs already read
    // once at pairing time in chest-strap-pairing.tsx; read again here so the coin-cell
    // level stays visible for the life of the all-day connection, not just at pairing.
    val BATTERY_SERVICE: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
    val BATTERY_LEVEL: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")

    // ---- PMD (Polar Measurement Data) — the proprietary service carrying raw ACC ----
    // The H10 exposes no cadence or step metric over BLE (polar-h10-ble skill §0), so
    // cadence has to come from the raw accelerometer. Control Point (write + indicate)
    // starts/stops a stream; sample frames then arrive on Data (notify).

    val PMD_SERVICE: UUID = UUID.fromString("fb005c80-02e7-f387-1cad-8acd2d8df0c8")
    val PMD_CONTROL_POINT: UUID = UUID.fromString("fb005c81-02e7-f387-1cad-8acd2d8df0c8")
    val PMD_DATA: UUID = UUID.fromString("fb005c82-02e7-f387-1cad-8acd2d8df0c8")

    const val PMD_OP_GET_SETTINGS = 0x01
    const val PMD_OP_START = 0x02
    const val PMD_OP_STOP = 0x03
    const val PMD_MEAS_ACC = 0x02

    /**
     * Accelerometer sample rate, Hz. The H10 offers 25/50/100/200; 50 is the lowest that
     * clears Nyquist for the ~3.7 Hz top of the cadence band with wide margin, and the
     * cadence DSP's sub-sample interpolation removes the resolution penalty that would
     * otherwise make a low rate a bad trade. Lower rate = less radio time = less drain on
     * both the strap and the phone, which matters because this runs for a whole run.
     */
    const val ACC_SAMPLE_RATE_HZ = 50
    /** ±8 G. Running foot-strike transients at the torso exceed ±4 G; clipping would
     *  distort the very peaks the cadence rhythm is measured from. */
    const val ACC_RANGE_G = 8
    const val ACC_RESOLUTION_BITS = 16

    /** Start ACC: [op][type] then settings TLVs [type:1][len:1][value:2 LE]. */
    fun buildAccStartCommand(
        rateHz: Int = ACC_SAMPLE_RATE_HZ,
        rangeG: Int = ACC_RANGE_G,
        resolutionBits: Int = ACC_RESOLUTION_BITS,
    ): ByteArray = byteArrayOf(
        PMD_OP_START.toByte(), PMD_MEAS_ACC.toByte(),
        0x00, 0x01, (rateHz and 0xff).toByte(), ((rateHz shr 8) and 0xff).toByte(),
        0x01, 0x01, (resolutionBits and 0xff).toByte(), ((resolutionBits shr 8) and 0xff).toByte(),
        0x02, 0x01, (rangeG and 0xff).toByte(), ((rangeG shr 8) and 0xff).toByte(),
    )

    fun buildAccStopCommand(): ByteArray =
        byteArrayOf(PMD_OP_STOP.toByte(), PMD_MEAS_ACC.toByte())

    fun buildGetSettingsCommand(measType: Int = PMD_MEAS_ACC): ByteArray =
        byteArrayOf(PMD_OP_GET_SETTINGS.toByte(), (measType and 0xff).toByte())

    /** One 3-axis accelerometer sample, in the units the strap reports (milli-g). */
    data class AccSample(val x: Int, val y: Int, val z: Int)

    /** A decoded PMD ACC data frame. `frameType` is carried through deliberately: which
     *  encoding the H10 actually emits is only knowable from a real capture, so the admin
     *  console surfaces it rather than having us guess silently. */
    data class AccFrame(val timestampNs: Long, val frameType: Int, val samples: List<AccSample>)

    private const val PMD_HEADER_LEN = 10

    /** Euclidean norm — orientation-independent, so it does not matter how the pod sits. */
    fun magnitude(s: AccSample): Double =
        Math.sqrt((s.x.toDouble() * s.x + s.y.toDouble() * s.y + s.z.toDouble() * s.z))

    /**
     * Decode a PMD ACC data frame. Infallible: returns null on anything malformed and never
     * throws (the same rule the Oura decoders follow — a bad frame must never kill a stream).
     *
     * Layout: [0] measurement type, [1..8] uint64 LE timestamp (ns, at the LAST sample),
     * [9] frame type, [10..] samples.
     *
     * Frame type selects the encoding, and the two conventions in circulation disagree, so
     * BOTH are accepted: bit 7 set (the PMD spec's "compressed" flag) or the literal 0x02.
     * Anything else is read as raw int16 triplets. A raw body must be a whole number of
     * 6-byte samples; if it is not, the frame is treated as delta rather than silently
     * truncated — a wrong branch here would produce plausible-looking garbage cadence.
     */
    fun parseAccFrame(frame: ByteArray): AccFrame? {
        if (frame.size < PMD_HEADER_LEN) return null
        if ((frame[0].toInt() and 0xff) != PMD_MEAS_ACC) return null

        var ts = 0L
        for (i in 0 until 8) ts = ts or ((frame[1 + i].toLong() and 0xff) shl (8 * i))
        val frameType = frame[9].toInt() and 0xff

        val bodyLen = frame.size - PMD_HEADER_LEN
        if (bodyLen <= 0) return null
        val compressed = (frameType and 0x80) != 0 || frameType == 0x02 || bodyLen % 6 != 0

        val samples = if (compressed) decodeDelta(frame, PMD_HEADER_LEN) else decodeRaw(frame, PMD_HEADER_LEN)
        if (samples.isNullOrEmpty()) return null
        return AccFrame(ts, frameType, samples)
    }

    private fun int16LE(b: ByteArray, i: Int): Int {
        val v = (b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8)
        return if (v > 0x7fff) v - 0x10000 else v
    }

    private fun decodeRaw(frame: ByteArray, start: Int): List<AccSample>? {
        val out = ArrayList<AccSample>()
        var i = start
        while (i + 6 <= frame.size) {
            out.add(AccSample(int16LE(frame, i), int16LE(frame, i + 2), int16LE(frame, i + 4)))
            i += 6
        }
        return out
    }

    /**
     * Delta body: a full reference sample (3 × int16 LE) followed by repeated groups of
     * `[bitWidth:1][sampleCount:1][packed deltas]`, each delta LSB-first and sign-extended at
     * `bitWidth`, applied cumulatively per axis.
     *
     * The group-header byte order ([bitWidth][sampleCount] vs the reverse) is the one part of
     * this format that open sources disagree on. A wrong order does not fail loudly — it
     * yields wrong sample counts — so the admin console reports decoded samples-per-second
     * against the requested rate, which catches it immediately on the first real capture.
     */
    private fun decodeDelta(frame: ByteArray, start: Int): List<AccSample>? {
        var off = start
        if (off + 6 > frame.size) return null
        var x = int16LE(frame, off)
        var y = int16LE(frame, off + 2)
        var z = int16LE(frame, off + 4)
        off += 6

        val out = ArrayList<AccSample>()
        out.add(AccSample(x, y, z))

        while (off + 2 <= frame.size) {
            val bitWidth = frame[off].toInt() and 0xff
            val count = frame[off + 1].toInt() and 0xff
            off += 2
            if (bitWidth == 0 || count == 0) break
            if (bitWidth > 32) return null
            val totalBits = bitWidth * 3 * count
            val totalBytes = (totalBits + 7) / 8
            if (off + totalBytes > frame.size) return null
            var bitPos = off * 8
            for (s in 0 until count) {
                x += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
                y += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
                z += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
                out.add(AccSample(x, y, z))
            }
            off += totalBytes
        }
        return out
    }

    /** Read `width` bits LSB-first from an absolute bit position, sign-extended. */
    private fun readSignedBits(b: ByteArray, bitPos: Int, width: Int): Int {
        var v = 0
        for (k in 0 until width) {
            val abs = bitPos + k
            val bit = (b[abs ushr 3].toInt() shr (abs and 7)) and 1
            v = v or (bit shl k)
        }
        val signBit = 1 shl (width - 1)
        return if ((v and signBit) != 0) v - (1 shl width) else v
    }

    /** One decoded 0x2A37 notification. `contact` is true/false only when the device
     *  advertises contact support (the H10 does), null otherwise. `rr` is per-beat
     *  intervals in ms (converted from 1/1024 s units) — the live-HRV raw material. */
    data class HrSample(val bpm: Int, val rr: List<Int>, val contact: Boolean?)

    /** Parse a Heart Rate Measurement value. Returns null on a malformed/short buffer
     *  (infallible-decoder rule: never throw). Layout: [flags][hr:1|2][energy:2]?[rr:2]*. */
    fun parseHeartRateMeasurement(v: ByteArray): HrSample? {
        if (v.size < 2) return null
        val flags = v[0].toInt() and 0xff
        val hr16 = (flags and 0x01) != 0
        val contactSupported = (flags and 0x04) != 0
        val energyPresent = (flags and 0x08) != 0
        val rrPresent = (flags and 0x10) != 0
        var i = 1
        val bpm: Int
        if (hr16) {
            if (v.size < 3) return null
            bpm = (v[1].toInt() and 0xff) or ((v[2].toInt() and 0xff) shl 8)
            i = 3
        } else {
            bpm = v[1].toInt() and 0xff
            i = 2
        }
        if (energyPresent) i += 2 // uint16 energy expended — skipped
        val rr = ArrayList<Int>()
        if (rrPresent) {
            while (i + 1 < v.size) {
                val raw = (v[i].toInt() and 0xff) or ((v[i + 1].toInt() and 0xff) shl 8) // 1/1024 s units
                rr.add(Math.round(raw / 1024.0 * 1000.0).toInt())
                i += 2
            }
        }
        val contact = if (contactSupported) (flags and 0x02) != 0 else null
        return HrSample(bpm, rr, contact)
    }
}
