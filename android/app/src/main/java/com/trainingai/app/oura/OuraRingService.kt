package com.trainingai.app.oura

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
import com.trainingai.app.DeviceBatteryNotifier
import com.trainingai.app.MainActivity
import com.trainingai.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.ArrayDeque
import java.util.concurrent.Executors

/** Holds the persistent ring connection and owns the WHOLE sync pipeline: drain the
 *  ring's history, POST each batch to the server itself (native HTTP — no WebView in
 *  the data path), and advance the persisted resume cursor only after the server
 *  confirms storage. The cursor-ack invariant (CLAUDE.md "Oura Direct-BLE"): the
 *  resume cursor may only advance past events that are durably ingested (2xx).
 *
 *  Patient scan loop with backoff (RE4), hard cool-down after consecutive failures
 *  because a wedged radio only recovers by itself (RE6). All observations go to a
 *  timestamped ring-buffer log + a metrics object the plugin exposes. */
class OuraRingService : Service(), OuraGattClient.Listener {

    companion object {
        @Volatile var instance: OuraRingService? = null
        /** Set by the plugin so service events reach JS without a bound connection. */
        @Volatile var eventSink: ((type: String, data: JSONObject) -> Unit)? = null
        private val BACKOFF_MS = longArrayOf(5_000, 10_000, 30_000, 60_000, 120_000, 300_000)
        private const val WEDGE_FAILURES = 6           // RE6: stop hammering after this many
        private const val WEDGE_COOLDOWN_MS = 900_000L // 15 min — let the firmware watchdog work
        private const val SCAN_WINDOW_MS = 90_000L     // RE4: long patient window
        private const val KEEPALIVE_MS = 300_000L      // battery poll proves the link is alive
        // v2: NotificationChannel importance is immutable once created, so an upgraded install
        // would keep the old IMPORTANCE_LOW channel and the drop to MIN would never take effect.
        private const val CHANNEL_ID = "oura-ble-v2"
        private const val LEGACY_CHANNEL_ID = "oura-ble"
        private const val LOW_BATTERY_CHANNEL_ID = "oura-ble-low-battery"
        private const val DRAIN_DONE_CHANNEL_ID = "oura-ble-drain-done"
        private const val DRAIN_DONE_NOTIF_ID = 2003
        private const val LOW_BATTERY_NOTIF_ID = 2011
        // Runaway guard for the auto-loop drain: a full backlog is thousands of
        // events (255/batch), but a firmware that never reports bytesLeft==0 would
        // otherwise loop forever. Well above any real backlog, so it never trips
        // in normal use.
        private const val MAX_DRAIN_BATCHES = 5000
        // Sync-cadence policy (docs/oura-ble-operations.md §2): drain on connect,
        // then re-drain hourly while connected. An ingest failure zeroes
        // lastDrainCompletedAt so the next keepalive tick (<=5 min) retries.
        private const val DRAIN_INTERVAL_MS = 3_600_000L
        private const val AUTO_DRAIN_DELAY_MS = 3_000L // let the feature-enable acks land first
        // Spontaneous (non-drain) history frames buffer this many before a flush;
        // capped so an offline stretch can't grow memory unboundedly.
        private const val LIVE_FLUSH_THRESHOLD = 200
        private const val LIVE_BUFFER_CAP = 2000
        private const val POST_RETRIES = 3
        private val POST_RETRY_SLEEP_MS = longArrayOf(2_000, 5_000, 10_000)
    }

    private val main = Handler(Looper.getMainLooper())
    // Single-threaded so batches POST in order — the resume cursor must move
    // monotonically through confirmed batches, never past an unconfirmed one.
    private val ingest = Executors.newSingleThreadExecutor()
    private var client: OuraGattClient? = null
    private var key: ByteArray? = null
    private var consecutiveFailures = 0
    private var stopped = false

    // -- metrics (the Phase-2 deliverable) --
    private var serviceStartedAt = 0L
    private var connectAttemptStartedAt = 0L
    private var connectedAt = 0L
    private var connectCount = 0
    private var dropCount = 0
    private var lastTimeToConnectMs = 0L
    private var totalConnectedMs = 0L
    private var battery: Int? = null
    private var state = "idle"

