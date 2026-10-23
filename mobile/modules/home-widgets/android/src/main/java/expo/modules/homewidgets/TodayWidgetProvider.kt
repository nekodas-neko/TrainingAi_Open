package expo.modules.homewidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

// The Today widget: Home's four scores, from the last snapshot. A tap opens the app. The widget is
// redrawn by the app (refreshAll) or by the launcher, and each time it re-reads the snapshot, so a
// change of dark or light mode picks the matching colours on the launcher's next redraw.
class TodayWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val snapshot = WidgetSnapshot.parseToday(WidgetStore.read(context))
    for (id in appWidgetIds) manager.updateAppWidget(id, render(context, snapshot))
  }

  private fun render(context: Context, snapshot: TodaySnapshot?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.home_widget_today)
    views.setOnClickPendingIntent(R.id.home_widget_root, openApp(context))
    if (snapshot == null || snapshot.scores.isEmpty()) {
      views.setViewVisibility(R.id.home_widget_scores, View.GONE)
      views.setViewVisibility(R.id.home_widget_empty, View.VISIBLE)
      views.setTextViewText(R.id.home_widget_updated, "")
      return views
    }
    val stale = WidgetSnapshot.isStale(snapshot, LocalDate.now().toString())
    views.setViewVisibility(R.id.home_widget_scores, View.VISIBLE)
    views.setViewVisibility(R.id.home_widget_empty, View.GONE)
    views.setTextViewText(
      R.id.home_widget_updated,
      if (stale) context.getString(R.string.home_widget_stale) else snapshot.updated,
    )
    val night = context.resources.configuration.uiMode and
      Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    SLOTS.forEachIndexed { i, slot ->
      val score = snapshot.scores.getOrNull(i)
      views.setViewVisibility(slot.cell, if (score == null) View.GONE else View.VISIBLE)
      if (score == null) return@forEachIndexed
      views.setTextViewText(slot.label, if (score.qualified) "${score.label} ⓘ" else score.label)
      views.setTextViewText(slot.value, if (stale) DASH else score.value ?: DASH)
      // A stale value is a dash in the text colour; the accent is only for today's numbers.
      val accent = (if (night) score.colorDark else score.colorLight)?.takeIf { !stale }
      views.setTextColor(
        slot.value,
        accent?.let(Color::parseColor) ?: context.getColor(R.color.home_widget_text),
      )
    }
    return views
  }

  private fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(
      context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private data class Slot(val cell: Int, val label: Int, val value: Int)

  companion object {
    private const val DASH = "–"
    private val SLOTS = listOf(
      Slot(R.id.home_widget_cell_0, R.id.home_widget_label_0, R.id.home_widget_value_0),
      Slot(R.id.home_widget_cell_1, R.id.home_widget_label_1, R.id.home_widget_value_1),
      Slot(R.id.home_widget_cell_2, R.id.home_widget_label_2, R.id.home_widget_value_2),
      Slot(R.id.home_widget_cell_3, R.id.home_widget_label_3, R.id.home_widget_value_3),
    )

    fun ids(context: Context): IntArray =
      AppWidgetManager.getInstance(context)
        .getAppWidgetIds(ComponentName(context, TodayWidgetProvider::class.java))

    /** Redraws every placed Today widget from the snapshot just written. */
    fun refreshAll(context: Context) {
      val ids = ids(context)
      if (ids.isEmpty()) return
      TodayWidgetProvider().onUpdate(context, AppWidgetManager.getInstance(context), ids)
    }
  }
}
