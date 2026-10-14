import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLastNight,
  isMorning,
  morningHandoffDecision,
  waitForNight,
} from '../src/features/health/data/oura-handoff.ts';
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

test('each guard stops the hand-off, and the network checks run only when the rest pass', async () => {
  const cases: [Partial<Parameters<typeof morningHandoffDecision>[0]>, string, number][] = [
    [{ enabled: false }, 'disabled', 0],
    [{ supported: false }, 'unsupported', 0],
    [{ now: Date.UTC(2026, 9, 14, 3) }, 'not_morning', 0],
    [{ now: Date.UTC(2026, 9, 13, 17, 59) }, 'not_morning', 0],
    [{ lastRunDay: '2026-10-14' }, 'already_ran', 0],
    [{ installed: () => false }, 'not_installed', 0],
    [{ lastNight: async () => true }, 'have_sleep', 0],
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

test('the setting defaults on and the hand-off has never run', () => {
  const settings = platformSchema.parse({ scope: 'x' });
  assert.equal(settings.ouraMorningSync, true);
  assert.equal(settings.ouraHandoffDay, null);
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
