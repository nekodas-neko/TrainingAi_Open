package com.trainingai.app.polar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.webkit.CookieManager
import com.trainingai.app.DeviceBatteryNotifier
import com.trainingai.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Holds the all-day chest-strap connection so the strap streams HR even with the
 *  screen off / app backgrounded (the WebView-based JS path is suspended in the
 *  background — this native foreground service is not). Owns the whole strap
 *  pipeline: connect over standard HRS, decode 0x2A37, POST decoded samples to
 *  /api/hr-ingest itself (native HTTP, session cookie from CookieManager — same
 *  pattern as OuraRingService), and emit live beats to JS for the in-app readout.
 *
 *  Ambient (all-day) mode thins what it PERSISTS to ~1 sample/30 s so all-day 1 Hz
 *  doesn't bloat oura_heartrate; full 1 Hz during a workout. Live events to JS are
 *  never thinned. */
class PolarStrapService : Service(), PolarGattClient.Listener {

    companion object {
        @Volatile var instance: PolarStrapService? = null
        @Volatile var eventSink: ((type: String, data: JSONObject) -> Unit)? = null
        // v2: NotificationChannel importance is immutable once created, so an upgraded install
        // would keep the old IMPORTANCE_LOW channel and the drop to MIN would never take effect.
        private const val CHANNEL_ID = "polar-ble-v2"
        private const val LEGACY_CHANNEL_ID = "polar-ble"
        private const val LOW_BATTERY_CHANNEL_ID = "polar-ble-low-battery"
        private const val LOW_BATTERY_NOTIF_ID = 2012
        private const val NOTIF_ID = 2002
        private val BACKOFF_MS = longArrayOf(2_000, 5_000, 10_000, 30_000, 60_000, 120_000)
        private const val FLUSH_EVERY_MS = 10_000L
        private const val FLUSH_AT_COUNT = 40
        private const val MAX_BUFFER = 1_200
        private const val AMBIENT_GAP_MS = 30_000L
        private const val NOT_WORN_GRACE_MS = 15_000L
        /** ~1 s of 50 Hz accelerometer per bridge call. */
        private const val ACC_EMIT_AT_COUNT = 50
        private const val ACC_EMIT_EVERY_MS = 1_000L
        /** Give up after exhausting the backoff ladder once (~4 min total) rather than nagging
         *  the "unreachable" notification forever. Unlike the ring, the strap is not meant to be
         *  worn all day (the ring covers when it's absent), so a long-unreachable strap almost
         *  always just means it isn't being worn right now — stop the service quietly instead
         *  of retrying at the 120s ceiling indefinitely. JS restarts it on the next app open.
         *  Matches BACKOFF_MS.size (kept a literal — array size isn't a compile-time constant). */
        private const val MAX_CONSECUTIVE_FAILURES = 6

        /** TN-54. A healthy connection changes nothing for hours, so change alone would leave a
         *  gap indistinguishable from the service being dead. This floor makes "still connected"
         *  an observation rather than an absence of one. */
        private const val STATUS_HEARTBEAT_MS = 15 * 60 * 1000L

        /** onDestroy has a bounded window before the process can go; the give-up status and the
         *  final flush have to fit inside it. */
        private const val SHUTDOWN_DRAIN_SEC = 3L
    }

    private val main = Handler(Looper.getMainLooper())
    private val ingest = Executors.newSingleThreadExecutor()
    private var client: PolarGattClient? = null
    private var deviceId: String? = null
    private var ingestUrl: String? = null
    private var stopped = false
    private var consecutiveFailures = 0
    private var state = "idle"
    private var battery: Int? = null
    // BF-140. The reading's OWN time, carried to JS so it is not re-stamped as new on every Home
    // mount. `battery` is written once per connection and never cleared, so without this the chip's
    // staleness affordance can never fire and a months-old reading is pixel-identical to a live one.
    private var batteryAt: Long? = null
    // TN-54. The strap's own last good sample. This is the one figure in the posted status that
    // is NOT server-stamped, because it is what answers "did last night actually record".
    private var lastSampleAt: Long? = null
    private var lastPostedKey: String? = null
    private var lastStatusPostAt = 0L
    private var lowBatteryFired = false

