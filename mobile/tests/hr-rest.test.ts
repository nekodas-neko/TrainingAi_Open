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
  assert.deepEqual(setHrLine(false, set), { kind: 'none' });
  assert.match(sparseWorkoutHrNote(false) ?? '', /Wear the chest strap for per-set heart rate/);
  assert.equal(sparseWorkoutHrNote(true), null);
  assert.equal(sparseWorkoutHrNote(null), null);
});

test('a set with too few readings says so instead of a figure (#3775)', async () => {
  const { setHrLine } = await import('../src/features/workouts/data/hr-rest.ts');
  const line = setHrLine(true, { hrMeasured: false, peakBpm: null, bpmAtLog: null, hrr1: null });
  assert.equal(line.kind, 'note');
  assert.match(line.kind === 'note' ? line.text : '', /Too few heart-rate readings/);
  assert.deepEqual(setHrLine(true, { hrMeasured: true, peakBpm: 150, bpmAtLog: 140, hrr1: 18 }), {
    kind: 'figures',
    text: 'Peak 150 bpm · End 140 bpm · HRR60 18 bpm',
  });
  // An older server response carries neither field: the figures show as before.
  assert.equal(setHrLine(undefined, { peakBpm: 150, bpmAtLog: 140, hrr1: null }).kind, 'figures');
});

test('a workout mean and peak need two readings (#3775)', async () => {
  const { workoutHrFiguresShown } = await import('../src/features/workouts/data/hr-rest.ts');
  assert.equal(workoutHrFiguresShown(0), false);
  assert.equal(workoutHrFiguresShown(1), false);
  assert.equal(workoutHrFiguresShown(2), true);
});
