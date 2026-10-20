package com.trainingai.app.scale

import org.junit.Assert.assertEquals
import org.junit.Test

class ScaleWeighInOutcomeTest {

    @Test
    fun `a confirmed reading that moved the trend is logged`() {
        assertEquals(ScaleWeighInOutcome.LOGGED, ScaleWeighInOutcome.of("confirmed", false, false))
    }

    @Test
    fun `a confirmed reading that left the trend unchanged is an additional reading`() {
        assertEquals(ScaleWeighInOutcome.ADDITIONAL, ScaleWeighInOutcome.of("confirmed", false, true))
    }

    @Test
    fun `an ambiguous reading is pending`() {
        assertEquals(ScaleWeighInOutcome.PENDING, ScaleWeighInOutcome.of("pending", false, false))
    }

    @Test
    fun `a saved reading without composition is composition skipped`() {
        assertEquals(ScaleWeighInOutcome.COMPOSITION_SKIPPED, ScaleWeighInOutcome.of("confirmed", true, false))
    }

    @Test
    fun `a dismissed reading is declined, never logged`() {
        assertEquals(ScaleWeighInOutcome.DECLINED, ScaleWeighInOutcome.of("dismissed", false, false))
        assertEquals(ScaleWeighInOutcome.DECLINED, ScaleWeighInOutcome.of("dismissed", true, true))
    }
}
