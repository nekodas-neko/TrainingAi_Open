import assert from "node:assert/strict";
import { test } from "node:test";
import {
  includeTarget,
  meetBox,
  niceTicks,
  tickLabel,
  yPixel,
} from "../src/shared/ui/chartScale.ts";
import { niceTicks as nutritionNiceTicks } from "../src/features/nutrition/data/heart-response-view.ts";

test("niceTicks gives round values inside the range", () => {
  assert.deepEqual(niceTicks(0, 100), [0, 50, 100]);
  assert.deepEqual(niceTicks(60, 90), [60, 70, 80, 90]);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("the nutrition feature still exports the same niceTicks", () => {
  assert.equal(nutritionNiceTicks, niceTicks);
});

test("includeTarget widens the range only when the target falls outside it", () => {
  assert.deepEqual(includeTarget(0, 80, undefined), [0, 80]);
  assert.deepEqual(includeTarget(0, 80, { value: 50, label: "Goal" }), [0, 80]);
  assert.deepEqual(
    includeTarget(0, 80, { value: 120, label: "Goal" }),
    [0, 120],
  );
  assert.deepEqual(includeTarget(10, 80, { value: 2, label: "Goal" }), [2, 80]);
  assert.deepEqual(
    includeTarget(0, 80, { value: Number.NaN, label: "Goal" }),
    [0, 80],
  );
});

test("yPixel puts max at the top and min at the bottom", () => {
  assert.equal(yPixel(100, 0, 100, 96), 0);
  assert.equal(yPixel(0, 0, 100, 96), 96);
  assert.equal(yPixel(50, 0, 100, 96), 48);
  assert.equal(yPixel(7, 7, 7, 96), 48);
});

test("tickLabel keeps at most one decimal", () => {
  assert.equal(tickLabel(50), "50");
  assert.equal(tickLabel(0.25), "0.3");
  assert.equal(tickLabel(1.5), "1.5");
});

test("meetBox centres the viewBox on the limiting axis", () => {
  // 320x90 viewBox in a box twice as wide as tall-limited: height limits, so it is centred in x.
  const wide = meetBox(1000, 90, 320, 90);
  assert.equal(wide.scale, 1);
  assert.equal(wide.offsetY, 0);
  assert.equal(wide.offsetX, 340);
  const narrow = meetBox(160, 96, 320, 90);
  assert.equal(narrow.scale, 0.5);
  assert.equal(narrow.offsetX, 0);
  assert.equal(narrow.offsetY, 25.5);
});
