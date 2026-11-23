import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayLoad,
  loadLabel,
  storedLoad,
  weightUnitOf,
} from '../src/features/workouts/logging/preferences.ts';
import { formatSetLoad } from '../src/features/workouts/logging/targets.ts';
import { workoutStatusFor, knownLoad } from '../src/features/workouts/status/workout-status.ts';
import { workoutCalendarEvent } from '../src/features/platform/data/CalendarStore.ts';
import { createWorkout, mutationFor } from '../src/features/workouts/logging/workout.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

// #4072 part 1: a lift logged in pounds reads in pounds wherever a set is labelled. What is stored
// and uploaded stays exact kilograms.
const dumbbell = storedLoad('22.5', 'lb');

test('a kilogram lift reads as it always did', () => {
  assert.equal(loadLabel('62.5'), '62.5 kg');
  assert.equal(loadLabel('62.5', 'kg'), '62.5 kg');
  assert.equal(loadLabel('10.2058'), '10.21 kg');
  assert.equal(loadLabel(0), '0 kg');
  assert.equal(loadLabel(''), '');
  assert.equal(loadLabel('abc', 'lb'), '');
});

test('a pound lift reads in pounds, to the nearest tenth', () => {
  assert.equal(loadLabel(dumbbell, 'lb'), '22.5 lb', 'the 22.5 lb dumbbell, not 10.21 kg');
  assert.equal(loadLabel(storedLoad('25', 'lb'), 'lb'), '25 lb', 'a whole number has no ".0"');
  assert.equal(loadLabel(storedLoad('45', 'lb'), 'lb'), '45 lb');
  assert.equal(loadLabel('10.2058', 'lb'), '22.5 lb', 'a rounded kilogram figure still lands on the half');
  assert.equal(loadLabel('11.35', 'lb'), '25 lb', '24.99 rounds up to the whole');
  assert.equal(loadLabel('11.25', 'lb'), '24.8 lb');
  assert.equal(loadLabel(0, 'lb'), '0 lb');
  assert.equal(loadLabel('-9', 'lb'), '-19.8 lb', 'assistance keeps its sign');
  assert.equal(loadLabel('', 'lb'), '');
});

test('a bodyweight set reads in the lift’s unit, and an unloaded one stays reps only', () => {
  const bw = { exerciseType: 'bodyweight' as const, weightUnit: 'lb' as const };
  assert.equal(formatSetLoad(bw, { weight: '0', reps: '8' }), '8 reps');
  assert.equal(formatSetLoad(bw, { weight: dumbbell, reps: '8' }), '+22.5 lb × 8 reps');
  assert.equal(formatSetLoad({ ...bw, weightUnit: 'kg' }, { weight: '5', reps: '8' }), '+5 kg × 8 reps');
});

test('formatSetLoad takes the unit from the exercise, kilograms when it has none', () => {
  const set = { weight: dumbbell, reps: '10' };
  assert.equal(formatSetLoad({ exerciseType: 'weighted', weightUnit: 'lb' }, set), '22.5 lb × 10 reps');
  assert.equal(formatSetLoad({ exerciseType: 'weighted', weightUnit: 'kg' }, set), '10.21 kg × 10 reps');
  assert.equal(formatSetLoad({ exerciseType: 'weighted' }, set), '10.21 kg × 10 reps');
});

test('the unit comes from the same preference the set card toggle writes', () => {
  const units = { a: 'lb' as const };
  assert.equal(weightUnitOf(units, 'a'), 'lb');
  assert.equal(weightUnitOf(units, 'b'), 'kg');
  assert.equal(weightUnitOf(units, null), 'kg');
});

test('the entry wheel and the label agree on the same stored load', () => {
  assert.equal(displayLoad(dumbbell, 'lb'), '22.5');
  assert.equal(loadLabel(dumbbell, 'lb'), '22.5 lb');
});

test('the picture-in-picture and notification load reads in the lift’s unit', () => {
  const f = loggingFixture();
  const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
  const exercise = { ...workout.exercises[0], weightUnit: 'lb' as const };
  const set = { ...exercise.sets[0], weight: dumbbell, reps: '10' };
  assert.equal(knownLoad(exercise, set), '22.5 lb × 10');
  assert.equal(knownLoad({ ...exercise, weightUnit: 'kg' }, set), '10.21 kg × 10');
  assert.ok(workoutStatusFor);
});

test('a calendar entry lists a pound lift in pounds', () => {
  const f = loggingFixture();
  const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
  workout.exercises = [
    {
      ...workout.exercises[0],
      weightUnit: 'lb',
      sets: [{ ...workout.exercises[0].sets[0], weight: dumbbell, reps: '10', completedAt: 5 }],
    },
  ];
  workout.status = 'completed';
  workout.startedAt = 1;
  workout.completedAt = 99_000;
  const event = workoutCalendarEvent(workout);
  assert.match(event.notes, /: 22\.5 lb × 10$/m);
});

const T = Date.UTC(2026, 10, 23, 2);

test('what is uploaded does not change with the unit: exact kilograms, no unit field', () => {
  const f = loggingFixture();
  const make = (unit: 'kg' | 'lb') => {
    let n = 0;
    const same = () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const workout = createWorkout(f.session, programId, null, true, T, same);
    const exercise = workout.exercises[0];
    exercise.weightUnit = unit;
    exercise.sets = [
      { ...exercise.sets[0], weight: dumbbell, reps: '10', startedAt: T + 2_000, completedAt: T + 20_000 },
    ];
    return mutationFor(workout, { id: exercise.logId, domain: 'workout_log', exerciseId: exercise.id });
  };
  const inLb = make('lb');
  const inKg = make('kg');
  assert.deepEqual(inLb, inKg, 'the same stored load uploads the same body in either unit');
  const body = inLb.payload as { weights: number[] };
  assert.deepEqual(body.weights, [Number(dumbbell)], 'the exact kilograms, as before');
  assert.ok(Math.abs(body.weights[0] - 10.2058) < 1e-4);
  assert.doesNotMatch(JSON.stringify(inLb), /"lb"|weightUnit|unit/);
});

test('a pound label rounds a tie away from zero, for an assistance (negative) load as for a positive one', () => {
  // Exact half-tenths: these kilogram values convert to precisely 0.25 lb and 0.35 lb, no float noise.
  assert.equal(loadLabel(0.1133980925, 'lb'), '0.3 lb', 'positive tie 0.25 rounds up');
  assert.equal(loadLabel(-0.1133980925, 'lb'), '-0.3 lb', 'negative tie 0.25 rounds away from zero');
  assert.equal(loadLabel(0.1587573295, 'lb'), '0.4 lb');
  assert.equal(loadLabel(-0.1587573295, 'lb'), '-0.4 lb');
  assert.equal(loadLabel(-0.0113398, 'lb'), '0 lb', 'no negative zero');
  assert.equal(loadLabel('0', 'lb'), '0 lb');
});
