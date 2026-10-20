import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { blend } from '../src/features/rewards/components/tint.ts';
import { gradientStops } from '../src/shared/ui/gradientStops.ts';

// Guards for the Preview parity pass of 20 Oct (#3182, #3183, #3184, #3185, #3187). The components
// need a device to render, so the source checks read for the pieces each fix depends on.
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('blend lays a colour over the background as one opaque colour (#3182)', () => {
  assert.equal(blend('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(blend('#ff0000', '#000000', 0), '#000000');
  assert.equal(blend('#ff0000', '#00ff00', 1), '#ff0000');
  // Not a #rrggbb: handed back as it came.
  assert.equal(blend('var(--x)', '#000000', 0.12), 'var(--x)');
  const badge = '#10b981';
  assert.match(blend(badge, '#050c06', 0.12), /^#[\da-f]{6}$/);
});

test('achievement and trophy tiles are opaque, so their glow is not a box behind the icon (#3182)', async () => {
  for (const file of ['AchievementBadge', 'TrophyCase']) {
    const source = await read(`features/rewards/components/${file}.tsx`);
    assert.match(source, /blend\(color, theme\.colors\.background/, file);
    assert.doesNotMatch(source, /backgroundColor: (unlocked \? )?tint\(color/, file);
  }
});

test('an empty heart-rate card is a heading and one line, with no plot box, legend or footnote (#3184)', async () => {
  const card = await read('features/health/components/HrDayCard.tsx');
  assert.doesNotMatch(card, /minHeight: theme\.sizes\.hrChartHeight/);
  assert.match(card, /readings\.length === 0/);
  assert.match(card, /noHrDataCopy\(null, 'day'\)/);
  // Both empty branches return before the chart, legend and footnote are built.
  assert.ok(card.indexOf('readings.length === 0') < card.indexOf('<LineChart'));
});

test('Week in review draws the compact trend rows, with the Recovery heading (#3185)', async () => {
  const screen = await read('features/health/screens/HealthWeekScreen.tsx');
  assert.match(screen, /<TrendRowCard/);
  assert.doesNotMatch(screen, /<HealthMetricCard/);
  assert.match(screen, />Recovery</);
  assert.match(screen, /Against the last four weeks/);
  const day = await read('features/nutrition/components/DayReviewDetails.tsx');
  assert.match(day, /<TrendRowCard/, 'the day review shares the same card');
});

test('the 14-day charts curve and put the change on the title row (#3183)', async () => {
  const training = await read('features/health/components/TrainingPanel.tsx');
  assert.match(training, /<LineChart[\s\S]*?\bsmooth\b/);
  assert.match(training, /— 14 days/);
  assert.match(training, /change\.text/);
  assert.match(await read('features/health/components/HeartDetails.tsx'), /smooth: true/);
});

test('a tinted card is the current app’s accent wash, and a detail page has its own gradient (#3187)', async () => {
  const card = await read('shared/ui/Card.tsx');
  assert.match(card, /stopOpacity="0\.3"/);
  assert.match(card, /stopOpacity="0\.12"/);
  assert.match(card, /\$\{color\}66/, 'a 40% border');
  const layout = await read('shared/ui/HealthDetailLayout.tsx');
  assert.match(layout, /<PageGradient css=\{theme\.healthPageGradients\[kind\]\[theme\.mode\]\}/);
});

test('a CSS gradient string becomes stops, and transparent keeps the colour before it', () => {
  const stops = gradientStops('linear-gradient(180deg, #5c1010 0%, #3d0808 50%, transparent 100%)');
  assert.deepEqual(stops, [
    { offset: '0%', color: '#5c1010', opacity: 1 },
    { offset: '50%', color: '#3d0808', opacity: 1 },
    { offset: '100%', color: '#3d0808', opacity: 0 },
  ]);
});

test('every Body card the web tints takes its accent (#3187)', async () => {
  const expected: [string, string][] = [
    ['BodyWeightCards.tsx', 'bodyCardColors.weight'],
    ['BodyWeightCards.tsx', 'bodyCardColors.fat'],
    ['BodyCompositionCards.tsx', 'bodyCardColors.leanMass'],
    ['BodyCompositionCards.tsx', 'bodyCardColors.composition'],
    ['BodySleepCard.tsx', 'bodyCardColors.sleep'],
    ['BodyPanel.tsx', 'bodyCardColors.burned'],
    ['BodyPanel.tsx', 'bodyCardColors.bmi'],
  ];
  for (const [file, token] of expected) {
    assert.ok((await read(`features/health/components/${file}`)).includes(`accent={${token}}`), `${file} ${token}`);
  }
});
