import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeScoreChips } from '../src/features/home/data/score-chips.ts';
import { snapshotIdentity, todayWidgetSnapshot } from '../src/features/widgets/snapshot.ts';

const today = '2026-10-23';
const now = new Date('2026-10-23T07:42:00+11:00');
const tz = 'Australia/Sydney';

test('the widget shows the scores, labels and colours Home shows', () => {
  const chips = homeScoreChips(
    { readinessDisplayScore: 82.4, sleepScore: 77, activityScore: 64, restingHrLastNight: 52 },
    [],
    today,
  );
  const snapshot = todayWidgetSnapshot(today, chips, now, tz);
  assert.deepEqual(
    snapshot.today.scores.map((score) => [score.label, score.value]),
    [
      ['Readiness', '82'],
      ['Resting HR', '52'],
      ['Sleep', '77'],
      ['Activity', '64'],
    ],
  );
  assert.deepEqual(snapshot.today.scores[0]!.color, { dark: '#60a5fa', light: '#2563eb' });
  assert.equal(snapshot.updated, 'Updated 7:42 am');
  assert.equal(snapshot.v, 1);
});

test('a missing score stays missing, and last night stands in for a missing sleep score', () => {
  const chips = homeScoreChips({ hrCurrent: 61, limited: true }, [{ date: '2026-10-22', durationHours: 7.2 }], today);
  const [readiness, heart, sleep, activity] = todayWidgetSnapshot(today, chips, now, tz).today.scores;
  assert.equal(readiness!.value, null);
  assert.equal(readiness!.qualified, true);
  assert.equal(heart!.label, 'Heart Rate');
  assert.deepEqual([sleep!.label, sleep!.value], ['Sleep (h)', '7.2']);
  assert.equal(activity!.value, null);
});

test('the same numbers a minute later do not rewrite the widget', () => {
  const chips = homeScoreChips({ readinessDisplayScore: 80 }, [], today);
  const a = todayWidgetSnapshot(today, chips, now, tz);
  const b = todayWidgetSnapshot(today, chips, new Date(now.getTime() + 60_000), tz);
  assert.notEqual(a.updated, b.updated);
  assert.equal(snapshotIdentity(a), snapshotIdentity(b));
});
