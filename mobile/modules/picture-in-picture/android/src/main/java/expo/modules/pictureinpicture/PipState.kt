package expo.modules.pictureinpicture

// What the workout's picture-in-picture window shows, and when it may open. Pure and Android-free
// so it runs as a JVM unit test, as the current app's PipPolicy does. The window itself is drawn
// natively (PipWindowView): React Native stops applying UI updates while the activity is paused,
// and an activity in PiP is paused.

/** The current app's PipPolicy, grown for the phase card (#3266): which phases open the window. */
object PipPolicy {
  const val IDLE = "idle"
  // "ready" is an exercise before its first set (#3734); it opened the window as "rest" before.
  private val ACTIVE_PHASES = setOf("ready", "rest", "set", "complete", "summary", "paused")

  /**
   * The phases the system enters picture-in-picture from on its own, with the smooth shrink: a set,
   * a rest, and a pause (which holds a set or a rest). The others still open the window from
   * onUserLeaveHint, as before, so no phase that opened a window stops opening one.
   */
  private val AUTO_ENTER_PHASES = setOf("set", "ready", "rest", "paused")

  /** The most buttons the system shows (`config_pictureInPictureMaxNumberOfActions`). */
  const val MAX_ACTIONS = 3

  fun isActivePhase(phase: String?): Boolean = phase in ACTIVE_PHASES

  fun autoEnters(phase: String?): Boolean = phase in AUTO_ENTER_PHASES

  /** `Build.VERSION_CODES.S`: auto-enter exists from here. */
  private const val SDK_S = 31

  /**
   * Whether leaving the app should open the window by hand. From Android 12 the phases that
   * auto-enter are entered by the system with the shrink animation, and a manual entry would
   * pre-empt it; every other active phase, and every phase before Android 12, still enters here.
   */
  fun entersOnLeave(phase: String?, sdk: Int): Boolean =
    isActivePhase(phase) && !(sdk >= SDK_S && autoEnters(phase))

  /** The window's width : height: one 3:4 card in every state (#3734, option A). */
  @Suppress("UNUSED_PARAMETER")
  fun aspect(phase: String?): Pair<Int, Int> = 3 to 4
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
  /** `#rrggbb` per set of this exercise, in order, for the set segments. */
  val setColors: List<String> = emptyList(),
  // #3734: where the lifter is, and the clock when nothing else runs.
  val sessionName: String? = null,
  /** 1-based place among the session's exercises, and how many; 0 when unknown. */
  val exerciseIndex: Int = 0,
  val exerciseCount: Int = 0,
  /** Now minus this is the workout's running time; null for an older app that does not send it. */
  val workoutFrom: Long? = null,
  /** The exercise Next moves to: its place, set count and first load. */
  val nextUpIndex: Int = 0,
  val nextUpSets: Int = 0,
  val nextUpLoad: String? = null,
  /** #3745: the answer buttons are offered until this wall time; null when the window doesn't ask. */
  val effortUntil: Long? = null,
  /** The app's accent, `#rrggbb`, or null for the window's own green. */
  val accent: String? = null,
)

/** The heart-rate line: `bpm` is null once the reading is too old to show. */
data class PipHeartView(val bpm: Int?, val zoneName: String?, val zoneColor: String?)

/** One of the window's buttons. `icon` names a drawable; `action` is what JS is told. */
data class PipButton(val action: String, val label: String, val icon: String)

/** The six states of the card (#3734, option A). */
enum class PipCardState { READY, LIFTING, RESTING, REST_OVER, EXERCISE_DONE, PAUSED }

/** One frame of the window. Clocks are anchors in wall time; the view's chronometer counts. */
sealed class PipFrame {
  /** No workout data, the warm-up or the review: a card with the name, never a blank window. */
  data class Placeholder(val name: String, val hint: Boolean, val nextUp: String? = null) : PipFrame()

