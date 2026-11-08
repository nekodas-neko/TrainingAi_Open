// Batch #190: Preview's guided walk, fitness tests and free activities record what the current app
// records (#3640, #3641, #3647, #3648, #3649, #3655).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sixMwtVo2max, latestTestWeightKg } from '@trainingai/shared/health/fitness-tests';
import { walkHrTargets } from '@trainingai/shared/walking/walk-pacer';
import { ActivityStore, sessionPayload } from '../src/features/activities/data/ActivityStore.ts';
import { defaultWalk, fitnessResult, testProfile } from '../src/features/activities/data/guidance.ts';
import { CadenceLog, pacerHrTargets } from '../src/features/activities/data/walk-pace.ts';
import { hrSamples, type HrWindow } from '../src/features/activities/data/hr-window.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';
import { PlatformStore, migrateCues } from '../src/features/platform/data/PlatformStore.ts';
import { planAlerts } from '../src/features/platform/data/alert-plan.ts';
import { deviceUploadsWaiting } from '../src/features/settings/data/device-uploads.ts';
import { UPLOAD_BATCH } from '../src/features/devices/strap/HrOutbox.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const tz = 'Australia/Brisbane';
// Local midday, so no day boundary is near.
const START = Date.parse('2026-10-12T12:00:00+10:00');
const testId = '20000000-0000-4000-8000-000000000001';
const activityId = '20000000-0000-4000-8000-000000000002';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
}
const offline: AccountConnection = {
  origin: 'https://example.com',
  userId: 'one',
  timezone: tz,
  get: async () => {
    throw new Error('Offline');
  },
  post: async () => {
    throw new Error('Offline');
  },
};
function store(now: { ms: number }) {
  let n = 0;
  return new ActivityStore(
    memoryStorage(),
    offline,
    () => `30000000-0000-4000-8000-00000000000${++n}`,
    () => {},
    () => now.ms,
  );
}
/** One reading a second from `fromMs` for `seconds`, at `bpm(i)`. */
function window(fromMs: number, seconds: number, bpm: (i: number) => number): HrWindow {
  const readings = Array.from({ length: seconds }, (_, i) => ({
    timestamp: new Date(fromMs + i * 1000).toISOString(),
    bpm: bpm(i),
  }));
  const values = readings.map((r) => r.bpm);
  return {
    avgHr: values.reduce((a, b) => a + b, 0) / values.length,
    maxHr: Math.max(...values),
    readings,
  };
}
/** A straight line north, one fix every 5 s at about 1.4 m/s (7 m per fix). */
function route(fromMs: number, seconds: number) {
  return Array.from({ length: Math.floor(seconds / 5) + 1 }, (_, i) => ({
    lat: -27.47 + (i * 7) / 111_195,
    lng: 153.02,
    t: fromMs + i * 5000,
  }));
}
const hz = (spm: number, seconds: number) =>
  Array.from({ length: seconds * 50 }, (_, i) =>
    Math.round(1000 + 300 * Math.sin((2 * Math.PI * (spm / 60) * i) / 50)),
  );
function feedCadence(log: { onBatch: CadenceLog['onBatch'] }, spm: number, seconds: number, fromMs: number) {
  const samples = hz(spm, seconds);
  for (let s = 0; s < seconds; s++)
    log.onBatch({ magnitudes: samples.slice(s * 50, (s + 1) * 50), sampleRate: 50, at: fromMs + (s + 1) * 1000 });
}

// #3640 ----------------------------------------------------------------------------------------

