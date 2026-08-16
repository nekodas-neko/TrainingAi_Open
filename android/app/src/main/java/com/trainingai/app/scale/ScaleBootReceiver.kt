package com.trainingai.app.scale

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms the passive scale scan after a reboot or app update — BLE scan registrations don't
 * survive a device reboot (unlike SharedPreferences), so without this the background-sync toggle
 * would silently stop working until the app was reopened. Registering a scan is NOT starting a
 * foreground service, so — unlike OuraBootReceiver, which has to swallow
 * ForegroundServiceStartNotAllowedException on newer Android — this isn't subject to the
 * BOOT_COMPLETED foreground-service-start restriction at all.
 */
class ScaleBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }
        val prefs = context.getSharedPreferences("scale_ble", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null) ?: return
        if (!prefs.getBoolean("bg_sync_armed", false)) return
        ScaleBleScanManager.start(context, deviceId)
    }
}
