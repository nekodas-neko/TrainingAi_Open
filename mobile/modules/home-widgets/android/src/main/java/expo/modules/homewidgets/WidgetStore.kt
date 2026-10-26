package expo.modules.homewidgets

import android.content.Context

/**
 * The snapshot and the queued water taps, kept in the app's own SharedPreferences so a widget can
 * draw them after a reboot with the app closed. The file is excluded from backups
 * (src/integrations/auth/private-backups.cjs).
 */
internal object WidgetStore {
  private const val PREFS = "trainingai_home_widgets"
  private const val KEY = "snapshot"
  private const val PENDING = "pending_water"
  private val lock = Any()

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun write(context: Context, json: String) {
    prefs(context).edit().putString(KEY, json).apply()
  }

  fun read(context: Context): String? = prefs(context).getString(KEY, null)

  /** Sign-out: the snapshot and any taps queued by the account that just left. */
  fun clear(context: Context) {
    synchronized(lock) { prefs(context).edit().remove(KEY).remove(PENDING).commit() }
  }

  fun pending(context: Context): List<WaterTap> =
    synchronized(lock) { PendingWater.parse(prefs(context).getString(PENDING, null)) }

  /** Queues a tap; committed before returning, because the app may be killed right after. */
  fun addPending(context: Context, tap: WaterTap) {
    synchronized(lock) {
      val next = PendingWater.append(PendingWater.parse(prefs(context).getString(PENDING, null)), tap)
      prefs(context).edit().putString(PENDING, PendingWater.toJson(next)).commit()
    }
  }

  fun ackPending(context: Context, ids: Collection<String>) {
    synchronized(lock) {
      val next = PendingWater.ack(PendingWater.parse(prefs(context).getString(PENDING, null)), ids)
      prefs(context).edit().putString(PENDING, PendingWater.toJson(next)).commit()
    }
  }
}
