package expo.modules.workoutstatus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #3249: what the workout notification says in each state, and when it may be posted. */
class WorkoutStatusStateTest {
  private val now = 1_792_000_000_000L
  private val working = WorkoutStatus(
    workoutId = "w1", sessionName = "Upper body", exerciseName = "Bench press",
    phase = "working", nextSet = 2, sets = 4, load = "80 kg × 8",
  )

  @Test fun `a running set names the set and its load, with the set as the chip`() {
    val view = WorkoutStatusPresenter.present(working, now)
    assertEquals("Bench press", view.title)
    assertEquals("Set 2 of 4 · 80 kg × 8", view.text)
    assertEquals("Upper body", view.subText)
    assertEquals("Set 2/4", view.shortCriticalText)
    assertNull(view.countdownEndsAt)
  }

  @Test fun `a rest counts down to its end and leaves the chip to the countdown`() {
    val view = WorkoutStatusPresenter.present(
      working.copy(phase = "resting", nextSet = 3, load = "80 kg × 8", restEndsAt = now + 90_000), now,
    )
    assertEquals("Resting, next · Set 3 of 4 · 80 kg × 8", view.text)
    assertEquals(now + 90_000, view.countdownEndsAt)
    assertNull(view.shortCriticalText)
  }

  @Test fun `a rest that has ended shows the next set without a countdown`() {
    val over = working.copy(phase = "resting", nextSet = 3, restEndsAt = now - 1)
    val view = WorkoutStatusPresenter.present(over, now)
    assertNull(view.countdownEndsAt)
    assertEquals("Rest over, next · Set 3 of 4 · 80 kg × 8", view.text)
    assertEquals("Set 3/4", view.shortCriticalText)
    assertNull(WorkoutStatusPresenter.present(over.copy(restEndsAt = now), now).countdownEndsAt)
    assertNull(WorkoutStatusPresenter.present(over.copy(restEndsAt = null), now).countdownEndsAt)
  }

  @Test fun `only known values are shown`() {
    assertEquals("Set 2 of 4", WorkoutStatusPresenter.present(working.copy(load = null), now).text)
    assertEquals("Set 2 of 4 · 8 reps", WorkoutStatusPresenter.present(working.copy(load = "8 reps"), now).text)
  }

  @Test fun `between sets the next set is named with no timer`() {
    val view = WorkoutStatusPresenter.present(working.copy(phase = "ready", nextSet = 3), now)
    assertEquals("Next · Set 3 of 4 · 80 kg × 8", view.text)
    assertEquals("Set 3/4", view.shortCriticalText)
    assertNull(view.countdownEndsAt)
  }

  @Test fun `with no set to name the label stands in, and the chip is left empty`() {
    val done = working.copy(phase = "resting", nextSet = 0, load = "80 kg × 8", label = "Exercise done", restEndsAt = now + 30_000)
    val rest = WorkoutStatusPresenter.present(done, now)
    assertEquals("Resting · Exercise done", rest.text)
    assertEquals(now + 30_000, rest.countdownEndsAt)
    val warmup = WorkoutStatusPresenter.present(
      working.copy(phase = "ready", exerciseName = "Upper body", nextSet = 0, sets = 0, load = null, label = "Warm-up"), now,
    )
    assertEquals("Warm-up", warmup.text)
    assertNull(warmup.shortCriticalText)
    assertEquals(
      "Workout in progress",
      WorkoutStatusPresenter.present(working.copy(phase = "ready", nextSet = 0, load = null), now).text,
    )
  }

  @Test fun `a paused workout stops counting down`() {
    val view = WorkoutStatusPresenter.present(working.copy(phase = "paused", restEndsAt = now + 60_000), now)
    assertEquals("Paused · Set 2 of 4 · 80 kg × 8", view.text)
    assertEquals("Paused", view.shortCriticalText)
    assertNull(view.countdownEndsAt)
  }

  @Test fun `the JS payload is read, and a malformed one is refused`() {
    val read = WorkoutStatusPresenter.fromMap(
      mapOf(
        "workoutId" to "w1", "sessionName" to "Upper body", "exerciseName" to "Bench press",
        "phase" to "resting", "nextSet" to 3.0, "sets" to 4.0, "load" to "80 kg × 8",
        "restEndsAt" to now.toDouble(), "label" to null,
      ),
    )
    assertEquals(
      WorkoutStatus("w1", "Upper body", "Bench press", "resting", 3, 4, "80 kg × 8", now, null),
      read,
    )
    assertNull(WorkoutStatusPresenter.fromMap(null))
    assertNull(WorkoutStatusPresenter.fromMap(mapOf("workoutId" to "w1", "exerciseName" to "x")))
    assertNull(WorkoutStatusPresenter.fromMap(mapOf("workoutId" to "w1", "exerciseName" to "x", "phase" to "other")))
    assertNull(WorkoutStatusPresenter.fromMap(mapOf("workoutId" to " ", "exerciseName" to "x", "phase" to "working")))
    assertNull(WorkoutStatusPresenter.fromMap(mapOf("workoutId" to "w1", "exerciseName" to "", "phase" to "working")))
  }

  @Test fun `promotion is requested only on Android 16 with Live Updates allowed`() {
    assertTrue(WorkoutStatusPolicy.requestsPromotion(36, true))
    assertTrue(WorkoutStatusPolicy.requestsPromotion(37, true))
    assertFalse(WorkoutStatusPolicy.requestsPromotion(36, false))
    assertFalse(WorkoutStatusPolicy.requestsPromotion(35, true))
  }

  @Test fun `a dismissed workout stays dismissed and the next one posts`() {
    assertTrue(WorkoutStatusPolicy.mayPost(null, "w1"))
    assertFalse(WorkoutStatusPolicy.mayPost("w1", "w1"))
    assertTrue(WorkoutStatusPolicy.mayPost("w1", "w2"))
  }
}
