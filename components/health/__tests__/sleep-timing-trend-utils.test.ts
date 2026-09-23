import { describe, it, expect } from "vitest";
import { clockLabel, timingPoints, timingValueToClock } from "../sleep-timing-trend-utils";

// DV-7 — every fixture carries an explicit offset and every expectation names its zone.
// They used to be bare local-time strings ("2026-08-01T23:30:00"), which `new Date` parses in the
// RUNNER's zone, so these cases asserted that the chart agrees with whatever machine ran them.
// `+10:00` is Brisbane, which has no DST, so the expected clock times are checkable by hand.
const BNE = "Australia/Brisbane";

describe("clockLabel", () => {
  it("formats midday and midnight correctly", () => {
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(720)).toBe("12:00 PM");
  });

  it("formats a plain morning/evening time", () => {
    expect(clockLabel(6 * 60 + 30)).toBe("6:30 AM");
    expect(clockLabel(22 * 60 + 15)).toBe("10:15 PM");
  });

  it("wraps a negative or over-1440 value back onto the clock", () => {
    expect(clockLabel(-30)).toBe("11:30 PM");
    expect(clockLabel(1440 + 45)).toBe("12:45 AM");
  });
});

describe("timingPoints", () => {
  it("computes noon-shifted bedtime values that don't jump across the midnight wrap", () => {
    // 11:30pm and 12:15am are 45 minutes apart in reality — the noon-shifted values
    // must reflect that small gap, not the ~23h a raw minutes-since-midnight would show.
    const nights = [
      { date: "2026-08-01", sleepStart: "2026-08-01T23:30:00+10:00", sleepEnd: null },
      { date: "2026-08-02", sleepStart: "2026-08-02T00:15:00+10:00", sleepEnd: null },
    ];
    const points = timingPoints(nights, "bedtime", BNE);
    expect(points[0].value).not.toBeNull();
    expect(points[1].value).not.toBeNull();
    expect(Math.abs((points[1].value as number) - (points[0].value as number))).toBe(45);
  });

  it("computes plain minutes-since-midnight for wake time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: "2026-08-01T07:15:00+10:00" }];
    const points = timingPoints(nights, "wake", BNE);
    expect(points[0].value).toBe(7 * 60 + 15);
  });

  it("returns null for a night with no timestamp for the requested mode", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: null }];
    expect(timingPoints(nights, "bedtime", BNE)[0].value).toBeNull();
    expect(timingPoints(nights, "wake", BNE)[0].value).toBeNull();
  });
});

describe("timingValueToClock", () => {
  it("round-trips a bedtime value back to its clock time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: "2026-08-01T23:30:00+10:00", sleepEnd: null }];
    const value = timingPoints(nights, "bedtime", BNE)[0].value as number;
    expect(timingValueToClock(value, "bedtime")).toBe("11:30 PM");
  });

  it("round-trips a wake value back to its clock time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: "2026-08-01T07:15:00+10:00" }];
    const value = timingPoints(nights, "wake", BNE)[0].value as number;
    expect(timingValueToClock(value, "wake")).toBe("7:15 AM");
  });
});

describe("timingPoints — one zone governs the whole chart (DV-7)", () => {
  // The regression this guards: bedtime went through the shared helper while wake read the
  // device's clock, so once the helper stopped reading the device the two modes of ONE chart
  // sat in two different timezones on any phone outside Brisbane.
  const nights = [{
    date: "2026-08-01",
    sleepStart: "2026-08-01T23:30:00+10:00",
    sleepEnd: "2026-08-02T07:15:00+10:00",
  }];

  it("moves BOTH modes when the zone changes, by the same offset", () => {
    const bneBed  = timingPoints(nights, "bedtime", BNE)[0].value as number;
    const bneWake = timingPoints(nights, "wake", BNE)[0].value as number;
    const nycBed  = timingPoints(nights, "bedtime", "America/New_York")[0].value as number;
    const nycWake = timingPoints(nights, "wake", "America/New_York")[0].value as number;
    // New York is 14 hours behind Brisbane in August (EDT).
    const shift = 14 * 60;
    expect(((bneBed - nycBed) + 1440) % 1440).toBe(shift);
    expect(((bneWake - nycWake) + 1440) % 1440).toBe(shift);
  });

  it("defaults to the user timezone, not the runner's", () => {
    expect(timingPoints(nights, "bedtime")).toEqual(timingPoints(nights, "bedtime", BNE));
    expect(timingPoints(nights, "wake")).toEqual(timingPoints(nights, "wake", BNE));
  });
});
