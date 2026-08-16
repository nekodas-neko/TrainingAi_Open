import { describe, it, expect } from "vitest";
import { modalWeight, avgReps, clampVoiceLogResult } from "./utils";

describe("modalWeight", () => {
  it("returns null for an empty list", () => {
    expect(modalWeight([])).toBeNull();
  });
  it("returns the most-frequent weight", () => {
    expect(modalWeight([60, 60, 55])).toBe(60);
  });
  it("returns the first-seen weight on a tie", () => {
    expect(modalWeight([60, 55])).toBe(60);
  });
  it("returns the only value for a single-weight list", () => {
    expect(modalWeight([70])).toBe(70);
  });
});

describe("avgReps", () => {
  it("returns null for an empty list", () => {
    expect(avgReps([])).toBeNull();
  });
  it("returns null when every rep is null", () => {
    expect(avgReps([null, null])).toBeNull();
  });
  it("rounds the mean of the reps", () => {
    expect(avgReps([8, 7, 6])).toBe(7);
    expect(avgReps([8, 7])).toBe(8);
  });
  it("ignores null entries when averaging", () => {
    expect(avgReps([8, null, 6])).toBe(7);
  });

  describe("floor rounding (pre-workout 'last time' preview)", () => {
    it("floors the mean rather than rounding to nearest", () => {
      expect(avgReps([8, 8, 8, 10], "floor")).toBe(8); // was 9 under round
      expect(avgReps([5, 4, 4, 5], "floor")).toBe(4); // was 5 under round
    });
    it("is unchanged for an exact-integer mean", () => {
      expect(avgReps([10, 10, 10, 10], "floor")).toBe(10);
    });
    it("matches round when the fractional part is already below .5", () => {
      expect(avgReps([12, 13, 15], "floor")).toBe(13); // mean 13.33
    });
    it("returns null for an empty or all-null list", () => {
      expect(avgReps([], "floor")).toBeNull();
      expect(avgReps([null, null], "floor")).toBeNull();
    });
  });
});

describe("clampVoiceLogResult", () => {
  it("passes through in-range values unchanged", () => {
    expect(clampVoiceLogResult(80, 8)).toEqual({ weight: 80, reps: 8 });
  });
  it("clamps a mis-heard 0 reps up to the 1-rep floor (matches the +/- control)", () => {
    expect(clampVoiceLogResult(80, 0)).toEqual({ weight: 80, reps: 1 });
  });
  it("clamps reps above the server schema's max (100)", () => {
    expect(clampVoiceLogResult(80, 250)).toEqual({ weight: 80, reps: 100 });
  });
  it("rounds a fractional rep count", () => {
    expect(clampVoiceLogResult(80, 8.6)).toEqual({ weight: 80, reps: 9 });
  });
  it("clamps a mis-heard negative weight up to 0", () => {
    expect(clampVoiceLogResult(-40, 8)).toEqual({ weight: 0, reps: 8 });
  });
  it("clamps weight above the server schema's max (500)", () => {
    expect(clampVoiceLogResult(9999, 8)).toEqual({ weight: 500, reps: 8 });
  });
  it("leaves an omitted field undefined", () => {
    expect(clampVoiceLogResult(undefined, 8)).toEqual({ weight: undefined, reps: 8 });
    expect(clampVoiceLogResult(80, undefined)).toEqual({ weight: 80, reps: undefined });
  });
});
