import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { todayInTz } from '@trainingai/shared/date-utils';
import { lastTwelveMonthLabels } from '../src/features/settings/data/year-months.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Your Year labels every month with exactly three letters, whatever the locale data says (#3517)', () => {
  for (let month = 0; month < 12; month++) {
    const labels = lastTwelveMonthLabels(`2026-${String(month + 1).padStart(2, '0')}-15`);
    assert.equal(labels.length, 12);
    for (const label of labels) assert.match(label, /^[A-Z][a-z]{2}$/);
    assert.equal(labels[11], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]);
  }
  assert.deepEqual(lastTwelveMonthLabels('2026-10-28').slice(0, 3), ['Nov', 'Dec', 'Jan']);
  assert.ok(lastTwelveMonthLabels('2026-10-28').includes('Sep'));
});

test('Your Year labels the last bar by the user\'s month, not the device clock\'s (#3517)', () => {
  // A phone in New York at 2026-10-31 19:00Z; the Brisbane user is already on 1 November.
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T19:00:00Z') });
  try {
    assert.equal(lastTwelveMonthLabels(todayInTz('Australia/Brisbane'))[11], 'Nov');
    assert.equal(lastTwelveMonthLabels(todayInTz('America/New_York'))[11], 'Oct');
  } finally {
    mock.timers.reset();
  }
  const screen = read('features/settings/screens/YearReviewScreen.tsx');
  assert.match(screen, /todayInTz\(timezone\)/);
});

test('the Your Year screen takes its labels from that helper, not the locale', () => {
  const screen = read('features/settings/screens/YearReviewScreen.tsx');
  assert.match(screen, /lastTwelveMonthLabels\(/);
  assert.doesNotMatch(screen, /toLocaleDateString\('en-AU', \{ month: 'short' \}\)/);
});

test('a segmented-control label stays on one line (#3517)', () => {
  const control = read('shared/ui/SegmentedControl.tsx');
  assert.match(control, /numberOfLines=\{1\}\s*adjustsFontSizeToFit\s*minimumFontScale=\{0\.7\}/);
});

test('a bar label never wraps mid-word at large text scales', () => {
  const chart = read('shared/ui/BarChart.tsx');
  assert.match(chart, /numberOfLines=\{1\}\s*adjustsFontSizeToFit\s*minimumFontScale=\{0\.7\}/);
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
  assert.match(supplements, /name="syringe" tone="muted" size=\{theme\.sizes\.iconCompact\}/);
  assert.match(supplements, /marginVertical: -theme\.spacing\.sm \}\}>\s*<StatusIndicator/, 'the status slot never grows the header');
  assert.match(screen, /iconSize=\{theme\.sizes\.iconCompact\}\s*iconColor=\{theme\.colors\.muted\}/, 'the moon is 16 px and muted');
  assert.match(plan, /alignItems: 'center',\s*paddingHorizontal/, 'the step-by-step link is centred');
});
