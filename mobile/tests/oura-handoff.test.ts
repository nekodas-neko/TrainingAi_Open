import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE,
  createHandoffRunner,
  currentHandoffState,
  hasLastNight,
  isMorning,
  morningHandoffDecision,
  waitForNight,
  type HandoffDeps,
  type HandoffState,
} from '../src/features/health/data/oura-handoff.ts';
import type { HandoffOutcome } from '../src/integrations/app-handoff/types.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';
import type { SleepRow } from '../src/features/health/data/models.ts';

const tz = 'Australia/Brisbane';
// 07:00 on 14 Oct 2026 in Brisbane (UTC+10).
const morning = Date.UTC(2026, 9, 13, 21);
const night = (date: string, extra: Partial<SleepRow> = {}) =>
  ({ date, durationHours: 7.2, ...extra }) as SleepRow;

function inputs(overrides: Partial<Parameters<typeof morningHandoffDecision>[0]> = {}) {
  const calls = { lastNight: 0, connected: 0 };
  return {
    calls,
    input: {
      enabled: true,
      supported: true,
      installed: () => true,
      lastRunDay: '2026-10-13',
      now: morning,
      timezone: tz,
      lastNight: async () => {
        calls.lastNight++;
        return false;
      },
      connected: async () => {
        calls.connected++;
        return true;
      },
      ...overrides,
    },
  };
}

test('hands off on a morning open when Oura is connected and last night is missing', async () => {
  const { input } = inputs();
  assert.deepEqual(await morningHandoffDecision(input), { run: true, day: '2026-10-14' });
});

test('each guard stops the hand-off, and the network checks run only when the rest pass, connection first', async () => {
  const cases: [Partial<Parameters<typeof morningHandoffDecision>[0]>, string, number][] = [
    [{ enabled: false }, 'disabled', 0],
    [{ supported: false }, 'unsupported', 0],
    [{ now: Date.UTC(2026, 9, 14, 3) }, 'not_morning', 0],
    [{ now: Date.UTC(2026, 9, 13, 17, 59) }, 'not_morning', 0],
    [{ lastRunDay: '2026-10-14' }, 'already_ran', 0],
    [{ installed: () => false }, 'not_installed', 0],
    [{ lastNight: async () => true }, 'have_sleep', 1],
    [{ connected: async () => false }, 'not_connected', 1],
  ];
  for (const [override, reason, connectedCalls] of cases) {
    const { input, calls } = inputs(override);
    const counted = override.connected
      ? {
          ...input,
          connected: async () => {
            calls.connected++;
            return override.connected!();
          },
        }
      : input;
    assert.deepEqual(await morningHandoffDecision(counted), { run: false, reason }, reason);
    assert.equal(calls.connected, connectedCalls, reason);
    // The forced sleep refresh only runs for a connected user.
    assert.equal(calls.lastNight, 0, reason);
  }
});

test('a manual Sync now skips the setting, morning window and once-a-morning guard only', async () => {
  const afternoon = Date.UTC(2026, 9, 14, 5);
  const { input } = inputs({
    manual: true,
    enabled: false,
    now: afternoon,
    lastRunDay: '2026-10-14',
  });
  assert.deepEqual(await morningHandoffDecision(input), { run: true, day: '2026-10-14' });
  for (const [override, reason] of [
    [{ installed: () => false }, 'not_installed'],
    [{ lastNight: async () => true }, 'have_sleep'],
    [{ connected: async () => false }, 'not_connected'],
  ] as const) {
    assert.deepEqual(
      await morningHandoffDecision({ ...input, ...override }),
      { run: false, reason },
    );
  }
});

test('morning is 04:00 to noon in the user timezone, not the phone clock', () => {
  assert.equal(isMorning(Date.UTC(2026, 9, 13, 18), tz), true);
  assert.equal(isMorning(Date.UTC(2026, 9, 14, 1, 59), tz), true);
  assert.equal(isMorning(Date.UTC(2026, 9, 14, 2), tz), false);
  assert.equal(isMorning(Date.UTC(2026, 9, 13, 21), 'Europe/London'), false);
});

test('last night is a finished night dated today', () => {
  assert.equal(hasLastNight([night('2026-10-14')], '2026-10-14'), true);
  assert.equal(hasLastNight([night('2026-10-13')], '2026-10-14'), false);
  assert.equal(hasLastNight([night('2026-10-14', { durationHours: null })], '2026-10-14'), false);
  assert.equal(hasLastNight([night('2026-10-14', { provisional: true })], '2026-10-14'), false);
});

test('the setting defaults off until the switch, and the hand-off has never run', () => {
  const settings = platformSchema.parse({ scope: 'x' });
  assert.equal(settings.ouraMorningSync, false);
  assert.equal(settings.ouraHandoffDay, null);
  assert.equal(settings.ouraHandoffStrandedDay, null);
});

