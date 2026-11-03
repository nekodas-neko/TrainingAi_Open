import test from 'node:test';
import assert from 'node:assert/strict';
import { speedTargetsFromHistory, walkHrTargets } from '@trainingai/shared/walking/walk-pacer';
import {
  WalkPace,
  noSignals,
  paceSignals,
  pacingView,
} from '../src/features/activities/data/walk-pace.ts';
import { defaultWalk, walkPlan } from '../src/features/activities/data/guidance.ts';
import { ActivityStore } from '../src/features/activities/data/ActivityStore.ts';
import { activityPayload } from '../src/features/activities/data/models.ts';
import type { StrapState } from '../src/features/devices/strap/StrapSession.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const config = { ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60, fastCadenceSpm: 120, slowCadenceSpm: 95 };
const [slowBlock, fastBlock] = walkPlan(config).segments;
// The speed pair a walker's history gives: fast blocks 6 km/h, slow blocks 4 km/h.
const speedTargets = speedTargetsFromHistory({
  fast: { avgPaceSecPerKm: 600, count: 5 },
  slow: { avgPaceSecPerKm: 900, count: 5 },
});
// 168 max, 55 resting: fast band 101-118, slow ceiling 55 + 0.4 x reserve.
const hrTargets = walkHrTargets(168, 55);
const hz = (spm: number, seconds: number) =>
  Array.from({ length: seconds * 50 }, (_, i) => Math.round(1000 + 300 * Math.sin((2 * Math.PI * (spm / 60) * i) / 50)));
function feedCadence(pace: WalkPace, spm: number, seconds: number, startAtMs: number) {
  const samples = hz(spm, seconds);
  for (let s = 0; s < seconds; s++)
    pace.onBatch({ magnitudes: samples.slice(s * 50, (s + 1) * 50), sampleRate: 50, at: startAtMs + (s + 1) * 1000 });
}
function walker(
  targets: Parameters<WalkPace['setTargets']>[0] = { speed: speedTargets, hr: hrTargets },
) {
  const pace = new WalkPace(0, config);
  pace.setTargets(targets);
  return pace;
}

test('the history gives a speed pair, and a max and resting HR give the heart-rate pair', () => {
  assert.ok(speedTargets && Math.abs(speedTargets.fast - 6) < 1e-9 && Math.abs(speedTargets.slow - 4) < 1e-9);
  assert.deepEqual([hrTargets.fast, hrTargets.fastMax], [101, 118]);
  assert.equal(speedTargetsFromHistory({ fast: { avgPaceSecPerKm: 600, count: 2 }, slow: { avgPaceSecPerKm: 900, count: 5 } }), null);
});

test('each rung paces on its own: cadence, then speed, then heart rate', () => {
  const pace = walker();
  feedCadence(pace, 125, 8, 0);
  const onCadence = pace.reading(8_000, fastBlock, { speedKmh: 4, bpm: 90 })!;
  assert.equal(onCadence.signal, 'cadence');
  assert.equal(onCadence.band, 'green');
  assert.equal(onCadence.fallbackNote, null);

  const noCadence = walker();
  const onSpeed = noCadence.reading(0, fastBlock, { speedKmh: 6.5, bpm: 90 })!;
  assert.equal(onSpeed.signal, 'speed');
  assert.equal(onSpeed.band, 'green', '6.5 km/h meets a 6 km/h floor');
  assert.match(onSpeed.fallbackNote!, /pacing by speed/);
  assert.equal(noCadence.reading(0, slowBlock, { speedKmh: 6.5, bpm: null })!.band, 'red', 'well over the slow ceiling');

  const onHr = noCadence.reading(0, fastBlock, { speedKmh: null, bpm: 110 })!;
  assert.equal(onHr.signal, 'hr');
  assert.equal(onHr.band, 'green', '110 is inside the 101-118 band');
  assert.notEqual(noCadence.reading(0, fastBlock, { speedKmh: null, bpm: 125 })!.band, 'green', 'above the band is not on pace');
  assert.match(onHr.fallbackNote!, /pacing by heart rate/);
});

