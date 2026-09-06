import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { perPortion, showsPerPortion } from '@/components/nutrition/meal-builder-portions';
import { oneServingItems } from '@trainingai/shared/nutrition/saved-meal-ingredients';
import type { SavedMeal } from '@trainingai/shared/types/nutrition';

// The owner's screenshot: Protein Pancakes, 4 portions.
const PANCAKES = { calories: 983, protein: 52, carbs: 103, fat: 39 };

describe('perPortion — BF-121', () => {
  it('divides the macros, not only the calories', () => {
    // The bug in one line: 246 kcal was already divided and 52 P was not.
    const p = perPortion(PANCAKES, 4);
    expect(Math.round(p.calories)).toBe(246);
    expect(Math.round(p.protein)).toBe(13);
    expect(Math.round(p.carbs)).toBe(26);
    expect(Math.round(p.fat)).toBe(10);
  });

  it('reproduces the calorie figure the footer already showed', () => {
    // Whatever else changes, the number on screen today must not move.
    expect(Math.round(perPortion(PANCAKES, 4).calories)).toBe(Math.round(983 / 4));
  });

  it('divides before rounding', () => {
    // Rounding first would print 1 P per portion here instead of 0.5 → 1... and 2 P for a batch of
    // 5.4 over 3. The diary row the log writes divides first, so the builder must too.
    const p = perPortion({ calories: 10, protein: 5.4, carbs: 0, fat: 0 }, 3);
    expect(p.protein).toBeCloseTo(1.8, 10);
    expect(Math.round(p.protein)).toBe(2);
  });

  it('leaves a one-portion meal alone', () => {
    expect(perPortion(PANCAKES, 1)).toEqual(PANCAKES);
    expect(showsPerPortion(1)).toBe(false);
  });

  it('falls back to the batch when servings cannot divide', () => {
    // Same guard as `oneServingItems`, which is the canonical path.
    for (const bad of [0, -1, NaN]) {
      expect(perPortion(PANCAKES, bad)).toEqual(PANCAKES);
      expect(showsPerPortion(bad)).toBe(false);
    }
  });

  it('shows the second line only when it says something new', () => {
    expect(showsPerPortion(4)).toBe(true);
    expect(showsPerPortion(2)).toBe(true);
  });
});

describe('it agrees with the canonical per-portion path', () => {
  it('dividing the batch sum equals summing the scaled ingredients', () => {
    // `oneServingItems` scales each ingredient's quantityMultiplier by 1/servings and the totals are
    // a linear sum of those, so the two routes are the same real number — which is why the footer
    // may divide the batch instead of re-deriving rows it does not have.
    const meal = {
      id: 'm', userId: 'u', name: 'Spec', servings: 4, createdAt: '', items: [
        { id: 'a', savedMealId: 'm', foodItemId: 'f1', quantityMultiplier: 2,
          foodItem: { id: 'f1', name: 'A', servingSizeG: 100, calories: 300, proteinG: 20, carbsG: 30, fatG: 10 } },
        { id: 'b', savedMealId: 'm', foodItemId: 'f2', quantityMultiplier: 1,
          foodItem: { id: 'f2', name: 'B', servingSizeG: 100, calories: 383, proteinG: 12, carbsG: 43, fatG: 19 } },
      ],
      // Cast to the real type rather than `any`: this fixture stands in for a saved meal, and a
      // shape that drifts from `SavedMeal` should fail here rather than pass by being untyped.
    } as unknown as SavedMeal;
    const scaled = oneServingItems(meal);
    const sum = (k: 'calories' | 'proteinG' | 'carbsG' | 'fatG') =>
      scaled.reduce<number>((a, i) => a + (i.foodItem?.[k] ?? 0) * i.quantityMultiplier, 0);
    const batch = { calories: 300 * 2 + 383, protein: 20 * 2 + 12, carbs: 30 * 2 + 43, fat: 10 * 2 + 19 };
    const p = perPortion(batch, 4);
    expect(p.calories).toBeCloseTo(sum('calories'), 10);
    expect(p.protein).toBeCloseTo(sum('proteinG'), 10);
    expect(p.carbs).toBeCloseTo(sum('carbsG'), 10);
    expect(p.fat).toBeCloseTo(sum('fatG'), 10);
  });
});

const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the footer shows both denominators, each labelled', () => {
  const footer = code(readFileSync(path.resolve(__dirname, '../meal-builder-footer.tsx'), 'utf8'));

  it('no longer divides only the calories inline', () => {
    expect(footer, 'the one-denominator-per-row shape is the bug').not.toMatch(/batchKcal \/ servings/);
    expect(footer).not.toMatch(/\{Math\.round\(batchKcal\)\} kcal/);
  });

  it('labels both lines and renders them through one component', () => {
    expect(footer).toMatch(/label="Batch"/);
    expect(footer).toMatch(/label="Per portion"/);
    // Two instances, not two copies — a second copy is how the formats drift apart again.
    expect(footer.match(/function MacroLine\(/g) ?? []).toHaveLength(1);
  });

  it('gates the second line on the helper rather than an inline count', () => {
    expect(footer).toMatch(/showsPerPortion\(servings\)/);
  });
});
