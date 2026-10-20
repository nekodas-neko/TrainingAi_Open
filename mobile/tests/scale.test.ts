import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_MEASUREMENT_CMD,
  REQUEST_STORED_MEASUREMENTS_CMD,
  SCALE_SERVICE,
} from '@trainingai/shared/devices/scale-protocol';
import { encodeBase64, decodeBase64 } from '../src/integrations/ble/base64.ts';
import {
  ScaleOutbox,
  type ScaleReading,
} from '../src/features/devices/scale/ScaleOutbox.ts';
import {
  CYCLE_BUDGET_MS,
  ScaleSession,
} from '../src/features/devices/scale/ScaleSession.ts';
import {
  resultOfVerdict,
  resultText,
  scaleBlocker,
  scaleLinkLabel,
} from '../src/features/devices/scale/labels.ts';
import {
  scaleTodaySpec,
  scaleWaitingSpec,
  scaleWritePaths,
} from '../src/features/devices/scale/data.ts';
import { manualHealthWritePaths } from '../src/features/health/data/manual-write-paths.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import type {
  BleAdapter,
  BlePermission,
  BleRadio,
  ScaleLink,
} from '../src/integrations/ble/types.ts';
import type { ScopedStorage } from '../src/core/storage/LocalStorage.ts';

const hex = (s: string) => Uint8Array.from(s.split('-').map((b) => parseInt(b, 16)));
// The owner's real captures (see the shared decoder's test).
const UNSTABLE = hex('10-0B-15-1B-B2-00-00-00-00-00-FD'); // 70.90 kg
const FINAL = hex('10-0B-15-1B-B7-01-01-F9-01-F7-F5'); // 70.95 kg, 505 / 503 Ω
const HANDSHAKE = hex('12-0F-15-07-B4-ED-38-C1-A4-38-01-38-00-07-F3');

function memoryStorage(seed: Record<string, string> = {}): ScopedStorage {
  const values = new Map(Object.entries(seed));
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fakeTimers() {
  let now = 1_800_000_000_000;
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

test('write characteristics are sent as base64 and read back the same', () => {
  const command = Uint8Array.from(REQUEST_MEASUREMENT_CMD);
  assert.equal(encodeBase64(command), 'EwkVARAAAABC');
  assert.deepEqual(decodeBase64(encodeBase64(command)), command);
  for (const length of [0, 1, 2, 3, 4, 11]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 5) & 0xff);
    assert.deepEqual(decodeBase64(encodeBase64(bytes)) ?? new Uint8Array(), bytes);
  }
});

const reading = (over: Partial<ScaleReading> = {}): ScaleReading => ({
  rawHex: '100b151bb70101f901f7f5',
  weightKg: 70.95,
  impedanceOhmsA: 505,
  impedanceOhmsB: 503,
  measuredAt: '2026-10-20T01:00:00.000Z',
  ...over,
});
const connection = (
  post: (path: string, body: unknown) => Promise<unknown>,
  userId = 'u1',
) => ({
  origin: 'https://example.test',
  userId,
  post,
});

test('a weigh-in is saved on the phone first, then sent with the moment it was taken', async () => {
  const posts: { path: string; body: unknown }[] = [];
  const outcomes: string[] = [];
  const outbox = new ScaleOutbox(
    memoryStorage(),
    connection(async (path, body) => {
      posts.push({ path, body });
      return { status: 'confirmed', weightKg: 70.95, isAdditionalReadingForDay: false };
    }),
    (outcome) => outcomes.push(outcome.kind),
  );
  await outbox.append(reading());
  assert.equal(outbox.pending(), 1);
  await outbox.sync();
  assert.deepEqual(posts, [{ path: '/api/scale-ble/samples', body: reading() }]);
  assert.equal(outbox.pending(), 0);
  assert.deepEqual(outcomes, ['verdict']);
});

