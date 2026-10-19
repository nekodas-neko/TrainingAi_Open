import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHeartRateMeasurement,
  parseBatteryLevel,
} from '@trainingai/shared/devices/heart-rate-measurement';
import { decodeBase64 } from '../src/integrations/ble/base64.ts';
import {
  RECONNECT_DELAYS_MS,
  initialLink,
  linkStep,
  type LinkEvent,
  type LinkState,
} from '../src/features/devices/strap/reconnect.ts';
import {
  HrOutbox,
  MAX_SAVED_SAMPLES,
  UPLOAD_BATCH,
  type StrapSample,
} from '../src/features/devices/strap/HrOutbox.ts';
import { StrapSession } from '../src/features/devices/strap/StrapSession.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import type {
  BleAdapter,
  BlePermission,
  BleRadio,
  StrapLink,
} from '../src/integrations/ble/types.ts';
import type { ScopedStorage } from '../src/core/storage/LocalStorage.ts';

const bytes = (...b: number[]) => new Uint8Array(b);

test('the strap decoders read the standard byte layouts', () => {
  // Flags 0x16: RR present, contact supported and detected. 8-bit HR 142, RR 431 and 437 in
  // 1/1024 s → 421 and 427 ms.
  assert.deepEqual(parseHeartRateMeasurement(bytes(0x16, 142, 0xaf, 0x01, 0xb5, 0x01)), {
    bpm: 142,
    rr: [421, 427],
    contact: true,
  });
  // Flags 0x01: uint16 HR, 0x00B4 = 180.
  assert.deepEqual(parseHeartRateMeasurement(bytes(0x01, 0xb4, 0x00)), {
    bpm: 180,
    rr: [],
    contact: null,
  });
  // Contact supported, not detected.
  assert.equal(parseHeartRateMeasurement(bytes(0x04, 70))?.contact, false);
  // Energy expended (bit 3) is skipped before the RR list: RR 1024 → 1000 ms.
  assert.deepEqual(parseHeartRateMeasurement(bytes(0x18, 60, 0x34, 0x12, 0x00, 0x04))?.rr, [1000]);
  assert.equal(parseHeartRateMeasurement(bytes(0x01, 0xb4)), null);
  assert.equal(parseHeartRateMeasurement(bytes()), null);
  assert.equal(parseBatteryLevel(bytes(34)), 34);
  assert.equal(parseBatteryLevel(bytes(200)), null);
  assert.equal(parseBatteryLevel(bytes()), null);
});

test('characteristic values decode from base64 without throwing', () => {
  assert.deepEqual(decodeBase64('FowBrwG1AQ=='), bytes(0x16, 0x8c, 0x01, 0xaf, 0x01, 0xb5, 0x01));
  assert.deepEqual(decodeBase64('Ig=='), bytes(34));
  assert.deepEqual(decodeBase64('AAEC'), bytes(0, 1, 2));
  assert.equal(decodeBase64(null), null);
  assert.equal(decodeBase64('!!!!'), null);
  assert.equal(decodeBase64('A'), null);
});

function run(events: LinkEvent[], from: LinkState = initialLink) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const next = linkStep(state, event);
    state = next.state;
    effects.push(next.effect);
  }
  return { state, effects };
}

test('the link connects when wanted and backs off after each failure', () => {
  const { state, effects } = run([
    { type: 'want' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'lost' },
  ]);
  assert.deepEqual(effects, [
    { type: 'connect' },
    { type: 'wait', ms: 2_000 },
    { type: 'connect' },
    { type: 'wait', ms: 5_000 },
    { type: 'connect' },
    { type: 'wait', ms: 10_000 },
    { type: 'connect' },
    { type: 'wait', ms: 30_000 },
    { type: 'connect' },
    // It never gives up while a workout wants it; it stays on the last step.
    { type: 'wait', ms: RECONNECT_DELAYS_MS.at(-1) },
  ]);
  assert.equal(state.phase, 'waiting');
});

