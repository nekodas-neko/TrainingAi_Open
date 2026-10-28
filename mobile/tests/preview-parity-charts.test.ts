import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Guards for the Health Training, Health Progress and Nutrition parity fixes (#2900, #2901, #2898,
// #2932, #2946, #2948). The components need a device to render, so these read the source for the
// props and tokens each fix depends on; a revert fails here rather than on the phone.
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Health Training draws the Training Load card and scales its 14-day charts to their gridlines', async () => {
  const panel = await read('features/health/components/TrainingPanel.tsx');
  assert.match(panel, /<WeeklyTrainingCard[\s\S]*?readable/, 'Training Load card is rendered');
  assert.match(panel, /<LineChart[\s\S]*?niceBounds/, '14-day charts end on a gridline at the bottom');
  assert.match(panel, /<LineChart[\s\S]*?dots="isolated"/);
});

test('the weekly card and the calendar use the web legend', async () => {
  const weekly = await read('features/progress/WeeklyTrainingCard.tsx');
  const calendar = await read('features/health/components/TrainingCalendarCard.tsx');
  assert.match(weekly, /<Legend[\s\S]*?ruled[\s\S]*?tinted/);
  assert.match(calendar, /<Legend[\s\S]*?ruled[\s\S]*?centered/);
});

test('a month grid keeps the web row gap', async () => {
  assert.match(await read('shared/ui/MonthCalendar.tsx'), /rowGap: theme\.spacing\.xxs/);
});

test('strength bar guides use the 7 px label token and strokes, never a one-sided dashed border', async () => {
  const panel = await read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /variant="strengthMarker"/);
  assert.match(panel, /strokeDasharray/);
  assert.doesNotMatch(panel, /borderStyle:\s*'dashed'/, 'a one-sided dashed border renders solid on Android');
});

test('the Strength Trend chart runs edge to edge at the current app height, without gridlines', async () => {
  const screen = await read('features/progress/StrengthScreen.tsx');
  assert.match(screen, /<LineChart[\s\S]*?stretch/);
  assert.match(screen, /dots="none"/, 'the web Sparkline draws no dots');
  assert.match(screen, /theme\.sizes\.sparkline/);
  assert.doesNotMatch(screen, /^\s+gridlines\s*$/m);
  assert.doesNotMatch(screen, /chartWidth/, 'no first-paint width guess');
});

test('the Trends card is tinted and its chosen chip is solid', async () => {
  const panel = await read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /<Card accent=\{theme\.progress\.trends\}>/);
  assert.match(panel, /<ChipPicker[\s\S]*?solid/);
});

test('Nutrition: plain macro columns, a whole-track ramp on the budget bar, a shared supplement line', async () => {
  const energy = await read('features/nutrition/components/NutritionEnergyCard.tsx');
  assert.match(energy, /variant="macroShare"/);
  assert.doesNotMatch(energy, /<ProgressBar[\s\S]{0,80}colors\[i\]/, 'macro tiles carry no bar of their own');
  const bar = await read('shared/ui/GradientProgressBar.tsx');
  assert.match(bar, /gradientUnits="userSpaceOnUse"/, 'the ramp spans the track, not the fill');
  const supplements = await read('features/nutrition/components/SupplementsSection.tsx');
  assert.match(supplements, /supplementSubtitle\(s\)/);
  assert.match(supplements, /borderTopWidth: 1/, 'rows run edge to edge under hairlines');
  assert.match(supplements, /paddingVertical: theme\.spacing\.md/, 'py-3 rows, as the current app\'s');
});
