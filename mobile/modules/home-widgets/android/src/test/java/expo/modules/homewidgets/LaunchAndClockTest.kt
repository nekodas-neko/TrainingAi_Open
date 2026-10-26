package expo.modules.homewidgets

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LaunchInboxTest {
  @Test fun `a target is handed over once`() {
    val inbox = LaunchInbox()
    assertEquals("next-session:12", inbox.take("next-session:12"))
    assertNull(inbox.take(null))
  }

  @Test fun `a target from a new intent wins over the launch intent's`() {
    val inbox = LaunchInbox()
    inbox.capture("nutrition")
    assertEquals("nutrition", inbox.take("home"))
    assertNull(inbox.take(null))
  }

  @Test fun `blank targets are no target`() {
    val inbox = LaunchInbox()
    inbox.capture("")
    assertNull(inbox.take(" "))
  }
}

class MidnightClockTest {
  private val sydney = ZoneId.of("Australia/Sydney")
  private fun millis(local: LocalDateTime, zone: ZoneId) = local.atZone(zone).toInstant().toEpochMilli()

  @Test fun `the alarm lands a minute after the next local midnight`() {
    val evening = millis(LocalDateTime.of(2026, 10, 23, 21, 30), sydney)
    assertEquals(millis(LocalDateTime.of(2026, 10, 24, 0, 1), sydney), MidnightClock.nextMillis(evening, sydney))
  }

  @Test fun `just after midnight waits for the following one`() {
    val justAfter = millis(LocalDateTime.of(2026, 10, 24, 0, 0, 30), sydney)
    assertEquals(millis(LocalDateTime.of(2026, 10, 25, 0, 1), sydney), MidnightClock.nextMillis(justAfter, sydney))
  }

  @Test fun `the clock change at daylight saving does not skip a day`() {
    // Sydney springs forward on 4 October 2026 at 02:00; the day is 23 hours long.
    val before = millis(LocalDateTime.of(2026, 10, 3, 22, 0), sydney)
    assertEquals(millis(LocalDateTime.of(2026, 10, 4, 0, 1), sydney), MidnightClock.nextMillis(before, sydney))
    val during = millis(LocalDateTime.of(2026, 10, 4, 12, 0), sydney)
    assertEquals(millis(LocalDateTime.of(2026, 10, 5, 0, 1), sydney), MidnightClock.nextMillis(during, sydney))
  }

  @Test fun `the next midnight is the profile's, whichever zone the phone is in`() {
    val tokyo = ZoneId.of("Asia/Tokyo")
    val losAngeles = ZoneId.of("America/Los_Angeles")
    val now = millis(LocalDateTime.of(2026, 10, 23, 23, 30), tokyo)
    assertEquals(millis(LocalDateTime.of(2026, 10, 24, 0, 1), tokyo), MidnightClock.nextMillis(now, tokyo))
    assertNotEquals(MidnightClock.nextMillis(now, losAngeles), MidnightClock.nextMillis(now, tokyo))
  }
}
