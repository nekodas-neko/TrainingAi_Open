package expo.modules.homewidgets

import org.json.JSONArray
import org.json.JSONObject

/**
 * The +250 ml taps made on the home screen that the app has not recorded yet. The app reads them
 * (peekPending), records each in its own store, then acknowledges them by id (ackPending), so a
 * crash in between loses no tap, and ids keep a retry from counting one twice. Pure, so it runs as a
 * JVM unit test; WidgetStore keeps the JSON.
 */
data class WaterTap(val id: String, val ml: Int, val at: Long, val date: String, val user: String)

object PendingWater {
  /** A phone left alone for a long time stops queueing here rather than growing without bound. */
  const val MAX = 50

  fun parse(json: String?): List<WaterTap> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
      val list = JSONArray(json)
      (0 until list.length()).mapNotNull { i ->
        val item = list.optJSONObject(i) ?: return@mapNotNull null
        val id = item.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        WaterTap(
          id = id,
          ml = item.optInt("ml"),
          at = item.optLong("at"),
          date = item.optString("date"),
          user = item.optString("user"),
        )
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun toJson(taps: List<WaterTap>): String {
    val list = JSONArray()
    for (tap in taps) {
      list.put(
        JSONObject()
          .put("id", tap.id)
          .put("ml", tap.ml)
          .put("at", tap.at)
          .put("date", tap.date)
          .put("user", tap.user),
      )
    }
    return list.toString()
  }

  /** Adds a tap; a tap already queued under its id, or one past MAX, leaves the queue as it was. */
  fun append(taps: List<WaterTap>, tap: WaterTap): List<WaterTap> =
    if (taps.any { it.id == tap.id } || taps.size >= MAX) taps else taps + tap

  /** Removes the acknowledged taps; an id that is not queued is ignored. */
  fun ack(taps: List<WaterTap>, ids: Collection<String>): List<WaterTap> =
    taps.filter { it.id !in ids }

  /** Taps that belong in a day's total: that account's, made on that day. */
  fun waiting(taps: List<WaterTap>, user: String, date: String): Int =
    taps.count { it.user == user && it.date == date }
}
