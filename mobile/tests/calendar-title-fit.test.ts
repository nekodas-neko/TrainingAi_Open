import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarTitleStacked, stackCalendarTitleToFit } from '../src/shared/ui/monthGrid';
import { textScale } from '../src/shared/theme/text-scale';
import { sizes, spacing } from '../src/shared/theme/tokens';

// Widths follow the layout: a 16 px screen margin and 16 px card padding on each side, controls of
// two 28 px drawn arrows (48 px to touch, through hitSlop), the month label and two xs gaps, and
// the 12 px uppercase "TRAINING CALENDAR" at roughly 140 px on one line, growing with text scale.
// The status slot is outside the measured controls. The gap kept beside the title is the shared
// row's own, sm.
const CONTROLS = 2 * sizes.calendarArrow + sizes.calendarMonthLabel + 2 * spacing.xs;
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

test('the title shares the row with the controls at 0.9 and 1.0 on a 384 px phone (#2948)', () => {
  for (const fontScale of [0.9, 1]) assert.equal(fits(384, fontScale), false, `${fontScale}`);
});

test('the title shares the row at 0.9 and 1.0 on a 412 px phone', () => {
  for (const fontScale of [0.9, 1]) assert.equal(fits(412, fontScale), false, `${fontScale}`);
});

test('the title stacks at text size 1.3 on both phones, never cut', () => {
  for (const phone of [384, 412]) assert.equal(fits(phone, 1.3), true, `${phone}`);
});

test('the title shares the row only when the controls leave it its one-line width plus the gap', () => {
  const base = { controlsWidth: CONTROLS, titleWidth: 140, gap: GAP };
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP }), false);
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + GAP - 1 }), true);
  // With the xs gap a 4 px window would wrongly say it fits; the row's real gap is sm.
  assert.equal(stackCalendarTitleToFit({ ...base, rowWidth: CONTROLS + 140 + spacing.xs }), true);
});

test('before anything is measured the title shares the row, the layout a phone settles on', () => {
  assert.equal(calendarTitleStacked(null), false);
});

test('once measured, the fit decides: a wide block puts the title back on the row', () => {
  const base = { controlsWidth: CONTROLS, titleWidth: 140, gap: GAP };
  assert.equal(calendarTitleStacked({ ...base, rowWidth: 300 }), true);
  assert.equal(calendarTitleStacked({ ...base, rowWidth: CONTROLS + 140 + GAP }), false);
});

test('a 48 px status slot is centred over a header line without adding height (#2934)', async () => {
  const { centredOverlayTop } = await import('../src/shared/ui/touchSlop');
  assert.equal(centredOverlayTop(15, 48), -16.5);
  assert.equal(centredOverlayTop(48, 48), 0);
});
