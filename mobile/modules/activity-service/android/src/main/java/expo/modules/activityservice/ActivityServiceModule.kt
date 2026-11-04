package expo.modules.activityservice

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS's handle on the connected-device service (#3595, #3627) and the activity notification's clock
// (#3626). `start` resolves 'on', 'failed' or 'skipped' and never rejects; `stop` and `clear` are
// safe to call when nothing runs. A clock is two numbers, absent for none: the instant it counts
// from, and the frozen elapsed time while paused (see ActivityClock).
class ActivityServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ActivityService")

    AsyncFunction("start") { title: String, body: String, clockStartedAt: Double?, clockPausedMs: Double?, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("skipped")
      } else {
        val clock = ActivityServicePolicy.clock(clockStartedAt, clockPausedMs)
        ActivityServiceController.start(context, title, body, clock) { promise.resolve(it) }
      }
    }

    AsyncFunction("show") { title: String, body: String, clockStartedAt: Double?, clockPausedMs: Double? ->
      appContext.reactContext?.let {
        ActivityServiceController.show(it, title, body, ActivityServicePolicy.clock(clockStartedAt, clockPausedMs))
      }
    }

    AsyncFunction("clear") {
      appContext.reactContext?.let { ActivityServiceController.clear(it) }
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let { ActivityServiceController.stop(it) }
    }

    // A JS reload or a torn-down bridge leaves no activity to serve.
    OnDestroy {
      appContext.reactContext?.let {
        ActivityServiceController.stop(it)
        ActivityServiceController.clear(it)
      }
    }
  }
}
