import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { muscleVolumeCaption } from '../src/features/health/data/training-view.ts';

// Guards for the remaining Preview differences on #2934, #2900, #2901 and #2902. The components need
// a device to render, so the source checks read for the pieces each change depends on.
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the muscle volume card names its scale at the right of the title, as the current app does (#2900)', () => {
  assert.equal(muscleVolumeCaption([{ target: 12 }, { target: null }]), 'vs your program target');
  assert.equal(muscleVolumeCaption([{ target: null }]), 'Target: 10–20 sets');
});

test('the muscle volume legend sits above the figure with the current app’s four swatches (#2900)', async () => {
  const figure = await read('features/health/components/MuscleVolumeFigure.tsx');
  for (const label of ['Under 60%', '60–99%', 'At target', 'Not trained']) {
    assert.ok(figure.includes(`'${label}'`), label);
  }
  assert.ok(figure.indexOf('<Legend') < figure.indexOf('<MuscleMap'));
  const panel = await read('features/health/components/TrainingPanel.tsx');
  assert.doesNotMatch(panel, /target scale/, 'no phase subtitle the current app does not draw');
});

test('the training calendar title shares a row with the month controls (#2900)', async () => {
  const card = await read('features/health/components/TrainingCalendarCard.tsx');
  assert.match(card, /title="Training Calendar"/);
  const calendar = await read('shared/ui/MonthCalendar.tsx');
  assert.ok(calendar.indexOf('{title &&') < calendar.indexOf('label="Previous month"'));
});

test('AI Periodization draws a tile per session with its icon, and the sparkle in the header (#2900)', async () => {
  const panel = await read('features/health/components/TrainingPanel.tsx');
  assert.match(panel, /icon="coach"/);
  assert.match(panel, /<SessionGlyph/);
  assert.match(await read('features/health/data/models.ts'), /icon: z\.string\(\)\.nullish\(\)/);
});

test('Activities This Week has a brand header with the count, and a centred empty line (#2900)', async () => {
  const panel = await read('features/health/components/TrainingPanel.tsx');
  assert.match(panel, /color: theme\.colors\.brandText/);
  assert.match(panel, /textAlign: 'center'[\s\S]{0,60}No activities this week|No activities this week/);
  assert.match(panel, /<Card padded=\{false\}/);
});

test('Week in review draws a bare brand icon rather than a tile (#2900)', async () => {
  const panel = await read('features/health/components/TrainingPanel.tsx');
  assert.match(panel, /icon="calendarRange"[\s\S]{0,60}iconTile=\{false\}/);
  const hub = await read('shared/ui/HubCard.tsx');
  assert.match(hub, /iconTile \?/);
});

test('the strength card is Estimated 1RM with a dumbbell and a small Sets | 1RM toggle on its title row (#2901)', async () => {
  const panel = await read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /title=\{'Estimated 1RM'\}/);
  assert.match(panel, /icon="workout"/);
  assert.match(panel, /<CompactToggle[\s\S]{0,80}appearance="tint"/);
  assert.doesNotMatch(panel, /Strength Progress/);
});

test('the Goals period toggle shares the title row, and the Trends note is an inset box with an info icon (#2901)', async () => {
  const panel = await read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /<CompactToggle[\s\S]{0,80}appearance="pill"/);
  assert.doesNotMatch(panel, /SegmentedControl/);
  assert.match(panel, /<Icon name="info"/);
  assert.match(panel, /meaningful — keep logging/);
});

test('the Strength Trend gain is plain coloured text, not a filled pill (#2901)', async () => {
  const screen = await read('features/progress/StrengthScreen.tsx');
  assert.doesNotMatch(screen, /label=\{\(exercise\.gainPct/);
  assert.match(screen, /theme\.progress\.trendUp/);
});

test('a compact toggle keeps a 48 px touch target through hitSlop (#2901)', async () => {
  const toggle = await read('shared/ui/CompactToggle.tsx');
  assert.match(toggle, /hitSlop=\{\{ top: hit, bottom: hit \}\}/);
  assert.match(toggle, /theme\.sizes\.touchTarget - theme\.sizes\.compactToggle/);
});
