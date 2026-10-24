package expo.modules.pictureinpicture

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.ViewGroup
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Picture-in-picture for an active workout (#3064), ported from the current app's MainActivity:
// the same 3:4 window, entered from onUserLeaveHint, and the same buttons per phase. JS reports
// the phase whenever the workout screen changes it and sends "idle" when the screen closes, so
// leaving the app with no workout open never shrinks it into a window (#2908).
//
// The window's content is a native view (PipWindowView) laid over the app while in PiP. React
// Native stops applying UI updates while the activity is paused, and an activity in PiP is paused,
// so a React-drawn window would freeze on its first frame. JS keeps the view's data current through
// setPhase, sending the workout status payload the ongoing notification also reads (#3266); the
// view's own Chronometers keep its clocks running.
class PictureInPictureModule : Module() {
  @Volatile private var phase = PipPolicy.IDLE
  @Volatile private var status: PipStatus? = null
  @Volatile private var setColor: String? = null
  private var windowView: PipWindowView? = null
  private var receiverRegistered = false
  private var watched: OnPictureInPictureModeChangedProvider? = null
  private var inPip = false
  private val main = Handler(Looper.getMainLooper())

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
      val action = ACTIONS[intent.action] ?: return
      sendEvent("onAction", mapOf("action" to action))
    }
  }

  private val modeListener = Consumer<PictureInPictureModeChangedInfo> { info ->
    report(info.isInPictureInPictureMode)
  }

  override fun definition() = ModuleDefinition {
    Name("PictureInPicture")
    Events("onModeChange", "onAction")

    Function("isAvailable") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    Function("setPhase") { next: String, payload: Map<String, Any?>?, color: String? ->
      phase = next
      // Kept for any phase: one that cannot open the window can still arrive while it is open,
      // such as "done" after Next on the last exercise, and the window must not go blank.
      status = PipPresenter.fromMap(payload)
      setColor = PipPresenter.color(color)
      main.post { windowView?.render() }
      val activity = appContext.currentActivity ?: return@Function
      watch(activity)
      activity.runOnUiThread {
        // Keeps the buttons of an open window in step with the workout, as AndroidPip.updatePhase did.
        params(activity, next)?.let { runCatching { activity.setPictureInPictureParams(it) } }
      }
    }

    OnCreate {
      val filter = IntentFilter().apply { ACTIONS.keys.forEach { addAction(it) } }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        context.registerReceiver(receiver, filter)
      }
      receiverRegistered = true
    }

    OnDestroy {
      if (receiverRegistered) runCatching { context.unregisterReceiver(receiver) }
      receiverRegistered = false
      watched?.removeOnPictureInPictureModeChangedListener(modeListener)
      watched = null
      inPip = false
      main.post { removeWindow() }
    }

    OnActivityEntersForeground {
      appContext.currentActivity?.let {
        watch(it)
        report(Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && it.isInPictureInPictureMode)
      }
    }

    OnUserLeavesActivity {
      val activity = appContext.currentActivity ?: return@OnUserLeavesActivity
      if (!PipPolicy.isActivePhase(phase)) return@OnUserLeavesActivity
      val params = params(activity, phase) ?: return@OnUserLeavesActivity
      watch(activity)
      if (runCatching { activity.enterPictureInPictureMode(params) }.getOrDefault(false)) report(true)
    }
  }

  private fun watch(activity: Activity) {
    val provider = activity as? OnPictureInPictureModeChangedProvider ?: return
    if (provider === watched) return
    watched?.removeOnPictureInPictureModeChangedListener(modeListener)
    provider.addOnPictureInPictureModeChangedListener(modeListener)
    watched = provider
  }

  private fun report(active: Boolean) {
    if (active == inPip) return
    inPip = active
    sendEvent("onModeChange", mapOf("active" to active))
    if (active) {
      showWindow()
    } else {
      removeWindow()
    }
  }

  private fun showWindow() {
    val activity = appContext.currentActivity ?: return
    val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
    val view = windowView
      ?: PipWindowView(activity) { now -> PipPresenter.present(phase, status, setColor, now) }
        .also { windowView = it }
    if (view.parent !== content) {
      (view.parent as? ViewGroup)?.removeView(view)
      content.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    view.bringToFront()
    view.render()
  }

  private fun removeWindow() {
    val view = windowView ?: return
    (view.parent as? ViewGroup)?.removeView(view)
    windowView = null
  }

  private fun params(activity: Activity, phase: String): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return PictureInPictureParams.Builder()
      .setAspectRatio(Rational(3, 4))
      .setActions(actions(activity, phase))
      .build()
  }

  // MainActivity.buildActions: at most three visible (the Android and Samsung limit).
  private fun actions(activity: Activity, phase: String): List<RemoteAction> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
    fun action(name: String, icon: Int, label: String, code: Int): RemoteAction {
      val intent = Intent(name).setPackage(activity.packageName)
      val pending = PendingIntent.getBroadcast(
        activity, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return RemoteAction(Icon.createWithResource(activity, icon), label, label, pending)
    }
    return when (phase) {
      "set" -> listOf(
        action(REPS_DOWN, R.drawable.pip_minus, "Reps -", 1),
        action(REPS_UP, R.drawable.pip_plus, "Reps +", 3),
        action(LOG, R.drawable.pip_log, "Log", 2),
      )
      "rest" -> listOf(action(LOG, R.drawable.pip_start, "Start Set", 2))
      "complete" -> listOf(action(LOG, R.drawable.pip_log, "Complete", 2))
      "summary" -> listOf(action(LOG, R.drawable.pip_start, "Next", 2))
      else -> emptyList()
    }
  }

  companion object {
    private const val REPS_DOWN = "com.trainingai.pip.REPS_DOWN"
    private const val REPS_UP = "com.trainingai.pip.REPS_UP"
    private const val LOG = "com.trainingai.pip.LOG"
    private val ACTIONS = mapOf(REPS_DOWN to "repsDown", REPS_UP to "repsUp", LOG to "log")
  }
}
