import { describe, it, expect } from "vitest";
import { longestWeeklyStreak, monthlySessionCounts } from "../year-review";

describe("longestWeeklyStreak", () => {
  it("finds a run of 3 consecutive weeks", () => {
    // Mondays 2026-06-01, 06-08, 06-15 are consecutive; 06-29 breaks the streak
    const days = ["2026-06-01", "2026-06-03", "2026-06-08", "2026-06-15", "2026-06-29"];
    expect(longestWeeklyStreak(days)).toBe(3);
  });

  it("returns 1 for a single session", () => {
    expect(longestWeeklyStreak(["2026-06-01"])).toBe(1);
  });

  it("returns 0 for no sessions", () => {
    expect(longestWeeklyStreak([])).toBe(0);
  });

  it("treats multiple sessions in the same week as one week", () => {
    expect(longestWeeklyStreak(["2026-06-01", "2026-06-02", "2026-06-03"])).toBe(1);
  });
});

describe("monthlySessionCounts", () => {
  it("buckets sessions into the correct trailing-year month slot", () => {
    // today = 2026-07-04 -> index 11 = July, index 10 = June, index 0 = August last year (out of range, dropped)
    const counts = monthlySessionCounts(
      ["2026-07-01", "2026-07-02", "2026-06-15", "2025-07-01"],
      "2026-07-04",
    );
    expect(counts).toHaveLength(12);
    expect(counts[11]).toBe(2); // this month
    expect(counts[10]).toBe(1); // last month
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3); // the 2025-07-01 session is >=12 months ago, dropped
  });

  it("returns all zeros for no sessions", () => {
    expect(monthlySessionCounts([], "2026-07-04")).toEqual(new Array(12).fill(0));
  });
});
