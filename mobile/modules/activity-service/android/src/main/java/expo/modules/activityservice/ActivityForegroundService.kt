package expo.modules.activityservice

import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

// A connected-device foreground service with no work of its own: while it runs Android keeps the
// process alive with the screen off, so the JS strap session's BLE link (react-native-ble-plx)
// keeps delivering heart rate and accelerometer samples. GPS recordings use expo-location's
// location service instead; only one of the two runs for an activity. A gym workout with a paired
// strap holds this same service (#3627); JS counts who holds it (`shared-service.ts`).
class ActivityForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "TrainingAI · Activity"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Tracking your activity"
    val clock = ActivityServicePolicy.clock(
      intent?.getDoubleExtra(EXTRA_CLOCK_STARTED_AT, -1.0),
      intent?.getDoubleExtra(EXTRA_CLOCK_PAUSED_MS, -1.0),
    )
    try {
      ServiceCompat.startForeground(
        this,
        ActivityNotification.SERVICE_ID,
        ActivityNotification.build(this, title, body, clock),
        ActivityServicePolicy.serviceType(Build.VERSION.SDK_INT),
      )
      running = true
      // The service's notification carries the clock now: a plain one shown before it goes.
      ActivityNotification.clearPlain(this)
      ActivityServiceController.settle("on")
    } catch (failure: Exception) {
      // ForegroundServiceStartNotAllowedException, or a SecurityException for a missing
      // prerequisite permission: JS falls back to screen-on recording and says so.
      ActivityServiceController.settle("failed")
      stopSelf()
    }
    // Restarted by Android after a kill, it would hold a process with no activity to serve.
    return START_NOT_STICKY
  }

  // Swiping the app away ends the activity's process: the notification must go with it.
  override fun onTaskRemoved(rootIntent: Intent?) {
    running = false
    ActivityNotification.clearPlain(this)
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TITLE = "trainingai.activityService.title"
    const val EXTRA_BODY = "trainingai.activityService.body"
    const val EXTRA_CLOCK_STARTED_AT = "trainingai.activityService.clockStartedAt"
    const val EXTRA_CLOCK_PAUSED_MS = "trainingai.activityService.clockPausedMs"

    /**
     * Whether the service's notification is up, so a clock update goes to its slot. Cleared by the
     * controller the moment it asks for a stop, not when onDestroy lands later: an update sent
     * straight after a stop must go to the plain slot, or onDestroy would remove it.
     */
    @Volatile var running = false
  }
}