    // Worn-gating (contact bit): drop posts while off the chest so the ring covers.
    private var worn = true
    private var notWornSince = 0L

    // Ambient vs full persistence. Volatile: set from the plugin thread.
    @Volatile private var ambient = true
    // TN-51: null means "nothing sent yet", replacing a 0L sentinel that a real timestamp of 0
    // could collide with. See PolarAmbientThinner.State.
    private var lastAmbientSentAt: Long? = null
    // TN-51. Beats from samples the thinning dropped, waiting for the next kept sample. Carried
    // across flushes: the buffer flushes on a count threshold and on a timer, neither aligned to
    // AMBIENT_GAP_MS, so a flush that keeps nothing is ordinary — and its beats would otherwise be
    // lost exactly as before.
    private var pendingAmbientRr: List<Int> = emptyList()

    private data class Sample(val at: Long, val bpm: Int, val rr: List<Int>)
    private val buffer = ArrayList<Sample>()
    private var flushScheduled = false

    // Accelerometer (cadence) stream — opt-in, bounded to an active run/walk.
    private var accStreaming = false
    private val accBuffer = ArrayList<Double>()
    private var accFrameType = -1
    private var accFramesSeen = 0L

    private fun log(line: String) {
        eventSink?.invoke("polarLog", JSONObject().put("line", line))
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
        val prefs = getSharedPreferences("polar_ble", MODE_PRIVATE)
        deviceId = prefs.getString("device_id", null)
        if (deviceId == null) { log("no strap paired — stopping"); stopSelf(); return START_NOT_STICKY }
        ingestUrl = prefs.getString("ingest_url", null)
        startInForeground("Connecting to strap…")
        stopped = false
        scheduleFlush()
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
        // Tell JS before dying. Without a final status the WebView keeps its last-seen state
        // forever and the pairing card claims the strap is still connecting while nothing is
        // (owner report, 2026-08-02).
        state = "stopped"
        emitStatus()
        main.removeCallbacksAndMessages(null)
        flush() // best-effort final flush
        // TN-54. `shutdownNow()` alone cancels tasks that have not started, and the two queued
        // immediately above — the give-up status and the final flush — are exactly the ones worth
        // keeping. The give-up row is the whole point of the status table: it is the difference
        // between "the strap was unreachable and the service stopped" and five days of silence.
        // Bounded, so a wedged POST cannot hold the service open.
        ingest.shutdown()
        try {
            if (!ingest.awaitTermination(SHUTDOWN_DRAIN_SEC, TimeUnit.SECONDS)) ingest.shutdownNow()
        } catch (_: InterruptedException) {
            ingest.shutdownNow()
        }
        client?.close(); client = null
        instance = null
        super.onDestroy()
    }

    fun setIngestUrl(url: String) { ingestUrl = url }
    fun setAmbient(a: Boolean) {
        if (a && !ambient) lastAmbientSentAt = null
        ambient = a
    }

