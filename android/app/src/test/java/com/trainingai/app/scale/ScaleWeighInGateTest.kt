package com.trainingai.app.scale

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScaleWeighInGateTest {

    @Test
    fun `the first unstable reading of a wake is always new evidence`() {
        // Nothing captured yet, so there is nothing this could be a replay of. This is the case that
        // must never be gated — it is every genuine first weigh-in.
        assertTrue(ScaleWeighInGate.isNewWeighInEvidence(71.0, null))
        assertTrue(ScaleWeighInGate.isNewWeighInEvidence(0.0, null))
    }

    @Test
    fun `a reading identical to the capture just taken is a replay, not a new weigh-in`() {
        // The owner's reported shape: a genuine 71.0 kg capture, then a re-link a minute later
        // replaying the same notification with nobody on the scale.
        assertFalse(ScaleWeighInGate.isNewWeighInEvidence(71.0, 71.0))
    }

    @Test
    fun `a different weight is a new weigh-in even moments after a capture`() {
        // Someone else stepping on, or the same person after a change — the gate must not touch it.
        assertTrue(ScaleWeighInGate.isNewWeighInEvidence(64.2, 71.0))
        assertTrue(ScaleWeighInGate.isNewWeighInEvidence(71.2, 71.0))
    }

    @Test
    fun `the tolerance is a gram, not a rounding band`() {
        // 0.1 kg is the scale's own display resolution and a real difference; only float noise
        // should collapse. A wider band would start suppressing genuine consecutive weigh-ins.
        assertTrue(ScaleWeighInGate.isNewWeighInEvidence(71.1, 71.0))
        assertFalse(ScaleWeighInGate.isNewWeighInEvidence(71.0 + 1e-9, 71.0))
    }
}
