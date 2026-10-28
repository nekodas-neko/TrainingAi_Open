import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { washSize } from '../src/shared/ui/card-wash.ts';
import { homeCardColors } from '../src/shared/theme/tokens.ts';
import { palettes } from '../src/shared/theme/palettes.ts';

// #3506: Home's cards take the current app's tints, and the wash covers the whole card.
test('every Home card tint is the current app default', async () => {
  // Read as text: the current app's file imports through its own `@/` alias, which this project's
  // typecheck cannot resolve.
  const web = await readFile(
    new URL('../../app/session-select/constants.ts', import.meta.url),
    'utf8',
  );
  const block = web.slice(web.indexOf('CARD_DEFAULT_COLORS'));
  const expected = Object.fromEntries(
    [...block.matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
  );
  assert.ok(Object.keys(expected).length >= 13, 'parsed the current app table');
  assert.deepEqual(homeCardColors, expected);
});

function oklchToHex(L: number, C: number, hue: number): string {
  const a = C * Math.cos((hue * Math.PI) / 180);
  const b = C * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    '#' +
    rgb
      .map((x) => {
        const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(255 * v)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

test('the base an accent wash sits on is the web --muted (dark, brand hue 149)', () => {
  // app/globals.css: --muted: oklch(0.225 0.034 var(--brand-hue, 149)) in dark.
  assert.equal(palettes.green.dark.raised, oklchToHex(0.225, 0.034, 149));
});

test('the wash is drawn at the card measured size, however tall that is', () => {
  assert.deepEqual(washSize(340, 180, null), { width: 340, height: 180 });
  const first = washSize(340, 120, null);
  assert.deepEqual(
    washSize(340, 190, first),
    { width: 340, height: 190 },
    'a card that grows is washed to its new height',
  );
  assert.equal(washSize(0, 0, first), first, 'an unmeasured layout keeps the last size');
});

test('Card gives the wash no fixed or percentage height', async () => {
  const card = await readFile(new URL('../src/shared/ui/Card.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /height="100%"/);
  assert.match(card, /onLayout=/);
  assert.match(card, /<Svg width=\{wash\.width\} height=\{wash\.height\}>/);
});
