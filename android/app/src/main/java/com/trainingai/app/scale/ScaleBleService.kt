package com.trainingai.app.scale

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import com.trainingai.app.MainActivity
import com.trainingai.app.R
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Foreground service that connects to the paired Renpho scale and, on each weigh-in, POSTs the
 * reading to /api/scale-ble/samples using the WebView's own session cookie (same native-HTTP +
 * CookieManager pattern PolarStrapService uses for /api/hr-ingest) — that's what attributes a
 * reading to whichever account is logged in on this phone. Opt-in only (background-sync toggle
 * in scale-pairing.tsx) — this is NOT started automatically, unlike the Oura ring service, so a
 * user without this scale never pays the battery/notification cost.
 *
 * PERSISTENT CONNECTION (2026-08-01): started only when ScaleScanReceiver/
 * ScaleForegroundScanner sees the scale actually advertising, same as before — the scale itself
 * doesn't stay advertising while idle, so there's no way to proactively connect ahead of that.
 * But once ScaleGattClient reports the link genuinely alive (onLinked), the connection is now
 * held open indefinitely and reports every weigh-in that happens on it, the same way
 * PolarStrapService holds the chest-strap connection open all day — it does NOT disconnect after
 * one reading. On-device testing that evening kept finding "instant" success only once a
 * connection had already been established (by nRF Connect, the official app, or this app itself)
 * and never disconnected — which was this app tearing its own connection down every time and
 * starting from zero, not a missing handshake. CYCLE_BUDGET_MS/MAX_ATTEMPTS/RETRY_GAP_MS below
 * now only bound getting to that first live link — once linked, none of them apply anymore, and
 * the service just keeps running (START_STICKY) for as long as background sync stays armed.
 */
class ScaleBleService : Service(), ScaleGattClient.Listener {

    companion object {
        @Volatile var instance: ScaleBleService? = null
        @Volatile var eventSink: ((type: String, data: JSONObject) -> Unit)? = null
        /** Diagnostic only (2026-07-31): both ScaleForegroundScanner (live ScanCallback) and
         *  ScaleBleScanManager (PendingIntent) run concurrently against the same filter, and a
         *  weigh-in reported as still-too-slow despite the live-scan/aggressive-match work makes
         *  it worth knowing, from real on-device logs, which of the two actually won the race —
         *  rather than guessing again at another scan-tuning change. No behavior depends on this. */
        const val EXTRA_SCAN_SOURCE = "scan_source"
        const val SOURCE_LIVE = "live"
        const val SOURCE_BACKGROUND = "background"
        // v2 because NotificationChannel objects are immutable once created — Android will NOT
        // retroactively lower an existing channel's importance, so an upgraded install would keep
        // the old IMPORTANCE_LOW channel and nothing would change. A new id is the only way the
        // drop to IMPORTANCE_MIN actually takes effect for anyone who already has the app.
        private const val CHANNEL_ID = "scale-ble-v2"
        /** Deleted on first run so the superseded channel doesn't linger in Android's notification
         *  settings as an orphan the owner can still see and toggle. */
        private const val LEGACY_CHANNEL_ID = "scale-ble"
        private const val PENDING_CHANNEL_ID = "scale-ble-pending"
        private const val SKIPPED_CHANNEL_ID = "scale-ble-skipped"
        private const val LOGGED_CHANNEL_ID = "scale-ble-logged"
        private const val FAILED_CHANNEL_ID = "scale-ble-failed"
        private const val NOTIF_ID = 2003
        private const val PENDING_NOTIF_ID = 2004
        private const val SKIPPED_NOTIF_ID = 2005
        private const val LOGGED_NOTIF_ID = 2006
        private const val FAILED_NOTIF_ID = 2007
        /** We're only ever started because the scan just saw the scale advertising, so a
         *  connect failure here is a transient GATT hiccup, not "asleep" — worth a handful of
         *  quick tries rather than giving up early. Bumped 3→5 2026-08-01: under the persistent-
         *  connection model, successfully linking even once now pays off for the rest of the
         *  session (see the class doc) instead of being thrown away after a single reading, which
         *  changes the cost/benefit of trying harder to get that first link. Soft cap only —
         *  CYCLE_BUDGET_MS below is the real ceiling; whichever is hit first wins. */
        private const val MAX_ATTEMPTS = 5
        /** Kept short deliberately: CYCLE_BUDGET_MS below is the real limiting factor, and a
         *  longer gap would burn most of that budget on dead time between retries. */
        private const val RETRY_GAP_MS = 2_000L
        /** Bounds only reaching a first live link (ScaleGattClient.onLinked), timed from the very
         *  first connect attempt of this wake — not per-attempt, and not extended by retries.
         *  Once linked, this no longer applies at all (see onLinked below); the connection is
         *  held open indefinitely from there. Owner-measured on their actual scale (2026-07-31):
         *  it stays connectable for up to ~19s after being stepped on. 16s leaves room for
         *  MAX_ATTEMPTS worth of connect/discover/subscribe round trips while staying clear of
         *  that ~19s ceiling — past this point the scale has very likely gone back to sleep
         *  without ever becoming reachable, so the whole cycle gives up and resets for the next
         *  step-on. See onCycleDeadline(). */
        private const val CYCLE_BUDGET_MS = 16_000L
        /** The scale keeps genuinely (not staleness-filtered — see ScaleScanReceiver)
         *  re-advertising for a short while after real use, as it settles back to sleep; each of
         *  those wakes would otherwise restart a whole new connect cycle. This cooldown bounds
         *  how soon a new cycle can start after a give-up (never reaching a live link), without
         *  needing to tell "still settling down" apart from "a genuinely new wake". Only applies
         *  to the give-up path now (2026-08-01) — a successful link no longer disconnects, so
         *  there's nothing to cool down from after a weigh-in anymore. Survives across Service
         *  re-creation within the same process (companion-object state), reset only by a full
         *  process kill. */
        private const val GIVE_UP_COOLDOWN_MS = 5_000L
        @Volatile private var cooldownUntilElapsedMs: Long = 0L
    }

