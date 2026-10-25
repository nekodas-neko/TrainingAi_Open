package expo.modules.pictureinpicture

// What the workout's picture-in-picture window shows, and when it may open. Pure and Android-free
// so it runs as a JVM unit test, as the current app's PipPolicy does. The window itself is drawn
// natively (PipWindowView): React Native stops applying UI updates while the activity is paused,
// and an activity in PiP is paused.

/** The current app's PipPolicy, grown for the phase card (#3266): which phases open the window. */
object PipPolicy {
  const val IDLE = "idle"
  private val ACTIVE_PHASES = setOf("rest", "set", "complete", "summary", "paused")

  /**
   * The phases the system enters picture-in-picture from on its own, with the smooth shrink: a set,
   * a rest, and a pause (which holds a set or a rest). The others still open the window from
   * onUserLeaveHint, as before, so no phase that opened a window stops opening one.
   */
  private val AUTO_ENTER_PHASES = setOf("set", "rest", "paused")

  /** The most buttons the system shows (`config_pictureInPictureMaxNumberOfActions`). */
  const val MAX_ACTIONS = 3

  fun isActivePhase(phase: String?): Boolean = phase in ACTIVE_PHASES

  fun autoEnters(phase: String?): Boolean = phase in AUTO_ENTER_PHASES

  /** The window's width : height. Portrait while lifting, square for everything else. */
  fun aspect(phase: String?): Pair<Int, Int> = if (phase == "set") 3 to 4 else 1 to 1
}

/** The strap's latest reading, as JS sends it (`PipHeartRate` in usePictureInPicture.ts). */
data class PipHeartRate(
  val bpm: Int,
  val zoneName: String?,
  /** `#rrggbb`, or null for no zone colour. */
  val zoneColor: String?,
  /** When the strap sent it, in wall time. */
  val at: Long,
)

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
  /** When the current pause began; null unless the workout is paused. */
  val pausedAt: Long? = null,
  /** The exercise Next moves to, from the exercise summary; null when Next ends the workout. */
  val nextUp: String? = null,
  /** The strap's reading; null with no strap, in which case the window shows no heart rate. */
  val hr: PipHeartRate? = null,
  /** `#rrggbb` per set of this exercise, in order, for the set dots. */
  val setColors: List<String> = emptyList(),
)

/** The heart-rate line: `bpm` is null once the reading is too old to show. */
data class PipHeartView(val bpm: Int?, val zoneName: String?, val zoneColor: String?)

/** One of the window's buttons. `icon` names a drawable; `action` is what JS is told. */
data class PipButton(val action: String, val label: String, val icon: String)

/** One frame of the window. Clocks are anchors in wall time; the view's chronometers count. */
sealed class PipFrame {
  data class Placeholder(val name: String, val hint: Boolean, val nextUp: String? = null) : PipFrame()

  /** A running set: the portrait card (3:4). */
  data class Working(
    val name: String,
    /** "Set 3 of 4". */
    val setLabel: String,
    /** "80" and "kg", the load's big part; null when the load is not a weight. */
    val weight: String?,
    val unit: String?,
    /** "× 8" or "8 reps"; null when unknown. */
    val reps: String?,
    val sets: Int,
    val setsDone: Int,
    val setColors: List<String>,
    /** The running set's own colour, which pulses. */
    val setColor: String?,
    /** What the set clock counts up from; null stands at 0:00. */
    val countsFrom: Long?,
    val hr: PipHeartView?,
  ) : PipFrame()

  /** A rest: the square (1:1) with its ring. */
  data class Resting(
    val name: String,
    /** "REST · NEXT 3/4", "REST OVER", "REST · DONE". */
    val eyebrow: String,
    /** What the clock counts from (the rest's start); null stands still. */
    val countsFrom: Long?,
    /** The rest's length in seconds, counted down to; null counts up from the start. */
    val targetSec: Long?,
    /** Past the target: the clock reads "+0:12" and the ring is red and full. */
    val over: Boolean,
    /** How much of the ring is left: 1 at the start, 0 at the target; 1 once over. */
    val fraction: Float,
    /** The next set's load, "80 kg × 8"; null when unknown. */
    val load: String?,
    val hr: PipHeartView?,
  ) : PipFrame()

