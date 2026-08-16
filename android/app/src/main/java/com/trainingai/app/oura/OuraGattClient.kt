package com.trainingai.app.oura

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.ArrayDeque

/** One scan→connect→auth lifecycle against the ring. Owned and restarted by
 *  OuraRingService; reports everything through the listener so the service can
 *  apply the backoff/wedge policy and the plugin can mirror it to JS.
 *
 *  Phase-0 lessons applied here: scan by manufacturer id 0x02b2 + name prefix,
 *  NEVER by address (RE2) and never with an OS service-UUID filter (D1/D2);
 *  request MTU 247; subscribe every notify/indicate characteristic in the ring
 *  service; auth per connection; on INSUFFICIENT_AUTHENTICATION try createBond()
 *  once and record what happened (RE8). */
@SuppressLint("MissingPermission") // service checks BLUETOOTH_SCAN/CONNECT before starting
class OuraGattClient(
    private val context: Context,
    private val key: ByteArray,
    private val listener: Listener,
) {
    interface Listener {
        fun onLog(line: String)
        fun onState(state: State)
        fun onReady()
        fun onFrame(frame: OuraProtocol.Frame, raw: ByteArray)
        fun onFailure(reason: String)   // terminal for this attempt — service decides on retry
    }

    enum class State { IDLE, SCANNING, CONNECTING, PREPARING, AUTHENTICATING, READY, CLOSED }

    companion object {
        // Gap between stopScan() and connectGatt() to let the radio finish the
        // stop-scan HCI transaction first — see the scanCallback comment below.
        private const val CONNECT_SETTLE_MS = 500L
        // Same-device retry before falling back to a full re-scan (which costs the
        // ring's current rotating address, RE2). REVERTED HERE from autoConnect=true
        // (tried on-device, 2026-07-07): autoConnect=true failed *instantly* and
        // *deterministically* with status 135 on repeated attempts, including after a
        // full phone reboot (ruling out accumulated Bluetooth-stack state) — worse
        // than direct connect's earlier intermittent ~8-10s-delayed status-133
        // failures, which at least suggested real negotiation was happening. Samsung's
        // BLE stack has a known history of non-standard autoConnect behaviour, so
        // going back to a direct connect (autoConnect=false) is the better-evidenced
        // choice pending real HCI-snoop-log diagnosis of the underlying failure.
        private const val MAX_LOCAL_CONNECT_RETRIES = 2
        private const val LOCAL_RETRY_DELAY_MS = 800L
        // Safety-net timeout in case connectGatt() never calls back at all.
        private const val CONNECT_TIMEOUT_MS = 15_000L
    }

    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var state = State.IDLE
    private var closed = false
    private var bondAttempted = false
    private var connectTimeoutRunnable: Runnable? = null
    private var pendingDevice: BluetoothDevice? = null
    private var localConnectRetriesLeft = 0

    // GATT allows one outstanding operation; queue descriptor + characteristic writes.
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

    // ---- scan ----

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            // The BLE stack can deliver a queued/duplicate advertisement report after
            // stopScan() has already been called for a prior hit (it's not synchronous);
            // ignore anything once we've moved past SCANNING to avoid a second connect
            // attempt racing the first (that produced a real GATT status 133 on-device).
            if (state != State.SCANNING) return
            val name = result.scanRecord?.deviceName ?: result.device.name
            val mfr = result.scanRecord?.getManufacturerSpecificData(OuraProtocol.MANUFACTURER_ID)
            log("scan hit: name=$name rssi=${result.rssi} mfrMatch=${mfr != null}")
            stopScan()
            setState(State.CONNECTING)
            pendingDevice = result.device
            localConnectRetriesLeft = MAX_LOCAL_CONNECT_RETRIES
            // Connecting in the same tick as stopScan() can race the radio still
            // finishing the stop-scan HCI transaction — a known cause of generic
            // Android BLE connect failures (status 133/147, seen on-device). Give
            // it a brief settle before issuing connectGatt(). Guard against this
            // client having been close()'d (e.g. superseded by a retry) during
            // the settle window — a stray connectGatt() on a retired client would
            // leak a dangling GATT connection nothing tears down.
            main.postDelayed({ if (!closed) connect(result.device) }, CONNECT_SETTLE_MS)
        }
        override fun onScanFailed(errorCode: Int) {
            listener.onFailure("scan failed: code=$errorCode")
        }
    }

    fun start(scanTimeoutMs: Long) {
        setState(State.SCANNING)
        val scanner = manager.adapter?.bluetoothLeScanner
            ?: return listener.onFailure("bluetooth adapter unavailable")
        // D1/D2 lesson: no service-UUID filter. Manufacturer-id filter keeps the scan
        // legal with the screen off; name filter is the belt-and-braces second match.
        val filters = listOf(
            ScanFilter.Builder().setManufacturerData(OuraProtocol.MANUFACTURER_ID, byteArrayOf(), byteArrayOf()).build(),
            ScanFilter.Builder().setDeviceName("Oura Ring 5").build(),
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        log("scanning (mfr 0x02b2 + name filters, ${scanTimeoutMs / 1000}s window)…")
        scanner.startScan(filters, settings, scanCallback)
        main.postDelayed(scanTimeoutRunnable, scanTimeoutMs)
    }

    private val scanTimeoutRunnable = Runnable {
        if (state == State.SCANNING) {
            stopScan()
            listener.onFailure("scan timeout — ring not advertising (worn + moving wakes it, RE4)")
        }
    }

    private fun stopScan() {
        main.removeCallbacks(scanTimeoutRunnable)
        try { manager.adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
    }

    // ---- connect / prepare / auth ----

    private fun connect(device: BluetoothDevice) {
        setState(State.CONNECTING)
        log("connecting to ${device.address} (bondState=${device.bondState})")
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        val timeoutRunnable = Runnable {
            log("connect timeout after ${CONNECT_TIMEOUT_MS / 1000}s — abandoning for a fresh scan")
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

    @Suppress("DEPRECATION") // legacy write API works on all API levels incl. the S25; spike-appropriate
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            log("connectionStateChange status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                cancelConnectTimeout()
                setState(State.PREPARING)
                g.requestMtu(OuraProtocol.PREFERRED_MTU)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                cancelConnectTimeout()
                val wasReady = state == State.READY
                val device = pendingDevice
                if (!wasReady && !closed && device != null && localConnectRetriesLeft > 0) {
                    // Generic connect-establishment failure — retry the SAME device
                    // object a few times before falling back to a full re-scan.
                    // Discard this BluetoothGatt but don't tear down the whole client
                    // (that would notify the service of a terminal failure).
                    localConnectRetriesLeft--
                    log("connect failed (status=$status) — retrying same device (${localConnectRetriesLeft} left)")
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
            val service = g.getService(OuraProtocol.RING_SERVICE)
                ?: return listener.onFailure("ring service missing after discovery")
            writeChar = service.getCharacteristic(OuraProtocol.WRITE_CHAR)
            // Subscribe EVERY notify/indicate characteristic in the service (skill §2 —
            // Ring 5's 0004/0005/0006 roles are uncharacterised; subscribe them all).
            for (ch in service.characteristics) {
                val props = ch.properties
                val notify = props and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
                val indicate = props and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
                if (!notify && !indicate) continue
                enqueue {
                    g.setCharacteristicNotification(ch, true)
                    val cccd = ch.getDescriptor(OuraProtocol.CCCD) ?: run { opDone(); return@enqueue }
                    cccd.value = if (notify) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                 else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    if (!g.writeDescriptor(cccd)) { log("writeDescriptor(${ch.uuid}) rejected"); opDone() }
                }
            }
            enqueue { opDone(); startAuth() }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (status == 5 /* GATT_INSUFFICIENT_AUTHENTICATION */ || status == 8 || status == 137) {
                // RE8: record whether Android auto-bonds or we must createBond() ourselves.
                log("RE8: CCCD write insufficient-auth (status=$status), bondAttempted=$bondAttempted")
                if (!bondAttempted) {
                    bondAttempted = true
                    log("RE8: calling createBond(); service will retry the connection after bonding")
                    g.device.createBond()
                }
                close()
                listener.onFailure("insufficient authentication — bonding initiated")
                return
            }
            if (status != BluetoothGatt.GATT_SUCCESS) log("descriptor write status=$status on ${d.characteristic.uuid}")
            opDone()
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) log("characteristic write status=$status")
            opDone()
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            val raw = c.value ?: return
            val frame = OuraProtocol.parseFrame(raw)
            if (frame == null) { log("unparsed notification: ${raw.joinToString("") { "%02x".format(it) }}"); return }
            handleFrame(frame, raw)
        }
    }

    private fun startAuth() {
        setState(State.AUTHENTICATING)
        log("auth: requesting nonce")
        write(OuraProtocol.reqNonce())
    }

    private fun handleFrame(frame: OuraProtocol.Frame, raw: ByteArray) {
        if (state == State.AUTHENTICATING && OuraProtocol.isNonceResponse(frame)) {
            log("auth: nonce received, sending encrypted response")
            write(OuraProtocol.reqAuthenticate(OuraAuth.encryptNonce(key, OuraProtocol.nonceFrom(frame))))
            return
        }
        if (state == State.AUTHENTICATING && frame.tag == 0x2f && frame.subOp == 0x2e) {
            if (OuraProtocol.authSucceeded(frame)) {
                setState(State.READY)
                log("auth: SUCCESS")
                listener.onReady()
            } else {
                listener.onFailure("auth REJECTED — wrong key?")
                close()
            }
            return
        }
        listener.onFrame(frame, raw)
    }

    /** Connection-parameter tuning: HIGH (7.5–15 ms interval) makes a history drain
     *  several times faster; BALANCED is the idle-hold default so the held link
     *  doesn't cost battery. Best-effort — some stacks reject the request. */
    fun setConnectionPriority(high: Boolean) {
        val g = gatt ?: return
        val accepted = try {
            g.requestConnectionPriority(
                if (high) BluetoothGatt.CONNECTION_PRIORITY_HIGH
                else BluetoothGatt.CONNECTION_PRIORITY_BALANCED)
        } catch (_: Exception) { false }
        log("connection priority → ${if (high) "HIGH" else "BALANCED"} (accepted=$accepted)")
    }

    /** Serialised write of one command frame to the ring. */
    @Suppress("DEPRECATION")
    fun write(command: ByteArray) {
        val g = gatt ?: return
        val ch = writeChar ?: return
        enqueue {
            ch.value = command
            ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            if (!g.writeCharacteristic(ch)) { log("writeCharacteristic rejected"); opDone() }
        }
    }

    fun close() {
        closed = true
        stopScan()
        cancelConnectTimeout()
        opQueue.clear(); opInFlight = false
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        gatt = null
        if (state != State.CLOSED) setState(State.CLOSED)
    }
}