test('the ladder falls through in order, and says nothing when no rung has a reading', () => {
  const pace = walker();
  feedCadence(pace, 125, 8, 0);
  // Cadence goes stale after five seconds: speed takes over.
  assert.equal(pace.reading(8_000 + 5_001, fastBlock, { speedKmh: 6.5, bpm: 110 })!.signal, 'speed');
  // No speed target (too little history): heart rate.
  const noHistory = walker({ speed: null, hr: hrTargets });
  assert.equal(noHistory.reading(0, fastBlock, { speedKmh: 6.5, bpm: 110 })!.signal, 'hr');
  // No heart-rate targets (no profile yet): a bpm is not a reading.
  const noProfile = walker({ speed: null, hr: null });
  assert.equal(noProfile.reading(0, fastBlock, { speedKmh: null, bpm: 110 }), null);
  assert.equal(walker().reading(0, fastBlock, noSignals), null);
  assert.equal(walker().reading(0, { ...fastBlock, kind: 'warmup' }, { speedKmh: 6, bpm: 110 }), null);
});

test('a treadmill walk is never paced by GPS: no route, or the flag, leaves heart rate', () => {
  const route = [
    { lat: -27.47, lng: 153.02, t: 0 },
    { lat: -27.4701, lng: 153.0201, t: 10_000 },
    { lat: -27.4702, lng: 153.0202, t: 20_000 },
  ];
  const strap = { bpm: 110, bpmAt: 20_000, link: 'connected', worn: true, trace: [] } as unknown as StrapState;
  const outdoors = paceSignals({ route, treadmill: false, strap, nowMs: 21_000 });
  assert.ok(outdoors.speedKmh !== null && outdoors.speedKmh > 0);
  assert.equal(outdoors.bpm, 110);
  // The flag wins even if fixes arrived: a phone on a treadmill drifts and reads as slow walking.
  const indoors = paceSignals({ route, treadmill: true, strap, nowMs: 21_000 });
  assert.equal(indoors.speedKmh, null);
  assert.equal(paceSignals({ route: [], treadmill: false, strap, nowMs: 21_000 }).speedKmh, null, 'no fixes, no speed');
  const pace = walker();
  assert.equal(pace.reading(0, fastBlock, indoors)!.signal, 'hr');
  // A held last reading, or a strap that dropped, is not paced against.
  assert.equal(paceSignals({ route, treadmill: true, strap, nowMs: 60_000 }).bpm, null);
  assert.equal(paceSignals({ route, treadmill: true, strap: null, nowMs: 21_000 }).bpm, null);
});

test('the card shows the rung in use, and a missing strap no longer hides GPS or heart rate', () => {
  const pace = walker();
  const signals = { speedKmh: null, bpm: 110 };
  const reading = pace.reading(0, fastBlock, signals);
  const view = pacingView({ paired: false, link: 'off', accel: 'off', spm: null, reading, signals } as never);
  assert.equal(view.state, 'live');
  assert.ok(view.state === 'live' && view.unit === 'bpm' && view.value === 110);
  const speed = pacingView({
    paired: false, link: 'off', accel: 'off', spm: null, signals: { speedKmh: 6.5, bpm: null },
    reading: pace.reading(0, fastBlock, { speedKmh: 6.5, bpm: null }),
  } as never);
  assert.ok(speed.state === 'live' && speed.unit === 'km/h' && speed.value === 6.5);
  const none = pacingView({ paired: false, link: 'off', accel: 'off', spm: null, reading: null } as never);
  assert.equal(none.state, 'none');
  assert.match((none as { note: string }).note, /GPS speed, then heart rate/);
});

function storeFixture(values = new Map<string, string>(), startAt = Date.parse('2026-11-02T08:00:00+10:00')) {
  let now = startAt;
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ activityLogs: [] }),
    post: async () => {
      throw new Error('Offline');
    },
  };
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
  const store = new ActivityStore(storage, connection, () => '10000000-0000-4000-8000-000000000009', () => {}, () => now);
  return { store, values, advance: (ms: number) => (now += ms), now: () => now };
}
const walkType = { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: false };

/** A slow block on heart rate alone, then a fast block on speed alone: no strap on the walk. */
async function walkIt(f: ReturnType<typeof storeFixture>, until: 'slow' | 'fast' | 'end') {
  const session = f.store.getSnapshot().session!;
  const pace = f.store.paceFor(session)!;
  pace.setTargets({ speed: speedTargets, hr: hrTargets });
  const [slow, fast] = walkPlan(config).segments;
  const at = (s: number) => session.startMs! + s * 1000;
  for (let s = 1; s <= 60; s++) pace.tick(at(s), slow, { speedKmh: null, bpm: 85 });
  f.store.pacerUpdated();
  if (until === 'slow') return pace;
  for (let s = 61; s <= 120; s++) pace.tick(at(s), fast, { speedKmh: 6.5, bpm: 110 });
  f.store.pacerUpdated();
  return pace;
}
async function startedWalk(f: ReturnType<typeof storeFixture>) {
  await f.store.initialize();
  await f.store.start(walkType, { kind: 'walk', config, saved: false });
  await f.store.begin();
}

