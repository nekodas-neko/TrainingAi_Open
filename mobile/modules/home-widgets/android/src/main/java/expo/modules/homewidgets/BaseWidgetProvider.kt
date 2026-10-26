package expo.modules.homewidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import android.widget.RemoteViews

/**
 * Every widget draws the snapshot the app last wrote and nothing else (#3268). It is redrawn by the
 * app (WidgetRefresh.refreshAll), by the launcher, when it is resized, and when the day turns.
 */
abstract class BaseWidgetProvider : AppWidgetProvider() {
  /** `heightDp` is the widget's current minimum height, which decides what a tall widget adds. */
  internal abstract fun render(
    context: Context,
    snapshot: Snapshot?,
    stale: Boolean,
    heightDp: Int,
  ): RemoteViews

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val snapshot = WidgetSnapshot.parse(WidgetStore.read(context))
    val stale = snapshot != null && WidgetSnapshot.isStale(snapshot, WidgetRender.localToday())
    for (id in appWidgetIds) {
      val height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
      manager.updateAppWidget(id, render(context, snapshot, stale, height))
    }
    WidgetRefresh.scheduleMidnight(context)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    onUpdate(context, manager, intArrayOf(appWidgetId))
  }

  override fun onEnabled(context: Context) {
    WidgetRefresh.scheduleMidnight(context)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    if (!WidgetRefresh.hasWidgets(context)) WidgetRefresh.cancelMidnight(context)
  }

  override fun onDisabled(context: Context) {
    if (!WidgetRefresh.hasWidgets(context)) WidgetRefresh.cancelMidnight(context)
  }
}
