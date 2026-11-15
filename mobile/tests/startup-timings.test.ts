import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppLoadSchema } from '@trainingai/shared/validation/app-load';
import {
  STARTUP_DEADLINE_MS,
  StartupTimings,
  nativeStartMs,
  type StartupRow,
} from '../src/core/reporting/StartupTimings.ts';
import { startupTabStates } from '../src/app/startup-tab-states.ts';

const build = { platform: 'android' as const, appVersion: '1.4.0', buildCode: '212' };

function harness(nativeMs: number | null = 400, foreground = true) {
  let now = 1_000;
  const timers: Array<{ at: number; run: () => void }> = [];
  const sent: StartupRow[] = [];
  const timings = new StartupTimings(1_000, () => now, (run, ms) => timers.push({ at: now + ms, run }));
  timings.enable(build, nativeMs, foreground);
  timings.connect('user-1', async (path, body) => {
    assert.equal(path, '/api/app-load');
    sent.push(body);
  });
  return {
    timings,
    sent,
    at(ms: number) {
      now = 1_000 + ms;
      for (const timer of timers.splice(0)) {
        if (timer.at <= now) timer.run();
        else timers.push(timer);
      }
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a start reports its four marks once, as rows the intake accepts', async () => {
  const h = harness();
  h.at(900);
  h.timings.mark('start', true);
  h.at(1_300);
  h.timings.observe('workout', true, true);
  h.at(2_000);
  h.timings.observe('health', true, false);
  h.timings.observe('home', true, false);
  assert.equal(h.sent.length, 0, 'nothing goes until every mark is in');
  h.at(3_100);
  h.timings.observe('health', true, true);
  h.timings.observe('home', true, true);
  h.timings.mark('start', true);
  await settle();
  assert.deepEqual(
    h.sent.map((row) => [row.route, row.totalMs, row.cold]),
    [
      ['/native/android/start', 1_300, true],
      ['/native/android/home', 3_500, true],
      ['/native/android/workout', 1_700, false],
      ['/native/android/health', 3_500, true],
    ],
  );
  for (const row of h.sent) {
    assert.equal(AppLoadSchema.safeParse(row).success, true, row.route);
    assert.equal(row.responseStartMs, 400);
    assert.equal(row.buildId, '1.4.0+212');
    // Timings, booleans and fixed labels only: no health value, name or free text.
    assert.deepEqual(Object.keys(row).sort(), ['buildId', 'cold', 'responseStartMs', 'route', 'totalMs']);
  }
  h.timings.mark('home', false);
  h.at(STARTUP_DEADLINE_MS + 1);
  await settle();
  assert.equal(h.sent.length, 4, 'never a second report in the same process');
});

test('the deadline sends what was measured and drops the rest', async () => {
  const h = harness(null);
  h.at(800);
  h.timings.mark('start', true);
  h.at(STARTUP_DEADLINE_MS);
  await settle();
  assert.deepEqual(h.sent.map((row) => [row.route, row.totalMs, row.responseStartMs]), [
    ['/native/android/start', 800, null],
  ]);
  h.timings.observe('workout', true, true);
  await settle();
  assert.equal(h.sent.length, 1);
});

test('leaving the app stops the measurement, and a background start measures nothing', async () => {
  const h = harness();
  h.at(500);
  h.timings.mark('start', true);
  h.timings.stop();
  h.at(600);
  h.timings.observe('workout', true, true);
  await settle();
  assert.deepEqual(h.sent.map((row) => row.route), ['/native/android/start']);

  const background = harness(400, false);
  background.timings.mark('start', true);
  background.at(STARTUP_DEADLINE_MS);
  await settle();
  assert.equal(background.sent.length, 0);
});

test('nothing is sent while signed out or before the reporter is installed', async () => {
  const sent: unknown[] = [];
  const off = new StartupTimings(0, () => 10, () => undefined);
  off.connect('user-1', async (_path, body) => void sent.push(body));
  off.mark('start', true);
  off.stop();
  const signedOut = new StartupTimings(0, () => 10, () => undefined);
  signedOut.enable(build, 0, true);
  signedOut.mark('start', true);
  signedOut.stop();
  signedOut.connect(null, null);
  await settle();
  assert.equal(sent.length, 0);
});

test('a failed post drops the rest rather than retrying', async () => {
  let calls = 0;
  const timings = new StartupTimings(0, () => 10, () => undefined);
  timings.enable(build, 0, true);
  timings.connect('user-1', async () => {
    calls += 1;
    throw new Error('offline');
  });
  timings.mark('start', true);
  timings.observe('workout', true, true);
  timings.stop();
  await settle();
  assert.equal(calls, 1);
});

test('native start-up time comes only from a sane pair of markers', () => {
  assert.equal(nativeStartMs({ startTime: 100, executeJavaScriptBundleEntryPointStart: 412.6 }), 313);
  assert.equal(nativeStartMs({ startTime: 500, executeJavaScriptBundleEntryPointStart: 100 }), null);
  assert.equal(nativeStartMs({ startTime: 100 }), null);
  assert.equal(nativeStartMs({ startTime: Number.NaN, executeJavaScriptBundleEntryPointStart: 1 }), null);
  assert.equal(nativeStartMs(undefined), null);
});

test('each tab counts its first data, and the data it opened with counts as saved', () => {
  const base = { homeReady: true, healthReady: true, body: true, sleep: true, catalogReady: true, catalog: true };
  const byMark = (state: typeof base) =>
    Object.fromEntries(startupTabStates(state).map((tab) => [tab.mark, [tab.ready, tab.hasData]]));
  assert.deepEqual(byMark(base), { home: [true, true], health: [true, true], workout: [true, true] });
  assert.deepEqual(byMark({ ...base, catalog: false }), {
    home: [true, false],
    health: [true, true],
    workout: [true, false],
  });
  assert.deepEqual(byMark({ ...base, sleep: false, homeReady: false }), {
    home: [false, true],
    health: [true, false],
    workout: [true, true],
  });
});