    private val main = Handler(Looper.getMainLooper())
    private val ingest = Executors.newSingleThreadExecutor()
    private var client: ScaleGattClient? = null
    private var deviceId: String? = null
    private var ingestUrl: String? = null
    private var stopped = false
    private var state = "idle"
    private var attempts = 0
    // True from the first connect attempt of a wake through retries to either a live link or a
    // final give-up — not just while a GATT client object exists (`client` goes null between a
    // failed attempt and its scheduled retry, see onFailure). Once a link is reached (onLinked),
    // this stays true for the rest of the persistent connection's life, which is exactly what's
    // wanted: it makes a scan hit arriving while already linked a correctly-ignored no-op instead
    // of starting a redundant second connection.
    private var cycleActive = false
    // Set by onLinked, cleared by onFailure/onDestroy — distinguishes "still trying to reach a
    // first link" (bounded by CYCLE_BUDGET_MS) from "persistently connected" (unbounded).
    private var linked = false
    // Set by onWeighIn once a stable reading has actually been captured this wake; cleared on a
    // genuinely fresh scan-hit cycle and by onUnstableReading (real evidence of a new physical
    // weigh-in starting). While true, the scale disconnecting and this service quietly
    // reconnecting in the background (completely normal — the scale itself drops the link after
    // a reading) must not be reported to JS as a new "weighing you…" cycle or, if the reconnect
    // then fails, as a "weigh-in not captured" failure — both would be describing background
    // housekeeping as if it were a fresh, failed weigh-in. See onState/onUnstableReading/
    // onCycleDeadline/onFailure below.
    private var hasCapturedThisWake = false
    // Set only by onUnstableReading — the first real proof the scale is reporting live weight
    // data, not just that a GATT link exists. Cleared only at the start of a genuinely fresh
    // scan-hit cycle (onStartCommand), same as hasCapturedThisWake. Persistent connections (#972)
    // plus stopping/restarting the service on Home-tab focus (setHomeScreenActive) mean a
    // connect/reconnect can now happen with nobody on the scale at all — e.g. returning to Home
    // while the scale is still finishing its own post-use re-advertising re-links the persistent
    // connection with no one there. Before this flag, CONNECTING/PREPARING/WAITING were forwarded
    // to JS unconditionally on any such reconnect, showing a false "Weighing you…" toast — confirmed
    // on-device 2026-08-01: a connection linked at 08.887 sat idle for a full 22s before the first
    // real unstable reading at 30.946, with the toast visible the whole time. See onState,
    // onUnstableReading, onFailure and onCycleDeadline below — all gate user-visible feedback on
    // this flag now, not on bare connection state.
    private var hasSeenActivityThisWake = false
    private var cycleStartElapsedMs = 0L
    private var cycleDeadlineRunnable: Runnable? = null

