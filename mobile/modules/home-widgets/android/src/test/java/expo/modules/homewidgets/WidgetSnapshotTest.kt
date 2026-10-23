package expo.modules.homewidgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Today widget draws only what the app's snapshot says, and nothing from a bad one. */
class WidgetSnapshotTest {
  private val json = """
    {"v":1,"date":"2026-10-23","updated":"Updated 7:42","today":{"scores":[
      {"label":"Readiness","value":"82","color":{"dark":"#60a5fa","light":"#2563eb"},"qualified":true},
      {"label":"Sleep (h)","value":"7.2","color":{"dark":"purple","light":"#7c3aed"}},
      {"label":"","value":"1"},
      {"label":"Resting HR","value":null},
      {"label":"Activity","value":"64","color":{"dark":"#f97316","light":"#c2410c"}},
      {"label":"Fifth","value":"9"}
    ]}}
  """.trimIndent()

  @Test fun `reads up to four labelled scores as sent`() {
    val snapshot = WidgetSnapshot.parseToday(json)!!
    assertEquals("Updated 7:42", snapshot.updated)
    assertEquals(listOf("Readiness", "Sleep (h)", "Resting HR", "Activity"), snapshot.scores.map { it.label })
    assertEquals(WidgetScore("Readiness", "82", "#60a5fa", "#2563eb", qualified = true), snapshot.scores[0])
  }

  @Test fun `a missing value stays missing rather than becoming zero`() {
    assertNull(WidgetSnapshot.parseToday(json)!!.scores[2].value)
  }

  @Test fun `a colour that is not a hex code is dropped`() {
    val sleep = WidgetSnapshot.parseToday(json)!!.scores[1]
    assertNull(sleep.colorDark)
    assertEquals("#7c3aed", sleep.colorLight)
  }

  @Test fun `an unreadable or other-version snapshot draws nothing`() {
    for (bad in listOf(null, "", "not json", """{"v":2,"today":{"scores":[]}}""", """{"v":1}""")) {
      assertNull(bad, WidgetSnapshot.parseToday(bad))
    }
  }

  @Test fun `yesterday's snapshot is stale`() {
    val snapshot = WidgetSnapshot.parseToday(json)!!
    assertFalse(WidgetSnapshot.isStale(snapshot, "2026-10-23"))
    assertTrue(WidgetSnapshot.isStale(snapshot, "2026-10-24"))
  }
}
