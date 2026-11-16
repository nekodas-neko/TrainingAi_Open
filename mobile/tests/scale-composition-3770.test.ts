import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { scaleEstimates, weighInDay } from '../src/features/health/data/scale-composition.ts';
import type { BodyRow } from '../src/features/health/data/models.ts';

const row = (o: Partial<BodyRow>) => ({ date: '2026-11-10', ...o }) as BodyRow;
const full = row({
  weightKg: 80,
  bodyFat: 20,
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
});

test('#3770: the estimates are the ten figures worked out from weight, height, age and sex', () => {
  const labels = scaleEstimates(full).map((x) => x.label);
  assert.deepEqual(labels, [
    'Skeletal Muscle',
    'Fat-Free Mass',
    'Muscle Mass',
    'Body Water',
    'Bone Mass',
    'Visceral Fat',
    'BMR',
    'Protein',
    'Subcutaneous Fat',
    'Metabolic Age',
  ]);
  assert.ok(!labels.includes('Weight') && !labels.includes('Body Fat'));
});

test('#3770: a figure the weigh-in did not carry is left out, not shown as zero', () => {
  const estimates = scaleEstimates(row({ skeletalMusclePct: 40, bmrKcal: null }));
  assert.deepEqual(estimates, [{ label: 'Skeletal Muscle', value: '40%' }]);
});

test('#3770: the weigh-in is named by its real day', () => {
  assert.equal(weighInDay('2026-11-16', '2026-11-16'), 'today');
  assert.equal(weighInDay('2026-11-15', '2026-11-16'), 'yesterday');
  assert.match(weighInDay('2026-11-10', '2026-11-16'), /^on /);
});

test('#3770: the card no longer calls every figure measured, and its estimates start closed', async () => {
  const card = await readFile(
    new URL('../src/features/health/components/BodyCompositionCards.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(card, /Measured directly by your body-composition scale/);
  assert.match(card, /Estimated from weight, height, age and sex · \{estimates\.length\}/);
  assert.match(card, /useState\(false\)/);
  assert.match(card, /label="Body fat percent trend"/);
});
