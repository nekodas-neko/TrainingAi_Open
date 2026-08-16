import { describe, it, expect } from "vitest";
import { clockLabel, timingPoints, timingValueToClock } from "../sleep-timing-trend-utils";

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
      { date: "2026-08-01", sleepStart: "2026-08-01T23:30:00", sleepEnd: null },
      { date: "2026-08-02", sleepStart: "2026-08-02T00:15:00", sleepEnd: null },
    ];
    const points = timingPoints(nights, "bedtime");
    expect(points[0].value).not.toBeNull();
    expect(points[1].value).not.toBeNull();
    expect(Math.abs((points[1].value as number) - (points[0].value as number))).toBe(45);
  });

  it("computes plain minutes-since-midnight for wake time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: "2026-08-01T07:15:00" }];
    const points = timingPoints(nights, "wake");
    expect(points[0].value).toBe(7 * 60 + 15);
  });

  it("returns null for a night with no timestamp for the requested mode", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: null }];
    expect(timingPoints(nights, "bedtime")[0].value).toBeNull();
    expect(timingPoints(nights, "wake")[0].value).toBeNull();
  });
});

describe("timingValueToClock", () => {
  it("round-trips a bedtime value back to its clock time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: "2026-08-01T23:30:00", sleepEnd: null }];
    const value = timingPoints(nights, "bedtime")[0].value as number;
    expect(timingValueToClock(value, "bedtime")).toBe("11:30 PM");
  });

  it("round-trips a wake value back to its clock time", () => {
    const nights = [{ date: "2026-08-01", sleepStart: null, sleepEnd: "2026-08-01T07:15:00" }];
    const value = timingPoints(nights, "wake")[0].value as number;
    expect(timingValueToClock(value, "wake")).toBe("7:15 AM");
  });
});
