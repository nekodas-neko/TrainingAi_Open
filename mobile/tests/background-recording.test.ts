import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityStore, ROUTE_CHECKPOINT_MS, liveRouteReadout } from '../src/features/activities/data/ActivityStore.ts';
import {
  BACKGROUND_FAILED_NOTICE,
  backgroundNotification,
  isActivityServiceRunning,
  runActivityService,
  runBackgroundRecording,
  type ActivityServiceStarter,
  type BackgroundRecorder,
  type BackgroundState,
  type BackgroundStarted,
} from '../src/features/activities/data/background-recording.ts';
import {
  BACKGROUND_LOCATION_TASK,
  deliverBackgroundLocations,
  setBackgroundFixSink,
} from '../src/integrations/location/background-fixes.ts';
import {
  GPS_LOST_AFTER_MS,
  ROUTE_CLOCK_TICK_MS,
  activityServiceKind,
  activityServiceNotice,
  gpsStatus,
  runServiceRecording,
  type RouteWatchState,
} from '../src/features/activities/data/route-recording.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const timezone = 'Australia/Brisbane';
const run = { id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: true };
const id = '20000000-0000-4000-8000-000000000002';
const midday = Date.parse('2026-10-12T12:00:00+10:00');
const origin = { lat: -27.47, lng: 153.02 };
const metresNorth = (metres: number) => origin.lat + metres / 111_195;
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A recorder standing in for the Android service: the test decides the answer and pushes the
// fixes Android would deliver to the task.
class FakeService implements BackgroundRecorder {
  starts = 0;
  stops = 0;
  options: Parameters<BackgroundRecorder['start']>[0] | null = null;
  private release: ((started: BackgroundStarted) => void) | null = null;
  constructor(private answer: 'on' | 'failed' | 'skipped' | 'wait' = 'on') {}
  start(options: Parameters<BackgroundRecorder['start']>[0]) {
    this.starts++;
    this.options = options;
    if (this.answer === 'wait') {
      return new Promise<BackgroundStarted>((resolve) => (this.release = resolve));
    }
    if (this.answer !== 'on') {
      return Promise.resolve<BackgroundStarted>({ result: this.answer });
    }
    return Promise.resolve<BackgroundStarted>({ result: 'on', stop: this.stopped });
  }
  stopped = async () => {
    this.stops++;
  };
  answerNow(started: BackgroundStarted) {
    this.release?.(started);
  }
}

function fixture() {
  const values = new Map<string, string>();
  let now = midday;
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone,
    get: async () => ({ activityLogs: [] }),
    post: async () => ({ processed: 1, errors: [] }),
  };
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
  const stores: ActivityStore[] = [];
  const create = () => {
    const store = new ActivityStore(storage, connection, () => id, () => {}, () => now);
    stores.push(store);
    return store;
  };
  return {
    create,
    advance: (ms: number) => void (now += ms),
    now: () => now,
    done: () => stores.forEach((store) => store.cancel()),
  };
}

async function begun(f: ReturnType<typeof fixture>) {
  const store = f.create();
  await store.initialize();
  await store.start(run);
  await store.begin();
  return store;
}

const states = () => {
  const seen: BackgroundState[] = [];
  return { seen, on: (state: BackgroundState) => seen.push(state) };
};

test('the service starts with the activity, names it, and stops when it ends or is discarded', async () => {
  const f = fixture(),
    store = await begun(f),
    service = new FakeService('on'),
    log = states();
  const session = store.getSnapshot().session!;
  assert.deepEqual(backgroundNotification(session), {
    title: 'TrainingAI · Activity',
    body: 'Tracking your run',
  });
  assert.equal(isActivityServiceRunning(), false);
  const stop = runBackgroundRecording(service, store, backgroundNotification(session), log.on);
  await settle();
  assert.deepEqual(log.seen, ['pending', 'on']);
  assert.equal(service.starts, 1);
  assert.equal(service.options?.notification.body, 'Tracking your run');
  assert.equal(isActivityServiceRunning(), true, 'the strap hold can see the service is up');
  // The hook stops it when the session goes (finish or discard); once, however often it is called.
  stop();
  stop();
  await settle();
  assert.equal(service.stops, 1);
  assert.equal(isActivityServiceRunning(), false);
  f.done();
});

