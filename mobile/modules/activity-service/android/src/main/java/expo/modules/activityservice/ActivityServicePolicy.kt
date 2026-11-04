package expo.modules.activityservice

import android.content.pm.ServiceInfo
import java.util.Locale

/**
 * The clock the activity notification shows (#3626). `startedAt` is the instant the elapsed time
 * counts from (the start moved on by the time already spent paused), so a running clock is the
 * system chronometer from it; `pausedElapsedMs` is set while paused, when the clock stands still.
 * JS works both out from the activity (`activityClock`); this side only shows them.
 */
data class ActivityClock(val startedAt: Long, val pausedElapsedMs: Long?)

// The decisions that need no phone, kept apart so the JVM tests can reach them.
object ActivityServicePolicy {
  /** How long a plain clock notification (beside a GPS recording's service) may outlive its post. */
  const val PLAIN_MAX_AGE_MS = 6L * 60 * 60 * 1000

  /**
   * Android 12+ makes BLUETOOTH_CONNECT a runtime permission, and Android 14 refuses a
   * connected-device service without it. With it missing the strap cannot connect either, so there
   * is nothing for the service to keep alive: the caller reports 'skipped' rather than starting.
   */
  fun mayStart(sdk: Int, bluetoothConnectGranted: Boolean): Boolean = sdk < 31 || bluetoothConnectGranted

  /** The type passed to startForeground: typed services exist from Android 10. */
  fun serviceType(sdk: Int): Int = if (sdk >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0

  /** The clock from JS's two numbers; absent or negative means none (or not paused). */
  fun clock(startedAt: Double?, pausedElapsedMs: Double?): ActivityClock? {
    if (startedAt == null || startedAt.isNaN() || startedAt <= 0) return null
    val paused = pausedElapsedMs?.takeIf { !it.isNaN() && it >= 0 }?.toLong()
    return ActivityClock(startedAt.toLong(), paused)
  }

  /** "Paused · 12:34", or "Paused · 1:02:03" past the hour: the chronometer's own format. */
  fun pausedText(elapsedMs: Long): String {
    val total = maxOf(0L, elapsedMs) / 1000
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    val time =
      if (hours > 0) String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds)
      else String.format(Locale.ROOT, "%02d:%02d", minutes, seconds)
    return "Paused · $time"
  }
}
