import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runningPlanSpec } from '../src/features/activities/data/models.ts';

// #3779 — a walking plan keeps its own state on the plan's snapshot instead of running fitness.
// The payload must still parse (Preview's Cardio and Running screens read it), and a running plan's
// fitness must still be checked field by field.
const schema = runningPlanSpec('2026-11-15').schema;
const base = { prescription: null, run: null, heartHealth: { days: [] } };

test('a walking plan payload parses, its snapshot read as no running fitness', () => {
  const parsed = schema.parse({
    ...base,
    plan: {
      id: 'p-w',
      frameworkKey: 'walking-heart-health',
      goalKind: 'walking',
      fitnessSnapshot: { walkingPlan: { version: 1, stepsTarget: 8000, minutesTarget: 60, weeks: [] } },
    },
  });
  assert.equal(parsed.plan?.fitnessSnapshot, null);
  assert.equal(parsed.plan?.id, 'p-w');
});

test('a running plan payload keeps its fitness snapshot', () => {
  const fitness = { maxHr: 190, restingHr: 60, vo2max: null, thresholdHr: null, weeklyBaseMinutes: 120, source: 'baseline' };
  const parsed = schema.parse({ ...base, plan: { id: 'p-r', frameworkKey: 'zone2-base', fitnessSnapshot: fitness } });
  assert.deepEqual(parsed.plan?.fitnessSnapshot, fitness);
});

test('a malformed running snapshot is still refused', () => {
  assert.throws(() => schema.parse({ ...base, plan: { id: 'p-r', frameworkKey: 'zone2-base', fitnessSnapshot: { maxHr: 'high' } } }));
});

test('a walking plan whose state has not been written yet ({}) parses as no running fitness', () => {
  const parsed = schema.parse({ ...base, plan: { id: 'p-w0', frameworkKey: 'walking-heart-health', goalKind: 'walking', fitnessSnapshot: {} } });
  assert.equal(parsed.plan?.fitnessSnapshot, null);
});

test('the walking block of the payload parses, and a running payload has none', () => {
  const walking = {
    kind: 'walking',
    targets: { stepsPerDay: 8000, activeMinutesPerWeek: 140, activeMinutesPerDay: 20, stepsCeiling: 12000 },
    week: {
      from: '2026-11-16',
      to: '2026-11-22',
      stepsToday: null,
      activeMinutes: 0,
      activeMinutesBasis: null,
      days: [{ date: '2026-11-16', steps: null, stepsMet: false, activeMinutes: 0, minutesMet: false, done: false, excluded: null, isToday: true }],
    },
  };
  const parsed = schema.parse({ ...base, plan: { id: 'p-w', frameworkKey: 'walking-heart-health', goalKind: 'walking', fitnessSnapshot: {} }, walking });
  assert.equal(parsed.walking?.targets.stepsPerDay, 8000);
  assert.equal(schema.parse({ ...base, plan: null }).walking, undefined);
});
