import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openingDraft } from '../src/features/nutrition/data/opening-draft.ts';

type Draft = { mealTypeId: string; tab: 'recent' | 'meals' | 'search'; text: string };
const saved: Draft = { mealTypeId: 'breakfast', tab: 'recent', text: 'half typed' };

// #2123: tap estimated Lunch, "I ate something else", "Search all foods" over a day whose saved
// draft is Breakfast on Recent. Both changes have to land in the one write.
test('the logger opens on the requested meal group and tab together', () => {
  assert.deepEqual(openingDraft(saved, { mealTypeId: 'lunch', tab: 'search' }), {
    mealTypeId: 'lunch',
    tab: 'search',
    text: 'half typed',
  });
});

test('only what differs from the saved draft is changed, and nothing when it already matches', () => {
  assert.deepEqual(openingDraft(saved, { mealTypeId: 'lunch' }), { ...saved, mealTypeId: 'lunch' });
  assert.deepEqual(openingDraft(saved, { tab: 'search' }), { ...saved, tab: 'search' });
  assert.equal(openingDraft(saved, { mealTypeId: 'breakfast', tab: 'recent' }), null);
  assert.equal(openingDraft(saved, {}), null);
});
