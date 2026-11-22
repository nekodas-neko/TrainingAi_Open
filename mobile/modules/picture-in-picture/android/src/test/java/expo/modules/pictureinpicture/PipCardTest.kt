package expo.modules.pictureinpicture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #3734, option A: one 3:4 card in every state. The six states of the build spec, each mapped from
 * the app's phase and the workout status payload. #3745: the window's three answer buttons.
 */
class PipCardTest {
  private val t0 = 1_792_000_000_000L
  private val accent = "#3b82f6"
  private val base = PipStatus(
    exerciseName = "Incline press", phase = "ready", sets = 2, setsDone = 0, load = "27.5 kg × 7",
    sessionName = "Push A", exerciseIndex = 2, exerciseCount = 5, workoutFrom = t0 - 600_000,
    accent = accent,
  )
  private fun card(phase: String, status: PipStatus, now: Long = t0) =
    PipPresenter.present(phase, status, now) as PipFrame.Card

  @Test fun `the window is 3 to 4 in every state`() {
    for (phase in listOf("ready", "set", "rest", "complete", "summary", "paused", "pre", "done", PipPolicy.IDLE, null)) {
      assertEquals("$phase", 3 to 4, PipPolicy.aspect(phase))
    }
  }

  @Test fun `Ready counts the workout's time, in grey, with the first set's load`() {
    val c = card("ready", base, t0)
    assertEquals(PipCardState.READY, c.state)
    assertEquals(PipPresenter.READY_COLOR, c.color)
    assertEquals("READY", c.stateWord)
    assertEquals("Set 1 of 2", c.setLine)
    assertEquals(t0 - 600_000, c.countsFrom)
    assertNull(c.targetSec)
    assertEquals("workout time", c.clockLabel)
    assertNull(c.bar)
    assertEquals("Incline press", c.name)
    assertEquals("Exercise 2 of 5 · Push A", c.where)
    assertEquals("27.5 kg × 7", c.load)
    assertEquals("first set", c.loadLabel)
    assertEquals(0, c.current)
  }

  @Test fun `Lifting counts this set up, in green, with no load label, and pulses`() {
    val c = card("set", base.copy(phase = "working", setStartedAt = t0 - 20_000))
    assertEquals(PipCardState.LIFTING, c.state)
    assertEquals(PipPresenter.LIFT_COLOR, c.color)
    assertEquals("Set 1 of 2", c.setLine)
    assertEquals(t0 - 20_000, c.countsFrom)
    assertEquals("this set", c.clockLabel)
    assertNull(c.loadLabel)
    assertTrue(c.pulse)
    // A set with no start falls back to the workout's clock, which always counts.
    val untimed = card("set", base.copy(phase = "working"))
    assertEquals(t0 - 600_000, untimed.countsFrom)
    assertEquals("workout time", untimed.clockLabel)
  }

  @Test fun `the set bar is one colour at five sets with four done`() {
    val five = base.copy(phase = "resting", sets = 5, setsDone = 4, restStartedAt = t0, restEndsAt = t0 + 90_000)
    val c = card("rest", five, t0)
    assertEquals(accent, c.accent)
    // Four done and the next set in the accent, nothing past it: no per-set hue.
    val colors = (0 until 5).map { PipPresenter.segmentColor(it, c.setsDone, c.current, c.accent) }
    assertEquals(listOf(accent, accent, accent, accent, accent), colors)
    // At the same five sets with two done, the sets still to come are the muted track (null).
    val early = card("rest", five.copy(setsDone = 2), t0)
    assertEquals(
      listOf(accent, accent, accent, null, null),
      (0 until 5).map { PipPresenter.segmentColor(it, early.setsDone, early.current, early.accent) },
    )
    // An app that sends no accent draws the window's own green.
    assertEquals(PipPresenter.DEFAULT_ACCENT, card("rest", five.copy(accent = null), t0).accent)
    // The lifting card keeps the accent for its running set rather than the lime state colour.
    val lifting = card("set", five.copy(phase = "working", setStartedAt = t0), t0)
    assertEquals(accent, lifting.accent)
    assertEquals(true, lifting.pulse)
  }

