package com.trainingai.app.polar

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

/** JS bridge for the native chest-strap foreground service. Mirrors OuraBlePlugin's
 *  shape. The strap's deviceId (stable MAC) is set from the JS pairing flow; the
 *  service reads it from SharedPreferences and connects directly. */
@CapacitorPlugin(
    name = "PolarBle",
    permissions = [Permission(
        alias = "bluetooth",
        strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
    )],
)
class PolarBlePlugin : Plugin() {

    override fun load() {
        PolarStrapService.eventSink = { type, data ->
            notifyListeners(type, JSObject.fromJSONObject(data))
        }
    }

    private fun prefs() = context.getSharedPreferences("polar_ble", Context.MODE_PRIVATE)

    // ---- paired device (the H10's stable MAC) ----

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

    // ---- service control ----

    @PluginMethod fun startService(call: PluginCall) {
        if (!prefs().contains("device_id")) return call.reject("no strap paired")
        val intent = Intent(context, PolarStrapService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        call.resolve()
    }

    @PluginMethod fun stopService(call: PluginCall) {
        context.stopService(Intent(context, PolarStrapService::class.java))
        call.resolve()
    }

    @PluginMethod fun getStatus(call: PluginCall) {
        val svc = PolarStrapService.instance
            ?: return call.resolve(JSObject().put("state", "stopped"))
        call.resolve(JSObject.fromJSONObject(svc.status()))
    }

    /** Store the server origin the service POSTs samples to (window.location.origin),
     *  called on every app open; persisted so a restarted service has it too. */
    @PluginMethod fun setIngestUrl(call: PluginCall) {
        val url = call.getString("url")?.trim()?.trimEnd('/') ?: return call.reject("url required")
        if (!url.startsWith("http")) return call.reject("url must be absolute")
        prefs().edit().putString("ingest_url", url).apply()
        PolarStrapService.instance?.setIngestUrl(url)
        call.resolve()
    }

    /** Ambient (all-day, thinned persistence) vs full (in-workout, 1 Hz). */
    @PluginMethod fun setAmbient(call: PluginCall) {
        val ambient = call.getBoolean("ambient", true) ?: true
        PolarStrapService.instance?.setAmbient(ambient)
        call.resolve()
    }

    /**
     * Start/stop the accelerometer stream that feeds cadence. Deliberately explicit and
     * bounded — never all-day — because a continuous stream costs strap and phone battery
     * in a way the 1 Hz HR notifications do not. Rejects when the service is not running so
     * a caller cannot silently believe cadence is being captured when it is not.
     */
    @PluginMethod fun setAccStreaming(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        val svc = PolarStrapService.instance ?: return call.reject("strap service not running")
        svc.setAccStreaming(enabled)
        call.resolve()
    }
}
