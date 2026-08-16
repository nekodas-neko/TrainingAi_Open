package com.trainingai.app.scale

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.util.ArrayDeque

/**
 * One connect→link→(repeated)weigh-in lifecycle against the Renpho ES-20M (QN-Scale). Owned and
 * restarted by ScaleBleService, which applies the retry policy and mirrors status to JS.
 *
 * PERSISTENT CONNECTION (2026-08-01): unlike the Polar strap, the scale doesn't stay advertising
 * while idle, so this still needs the scan-wake trigger to catch the initial connectable window
 * — but once genuinely linked (proven by any FFE1 notification, including the harmless
 * handshake frame), the connection is treated the same as the strap's: held open indefinitely,
 * reporting every weigh-in that happens on it, rather than closing after one reading. That's what
 * the "connect once, then it's instant every time after" behavior observed on-device tonight
 * actually was — nRF Connect and the official app both stayed connected across the whole test
 * session rather than disconnecting after each reading, and every "already primed" success
 * tonight was really just "still connected from last time." No more give-up timeout applies once
 * linked: the connection just waits, however long it takes, for the next real reading — the
 * previous one-shot design's EARLY_DATA_TIMEOUT_MS/WEIGH_IN_TIMEOUT_MS/CYCLE_BUDGET_MS ceilings
 * only bound getting to that first proof of life, not anything after it.
 *
 * Samsung's stack does not honour `autoConnect=true` (proven on-device for the Oura ring,
 * oura-native-ble skill §8), so this still uses the same proven pattern as before: a direct
 * `connectGatt(autoConnect=false)` attempt, triggered only once ScaleScanReceiver/
 * ScaleForegroundScanner has already seen the scale advertising.
 */
