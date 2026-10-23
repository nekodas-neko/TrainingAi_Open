import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { geistFace, geistFaces, withGeist } from '../src/shared/theme/fonts';
import { typography } from '../src/shared/theme/tokens';

// Preview draws Geist like the current app. Android picks no weight from one family name, so every
// weight a token or an inline override uses must resolve to a face the build embeds.
const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const plugin = config.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-font');
const embedded: string[] = (plugin?.[1].fonts ?? []).map((path: string) =>
  path.split('/').pop()!.replace('.ttf', ''),
);

test('every Geist face is embedded by the expo-font plugin and exists on disk', () => {
  for (const face of Object.values(geistFaces)) {
    assert.ok(embedded.includes(face), `${face} is missing from the expo-font plugin in app.json`);
  }
  for (const path of plugin[1].fonts) {
    assert.doesNotThrow(() => readFileSync(new URL(`../${path}`, import.meta.url)), path);
  }
});

test('every typography token resolves to a bundled face', () => {
  for (const [name, token] of Object.entries(typography)) {
    const face = geistFace((token as { fontWeight?: never }).fontWeight);
    assert.ok(face && embedded.includes(face), `${name} (${token['fontWeight' as never]}) has no face`);
  }
});

test('every weight in use maps to its own face, and bold is never synthesised', () => {
  for (const [weight, face] of Object.entries(geistFaces)) {
    const style = withGeist({ fontWeight: weight as '400', fontSize: 14 });
    assert.equal(style.fontFamily, face);
    assert.equal(style.fontWeight, undefined);
    assert.equal(style.fontSize, 14);
  }
  assert.equal(withGeist({}).fontFamily, geistFaces['400']);
  assert.equal(withGeist({ fontWeight: '500' }).fontFamily, geistFaces['500']);
  assert.equal(geistFace('bold'), geistFaces['700']);
});

test('an unmapped weight is kept, not quietly sent to the system font', () => {
  assert.equal(geistFace('300'), undefined);
  assert.equal(withGeist({ fontWeight: '300' }).fontWeight, '300');
});
