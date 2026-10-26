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
import android.graphics.Rect
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

// Picture-in-picture for an active workout (#3064, #3266). JS reports the phase whenever the workout
// screen changes it and sends "idle" when the screen closes, so leaving the app with no workout open
// never shrinks it into a window (#2908). The window changes with the workout (the phase card): a
// 3:4 card while a set runs, a square for a rest or a pause, each with its own three buttons.
//
// While a set, a rest or a pause is on, the system enters the window itself (auto-enter), shrinking
// the screen into it from the on-screen card (the source rect JS reports). The other active phases
// still enter from onUserLeaveHint, as before.
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
  // Where the on-screen set card or rest ring is, in window pixels: the window shrinks out of it.
  @Volatile private var sourceRect: Rect? = null
  private var windowView: PipWindowView? = null
  private var receiverRegistered = false
  private var watched: OnPictureInPictureModeChangedProvider? = null
  private var inPip = false
  // The last params the system accepted (UI thread only); see pushParams.
  private var lastPushed: ParamsKey? = null
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
      main.post { runCatching { windowView?.render() } }
      val activity = appContext.currentActivity ?: return@Function
      watch(activity)
      pushParams(activity)
    }

    // The on-screen card the window shrinks out of, in dp from the window's top left, or nulls for
    // none. JS reports it on layout; it only shapes the animation, so a stale one is harmless.
    Function("setSourceRect") { left: Double?, top: Double?, right: Double?, bottom: Double? ->
      val density = context.resources.displayMetrics.density
      sourceRect = if (left == null || top == null || right == null || bottom == null) null else
        Rect((left * density).toInt(), (top * density).toInt(), (right * density).toInt(), (bottom * density).toInt())
          .takeIf { it.width() > 0 && it.height() > 0 }
      val activity = appContext.currentActivity ?: return@Function
      pushParams(activity)
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
        // Auto-enter is armed by the params; arm them for an activity that arrived after setPhase.
        if (PipPolicy.isActivePhase(phase)) pushParams(it)
        report(Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && it.isInPictureInPictureMode)
      }
    }

    OnUserLeavesActivity {
      val activity = appContext.currentActivity ?: return@OnUserLeavesActivity
      // From Android 12 the system enters the window itself for a set, a rest or a pause, shrinking
      // the screen into the on-screen card (the source rect). Entering here as well would pre-empt
      // that; pushParams has already armed auto-enter.
      if (!PipPolicy.entersOnLeave(phase, Build.VERSION.SDK_INT)) return@OnUserLeavesActivity
      val params = runCatching { params(activity, phase) }.getOrNull() ?: return@OnUserLeavesActivity
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
    // Called from the activity's own callbacks: a failure drawing the window must never take down
    // the workout behind it, so it leaves the window without our view rather than crashing.
    runCatching { if (active) showWindow() else removeWindow() }
      .onFailure { runCatching { removeWindow() } }
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

  /**
   * Keeps the shape, buttons and auto-enter of the window in step with the workout. The status
   * changes about once a second with a heart-rate strap, but the window's shape and buttons do not,
   * so a push whose params would be the same as the last one is skipped: rebuilding three
   * RemoteActions and calling the system every second is wasted work on the UI thread.
   */
  private fun pushParams(activity: Activity) {
    val current = phase
    activity.runOnUiThread {
      // Built on the UI thread by the framework's own classes; a failure must not crash the app.
      runCatching {
        val key = paramsKey(activity, current)
        if (key == lastPushed) return@runCatching
        params(activity, current)?.let {
          activity.setPictureInPictureParams(it)
          lastPushed = key
        }
      }
    }
  }

  /** Everything `params` reads: if none of it changed, the system already has these params. */
  private data class ParamsKey(
    val activity: Int,
    val phase: String,
    val aspect: Pair<Int, Int>,
    val buttons: List<Triple<String, String, String>>,
    val title: String?,
    val subtitle: String?,
    val sourceRect: Rect?,
  )

  private fun paramsKey(activity: Activity, phase: String) = ParamsKey(
    activity = System.identityHashCode(activity),
    phase = phase,
    aspect = PipPolicy.aspect(phase).let { it.first to it.second },
    buttons = PipPresenter.buttons(phase, status).map { Triple(it.action, it.icon, it.label) },
    title = PipPresenter.title(status),
    subtitle = PipPresenter.subtitle(phase, status),
    sourceRect = sourceRect?.let { Rect(it) },
  )

  private fun params(activity: Activity, phase: String): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val (width, height) = PipPolicy.aspect(phase)
    val builder = PictureInPictureParams.Builder()
      .setAspectRatio(Rational(width, height))
      .setActions(actions(activity, phase))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // The system enters on its own only while a set, a rest or a pause is on (#3266). The window
      // is not video, so it crossfades between shapes rather than resizing in place.
      builder.setAutoEnterEnabled(PipPolicy.autoEnters(phase))
      builder.setSeamlessResizeEnabled(false)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      PipPresenter.title(status)?.let { builder.setTitle(it) }
      PipPresenter.subtitle(phase, status)?.let { builder.setSubtitle(it) }
    }
    sourceRect?.let { builder.setSourceRectHint(it) }
    return builder.build()
  }

  // The buttons per phase come from PipPresenter.buttons: at most three, the Android and Samsung limit.
  private fun actions(activity: Activity, phase: String): List<RemoteAction> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
    return PipPresenter.buttons(phase, status).mapNotNull { button ->
      val name = INTENTS[button.action] ?: return@mapNotNull null
      val intent = Intent(name).setPackage(activity.packageName)
      val pending = PendingIntent.getBroadcast(
        activity,
        INTENTS.keys.indexOf(button.action) + 1,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      RemoteAction(Icon.createWithResource(activity, icon(button.icon)), button.label, button.label, pending)
    }
  }

  private fun icon(key: String) = when (key) {
    "minus" -> R.drawable.pip_minus
    "plus" -> R.drawable.pip_plus
    "plus30" -> R.drawable.pip_plus30
    "start" -> R.drawable.pip_start
    "pause" -> R.drawable.pip_pause
    "resume" -> R.drawable.pip_resume
    else -> R.drawable.pip_log
  }

  companion object {
    private const val REPS_DOWN = "com.trainingai.pip.REPS_DOWN"
    private const val REPS_UP = "com.trainingai.pip.REPS_UP"
    private const val LOG = "com.trainingai.pip.LOG"
    private const val REST_PLUS = "com.trainingai.pip.REST_PLUS"
    private const val PAUSE = "com.trainingai.pip.PAUSE"
    private const val RESUME = "com.trainingai.pip.RESUME"

    // The action JS is told, by the intent that carries it.
    private val INTENTS = linkedMapOf(
      "repsDown" to REPS_DOWN, "repsUp" to REPS_UP, "log" to LOG,
      "restPlus" to REST_PLUS, "pause" to PAUSE, "resume" to RESUME,
    )
    private val ACTIONS = INTENTS.entries.associate { (action, intent) -> intent to action }
  }
}
