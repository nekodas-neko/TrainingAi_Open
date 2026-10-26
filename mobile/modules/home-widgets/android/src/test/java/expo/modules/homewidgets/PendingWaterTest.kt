package expo.modules.homewidgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The +250 ml taps made with the app closed: peek, acknowledge, and never count one twice. */
class PendingWaterTest {
  private fun tap(id: String, date: String = "2026-10-23", user: String = "user-one") =
    WaterTap(id, 250, 1_700_000_000_000L, date, user)

  @Test fun `taps survive the round trip through the stored JSON`() {
    val taps = listOf(tap("a"), tap("b", date = "2026-10-24"))
    assertEquals(taps, PendingWater.parse(PendingWater.toJson(taps)))
  }

  @Test fun `an unreadable queue is an empty one`() {
    for (bad in listOf(null, "", "nope", "{}")) assertTrue(bad, PendingWater.parse(bad).isEmpty())
  }

  @Test fun `a tap already queued under its id is not queued twice`() {
    val once = PendingWater.append(emptyList(), tap("a"))
    assertEquals(once, PendingWater.append(once, tap("a")))
    assertEquals(2, PendingWater.append(once, tap("b")).size)
  }

  @Test fun `acknowledging removes exactly those ids and ignores the rest`() {
    val taps = listOf(tap("a"), tap("b"), tap("c"))
    assertEquals(listOf("b"), PendingWater.ack(taps, listOf("a", "c", "never-queued")).map { it.id })
    assertEquals(taps, PendingWater.ack(taps, emptyList()))
  }

  @Test fun `a tap made while the app read the queue survives the acknowledgement`() {
    val peeked = listOf(tap("a"))
    val later = PendingWater.append(peeked, tap("b"))
    assertEquals(listOf("b"), PendingWater.ack(later, peeked.map { it.id }).map { it.id })
  }

  @Test fun `the queue stops growing at its limit`() {
    var taps = emptyList<WaterTap>()
    repeat(PendingWater.MAX + 10) { taps = PendingWater.append(taps, tap("id-$it")) }
    assertEquals(PendingWater.MAX, taps.size)
  }

  @Test fun `only that account's taps for that day count toward a day's total`() {
    val taps = listOf(tap("a"), tap("b"), tap("c", date = "2026-10-22"), tap("d", user = "user-two"))
    assertEquals(2, PendingWater.waiting(taps, "user-one", "2026-10-23"))
  }
}
