import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_PAUSED_CODE, AI_PAUSED_MESSAGE } from '@trainingai/shared/ai-paused-notice';
import { ApiError } from '../src/features/account/api/client.ts';
import { readRecipeScan, recipePhotoError } from '../src/features/nutrition/data/scan-response.ts';
import { createScanGate } from '../src/integrations/nutrition/scan-gate.ts';

const dish = {
  name: 'Lentil dal',
  calories: 600,
  proteinG: 30,
  carbsG: 90,
  fatG: 10,
  servingSizeG: 400,
  confidence: 'medium',
  ingredients: [],
};

test('the scan gate lets one code through until the scanner is opened again', () => {
  const gate = createScanGate();
  assert.equal(gate.take(), true);
  assert.equal(gate.take(), false);
  gate.reset();
  assert.equal(gate.take(), true);
});

test('a recipe photo answer keeps its yield, and "could not identify" is an unidentified recipe', () => {
  const read = readRecipeScan({ ...dish, origin: 'photo', recipeYield: 4 });
  assert.equal(read.recipeYield, 4);
  assert.throws(() => readRecipeScan({ error: 'Could not identify food' }));
  assert.match(
    recipePhotoError(
      (() => {
        try {
          readRecipeScan({ error: 'Could not identify food' });
        } catch (e) {
          return e;
        }
      })(),
    ),
    /No recipe was found/,
  );
});

test('the paused 503 shows the fixed sentence on the recipe photo path as on food scanning', () => {
  const paused = new ApiError(503, AI_PAUSED_CODE, AI_PAUSED_MESSAGE);
  assert.equal(recipePhotoError(paused), AI_PAUSED_MESSAGE);
  assert.match(recipePhotoError(new ApiError(413)), /too large/);
});
