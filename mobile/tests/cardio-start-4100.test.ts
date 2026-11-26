import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  START_ROOT_ROWS,
  TREADMILL_LOG_MINUTES,
  WALK_RUN_ROWS,
  somethingElseTypes,
  startButtonTitle,
  startStepBack,
  startStepTitle,
  treadmillType,
} from '../src/features/activities/data/cardio-start.ts';

// #4100: one Start button, a sheet with two steps, and a step of its own for the treadmill.

test('the first step offers Walk or run and Something else, nothing else', () => {
  assert.deepEqual(
    START_ROOT_ROWS.map((row) => row.title),
    ['Walk or run', 'Something else'],
  );
});

test('Walk or run offers Run, Walk, Guided walk and Treadmill in that order', () => {
  assert.deepEqual(
    WALK_RUN_ROWS.map((row) => row.title),
    ['Run', 'Walk', 'Guided walk', 'Treadmill'],
  );
});

test("Treadmill's step logs 20, 30 and 45 min, and walk or run are the same activity type", () => {
  assert.deepEqual([...TREADMILL_LOG_MINUTES], [20, 30, 45]);
  assert.equal(treadmillType('walk').id, 'treadmill');
  assert.equal(treadmillType('run').id, 'treadmill');
  assert.equal(treadmillType('walk').label, 'Treadmill walk');
  assert.equal(treadmillType('run').label, 'Treadmill run');
});

test('Back goes treadmill → walk or run → first step → closes', () => {
  assert.equal(startStepBack('treadmill'), 'walk-run');
  assert.equal(startStepBack('walk-run'), 'root');
  assert.equal(startStepBack('else'), 'root');
  assert.equal(startStepBack('root'), null);
  assert.equal(startStepTitle('root'), 'Start an activity');
});

test('Something else is the Log Activity grid without Treadmill, Walk and Run', () => {
  const types = ['run', 'walk', 'treadmill', 'cycle', 'swim', 'Treadmill'].map((id) => ({ id }));
  assert.deepEqual(
    somethingElseTypes(types).map((type) => type.id),
    ['cycle', 'swim'],
  );
});

test('the card button names an open activity instead of offering a second start', () => {
  assert.equal(startButtonTitle(true), 'Activity in progress');
  assert.equal(startButtonTitle(false), 'Start an activity');
});
