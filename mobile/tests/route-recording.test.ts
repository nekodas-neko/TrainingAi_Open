import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRoute } from '@trainingai/shared/activity/route-encoding';
import { haversineDistanceKm } from '@trainingai/shared/activity/route-metrics';
import {
  ActivityStore,
  ROUTE_CHECKPOINT_MS,
  liveRouteReadout,
  sessionPayload,
} from '../src/features/activities/data/ActivityStore.ts';
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log';
import { MAX_PACE_SEC_PER_KM } from '@trainingai/shared/validation/plausibility';
import {
  GPS_LOST_AFTER_MS,
  gpsStatus,
  keepsFix,
  liveRouteStats,
  type LocationProblem,
  type LocationSource,
  type RoutePoint,
} from '../src/features/activities/data/route-recording.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const timezone = 'Australia/Brisbane';
const run = { id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: true };
const id = '20000000-0000-4000-8000-000000000001';
// Local midday, so no window edge or date boundary is anywhere near the recording.
const midday = Date.parse('2026-10-12T12:00:00+10:00');
const origin = { lat: -27.47, lng: 153.02 };
// One step north of `origin` per metre, at 0.001 km per 0.0000089932° of latitude.
const metresNorth = (metres: number) => origin.lat + metres / 111_195;

// The location adapter as the screen uses it, with fixes and problems pushed by the test.
class FakeLocation implements LocationSource {
  private handlers: Parameters<LocationSource['watch']>[0] | null = null;
  stopped = 0;
  constructor(private refuse: LocationProblem | null = null) {}
  async watch(handlers: Parameters<LocationSource['watch']>[0]) {
    if (this.refuse) {
      handlers.problem(this.refuse);
      return () => {};
    }
    this.handlers = handlers;
    return () => {
      this.handlers = null;
      this.stopped++;
    };
  }
  fix(point: RoutePoint) {
    this.handlers?.fix(point);
  }
}

function fixture() {
  const values = new Map<string, string>();
  const server = new Map<string, Record<string, unknown>>();
  let now = midday,
    online = false,
    posts = 0;
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone,
    get: async () => ({ activityLogs: [...server.values()] }),
    post: async (_, body) => {
      posts++;
      if (!online) {
        throw new Error('Offline');
      }
      const change = (body as { mutations: { payload: Record<string, unknown> }[] }).mutations[0];
      // Through the database and back: JSONB and double precision as sent, and the start and
      // end times as Postgres `time` columns return them, with seconds.
      const stored = JSON.parse(JSON.stringify(change.payload));
      for (const field of ['startTime', 'endTime']) {
        if (stored[field]) {
          stored[field] = `${stored[field]}:00`;
        }
      }
      server.set(String(change.payload.id), stored);
      return { processed: 1, errors: [] };
    },
  };
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const stores: ActivityStore[] = [];
  const create = () => {
    const store = new ActivityStore(
      storage,
      connection,
      () => id,
      () => {},
      () => now,
    );
    stores.push(store);
    return store;
  };
  // Starts watching the way `useRouteRecording` does: every fix goes to the store.
  const watch = (store: ActivityStore, source: FakeLocation) => {
    const problems: LocationProblem[] = [];
    const stop = source.watch({
      fix: (point) => store.appendFix(point),
      problem: (problem) => problems.push(problem),
    });
    return { stop, problems };
  };
  return {
    create,
    watch,
    values,
    server,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    online: (value = true) => {
      online = value;
    },
    posts: () => posts,
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

// A fix every 2 s, 10 m further north, climbing 1 m each: 5 m/s, 3:20 per km.
function walkNorth(
  f: ReturnType<typeof fixture>,
  source: FakeLocation,
  from: number,
  count: number,
) {
  for (let step = from; step < from + count; step++) {
    f.advance(2000);
    source.fix({ lat: metresNorth(step * 10), lng: origin.lng, ele: 20 + step, t: f.now() });
  }
}

test('distance, pace, splits and elevation come from the recorded track', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  walkNorth(f, source, 0, 251);
  const track = store.getSnapshot().route;
  assert.equal(track.length, 251);
  const expectedKm = haversineDistanceKm(track[0], track.at(-1)!);
  const live = liveRouteStats(track, 500);
  assert.ok(Math.abs(live.distanceKm! - expectedKm) < 1e-9);
  assert.equal(live.paceSecPerKm, Math.round(500 / expectedKm));
  assert.deepEqual(
    live.splits.map((split) => split.km),
    [1, 2],
  );
  await store.finish();
  const payload = sessionPayload(store.getSnapshot().session!, timezone, track);
  assert.equal(payload.distanceKm, Math.round(expectedKm * 100) / 100);
  // The current app's denominator: the span from the first fix to the last.
  assert.equal(payload.avgPaceSecPerKm, Math.round(500 / expectedKm));
  assert.equal(payload.elevationGainM, 250);
  assert.equal(payload.elevationLossM, 0);
  assert.equal(payload.splits!.length, 2);
  assert.ok(payload.splits!.every((split) => Math.abs(split.paceSec - 200) <= 1));
  assert.ok(payload.paceSeries!.length > 0);
  // A straight line simplifies to its two ends.
  const line = decodeRoute(payload.routePolyline!);
  assert.equal(line.length, 2);
  assert.ok(Math.abs(line[1].lat - track.at(-1)!.lat) < 1e-5);
  f.done();
});