test('a dropout mid-workout reconnects, and a good connection resets the ladder', () => {
  const { state, effects } = run([
    { type: 'want' },
    { type: 'connected' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'connected' },
    { type: 'lost' },
  ]);
  assert.deepEqual(
    effects.map((x) => x.type),
    ['connect', 'none', 'wait', 'connect', 'none', 'wait'],
  );
  assert.deepEqual(effects.at(-1), { type: 'wait', ms: 2_000 });
  assert.equal(state.attempt, 1);
});

test('the link lets go when nothing wants it', () => {
  const connected = run([{ type: 'want' }, { type: 'connected' }]).state;
  assert.deepEqual(run([{ type: 'unwant' }], connected).effects, [{ type: 'disconnect' }]);
  const waiting = run([{ type: 'want' }, { type: 'lost' }]).state;
  const stopped = run([{ type: 'unwant' }, { type: 'timer' }], waiting);
  assert.deepEqual(stopped.effects, [{ type: 'none' }, { type: 'none' }]);
  assert.equal(stopped.state.phase, 'idle');
  // A connect that lands after the workout ended is closed straight away.
  const late = run([{ type: 'want' }, { type: 'unwant' }, { type: 'connected' }]);
  assert.deepEqual(late.effects.at(-1), { type: 'disconnect' });
  assert.equal(late.state.phase, 'idle');
});

test('Bluetooth off pauses retries until it is back on', () => {
  const off = run([
    { type: 'want' },
    { type: 'connected' },
    { type: 'radio', on: false },
    { type: 'lost' },
  ]);
  assert.equal(off.state.phase, 'radioOff');
  assert.deepEqual(off.effects.slice(2), [{ type: 'none' }, { type: 'none' }]);
  const back = run([{ type: 'radio', on: true }], off.state);
  assert.deepEqual(back.effects, [{ type: 'connect' }]);
  assert.equal(back.state.attempt, 0);
  const wantedWhileOff = run([{ type: 'radio', on: false }, { type: 'want' }]);
  assert.equal(wantedWhileOff.state.phase, 'radioOff');
  assert.deepEqual(wantedWhileOff.effects, [{ type: 'none' }, { type: 'none' }]);
});

test('retry skips the wait but never doubles a live attempt', () => {
  const waiting = run([
    { type: 'want' },
    { type: 'lost' },
    { type: 'timer' },
    { type: 'lost' },
  ]).state;
  const retried = run([{ type: 'retry' }], waiting);
  assert.deepEqual(retried.effects, [{ type: 'connect' }]);
  assert.equal(retried.state.attempt, 0);
  const connecting = run([{ type: 'want' }]).state;
  assert.deepEqual(run([{ type: 'retry' }], connecting).effects, [{ type: 'none' }]);
});

function memoryStorage(
  seed: Record<string, string> = {},
): ScopedStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}
const samples = (count: number, from = 1_000): StrapSample[] =>
  Array.from({ length: count }, (_, i) => ({
    at: from + i * 1000,
    bpm: 120 + (i % 10),
    rr: [500],
  }));

test('strap samples are saved on the phone before they are uploaded', async () => {
  const storage = memoryStorage();
  const posts: unknown[] = [];
  let online = false;
  let uploaded = 0;
  const outbox = new HrOutbox(
    storage,
    {
      origin: 'https://example.test',
      userId: 'u1',
      post: async (path, body) => {
        if (!online) throw new Error('offline');
        posts.push({ path, body });
        return { ok: true };
      },
    },
    () => uploaded++,
  );
  await outbox.append(samples(3));
  await outbox.sync();
  assert.equal(outbox.pending(), 3);
  assert.equal(JSON.parse(storage.values.get('strap-hr-outbox.v1')!).samples.length, 3);
  assert.equal(uploaded, 0);

  online = true;
  await outbox.append(samples(UPLOAD_BATCH, 10_000_000));
  await outbox.sync();
  assert.equal(outbox.pending(), 0);
  assert.equal(JSON.parse(storage.values.get('strap-hr-outbox.v1')!).samples.length, 0);
  assert.deepEqual(
    posts.map((x) => (x as { path: string; body: { samples: unknown[] } }).body.samples.length),
    [UPLOAD_BATCH, 3],
  );
  assert.equal((posts[0] as { path: string }).path, '/api/hr-ingest');
  assert.equal(uploaded, 1);
});

