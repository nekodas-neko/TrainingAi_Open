import { describe, it, expect } from "vitest";
import { prescribedBarWeights, plannedWeightsPayload, computeInitialWeights, mroundStepUp, barIsCapped } from "../utils";

// #2445: the bar stored as set_logs.planned_weight_kg is the one the screen opens each set on —
// the plate-rounded-UP figure, not the style percentage's arithmetic.
describe("prescribedBarWeights", () => {
  const skull = {
    exerciseType: "weighted" as const,
    estimated1rm: 36.5,
    equipment: ["barbell"],
    progressionStyle: [
      { pct: 70.5, reps: 10, restSec: 90 },
      { pct: 70.5, reps: 10, restSec: 90 },
    ],
  };

  it("rounds each set's prescription up to the plate step (the #2200 Skull Crusher case)", () => {
    // 36.5 x 70.5% = 25.73, raised to 27.5 on a 2.5 kg barbell step.
    expect(prescribedBarWeights(skull as never, 2)).toEqual([27.5, 27.5]);
  });

  it("is null for a set past the style's length", () => {
    expect(prescribedBarWeights(skull as never, 3)).toEqual([27.5, 27.5, null]);
  });

  it("is all null with no style, no 1RM, or a bodyweight movement", () => {
    expect(prescribedBarWeights({ ...skull, progressionStyle: null } as never, 2)).toEqual([null, null]);
    expect(prescribedBarWeights({ ...skull, estimated1rm: null } as never, 2)).toEqual([null, null]);
    expect(prescribedBarWeights({ ...skull, exerciseType: "bodyweight" } as never, 2)).toEqual([null, null]);
  });

  it("omits the payload field when no set had a bar, so a freeform log stays bare", () => {
    expect(plannedWeightsPayload({ ...skull, progressionStyle: null } as never, 2)).toBeUndefined();
    expect(plannedWeightsPayload(skull as never, 3)).toEqual([27.5, 27.5, null]);
  });
});

// #2762: with no progression style the field opened on the NEAREST plate while the card's "Target
// weight" showed the bar rounded UP, so the two could disagree by a step.
describe("computeInitialWeights with no progression style", () => {
  const base = { exerciseType: "weighted" as const, equipment: ["barbell"], progressionStyle: null, estimated1rm: 80 };

  it("opens on the same rounded-up bar the card shows", () => {
    // 61.0 is nearer 60 on a 2.5 kg step; the card shows mroundStepUp → 62.5.
    const ex = { ...base, target80: 61.0 };
    expect(computeInitialWeights(ex as never, 2)).toEqual([62.5, 62.5]);
    expect(computeInitialWeights(ex as never, 1)[0]).toBe(mroundStepUp(61.0, 2.5));
  });
});

describe("barIsCapped", () => {
  it("is true only past the bar limit that mroundStepUp clamps to", () => {
    expect(barIsCapped(250)).toBe(false);
    expect(barIsCapped(250.1)).toBe(true);
    expect(mroundStepUp(260, 2.5)).toBe(250);
    expect(barIsCapped(null)).toBe(false);
  });
});
