import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatsPersonalRecord } from '@trainingai/shared/1rm';
import { buildCatalog } from '../src/features/workouts/catalog.ts';
import { createWorkout, type WorkoutRecord } from '../src/features/workouts/logging/workout.ts';
import {
  exerciseResult,
  newPersonalRecord,
  personalRecordNames,
  personalRecordShareText,
  personalRecordsLine,
} from '../src/features/workouts/logging/summary.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

// #3671 ②: Preview says "New Personal Record" where the current app does, against the same bar.

function session(row: Record<string, unknown>) {
  const f = loggingFixture();
  Object.assign(f.response.exercises[0], row);
  return buildCatalog(f.meta, f.next, f.all, f.reader).program!.sessions[0];
}
let seq = 1;
const uuid = () => `30000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
// Both sets done at 100 kg × 8: an estimate well above anything below.
function done(row: Record<string, unknown>, over: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const w = createWorkout(session(row), programId, 'Australia/Brisbane', false, Date.parse('2026-11-08T08:00:00Z'), uuid);
  const exercise = w.exercises[0];
  exercise.sets = exercise.sets.map((set, i) => ({
    ...set,
    weight: '100',
    reps: '8',
    startedAt: Date.parse('2026-11-08T08:10:00Z') + i * 300_000,
    completedAt: Date.parse('2026-11-08T08:11:00Z') + i * 300_000,
  }));
  return { ...w, ...over };
}

test('the shared rule: beats the all-time record, else last session, by more than 0.1', () => {
  assert.equal(beatsPersonalRecord(120, 119, 130), true);
  assert.equal(beatsPersonalRecord(120, 119.95, null), false);
  assert.equal(beatsPersonalRecord(120, null, 110), true);
  assert.equal(beatsPersonalRecord(120, null, 125), false);
  assert.equal(beatsPersonalRecord(120, null, null), true);
  assert.equal(beatsPersonalRecord(0, null, null), false);
  assert.equal(beatsPersonalRecord(null, null, null), false);
});

test('the catalog carries the all-time record and the baseline flag; a bad record is no record', () => {
  const ex = session({ allTimePr1rm: 140, prevFromBaseline: true }).exercises[0];
  assert.equal(ex.allTimePr1rm, 140);
  assert.equal(ex.prevFromBaseline, true);
  const none = session({ allTimePr1rm: 'x' }).exercises[0];
  assert.equal(none.allTimePr1rm, null);
  assert.equal(none.prevFromBaseline, false);
});

test('a session beating the all-time record says so, and lists it on the done screen', () => {
  const w = done({ allTimePr1rm: 50 });
  const estimate = exerciseResult(w, w.exercises[0]).estimate!;
  assert.ok(estimate > 50);
  assert.equal(newPersonalRecord(w, w.exercises[0]), true);
  assert.deepEqual(personalRecordNames(w), ['Bench press']);
  assert.equal(personalRecordsLine(['Bench press']), '🏆 New PRs: Bench press');
  assert.equal(personalRecordShareText('Bench press'), '🏆 New personal record on Bench press! #TrainingAI');
});

test('beating last session but not the all-time record is no record (E1-7)', () => {
  const w = done({ allTimePr1rm: 1000, estimated1rm: 50 });
  assert.equal(newPersonalRecord(w, w.exercises[0]), false);
  assert.deepEqual(personalRecordNames(w), []);
  assert.equal(personalRecordsLine([]), null);
});

test('a deload session is never a record, a baseline test is', () => {
  const deload = done({ allTimePr1rm: 50 }, { intensityMode: 'deload' });
  assert.equal(newPersonalRecord(deload, deload.exercises[0]), false);
  const baseline = done({ allTimePr1rm: 50 }, { intensityMode: 'deload', isBaseline: true });
  assert.equal(newPersonalRecord(baseline, baseline.exercises[0]), true);
  const deloaded = done({ allTimePr1rm: 50, deloaded: true });
  assert.equal(newPersonalRecord(deloaded, deloaded.exercises[0]), false);
});
