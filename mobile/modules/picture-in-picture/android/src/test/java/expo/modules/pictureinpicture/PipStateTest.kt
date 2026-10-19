package expo.modules.pictureinpicture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #3064: what the native PiP window shows, and #2908's gate on when it opens. */
class PipStateTest {
  private val t0 = 1_792_000_000_000L
  private val rest = PipWindow(
    kind = "timer", exerciseName = "Bench press", phase = "rest",
    currentSet = 2, sets = 3, restTargetSec = 90, restStartMs = t0,
  )

  @Test fun `only an active workout phase opens the window`() {
    for (phase in listOf("rest", "set", "complete", "summary")) assertTrue(phase, PipPolicy.isActivePhase(phase))
    for (phase in listOf(PipPolicy.IDLE, "pre", "done", "", null)) assertFalse("$phase", PipPolicy.isActivePhase(phase))
  }

  @Test fun `a rest counts up against its target`() {
    val clock = PipState.clock(rest, t0 + 45_500)
    assertEquals(45L, clock.seconds)
    assertFalse(clock.overTime)
    assertEquals("/ 1:30", clock.target)
    assertEquals(0.5f, clock.fraction, 0.001f)
    assertEquals("rest · 2/3", clock.label)
  }

  @Test fun `past its target the rest turns over and shows the overrun`() {
    val clock = PipState.clock(rest, t0 + 100_000)
    assertTrue(clock.overTime)
    assertEquals("+0:10", clock.target)
    assertEquals(1f, clock.fraction, 0f)
    assertTrue(PipState.clock(rest, t0 + 90_000).overTime)
  }

  @Test fun `a rest with no target or anchor shows elapsed only`() {
    val untimed = rest.copy(restTargetSec = 0)
    assertNull(PipState.clock(untimed, t0 + 30_000).target)
    assertEquals(0f, PipState.clock(untimed, t0 + 30_000).fraction, 0f)
    assertEquals(0L, PipState.clock(rest.copy(restStartMs = null), t0 + 30_000).seconds)
    assertEquals("done", PipState.clock(rest.copy(currentSet = 3), t0).label)
  }

  @Test fun `a set counts up to a three-minute arc`() {
    val set = rest.copy(phase = "set", currentSet = 1, restStartMs = null, setStartMs = t0)
    val clock = PipState.clock(set, t0 + 90_000)
    assertEquals(90L, clock.seconds)
    assertEquals("set 2/3", clock.label)
    assertEquals(0.5f, clock.fraction, 0.001f)
    assertNull(clock.target)
    assertEquals(1f, PipState.clock(set, t0 + 400_000).fraction, 0f)
  }

  @Test fun `times read m colon ss with minutes unbounded`() {
    assertEquals("0:05", PipState.formatTime(5))
    assertEquals("1:30", PipState.formatTime(90))
    assertEquals("75:00", PipState.formatTime(4_500))
    assertEquals("0:00", PipState.formatTime(-3))
  }

  @Test fun `the JS payload is read, and a malformed one is refused`() {
    val read = PipState.fromMap(
      mapOf(
        "kind" to "timer", "exerciseName" to "Bench press", "phase" to "set", "currentSet" to 1.0,
        "sets" to 3.0, "restTargetSec" to 0.0, "restStartMs" to null, "setStartMs" to t0.toDouble(),
        "load" to "60 kg × 8", "setColor" to "#a78bfa",
      ),
    )
    assertEquals(
      PipWindow("timer", "Bench press", "set", 1, 3, 0, null, t0, "60 kg × 8", "#a78bfa"),
      read,
    )
    assertEquals(
      PipWindow("placeholder", "Bench press"),
      PipState.fromMap(mapOf("kind" to "placeholder", "exerciseName" to "Bench press")),
    )
    assertNull(PipState.fromMap(null))
    assertNull(PipState.fromMap(mapOf("kind" to "timer")))
    assertNull(PipState.fromMap(mapOf("kind" to "other", "exerciseName" to "x")))
    assertNull(PipState.fromMap(mapOf("kind" to "timer", "exerciseName" to "x", "setColor" to "oklch(1 0 0)"))?.setColor)
  }
}