  @Test fun `Resting counts the rest down in the accent and the bar drains`() {
    val resting = base.copy(phase = "resting", setsDone = 1, restStartedAt = t0, restEndsAt = t0 + 120_000)
    val c = card("rest", resting, t0 + 30_000)
    assertEquals(PipCardState.RESTING, c.state)
    assertEquals(accent, c.color)
    assertEquals("Next 2 of 2", c.setLine)
    assertEquals(t0, c.countsFrom)
    assertEquals(120L, c.targetSec)
    assertEquals("left of 2:00 rest", c.clockLabel)
    assertEquals(0.75f, c.bar!!, 0.001f)
    assertEquals("next set", c.loadLabel)
    assertEquals(1, c.current)
    assertEquals(1, c.setsDone)
    // An app that sends no accent gets the window's own green.
    assertEquals(PipPresenter.DEFAULT_ACCENT, card("rest", resting.copy(accent = null), t0).color)
  }

  @Test fun `Rest over turns red, counts past the rest, and the bar is full`() {
    val resting = base.copy(phase = "resting", setsDone = 1, restStartedAt = t0, restEndsAt = t0 + 120_000)
    val c = card("rest", resting, t0 + 132_000)
    assertEquals(PipCardState.REST_OVER, c.state)
    assertEquals(PipPresenter.OVER_COLOR, c.color)
    assertEquals("REST OVER", c.stateWord)
    assertEquals("Next 2 of 2", c.setLine)
    assertEquals("past the 2:00 rest", c.clockLabel)
    assertEquals(1f, c.bar!!, 0f)
    assertEquals("+0:12", PipPresenter.restClockText(132, c.targetSec))
  }

  @Test fun `an untimed rest counts up from the last set, with no bar`() {
    val c = card("rest", base.copy(phase = "ready", setsDone = 1, restStartedAt = t0), t0 + 5_000)
    assertEquals(PipCardState.RESTING, c.state)
    assertEquals(t0, c.countsFrom)
    assertNull(c.targetSec)
    assertEquals("since the last set", c.clockLabel)
    assertNull(c.bar)
  }

  @Test fun `Exercise done counts the rest before the next exercise and shows what comes next`() {
    val done = base.copy(
      phase = "resting", setsDone = 2, load = null, restStartedAt = t0, restEndsAt = t0 + 90_000,
      nextUp = "Cable fly", nextUpIndex = 3, nextUpSets = 3, nextUpLoad = "12.5 kg × 12",
    )
    val c = card("summary", done, t0 + 45_000)
    assertEquals(PipCardState.EXERCISE_DONE, c.state)
    assertEquals(accent, c.color)
    assertEquals("", c.setLine)
    assertEquals("left of 1:30 rest", c.clockLabel)
    assertEquals(0.5f, c.bar!!, 0.001f)
    assertEquals("Next: Cable fly", c.name)
    assertEquals("Exercise 3 of 5 · Push A", c.where)
    assertEquals("12.5 kg × 12", c.load)
    assertEquals("first set", c.loadLabel)
    // All of the next exercise's segments are dim.
    assertEquals(3, c.sets)
    assertEquals(0, c.setsDone)
    assertNull(c.current)
    // Past its rest, it turns over like any rest.
    assertEquals(PipCardState.REST_OVER, card("summary", done, t0 + 95_000).state)
    // With nothing timed, the workout's clock.
    val untimed = card("summary", done.copy(phase = "ready", restEndsAt = null), t0)
    assertEquals(t0 - 600_000, untimed.countsFrom)
    assertEquals("workout time", untimed.clockLabel)
    assertNull(untimed.bar)
  }

  @Test fun `Paused counts how long, in amber, and says what is left of the rest`() {
    val paused = base.copy(
      phase = "paused", setsDone = 1, restStartedAt = t0 - 72_000, restEndsAt = t0 + 48_000, pausedAt = t0,
    )
    val c = card("paused", paused, t0 + 30_000)
    assertEquals(PipCardState.PAUSED, c.state)
    assertEquals(PipPresenter.PAUSED_COLOR, c.color)
    assertEquals("Next 2 of 2", c.setLine)
    assertEquals(t0, c.countsFrom)
    assertEquals("paused for · 0:48 of rest left", c.clockLabel)
    assertNull(c.bar)
    assertEquals("next set", c.loadLabel)
    assertEquals("paused for", card("paused", paused.copy(restEndsAt = null), t0).clockLabel)
  }

