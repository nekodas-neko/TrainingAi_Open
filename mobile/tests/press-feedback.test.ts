import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRESSED_OPACITY,
  dimsOnPress,
  withPressedOpacity,
} from '../src/shared/ui/pressFeedback';
import { slopTo } from '../src/shared/ui/touchSlop';
import { sizes, spacing } from '../src/shared/theme/tokens';

// #3759: one pressed look, applied by the shared Pressable, so a feature never sets its own.

const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flat))
    : style && typeof style === 'object'
      ? (style as Record<string, unknown>)
      : {};
const opacity = (style: unknown, pressed: boolean) =>
  flat(withPressedOpacity(style)({ pressed })).opacity;
const press = () => {};

test('a pressable with no pressed style of its own dims while pressed', () => {
  assert.equal(opacity({ padding: 8 }, true), PRESSED_OPACITY);
  assert.equal(opacity({ padding: 8 }, false), undefined);
  assert.equal(opacity(undefined, true), PRESSED_OPACITY);
  assert.equal(opacity(() => [{ padding: 8 }, null], true), PRESSED_OPACITY);
  assert.equal(flat(withPressedOpacity({ padding: 8 })({ pressed: true })).padding, 8);
});

test("a caller's own pressed opacity is left alone", () => {
  const own = ({ pressed }: { pressed: boolean }) => ({ opacity: pressed ? 0.5 : 1 });
  assert.equal(opacity(own, true), 0.5);
  assert.equal(opacity(own, false), 1);
  const nested = ({ pressed }: { pressed: boolean }) => [{ opacity: 1 }, [pressed && { opacity: 0.4 }]];
  assert.equal(opacity(nested, true), 0.4);
});

test('a fixed opacity is dimmed in proportion, not replaced', () => {
  assert.equal(opacity({ opacity: 0.5 }, true), 0.5 * PRESSED_OPACITY);
  assert.equal(opacity({ opacity: 0.5 }, false), 0.5);
});

test('the opt-out, a disabled control and one that answers no press do not dim', () => {
  assert.equal(dimsOnPress({ onPress: press }), true);
  assert.equal(dimsOnPress({ onLongPress: press }), true);
  assert.equal(dimsOnPress({ onPress: press, feedback: 'none' }), false);
  assert.equal(dimsOnPress({ onPress: press, disabled: true }), false);
  assert.equal(dimsOnPress({}), false);
});

test('hit slop makes up the shortfall to the touch target and is never negative', () => {
  assert.equal(20 + 2 * slopTo(sizes.touchTarget, 20), 48);
  assert.ok(37 + 2 * slopTo(sizes.touchTarget, 37) >= 48);
  assert.equal(slopTo(sizes.touchTarget, 60), 0);
});

test("a segmented control's cell reaches the touch target inside its own track", () => {
  // The cell is drawn `control` high with (touchTarget - control) / 2 of hitSlop above and below.
  // The track pads it by `xs`, so that reach stays inside the track and is not clipped by it.
  assert.equal(sizes.control + 2 * spacing.xs, sizes.touchTarget);
});
