package com.trainingai.app.oura

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteFullException
import android.os.StatFs
import java.io.File

/** One decoded ring history event, as stored in `oura_raw.db`. `bodyHex` is the frame
 *  payload AFTER the 4-byte deciseconds timestamp — the same slice the server stores in
 *  `oura_raw_samples.body_hex`, so a row here and a row there are byte-identical. */
data class OuraRawRow(
    val ringTs: Long,
    val tag: Int,
    val eventName: String,
    val bodyHex: String,
    val measuredAt: Long?,
)

/** One observed `(ringDs ↔ wall-clock)` correspondence — the native mirror of
 *  `lib/oura-ble/clock.ts`'s `ClockAnchor` / `oura_ble_clock_anchors`. */
data class ClockAnchorRow(
    val epoch: Int,
    val anchorDs: Long,
    val anchorUtcMs: Long,
    val observedSource: String,
)

/** Deciseconds per epoch: how far a batch's max ds can regress below the current epoch's
 *  high-water mark before it's treated as a ring-clock reset rather than batch reordering.
 *  Must stay equal to `EPOCH_REGRESSION_TOLERANCE_DS` in clock.ts — both read the same ring. */
private const val EPOCH_REGRESSION_TOLERANCE_DS = 36_000L
private const val MS_PER_DS = 100L

/** Given the current epoch's state and a new batch's max ds, decide whether to record a new
 *  anchor observation and in which epoch. Pure (no SQLite/Android dependency) so it unit-tests
 *  directly — mirrors `insertOuraRawSamples`'s epoch/reset logic in `adapter.ts` exactly: a
 *  batch that doesn't advance the epoch's high-water mark is not observed; a batch materially
 *  *below* it is a reset (re-key / dead battery), not reordering. */
internal fun decideAnchorObservation(epochNow: Int?, epochMaxDs: Long, batchMaxDs: Long): Pair<Int, Boolean> {
    if (epochNow == null) return Pair(0, true)
    if (batchMaxDs < epochMaxDs - EPOCH_REGRESSION_TOLERANCE_DS) return Pair(epochNow + 1, true)
    return Pair(epochNow, batchMaxDs > epochMaxDs)
}

/**
 * The device-owned archival store for raw ring frames, and the home of the authoritative
 * history cursor.
 *
 * Two rules make this file the durability boundary of the whole BLE pipeline:
 *
 * 1. **The cursor lives in the same database as the data it points past.** Previously the
 *    resume cursor lived in SharedPreferences while the frames lived on a server across a
 *    network — two stores that can die independently, and the failure mode is always the
 *    same direction: cursor survives, data doesn't, and the drained span is gone forever
 *    (the ring's buffer only moves forward). `insertBatchAndAdvance` writes both inside one
 *    transaction, so they live or die together.
 * 2. **PRAGMAs are set after open, never inside a transaction.** `journal_mode` cannot be
 *    changed inside one, and doing it during an upgrade is what killed the app's local
 *    SQLite store twice (CLAUDE.md, "Local SQLite Migrations"). `synchronous=FULL` because
 *    the cursor advance is the point of no return — WAL's default NORMAL is not durable
 *    across a battery pull.
 *
 * A single instance owns the file for the whole process ([get]): the foreground service
 * writes it and the WebView bridge reads it, so letting either open its own connection —
 * let alone letting the WebView's SQLite library touch the same WAL — is a two-writer
 * `SQLITE_BUSY` waiting to happen.
 */
class OuraRawDb private constructor(private val file: File, private val db: SQLiteDatabase) {

    /** Set when a write failed for lack of disk. Surfaced in the service status + rawStats
     *  so a full phone is diagnosable instead of just looking like a stalled sync. */
    @Volatile
    var lowDisk: Boolean = false
        private set

