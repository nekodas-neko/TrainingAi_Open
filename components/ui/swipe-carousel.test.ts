import { describe, it, expect } from "vitest";
import { applyEdgeResistance, commitTarget } from "./swipe-carousel-math";

describe("applyEdgeResistance", () => {
  it("dampens drag past the first panel by 0.2x", () => {
    // index 0, dragging right (+dx) has no previous panel: 50 * 0.2 = 10
    expect(applyEdgeResistance(50, 0, 3)).toBe(10);
  });
  it("dampens drag past the last panel by 0.2x", () => {
    // index 2 of 3, dragging left (-dx): -50 * 0.2 = -10
    expect(applyEdgeResistance(-50, 2, 3)).toBe(-10);
  });
  it("passes interior drags through unchanged", () => {
    expect(applyEdgeResistance(-50, 1, 3)).toBe(-50);
  });
});

describe("commitTarget", () => {
  it("advances on a -61px drag (past the 60px threshold)", () => {
    expect(commitTarget(-61, 0, 1, 3)).toBe(1);
  });
  it("stays put under the threshold with no flick", () => {
    expect(commitTarget(-40, 0, 0.1, 3)).toBe(0);
  });
  it("advances on a fast flick even under 60px (velocity > 0.5 px/ms)", () => {
    expect(commitTarget(-30, 0, 0.6, 3)).toBe(1);
  });
  it("clamps at the edges", () => {
    expect(commitTarget(-200, 2, 2, 3)).toBe(2);
    expect(commitTarget(200, 0, 2, 3)).toBe(0);
  });
});
