import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWorkoutStatus,
  createWorkoutStatusReporter,
  promotionDiagnostic,
  workoutStatusFor,
} from '../src/features/workouts/status/workout-status.ts';
import {
  accountScopeDecision,
  statusDelay,
  routeOpen,
  shouldAskPermission,
  startingScope,
  type AccountScope,
} from '../src/features/workouts/status/sync-decisions.ts';
import { scrubText } from '../src/core/reporting/scrub.ts';
import { workoutStatus as webModule } from '../src/integrations/workout-status/platform.ts';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';

const T0 = Date.UTC(2026, 9, 23, 8);
const ids = {
  workout: '00000000-0000-4000-8000-000000000001',
  bench: '00000000-0000-4000-8000-000000000002',
  row: '00000000-0000-4000-8000-000000000003',
  set: (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
};

function set(n: number, extra: Partial<WorkoutRecord['exercises'][number]['sets'][number]> = {}) {
  return {
    id: ids.set(n),
    weight: '80',
    reps: '8',
    startedAt: null,
    completedAt: null,
    restAfterSec: null,
    planned: { number: n, reps: 8, percent: 70, restSeconds: 90 },
    plannedWeight: 80,
    rpe: null,
    rpeSource: null,
    suggestionHandled: false,
    ...extra,
  };
}
function workout(extra: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const exercise = (id: string, name: string, first: number) => ({
    id,
    logId: id,
    name,
    exerciseType: 'weighted' as const,
    weightUnit: 'kg' as const,
    sets: [set(first), set(first + 1), set(first + 2), set(first + 3)],
  });
  return {
    id: ids.workout,
    sessionName: 'Upper body',
    status: 'active',
    startedAt: T0,
    restAdjustmentSeconds: 0,
    restAnchor: null,
    rest: null,
    runningSet: null,
    flow: { stage: 'exercise', exerciseId: ids.bench },
    exercises: [exercise(ids.bench, 'Bench press', 1), exercise(ids.row, 'Barbell row', 5)],
    ...extra,
  } as unknown as WorkoutRecord;
}
/** Bench press with its first `count` sets recorded. */
function recorded(count: number, extra: Partial<WorkoutRecord> = {}) {
  const base = workout(extra);
  base.exercises[0].sets = base.exercises[0].sets.map((x, i) =>
    i < count ? { ...x, startedAt: T0 + i * 60_000, completedAt: T0 + i * 60_000 + 30_000 } : x,
  );
  return base;
}

test('no status without an open workout', () => {
  assert.equal(workoutStatusFor(null), null);
  assert.equal(workoutStatusFor(workout({ status: 'completed' })), null);
  assert.equal(workoutStatusFor(workout({ status: 'discarded' })), null);
});

test('the warm-up and the review name the session, with no set', () => {
  const warmup = workoutStatusFor(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } }));
  assert.deepEqual(
    [warmup?.phase, warmup?.exerciseName, warmup?.label, warmup?.nextSet, warmup?.sets],
    ['ready', 'Upper body', 'Warm-up', 0, 0],
  );
  assert.equal(
    workoutStatusFor(workout({ flow: { stage: 'review', exerciseId: ids.bench } }))?.label,
    'Finishing up',
  );
});

test('before a set, the next set is named with its prescribed load', () => {
  const status = workoutStatusFor(recorded(1));
  assert.deepEqual(
    [status?.phase, status?.exerciseName, status?.nextSet, status?.sets, status?.load, status?.restEndsAt],
    ['ready', 'Bench press', 2, 4, '80 kg × 8', null],
  );
});

test('a rest carries its end, for the system to count down', () => {
  const endsAt = T0 + 200_000;
  const status = workoutStatusFor(
    recorded(2, {
      rest: { exerciseId: ids.bench, setId: ids.set(2), startedAt: T0 + 110_000, endsAt },
    }),
  );
  assert.deepEqual(
    [status?.phase, status?.nextSet, status?.load, status?.restEndsAt],
    ['resting', 3, '80 kg × 8', endsAt],
  );
});

test('a running set is working, on that set', () => {
  const status = workoutStatusFor(recorded(2, { runningSet: { exerciseId: ids.bench, setId: ids.set(3) } }));
  assert.deepEqual([status?.phase, status?.nextSet, status?.sets, status?.restEndsAt], ['working', 3, 4, null]);
});