    private fun log(line: String) {
        eventSink?.invoke("scaleLog", JSONObject().put("line", line))
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences("scale_ble", MODE_PRIVATE)
        deviceId = prefs.getString("device_id", null)
        if (deviceId == null) { log("no scale paired — stopping"); stopSelf(); return START_NOT_STICKY }
        ingestUrl = prefs.getString("ingest_url", null)
        val scanSource = intent?.getStringExtra(EXTRA_SCAN_SOURCE) ?: "unknown"
        // Always call startForeground() here regardless of which branch below is taken —
        // Android requires it within a few seconds of any startForegroundService()-triggered
        // start, including one that immediately turns around and stops itself. Deliberately
        // neutral wording ("Scale nearby", not "Weigh-in detected") — at this point we only know
        // the scale is advertising, not that anyone's actually on it (see
        // hasSeenActivityThisWake's doc comment); onUnstableReading below flips this to
        // "Weighing you…" once there's real evidence.
        startInForeground("Scale nearby — connecting…")
        stopped = false
        val now = SystemClock.elapsedRealtime()
        when {
            cycleActive -> log("start command ignored (source=$scanSource) — already running (state=$state)")
            now < cooldownUntilElapsedMs -> {
                log("cooldown active (${(cooldownUntilElapsedMs - now) / 1000}s left) — ignoring wake (source=$scanSource)")
                stopSelf()
            }
            else -> {
                log("scan hit (source=$scanSource) — attempting connection")
                cycleActive = true
                hasCapturedThisWake = false
                hasSeenActivityThisWake = false
                attempts = 0
                cycleStartElapsedMs = SystemClock.elapsedRealtime()
                val deadline = Runnable { onCycleDeadline() }
                cycleDeadlineRunnable = deadline
                main.postDelayed(deadline, CYCLE_BUDGET_MS)
                attemptConnection()
            }
        }
        // START_STICKY (2026-08-01): this is now a persistent connection, not a bounded one-shot
        // task per scan hit — the OS should resurrect it if it gets killed, same as
        // PolarStrapService. A restart delivers a null Intent, which the deviceId-from-prefs read
        // above already handles (it doesn't depend on the Intent's extras).
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        ingest.shutdownNow()
        client?.close(); client = null
        cycleActive = false
        linked = false
        hasCapturedThisWake = false
        hasSeenActivityThisWake = false
        instance = null
        super.onDestroy()
    }

    fun setIngestUrl(url: String) { ingestUrl = url }

