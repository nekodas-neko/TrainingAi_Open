package com.trainingai.app.scale

import java.util.UUID

/**
 * Renpho ES-20M (QN-Scale family) BLE wire format — pinned from a real on-device capture
 * via nRF Connect against the owner's actual scale (2026-07-27), NOT from memory or generic
 * docs. See docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md "Phase 0 RESULTS"
 * for the captured packets this was verified against. Pure — no Android imports — so the
 * decoder is unit-testable on the JVM (mirrors PolarProtocol's shape).
 */
object ScaleProtocol {
    private fun uuid16(short: String): UUID = UUID.fromString("0000$short-0000-1000-8000-00805f9b34fb")

    val SCALE_SERVICE: UUID = uuid16("ffe0")
    /** Notify — weight/impedance stream. */
    val FFE1_MEASUREMENT: UUID = uuid16("ffe1")
    /** Indicate — never observed firing during Phase 0 capture; declared for completeness. */
    val FFE2_INDICATE: UUID = uuid16("ffe2")
    /** Write — request-measurement command. */
    val FFE3_REQUEST: UUID = uuid16("ffe3")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** The exact command that triggered real weigh-in notifications during Phase 0. */
    val REQUEST_MEASUREMENT_CMD: ByteArray = byteArrayOf(
        0x13, 0x09, 0x15, 0x01, 0x10, 0x00, 0x00, 0x00, 0x42,
    )

    /**
     * SPECULATIVE, UNVERIFIED against our own hardware — request the scale's stored/offline
     * measurements (readings taken while nothing was connected). Ported from a third-party
     * open-source BLE client for this scale family (`ronnnnnnnnnnnnn/renpho-escs20m`) that
     * independently confirmed our own FFE1/FFE2/FFE3 UUID roles and the 0x12 handshake-frame
     * identity for its "FFE0 layout" variant — the same one this scale uses. But their command
     * opcode family (`0x22`-prefixed here) is for a *different* firmware/scale generation than our
     * own confirmed `0x13`-prefixed [REQUEST_MEASUREMENT_CMD] — there is no structural evidence
     * these exact bytes are understood by our hardware. `vendor_byte` (byte[2], `0x15`) is guessed
     * by analogy with byte[2] of our own confirmed command, not confirmed either. Written
     * defensively: queued strictly after the live-measurement request so it can never delay that
     * flow, and if the scale doesn't recognise this opcode it should simply not respond — no
     * effect either way.
     *
     * RESTORED 2026-08-01 — this was added in #951, then silently dropped by #970 (which was
     * only meant to defer the *live*-measurement write to a fallback path, but rewrote
     * onServicesDiscovered wholesale and dropped this second write with it) and never
     * re-added when #971 reverted the fallback-write experiment. No on-device evidence either
     * way yet on whether this scale actually understands the opcode — restoring it because it's
     * the most direct fix for a missed-live-window weigh-in being lost outright instead of
     * recoverable on the next connection. See
     * docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-and-scan-latency.md.
     */
    val REQUEST_STORED_MEASUREMENTS_CMD: ByteArray = byteArrayOf(0x22, 0x04, 0x15)

    private const val STORED_RECORD_MARKER = 0x23
    private const val STORED_RECORD_MIN_SIZE = 19
    /** The scale's own epoch, per the third-party source above: 2000-01-01 00:00:00 UTC. */
    private const val STORED_RECORD_EPOCH_OFFSET_SECONDS = 946_656_000L

    /** One decoded drained stored-measurement record — historical, not the live weigh-in.
     *  SPECULATIVE — see [parseStoredRecord]. */
    data class StoredWeightPacket(
        val weightKg: Double,
        val measuredAtEpochSeconds: Long,
        val resistance1Ohms: Int,
        val resistance2Ohms: Int,
        val count: Int,
        val index: Int,
        val rawHex: String,
    )

    /** One decoded FFE1 notification. `stable` false means the measurement is still settling
     *  (weight only, impedance not yet ready) — callers should keep waiting, not give up. */
    data class WeightPacket(
        val weightKg: Double,
        val stable: Boolean,
        val impedanceOhmsA: Int,
        val impedanceOhmsB: Int,
        val rawHex: String,
    )