@SuppressLint("MissingPermission") // service checks BLUETOOTH_CONNECT before starting
class ScaleGattClient(
    private val context: Context,
    private val deviceId: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onLog(line: String)
        fun onState(state: State)
        /** Fired once per connection, the first time any FFE1 notification proves the notify
         *  subscription is genuinely alive (including the harmless handshake frame). From this
         *  point on the connection is treated as persistent — no more give-up timeout applies,
         *  and the caller should stop bounding this attempt with an overall deadline. */
        fun onLinked()
        /** A still-settling reading (weight only, impedance not yet ready) — proof someone is
         *  actively on the scale right now, not just that the connection is alive. Non-terminal;
         *  may fire repeatedly across the life of one persistent connection. */
        fun onUnstableReading(weightKg: Double)
        /** A stable, final reading — impedance included. Non-terminal: the connection stays open
         *  and keeps listening for further weigh-ins, same as the strap keeps streaming HR. */
        fun onWeighIn(packet: ScaleProtocol.WeightPacket)
        /** Terminal — the connection was never established, or a live link was lost. Service
         *  decides whether/how to retry. */
        fun onFailure(reason: String)
        /** A drained stored-measurement record — historical, not the live weigh-in. Non-terminal:
         *  may fire any number of times, and does not affect the live weigh-in flow or close the
         *  connection. SPECULATIVE — see ScaleProtocol.parseStoredRecord. */
        fun onStoredReading(record: ScaleProtocol.StoredWeightPacket)
    }

    enum class State { IDLE, CONNECTING, PREPARING, WAITING, CLOSED }

    companion object {
        /** Bounds only the initial `connectGatt()` round trip. The scan hit that starts this
         *  attempt means the scale is already known to be advertising right now, so a real
         *  connect normally completes in well under a second. */
        private const val CONNECT_TIMEOUT_MS = 5_000L
        /** Bounds only the pre-link phase (FFE3 write succeeded, waiting for the first proof the
         *  notify subscription actually took effect) — see onLinked. Once linked, this never
         *  fires again for the life of the connection; there is no timeout on waiting for an
         *  actual weigh-in once we know the link is real. 5s is generous — nRF Connect on-device
         *  (2026-07-31) received a real unstable packet within a couple of seconds of
         *  subscribing. */
        private const val EARLY_DATA_TIMEOUT_MS = 5_000L
        /** The scale itself has been observed (2026-08-01) retransmitting the *same* stable
         *  reading up to 3 times in a row, ~500ms apart, before it goes idle — the notify
         *  characteristic just repeats, it's not a new weigh-in. Under the old one-shot design
         *  this never mattered (the connection closed after the first one); now that the
         *  connection stays open, each repeat would otherwise be reported as a brand new
         *  weigh-in. Only a stable reading whose raw bytes differ from the last reported one, or
         *  one that arrives after this window, counts as genuinely new. */
        private const val STABLE_REPEAT_WINDOW_MS = 10_000L
    }

    /** True once any FFE1 notification has proven the link genuinely alive — see onLinked. */
    private var linked = false

    // Dedup guard for STABLE_REPEAT_WINDOW_MS — see its doc comment.
    private var lastStableRawHex: String? = null
    private var lastStableReportedAtElapsedMs = 0L

    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private var gatt: BluetoothGatt? = null
    private var state = State.IDLE
    // Stage-timing diagnostic (2026-08-01) — added to pin down where a "cold" first-ever connect
    // spends its time vs. a "warm" reconnect, after the owner reported needing to step on once to
    // "prime" the connection before a second attempt ~30s later connects instantly. Every log line
    // below reports elapsed time since this attempt's connectGatt() call, so a cold-vs-warm log
    // pair can be compared stage-by-stage instead of guessing which phase is slow.
    private var connectStartElapsedMs = 0L
    private fun elapsedMs() = SystemClock.elapsedRealtime() - connectStartElapsedMs
    private var closed = false
    private var connectTimeoutRunnable: Runnable? = null
    private var earlyDataTimeoutRunnable: Runnable? = null
    // Guards EARLY_DATA_TIMEOUT_MS from being armed more than once per connection —
    // onCharacteristicWrite can in principle report success more than once.
    private var earlyDataTimerArmed = false

    // GATT allows one outstanding operation; queue descriptor/characteristic writes.
    private val opQueue = ArrayDeque<() -> Unit>()
    private var opInFlight = false

    private fun setState(s: State) { state = s; listener.onState(s) }
    private fun log(msg: String) = listener.onLog(msg)

    private fun enqueue(op: () -> Unit) { opQueue.add(op); pump() }
    private fun pump() {
        if (opInFlight) return
        val op = opQueue.poll() ?: return
        opInFlight = true
        op()
    }
    private fun opDone() { opInFlight = false; pump() }

    fun start() {
        val device: BluetoothDevice = try {
            manager.adapter?.getRemoteDevice(deviceId)
                ?: return listener.onFailure("bluetooth adapter unavailable")
        } catch (e: IllegalArgumentException) {
            return listener.onFailure("invalid scale address: $deviceId")
        }
        connectStartElapsedMs = SystemClock.elapsedRealtime()
        setState(State.CONNECTING)
        log("connecting to ${device.address}")
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        val timeoutRunnable = Runnable {
            log("connect timeout after ${CONNECT_TIMEOUT_MS / 1000}s — scale likely asleep, will retry later")
            close()
            listener.onFailure("connect timeout")
        }
        connectTimeoutRunnable = timeoutRunnable
        main.postDelayed(timeoutRunnable, CONNECT_TIMEOUT_MS)
    }

    private fun cancelConnectTimeout() {
        connectTimeoutRunnable?.let { main.removeCallbacks(it) }
        connectTimeoutRunnable = null
    }

    private fun startEarlyDataTimeout() {
        val timeoutRunnable = Runnable {
            log("no data within ${EARLY_DATA_TIMEOUT_MS / 1000}s of request — notify subscribe likely failed, retrying")
            close()
            listener.onFailure("no data — notify subscribe likely failed")
        }
        earlyDataTimeoutRunnable = timeoutRunnable
        main.postDelayed(timeoutRunnable, EARLY_DATA_TIMEOUT_MS)
    }

    private fun cancelEarlyDataTimeout() {
        earlyDataTimeoutRunnable?.let { main.removeCallbacks(it) }
        earlyDataTimeoutRunnable = null
    }

    @Suppress("DEPRECATION") // legacy value/descriptor API works on all API levels incl. the S25
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            log("connectionStateChange status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                log("gatt connected (+${elapsedMs()}ms) — discovering services")
                cancelConnectTimeout()
                setState(State.PREPARING)
                // Shaves real time off the discover→subscribe→write round trips that follow —
                // directly narrows the race against the scale's own short measurement window
                // (see EARLY_DATA_TIMEOUT_MS above). Best-effort: the request itself has no
                // failure callback, so nothing to branch on if the radio ignores it.
                g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                cancelConnectTimeout()
                val wasLinked = linked
                close()
                listener.onFailure(if (wasLinked) "link dropped (status=$status)" else "connect failed (status=$status)")
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            log("services discovered (+${elapsedMs()}ms)")
            val service = g.getService(ScaleProtocol.SCALE_SERVICE)
                ?: return listener.onFailure("FFE0 service missing after discovery")
            val measurement = service.getCharacteristic(ScaleProtocol.FFE1_MEASUREMENT)
                ?: return listener.onFailure("FFE1 characteristic missing")
            val request = service.getCharacteristic(ScaleProtocol.FFE3_REQUEST)
                ?: return listener.onFailure("FFE3 characteristic missing")

            // Writes the request immediately after subscribing, same as every earlier iteration
            // that produced an instant weigh-in. 2026-07-31 briefly deferred this to a fallback
            // (only writing it if nothing live showed up within EARLY_DATA_TIMEOUT_MS) on the
            // theory that the write itself was resetting the reading — every one of that
            // evening's own connections that wrote immediately happened to also be late (scale
            // already idle by the time they connected), while the one no-write success (nRF
            // Connect) happened to land early, so "no write" and "landed in time" were
            // confounded. Reverted 2026-08-01: deferring the write made the common case *worse*
            // (connects fast, but stopped producing the sometimes-instant weigh-ins earlier
            // iterations had), which is stronger evidence than the earlier correlation was.
            enqueue {
                g.setCharacteristicNotification(measurement, true)
                val cccd = measurement.getDescriptor(ScaleProtocol.CCCD) ?: run {
                    log("FFE1 CCCD missing"); opDone(); return@enqueue
                }
                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                if (!g.writeDescriptor(cccd)) { log("writeDescriptor(FFE1) rejected"); opDone() }
            }
            enqueue {
                request.value = ScaleProtocol.REQUEST_MEASUREMENT_CMD
                request.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                if (!g.writeCharacteristic(request)) { log("FFE3 request write rejected"); opDone() }
            }
            // Speculative stored-measurement drain (ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD)
            // — queued strictly after the live request above, so it can never delay or interfere
            // with that flow (see REQUEST_STORED_MEASUREMENTS_CMD's doc comment for why this is
            // safe to send even though the opcode is unverified against our own hardware).
            // RESTORED 2026-08-01: this enqueue existed briefly (#969) and was accidentally
            // dropped by #970's rewrite of this function a few commits later, never re-added when
            // #971 reverted the rest of that change — see ScaleProtocol.kt's doc comment.
            enqueue {
                request.value = ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD
                request.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                if (!g.writeCharacteristic(request)) { log("FFE3 stored-request write rejected"); opDone() }
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) log("descriptor write status=$status")
            else log("notify subscribed (+${elapsedMs()}ms)")
            opDone()
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                log("characteristic write status=$status")
            } else if (c.uuid == ScaleProtocol.FFE3_REQUEST && !earlyDataTimerArmed) {
                earlyDataTimerArmed = true
                log("measurement requested (+${elapsedMs()}ms)")
                setState(State.WAITING)
                startEarlyDataTimeout()
            }
            opDone()
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (c.uuid != ScaleProtocol.FFE1_MEASUREMENT) return
            val raw = c.value ?: return

            // Any notification at all — malformed, the handshake frame, a real reading, whatever
            // — proves the link is genuinely alive. Fires once per connection; from here on the
            // connection is persistent (see the class doc comment) and never times out on its
            // own again, so there's nothing left to re-arm no matter how much repeat noise a
            // frame like the handshake spams (confirmed on-device 2026-08-01 to sometimes repeat
            // every ~300ms rather than firing once).
            if (!linked) {
                linked = true
                log("first FFE1 notification (+${elapsedMs()}ms) — link proven alive")
                cancelEarlyDataTimeout()
                listener.onLinked()
            }

            val stored = ScaleProtocol.parseStoredRecord(raw)
            if (stored != null) {
                // Speculative — see ScaleProtocol.parseStoredRecord.
                log("stored record ${stored.index + 1}/${stored.count}: ${stored.weightKg} kg @ epoch ${stored.measuredAtEpochSeconds}")
                listener.onStoredReading(stored)
                return
            }

            val packet = ScaleProtocol.parseWeightPacket(raw)
            if (packet == null) {
                // Malformed, or the auto handshake/identify frame (marker 0x12, contains the
                // scale's own MAC — confirmed 2026-08-01 by decoding one on-device: `12-0f-15-
                // 07-b4-ed-38-c1-a4-...` against MAC A4:C1:38:ED:B4:07 reversed).
                val hex = raw.joinToString("") { "%02x".format(it) }
                log("FFE1 notification ignored — did not parse as a weight packet (${raw.size} bytes): $hex")
                return
            }
            if (!packet.stable) {
                log("unstable reading: ${packet.weightKg} kg")
                listener.onUnstableReading(packet.weightKg)
                return
            }
            val nowElapsed = SystemClock.elapsedRealtime()
            if (packet.rawHex == lastStableRawHex && nowElapsed - lastStableReportedAtElapsedMs < STABLE_REPEAT_WINDOW_MS) {
                log("stable reading ${packet.weightKg} kg ignored — scale repeated the same frame it already reported ${nowElapsed - lastStableReportedAtElapsedMs}ms ago")
                return
            }
            lastStableRawHex = packet.rawHex
            lastStableReportedAtElapsedMs = nowElapsed
            log("stable reading: ${packet.weightKg} kg, impedance ${packet.impedanceOhmsA}/${packet.impedanceOhmsB}")
            listener.onWeighIn(packet)
            // No close() — the connection stays open and keeps listening for the next weigh-in,
            // same as the strap keeps streaming HR after its first sample. See the class doc.
        }
    }

    fun close() {
        closed = true
        cancelConnectTimeout()
        cancelEarlyDataTimeout()
        opQueue.clear(); opInFlight = false
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        gatt = null
        if (state != State.CLOSED) setState(State.CLOSED)
    }
}
