import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACC_SAMPLE_RATE_HZ,
  accMagnitudes,
  buildAccStartCommand,
  buildAccStopCommand,
  magnitude,
  parseAccFrame,
} from '@trainingai/shared/devices/polar-pmd';
import { WalkPace, pacingView } from '../src/features/activities/data/walk-pace.ts';
import { defaultWalk, walkPlan, walkSegments } from '../src/features/activities/data/guidance.ts';
import { ActivityStore, sessionPayload } from '../src/features/activities/data/ActivityStore.ts';
import { activityPayload } from '../src/features/activities/data/models.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const header = (frameType: number) => [0x02, 1, 0, 0, 0, 0, 0, 0, 0, frameType];
const hex = (bytes: Uint8Array) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join(' ');

test('the start and stop commands are the bytes PolarProtocol.kt builds', () => {
  // [op][type] then TLVs [type][len][value:2 LE]: rate 50, resolution 16, range 8 g.
  assert.equal(ACC_SAMPLE_RATE_HZ, 50);
  assert.equal(hex(buildAccStartCommand()), '02 02 00 01 32 00 01 01 10 00 02 01 08 00');
  assert.equal(hex(buildAccStartCommand(200)), '02 02 00 01 c8 00 01 01 10 00 02 01 08 00');
  assert.equal(hex(buildAccStopCommand()), '03 02');
});

test('a raw ACC frame decodes whole int16 triplets', () => {
  // (1, -1, 1000) and (-2, 3, -1000) in milli-g.
  const frame = new Uint8Array([
    ...header(0x00),
    0x01, 0x00, 0xff, 0xff, 0xe8, 0x03,
    0xfe, 0xff, 0x03, 0x00, 0x18, 0xfc,
  ]);
  const decoded = parseAccFrame(frame)!;
  assert.equal(decoded.frameType, 0);
  assert.deepEqual(decoded.samples, [
    { x: 1, y: -1, z: 1000 },
    { x: -2, y: 3, z: -1000 },
  ]);
  assert.equal(Math.round(magnitude({ x: 3, y: 4, z: 0 })), 5);
  assert.deepEqual(accMagnitudes(decoded), [1000, 1000]);
  // Frame type 0x01 is raw too.
  assert.equal(parseAccFrame(new Uint8Array([...header(0x01), 1, 0, 2, 0, 3, 0]))?.samples.length, 1);
});

test('a delta ACC frame applies packed signed deltas to its reference sample', () => {
  // Reference (1000, -1000, 0), then one group of bitWidth 4 and count 2. The deltas, LSB-first at 4
  // bits each: (+1, -2, 0) then (-3, +7, -8) = nibbles 1 e 0 d 7 8 = bytes e1 d0 87.
  for (const frameType of [0x80, 0x82, 0x02]) {
    const frame = new Uint8Array([
      ...header(frameType),
      0xe8, 0x03, 0x18, 0xfc, 0x00, 0x00,
      0x04, 0x02, 0xe1, 0xd0, 0x87,
    ]);
    assert.deepEqual(parseAccFrame(frame)?.samples, [
      { x: 1000, y: -1000, z: 0 },
      { x: 1001, y: -1002, z: 0 },
      { x: 998, y: -995, z: -8 },
    ]);
  }
  // A raw-typed frame whose body is not whole 6-byte samples is read as delta, not truncated.
  const odd = new Uint8Array([...header(0x00), 0xe8, 0x03, 0x18, 0xfc, 0x00, 0x00, 0x04, 0x02, 0xe1, 0xd0, 0x87]);
  assert.equal(parseAccFrame(odd)?.samples.length, 3);
});

test('malformed ACC frames decode to null and never throw', () => {
  assert.equal(parseAccFrame(new Uint8Array()), null);
  assert.equal(parseAccFrame(new Uint8Array([0x02, 1, 2, 3])), null, 'shorter than the header');
  assert.equal(parseAccFrame(new Uint8Array(header(0x00))), null, 'no body');
  assert.equal(parseAccFrame(new Uint8Array([0x00, ...header(0x00).slice(1), 1, 0, 2, 0, 3, 0])), null, 'ECG, not ACC');
  // A delta group that claims more bits than the frame holds.
  assert.equal(
    parseAccFrame(new Uint8Array([...header(0x80), 0, 0, 0, 0, 0, 0, 0x10, 0xff, 0x01])),
    null,
  );
  // A bit width past 32 is not a delta.
  assert.equal(parseAccFrame(new Uint8Array([...header(0x80), 0, 0, 0, 0, 0, 0, 0x21, 0x01, 0, 0, 0, 0])), null);
});

