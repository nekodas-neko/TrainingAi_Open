import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityClock,
  activityServiceNotification,
  type ActivitySession,
} from '../src/features/activities/data/ActivityStore.ts';
import {
  isActivityServiceRunning,
  runActivityService,
} from '../src/features/activities/data/background-recording.ts';
import {
  createActivityServiceHost,
  type NativeActivityService,
} from '../src/integrations/activity-service/shared-service.ts';
import {
  WORKOUT_HOLD_MAX_AGE_MS,
  WORKOUT_STRAP_NOTIFICATION,
  holdServiceForWorkout,
  workoutServiceWanted,
} from '../src/features/devices/strap/workout-hold.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The native module as the host sees it: every call logged, the start answered on demand. */
class FakeNative implements NativeActivityService {
  log: string[] = [];
  private answers: ((result: 'on' | 'failed' | 'skipped') => void)[] = [];
  constructor(private answer: 'on' | 'failed' | 'skipped' | 'manual' = 'on') {}
  start(title: string, body: string, startedAt: number | null, pausedMs: number | null) {
    this.log.push(`start ${title} | ${body} | ${startedAt} | ${pausedMs}`);
    if (this.answer === 'manual') {
      return new Promise<'on' | 'failed' | 'skipped'>((resolve) => this.answers.push(resolve));
    }
    return Promise.resolve(this.answer);
  }
  reply(result: 'on' | 'failed' | 'skipped') {
    this.answers.shift()?.(result);
  }
  async show(title: string, body: string, startedAt: number | null, pausedMs: number | null) {
    this.log.push(`show ${title} | ${body} | ${startedAt} | ${pausedMs}`);
  }
  async clear() {
    this.log.push('clear');
  }
  async stop() {
    this.log.push('stop');
  }
  /** The calls since the host's own clear at creation. */
  calls() {
    return this.log.filter((_, i) => i > 0);
  }
}

const START = 1_793_000_000_000;
function walk(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: '7d3c8a52-1d7b-4cb5-9f5e-2b4f3f0a6c11',
    type: { id: 'walk', label: 'Walk', isDistanceBased: true } as ActivitySession['type'],
    title: 'Walk',
    mode: 'active',
    startMs: START,
    endMs: null,
    pausedMs: 0,
    pauseStartMs: null,
    notes: '',
    distance: '',
    ...overrides,
  };
}

// #3626: the notification payload carries the start time and the paused state.
test('a running activity counts up from its start, moved on by the time already paused', () => {
  assert.deepEqual(activityClock(walk()), { startedAt: START, pausedElapsedMs: null });
  assert.deepEqual(activityClock(walk({ pausedMs: 90_000 })), {
    startedAt: START + 90_000,
    pausedElapsedMs: null,
  });
  assert.deepEqual(activityServiceNotification(walk()), {
    title: 'TrainingAI · Activity',
    body: 'Tracking your walk',
    clock: { startedAt: START, pausedElapsedMs: null },
  });
});

test('a paused activity carries the frozen elapsed time, the same the screen shows', () => {
  // 20 minutes in, 2 of them paused earlier, paused again now.
  const paused = walk({ pausedMs: 120_000, pauseStartMs: START + 20 * 60_000 });
  assert.deepEqual(activityClock(paused), {
    startedAt: START + 120_000,
    pausedElapsedMs: 18 * 60_000,
  });
});

test('no clock before the start or after the end', () => {
  assert.equal(activityServiceNotification(walk({ mode: 'pre', startMs: null })), null);
  assert.equal(activityServiceNotification(walk({ mode: 'done', endMs: START + 60_000 })), null);
});

test('a GPS recording shows its clock on a notification of its own, cleared at the end', async () => {
  const native = new FakeNative();
  const host = createActivityServiceHost(native);
  assert.deepEqual(native.log, ['clear'], 'a notification left by a killed process goes at once');
  host.notify('activity', activityServiceNotification(walk()));
  host.notify('activity', activityServiceNotification(walk()));
  host.notify('activity', activityServiceNotification(walk({ pauseStartMs: START + 60_000 })));
  host.notify('activity', null);
  await settle();
  assert.deepEqual(native.calls(), [
    `show TrainingAI · Activity | Tracking your walk | ${START} | null`,
    `show TrainingAI · Activity | Tracking your walk | ${START} | 60000`,
    'clear',
  ]);
});

