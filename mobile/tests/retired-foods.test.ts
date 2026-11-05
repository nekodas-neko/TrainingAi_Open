import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foodSchema } from '../src/features/nutrition/data/models.ts';
import { refreshedLibrary } from '../src/features/nutrition/data/retired-foods.ts';

const food = (id: string, extra: Record<string, unknown> = {}) =>
  foodSchema.parse({
    id, name: 'Granola', source: 'manual', servingSizeG: 40, calories: 180, proteinG: 4, carbsG: 25, fatG: 7, ...extra,
  });

// #3476.
test('the library drops retired foods, keeps the rest in order, and lays fresh copies over by id', () => {
  const library = [food('a'), food('b'), food('c')];
  const out = refreshedLibrary(library, [food('d')], {
    retired: [{ id: 'b' }],
    keepers: [food('a', { barcode: '123' })],
    at: '2026-11-05T00:00:00.000Z',
  });
  assert.deepEqual(out.map((x) => x.id), ['a', 'c', 'd']);
  assert.equal(out[0].barcode, '123');
});

test('a retired id never comes back through the list or the keepers', () => {
  const out = refreshedLibrary([food('a')], [food('b')], {
    retired: [{ id: 'b' }],
    keepers: [food('b')],
    at: '2026-11-05T00:00:00.000Z',
  });
  assert.deepEqual(out.map((x) => x.id), ['a']);
});

test('with no retired-foods answer the library only takes the list over it', () => {
  const out = refreshedLibrary([food('a'), food('b')], [food('b', { barcode: '9' })], null);
  assert.deepEqual(out.map((x) => [x.id, x.barcode ?? null]), [['a', null], ['b', '9']]);
});
