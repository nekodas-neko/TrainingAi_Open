package expo.modules.workoutstatus

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The workout's ongoing notification, promoted to an Android 16 Live Update where the phone and the
// user's settings allow it (#3249). JS drives it from the journal; this module holds no workout
// state of its own beyond which workout the user dismissed.
class WorkoutStatusModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("WorkoutStatus")
    Events("onOpen")

    // Both replace the notification in place; the two names keep JS's intent readable.
    Function("show") { status: Map<String, Any?> -> post(status) }
    Function("update") { status: Map<String, Any?> -> post(status) }
    Function("clear") { WorkoutStatusNotifier.clear(context) }

    // A tap while the app is running arrives as a new intent; one that started the app is read here.
    OnNewIntent { intent ->
      intent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)?.let { id ->
        intent.removeExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
        sendEvent("onOpen", mapOf("workoutId" to id))
      }
    }
    Function("takeOpenRequest") {
      val intent = appContext.currentActivity?.intent ?: return@Function null
      val id = intent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      intent.removeExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      id
    }
  }

  private fun post(status: Map<String, Any?>): Boolean {
    val parsed = WorkoutStatusPresenter.fromMap(status) ?: return false
    return WorkoutStatusNotifier.post(context, parsed, System.currentTimeMillis())
  }
}
