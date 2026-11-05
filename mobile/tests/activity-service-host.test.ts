import test, { mock } from 'node:test';
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
  holdWorkoutServiceUntilCutoff,
  workoutServiceWanted,
  workoutToHold,
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

// #3632: the refused start used to leave the workout's text up as a plain notification ("Keeping
// your strap connected through the workout") with nothing holding the strap, and a workout never
// redraws it.
test('a refused or skipped start leaves nothing on screen', async () => {
  for (const answer of ['failed', 'skipped'] as const) {
    const native = new FakeNative(answer);
    const host = createActivityServiceHost(native);
    holdServiceForWorkout(host.starter('workout'));
    await settle();
    assert.deepEqual(native.calls(), [
      `start ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`,
    ]);
  }
});

test("a refused start for an indoor activity puts the activity's clock on a notification of its own", async () => {
  const native = new FakeNative('failed');
  const host = createActivityServiceHost(native);
  const treadmill = walk({ type: { id: 'treadmill', label: 'Treadmill', isDistanceBased: false } as ActivitySession['type'] });
  host.notify('activity', activityServiceNotification(treadmill));
  await settle();
  runActivityService(host.starter('activity'), TREADMILL, () => {});
  await settle();
  host.notify('activity', null);
  await settle();
  assert.deepEqual(native.calls(), [
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    `start TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    // The start's refusal: the same clock goes back on the plain notification, and goes at the end.
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    'clear',
  ]);
  assert.equal(isActivityServiceRunning(), false);
});

const TREADMILL = { title: 'TrainingAI · Activity', body: 'Tracking your treadmill' };
type Claimant = 'activity' | 'workout';
const other = (claimant: Claimant): Claimant => (claimant === 'activity' ? 'workout' : 'activity');
const hold = (host: ReturnType<typeof createActivityServiceHost>, claimant: Claimant) =>
  claimant === 'activity'
    ? runActivityService(host.starter('activity'), TREADMILL, () => {})
    : holdServiceForWorkout(host.starter('workout'));
const textOf = { activity: TREADMILL, workout: WORKOUT_STRAP_NOTIFICATION };
/** The title and body on screen now: the last one the host started the service with or showed. */
const onScreen = (native: FakeNative) => {
  const last = native.calls().filter((call) => /^(start|show) /.test(call)).at(-1);
  return last?.replace(/^(start|show) /, '').split(' | ').slice(0, 2).join(' | ');
};

// #3632: every order of two holds and two releases. One start; the stop waits for the last release;
// the notification belongs to whoever still holds.
for (const first of ['activity', 'workout'] as const) {
  for (const firstOut of ['activity', 'workout'] as const) {
    const second = other(first);
    const lastOut = other(firstOut);
    test(`the ${first} holds first, the ${firstOut} lets go first: the service stays for the ${lastOut}`, async () => {
      const native = new FakeNative();
      const host = createActivityServiceHost(native);
      const release = {} as Record<Claimant, () => void>;
      release[first] = hold(host, first);
      await settle();
      release[second] = hold(host, second);
      await settle();
      assert.equal(onScreen(native), `${textOf.activity.title} | ${textOf.activity.body}`, "the activity's wins while both hold");
      release[firstOut]();
      await settle();
      assert.equal(native.calls().includes('stop'), false, `the ${firstOut}'s release leaves the ${lastOut}'s service`);
      assert.equal(onScreen(native), `${textOf[lastOut].title} | ${textOf[lastOut].body}`);
      release[lastOut]();
      await settle();
      const calls = native.calls();
      assert.deepEqual(
        calls.filter((call) => call.startsWith('start')),
        [`start ${textOf[first].title} | ${textOf[first].body} | null | null`],
      );
      assert.deepEqual(calls.filter((call) => call === 'stop'), ['stop']);
      assert.equal(calls.at(-1), 'stop', 'nothing is shown after the last release');
      assert.equal(isActivityServiceRunning(), false);
    });
  }
}

test('a pause while a workout also holds the service moves the clock on the one notification', async () => {
  const native = new FakeNative();
  const host = createActivityServiceHost(native);
  const releaseWorkout = holdServiceForWorkout(host.starter('workout'));
  await settle();
  const treadmill = walk({ type: { id: 'treadmill', label: 'Treadmill', isDistanceBased: false } as ActivitySession['type'] });
  host.notify('activity', activityServiceNotification(treadmill));
  const stopActivity = runActivityService(host.starter('activity'), TREADMILL, () => {});
  await settle();
  const paused = { ...treadmill, pauseStartMs: START + 5_000 };
  host.notify('activity', activityServiceNotification(paused));
  host.notify('activity', activityServiceNotification(paused));
  // Resumed after 25 s: the clock counts from 25 s later than the start, plus the 5 s paused earlier.
  host.notify('activity', activityServiceNotification({ ...treadmill, pausedMs: 30_000 }));
  stopActivity();
  host.notify('activity', null);
  await settle();
  assert.equal(native.calls().includes('stop'), false, "the activity's end leaves the workout's service");
  releaseWorkout();
  await settle();
  assert.deepEqual(native.calls(), [
    `start ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`,
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | null`,
    `show TrainingAI · Activity | Tracking your treadmill | ${START} | 5000`,
    `show TrainingAI · Activity | Tracking your treadmill | ${START + 30_000} | null`,
    `show ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`,
    'stop',
  ]);
});

