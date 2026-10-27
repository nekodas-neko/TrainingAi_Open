import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stackCalendarTitle, stackCalendarTitleToFit } from '../src/shared/ui/monthGrid';
import { textScale } from '../src/shared/theme/text-scale';

// Widths follow the layout: a 16 px screen margin and 16 px card padding on each side, controls of
// two 48 px arrows, the 96 px month label, a 48 px status slot and three 4 px gaps, and the
// 12 px uppercase "TRAINING CALENDAR" at roughly 140 px on one line, growing with text scale.
const CONTROLS = 48 + 48 + 96 + 48 + 12;
const GAP = 4;

function fits(phone: number, fontScale: number) {
  const scale = textScale(fontScale);
  return stackCalendarTitleToFit({
    rowWidth: phone - 64,
    controlsWidth: CONTROLS,
    titleWidth: Math.ceil(140 * scale),
    gap: GAP,
  });
}

test('the title stacks at 0.9, 1.0 and 1.3 on a 384 px phone', () => {
  for (const fontScale of [0.9, 1, 1.3]) assert.equal(fits(384, fontScale), true, `${fontScale}`);
});

test('the title stacks at 0.9, 1.0 and 1.3 on a 412 px phone', () => {
  for (const fontScale of [0.9, 1, 1.3]) assert.equal(fits(412, fontScale), true, `${fontScale}`);
});

test('the title shares the row when the controls leave it its one-line width', () => {
  const base = { controlsWidth: CONTROLS, titleWidth: 140, gap: GAP };
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP }), false);
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP - 1 }), true);
});

test('before measuring, the text scale decides: 0.9 and 1.0 share the row, 1.3 stacks', () => {
  assert.equal(stackCalendarTitle(textScale(0.9)), false);
  assert.equal(stackCalendarTitle(textScale(1)), false);
  assert.equal(stackCalendarTitle(textScale(1.3)), true);
});