  /** A pause: how long it has lasted, and what it is holding. */
  data class Paused(
    val countsFrom: Long?,
    val caption: String,
  ) : PipFrame()
}

object PipPresenter {
  /** A reading older than this is "—", as the strap's own stale limit (STALE_MS in StrapSession.ts). */
  const val HR_STALE_MS = 8_000L

  /**
   * The window for the workout at one instant. A phase with no timer (the summary once Next has
   * nothing to time, the workout done, no data yet) shows the placeholder, never a blank window;
   * "Tap Next" only where the window has a Next button.
   */
  fun present(phase: String, status: PipStatus?, setColor: String?, nowMs: Long): PipFrame {
    if (status == null) return PipFrame.Placeholder("", false)
    return when {
      phase == "paused" -> paused(status, nowMs)
      phase == "set" -> working(status, setColor, nowMs)
      phase == "rest" || phase == "complete" || (phase == "summary" && status.phase == "resting") ->
        resting(status, nowMs)
      phase == "summary" -> PipFrame.Placeholder(status.exerciseName, true, status.nextUp)
      else -> PipFrame.Placeholder(status.exerciseName, false)
    }
  }

  private fun working(status: PipStatus, setColor: String?, nowMs: Long): PipFrame.Working {
    val parts = splitLoad(status.load)
    return PipFrame.Working(
      name = status.exerciseName,
      setLabel = "Set ${minOf(status.setsDone + 1, maxOf(status.sets, 1))} of ${status.sets}",
      weight = parts.weight,
      unit = parts.unit,
      reps = parts.reps,
      sets = status.sets,
      setsDone = status.setsDone,
      setColors = status.setColors,
      setColor = setColor,
      countsFrom = status.setStartedAt,
      hr = heartView(status.hr, nowMs),
    )
  }

  private fun resting(status: PipStatus, nowMs: Long): PipFrame.Resting {
    val start = status.restStartedAt
    val end = status.restEndsAt
    val targetSec = if (start != null && end != null) maxOf(0L, (end - start) / 1000) else 0L
    val timed = targetSec > 0
    val elapsed = seconds(start, nowMs)
    val over = timed && elapsed >= targetSec
    val done = status.setsDone >= status.sets
    return PipFrame.Resting(
      name = status.exerciseName,
      eyebrow = when {
        over -> "REST OVER"
        done -> "REST · DONE"
        else -> "REST · NEXT ${status.setsDone + 1}/${status.sets}"
      },
      countsFrom = start,
      targetSec = if (timed) targetSec else null,
      over = over,
      // The ring empties as the rest runs out, and sits full and red once it is over.
      fraction = when {
        !timed -> 0f
        over -> 1f
        else -> 1f - elapsed.toFloat() / targetSec
      },
      load = if (done) null else status.load,
      hr = heartView(status.hr, nowMs),
    )
  }

  private fun paused(status: PipStatus, nowMs: Long): PipFrame.Paused {
    val end = status.restEndsAt
    val at = status.pausedAt
    // What is left of the rest, as it was when the workout stopped.
    val left = if (end != null && at != null && end > at) (end - at + 999) / 1000 else null
    return PipFrame.Paused(
      countsFrom = at,
      caption = if (left != null) "${status.exerciseName} · rest ${formatTime(left)} left" else status.exerciseName,
    )
  }

  /** Null with no strap; a bpm of null once the reading is stale, which the window draws as "—". */
  fun heartView(hr: PipHeartRate?, nowMs: Long): PipHeartView? {
    if (hr == null) return null
    val fresh = nowMs - hr.at <= HR_STALE_MS
    return PipHeartView(if (fresh) hr.bpm else null, hr.zoneName, hr.zoneColor)
  }

