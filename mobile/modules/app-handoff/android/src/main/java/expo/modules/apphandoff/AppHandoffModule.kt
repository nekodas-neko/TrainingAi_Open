package expo.modules.apphandoff

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Opens another app for a moment, then brings TrainingAi's own task back to the front (#2896).
// Android has no "start an app hidden" call, so the other app shows briefly. Coming back is a
// background activity start, which Android 10+ restricts; the result says whether it worked and
// how, so the behaviour can be settled on the owner's phone.
class AppHandoffModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var foreground = true
  @Volatile private var running = false

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("AppHandoff")

    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false }
    // Drops the pending hand-back steps so none runs against a torn-down module.
    OnDestroy {
      handler.removeCallbacksAndMessages(null)
      running = false
    }

    Function("isInstalled") { packageName: String ->
      context.packageManager.getLaunchIntentForPackage(packageName) != null
    }

    Function("canDrawOverlays") {
      Settings.canDrawOverlays(context)
    }

    Function("openOverlaySettings") {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("openAppBriefly") { packageName: String, handBackMs: Int, promise: Promise ->
      handler.post { start(packageName, handBackMs, promise) }
    }
  }

  private fun start(packageName: String, handBackMs: Int, promise: Promise) {
    val begun = SystemClock.elapsedRealtime()
    val react = appContext.reactContext
    val overlay = react?.let { Settings.canDrawOverlays(it) } ?: false
    fun result(outcome: String, method: String?, error: String?) = mapOf(
      "outcome" to outcome,
      "method" to method,
      "overlayGranted" to overlay,
      "elapsedMs" to (SystemClock.elapsedRealtime() - begun).toDouble(),
      "error" to error,
    )
    // Answers a call that never took the guard, so the hand-off already in flight keeps it.
    fun refuse(outcome: String, error: String? = null) = promise.resolve(result(outcome, null, error))
    if (running) return refuse("busy")
    if (react == null) return refuse("launch_failed", "The app context is not available.")
    // The decision to hand off waits on network checks; by then the user may have left the app.
    // Starting Oura from behind would pull TrainingAi back over whatever they are doing.
    val activity = appContext.currentActivity
    if (!foreground || activity == null) return refuse("not_foreground")
    val launch = react.packageManager.getLaunchIntentForPackage(packageName)
      ?: return refuse("not_installed")
    val taskId = activity.taskId
    running = true
    fun finish(outcome: String, method: String? = null, error: String? = null) {
      running = false
      promise.resolve(result(outcome, method, error))
    }
    try {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
      activity.startActivity(launch)
    } catch (cause: Exception) {
      return finish("launch_failed", error = cause.message)
    }
    handler.postDelayed({
      if (foreground) return@postDelayed finish("never_left")
      // A dev reload can tear the React context down while Oura is in front.
      val current = appContext.reactContext
        ?: return@postDelayed finish("stayed_behind", error = "The app context went away.")
      val moved = try {
        val manager = current.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        manager.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_NO_USER_ACTION)
        true
      } catch (cause: Exception) {
        false
      }
      handler.postDelayed({
        if (moved && foreground) return@postDelayed finish("returned", "moveTaskToFront")
        try {
          val own = appContext.reactContext?.let { ctx ->
            ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.also {
              it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
              ctx.startActivity(it)
            }
          }
          if (own == null) return@postDelayed finish("stayed_behind", error = "No launch intent.")
        } catch (cause: Exception) {
          return@postDelayed finish("stayed_behind", error = cause.message)
        }
        handler.postDelayed({
          if (foreground) finish("returned", "launchIntent") else finish("stayed_behind")
        }, CONFIRM_MS)
      }, CONFIRM_MS)
    }, handBackMs.toLong().coerceIn(MIN_HAND_BACK_MS, MAX_HAND_BACK_MS))
  }

  companion object {
    private const val CONFIRM_MS = 700L
    private const val MIN_HAND_BACK_MS = 250L
    private const val MAX_HAND_BACK_MS = 15_000L
  }
}
