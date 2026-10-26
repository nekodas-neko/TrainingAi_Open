package expo.modules.workoutstatus

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The workout's ongoing notification, promoted to an Android 16 Live Update where the phone and the
// user's settings allow it (#3249). JS drives it from the journal; this module holds no workout
// state of its own beyond which workout the user dismissed and the last status, kept for the
// rest-end repost. Nothing here throws into JS: without an app context a call simply does nothing.
class WorkoutStatusModule : Module() {
  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("WorkoutStatus")
    Events("onOpen")

    // Both replace the notification in place; the two names keep JS's intent readable.
    Function("show") { status: Map<String, Any?> -> post(status) }
    Function("update") { status: Map<String, Any?> -> post(status) }
    Function("clear") {
      val ctx = context
      if (ctx != null) WorkoutStatusNotifier.clear(ctx)
    }

    // What the system did with it, for the once-per-start diagnostic.
    Function("promotion") {
      val ctx = context
      if (ctx != null) WorkoutStatusNotifier.promotionReport(ctx) else emptyMap<String, Any?>()
    }

    // A tap while the app is running arrives as a new intent; one that started the app is read here.
    OnNewIntent { intent ->
      val ctx = context ?: return@OnNewIntent
      val id = intent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      val nonce = intent.getLongExtra(WorkoutStatusNotifier.EXTRA_NONCE, 0)
      val resume = intent.getBooleanExtra(WorkoutStatusNotifier.EXTRA_RESUME, false)
      intent.removeExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      intent.removeExtra(WorkoutStatusNotifier.EXTRA_RESUME)
      WorkoutStatusNotifier.consumeOpen(ctx, id, nonce)
        ?.let { sendEvent("onOpen", mapOf("workoutId" to it, "resume" to resume)) }
    }
    Function("takeOpenRequest") {
      val ctx = context ?: return@Function null
      val intent = appContext.currentActivity?.intent ?: return@Function null
      val id = intent.getStringExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      val nonce = intent.getLongExtra(WorkoutStatusNotifier.EXTRA_NONCE, 0)
      val resume = intent.getBooleanExtra(WorkoutStatusNotifier.EXTRA_RESUME, false)
      intent.removeExtra(WorkoutStatusNotifier.EXTRA_WORKOUT_ID)
      intent.removeExtra(WorkoutStatusNotifier.EXTRA_RESUME)
      WorkoutStatusNotifier.consumeOpen(ctx, id, nonce)?.let { mapOf("workoutId" to it, "resume" to resume) }
    }
  }

  private fun post(status: Map<String, Any?>): Boolean {
    val ctx = context ?: return false
    val parsed = WorkoutStatusPresenter.fromMap(status) ?: return false
    return WorkoutStatusNotifier.post(ctx, parsed, System.currentTimeMillis())
  }
}
