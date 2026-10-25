package expo.modules.homewidgets

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import java.time.LocalDate

/** What every widget needs to draw itself. */
internal object WidgetRender {
  const val DASH = "–"

  /** The phone's dark or light mode; a widget has no app theme of its own to follow. */
  fun isNight(context: Context): Boolean =
    context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
      Configuration.UI_MODE_NIGHT_YES

  /** The date on the phone's clock, the same one the snapshot's date is compared with. */
  fun localToday(): String = LocalDate.now().toString()

  /**
   * Opens the app, asking it to go to `target` (src/features/widgets/launch-target.ts). Each target
   * has its own request code, because two PendingIntents that differ only in extras are one.
   * The target travels as an extra, never as a link: the app treats links on its own scheme as a
   * sign-in return.
   */
  fun openApp(context: Context, requestCode: Int, target: String): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.putExtra(LaunchInbox.EXTRA, target)
    return PendingIntent.getActivity(
      context,
      requestCode,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun sendBroadcast(context: Context, requestCode: Int, intent: Intent): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /** Request codes, one per tap target. */
  const val REQ_TODAY = 1
  const val REQ_NEXT_ROOT = 10
  const val REQ_NEXT_START = 11
  const val REQ_NEXT_SESSIONS = 12
  const val REQ_NUTRITION = 20
  const val REQ_ADD_WATER = 21
}
