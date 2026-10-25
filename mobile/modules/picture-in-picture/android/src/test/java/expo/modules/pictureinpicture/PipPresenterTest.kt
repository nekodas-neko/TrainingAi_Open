package expo.modules.pictureinpicture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #3064 and #3266: what the native PiP window shows from the shared status, and #2908's gate. */
class PipPresenterTest {
  private val t0 = 1_792_000_000_000L
  private val resting = PipStatus(
    exerciseName = "Bench press", phase = "resting", sets = 4, setsDone = 2, load = "80 kg × 8",
    restStartedAt = t0, restEndsAt = t0 + 90_000,
  )
  private val working = PipStatus(
    exerciseName = "Bench press", phase = "working", sets = 4, setsDone = 2,
    load = "80 kg × 8", setStartedAt = t0,
    setColors = listOf("#60a5fa", "#f472b6", "#34d399", "#fbbf24"),
  )
  private val reading = PipHeartRate(128, "Aerobic", "#eab308", t0)
  private fun asWorking(frame: PipFrame) = frame as PipFrame.Working
  private fun asResting(frame: PipFrame) = frame as PipFrame.Resting

  @Test fun `only an active workout phase opens the window, a pause included`() {
    for (phase in listOf("rest", "set", "complete", "summary", "paused")) assertTrue(phase, PipPolicy.isActivePhase(phase))
    for (phase in listOf(PipPolicy.IDLE, "pre", "done", "", null)) assertFalse("$phase", PipPolicy.isActivePhase(phase))
  }

  @Test fun `the system enters on its own only for a set, a rest or a pause`() {
    for (phase in listOf("set", "rest", "paused")) assertTrue(phase, PipPolicy.autoEnters(phase))
    for (phase in listOf("complete", "summary", "pre", "done", PipPolicy.IDLE, "", null)) {
      assertFalse("$phase", PipPolicy.autoEnters(phase))
    }
  }

  @Test fun `the window is portrait while a set runs and square otherwise`() {
    assertEquals(3 to 4, PipPolicy.aspect("set"))
    for (phase in listOf("rest", "paused", "complete", "summary", PipPolicy.IDLE, null)) assertEquals("$phase", 1 to 1, PipPolicy.aspect(phase))
  }

  @Test fun `a set shows its load split into weight, unit and reps, and the set it is on`() {
    val frame = asWorking(PipPresenter.present("set", working, "#34d399", t0 + 90_000))
    assertEquals("Set 3 of 4", frame.setLabel)
    assertEquals("80", frame.weight)
    assertEquals("kg", frame.unit)
    assertEquals("× 8", frame.reps)
    assertEquals(t0, frame.countsFrom)
    assertEquals(4, frame.sets)
    assertEquals(2, frame.setsDone)
    assertEquals("#34d399", frame.setColor)
    assertEquals(working.setColors, frame.setColors)
  }

