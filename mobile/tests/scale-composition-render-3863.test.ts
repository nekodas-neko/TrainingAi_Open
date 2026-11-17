import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import type { BodyRow } from '../src/features/health/data/models.ts';

// #3863: the scale composition card, rendered. The card's React Native layer is swapped for the
// plain-HTML stubs in fixtures/, and its `useState` for one a test can drive, so this runner can
// render the real component and tap its disclosure row.
const card = new URL('../src/features/health/components/BodyCompositionCards.tsx', import.meta.url)
  .href;
const stubs = new URL('./fixtures/native-render-stubs.ts', import.meta.url).href;
const hookState = new URL('./fixtures/hook-state.ts', import.meta.url).href;
const stubbed = new Set([
  'react-native',
  '../../../shared/ui',
  '../../../shared/ui/layoutMotion',
  '../../../shared/ui/Pressable',
  '../../../shared/ui/useReducedMotion',
  '../../../shared/theme/ThemeProvider',
  './RangeBar',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === card) {
      if (specifier === 'react') return { url: hookState, shortCircuit: true };
      if (stubbed.has(specifier)) return { url: stubs, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
// react-dom ships no types here, and no dependency is added for one function.
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { ScaleCompositionCard } = await import(card);
const { pressed } = await import(stubs);
const { held } = await import(hookState);

const TODAY = '2026-11-16';
const weighIn = (date: string, fat: number, corrected?: number): BodyRow =>
  ({
    date,
    weightKg: 80,
    bodyFat: fat,
    ...(corrected == null ? {} : { bodyFatCorrected: corrected, bodyFatIsCorrected: true }),
    skeletalMusclePct: 40,
    fatFreeMassKg: 64,
    muscleMassKg: 48,
    bodyWaterPct: 58,
    boneMassKg: 3.6,
    visceralFatIndex: 8,
    bmrKcal: 1750,
    proteinPct: 18,
    subcutaneousFatPct: 17,
    metabolicAge: 30,
  }) as BodyRow;
// Newest first, as the Body tab passes them. The 13th is a manual body-fat entry, no weigh-in.
const rows: BodyRow[] = [
  weighIn('2026-11-16', 20, 22),
  weighIn('2026-11-15', 20.5, 22.5),
  { date: '2026-11-13', weightKg: null, bodyFat: 30 } as BodyRow,
  weighIn('2026-11-12', 21),
  weighIn('2026-11-11', 21.5),
];
const render = () =>
  renderToStaticMarkup(createElement(ScaleCompositionCard, { rows, today: TODAY }));

test('#3863: closed by default, with the count, and the corrected About text', () => {
  delete held.value;
  const html = render();
  assert.match(html, /From your weigh-in today/);
  assert.match(html, /Weight: 80 kg \(measured\)/);
  assert.match(html, /Body Fat: 22%/);
  assert.match(html, /Estimated from weight, height, age and sex · 10/);
  assert.match(html, /<i>&gt;<\/i>/);
  assert.doesNotMatch(html, /Skeletal Muscle:/);
  assert.match(html, /Weight is measured\s+directly/);
  assert.match(html, /The figures under “Estimated” are fixed ratios/);
  assert.doesNotMatch(html, /measured directly by your body-composition scale/i);
});

test('#3863: opening the row shows the grid of estimates', () => {
  delete held.value;
  render();
  pressed.onPress?.();
  assert.equal(held.value, true);
  const html = render();
  assert.match(html, /<i>v<\/i>/);
  for (const label of ['Skeletal Muscle: 40%', 'BMR: 1750 kcal', 'Metabolic Age: 30 yrs'])
    assert.ok(html.includes(label), label);
});

test('#3863: the sparkline plots weigh-ins only and marks the corrected seam', () => {
  delete held.value;
  const html = render();
  const points = html.match(/data-points="([^"]*)"/)?.[1];
  assert.equal(points, '2026-11-11=21.5,2026-11-12=21,2026-11-15=22.5,2026-11-16=22');
  assert.equal(html.match(/data-markers="([^"]*)"/)?.[1], '1.5');
  assert.match(html, /Body fat % trend · corrected from the dashed line/);
});
