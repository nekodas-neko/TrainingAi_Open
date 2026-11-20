import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEXT_SCALE, scalesText, textScale } from '../src/shared/theme/text-scale';

// The current app's WebView scales all text by the system font scale, down as well as up, so
// Preview does too (#3912).
test('a font scale below 1 shrinks text as the WebView does', () => {
  assert.equal(textScale(0.9), 0.9);
  assert.equal(textScale(0.85), 0.85);
  assert.equal(scalesText(0.9), true);
});

test('a font scale of 1 or more still grows text', () => {
  assert.equal(textScale(1), 1);
  assert.equal(textScale(1.3), 1.3);
  assert.equal(scalesText(1), true);
  assert.equal(scalesText(1.3), true);
});

test('growth stops at the cap, past which fixed rows clip their text', () => {
  assert.equal(MAX_TEXT_SCALE, 1.3);
  assert.equal(textScale(1.15), 1.15);
  assert.equal(textScale(2), MAX_TEXT_SCALE);
});

test('an unreadable font scale leaves text at its token size', () => {
  assert.equal(textScale(Number.NaN), 1);
  assert.equal(textScale(0), 1);
  assert.equal(scalesText(Number.NaN), false);
  assert.equal(scalesText(0), false);
});