test('a 6MWT on a morning with no weigh-in scores on the full equation from earlier in the week (#3640)', () => {
  const today = '2026-10-12';
  const profile = testProfile({
    today,
    now: new Date(START),
    dateOfBirth: '1986-06-01',
    sex: 'male',
    // No weigh-in today; the last one was three days ago. Today's ring resting HR is not in yet.
    body: { today: { weightKg: null }, latestWeightKg: 80, latestWeightDate: '2026-10-09' },
    hrProfile: { restingHr: 55 },
  });
  assert.equal(profile.weightKg, 80);
  assert.equal(profile.restingHr, 55);
  const session = {
    id: testId,
    startMs: START,
    endMs: START + 360_000,
    distance: '0.65',
    notes: '',
    guidance: {
      kind: 'test' as const,
      protocol: '6mwt' as const,
      activityId,
      countdownUntil: START,
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  };
  const result = fitnessResult(session, tz, profile);
  const full = sixMwtVo2max({ distanceM: 650, age: 40, sex: 'male', weightKg: 80, restingHr: 55 });
  const fallback = sixMwtVo2max({ distanceM: 650, age: 40, sex: 'male', weightKg: null, restingHr: null });
  assert.notEqual(full, fallback);
  assert.equal(result.payload.vo2maxEst, full);
  assert.equal(result.payload.method, 'burr_2011');
});

test('the test weight is the newest weigh-in in the 30 days to today, as the baselines page reads it', () => {
  const today = '2026-10-12';
  assert.equal(
    latestTestWeightKg(
      [
        { date: '2026-10-01', weightKg: 81 },
        { date: '2026/10/09', weightKg: 80 },
        { date: '2026-10-10', weightKg: null },
      ],
      today,
    ),
    80,
  );
  assert.equal(latestTestWeightKg([{ date: '2026-09-01', weightKg: 82 }], today), null, '41 days old');
  assert.equal(
    testProfile({ today, now: new Date(START), body: { latestWeightKg: 82, latestWeightDate: '2026-09-01' } })
      .weightKg,
    null,
  );
});

// #3641 ----------------------------------------------------------------------------------------

const walkType = { id: 'walk', label: 'Interval walk', icon: 'PersonSimpleWalk', isDistanceBased: true };
const walkConfig = { ...defaultWalk, sets: 1, slowSec: 60, fastSec: 60 };

test('a guided walk saves its avg and max HR, and each block its HR, distance, pace and start HR (#3641)', async () => {
  const now = { ms: START };
  const s = store(now);
  await s.initialize();
  await s.start(walkType, { kind: 'walk', config: walkConfig, saved: false });
  await s.begin();
  for (const point of route(START, 120)) {
    now.ms = point.t;
    s.appendFix(point);
  }
  now.ms = START + 120_000;
  await s.finishGuided();
  // Saved at the end, before the strap's samples have reached the server.
  await s.saveWalk(tz);
  let row = s.getSnapshot().rows[0].payload;
  assert.equal(row.avgHr, undefined);
  assert.equal(row.segments?.[0].avgHr, null);
  assert.ok((row.segments?.[0].distanceKm ?? 0) > 0, 'block distance comes from the route');
  assert.ok((row.segments?.[1].avgPaceSecPerKm ?? 0) > 0, 'block pace comes from the route');
  // The strap's samples land: slow block at 95 bpm, fast block at 115.
  const hr = window(START, 120, (i) => (i < 60 ? 95 : 115));
  await s.saveWalk(tz, hr);
  row = s.getSnapshot().rows[0].payload;
  assert.equal(s.getSnapshot().rows.length, 1);
  assert.equal(row.avgHr, 105);
  assert.equal(row.maxHr, 115);
  const [slow, fast] = row.segments!;
  assert.deepEqual([slow.kind, slow.avgHr, slow.maxHr, slow.hrAtStart], ['slow', 95, 95, 95]);
  assert.deepEqual([fast.kind, fast.avgHr, fast.maxHr, fast.hrAtStart], ['fast', 115, 115, 115]);
  assert.ok(s.getSnapshot().rows[0].pending, 'the fuller save uploads again');
  // The same window again changes nothing.
  const before = JSON.stringify(s.getSnapshot().rows);
  await s.saveWalk(tz, hr);
  assert.equal(JSON.stringify(s.getSnapshot().rows), before);
});

test('a Cooper test saves its GPS distance and peak HR, and the activity its avg and max (#3641)', () => {
  const session = {
    id: testId,
    startMs: START,
    endMs: START + 720_000,
    distance: '',
    notes: '',
    guidance: {
      kind: 'test' as const,
      protocol: 'cooper12' as const,
      activityId,
      countdownUntil: START,
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  };
  // 2.4 km over 12 minutes, readings climbing from 130 to 189 bpm.
  const points = Array.from({ length: 145 }, (_, i) => ({
    lat: -27.47 + (i * 2400) / 144 / 111_195,
    lng: 153.02,
    t: START + i * 5000,
  }));
  const hr = window(START, 720, (i) => 130 + Math.floor(i / 12));
  const result = fitnessResult(session, tz, {}, { hr, route: points });
  assert.ok(Math.abs((result.payload.distanceM ?? 0) - 2400) <= 2);
  assert.equal(result.payload.method, 'cooper_1968');
  assert.ok(result.payload.vo2maxEst! > 0);
  assert.ok(result.payload.maxHr! >= 185, 'the peak reaches max HR');
  assert.ok(result.payload.avgHr! > 150);
  assert.equal(result.activity?.maxHr, result.payload.maxHr);
  assert.equal(result.activity?.avgHr, result.payload.avgHr);
  // A typed distance still overrides the GPS one.
  const typed = fitnessResult({ ...session, distance: '2.5' }, tz, {}, { hr, route: points });
  assert.equal(typed.payload.distanceM, 2500);
});

test('a Cooper test that ends with the phone locked measures only the fixes up to its end (#3684)', () => {
  const session = {
    id: testId,
    startMs: START,
    endMs: START + 720_000,
    distance: '',
    notes: '',
    guidance: {
      kind: 'test' as const,
      protocol: 'cooper12' as const,
      activityId,
      countdownUntil: START,
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  };
  // 2.4 km over the 12 minutes, then the same pace for 10 more minutes before the screen's timer
  // finished the test at unlock.
  const points = Array.from({ length: 265 }, (_, i) => ({
    lat: -27.47 + (i * 2400) / 144 / 111_195,
    lng: 153.02,
    t: START + i * 5000,
  }));
  const result = fitnessResult(session, tz, {}, { route: points });
  assert.ok(Math.abs((result.payload.distanceM ?? 0) - 2400) <= 2, `${result.payload.distanceM}`);
  const within = fitnessResult(session, tz, {}, { route: points.slice(0, 145) });
  assert.equal(result.payload.vo2maxEst, within.payload.vo2maxEst);
});

test('the resting HRR test reads resting HR and 1-minute recovery from the strap, typed values override', () => {
  const session = {
    id: testId,
    startMs: START,
    endMs: START + 300_000,
    distance: '',
    notes: '',
    guidance: {
      kind: 'test' as const,
      protocol: 'resting_hrr' as const,
      activityId,
      countdownUntil: START,
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  };
  // Rest at 60, effort up to 160, then recovery dropping 1 bpm a second.
  const hr = window(START, 300, (i) => (i < 120 ? 60 : i < 240 ? 60 + Math.min(100, i - 120) : 160 - (i - 240)));
  const sensor = fitnessResult(session, tz, {}, { hr });
  assert.ok(sensor.payload.restingHr! <= 62);
  assert.ok(sensor.payload.hrr1Bpm! > 0);
  assert.ok(sensor.payload.maxHr! >= 155);
  assert.equal(sensor.payload.method, undefined);
  const typed = fitnessResult(
    { ...session, guidance: { ...session.guidance, restingHr: '58', peakHr: '150', recoveryHr: '120' } },
    tz,
    {},
    { hr },
  );
  assert.deepEqual(
    [typed.payload.restingHr, typed.payload.maxHr, typed.payload.hrr1Bpm, typed.payload.method],
    [58, 150, 30, 'manual_hrr'],
  );
});

test('a distance test records its route, and its save clears it', async () => {
  const now = { ms: START };
  const s = store(now);
  await s.initialize();
  await s.start(
    { id: 'run', label: 'Cooper', icon: 'Activity', isDistanceBased: true },
    {
      kind: 'test',
      protocol: 'cooper12',
      activityId,
      countdownUntil: START,
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  );
  await s.begin();
  for (const point of route(START, 60)) {
    now.ms = point.t;
    assert.equal(s.appendFix(point), true);
  }
  now.ms = START + 720_000;
  await s.finishGuided();
  await s.saveFitness(tz, {});
  assert.ok((s.getSnapshot().tests[0].payload.distanceM ?? 0) > 0);
  assert.deepEqual(s.getSnapshot().route, []);
});

test('hr-window readings convert to samples oldest first, dropping unusable times', () => {
  assert.deepEqual(
    hrSamples({
      readings: [
        { timestamp: new Date(START + 1000).toISOString(), bpm: 101 },
        { timestamp: 'not a time', bpm: 99 },
        { timestamp: new Date(START).toISOString(), bpm: 100 },
      ],
    }),
    [
      { at: START, bpm: 100 },
      { at: START + 1000, bpm: 101 },
    ],
  );
});

// #3647 ----------------------------------------------------------------------------------------

test('interval cues are on by default, and settings saved under the old opt-in default turn on once (#3647)', async () => {
  assert.equal(platformSchema.parse({ scope: 's' }).walkCues, true);
  assert.equal((migrateCues({ scope: 's', walkCues: false }) as { walkCues: boolean }).walkCues, true);
  const storage = memoryStorage({
    'platform-settings.v1': JSON.stringify({ scope: 's', walkCues: false, keepAwake: false }),
  });
  const platform = new PlatformStore(storage, () => 'unused');
  await platform.initialize();
  assert.equal(platform.getSnapshot().settings.walkCues, true);
  assert.equal(platform.getSnapshot().settings.keepAwake, false, 'nothing else changes');
  assert.equal(JSON.parse(storage.values.get('platform-settings.v1')!).walkCuesDefaultOn, true);
  // A switch-off after that sticks across a restart.
  await platform.configure({ walkCues: false });
  const reopened = new PlatformStore(storage, () => 'unused');
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().settings.walkCues, false);
});

test('a walk started with default settings plans its block cues and the end cue', () => {
  const settings = platformSchema.parse({ scope: 's' });
  const alerts = planAlerts(
    settings,
    [],
    {
      id: testId,
      type: walkType,
      title: 'Interval walk',
      mode: 'active',
      startMs: START,
      endMs: null,
      pausedMs: 0,
      pauseStartMs: null,
      notes: '',
      distance: '',
      guidance: { kind: 'walk', config: walkConfig, saved: false },
    },
    START + 1000,
  );
  assert.deepEqual(
    alerts.map((alert) => alert.title),
    ['Fast walking', 'Walk complete'],
  );
});

// #3648 ----------------------------------------------------------------------------------------

test('a free run saves the strap cadence, its series and source, and the steps it covers (#3648)', async () => {
  const now = { ms: START };
  const s = store(now);
  await s.initialize();
  await s.start({ id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: true });
  await s.begin();
  const session = s.getSnapshot().session!;
  const log = s.cadenceFor(session)!;
  assert.ok(log);
  feedCadence(log, 160, 120, START);
  now.ms = START + 120_000;
  await s.finish();
  await s.save(tz, { avgHr: 150, maxHr: 170 });
  const row = s.getSnapshot().rows[0].payload;
  assert.ok(Math.abs((row.cadenceSpm ?? 0) - 160) <= 3, `cadence ${row.cadenceSpm}`);
  assert.ok((row.cadenceSeries?.length ?? 0) > 0);
  assert.equal(row.cadenceSource, 'strap');
  // The shared covered-steps integration, about two minutes at 160 spm.
  assert.ok((row.steps ?? 0) > 280 && (row.steps ?? 0) < 380, `steps ${row.steps}`);
  assert.equal(s.cadence, null, 'the log goes with the saved activity');
});

test('a treadmill keeps its distance-based steps over the cadence estimate, as the current app does', async () => {
  const now = { ms: START };
  const s = store(now);
  await s.initialize();
  await s.start({ id: 'treadmill', label: 'Treadmill', icon: 'PersonSimpleWalk', isDistanceBased: false });
  await s.begin();
  feedCadence(s.cadenceFor(s.getSnapshot().session!)!, 120, 120, START);
  now.ms = START + 120_000;
  await s.finish();
  await s.save(tz, { steps: 300 });
  const row = s.getSnapshot().rows[0].payload;
  assert.equal(row.steps, 300);
  assert.ok(row.cadenceSpm != null);
});

test('a free activity with no strap cadence saves no cadence keys', () => {
  const session = {
    id: testId,
    type: { id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: false },
    title: 'Run',
    mode: 'done' as const,
    startMs: START,
    endMs: START + 600_000,
    pausedMs: 0,
    pauseStartMs: null,
    notes: '',
    distance: '',
  };
  const payload = sessionPayload(session, tz, [], null, { cadence: new CadenceLog(START) });
  assert.equal('cadenceSpm' in payload, false);
  assert.equal('steps' in payload, false);
});

test('a cycle keeps no cadence log', async () => {
  const s = store({ ms: START });
  await s.initialize();
  await s.start({ id: 'cycle', label: 'Cycle', icon: 'Bicycle', isDistanceBased: true });
  await s.begin();
  assert.equal(s.cadenceFor(s.getSnapshot().session!), null);
});

// #3649 ----------------------------------------------------------------------------------------

test('the walk pacer judges heart rate against the anchor, not the zone ceiling (#3649)', () => {
  // The HR profile as `/api/hr-profile` serves it: zone ceiling 181, reachable anchor 175.
  const profile = { maxHr: 181, targetAnchorMax: 175, restingHr: 52 };
  const targets = pacerHrTargets(profile);
  assert.deepEqual(targets, walkHrTargets(175, 52));
  assert.notDeepEqual(targets, walkHrTargets(181, 52));
  const noAnchor = { maxHr: 181, restingHr: 52 };
  assert.equal(pacerHrTargets(noAnchor), null, 'no anchor, no HR rung');
});

// #3655 ----------------------------------------------------------------------------------------

test('the strap and scale outboxes count toward "waiting to upload" (#3655)', () => {
  assert.equal(deviceUploadsWaiting({ strapSamples: 0, scaleReadings: 0 }), 0);
  assert.equal(deviceUploadsWaiting({ strapSamples: 1, scaleReadings: 0 }), 1);
  assert.equal(deviceUploadsWaiting({ strapSamples: UPLOAD_BATCH + 1, scaleReadings: 2 }), 4);
});
