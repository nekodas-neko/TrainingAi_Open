package com.trainingai.app.scale

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** JS bridge for the native scale foreground service. Mirrors PolarBlePlugin's shape. The
 *  scale's deviceId (stable MAC, discovered once during pairing) is set from the JS pairing
 *  flow; the service reads it from SharedPreferences and connects directly. */
@CapacitorPlugin(
    name = "ScaleBle",
    permissions = [Permission(
        alias = "bluetooth",
        strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
    )],
)
class ScaleBlePlugin : Plugin() {

    override fun load() {
        ScaleBleService.eventSink = { type, data ->
            notifyListeners(type, JSObject.fromJSONObject(data))
        }
    }

    private fun prefs() = context.getSharedPreferences("scale_ble", Context.MODE_PRIVATE)

    // ---- paired device (the scale's stable MAC) ----

    @PluginMethod fun setDevice(call: PluginCall) {
        val id = call.getString("deviceId")?.trim() ?: return call.reject("deviceId required")
        prefs().edit().putString("device_id", id).apply()
        call.resolve()
    }

    @PluginMethod fun hasDevice(call: PluginCall) =
        call.resolve(JSObject().put("hasDevice", prefs().contains("device_id")))

    @PluginMethod fun clearDevice(call: PluginCall) {
        prefs().edit().remove("device_id").apply(); call.resolve()
    }

    // ---- permissions ----

    @PluginMethod fun ensurePermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("bluetooth", call, "onBluetoothPermission")
        }
    }

    @PermissionCallback fun onBluetoothPermission(call: PluginCall) =
        call.resolve(JSObject().put("granted", getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED))

    // ---- background sync control (opt-in) ----
    // "Background sync" now means "the passive scan that wakes ScaleBleService when the scale
    // advertises" (ScaleBleScanManager), not a continuously-running foreground service — the
    // service itself only ever runs for the few seconds of an actual weigh-in.

    @PluginMethod fun startService(call: PluginCall) {
        val deviceId = prefs().getString("device_id", null) ?: return call.reject("no scale paired")
        if (!ScaleBleScanManager.start(context, deviceId)) return call.reject("could not start scale scan")
        prefs().edit().putBoolean("bg_sync_armed", true).apply()
        // Re-check eligibility now that bg_sync_armed just flipped on — if the owner happens to
        // already be on the home screen (ScaleForegroundScanner.homeScreenActive), the live scan
        // starts immediately rather than waiting for the next screen change.
        ScaleForegroundScanner.onBackgroundSyncToggled(context)
        call.resolve()
    }

    @PluginMethod fun stopService(call: PluginCall) {
        ScaleBleScanManager.stop(context)
        ScaleForegroundScanner.stop(context)
        prefs().edit().putBoolean("bg_sync_armed", false).apply()
        // In case a connect attempt happens to be mid-flight when the toggle is switched off.
        context.stopService(Intent(context, ScaleBleService::class.java))
        call.resolve()
    }

    /** JS pushes this on every route change (usePathname in capacitor-native-init.tsx) — native
     *  has no visibility into client-side routing on its own since Capacitor is single-Activity.
     *  Scopes the live foreground scan to the home screen specifically (2026-07-31, owner
     *  request) rather than "the app is open anywhere", to avoid running the more battery-hungry
     *  LOW_LATENCY scan while deep in Settings/Nutrition/etc. with no reason to expect a weigh-in.
     *
     *  Also stops ScaleBleService outright on leaving Home (2026-08-01, owner request): the
     *  service's connection is now persistent (see its class doc) rather than a few-seconds
     *  one-shot, so its battery cost is no longer bounded on its own the way it used to be —
     *  scoping the whole feature, not just the scanner, to Home-screen dwell time is what keeps
     *  that cost bounded. ScaleScanReceiver also checks isHomeScreenActive() before starting a
     *  new connection, so this covers both "stop an existing one" and "don't start a new one". */
    @PluginMethod fun setHomeScreenActive(call: PluginCall) {
        val active = call.getBoolean("active") ?: return call.reject("active required")
        ScaleForegroundScanner.setHomeScreenActive(context, active)
        if (!active) context.stopService(Intent(context, ScaleBleService::class.java))
        call.resolve()
    }

    @PluginMethod fun getStatus(call: PluginCall) {
        val svc = ScaleBleService.instance
            ?: return call.resolve(JSObject().put("state", "stopped"))
        call.resolve(JSObject.fromJSONObject(svc.status()))
    }

    /** Store the server origin the service POSTs samples to (window.location.origin),
     *  called on every app open; persisted so a restarted service has it too. */
    @PluginMethod fun setIngestUrl(call: PluginCall) {
        val url = call.getString("url")?.trim()?.trimEnd('/') ?: return call.reject("url required")
        if (!url.startsWith("http")) return call.reject("url must be absolute")
        prefs().edit().putString("ingest_url", url).apply()
        ScaleBleService.instance?.setIngestUrl(url)
        call.resolve()
    }
}
