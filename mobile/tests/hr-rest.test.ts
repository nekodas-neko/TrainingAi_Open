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
