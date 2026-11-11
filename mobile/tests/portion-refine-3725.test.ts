import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { macroCalorieWarning } from '@trainingai/shared/nutrition/scan-totals';
import { portionRefine, refineEstimate } from '../src/features/nutrition/data/portion-refine.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

const fields = {
  name: 'Chicken rice',
  servingSizeG: '150',
  calories: '240',
  proteinG: '18',
  carbsG: '30',
  fatG: '5.1',
  fiberG: '2',
  sugarG: '1.5',
  sodiumMg: '300',
  satFatG: '1.2',
};

test('a portion-only correction is answered on the phone and never asks the model (#3725)', () => {
  // The model's side is the only caller of POST /api/nutrition/scan for a refine.
  let scanPosts = 0;
  let applied: ReturnType<typeof portionRefine> = null;
  const actions = {
    applyLocal: (result: NonNullable<typeof applied>) => {
      applied = result;
    },
    askModel: () => {
      scanPosts += 1;
    },
  };
  for (const correction of ['it was 300g', '300 g', 'actually about 0.3 kg', '2 servings']) {
    applied = null;
    assert.equal(
      refineEstimate({ correction, fields, ingredients: [] }, actions),
      'local',
      correction,
    );
    assert.equal(applied!.fields.servingSizeG, '300', correction);
    assert.equal(applied!.fields.calories, '480', correction);
  }
  assert.equal(scanPosts, 0);
});

test('anything that is not a bare portion still goes to the model', () => {
  let scanPosts = 0;
  const actions = { applyLocal: () => assert.fail('rescaled a sentence'), askModel: () => scanPosts++ };
  for (const correction of ['it was fried in butter', '300', '300 ml', '300g and no rice', '']) {
    assert.equal(refineEstimate({ correction, fields, ingredients: [] }, actions), 'model');
  }
  // No serving size on the form: nothing to scale from, so the model is asked.
  assert.equal(
    refineEstimate(
      { correction: '300g', fields: { ...fields, servingSizeG: '0' }, ingredients: [] },
      actions,
    ),
    'model',
  );
  assert.equal(scanPosts, 6);
});

test('the rescale keeps the name, scales every figure, and resizes ingredients to match', () => {
  const plain = portionRefine('300g', fields, []);
  assert.deepEqual(plain?.fields, {
    name: 'Chicken rice',
    servingSizeG: '300',
    calories: '480',
    proteinG: '36',
    carbsG: '60',
    fatG: '10.2',
    fiberG: '4',
    sugarG: '3',
    sodiumMg: '600',
    satFatG: '2.4',
  });
  const ingredients = [
    { name: 'Chicken', weightG: 50, caloriesPer100g: 160, proteinPer100g: 30, carbsPer100g: 0, fatPer100g: 4 },
    { name: 'Rice', weightG: 100, caloriesPer100g: 130, proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0.3 },
  ];
  const built = portionRefine('300g', fields, ingredients);
  assert.deepEqual(
    built?.ingredients.map((ingredient) => ingredient.weightG),
    [100, 200],
  );
  // The totals are the ingredients' own sum, so the logged ingredients add up to the form.
  assert.equal(built?.fields.servingSizeG, '300');
  assert.equal(built?.fields.proteinG, '36');
  assert.equal(built?.fields.carbsG, '56');
});

test('the Refine button goes through refineEstimate, and analyse is the only scan post', () => {
  const logger = read('features/nutrition/components/FoodLogger.tsx');
  const refine = logger.slice(logger.indexOf('title="Refine"'));
  assert.match(refine.slice(0, 600), /refineEstimate\(/);
  assert.equal(logger.split("post('/api/nutrition/scan'").length - 1, 1);
});

test('the review form and the food-database rows warn when calories and macros disagree (#3725)', () => {
  // 45.7 P / 52.1 C / 13.6 F come to 514 kcal by Atwater; the product states 173.
  assert.deepEqual(
    macroCalorieWarning({ calories: 173, proteinG: 45.7, carbsG: 52.1, fatG: 13.6 }),
    { fromMacros: 514 },
  );
  // Label rounding is not a warning, and neither is a food with no calories or no macros.
  assert.equal(macroCalorieWarning({ calories: 500, proteinG: 45.7, carbsG: 52.1, fatG: 13.6 }), null);
  assert.equal(macroCalorieWarning({ calories: 0, proteinG: 10, carbsG: 10, fatG: 10 }), null);
  assert.equal(macroCalorieWarning({ calories: 50 }), null);
  const logger = read('features/nutrition/components/FoodLogger.tsx');
  assert.match(logger, /<NutritionFieldsForm\s+value=\{d\.fields\}\s+calorieCheck/);
  assert.match(logger, /warning=\{\s*macroCalorieWarning\(scan\)/);
  const elements = read('features/nutrition/components/NutritionElements.tsx');
  assert.match(elements, /calorieCheck && \(\s*<MacroCalorieWarning/);
  assert.match(elements, /onUseMacroCalories=\{\(calories\) => set\('calories', String\(calories\)\)\}/);
});
