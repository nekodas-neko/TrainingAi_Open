package com.trainingai.app.scale

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log

/**
 * Live (non-PendingIntent) BLE scan — purely an additive fast path on top of
 * ScaleBleScanManager's always-on background scan.
 *
 * A PendingIntent-based scan delivers matches through a system broadcast, which on-device
 * testing (2026-07-30) showed noticeably lagging a direct in-process ScanCallback — enough that
 * the "weigh-in detected" toast was landing seconds after the person had already stepped off.
 * Calls the exact same ScaleBleService the background scan does — ScaleBleService's own
 * `cycleActive` guard (onStartCommand) already makes a redundant start from both paths firing on
 * the same advertisement a harmless no-op, so this needs no extra de-duplication.
 *
 * Gated on two independent signals, both of which must hold — deliberately narrower than "the
 * app is open": the owner asked (2026-07-31) to scope this to the home screen specifically, not
 * every screen, to avoid needlessly running the more battery-hungry LOW_LATENCY scan while
 * they're deep in Settings/Nutrition/etc. with no reason to expect a weigh-in.
 *   - `appResumed`: mirrors MainActivity's onResume/onPause.
 *   - `homeScreenActive`: pushed from JS (usePathname in capacitor-native-init.tsx) — Capacitor
 *     is single-Activity, so native has no visibility into client-side route changes on its own.
 */
@SuppressLint("MissingPermission") // checked below on S+; not a runtime grant pre-S
object ScaleForegroundScanner {
    private const val TAG = "ScaleForegroundScanner"
    private var callback: ScanCallback? = null
    private var appResumed = false
    private var homeScreenActive = false

    fun setAppResumed(context: Context, resumed: Boolean) {
        appResumed = resumed
        refresh(context)
    }

    fun setHomeScreenActive(context: Context, active: Boolean) {
        homeScreenActive = active
        refresh(context)
    }

    /** Read by ScaleScanReceiver (2026-08-01) to gate whether a background scan hit is even
     *  allowed to start ScaleBleService — the whole scale feature, including its now-persistent
     *  connection (see ScaleBleService's class doc), is scoped to the Home screen specifically,
     *  not "the app is open anywhere". */
    fun isHomeScreenActive(): Boolean = homeScreenActive

    /** Unconditional stop, independent of the tracked appResumed/homeScreenActive state — used
     *  when the owner explicitly turns background sync off, which must take effect immediately
     *  regardless of which screen they're on. */
    fun stop(context: Context) = disengage(context)

    /** Re-evaluates eligibility against the currently tracked appResumed/homeScreenActive state —
     *  used when the thing that changed is the `bg_sync_armed` preference itself (turning
     *  background sync on), not either of those two signals. */
    fun onBackgroundSyncToggled(context: Context) = refresh(context)

    private fun refresh(context: Context) {
        if (appResumed && homeScreenActive) engage(context) else disengage(context)
    }

    private fun engage(context: Context) {
        if (callback != null) return
        val prefs = context.getSharedPreferences("scale_ble", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("bg_sync_armed", false)) return
        val deviceId = prefs.getString("device_id", null) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED
        ) return

        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val scanner = manager?.adapter?.bluetoothLeScanner
        if (scanner == null) { Log.w(TAG, "no BLE scanner available (adapter off?)"); return }

        // Same FFE0 service-UUID filter as ScaleBleScanManager — see its class doc for why not
        // setDeviceAddress(). The FFE0/FFE1/FFE2/FFE3 pattern is a common generic
        // Bluetooth-serial-module signature shared by many unrelated cheap BLE peripherals, so a
        // service-UUID-only match can hit a device that isn't the paired scale at all (confirmed
        // on-device 2026-07-31 — see ScaleScanReceiver.hasRecentMatch's doc comment for the full
        // reasoning and why this per-result address check is safe unlike setDeviceAddress()).
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(ScaleProtocol.SCALE_SERVICE)).build()
        // MATCH_MODE_AGGRESSIVE/MATCH_NUM_ONE_ADVERTISEMENT: the hardware filter can report a
        // match after fewer observed advertising packets, at the cost of more false-positive
        // matches and higher power draw — an acceptable tradeoff only now that this scan is
        // scoped to the Home screen specifically (2026-07-31 change above), not running all day;
        // the per-result MAC check a few lines down already rejects any false positive this
        // surfaces before it can start a connect attempt. Given the scale's own advertising
        // interval is 30ms (confirmed via nRF Connect capture, 2026-07-31), the practical gain is
        // small — the default match mode was already fast — but this is free once battery cost is
        // bounded to Home-screen dwell time.
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_ONE_ADVERTISEMENT)
            .build()
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (!result.device.address.equals(deviceId, ignoreCase = true)) return
                val svc = Intent(context, ScaleBleService::class.java)
                    .putExtra(ScaleBleService.EXTRA_SCAN_SOURCE, ScaleBleService.SOURCE_LIVE)
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(svc)
                    else context.startService(svc)
                } catch (e: Exception) {
                    Log.w(TAG, "could not start ScaleBleService: ${e.message}")
                }
            }
            override fun onScanFailed(errorCode: Int) {
                Log.w(TAG, "live scan failed: $errorCode")
                callback = null
            }
        }
        try {
            scanner.startScan(listOf(filter), settings, cb)
            callback = cb
        } catch (e: Exception) {
            Log.w(TAG, "startScan failed: ${e.message}")
        }
    }

    private fun disengage(context: Context) {
        val cb = callback ?: return
        callback = null
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val scanner = manager?.adapter?.bluetoothLeScanner ?: return
        try { scanner.stopScan(cb) } catch (e: Exception) {
            Log.w(TAG, "stopScan failed: ${e.message}")
        }
    }
}