test('a saved walk records which rung paced each block, with no cadence at all', async () => {
  const f = storeFixture();
  await startedWalk(f);
  await walkIt(f, 'end');
  f.advance(120_000);
  await f.store.finishGuided();
  await f.store.saveWalk('Australia/Brisbane');
  const row = f.store.getSnapshot().rows[0].payload;
  const [slow, fast] = row.segments!;
  assert.equal(slow.pacerSignal, 'hr');
  assert.equal(slow.pacerAdherence, 1, '85 bpm is under the slow ceiling');
  assert.equal(fast.pacerSignal, 'speed');
  assert.equal(fast.pacerAdherence, 1);
  assert.equal(row.cadenceSpm, undefined, 'no strap cadence, so none is invented');
  assert.equal(row.steps, undefined);
  assert.equal(activityPayload.safeParse(row).success, true);
});

test('a kill mid-walk keeps the tally: the resumed walk saves what the first run counted', async () => {
  const first = storeFixture();
  await startedWalk(first);
  const pace = await walkIt(first, 'end');
  // Some strap cadence too, so the series and the average survive.
  feedCadence(pace, 125, 20, first.store.getSnapshot().session!.startMs!);
  await first.store.checkpoint();
  const expected = pace.segments(walkPlan(config).segments);
  const expectedCadence = pace.cadencePayload(120);
  assert.ok(first.values.has('activities.pace.v1'), 'the tally is checkpointed');

  // The process dies. A new one opens the same storage and carries on.
  const second = storeFixture(first.values, first.now());
  await second.store.initialize();
  assert.equal(second.store.pace, null, 'nothing in memory yet');
  const session = second.store.getSnapshot().session!;
  const resumed = second.store.paceFor(session)!;
  assert.deepEqual(resumed.segments(walkPlan(config).segments), expected);
  assert.deepEqual(resumed.cadencePayload(120), expectedCadence);
  second.advance(120_000);
  await second.store.finishGuided();
  await second.store.saveWalk('Australia/Brisbane');
  const row = second.store.getSnapshot().rows[0].payload;
  assert.equal(row.segments![0].pacerSignal, 'hr');
  assert.equal(row.segments![1].pacerSignal, 'speed');
  assert.ok(row.cadenceSpm! > 100, `cadence ${row.cadenceSpm}`);
});

test('a treadmill walk, with no route to trigger one, still checkpoints its tally', async () => {
  const f = storeFixture();
  await startedWalk(f);
  f.advance(10_000);
  await walkIt(f, 'slow');
  await new Promise((resolve) => setImmediate(resolve));
  await f.store.checkpoint();
  assert.ok(f.values.has('activities.pace.v1'));
  assert.equal(f.store.getSnapshot().route.length, 0);
});

test('another recording’s or another account’s tally is not attached, and finishing clears it', async () => {
  const first = storeFixture();
  await startedWalk(first);
  await walkIt(first, 'end');
  await first.store.checkpoint();
  // A different walk: its start time differs, so the leftover is dropped, not attached.
  const saved = JSON.parse(first.values.get('activities.pace.v1')!);
  first.values.set('activities.pace.v1', JSON.stringify({ ...saved, startMs: saved.startMs + 1 }));
  const second = storeFixture(first.values, first.now());
  await second.store.initialize();
  const fresh = second.store.paceFor(second.store.getSnapshot().session!)!;
  assert.equal(fresh.hasData, false);
  assert.equal(second.values.has('activities.pace.v1'), false, 'the stale record is removed');
  // Discarding a walk removes what was kept.
  const third = storeFixture();
  await startedWalk(third);
  await walkIt(third, 'end');
  await third.store.checkpoint();
  assert.ok(third.values.has('activities.pace.v1'));
  await third.store.discard();
  assert.equal(third.values.has('activities.pace.v1'), false);
});
