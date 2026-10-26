package expo.modules.homewidgets

import java.time.Instant
import java.time.ZoneId

/** When the day next turns, so a widget showing a day's numbers can say it needs the app. */
object MidnightClock {
  /**
   * A minute past the next local midnight, so the clock reads the new day wherever the inexact
   * alarm lands.
   */
  fun nextMillis(now: Long, zone: ZoneId): Long =
    Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone)
      .plusMinutes(1).toInstant().toEpochMilli()
}
