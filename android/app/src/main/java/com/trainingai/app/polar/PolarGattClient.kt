package com.trainingai.app.polar

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
import java.util.ArrayDeque

/** One connect→subscribe lifecycle against a standard-HRS chest strap (Polar H10).
 *  Owned and restarted by PolarStrapService; reports through the listener so the
 *  service applies the backoff policy and mirrors status to JS.
 *
 *  Far simpler than OuraGattClient: the H10 has a STABLE public MAC (skill §5) so we
 *  connect directly by address — no scan, no rotating-RPA handling. Standard Heart
 *  Rate Service is unauthenticated and notify-only, so there is no nonce handshake
 *  and no write characteristic — just enable notifications on 0x2A37. */
@SuppressLint("MissingPermission") // service checks BLUETOOTH_CONNECT before starting
class PolarGattClient(
    private val context: Context,
    private val deviceId: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onLog(line: String)
        fun onState(state: State)
        fun onReady()
        fun onSample(sample: PolarProtocol.HrSample)
        fun onFailure(reason: String)   // terminal for this attempt — service decides on retry
        /** Decoded accelerometer frame, only while the PMD stream is running. */
        fun onAccFrame(frame: PolarProtocol.AccFrame)
        /** Battery Service read, once per connection (best-effort — never blocks readiness). */
        fun onBattery(percent: Int)
    }

    enum class State { IDLE, CONNECTING, PREPARING, READY, CLOSED }

    companion object {
        private const val MAX_LOCAL_CONNECT_RETRIES = 2
        private const val LOCAL_RETRY_DELAY_MS = 800L
        private const val CONNECT_TIMEOUT_MS = 15_000L
    }

    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private var gatt: BluetoothGatt? = null
    private var state = State.IDLE
    private var closed = false
    private var connectTimeoutRunnable: Runnable? = null
    private var localConnectRetriesLeft = 0
    private var accStreaming = false

    // GATT allows one outstanding operation; queue the CCCD descriptor write.
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
            return listener.onFailure("invalid strap address: $deviceId")
        }
        localConnectRetriesLeft = MAX_LOCAL_CONNECT_RETRIES
        connect(device)
    }

    private fun connect(device: BluetoothDevice) {
        setState(State.CONNECTING)
        log("connecting to ${device.address} (bondState=${device.bondState})")
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        val timeoutRunnable = Runnable {
            log("connect timeout after ${CONNECT_TIMEOUT_MS / 1000}s — abandoning")
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

    @Suppress("DEPRECATION") // legacy value/descriptor API works on all API levels incl. the S25
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            log("connectionStateChange status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                cancelConnectTimeout()
                setState(State.PREPARING)
                g.requestMtu(PolarProtocol.PREFERRED_MTU)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                cancelConnectTimeout()
                val wasReady = state == State.READY
                val device = try { manager.adapter?.getRemoteDevice(deviceId) } catch (_: Exception) { null }
                if (!wasReady && !closed && device != null && localConnectRetriesLeft > 0) {
                    localConnectRetriesLeft--
                    log("connect failed (status=$status) — retrying same device ($localConnectRetriesLeft left)")
                    try { g.close() } catch (_: Exception) {}
                    gatt = null
                    main.postDelayed({ if (!closed) connect(device) }, LOCAL_RETRY_DELAY_MS)
                    return
                }
                close()
                listener.onFailure(if (wasReady) "link dropped (status=$status)" else "connect failed (status=$status)")
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            log("mtu=$mtu status=$status")
            g.discoverServices()
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val service = g.getService(PolarProtocol.HR_SERVICE)
                ?: return listener.onFailure("HR service missing after discovery")
            val ch = service.getCharacteristic(PolarProtocol.HR_MEASUREMENT)
                ?: return listener.onFailure("HR measurement characteristic missing")
            enqueue {
                g.setCharacteristicNotification(ch, true)
                val cccd = ch.getDescriptor(PolarProtocol.CCCD) ?: run {
                    log("HR measurement CCCD missing"); opDone(); return@enqueue
                }
                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                if (!g.writeDescriptor(cccd)) { log("writeDescriptor(HR) rejected"); opDone() }
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) log("descriptor write status=$status")
            opDone()
            // Only the HR subscription means "the strap is streaming". The PMD CCCD writes
            // also land here, and readiness must not be re-derived from a cadence stream that
            // is optional and may fail independently.
            if (d.characteristic?.uuid != PolarProtocol.HR_MEASUREMENT) return
            if (state != State.READY) { setState(State.READY); listener.onReady() }
            readBattery(g)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            val raw = c.value ?: return
            when (c.uuid) {
                PolarProtocol.HR_MEASUREMENT -> {
                    val sample = PolarProtocol.parseHeartRateMeasurement(raw) ?: return
                    listener.onSample(sample)
                }
                PolarProtocol.PMD_DATA -> {
                    // Infallible decoder: a malformed frame is dropped, never fatal to the stream.
                    val frame = PolarProtocol.parseAccFrame(raw) ?: return
                    listener.onAccFrame(frame)
                }
                PolarProtocol.PMD_CONTROL_POINT -> {
                    // Indication carrying the start/stop ack + granted settings. Logged rather
                    // than parsed: which settings the H10 actually grants is exactly what the
                    // first on-device capture needs to reveal.
                    log("pmd control response: ${raw.joinToString(" ") { "%02x".format(it) }}")
                }
            }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (c.uuid == PolarProtocol.PMD_CONTROL_POINT && status != BluetoothGatt.GATT_SUCCESS) {
                log("pmd control write failed status=$status")
            }
            opDone()
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            opDone()
            if (c.uuid != PolarProtocol.BATTERY_LEVEL) return
            if (status != BluetoothGatt.GATT_SUCCESS) { log("battery read status=$status"); return }
            val pct = c.value?.firstOrNull()?.toInt()?.and(0xff) ?: return
            listener.onBattery(pct)
        }
    }

    /** Best-effort battery-level read, queued behind whatever else is in flight. Silently
     *  no-ops if the H10 doesn't expose the standard Battery Service (never blocks HR). */
    private fun readBattery(g: BluetoothGatt) {
        val service = g.getService(PolarProtocol.BATTERY_SERVICE) ?: return
        val ch = service.getCharacteristic(PolarProtocol.BATTERY_LEVEL) ?: return
        enqueue { if (!g.readCharacteristic(ch)) { log("battery read rejected"); opDone() } }
    }

    // ---- PMD accelerometer stream (cadence) ----

    /**
     * Start the PMD accelerometer stream on the live connection. Additive to the HR
     * notifications, which keep running untouched — HR is the strap's primary job and must
     * not be disturbed by a cadence stream that may fail on its own.
     *
     * Silently no-ops when the H10 does not expose PMD; the caller falls back to ring cadence.
     */
    fun startAccStream() {
        val g = gatt ?: return log("acc stream requested with no connection")
        if (state != State.READY) return log("acc stream requested before ready (state=$state)")
        if (accStreaming) return
        val service = g.getService(PolarProtocol.PMD_SERVICE)
            ?: return log("PMD service not exposed — no strap cadence available")
        val data = service.getCharacteristic(PolarProtocol.PMD_DATA)
            ?: return log("PMD data characteristic missing")
        val control = service.getCharacteristic(PolarProtocol.PMD_CONTROL_POINT)
            ?: return log("PMD control point missing")

        accStreaming = true
        enqueue { subscribe(g, control, indication = true) }
        enqueue { subscribe(g, data, indication = false) }
        enqueue {
            @Suppress("DEPRECATION")
            run {
                control.value = PolarProtocol.buildAccStartCommand()
                control.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                if (!g.writeCharacteristic(control)) { log("pmd start write rejected"); opDone() }
            }
        }
        log("acc stream starting at ${PolarProtocol.ACC_SAMPLE_RATE_HZ} Hz")
    }

    /** Stop the PMD stream, leaving the connection and HR notifications in place. */
    fun stopAccStream() {
        if (!accStreaming) return
        accStreaming = false
        val g = gatt ?: return
        val service = g.getService(PolarProtocol.PMD_SERVICE) ?: return
        val control = service.getCharacteristic(PolarProtocol.PMD_CONTROL_POINT)
        val data = service.getCharacteristic(PolarProtocol.PMD_DATA)
        if (control != null) {
            enqueue {
                @Suppress("DEPRECATION")
                run {
                    control.value = PolarProtocol.buildAccStopCommand()
                    control.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    if (!g.writeCharacteristic(control)) { log("pmd stop write rejected"); opDone() }
                }
            }
        }
        if (data != null) enqueue { unsubscribe(g, data) }
        log("acc stream stopped")
    }

    fun isAccStreaming() = accStreaming

    @Suppress("DEPRECATION")
    private fun subscribe(g: BluetoothGatt, c: BluetoothGattCharacteristic, indication: Boolean) {
        g.setCharacteristicNotification(c, true)
        val cccd = c.getDescriptor(PolarProtocol.CCCD) ?: run {
            log("CCCD missing on ${c.uuid}"); opDone(); return
        }
        cccd.value = if (indication) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                     else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        if (!g.writeDescriptor(cccd)) { log("writeDescriptor(${c.uuid}) rejected"); opDone() }
    }

    @Suppress("DEPRECATION")
    private fun unsubscribe(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
        g.setCharacteristicNotification(c, false)
        val cccd = c.getDescriptor(PolarProtocol.CCCD) ?: run { opDone(); return }
        cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
        if (!g.writeDescriptor(cccd)) opDone()
    }

    fun close() {
        closed = true
        accStreaming = false
        cancelConnectTimeout()
        opQueue.clear(); opInFlight = false
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        gatt = null
        if (state != State.CLOSED) setState(State.CLOSED)
    }
}
