import { describe, it, expect } from "vitest";
import { ACTION_WIDTH, dragOffset, shouldRestOpen, trayWidth } from "./swipe-actions-math";

describe("trayWidth", () => {
  it("is one action width per action", () => {
    expect(trayWidth(3)).toBe(ACTION_WIDTH * 3);
  });
});

describe("dragOffset", () => {
  it("tracks the thumb one-to-one while the tray is still being revealed", () => {
    expect(dragOffset(-40, false, 3)).toBe(-40);
  });
  it("dampens a drag past the fully-revealed tray", () => {
    // 3 actions = 192px of tray; 32px beyond it lands at 192 + 32 * 0.25
    expect(dragOffset(-224, false, 3)).toBe(-200);
  });
  it("dampens a right-drag on a closed row rather than letting it move", () => {
    expect(dragOffset(40, false, 3)).toBe(10);
  });
  it("measures from the open position when the drag starts open", () => {
    // already at -192; a 40px drag right leaves it at -152
    expect(dragOffset(40, true, 3)).toBe(-152);
  });
  it("lets an open row be dragged shut all the way", () => {
    expect(dragOffset(192, true, 3)).toBe(0);
  });
});

describe("shouldRestOpen", () => {
  it("opens past the halfway point", () => {
    expect(shouldRestOpen(-100, 0.1, -1, 3)).toBe(true);
  });
  it("springs back when short of halfway", () => {
    expect(shouldRestOpen(-80, 0.1, -1, 3)).toBe(false);
  });
  it("opens on a leftward flick that never reached halfway", () => {
    expect(shouldRestOpen(-20, 0.9, -1, 3)).toBe(true);
  });
  it("closes on a rightward flick from a fully-open row", () => {
    // Velocity is unsigned, so only `direction` says which way the thumb went.
    expect(shouldRestOpen(-192, 0.9, 1, 3)).toBe(false);
  });
  it("ignores velocity with no direction (a lift with no travel)", () => {
    expect(shouldRestOpen(-100, 5, 0, 3)).toBe(true);
  });
});