    companion object {
        private const val DB_NAME = "oura_raw.db"
        private const val CURSOR_KEY = "history_cursor_ds"
        /** Deletes per prune iteration — bounded so a prune can't hold the write lock for
         *  seconds while the service is trying to commit a drained batch. */
        private const val PRUNE_BATCH = 2000
        private const val PRUNE_MAX_ITERATIONS = 200
        /** SQLite's parameter ceiling is 999; stay well under it when chunking IN lists. */
        private const val IN_CHUNK = 500

        @Volatile private var instance: OuraRawDb? = null

        /**
         * The process-wide instance, or null if the database cannot be opened. Callers must
         * treat null as "no durable local store" and hold the history cursor rather than
         * advancing it — never as "skip the local write and carry on".
         */
        @Synchronized
        fun get(context: Context, log: (String) -> Unit = {}): OuraRawDb? {
            instance?.let { return it }
            return try {
                val file = context.getDatabasePath(DB_NAME)
                file.parentFile?.mkdirs()
                val db = SQLiteDatabase.openDatabase(
                    file.path, null,
                    SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
                )
                // PRAGMAs first, and via rawQuery for journal_mode: it returns a row, and the
                // returned value is the only honest confirmation that WAL actually took (a
                // silently-ignored pragma would leave us on rollback-journal durability).
                val mode = db.rawQuery("PRAGMA journal_mode=WAL", null).use {
                    if (it.moveToFirst()) it.getString(0) else "?"
                }
                db.execSQL("PRAGMA synchronous=FULL")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS raw (
                         ring_ts INTEGER NOT NULL, tag INTEGER NOT NULL, event_name TEXT NOT NULL,
                         body_hex TEXT NOT NULL, measured_at INTEGER,
                         rolled_up INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0,
                         UNIQUE(ring_ts, tag, body_hex))""",
                )
                db.execSQL("CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v INTEGER NOT NULL)")
                db.execSQL("CREATE INDEX IF NOT EXISTS raw_unrolled ON raw(rolled_up, ring_ts)")
                db.execSQL("CREATE INDEX IF NOT EXISTS raw_prunable ON raw(rolled_up, synced, measured_at)")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS clock_anchors (
                         epoch INTEGER NOT NULL, anchor_ds INTEGER NOT NULL, anchor_utc_ms INTEGER NOT NULL,
                         observed_source TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
                         UNIQUE(epoch, anchor_ds))""",
                )
                log("oura_raw.db open (journal_mode=$mode)")
                OuraRawDb(file, db).also { instance = it }
            } catch (e: Exception) {
                log("oura_raw.db FAILED to open: ${e.message ?: e.javaClass.simpleName}")
                null
            }
        }
    }

    /**
     * Insert one drained batch and advance the history cursor to `batchMaxDs + 1`, both in a
     * single transaction. Returns true only once `endTransaction()` has returned — which,
     * under `synchronous=FULL`, means the bytes are on the platter.
     *
     * Returns false without advancing on disk-full or any other write error: the batch stays
     * unconfirmed, the ring re-serves it on the next drain, and `INSERT OR IGNORE` against
     * `UNIQUE(ring_ts, tag, body_hex)` absorbs whatever did land. Re-draining costs seconds;
     * a cursor past data that never landed costs the span permanently.
     *
     * Also observes a `(batchMaxDs ↔ nowMs)` clock-anchor correspondence (mirroring
     * `insertOuraRawSamples`'s anchor maintenance in `adapter.ts`) and backfills this batch's
     * own `measured_at`, in the same transaction — the anchor and the timestamps it produces
     * must live or die with the data they date, same as the cursor.
     */
    fun insertBatchAndAdvance(rows: List<OuraRawRow>, batchMaxDs: Long, nowMs: Long): Boolean = try {
        db.beginTransaction()
        try {
            db.compileStatement(
                "INSERT OR IGNORE INTO raw (ring_ts, tag, event_name, body_hex, measured_at) VALUES (?, ?, ?, ?, ?)",
            ).use { stmt ->
                for (r in rows) {
                    stmt.clearBindings()
                    stmt.bindLong(1, r.ringTs)
                    stmt.bindLong(2, r.tag.toLong())
                    stmt.bindString(3, r.eventName)
                    stmt.bindString(4, r.bodyHex)
                    if (r.measuredAt == null) stmt.bindNull(5) else stmt.bindLong(5, r.measuredAt)
                    stmt.executeInsert()
                }
            }
            // Monotonic by explicit read-then-write rather than an UPSERT: `ON CONFLICT DO
            // UPDATE` needs SQLite 3.24 and minSdk 26 ships 3.19, so the upsert form would
            // throw a syntax error on an old device instead of advancing the cursor.
            val next = batchMaxDs + 1
            if (next > readCursor()) {
                db.execSQL("INSERT OR REPLACE INTO sync_state (k, v) VALUES (?, ?)", arrayOf<Any>(CURSOR_KEY, next))
            }
            observeClockAnchorAndBackfill(batchMaxDs, nowMs)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        lowDisk = false
        true
    } catch (e: SQLiteFullException) {
        lowDisk = true
        false
    } catch (e: Exception) {
        false
    }

    /** Must run inside the caller's transaction. Records a new anchor observation when this
     *  batch's max ds advances the current epoch (or regresses far enough to mean a ring-clock
     *  reset), then stamps every still-null `measured_at` from the single newest anchor across
     *  all epochs — the same "newest anchor wins" stamping rule `insertOuraRawSamples` uses,
     *  not full multi-anchor interpolation (that's for the rollup's later re-derivation, Task 5). */
    private fun observeClockAnchorAndBackfill(batchMaxDs: Long, nowMs: Long) {
        val (epochNow, epochMaxDs) = latestEpochAndMaxDs()
        val (epoch, shouldObserve) = decideAnchorObservation(epochNow, epochMaxDs, batchMaxDs)
        if (shouldObserve) {
            db.execSQL(
                "INSERT OR IGNORE INTO clock_anchors (epoch, anchor_ds, anchor_utc_ms, observed_source, created_at_ms) VALUES (?, ?, ?, ?, ?)",
                arrayOf<Any>(epoch, batchMaxDs, nowMs, "drain", nowMs),
            )
        }
        val anchor = newestAnchor() ?: return
        db.compileStatement(
            "UPDATE raw SET measured_at = ? + (ring_ts - ?) * $MS_PER_DS WHERE measured_at IS NULL",
        ).use {
            it.bindLong(1, anchor.anchorUtcMs)
            it.bindLong(2, anchor.anchorDs)
            it.executeUpdateDelete()
        }
    }

    private fun latestEpochAndMaxDs(): Pair<Int?, Long> {
        db.rawQuery(
            "SELECT epoch, MAX(anchor_ds) FROM clock_anchors WHERE epoch = (SELECT MAX(epoch) FROM clock_anchors)",
            null,
        ).use { if (it.moveToFirst() && !it.isNull(0)) return Pair(it.getInt(0), it.getLong(1)) }
        return Pair(null, Long.MIN_VALUE)
    }

    /** The single newest anchor by wall-clock time, across all epochs — used only for
     *  insert-time `measured_at` stamping. The rollup (Task 5) resolves a given ds against the
     *  bracketing/nearest anchor *within its own epoch* instead (see clock.ts). */
    private fun newestAnchor(): ClockAnchorRow? {
        db.rawQuery(
            "SELECT epoch, anchor_ds, anchor_utc_ms, observed_source FROM clock_anchors ORDER BY anchor_utc_ms DESC LIMIT 1",
            null,
        ).use { if (it.moveToFirst()) return ClockAnchorRow(it.getInt(0), it.getLong(1), it.getLong(2), it.getString(3)) }
        return null
    }

    /** All observed anchors, in ds order — for the WebView rollup bridge (Task 5+). */
    fun getClockAnchors(): List<ClockAnchorRow> {
        val out = ArrayList<ClockAnchorRow>()
        db.rawQuery("SELECT epoch, anchor_ds, anchor_utc_ms, observed_source FROM clock_anchors ORDER BY anchor_ds", null).use { c ->
            while (c.moveToNext()) out.add(ClockAnchorRow(c.getInt(0), c.getLong(1), c.getLong(2), c.getString(3)))
        }
        return out
    }

    /** The authoritative resume cursor (deciseconds), 0 when nothing has been committed. */
    fun cursorDs(): Long = try { readCursor() } catch (e: Exception) { 0L }

    /**
     * Reconcile against the legacy SharedPreferences cursor by taking the **minimum** of the
     * two and persisting it. They can only disagree because one store died independently of
     * the other, and only one direction of disagreement is safe: re-draining a span the ring
     * still holds is free and dedup-absorbed, while trusting the higher cursor skips whatever
     * the lower one hadn't stored. Returns the cursor to drain from.
     */
    fun reconcileCursor(prefsCursorDs: Long): Long = try {
        val own = readCursor()
        val effective = minOf(own, prefsCursorDs)
        if (effective < own) {
            db.execSQL("INSERT OR REPLACE INTO sync_state (k, v) VALUES (?, ?)", arrayOf<Any>(CURSOR_KEY, effective))
        }
        effective
    } catch (e: Exception) {
        prefsCursorDs
    }

    /**
     * Mark the rows of one successfully-POSTed batch as backed up on the server. The WebView
     * never sees that POST's result, so nothing else can set this, and until it is set the
     * prune has nothing it is allowed to delete.
     *
     * Scoped to the batch's own `[minDs, maxDs]` rather than everything up to `maxDs`: batches
     * POST independently, so a later success must not vouch for an earlier batch that failed —
     * that would mark never-uploaded rows prunable, and `body_hex` is the only thing a future
     * decoder fix can be re-run against.
     */
    fun markSyncedRange(minDs: Long, maxDs: Long): Int = try {
        db.compileStatement("UPDATE raw SET synced = 1 WHERE synced = 0 AND ring_ts >= ? AND ring_ts <= ?").use {
            it.bindLong(1, minDs)
            it.bindLong(2, maxDs)
            it.executeUpdateDelete()
        }
    } catch (e: Exception) {
        0
    }

    /**
     * The oldest un-rolled-up rows, in ring order, for the WebView rollup.
     *
     * Never splits a `ring_ts` across two calls: rows are marked consumed by `ring_ts`
     * ([markRolledUp]), so handing back half of a timestamp's rows would let the caller mark
     * the other half consumed without ever having seen it. The returned batch can therefore
     * slightly exceed `limit`.
     */
    fun getUnrolledRaw(limit: Int): List<OuraRawRow> {
        val out = ArrayList<OuraRawRow>(limit)
        var lastTs = 0L
        var lastRowid = 0L
        db.rawQuery(
            "SELECT rowid, ring_ts, tag, event_name, body_hex, measured_at FROM raw " +
                "WHERE rolled_up = 0 ORDER BY ring_ts, rowid LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                lastRowid = c.getLong(0)
                lastTs = c.getLong(1)
                out.add(readRow(c))
            }
        }
        if (out.size < limit) return out
        db.rawQuery(
            "SELECT rowid, ring_ts, tag, event_name, body_hex, measured_at FROM raw " +
                "WHERE rolled_up = 0 AND ring_ts = ? AND rowid > ? ORDER BY rowid",
            arrayOf(lastTs.toString(), lastRowid.toString()),
        ).use { c -> while (c.moveToNext()) out.add(readRow(c)) }
        return out
    }

    fun markRolledUp(ringTsList: List<Long>): Int = updateByRingTs("rolled_up", ringTsList)

    fun markSynced(ringTsList: List<Long>): Int = updateByRingTs("synced", ringTsList)

    /**
     * Delete rolled-up, server-backed rows older than `olderThanMs` in bounded batches, until
     * either nothing is left to delete or free disk reaches `reserveBytes`. Rows with a null
     * `measured_at` are never eligible — an un-timestamped row cannot be proven old.
     */
    fun pruneRaw(olderThanMs: Long, reserveBytes: Long): Int {
        var deleted = 0
        var iterations = 0
        while (iterations++ < PRUNE_MAX_ITERATIONS) {
            if (reserveBytes > 0 && freeBytes() >= reserveBytes) break
            val n = try {
                db.compileStatement(
                    "DELETE FROM raw WHERE rowid IN (SELECT rowid FROM raw " +
                        "WHERE rolled_up = 1 AND synced = 1 AND measured_at IS NOT NULL AND measured_at < ? " +
                        "ORDER BY measured_at LIMIT ?)",
                ).use {
                    it.bindLong(1, olderThanMs)
                    it.bindLong(2, PRUNE_BATCH.toLong())
                    it.executeUpdateDelete()
                }
            } catch (e: Exception) {
                break
            }
            if (n <= 0) break
            deleted += n
        }
        if (deleted > 0) lowDisk = false
        return deleted
    }

    /** `totalRows`, `unrolledRows` and the on-disk size of the database (including its WAL). */
    fun stats(): Triple<Long, Long, Long> {
        val total = countWhere("1 = 1")
        val unrolled = countWhere("rolled_up = 0")
        val bytes = file.length() +
            File("${file.path}-wal").length() +
            File("${file.path}-shm").length()
        return Triple(total, unrolled, bytes)
    }

    // ---- internals ----

    private fun readRow(c: android.database.Cursor) = OuraRawRow(
        ringTs = c.getLong(1),
        tag = c.getInt(2),
        eventName = c.getString(3),
        bodyHex = c.getString(4),
        measuredAt = if (c.isNull(5)) null else c.getLong(5),
    )

    private fun readCursor(): Long =
        db.rawQuery("SELECT v FROM sync_state WHERE k = ?", arrayOf(CURSOR_KEY)).use {
            if (it.moveToFirst()) it.getLong(0) else 0L
        }

    private fun countWhere(where: String): Long = try {
        db.compileStatement("SELECT count(*) FROM raw WHERE $where").use { it.simpleQueryForLong() }
    } catch (e: Exception) {
        0L
    }

    private fun freeBytes(): Long = try {
        val path = file.parentFile?.path ?: return 0L
        StatFs(path).availableBytes
    } catch (e: Exception) {
        0L
    }

    /** One transaction for the whole list so a partial mark can't leave rows the caller
     *  believes it consumed. Chunked to stay under SQLite's bound-parameter ceiling. */
    private fun updateByRingTs(column: String, ringTsList: List<Long>): Int {
        if (ringTsList.isEmpty()) return 0
        var updated = 0
        return try {
            db.beginTransaction()
            try {
                ringTsList.chunked(IN_CHUNK).forEach { chunk ->
                    val placeholders = chunk.joinToString(",") { "?" }
                    db.compileStatement(
                        "UPDATE raw SET $column = 1 WHERE $column = 0 AND ring_ts IN ($placeholders)",
                    ).use { stmt ->
                        chunk.forEachIndexed { i, ts -> stmt.bindLong(i + 1, ts) }
                        updated += stmt.executeUpdateDelete()
                    }
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
            updated
        } catch (e: SQLiteFullException) {
            lowDisk = true
            0
        } catch (e: Exception) {
            0
        }
    }
}
