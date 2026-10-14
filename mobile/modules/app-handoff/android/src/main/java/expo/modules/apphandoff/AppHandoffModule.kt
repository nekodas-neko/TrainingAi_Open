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
    val overlay = Settings.canDrawOverlays(context)
    fun finish(outcome: String, method: String? = null, error: String? = null) {
      running = false
      promise.resolve(
        mapOf(
          "outcome" to outcome,
          "method" to method,
          "overlayGranted" to overlay,
          "elapsedMs" to (SystemClock.elapsedRealtime() - begun).toDouble(),
          "error" to error,
        ),
      )
    }
    if (running) return finish("busy")
    val launch = context.packageManager.getLaunchIntentForPackage(packageName)
      ?: return finish("not_installed")
    val activity = appContext.currentActivity
    val taskId = activity?.taskId
    running = true
    try {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
      (activity ?: context).startActivity(launch)
    } catch (cause: Exception) {
      return finish("launch_failed", error = cause.message)
    }
    handler.postDelayed({
      if (foreground) return@postDelayed finish("never_left")
      val moved = try {
        if (taskId == null) {
          false
        } else {
          val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
          manager.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_NO_USER_ACTION)
          true
        }
      } catch (cause: Exception) {
        false
      }
      handler.postDelayed({
        if (moved && foreground) return@postDelayed finish("returned", "moveTaskToFront")
        val own = context.packageManager.getLaunchIntentForPackage(context.packageName)
        try {
          own?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
          own?.let { context.startActivity(it) }
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
