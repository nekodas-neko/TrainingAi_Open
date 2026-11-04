package expo.modules.activityservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// The activity notification, built once for both places it appears (#3626): the connected-device
// service's own notification (a treadmill walk, an indoor session, a gym workout holding the strap),
// and, during a GPS recording whose service is expo-location's, a plain notification on its own
// slot carrying the clock that expo-location's fixed text cannot. The current app does the same
// with its run chip beside the geolocation notice (`lib/native/run-status-chip.ts`).
object ActivityNotification {
  const val CHANNEL_ID = "training-activity-service"
  /** The service's notification. */
  const val SERVICE_ID = 7311
  /** The plain one, shown only while the service is not running. */
  const val PLAIN_ID = 7312

  fun build(
    context: Context,
    title: String,
    body: String,
    clock: ActivityClock?,
    timeoutAfterMs: Long? = null,
  ): Notification {
    ensureChannel(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val open = launch?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.activity_service_icon)
      .setContentTitle(title)
      .setContentText(body)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
    // A running activity counts up on the system chronometer, so it keeps time with the app
    // suspended; a paused one shows the frozen time instead, as the workout notification drops
    // its countdown while paused (WorkoutStatusNotifier).
    when {
      clock == null -> builder.setShowWhen(false)
      clock.pausedElapsedMs != null ->
        builder.setShowWhen(false).setUsesChronometer(false).setSubText(ActivityServicePolicy.pausedText(clock.pausedElapsedMs))
      else -> builder.setShowWhen(true).setWhen(clock.startedAt).setUsesChronometer(true)
    }
    timeoutAfterMs?.let { builder.setTimeoutAfter(it) }
    return builder.build()
  }

  /**
   * Shows the notification where it belongs: on the service's slot while the service runs, else on
   * the plain slot. A plain one cannot outlive the activity by long: it times out, and the app
   * clears it at its next start.
   */
  fun show(context: Context, title: String, body: String, clock: ActivityClock?) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    try {
      if (ActivityForegroundService.running) {
        manager.notify(SERVICE_ID, build(context, title, body, clock))
        manager.cancel(PLAIN_ID)
      } else {
        manager.notify(PLAIN_ID, build(context, title, body, clock, ActivityServicePolicy.PLAIN_MAX_AGE_MS))
      }
    } catch (failure: Exception) {
      // SecurityException with the notification permission revoked mid-activity: nothing to show.
    }
  }

  fun clearPlain(context: Context) {
    runCatching { NotificationManagerCompat.from(context).cancel(PLAIN_ID) }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Activity recording", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a walk, run, indoor activity or workout records with the screen off."
        setShowBadge(false)
      },
    )
  }
}
