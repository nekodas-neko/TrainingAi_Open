package com.trainingai.app.oura

import android.Manifest
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "OuraBle",
    permissions = [Permission(
        alias = "bluetooth",
        strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
    )],
)
class OuraBlePlugin : Plugin() {

    override fun load() {
        OuraRingService.eventSink = { type, data ->
            notifyListeners(type, JSObject.fromJSONObject(data))
        }
    }

    private fun prefs() = context.getSharedPreferences("oura_ble", android.content.Context.MODE_PRIVATE)

    // ---- key management (the key is never logged; `revealKey` is its only way out) ----

    @PluginMethod fun setKey(call: PluginCall) {
        val hex = call.getString("hex") ?: return call.reject("hex required")
        if (OuraAuth.parseKeyHex(hex) == null) return call.reject("key must be 32 hex chars")
        prefs().edit().putString("key_hex", hex.trim().lowercase()).apply()
        call.resolve()
    }

    @PluginMethod fun hasKey(call: PluginCall) =
        call.resolve(JSObject().put("hasKey", prefs().contains("key_hex")))

    @PluginMethod fun clearKey(call: PluginCall) {
        prefs().edit().remove("key_hex").apply(); call.resolve()
    }

    /**
     * Return the stored key so it can be copied somewhere durable (Q-537).
     *
     * **Why this exists, given the rule right above it.** The key had exactly one copy — this
     * one — with no export and no backup. An uninstall or a device change destroys it silently:
     * the service logs `no key stored` and refuses to start, while the Devices card keeps showing
     * the ring as healthy because it reads server data. The intuitive recovery is worse than the
     * loss, because re-onboarding the official Oura app re-keys the ring and can force a firmware
     * update that changes the BLE event encoding — turning a recoverable credential problem into
     * a protocol re-validation. That happened on 2026-08-17 and was only survived because the
     * original `open_oura` `key.hex` still existed on a machine somewhere.
     *
     * **What it does not change.** Every caller of this plugin is already JS inside this app's own
     * WebView, and that caller can today call `setKey` to replace the key or `clearKey` to destroy
     * it. Reading it is strictly weaker than either. What stays true is that the key is never
     * written to the log, never sent to the server, and never leaves the device except through a
     * person deliberately asking for it here.
     */
    @PluginMethod fun revealKey(call: PluginCall) {
        val hex = prefs().getString("key_hex", null)
            ?: return call.reject("no key stored")
        call.resolve(JSObject().put("hex", hex))
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
        if (!prefs().contains("key_hex")) return call.reject("no key stored")
        val intent = Intent(context, OuraRingService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        call.resolve()
    }

    @PluginMethod fun stopService(call: PluginCall) {
        context.stopService(Intent(context, OuraRingService::class.java))
        call.resolve()
    }

    // ---- battery optimization (Samsung kills unexempted background services, ops L9) ----

    @PluginMethod fun isBatteryExempt(call: PluginCall) {
        val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        call.resolve(JSObject().put("exempt", pm.isIgnoringBatteryOptimizations(context.packageName)))
    }

    /** Open the system "ignore battery optimizations" dialog for this app. Resolves
     *  immediately with the pre-prompt state; the tester re-reads isBatteryExempt after.
     *  A no-op prompt when already exempt. */
    @PluginMethod fun requestBatteryExemption(call: PluginCall) {
        val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        if (pm.isIgnoringBatteryOptimizations(context.packageName)) {
            return call.resolve(JSObject().put("exempt", true).put("requested", false))
        }
        val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(android.net.Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("exempt", false).put("requested", true))
        } catch (e: Exception) {
            call.reject("could not open battery-optimization settings: ${e.message}")
        }
    }

    @PluginMethod fun getStatus(call: PluginCall) {
        val svc = OuraRingService.instance
            ?: return call.resolve(JSObject().put("state", "stopped"))
        call.resolve(JSObject.fromJSONObject(svc.status()))
    }

    @PluginMethod fun getLog(call: PluginCall) {
        // Pass the JSONArray straight into put(String, Object): JSArray.from() only
        // accepts a real Java array (it wraps JSONArray(Object)), so it would return
        // null for our org.json.JSONArray and send {"lines": null} to JS.
        val svc = OuraRingService.instance
            ?: return call.resolve(JSObject().put("lines", org.json.JSONArray()))
        call.resolve(JSObject().put("lines", svc.logSnapshot()))
    }