test('the outbox keeps readings through an outage, drops only refused ones, and files in order', async () => {
  let mode: 'offline' | 'refuse' | 'ok' = 'offline';
  const sent: number[] = [];
  const outcomes: string[] = [];
  const outbox = new ScaleOutbox(
    memoryStorage(),
    connection(async (_path, body) => {
      const weight = (body as ScaleReading).weightKg;
      if (mode === 'offline') throw new Error('offline');
      if (mode === 'refuse' && weight === 71) throw new ApiError(400);
      sent.push(weight);
      return { status: 'confirmed' };
    }),
    (outcome) => outcomes.push(outcome.kind),
  );
  await outbox.append(reading({ weightKg: 70, rawHex: 'a' }));
  await outbox.append(reading({ weightKg: 71, rawHex: 'b' }));
  await outbox.append(reading({ weightKg: 72, rawHex: 'c' }));
  await outbox.sync();
  assert.equal(outbox.pending(), 3, 'nothing is lost to a dead connection');
  mode = 'refuse';
  await outbox.sync();
  assert.deepEqual(sent, [70, 72]);
  assert.deepEqual(outcomes, ['verdict', 'rejected', 'verdict']);
  assert.equal(outbox.pending(), 0);
});

test('readings survive a restart and are never filed under another account', async () => {
  const storage = memoryStorage();
  const first = new ScaleOutbox(
    storage,
    connection(async () => Promise.reject(new Error('x'))),
  );
  await first.append(reading());
  const posts: string[] = [];
  const same = new ScaleOutbox(
    storage,
    connection(async () => {
      posts.push('u1');
      return { status: 'confirmed' };
    }),
  );
  await same.sync();
  assert.deepEqual(posts, ['u1']);

  const sentAsOther: unknown[] = [];
  const other = new ScaleOutbox(
    storage,
    connection(async (_path, body) => {
      sentAsOther.push(body);
      return { status: 'confirmed' };
    }, 'u2'),
  );
  await first.append(reading({ rawHex: 'z' }));
  await other.sync();
  assert.equal(other.pending(), 0);
  assert.deepEqual(sentAsOther, [], 'u2 never files the first account’s weigh-in');
});

test('the server’s verdict reads as the current app’s toast does', () => {
  assert.deepEqual(resultOfVerdict({ status: 'confirmed', weightKg: 70.9 }, 70), {
    kind: 'logged',
    weightKg: 70.9,
    additional: false,
  });
  assert.deepEqual(
    resultOfVerdict({ status: 'confirmed', isAdditionalReadingForDay: true }, 70.95),
    { kind: 'logged', weightKg: 70.95, additional: true },
  );
  assert.deepEqual(
    resultOfVerdict(
      {
        status: 'confirmed',
        compositionSkipped: true,
        compositionSkippedReason: 'impedance',
      },
      70.95,
    ),
    { kind: 'skipped', weightKg: 70.95, reason: 'impedance' },
  );
  // An older deploy sends no reason; the contact problem is the one the current app has always said.
  assert.equal(
    (
      resultOfVerdict({ status: 'confirmed', compositionSkipped: true }, 70) as {
        reason: string;
      }
    ).reason,
    'impedance',
  );
  assert.equal(resultOfVerdict({ status: 'pending', weightKg: 80 }, 80).kind, 'pending');
  assert.equal(
    resultOfVerdict({ status: 'dismissed', weightKg: 55 }, 55).kind,
    'declined',
  );

  assert.deepEqual(resultText({ kind: 'logged', weightKg: 70.95, additional: true }), {
    title: '71.0 kg logged',
    description: 'Additional reading today',
  });
  assert.equal(
    resultText({ kind: 'skipped', weightKg: 70, reason: 'impedance' }).description,
    'Body composition skipped — stand barefoot on the plates',
  );
  assert.match(
    resultText({ kind: 'skipped', weightKg: 70, reason: 'profile' }).description ?? '',
    /height, birth date and sex/,
  );
  assert.equal(
    resultText({ kind: 'pending', weightKg: 80 }).title,
    '80.0 kg — looks different from usual',
  );
  assert.equal(resultText({ kind: 'failed' }).title, 'Didn’t catch that');
  // A declined reading is never reported as logged.
  assert.doesNotMatch(resultText({ kind: 'declined', weightKg: 55 }).title, /logged/);
});

