package expo.modules.workoutstatus

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

// Draws WorkoutPresentation as the ongoing notification. The countdown is the system's own
// chronometer, counting down to the rest's end, so it keeps running while the app is suspended.
// No foreground service: the notification displays state the app already holds durably and records
// nothing, so nothing here has to keep the process alive. Nothing in here throws: a status
// notification must never break the workout that asked for it.
object WorkoutStatusNotifier {
  const val EXTRA_WORKOUT_ID = "trainingai.workoutStatus.workoutId"
  const val EXTRA_NONCE = "trainingai.workoutStatus.nonce"
  /** Set on the paused notification's Resume button: the tap opens the app and resumes the workout. */
  const val EXTRA_RESUME = "trainingai.workoutStatus.resume"
  const val CHANNEL_ID = "training-workout-status"
  const val NOTIFICATION_ID = 7301
  private const val PREFS = "workout-status"
  private const val DISMISSED = "dismissedWorkoutId"
  private const val LAST_STATUS = "lastStatus"
  private const val LAST_OPEN_NONCE = "lastOpenNonce"
  @Volatile private var channelReady = false

  fun post(context: Context, status: WorkoutStatus, nowMs: Long): Boolean {
    if (WorkoutStatusPolicy.isStale(status.startedAt, nowMs)) {
      clear(context)
      return false
    }
    if (!WorkoutStatusPolicy.mayPost(dismissedId(context), status.workoutId)) return false
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    return try {
      ensureChannel(context)
      val promote = WorkoutStatusPolicy.requestsPromotion(sdkFull(), canPostPromoted(context))
      manager.notify(NOTIFICATION_ID, build(context, status, nowMs, promote))
      prefs(context).edit().putString(LAST_STATUS, toJson(status)).apply()
      scheduleRestEnd(context, status, nowMs)
      true
    } catch (failure: Exception) {
      false
    }
  }

  /** The rest-end alarm: the stored status, judged at the moment it fires. */
  fun repostStored(context: Context) {
    val status = storedStatus(context) ?: return
    // An alarm may land a hair before the end; judging it at the end keeps "Rest over" honest.
    post(context, status, maxOf(System.currentTimeMillis(), status.restEndsAt ?: 0))
  }

  fun clear(context: Context) {
    runCatching {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
      alarmManager(context)?.cancel(restEndIntent(context))
      prefs(context).edit().remove(LAST_STATUS).apply()
    }
  }

  fun rememberDismissed(context: Context, workoutId: String) {
    prefs(context).edit().putString(DISMISSED, workoutId).apply()
  }

  /** The workout a tap should open, once: a restored process replaying an old intent gets null. */
  fun consumeOpen(context: Context, workoutId: String?, nonce: Long): String? {
    if (workoutId == null) return null
    val last = prefs(context).getLong(LAST_OPEN_NONCE, 0)
    if (!WorkoutStatusPolicy.isFreshOpen(nonce, last)) return null
    prefs(context).edit().putLong(LAST_OPEN_NONCE, nonce).apply()
    return workoutId
  }

  /** What the system did with the notification, read back from it: ground truth for the phone check. */
  fun promotionReport(context: Context): Map<String, Any?> {
    val manager = context.getSystemService(NotificationManager::class.java)
    val shown = runCatching { manager?.activeNotifications?.firstOrNull { it.id == NOTIFICATION_ID } }.getOrNull()
    val promoted = Build.VERSION.SDK_INT >= WORKOUT_FLAG_SDK &&
      shown != null && (shown.notification.flags and Notification.FLAG_PROMOTED_ONGOING) != 0
    return mapOf(
      "posted" to (shown != null),
      "promoted" to promoted,
      "sdkFull" to sdkFull(),
      "canPostPromoted" to canPostPromoted(context),
    )
  }

  private const val WORKOUT_FLAG_SDK = 36

  private fun sdkFull() = if (Build.VERSION.SDK_INT >= WORKOUT_FLAG_SDK) Build.VERSION.SDK_INT_FULL else 0

