import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appleSleepNights,
  mergeAppleSleep,
  type SleepSample,
} from '../src/integrations/apple-health/sleep-data.ts';
const start = Date.parse('2026-10-11T12:00:00Z');
const now = Date.parse('2026-10-12T04:00:00Z');
const row = (from: number, to: number, value = 1, source = 'Ring'): SleepSample => ({
  start: start + from * 3_600_000,
  end: start + to * 3_600_000,
  value,
  source,
  bundle: source,
});
test('Apple sleep uses one measured night across overlapping sources and excludes awake intervals', () => {
  const result = appleSleepNights(
    [
      row(0, 8),
      row(0, 2, 4, 'Watch'),
      row(2, 4, 3, 'Watch'),
      row(4, 4.5, 2, 'Watch'),
      row(4.5, 6, 5, 'Watch'),
      row(6, 8, 3, 'Watch'),
    ],
    'Australia/Brisbane',
    now,
  );
  assert.equal(result.length, 1);
  const night = result[0];
  assert.equal(night.date, '2026-10-12');
  assert.equal(night.durationHours, 7.5);
  assert.equal(night.deepSleepHours, 2);
  assert.equal(night.lightSleepHours, 4);
  assert.equal(night.remSleepHours, 1.5);
  assert.equal(night.awakHours, 0.5);
  assert.equal(night.sleepScore, null);
  assert.equal(night.localOnly, true);
  assert.equal(night.sources?.length, 2);
  assert.equal(night.sleepPhase5Min?.slice(0, 24), '1'.repeat(24));
  assert.equal(night.sleepPhase5Min?.slice(48, 54), '4'.repeat(6));
});
test('daytime naps cannot inflate the primary sleep night and genuine fragments are combined', () => {
  const nights = appleSleepNights([row(0, 8), row(12, 13)], 'Australia/Brisbane', now);
  assert.equal(nights.length, 1);
  assert.equal(nights[0].durationHours, 8);
  const fragments = appleSleepNights([row(0, 2), row(3.75, 7.75)], 'Australia/Brisbane', now);
  assert.equal(fragments[0].durationHours, 6);
});
test('generic sleep has no fabricated stage values or score, and daytime shift sleep remains valid', () => {
  const night = appleSleepNights([row(0, 8)], 'Australia/Brisbane', now)[0];
  assert.equal(night.deepSleepHours, null);
  assert.equal(night.remSleepHours, null);
  assert.equal(night.lightSleepHours, null);
  assert.equal(night.sleepPhase5Min, null);
  assert.equal(night.sleepScore, null);
  const daytime = appleSleepNights([row(12, 18)], 'Australia/Brisbane', start + 20 * 3_600_000);
  assert.equal(daytime[0].durationHours, 6);
});
test('an incomplete stage source preserves unmeasured stages instead of turning them into zero', () => {
  const night = appleSleepNights(
    [row(0, 8), row(0, 0.25, 4, 'Watch')],
    'Australia/Brisbane',
    now,
  )[0];
  assert.equal(night.durationHours, 8);
  assert.equal(night.deepSleepHours, 0.25);
  assert.equal(night.remSleepHours, null);
  assert.equal(night.lightSleepHours, null);
});
test('cached Apple sleep fills missing nights without adding its duration to server nights', () => {
  const [night] = appleSleepNights([row(0, 8)], 'Australia/Brisbane', now);
  assert.equal(mergeAppleSleep([], [night])[0].durationHours, 8);
  const server = { ...night, id: 'server', localOnly: false, durationHours: 7.8 };
  const merged = mergeAppleSleep([server], [night]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'server');
  // Server precedence holds even for a row with no duration or one entered by hand.
  assert.equal(mergeAppleSleep([{ ...server, manualEntry: true }], [night])[0].id, 'server');
  assert.equal(mergeAppleSleep([{ ...server, durationHours: null }], [night])[0].id, 'server');
  // A different date the server has not received is still filled in.
  const earlier = { ...night, id: 'earlier', date: '2000-01-01' };
  const both = mergeAppleSleep([server], [night, earlier]);
  assert.deepEqual(both.map((n) => n.id), ['server', 'earlier']);
});
test('invalid or future records and an evening fragment cannot replace last night', () => {
  const nights = appleSleepNights(
    [row(0, 8), row(24.25, 24.75), row(3, 2)],
    'Australia/Brisbane',
    start + 25 * 3_600_000,
  );
  assert.equal(nights.length, 1);
  assert.equal(nights[0].durationHours, 8);
  assert.deepEqual(appleSleepNights([row(40, 48)], 'Australia/Brisbane', now), []);
});