    // -- history sync cursor tracking (RE9) + auto-loop drain (main thread only) --
    // Two cursors, deliberately decoupled (durability fix): `drainCursor` is the
    // in-memory loop position that advances every batch so we keep pulling; the
    // PERSISTED `history_cursor_ds` is the resume point and only advances in
    // confirmStored() once the server has durably stored the batch. The ring
    // keeps every buffered event and serves any range, so re-draining an
    // unconfirmed tail is safe (dedup handles it) — but advancing the resume
    // cursor before storage is what silently dropped data.
    private var maxHistoryTsSeen = 0L
    private var draining = false
    private var drainBatches = 0
    private var drainFullResync = false   // notify on completion only for a full re-sync (Q-533)
    private var drainCursor = 0L
    private val drainFrames = ArrayList<String>() // hex frames of the in-flight batch
    // @Volatile: set on the ingest thread the instant a batch fails to commit locally, read on
    // the ingest thread (the next batch's guard) AND the main thread (the confirm re-check +
    // startDrain reset). Cross-thread visibility is load-bearing — see postDrainBatch.
    @Volatile private var drainIngestFailed = false   // stop confirming later batches after a failed one
    private val liveFrames = ArrayList<String>()  // spontaneous history frames outside a drain

    // -- native ingest state --
    // The device-owned raw store. Null only when the database could not be opened at all;
    // see postDrainBatch for what that degrades to.
    private var rawDb: OuraRawDb? = null
    private var ingestUrl: String? = null
    private var ingestPosted = 0
    private var ingestStored = 0
    @Volatile private var lastIngestError: String? = null
    private var lastDrainCompletedAt = 0L

