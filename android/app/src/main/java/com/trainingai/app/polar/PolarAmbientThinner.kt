package com.trainingai.app.polar

/**
 * TN-51. Ambient thinning keeps one HR sample per 30 s and **must stop throwing the beats away**.
 *
 * `PolarStrapService` is built for all-day wear and runs overnight, and `ambient` defaults to true —
 * so a night in the strap goes through this path. The old thinning kept one buffered `Sample` per
 * `AMBIENT_GAP_MS` and dropped the rest whole, each discarded sample carrying its own `rr` list.
 *
 * **Measured live in production 2026-09-20 06:03–06:05 Brisbane:** consecutive stored RR rows sat
 * 30.2 s, 30.2 s and 30.7 s apart — `AMBIENT_GAP_MS` exactly — with **one RR interval per kept
 * sample**. rMSSD is the root-mean-square of differences between ADJACENT intervals, so one interval
 * every 30 s yields no adjacent pair at all: the figure is not degraded, it is **undefined**. That is
 * what blocks PS-44's HRV comparison, which exists to check the strap against the ring's own
 * `0x5d rmssd_ms`.
 *
 * **The thinning itself is not the bug and is not removed.** It exists so all-day 1 Hz does not
 * bloat `oura_heartrate`, and `rr_intervals` already spans 60 days at 23 MB. What changes is that
 * the RR intervals of the dropped samples are **carried forward onto the kept one** instead of
 * discarded. The HR series stays thinned at 1/30 s; the beat series becomes contiguous.
 *
 * That works because of how the server places beats: `/api/hr-ingest` walks a sample's `rr` list
 * BACKWARDS from `sample.at`, subtracting each interval, so a kept sample carrying the whole
 * window's beats lands them across the window they actually occurred in. Carrying forward is
 * therefore not an approximation — it reconstructs the real times.
 *
 * Extracted from the service as a pure function so it can be unit-tested. The logic is the whole
 * fix, and it is the half no device check would isolate: a night of wear that produced good data
 * would not tell you whether it was this or the mode.
 */
object PolarAmbientThinner {

    /**
     * The server caps `rr` per sample (`hr-ingest`'s schema). A carry that exceeds it must SPLIT
     * rather than silently truncate — dropping the overflow would be the same data loss this fixes,
     * wearing a different hat.
     *
     * 30 s holds ~30 beats at rest and ~100 at 200 bpm, so a single window can exceed any sane
     * per-sample cap during a hard effort. The split emits the overflow as extra samples carrying
     * the same bpm, which the backwards walk still places correctly.
     */
    const val MAX_RR_PER_SAMPLE = 100

    /** What the service buffers: a receive time, a bpm, and that packet's RR intervals. */
    data class Beat(val at: Long, val bpm: Int, val rr: List<Int>)

    /** Carried across flushes by the caller, exactly as `lastAmbientSentAt` was. */
    data class State(val lastSentAt: Long = 0L, val pendingRr: List<Int> = emptyList())

    data class Result(val kept: List<Beat>, val state: State)

    /**
     * Keep ~1 sample per [gapMs]; every dropped sample's RR intervals ride forward onto the next
     * kept sample, in chronological order, ahead of that sample's own.
     *
     * **Unsent carry survives in [State].** A flush can end mid-window — the buffer is flushed on a
     * count threshold and on a timer, neither aligned to 30 s — and beats stranded in a flush that
     * kept nothing would be lost exactly as before. That is the case the count-based flush makes
     * common rather than rare.
     */
    fun thin(samples: List<Beat>, state: State, gapMs: Long): Result {
        val kept = ArrayList<Beat>()
        var lastSentAt = state.lastSentAt
        var carry = ArrayList(state.pendingRr)

        for (s in samples) {
            if (lastSentAt == 0L || s.at - lastSentAt >= gapMs) {
                val all = ArrayList<Int>(carry.size + s.rr.size)
                all.addAll(carry)
                all.addAll(s.rr)
                carry = ArrayList()
                lastSentAt = s.at
                // Oldest chunks first, so the emitted samples stay in the order they occurred.
                // Each chunk carries the kept sample's timestamp; the backwards walk from `at`
                // spans them, and the HR row each chunk produces is the same reading, so the
                // thinned HR series is unaffected by the split.
                if (all.size <= MAX_RR_PER_SAMPLE) {
                    kept.add(Beat(s.at, s.bpm, all))
                } else {
                    var i = 0
                    while (i < all.size) {
                        val end = minOf(i + MAX_RR_PER_SAMPLE, all.size)
                        kept.add(Beat(s.at, s.bpm, all.subList(i, end).toList()))
                        i = end
                    }
                }
            } else {
                // Dropped from the HR series, but its beats are not dropped.
                carry.addAll(s.rr)
            }
        }
        return Result(kept, State(lastSentAt, carry))
    }
}
