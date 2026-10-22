import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  latestBaselines,
  weekDayOutcome,
} from '../src/features/activities/data/cardio-view.ts';
import { baselinesSpec, runningPlanSpec } from '../src/features/activities/data/models.ts';

const tests = baselinesSpec.schema.parse({
  fitnessTests: [
    { id: 'c1', date: '2026-09-01', testType: 'cooper-12min', vo2maxEst: 38 },
    { id: 'h1', date: '2026-08-01', testType: 'hrr-3min', hrr1Bpm: 20 },
    { id: 'h2', date: '2026-10-01', testType: 'hrr-3min', hrr1Bpm: 26 },
  ],
}).fitnessTests;

test('baselines keep the newest result of each protocol, ordered by when each first appeared', () => {
  const rows = latestBaselines(tests);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['h2', 'c1'],
  );
});

test('two baselines saved on one day keep the order the current app reads them in', () => {
  const server = baselinesSpec.schema.parse({
    fitnessTests: [
      { id: 'hrr', date: '2026-10-10', testType: 'resting_hrr', hrr1Bpm: 24 },
      { id: 'six', date: '2026-10-10', testType: '6mwt', vo2maxEst: 30 },
      { id: 'coo', date: '2026-10-12', testType: 'cooper12', vo2maxEst: 33 },
    ],
  }).fitnessTests;
  assert.deepEqual(
    latestBaselines(server).map((row) => row.id),
    ['six', 'hrr', 'coo'],
  );
  const phone = baselinesSpec.schema.parse({
    fitnessTests: [{ id: 'coo2', date: '2026-10-12', testType: 'cooper12', vo2maxEst: 35 }],
  }).fitnessTests;
  assert.deepEqual(
    latestBaselines(server, phone).map((row) => row.id),
    ['six', 'hrr', 'coo2'],
  );
});

const day = (extra: Record<string, unknown>) =>
  runningPlanSpec('2026-10-17').schema.parse({
    plan: null,
    heartHealth: {
      days: [
        {
          date: '2026/10/14',
          runId: 'r1',
          status: 'pending',
          creditedId: null,
          activities: [],
          countedMin: 0,
          met: false,
          ...extra,
        },
      ],
    },
  }).heartHealth!.days[0];

test('a day reads the outcome the server sent', () => {
  assert.equal(weekDayOutcome(day({ outcome: 'not-counted' }), '2026-10-17'), 'not-counted');
});

test('a payload cached before the server sent an outcome is read through the shared rule', () => {
  assert.equal(weekDayOutcome(day({}), '2026-10-17'), 'nothing-logged');
  assert.equal(weekDayOutcome(day({ date: '2026/10/17' }), '2026-10-17'), 'today');
  assert.equal(weekDayOutcome(day({ met: true }), '2026-10-17'), 'counted');
  assert.equal(
    weekDayOutcome(
      day({
        activities: [
          { id: 'a', title: 'Walk', activityType: 'walk', durationMin: 30, effortMin: 5 },
        ],
      }),
      '2026-10-17',
    ),
    'not-counted',
  );
});
