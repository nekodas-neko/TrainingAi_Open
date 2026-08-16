package com.trainingai.app.oura

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Restart the ring service after a reboot or an app update, so the set-and-forget
 *  sync survives without the owner reopening the app. Only acts if a key is stored
 *  (nothing to connect to otherwise).
 *
 *  Caveat (targetSdk 36): a `connectedDevice` foreground service is NOT on Android's
 *  allowlist for starting from BOOT_COMPLETED, so `startForegroundService()` here can
 *  throw `ForegroundServiceStartNotAllowedException`. We attempt it and swallow that
 *  failure — the service still comes up the next time the app is opened (auto-start),
 *  and START_STICKY + the battery-optimization exemption keep an already-running
 *  service alive across most kills. CompanionDeviceManager presence (the robust
 *  wake-on-advertise path) remains a queued follow-up. */
class OuraBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }
        val prefs = context.getSharedPreferences("oura_ble", Context.MODE_PRIVATE)
        if (!prefs.contains("key_hex")) return

        val svc = Intent(context, OuraRingService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(svc)
            else context.startService(svc)
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (connectedDevice type isn't
            // boot-allowed on newer Android) — the service will start on next app open.
            android.util.Log.w("OuraBootReceiver", "boot service start blocked: ${e.message}")
        }
    }
}