test('an indoor activity starts the service with its clock and stops it at the end', async () => {
  const native = new FakeNative();
  const host = createActivityServiceHost(native);
  const treadmill = walk({ type: { id: 'treadmill', label: 'Treadmill', isDistanceBased: false } as ActivitySession['type'] });
  host.notify('activity', activityServiceNotification(treadmill));
  await settle();
  const stop = runActivityService(host.starter('activity'), { title: 'TrainingAI · Activity', body: 'Tracking your treadmill' }, () => {});
  await settle();
  assert.equal(isActivityServiceRunning(), true);
  host.notify('activity', activityServiceNotification({ ...treadmill, pauseStartMs: START + 5_000 }));
  stop();
  host.notify('activity', null);
  await settle();
  assert.deepEqual(native.calls(), [
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    `start TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | 5000`,
    'stop',
  ]);
  assert.equal(isActivityServiceRunning(), false);
});

// #3627: one service, counted. A workout and an activity at once share it.
test('a workout and an activity share one service; it stops with the last release', async () => {
  const native = new FakeNative();
  const host = createActivityServiceHost(native);
  const releaseWorkout = holdServiceForWorkout(host.starter('workout'));
  await settle();
  const stopActivity = runActivityService(host.starter('activity'), { title: 'TrainingAI · Activity', body: 'Tracking your treadmill' }, () => {});
  await settle();
  // The activity's notification, with its clock, wins while both hold.
  host.notify('activity', activityServiceNotification(walk()));
  stopActivity();
  host.notify('activity', null);
  await settle();
  assert.equal(native.calls().filter((call) => call.startsWith('start')).length, 1);
  assert.equal(native.calls().includes('stop'), false, "the activity's end leaves the workout's service");
  assert.equal(
    native.calls().at(-1),
    `show ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`,
  );
  releaseWorkout();
  releaseWorkout();
  await settle();
  assert.deepEqual(native.calls().filter((call) => call === 'stop'), ['stop']);
});

test('a hold released while Android is still answering stops the service once it is up', async () => {
  const native = new FakeNative('manual');
  const host = createActivityServiceHost(native);
  const release = holdServiceForWorkout(host.starter('workout'));
  await settle();
  release();
  native.reply('on');
  await settle();
  assert.deepEqual(native.calls(), [
    `start ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`,
    'stop',
  ]);
});

test('a refused or skipped start holds nothing, and the next workout asks again', async () => {
  for (const answer of ['failed', 'skipped'] as const) {
    const native = new FakeNative(answer);
    const host = createActivityServiceHost(native);
    const release = holdServiceForWorkout(host.starter('workout'));
    await settle();
    release();
    holdServiceForWorkout(host.starter('workout'));
    await settle();
    assert.equal(native.calls().filter((call) => call.startsWith('start')).length, 2);
    assert.equal(native.calls().includes('stop'), false);
  }
});

const open = { status: 'active', startedAt: START };
const base = { signedIn: true, workout: open, strapPaired: true, now: START + 60_000 };

test('a workout holds the service from its start, with a strap paired and signed in', () => {
  assert.equal(workoutServiceWanted(base), true);
  assert.equal(workoutServiceWanted({ ...base, strapPaired: false }), false, 'no strap, nothing to keep alive');
  assert.equal(workoutServiceWanted({ ...base, workout: null }), false);
});

test('finish, discard, sign-out and an abandoned workout release it', () => {
  assert.equal(workoutServiceWanted({ ...base, workout: { ...open, status: 'completed' } }), false);
  assert.equal(workoutServiceWanted({ ...base, workout: { ...open, status: 'discarded' } }), false);
  assert.equal(workoutServiceWanted({ ...base, signedIn: false }), false);
  // Reopened hours after a kill: the workout is still open, but nothing should hold the phone.
  assert.equal(workoutServiceWanted({ ...base, now: START + WORKOUT_HOLD_MAX_AGE_MS - 1 }), true);
  assert.equal(workoutServiceWanted({ ...base, now: START + WORKOUT_HOLD_MAX_AGE_MS }), false);
});

test('the workout hold is taken on start and released on finish, discard and sign-out', async () => {
  // As StrapProvider drives it: hold while wanted, release when it stops being wanted.
  for (const end of [
    { ...base, workout: { ...open, status: 'completed' } },
    { ...base, workout: { ...open, status: 'discarded' } },
    { ...base, signedIn: false, workout: null },
  ]) {
    const native = new FakeNative();
    const host = createActivityServiceHost(native);
    let release: (() => void) | null = null;
    for (const state of [base, base, end]) {
      const wanted = workoutServiceWanted(state);
      if (wanted && !release) release = holdServiceForWorkout(host.starter('workout'));
      if (!wanted && release) {
        release();
        release = null;
      }
      await settle();
    }
    assert.deepEqual(
      native.calls().map((call) => call.split(' ')[0]),
      ['start', 'stop'],
    );
    assert.equal(isActivityServiceRunning(), false, "the workout's hold leaves the activity flag alone");
  }
});
