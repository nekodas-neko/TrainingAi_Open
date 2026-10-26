package expo.modules.homewidgets

import org.json.JSONArray
import org.json.JSONObject

// What the home-screen widgets draw: a snapshot the app writes from its own local data
// (src/features/widgets/snapshot.ts). Every number arrives formatted, so no score, band or wording
// is worked out here; a widget only lays it out. Pure, so it runs as a JVM unit test.

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

data class WidgetBattery(val value: String, val label: String, val level: Int, val band: String)

data class WidgetNext(
  val eyebrow: String,
  val name: String,
  val meta: String,
  /** The session the Start button opens; null for the check-in and rest-day cards. */
  val sessionId: String?,
  val startable: Boolean,
  val restDay: Boolean,
)

data class WidgetMacro(val key: String, val label: String, val left: String?, val fraction: Double?)

data class WaterStep(val text: String, val fraction: Double?)

data class WidgetWater(
  val goal: String?,
  /** Millilitres one tap of the button adds; a snapshot without it has no button. */
  val tapMl: Int,
  /** The row after 0, 1, 2 … taps the app has not seen yet; steps[0] is the row as the app left it. */
  val steps: List<WaterStep>,
)

data class WidgetNutrition(
  val kcalValue: String?,
  val kcalLabel: String?,
  val macros: List<WidgetMacro>,
  val water: WidgetWater?,
)

data class Snapshot(
  /** The account it was built for. */
  val user: String,
  /** The user's local date the snapshot describes, `YYYY-MM-DD`. */
  val date: String,
  /** "Updated 7:42 am", already in the user's time zone. */
  val updated: String,
  val scores: List<WidgetScore>,
  val battery: WidgetBattery?,
  val next: WidgetNext?,
  val nutrition: WidgetNutrition?,
)

object WidgetSnapshot {
  const val VERSION = 1
  /** The Today widget has room for four scores. */
  const val MAX_SCORES = 4
  const val MAX_MACROS = 3

  /** Null for anything unreadable or from another version: the widget then asks to open the app. */
  fun parse(json: String?): Snapshot? {
    if (json.isNullOrBlank()) return null
    return try {
      val root = JSONObject(json)
      if (root.optInt("v") != VERSION) return null
      val user = root.text("user") ?: return null
      val date = root.text("date") ?: return null
      val today = root.optJSONObject("today")
      Snapshot(
        user = user,
        date = date,
        updated = root.optString("updated"),
        scores = today?.optJSONArray("scores").objects().mapNotNull(::score).take(MAX_SCORES),
        battery = today?.optJSONObject("battery")?.let(::battery),
        next = root.optJSONObject("next")?.let(::next),
        nutrition = root.optJSONObject("nutrition")?.let(::nutrition),
      )
    } catch (_: Exception) {
      null
    }
  }

  /** A snapshot from an earlier day is never shown as today's numbers. */
  fun isStale(snapshot: Snapshot, localDate: String): Boolean = snapshot.date != localDate

  /** The water row after `taps` button presses the app has not recorded; more taps than the table holds show its last row. */
  fun waterStep(water: WidgetWater, taps: Int): WaterStep? =
    water.steps.getOrNull(taps.coerceIn(0, (water.steps.size - 1).coerceAtLeast(0)))

  private fun score(item: JSONObject): WidgetScore? {
    val label = item.text("label") ?: return null
    val color = item.optJSONObject("color")
    return WidgetScore(
      label = label,
      value = item.text("value"),
      colorDark = color?.color("dark"),
      colorLight = color?.color("light"),
      qualified = item.optBoolean("qualified"),
    )
  }

  private fun battery(item: JSONObject): WidgetBattery? {
    val value = item.text("value") ?: return null
    val band = item.text("band")?.takeIf { it in BANDS } ?: return null
    return WidgetBattery(value, item.optString("label"), item.optInt("level").coerceIn(0, 100), band)
  }

  private fun next(item: JSONObject): WidgetNext? {
    val name = item.text("name") ?: return null
    return WidgetNext(
      eyebrow = item.optString("eyebrow"),
      name = name,
      meta = item.optString("meta"),
      sessionId = item.text("sessionId"),
      startable = item.optBoolean("startable") && item.text("sessionId") != null,
      restDay = item.optBoolean("restDay"),
    )
  }

  private fun nutrition(item: JSONObject): WidgetNutrition {
    val kcal = item.optJSONObject("kcal")
    return WidgetNutrition(
      kcalValue = kcal?.text("value"),
      kcalLabel = kcal?.text("label"),
      macros = item.optJSONArray("macros").objects().mapNotNull(::macro).take(MAX_MACROS),
      water = item.optJSONObject("water")?.let(::water),
    )
  }

  private fun macro(item: JSONObject): WidgetMacro? {
    val key = item.text("key")?.takeIf { it in MACRO_KEYS } ?: return null
    return WidgetMacro(key, item.optString("label"), item.text("left"), item.fraction("fraction"))
  }

  private fun water(item: JSONObject): WidgetWater? {
    val steps = item.optJSONArray("steps").objects().map {
      WaterStep(it.text("text") ?: DASH, it.fraction("fraction"))
    }
    if (steps.isEmpty()) return null
    return WidgetWater(item.text("goal"), item.optInt("tapMl"), steps)
  }

  private const val DASH = "—"
  private val BANDS = setOf("drained", "low", "good")
  private val MACRO_KEYS = setOf("protein", "carbs", "fat")
  private val HEX = Regex("^#[0-9a-fA-F]{6}$")

  private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

  private fun JSONObject.text(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

  private fun JSONObject.color(key: String): String? = text(key)?.takeIf { HEX.matches(it) }

  /** 0–1, or null when absent; a value outside the range is clamped to it. */
  private fun JSONObject.fraction(key: String): Double? =
    if (isNull(key) || !has(key)) null else optDouble(key).takeIf { !it.isNaN() }?.coerceIn(0.0, 1.0)
}