  /**
   * The one card, in every state: a band in the state's colour holding a clock that always counts,
   * and the same four facts below it.
   */
  data class Card(
    val state: PipCardState,
    /** `#rrggbb`: the band, the state word, the bar and the current set's segment. */
    val color: String,
    /** "READY", "LIFTING", "RESTING", "REST OVER", "EXERCISE DONE", "PAUSED". */
    val stateWord: String,
    /** "Set 1 of 2", "Next 2 of 2", or empty. */
    val setLine: String,
    /** What the clock counts from; null stands at 0:00 (an older app that sends no workout start). */
    val countsFrom: Long?,
    /** A rest's length: the clock counts down to it, then up past it with a "+". Null counts up. */
    val targetSec: Long?,
    val clockLabel: String,
    /** The rest bar's fill, 1 at the rest's start; null where the state has no bar. */
    val bar: Float?,
    val name: String,
    /** "Exercise 2 of 5 · Push A". */
    val where: String,
    /** "27.5 kg × 7"; null when unknown, never made up. */
    val load: String?,
    /** "first set", "next set", or null. */
    val loadLabel: String?,
    val sets: Int,
    /** Segments drawn in their set colours. */
    val setsDone: Int,
    /** The segment drawn in the state colour; null for none. */
    val current: Int?,
    val setColors: List<String>,
    /** The lifting segment pulses. */
    val pulse: Boolean,
    val hr: PipHeartView?,
  ) : PipFrame()
}

object PipPresenter {
  /** A reading older than this is "—", as the strap's own stale limit (STALE_MS in StrapSession.ts). */
  const val HR_STALE_MS = 8_000L

  const val READY_COLOR = "#cfd8dc"
  const val LIFT_COLOR = "#56ee66"
  const val OVER_COLOR = "#ff6467"
  /** The dark warning status token (#3441), as the in-app chips. */
  const val PAUSED_COLOR = "#efaf00"
  /** The app's green, for an app that sends no accent. */
  const val DEFAULT_ACCENT = "#00c84e"

  /**
   * The window for the workout at one instant (#3734, option A). `phase` is the app's
   * (`pipPhaseFor`); `status` the workout status payload. The warm-up, the review and a missing
   * status show the placeholder, never a blank window.
   */
  fun present(phase: String, status: PipStatus?, setColor: String?, nowMs: Long): PipFrame {
    if (status == null) return PipFrame.Placeholder("", false)
    val accent = status.accent ?: DEFAULT_ACCENT
    return when (phase) {
      "paused" -> paused(status, accent, nowMs)
      "set" -> lifting(status, setColor, nowMs)
      "ready" -> ready(status, nowMs)
      "rest", "complete" ->
        if (status.sets > 0 && status.setsDone >= status.sets) exerciseDone(status, accent, nowMs)
        else resting(status, accent, nowMs)
      "summary" -> exerciseDone(status, accent, nowMs)
      else -> PipFrame.Placeholder(status.exerciseName, false)
    }
  }

  private fun where(index: Int, status: PipStatus): String {
    val session = status.sessionName?.takeIf { it.isNotBlank() }
    val place = if (index > 0 && status.exerciseCount > 0) "Exercise $index of ${status.exerciseCount}" else null
    return listOfNotNull(place, session).joinToString(" · ")
  }

  private fun setOf(n: Int, sets: Int) = "${minOf(n, maxOf(sets, 1))} of $sets"

  /** The clock when nothing else runs: the workout's running time. */
  private fun workoutClock(status: PipStatus) = status.workoutFrom

  private fun card(
    state: PipCardState, color: String, word: String, status: PipStatus, nowMs: Long,
    setLine: String, countsFrom: Long?, targetSec: Long?, clockLabel: String, bar: Float?,
    loadLabel: String?, current: Int?, pulse: Boolean = false,
  ) = PipFrame.Card(
    state = state, color = color, stateWord = word, setLine = setLine,
    countsFrom = countsFrom, targetSec = targetSec, clockLabel = clockLabel, bar = bar,
    name = status.exerciseName, where = where(status.exerciseIndex, status),
    load = status.load, loadLabel = loadLabel.takeIf { status.load != null },
    sets = status.sets, setsDone = status.setsDone, current = current,
    setColors = status.setColors, pulse = pulse, hr = heartView(status.hr, nowMs),
  )