  private fun canPostPromoted(context: Context) = Build.VERSION.SDK_INT >= WORKOUT_FLAG_SDK &&
    runCatching { context.getSystemService(NotificationManager::class.java).canPostPromotedNotifications() }
      .getOrDefault(false)

  private fun dismissedId(context: Context) = prefs(context).getString(DISMISSED, null)

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun alarmManager(context: Context) = context.getSystemService(AlarmManager::class.java)

  private fun storedStatus(context: Context): WorkoutStatus? = runCatching {
    val json = JSONObject(prefs(context).getString(LAST_STATUS, null) ?: return null)
    WorkoutStatusPresenter.fromMap(json.keys().asSequence().associateWith { json.opt(it).takeIf { v -> v != JSONObject.NULL } })
  }.getOrNull()

  private fun toJson(status: WorkoutStatus) = JSONObject(
    mapOf(
      "workoutId" to status.workoutId, "sessionName" to status.sessionName,
      "exerciseName" to status.exerciseName, "phase" to status.phase, "nextSet" to status.nextSet,
      "sets" to status.sets, "load" to status.load, "restEndsAt" to status.restEndsAt,
      "label" to status.label, "startedAt" to status.startedAt,
    ).filterValues { it != null },
  ).toString()

  private fun ensureChannel(context: Context) {
    if (channelReady || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Workout status", NotificationManager.IMPORTANCE_LOW).apply {
      description = "The exercise, next set and rest countdown while a workout is open"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    channelReady = true
  }

  internal fun build(context: Context, status: WorkoutStatus, nowMs: Long, promote: Boolean): Notification {
    val view = WorkoutStatusPresenter.present(status, nowMs)
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
      .setTimeoutAfter(WorkoutStatusPolicy.MAX_AGE_MS)
      .setContentIntent(openIntent(context, status.workoutId, nowMs))
      .setDeleteIntent(dismissIntent(context, status.workoutId))
    if (view.countdownEndsAt != null) {
      builder.setShowWhen(true)
        .setWhen(view.countdownEndsAt)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
    }
    // Resume brings the app up and resumes there: the pause lives in the app's own journal, which
    // only the app can write (#3266).
    if (status.phase == WorkoutStatusPresenter.PAUSED) {
      builder.addAction(0, "Resume", openIntent(context, status.workoutId, nowMs, resume = true))
    }
    if (promote) {
      builder.setRequestPromotedOngoing(true)
      view.shortCriticalText?.let { builder.setShortCriticalText(it) }
    }
    return builder.build()
  }

  // The app's own launch intent, so the tap brings the existing task forward rather than starting
  // a second one; the extras tell JS which workout, and the nonce stops a replay from reopening it.
  private fun openIntent(context: Context, workoutId: String, nowMs: Long, resume: Boolean = false): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_WORKOUT_ID, workoutId)
      putExtra(EXTRA_NONCE, nowMs)
      if (resume) putExtra(EXTRA_RESUME, true)
    } ?: return null
    // A request code of its own, so the Resume button's intent is not the tap's.
    return PendingIntent.getActivity(
      context, if (resume) 3 else 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun dismissIntent(context: Context, workoutId: String): PendingIntent {
    val intent = Intent(context, WorkoutStatusDismissReceiver::class.java).putExtra(EXTRA_WORKOUT_ID, workoutId)
    return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun restEndIntent(context: Context): PendingIntent {
    val intent = Intent(context, WorkoutStatusRestEndReceiver::class.java)
    return PendingIntent.getBroadcast(context, 2, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  // Exact where the app may set an exact alarm (it holds USE_EXACT_ALARM), else the nearest the
  // system allows; either way the repost is idempotent, so a late one only shows "Rest over" late.
  private fun scheduleRestEnd(context: Context, status: WorkoutStatus, nowMs: Long) {
    val alarms = alarmManager(context) ?: return
    val pending = restEndIntent(context)
    val at = WorkoutStatusPolicy.restEndAlarmAt(status, nowMs)
    if (at == null) {
      alarms.cancel(pending)
      return
    }
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    try {
      if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
    } catch (denied: SecurityException) {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
    }
  }
}