test('standing still keeps GPS jitter out of the distance, and paused fixes are not recorded', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  source.fix({ ...origin, t: f.now() });
  for (let n = 1; n <= 20; n++) {
    f.advance(3000);
    // Two metres either side of the first fix: what a phone reports from one spot.
    source.fix({ lat: metresNorth(n % 2 ? 2 : -2), lng: origin.lng, t: f.now() });
  }
  assert.equal(store.getSnapshot().route.length, 1);
  assert.equal(liveRouteStats(store.getSnapshot().route, 60).distanceKm, 0);
  assert.equal(
    keepsFix(store.getSnapshot().route[0], {
      lat: metresNorth(6),
      lng: origin.lng,
      t: f.now() + 1,
    }),
    true,
  );
  await store.pause();
  f.advance(3000);
  assert.equal(store.appendFix({ lat: metresNorth(100), lng: origin.lng, t: f.now() }), false);
  assert.equal(store.getSnapshot().route.length, 1);
  f.done();
});

test('a killed recording resumes from its last checkpoint and saves the whole route', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  // 12 s of fixes: the first is written at once, the rest at the next checkpoint.
  walkNorth(f, source, 0, 6);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().route.length, 6);
  // The app is killed here, without a pause or a background write.
  store.cancel();
  const reopened = f.create();
  await reopened.initialize();
  const kept = reopened.getSnapshot().route;
  assert.equal(reopened.getSnapshot().session?.mode, 'active');
  // Nothing older than one checkpoint interval is lost.
  assert.ok(kept.length >= 6 - ROUTE_CHECKPOINT_MS / 2000, `kept ${kept.length}`);
  assert.deepEqual(kept, store.getSnapshot().route.slice(0, kept.length));
  // The watcher starts again on the reopened screen and the walk carries on.
  const again = new FakeLocation();
  f.watch(reopened, again);
  walkNorth(f, again, 6, 50);
  await reopened.finish();
  // A second kill after finishing still has every point: finish writes the route.
  reopened.cancel();
  const afterRestart = f.create();
  await afterRestart.initialize();
  const route = afterRestart.getSnapshot().route;
  assert.equal(afterRestart.getSnapshot().session?.mode, 'done');
  assert.equal(route.length, kept.length + 50);
  await afterRestart.save(timezone);
  const row = afterRestart.getSnapshot().rows[0].payload;
  assert.equal(
    row.distanceKm,
    Math.round(haversineDistanceKm(route[0], route.at(-1)!) * 100) / 100,
  );
  // Saving clears the route, so the next recording starts empty.
  assert.equal(f.values.has('activities.route.v1'), false);
  assert.deepEqual(afterRestart.getSnapshot().route, []);
  f.done();
});

test('a route left by another recording is never attached to a new one', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  walkNorth(f, source, 0, 3);
  await store.checkpoint();
  await store.discard();
  assert.equal(f.values.has('activities.route.v1'), false);
  // Leftovers from a kill between the save and the clear.
  const next = await begun(f);
  f.values.set(
    'activities.route.v1',
    JSON.stringify({
      version: 1,
      origin: 'https://example.com',
      userId: 'one',
      startMs: midday - 3_600_000,
      points: [{ ...origin, t: midday - 3_600_000 }],
    }),
  );
  next.cancel();
  const reopened = f.create();
  await reopened.initialize();
  assert.deepEqual(reopened.getSnapshot().route, []);
  assert.equal(f.values.has('activities.route.v1'), false);
  f.done();
});

