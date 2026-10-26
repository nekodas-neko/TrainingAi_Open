package expo.modules.homewidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import java.time.ZoneId

/** Redraws the placed widgets, and arranges for them to be redrawn when the day turns. */
internal object WidgetRefresh {
  const val ACTION_MIDNIGHT = "expo.modules.homewidgets.MIDNIGHT"
  private const val MIDNIGHT_REQUEST = 7001

  private val providers: List<Class<out BaseWidgetProvider>> = listOf(
    TodayWidgetProvider::class.java,
    NextWorkoutWidgetProvider::class.java,
    NutritionWidgetProvider::class.java,
  )

  private fun ids(context: Context, provider: Class<out BaseWidgetProvider>): IntArray =
    AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider))

  fun hasWidgets(context: Context): Boolean = providers.any { ids(context, it).isNotEmpty() }

  /** Redraws every placed widget from the snapshot as it now stands. */
  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (provider in providers) {
      val ids = ids(context, provider)
      if (ids.isNotEmpty()) provider.getDeclaredConstructor().newInstance().onUpdate(context, manager, ids)
    }
  }

  private fun midnightIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      MIDNIGHT_REQUEST,
      Intent(context, WidgetRefreshReceiver::class.java).setAction(ACTION_MIDNIGHT),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /**
   * An inexact alarm, so it needs no exact-alarm permission and Android may move it a little: the
   * widget then turns to "Open to update" a few minutes late at worst. It re-arms itself each time.
   */
  fun scheduleMidnight(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarms.set(
      AlarmManager.RTC,
      MidnightClock.nextMillis(System.currentTimeMillis(), ZoneId.systemDefault()),
      midnightIntent(context),
    )
  }

  fun cancelMidnight(context: Context) {
    (context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)?.cancel(midnightIntent(context))
  }
}
