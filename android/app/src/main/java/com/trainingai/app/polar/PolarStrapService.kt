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
    private var lowBatteryFired = false

    // Worn-gating (contact bit): drop posts while off the chest so the ring covers.
    private var worn = true
    private var notWornSince = 0L

    // Ambient vs full persistence. Volatile: set from the plugin thread.
    @Volatile private var ambient = true
    private var lastAmbientSentAt = 0L

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
        ingest.shutdownNow()
        client?.close(); client = null
        instance = null
        super.onDestroy()
    }

    fun setIngestUrl(url: String) { ingestUrl = url }
    fun setAmbient(a: Boolean) {
        if (a && !ambient) lastAmbientSentAt = 0L
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

    // Keep ~1 sample/AMBIENT_GAP_MS; lastAmbientSentAt carries across flushes.
    private fun thinAmbient(samples: List<Sample>): ArrayList<Sample> {
        val kept = ArrayList<Sample>()
        for (s in samples) {
            if (lastAmbientSentAt == 0L || s.at - lastAmbientSentAt >= AMBIENT_GAP_MS) {
                kept.add(s); lastAmbientSentAt = s.at
            }
        }
        return kept
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
        .put("accStreaming", accStreaming)
        // Surfaced for the calibration console: which frame encoding the H10 actually sends,
        // and whether frames are arriving at all, are the first two questions a failing
        // cadence capture needs answered.
        .put("accFrameType", accFrameType)
        .put("accFramesSeen", accFramesSeen)
        .put("accSampleRate", PolarProtocol.ACC_SAMPLE_RATE_HZ)

    private fun emitStatus() { eventSink?.invoke("polarStatus", status()) }
}
