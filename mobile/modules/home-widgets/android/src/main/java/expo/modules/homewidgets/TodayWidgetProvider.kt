package expo.modules.homewidgets

import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews

// The Today widget: Home's four scores, 4 x 1; resized to 4 x 2 it adds Body Battery. A tap opens
// Home. Scores are only as fresh as the last time the app ran, so a snapshot from an earlier day
// shows dashes and "Open to update" instead of yesterday's numbers.
class TodayWidgetProvider : BaseWidgetProvider() {
  override fun render(context: Context, snapshot: Snapshot?, stale: Boolean, heightDp: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.home_widget_today)
    views.setOnClickPendingIntent(
      R.id.home_widget_root,
      WidgetRender.openApp(context, WidgetRender.REQ_TODAY, "home"),
    )
    if (snapshot == null || snapshot.scores.isEmpty()) {
      views.setViewVisibility(R.id.home_widget_scores, View.GONE)
      views.setViewVisibility(R.id.home_widget_battery, View.GONE)
      views.setViewVisibility(R.id.home_widget_empty, View.VISIBLE)
      views.setTextViewText(R.id.home_widget_empty, context.getString(R.string.home_widget_empty))
      views.setTextViewText(R.id.home_widget_updated, "")
      return views
    }
    views.setViewVisibility(R.id.home_widget_scores, View.VISIBLE)
    views.setViewVisibility(R.id.home_widget_empty, View.GONE)
    views.setTextViewText(
      R.id.home_widget_updated,
      if (stale) context.getString(R.string.home_widget_stale) else snapshot.updated,
    )
    val night = WidgetRender.isNight(context)
    SLOTS.forEachIndexed { i, slot ->
      val score = snapshot.scores.getOrNull(i)
      views.setViewVisibility(slot.cell, if (score == null) View.GONE else View.VISIBLE)
      if (score == null) return@forEachIndexed
      views.setTextViewText(slot.label, if (score.qualified) "${score.label} ⓘ" else score.label)
      views.setTextViewText(slot.value, if (stale) WidgetRender.DASH else score.value ?: WidgetRender.DASH)
      // A stale value is a dash in the text colour; the accent is only for today's numbers.
      val accent = (if (night) score.colorDark else score.colorLight)?.takeIf { !stale }
      views.setTextColor(slot.value, accent?.let(Color::parseColor) ?: context.getColor(R.color.home_widget_text))
    }
    renderBattery(context, views, snapshot.battery.takeIf { !stale }, heightDp)
    return views
  }

  private fun renderBattery(context: Context, views: RemoteViews, battery: WidgetBattery?, heightDp: Int) {
    val show = battery != null && heightDp >= TALL_DP
    views.setViewVisibility(R.id.home_widget_battery, if (show) View.VISIBLE else View.GONE)
    if (!show || battery == null) return
    views.setTextViewText(R.id.home_widget_battery_label, battery.label)
    views.setTextViewText(R.id.home_widget_battery_value, battery.value)
    for ((band, id) in BARS) {
      views.setViewVisibility(id, if (band == battery.band) View.VISIBLE else View.GONE)
    }
    BARS[battery.band]?.let { views.setProgressBar(it, 100, battery.level, false) }
  }

  private data class Slot(val cell: Int, val label: Int, val value: Int)

  private companion object {
    /** About the height of two home-screen cells; one cell is 60–90 dp tall. */
    const val TALL_DP = 110
    val SLOTS = listOf(
      Slot(R.id.home_widget_cell_0, R.id.home_widget_label_0, R.id.home_widget_value_0),
      Slot(R.id.home_widget_cell_1, R.id.home_widget_label_1, R.id.home_widget_value_1),
      Slot(R.id.home_widget_cell_2, R.id.home_widget_label_2, R.id.home_widget_value_2),
      Slot(R.id.home_widget_cell_3, R.id.home_widget_label_3, R.id.home_widget_value_3),
    )
    val BARS = mapOf(
      "good" to R.id.home_widget_battery_bar_good,
      "low" to R.id.home_widget_battery_bar_low,
      "drained" to R.id.home_widget_battery_bar_drained,
    )
  }
}
