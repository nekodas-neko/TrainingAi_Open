package expo.modules.homewidgets

import android.content.Context
import android.view.View
import android.widget.RemoteViews

// The Next workout widget: the card Home shows as "Recommended Today", worded by the same code.
// Start opens that session; Sessions opens the Workout tab. A rest day is shown as Home shows it,
// with "Train instead" (Home's override) in place of Sessions; a check-in has no Start. Yesterday's recommendation is never shown as today's.
class NextWorkoutWidgetProvider : BaseWidgetProvider() {
  override fun render(context: Context, snapshot: Snapshot?, stale: Boolean, heightDp: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.home_widget_next)
    views.setOnClickPendingIntent(
      R.id.home_widget_root,
      WidgetRender.openApp(context, WidgetRender.REQ_NEXT_ROOT, "home"),
    )
    val next = snapshot?.next
    if (snapshot == null || next == null || stale) {
      views.setViewVisibility(R.id.home_widget_next_body, View.GONE)
      views.setViewVisibility(R.id.home_widget_empty, View.VISIBLE)
      views.setTextViewText(
        R.id.home_widget_empty,
        context.getString(if (snapshot == null) R.string.home_widget_empty else R.string.home_widget_stale),
      )
      views.setTextViewText(R.id.home_widget_eyebrow, context.getString(R.string.home_widget_next_label))
      views.setTextViewText(R.id.home_widget_updated, "")
      return views
    }
    views.setViewVisibility(R.id.home_widget_next_body, View.VISIBLE)
    views.setViewVisibility(R.id.home_widget_empty, View.GONE)
    views.setTextViewText(R.id.home_widget_eyebrow, next.eyebrow)
    views.setTextViewText(R.id.home_widget_updated, snapshot.updated)
    views.setTextViewText(R.id.home_widget_name, next.name)
    views.setTextViewText(R.id.home_widget_meta, next.meta)

    // Start for a session, Check in for the readiness card; a rest day or a finished or running
    // workout has only Sessions.
    val checkIn = next.sessionId == null && !next.restDay
    val primary = when {
      next.startable -> "next-session:${next.sessionId}" to R.string.home_widget_start
      checkIn -> "home" to R.string.home_widget_checkin
      else -> null
    }
    if (primary == null) {
      views.setViewVisibility(R.id.home_widget_primary, View.GONE)
    } else {
      views.setViewVisibility(R.id.home_widget_primary, View.VISIBLE)
      views.setTextViewText(R.id.home_widget_primary, context.getString(primary.second))
      views.setOnClickPendingIntent(
        R.id.home_widget_primary,
        WidgetRender.openApp(context, WidgetRender.REQ_NEXT_START, primary.first),
      )
    }
    views.setViewVisibility(R.id.home_widget_secondary, if (checkIn) View.GONE else View.VISIBLE)
    views.setTextViewText(
      R.id.home_widget_secondary,
      context.getString(if (next.restDay) R.string.home_widget_train_instead else R.string.home_widget_sessions),
    )
    views.setOnClickPendingIntent(
      R.id.home_widget_secondary,
      WidgetRender.openApp(
        context,
        WidgetRender.REQ_NEXT_SESSIONS,
        if (next.restDay) "train-instead" else "workout",
      ),
    )
    return views
  }
}
