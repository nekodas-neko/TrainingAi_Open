package expo.modules.workoutstatus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Runs when the user swipes the notification away. The workout's id is kept so the app's next
// update for the same workout does not put it back (#2846: respect dismissal).
class WorkoutStatusDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID) ?: return
    WorkoutStatusNotifier.rememberDismissed(context, id)
  }
}
