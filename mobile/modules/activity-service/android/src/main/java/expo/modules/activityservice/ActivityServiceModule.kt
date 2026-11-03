package expo.modules.activityservice

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS's handle on the indoor activity service (#3595). `start` resolves 'on', 'failed' or 'skipped'
// and never rejects; `stop` is safe to call when nothing runs.
class ActivityServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ActivityService")

    AsyncFunction("start") { title: String, body: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("skipped")
      } else {
        ActivityServiceController.start(context, title, body) { promise.resolve(it) }
      }
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let { ActivityServiceController.stop(it) }
    }

    // A JS reload or a torn-down bridge leaves no activity to serve.
    OnDestroy {
      appContext.reactContext?.let { ActivityServiceController.stop(it) }
    }
  }
}
