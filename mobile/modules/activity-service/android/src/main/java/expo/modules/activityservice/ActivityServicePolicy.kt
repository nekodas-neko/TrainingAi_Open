package expo.modules.activityservice

import android.content.pm.ServiceInfo

// The decisions that need no phone, kept apart so the JVM tests can reach them.
object ActivityServicePolicy {
  /**
   * Android 12+ makes BLUETOOTH_CONNECT a runtime permission, and Android 14 refuses a
   * connected-device service without it. With it missing the strap cannot connect either, so there
   * is nothing for the service to keep alive: the caller reports 'skipped' rather than starting.
   */
  fun mayStart(sdk: Int, bluetoothConnectGranted: Boolean): Boolean = sdk < 31 || bluetoothConnectGranted

  /** The type passed to startForeground: typed services exist from Android 10. */
  fun serviceType(sdk: Int): Int = if (sdk >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
}
