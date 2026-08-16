package com.trainingai.app.oura

import org.junit.Assert.*
import org.junit.Test

/** Parity with `lib/oura-ble/__tests__/clock.test.ts`'s epoch-detection cases —
 *  `decideAnchorObservation` must agree with `isClockEpochReset`/`currentEpoch` in clock.ts on
 *  every one of them, since both read the same ring and must open the same epoch at the same
 *  point. */
class OuraRawDbTest {

    @Test fun firstEverObservationOpensEpochZero() {
        val (epoch, observe) = decideAnchorObservation(null, Long.MIN_VALUE, 10_000)
        assertEquals(0, epoch)
        assertTrue(observe)
    }

    @Test fun batchAdvancingTheEpochIsObserved() {
        val (epoch, observe) = decideAnchorObservation(0, 1_000_000, 1_000_500)
        assertEquals(0, epoch)
        assertTrue(observe)
    }

    @Test fun batchNotAdvancingTheEpochIsNotObserved() {
        val (epoch, observe) = decideAnchorObservation(0, 1_000_000, 999_000)
        assertEquals(0, epoch)
        assertFalse(observe)
    }

    @Test fun smallBackwardsStepIsOutOfOrderDeliveryNotAReset() {
        // Mirrors clock.test.ts: exactly at the tolerance boundary is still not a reset.
        val (epoch, observe) = decideAnchorObservation(0, 1_000_000, 1_000_000 - 36_000)
        assertEquals(0, epoch)
        assertFalse(observe)
    }

    @Test fun counterRestartingNearZeroIsAReset() {
        val (epoch, observe) = decideAnchorObservation(0, 9_000_000, 500)
        assertEquals(1, epoch)
        assertTrue(observe)
    }

    @Test fun equalBatchMaxDsIsNotObserved() {
        val (epoch, observe) = decideAnchorObservation(2, 5_000, 5_000)
        assertEquals(2, epoch)
        assertFalse(observe)
    }
}
