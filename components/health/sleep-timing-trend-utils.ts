// Extracted from sleep-timing-trend-card.tsx so this pure logic can be unit-tested without
// pulling chart.js/JSX into the test transform (see hr-day-chart-gaps.ts for the same reasoning
// in this codebase — importing a .tsx component directly from a .ts test file fails vite's
// import-analysis here).
import { minutesFromNoon } from "@trainingai/shared/health/sleep-consistency";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";

export interface TimingNight {
  date: string;
  sleepStart: string | null;
  sleepEnd: string | null;
}

export interface TimingPoint {
  date: string;
  value: number | null;
}

// Clock time, HH:MM AM/PM, from an already-zoned minutes-since-midnight value. The caller
// resolves the zone (see `timingPoints`); this does no timezone work of its own.
//
// DV-7 removed the "device-local is already correct for client display" convention this comment
// used to cite — it never was, it was merely invisible on a phone sitting in the zone the data
// was recorded in.
export function clockLabel(minutesSinceMidnight: number): string {
  const m = ((minutesSinceMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = Math.round(m % 60);
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${period}`;
}

// Bedtimes cluster around midnight — plot on the noon-shifted axis (minutesFromNoon) so
// 11:30pm and 12:15am land 45 minutes apart, not ~23 hours (see sleep-consistency.ts).
// Wake times don't share that problem (they cluster mid-morning), so they plot on a plain
// minutes-since-midnight axis.
//
// DV-7: both modes resolve through `minutesFromNoon`, so one zone governs the whole chart. Wake
// used to read `d.getHours()` — the device — while bedtime went through the shared helper, and
// once that helper stopped reading the device the two halves of one chart would have sat in two
// different timezones on any phone outside Brisbane. Deriving wake from the same call keeps a
// single clock implementation here rather than a second one (One Formula, One Place).
export function timingPoints(
  nights: TimingNight[],
  mode: "bedtime" | "wake",
  tz: string = DEFAULT_TZ,
): TimingPoint[] {
  return nights.map(n => {
    const iso = mode === "bedtime" ? n.sleepStart : n.sleepEnd;
    if (iso == null) return { date: n.date, value: null };
    const fromNoon = minutesFromNoon(iso, tz);
    // Wake times cluster mid-morning and need no noon shift; undo it rather than re-read the clock.
    return { date: n.date, value: mode === "bedtime" ? fromNoon : (fromNoon + 720) % 1440 };
  });
}

// Converts a plotted axis value (bedtime is noon-shifted, wake is not) back to a clock label.
export function timingValueToClock(value: number, mode: "bedtime" | "wake"): string {
  return mode === "bedtime" ? clockLabel(value + 720) : clockLabel(value);
}
