package expo.modules.homewidgets

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

// The Nutrition and water widget: calories and macros left, and water against the goal, as the
// app words them. The +250 ml button works with the app closed: it queues the tap on the phone
// (WaterTapReceiver) and redraws at once; the app records it the next time it runs.
class NutritionWidgetProvider : BaseWidgetProvider() {
  override fun render(context: Context, snapshot: Snapshot?, stale: Boolean, heightDp: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.home_widget_nutrition)
    views.setOnClickPendingIntent(
      R.id.home_widget_root,
      WidgetRender.openApp(context, WidgetRender.REQ_NUTRITION, "nutrition"),
    )
    val nutrition = snapshot?.nutrition
    if (snapshot == null || nutrition == null) {
      views.setViewVisibility(R.id.home_widget_nutrition_body, View.GONE)
      views.setViewVisibility(R.id.home_widget_empty, View.VISIBLE)
      views.setTextViewText(R.id.home_widget_empty, context.getString(R.string.home_widget_empty))
      views.setTextViewText(R.id.home_widget_updated, "")
      return views
    }
    views.setViewVisibility(R.id.home_widget_nutrition_body, View.VISIBLE)
    views.setViewVisibility(R.id.home_widget_empty, View.GONE)
    views.setTextViewText(
      R.id.home_widget_updated,
      if (stale) context.getString(R.string.home_widget_stale) else context.getString(R.string.home_widget_nutrition_subtitle),
    )
    // Yesterday's calories and macros are never shown as today's.
    val shown = if (stale) null else nutrition
    views.setTextViewText(R.id.home_widget_kcal_value, shown?.kcalValue ?: WidgetRender.DASH)
    views.setTextViewText(R.id.home_widget_kcal_label, shown?.kcalLabel ?: "")
    for (slot in MACROS) {
      val macro = shown?.macros?.firstOrNull { it.key == slot.key }
      views.setTextViewText(slot.label, macro?.label ?: slot.fallback)
      views.setTextViewText(slot.left, macro?.left ?: WidgetRender.DASH)
      views.setProgressBar(slot.bar, 100, percent(macro?.fraction), false)
    }
    renderWater(context, views, snapshot, nutrition.water, stale)
    return views
  }

  private fun renderWater(context: Context, views: RemoteViews, snapshot: Snapshot, water: WidgetWater?, stale: Boolean) {
    if (water == null || water.tapMl <= 0) {
      views.setTextViewText(R.id.home_widget_water_text, WidgetRender.DASH)
      views.setProgressBar(R.id.home_widget_water_bar, 100, 0, false)
      views.setViewVisibility(R.id.home_widget_add_water, View.GONE)
      return
    }
    val taps = WidgetStore.pending(context)
    if (stale) {
      // The total on file is from an earlier day; say so, and show only the taps made since.
      val queued = PendingWater.waiting(taps, snapshot.user, WidgetRender.localToday()) * water.tapMl
      views.setTextViewText(
        R.id.home_widget_water_text,
        if (queued > 0) context.getString(R.string.home_widget_water_queued, queued) else context.getString(R.string.home_widget_stale),
      )
      views.setProgressBar(R.id.home_widget_water_bar, 100, 0, false)
    } else {
      val step = WidgetSnapshot.waterStep(water, PendingWater.waiting(taps, snapshot.user, snapshot.date))
      views.setTextViewText(
        R.id.home_widget_water_text,
        listOfNotNull(step?.text, water.goal).joinToString(" · "),
      )
      views.setProgressBar(R.id.home_widget_water_bar, 100, percent(step?.fraction), false)
    }
    views.setViewVisibility(R.id.home_widget_add_water, View.VISIBLE)
    views.setOnClickPendingIntent(
      R.id.home_widget_add_water,
      WidgetRender.sendBroadcast(
        context,
        WidgetRender.REQ_ADD_WATER,
        Intent(context, WaterTapReceiver::class.java).setAction(WaterTapReceiver.ACTION_ADD_WATER),
      ),
    )
  }

  private fun percent(fraction: Double?): Int = ((fraction ?: 0.0) * 100).toInt().coerceIn(0, 100)

  private data class MacroSlot(val key: String, val fallback: String, val label: Int, val left: Int, val bar: Int)

  private companion object {
    val MACROS = listOf(
      MacroSlot("protein", "Protein", R.id.home_widget_protein_label, R.id.home_widget_protein_left, R.id.home_widget_protein_bar),
      MacroSlot("carbs", "Carbs", R.id.home_widget_carbs_label, R.id.home_widget_carbs_left, R.id.home_widget_carbs_bar),
      MacroSlot("fat", "Fat", R.id.home_widget_fat_label, R.id.home_widget_fat_left, R.id.home_widget_fat_bar),
    )
  }
}