    private fun startInForeground(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                // IMPORTANCE_MIN, not LOW: Android requires *a* notification for a running
                // foreground service, but "connected — listening for weigh-ins" carries no action
                // for the owner (unlike "Weigh-in logged", which stays at LOW below). MIN drops the
                // status-bar icon and collapses the shade entry to the bottom.
                NotificationChannel(CHANNEL_ID, "Scale sync", NotificationManager.IMPORTANCE_MIN))
            nm.deleteNotificationChannel(LEGACY_CHANNEL_ID)
        }
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("TrainingAI · Scale")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun updateNotification(text: String) = startInForeground(text)

    private fun attemptConnection() {
        if (stopped) return
        val id = deviceId ?: return
        client?.close()
        client = ScaleGattClient(this, id, this).also { it.start() }
    }

    private fun cancelCycleDeadline() {
        cycleDeadlineRunnable?.let { main.removeCallbacks(it) }
        cycleDeadlineRunnable = null
    }

    /** Fires CYCLE_BUDGET_MS after the first connect attempt of this wake, regardless of which
     *  attempt or GATT state things are in — the hard ceiling ScaleGattClient's own per-operation
     *  timeouts (sized generously as a safety net, not a UX target) don't enforce on their own.
     *  Cancelled by onLinked as soon as a live link is reached, so this only ever fires while
     *  still trying to get connected — past this point the scale has very likely gone back to
     *  sleep without ever becoming reachable this wake, so this gives up unconditionally and
     *  resets for the next scan hit rather than letting MAX_ATTEMPTS keep chasing it. */
    private fun onCycleDeadline() {
        cycleDeadlineRunnable = null
        log("cycle budget (${CYCLE_BUDGET_MS / 1000}s) exhausted — never reached a live link, giving up")
        client?.close(); client = null
        cooldownUntilElapsedMs = SystemClock.elapsedRealtime() + GIVE_UP_COOLDOWN_MS
        // A reading was already captured this wake — this deadline is for re-linking after the
        // scale's own post-reading disconnect, not for an initial weigh-in, so this is the scale
        // going back to sleep as normal, not a failure worth telling the user about. Also don't
        // report failure if no real activity was ever seen this wake (hasSeenActivityThisWake) —
        // that's a connect/reconnect that never proved anyone was actually on the scale (e.g. a
        // stray re-link on Home-tab focus), not a missed weigh-in. Trade-off: a genuine step-on
        // whose connect fails before ever reaching a real weight packet also fails silently now —
        // accepted, since there's no BLE evidence to tell that case apart from a spurious re-link,
        // and the stray-reconnect case is by far the more common one in practice.
        if (!hasCapturedThisWake && hasSeenActivityThisWake) notifyWeighInFailed()
        stopSelf()
    }

    // ---- ScaleGattClient.Listener (callbacks arrive on main thread) ----

    override fun onLog(line: String) = log(line)

    override fun onState(state: ScaleGattClient.State) = runOnMain {
        this.state = state.name.lowercase()
        // Suppress CONNECTING/PREPARING/WAITING from JS unless either (a) a reading's already
        // been captured this wake — this is just the service quietly re-linking after the
        // scale's own post-reading disconnect, not evidence of a new weigh-in — or (b) no real
        // activity has been seen yet this wake at all, which covers a plain connect/reconnect
        // with nobody on the scale (see hasSeenActivityThisWake's doc comment). onUnstableReading
        // below is the one signal allowed to lift suppression, since that's real proof someone is
        // on the scale right now.
        if ((hasCapturedThisWake || !hasSeenActivityThisWake) && (state == ScaleGattClient.State.CONNECTING ||
                state == ScaleGattClient.State.PREPARING || state == ScaleGattClient.State.WAITING)
        ) {
            return@runOnMain
        }
        eventSink?.invoke("scaleStatus", JSONObject().put("state", this.state))
    }

    override fun onLinked() = runOnMain {
        linked = true
        cancelCycleDeadline()
        log("linked — connection established, listening for weigh-ins")
        updateNotification("Connected — listening for weigh-ins")
    }

    override fun onUnstableReading(weightKg: Double) = runOnMain {
        updateNotification("Weighing you…")
        // Real evidence a new physical weigh-in is underway (not just link housekeeping) — undo
        // the post-capture suppression above so a genuinely new attempt reports normally,
        // success or failure, same as the very first one this wake.
        hasCapturedThisWake = false
        // First real proof this wake — lifts onState()'s/onFailure()'s activity-gate below for
        // the rest of this wake. See the field's doc comment.
        hasSeenActivityThisWake = true
        // Re-fires 'waiting' so the JS toast — gated on a flag that only resets once a
        // scaleResult event ends the previous cycle — starts a fresh progress bar for this
        // weigh-in. There's no new 'connecting'/'waiting' state transition to key off anymore
        // under the persistent-connection model, since the GATT link never disconnects between
        // readings; this is the substitute signal for "a new physical weigh-in has begun".
        eventSink?.invoke("scaleStatus", JSONObject().put("state", "waiting"))
    }

    override fun onWeighIn(packet: ScaleProtocol.WeightPacket) = runOnMain {
        updateNotification("Weigh-in captured — syncing…")
        hasCapturedThisWake = true
        // No client=null and no cooldown re-arm here anymore (2026-08-01) — the connection stays
        // open (see the class doc) and keeps listening for the next weigh-in instead of
        // disconnecting after this one, so there's nothing to "settle back to sleep" from.
        ingest.execute { postWeighIn(packet) }
    }

    override fun onFailure(reason: String) = runOnMain {
        log("attempt failed: $reason")
        client = null
        if (linked) {
            // The link was dropped after being genuinely established, not a failure to ever
            // reach one — treat this as a fresh cycle for retry-budget purposes rather than
            // inheriting however long the connection had already been up, which would otherwise
            // make remainingBudgetMs deeply negative below and skip retrying entirely.
            linked = false
            attempts = 0
            cycleStartElapsedMs = SystemClock.elapsedRealtime()
            cancelCycleDeadline()
            val deadline = Runnable { onCycleDeadline() }
            cycleDeadlineRunnable = deadline
            main.postDelayed(deadline, CYCLE_BUDGET_MS)
        }
        attempts++
        val remainingBudgetMs = CYCLE_BUDGET_MS - (SystemClock.elapsedRealtime() - cycleStartElapsedMs)
        // Deadline-aware, not just attempt-count-aware: a retry that can't possibly finish
        // (connect + discover + subscribe + request) before onCycleDeadline() fires anyway is
        // wasted effort — give up now instead of scheduling one last doomed attempt.
        if (attempts < MAX_ATTEMPTS && remainingBudgetMs > RETRY_GAP_MS) {
            // Same suppression as onState() above, and for the same reason: a reading was already
            // captured this wake, so this retry is the service quietly re-linking after the
            // scale's own post-reading disconnect, not a fresh weigh-in attempt failing. Confirmed
            // on-device 2026-08-01 — onState()'s guard doesn't cover this path (retrying is
            // broadcast directly from here, not via onState), so a post-capture link drop
            // (status=19) was still reopening the JS toast as "Still trying — stay on the scale…"
            // right after a successful weigh-in.
            if (!hasCapturedThisWake && hasSeenActivityThisWake) {
                updateNotification("Retrying — stay on the scale…")
                // The in-app toast otherwise sits frozen on "Weighing you…" through every retry —
                // onState() only fires for ScaleGattClient's own CONNECTING/PREPARING/WAITING/CLOSED
                // states, so a failed attempt between two of those was previously invisible in-app,
                // even though the native notification above already said "Retrying…". A stuck-looking
                // toast is indistinguishable from a genuinely hung one without this.
                eventSink?.invoke("scaleStatus", JSONObject().put("state", "retrying"))
            }
            main.postDelayed({ attemptConnection() }, RETRY_GAP_MS)
        } else {
            log("giving up after $attempts attempt(s) this wake")
            cancelCycleDeadline()
            cooldownUntilElapsedMs = SystemClock.elapsedRealtime() + GIVE_UP_COOLDOWN_MS
            // Same reasoning as onCycleDeadline above — don't report "not captured" for a
            // failed re-link after an already-successful reading this wake, or for a give-up
            // that never saw real activity at all.
            if (!hasCapturedThisWake && hasSeenActivityThisWake) notifyWeighInFailed()
            stopSelf()
        }
    }

    /** Unlike the pre-2026-08-01 one-shot design, does NOT call stopSelf() — the persistent
     *  connection stays open for the next weigh-in either way, and this can fire any number of
     *  times per connection regardless. */
    override fun onStoredReading(record: ScaleProtocol.StoredWeightPacket) = runOnMain {
        ingest.execute { postStoredReading(record) }
    }

    // ---- ingest ----

    /** Runs on the ingest executor thread. No longer calls stopSelf() (2026-08-01) — the
     *  connection stays open and the service keeps running to catch the next weigh-in, same as
     *  PolarStrapService's ingest never stops the strap connection either. */
    private fun postWeighIn(packet: ScaleProtocol.WeightPacket) {
        try {
            val base = ingestUrl ?: return
            val cookie = CookieManager.getInstance().getCookie(base) ?: return
            val body = JSONObject()
                .put("weightKg", packet.weightKg)
                .put("impedanceOhmsA", packet.impedanceOhmsA)
                .put("impedanceOhmsB", packet.impedanceOhmsB)
                .put("rawHex", packet.rawHex)
                .toString().toByteArray(Charsets.UTF_8)
            val conn = URL("$base/api/scale-ble/samples").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write(body) }
                val code = conn.responseCode
                if (code in 200..299) {
                    val resp = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(resp)
                    if (json.optString("status") == "pending") {
                        notifyPendingConfirmation(json)
                    } else if (json.optBoolean("compositionSkipped")) {
                        notifyCompositionSkipped(json)
                    } else {
                        notifyWeighInLogged(json)
                    }
                } else {
                    log("ingest HTTP $code")
                    eventSink?.invoke("scaleResult", JSONObject().put("outcome", "failed"))
                }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            log("ingest failed: ${e.message}")
            eventSink?.invoke("scaleResult", JSONObject().put("outcome", "failed"))
        } finally {
            if (!stopped) updateNotification("Connected — listening for weigh-ins")
        }
    }

    /**
     * SPECULATIVE — posts a drained historical reading. Reuses the ingest route's existing
     * `measuredAt` field (see resolveMeasuredAt, packages/shared/src/validation/ingest-clock.ts)
     * rather than needing any server-side change: that field already exists precisely for a
     * client-supplied timestamp, and already clamps to a 7-day window rather than trusting it
     * blindly. Does NOT call stopSelf() — see onStoredReading's doc comment. A failure here is
     * silent (log only) rather than surfaced to the user; this is a best-effort backfill on top
     * of an already-working live-weigh-in path, not something worth a user-facing error state.
     */
    private fun postStoredReading(record: ScaleProtocol.StoredWeightPacket) {
        try {
            val base = ingestUrl ?: return
            val cookie = CookieManager.getInstance().getCookie(base) ?: return
            val measuredAt = java.time.Instant.ofEpochSecond(record.measuredAtEpochSeconds).toString()
            val body = JSONObject()
                .put("weightKg", record.weightKg)
                .put("impedanceOhmsA", record.resistance1Ohms)
                .put("impedanceOhmsB", record.resistance2Ohms)
                .put("rawHex", record.rawHex)
                .put("measuredAt", measuredAt)
                .toString().toByteArray(Charsets.UTF_8)
            val conn = URL("$base/api/scale-ble/samples").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write(body) }
                val code = conn.responseCode
                if (code !in 200..299) log("stored-reading ingest HTTP $code")
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            log("stored-reading ingest failed: ${e.message}")
        }
    }

    /**
     * The multi-user safety net: the owner's partner also uses this scale, so a reading that
     * looked like a big jump from the account's usual weight was staged as 'pending' by the
     * server instead of auto-saved. Fires from native code (not the JS LocalNotifications
     * plugin, which only reacts while the WebView is foregrounded) so this reaches the user even
     * fully backgrounded. Tapping opens the app; deep-linking straight to the pending-
     * confirmation list is a follow-up (no existing bridge for a native-built notification's tap
     * to hand a route to JS) — Settings > Scale is one tap away regardless.
     */
    private fun notifyPendingConfirmation(json: JSONObject) {
        val weightKg = json.optDouble("weightKg")
        val lastWeightKg = json.optDouble("lastWeightKg")
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(PENDING_CHANNEL_ID, "Unusual weigh-ins", NotificationManager.IMPORTANCE_HIGH))
        }
        val openApp = PendingIntent.getActivity(
            this, PENDING_NOTIF_ID, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = "%.1f kg (usual ~%.1f kg) — tap to confirm it's you".format(weightKg, lastWeightKg)
        val notification = Notification.Builder(this, PENDING_CHANNEL_ID)
            .setContentTitle("Unusual weigh-in")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .build()
        nm.notify(PENDING_NOTIF_ID, notification)
        eventSink?.invoke("scaleResult", JSONObject().put("outcome", "pending").put("weightKg", weightKg))
    }

    /**
     * BIA needs bare-skin contact on both foot plates. Socks/stockings/dry feet break that path
     * — the scale still reports a real weight (load cell, contact-independent) but the server
     * skips body-composition math rather than writing a divide-by-zero-derived reading (real
     * incident 2026-07-28: socks produced a 3% body-fat reading). Low-importance/one-shot, unlike
     * the pending-confirmation notification — this isn't asking for a decision, just visibility
     * into why composition fields didn't update this time.
     */
    private fun notifyCompositionSkipped(json: JSONObject) {
        val weightKg = json.optDouble("weightKg")
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(SKIPPED_CHANNEL_ID, "Body composition skipped", NotificationManager.IMPORTANCE_LOW))
        }
        val text = "%.1f kg saved — stand barefoot on the plates for body composition".format(weightKg)
        val notification = Notification.Builder(this, SKIPPED_CHANNEL_ID)
            .setContentTitle("Body composition not measured")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setAutoCancel(true)
            .build()
        nm.notify(SKIPPED_NOTIF_ID, notification)
        eventSink?.invoke("scaleResult", JSONObject().put("outcome", "skipped").put("weightKg", weightKg))
    }

    /**
     * The plain success path — a normal weigh-in with valid impedance, same-day trend or not.
     * Previously this case notified nothing at all: the transient "Weigh-in captured — syncing…"
     * foreground notification just disappeared the moment the service stopped, giving no lasting
     * confirmation the reading actually landed. Low-importance/one-shot, same as the
     * composition-skipped case — this isn't asking for a decision.
     */
    private fun notifyWeighInLogged(json: JSONObject) {
        val weightKg = json.optDouble("weightKg")
        val isAdditional = json.optBoolean("isAdditionalReadingToday")
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(LOGGED_CHANNEL_ID, "Weigh-in logged", NotificationManager.IMPORTANCE_LOW))
        }
        val text = if (isAdditional) "%.1f kg logged — additional reading today".format(weightKg)
                   else "%.1f kg logged".format(weightKg)
        val notification = Notification.Builder(this, LOGGED_CHANNEL_ID)
            .setContentTitle("Weigh-in logged")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setAutoCancel(true)
            .build()
        nm.notify(LOGGED_NOTIF_ID, notification)
        eventSink?.invoke("scaleResult", JSONObject().put("outcome", "logged")
            .put("weightKg", weightKg).put("isAdditionalReadingToday", isAdditional))
    }

    /**
     * All MAX_ATTEMPTS attempts failed this wake. Previously this path notified nothing — the
     * "Retrying…" foreground notification just disappeared when the service stopped, so a failed
     * weigh-in and a successful one looked identical from the notification shade (nothing lasting
     * either way) unless you happened to be watching `chrome://inspect`. Low-importance/one-shot,
     * same as the logged/skipped cases — nudges stepping on again rather than leaving it to guesswork.
     */
    private fun notifyWeighInFailed() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(FAILED_CHANNEL_ID, "Weigh-in not captured", NotificationManager.IMPORTANCE_LOW))
        }
        val notification = Notification.Builder(this, FAILED_CHANNEL_ID)
            .setContentTitle("Weigh-in not captured")
            .setContentText("Didn't get a reading — step on the scale again")
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setAutoCancel(true)
            .build()
        nm.notify(FAILED_NOTIF_ID, notification)
        eventSink?.invoke("scaleResult", JSONObject().put("outcome", "failed"))
    }

    // ---- plugin surface ----

    fun status(): JSONObject = JSONObject().put("state", state)
}