test('the outbox survives a restart, keeps to its own account and drops only unacceptable batches', async () => {
  const storage = memoryStorage();
  const account = { origin: 'https://example.test', userId: 'u1' };
  await new HrOutbox(storage, {
    ...account,
    post: async () => Promise.reject(new Error('offline')),
  }).append(samples(2));
  const statuses = [429, 400];
  const reopened = new HrOutbox(storage, {
    ...account,
    post: async () => {
      throw new ApiError(statuses.shift()!);
    },
  });
  await reopened.sync();
  assert.equal(reopened.pending(), 2, 'a rate limit keeps the batch');
  await reopened.sync();
  assert.equal(reopened.pending(), 0, 'a malformed batch is dropped rather than retried forever');

  await new HrOutbox(storage, {
    ...account,
    post: async () => Promise.reject(new Error('x')),
  }).append(samples(1));
  const other = new HrOutbox(storage, {
    origin: account.origin,
    userId: 'u2',
    post: async () => ({}),
  });
  await other.sync();
  assert.equal(other.pending(), 0);
});

test('the outbox caps what it keeps through a long outage', async () => {
  const outbox = new HrOutbox(memoryStorage(), {
    origin: 'https://example.test',
    userId: 'u1',
    post: async () => Promise.reject(new Error('offline')),
  });
  await outbox.append(samples(MAX_SAVED_SAMPLES));
  await outbox.append(samples(5, 99_000_000));
  assert.equal(outbox.pending(), MAX_SAVED_SAMPLES);
});

function fakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    timers: {
      set: (run: () => void, ms: number) => {
        pending.set(++id, { at: now + ms, run });
        return id;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, x]) => x.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

type FakeOptions = { battery?: number; firmware?: string; permission?: BlePermission };
function fakeBle(options: FakeOptions = {}) {
  let permission: BlePermission = options.permission ?? 'granted';
  let hrFailed: (() => void) | null = null;
  let radioListener: ((radio: BleRadio) => void) | null = null;
  const log: string[] = [];
  let fail = 0;
  let drop: (() => void) | null = null;
  let hr: ((value: Uint8Array) => void) | null = null;
  const adapter: BleAdapter = {
    available: true,
    radio: async () => 'on',
    onRadioChange: (listener) => {
      radioListener = listener;
      return () => {};
    },
    permission: async () => permission,
    scan: (onFound) => {
      onFound({ id: 'AA:BB', name: 'Polar H10 1234ABCD', rssi: -60 });
      return () => log.push('scan stopped');
    },
    connect: async (id, onDisconnected) => {
      log.push(`connect ${id}`);
      if (fail > 0) {
        fail--;
        throw new Error('unreachable');
      }
      drop = onDisconnected;
      const link: StrapLink = {
        onHeartRate: (listener, onFailed) => {
          hr = listener;
          hrFailed = onFailed;
          return () => {
            hr = null;
          };
        },
        readBattery: async () => (options.battery === undefined ? null : bytes(options.battery)),
        readFirmware: async () =>
          options.firmware === undefined
            ? null
            : new Uint8Array([...options.firmware].map((c) => c.charCodeAt(0)).concat([0, 0])),
        disconnect: async () => {
          log.push('disconnect');
        },
      };
      return link;
    },
  };
  return {
    adapter,
    log,
    failNext: (count: number) => {
      fail = count;
    },
    drop: () => drop?.(),
    beat: (value: Uint8Array) => hr?.(value),
    radio: (radio: BleRadio) => radioListener?.(radio),
    grant: (next: BlePermission) => {
      permission = next;
    },
    failNotifications: () => hrFailed?.(),
  };
}

