import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEXT_SCALE, scalesText, textScale } from '../src/shared/theme/text-scale';

// The current app's WebView never draws text below its CSS size, so neither does Preview (#2994).
test('a font scale below 1 leaves text at its token size', () => {
  assert.equal(textScale(0.9), 1);
  assert.equal(textScale(0.85), 1);
  assert.equal(scalesText(0.9), false);
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
  assert.equal(textScale(Number.NaN), 1);
  assert.equal(textScale(0), 1);
});
