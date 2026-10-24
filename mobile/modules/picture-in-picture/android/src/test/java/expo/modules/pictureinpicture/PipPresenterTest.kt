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
    exerciseName = "Bench press", phase = "resting", sets = 3, setsDone = 2,
    restStartedAt = t0, restEndsAt = t0 + 90_000,
  )
  private val working = PipStatus(
    exerciseName = "Bench press", phase = "working", sets = 3, setsDone = 1,
    load = "80 kg × 8", setStartedAt = t0,
  )
  private fun timer(frame: PipFrame) = frame as PipFrame.Timer

  @Test fun `only an active workout phase opens the window`() {
    for (phase in listOf("rest", "set", "complete", "summary")) assertTrue(phase, PipPolicy.isActivePhase(phase))
    for (phase in listOf(PipPolicy.IDLE, "pre", "done", "", null)) assertFalse("$phase", PipPolicy.isActivePhase(phase))
  }

  @Test fun `a rest counts up from its start against its target`() {
    val frame = timer(PipPresenter.present("rest", resting, null, t0 + 45_500))
    assertTrue(frame.rest)
    assertEquals(t0, frame.countsFrom)
    assertFalse(frame.overTime)
    assertEquals("/ 1:30", frame.target)
    assertEquals(0.5f, frame.fraction, 0.001f)
    assertEquals("rest · 2/3", frame.label)
    assertNull(frame.load)
  }

  @Test fun `past its target the rest is over and its caption counts up from the rest's end`() {
    val frame = timer(PipPresenter.present("rest", resting, null, t0 + 100_000))
    assertTrue(frame.overTime)
    assertEquals(t0 + 90_000, frame.overFrom)
    assertEquals(1f, frame.fraction, 0f)
    assertTrue(timer(PipPresenter.present("rest", resting, null, t0 + 90_000)).overTime)
    assertFalse(timer(PipPresenter.present("rest", resting, null, t0 + 89_999)).overTime)
  }

  @Test fun `a rest with no target counts up from the last set, and with no start stands still`() {
    val untimed = timer(PipPresenter.present("rest", resting.copy(restEndsAt = null), null, t0 + 30_000))
    assertNull(untimed.target)
    assertNull(untimed.overFrom)
    assertEquals(0f, untimed.fraction, 0f)
    assertEquals(t0, untimed.countsFrom)
    val unanchored = timer(PipPresenter.present("rest", resting.copy(restStartedAt = null), null, t0 + 30_000))
    assertNull(unanchored.countsFrom)
    assertNull(unanchored.target)
    assertEquals("done", timer(PipPresenter.present("complete", resting.copy(setsDone = 3), null, t0)).label)
  }

  @Test fun `a set counts up to a three-minute arc in its colour, with its load`() {
    val frame = timer(PipPresenter.present("set", working, "#a78bfa", t0 + 90_000))
    assertFalse(frame.rest)
    assertEquals(t0, frame.countsFrom)
    assertEquals("set 2/3", frame.label)
    assertEquals(0.5f, frame.fraction, 0.001f)
    assertNull(frame.target)
    assertEquals("80 kg × 8", frame.load)
    assertEquals("#a78bfa", frame.setColor)
    assertEquals(1f, timer(PipPresenter.present("set", working, null, t0 + 400_000)).fraction, 0f)
  }

  @Test fun `an unknown load shows nothing, never a made-up one`() {
    assertNull(timer(PipPresenter.present("set", working.copy(load = null), null, t0)).load)
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "Squat", "phase" to "working", "load" to " "))?.load)
    // A set with no start stands at 0:00 rather than guessing one.
    val unstarted = timer(PipPresenter.present("set", working.copy(setStartedAt = null), null, t0 + 60_000))
    assertNull(unstarted.countsFrom)
    assertEquals(0f, unstarted.fraction, 0f)
  }

  @Test fun `the summary times its last-set rest, then shows the placeholder with Next`() {
    val summaryRest = timer(PipPresenter.present("summary", resting.copy(setsDone = 3), null, t0 + 10_000))
    assertEquals("done", summaryRest.label)
    assertEquals(
      PipFrame.Placeholder("Bench press", true),
      PipPresenter.present("summary", resting.copy(phase = "ready", restEndsAt = null), null, t0),
    )
  }

  @Test fun `the workout's end and a missing status show a placeholder without Next, never a blank window`() {
    assertEquals(
      PipFrame.Placeholder("Upper body", false),
      PipPresenter.present("done", PipStatus("Upper body", "ready"), null, t0),
    )
    assertEquals(PipFrame.Placeholder("", false), PipPresenter.present("rest", null, null, t0))
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
        "phase" to "working", "nextSet" to 2.0, "sets" to 3.0, "setsDone" to 1.0, "load" to "80 kg × 8",
        "restEndsAt" to null, "label" to null, "startedAt" to t0.toDouble(), "setStartedAt" to t0.toDouble(),
        "restStartedAt" to null, "nextUp" to null, "hr" to null,
      ),
    )
    assertEquals(PipStatus("Bench press", "working", 3, 1, "80 kg × 8", t0, null, null), read)
    assertNull(PipPresenter.fromMap(null))
    assertNull(PipPresenter.fromMap(mapOf("phase" to "working")))
    assertNull(PipPresenter.fromMap(mapOf("exerciseName" to "x")))
    assertNull(PipPresenter.color("oklch(1 0 0)"))
    assertNull(PipPresenter.color(null))
    assertEquals("#a78bfa", PipPresenter.color("#a78bfa"))
  }
}