    private fun startInForeground(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // MIN, not LOW. This one matters more since v1.257.0: the auto-retry restarts this
            // service roughly every 4 minutes while the app is foregrounded and the strap is off,
            // so "Connecting to strap…" cycles rather than sitting still.
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Chest strap", NotificationManager.IMPORTANCE_MIN))
            nm.deleteNotificationChannel(LEGACY_CHANNEL_ID)
        }
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("TrainingAI · Chest strap")
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
        client = PolarGattClient(this, id, this).also { it.start() }
    }

    private fun scheduleRetry() {
        if (stopped) return
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            log("giving up after $consecutiveFailures consecutive failures — strap not reachable, stopping (ring covers HR)")
            // Announce the give-up before stopSelf(). onDestroy() also emits, but this is the
            // state the user's card needs and the one that names WHY the link is down.
            state = "stopped"
            emitStatus()
            stopSelf()
            return
        }
        val delay = BACKOFF_MS[minOf(consecutiveFailures, BACKOFF_MS.size - 1)]
        log("retry in ${delay / 1000}s (failures=$consecutiveFailures)")
        updateNotification("Strap unreachable — retrying in ${delay / 1000}s")
        main.postDelayed({ attemptConnection() }, delay)
    }

    // ---- PolarGattClient.Listener (callbacks arrive on Binder or main threads) ----

    override fun onLog(line: String) = log(line)

    override fun onState(state: PolarGattClient.State) = runOnMain {
        this.state = state.name.lowercase()
        emitStatus()
    }

    override fun onReady() = runOnMain {
        consecutiveFailures = 0
        state = "ready"
        worn = true; notWornSince = 0L
        updateNotification("Connected")
        emitStatus()
    }

    override fun onSample(sample: PolarProtocol.HrSample) = runOnMain {
        val now = System.currentTimeMillis()
        // Every sample, not just the ones that survive the worn gate: the question this answers is
        // whether the strap was TALKING, and an unworn-but-connected strap is a different fault
        // from an unreachable one.
        lastSampleAt = now
        updateWorn(sample.contact, now)
        // Live beat to JS for the in-app readout — never thinned, emitted even if the
        // POST path is worn-gated off.
        eventSink?.invoke("polarHr", JSONObject().put("bpm", sample.bpm).put("at", now))
        if (!worn) return@runOnMain
        buffer.add(Sample(now, sample.bpm, sample.rr))
        if (buffer.size >= FLUSH_AT_COUNT) flush()
    }

    override fun onFailure(reason: String) = runOnMain {
        log("failure: $reason")
        consecutiveFailures++
        client?.close(); client = null
        state = "disconnected"
        accStreaming = false
        emitStatus()
        scheduleRetry()
    }

    override fun onBattery(percent: Int) = runOnMain {
        battery = percent
        batteryAt = System.currentTimeMillis()
        updateNotification("Connected · $percent% battery")
        // The H10 runs a CR2025 coin cell, and a dying cell presents as flaky connections long
        // before it presents as a dead strap — so this warning is worth more here than on the ring.
        // charging=false always: a coin cell cannot charge.
        val d = DeviceBatteryNotifier.decide(percent, false, lowBatteryFired)
        lowBatteryFired = d.fired
        if (d.notify) {
            DeviceBatteryNotifier.post(
                this, LOW_BATTERY_CHANNEL_ID, "Strap battery", LOW_BATTERY_NOTIF_ID,
                "Chest strap", percent, R.drawable.ic_stat_dumbbell,
            )
        }
        emitStatus()
    }

    override fun onAccFrame(frame: PolarProtocol.AccFrame) = runOnMain {
        // Forward MAGNITUDES, not 3-axis samples: magnitude is what the cadence DSP consumes,
        // it is orientation-independent, and it cuts what crosses the JS bridge by two thirds.
        // The DSP itself deliberately stays in TypeScript so ring and strap cadence share one
        // implementation rather than growing a second copy here.
        for (s in frame.samples) accBuffer.add(PolarProtocol.magnitude(s))
        accFrameType = frame.frameType
        accFramesSeen++
        if (accBuffer.size >= ACC_EMIT_AT_COUNT) emitAccBatch()
    }

    /** Emit buffered magnitudes to JS. Batched so a 50 Hz stream is ~1 bridge call/second
     *  instead of 50 — the bridge, not the radio, is what would struggle otherwise. */
    private fun emitAccBatch() {
        if (accBuffer.isEmpty()) return
        val arr = JSONArray()
        for (m in accBuffer) arr.put(Math.round(m).toInt())
        accBuffer.clear()
        eventSink?.invoke("polarAccel", JSONObject()
            .put("magnitudes", arr)
            .put("sampleRate", PolarProtocol.ACC_SAMPLE_RATE_HZ)
            .put("frameType", accFrameType)
            .put("at", System.currentTimeMillis()))
    }

    /**
     * Turn the accelerometer stream on/off. Off by default and never all-day: a continuous
     * accelerometer stream is real drain on both the strap and the phone, so it runs only for
     * a bounded run/walk, started explicitly by JS. HR streaming is untouched either way.
     */
    fun setAccStreaming(enabled: Boolean) = runOnMain {
        if (enabled == accStreaming) return@runOnMain
        accStreaming = enabled
        accBuffer.clear()
        if (enabled) {
            accFramesSeen = 0
            accFrameType = -1
            client?.startAccStream()
            scheduleAccEmit()
        } else {
            client?.stopAccStream()
        }
        emitStatus()
    }

    /** Flush partial batches on a timer so a low-rate or stuttering stream still reaches the
     *  UI promptly instead of waiting for a full buffer that may never arrive. */
    private fun scheduleAccEmit() {
        main.postDelayed(object : Runnable {
            override fun run() {
                if (stopped || !accStreaming) return
                emitAccBatch()
                main.postDelayed(this, ACC_EMIT_EVERY_MS)
            }
        }, ACC_EMIT_EVERY_MS)
    }

    private fun updateWorn(contact: Boolean?, now: Long) {
        if (contact != false) { worn = true; notWornSince = 0L; return }
        if (notWornSince == 0L) notWornSince = now
        if (now - notWornSince > NOT_WORN_GRACE_MS) worn = false
    }

    // ---- ingest ----

    private fun scheduleFlush() {
        if (flushScheduled) return
        flushScheduled = true
        main.postDelayed(object : Runnable {
            override fun run() {
                flush()
                if (!stopped) main.postDelayed(this, FLUSH_EVERY_MS)
            }
        }, FLUSH_EVERY_MS)
    }

    private fun flush() {
        if (buffer.isEmpty()) return
        var batch = ArrayList(buffer)
        buffer.clear()
        if (ambient) batch = thinAmbient(batch)
        if (batch.isEmpty()) return
        val base = ingestUrl ?: return
        ingest.execute { postSamples(base, batch) }
    }

    // TN-51. Keep ~1 sample/AMBIENT_GAP_MS, and carry every dropped sample's RR intervals forward
    // onto the kept one. The thinning stays — it exists so all-day 1 Hz does not bloat
    // `oura_heartrate` — but the beats it used to discard are what rMSSD is computed from, and
    // dropping them made the figure UNDEFINED rather than noisy (one interval per 30 s has no
    // adjacent pair). Logic lives in `PolarAmbientThinner` so it can be unit-tested; this is the
    // half no device check would isolate.
    private fun thinAmbient(samples: List<Sample>): ArrayList<Sample> {
        val result = PolarAmbientThinner.thin(
            samples.map { PolarAmbientThinner.Beat(it.at, it.bpm, it.rr) },
            PolarAmbientThinner.State(lastAmbientSentAt, pendingAmbientRr),
            AMBIENT_GAP_MS,
        )
        lastAmbientSentAt = result.state.lastSentAt
        pendingAmbientRr = result.state.pendingRr
        return ArrayList(result.kept.map { Sample(it.at, it.bpm, it.rr) })
    }

    private fun postSamples(base: String, samples: List<Sample>) {
        try {
            val cookie = CookieManager.getInstance().getCookie(base) ?: return
            val arr = JSONArray()
            for (s in samples) {
                val rr = JSONArray().also { a -> s.rr.forEach { a.put(it) } }
                arr.put(JSONObject().put("at", s.at).put("bpm", s.bpm).put("rr", rr))
            }
            val body = JSONObject().put("samples", arr).toString().toByteArray(Charsets.UTF_8)
            val conn = URL("$base/api/hr-ingest").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write(body) }
                val code = conn.responseCode
                if (code < 200 || code >= 300) {
                    // On a transient failure, re-buffer so the next flush retries (capped).
                    if (code >= 500 || code == 429) rebuffer(samples)
                    log("ingest HTTP $code")
                }
            } finally {
                conn.disconnect()
            }
        } catch (_: InterruptedException) {
            // shutting down
        } catch (e: Exception) {
            rebuffer(samples)
            log("ingest failed: ${e.message}")
        }
    }

    private fun rebuffer(samples: List<Sample>) = runOnMain {
        buffer.addAll(0, samples)
        while (buffer.size > MAX_BUFFER) buffer.removeAt(0)
    }

    // ---- plugin surface ----

    fun status(): JSONObject = JSONObject()
        .put("state", state)
        .put("worn", worn)
        .put("ambient", ambient)
        .put("failures", consecutiveFailures)
        .put("battery", battery ?: JSONObject.NULL)
        .put("batteryAt", batteryAt ?: JSONObject.NULL)
        .put("accStreaming", accStreaming)
        // Surfaced for the calibration console: which frame encoding the H10 actually sends,
        // and whether frames are arriving at all, are the first two questions a failing
        // cadence capture needs answered.
        .put("accFrameType", accFrameType)
        .put("accFramesSeen", accFramesSeen)
        .put("accSampleRate", PolarProtocol.ACC_SAMPLE_RATE_HZ)

    private fun emitStatus() {
        eventSink?.invoke("polarStatus", status())
        postStatusIfChanged()
    }

    /**
     * TN-54. Persist what `status()` has always known.
     *
     * Hooked to `emitStatus()` rather than to individual call sites because every transition worth
     * recording already calls it — connect, ready, failure, battery, give-up and the final
     * `onDestroy` — and a new transition that forgets to post is the failure mode this exists to
     * remove. It is NOT on the sample path, so this cannot become per-beat traffic.
     *
     * Posts on a change of the fields that explain reachability, plus a slow heartbeat so hours of
     * healthy connection read as evidence rather than as silence.
     */
    private fun postStatusIfChanged() {
        val base = ingestUrl ?: return
        val key = "$state|$consecutiveFailures|$battery|$worn"
        val now = System.currentTimeMillis()
        if (key == lastPostedKey && now - lastStatusPostAt < STATUS_HEARTBEAT_MS) return
        lastPostedKey = key
        lastStatusPostAt = now
        val body = JSONObject()
            .put("state", state)
            .put("batteryPercent", battery ?: JSONObject.NULL)
            .put("lastSampleAt", lastSampleAt ?: JSONObject.NULL)
            .put("consecutiveFailures", consecutiveFailures)
            .put("worn", worn)
            .toString().toByteArray(Charsets.UTF_8)
        try {
            ingest.execute { postStatus(base, body) }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            // Shutting down and the drain window has closed. Nothing to recover — dropping a
            // status must never be able to take the service down with it.
        }
    }

    private fun postStatus(base: String, body: ByteArray) {
        try {
            val cookie = CookieManager.getInstance().getCookie(base)
            if (cookie == null) {
                // Worth a line: no cookie means the SAMPLE path is silently returning too
                // (`postSamples` does the same), which looks identical to a dead strap.
                log("status not posted — no session cookie for $base")
                return
            }
            val conn = URL("$base/api/strap-status").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write(body) }
                val code = conn.responseCode
                // No re-buffering, unlike samples: a status is a point-in-time observation and a
                // stale one re-sent later would be a lie about when it was true.
                if (code < 200 || code >= 300) log("status HTTP $code")
            } finally {
                conn.disconnect()
            }
        } catch (_: InterruptedException) {
            // shutting down
        } catch (e: Exception) {
            log("status post failed: ${e.message}")
        }
    }
}
