package expo.modules.homewidgets

/**
 * Where a widget tap asked the app to go. A target is handed over once: the app takes it when it
 * starts and each time it comes to the front. Android delivers it as an extra on the launch intent
 * (cold start) or on a new intent (the app was already running).
 */
internal class LaunchInbox {
  private var captured: String? = null

  /** A target from a new intent, which is newer than whatever the launch intent still carries. */
  @Synchronized
  fun capture(target: String?) {
    if (!target.isNullOrBlank()) captured = target
  }

  /** The newest target not yet taken, or null. */
  @Synchronized
  fun take(fromLaunchIntent: String?): String? {
    val target = captured ?: fromLaunchIntent?.takeIf { it.isNotBlank() }
    captured = null
    return target
  }

  companion object {
    /** The intent extra the widgets put the target in. */
    const val EXTRA = "widgetTarget"
    val shared = LaunchInbox()
  }
}