  @Test fun `every card carries the same four facts and the heart rate`() {
    val reading = PipHeartRate(128, "Aerobic", "#eab308", t0)
    val states = listOf(
      "ready" to base,
      "set" to base.copy(phase = "working", setStartedAt = t0),
      "rest" to base.copy(phase = "resting", setsDone = 1, restStartedAt = t0, restEndsAt = t0 + 60_000),
      "paused" to base.copy(phase = "paused", setsDone = 1, pausedAt = t0),
    )
    for ((phase, status) in states) {
      val c = card(phase, status.copy(hr = reading), t0 + 1_000)
      assertEquals(phase, "Incline press", c.name)
      assertEquals(phase, "Exercise 2 of 5 · Push A", c.where)
      assertEquals(phase, "27.5 kg × 7", c.load)
      assertEquals(phase, 2, c.sets)
      assertEquals(phase, PipHeartView(128, "Aerobic", "#eab308"), c.hr)
    }
    // Stale: the footer says so; no strap: no footer.
    assertEquals(PipHeartView(null, "Aerobic", "#eab308"), card("ready", base.copy(hr = reading), t0 + 8_001).hr)
    assertNull(card("ready", base, t0).hr)
    // An older app that sends no place shows the session alone.
    assertEquals("Push A", card("ready", base.copy(exerciseIndex = 0, exerciseCount = 0), t0).where)
  }

  @Test fun `the warm-up, the review and no data show the placeholder, never a blank window`() {
    assertEquals(PipFrame.Placeholder("Upper body", false), PipPresenter.present("done", PipStatus("Upper body", "ready"), t0))
    assertEquals(PipFrame.Placeholder("Upper body", false), PipPresenter.present("pre", PipStatus("Upper body", "ready"), t0))
    assertEquals(PipFrame.Placeholder("", false), PipPresenter.present("rest", null, t0))
  }

  @Test fun `for the first seconds after the last set the buttons answer how it felt, then go back`() {
    val asked = base.copy(phase = "resting", setsDone = 2, restStartedAt = t0, restEndsAt = t0 + 90_000, effortUntil = t0 + 20_000)
    fun actions(phase: String, now: Long) = PipPresenter.buttons(phase, asked, now).map { it.action }
    assertEquals(listOf("effortEasier", "effortAsExpected", "effortHarder"), actions("summary", t0 + 1_000))
    // The answer it stands on, As expected by default, is the selected one.
    assertEquals(listOf("Easier", "As expected, selected", "Harder"), PipPresenter.buttons("summary", asked, t0).map { it.label })
    assertEquals(listOf("easier", "expectedSelected", "harder"), PipPresenter.buttons("summary", asked, t0).map { it.icon })
    assertEquals(
      listOf("Easier", "As expected", "Harder, selected"),
      PipPresenter.buttons("summary", asked.copy(effortAnswer = 1), t0).map { it.label },
    )
    assertEquals("How did it feel?", PipPresenter.subtitle("summary", asked, t0 + 1_000))
    // Then the usual Next.
    assertEquals(listOf("log"), actions("summary", t0 + 20_000))
    assertNull(PipPresenter.subtitle("summary", asked, t0 + 20_000))
    // Only after the last set: no other phase asks, whatever the payload says.
    assertEquals(listOf("log", "pause"), actions("rest", t0 + 1_000))
    assertEquals(listOf("log"), PipPresenter.buttons("summary", asked.copy(effortUntil = null), t0).map { it.action })
    assertTrue(PipPresenter.EFFORT_BUTTONS.size <= PipPolicy.MAX_ACTIONS)
  }

  @Test fun `while it asks, the card names the exercise just finished, not the next one`() {
    val asked = base.copy(
      phase = "resting", setsDone = 2, restStartedAt = t0, restEndsAt = t0 + 90_000,
      nextUp = "Cable fly", nextUpIndex = 3, nextUpSets = 3, nextUpLoad = "12.5 kg × 12",
      effortUntil = t0 + 20_000, effortAnswer = 0,
    )
    val c = card("summary", asked, t0 + 5_000)
    assertEquals("HOW DID IT FEEL?", c.stateWord)
    assertEquals("As expected", c.setLine)
    assertEquals("Incline press", c.name)
    assertEquals("Exercise 2 of 5 · Push A", c.where)
    assertEquals(2, c.sets)
    assertEquals(2, c.setsDone)
    assertNull(c.load)
    assertEquals("left of 1:30 rest", c.clockLabel)
    assertEquals("Easier than expected", card("summary", asked.copy(effortAnswer = -1), t0 + 5_000).setLine)
    // Once the window stops asking: Exercise done, and what comes next.
    val after = card("summary", asked, t0 + 20_000)
    assertEquals("EXERCISE DONE", after.stateWord)
    assertEquals("", after.setLine)
    assertEquals("Next: Cable fly", after.name)
    assertEquals("Exercise 3 of 5 · Push A", after.where)
  }
}
