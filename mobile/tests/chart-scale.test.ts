import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  includeTarget,
  meetBox,
  niceTicks,
  tickLabels,
  yAxisWidth,
  drawableTarget,
  guideSummary,
  yPixel,
  isPointAlignedAxis,
  pointCentreX,
} from '../src/shared/ui/chartScale.ts';
import { niceTicks as nutritionNiceTicks } from '../src/features/nutrition/data/heart-response-view.ts';

test('niceTicks gives round values inside the range', () => {
  assert.deepEqual(niceTicks(0, 100), [0, 50, 100]);
  assert.deepEqual(niceTicks(60, 90), [60, 70, 80, 90]);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test('niceTicks keeps one gridline for a flat series, whatever the value', () => {
  assert.deepEqual(niceTicks(72.4, 72.4), [72.4]);
  assert.deepEqual(niceTicks(-3.5, -3.5), [-3.5]);
  assert.deepEqual(niceTicks(0.1, 0.1), [0.1]);
  for (let tenths = 0; tenths <= 3000; tenths++) {
    const v = tenths / 10;
    assert.equal(niceTicks(v, v).length, 1, `flat series at ${v}`);
  }
  assert.deepEqual(niceTicks(-20, 20), [-20, 0, 20]);
  // Spans too small to space ticks over are a flat series too.
  assert.equal(niceTicks(0.4, 0.40000001).length, 1);
  assert.equal(niceTicks(0.4, 0.4000002).length, 1);
});

test('the nutrition feature still exports the same niceTicks', () => {
  assert.equal(nutritionNiceTicks, niceTicks);
});

test('includeTarget widens the range only when the target falls outside it', () => {
  assert.deepEqual(includeTarget(0, 80, undefined), [0, 80]);
  assert.deepEqual(includeTarget(0, 80, { value: 50, label: 'Goal' }), [0, 80]);
  assert.deepEqual(includeTarget(0, 80, { value: 120, label: 'Goal' }), [0, 120]);
  assert.deepEqual(includeTarget(10, 80, { value: 2, label: 'Goal' }), [2, 80]);
  assert.deepEqual(includeTarget(0, 80, { value: Number.NaN, label: 'Goal' }), [0, 80]);
});

test('yPixel puts max at the top and min at the bottom', () => {
  assert.equal(yPixel(100, 0, 100, 96), 0);
  assert.equal(yPixel(0, 0, 100, 96), 96);
  assert.equal(yPixel(50, 0, 100, 96), 48);
  assert.equal(yPixel(7, 7, 7, 96), 48);
});

test('tickLabels never repeat and never carry float noise', () => {
  assert.deepEqual(tickLabels([0, 50, 100]), ['0', '50', '100']);
  assert.deepEqual(tickLabels(niceTicks(0, 1)), ['0', '0.5', '1']);
  const fine = tickLabels(niceTicks(0, 0.12));
  assert.equal(new Set(fine).size, fine.length);
  assert.deepEqual(tickLabels([72.4]), ['72.4']);
});

test('tickLabels abbreviates thousands only when every tick is a multiple of 100', () => {
  assert.deepEqual(tickLabels([0, 5000, 10000, 15000]), ['0', '5k', '10k', '15k']);
  assert.deepEqual(tickLabels([0, 1250, 2500]), ['0', '1250', '2500']);
  assert.deepEqual(tickLabels([-1500, 0, 1500]), ['-1.5k', '0', '1.5k']);
  assert.deepEqual(tickLabels([1000, 1020, 1040]), ['1000', '1020', '1040']);
});

test('yAxisWidth grows with the longest label and the font scale', () => {
  assert.equal(yAxisWidth(['0', '50']), 32);
  assert.ok(yAxisWidth(['-12.5k']) > 32);
  assert.ok(yAxisWidth(['-12.5k'], 1.3) > yAxisWidth(['-12.5k']));
  assert.equal(yAxisWidth([]), 32);
});

test('drawableTarget drops a target that is not a finite number', () => {
  const goal = { value: 2500, label: 'Goal' };
  assert.equal(drawableTarget(goal), goal);
  assert.equal(drawableTarget(undefined), undefined);
  assert.equal(drawableTarget({ value: Number.NaN, label: 'Goal' }), undefined);
  assert.equal(drawableTarget({ value: Infinity, label: 'Goal' }), undefined);
});

test('guideSummary words the range and the target for a screen reader', () => {
  assert.equal(
    guideSummary(0, 2700, { value: 2500, label: 'Goal' }),
    '. Range 0 to 2700. Goal 2500',
  );
  assert.equal(guideSummary(1.25, 3, undefined), '. Range 1.3 to 3');
});

test('meetBox centres the viewBox on the limiting axis', () => {
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

test("a thinned axis puts each label under its own point", () => {
  // 14 points with a label on every second one: label i must sit at point i's x, not spread evenly.
  const labels = Array.from({ length: 14 }, (_, i) => ((13 - i) % 2 === 0 ? `L${i}` : ""));
  assert.ok(isPointAlignedAxis(labels.length, 14, labels));
  const width = 320;
  const height = 90;
  const centres = labels.map((l, i) => (l ? pointCentreX(i, 0, 13, width, height) : null));
  labels.forEach((l, i) => {
    if (!l) return;
    // The point at index i is drawn at 12 + i/13*296 of 320 (scale 1 here).
    assert.ok(Math.abs(centres[i]! - (12 + (i / 13) * 296)) < 1e-9);
  });
  // Not where an even spread of the 7 labels would put them (0, 1/6, ... of the row).
  const shown = centres.filter((c): c is number => c !== null);
  assert.ok(Math.abs(shown[1] - 320 / 6) > 5);
  // Leaves every other caller alone: full or short label lists keep the old spread.
  assert.equal(isPointAlignedAxis(3, 14, ["a", "b", "c"]), false);
  assert.equal(isPointAlignedAxis(3, 3, ["a", "b", "c"]), false);
});