// A walking signal at `spm` steps a minute: 50 Hz acceleration magnitude around 1 g.
function stepSignal(spm: number, seconds: number, from = 0) {
  const hz = spm / 60;
  return Array.from({ length: seconds * 50 }, (_, i) =>
    Math.round(1000 + 300 * Math.sin((2 * Math.PI * hz * (from * 50 + i)) / 50)),
  );
}
function feed(pace: WalkPace, spm: number, seconds: number, startAtMs: number) {
  const samples = stepSignal(spm, seconds);
  for (let s = 0; s < seconds; s++)
    pace.onBatch({
      magnitudes: samples.slice(s * 50, (s + 1) * 50),
      sampleRate: 50,
      at: startAtMs + (s + 1) * 1000,
    });
}
const plan = walkPlan({ ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60 });
const slowBlock = plan.segments.find((x) => x.kind === 'slow');
const fastBlock = plan.segments.find((x) => x.kind === 'fast');

test('live cadence comes from the shared detector over the last seconds, and goes stale', () => {
  const pace = new WalkPace(0, defaultWalk);
  assert.equal(pace.live(1_000), null, 'nothing read yet');
  feed(pace, 120, 8, 0);
  const spm = pace.live(8_000)!;
  assert.ok(Math.abs(spm - 120) <= 3, `read ${spm} for a 120 spm signal`);
  assert.equal(pace.live(8_000 + 5_000), spm);
  assert.equal(pace.live(8_000 + 5_001), null, 'older than five seconds is not live');
});

test('the pacer bands cadence against the block target, and a standstill is neutral', () => {
  const pace = new WalkPace(0, { fastCadenceSpm: 120, slowCadenceSpm: 95 });
  feed(pace, 120, 8, 0);
  assert.equal(pace.reading(8_000, fastBlock)?.band, 'green', '120 meets a ≥120 floor');
  assert.equal(pace.reading(8_000, slowBlock)?.band, 'red', '120 is well over a ≤95 ceiling');
  assert.equal(pace.reading(8_000, { ...fastBlock!, kind: 'warmup' }), null, 'no band in a warm-up');
  assert.equal(new WalkPace(0, defaultWalk).reading(0, fastBlock), null, 'no cadence, no band');
});

test('adherence counts what was shown each second and is absent where nothing was judged', () => {
  const pace = new WalkPace(0, { fastCadenceSpm: 120, slowCadenceSpm: 95 });
  feed(pace, 120, 8, 0);
  for (let t = 0; t < 4; t++) pace.tick(8_000 + t * 1000, fastBlock);
  pace.tick(8_000, slowBlock);
  const [slow, fast] = pace.segments(plan.segments);
  assert.equal(fast.pacerSignal, 'cadence');
  assert.deepEqual(fast.pacerTicks, { green: 4, amber: 0, red: 0, stopped: 0 });
  assert.equal(fast.pacerAdherence, 1);
  assert.deepEqual(slow.pacerTicks, { green: 0, amber: 0, red: 1, stopped: 0 });
  assert.equal(slow.pacerAdherence, 0);
  const none = new WalkPace(0, defaultWalk).segments(plan.segments);
  assert.ok(none.every((x) => !('pacerSignal' in x) && !('pacerAdherence' in x)));
  assert.ok(none.every((x) => x.avgCadenceSpm === null && x.steps === null));
});

test('the pacing card says the true state: no strap, waiting, unavailable, or live', () => {
  const reading = new WalkPace(0, defaultWalk);
  feed(reading, 120, 8, 0);
  const live = reading.reading(8_000, fastBlock);
  const base = { paired: true, link: 'connected', accel: 'streaming', spm: null, reading: null } as const;
  assert.equal(pacingView({ ...base, paired: false }).state, 'none');
  assert.match(pacingView({ ...base, paired: false }).state === 'none' ? (pacingView({ ...base, paired: false }) as { note: string }).note : '', /Pair one in Devices/);
  const connecting = pacingView({ ...base, link: 'waiting' });
  assert.equal(connecting.state, 'waiting');
  const waiting = pacingView({ ...base, accel: 'starting' });
  assert.equal(waiting.state, 'waiting');
  assert.match((waiting as { note: string }).note, /Waiting for your cadence/);
  assert.equal(pacingView({ ...base, accel: 'unavailable' }).state, 'unavailable');
  const shown = pacingView({ ...base, spm: reading.live(8_000), reading: live });
  assert.equal(shown.state, 'live');
  // A reading while the link is down is not live.
  assert.equal(pacingView({ ...base, link: 'waiting', spm: 120, reading: live }).state, 'waiting');
});

function storeFixture() {
  const values = new Map<string, string>();
  let now = Date.parse('2026-10-12T08:00:00+10:00');
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
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const store = new ActivityStore(storage, connection, () => '10000000-0000-4000-8000-000000000009', () => {}, () => now);
  return { store, advance: (ms: number) => (now += ms), now: () => now };
}
const walkType = { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: true };

