import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPipReporter, HR_PUSH_MS } from '../src/features/workouts/pip/usePictureInPicture.ts';
import { workoutStatusFor } from '../src/features/workouts/status/workout-status.ts';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';

const ids = {
  workout: '00000000-0000-4000-8000-000000000001',
  bench: '00000000-0000-4000-8000-000000000002',
  set: (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
};
function resting(): WorkoutRecord {
  const set = (n: number, done: boolean) => ({
    id: ids.set(n),
    weight: '80',
    reps: '8',
    startedAt: done ? 1 : null,
    completedAt: done ? 2 : null,
    restAfterSec: null,
    planned: { number: n, reps: 8, percent: 70, restSeconds: 90 },
    plannedWeight: 80,
    rpe: null,
    rpeSource: null,
    suggestionHandled: false,
  });
  return {
    id: ids.workout,
    status: 'active',
    sessionName: 'Push A',
    startedAt: Date.UTC(2026, 9, 19, 8),
    pausedAt: null,
    pausedMs: 0,
    restAdjustmentSeconds: 0,
    restAnchor: null,
    rest: { exerciseId: ids.bench, setId: ids.set(1), startedAt: 1_000, endsAt: 91_000 },
    runningSet: null,
    flow: { stage: 'exercise', exerciseId: ids.bench },
    exercises: [
      { id: ids.bench, logId: ids.bench, name: 'Bench press', weightUnit: 'kg', exerciseType: 'weighted', sets: [set(1, true), set(2, false)] },
    ],
  } as unknown as WorkoutRecord;
}
const reading = (bpm: number, at: number) => ({ bpm, zoneName: 'Aerobic', zoneColor: '#eab308', at });

test('the notification never sees a heart rate, so a reading is not a status change (#3266)', () => {
  assert.equal(workoutStatusFor(resting())!.hr, null);
});

test('a reading reaches the window at most once a second, with no timer (#3266)', () => {
  let now = 10_000;
  const sent: { hr: unknown }[] = [];
  const reporter = createPipReporter(
    { setPhase: (_phase, status) => void sent.push({ hr: status?.hr ?? null }) },
    () => now,
  );
  reporter.update(resting());
  assert.equal(sent.length, 1);
  reporter.heartRate(reading(120, now));
  assert.equal(sent.length, 2, 'the first reading goes at once');
  now += 300;
  reporter.heartRate(reading(121, now));
  now += 300;
  reporter.heartRate(reading(122, now));
  assert.equal(sent.length, 2, 'readings inside a second wait');
  now += HR_PUSH_MS;
  reporter.heartRate(reading(125, now));
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2].hr, reading(125, now));
});

test('losing the strap clears the reading at once, and a repeat of nothing sends nothing (#3266)', () => {
  const now = 10_000;
  const sent: { hr: unknown }[] = [];
  const reporter = createPipReporter(
    { setPhase: (_phase, status) => void sent.push({ hr: status?.hr ?? null }) },
    () => now,
  );
  reporter.update(resting());
  reporter.heartRate(null);
  assert.equal(sent.length, 1, 'no reading, nothing new to say');
  reporter.heartRate(reading(120, now));
  reporter.heartRate(null);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].hr, null);
});

test('a workout change goes at once, carrying the last reading (#3266)', () => {
  const now = 10_000;
  const sent: { phase: string; hr: unknown }[] = [];
  const reporter = createPipReporter(
    { setPhase: (phase, status) => void sent.push({ phase, hr: status?.hr ?? null }) },
    () => now,
  );
  reporter.update(resting());
  reporter.heartRate(reading(120, now));
  reporter.update({ ...resting(), pausedAt: 5_000 });
  assert.equal(sent.at(-1)!.phase, 'paused');
  assert.deepEqual(sent.at(-1)!.hr, reading(120, now));
});