  private fun ready(status: PipStatus, nowMs: Long) = card(
    PipCardState.READY, READY_COLOR, "READY", status, nowMs,
    setLine = "Set ${setOf(status.setsDone + 1, status.sets)}",
    countsFrom = workoutClock(status), targetSec = null, clockLabel = "workout time", bar = null,
    loadLabel = "first set", current = status.setsDone,
  )

  // The running set's own colour (`setColor`) is no longer drawn: the card's current segment takes
  // the state's colour, as every state's does (#3734).
  @Suppress("UNUSED_PARAMETER")
  private fun lifting(status: PipStatus, setColor: String?, nowMs: Long): PipFrame.Card {
    val timed = status.setStartedAt != null
    return card(
      PipCardState.LIFTING, LIFT_COLOR, "LIFTING", status, nowMs,
      setLine = "Set ${setOf(status.setsDone + 1, status.sets)}",
      countsFrom = status.setStartedAt ?: workoutClock(status), targetSec = null,
      clockLabel = if (timed) "this set" else "workout time", bar = null,
      loadLabel = null, current = status.setsDone, pulse = true,
    )
  }

  /** The rest's length in whole seconds, or null for an untimed rest. */
  private fun target(status: PipStatus): Long? {
    val start = status.restStartedAt ?: return null
    val end = status.restEndsAt ?: return null
    return maxOf(0L, (end - start) / 1000).takeIf { it > 0 }
  }

  private fun resting(status: PipStatus, accent: String, nowMs: Long): PipFrame.Card {
    val start = status.restStartedAt
    val target = target(status)
    val next = "Next ${setOf(status.setsDone + 1, status.sets)}"
    if (start == null) {
      // No rest to count at all: the workout's clock.
      return card(
        PipCardState.RESTING, accent, "RESTING", status, nowMs, next,
        workoutClock(status), null, "workout time", null, "next set", status.setsDone,
      )
    }
    if (target == null) {
      return card(
        PipCardState.RESTING, accent, "RESTING", status, nowMs, next,
        start, null, "since the last set", null, "next set", status.setsDone,
      )
    }
    val elapsed = seconds(start, nowMs)
    val over = elapsed >= target
    return card(
      if (over) PipCardState.REST_OVER else PipCardState.RESTING,
      if (over) OVER_COLOR else accent,
      if (over) "REST OVER" else "RESTING",
      status, nowMs, next, start, target,
      if (over) "past the ${formatTime(target)} rest" else "left of ${formatTime(target)} rest",
      if (over) 1f else 1f - elapsed.toFloat() / target,
      "next set", status.setsDone,
    )
  }

  private fun exerciseDone(status: PipStatus, accent: String, nowMs: Long): PipFrame.Card {
    val start = status.restStartedAt
    val target = if (status.phase == "resting") target(status) else null
    val elapsed = seconds(start, nowMs)
    val over = target != null && elapsed >= target
    val next = status.nextUp
    val base = card(
      if (over) PipCardState.REST_OVER else PipCardState.EXERCISE_DONE,
      if (over) OVER_COLOR else accent,
      if (over) "REST OVER" else "EXERCISE DONE",
      status, nowMs, "",
      if (target != null) start else workoutClock(status), target,
      when {
        target == null -> "workout time"
        over -> "past the ${formatTime(target)} rest"
        else -> "left of ${formatTime(target)} rest"
      },
      when {
        target == null -> null
        over -> 1f
        else -> 1f - elapsed.toFloat() / target
      },
      null, null,
    )
    // What comes next: its name, its place, its first set and its sets, all still to do.
    return if (next != null) base.copy(
      name = "Next: $next",
      where = where(status.nextUpIndex, status),
      load = status.nextUpLoad,
      loadLabel = if (status.nextUpLoad != null) "first set" else null,
      sets = status.nextUpSets,
      setsDone = 0,
      current = null,
    ) else base.copy(load = null, loadLabel = null)
  }

