import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { exerciseHrTrendSpec } from '../src/features/workouts/data/models.ts';
import { exerciseHrView } from '../src/features/workouts/data/exercise-hr-view.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

const session = (values: Record<string, number | null>) => ({
  workoutSessionId: 's',
  date: '2026-11-01',
  avgPeakBpm: null,
  avgDrop30: null,
  avgDrop60: null,
  avgDrop90: null,
  avgDrop120: null,
  avgPctHrrAtRestEnd: null,
  ...values,
});

test('the trend spec reads the route the current app reads, by exercise name (#3726)', () => {
  const spec = exerciseHrTrendSpec('Bench Press');
  assert.equal(spec.path, '/api/workout/exercise-hr-trend');
  assert.deepEqual(spec.query, { exerciseName: 'Bench Press' });
  const parsed = spec.schema.parse({
    exerciseName: 'Bench Press',
    sessions: [session({ avgPeakBpm: 1, avgDrop60: 1 })],
    byIntensity: [{ label: '70–79', min: 70, max: 80, n: 3, avgPeakBpm: 1, avgDrop60: null, avgPctHrrAtRestEnd: null }],
    totalSets: 4,
    coveredSets: 3,
  });
  assert.equal(parsed.coveredSets, 3);
  assert.equal(parsed.byIntensity[0].avgDrop60, null);
  // A field the server leaves out reads as "no reading", not as a failed response.
  assert.equal(spec.schema.parse({ sessions: [{}] }).sessions[0].avgPeakBpm, null);
  assert.equal(spec.schema.parse({}).coveredSets, 0);
});

test('the card draws nothing until a set has heart-rate cover', () => {
  assert.equal(exerciseHrView(null), null);
  assert.equal(
    exerciseHrView({ sessions: [session({})], byIntensity: [], coveredSets: 0 }),
    null,
  );
});

test('the newest session with a reading leads, and a single reading is not a trend', () => {
  const view = exerciseHrView({
    sessions: [
      session({ avgPeakBpm: 3, avgDrop60: 2 }),
      session({ avgPeakBpm: 4, avgDrop60: null, avgDrop30: 1 }),
      session({}),
    ],
    byIntensity: [],
    coveredSets: 5,
  });
  assert.equal(view?.latest?.avgPeakBpm, 4);
  assert.deepEqual(view?.peakSeries, [3, 4]);
  assert.equal(view?.dropSeries, null);
  assert.deepEqual(view?.curve, [
    ['30s', 1],
    ['1m', null],
    ['90s', null],
    ['2m', null],
  ]);
  const flat = exerciseHrView({
    sessions: [session({ avgPeakBpm: 3, avgDrop60: 2 })],
    byIntensity: [],
    coveredSets: 1,
  });
  assert.equal(flat?.curve, null);
  assert.equal(flat?.peakSeries, null);
});

test('exercise history shows the card, with the cardiovascular-only line', () => {
  assert.match(
    read('features/workouts/components/ExerciseHistory.tsx'),
    /<ExerciseHrTrendCard name=\{name\} \/>/,
  );
  const card = read('features/workouts/components/ExerciseHrTrendCard.tsx');
  assert.match(card, /cardiovascular recovery only — not CNS or muscular readiness/);
  assert.match(card, /useWorkoutResource\(exerciseHrTrendSpec\(name\)\)/);
});
