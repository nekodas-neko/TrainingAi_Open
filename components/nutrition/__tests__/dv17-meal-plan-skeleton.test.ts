import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js';

const ROOT = path.resolve(__dirname, '../../..');
/** Comments are stripped first: the fix's own comment quotes the shape it replaced. */
const code = (s: string) =>
  stripComments(s);
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * DV-17 — Nutrition painted a 338x108 pulse on every warm visit for an account with no meal plan,
 * 3 of 3 on the S25, while Health/More/Home painted none in 9 of 9.
 *
 * The entry located it at `meal-plan-section.tsx:99`, and that line is not wrong so much as
 * downstream: `if (loading && plan == null)` is correct given its props. The defect is the prop.
 * `nutrition-content.tsx` passed `loading && mealPlan === null`, and for someone with no plan
 * `null` is the SETTLED answer the cache already gave — indistinguishable from "no answer yet".
 *
 * So the assertions are on the parent, and the presentational component is pinned unchanged.
 */
describe('DV-17 — a warm Nutrition visit does not repaint the meal-plan skeleton', () => {
  const parent = src('app/nutrition/nutrition-content.tsx');

  it('gates the skeleton on whether the plan was ANSWERED, not on it being non-null', () => {
    expect(parent).toContain('loading={loading && !planLoaded}');
    expect(parent, 'null is the settled answer for an account with no plan')
      .not.toContain('loading={loading && mealPlan === null}');
  });

  it('marks it answered from the synchronous cache seed, which is what makes a warm visit quiet', () => {
    // The seed is the only thing that runs before first paint; settling it later cannot prevent
    // a flash that has already happened.
    expect(parent).toMatch(/readCacheSync<MealPlansResponse>\('meal-plans'\)/);
    expect(parent).toMatch(/if \(plans\) \{[^}]*setPlanLoaded\(true\)/);
  });

  it('does not let a failed fetch settle the question', () => {
    // cachedFetch swallows !res.ok and calls back with undefined; treating that as an answer
    // would replace a skeleton with "Build a meal plan" for someone who may well have one.
    expect(parent).toContain('if (d) setPlanLoaded(true)');
  });

  it('leaves the presentational guard alone — it was never the defect', () => {
    expect(src('components/nutrition/meal-plan-section.tsx'))
      .toContain('if (loading && plan == null)');
  });
});