test("the last set's rest is timed with no next set to name", () => {
  const endsAt = T0 + 400_000;
  const status = workoutStatusFor(
    recorded(4, {
      flow: { stage: 'summary', exerciseId: ids.bench },
      rest: { exerciseId: ids.bench, setId: ids.set(4), startedAt: T0 + 300_000, endsAt, lastSet: true },
    }),
  );
  assert.deepEqual(
    [status?.phase, status?.nextSet, status?.load, status?.label, status?.restEndsAt],
    ['resting', 0, null, 'Exercise done', endsAt],
  );
  const after = workoutStatusFor(recorded(4, { flow: { stage: 'summary', exerciseId: ids.bench } }));
  assert.deepEqual([after?.phase, after?.label], ['ready', 'Exercise done']);
});

test('a superset follows the partner exercise the workout moved to', () => {
  const base = recorded(1, {
    flow: { stage: 'exercise', exerciseId: ids.row },
    rest: { exerciseId: ids.bench, setId: ids.set(1), startedAt: T0, endsAt: T0 + 90_000 },
  });
  const status = workoutStatusFor(base);
  assert.deepEqual([status?.exerciseName, status?.nextSet, status?.phase], ['Barbell row', 1, 'resting']);
});

test('only known values are shown', () => {
  const blank = workout();
  blank.exercises[0].sets = blank.exercises[0].sets.map((x) => ({ ...x, weight: '', plannedWeight: null }));
  assert.equal(workoutStatusFor(blank)?.load, '8 reps');
  blank.exercises[0].sets = blank.exercises[0].sets.map((x) => ({ ...x, reps: '', planned: null }));
  assert.equal(workoutStatusFor(blank)?.load, null);
  const bodyweight = workout();
  bodyweight.exercises[0].exerciseType = 'bodyweight';
  assert.equal(workoutStatusFor(bodyweight)?.load, '8 reps');
});

test('a pound exercise reads in pounds', () => {
  const pounds = workout();
  pounds.exercises[0].weightUnit = 'lb';
  pounds.exercises[0].sets = pounds.exercises[0].sets.map((x) => ({ ...x, weight: '45' }));
  assert.equal(workoutStatusFor(pounds)?.load, '99.21 lb × 8');
});

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    native: {
      show: (s: { phase: string; nextSet: number }) => (calls.push(`show ${s.phase} ${s.nextSet}`), true),
      update: (s: { phase: string; nextSet: number }) => (calls.push(`update ${s.phase} ${s.nextSet}`), true),
      clear: () => void calls.push('clear'),
    },
  };
}

test('it shows on start, updates only on change, and clears once on finish', () => {
  const { calls, native } = recorder();
  const reporter = createWorkoutStatusReporter(native);
  reporter.update(workout());
  reporter.update(workout());
  assert.deepEqual(calls, ['show ready 1']);
  reporter.update(workout({ runningSet: { exerciseId: ids.bench, setId: ids.set(1) } }));
  reporter.update(
    recorded(1, { rest: { exerciseId: ids.bench, setId: ids.set(1), startedAt: T0, endsAt: T0 + 90_000 } }),
  );
  reporter.update(recorded(1));
  assert.deepEqual(calls.slice(1), ['update working 1', 'update resting 2', 'update ready 2']);
  reporter.update(workout({ status: 'completed' }));
  reporter.update(null);
  assert.deepEqual(calls.slice(4), ['clear']);
});

test('a discarded workout clears, and a later one shows again', () => {
  const { calls, native } = recorder();
  const reporter = createWorkoutStatusReporter(native);
  reporter.update(workout());
  reporter.update(workout({ status: 'discarded' }));
  reporter.update(workout());
  assert.deepEqual(calls, ['show ready 1', 'clear', 'show ready 1']);
});

test('the first update after a restart reconciles: it clears a stale one and shows a live one', () => {
  const none = recorder();
  const restartWithoutWorkout = createWorkoutStatusReporter(none.native);
  restartWithoutWorkout.update(null);
  restartWithoutWorkout.update(null);
  assert.deepEqual(none.calls, ['clear']);

  const live = recorder();
  createWorkoutStatusReporter(live.native).update(recorded(1));
  assert.deepEqual(live.calls, ['show ready 2']);
});

test('invalidate posts the same status again, and clear drops it on sign-out', () => {
  const { calls, native } = recorder();
  const reporter = createWorkoutStatusReporter(native);
  reporter.update(workout());
  reporter.invalidate();
  reporter.update(workout());
  reporter.clear();
  reporter.clear();
  reporter.invalidate();
  reporter.update(null);
  assert.deepEqual(calls, ['show ready 1', 'show ready 1', 'clear']);
});

test('without the native module (web, iOS, an older build) nothing happens', () => {
  assert.equal(webModule, null);
  const reporter = createWorkoutStatusReporter(null);
  assert.doesNotThrow(() => {
    reporter.update(workout());
    reporter.invalidate();
    reporter.update(null);
    reporter.clear();
  });
});