    // Device-local wall-clock time, not raw epoch millis — this log spans a
    // multi-day persistence soak, so the owner reads it in their own timezone.
    // LocalDateTime.now() reads the system default timezone (no hardcoded
    // offset needed); DateTimeFormatter instances are immutable/thread-safe,
    // unlike SimpleDateFormat, which matters since GATT callbacks can log
    // from a Binder thread.
    private val logTimeFormatter = DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")
    private val logBuffer = ArrayDeque<String>()
    private fun log(line: String) {
        val stamped = "${LocalDateTime.now().format(logTimeFormatter)} $line"
        synchronized(logBuffer) { logBuffer.add(stamped); if (logBuffer.size > 1000) logBuffer.poll() }
        eventSink?.invoke("ouraLog", JSONObject().put("line", stamped))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        serviceStartedAt = SystemClock.elapsedRealtime()
        rawDb = OuraRawDb.get(applicationContext) { log(it) }
        if (rawDb == null) {
            log("WARNING: oura_raw.db unavailable — falling back to the server-2xx cursor gate")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences("oura_ble", MODE_PRIVATE)
        val keyHex = prefs.getString("key_hex", null)
        key = keyHex?.let { OuraAuth.parseKeyHex(it) }
        if (key == null) { log("no key stored — stopping"); stopSelf(); return START_NOT_STICKY }
        ingestUrl = prefs.getString("ingest_url", null)
        if (ingestUrl == null) log("no ingest URL yet — native drains disabled until the app configures it")
        startInForeground("Connecting to ring…")
        stopped = false
        // Guard against a duplicate start command (a double-tap of Start service, or
        // Android redelivering the intent) spawning a second OuraGattClient while one
        // is already scanning/connecting/connected — that raced two concurrent connect
        // attempts to the same ring and produced a generic GATT status 133. `client` is
        // only nulled in onDestroy(), so a real Stop still allows a fresh start, and the
        // internal retry loop (scheduleRetry -> attemptConnection) bypasses this guard
        // entirely since it never goes through onStartCommand.
        if (client != null) {
            log("start command ignored — already running (state=$state)")
        } else {
            log("service started")
            attemptConnection()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        // A POST in flight is abandoned mid-way: its batch was never confirmed, so
        // the resume cursor still points at it and the span re-drains (dedup-safe).
        ingest.shutdownNow()
        client?.close(); client = null
        instance = null
        log("service destroyed")
        super.onDestroy()
    }

    fun setIngestUrl(url: String) {
        ingestUrl = url
        log("ingest URL configured")
    }

    private fun startInForeground(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // MIN, not LOW: "Connected · 62% battery" is not actionable at 62%. The reading that
            // IS actionable gets its own one-shot channel — see DeviceBatteryNotifier.
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Oura Ring", NotificationManager.IMPORTANCE_MIN))
            nm.deleteNotificationChannel(LEGACY_CHANNEL_ID)
        }
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("TrainingAI · Oura Ring")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(2001, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(2001, notification)
        }
    }

    private fun updateNotification(text: String) = startInForeground(text)

    // Polled every KEEPALIVE_MS (5 min), so the hysteresis in DeviceBatteryNotifier is what stops
    // a low ring from notifying 288 times a day.
    private var lowBatteryFired = false
    private fun maybeWarnLowBattery(percent: Int, charging: Boolean) {
        val d = DeviceBatteryNotifier.decide(percent, charging, lowBatteryFired)
        lowBatteryFired = d.fired
        if (d.notify) {
            DeviceBatteryNotifier.post(
                this, LOW_BATTERY_CHANNEL_ID, "Ring battery", LOW_BATTERY_NOTIF_ID,
                "Oura Ring", percent, R.drawable.ic_stat_dumbbell,
            )
        }
    }

    /** A full re-sync is thousands of events at 255 per batch and takes long enough that the
     *  owner puts the phone down. It ran unattended already — the service drains, POSTs and
     *  commits with no screen involved — but the only report of the *ending* was a log line in
     *  the admin console, so the only way to learn it had finished was to watch it (Q-533).
     *
     *  Runs on the ingest executor, after the last batch of this drain has committed. */
    private fun notifyDrainComplete(batches: Int, ingestFailed: Boolean) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(
                DRAIN_DONE_CHANNEL_ID, "Ring re-sync", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val tap = PendingIntent.getActivity(
            this, DRAIN_DONE_NOTIF_ID,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Says which of the two outcomes it was. "Finished" alone would read as success on a
        // drain whose batches failed to commit, and the whole point of the notification is that
        // nobody was watching the log that would have said otherwise.
        val text = if (ingestFailed) {
            "$batches batches pulled, but some did not save — the ring still holds them and they re-sync."
        } else {
            "$batches batches pulled and saved."
        }
        nm.notify(DRAIN_DONE_NOTIF_ID, Notification.Builder(this, DRAIN_DONE_CHANNEL_ID)
            .setContentTitle(if (ingestFailed) "Ring re-sync finished with errors" else "Ring re-sync complete")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build())
        log("drain-complete notification posted: batches=$batches ingestFailed=$ingestFailed")
    }

    private fun attemptConnection() {
        if (stopped) return
        val k = key ?: return
        connectAttemptStartedAt = SystemClock.elapsedRealtime()
        client?.close()
        client = OuraGattClient(this, k, this).also { it.start(SCAN_WINDOW_MS) }
    }

    private fun scheduleRetry() {
        if (stopped) return
        val delay = if (consecutiveFailures >= WEDGE_FAILURES) {
            log("RE6 wedge guard: $consecutiveFailures consecutive failures — cooling down ${WEDGE_COOLDOWN_MS / 60000} min")
            WEDGE_COOLDOWN_MS
        } else {
            // consecutiveFailures is already incremented for *this* failure (1-indexed)
            // by the time onFailure() calls scheduleRetry() — index by failures-1 so the
            // first retry uses BACKOFF_MS[0] (5s), not BACKOFF_MS[1] (10s). Confirmed via
            // an on-device log showing a 10s gap on the very first retry.
            BACKOFF_MS[minOf(consecutiveFailures - 1, BACKOFF_MS.size - 1)]
        }
        updateNotification("Ring unreachable — retrying in ${delay / 1000}s")
        main.postDelayed({ attemptConnection() }, delay)
    }

    private val keepalive = object : Runnable {
        override fun run() {
            if (state == "ready") {
                client?.write(OuraProtocol.reqBattery())
                flushLiveFrames()
                // Routine re-drain: hourly while connected. An ingest failure zeroes
                // lastDrainCompletedAt, so the failed span retries here within 5 min.
                if (!draining && ingestUrl != null &&
                    SystemClock.elapsedRealtime() - lastDrainCompletedAt > DRAIN_INTERVAL_MS) {
                    startDrain(false)
                }
                main.postDelayed(this, KEEPALIVE_MS)
            }
        }
    }

    // ---- OuraGattClient.Listener ----
    // All state-bearing callbacks marshal onto the main handler: GATT delivers them on
    // Binder threads, and the drain/cursor state machine is main-thread-only by design.

    override fun onLog(line: String) = log(line)

    override fun onState(s: OuraGattClient.State) = runOnMain {
        state = s.name.lowercase()
        emitStatus(force = true)
    }

    override fun onReady() = runOnMain {
        connectCount++
        consecutiveFailures = 0
        connectedAt = SystemClock.elapsedRealtime()
        lastTimeToConnectMs = connectedAt - connectAttemptStartedAt
        state = "ready"
        log("READY in ${lastTimeToConnectMs}ms (connect #$connectCount)")
        updateNotification("Connected · auth OK")
        // RE10: SyncTime first, then enable notifications, then battery.
        client?.write(OuraProtocol.reqSyncTime(System.currentTimeMillis() / 1000))
        client?.write(OuraProtocol.reqEnableAllNotifications())
        client?.write(OuraProtocol.reqBattery())
        // Enable background measurement recording (DAYTIME_HR + SPO2 + REAL_STEPS → AUTOMATIC).
        // After a key-only re-key these are OFF, so the ring records only system/debug
        // events until this runs — without it there is no HR/temp/SpO₂/steps to sync.
        OuraProtocol.enableMeasurementSequence().forEach { client?.write(it) }
        log("enabled measurement features (DAYTIME_HR + SPO2 + REAL_STEPS + EXERCISE_HR → automatic, fast-HR off)")
        // Set-and-forget: drain automatically on every connect (after the feature acks).
        main.postDelayed({ if (state == "ready" && ingestUrl != null) startDrain(false) }, AUTO_DRAIN_DELAY_MS)
        main.postDelayed(keepalive, KEEPALIVE_MS)
        emitStatus(force = true)
    }

    override fun onFrame(frame: OuraProtocol.Frame, raw: ByteArray) = runOnMain {
        OuraProtocol.parseBattery(frame)?.let {
            battery = it.percent
            updateNotification("Connected · ${it.percent}% battery")
            maybeWarnLowBattery(it.percent, it.charging)
            // Persist the live keepalive poll (migration 133) so active-use drain rate is captured.
            // Fire-and-forget: a dropped poll is inconsequential — the next 5-min tick re-posts.
            postBatteryPoll(it.percent, it.charging)
        }
        val hex = raw.joinToString("") { "%02x".format(it) }
        // Diagnostics (accel/feature investigation): surface command responses so the real
        // feature on/off state (0x21 feature_status, 0x23 set_feature_mode_ack) and any
        // realtime-stream response/rejection (0x06 set_realtime) are visible in the log.
        // Raw payload hex — decoded off-device from the reported bytes, no layout guessing.
        if (frame.tag == 0x2f && (frame.subOp == 0x21 || frame.subOp == 0x23)) {
            log("feat resp sub=0x${"%02x".format(frame.subOp!!)}: ${frame.payload.joinToString("") { "%02x".format(it) }}")
        } else if (frame.tag == 0x06) {
            log("realtime resp: $hex")
        }
        if (frame.tag >= OuraProtocol.HISTORY_EVENT_PREFIX) {
            // RE9: track the newest event timestamp seen this batch — it becomes the
            // in-memory drain cursor AND the batch's confirmStored watermark.
            OuraProtocol.historyEventTimestamp(frame)?.let { ts -> if (ts > maxHistoryTsSeen) maxHistoryTsSeen = ts }
            if (draining) {
                drainFrames.add(hex)
            } else {
                // Spontaneous history event (live stream / idle notify): buffer + flush.
                // Not cursor-tracked — recorded metrics also land in ring history, so a
                // lost flush is recovered by the next drain.
                liveFrames.add(hex)
                if (liveFrames.size >= LIVE_FLUSH_THRESHOLD) flushLiveFrames()
            }
        }
        OuraProtocol.parseHistoryCompletion(frame)?.let { onDrainBatchComplete(it) }
        bufferFrame(JSONObject()
            .put("tag", frame.tag).put("subOp", frame.subOp ?: JSONObject.NULL).put("hex", hex))
        emitStatus()
    }

    override fun onFailure(reason: String) = runOnMain {
        if (state == "ready") {
            dropCount++
            totalConnectedMs += SystemClock.elapsedRealtime() - connectedAt
            log("DROP #$dropCount: $reason")
        } else {
            log("attempt failed: $reason")
        }
        if (draining) {
            // Any batch already handed to the ingest executor still confirms if its
            // POST succeeds; the resume cursor simply stops at the last stored batch
            // and the interrupted tail re-drains after reconnect.
            draining = false
            drainFrames.clear()
            log("drain aborted by disconnect — unconfirmed tail will re-drain")
        }
        consecutiveFailures++
        state = "disconnected"
        main.removeCallbacks(keepalive)
        emitStatus(force = true)
        scheduleRetry()
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    // ---- drain + native ingest pipeline (state on main; POSTs on the executor) ----

    private fun onDrainBatchComplete(done: OuraProtocol.HistoryCompletion) {
        if (!draining) {
            log("history batch outside a drain: events=${done.eventsReceived} bytesLeft=${done.bytesLeft}")
            return
        }
        drainBatches++
        val progressed = done.eventsReceived > 0 && maxHistoryTsSeen > 0
        val batch = ArrayList(drainFrames)
        drainFrames.clear()
        val batchMaxDs = maxHistoryTsSeen
        maxHistoryTsSeen = 0
        if (progressed) {
            drainCursor = batchMaxDs + 1 // in-memory loop position; the persisted resume
                                         // cursor moves only in confirmStored() below
            log("history batch: events=${done.eventsReceived} frames=${batch.size} bytesLeft=${done.bytesLeft} drainCursor→$drainCursor")
            // Hand the batch to the ingest executor: POST, then confirm. The drain loop
            // does NOT wait — it keeps pulling at BLE speed while batches upload behind
            // it (in order, single-threaded).
            ingest.execute { postDrainBatch(batch, batchMaxDs) }
        } else {
            log("history batch: events=${done.eventsReceived} bytesLeft=${done.bytesLeft} (no progress)")
        }
        // Auto-loop the drain: the ring returns at most 255 events per GetHistory,
        // so keep requesting from the advanced in-memory cursor until the ring
        // reports the backlog is empty (bytesLeft==0) or a batch stops making
        // progress — otherwise we'd re-request the same tail forever.
        // MAX_DRAIN_BATCHES is a hard runaway ceiling.
        if (done.bytesLeft > 0 && progressed && drainBatches < MAX_DRAIN_BATCHES) {
            client?.write(OuraProtocol.reqGetHistory(drainCursor))
        } else {
            draining = false
            client?.setConnectionPriority(false)
            lastDrainCompletedAt = SystemClock.elapsedRealtime()
            log("drain complete: batches=$drainBatches bytesLeft=${done.bytesLeft} (uploads may still be finishing)")
            emitStatus(force = true)
            if (drainFullResync) {
                // Queued on the ingest executor rather than fired here. That executor is
                // single-threaded and in order, so this task runs only after every batch this
                // drain queued has finished committing — which is what makes "uploads settled"
                // a fact rather than a guess. Firing at the end of the BLE loop instead would
                // announce completion while batches were still writing, and the log line right
                // above says exactly why that is wrong.
                val batches = drainBatches
                ingest.execute { notifyDrainComplete(batches, drainIngestFailed) }
            }
        }
    }

    /** Runs on the ingest executor. Commits one drained batch to the device's own
     *  `oura_raw.db` and advances the history cursor **in that same transaction**, then fires
     *  the server POST as a best-effort backup whose result no longer gates anything.
     *
     *  The gate moved off the POST deliberately: a durable local commit is the strongest
     *  guarantee available on the device, it doesn't need a network or a live session cookie,
     *  and it makes the phone — not Railway — the thing that owns the raw span. After one
     *  batch fails to commit, later batches of the SAME drain are not confirmed either: the
     *  cursor must never jump a hole, and the skipped span re-drains (dedup absorbs it). */
    private fun postDrainBatch(batch: List<String>, batchMaxDs: Long) {
        if (drainIngestFailed) {
            log("skipping batch (${batch.size} frames) — an earlier batch failed; span re-drains")
            return
        }
        val db = rawDb
        if (db == null) {
            // No local store at all (open failed). Rather than wedge the drain forever,
            // degrade to the previous contract — cursor gated on the server's 2xx — so the
            // phone still syncs with exactly the durability it had before this change.
            postDrainBatchServerGated(batch, batchMaxDs)
            return
        }
        // Frames that aren't history events, or that are malformed, are skipped rather than
        // failing the batch — the same infallible-decoder posture the server takes.
        val rows = batch.mapNotNull { hex ->
            OuraProtocol.historyEventFromHex(hex)?.let {
                // measured_at starts null; insertBatchAndAdvance backfills it from the fresh
                // (batchMaxDs ↔ now) clock anchor inside the same transaction (Task 4).
                OuraRawRow(it.ringTs, it.tag, it.name, it.bodyHex, null)
            }
        }
        val committed = db.insertBatchAndAdvance(rows, batchMaxDs, System.currentTimeMillis())
        // Flip the failure flag HERE — synchronously, on the ingest thread — the instant the
        // commit fails, NOT inside the main.post below. The ingest executor is single-threaded
        // and ordered, so setting it now guarantees the NEXT batch's guard (above) sees it
        // before that batch commits. Setting it on the main thread via main.post would let a
        // later batch commit + confirm before the flag landed, advancing the resume cursor
        // PAST the failed span's hole — silent, permanent loss of a ≤255-event batch.
        if (!committed) drainIngestFailed = true
        main.post {
            if (!committed) {
                lastDrainCompletedAt = 0L // keepalive retries the drain within 5 min
                val why = if (db.lowDisk) "disk full" else "local write error"
                log("batch commit FAILED ($why) — cursor held, span re-drains")
            } else {
                // Mirror the authoritative cursor into SharedPreferences for the status
                // readout and for older code paths that still read it.
                confirmStored(batchMaxDs)
                log("batch committed locally: rows=${rows.size} of ${batch.size} frames → cursor=${batchMaxDs + 1}")
            }
            emitStatus()
        }
        // Best-effort backup, always: Railway is still the off-device copy, and it matters
        // most precisely when the local commit just failed.
        postFramesBestEffort(batch, rows.minOfOrNull { it.ringTs } ?: batchMaxDs, batchMaxDs, db)
    }

    /** Post a committed batch to the server without gating anything on it, and mark that
     *  batch's rows server-backed on a 2xx. */
    private fun postFramesBestEffort(batch: List<String>, batchMinDs: Long, batchMaxDs: Long, db: OuraRawDb) {
        try {
            ingest.execute {
                val stored = postFramesWithRetry(batch)
                if (stored != null) db.markSyncedRange(batchMinDs, batchMaxDs)
                main.post {
                    if (stored == null) {
                        log("backup POST failed: ${lastIngestError ?: "unknown"} — data is safe locally, retries next drain")
                    } else {
                        ingestPosted += batch.size
                        ingestStored += stored
                    }
                    emitStatus()
                }
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            // Service is shutting down mid-drain. The batch is already committed locally, so
            // nothing is lost — it just uploads on the next drain instead.
            log("backup POST skipped — service stopping")
        }
    }

    /** Pre-`oura_raw.db` behaviour, kept for the one case where the local store cannot be
     *  opened: the cursor advances only on the server's 2xx. */
    private fun postDrainBatchServerGated(batch: List<String>, batchMaxDs: Long) {
        val stored = postFramesWithRetry(batch)
        if (stored == null) drainIngestFailed = true
        main.post {
            if (stored == null) {
                lastDrainCompletedAt = 0L
                log("batch ingest FAILED: ${lastIngestError ?: "unknown"} — resume cursor held, span re-drains")
            } else {
                confirmStored(batchMaxDs)
                ingestPosted += batch.size
                ingestStored += stored
                log("batch ingested (no local store): stored=$stored dup=${batch.size - stored}")
            }
            emitStatus()
        }
    }

    private fun flushLiveFrames() {
        if (liveFrames.isEmpty() || ingestUrl == null) return
        val batch = ArrayList(liveFrames)
        liveFrames.clear()
        ingest.execute {
            val stored = postFramesWithRetry(batch)
            main.post {
                if (stored == null) {
                    // Re-queue at the front, capped — these aren't cursor-protected.
                    liveFrames.addAll(0, batch)
                    while (liveFrames.size > LIVE_BUFFER_CAP) liveFrames.removeAt(liveFrames.size - 1)
                } else {
                    ingestPosted += batch.size
                    ingestStored += stored
                    emitStatus()
                }
            }
        }
    }

    /** POST frames to the ingest route. Returns the server's stored count, or null
     *  after exhausting retries. Runs on the ingest executor — never the main thread. */
    private fun postFramesWithRetry(framesHex: List<String>): Int? {
        if (framesHex.isEmpty()) return 0
        val base = ingestUrl
        if (base == null) {
            lastIngestError = "no ingest URL — open the app once to configure"
            return null
        }
        for (attempt in 0..POST_RETRIES) {
            try {
                val stored = postFrames(base, framesHex)
                lastIngestError = null
                return stored
            } catch (_: InterruptedException) {
                return null // service shutting down
            } catch (e: Exception) {
                lastIngestError = e.message ?: e.javaClass.simpleName
                log("ingest POST failed (attempt ${attempt + 1}/${POST_RETRIES + 1}): $lastIngestError")
                if (attempt < POST_RETRIES) {
                    try { Thread.sleep(POST_RETRY_SLEEP_MS[minOf(attempt, POST_RETRY_SLEEP_MS.size - 1)]) }
                    catch (_: InterruptedException) { return null }
                }
            }
        }
        return null
    }

    private fun postFrames(base: String, framesHex: List<String>): Int {
        // The Capacitor WebView shares the system cookie store, so the app's session
        // cookie for the Railway origin is available here. If it's missing/expired the
        // POST 401s, the resume cursor holds, and opening the app refreshes the cookie.
        val cookie = CookieManager.getInstance().getCookie(base)
            ?: throw IllegalStateException("no session cookie — open the app and sign in")
        val frames = JSONArray()
        framesHex.forEach { frames.put(JSONObject().put("hex", it)) }
        val body = JSONObject().put("frames", frames).toString().toByteArray(Charsets.UTF_8)
        val conn = URL("$base/api/oura-ble/samples").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Cookie", cookie)
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            if (code < 200 || code >= 300) throw IllegalStateException("HTTP $code")
            val resp = conn.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(resp).optInt("stored", 0)
        } finally {
            conn.disconnect()
        }
    }

    // Fire-and-forget POST of one live battery poll (migration 133). Runs on the ingest
    // executor; failures are swallowed (the next 5-min keepalive tick re-posts). No cursor,
    // no retry loop — this telemetry is best-effort, unlike the durability-critical drain.
    private fun postBatteryPoll(percent: Int, charging: Boolean) {
        val base = ingestUrl ?: return
        ingest.execute {
            try {
                val cookie = CookieManager.getInstance().getCookie(base) ?: return@execute
                val body = JSONObject().put("percent", percent).put("charging", charging)
                    .toString().toByteArray(Charsets.UTF_8)
                val conn = URL("$base/api/oura-ble/battery-poll").openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 15_000
                    conn.readTimeout = 15_000
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("Cookie", cookie)
                    conn.outputStream.use { it.write(body) }
                    conn.responseCode // drive the request; response body unused
                } finally {
                    conn.disconnect()
                }
            } catch (_: Exception) {
                // best-effort telemetry — ignore
            }
        }
    }

    // ---- plugin surface ----

    fun sendCommand(command: ByteArray): Boolean {
        val hex = command.joinToString("") { "%02x".format(it) }
        // Diagnostics: a command sent while not connected is silently dropped, which looked
        // like "the Accel button does nothing" — surface both the drop and the bytes sent.
        if (state != "ready") { log("cmd DROPPED (state=$state): $hex"); return false }
        log("cmd → $hex")
        client?.write(command); return true
    }

    /** Drain the history backlog, auto-looping one GetHistory per completion until
     *  the ring reports bytesLeft==0 (see onDrainBatchComplete). `fromZero=false`
     *  resumes from the server-confirmed resume cursor (normal incremental sync);
     *  `fromZero=true` is a **full re-sync** that re-pulls everything still in the
     *  ring's buffer (recovery after data was dropped) — dedup makes re-storing
     *  already-stored events a no-op. Refused when no ingest URL is configured on
     *  this build (frames would have nowhere durable to go — unless legacy JS
     *  forwarding is doing the ingest, which only old APKs rely on).
     *  A no-op if already draining or not connected. */
    fun startDrain(fromZero: Boolean): Boolean {
        if (state != "ready") return false
        if (ingestUrl == null) { log("drain refused: no ingest URL — open the app once"); return false }
        runOnMain {
            if (draining) { log("drain already in progress (batches=$drainBatches)"); return@runOnMain }
            draining = true
            drainFullResync = fromZero
            drainBatches = 0
            maxHistoryTsSeen = 0
            drainFrames.clear()
            drainIngestFailed = false
            client?.setConnectionPriority(true)
            drainCursor = if (fromZero) 0L else resumeCursor()
            log("drain start from cursor=$drainCursor (fullResync=$fromZero)")
            client?.write(OuraProtocol.reqGetHistory(drainCursor))
            emitStatus(force = true)
        }
        return true
    }

    /** The resume point for an incremental drain. The authoritative cursor lives in
     *  `oura_raw.db` alongside the rows it points past; SharedPreferences keeps a mirror for
     *  the status readout. They can only disagree if one store died independently of the
     *  other, so [OuraRawDb.reconcileCursor] takes the lower of the two and we re-drain the
     *  difference — free, since the ring still holds it and dedup absorbs the overlap. */
    private fun resumeCursor(): Long {
        val prefsCursor = getSharedPreferences("oura_ble", MODE_PRIVATE).getLong("history_cursor_ds", 0L)
        val db = rawDb ?: return prefsCursor
        val effective = db.reconcileCursor(prefsCursor)
        if (effective != prefsCursor) log("cursor reconciled: prefs=$prefsCursor raw.db=${db.cursorDs()} → $effective")
        return effective
    }

    /** Advance the mirrored resume cursor to `ds + 1` — called after the local commit has
     *  durably stored every event up to `ds` (and, on builds with no local store, after the
     *  server has). Monotonic (never regresses), so an out-of-order confirm can't rewind the
     *  cursor. This is the durability contract: unconfirmed events stay re-drainable across
     *  restarts. */
    fun confirmStored(ds: Long): Boolean {
        val prefs = getSharedPreferences("oura_ble", MODE_PRIVATE)
        val next = ds + 1
        if (next > prefs.getLong("history_cursor_ds", 0L)) {
            prefs.edit().putLong("history_cursor_ds", next).apply()
            log("confirmed stored ≤ ds=$ds → resume cursor=$next")
        }
        return true
    }

    fun enableMeasurement(): Boolean {
        if (state != "ready") return false
        OuraProtocol.enableMeasurementSequence().forEach { client?.write(it) }
        log("enableMeasurement: DAYTIME_HR + SPO2 + REAL_STEPS + EXERCISE_HR → automatic, fast-HR off")
        return true
    }

    fun featureStatus(): Boolean {
        if (state != "ready") return false
        client?.write(OuraProtocol.reqFeatureStatus(OuraProtocol.FeatureId.DAYTIME_HR))
        client?.write(OuraProtocol.reqFeatureStatus(OuraProtocol.FeatureId.SPO2))
        client?.write(OuraProtocol.reqFeatureStatus(OuraProtocol.FeatureId.REAL_STEPS))
        log("featureStatus: queried DAYTIME_HR + SPO2 + REAL_STEPS")
        return true
    }

    fun status(): JSONObject = JSONObject()
        .put("state", state)
        .put("battery", battery ?: JSONObject.NULL)
        .put("connectCount", connectCount)
        .put("dropCount", dropCount)
        .put("lastTimeToConnectMs", lastTimeToConnectMs)
        .put("totalConnectedMs", totalConnectedMs +
            if (state == "ready") SystemClock.elapsedRealtime() - connectedAt else 0)
        .put("serviceUptimeMs", SystemClock.elapsedRealtime() - serviceStartedAt)
        .put("consecutiveFailures", consecutiveFailures)
        .put("draining", draining)
        .put("cursorDs", getSharedPreferences("oura_ble", MODE_PRIVATE).getLong("history_cursor_ds", 0L))
        .put("ingestPosted", ingestPosted)
        .put("ingestStored", ingestStored)
        .put("lastIngestError", lastIngestError ?: JSONObject.NULL)
        .put("rawStoreOpen", rawDb != null)
        .put("lowDisk", rawDb?.lowDisk ?: false)

    fun logSnapshot(): JSONArray {
        val arr = JSONArray()
        synchronized(logBuffer) { logBuffer.forEach { arr.put(it) } }
        return arr
    }

    // Status events are throttled: a multi-thousand-event drain used to emit one full
    // status JSON per frame across the bridge (review BLE-7). Forced on state changes.
    private var lastStatusEmitAt = 0L
    private fun emitStatus(force: Boolean = false) {
        if (force) flushFrames() // trailing frames go out with the next state change
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastStatusEmitAt < 1000) return
        lastStatusEmitAt = now
        eventSink?.invoke("ouraStatus", status())
    }

    // ouraFrame batching (Chunk 3, review BLE-7/-15): a drain streams thousands of
    // frames — coalesce them into arrays (≤100, or ≥1 s apart) so the JS bridge is
    // crossed once per batch, not once per frame. Emitted as `ouraFrames` ({frames:[…]});
    // the tester keeps a single-`ouraFrame` listener too for older APKs.
    private val frameEmitBuffer = ArrayList<JSONObject>()
    private var lastFrameEmitAt = 0L
    private fun bufferFrame(obj: JSONObject) {
        frameEmitBuffer.add(obj)
        if (frameEmitBuffer.size >= 100 || SystemClock.elapsedRealtime() - lastFrameEmitAt >= 1000) flushFrames()
    }
    private fun flushFrames() {
        if (frameEmitBuffer.isEmpty()) return
        lastFrameEmitAt = SystemClock.elapsedRealtime()
        val arr = JSONArray()
        frameEmitBuffer.forEach { arr.put(it) }
        frameEmitBuffer.clear()
        eventSink?.invoke("ouraFrames", JSONObject().put("frames", arr))
    }
}
