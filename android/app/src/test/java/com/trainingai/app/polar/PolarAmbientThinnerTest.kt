package com.trainingai.app.polar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-51. The property under test is not "thinning happens" — it did before. It is that **no RR
 * interval is lost**, because the measured failure was one interval every 30 s, which makes rMSSD
 * undefined rather than merely noisy.
 */
class PolarAmbientThinnerTest {

    private val GAP = 30_000L
    private fun beat(at: Long, bpm: Int, vararg rr: Int) =
        PolarAmbientThinner.Beat(at, bpm, rr.toList())

    private fun allRr(r: PolarAmbientThinner.Result) = r.kept.flatMap { it.rr }

    @Test
    fun `the HR series is still thinned to one sample per gap`() {
        // The bloat argument the thinning exists for has to survive the fix.
        val samples = (0..59).map { beat(it * 1_000L, 60, 1000) }
        val r = PolarAmbientThinner.thin(samples, PolarAmbientThinner.State(), GAP)
        assertEquals(listOf(0L, 30_000L), r.kept.map { it.at })
    }

    @Test
    fun `every RR interval of every dropped sample survives`() {
        // This is the whole entry. 60 seconds of 1 Hz beats, thinned to 2 HR samples, must still
        // carry 60 intervals — not 2.
        val samples = (0..59).map { beat(it * 1_000L, 60, 1000 + it) }
        val r = PolarAmbientThinner.thin(samples, PolarAmbientThinner.State(), GAP)
        val rr = allRr(r) + r.state.pendingRr
        assertEquals(60, rr.size)
        assertEquals((0..59).map { 1000 + it }, rr)
    }

    @Test
    fun `carried intervals stay in chronological order, ahead of the kept sample's own`() {
        // The server walks `rr` BACKWARDS from sample.at, so order is not cosmetic — it decides
        // the timestamp each beat is stored at.
        // A real previous send, not a sentinel: `lastSentAt` is nullable precisely so a test does
        // not have to reach for a negative timestamp to mean "long enough ago".
        val r = PolarAmbientThinner.thin(
            listOf(beat(0, 60, 900), beat(1_000, 60, 910), beat(30_000, 60, 920)),
            PolarAmbientThinner.State(lastSentAt = -GAP), GAP,
        )
        assertEquals(listOf(900, 910, 920), allRr(r))
    }

    @Test
    fun `a carry stranded by a flush boundary is not lost`() {
        // The buffer flushes on a count threshold and on a timer, neither aligned to 30 s, so a
        // flush that keeps NOTHING is ordinary rather than exotic. Before the carry lived in State,
        // those beats were dropped exactly as the bug describes.
        val first = PolarAmbientThinner.thin(
            listOf(beat(0, 60, 1000)), PolarAmbientThinner.State(), GAP,
        )
        val second = PolarAmbientThinner.thin(
            listOf(beat(10_000, 60, 1010), beat(20_000, 60, 1020)), first.state, GAP,
        )
        assertTrue("nothing should be kept mid-window", second.kept.isEmpty())
        assertEquals(listOf(1010, 1020), second.state.pendingRr)

        val third = PolarAmbientThinner.thin(
            listOf(beat(30_000, 60, 1030)), second.state, GAP,
        )
        assertEquals(listOf(1010, 1020, 1030), allRr(third))
        assertTrue(third.state.pendingRr.isEmpty())
    }

    @Test
    fun `an oversized window splits instead of truncating`() {
        // A hard effort can put >100 beats in 30 s. Truncating the overflow would be the same data
        // loss this fixes; the split keeps every interval and the backwards walk still places them.
        val many = (1..250).map { 200 + it }
        val samples = listOf(beat(0, 60, 1000)) +
            (1..29).map { PolarAmbientThinner.Beat(it * 1_000L, 60, emptyList()) } +
            listOf(PolarAmbientThinner.Beat(30_000, 180, many))
        val r = PolarAmbientThinner.thin(samples, PolarAmbientThinner.State(), GAP)
        val emitted = r.kept.filter { it.at == 30_000L }
        assertTrue("must split across samples", emitted.size > 1)
        emitted.forEach {
            assertTrue("no chunk may exceed the cap", it.rr.size <= PolarAmbientThinner.MAX_RR_PER_SAMPLE)
        }
        assertEquals(many, emitted.flatMap { it.rr })
    }

    @Test
    fun `the first sample of a session is always kept`() {
        val r = PolarAmbientThinner.thin(listOf(beat(1_700_000_000_000, 55, 1100)),
            PolarAmbientThinner.State(), GAP)
        assertEquals(1, r.kept.size)
        assertEquals(listOf(1100), allRr(r))
    }

    @Test
    fun `a timestamp of zero is a timestamp, not "nothing sent yet"`() {
        // The `0L`-means-never sentinel this replaced collided with a real value: keeping a sample
        // at t=0 set lastSentAt=0, the sentinel fired again, and the thinning silently stopped.
        // Unreachable in production (`at` is System.currentTimeMillis()) and the reason it survived
        // until the logic was testable — which is the argument for extracting it.
        val r = PolarAmbientThinner.thin(
            listOf(beat(0, 60, 1000), beat(1_000, 60, 1001), beat(2_000, 60, 1002)),
            PolarAmbientThinner.State(), GAP,
        )
        assertEquals("only the first sample is inside a gap of one", listOf(0L), r.kept.map { it.at })
        assertEquals(listOf(1001, 1002), r.state.pendingRr)
    }

    @Test
    fun `a sample carrying no RR still thins without inventing intervals`() {
        // The H10 emits bpm with no rr during acquisition. That must not become a phantom beat.
        val r = PolarAmbientThinner.thin(
            listOf(PolarAmbientThinner.Beat(0, 0, emptyList()),
                   PolarAmbientThinner.Beat(30_000, 60, emptyList())),
            PolarAmbientThinner.State(), GAP,
        )
        assertEquals(2, r.kept.size)
        assertTrue(allRr(r).isEmpty())
    }
}