test('a paced walk stores its cadence and each block’s adherence, as the current app’s walk does', async () => {
  const f = storeFixture();
  await f.store.initialize();
  const config = { ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60, fastCadenceSpm: 120, slowCadenceSpm: 95 };
  await f.store.start(walkType, { kind: 'walk', config, saved: false });
  await f.store.begin();
  const session = f.store.getSnapshot().session!;
  const pace = f.store.paceFor(session)!;
  assert.equal(f.store.paceFor(session), pace, 'one pacer per walk');
  // Slow block 0-60 s at 90 spm (under the 95 ceiling), fast block 60-120 s at 125 spm.
  const slowAt = (s: number) => session.startMs! + s * 1000;
  const slowSamples = stepSignal(90, 60);
  for (let s = 0; s < 60; s++) {
    pace.onBatch({ magnitudes: slowSamples.slice(s * 50, (s + 1) * 50), sampleRate: 50, at: slowAt(s + 1) });
    pace.tick(slowAt(s + 1), walkPlan(config).segments[0]);
  }
  const fastSamples = stepSignal(125, 60);
  for (let s = 0; s < 60; s++) {
    pace.onBatch({ magnitudes: fastSamples.slice(s * 50, (s + 1) * 50), sampleRate: 50, at: slowAt(61 + s) });
    pace.tick(slowAt(61 + s), walkPlan(config).segments[1]);
  }
  f.advance(120_000);
  await f.store.finishGuided();
  await f.store.saveWalk('Australia/Brisbane');
  const row = f.store.getSnapshot().rows[0].payload;
  assert.equal(row.cadenceSource, 'strap');
  assert.ok(row.cadenceSpm! > 90 && row.cadenceSpm! < 125, `avg ${row.cadenceSpm}`);
  assert.ok(row.cadenceSeries!.length >= 10);
  const [slow, fast] = row.segments!;
  assert.equal(slow.pacerSignal, 'cadence');
  assert.ok(slow.pacerAdherence! > 0.8, `slow adherence ${slow.pacerAdherence}`);
  assert.ok(fast.pacerAdherence! > 0.8, `fast adherence ${fast.pacerAdherence}`);
  assert.ok(Math.abs(slow.avgCadenceSpm! - 90) < 6);
  assert.ok(Math.abs(fast.avgCadenceSpm! - 125) < 6);
  assert.ok(slow.steps! > 60 && fast.steps! > 90);
  assert.ok(row.steps! >= slow.steps! + fast.steps!, `walk steps ${row.steps}`);
  assert.equal(activityPayload.safeParse(row).success, true, 'it passes the same save schema');
});

test('a walk with no strap saves exactly what it did before', async () => {
  const f = storeFixture();
  await f.store.initialize();
  await f.store.start(walkType, { kind: 'walk', config: { ...defaultWalk, sets: 1 }, saved: false });
  await f.store.begin();
  f.advance(90_000);
  await f.store.finishGuided();
  await f.store.saveWalk('Australia/Brisbane');
  const row = f.store.getSnapshot().rows[0].payload;
  assert.equal(row.cadenceSpm, undefined);
  assert.equal(row.cadenceSeries, undefined);
  assert.equal(row.cadenceSource, undefined);
  assert.equal(row.steps, undefined);
  assert.ok(row.segments!.every((x) => x.avgCadenceSpm === null && x.pacerSignal === undefined));
  // The sessionPayload default (no pacer) is the unpaced shape.
  assert.deepEqual(
    sessionPayload(f.store.getSnapshot().session!, 'Australia/Brisbane').segments,
    walkSegments(f.store.getSnapshot().session!.guidance!.kind === 'walk' ? (f.store.getSnapshot().session!.guidance as { config: typeof defaultWalk }).config : defaultWalk, 90),
  );
});

test('walk-level steps are the shared estimate, and absent when the strap covers under half the walk (#3541)', () => {
  const full = new WalkPace(0, defaultWalk);
  feed(full, 120, 120, 0);
  const steps = full.cadencePayload(120).steps;
  assert.ok(steps !== undefined && steps > 150, `steps ${steps}`);
  assert.equal('steps' in full.cadencePayload(), false, 'no duration, no estimate');
  // A stream that starts late, 20 s of cadence in a 120 s walk, is discarded rather than scaled.
  const late = new WalkPace(0, defaultWalk);
  feed(late, 120, 20, 100_000);
  assert.equal('steps' in late.cadencePayload(120), false);
  assert.equal('steps' in new WalkPace(0, defaultWalk).cadencePayload(120), false);
});