function clock() {
  let at = 0;
  return {
    now: () => at,
    sleep: async (ms: number) => {
      at += ms;
    },
  };
}

test('waiting stops as soon as the night lands', async () => {
  const time = clock();
  let checks = 0;
  const outcome = await waitForNight({
    ...time,
    cancelled: () => false,
    landed: async () => ++checks === 3,
    intervalMs: 5_000,
    timeoutMs: 120_000,
  });
  assert.equal(outcome, 'landed');
  assert.equal(checks, 3);
  assert.equal(time.now(), 15_000);
});

test('waiting gives up at the timeout and never runs past it', async () => {
  const time = clock();
  let checks = 0;
  const outcome = await waitForNight({
    ...time,
    cancelled: () => false,
    landed: async () => {
      checks++;
      return false;
    },
    intervalMs: 5_000,
    timeoutMs: 12_000,
  });
  assert.equal(outcome, 'timeout');
  assert.equal(checks, 3);
  assert.equal(time.now(), 12_000);
});

test('a failed check keeps waiting, and cancelling stops without another check', async () => {
  const time = clock();
  let checks = 0;
  let cancelled = false;
  const outcome = await waitForNight({
    ...time,
    cancelled: () => cancelled,
    landed: async () => {
      checks++;
      if (checks === 1) throw new Error('offline');
      cancelled = true;
      return false;
    },
    intervalMs: 5_000,
    timeoutMs: 120_000,
  });
  assert.equal(outcome, 'cancelled');
  assert.equal(checks, 2);
});

// A fake world for the runner: settings stored in memory, a log of every side effect in order.
function world(overrides: Partial<HandoffDeps> & { outcome?: HandoffOutcome } = {}) {
  const log: string[] = [];
  const states: HandoffState[] = [];
  const stored = { enabled: true, lastRunDay: '2026-10-13' as string | null, stranded: null as string | null };
  let active = true;
  const deps: HandoffDeps = {
    settings: async () => ({ enabled: stored.enabled, lastRunDay: stored.lastRunDay }),
    supported: true,
    installed: () => true,
    now: () => morning,
    timezone: () => tz,
    connected: async () => {
      log.push('connected');
      return true;
    },
    lastNight: async () => {
      log.push('lastNight');
      return false;
    },
    active: () => active,
    saveDay: async (day) => {
      log.push(`saveDay ${day}`);
      stored.lastRunDay = day;
    },
    open: async (manual) => {
      log.push(`open ${manual ? 'manual' : 'auto'} (saved ${stored.lastRunDay})`);
      return { outcome: overrides.outcome ?? 'returned' };
    },
    stayedBehind: async (day) => {
      log.push(`stayedBehind ${day}`);
      stored.enabled = false;
      stored.stranded = day;
    },
    wait: async () => {
      log.push('wait');
      return 'landed';
    },
    setState: (state) => states.push(state),
    ...overrides,
  };
  return {
    log,
    states,
    stored,
    setActive: (value: boolean) => {
      active = value;
    },
    runner: createHandoffRunner(deps),
  };
}

test('the runner saves the day before Oura opens, then waits for the night', async () => {
  const w = world();
  assert.deepEqual(await w.runner.run(false), { kind: 'waited', outcome: 'returned', wait: 'landed' });
  assert.deepEqual(w.log, [
    'connected',
    'lastNight',
    'saveDay 2026-10-14',
    'open auto (saved 2026-10-14)',
    'wait',
  ]);
  assert.deepEqual(w.states, [{ status: 'syncing', day: '2026-10-14' }, IDLE]);
});

test('returning to the front mid-run starts nothing, and the next foreground finds it already ran', async () => {
  let release!: () => void;
  const w = world({
    wait: () => new Promise((resolve) => (release = () => resolve('timeout'))),
  });
  const first = w.runner.run(false);
  // AppState 'active' fires while Oura hands back and the wait is in flight.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await w.runner.run(false), { kind: 'skipped', reason: 'running' });
  release();
  assert.deepEqual(await first, { kind: 'waited', outcome: 'returned', wait: 'timeout' });
  assert.deepEqual(w.states.at(-1), { status: 'timeout', day: '2026-10-14' });
  assert.deepEqual(await w.runner.run(false), { kind: 'skipped', reason: 'already_ran' });
  assert.equal(w.log.filter((line) => line.startsWith('open')).length, 1);
});

