package expo.modules.activityservice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

// Starts and stops ActivityForegroundService and turns the outcome into the answer JS waits for:
// 'on' once startForeground has succeeded, 'failed' when Android refused (in startForegroundService
// or in startForeground), 'skipped' when BLUETOOTH_CONNECT is missing. Everything runs on the main
// thread, as onStartCommand does, so the pending answer needs no lock.
object ActivityServiceController {
  private const val ANSWER_TIMEOUT_MS = 5_000L
  private val main = Handler(Looper.getMainLooper())
  private var pending: ((String) -> Unit)? = null
  private var appContext: Context? = null
  private val timeout = Runnable {
    // The service never reached onStartCommand: treat it as refused, and make sure a late start
    // does not leave a notification nobody will clear.
    appContext?.let { stop(it) }
    settle("failed")
  }

  fun start(context: Context, title: String, body: String, answer: (String) -> Unit) {
    val granted =
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED
    if (!ActivityServicePolicy.mayStart(Build.VERSION.SDK_INT, granted)) {
      answer("skipped")
      return
    }
    main.post {
      // A start still waiting for its answer is superseded by this one.
      settle("failed")
      val app = context.applicationContext
      appContext = app
      pending = answer
      val intent = Intent(app, ActivityForegroundService::class.java)
        .putExtra(ActivityForegroundService.EXTRA_TITLE, title)
        .putExtra(ActivityForegroundService.EXTRA_BODY, body)
      try {
        // ForegroundServiceStartNotAllowedException (Android 12+) lands here.
        ContextCompat.startForegroundService(app, intent)
      } catch (failure: Exception) {
        settle("failed")
        return@post
      }
      main.postDelayed(timeout, ANSWER_TIMEOUT_MS)
    }
  }

  /** Called by the service from onStartCommand, and by the controller itself. */
  fun settle(result: String) {
    main.removeCallbacks(timeout)
    val answer = pending ?: return
    pending = null
    answer(result)
  }

  fun stop(context: Context) {
    runCatching {
      context.applicationContext.stopService(Intent(context.applicationContext, ActivityForegroundService::class.java))
    }
  }
}
