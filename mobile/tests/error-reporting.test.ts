import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ErrorReporter } from '../src/core/reporting/ErrorReporter.ts';
import {
  failureReason,
  isExpectedFailure,
  reportMessage,
  scrubApiPath,
} from '../src/core/reporting/scrub.ts';
import { errorReporter, failureNotice } from '../src/core/reporting/index.ts';
import { ApiError, createApiClient } from '../src/features/account/api/client.ts';
import { NativeClientErrorBatchSchema } from '@trainingai/shared/validation/client-error';
import { z } from 'zod';

const build = { appVersion: '0.4.2', buildCode: '57', platform: 'android' } as const;

function harness() {
  let clock = 1_000_000;
  const timers: { at: number; run: () => void }[] = [];
  const sent: unknown[] = [];
  let fail = false;
  const reporter = new ErrorReporter(() => clock, ((run: () => void, ms: number) => {
    timers.push({ at: clock + ms, run });
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as never);
  reporter.enable(build);
  reporter.connect(async (_path, body) => {
    sent.push(body);
    if (fail) throw new TypeError('Network request failed');
  });
  return {
    reporter,
    sent,
    failNext: () => (fail = true),
    async advance(ms: number) {
      clock += ms;
      for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
        if (timer.at <= clock) timer.run();
        else timers.push(timer);
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('a report never carries a token, an email, a number or quoted text', () => {
  const planted = new Error(
    'Rejected Bearer abc.def-ghi for dasa@example.com: token=sk_live_9f8e7d6c5b4a3f2e1d0c ' +
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig weight 82.5 kg, HRV 47 ms, ' +
      'exercise "Nordic curl" on 2026-10-19 via https://x.example/api/a?secret=1',
  );
  const message = reportMessage(planted);
  for (const leaked of [
    'abc.def',
    'sk_live',
    'dasa@',
    'eyJ',
    '82.5',
    '82',
    '47',
    'Nordic',
    '2026',
    'secret=1',
  ]) {
    assert.ok(!message.includes(leaked), `${leaked} leaked into: ${message}`);
  }
  assert.match(message, /^Error: Rejected Bearer \[redacted\]/);
  assert.match(message, /weight # kg, HRV # ms/);
});

test('the HTTP status comes from the error, not its scrubbed text', () => {
  const error = new ApiError(500, 'server_error', undefined, '/api/workout-data');
  assert.equal(
    reportMessage(error),
    'Error: TrainingAi request failed (#). [HTTP 500 server_error]',
  );
  assert.equal(failureReason(error), 'HTTP 500 server_error');
  assert.equal(failureReason(new Error('Invalid workout count.')), 'Invalid workout count');
  assert.equal(failureReason(new TypeError('Network request failed')), 'no connection');
});

test('api paths lose their ids and query', () => {
  assert.equal(
    scrubApiPath('/api/workout-sessions/5f1c2a9e-1111-4222-8333-944445555666/sets?day=2026-10-19'),
    '/api/workout-sessions/:id/sets',
  );
  assert.equal(scrubApiPath('/api/workout-data'), '/api/workout-data');
  assert.equal(scrubApiPath('https://other.example/x'), undefined);
});

test('offline, signed-out, not-found, conflict, rate-limit and paused failures are not faults', () => {
  for (const status of [401, 403, 404, 409, 429])
    assert.ok(isExpectedFailure(new ApiError(status)));
  assert.ok(isExpectedFailure(new ApiError(503, 'ai_paused')));
  assert.ok(isExpectedFailure(new TypeError('Network request failed')));
  assert.ok(!isExpectedFailure(new ApiError(500)));
  assert.ok(!isExpectedFailure(new ApiError(400)));
  assert.ok(!isExpectedFailure(new Error('Invalid workout count.')));
});

test('reports are batched, sent in the intake shape, and repeats are dropped', async () => {
  const h = harness();
  h.reporter.setScreen('Workout');
  h.reporter.report(new Error('Invalid workout count.'), { apiPath: '/api/workout-data' });
  h.reporter.report(new Error('Invalid workout count.'), { apiPath: '/api/workout-data' });
  h.reporter.report(new ApiError(500, undefined, undefined, '/api/next-session'));
  await h.advance(4_999);
  assert.equal(h.sent.length, 0, 'nothing leaves before the batching delay');
  await h.advance(1);
  assert.equal(h.sent.length, 1);
  const body = NativeClientErrorBatchSchema.parse(h.sent[0]);
  assert.deepEqual(
    body.events.map((event) => [event.message, event.screen, event.apiPath]),
    [
      ['Error: Invalid workout count.', 'Workout', '/api/workout-data'],
      ['Error: TrainingAi request failed (#). [HTTP 500]', 'Workout', '/api/next-session'],
    ],
  );
  assert.deepEqual(
    {
      appVersion: body.events[0].appVersion,
      buildCode: body.events[0].buildCode,
      platform: body.events[0].platform,
    },
    build,
  );
});

test('sends are spaced, the queue is bounded, and a failed send is dropped, not retried', async () => {
  const h = harness();
  h.failNext();
  for (let i = 0; i < 25; i++) h.reporter.report(new Error(`fault ${'x'.repeat(i + 1)}`));
  await h.advance(5_000);
  assert.equal(h.sent.length, 1);
  assert.equal((h.sent[0] as { events: unknown[] }).events.length, 5);
  await h.advance(9_000);
  assert.equal(h.sent.length, 1, 'the next send waits out the gap');
  await h.advance(1_000);
  assert.equal(h.sent.length, 2);
  await h.advance(60_000);
  await h.advance(60_000);
  const total = h.sent.reduce<number>(
    (sum, body) => sum + (body as { events: unknown[] }).events.length,
    0,
  );
  assert.equal(total, 10, 'the queue held at most 10, and the failed batch was not resent');
});

test('the reporter is off until enabled, and never throws', async () => {
  const reporter = new ErrorReporter();
  const sent: unknown[] = [];
  reporter.connect(async (_path, body) => void sent.push(body));
  assert.doesNotThrow(() => reporter.report(new Error('before enable')));
  const hostile = {
    get message() {
      throw new Error('boom');
    },
  };
  reporter.enable(build);
  assert.doesNotThrow(() => reporter.report(hostile));
  assert.doesNotThrow(() => reporter.report(undefined));
  assert.equal(sent.length, 0);
  // The app's shared reporter stays off in tests and dev builds.
  assert.equal(
    failureNotice('Could not load.', new Error('Bad shape.')),
    'Could not load. (Bad shape)',
  );
  errorReporter.report(new Error('not enabled'));
});

test('the API client tags failures with their path and does not report its own intake', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('{"error":"server_error"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createApiClient('https://example.com', async () => 'test-session');
  const error = await client.get('/api/workout-data').catch((value: unknown) => value);
  assert.ok(error instanceof ApiError);
  assert.equal(error.path, '/api/workout-data');
  const source = await readFile(
    new URL('../src/features/account/api/client.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /if \(path !== '\/api\/client-error'\) reportError\(error, \{ apiPath: path \}\)/,
  );
});

test('release builds install the global handlers; the app connects and names the screen', async () => {
  const install = await readFile(
    new URL('../src/core/reporting/install.ts', import.meta.url),
    'utf8',
  );
  assert.match(install, /__DEV__/);
  assert.match(install, /ErrorUtils\.setGlobalHandler/);
  assert.match(install, /enablePromiseRejectionTracker/);
  const app = await readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /installErrorReporting\(\)/);
  assert.match(app, /errorReporter\.connect\(/);
  assert.match(app, /errorReporter\.setScreen\(detail \?\? tab\)/);
});

test('a schema failure reports its first field path and code, never the data or record keys', () => {
  const parsed = z
    .object({
      program: z.object({ sessions: z.record(z.string(), z.object({ sets: z.number() })) }),
    })
    .safeParse({ program: { sessions: { 'Nordic curl day': { sets: 'four at 82.5 kg' } } } });
  assert.ok(!parsed.success);
  assert.equal(
    failureReason(parsed.error),
    'unexpected data at program.sessions.*.sets (invalid_type)',
  );
  const message = reportMessage(parsed.error);
  assert.match(message, /unexpected data at program\.sessions\.\*\.sets \(invalid_type\)/);
  assert.ok(!/Nordic|82|four/.test(message), message);
});
