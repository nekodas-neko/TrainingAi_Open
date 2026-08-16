import { describe, it, expect } from "vitest";
import { tdeeAdjustment } from "../tdee-adaptation";

describe("tdeeAdjustment", () => {
  it("suggests eating less when losing slower than the lose_weight target", () => {
    expect(tdeeAdjustment("lose_weight", -0.1)).toBe(-200);
  });
  it("suggests eating more when losing faster than intended", () => {
    expect(tdeeAdjustment("lose_weight", -0.8)).toBe(200);
  });
  it("returns 0 inside the ±0.1 kg/week deadband", () => {
    expect(tdeeAdjustment("lose_weight", -0.5)).toBe(0);
    expect(tdeeAdjustment("maintain", 0.05)).toBe(0);
  });
  it("rounds to the nearest 50 kcal", () => {
    expect(tdeeAdjustment("build_muscle", 0)).toBe(200);
    expect(tdeeAdjustment("maintain", -0.15)).toBe(150);
  });
});