  /** What a load string splits into: the weight (big) and its unit, and the reps (smaller). */
  data class LoadParts(val weight: String?, val unit: String?, val reps: String?)

  /**
   * "80 kg × 8" → 80 / kg / × 8; "80 kg" → 80 / kg; "8 reps" → reps only. Nothing is made up: a
   * load that is none of these shows whole as the weight line.
   */
  fun splitLoad(load: String?): LoadParts {
    val text = load?.trim()?.takeIf { it.isNotEmpty() } ?: return LoadParts(null, null, null)
    val cross = text.indexOf(" × ")
    val left = if (cross >= 0) text.substring(0, cross).trim() else text
    val reps = if (cross >= 0) "× " + text.substring(cross + 3).trim() else null
    if (cross < 0 && text.endsWith(" reps")) return LoadParts(null, null, text)
    val weight = Regex("^(-?[0-9][0-9.,]*)\\s*(kg|lb)$").find(left)
    return if (weight != null) LoadParts(weight.groupValues[1], weight.groupValues[2], reps)
    else LoadParts(left, null, reps)
  }

  /** The buttons for a phase, at most `PipPolicy.MAX_ACTIONS`; the middle one is the main one. */
  fun buttons(phase: String, status: PipStatus?): List<PipButton> {
    val list = when (phase) {
      "set" -> listOf(
        PipButton("repsDown", "Reps -", "minus"),
        PipButton("log", "Log set", "log"),
        PipButton("repsUp", "Reps +", "plus"),
      )
      "rest" -> listOfNotNull(
        // +30 s moves a timed rest's end; an untimed rest has none to move.
        if (status?.restEndsAt != null) PipButton("restPlus", "+30 s", "plus30") else null,
        PipButton("log", "Start set", "start"),
        PipButton("pause", "Pause", "pause"),
      )
      "paused" -> listOf(PipButton("resume", "Resume", "resume"))
      "complete" -> listOf(PipButton("log", "Complete", "log"))
      "summary" -> listOf(PipButton("log", "Next", "start"))
      else -> emptyList()
    }
    return list.take(PipPolicy.MAX_ACTIONS)
  }

  /** The window's title for the system: the exercise, or the session while there is none. */
  fun title(status: PipStatus?): String? = status?.exerciseName?.takeIf { it.isNotBlank() }

  /** The line under the title: where the set is, or that the workout is held. */
  fun subtitle(phase: String, status: PipStatus?): String? = when {
    status == null -> null
    phase == "paused" -> "Paused"
    phase == "set" -> "Set ${minOf(status.setsDone + 1, maxOf(status.sets, 1))} of ${status.sets}"
    phase == "rest" -> "Resting"
    else -> null
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

  /** What the rest clock reads: the time left, then "+0:12" once past the target; up with none. */
  fun restClockText(elapsedSec: Long, targetSec: Long?): String = when {
    targetSec == null -> formatTime(elapsedSec)
    elapsedSec >= targetSec -> "+" + formatTime(elapsedSec - targetSec)
    else -> formatTime(targetSec - elapsedSec)
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
      pausedAt = long("pausedAt"),
      nextUp = (map["nextUp"] as? String)?.takeIf { it.isNotBlank() },
      hr = heartRate(map["hr"]),
      setColors = (map["setColors"] as? List<*>)?.mapNotNull { color(it) } ?: emptyList(),
    )
  }

  private fun heartRate(value: Any?): PipHeartRate? {
    val map = value as? Map<*, *> ?: return null
    val bpm = (map["bpm"] as? Number)?.toInt() ?: return null
    val at = (map["at"] as? Number)?.toLong() ?: return null
    return PipHeartRate(
      bpm = bpm,
      zoneName = (map["zoneName"] as? String)?.takeIf { it.isNotBlank() },
      zoneColor = color(map["zoneColor"]),
      at = at,
    )
  }

  /** The arc colour JS sends; anything Android cannot parse falls back to the default colour. */
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