test('the payload carries when the workout began, for the six-hour cutoff', () => {
  assert.equal(workoutStatusFor(workout())?.startedAt, T0);
});

test('a native module that throws never reaches the workout', () => {
  const boom = () => {
    throw new Error('native failure');
  };
  const reporter = createWorkoutStatusReporter({ show: boom, update: boom, clear: boom });
  assert.doesNotThrow(() => {
    reporter.update(workout());
    reporter.update(recorded(1));
    reporter.update(null);
    reporter.invalidate();
    reporter.clear();
  });
  assert.doesNotThrow(() => clearWorkoutStatus({ clear: boom }));
});

function scopes(steps: [AccountScopeStatus, string | null][]) {
  let scope: AccountScope = startingScope;
  return steps.map(([status, userId]) => {
    const decision = accountScopeDecision(scope, status, userId);
    scope = decision.scope;
    return decision.clear;
  });
}
type AccountScopeStatus = Parameters<typeof accountScopeDecision>[1];

test('signing out clears once, however often the status repeats', () => {
  assert.deepEqual(
    scopes([
      ['signedIn', 'a'],
      ['signedOut', null],
      ['signedOut', null],
      ['signedIn', 'a'],
      ['signedOut', null],
    ]),
    [false, true, false, false, true],
  );
});

test('a token refresh, with no reader but still signed in, does not clear', () => {
  assert.deepEqual(
    scopes([
      ['signedIn', 'a'],
      ['checking', null],
      ['signedIn', null],
      ['signedIn', 'a'],
    ]),
    [false, false, false, false],
  );
});

test('switching to a different account clears the first one at once', () => {
  assert.deepEqual(
    scopes([
      ['signedIn', 'a'],
      ['signedIn', 'b'],
      ['signedIn', 'b'],
    ]),
    [false, true, false],
  );
  assert.deepEqual(scopes([['loading', null], ['signedIn', 'a']]), [false, false]);
});

test('the permission is asked only where the module exists, for a new workout, once, and while askable', () => {
  const base = { moduleAvailable: true, startedHere: true, alreadyAsked: false, canAskAgain: true };
  assert.equal(shouldAskPermission(base), true);
  assert.equal(shouldAskPermission({ ...base, moduleAvailable: false }), false);
  assert.equal(shouldAskPermission({ ...base, startedHere: false }), false);
  assert.equal(shouldAskPermission({ ...base, alreadyAsked: true }), false);
  assert.equal(shouldAskPermission({ ...base, canAskAgain: false }), false);
});

test('a tap opens its workout only while it is the active one', () => {
  assert.equal(routeOpen(ids.workout, ids.workout), 'workout');
  assert.equal(routeOpen(ids.workout, 'another'), 'tab');
  assert.equal(routeOpen(null, ids.workout), 'tab');
});

test('the promotion line names the level in words and survives the reporter scrub', () => {
  const line = promotionDiagnostic({ posted: true, promoted: true, sdkFull: 3_600_001, canPostPromoted: true });
  assert.equal(line, 'Workout status promotion: promoted=true posted=true level=baklava-later canpost=true');
  assert.equal(scrubText(line), line);
  assert.match(promotionDiagnostic({ posted: true, promoted: false, sdkFull: 3_600_000, canPostPromoted: true }), /level=baklava /);
  assert.match(promotionDiagnostic({ posted: false, promoted: false, sdkFull: 0, canPostPromoted: false }), /level=older/);
});

test('a sign-out whose secure storage failed still clears the old workout', () => {
  let scope: AccountScope = startingScope;
  const step = (status: AccountScopeStatus, userId: string | null, hasSession: boolean) => {
    const decision = accountScopeDecision(scope, status, userId, hasSession);
    scope = decision.scope;
    return decision.clear;
  };
  assert.equal(step('signedIn', 'a', true), false);
  assert.equal(step('checking', null, false), false);
  assert.equal(step('storageError', null, false), true, 'the session is gone: signed out');
  assert.equal(step('storageError', null, false), false, 'once');
  // A storage error with the session still held (an interrupted sign-in) is no sign-out.
  scope = startingScope;
  assert.equal(step('signedIn', 'a', true), false);
  assert.equal(step('storageError', null, true), false);
});

test('away from the app a journal change goes to the notification at once (#3266)', () => {
  assert.equal(statusDelay('background', true, 250), null, 'no timer fires in the background');
  assert.equal(statusDelay('inactive', false, 250), null);
  assert.equal(statusDelay('active', false, 250), 0, 'the reconcile goes at once');
  assert.equal(statusDelay('active', true, 250), 250, 'in the app a burst still settles first');
});
