import { describe, it, expect } from "vitest";
import { prescribedBarWeights, plannedWeightsPayload, styleWithPrescribedBars, prescriptionBasisPayload } from "../utils";
import { calculate1RM } from "@trainingai/shared/1rm";

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

// Issue 2200: the device estimate and the live readout score against the same bars, and the
// payload carries the basis beside them so the server agrees.
describe("styleWithPrescribedBars / prescriptionBasisPayload", () => {
  const skull = {
    exerciseType: "weighted" as const,
    estimated1rm: 36.5,
    equipment: ["barbell"],
    progressionStyle: [
      { pct: 70.5, reps: 10, restSec: 90 },
      { pct: 70.5, reps: 10, restSec: 90 },
    ],
  };

  it("attaches each set's bar and the basis it came from", () => {
    expect(styleWithPrescribedBars(skull as never, 2)).toEqual([
      { pct: 70.5, reps: 10, restSec: 90, barKg: 27.5, basisKg: 36.5 },
      { pct: 70.5, reps: 10, restSec: 90, barKg: 27.5, basisKg: 36.5 },
    ]);
  });

  it("hitting the rounded bar exactly holds the 1RM", () => {
    expect(calculate1RM([27.5, 27.5], [10, 10], styleWithPrescribedBars(skull as never, 2)).estimated1rm).toBe(36.5);
  });

  it("sends the basis only beside bars", () => {
    expect(prescriptionBasisPayload(skull as never, 2)).toBe(36.5);
    expect(prescriptionBasisPayload({ ...skull, progressionStyle: null } as never, 2)).toBeUndefined();
    expect(prescriptionBasisPayload({ ...skull, exerciseType: "bodyweight" } as never, 2)).toBeUndefined();
  });

  it("leaves a style without a 1RM untouched", () => {
    expect(styleWithPrescribedBars({ ...skull, estimated1rm: null } as never, 2)).toEqual(skull.progressionStyle);
  });
});
