import { describe, it, expect } from "vitest";
import { easeOutCubicValue, interpolateCountUp } from "./use-count-up";

describe("easeOutCubicValue", () => {
  it("starts at 0", () => expect(easeOutCubicValue(0, 80)).toBe(0));
  it("ends exactly at the target", () => expect(easeOutCubicValue(1, 80)).toBe(80));
  it("is past the midpoint at t=0.5 (ease-out)", () => {
    // easeOutCubic(0.5) = 1 - 0.5^3 = 0.875 → 80 * 0.875 = 70
    expect(easeOutCubicValue(0.5, 80)).toBe(70);
  });
});

describe("interpolateCountUp", () => {
  it("starts at the previous displayed value, not 0 — no zero-frame flash on mount", () => {
    // A cache-seeded target at mount: the first animation frame (t=0) must read
    // as the already-known value, not flash down to 0 first.
    expect(interpolateCountUp(75, 75, 0)).toBe(75);
  });

  it("animates a target change from the previous value, not from scratch", () => {
    // 75 -> 78: at t=0 the displayed value is still 75, not 0.
    expect(interpolateCountUp(75, 78, 0)).toBe(75);
    expect(interpolateCountUp(75, 78, 1)).toBe(78);
  });

  it("matches easeOutCubicValue when animating from 0 (backward-compatible math)", () => {
    expect(interpolateCountUp(0, 80, 0.5)).toBe(easeOutCubicValue(0.5, 80));
  });
});
