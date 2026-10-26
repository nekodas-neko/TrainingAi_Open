import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { statusColors } from '../src/shared/theme/tokens.ts';

// The PiP window is native Kotlin and cannot import the theme, so its two status colours are
// copies of the dark status tokens. This keeps them from drifting again (#3435).
const kotlin = readFileSync(
  new URL(
    '../modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PipWindowView.kt',
    import.meta.url,
  ),
  'utf8',
);
const colourOf = (name: string) =>
  kotlin.match(new RegExp(`private val ${name} = Color\\.parseColor\\("(#[0-9A-Fa-f]{6})"\\)`))?.[1];

test('the PiP window uses the dark warning and danger status tokens', () => {
  assert.equal(colourOf('AMBER')?.toLowerCase(), statusColors.dark.warning);
  assert.equal(colourOf('OVER')?.toLowerCase(), statusColors.dark.danger);
});

test('the PiP paused frame is the warning token at the same alpha, not the old amber', () => {
  const frame = kotlin.match(/setStroke\(dp\(2f\), Color\.parseColor\("#([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})"\)\)/);
  assert.equal(`#${frame?.[2]}`.toLowerCase(), statusColors.dark.warning);
});
