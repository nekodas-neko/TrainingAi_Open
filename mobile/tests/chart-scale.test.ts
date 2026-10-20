import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  includeTarget,
  meetBox,
  niceTicks,
  niceScale,
  axisLabelBox,
  tickLabels,
  yAxisWidth,
  drawableTarget,
  guideSummary,
  yPixel,
  isPointAlignedAxis,
  smoothPath,
  DENSE_AXIS_POINTS,
  pointCentreX,
  dotMask,
  lineSegments,
  lastReadingIndex,
} from '../src/shared/ui/chartScale.ts';
import { niceTicks as nutritionNiceTicks } from '@trainingai/shared/nutrition/heart-response-view';

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

test('tickLabels abbreviates only five-digit values, and only when every tick is a multiple of 100', () => {
  assert.deepEqual(tickLabels([0, 5000, 10000, 15000]), ['0', '5k', '10k', '15k']);
  assert.deepEqual(tickLabels([0, 1250, 2500]), ['0', '1,250', '2,500']);
  // The Nutrition 7-day chart's axis reads like the current app's chart.js: 500 and 1,500, not 0.5k.
  assert.deepEqual(tickLabels([0, 500, 1000, 1500, 2000]), ['0', '500', '1,000', '1,500', '2,000']);
  assert.deepEqual(tickLabels([-1500, 0, 1500]), ['-1,500', '0', '1,500']);
  assert.deepEqual(tickLabels([-12500, 0, 12500]), ['-12.5k', '0', '12.5k']);
  assert.deepEqual(tickLabels([1000, 1020, 1040]), ['1,000', '1,020', '1,040']);
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

test('dotMask dots every reading, or only the latest and the ones with no neighbour', () => {
  const values = [1, null, 2, 3, null, 4, null, 5];
  assert.deepEqual(dotMask(values, 'all'), [true, false, true, true, false, true, false, true]);
  assert.deepEqual(dotMask(values, 'isolated'), [true, false, false, false, false, true, false, true]);
  assert.deepEqual(dotMask([1, 2, 3], 'isolated'), [false, false, true]);
  assert.deepEqual(dotMask([1, 2, null], 'isolated'), [false, false, false]);
});

// A body reading every few days is a series with empty days between: a broken line leaves each
// reading alone, which is the "floating dots" of #3020.
test('lineSegments breaks at an empty day by default, so sparse readings are separate runs', () => {
  const sparse = [{ v: 1 }, null, null, { v: 2 }, null, { v: 3 }];
  assert.deepEqual(
    lineSegments(sparse, 'break').map((run) => run.length),
    [1, 1, 1],
  );
});

test('lineSegments connect draws one run through every reading, across empty days', () => {
  const sparse = [{ v: 1 }, null, null, { v: 2 }, null, { v: 3 }];
  assert.deepEqual(lineSegments(sparse, 'connect'), [[{ v: 1 }, { v: 2 }, { v: 3 }]]);
  assert.deepEqual(lineSegments([null, null], 'connect'), [[]]);
});

test('lineSegments keeps a gap in a 14-day series that breaks', () => {
  const run = lineSegments([1, 2, null, 4, 5], 'break');
  assert.deepEqual(run, [[1, 2], [4, 5]]);
});

test('lastReadingIndex finds the newest reading, skipping trailing empty days', () => {
  assert.equal(lastReadingIndex([1, null, 3, null]), 2);
  assert.equal(lastReadingIndex([null, null]), -1);
  assert.equal(lastReadingIndex([]), -1);
});

test('niceScale widens a range out to its round gridline values', () => {
  assert.deepEqual(niceScale(12, 48), { min: 0, max: 60, ticks: [0, 20, 40, 60] });
  assert.deepEqual(niceScale(62, 79), { min: 60, max: 80, ticks: [60, 70, 80] });
  // chart.js (maxTicksLimit 4) widens the spacing when the first pass gives too many spaces.
  assert.deepEqual(niceScale(35, 65), { min: 20, max: 80, ticks: [20, 40, 60, 80] });
  assert.deepEqual(niceScale(15, 45), { min: 0, max: 60, ticks: [0, 20, 40, 60] });
  // Already round: not widened further.
  assert.deepEqual(niceScale(0, 60), { min: 0, max: 60, ticks: [0, 20, 40, 60] });
  // A flat series keeps its one gridline.
  assert.deepEqual(niceScale(7, 7), { min: 7, max: 7, ticks: [7] });
  const scale = niceScale(0.3, 1.9);
  assert.equal(scale.ticks[0], scale.min);
  assert.equal(scale.ticks.at(-1), scale.max);
});

test('axisLabelBox keeps an end label inside the chart and centres the rest', () => {
  assert.deepEqual(axisLabelBox(150, 40, 300), { left: 130, alignItems: 'center' });
  // The last weekday of a 300 px chart sits 11 px from the edge: 40 px centred would overshoot it.
  assert.deepEqual(axisLabelBox(289, 40, 300), { left: 260, alignItems: 'flex-end' });
  assert.deepEqual(axisLabelBox(11, 40, 300), { left: 0, alignItems: 'flex-start' });
  for (const centre of [0, 5, 11, 150, 289, 295, 300]) {
    const { left } = axisLabelBox(centre, 40, 300);
    assert.ok(left >= 0 && left + 40 <= 300, `label at ${centre} stays inside 0..300`);
  }
  // Narrower than the label box: nothing to slide.
  assert.deepEqual(axisLabelBox(10, 40, 30), { left: 0, alignItems: 'center' });
});

test('a stretched chart puts its first and last point on the edges', () => {
  assert.equal(pointCentreX(0, 0, 13, 300, 64, 0, true), 0);
  assert.equal(pointCentreX(13, 0, 13, 300, 64, 0, true), 300);
  assert.equal(pointCentreX(13, 0, 13, 300, 64, 40, true), 340);
  // Fitted (the default) keeps its inset.
  assert.ok(pointCentreX(0, 0, 13, 300, 90) > 0);
});

test('dotMask "none" draws no dot, not even the latest reading', () => {
  assert.deepEqual(dotMask([1, 2, null, 3], 'none'), [false, false, false, false]);
  assert.deepEqual(dotMask([1, 2, 3], 'isolated'), [false, false, true]);
});

test('14 weekday labels, one per point, are laid inside the plot with the end ones whole', () => {
  const labels = Array.from({ length: 14 }, (_, i) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7]);
  // No blanks, but a label on every point of a dense series is still point-aligned (#3183).
  assert.ok(14 >= DENSE_AXIS_POINTS);
  assert.ok(isPointAlignedAxis(14, 14, labels));
  const width = 290;
  const boxes = labels.map((_, i) =>
    axisLabelBox(pointCentreX(i, 0, 13, width, 88), 40, width),
  );
  // Every box, the first and the last included, sits inside the chart's width.
  boxes.forEach((box) => assert.ok(box.left >= 0 && box.left + 40 <= width));
  // The last label leans on the right edge and is not pushed past it.
  assert.equal(boxes[13].alignItems, 'flex-end');
  assert.equal(boxes[0].alignItems, 'flex-start');
  // Neighbouring points are further apart than a 9 px three-letter weekday (about 18 px) is wide.
  assert.ok(pointCentreX(1, 0, 13, width, 88) - pointCentreX(0, 0, 13, width, 88) > 18);
});

test('smoothPath is a cubic through every point, and a straight line for tension 0 or two points', () => {
  const pts = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }];
  const d = smoothPath(pts);
  assert.match(d, /^M0,10 C/);
  assert.equal(d.match(/C/g)!.length, 2);
  assert.ok(d.endsWith('20,10'));
  assert.equal(smoothPath(pts, 0), 'M0,10 L10,0 L20,10');
  assert.equal(smoothPath(pts.slice(0, 2)), 'M0,10 L10,0');
  assert.equal(smoothPath([]), '');
});
