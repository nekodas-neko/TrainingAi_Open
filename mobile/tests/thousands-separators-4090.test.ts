import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCount } from '@trainingai/shared/format/number';
import { yearTiles } from '../src/features/settings/data/year-tiles.ts';

// #4090. Your Year printed "488688" and "1725".
test('the one formatter groups from 1,000', () => {
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1,000');
  assert.equal(formatCount(1725), '1,725');
  assert.equal(formatCount(488688), '488,688');
  assert.equal(formatCount(1234.5, { decimals: 1 }), '1,234.5');
  assert.equal(formatCount(null), '—');
});
test('Your Year prints every total through it', () => {
  const tiles = yearTiles({
    sessionCount: 212,
    totalSets: 1725,
    totalVolumeKg: 488688,
    totalMinutes: 15_300,
    prCount: 1042,
    longestWeeklyStreak: 12,
  });
  const by = Object.fromEntries(tiles.map((t) => [t.label, t.value]));
  assert.equal(by['Sets'], '1,725');
  assert.equal(by['Volume'], '488,688');
  assert.equal(by['Personal records'], '1,042');
  assert.equal(by['Sessions'], '212');
  assert.equal(by['Training time'], '255');
  assert.deepEqual(tiles.map((t) => t.unit), ['', '', 'kg', 'h', '', 'weeks']);
});
test('a small total and a fractional hour read as before', () => {
  const by = Object.fromEntries(
    yearTiles({ sessionCount: 0, totalSets: 999, totalVolumeKg: 0, totalMinutes: 90, prCount: 0, longestWeeklyStreak: 0 }).map((t) => [t.label, t.value]),
  );
  assert.equal(by['Sets'], '999');
  assert.equal(by['Volume'], '0');
  assert.equal(by['Training time'], '2');
});
