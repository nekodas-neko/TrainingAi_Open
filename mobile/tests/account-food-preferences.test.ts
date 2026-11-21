// #3964: the food search region and meal label style follow the account, as the current app's
// `foodRegion` and `mealLabelStyle` preferences, and fall back to what the phone had.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  foodRegionChoice,
  foodRegionPatch,
  mealLabelStyleChoice,
  mealLabelStylePatch,
} from '../src/features/nutrition/data/account-preferences.ts';
import { preferencesSchema } from '../src/features/home/data/models.ts';

test('the account region wins, then the phone, then AU', () => {
  assert.equal(foodRegionChoice('NZ', 'US'), 'NZ');
  assert.equal(foodRegionChoice(undefined, 'US'), 'US');
  assert.equal(foodRegionChoice('', undefined), 'AU');
});

test('the account label style wins; an unknown value falls back to a real style', () => {
  assert.equal(mealLabelStyleChoice('band', 'inlineCentred'), 'band');
  assert.equal(mealLabelStyleChoice(undefined, 'inlineCentred'), 'inlineCentred');
  assert.equal(mealLabelStyleChoice('nonsense', undefined), 'inlineCentred');
});

test('patches use the account keys, and Home preferences now carry both', () => {
  assert.deepEqual(foodRegionPatch('GB'), { foodRegion: 'GB' });
  assert.deepEqual(mealLabelStylePatch('band'), { mealLabelStyle: 'band' });
  assert.deepEqual(mealLabelStylePatch('nonsense'), { mealLabelStyle: 'inlineCentred' });
  const parsed = preferencesSchema.parse({ foodRegion: 'CA', mealLabelStyle: 'inlineCentred', junk: 1 });
  assert.deepEqual(parsed, { foodRegion: 'CA', mealLabelStyle: 'inlineCentred' });
  assert.deepEqual(preferencesSchema.parse(foodRegionPatch('NZ')), { foodRegion: 'NZ' });
});
