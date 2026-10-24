package expo.modules.workoutstatus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Fires at a rest's end, when nothing else is running: the system chronometer would otherwise go
// negative and the chip lose its text. It reposts the last status, which now reads "Rest over".
class WorkoutStatusRestEndReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    runCatching { WorkoutStatusNotifier.repostStored(context) }
  }
}