test('the pending lists and today’s readings parse the routes’ answers', () => {
  assert.deepEqual(
    scaleWaitingSpec.schema.parse({
      pending: [{ id: 3, measuredAt: '2026-10-20T01:00:00.000Z', weightKg: 80.2 }],
    }),
    {
      pending: [{ id: 3, measuredAt: '2026-10-20T01:00:00.000Z', weightKg: 80.2 }],
      dismissed: [],
    },
  );
  assert.equal(
    scaleWaitingSpec.schema.parse({
      pending: [],
      dismissed: [{ id: 9, measuredAt: '2026-10-19T01:00:00.000Z', weightKg: null }],
    }).dismissed[0].weightKg,
    null,
  );
  const today = scaleTodaySpec.schema.parse({
    readings: [
      {
        id: 1,
        measuredAt: '2026-10-20T01:00:00.000Z',
        isTrend: true,
        weightKg: 70.95,
        bodyFatPct: 20.5,
        impedanceOhmsA: 505,
        visceralFatIndex: 4,
      },
    ],
  });
  assert.equal(today.readings[0].bodyFatPct, 20.5);
  // A filed weigh-in refreshes the weight views the current app clears, and the scale's own lists.
  for (const path of ['/api/scale-ble', '/api/body-metadata', ...manualHealthWritePaths])
    assert.ok(scaleWritePaths.includes(path), path);
});

