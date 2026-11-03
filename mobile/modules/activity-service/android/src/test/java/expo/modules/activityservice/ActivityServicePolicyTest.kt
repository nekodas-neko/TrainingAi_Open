package expo.modules.activityservice

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}
