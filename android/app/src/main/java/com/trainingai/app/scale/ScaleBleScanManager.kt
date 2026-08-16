package com.trainingai.app.scale

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.ParcelUuid
import android.util.Log

/**
 * Registers/unregisters the passive BLE scan that wakes ScaleScanReceiver when the paired scale
 * starts advertising (someone just stepped on it). This registration lives with the Bluetooth
 * stack, not this app's process — it survives the app being killed, unlike the old design where
 * ScaleBleService itself had to keep running continuously (with an always-visible notification)
 * just to retry a connect attempt every 45s, most of which failed simply because the scale was
 * asleep.
 *
 * Filtered by the FFE0 service UUID (ScaleProtocol.SCALE_SERVICE), the same filter
 * scale-pairing.tsx's `BleClient.requestDevice({services:[SCALE_SERVICE]})` already uses and has
 * proven correct on real hardware — deliberately NOT `ScanFilter.setDeviceAddress()`, which
 * assumes a PUBLIC BLE address type unless told otherwise; we don't actually know whether this
 * scale's stable MAC is a public or static-random address, and guessing wrong there would make
 * the scan silently never match (worse than the rare cost of a stray FFE0 device nearby
 * triggering a harmless, self-correcting connect attempt — ScaleGattClient/ScaleProtocol already
 * reject anything that doesn't decode as a real weigh-in packet).
 */
@SuppressLint("MissingPermission") // callers check BLUETOOTH_SCAN before calling
object ScaleBleScanManager {
    private const val TAG = "ScaleBleScanManager"
    private const val REQUEST_CODE = 4001

    private fun scanIntent(context: Context): PendingIntent {
        val intent = Intent(context, ScaleScanReceiver::class.java).setAction(ScaleScanReceiver.ACTION)
        return PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    /** deviceId is accepted for parity with stop()/callers and to keep the door open for a
     *  tighter combined filter later, but is not used for matching today — see the class doc. */
    @Suppress("UNUSED_PARAMETER")
    fun start(context: Context, deviceId: String): Boolean {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val scanner = manager?.adapter?.bluetoothLeScanner
        if (scanner == null) { Log.w(TAG, "no BLE scanner available (adapter off?)"); return false }
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(ScaleProtocol.SCALE_SERVICE)).build()
        // LOW_LATENCY, not LOW_POWER (2026-07-30): confirmed on-device that the dominant weigh-in
        // failure is a race between the scale's own (fast) measurement cycle and the phone's
        // connect→discover→subscribe→request pipeline — the person often steps off before the
        // request goes out. LOW_POWER's duty-cycled scan window adds avoidable seconds to
        // detecting the advertisement in the first place, on top of everything downstream. This
        // filtered PendingIntent scan only runs the few seconds someone's actually on the scale a
        // couple of times a day — reliability over battery for an opt-in, rarely-active feature.
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        return try {
            scanner.startScan(listOf(filter), settings, scanIntent(context))
            true
        } catch (e: Exception) {
            Log.w(TAG, "startScan failed: ${e.message}")
            false
        }
    }

    fun stop(context: Context) {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val scanner = manager?.adapter?.bluetoothLeScanner ?: return
        try { scanner.stopScan(scanIntent(context)) } catch (e: Exception) {
            Log.w(TAG, "stopScan failed: ${e.message}")
        }
    }
}