async function pairedSession(
  options: FakeOptions & { alerted?: boolean; noOutbox?: boolean } = {},
) {
  const clock = fakeTimers();
  const ble = fakeBle(options);
  const storage = memoryStorage({
    'paired-hr-strap.v1': JSON.stringify({ id: 'AA:BB', name: 'Polar H10 1234ABCD' }),
    ...(options.alerted ? { 'strap-battery-alert.v1': 'fired' } : {}),
  });
  const alerts: number[] = [];
  const posts: StrapSample[][] = [];
  const session = new StrapSession({
    ble: ble.adapter,
    storage,
    now: clock.now,
    timers: clock.timers,
    notifyLowBattery: async (percent) => {
      alerts.push(percent);
    },
  });
  const outbox = (userId = 'u1') =>
    new HrOutbox(memoryStorage(), {
      origin: 'https://example.test',
      userId,
      post: async (_path, body) => {
        posts.push((body as { samples: StrapSample[] }).samples);
        return { ok: true };
      },
    });
  if (!options.noOutbox) session.setOutbox(outbox());
  await session.initialize();
  return { session, ble, clock, storage, alerts, posts, outbox };
}

test('a workout connects the paired strap, shows live bpm and uploads what it records', async () => {
  const { session, ble, clock, posts } = await pairedSession();
  assert.equal(session.getSnapshot().link, 'idle');
  session.hold('workout', true);
  await settle();
  assert.equal(session.getSnapshot().link, 'connected');
  ble.beat(bytes(0x16, 128, 0x00, 0x02));
  assert.equal(session.getSnapshot().bpm, 128);
  await clock.advance(10_000);
  assert.deepEqual(posts, [[{ at: 0, bpm: 128, rr: [500] }]]);
  session.hold('workout', false);
  await settle();
  assert.equal(session.getSnapshot().link, 'idle');
  assert.ok(ble.log.includes('disconnect'));
});

test('the Devices screen holds the link without recording', async () => {
  const { session, ble, clock, posts } = await pairedSession();
  session.hold('settings', true);
  await settle();
  ble.beat(bytes(0x06, 70));
  await clock.advance(20_000);
  assert.equal(session.getSnapshot().bpm, 70);
  assert.deepEqual(posts, []);
});

test('a strap that drops mid-workout reconnects on its own', async () => {
  const { session, ble, clock } = await pairedSession();
  session.hold('workout', true);
  await settle();
  ble.failNext(2);
  ble.drop();
  assert.equal(session.getSnapshot().link, 'waiting');
  await clock.advance(2_000);
  assert.equal(session.getSnapshot().link, 'waiting');
  await clock.advance(5_000);
  assert.equal(session.getSnapshot().link, 'waiting');
  await clock.advance(10_000);
  assert.equal(session.getSnapshot().link, 'connected');
  assert.equal(ble.log.filter((x) => x.startsWith('connect')).length, 4);
});

test('off the chest the strap is shown as not worn and nothing is recorded', async () => {
  const { session, ble, clock, posts } = await pairedSession();
  session.hold('workout', true);
  await settle();
  ble.beat(bytes(0x04, 40));
  assert.equal(session.getSnapshot().worn, true, 'inside the grace period');
  await clock.advance(16_000);
  ble.beat(bytes(0x04, 40));
  assert.equal(session.getSnapshot().worn, false);
  await clock.advance(10_000);
  assert.deepEqual(
    posts.flat().map((x) => x.at),
    [0],
  );
  ble.beat(bytes(0x06, 90));
  assert.equal(session.getSnapshot().worn, true);
});

