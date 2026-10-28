import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarTitleStacked, stackCalendarTitleToFit } from '../src/shared/ui/monthGrid';
import { textScale } from '../src/shared/theme/text-scale';
import { sizes, spacing } from '../src/shared/theme/tokens';

// Widths follow the layout: a 16 px screen margin and 16 px card padding on each side, controls of
// two 48 px arrows, the month label, a 48 px status slot and three xs gaps, and the 12 px uppercase
// "TRAINING CALENDAR" at roughly 140 px on one line, growing with text scale. The gap kept beside
// the title is the shared row's own, sm.
const CONTROLS = 48 + 48 + sizes.calendarMonthLabel + 48 + 3 * spacing.xs;
const GAP = spacing.sm;

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

test('the title shares the row only when the controls leave it its one-line width plus the gap', () => {
  const base = { controlsWidth: CONTROLS, titleWidth: 140, gap: GAP };
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP }), false);
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP - 1 }), true);
  // With the xs gap a 4 px window would wrongly say it fits; the row's real gap is sm.
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + spacing.xs }), true);
});

test('before anything is measured the title is stacked, so the first paint does not jump', () => {
  assert.equal(calendarTitleStacked(null), true);
});

test('once measured, the fit decides: a wide block puts the title back on the row', () => {
  const base = { controlsWidth: CONTROLS, titleWidth: 140, gap: GAP };
  assert.equal(calendarTitleStacked({ ...base, rowWidth: 320 }), true);
  assert.equal(calendarTitleStacked({ ...base, rowWidth: CONTROLS + 140 + GAP }), false);
});
