package expo.modules.homewidgets

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's side of the home-screen widgets (#3268). JS writes the snapshot whenever the local data
// behind it changes (WidgetSync); a widget will read only that, so it works with the app closed and
// never needs the session cookie (#2190). No widget is registered yet, so nothing reads it today.
class HomeWidgetsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    Function("writeSnapshot") { json: String ->
      WidgetStore.write(context, json)
    }
  }
}