test('a guided walk is named as one', () => {
  assert.equal(
    backgroundNotification({ type: { label: 'Walk' }, guidance: { kind: 'walk' } }).body,
    'Tracking your guided walk',
  );
});

test('ending the activity while the permission question is open stops the service as soon as it is up', async () => {
  const f = fixture(),
    store = await begun(f),
    service = new FakeService('wait'),
    log = states();
  const stop = runBackgroundRecording(service, store, backgroundNotification(store.getSnapshot().session!), log.on);
  stop();
  service.answerNow({ result: 'on', stop: service.stopped });
  await settle();
  assert.equal(service.stops, 1);
  assert.equal(isActivityServiceRunning(), false);
  assert.deepEqual(log.seen, ['pending'], 'a cancelled start never reports on');
  f.done();
});

test('a service Android refuses leaves screen-on recording and says so; nothing to start says nothing', async () => {
  for (const answer of ['failed', 'skipped'] as const) {
    const f = fixture(),
      store = await begun(f),
      log = states();
    runBackgroundRecording(new FakeService(answer), store, backgroundNotification(store.getSnapshot().session!), log.on);
    await settle();
    assert.deepEqual(log.seen, ['pending', answer]);
    assert.equal(isActivityServiceRunning(), false);
    // The store still takes fixes from the screen-on watcher.
    assert.equal(store.appendFix({ ...origin, t: f.now() }), true);
    f.done();
  }
  assert.equal(BACKGROUND_FAILED_NOTICE, 'Recording continues only while the screen is on.');
});

test('a start that throws falls back rather than failing the activity', async () => {
  const f = fixture(),
    store = await begun(f),
    log = states(),
    broken: BackgroundRecorder = { start: () => Promise.reject(new Error('no service')) };
  runBackgroundRecording(broken, store, backgroundNotification(store.getSnapshot().session!), log.on);
  await settle();
  assert.deepEqual(log.seen, ['pending', 'failed']);
  f.done();
});

test('fixes delivered while the app is backgrounded reach the checkpoint, and survive a kill', async () => {
  const f = fixture(),
    store = await begun(f);
  // The recorder points the task's sink at the store, as the Android recorder does.
  setBackgroundFixSink((point) => store.appendFix(point));
  const walk = (from: number, count: number) => {
    // Android hands the task a batch every few seconds, the screen off and no React state moving.
    for (let step = from; step < from + count; step += 2) {
      f.advance(6000);
      deliverBackgroundLocations([
        { coords: { latitude: metresNorth((step + 1) * 10), longitude: origin.lng, altitude: 21 }, timestamp: f.now() },
        { coords: { latitude: metresNorth(step * 10), longitude: origin.lng, altitude: 20 }, timestamp: f.now() - 3000 },
      ]);
    }
  };
  walk(0, 10);
  await settle();
  assert.equal(store.getSnapshot().route.length, 10, 'a batch is delivered oldest first and every fix kept');
  assert.ok(store.getSnapshot().route.every((p, i, all) => i === 0 || p.t > all[i - 1].t));
  // The checkpoint timer fires with no screen: wait out the interval, as the phone's clock would.
  f.advance(ROUTE_CHECKPOINT_MS);
  walk(10, 2);
  await store.checkpoint();
  store.cancel(); // process killed: no pause, no foreground write
  setBackgroundFixSink(null);
  const reopened = f.create();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().session?.mode, 'active');
  assert.equal(reopened.getSnapshot().route.length, 12, 'nothing recorded while locked is lost');
  f.done();
});

test('fixes arriving with no activity open are dropped, and the task has a name', () => {
  setBackgroundFixSink(null);
  assert.equal(
    deliverBackgroundLocations([{ coords: { latitude: 1, longitude: 1, altitude: null }, timestamp: 1 }]),
    0,
  );
  assert.equal(BACKGROUND_LOCATION_TASK, 'trainingai-activity-location');
});

