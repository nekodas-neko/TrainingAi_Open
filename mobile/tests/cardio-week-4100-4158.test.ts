import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANY_ACTIVITY_COUNTS,
  dayWhy,
  floorLine,
  sessionWhy,
  weekRows,
} from '../src/features/activities/data/cardio-week-view.ts';
import type { HeartHealthDay } from '../src/features/activities/data/cardio-view.ts';

const day = (date: string, over: Partial<HeartHealthDay> = {}): HeartHealthDay =>
  ({
    date,
    runId: `run-${date}`,
    status: 'pending',
    creditedId: null,
    activities: [],
    countedMin: 0,
    met: false,
    ...over,
  }) as HeartHealthDay;

test('a Sunday across a month end lists all seven days, Monday first', () => {
  // Mon 30 Nov 2026 to Sun 6 Dec 2026.
  const rows = weekRows([day('2026-11-30'), day('2026-12-02')], '2026-12-06');
  assert.deepEqual(
    rows.map((row) => row.date),
    ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'],
  );
  assert.deepEqual(
    rows.map((row) => row.day !== null),
    [true, false, true, false, false, false, false],
  );
});

test('the list stops at today, and slashed dates from the server still match', () => {
  const rows = weekRows([day('2026/12/01')], '2026-12-02');
  assert.deepEqual(
    rows.map((row) => row.date),
    ['2026-11-30', '2026-12-01', '2026-12-02'],
  );
  assert.equal(rows[1].day?.runId, 'run-2026/12/01');
  assert.equal(rows[0].day, null);
});

test('a Monday is a list of one', () => {
  assert.deepEqual(
    weekRows([], '2026-11-30').map((row) => row.date),
    ['2026-11-30'],
  );
});

test('a session that counted nothing says so in its own minutes', () => {
  assert.equal(
    sessionWhy({ durationMin: 80, effortMin: 0 }),
    '80 min, all below moderate effort',
  );
});

test('a session that counted some says how much of itself', () => {
  assert.equal(
    sessionWhy({ durationMin: 80, effortMin: 12 }),
    '12 of 80 min at moderate effort or above',
  );
  assert.equal(sessionWhy({ durationMin: 30, effortMin: 30 }), '30 min at moderate effort or above');
});

test('no heart rate reads as that, not as below effort', () => {
  assert.equal(sessionWhy({ durationMin: 80, effortMin: null }), 'No heart rate recorded');
});

test('a day with one session shows that session; with several, the day total', () => {
  const walk = { id: 'a', title: 'Walk', activityType: 'walk', durationMin: 80, effortMin: 0 };
  assert.equal(dayWhy({ activities: [walk], countedMin: 0 }), '80 min, all below moderate effort');
  assert.equal(
    dayWhy({ activities: [walk, { ...walk, id: 'b', effortMin: 10 }], countedMin: 10 }),
    '10 min at moderate effort or above across 2 activities',
  );
  assert.equal(
    dayWhy({ activities: [walk, { ...walk, id: 'b' }], countedMin: 0 }),
    'All below moderate effort across 2 activities',
  );
  assert.equal(dayWhy({ activities: [], countedMin: 0 }), '');
});

test('the card line and the floor line', () => {
  assert.equal(
    ANY_ACTIVITY_COUNTS,
    'Any activity counts for its minutes at moderate effort or above',
  );
  assert.equal(floorLine(106), 'Moderate starts at 106 bpm for you');
  assert.equal(floorLine(105.6), 'Moderate starts at 106 bpm for you');
  assert.equal(floorLine(null), null);
  assert.equal(floorLine(undefined), null);
});

// #4100 N1: a day with nothing logged reads one thing, not "No activity logged" and "Nothing logged".
test('a past day with no activity says "No activity logged" once, with no outcome label beside it', async () => {
  const { weekRowView } = await import('../src/features/activities/data/cardio-week-view.ts');
  const missing = weekRowView({ date: '2026-12-01', day: null }, '2026-12-03');
  assert.equal(missing.line, 'No activity logged');
  assert.equal(missing.label, null);
  const emptyRow = weekRowView({ date: '2026-12-01', day: day('2026-12-01') }, '2026-12-03');
  assert.equal(emptyRow.line, 'No activity logged');
  assert.equal(emptyRow.label, null);
  // Today keeps its marker, and a day with an activity keeps its outcome.
  assert.equal(weekRowView({ date: '2026-12-03', day: null }, '2026-12-03').label, 'Today');
  const counted = weekRowView(
    {
      date: '2026-12-02',
      day: day('2026-12-02', {
        met: true,
        countedMin: 30,
        targetMin: 20,
        status: 'completed',
        activities: [{ id: 'a', title: 'Run', durationMin: 30, effortMin: 30 }] as never,
      }),
    },
    '2026-12-03',
  );
  assert.notEqual(counted.line, 'No activity logged');
  assert.ok(counted.label);
});
// #4100 N2: the seven-day list shows whenever the Heart-health card does, even with no days sent.
test('the week list shows with the Heart-health card, even when the server sent no days', async () => {
  const { showWeekList } = await import('../src/features/activities/data/cardio-week-view.ts');
  assert.equal(showWeekList({ run: { status: 'pending' }, heartHealth: { days: [] } }), true);
  assert.equal(showWeekList({ run: { status: 'pending' } }), true);
  assert.equal(showWeekList({ run: null, heartHealth: { days: [day('2026-12-01')] } }), false);
  assert.equal(showWeekList(undefined), false);
  assert.deepEqual(
    weekRows([], '2026-12-03').map((row) => row.day),
    [null, null, null, null],
    'Monday to Thursday filled from nothing',
  );
});
