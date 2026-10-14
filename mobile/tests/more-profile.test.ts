import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural } from '@trainingai/shared/format/plural';
import { memberSinceLabel, programTile } from '../src/features/settings/data/profile.ts';

test('plural keeps one singular and everything else plural', () => {
  assert.equal(plural(1, 'session', 'sessions'), '1 session');
  assert.equal(plural(0, 'session', 'sessions'), '0 sessions');
  assert.equal(plural(12, 'dose', 'doses'), '12 doses');
});

test('Member since reads the month the account was made in the user timezone', () => {
  assert.equal(memberSinceLabel('2025-03-14T02:00:00.000Z', 'Australia/Brisbane'), 'Mar 25');
  // 31 Dec 20:00 UTC is already 1 Jan in Brisbane: the label follows the user, not UTC.
  assert.equal(memberSinceLabel('2025-12-31T20:00:00.000Z', 'Australia/Brisbane'), 'Jan 26');
  assert.equal(memberSinceLabel('2025-12-31T20:00:00.000Z', 'UTC'), 'Dec 25');
});

test('Member since is blank, not "Invalid", without a usable timestamp', () => {
  assert.equal(memberSinceLabel(undefined, 'UTC'), null);
  assert.equal(memberSinceLabel('not a date', 'UTC'), null);
});

test('the sixth tile follows the current app: cycle, then tenure weeks, then Member since', () => {
  assert.deepEqual(
    programTile({ mode: 'cycle', cycleCurrent: 3, cycleTotal: 6, phaseName: 'Build' }, 'Mar 25'),
    { label: 'Build', value: '3/6' },
  );
  assert.deepEqual(
    programTile({ mode: 'cycle', cycleCurrent: 6, cycleTotal: 6, blockComplete: true }, null),
    { label: 'New block?', value: '6/6' },
  );
  assert.deepEqual(programTile({ mode: 'tenure', weeksRunning: 4 }, 'Mar 25'), {
    label: 'On program',
    value: '4w',
  });
  assert.deepEqual(programTile({ mode: 'tenure', weeksRunning: 12 }, 'Mar 25'), {
    label: 'Review?',
    value: '12w',
  });
  assert.deepEqual(programTile(null, 'Mar 25'), { label: 'Member since', value: 'Mar 25' });
  assert.deepEqual(programTile({ mode: 'tenure' }, null), { label: 'Member since', value: '—' });
  assert.deepEqual(programTile(undefined, null), { label: 'Member since', value: '—' });
});
