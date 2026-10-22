package expo.modules.workoutstatus

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Draws WorkoutPresentation as the ongoing notification. The countdown is the system's own
// chronometer, counting down to the rest's end, so it keeps running while the app is suspended.
// No foreground service: the notification displays state the app already holds durably and records
// nothing, so nothing here has to keep the process alive.
object WorkoutStatusNotifier {
  const val EXTRA_WORKOUT_ID = "trainingai.workoutStatus.workoutId"
  private const val CHANNEL_ID = "training-workout-status"
  private const val NOTIFICATION_ID = 7301
  private const val PREFS = "workout-status"
  private const val DISMISSED = "dismissedWorkoutId"
  // An abandoned notification (app killed, phone left) clears itself; every update restarts this.
  private const val MAX_AGE_MS = 6L * 60 * 60 * 1000

  fun post(context: Context, status: WorkoutStatus, nowMs: Long): Boolean {
    if (!WorkoutStatusPolicy.mayPost(dismissedId(context), status.workoutId)) return false
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    ensureChannel(context)
    return try {
      manager.notify(NOTIFICATION_ID, build(context, status, nowMs))
      true
    } catch (denied: SecurityException) {
      false
    }
  }

  fun clear(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  fun rememberDismissed(context: Context, workoutId: String) {
    prefs(context).edit().putString(DISMISSED, workoutId).apply()
  }

  private fun dismissedId(context: Context) = prefs(context).getString(DISMISSED, null)

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Workout status", NotificationManager.IMPORTANCE_LOW).apply {
      description = "The exercise, next set and rest countdown while a workout is open"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun build(context: Context, status: WorkoutStatus, nowMs: Long): android.app.Notification {
    val view = WorkoutStatusPresenter.present(status, nowMs)
    val manager = context.getSystemService(NotificationManager::class.java)
    val promoted = WorkoutStatusPolicy.requestsPromotion(
      Build.VERSION.SDK_INT,
      Build.VERSION.SDK_INT >= WorkoutStatusPolicy.PROMOTION_SDK && manager.canPostPromotedNotifications(),
    )
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.workout_status_icon)
      .setContentTitle(view.title)
      .setContentText(view.text)
      .setSubText(view.subText.ifEmpty { null })
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setLocalOnly(true)
      .setTimeoutAfter(MAX_AGE_MS)
      .setContentIntent(openIntent(context, status.workoutId))
      .setDeleteIntent(dismissIntent(context, status.workoutId))
    if (view.countdownEndsAt != null) {
      builder.setShowWhen(true)
        .setWhen(view.countdownEndsAt)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
    }
    if (promoted) {
      builder.setRequestPromotedOngoing(true)
      view.shortCriticalText?.let { builder.setShortCriticalText(it) }
    }
    return builder.build()
  }

  // The app's own launch intent, so the tap brings the existing task forward rather than starting
  // a second one; the extra tells JS which workout to open.
  private fun openIntent(context: Context, workoutId: String): PendingIntent {
    val launch = requireNotNull(context.packageManager.getLaunchIntentForPackage(context.packageName)) {
      "The app has no launch intent."
    }.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_WORKOUT_ID, workoutId)
    }
    return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun dismissIntent(context: Context, workoutId: String): PendingIntent {
    val intent = Intent(context, WorkoutStatusDismissReceiver::class.java).putExtra(EXTRA_WORKOUT_ID, workoutId)
    return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