test('a low strap battery alerts once per episode', async () => {
  const low = await pairedSession({ battery: 30 });
  low.session.hold('workout', true);
  await low.clock.advance(1);
  assert.deepEqual(low.alerts, [30]);
  assert.equal(low.session.getSnapshot().paired?.battery, 30);
  assert.equal(low.storage.values.get('strap-battery-alert.v1'), 'fired');
  await low.clock.advance(10 * 60_000);
  assert.deepEqual(low.alerts, [30], 'the next poll stays quiet');

  const already = await pairedSession({ battery: 30, alerted: true });
  already.session.hold('workout', true);
  await already.clock.advance(1);
  assert.deepEqual(already.alerts, [], 'an episode that alerted before a restart stays quiet');

  const fine = await pairedSession({ battery: 80, alerted: true });
  fine.session.hold('workout', true);
  await fine.clock.advance(1);
  assert.equal(fine.storage.values.get('strap-battery-alert.v1'), 'armed');
});

test('pairing scans for straps, and forgetting lets go of the link', async () => {
  const clock = fakeTimers();
  const ble = fakeBle();
  const storage = memoryStorage();
  const session = new StrapSession({
    ble: ble.adapter,
    storage,
    now: clock.now,
    timers: clock.timers,
  });
  await session.initialize();
  session.hold('settings', true);
  await session.scan();
  assert.equal(session.getSnapshot().found[0].name, 'Polar H10 1234ABCD');
  await session.pair(session.getSnapshot().found[0]);
  await settle();
  assert.ok(ble.log.includes('scan stopped'));
  assert.equal(session.getSnapshot().link, 'connected');
  assert.equal(JSON.parse(storage.values.get('paired-hr-strap.v1')!).id, 'AA:BB');
  await session.forget();
  assert.equal(session.getSnapshot().link, 'idle');
  assert.equal(storage.values.has('paired-hr-strap.v1'), false);
});

test('Bluetooth turned off during a workout waits, then reconnects', async () => {
  const { session, ble } = await pairedSession();
  session.hold('workout', true);
  await settle();
  ble.radio('off');
  ble.drop();
  assert.equal(session.getSnapshot().link, 'radioOff');
  ble.radio('on');
  await settle();
  assert.equal(session.getSnapshot().link, 'connected');
});

test('the strap card and workout readout name what blocks the link', async () => {
  const { strapBlocker, strapLinkLabel } = await import('../src/features/devices/strap/labels.ts');
  const { session, ble, clock } = await pairedSession();
  const base = session.getSnapshot();
  assert.equal(strapBlocker(base), null);
  assert.equal(strapBlocker({ ...base, available: false })?.title, 'Update TrainingAi Preview');
  assert.equal(
    strapBlocker({ ...base, permission: 'denied' })?.title,
    'Bluetooth permission needed',
  );
  const unpaired = { ...base, paired: null, permission: 'denied' as const };
  assert.equal(strapBlocker(unpaired), null, 'not asked yet: the pair button asks');
  assert.equal(
    strapBlocker({ ...unpaired, permissionAsked: true })?.title,
    'Bluetooth permission needed',
  );
  assert.match(strapBlocker({ ...base, permission: 'blocked' })!.message, /Settings/);
  assert.equal(strapBlocker({ ...base, radio: 'off' })?.title, 'Bluetooth is off');
  assert.equal(strapLinkLabel({ ...base, link: 'waiting' }), 'Strap not reachable — retrying');
});

