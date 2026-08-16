// Extracted from sleep-timing-trend-card.tsx so this pure logic can be unit-tested without
// pulling chart.js/JSX into the test transform (see hr-day-chart-gaps.ts for the same reasoning
// in this codebase — importing a .tsx component directly from a .ts test file fails vite's
// import-analysis here).
import { minutesFromNoon } from "@trainingai/shared/health/sleep-consistency";

export interface TimingNight {
  date: string;
  sleepStart: string | null;
  sleepEnd: string | null;
}

export interface TimingPoint {
  date: string;
  value: number | null;
}

// Device-local clock time, HH:MM AM/PM — matches computeSleepStartConsistency's existing
// no-tz convention in this same screen (device-local is already correct for client display).
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
export function timingPoints(nights: TimingNight[], mode: "bedtime" | "wake"): TimingPoint[] {
  return nights.map(n => {
    const iso = mode === "bedtime" ? n.sleepStart : n.sleepEnd;
    if (iso == null) return { date: n.date, value: null };
    const d = new Date(iso);
    const rawMinutes = d.getHours() * 60 + d.getMinutes();
    return { date: n.date, value: mode === "bedtime" ? minutesFromNoon(iso) : rawMinutes };
  });
}

// Converts a plotted axis value (bedtime is noon-shifted, wake is not) back to a clock label.
export function timingValueToClock(value: number, mode: "bedtime" | "wake"): string {
  return mode === "bedtime" ? clockLabel(value + 720) : clockLabel(value);
}
