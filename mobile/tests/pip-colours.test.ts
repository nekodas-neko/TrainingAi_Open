import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { statusColors } from '../src/shared/theme/tokens.ts';

// The PiP window is native Kotlin and cannot import the theme, so its two status colours are
// copies of the dark status tokens. This keeps them from drifting again (#3435). Since the one card
// (#3734) they are the Paused and Rest over states' colours, in PipState.kt.
const kotlin = readFileSync(
  new URL(
    '../modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PipState.kt',
    import.meta.url,
  ),
  'utf8',
);
const colourOf = (name: string) =>
  kotlin.match(new RegExp(`const val ${name} = "(#[0-9A-Fa-f]{6})"`))?.[1];

test('the PiP window uses the dark warning and danger status tokens', () => {
  assert.equal(colourOf('PAUSED_COLOR')?.toLowerCase(), statusColors.dark.warning);
  assert.equal(colourOf('OVER_COLOR')?.toLowerCase(), statusColors.dark.danger);
});

test('the paused card is drawn in the warning token, not the old amber', () => {
  assert.match(kotlin, /PipCardState\.PAUSED, PAUSED_COLOR, "PAUSED"/);
});