  private fun paused(status: PipStatus, accent: String, nowMs: Long): PipFrame.Card {
    val end = status.restEndsAt
    val at = status.pausedAt
    // What is left of the rest, as it was when the workout stopped.
    val left = if (end != null && at != null && end > at) (end - at + 999) / 1000 else null
    val inSet = status.setStartedAt != null && status.phase != "resting"
    val done = status.sets > 0 && status.setsDone >= status.sets
    val card = card(
      PipCardState.PAUSED, PAUSED_COLOR, "PAUSED", status, nowMs,
      setLine = when {
        done -> ""
        inSet -> "Set ${setOf(status.setsDone + 1, status.sets)}"
        else -> "Next ${setOf(status.setsDone + 1, status.sets)}"
      },
      countsFrom = at, targetSec = null,
      clockLabel = if (left != null) "paused for · ${formatTime(left)} of rest left" else "paused for",
      bar = null, loadLabel = if (inSet) "this set" else "next set", current = status.setsDone,
    )
    val next = status.nextUp
    return if (done && next != null) card.copy(
      name = "Next: $next", where = where(status.nextUpIndex, status), load = status.nextUpLoad,
      loadLabel = if (status.nextUpLoad != null) "first set" else null,
      sets = status.nextUpSets, setsDone = 0, current = null,
    ) else card
  }

  /** Null with no strap; a bpm of null once the reading is stale, which the window draws as "—". */
  fun heartView(hr: PipHeartRate?, nowMs: Long): PipHeartView? {
    if (hr == null) return null
    val fresh = nowMs - hr.at <= HR_STALE_MS
    return PipHeartView(if (fresh) hr.bpm else null, hr.zoneName, hr.zoneColor)
  }

  /** #3745: "how did it feel?", answered in the window for the first seconds of the last rest. */
  val EFFORT_BUTTONS = listOf(
    PipButton("effortEasier", "Easier", "easier"),
    PipButton("effortAsExpected", "As expected", "expected"),
    PipButton("effortHarder", "Harder", "harder"),
  )

  /** Whether the window is offering the answer buttons at `nowMs`. */
  fun asksEffort(phase: String, status: PipStatus?, nowMs: Long): Boolean {
    val until = status?.effortUntil ?: return false
    return phase == "summary" && nowMs < until
  }

  /** The buttons for a phase, at most `PipPolicy.MAX_ACTIONS`; the middle one is the main one. */
  fun buttons(phase: String, status: PipStatus?, nowMs: Long = System.currentTimeMillis()): List<PipButton> {
    if (asksEffort(phase, status, nowMs)) return EFFORT_BUTTONS
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
      "ready" -> listOf(
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
  fun subtitle(phase: String, status: PipStatus?, nowMs: Long = System.currentTimeMillis()): String? = when {
    status == null -> null
    asksEffort(phase, status, nowMs) -> "How did it feel?"
    phase == "ready" -> "Ready"
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
      sessionName = (map["sessionName"] as? String)?.takeIf { it.isNotBlank() },
      exerciseIndex = int("exerciseIndex"),
      exerciseCount = int("exerciseCount"),
      workoutFrom = long("workoutFrom"),
      nextUpIndex = int("nextUpIndex"),
      nextUpSets = int("nextUpSets"),
      nextUpLoad = (map["nextUpLoad"] as? String)?.takeIf { it.isNotBlank() },
      effortUntil = ((map["effortAsk"] as? Map<*, *>)?.get("until") as? Number)?.toLong(),
      accent = color(map["accent"]),
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