test('the rest card smooths, filters and zones the trace like the current app', async () => {
  const { liveHrView } = await import('../src/features/devices/strap/labels.ts');
  const { session, ble, clock } = await pairedSession();
  session.hold('workout', true);
  await settle();
  // A strap-on 0 never shows as a number, with or without a trace.
  ble.beat(bytes(0x06, 0));
  let view = liveHrView(session.getSnapshot(), clock.now(), null, null);
  assert.equal(view.bpm, null);
  assert.equal(view.message, 'Waiting for your strap…');
  for (const bpm of [120, 124, 122, 180, 126]) {
    await clock.advance(1_000);
    ble.beat(bytes(0x06, bpm));
  }
  const snapshot = session.getSnapshot();
  // Once three readings stand, 180 jumps more than 30 bpm off their median: dropped from the trace, as in exercise-trace.
  assert.deepEqual(
    snapshot.trace.map((x) => x.bpm),
    [120, 124, 122, 126],
  );
  view = liveHrView(snapshot, clock.now(), null, { maxHr: 190, restingHr: 60 });
  assert.deepEqual(
    view.points.map((x) => x.bpm),
    [122, 122, 124, 124],
  );
  assert.equal(view.bpm, 124);
  assert.equal(view.live, true);
  // Zone 2 starts at 60 % of reserve: 60 + 0.6 × 130 = 138.
  assert.deepEqual([view.zone?.name, view.zone?.color], ['Recovery', '#3b82f6']);
  assert.equal(
    liveHrView({ ...snapshot, trace: [], bpm: 140 }, clock.now(), null, {
      maxHr: 190,
      restingHr: 60,
    }).zone?.name,
    'Light',
  );
  // The rest window starts at the rest, not the workout.
  assert.equal(liveHrView(snapshot, clock.now(), 3_000, null).points.length, 2);
  // Held and dimmed after 8 s without a beat, or once the link drops.
  assert.equal(liveHrView(snapshot, clock.now() + 9_000, null, null).stale, true);
  ble.drop();
  const dropped = liveHrView(session.getSnapshot(), clock.now(), null, null);
  assert.deepEqual([dropped.bpm, dropped.stale], [124, true]);
});

test('a permission granted in Android Settings is noticed on return', async () => {
  const { session, ble } = await pairedSession({ permission: 'blocked' });
  session.hold('workout', true);
  await settle();
  assert.deepEqual(
    [session.getSnapshot().permission, session.getSnapshot().link],
    ['blocked', 'idle'],
  );
  ble.grant('granted');
  // What the provider does when the app becomes active again.
  await session.retry();
  await settle();
  assert.deepEqual(
    [session.getSnapshot().permission, session.getSnapshot().link],
    ['granted', 'connected'],
  );
});

test('samples recorded while signed out wait for the account, never for another one', async () => {
  const { session, ble, clock, posts, outbox } = await pairedSession({ noOutbox: true });
  session.hold('workout', true);
  await settle();
  for (let i = 0; i < 45; i++) {
    ble.beat(bytes(0x06, 120));
    await clock.advance(1_000);
  }
  assert.deepEqual(posts, []);
  session.setOutbox(outbox('u1'));
  await settle();
  assert.equal(posts.flat().length, 45);

  // Signed out mid-workout, then a different account signs in: those samples are not theirs.
  session.setOutbox(null);
  ble.beat(bytes(0x06, 121));
  await clock.advance(10_000);
  session.setOutbox(outbox('u2'));
  await settle();
  assert.equal(posts.flat().length, 45);
});

test('a failed notification subscription is a lost link, and it reconnects', async () => {
  const { session, ble, clock } = await pairedSession();
  session.hold('workout', true);
  await settle();
  ble.failNotifications();
  assert.equal(session.getSnapshot().link, 'waiting');
  assert.ok(ble.log.includes('disconnect'));
  await clock.advance(2_000);
  assert.equal(session.getSnapshot().link, 'connected');
});

test('the firmware revision is recorded once, after pairing', async () => {
  const { session, storage, clock } = await pairedSession({ firmware: '3.0.35' });
  session.hold('settings', true);
  await clock.advance(1);
  assert.equal(session.getSnapshot().paired?.firmware, '3.0.35');
  assert.equal(JSON.parse(storage.values.get('paired-hr-strap.v1')!).firmware, '3.0.35');
});