test('permission denied, approximate only and location off record time only, never 0 km', async () => {
  for (const problem of ['denied', 'approximate', 'disabled'] as const) {
    const f = fixture(),
      store = await begun(f);
    const watched = f.watch(store, new FakeLocation(problem));
    await watched.stop;
    assert.deepEqual(watched.problems, [problem]);
    const status = gpsStatus({
      problem: watched.problems[0],
      paused: false,
      points: 0,
      lastFixMs: null,
      now: f.now(),
    });
    assert.equal(status, problem);
    assert.equal(liveRouteStats([], 60).distanceKm, null);
    f.advance(600_000);
    await store.finish();
    await store.save(timezone);
    const row = store.getSnapshot().rows[0].payload;
    assert.equal(row.durationMin, 10);
    assert.equal(row.distanceKm, undefined);
    assert.equal(row.routePolyline, undefined);
    assert.equal(row.avgPaceSecPerKm, undefined);
    f.done();
  }
});

test('no fix yet reads as searching; one fix and no movement is a real zero', () => {
  const base = { problem: null, paused: false, now: midday };
  assert.equal(gpsStatus({ ...base, points: 0, lastFixMs: null }), 'searching');
  assert.equal(liveRouteStats([], 120).distanceKm, null);
  assert.equal(liveRouteStats([], 120).paceSecPerKm, null);
  assert.equal(gpsStatus({ ...base, points: 1, lastFixMs: midday - 1000 }), 'tracking');
  const still = liveRouteStats([{ ...origin, t: midday }], 120);
  assert.equal(still.distanceKm, 0);
  assert.equal(still.paceSecPerKm, null);
  // Points kept from before a kill, and no fix since the reopen, is still waiting for GPS.
  assert.equal(gpsStatus({ ...base, points: 40, lastFixMs: null }), 'searching');
  assert.equal(
    gpsStatus({ ...base, points: 40, lastFixMs: midday - GPS_LOST_AFTER_MS - 1 }),
    'lost',
  );
  assert.equal(gpsStatus({ ...base, paused: true, points: 0, lastFixMs: null }), 'paused');
  assert.equal(gpsStatus({ ...base, problem: 'denied', points: 0, lastFixMs: null }), 'denied');
});

test('a single fix saves no distance rather than 0 km', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  source.fix({ ...origin, t: f.now() });
  f.advance(120_000);
  await store.finish();
  await store.save(timezone);
  const row = store.getSnapshot().rows[0].payload;
  assert.equal(row.distanceKm, undefined);
  assert.equal(row.routePolyline, undefined);
  f.done();
});

test('the route waits in the outbox offline and uploads with every field on retry', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  walkNorth(f, source, 0, 120);
  await store.finish();
  await store.save(timezone);
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].pending, true);
  assert.ok(f.posts() >= 1);
  assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
  // Still queued after a restart while offline.
  store.cancel();
  const reopened = f.create();
  await reopened.initialize();
  await reopened.sync();
  const queued = reopened.getSnapshot().rows[0];
  assert.equal(queued.pending, true);
  assert.ok(queued.payload.routePolyline);
  f.online();
  await reopened.sync();
  const saved = reopened.getSnapshot().rows[0];
  assert.equal(saved.pending, false);
  const stored = f.server.get(id)!;
  for (const field of [
    'distanceKm',
    'routePolyline',
    'splits',
    'bestEfforts',
    'paceSeries',
    'avgPaceSecPerKm',
    'elevationGainM',
    'elevationLossM',
    'elevationProfile',
  ] as const) {
    assert.notEqual(stored[field], undefined, field);
    assert.deepEqual(stored[field], JSON.parse(JSON.stringify(saved.payload[field])), field);
  }
  f.done();
});

test('a guided walk saves its route with pace over the walk time', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = f.create();
  await store.initialize();
  await store.start(
    { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: true },
    {
      kind: 'walk',
      saved: false,
      config: {
        sets: 1,
        fastSec: 120,
        slowSec: 120,
        warmupSec: 0,
        cooldownSec: 0,
        treadmill: false,
        fastCadenceSpm: 120,
        slowCadenceSpm: 95,
      },
    },
  );
  await store.begin();
  f.watch(store, source);
  // 100 fixes over 200 s, then the walk runs to its planned 240 s with no more fixes.
  walkNorth(f, source, 0, 100);
  f.advance(40_000);
  await store.finishGuided();
  await store.saveWalk(timezone);
  const row = store.getSnapshot().rows[0].payload;
  const route = store.getSnapshot().route;
  const km = haversineDistanceKm(route[0], route.at(-1)!);
  assert.equal(row.distanceKm, Math.round(km * 100) / 100);
  assert.equal(row.avgPaceSecPerKm, Math.round(240 / km));
  assert.ok(row.routePolyline);
  f.done();
});

