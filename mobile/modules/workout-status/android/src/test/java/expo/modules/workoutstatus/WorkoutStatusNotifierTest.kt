package expo.modules.workoutstatus

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * #3249: the notification the module builds and posts, on Robolectric's Android 15 (35). The 36.1
 * promotion itself cannot run here (Robolectric has no 36.1), so these pin what the app controls:
 * the extra the system reads is set exactly when promotion is requested, and nothing else changes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WorkoutStatusNotifierTest {
  // The rest-end repost reads the real clock, so the fixtures are anchored to it.
  private val now = System.currentTimeMillis()
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val resting = WorkoutStatus(
    workoutId = "w1", sessionName = "Upper body", exerciseName = "Bench press", phase = "resting",
    nextSet = 3, sets = 4, load = "80 kg × 8", restEndsAt = now + 90_000, startedAt = now - 60_000,
  )

  private fun installLauncher() {
    val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
    val info = ResolveInfo().apply {
      activityInfo = ActivityInfo().apply { packageName = context.packageName; name = "${context.packageName}.MainActivity" }
    }
    shadowOf(context.packageManager).addResolveInfoForIntent(launch, info)
  }

  @Before fun clean() {
    installLauncher()
    context.getSharedPreferences("workout-status", Context.MODE_PRIVATE).edit().clear().commit()
    WorkoutStatusNotifier.clear(context)
  }

  private fun posted(): Notification? =
    shadowOf(context.getSystemService(NotificationManager::class.java)).getNotification(WorkoutStatusNotifier.NOTIFICATION_ID)

  @Test fun `it is ongoing, silent, public and immutable to tap`() {
    val n = WorkoutStatusNotifier.build(context, resting, now, promote = false)
    assertTrue(n.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(Notification.VISIBILITY_PUBLIC, n.visibility)
    assertEquals("Bench press", n.extras.getString(Notification.EXTRA_TITLE))
    assertEquals("Resting, next · Set 3 of 4 · 80 kg × 8", n.extras.getString(Notification.EXTRA_TEXT))
    assertTrue(n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    assertTrue(n.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
    assertEquals(now + 90_000, n.`when`)
    assertNotNull(n.contentIntent)
    assertTrue(shadowOf(n.contentIntent).flags and android.app.PendingIntent.FLAG_IMMUTABLE != 0)
    assertTrue(shadowOf(n.contentIntent).savedIntent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID) == "w1")
    assertEquals(now, shadowOf(n.contentIntent).savedIntent.getLongExtra(WorkoutStatusNotifier.EXTRA_NONCE, 0))
    assertTrue(shadowOf(n.deleteIntent).flags and android.app.PendingIntent.FLAG_IMMUTABLE != 0)
  }

  @Test fun `without a launcher activity it still posts, just without a tap target`() {
    shadowOf(context.packageManager).removeResolveInfosForIntent(
      Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName),
      context.packageName,
    )
    assertNull(WorkoutStatusNotifier.build(context, resting, now, promote = false).contentIntent)
  }

  @Test fun `the promotion request is made only when asked for`() {
    val plain = WorkoutStatusNotifier.build(context, resting, now, promote = false)
    assertFalse(plain.extras.containsKey("android.requestPromotedOngoing"))
    val promoted = WorkoutStatusNotifier.build(context, resting, now, promote = true)
    assertTrue(promoted.extras.getBoolean("android.requestPromotedOngoing"))
  }

  @Test fun `its channel is low importance with no sound or vibration`() {
    assertTrue(WorkoutStatusNotifier.post(context, resting, now))
    val channel = context.getSystemService(NotificationManager::class.java)
      .getNotificationChannel(WorkoutStatusNotifier.CHANNEL_ID)
    assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
    assertNull(channel.sound)
    assertFalse(channel.shouldVibrate())
  }

  @Test fun `a rest sets an alarm at its end, and the alarm reposts it as rest over`() {
    assertTrue(WorkoutStatusNotifier.post(context, resting, now))
    assertEquals(
      now + 90_000,
      shadowOf(context.getSystemService(AlarmManager::class.java)).nextScheduledAlarm?.triggerAtTime,
    )
    assertTrue(posted()!!.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    WorkoutStatusNotifier.repostStored(context)
    val after = posted()!!
    assertEquals("Rest over, next · Set 3 of 4 · 80 kg × 8", after.extras.getString(Notification.EXTRA_TEXT))
    assertFalse(after.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
  }

  @Test fun `a status that is not resting sets no alarm, and an update cancels the last one`() {
    WorkoutStatusNotifier.post(context, resting, now)
    WorkoutStatusNotifier.post(context, resting.copy(phase = "working", restEndsAt = null), now)
    assertNull(shadowOf(context.getSystemService(AlarmManager::class.java)).nextScheduledAlarm)
  }

  @Test fun `clear removes the notification and the alarm`() {
    WorkoutStatusNotifier.post(context, resting, now)
    WorkoutStatusNotifier.clear(context)
    assertNull(posted())
    assertNull(shadowOf(context.getSystemService(AlarmManager::class.java)).nextScheduledAlarm)
    WorkoutStatusNotifier.repostStored(context)
    assertNull(posted())
  }

  @Test fun `a dismissed workout is not posted again, a stale one is cleared`() {
    WorkoutStatusNotifier.post(context, resting, now)
    WorkoutStatusNotifier.rememberDismissed(context, "w1")
    WorkoutStatusNotifier.clear(context)
    assertFalse(WorkoutStatusNotifier.post(context, resting, now))
    assertNull(posted())
    assertTrue(WorkoutStatusNotifier.post(context, resting.copy(workoutId = "w2"), now))
    val old = resting.copy(workoutId = "w3", startedAt = now - WorkoutStatusPolicy.MAX_AGE_MS - 1)
    assertFalse(WorkoutStatusNotifier.post(context, old, now))
    assertNull(posted())
  }

  @Test fun `a tap opens its workout once`() {
    assertEquals("w1", WorkoutStatusNotifier.consumeOpen(context, "w1", now))
    assertNull(WorkoutStatusNotifier.consumeOpen(context, "w1", now))
    assertNull(WorkoutStatusNotifier.consumeOpen(context, "w1", now - 5))
    assertEquals("w1", WorkoutStatusNotifier.consumeOpen(context, "w1", now + 5))
    assertNull(WorkoutStatusNotifier.consumeOpen(context, null, now + 10))
  }

  @Test fun `the promotion report says what was posted`() {
    assertFalse(WorkoutStatusNotifier.promotionReport(context)["posted"] as Boolean)
    WorkoutStatusNotifier.post(context, resting, now)
    val report = WorkoutStatusNotifier.promotionReport(context)
    assertEquals(true, report["posted"])
    assertEquals(false, report["promoted"])
    assertEquals(0, report["sdkFull"])
  }
}
