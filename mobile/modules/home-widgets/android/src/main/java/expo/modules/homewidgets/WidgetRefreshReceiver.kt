package expo.modules.homewidgets

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The day turned, or the clock or time zone changed: every widget re-checks whether it is stale. */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    WidgetRefresh.refreshAll(context)
    if (WidgetRefresh.hasWidgets(context)) WidgetRefresh.scheduleMidnight(context)
  }
}
