package expo.modules.activityservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

// A connected-device foreground service with no work of its own: while it runs Android keeps the
// process alive with the screen off, so the JS strap session's BLE link (react-native-ble-plx)
// keeps delivering heart rate and accelerometer samples. GPS recordings use expo-location's
// location service instead; only one of the two runs for an activity.
class ActivityForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "TrainingAI · Activity"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Tracking your activity"
    try {
      ensureChannel(this)
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        build(title, body),
        ActivityServicePolicy.serviceType(Build.VERSION.SDK_INT),
      )
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
    stopSelf()
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun build(title: String, body: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val open = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.activity_service_icon)
      .setContentTitle(title)
      .setContentText(body)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "trainingai.activityService.title"
    const val EXTRA_BODY = "trainingai.activityService.body"
    const val CHANNEL_ID = "training-activity-service"
    const val NOTIFICATION_ID = 7311

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Activity recording", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while a walk or indoor activity records with the screen off."
          setShowBadge(false)
        },
      )
    }
  }
}
