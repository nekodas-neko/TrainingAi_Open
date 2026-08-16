import { describe, it, expect } from "vitest";
import { classifyHrResponse, hrEmptyMessage } from "../hr-session-state";

describe("classifyHrResponse", () => {
  it("returns 'incomplete' when the route reports the session is not completed", () => {
    expect(classifyHrResponse({ ready: false })).toBe("incomplete");
  });

  it("returns 'none' when the session is ready but the Oura window had no readings", () => {
    expect(classifyHrResponse({ ready: true, hasData: false, readings: [] })).toBe("none");
  });

  it("returns 'none' when ready+hasData but readings are missing", () => {
    expect(classifyHrResponse({ ready: true, hasData: true })).toBe("none");
  });

  it("returns the parsed data object when readings are present", () => {
    const data = {
      ready: true,
      hasData: true,
      startedAt: "2026-07-01T10:00:00.000Z",
      readings: [{ timestamp: "2026-07-01T10:01:00.000Z", bpm: 120 }],
      setStats: [{ exerciseName: "Bench", setNumber: 1, loggedAt: null, hrr1: 22, adequate: true }],
    };
    const result = classifyHrResponse(data);
    expect(result).not.toBe("none");
    expect(result).not.toBe("incomplete");
    expect(result).toMatchObject({
      hasData: true,
      startedAt: "2026-07-01T10:00:00.000Z",
      readings: [{ timestamp: "2026-07-01T10:01:00.000Z", bpm: 120 }],
      setStats: [{ exerciseName: "Bench", setNumber: 1 }],
    });
  });
});

describe("hrEmptyMessage", () => {
  it("gives a distinct message for a session that was never completed", () => {
    expect(hrEmptyMessage("incomplete")).toBe(
      "This workout wasn't marked complete, so there's no HR recovery to show",
    );
  });

  it("keeps the worn/synced message for a completed session with no readings", () => {
    expect(hrEmptyMessage("none")).toBe("No HR data — ensure Oura was worn and synced");
  });
});
