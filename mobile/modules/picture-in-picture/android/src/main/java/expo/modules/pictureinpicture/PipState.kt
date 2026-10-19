package expo.modules.pictureinpicture

// What the workout's picture-in-picture window shows, and when it may open. Pure and Android-free
// so it runs as a JVM unit test, as the current app's PipPolicy does. The window itself is drawn
// natively (PipWindowView): React Native stops applying UI updates while the activity is paused,
// and an activity in PiP is paused.

/** The current app's PipPolicy: only these phases open the window when the app is left (#2908). */
object PipPolicy {
  const val IDLE = "idle"
  private val ACTIVE_PHASES = setOf("rest", "set", "complete", "summary")

  fun isActivePhase(phase: String?): Boolean = phase in ACTIVE_PHASES
}

/** The payload JS sends with the phase (`pipViewFor` in pip.ts). */
data class PipWindow(
  /** "timer", or "placeholder" for the exercise summary. */
  val kind: String,
  val exerciseName: String,
  /** "rest" or "set". */
  val phase: String = "rest",
  /** Sets recorded so far in this exercise. */
  val currentSet: Int = 0,
  val sets: Int = 0,
  val restTargetSec: Int = 0,
  val restStartMs: Long? = null,
  val setStartMs: Long? = null,
  /** "60 kg × 8" during a set. */
  val load: String? = null,
  /** The set's colour, `#rrggbb`, from the shared categorical palette. */
  val setColor: String? = null,
)

data class PipClock(
  val seconds: Long,
  val overTime: Boolean,
  /** "/ 1:30" before the target, "+0:10" past it, null with no target or during a set. */
  val target: String?,
  /** How much of the ring is drawn, 0–1. */
  val fraction: Float,
  val label: String,
)

object PipState {
  /** pip-view.tsx's clock at one instant. */
  fun clock(window: PipWindow, nowMs: Long): PipClock {
    val rest = window.phase == "rest"
    val restElapsed =
      if (rest && window.restStartMs != null) maxOf(0L, (nowMs - window.restStartMs) / 1000) else 0L
    val setElapsed =
      if (!rest && window.setStartMs != null) maxOf(0L, (nowMs - window.setStartMs) / 1000) else 0L
    val overTime = rest && window.restTargetSec > 0 && restElapsed >= window.restTargetSec
    // Rest fills toward its target and stays full; a set grows to a three-minute visual cap.
    val fraction = if (rest) {
      if (window.restTargetSec > 0) minOf(restElapsed.toFloat() / window.restTargetSec, 1f) else 0f
    } else {
      minOf(setElapsed / 180f, 1f)
    }
    val target = when {
      !rest || window.restTargetSec <= 0 -> null
      overTime -> "+${formatTime(restElapsed - window.restTargetSec)}"
      else -> "/ ${formatTime(window.restTargetSec.toLong())}"
    }
    val label = when {
      !rest -> "set ${window.currentSet + 1}/${window.sets}"
      window.currentSet >= window.sets -> "done"
      else -> "rest · ${window.currentSet}/${window.sets}"
    }
    return PipClock(if (rest) restElapsed else setElapsed, overTime, target, fraction, label)
  }

  /** components/workout/utils.ts formatTime: m:ss, minutes unbounded. */
  fun formatTime(seconds: Long): String {
    val s = maxOf(0L, seconds)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
  }

  /** Reads the JS payload; anything malformed yields null rather than a broken window. */
  fun fromMap(map: Map<String, Any?>?): PipWindow? {
    if (map == null) return null
    val kind = map["kind"] as? String ?: return null
    val name = map["exerciseName"] as? String ?: return null
    if (kind != "timer" && kind != "placeholder") return null
    fun int(key: String) = (map[key] as? Number)?.toInt() ?: 0
    fun long(key: String) = (map[key] as? Number)?.toLong()
    return PipWindow(
      kind = kind,
      exerciseName = name,
      phase = if (map["phase"] == "set") "set" else "rest",
      currentSet = int("currentSet"),
      sets = int("sets"),
      restTargetSec = int("restTargetSec"),
      restStartMs = long("restStartMs"),
      setStartMs = long("setStartMs"),
      load = map["load"] as? String,
      setColor = (map["setColor"] as? String)?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) },
    )
  }
}
