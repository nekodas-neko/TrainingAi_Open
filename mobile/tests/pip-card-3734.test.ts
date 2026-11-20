// #3734, option A: what the app sends the picture-in-picture card. The card itself is drawn in
// Kotlin (PipPresenter.card, tested in PipCardTest.kt); these pin the phase and the payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipCommand, pipPhaseFor, workoutPhaseOf } from '../src/features/workouts/pip/pip.ts';
import { createPipReporter } from '../src/features/workouts/pip/usePictureInPicture.ts';
import { pipAccent } from '../src/features/workouts/pip/pip-accent.ts';
import { workoutStatusFor } from '../src/features/workouts/status/workout-status.ts';
import { EFFORT_PIP_MS } from '../src/features/workouts/logging/effort.ts';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';

const T0 = Date.UTC(2026, 10, 20, 8);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { workout: id(1), bench: id(2), row: id(3), fly: id(4), relog: id(5) };

function sets(first: number, extra: Record<string, unknown> = {}) {
  return [0, 1].map((i) => ({
    id: id(100 + first + i),
    weight: '27.5',
    reps: '7',
    startedAt: null,
    completedAt: null,
    restAfterSec: null,
    planned: { number: i + 1, reps: 7, percent: 70, restSeconds: 120 },
    plannedWeight: 27.5,
    rpe: null,
    rpeSource: null,
    suggestionHandled: false,
    ...extra,
  }));
}
function workout(extra: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const exercise = (exerciseId: string, name: string, first: number, more = {}) => ({
    id: exerciseId,
    logId: exerciseId,
    name,
    exerciseType: 'weighted',
    weightUnit: 'kg' as const,
    retired: false,
    relogOf: null,
    skipped: false,
    supersetGroup: null,
    effortVsPlan: null,
    effortSource: null,
    sets: sets(first),
    ...more,
  });
  return {
    id: ids.workout,
    status: 'active',
    sessionName: 'Push A',
    startedAt: T0,
    pausedAt: null,
    pausedMs: 30_000,
    restAdjustmentSeconds: 0,
    restAnchor: null,
    rest: null,
    runningSet: null,
    soloExerciseId: null,
    flow: { stage: 'exercise', exerciseId: ids.row },
    exercises: [
      exercise(ids.bench, 'Bench press', 0),
      exercise(ids.row, 'Barbell row', 2),
      exercise(ids.fly, 'Cable fly', 4),
    ],
    ...extra,
  } as unknown as WorkoutRecord;
}
function finished(base: WorkoutRecord, exerciseId: string, at = T0 + 600_000) {
  const exercise = base.exercises.find((x) => x.id === exerciseId)!;
  exercise.sets = exercise.sets.map((s, i) => ({ ...s, startedAt: at + i * 1000, completedAt: at + i * 1000 + 500 }));
  return base;
}

test('before an exercise\'s first set is Ready, not a rest of 0:00 (#3734)', () => {
  const ready = workout();
  assert.equal(workoutPhaseOf(ready), 'ready');
  assert.equal(pipPhaseFor(ready), 'ready');
  const status = workoutStatusFor(ready)!;
  assert.equal(status.phase, 'ready');
  assert.equal(status.restStartedAt, null, 'no rest to count');
  // The clock falls back to the workout's running time: its start, moved on by ended pauses.
  assert.equal(status.workoutFrom, T0 + 30_000);
  // Ready's buttons are a rest's: Start set and Pause.
  assert.deepEqual(pipCommand(ready, 'log'), { type: 'start', exerciseId: ids.row, setId: id(102) });
  assert.deepEqual(pipCommand(ready, 'pause'), { type: 'pause' });
  assert.equal(pipCommand(ready, 'restPlus'), null);
  // One set in, it is a rest.
  const resting = workout();
  resting.exercises[1].sets[0] = { ...resting.exercises[1].sets[0], startedAt: T0, completedAt: T0 + 500 };
  assert.equal(workoutPhaseOf(resting), 'rest');
});

test('the payload carries the exercise\'s place in the session (#3734)', () => {
  const status = workoutStatusFor(workout())!;
  assert.deepEqual([status.exerciseIndex, status.exerciseCount], [2, 3]);
  assert.equal(status.sessionName, 'Push A');
  // A re-log counts as the exercise it repeats, and is not one more.
  const relog = workout({ soloExerciseId: ids.relog, flow: { stage: 'exercise', exerciseId: ids.relog } });
  relog.exercises.push({ ...relog.exercises[0], id: ids.relog, logId: ids.relog, relogOf: ids.bench, sets: sets(6) });
  const again = workoutStatusFor(relog)!;
  assert.deepEqual([again.exerciseIndex, again.exerciseCount], [1, 3]);
});

test('Exercise done names the next exercise, its place, its sets and its first load (#3734)', () => {
  const done = finished(workout({ flow: { stage: 'summary', exerciseId: ids.row } }), ids.row);
  done.rest = {
    exerciseId: ids.row,
    setId: id(103),
    startedAt: T0 + 601_500,
    endsAt: T0 + 601_500 + 90_000,
    lastSet: true,
  };
  const status = workoutStatusFor(done)!;
  assert.equal(pipPhaseFor(done), 'summary');
  assert.equal(status.phase, 'resting');
  assert.equal(status.nextUp, 'Cable fly');
  assert.deepEqual([status.nextUpIndex, status.nextUpSets, status.nextUpLoad], [3, 2, '27.5 kg × 7']);
});

test('the window\'s copy carries the effort question for its first seconds, and the accent (#3745)', () => {
  const done = finished(workout({ flow: { stage: 'summary', exerciseId: ids.row } }), ids.row);
  done.exercises[1] = { ...done.exercises[1], effortVsPlan: 0, effortSource: 'default' };
  const start = T0 + 601_500;
  done.rest = { exerciseId: ids.row, setId: id(103), startedAt: start, endsAt: start + 90_000, lastSet: true };
  const sent: unknown[] = [];
  let now = start + 2_000;
  const reporter = createPipReporter(
    { setPhase: (_phase, status) => void sent.push(status) },
    () => now,
    '#00c84e',
  );
  reporter.update(done);
  const first = sent.at(-1) as { effortAsk: unknown; accent: string };
  assert.deepEqual(first.effortAsk, { until: start + EFFORT_PIP_MS, answer: 0 });
  assert.equal(first.accent, '#00c84e');
  // Answered: the window goes back to its usual buttons.
  const tapped = structuredClone(done);
  tapped.exercises[1] = { ...tapped.exercises[1], effortVsPlan: 1, effortSource: 'tapped' };
  reporter.update(tapped);
  assert.equal((sent.at(-1) as { effortAsk: unknown }).effortAsk, null);
  // A rest between sets never asks.
  now = start;
  const between = workout();
  between.exercises[1].sets[0] = { ...between.exercises[1].sets[0], startedAt: T0, completedAt: T0 + 500 };
  between.rest = { exerciseId: ids.row, setId: id(102), startedAt: T0 + 500, endsAt: T0 + 120_500 };
  reporter.update(between);
  assert.equal((sent.at(-1) as { effortAsk: unknown }).effortAsk, null);
});

test('the accent the window takes is a #rrggbb from the dark palette', () => {
  assert.match(pipAccent('green', null)!, /^#[\da-f]{6}$/i);
  assert.match(pipAccent('green', 200)!, /^#[\da-f]{6}$/i);
});