type FakeOptions = { permission?: BlePermission; radio?: BleRadio };
function fakeScaleBle(options: FakeOptions = {}) {
  let permission: BlePermission = options.permission ?? 'granted';
  let radio: BleRadio = options.radio ?? 'on';
  let radioListener: ((radio: BleRadio) => void) | null = null;
  const log: string[] = [];
  const writes: number[][] = [];
  const scans: (string | undefined)[] = [];
  let onFound:
    | ((device: { id: string; name: string | null; rssi: number | null }) => void)
    | null = null;
  let failConnects = 0;
  let drop: (() => void) | null = null;
  let notify: ((value: Uint8Array) => void) | null = null;
  let subscriptionFailed: (() => void) | null = null;
  let failWrites = false;
  const adapter: BleAdapter = {
    available: true,
    radio: async () => radio,
    onRadioChange: (listener) => {
      radioListener = listener;
      return () => {};
    },
    permission: async () => permission,
    scan: (found, _error, service) => {
      scans.push(service);
      onFound = found;
      return () => {
        onFound = null;
        log.push('scan stopped');
      };
    },
    connect: async () => {
      throw new Error('not a strap');
    },
    connectScale: async (id, onDisconnected) => {
      log.push(`connect ${id}`);
      if (failConnects > 0) {
        failConnects--;
        throw new Error('unreachable');
      }
      drop = onDisconnected;
      const link: ScaleLink = {
        onMeasurement: (listener, onFailed) => {
          notify = listener;
          subscriptionFailed = onFailed;
          return () => {
            notify = null;
          };
        },
        request: async (command) => {
          if (failWrites) throw new Error('write rejected');
          writes.push([...command]);
        },
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
    writes,
    scans,
    see: (id = 'A4:C1', name: string | null = 'QN-Scale', rssi: number | null = -55) =>
      onFound?.({ id, name, rssi }),
    scanning: () => onFound !== null,
    failConnects: (count: number) => {
      failConnects = count;
    },
    failWrites: () => {
      failWrites = true;
    },
    drop: () => drop?.(),
    notify: (value: Uint8Array) => notify?.(value),
    failSubscription: () => subscriptionFailed?.(),
    setRadio: (next: BleRadio) => {
      radio = next;
      radioListener?.(next);
    },
    grant: (next: BlePermission) => {
      permission = next;
    },
  };
}

async function pairedSession(
  options: FakeOptions & { noOutbox?: boolean; noPair?: boolean } = {},
) {
  const clock = fakeTimers();
  const ble = fakeScaleBle(options);
  const storage = memoryStorage(
    options.noPair
      ? {}
      : { 'paired-scale.v1': JSON.stringify({ id: 'A4:C1', name: 'QN-Scale' }) },
  );
  const session = new ScaleSession({
    ble: ble.adapter,
    storage,
    now: clock.now,
    timers: clock.timers,
  });
  const posts: ScaleReading[] = [];
  let verdict: Record<string, unknown> = { status: 'confirmed', weightKg: 70.95 };
  let online = true;
  const outbox = (userId = 'u1') =>
    new ScaleOutbox(
      memoryStorage(),
      connection(async (_path, body) => {
        if (!online) throw new Error('offline');
        posts.push(body as ScaleReading);
        return verdict;
      }, userId),
      (outcome) => session.applyOutcome(outcome),
    );
  if (!options.noOutbox) session.setOutbox(outbox());
  await session.initialize();
  return {
    session,
    ble,
    clock,
    storage,
    posts,
    outbox,
    setVerdict: (next: Record<string, unknown>) => {
      verdict = next;
    },
    setOnline: (next: boolean) => {
      online = next;
    },
  };
}

test('with the Devices screen open the paired scale is listened for, then connected the moment it is seen', async () => {
  const { session, ble } = await pairedSession();
  assert.equal(session.getSnapshot().phase, 'idle');
  assert.equal(ble.scanning(), false, 'nothing scans while no screen wants the scale');
  session.hold('settings', true);
  assert.equal(session.getSnapshot().phase, 'listening');
  assert.deepEqual(ble.scans, [SCALE_SERVICE]);
  ble.see('AA:BB', 'Some other scale');
  assert.equal(
    ble.log.some((line) => line.startsWith('connect')),
    false,
    'another scale is ignored',
  );
  ble.see('A4:C1');
  await settle();
  assert.deepEqual(ble.log, ['scan stopped', 'connect A4:C1']);
  assert.equal(session.getSnapshot().phase, 'connecting');
  // Subscribed first, then the live request, then the speculative stored-readings request.
  assert.deepEqual(ble.writes, [
    [...REQUEST_MEASUREMENT_CMD],
    [...REQUEST_STORED_MEASUREMENTS_CMD],
  ]);
  ble.notify(HANDSHAKE);
  assert.equal(
    session.getSnapshot().phase,
    'connected',
    'any notification proves the link alive',
  );
});

test('a weigh-in shows the settling weight, is saved on the phone, filed, and reported', async () => {
  const { session, ble, posts, clock } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(HANDSHAKE);
  ble.notify(UNSTABLE);
  assert.equal(session.getSnapshot().phase, 'weighing');
  assert.equal(session.getSnapshot().weightKg, 70.9);
  assert.equal(scaleLinkLabel(session.getSnapshot()), 'Weighing you… 70.9 kg');
  ble.notify(FINAL);
  await settle();
  await settle();
  assert.equal(posts.length, 1);
  assert.deepEqual(
    { ...posts[0], measuredAt: undefined },
    {
      rawHex: '100b151bb70101f901f7f5',
      weightKg: 70.95,
      impedanceOhmsA: 505,
      impedanceOhmsB: 503,
      measuredAt: undefined,
    },
  );
  assert.equal(posts[0].measuredAt, new Date(clock.now()).toISOString());
  const state = session.getSnapshot();
  assert.deepEqual(state.result, { kind: 'logged', weightKg: 70.95, additional: false });
  assert.equal(state.phase, 'connected');
  assert.equal(state.weightKg, null);
  assert.equal(state.queued, 0);
});

test('the same stable frame repeated by the scale is one weigh-in, a changed one is another', async () => {
  const { session, ble, posts, clock } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(FINAL);
  await clock.advance(500);
  ble.notify(FINAL);
  await clock.advance(500);
  ble.notify(FINAL);
  await settle();
  assert.equal(posts.length, 1);
  await clock.advance(11_000);
  ble.notify(FINAL);
  await settle();
  await settle();
  assert.equal(posts.length, 2, 'after the window the same bytes are a new weigh-in');
});

test('a replay of the capture just taken does not start a new weigh-in', async () => {
  const { session, ble } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(FINAL);
  await settle();
  await settle();
  const replay = hex('10-0B-15-1B-B7-00-00-00-00-00-02'); // 70.95 kg, unsettled
  ble.notify(replay);
  assert.equal(session.getSnapshot().phase, 'connected', 'nobody stepped on');
  ble.notify(UNSTABLE); // 70.90: a different weight is someone stepping on
  assert.equal(session.getSnapshot().phase, 'weighing');
});

test('the scale dropping its link after a reading is housekeeping, not a failed weigh-in', async () => {
  const { session, ble, clock } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(UNSTABLE);
  ble.notify(FINAL);
  await settle();
  await settle();
  ble.drop();
  await settle();
  assert.equal(session.getSnapshot().phase, 'listening');
  assert.equal(ble.scanning(), true);
  await clock.advance(60_000);
  assert.deepEqual(session.getSnapshot().result, {
    kind: 'logged',
    weightKg: 70.95,
    additional: false,
  });
});

test('a connect that keeps failing retries inside the budget, then waits for the next wake', async () => {
  const { session, ble, clock } = await pairedSession();
  ble.failConnects(99);
  session.hold('settings', true);
  ble.see();
  await settle();
  assert.equal(ble.log.filter((x) => x.startsWith('connect')).length, 1);
  await clock.advance(2_000);
  assert.equal(ble.log.filter((x) => x.startsWith('connect')).length, 2);
  await clock.advance(CYCLE_BUDGET_MS);
  const attempts = ble.log.filter((x) => x.startsWith('connect')).length;
  assert.ok(attempts <= 5, `${attempts} attempts`);
  assert.equal(session.getSnapshot().phase, 'listening');
  assert.equal(
    session.getSnapshot().result,
    null,
    'nobody was seen on the scale, so nothing was missed',
  );
});

test('a weigh-in seen starting and never captured is reported as missed once', async () => {
  const { session, ble, clock } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(UNSTABLE);
  // The link goes quiet before a stable frame; reconnects keep failing past the budget.
  ble.failConnects(99);
  ble.failSubscription();
  await settle();
  await clock.advance(CYCLE_BUDGET_MS + 2_000);
  assert.deepEqual(session.getSnapshot().result, { kind: 'failed' });
});

test('a link that is connected but never delivers is dropped and retried', async () => {
  const { session, ble, clock } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  assert.equal(ble.log.filter((x) => x === 'connect A4:C1').length, 1);
  await clock.advance(5_000);
  await clock.advance(2_000);
  assert.ok(
    ble.log.filter((x) => x === 'connect A4:C1').length >= 2,
    'it connected again',
  );
});

test('a write the scale rejects before it has said anything is a lost link', async () => {
  const { session, ble, clock } = await pairedSession();
  ble.failWrites();
  session.hold('settings', true);
  ble.see();
  await settle();
  await clock.advance(2_000);
  assert.ok(ble.log.filter((x) => x === 'connect A4:C1').length >= 2);
  assert.notEqual(session.getSnapshot().phase, 'connected');
});

test('leaving the screen stops scanning and lets go of the scale', async () => {
  const { session, ble } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(HANDSHAKE);
  session.hold('settings', false);
  await settle();
  assert.ok(ble.log.includes('disconnect'));
  assert.equal(session.getSnapshot().phase, 'idle');
  session.hold('settings', true);
  assert.equal(ble.scanning(), true, 'back on the screen it listens again');
});

test('a verdict that needs an answer, and one that was filed, each read as the current app words them', async () => {
  const { session, ble, setVerdict, posts } = await pairedSession();
  session.hold('settings', true);
  ble.see();
  await settle();
  setVerdict({ status: 'pending', weightKg: 80.1 });
  ble.notify(hex('10-0B-15-1F-51-01-01-F9-01-F7-93'));
  await settle();
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(session.getSnapshot().result?.kind, 'pending');
});

test('a weigh-in taken offline is kept and filed when the connection is back', async () => {
  const { session, ble, setOnline, posts } = await pairedSession();
  setOnline(false);
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(FINAL);
  await settle();
  await settle();
  assert.equal(posts.length, 0);
  assert.equal(session.getSnapshot().queued, 1);
  assert.equal(session.getSnapshot().result?.kind, 'saved');
  setOnline(true);
  session.sync();
  await settle();
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(session.getSnapshot().queued, 0);
  assert.equal(session.getSnapshot().result?.kind, 'logged');
});

test('with no account to file under, a weigh-in is reported as not caught rather than lost silently', async () => {
  const { session, ble } = await pairedSession({ noOutbox: true });
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(FINAL);
  await settle();
  assert.deepEqual(session.getSnapshot().result, { kind: 'failed' });
});

test('pairing scans for scales by their service, lists them by signal, and forgetting lets go', async () => {
  const { session, ble, storage } = await pairedSession({ noPair: true });
  await session.scan();
  assert.equal(session.getSnapshot().scanning, true);
  assert.deepEqual(ble.scans, [SCALE_SERVICE]);
  ble.see('X1', 'Far scale', -90);
  ble.see('X2', 'Near scale', -50);
  assert.deepEqual(
    session.getSnapshot().found.map((x) => x.id),
    ['X2', 'X1'],
  );
  await session.pair(session.getSnapshot().found[0]);
  assert.deepEqual(session.getSnapshot().paired, { id: 'X2', name: 'Near scale' });
  assert.equal(
    await storage.get('paired-scale.v1'),
    JSON.stringify({ id: 'X2', name: 'Near scale' }),
  );
  session.hold('settings', true);
  ble.see('X2');
  await settle();
  assert.ok(ble.log.includes('connect X2'));
  await session.forget();
  assert.equal(session.getSnapshot().paired, null);
  assert.equal(await storage.get('paired-scale.v1'), null);
  assert.ok(ble.log.includes('disconnect'));
  assert.equal(session.getSnapshot().phase, 'idle');
});

test('Bluetooth off or a missing permission is named and nothing scans', async () => {
  const off = await pairedSession({ radio: 'off' });
  off.session.hold('settings', true);
  assert.equal(off.ble.scanning(), false);
  assert.equal(off.session.getSnapshot().phase, 'radioOff');
  assert.equal(scaleBlocker(off.session.getSnapshot())?.title, 'Bluetooth is off');
  off.ble.setRadio('on');
  await settle();
  assert.equal(off.ble.scanning(), true, 'it listens as soon as Bluetooth is back');

  const denied = await pairedSession({ permission: 'denied' });
  denied.session.hold('settings', true);
  assert.equal(denied.ble.scanning(), false);
  assert.equal(
    scaleBlocker(denied.session.getSnapshot())?.title,
    'Bluetooth permission needed',
  );
  denied.ble.grant('granted');
  await denied.session.retry();
  assert.equal(
    denied.ble.scanning(),
    true,
    'a permission granted in Settings is noticed on return',
  );

  const blocked = await pairedSession({ permission: 'blocked' });
  assert.equal(
    scaleBlocker(blocked.session.getSnapshot())?.title,
    'Nearby devices is off for TrainingAi',
  );
});

test('weigh-ins queued for one account are not filed as another’s after a switch', async () => {
  const { session, outbox, setOnline, ble, posts } = await pairedSession();
  setOnline(false);
  session.hold('settings', true);
  ble.see();
  await settle();
  ble.notify(FINAL);
  await settle();
  await settle();
  assert.equal(session.getSnapshot().queued, 1);
  setOnline(true);
  session.setOutbox(outbox('u2'));
  await settle();
  await settle();
  assert.equal(session.getSnapshot().queued, 0, 'u2’s own outbox is empty');
  assert.equal(posts.length, 0, 'u1’s reading was not sent as u2’s');
});

test('Look for the scale restarts a listen that is already running', async () => {
  const { session, ble } = await pairedSession();
  session.hold('settings', true);
  assert.equal(ble.scans.length, 1);
  await session.retry();
  assert.equal(ble.scans.length, 2, 'a fresh scan was started');
  assert.equal(ble.scanning(), true);
  assert.equal(
    ble.log.filter((line) => line === 'scan stopped').length,
    1,
    'the old one was stopped',
  );
});
