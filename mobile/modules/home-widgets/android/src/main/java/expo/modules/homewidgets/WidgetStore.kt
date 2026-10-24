package expo.modules.homewidgets

import android.content.Context

/** The snapshot, kept in the app's own SharedPreferences so the widget can draw it after a reboot. */
internal object WidgetStore {
  private const val PREFS = "trainingai_home_widgets"
  private const val KEY = "snapshot"

  fun write(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }
}
