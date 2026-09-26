import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..');
/** The shared stripper — see the note in `rv111-scanner-back-dismiss.test.ts`; the regex
 *  pair the other source-scan tests copy mangles `accept="image/*"`. */
const src = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * RV-203 — food capture asked the model before checking the user's own foods.
 *
 * The logic each half rests on is unit-tested next door (`describe-search-phrase.test.ts`,
 * `portion-correction.test.ts`). What those cannot see is the WIRING, and the wiring is where this
 * would die quietly: the props below are all optional, so a call site that drops one degrades to
 * "no suggestions, ask the model" — the exact behaviour the entry exists to remove, with nothing
 * on screen to say it happened. There is no DOM project in this suite, so these are source
 * assertions.
 */
describe('RV-203 ① — the describe panel looks in the user\'s own foods first', () => {
  const capture = src('components/nutrition/capture-actions.tsx');
  const sheet = src('components/nutrition/saved-meals-sheet.tsx');

  it('searches the stored foods on the extracted phrase, never on the raw description', () => {
    // `searchFoodItems` is `name LIKE %q%`, so the whole typed sentence matches nothing. Passing
    // `describeText` straight in would look correct and find nothing, forever.
    expect(capture).toMatch(/describeSearchPhrase\(describeText\)/);
    expect(capture).toMatch(/store\.searchFoodItems\(phrase\)/);
    expect(capture).not.toMatch(/searchFoodItems\(describeText\)/);
  });

  it('reuses the list\'s own cache key rather than minting a second one for the same endpoint', () => {
    expect(capture).toMatch(/import \{ ALL_ITEMS_KEY \} from '\.\/food-list'/);
    expect(capture).toMatch(/readCacheSync<FoodItem\[\]>\(ALL_ITEMS_KEY\)/);
  });

  it('adds no network read of its own — every source is already on the device or in memory', () => {
    // Two `/api/` calls in this file, both of which were already here: the scan POST and the
    // barcode GET. A third would also break `scripts/check-bare-api-fetch.js`, which baselines
    // this file's bare GETs at 1.
    const apiFetches = capture.match(/fetch\(\s*`?['"`]?\/api\//g) ?? [];
    expect(apiFetches).toHaveLength(2);
    expect(capture).toMatch(/\/api\/nutrition\/barcode\?code=/);
    expect(capture).toMatch(/fetch\('\/api\/nutrition\/scan'/);
  });

  it('the suggestions come before the action row, not after it', () => {
    // A shortcut nobody sees until they have already committed to Analyse is not a shortcut.
    const suggestions = capture.indexOf('You already have');
    const analyse = capture.indexOf('onClick={handleDescribe}');
    expect(suggestions).toBeGreaterThan(-1);
    expect(analyse).toBeGreaterThan(-1);
    expect(suggestions).toBeLessThan(analyse);
  });

  it('the host sheet passes all four optional props, or the panel silently has nothing to offer', () => {
    const call = sheet.slice(sheet.indexOf('<CaptureActions'), sheet.indexOf('</CaptureActions>'));
    expect(call).toMatch(/userId=\{userId\}/);
    expect(call).toMatch(/savedMeals=\{meals\}/);
    expect(call).toMatch(/onSelectFood=\{onSelectFood\}/);
    expect(call).toMatch(/onOpenSavedMeal=\{openDetail\}/);
  });

  it('a tapped meal shows the same one-portion figure the meal list shows', () => {
    // Two lists on the same screen disagreeing about what a meal costs is the "One Formula, One
    // Place" failure; both go through `saved-meal-totals`.
    expect(capture).toMatch(/sumRows\(portionRows\(meal\)\)\.calories/);
  });
});

describe('RV-203 ③ — a portion-only correction never reaches the model', () => {
  const review = src('components/nutrition/review-step.tsx');
  const refine = review.slice(review.indexOf('async function handleRefine'), review.indexOf('function numField'));

  it('parses the correction before anything is sent', () => {
    const parsed = refine.indexOf('parsePortionCorrection(correction)');
    const sending = refine.indexOf('setRefining(true)');
    const posting = refine.indexOf("fetch('/api/nutrition/scan'");
    expect(parsed).toBeGreaterThan(-1);
    expect(parsed).toBeLessThan(sending);
    expect(parsed).toBeLessThan(posting);
  });

  it('rescales through the serving-size editor rather than recomputing macros beside it', () => {
    // `handleServingChange` scales every macro from the base snapshot. A second implementation
    // here would be a second copy of the same arithmetic, and they would drift.
    expect(refine).toMatch(/handleServingChange\(grams\)/);
    expect(refine).toMatch(/\breturn\b/);
  });

  it('requires the base snapshot, so an estimate with no serving size still asks the model', () => {
    expect(refine).toMatch(/if \(base && portion\)/);
  });
});
