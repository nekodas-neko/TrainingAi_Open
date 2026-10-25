package expo.modules.pictureinpicture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pressing Home mid-workout overflowed the stack (#3266): the big clock's tick rendered the window,
 * the render started the clock, and a Chronometer started from inside its own tick ticks again.
 */
class PipClockGateTest {
  /**
   * android.widget.Chronometer's start / setBase / updateRunning, in AOSP's order: the tick is
   * dispatched before mRunning is set, and setBase dispatches one too.
   */
  private class FakeChronometer : PipClock {
    var onTick: () -> Unit = {}
    var visible = false
    var ticks = 0
    var posted = 0
    private var started = false
    private var running = false
    var base = 0L
      private set

    override fun start() {
      started = true
      updateRunning()
    }

    override fun stop() {
      started = false
      updateRunning()
    }

    override fun setBase(base: Long) {
      this.base = base
      dispatchTick()
    }

    /** onWindowVisibilityChanged: the window became visible, as on entering picture-in-picture. */
    fun show() {
      visible = true
      updateRunning()
    }

    /** The tick runnable posted for the next second. */
    fun nextSecond() {
      if (running) {
        dispatchTick()
        posted++
      }
    }

    private fun updateRunning() {
      val now = visible && started
      if (now != running) {
        if (now) {
          dispatchTick()
          posted++
        }
        running = now
      }
    }

    private fun dispatchTick() {
      ticks++
      onTick()
    }
  }

  /** The view's wiring: the big clock's tick renders, and a render counts the clock from a base. */
  private fun window(clock: FakeChronometer, gate: PipClockGate, base: () -> Long?) {
    clock.onTick = { gate.render { gate.count(clock, base()) } }
  }

  @Test fun `the fake reproduces the crash when a tick starts its own clock`() {
    val clock = FakeChronometer()
    clock.onTick = { clock.start() }
    clock.start()
    var overflowed = false
    try {
      clock.show()
    } catch (e: StackOverflowError) {
      overflowed = true
    }
    assertTrue("a start() from inside its own tick recurses", overflowed)
  }

  @Test fun `showing the window renders once per tick and never recurses`() {
    val clock = FakeChronometer()
    val gate = PipClockGate()
    window(clock, gate) { 1_000L }
    gate.render { gate.count(clock, 1_000L) }
    clock.show()
    assertEquals(1, clock.posted)
    repeat(60) { clock.nextSecond() }
    assertEquals("one tick runnable, posted once a second", 61, clock.posted)
    assertEquals(1_000L, clock.base)
  }

  @Test fun `a render already visible starts the clock once, with its base`() {
    val clock = FakeChronometer().apply { visible = true }
    val gate = PipClockGate()
    window(clock, gate) { 5_000L }
    gate.render { gate.count(clock, 5_000L) }
    // setBase's tick and the start's tick each come back into a render, which is skipped.
    assertEquals(2, clock.ticks)
    assertEquals(1, clock.posted)
    gate.render { gate.count(clock, 5_000L) }
    assertEquals("the same base and a started clock do nothing", 2, clock.ticks)
  }

  @Test fun `a base moves only past the slack, and null stops the clock`() {
    val clock = FakeChronometer().apply { visible = true }
    val gate = PipClockGate(slackMs = 250L)
    assertTrue(gate.count(clock, 1_000L))
    assertFalse(gate.count(clock, 1_200L))
    assertTrue(gate.count(clock, 9_000L))
    assertEquals(9_000L, clock.base)
    assertFalse(gate.count(clock, null))
    // Started again after a stop, as when a new rest follows a set with no start.
    val before = clock.posted
    gate.count(clock, 9_000L)
    assertEquals(before + 1, clock.posted)
  }

  @Test fun `a render inside a render is skipped, and the gate opens again after a failure`() {
    val gate = PipClockGate()
    var outer = 0
    var inner = 0
    gate.render {
      outer++
      gate.render { inner++ }
    }
    assertEquals(1, outer)
    assertEquals(0, inner)
    try {
      gate.render { error("drawing failed") }
    } catch (_: IllegalStateException) {}
    gate.render { inner++ }
    assertEquals(1, inner)
  }
}
