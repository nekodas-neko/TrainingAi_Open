package expo.modules.homewidgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The widgets draw only what the app's snapshot says, and nothing from a bad one. */
class WidgetSnapshotTest {
  private val json = """
    {"v":1,"user":"user-one","date":"2026-10-23","updated":"Updated 7:42 am",
     "today":{"scores":[
       {"label":"Readiness","value":"82","color":{"dark":"#60a5fa","light":"#2563eb"},"qualified":true},
       {"label":"Sleep (h)","value":"7.2","color":{"dark":"purple","light":"#7c3aed"}},
       {"label":"","value":"1"},
       {"label":"Resting HR","value":null},
       {"label":"Activity","value":"64","color":{"dark":"#f97316","light":"#c2410c"}},
       {"label":"Fifth","value":"9"}
     ],"battery":{"value":"64","label":"Good · Charging","level":64,"band":"good"}},
     "next":{"eyebrow":"Recommended Today","name":"Upper A","meta":"~55 min · 6 exercises","sessionId":"12","startable":true,"restDay":false},
     "nutrition":{"kcal":{"value":"1,240","label":"kcal left"},
       "macros":[{"key":"protein","label":"Protein","left":"62 g left","fraction":0.58},
                 {"key":"carbs","label":"Carbs","left":null,"fraction":null},
                 {"key":"fibre","label":"Fibre","left":"1 g left","fraction":0.1}],
       "water":{"text":"1.3L","goal":"Goal: 2.5L","fraction":0.5,"tapMl":250,
                "steps":[{"text":"1.3L","fraction":0.5},{"text":"1.5L","fraction":0.6},{"text":"1.8L","fraction":1.7}]}}}
  """.trimIndent()

  @Test fun `reads up to four labelled scores as sent`() {
    val snapshot = WidgetSnapshot.parse(json)!!
    assertEquals("user-one", snapshot.user)
    assertEquals("Updated 7:42 am", snapshot.updated)
    assertEquals(listOf("Readiness", "Sleep (h)", "Resting HR", "Activity"), snapshot.scores.map { it.label })
    assertEquals(WidgetScore("Readiness", "82", "#60a5fa", "#2563eb", qualified = true), snapshot.scores[0])
  }

  @Test fun `a missing value stays missing rather than becoming zero`() {
    assertNull(WidgetSnapshot.parse(json)!!.scores[2].value)
  }

  @Test fun `a colour that is not a hex code is dropped`() {
    val sleep = WidgetSnapshot.parse(json)!!.scores[1]
    assertNull(sleep.colorDark)
    assertEquals("#7c3aed", sleep.colorLight)
  }

  @Test fun `reads Body Battery as worded by the app`() {
    assertEquals(WidgetBattery("64", "Good · Charging", 64, "good"), WidgetSnapshot.parse(json)!!.battery)
  }

  @Test fun `reads the next workout and what Start opens`() {
    val next = WidgetSnapshot.parse(json)!!.next!!
    assertEquals("Upper A", next.name)
    assertEquals("12", next.sessionId)
    assertTrue(next.startable)
  }

  @Test fun `a card without a session is never startable`() {
    val rest = json.replace("\"sessionId\":\"12\"", "\"sessionId\":null")
    assertFalse(WidgetSnapshot.parse(rest)!!.next!!.startable)
  }

  @Test fun `reads calories, macros that have a target, and the water table`() {
    val nutrition = WidgetSnapshot.parse(json)!!.nutrition!!
    assertEquals("1,240", nutrition.kcalValue)
    assertEquals("kcal left", nutrition.kcalLabel)
    assertEquals(listOf("protein", "carbs"), nutrition.macros.map { it.key })
    assertNull(nutrition.macros[1].left)
    assertNull(nutrition.macros[1].fraction)
    assertEquals(250, nutrition.water!!.tapMl)
    assertEquals("Goal: 2.5L", nutrition.water!!.goal)
  }

  @Test fun `taps the app has not recorded step through the table the app worded`() {
    val water = WidgetSnapshot.parse(json)!!.nutrition!!.water!!
    assertEquals("1.3L", WidgetSnapshot.waterStep(water, 0)!!.text)
    assertEquals("1.5L", WidgetSnapshot.waterStep(water, 1)!!.text)
    // More taps than the table holds show its last row, and a fraction is held to 0–1.
    assertEquals("1.8L", WidgetSnapshot.waterStep(water, 40)!!.text)
    assertEquals(1.0, WidgetSnapshot.waterStep(water, 2)!!.fraction!!, 0.0)
    assertEquals("1.3L", WidgetSnapshot.waterStep(water, -3)!!.text)
  }

  @Test fun `an unreadable, other-version or anonymous snapshot draws nothing`() {
    for (bad in listOf(
      null, "", "not json",
      """{"v":2,"user":"u","date":"2026-10-23"}""",
      """{"v":1,"date":"2026-10-23"}""",
      """{"v":1,"user":"u"}""",
    )) {
      assertNull(bad, WidgetSnapshot.parse(bad))
    }
  }

  @Test fun `a snapshot with no sections is readable and empty`() {
    val snapshot = WidgetSnapshot.parse("""{"v":1,"user":"u","date":"2026-10-23"}""")!!
    assertTrue(snapshot.scores.isEmpty())
    assertNull(snapshot.next)
    assertNull(snapshot.nutrition)
  }

  @Test fun `yesterday's snapshot is stale`() {
    val snapshot = WidgetSnapshot.parse(json)!!
    assertFalse(WidgetSnapshot.isStale(snapshot, "2026-10-23"))
    assertTrue(WidgetSnapshot.isStale(snapshot, "2026-10-24"))
  }
}
