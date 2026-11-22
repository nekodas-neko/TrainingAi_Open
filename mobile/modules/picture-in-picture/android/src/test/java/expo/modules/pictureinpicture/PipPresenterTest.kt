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
  )
  private val reading = PipHeartRate(128, "Aerobic", "#eab308", t0)

  @Test fun `only an active workout phase opens the window, a pause included`() {
    for (phase in listOf("ready", "rest", "set", "complete", "summary", "paused")) assertTrue(phase, PipPolicy.isActivePhase(phase))
    for (phase in listOf(PipPolicy.IDLE, "pre", "done", "", null)) assertFalse("$phase", PipPolicy.isActivePhase(phase))
  }

  @Test fun `leaving the app enters by hand only where the system does not enter on its own`() {
    // Android 12 and later: a set, a rest and a pause auto-enter, so no manual entry.
    for (phase in listOf("set", "ready", "rest", "paused")) assertFalse(phase, PipPolicy.entersOnLeave(phase, 34))
    for (phase in listOf("complete", "summary")) assertTrue(phase, PipPolicy.entersOnLeave(phase, 34))
    // Before Android 12 there is no auto-enter, so every active phase enters by hand.
    for (phase in listOf("set", "ready", "rest", "paused", "complete", "summary")) assertTrue(phase, PipPolicy.entersOnLeave(phase, 30))
    // No workout, no window.
    assertFalse(PipPolicy.entersOnLeave(PipPolicy.IDLE, 34))
    assertFalse(PipPolicy.entersOnLeave(null, 30))
  }

  @Test fun `the system enters on its own only for a set, a rest, ready or a pause`() {
    for (phase in listOf("set", "ready", "rest", "paused")) assertTrue(phase, PipPolicy.autoEnters(phase))
    for (phase in listOf("complete", "summary", "pre", "done", PipPolicy.IDLE, "", null)) {
      assertFalse("$phase", PipPolicy.autoEnters(phase))
    }
  }

  @Test fun `the buttons per phase are at most three, the main one in the middle`() {
    fun actions(phase: String, status: PipStatus? = null) = PipPresenter.buttons(phase, status, t0).map { it.action }
    assertEquals(listOf("repsDown", "log", "repsUp"), actions("set"))
    assertEquals(listOf("log", "pause"), actions("rest", resting))
    assertEquals(listOf("log", "pause"), actions("rest", resting.copy(restEndsAt = null)))
    assertEquals(listOf("log", "pause"), actions("ready", resting.copy(restStartedAt = null, restEndsAt = null)))
    assertEquals(listOf("resume"), actions("paused"))
    assertEquals(listOf("log"), actions("complete"))
    assertEquals(listOf("log"), actions("summary"))
    assertEquals(emptyList<String>(), actions("pre"))
    assertEquals(emptyList<String>(), actions(PipPolicy.IDLE))
    for (phase in listOf("set", "ready", "rest", "paused", "complete", "summary")) {
      assertTrue(phase, PipPresenter.buttons(phase, resting, t0).size <= PipPolicy.MAX_ACTIONS)
    }
    assertEquals(listOf("Start set"), PipPresenter.buttons("rest", resting, t0).filter { it.action == "log" }.map { it.label })
  }

  @Test fun `the system is told the exercise and where the set is`() {
    assertEquals("Bench press", PipPresenter.title(working))
    assertNull(PipPresenter.title(null))
    assertNull(PipPresenter.title(working.copy(exerciseName = " ")))
    assertEquals("Set 3 of 4", PipPresenter.subtitle("set", working, t0))
    assertEquals("Resting", PipPresenter.subtitle("rest", resting, t0))
    assertEquals("Ready", PipPresenter.subtitle("ready", resting, t0))
    assertEquals("Paused", PipPresenter.subtitle("paused", resting, t0))
    assertNull(PipPresenter.subtitle("summary", resting, t0))
    assertNull(PipPresenter.subtitle("set", null, t0))
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
        // #3734 and #3745.
        "exerciseIndex" to 2.0, "exerciseCount" to 5.0, "workoutFrom" to (t0 - 600_000).toDouble(),
        "nextUpIndex" to 3.0, "nextUpSets" to 3.0, "nextUpLoad" to "20 kg × 12",
        "effortAsk" to mapOf("until" to (t0 + 20_000).toDouble(), "answer" to 0.0),
        "accent" to "#00c84e",
      ),
    )
    assertEquals(
      PipStatus(
        "Bench press", "working", 4, 2, "80 kg × 8", t0, null, null, null, null, reading,
        sessionName = "Upper body", exerciseIndex = 2, exerciseCount = 5, workoutFrom = t0 - 600_000,
        nextUpIndex = 3, nextUpSets = 3, nextUpLoad = "20 kg × 12", effortUntil = t0 + 20_000,
        effortAnswer = 0, accent = "#00c84e",
      ),
      read,
    )
    // An older app's payload, without the new keys, still reads.
    val old = PipPresenter.fromMap(mapOf("exerciseName" to "Squat", "phase" to "resting"))!!
    assertEquals(listOf(0, 0, null, null, null, null), listOf(old.exerciseIndex, old.exerciseCount, old.workoutFrom, old.effortUntil, old.effortAnswer, old.accent))
    // An answer outside the three is not shown as one.
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "Squat", "phase" to "resting", "effortAsk" to mapOf("until" to 1.0, "answer" to 2.0)))!!.effortAnswer)
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "Squat", "phase" to "ready", "accent" to "green"))!!.accent)
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
