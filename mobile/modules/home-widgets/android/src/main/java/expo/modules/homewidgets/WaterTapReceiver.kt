package expo.modules.homewidgets

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.UUID

/**
 * The widget's +250 ml button. The app may be closed, so the tap is queued on the phone and the
 * widget redrawn at once; the app records it in its own store the next time it runs
 * (src/features/widgets/pending-water.ts). The amount and the account come from the snapshot the
 * widget is showing, so a tap can never belong to someone who is signed out.
 */
class WaterTapReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_ADD_WATER) return
    val snapshot = WidgetSnapshot.parse(WidgetStore.read(context)) ?: return
    val tapMl = snapshot.nutrition?.water?.tapMl ?: return
    if (tapMl <= 0) return
    WidgetStore.addPending(
      context,
      WaterTap(
        id = UUID.randomUUID().toString(),
        ml = tapMl,
        at = System.currentTimeMillis(),
        date = WidgetSnapshot.today(snapshot),
        user = snapshot.user,
      ),
    )
    WidgetRefresh.refreshAll(context)
  }

  companion object {
    const val ACTION_ADD_WATER = "expo.modules.homewidgets.ADD_WATER"
  }
}
