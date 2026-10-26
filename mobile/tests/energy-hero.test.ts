import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DIAL,
  TIDE,
  angleAt,
  arcPath,
  energyHeroSize,
  notch,
  polar,
} from '../src/features/home/data/energy-hero.ts';
import { chipFigure, homePillars, homeScoreChips } from '../src/features/home/data/score-chips.ts';

test('the size setting falls back to Full for anything unknown', () => {
  assert.equal(energyHeroSize(undefined), 'full');
  assert.equal(energyHeroSize('huge'), 'full');
  assert.equal(energyHeroSize('slim'), 'slim');
});

test('the dial matches the approved mockup: 76 of a 240° arc ends where D1 draws it', () => {
  // D1 draws a 244 px dial, r 102.5, centre 122, with the notch from (202.64, 79.84).
  const bar = notch(DIAL, 122, 102.5, 15, 76);
  assert.ok(Math.abs(bar.from.x - 202.64) < 1.2);
  assert.ok(Math.abs(bar.from.y - 79.84) < 1.2);
  assert.equal(angleAt(DIAL, 0), 150);
  assert.equal(angleAt(DIAL, 100), 390);
});

test('arcs run clockwise and an empty span has no path', () => {
  assert.equal(arcPath(DIAL, 122, 100, 40, 40), null);
  const path = arcPath(DIAL, 122, 100, 0, 50);
  assert.ok(path?.startsWith('M '));
  assert.match(path ?? '', / 0 0 1 /);
  // More than half of the 240° dial is a large arc.
  assert.match(arcPath(DIAL, 122, 100, 0, 80) ?? '', / 0 1 1 /);
});

test('a full tide ring is drawn as an arc that stops just short of closing', () => {
  const path = arcPath(TIDE, 108, 94, 0, 100);
  assert.ok(path);
  const top = polar(108, 94, -90);
  assert.ok(path.startsWith(`M ${top.x} ${top.y}`));
});

const today = '2026-10-26';

test('the pillars come in one order for every layout: Sleep, Heart, Activity', () => {
  const pillars = homePillars({ restingHr: 54, sleepScore: 80, activityScore: 61 }, [], today);
  assert.deepEqual(pillars.map((chip) => chip.key), ['sleep', 'heart', 'activity']);
});

test('the heart figure carries bpm wherever it is drawn, so it never reads as a score', () => {
  const heart = homePillars({ restingHr: 54 }, [], today).find((chip) => chip.key === 'heart')!;
  assert.deepEqual(chipFigure(heart), { text: '54', unit: 'bpm' });
  // No reading: a dash, with no unit hanging off it.
  const none = homePillars({}, [], today).find((chip) => chip.key === 'heart')!;
  assert.deepEqual(chipFigure(none), { text: '—' });
});

test("Slim's sleep-hours fallback carries its h; a sleep score carries no unit", () => {
  const night = [{ date: today, durationHours: 7.4 }];
  const hours = homePillars({ hrCurrent: 61 }, night, today)[0]!;
  assert.deepEqual(chipFigure(hours), { text: '7.4', unit: 'h' });
  const scored = homePillars({ sleepScore: 84 }, night, today)[0]!;
  assert.deepEqual(chipFigure(scored), { text: '84' });
});

test('the widget still reads the full four-chip model', () => {
  const chips = homeScoreChips({ restingHr: 54 }, [], today);
  assert.deepEqual(chips.map((chip) => chip.key), ['readiness', 'heart', 'sleep', 'activity']);
});

test('Full and Compact chips take their unit from chipFigure, and a dash never carries one', async () => {
  // Slim draws chipFigure directly; Full and Compact go through HomeScores and ScoreChip, so both
  // are pinned here (mobile tests do not render components).
  const scores = await readFile(
    new URL('../src/features/home/components/HomeScores.tsx', import.meta.url),
    'utf8',
  );
  assert.match(scores, /unit=\{chipFigure\(chip\)\.unit\}/);
  const chip = await readFile(new URL('../src/shared/ui/ScoreChip.tsx', import.meta.url), 'utf8');
  assert.match(chip, /shownUnit = unit && \(display != null \|\| value !== null\) \? unit : undefined/);
  assert.doesNotMatch(chip, /\{unit\}/);
});
