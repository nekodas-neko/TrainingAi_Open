package expo.modules.homewidgets

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's side of the home-screen widgets (#3268). JS writes the snapshot whenever the local data
// behind it changes (WidgetSync); the widgets read only that, so they work with the app closed and
// never need the session cookie (#2190). The widgets hand work back the other way through here:
// the water taps they queued, and the screen a tap asked for.
class HomeWidgetsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    // A widget tap while the app was already running arrives as a new intent.
    OnNewIntent { intent ->
      LaunchInbox.shared.capture(intent.getStringExtra(LaunchInbox.EXTRA))
    }

    Function("writeSnapshot") { json: String ->
      WidgetStore.write(context, json)
      WidgetRefresh.refreshAll(context)
    }

    // When no account is signed in any more (AccountSession.clearAccountData).
    Function("clearSnapshot") {
      WidgetStore.clear(context)
      WidgetRefresh.refreshAll(context)
    }

    Function("peekPending") {
      PendingWater.toJson(WidgetStore.pending(context))
    }

    // No redraw: the widget keeps showing the tap until the snapshot that includes it lands, so the
    // number never dips back in between.
    Function("ackPending") { ids: List<String> ->
      WidgetStore.ackPending(context, ids)
    }

    // Once: the extra is removed from the launch intent so a later foreground does not repeat it.
    Function("takeLaunchTarget") {
      val intent = appContext.currentActivity?.intent
      val fromLaunch = intent?.getStringExtra(LaunchInbox.EXTRA)
      if (fromLaunch != null) intent?.removeExtra(LaunchInbox.EXTRA)
      LaunchInbox.shared.take(fromLaunch)
    }
  }
}
