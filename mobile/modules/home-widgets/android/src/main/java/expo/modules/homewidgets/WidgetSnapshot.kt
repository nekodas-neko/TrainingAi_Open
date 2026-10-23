package expo.modules.homewidgets

import org.json.JSONObject

// What the home-screen widgets draw: a snapshot the app writes from its own local data
// (src/features/widgets/snapshot.ts). Every number arrives formatted, so no score, band or
// wording is worked out here; the widget only lays it out. Pure, so it runs as a JVM unit test.

data class WidgetScore(
  val label: String,
  /** "82", or "7.2" hours of sleep; null when the app has no value today, drawn as a dash. */
  val value: String?,
  /** Home's chip colour in each theme, `#rrggbb`. */
  val colorDark: String?,
  val colorLight: String?,
  /** Home marks it as resting on limited data. */
  val qualified: Boolean,
)

data class TodaySnapshot(
  /** The user's local date the snapshot describes, `YYYY-MM-DD`. */
  val date: String,
  /** "Updated 7:42", already in the user's time zone. */
  val updated: String,
  val scores: List<WidgetScore>,
)

object WidgetSnapshot {
  const val VERSION = 1
  /** The widget has room for four scores. */
  const val MAX_SCORES = 4

  /** Null for anything unreadable or from another version: the widget then asks to open the app. */
  fun parseToday(json: String?): TodaySnapshot? {
    if (json.isNullOrBlank()) return null
    return try {
      val root = JSONObject(json)
      if (root.optInt("v") != VERSION) return null
      val today = root.optJSONObject("today") ?: return null
      val list = today.optJSONArray("scores")
      val scores = (0 until (list?.length() ?: 0)).mapNotNull { i ->
        val item = list!!.optJSONObject(i) ?: return@mapNotNull null
        val label = item.optString("label").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        val color = item.optJSONObject("color")
        WidgetScore(
          label = label,
          value = item.text("value"),
          colorDark = color?.color("dark"),
          colorLight = color?.color("light"),
          qualified = item.optBoolean("qualified"),
        )
      }.take(MAX_SCORES)
      TodaySnapshot(
        date = root.optString("date"),
        updated = root.optString("updated"),
        scores = scores,
      )
    } catch (_: Exception) {
      null
    }
  }

  /** A snapshot from an earlier day is shown dimmed rather than as today's numbers. */
  fun isStale(snapshot: TodaySnapshot, localDate: String): Boolean = snapshot.date != localDate

  private fun JSONObject.text(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

  private val HEX = Regex("^#[0-9a-fA-F]{6}$")

  private fun JSONObject.color(key: String): String? = text(key)?.takeIf { HEX.matches(it) }
}