test("a workout letting go while a GPS walk's clock is on its notification: the stop lands before the plain clock", async () => {
  const native = new FakeNative();
  const host = createActivityServiceHost(native);
  host.notify('activity', activityServiceNotification(walk()));
  await settle();
  const releaseWorkout = holdServiceForWorkout(host.starter('workout'));
  await settle();
  releaseWorkout();
  await settle();
  host.notify('activity', null);
  await settle();
  assert.deepEqual(native.calls(), [
    `show TrainingAI · Activity | Tracking your walk | ${START} | null`,
    // The walk's clock has priority, so the service starts with it.
    `start TrainingAI · Activity | Tracking your walk | ${START} | null`,
    'stop',
    `show TrainingAI · Activity | Tracking your walk | ${START} | null`,
    'clear',
  ]);
});

for (const answer of ['on', 'failed'] as const) {
  test(`two holds that arrive while Android is answering share its one answer (${answer})`, async () => {
    const native = new FakeNative('manual');
    const host = createActivityServiceHost(native);
    const workout = host.starter('workout').start({ notification: WORKOUT_STRAP_NOTIFICATION });
    const activity = host.starter('activity').start({ notification: TREADMILL });
    await settle();
    native.reply(answer);
    const [w, a] = await Promise.all([workout, activity]);
    assert.equal(w.result, answer);
    assert.equal(a.result, answer);
    await settle();
    const start = `start ${WORKOUT_STRAP_NOTIFICATION.title} | ${WORKOUT_STRAP_NOTIFICATION.body} | null | null`;
    if (w.result === 'on' && a.result === 'on') {
      assert.deepEqual(native.calls(), [start, `show ${TREADMILL.title} | ${TREADMILL.body} | null | null`]);
      await w.stop();
      assert.equal(native.calls().includes('stop'), false);
      await a.stop();
      assert.equal(native.calls().at(-1), 'stop');
    } else {
      assert.deepEqual(native.calls(), [start], 'a refusal answers both and leaves nothing on screen');
      holdServiceForWorkout(host.starter('workout'));
      await settle();
      assert.equal(native.calls().filter((call) => call.startsWith('start')).length, 2, 'the next hold asks again');
    }
  });
}

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

// #3632: StrapProvider's effect, driven as React drives it: one hold per (workout id, start time),
// cleaned up when that changes, and the cutoff timer marking the workout aged out.
function strapProvider(host: ReturnType<typeof createActivityServiceHost>) {
  let agedOut: string | null = null;
  let effect: { key: string; cleanup: () => void } | null = null;
  let state = { signedIn: true, openWorkout: null as { id: string; status: string; startedAt: number } | null, strapPaired: true };
  const render = () => {
    const workout = workoutToHold({ ...state, agedOut, now: Date.now() });
    const key = workout ? `${workout.id}:${workout.startedAt}` : '';
    if (effect?.key === key) return;
    effect?.cleanup();
    effect = null;
    if (workout) {
      const cleanup = holdWorkoutServiceUntilCutoff(host.starter('workout'), workout, (id) => {
        agedOut = id;
        render();
      });
      effect = { key, cleanup };
    }
  };
  return {
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      render();
    },
  };
}

test("StrapProvider's hold follows the strap, the account and the workout, one start per change", async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  try {
    const native = new FakeNative();
    const provider = strapProvider(createActivityServiceHost(native));
    const workout = { id: 'w1', status: 'active', startedAt: START };
    provider.set({ openWorkout: workout });
    await settle();
    provider.set({ openWorkout: { ...workout } }); // a new journal object for the same workout
    await settle();
    provider.set({ strapPaired: false });
    await settle();
    provider.set({ strapPaired: true });
    await settle();
    provider.set({ signedIn: false, openWorkout: null });
    await settle();
    assert.deepEqual(
      native.calls().map((call) => call.split(' ')[0]),
      ['start', 'stop', 'start', 'stop'],
      'unpairing lets go, re-pairing holds again, sign-out lets go',
    );
  } finally {
    mock.timers.reset();
  }
});

test("StrapProvider's hold lets go at the cutoff, and the same workout is not held again", async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START + 60_000 });
  try {
    const native = new FakeNative();
    const provider = strapProvider(createActivityServiceHost(native));
    const workout = { id: 'w1', status: 'active', startedAt: START };
    provider.set({ openWorkout: workout });
    await settle();
    mock.timers.tick(WORKOUT_HOLD_MAX_AGE_MS - 60_000 - 1);
    await settle();
    assert.equal(native.calls().includes('stop'), false, 'held until the cutoff');
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(native.calls().map((call) => call.split(' ')[0]), ['start', 'stop']);
    // A re-render (the strap re-pairing, say) does not hold the aged-out workout again.
    provider.set({ strapPaired: false });
    provider.set({ strapPaired: true });
    await settle();
    assert.equal(native.calls().filter((call) => call.startsWith('start')).length, 1);
    // The next workout is held as usual.
    provider.set({ openWorkout: { id: 'w2', status: 'active', startedAt: Date.now() } });
    await settle();
    assert.equal(native.calls().filter((call) => call.startsWith('start')).length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a workout reopened past the cutoff is never held', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START + WORKOUT_HOLD_MAX_AGE_MS });
  try {
    const native = new FakeNative();
    const provider = strapProvider(createActivityServiceHost(native));
    provider.set({ openWorkout: { id: 'w1', status: 'active', startedAt: START } });
    await settle();
    assert.deepEqual(native.calls(), []);
  } finally {
    mock.timers.reset();
  }
});