test('the GPS status and live pace follow the service\'s fixes while the screen-on watcher is down', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: midday });
  try {
    const f = fixture(),
      store = await begun(f),
      service = new FakeService('on');
    // What the hook holds: the watch state from before Start, and the clock the store uses.
    let watch: RouteWatchState = { problem: null, lastFixMs: null, now: Date.now() };
    const stop = runServiceRecording(
      service,
      store,
      backgroundNotification(store.getSnapshot().session!),
      () => {},
      (next) => (watch = next),
      f.now,
    );
    await settle();
    const readout = () => {
      const { session, route } = store.getSnapshot();
      return {
        status: gpsStatus({
          problem: watch.problem,
          paused: session!.pauseStartMs != null,
          points: route.length,
          lastFixMs: watch.lastFixMs,
          now: watch.now,
        }),
        stats: liveRouteReadout(session!, route, watch.now),
      };
    };
    // Ten minutes, a fix every five seconds, 0.95 km.
    for (let i = 1; i <= 120; i++) {
      f.advance(5000);
      mock.timers.tick(5000);
      service.options!.fix({ lat: metresNorth((950 * i) / 120), lng: origin.lng, t: f.now() });
    }
    const live = readout();
    assert.equal(live.status, 'tracking');
    assert.ok(Math.abs(live.stats.distanceKm! - 0.95) < 0.02);
    assert.ok(live.stats.paceSecPerKm! > 600 && live.stats.paceSecPerKm! < 720, `pace ${live.stats.paceSecPerKm}`);
    // The service goes quiet: the tick alone moves the clock, so the lost-signal state can show.
    const quietFor = GPS_LOST_AFTER_MS + 5000;
    f.advance(quietFor);
    mock.timers.tick(quietFor);
    assert.equal(readout().status, 'lost');
    stop();
    f.done();
  } finally {
    mock.timers.reset();
  }
});

for (const answer of ['failed', 'skipped'] as const) {
  test(`the service feed stops driving the watch state once the service is ${answer}`, async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: midday });
    try {
      const f = fixture(),
        store = await begun(f),
        service = new FakeService(answer),
        states: BackgroundState[] = [];
      let watchCalls = 0;
      const stop = runServiceRecording(
        service,
        store,
        backgroundNotification(store.getSnapshot().session!),
        (state) => states.push(state),
        () => watchCalls++,
        f.now,
      );
      await settle();
      assert.ok(states.includes(answer));
      const before = watchCalls;
      mock.timers.tick(ROUTE_CLOCK_TICK_MS * 3);
      assert.equal(watchCalls, before, 'the screen-on watcher is the only writer now');
      stop();
      f.done();
    } finally {
      mock.timers.reset();
    }
  });
}

test('the service feed keeps driving the watch state while the service is on', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: midday });
  try {
    const f = fixture(),
      store = await begun(f),
      service = new FakeService('on');
    let watchCalls = 0;
    const stop = runServiceRecording(
      service,
      store,
      backgroundNotification(store.getSnapshot().session!),
      () => {},
      () => watchCalls++,
      f.now,
    );
    await settle();
    mock.timers.tick(ROUTE_CLOCK_TICK_MS);
    assert.equal(watchCalls, 1, 'the clock tick still publishes');
    service.options!.fix({ lat: origin.lat, lng: origin.lng, t: f.now() });
    assert.equal(watchCalls, 2, 'a fix still feeds the watch');
    stop();
    f.done();
  } finally {
    mock.timers.reset();
  }
});

// #3595: a treadmill walk or other indoor activity runs the connected-device service, so the
// strap's link survives the background; a GPS recording keeps the location service.
const treadmill = { isDistanceBased: false };
const outdoor = { isDistanceBased: true };
const strap = { strapPaired: true, locationSkipped: false };