    // ---- commands (all require state=ready; each returns {sent: boolean}) ----

    private fun send(call: PluginCall, command: ByteArray) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        call.resolve(JSObject().put("sent", svc.sendCommand(command)))
    }

    @PluginMethod fun readBattery(call: PluginCall) = send(call, OuraProtocol.reqBattery())
    @PluginMethod fun readInfo(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        svc.sendCommand(OuraProtocol.reqFirmwareVersion())
        svc.sendCommand(OuraProtocol.reqSerialNumber())
        call.resolve(JSObject().put("sent", true))
    }
    @PluginMethod fun syncTime(call: PluginCall) =
        send(call, OuraProtocol.reqSyncTime(System.currentTimeMillis() / 1000))

    @PluginMethod fun startLiveHr(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.liveHrStartSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun stopLiveHr(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.liveHrStopSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }

    /** Isolation lever for the live-HR investigation: toggle BLE fast-HR mode
     *  (`16 01 01`/`16 01 00`) on its own so the tester can tell whether it — rather
     *  than the feature-mode changes — is what makes the ring stream. */
    @PluginMethod fun fastHr(call: PluginCall) {
        val on = call.getBoolean("on", true) ?: true
        send(call, OuraProtocol.reqBleFastHrMode(on))
    }

    /** Isolation lever: set any feature to any mode (`2f 03 22 <feature> <mode>`) so the
     *  tester can sweep DAYTIME_HR/EXERCISE_HR/SPO2 × modes on-device without a rebuild. */
    @PluginMethod fun setFeatureMode(call: PluginCall) {
        val feature = call.getInt("feature") ?: return call.reject("feature required")
        val mode = call.getInt("mode") ?: return call.reject("mode required")
        send(call, OuraProtocol.reqSetFeatureMode(feature, mode))
    }

    /** "Measure now" — fire the DHR on-demand burst (open_ring's `0x26` sub-mode write).
     *  The ring reverts after ~20 s, so the JS live-HR source re-calls this every ~15 s. */
    @PluginMethod fun triggerHrBurst(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.dhrBurstSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun startAccel(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.accelStartSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun stopAccel(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.accelStopSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }

    /** History drain: auto-loops GetHistory from the persisted deciseconds cursor
     *  (RE9) until the ring reports the backlog is empty. Raw frames stream to JS as
     *  ouraFrame events; the debug screen counts by tag. The service advances +
     *  persists the cursor on each 0x11 completion packet and requests the next batch. */
    @PluginMethod fun drainHistory(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        val fromZero = call.getBoolean("fromZero", false) ?: false
        val cursor = if (fromZero) 0L else prefs().getLong("history_cursor_ds", 0L)
        call.resolve(JSObject().put("sent", svc.startDrain(fromZero)).put("cursor", cursor))
    }

    /** Advance the persisted resume cursor after the server confirms storage.
     *  `ds` is deciseconds (can exceed Int32) so it arrives as a JS number (double).
     *  Normally driven by the service's own native ingest; kept as a plugin method so
     *  a legacy JS forwarding loop (older Railway bundle) stays correct too. */
    @PluginMethod fun confirmStored(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        val ds = call.getDouble("ds") ?: return call.reject("ds required")
        call.resolve(JSObject().put("ok", svc.confirmStored(ds.toLong())))
    }

    /** Store the server origin the service POSTs drained frames to. Called by the
     *  app shell on every open (window.location.origin), so the running service
     *  always has a current target; persisted so a restarted service has it too. */
    @PluginMethod fun setIngestUrl(call: PluginCall) {
        val url = call.getString("url")?.trim()?.trimEnd('/') ?: return call.reject("url required")
        if (!url.startsWith("http")) return call.reject("url must be absolute")
        prefs().edit().putString("ingest_url", url).apply()
        OuraRingService.instance?.setIngestUrl(url)
        call.resolve()
    }

    /** Force the measurement features (DAYTIME_HR + SPO2 + REAL_STEPS) to AUTOMATIC so
     *  the ring records HR/temp/SpO₂/steps to its history. The service does this on
     *  connect; this is the manual lever for the tester. */
    @PluginMethod fun enableMeasurement(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        call.resolve(JSObject().put("sent", svc.enableMeasurement()))
    }

    /** Query the current mode of DAYTIME_HR + SPO2 + REAL_STEPS (diagnostic). Responses
     *  arrive as ouraFrame events. */
    @PluginMethod fun featureStatus(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        call.resolve(JSObject().put("sent", svc.featureStatus()))
    }

    // ---- raw store bridge (the WebView's ONLY door to oura_raw.db) ----
    //
    // The WebView must never open the file itself: two SQLite libraries on one WAL is a
    // two-writer SQLITE_BUSY waiting to happen, so native owns the connection and the
    // WebView reaches rows through these methods. Available whether or not the BLE service
    // is running — a rollup shouldn't need a connected ring.

    private fun rawDb(call: PluginCall): OuraRawDb? {
        val db = OuraRawDb.get(context)
        if (db == null) call.reject("raw store unavailable")
        return db
    }

    /** The oldest rows the WebView hasn't rolled up yet, in ring order. May return slightly
     *  more than `limit` — a ring_ts is never split across calls, because rows are marked
     *  consumed by ring_ts and a split would let the caller mark rows it never saw. */
    @PluginMethod fun getUnrolledRaw(call: PluginCall) {
        val db = rawDb(call) ?: return
        val limit = (call.getInt("limit") ?: 500).coerceIn(1, 5000)
        val rows = org.json.JSONArray()
        db.getUnrolledRaw(limit).forEach { r ->
            rows.put(
                org.json.JSONObject()
                    .put("ringTs", r.ringTs)
                    .put("tag", r.tag)
                    .put("eventName", r.eventName)
                    .put("bodyHex", r.bodyHex)
                    .put("measuredAt", r.measuredAt ?: org.json.JSONObject.NULL),
            )
        }
        call.resolve(JSObject().put("rows", rows))
    }

    /** Ring deciseconds arrive as JS numbers (doubles) — they exceed Int32. */
    private fun dsList(call: PluginCall): List<Long>? {
        val arr = call.getArray("ringTsList") ?: return null
        return (0 until arr.length()).mapNotNull { i -> (arr.opt(i) as? Number)?.toLong() }
    }

    @PluginMethod fun markRolledUp(call: PluginCall) {
        val db = rawDb(call) ?: return
        val list = dsList(call) ?: return call.reject("ringTsList required")
        call.resolve(JSObject().put("updated", db.markRolledUp(list)))
    }

    @PluginMethod fun markSynced(call: PluginCall) {
        val db = rawDb(call) ?: return
        val list = dsList(call) ?: return call.reject("ringTsList required")
        call.resolve(JSObject().put("updated", db.markSynced(list)))
    }

    /** Delete rolled-up, server-backed rows older than `olderThanMs`, stopping early once
     *  free disk reaches `reserveBytes`. Rows that are not both rolled up and synced are
     *  never eligible — `body_hex` is the only thing a future decoder fix can be re-run
     *  against, so it outlives everything derived from it. */
    @PluginMethod fun pruneRaw(call: PluginCall) {
        val db = rawDb(call) ?: return
        val olderThanMs = call.getDouble("olderThanMs")?.toLong() ?: return call.reject("olderThanMs required")
        val reserveBytes = call.getDouble("reserveBytes")?.toLong() ?: 0L
        call.resolve(JSObject().put("deleted", db.pruneRaw(olderThanMs, reserveBytes)))
    }

    @PluginMethod fun rawStats(call: PluginCall) {
        val db = rawDb(call) ?: return
        val (total, unrolled, bytes) = db.stats()
        call.resolve(
            JSObject()
                .put("totalRows", total)
                .put("unrolledRows", unrolled)
                .put("bytes", bytes)
                .put("lowDisk", db.lowDisk),
        )
    }

    /** Every observed `(ringDs ↔ utc)` anchor, for the WebView rollup to resolve a ds against
     *  via clock.ts's `resolveDsToMs` (nearest/interpolated within its epoch) — the on-device
     *  mirror of `getOuraClockAnchors` in adapter.ts. */
    @PluginMethod fun getClockAnchors(call: PluginCall) {
        val db = rawDb(call) ?: return
        val anchors = org.json.JSONArray()
        db.getClockAnchors().forEach { a ->
            anchors.put(
                org.json.JSONObject()
                    .put("epoch", a.epoch)
                    .put("anchorDs", a.anchorDs)
                    .put("anchorUtcMs", a.anchorUtcMs)
                    .put("observedSource", a.observedSource),
            )
        }
        call.resolve(JSObject().put("anchors", anchors))
    }
}
