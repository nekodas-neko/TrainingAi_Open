import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exercisesWithoutRest, REST_NOT_MEASURED } from '../src/features/workouts/data/hr-rest.ts';

test('an exercise with no recovery reading on any set says its rest was not measured (#2299)', () => {
  const set = (exerciseName: string, hrr1: number | null) => ({
    exerciseName,
    hrr1,
    adequate: null,
  });
  assert.equal(REST_NOT_MEASURED, 'Rest not measured with this device');
  assert.deepEqual(
    exercisesWithoutRest([
      set('Bench press', 9),
      set('Row', null),
      set('Row', null),
      set('Lateral raise', null),
      set('Squat', 4),
      set('Squat', null),
    ]),
    ['Row', 'Lateral raise'],
    'a partly measured exercise keeps its n/m line; a wholly unmeasured one gets the muted line',
  );
  assert.deepEqual(exercisesWithoutRest([]), []);
});

test('a sparse workout hides every per-set figure and says why once (#3775)', async () => {
  const { setHrLine, sparseWorkoutHrNote } = await import('../src/features/workouts/data/hr-rest.ts');
  const set = { hrMeasured: true, peakBpm: 150, bpmAtLog: 140, hrr1: 18 };
  assert.deepEqual(setHrLine(false, set, 9), { kind: 'none' });
  assert.match(sparseWorkoutHrNote(false, 9, [set]) ?? '', /Wear the chest strap for per-set heart rate/);
  assert.equal(sparseWorkoutHrNote(true, 3600, [set]), null);
  assert.equal(sparseWorkoutHrNote(null, 3600, [set]), null);
});

test('a set with too few readings says so instead of a figure (#3775)', async () => {
  const { setHrLine } = await import('../src/features/workouts/data/hr-rest.ts');
  const line = setHrLine(true, { hrMeasured: false, peakBpm: null, bpmAtLog: null, hrr1: null }, 13);
  assert.equal(line.kind, 'note');
  assert.match(line.kind === 'note' ? line.text : '', /Too few heart-rate readings/);
  assert.deepEqual(setHrLine(true, { hrMeasured: true, peakBpm: 150, bpmAtLog: 140, hrr1: 18 }, 3600), {
    kind: 'figures',
    text: 'Peak 150 bpm · End 140 bpm · HRR60 18 bpm',
  });
  // An older server response carries neither field: the figures show as before.
  assert.equal(setHrLine(undefined, { peakBpm: 150, bpmAtLog: 140, hrr1: null }, 3600).kind, 'figures');
});

test('a workout mean and peak need two readings (#3775)', async () => {
  const { workoutHrFiguresShown } = await import('../src/features/workouts/data/hr-rest.ts');
  assert.equal(workoutHrFiguresShown(0), false);
  assert.equal(workoutHrFiguresShown(1), false);
  assert.equal(workoutHrFiguresShown(2), true);
});

test('a workout with readings every 3 to 5 minutes says why once, even when judged dense (#3839)', async () => {
  const { sparseWorkoutHrNote } = await import('../src/features/workouts/data/hr-rest.ts');
  const unmeasured = { hrMeasured: false, peakBpm: null, bpmAtLog: null, hrr1: null };
  assert.match(sparseWorkoutHrNote(true, 13, [unmeasured, unmeasured]) ?? '', /too sparse for per-set heart rate/);
  assert.equal(sparseWorkoutHrNote(true, 13, [unmeasured, { ...unmeasured, hrMeasured: true }]), null);
  assert.equal(sparseWorkoutHrNote(true, 0, [unmeasured]), null, 'no readings: nothing sparse to explain');
});

test('a workout with no readings at all keeps the dashes, not "too few readings" (#3839)', async () => {
  const { setHrLine } = await import('../src/features/workouts/data/hr-rest.ts');
  // A pruned strap workout, or one with no heart rate: the server sends hrMeasured false.
  assert.deepEqual(setHrLine(true, { hrMeasured: false, peakBpm: null, bpmAtLog: null, hrr1: null }, 0), {
    kind: 'figures',
    text: 'Peak — bpm · End — bpm',
  });
  assert.deepEqual(setHrLine(null, { hrMeasured: false, peakBpm: null, bpmAtLog: null, hrr1: null }, 0), {
    kind: 'figures',
    text: 'Peak — bpm · End — bpm',
  });
});