test('a GPS recording runs the location service; anything else with a strap runs the indoor one', () => {
  assert.equal(activityServiceKind({ mode: 'active', type: outdoor }, strap), 'location');
  assert.equal(activityServiceKind({ mode: 'active', type: outdoor, guidance: { kind: 'walk' } }, strap), 'location');
  assert.equal(
    activityServiceKind({ mode: 'active', type: outdoor }, { ...strap, strapPaired: false }),
    'location',
    'a GPS recording needs no strap for its service',
  );
  // A treadmill walk starts with isDistanceBased false; the plain Treadmill activity too.
  assert.equal(activityServiceKind({ mode: 'active', type: treadmill, guidance: { kind: 'walk' } }, strap), 'connected-device');
  assert.equal(activityServiceKind({ mode: 'active', type: treadmill }, strap), 'connected-device');
  // A fitness test is distance based but records no route.
  assert.equal(activityServiceKind({ mode: 'active', type: outdoor, guidance: { kind: 'test' } }, strap), 'connected-device');
});

test('no strap and no GPS starts nothing; nor does an activity that is not running', () => {
  assert.equal(activityServiceKind({ mode: 'active', type: treadmill }, { ...strap, strapPaired: false }), null);
  for (const mode of ['pre', 'done']) {
    assert.equal(activityServiceKind({ mode, type: outdoor }, strap), null);
    assert.equal(activityServiceKind({ mode, type: treadmill }, strap), null);
  }
});

test('a GPS recording whose location service had nothing to start falls back to the indoor one', () => {
  assert.equal(activityServiceKind({ mode: 'active', type: outdoor }, { ...strap, locationSkipped: true }), 'connected-device');
  assert.equal(
    activityServiceKind({ mode: 'active', type: outdoor }, { strapPaired: false, locationSkipped: true }),
    null,
  );
});

class FakeIndoor implements ActivityServiceStarter {
  stops = 0;
  notifications: string[] = [];
  constructor(private answer: 'on' | 'failed' | 'skipped') {}
  start({ notification }: { notification: { title: string; body: string } }) {
    this.notifications.push(notification.body);
    return Promise.resolve<BackgroundStarted>(
      this.answer === 'on' ? { result: 'on', stop: async () => void this.stops++ } : { result: this.answer },
    );
  }
}

test('the indoor service tells the strap hold it is up, and stops once when the activity ends', async () => {
  const service = new FakeIndoor('on'),
    log = states();
  const stop = runActivityService(
    service,
    backgroundNotification({ type: { label: 'Treadmill' } }),
    log.on,
  );
  await settle();
  assert.deepEqual(log.seen, ['pending', 'on']);
  assert.deepEqual(service.notifications, ['Tracking your treadmill']);
  assert.equal(isActivityServiceRunning(), true);
  stop();
  stop();
  await settle();
  assert.equal(service.stops, 1);
  assert.equal(isActivityServiceRunning(), false);
});

test('an indoor service Android refuses shows the screen-on notice; one with nothing to start does not', async () => {
  for (const answer of ['failed', 'skipped'] as const) {
    const log = states();
    runActivityService(new FakeIndoor(answer), backgroundNotification({ type: { label: 'Treadmill' } }), log.on);
    await settle();
    assert.deepEqual(log.seen, ['pending', answer]);
    assert.equal(isActivityServiceRunning(), false);
    assert.equal(
      activityServiceNotice('connected-device', { location: 'off', 'connected-device': answer }),
      answer === 'failed' ? BACKGROUND_FAILED_NOTICE : null,
    );
  }
  // The GPS notice is unchanged, and a running or absent service says nothing.
  assert.equal(activityServiceNotice('location', { location: 'failed', 'connected-device': 'off' }), BACKGROUND_FAILED_NOTICE);
  assert.equal(activityServiceNotice('location', { location: 'off', 'connected-device': 'failed' }), null);
  assert.equal(activityServiceNotice('connected-device', { location: 'off', 'connected-device': 'on' }), null);
  assert.equal(activityServiceNotice(null, { location: 'failed', 'connected-device': 'failed' }), null);
});
