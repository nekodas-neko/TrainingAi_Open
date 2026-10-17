package com.trainingai.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #2908 — leaving the Workout tab with no workout running must not open picture-in-picture. */
class PipPolicyTest {
    private val origin = IngestUrlPolicy.APP_ORIGIN

    @Test fun `enters PiP on the workout route in every active phase`() {
        for (phase in listOf("rest", "set", "complete", "summary")) {
            assertTrue(phase, PipPolicy.shouldEnterPip("$origin/workout?session=abc", phase))
        }
    }

    @Test fun `the shell's starting state is no workout`() {
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout", PipPolicy.IDLE))
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout", null))
    }

    @Test fun `workout-select never matches, whatever the phase`() {
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout-select", "rest"))
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout-select?x=1", "set"))
        assertFalse(PipPolicy.shouldEnterPip("$origin/workouts", "set"))
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout/history", "set"))
    }

    @Test fun `no PiP for pre, done or a missing url`() {
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout", "pre"))
        assertFalse(PipPolicy.shouldEnterPip("$origin/workout", "done"))
        assertFalse(PipPolicy.shouldEnterPip(null, "set"))
        assertFalse(PipPolicy.shouldEnterPip("not a url ::", "set"))
    }
}
