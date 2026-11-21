// #3964: the weekly muscle card opens a row to a 6-week tonnage line, as the current app's does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { muscleTonnageTrendSpec } from '../src/features/health/data/models.ts';
import { muscleTonnageValues } from '../src/features/health/data/training-view.ts';

test('reads the route the current app reads and accepts its response shape', () => {
  assert.equal(muscleTonnageTrendSpec.path, '/api/muscle-tonnage-trend');
  const parsed = muscleTonnageTrendSpec.schema.parse({
    weekStarts: ['2026-10-12', '2026-10-19'],
    muscles: { Chest: [1200, 1500] },
  });
  assert.deepEqual(parsed.muscles.Chest, [1200, 1500]);
  assert.throws(() => muscleTonnageTrendSpec.schema.parse({ weekStarts: [], muscles: { Chest: ['x'] } }));
});

test('a muscle draws a line only with two or more weeks', () => {
  const trend = { muscles: { Chest: [1, 2, 3], Calves: [5], Core: [] as number[] } };
  assert.deepEqual(muscleTonnageValues(trend, 'Chest'), [1, 2, 3]);
  assert.equal(muscleTonnageValues(trend, 'Calves'), null);
  assert.equal(muscleTonnageValues(trend, 'Core'), null);
  assert.equal(muscleTonnageValues(trend, 'Quads'), null);
  assert.equal(muscleTonnageValues(null, 'Chest'), null);
});
