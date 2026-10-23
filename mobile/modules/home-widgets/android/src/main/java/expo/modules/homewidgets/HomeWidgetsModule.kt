package expo.modules.homewidgets

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's side of the home-screen widgets. JS writes the snapshot whenever the local data behind
// it changes; the widget reads only that, so it works with the app closed and never needs the
// session cookie (#2190).
class HomeWidgetsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    Function("setSnapshot") { json: String ->
      WidgetStore.write(context, json)
      TodayWidgetProvider.refreshAll(context)
    }

    Function("installedCount") {
      TodayWidgetProvider.ids(context).size
    }
  }
}
