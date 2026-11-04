package expo.modules.activityservice

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityServicePolicyTest {
  @Test
  fun startsWithoutBluetoothConnectOnlyBeforeAndroid12() {
    assertTrue(ActivityServicePolicy.mayStart(30, bluetoothConnectGranted = false))
    assertFalse(ActivityServicePolicy.mayStart(31, bluetoothConnectGranted = false))
    assertFalse(ActivityServicePolicy.mayStart(34, bluetoothConnectGranted = false))
    assertTrue(ActivityServicePolicy.mayStart(34, bluetoothConnectGranted = true))
  }

  @Test
  fun typesTheServiceAsConnectedDeviceFromAndroid10() {
    assertEquals(0, ActivityServicePolicy.serviceType(28))
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, ActivityServicePolicy.serviceType(29))
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, ActivityServicePolicy.serviceType(36))
  }

  @Test
  fun readsTheClockFromJsNumbers() {
    assertEquals(ActivityClock(1_700_000_000_000, null), ActivityServicePolicy.clock(1_700_000_000_000.0, null))
    assertEquals(ActivityClock(1_700_000_000_000, null), ActivityServicePolicy.clock(1_700_000_000_000.0, -1.0))
    assertEquals(ActivityClock(1_700_000_000_000, 0), ActivityServicePolicy.clock(1_700_000_000_000.0, 0.0))
    assertEquals(ActivityClock(1_700_000_000_000, 754_000), ActivityServicePolicy.clock(1_700_000_000_000.0, 754_000.0))
    assertNull(ActivityServicePolicy.clock(null, 754_000.0))
    assertNull(ActivityServicePolicy.clock(-1.0, null))
    assertNull(ActivityServicePolicy.clock(Double.NaN, null))
  }

  @Test
  fun showsThePausedTimeInTheChronometersFormat() {
    assertEquals("Paused · 00:00", ActivityServicePolicy.pausedText(0))
    assertEquals("Paused · 12:34", ActivityServicePolicy.pausedText(754_999))
    assertEquals("Paused · 59:59", ActivityServicePolicy.pausedText(3_599_000))
    assertEquals("Paused · 1:02:03", ActivityServicePolicy.pausedText(3_723_000))
    assertEquals("Paused · 00:00", ActivityServicePolicy.pausedText(-5))
  }
}
