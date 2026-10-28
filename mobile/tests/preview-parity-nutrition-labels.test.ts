import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lastTwelveMonthLabels } from '../src/features/settings/data/year-months.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Your Year labels every month with exactly three letters, whatever the locale data says (#3517)', () => {
  for (let month = 0; month < 12; month++) {
    const labels = lastTwelveMonthLabels(new Date(2026, month, 15));
    assert.equal(labels.length, 12);
    for (const label of labels) assert.match(label, /^[A-Z][a-z]{2}$/);
    assert.equal(labels[11], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]);
  }
  assert.deepEqual(lastTwelveMonthLabels(new Date(2026, 9, 28)).slice(0, 3), ['Nov', 'Dec', 'Jan']);
  assert.ok(lastTwelveMonthLabels(new Date(2026, 9, 28)).includes('Sep'));
});

test('the Your Year screen takes its labels from that helper, not the locale', () => {
  const screen = read('features/settings/screens/YearReviewScreen.tsx');
  assert.match(screen, /lastTwelveMonthLabels\(/);
  assert.doesNotMatch(screen, /toLocaleDateString\('en-AU', \{ month: 'short' \}\)/);
});

test('a segmented-control label stays on one line (#3517)', () => {
  const control = read('shared/ui/SegmentedControl.tsx');
  assert.match(control, /numberOfLines=\{1\}\s*adjustsFontSizeToFit/);
});

test('the Nutrition tab matches the current app (#2898)', () => {
  const screen = read('features/nutrition/screens/NutritionScreen.tsx');
  assert.match(screen, /icon="moon"/, 'End of Day carries a moon');
  assert.doesNotMatch(screen, /^\s*landing\s*$/m, 'the header keeps the current app\'s divider');
  const energy = read('features/nutrition/components/NutritionEnergyCard.tsx');
  assert.match(energy, /variant="energyRingCaption"/, 'the ring caption is the web\'s capitals');
  const plan = read('features/meal-plans/components/PlanMeals.tsx');
  assert.match(plan, /borderStyle: 'dashed'/);
  assert.match(plan, /textDecorationLine: 'underline'/);
  assert.match(read('features/nutrition/components/FoodLoggingComplete.tsx'), /variant="neutral"/);
  const supplements = read('features/nutrition/components/SupplementsSection.tsx');
  assert.match(supplements, /name="settings"/, 'Manage has its gear');
  assert.match(supplements, /name="syringe"/, 'the vial button is a syringe');
});
