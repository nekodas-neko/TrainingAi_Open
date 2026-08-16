package com.trainingai.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The ring polls battery every 5 minutes. Without hysteresis a low ring would post 288
 * notifications a day, which is a worse outcome than the always-on notification this change is
 * meant to quieten — so these cases are the point of the feature, not an edge.
 */
class DeviceBatteryNotifierTest {

    @Test fun quietWellAboveTheThreshold() {
        val d = DeviceBatteryNotifier.decide(percent = 62, charging = false, alreadyFired = false)
        assertFalse(d.notify)
        assertFalse(d.fired)
    }

    @Test fun alertsOnTheWayDown() {
        val d = DeviceBatteryNotifier.decide(percent = 34, charging = false, alreadyFired = false)
        assertTrue(d.notify)
        assertTrue(d.fired)
    }

    @Test fun doesNotRepeatWhileStillLow() {
        // This is the 288-a-day case.
        val d = DeviceBatteryNotifier.decide(percent = 20, charging = false, alreadyFired = true)
        assertFalse(d.notify)
        assertTrue(d.fired)
    }

    @Test fun holdsStateInsideTheDeadBand() {
        // 35..39 is neither low enough to alert nor recovered enough to re-arm. Whatever we were,
        // we stay — otherwise a reading hovering on the boundary alternates and notifies on every
        // other poll, which is exactly what the two separate thresholds exist to prevent.
        val stillFired = DeviceBatteryNotifier.decide(37, charging = false, alreadyFired = true)
        assertFalse(stillFired.notify)
        assertTrue(stillFired.fired)

        val stillArmed = DeviceBatteryNotifier.decide(37, charging = false, alreadyFired = false)
        assertFalse(stillArmed.notify)
        assertFalse(stillArmed.fired)
    }

    @Test fun reArmsOnlyAfterGenuineRecovery() {
        val recovered = DeviceBatteryNotifier.decide(41, charging = false, alreadyFired = true)
        assertFalse(recovered.notify)
        assertFalse(recovered.fired)
        // …and a later drop alerts again.
        assertTrue(DeviceBatteryNotifier.decide(30, charging = false, alreadyFired = false).notify)
    }

    @Test fun staysQuietOnCharge() {
        // The reading is going up and the owner is already dealing with it.
        val d = DeviceBatteryNotifier.decide(percent = 12, charging = true, alreadyFired = false)
        assertFalse(d.notify)
        assertFalse(d.fired)
    }

    @Test fun chargingClearsAnOutstandingAlert() {
        val d = DeviceBatteryNotifier.decide(percent = 30, charging = true, alreadyFired = true)
        assertFalse(d.notify)
        assertFalse(d.fired) // re-armed, so unplugging and draining again will warn
    }

    @Test fun aFullDayOfPollsOnALowRingProducesExactlyOneAlert() {
        // 288 polls at 5-minute intervals, battery drifting down through the threshold.
        var fired = false
        var alerts = 0
        for (i in 0 until 288) {
            val pct = 45 - (i * 45 / 288) // 45 → 0 across the day
            val d = DeviceBatteryNotifier.decide(pct, charging = false, alreadyFired = fired)
            fired = d.fired
            if (d.notify) alerts++
        }
        assertTrue("expected exactly one alert across a day of polls, got $alerts", alerts == 1)
    }
}
