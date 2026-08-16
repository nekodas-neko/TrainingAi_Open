package com.trainingai.app.scale

import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log

/**
 * Fires when the Bluetooth stack sees the paired scale advertising — i.e. someone just stepped
 * on it. Registered via ScaleBleScanManager.start(), a PendingIntent-based scan rather than a
 * continuously-running foreground service, so this can fire even after the app process has been
 * killed, with no ongoing notification while the scale is asleep (the vast majority of the time).
 * Starts ScaleBleService, which now holds the connection open persistently once it links
 * (2026-08-01 — see the service's class doc) rather than disconnecting after one reading. This
 * receiver mainly matters for the very first connect of a session; once linked, a redundant scan
 * hit is just ignored (ScaleBleService.cycleActive stays true for the life of the connection).
 *
 * Gated on ScaleForegroundScanner.isHomeScreenActive() (2026-08-01, owner request): the whole
 * scale feature, including the now-persistent connection, is scoped to the Home screen only —
 * a scan hit that arrives while the owner is elsewhere in the app (Settings/Nutrition/etc.) is
 * ignored rather than opening a connection nobody's there to see and paying its battery cost
 * for no reason. This scan itself (ScaleBleScanManager) keeps running regardless of screen —
 * only whether a hit is allowed to act on is scoped, not the passive listening. The registration
 * this receiver fires from still survives the app process being killed, but a killed process
 * has no Home-screen state either way, so ScaleForegroundScanner's default (false) already does
 * the right thing there.
 */
class ScaleScanReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION = "com.trainingai.app.scale.SCAN_RESULT"
        /** PendingIntent-based BLE scans have been observed on-device (2026-07-30) to redeliver
         *  a stale match well after the scale actually stopped advertising: an independent BLE
         *  scanner (nRF Connect) showed the scale advertising ONLY while someone was stepping on
         *  it, yet this receiver kept firing every ~3 minutes regardless with nobody near it.
         *  Trusting "onReceive fired" alone as proof of a live weigh-in was wrong — each
         *  ScanResult carries its own timestamp, so require at least one to be genuinely recent. */
        private const val MAX_RESULT_AGE_MS = 5_000L
    }

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences("scale_ble", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null)
        if (deviceId == null || !hasRecentMatch(intent, deviceId)) {
            Log.d("ScaleScanReceiver", "ignoring stale/replayed/unrelated scan result")
            return
        }
        if (!ScaleForegroundScanner.isHomeScreenActive()) {
            Log.d("ScaleScanReceiver", "ignoring scan hit — not on Home screen")
            return
        }
        val svc = Intent(context, ScaleBleService::class.java)
            .putExtra(ScaleBleService.EXTRA_SCAN_SOURCE, ScaleBleService.SOURCE_BACKGROUND)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(svc)
            else context.startService(svc)
        } catch (e: Exception) {
            Log.w("ScaleScanReceiver", "could not start ScaleBleService: ${e.message}")
        }
    }

    /** Confirmed on-device 2026-07-31: the OS-level ScanFilter (ScaleBleScanManager) matches on
     *  the FFE0 service UUID alone, which is an extremely common generic pattern shared by
     *  unrelated cheap BLE peripherals built on the same generic Bluetooth-serial module (fitness
     *  bands, LED controllers, OBD adapters, etc.) — any of those advertising nearby triggered a
     *  real connect attempt against a device that was never the paired scale, which always ends
     *  in the misleading "Weigh-in not captured — step on the scale again" notification with
     *  nobody near the actual scale. Checking the matched result's own address against the
     *  paired scale's stored MAC here is safe and doesn't reintroduce the risk ScaleBleScanManager's
     *  class doc describes for `ScanFilter.setDeviceAddress()` — that risk is specifically about
     *  telling the OS scanner to filter by address *type* (public vs static-random) before any
     *  match exists; this is a plain string comparison against a result the service-UUID filter
     *  already found. */
    @Suppress("DEPRECATION") // the untyped overload is still required below API 33 (minSdk 26)
    private fun hasRecentMatch(intent: Intent, deviceId: String): Boolean {
        val results: List<ScanResult> = (
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
            } else {
                intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT)
            }
        ) ?: return false
        if (results.isEmpty()) return false
        val nowNanos = SystemClock.elapsedRealtimeNanos()
        val maxAgeNanos = MAX_RESULT_AGE_MS * 1_000_000L
        return results.any {
            nowNanos - it.timestampNanos <= maxAgeNanos && it.device.address.equals(deviceId, ignoreCase = true)
        }
    }
}