  @Test fun `an unknown load shows nothing, never a made-up one`() {
    val frame = asWorking(PipPresenter.present("set", working.copy(load = null), null, t0))
    assertNull(frame.weight)
    assertNull(frame.unit)
    assertNull(frame.reps)
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "Squat", "phase" to "working", "load" to " "))?.load)
    // A set with no start stands at 0:00 rather than guessing one.
    assertNull(asWorking(PipPresenter.present("set", working.copy(setStartedAt = null), null, t0)).countsFrom)
  }

  @Test fun `a load splits only into what it says`() {
    assertEquals(PipPresenter.LoadParts("80", "kg", "× 8"), PipPresenter.splitLoad("80 kg × 8"))
    assertEquals(PipPresenter.LoadParts("82.5", "kg", null), PipPresenter.splitLoad("82.5 kg"))
    assertEquals(PipPresenter.LoadParts("135", "lb", "× 5"), PipPresenter.splitLoad("135 lb × 5"))
    assertEquals(PipPresenter.LoadParts(null, null, "8 reps"), PipPresenter.splitLoad("8 reps"))
    assertEquals(PipPresenter.LoadParts("Bodyweight", null, "× 12"), PipPresenter.splitLoad("Bodyweight × 12"))
    assertEquals(PipPresenter.LoadParts(null, null, null), PipPresenter.splitLoad(null))
    assertEquals(PipPresenter.LoadParts(null, null, null), PipPresenter.splitLoad("  "))
  }

  @Test fun `a rest counts down to its target and the ring empties`() {
    val frame = asResting(PipPresenter.present("rest", resting, null, t0 + 45_500))
    assertEquals(t0, frame.countsFrom)
    assertEquals(90L, frame.targetSec)
    assertFalse(frame.over)
    assertEquals(0.5f, frame.fraction, 0.001f)
    assertEquals("REST · NEXT 3/4", frame.eyebrow)
    assertEquals("80 kg × 8", frame.load)
    // The clock reads the time left.
    assertEquals("0:45", PipPresenter.restClockText(45, frame.targetSec))
    assertEquals("1:30", PipPresenter.restClockText(0, frame.targetSec))
  }

  @Test fun `past its target the rest is over, the ring is full and the clock counts up from zero`() {
    val frame = asResting(PipPresenter.present("rest", resting, null, t0 + 102_000))
    assertTrue(frame.over)
    assertEquals(1f, frame.fraction, 0f)
    assertEquals("REST OVER", frame.eyebrow)
    assertEquals("+0:12", PipPresenter.restClockText(102, frame.targetSec))
    assertTrue(asResting(PipPresenter.present("rest", resting, null, t0 + 90_000)).over)
    assertFalse(asResting(PipPresenter.present("rest", resting, null, t0 + 89_999)).over)
    assertEquals("+0:00", PipPresenter.restClockText(90, 90))
  }

  @Test fun `plus 30 seconds moves the target and the ring follows`() {
    val longer = resting.copy(restEndsAt = t0 + 120_000)
    val frame = asResting(PipPresenter.present("rest", longer, null, t0 + 60_000))
    assertEquals(120L, frame.targetSec)
    assertEquals(0.5f, frame.fraction, 0.001f)
    assertFalse(asResting(PipPresenter.present("rest", longer, null, t0 + 100_000)).over)
  }

  @Test fun `a rest with no target counts up from the last set, and with no start stands still`() {
    val untimed = asResting(PipPresenter.present("rest", resting.copy(restEndsAt = null), null, t0 + 30_000))
    assertNull(untimed.targetSec)
    assertFalse(untimed.over)
    assertEquals(0f, untimed.fraction, 0f)
    assertEquals(t0, untimed.countsFrom)
    assertEquals("0:30", PipPresenter.restClockText(30, untimed.targetSec))
    val unanchored = asResting(PipPresenter.present("rest", resting.copy(restStartedAt = null), null, t0 + 30_000))
    assertNull(unanchored.countsFrom)
    assertNull(unanchored.targetSec)
  }

  @Test fun `after the last set the rest says done and names no next set`() {
    val frame = asResting(PipPresenter.present("complete", resting.copy(setsDone = 4), null, t0 + 10_000))
    assertEquals("REST · DONE", frame.eyebrow)
    assertNull(frame.load)
  }

  @Test fun `the summary times its last-set rest, then shows the placeholder with Next`() {
    val summaryRest = asResting(PipPresenter.present("summary", resting.copy(setsDone = 4), null, t0 + 10_000))
    assertEquals("REST · DONE", summaryRest.eyebrow)
    assertEquals(
      PipFrame.Placeholder("Bench press", true, "Barbell row"),
      PipPresenter.present("summary", resting.copy(phase = "ready", restEndsAt = null, nextUp = "Barbell row"), null, t0),
    )
    assertEquals(
      PipFrame.Placeholder("Bench press", true),
      PipPresenter.present("summary", resting.copy(phase = "ready", restEndsAt = null), null, t0),
    )
  }

  @Test fun `a pause shows how long it has lasted and what is left of the rest`() {
    val paused = resting.copy(phase = "paused", pausedAt = t0 + 36_000)
    val frame = PipPresenter.present("paused", paused, null, t0 + 100_000) as PipFrame.Paused
    assertEquals(t0 + 36_000, frame.countsFrom)
    assertEquals("Bench press · rest 0:54 left", frame.caption)
    // A pause during a set holds no rest.
    val set = PipPresenter.present("paused", working.copy(phase = "paused", pausedAt = t0), null, t0) as PipFrame.Paused
    assertEquals("Bench press", set.caption)
    // A rest already over when paused has nothing left to show.
    val over = PipPresenter.present("paused", resting.copy(phase = "paused", pausedAt = t0 + 95_000), null, t0) as PipFrame.Paused
    assertEquals("Bench press", over.caption)
  }

  @Test fun `the workout's end and a missing status show a placeholder without Next, never a blank window`() {
    assertEquals(
      PipFrame.Placeholder("Upper body", false),
      PipPresenter.present("done", PipStatus("Upper body", "ready"), null, t0),
    )
    assertEquals(PipFrame.Placeholder("", false), PipPresenter.present("rest", null, null, t0))
    assertEquals(PipFrame.Placeholder("", false), PipPresenter.present("paused", null, null, t0))
  }

  @Test fun `a heart rate shows fresh, shows a dash once stale, and nothing with no strap`() {
    assertNull(PipPresenter.present("set", working, null, t0).let { asWorking(it).hr })
    val withHr = working.copy(hr = reading)
    assertEquals(PipHeartView(128, "Aerobic", "#eab308"), asWorking(PipPresenter.present("set", withHr, null, t0 + 7_999)).hr)
    assertEquals(PipHeartView(null, "Aerobic", "#eab308"), asWorking(PipPresenter.present("set", withHr, null, t0 + 8_001)).hr)
    assertEquals(PipHeartView(128, "Aerobic", "#eab308"), asResting(PipPresenter.present("rest", resting.copy(hr = reading), null, t0 + 1_000)).hr)
  }

  @Test fun `the buttons per phase are at most three, the main one in the middle`() {
    fun actions(phase: String, status: PipStatus? = null) = PipPresenter.buttons(phase, status).map { it.action }
    assertEquals(listOf("repsDown", "log", "repsUp"), actions("set"))
    assertEquals(listOf("restPlus", "log", "pause"), actions("rest", resting))
    assertEquals(listOf("log", "pause"), actions("rest", resting.copy(restEndsAt = null)))
    assertEquals(listOf("resume"), actions("paused"))
    assertEquals(listOf("log"), actions("complete"))
    assertEquals(listOf("log"), actions("summary"))
    assertEquals(emptyList<String>(), actions("pre"))
    assertEquals(emptyList<String>(), actions(PipPolicy.IDLE))
    for (phase in listOf("set", "rest", "paused", "complete", "summary")) {
      assertTrue(phase, PipPresenter.buttons(phase, resting).size <= PipPolicy.MAX_ACTIONS)
    }
    assertEquals(listOf("Start set"), PipPresenter.buttons("rest", resting).filter { it.action == "log" }.map { it.label })
  }

  @Test fun `the system is told the exercise and where the set is`() {
    assertEquals("Bench press", PipPresenter.title(working))
    assertNull(PipPresenter.title(null))
    assertNull(PipPresenter.title(working.copy(exerciseName = " ")))
    assertEquals("Set 3 of 4", PipPresenter.subtitle("set", working))
    assertEquals("Resting", PipPresenter.subtitle("rest", resting))
    assertEquals("Paused", PipPresenter.subtitle("paused", resting))
    assertNull(PipPresenter.subtitle("summary", resting))
    assertNull(PipPresenter.subtitle("set", null))
  }

  @Test fun `wall time maps onto the chronometer's elapsed-realtime base`() {
    // 45 s ago on the wall clock is 45 s before now on the elapsed clock.
    assertEquals(1_000_000L - 45_000, PipPresenter.elapsedBase(t0 - 45_000, t0, 1_000_000L))
    assertEquals(PipPresenter.seconds(t0, t0 + 45_999), 45L)
    assertEquals(PipPresenter.seconds(t0, t0 - 5_000), 0L)
    assertEquals(PipPresenter.seconds(null, t0), 0L)
  }

  @Test fun `times read m colon ss with minutes unbounded`() {
    assertEquals("0:05", PipPresenter.formatTime(5))
    assertEquals("1:30", PipPresenter.formatTime(90))
    assertEquals("75:00", PipPresenter.formatTime(4_500))
    assertEquals("0:00", PipPresenter.formatTime(-3))
  }

  @Test fun `the JS payload is read, and a malformed one is refused`() {
    val read = PipPresenter.fromMap(
      mapOf(
        "workoutId" to "w1", "sessionName" to "Upper body", "exerciseName" to "Bench press",
        "phase" to "working", "nextSet" to 3.0, "sets" to 4.0, "setsDone" to 2.0, "load" to "80 kg × 8",
        "restEndsAt" to null, "label" to null, "startedAt" to t0.toDouble(), "setStartedAt" to t0.toDouble(),
        "restStartedAt" to null, "nextUp" to null, "pausedAt" to null,
        "hr" to mapOf("bpm" to 128.0, "zoneName" to "Aerobic", "zoneColor" to "#eab308", "at" to t0.toDouble()),
        "setColors" to listOf("#60a5fa", "oklch(1 0 0)", "#34d399"),
      ),
    )
    assertEquals(
      PipStatus(
        "Bench press", "working", 4, 2, "80 kg × 8", t0, null, null, null, null, reading,
        listOf("#60a5fa", "#34d399"),
      ),
      read,
    )
    assertNull(PipPresenter.fromMap(null))
    assertNull(PipPresenter.fromMap(mapOf("phase" to "working")))
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "x")))
    assertNull(PipPresenter.color("oklch(1 0 0)"))
    assertNull(PipPresenter.color(null))
    assertEquals("#a78bfa", PipPresenter.color("#a78bfa"))
  }

  @Test fun `a heart rate without a bpm or a time is dropped, not guessed`() {
    val base = mapOf("exerciseName" to "Squat", "phase" to "working")
    assertNull(PipPresenter.fromMap(base + ("hr" to mapOf("zoneName" to "Light", "at" to 1.0)))?.hr)
    assertNull(PipPresenter.fromMap(base + ("hr" to mapOf("bpm" to 100.0)))?.hr)
    assertNull(PipPresenter.fromMap(base + ("hr" to "128"))?.hr)
    assertEquals(PipHeartRate(100, null, null, 1L), PipPresenter.fromMap(base + ("hr" to mapOf("bpm" to 100.0, "at" to 1.0)))?.hr)
  }
}