    /**
     * Decode an FFE1 notification. Infallible: returns null on anything malformed or on the
     * automatic handshake-identification packet the scale sends on subscribe (marker `0x12`,
     * observed during Phase 0, never a real reading) — never throws.
     *
     * Layout (11 bytes, verified against 4 independent real captures):
     *   [0]    0x10 marker (a real data packet; anything else is not one)
     *   [1]    0x0B — packet length (constant)
     *   [2]    0x15 — echoes byte 2 of the request command
     *   [3-4]  weight, big-endian uint16, ÷100 = kg
     *   [5]    stable flag — 0x00 while measuring, 0x01 once final (incl. impedance)
     *   [6-7]  impedance A, big-endian uint16 (zero until stable)
     *   [8-9]  impedance B, big-endian uint16 (zero until stable)
     *   [10]   checksum = sum(bytes 0-9) mod 256
     */
    fun parseWeightPacket(raw: ByteArray): WeightPacket? {
        if (raw.size < 11) return null
        if ((raw[0].toInt() and 0xff) != 0x10) return null

        var sum = 0
        for (i in 0 until 10) sum += (raw[i].toInt() and 0xff)
        val checksum = sum and 0xff
        if (checksum != (raw[10].toInt() and 0xff)) return null

        val weightRaw = ((raw[3].toInt() and 0xff) shl 8) or (raw[4].toInt() and 0xff)
        val stable = (raw[5].toInt() and 0xff) == 0x01
        val impedanceA = ((raw[6].toInt() and 0xff) shl 8) or (raw[7].toInt() and 0xff)
        val impedanceB = ((raw[8].toInt() and 0xff) shl 8) or (raw[9].toInt() and 0xff)

        return WeightPacket(
            weightKg = weightRaw / 100.0,
            stable = stable,
            impedanceOhmsA = impedanceA,
            impedanceOhmsB = impedanceB,
            rawHex = raw.joinToString("") { "%02x".format(it) },
        )
    }

    /**
     * Decode a candidate drained stored-measurement notification. SPECULATIVE, UNVERIFIED against
     * our own hardware — see [REQUEST_STORED_MEASUREMENTS_CMD]. Byte layout below is carried over
     * from the third-party source's documentation, not from our own captured evidence; only the
     * timestamp's endianness was explicitly documented there (little-endian) — weight/resistance
     * endianness is assumed big-endian by analogy with [parseWeightPacket], unconfirmed.
     *
     * Infallible: returns null on anything that doesn't match the expected marker/length, same
     * contract as [parseWeightPacket] — a wrong guess here degrades to "no stored records ever
     * decoded," not a crash.
     *
     * Layout (19 bytes, per the third-party source, NOT independently verified):
     *   [0]    0x23 marker (a stored record; anything else is not one — no separate checksum byte
     *          is documented for this frame type, unlike the live packet)
     *   [3]    count — how many stored records remain including this one
     *   [4]    index — this record's position in the drain
     *   [5-8]  timestamp offset, little-endian uint32, seconds since the scale's own epoch
     *   [9-10] weight, big-endian uint16 (assumed), ÷100 = kg
     *   [11-12] resistance 1, big-endian uint16 (assumed)
     *   [13-14] resistance 2, big-endian uint16 (assumed)
     */
    fun parseStoredRecord(raw: ByteArray): StoredWeightPacket? {
        if (raw.size < STORED_RECORD_MIN_SIZE) return null
        if ((raw[0].toInt() and 0xff) != STORED_RECORD_MARKER) return null

        val count = raw[3].toInt() and 0xff
        val index = raw[4].toInt() and 0xff
        val tsOffset = (raw[5].toInt() and 0xff) or
            ((raw[6].toInt() and 0xff) shl 8) or
            ((raw[7].toInt() and 0xff) shl 16) or
            ((raw[8].toInt() and 0xff) shl 24)
        val weightRaw = ((raw[9].toInt() and 0xff) shl 8) or (raw[10].toInt() and 0xff)
        val resistance1 = ((raw[11].toInt() and 0xff) shl 8) or (raw[12].toInt() and 0xff)
        val resistance2 = ((raw[13].toInt() and 0xff) shl 8) or (raw[14].toInt() and 0xff)

        return StoredWeightPacket(
            weightKg = weightRaw / 100.0,
            measuredAtEpochSeconds = STORED_RECORD_EPOCH_OFFSET_SECONDS + (tsOffset.toLong() and 0xffffffffL),
            resistance1Ohms = resistance1,
            resistance2Ohms = resistance2,
            count = count,
            index = index,
            rawHex = raw.joinToString("") { "%02x".format(it) },
        )
    }
}
