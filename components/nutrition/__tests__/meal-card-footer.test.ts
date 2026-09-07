import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mealFooter } from '@/components/nutrition/meal-card-footer';

describe('mealFooter — the gate is a kind, not a count (BF-120 / OR-101)', () => {
  it('gives one loose food its macro breakdown', () => {
    // The report: "1 meal doesnt show the calorie total; but 2 meals do" — and no P/C/F anywhere.
    expect(mealFooter(['log'])).toEqual({ show: true, showCalories: false });
  });

  it('withholds the calorie total from it, because the header already prints that number', () => {
    expect(mealFooter(['log']).showCalories).toBe(false);
  });

  it('draws nothing under one grouped meal, which states its own macros', () => {
    // This is the duplication BF-98 fixed, and it must stay fixed.
    expect(mealFooter(['meal'])).toEqual({ show: false, showCalories: false });
  });

  it('draws both under two or more, whatever they are', () => {
    for (const kinds of [['log', 'log'], ['meal', 'meal'], ['log', 'meal'], ['meal', 'log']] as const) {
      expect(mealFooter([...kinds])).toEqual({ show: true, showCalories: true });
    }
  });

  it('draws nothing for an empty section', () => {
    expect(mealFooter([])).toEqual({ show: false, showCalories: false });
  });

  it('separates the two shapes that share a count of one', () => {
    // BF-120's warning: "Those are different shapes behind the same count of 1, and the fix has to
    // tell them apart — which is likely why the threshold was set where it was."
    expect(mealFooter(['log']).show).not.toBe(mealFooter(['meal']).show);
  });
});

const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8'));

describe('the premise the old gate rested on', () => {
  it('a loose diary row still renders no macros, which is why the footer is needed', () => {
    // Q-406 moved the per-item P/C/F into the detail sheet so one row component could serve the
    // diary, the library and both search lists. If macros ever come back to the row, this footer
    // becomes the duplication it was written to avoid — so the guard fails rather than the screen.
    const row = src('components/nutrition/food-row.tsx');
    for (const macro of ['proteinG', 'carbsG', 'fatG']) {
      expect(row, `food-row.tsx renders ${macro}; re-check mealFooter`).not.toContain(macro);
    }
  });

  it('a group row does render them, which is why it gets no footer', () => {
    const group = src('components/nutrition/diary-meal-group.tsx');
    for (const macro of ['proteinG', 'carbsG', 'fatG']) {
      expect(group).toContain(macro);
    }
  });

  it('meal-card asks the helper rather than counting entries itself', () => {
    const card = src('components/nutrition/meal-card.tsx');
    expect(card).toMatch(/mealFooter\(/);
    expect(card, 'the count-based gate is what got this wrong').not.toMatch(/entries\.length > 1 && <MealTotals/);
  });
});

describe('the demotion that makes a count of one ambiguous', () => {
  it('is why a saved meal can arrive as a loose row', () => {
    // groupDiaryEntries maps a 'meal' holding exactly one log back to a 'log'. So "one saved meal"
    // is not reliably a 'meal' entry, and the footer follows what is RENDERED rather than what was
    // logged — which is the whole reason the gate is a kind and not a provenance.
    const groups = src('components/nutrition/diary-groups.ts');
    expect(groups).toMatch(/e\.kind === 'meal' && e\.logs\.length === 1/);
  });
});