// #3093 review: a pace bucket or split spanning a pause or a stop covers a few metres and reads as
// hours per km, which the save schema rejects. These tracks are the ones real activities produce.
const walkConfig = {
  sets: 1,
  fastSec: 120,
  slowSec: 120,
  warmupSec: 0,
  cooldownSec: 0,
  treadmill: false,
  fastCadenceSpm: 120,
  slowCadenceSpm: 95,
};
async function guidedWalk(f: ReturnType<typeof fixture>) {
  const store = f.create();
  await store.initialize();
  await store.start(
    { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: true },
    { kind: 'walk', saved: false, config: walkConfig },
  );
  await store.begin();
  return store;
}
// `metres` further north every 2 s, starting `from` metres up.
function moveNorth(
  f: ReturnType<typeof fixture>,
  source: FakeLocation,
  from: number,
  count: number,
  metres: number,
) {
  for (let step = 1; step <= count; step++) {
    f.advance(2000);
    source.fix({ lat: metresNorth(from + step * metres), lng: origin.lng, t: f.now() });
  }
  return from + count * metres;
}
function withinSchemaPaces(row: {
  splits?: { paceSec: number }[];
  paceSeries?: { paceSec: number }[];
}) {
  return [...(row.splits ?? []), ...(row.paceSeries ?? [])].every(
    (point) => point.paceSec <= MAX_PACE_SEC_PER_KM,
  );
}

test('a run with a pause saves, and live pace after resuming is not 0:00', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await begun(f);
  f.watch(store, source);
  // 10 km/h: 5.6 m every 2 s, for 3 minutes. The pause starts on a 30 s pace bucket's boundary,
  // so the next bucket is the few metres either side of the pause.
  let at = moveNorth(f, source, 0, 91, 5.6);
  await store.pause();
  f.advance(120_000);
  await store.pause();
  // Straight after resuming, before any new fix: distance over the active time so far.
  const resumed = liveRouteReadout(
    store.getSnapshot().session!,
    store.getSnapshot().route,
    f.now(),
  );
  assert.ok(resumed.paceSecPerKm! > 300 && resumed.paceSecPerKm! < 400, `${resumed.paceSecPerKm}`);
  at = moveNorth(f, source, at, 90, 5.6);
  const live = liveRouteReadout(store.getSnapshot().session!, store.getSnapshot().route, f.now());
  assert.equal(live.paceSecPerKm, Math.round(362 / live.distanceKm!));
  await store.finish();
  await store.save(timezone);
  const row = store.getSnapshot().rows[0].payload;
  assert.ok(row.distanceKm! > 0.9);
  assert.ok(withinSchemaPaces(row));
  assert.equal(ActivityLogBody.safeParse(row).success, true);
  f.done();
});

test('a guided walk with a long stop at a crossing saves', async () => {
  for (const stopAfter of [10, 25, 40, 55]) {
    const f = fixture(),
      source = new FakeLocation(),
      store = await guidedWalk(f);
    f.watch(store, source);
    let at = moveNorth(f, source, 0, stopAfter, 2.8);
    // 90 s standing still: the fixes keep coming, within a metre or two, and are filtered out.
    for (let n = 0; n < 30; n++) {
      f.advance(3000);
      source.fix({ lat: metresNorth(at + (n % 2)), lng: origin.lng, t: f.now() });
    }
    at = moveNorth(f, source, at, 60 - stopAfter, 2.8);
    f.advance(Math.max(0, 240_000 - (f.now() - midday)));
    await store.finishGuided();
    await store.saveWalk(timezone);
    const row = store.getSnapshot().rows[0].payload;
    assert.ok(row.routePolyline, `stop after ${stopAfter}`);
    assert.ok(withinSchemaPaces(row), `stop after ${stopAfter}`);
    f.done();
  }
});

test('a guided walk that lost GPS for most of it saves without an average pace', async () => {
  const f = fixture(),
    source = new FakeLocation(),
    store = await guidedWalk(f);
  f.watch(store, source);
  // 6 m every 2 s for 20 s, then no signal for the rest of the 4-minute walk.
  moveNorth(f, source, 0, 10, 6);
  f.advance(220_000);
  await store.finishGuided();
  await store.saveWalk(timezone);
  const row = store.getSnapshot().rows[0].payload;
  assert.equal(row.distanceKm, 0.05);
  // 240 s over 54 m is 4,400 s/km: not a pace the walker held, so it is left out.
  assert.equal(row.avgPaceSecPerKm, undefined);
  assert.ok(row.routePolyline);
  f.done();
});
