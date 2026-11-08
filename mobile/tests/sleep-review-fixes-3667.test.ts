// #3667: three of the 8 Nov review's small sleep fixes, on Preview's side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipFigure, homeScoreChips } from '../src/features/home/data/score-chips.ts';
import { hidesSleepVerdict } from '../src/features/health/data/partial-night-view.ts';
import { healthReadPaths, nightLandedPaths } from '../src/core/sync/health-invalidation.ts';

const today = '2026-11-08';
const sleepChip = (data: Parameters<typeof homeScoreChips>[0], nights: Parameters<typeof homeScoreChips>[1] = []) =>
  homeScoreChips(data, nights, today).find((chip) => chip.key === 'sleep')!;

test('item 1: a night marked partial hides Home\'s verdict at once, as one only on this phone does', () => {
  assert.equal(hidesSleepVerdict([{ date: today, partialNightAt: '1970-01-01T00:00:00.000Z' }], today), true);
  assert.equal(hidesSleepVerdict([{ date: today, recordingIncomplete: true }], today), true);
  assert.equal(hidesSleepVerdict([{ date: today, localOnly: true }], today), true);
  assert.equal(hidesSleepVerdict([{ date: today, partialNightAt: null }], today), false);
  // Another night's mark says nothing about last night.
  assert.equal(hidesSleepVerdict([{ date: '2026-11-06', partialNightAt: '2026-11-06T22:00:00.000Z' }], today), false);
});

test('item 2: an unscored night is a dash on the Sleep chip, never its hours', () => {
  const chip = sleepChip({ sleepScore: null }, [{ date: today, durationHours: 3.3 }]);
  assert.deepEqual([chip.label, chip.value, chipFigure(chip)], ['Sleep', null, { text: '—' }]);
});

test('item 3: an older night\'s score is not shown as today\'s', () => {
  assert.equal(sleepChip({ sleepScore: 78, sleepScoreDate: '2026-11-05' }).value, null);
  // A limited-coverage glyph never sits on a dash.
  assert.equal(sleepChip({ sleepScore: 78, sleepScoreDate: '2026-11-05', sleepScoreCoverage: { level: 'partial' } }).qualified, false);
  assert.equal(sleepChip({ sleepScore: 78, sleepScoreDate: '2026-11-07' }).value, 78);
  assert.equal(sleepChip({ sleepScore: 78, sleepScoreDate: today }).value, 78);
  // A cached payload from before the date existed shows as it always did.
  assert.equal(sleepChip({ sleepScore: 78 }).value, 78);
});

test('item 4: a landed night reloads every health read, the verdict and the day log', () => {
  for (const path of healthReadPaths) assert.ok(nightLandedPaths.includes(path), path);
  for (const path of ['/api/readiness-score', '/api/day-timeline', '/api/body-battery', '/api/sleep-verdict', '/api/day-log']) {
    assert.ok(nightLandedPaths.includes(path), path);
  }
});

test('item 3: the Body Sleep card\'s badge takes the same current-night rule (mobile tests render no components)', async () => {
  const { readFile } = await import('node:fs/promises');
  const card = await readFile(new URL('../src/features/health/components/BodySleepCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /const score = currentSleepScore\(readiness\.data, health\.today\);/);
});
