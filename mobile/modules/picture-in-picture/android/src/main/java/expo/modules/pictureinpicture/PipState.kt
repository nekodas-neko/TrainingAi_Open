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

/**
 * The workout status payload (`workoutStatusFor` in workout-status.ts), the same one the ongoing
 * notification reads (#3266). Only the keys the window draws from are read.
 */
data class PipStatus(
  /** The exercise on screen, or the session's name in the warm-up and the review. */
  val exerciseName: String,
  /** "working", "resting", "ready" or "paused", as the notification reads it. */
  val phase: String,
  val sets: Int = 0,
  /** Sets recorded so far in this exercise. */
  val setsDone: Int = 0,
  /** Only what the plan or the logger knows, or null: the window then shows no load. */
  val load: String? = null,
  val setStartedAt: Long? = null,
  val restStartedAt: Long? = null,
  val restEndsAt: Long? = null,
)

/** One frame of the window. Clocks are anchors in wall time; the view's chronometers count. */
sealed class PipFrame {
  data class Placeholder(val name: String, val hint: Boolean) : PipFrame()

  data class Timer(
    val name: String,
    val rest: Boolean,
    /** What the big clock counts up from; null shows 0:00 standing still. */
    val countsFrom: Long?,
    /** The rest's target, "/ 1:30", or null with no target or during a set. */
    val target: String?,
    /** Past the target: the caption counts up from the rest's end, "+0:10". */
    val overFrom: Long?,
    /** How much of the ring is drawn, 0–1. */
    val fraction: Float,
    val label: String,
    /** Shown only during a set, and only when known. */
    val load: String?,
    /** The running set's arc colour, `#rrggbb`, or null for the rest colour. */
    val setColor: String?,
  ) : PipFrame() {
    val overTime get() = overFrom != null
  }
}

object PipPresenter {
  private const val SET_ARC_SEC = 180f

  /**
   * pip-view.tsx's window for the workout at one instant. A phase with no timer (the summary once
   * Next has nothing to time, the workout done, no data yet) shows the placeholder, never a blank
   * window; "Tap Next" only where the window has a Next button.
   */
  fun present(phase: String, status: PipStatus?, setColor: String?, nowMs: Long): PipFrame {
    if (status == null) return PipFrame.Placeholder("", false)
    val timed = phase == "set" || phase == "rest" || phase == "complete" ||
      (phase == "summary" && status.phase == "resting")
    if (!timed) return PipFrame.Placeholder(status.exerciseName, phase == "summary")
    if (phase == "set") {
      val elapsed = seconds(status.setStartedAt, nowMs)
      return PipFrame.Timer(
        name = status.exerciseName,
        rest = false,
        countsFrom = status.setStartedAt,
        target = null,
        overFrom = null,
        // A set grows to a three-minute visual cap.
        fraction = minOf(elapsed / SET_ARC_SEC, 1f),
        label = "set ${status.setsDone + 1}/${status.sets}",
        load = status.load,
        setColor = setColor,
      )
    }
    val start = status.restStartedAt
    val end = status.restEndsAt
    val targetSec = if (start != null && end != null) maxOf(0L, (end - start) / 1000) else 0L
    val elapsed = seconds(start, nowMs)
    val over = targetSec > 0 && elapsed >= targetSec
    return PipFrame.Timer(
      name = status.exerciseName,
      rest = true,
      countsFrom = start,
      target = if (targetSec > 0) "/ ${formatTime(targetSec)}" else null,
      overFrom = if (over) start!! + targetSec * 1000 else null,
      // Rest fills toward its target and stays full.
      fraction = if (targetSec > 0) minOf(elapsed.toFloat() / targetSec, 1f) else 0f,
      label = if (status.setsDone >= status.sets) "done" else "rest · ${status.setsDone}/${status.sets}",
      load = null,
      setColor = null,
    )
  }

  /** Whole seconds since `fromMs`, never negative; 0 with nothing to count from. */
  fun seconds(fromMs: Long?, nowMs: Long): Long = if (fromMs == null) 0L else maxOf(0L, (nowMs - fromMs) / 1000)

  /**
   * A wall-clock instant on the `SystemClock.elapsedRealtime` time base a Chronometer counts on.
   * Read once per render, so a wall-clock change mid-rest moves the clock only at the next render.
   */
  fun elapsedBase(epochMs: Long, nowWallMs: Long, nowElapsedMs: Long): Long = nowElapsedMs - (nowWallMs - epochMs)

  /** components/workout/utils.ts formatTime: m:ss, minutes unbounded. */
  fun formatTime(seconds: Long): String {
    val s = maxOf(0L, seconds)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
  }

  /** Reads the JS payload; anything malformed yields null rather than a broken window. */
  fun fromMap(map: Map<String, Any?>?): PipStatus? {
    if (map == null) return null
    val name = map["exerciseName"] as? String ?: return null
    val phase = map["phase"] as? String ?: return null
    fun int(key: String) = (map[key] as? Number)?.toInt() ?: 0
    fun long(key: String) = (map[key] as? Number)?.toLong()
    return PipStatus(
      exerciseName = name,
      phase = phase,
      sets = int("sets"),
      setsDone = int("setsDone"),
      load = (map["load"] as? String)?.takeIf { it.isNotBlank() },
      setStartedAt = long("setStartedAt"),
      restStartedAt = long("restStartedAt"),
      restEndsAt = long("restEndsAt"),
    )
  }

  /** The arc colour JS sends; anything Android cannot parse falls back to the rest colour. */
  fun color(value: Any?): String? = (value as? String)?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }
}

/** A Chronometer as the window drives it. Each call may tick, and a tick renders the window. */
interface PipClock {
  fun start()
  fun stop()
  fun setBase(base: Long)
}

/**
 * Keeps the window's clocks from re-entering it. A Chronometer dispatches its tick before it records
 * that it is running, so a start() from inside a tick starts it again, ticks again and overflows the
 * stack; and setBase() ticks too. So each clock is started once and its base set only when it
 * moves, and a render reached from inside a render is skipped.
 */
class PipClockGate(private val slackMs: Long = 250L) {
  private val started = HashSet<PipClock>()
  private val bases = HashMap<PipClock, Long>()
  private var rendering = false

  fun render(draw: () -> Unit) {
    if (rendering) return
    rendering = true
    try {
      draw()
    } finally {
      rendering = false
    }
  }

  /** Counts `clock` from `base`, or stops it with null. True when the base was set. */
  fun count(clock: PipClock, base: Long?): Boolean {
    if (base == null) {
      started.remove(clock)
      bases.remove(clock)
      clock.stop()
      return false
    }
    val current = bases[clock]
    val moved = current == null || kotlin.math.abs(current - base) > slackMs
    if (moved) {
      bases[clock] = base
      clock.setBase(base)
    }
    if (started.add(clock)) clock.start()
    return moved
  }
}
