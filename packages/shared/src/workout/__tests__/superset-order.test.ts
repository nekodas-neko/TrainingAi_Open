import { describe, it, expect } from "vitest";
import { buildSetSequence, nextStep } from "../superset-order";

describe("buildSetSequence", () => {
  it("interleaves a 2-exercise superset per set index", () => {
    const seq = buildSetSequence([
      { supersetGroup: 1, setCount: 3 },
      { supersetGroup: 1, setCount: 3 },
      { supersetGroup: null, setCount: 2 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 }, { exerciseIndex: 1, setIndex: 1 },
      { exerciseIndex: 0, setIndex: 2 }, { exerciseIndex: 1, setIndex: 2 },
      { exerciseIndex: 2, setIndex: 0 }, { exerciseIndex: 2, setIndex: 1 },
    ]);
  });

  it("handles uneven set counts by dropping the exhausted exercise from the rotation", () => {
    const seq = buildSetSequence([
      { supersetGroup: 1, setCount: 2 },
      { supersetGroup: 1, setCount: 3 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 }, { exerciseIndex: 1, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 2 },
    ]);
  });

  it("passes an ungrouped program through in plain order", () => {
    const seq = buildSetSequence([
      { supersetGroup: null, setCount: 2 },
      { supersetGroup: null, setCount: 1 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 0, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 0 },
    ]);
  });

  it("supports a 3-exercise circuit", () => {
    const seq = buildSetSequence([
      { supersetGroup: 1, setCount: 2 },
      { supersetGroup: 1, setCount: 2 },
      { supersetGroup: 1, setCount: 2 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 1, setIndex: 0 }, { exerciseIndex: 2, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 }, { exerciseIndex: 1, setIndex: 1 }, { exerciseIndex: 2, setIndex: 1 },
    ]);
  });
});

describe("nextStep", () => {
  const seq = buildSetSequence([
    { supersetGroup: 1, setCount: 3 },
    { supersetGroup: 1, setCount: 4 },
  ]);

  it("crosses into the other exercise when alternating", () => {
    expect(nextStep(seq, { exerciseIndex: 0, setIndex: 0 })).toEqual({ exerciseIndex: 1, setIndex: 0 });
    expect(nextStep(seq, { exerciseIndex: 1, setIndex: 0 })).toEqual({ exerciseIndex: 0, setIndex: 1 });
  });

  it("stays on the same exercise once its partner is exhausted", () => {
    expect(nextStep(seq, { exerciseIndex: 1, setIndex: 2 })).toEqual({ exerciseIndex: 1, setIndex: 3 });
  });

  it("returns null after the last step", () => {
    expect(nextStep(seq, { exerciseIndex: 1, setIndex: 3 })).toBeNull();
  });

  it("returns null for a step not present in the sequence", () => {
    expect(nextStep(seq, { exerciseIndex: 5, setIndex: 0 })).toBeNull();
  });
});