test('Oura never opens once the app has left the front', async () => {
  const before = world();
  before.setActive(false);
  assert.deepEqual(await before.runner.run(false), { kind: 'skipped', reason: 'not_foreground' });
  assert.equal(before.stored.lastRunDay, '2026-10-13');
  assert.ok(!before.log.some((line) => line.startsWith('open')));

  // Left while the day was being saved: the day is put back so a later open can still run.
  const during = world({
    saveDay: async (day) => {
      during.log.push(`saveDay ${day}`);
      during.stored.lastRunDay = day;
      during.setActive(false);
    },
  });
  assert.deepEqual(await during.runner.run(false), { kind: 'skipped', reason: 'not_foreground' });
  assert.equal(during.stored.lastRunDay, '2026-10-13');
  assert.ok(!during.log.some((line) => line.startsWith('open')));
});

test('only returned and stayed_behind wait for the night; every other outcome goes idle', async () => {
  for (const outcome of ['never_left', 'not_installed', 'launch_failed', 'busy', 'not_foreground'] as const) {
    const w = world({ outcome });
    assert.deepEqual(await w.runner.run(false), { kind: 'not_opened', outcome }, outcome);
    assert.ok(!w.log.includes('wait'), outcome);
    assert.deepEqual(w.states.at(-1), IDLE, outcome);
  }
  // Natively refused for not being in front: today's run is given back.
  const behind = world({ outcome: 'not_foreground' });
  await behind.runner.run(false);
  assert.equal(behind.stored.lastRunDay, '2026-10-13');

  const thrown = world({ open: async () => Promise.reject(new Error('gone')) });
  assert.deepEqual(await thrown.runner.run(false), { kind: 'not_opened', outcome: 'failed' });
  assert.deepEqual(thrown.states.at(-1), IDLE);

  const manual = world({ outcome: 'launch_failed' });
  await manual.runner.run(true);
  assert.deepEqual(manual.states.at(-1), { status: 'not_opened', day: '2026-10-14' });
});

test('staying behind Oura turns the automatic runs off, and still waits for the night', async () => {
  const w = world({ outcome: 'stayed_behind' });
  assert.deepEqual(await w.runner.run(false), { kind: 'waited', outcome: 'stayed_behind', wait: 'landed' });
  assert.deepEqual(w.log.slice(-2), ['stayedBehind 2026-10-14', 'wait']);
  assert.equal(w.stored.enabled, false);
  assert.equal(w.stored.stranded, '2026-10-14');
  // Tomorrow morning nothing runs.
  w.stored.lastRunDay = '2026-10-14';
  const tomorrow = createHandoffRunner({
    settings: async () => ({ enabled: w.stored.enabled, lastRunDay: w.stored.lastRunDay }),
    supported: true,
    installed: () => true,
    now: () => morning + 86_400_000,
    timezone: () => tz,
    connected: async () => true,
    lastNight: async () => false,
    active: () => true,
    saveDay: async () => {},
    open: async () => assert.fail('opened'),
    stayedBehind: async () => {},
    wait: async () => 'landed',
    setState: () => {},
  });
  assert.deepEqual(await tomorrow.run(false), { kind: 'skipped', reason: 'disabled' });
});

test('a disconnected or already-synced morning is checked once, not on every foreground', async () => {
  for (const [key, reason] of [
    ['connected', 'not_connected'],
    ['lastNight', 'have_sleep'],
  ] as const) {
    let checks = 0;
    const w = world({
      [key]: async () => {
        checks++;
        return key === 'lastNight';
      },
    });
    assert.deepEqual(await w.runner.run(false), { kind: 'skipped', reason }, reason);
    assert.deepEqual(await w.runner.run(false), { kind: 'skipped', reason: 'already_ran' }, reason);
    assert.equal(checks, 1, reason);
    assert.deepEqual(w.states, [], reason);
  }
});

test('a skipped manual Sync now says why', async () => {
  for (const [override, status] of [
    [{ connected: async () => false }, 'not_connected'],
    [{ installed: () => false }, 'not_installed'],
  ] as const) {
    const w = world(override);
    await w.runner.run(true);
    assert.deepEqual(w.states, [{ status, day: '2026-10-14' }], status);
  }
  const synced = world({ lastNight: async () => true });
  await synced.runner.run(true);
  assert.deepEqual(synced.states, [IDLE]);
});

test('the card forgets a timeout on a new day or once the setting is off', () => {
  const timeout: HandoffState = { status: 'timeout', day: '2026-10-14' };
  assert.deepEqual(currentHandoffState(timeout, '2026-10-14', true), timeout);
  assert.deepEqual(currentHandoffState(timeout, '2026-10-15', true), IDLE);
  assert.deepEqual(currentHandoffState(timeout, '2026-10-14', false), IDLE);
  const syncing: HandoffState = { status: 'syncing', day: '2026-10-14' };
  assert.deepEqual(currentHandoffState(syncing, '2026-10-14', false), syncing);
});
