import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import { AI_PAUSED_CODE, AI_PAUSED_MESSAGE } from '@trainingai/shared/ai-paused-notice';
import { ApiError, aiFailureText, createApiClient } from '../src/features/account/api/client.ts';
import { foodScanError } from '../src/features/nutrition/data/scan-response.ts';
import {
  GOAL_REVIEW_FAILED,
  goalReviewError,
} from '../src/features/nutrition/data/goal-recommendation-error.ts';
import { CoachConversation } from '../src/features/coach/data/CoachConversation.ts';
import { coachError } from '../src/features/coach/data/models.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const json = { 'content-type': 'application/json' };
const paused = () =>
  new Response(JSON.stringify({ error: AI_PAUSED_MESSAGE, code: AI_PAUSED_CODE }), {
    status: 503,
    headers: json,
  });
const client = () => createApiClient('https://example.com', async () => 'test-session');
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('request() keeps the fixed sentence for a paused 503 and drops any other server text', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => paused());
  await assert.rejects(
    client().post('/api/nutrition/scan', {}),
    (e) =>
      e instanceof ApiError &&
      e.status === 503 &&
      e.code === AI_PAUSED_CODE &&
      e.notice === AI_PAUSED_MESSAGE,
  );
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'Quota exceeded for project 123', code: AI_PAUSED_CODE }), {
        status: 503,
        headers: json,
      }),
  );
  await assert.rejects(
    client().post('/api/nutrition/scan', {}),
    (e) => e instanceof ApiError && e.notice === AI_PAUSED_MESSAGE,
  );
});

test('request() sets no notice for other failures', async (t) => {
  for (const [status, body] of [
    [503, { error: 'Service unavailable' }],
    [502, { error: AI_PAUSED_MESSAGE, code: AI_PAUSED_CODE }],
    [429, { error: 'rate_limited' }],
  ] as const) {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify(body), { status, headers: json }),
    );
    await assert.rejects(
      client().post('/api/nutrition/scan', {}),
      (e) => e instanceof ApiError && e.status === status && e.notice === undefined,
    );
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }));
  await assert.rejects(
    client().post('/api/nutrition/scan', {}),
    (e) => e instanceof ApiError && e.notice === undefined,
  );
});

test('aiFailureText returns the sentence or the caller fallback, never other text', () => {
  assert.equal(aiFailureText(new ApiError(503, AI_PAUSED_CODE, AI_PAUSED_MESSAGE), 'x'), AI_PAUSED_MESSAGE);
  assert.equal(aiFailureText(new Error(AI_PAUSED_MESSAGE), 'x'), AI_PAUSED_MESSAGE);
  assert.equal(aiFailureText(new ApiError(503), 'x'), 'x');
  assert.equal(aiFailureText(new Error('Quota exceeded for project 123'), 'x'), 'x');
  assert.equal(aiFailureText(`${AI_PAUSED_MESSAGE} extra`, 'x'), 'x');
  assert.equal(aiFailureText(undefined, 'x'), 'x');
});

test('food scan shows the paused sentence, and its own lines otherwise', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => paused());
  const error = await client()
    .post('/api/nutrition/scan', { text: 'toast' })
    .catch((e: unknown) => e);
  assert.equal(foodScanError(error), AI_PAUSED_MESSAGE);
  assert.match(foodScanError(new ApiError(503)), /failed on the server \(503\)/);
  assert.match(foodScanError(new ApiError(429)), /Too many/);
});

test('goal recommendation shows the paused sentence instead of blaming the profile', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => paused());
  const error = await client()
    .post('/api/nutrition-goals/recommend', {})
    .catch((e: unknown) => e);
  assert.equal(goalReviewError(error), AI_PAUSED_MESSAGE);
  assert.equal(goalReviewError(new ApiError(500)), GOAL_REVIEW_FAILED);
  assert.equal(goalReviewError(new Error('offline')), GOAL_REVIEW_FAILED);
});


test('Coach stream: a paused 503 before the stream opens carries the sentence', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => paused());
  const error = await client()
    .coachStream({ messages: [] })
    .catch((e: unknown) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 503);
  assert.equal(coachError(error), AI_PAUSED_MESSAGE);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503, headers: json }));
  const other = await client()
    .coachStream({ messages: [] })
    .catch((e: unknown) => e);
  assert.equal(coachError(other), 'Could not get a reply. Check your connection and retry.');
});

function conversation(chunks: UIMessageChunk[]) {
  const values = new Map<string, string>();
  const connection = {
    origin: 'https://example.com',
    userId: id(1),
    timezone: 'Australia/Brisbane',
    get: async () => ({ threads: [], changes: [] }),
    post: async () => ({ threadId: id(50) }),
    coachStream: async () =>
      createUIMessageStreamResponse({
        stream: new ReadableStream({
          start(controller) {
            chunks.forEach((c) => controller.enqueue(c));
            controller.close();
          },
        }),
      }),
  } as unknown as AccountConnection;
  const resources = new WorkoutResources(
    {
      get: async (k) => values.get(k) ?? null,
      set: async (k, v) => {
        values.set(k, v);
      },
      remove: async (k) => {
        values.delete(k);
      },
    },
    connection,
  );
  let next = 100;
  return new CoachConversation(resources, 'general', () => id(++next));
}

test('Coach stream: a mid-stream error part shows the sentence only when it is exactly the paused one', async () => {
  for (const [errorText, expected] of [
    [AI_PAUSED_MESSAGE, AI_PAUSED_MESSAGE],
    ['Quota exceeded for project 123', 'Could not get a reply. Check your connection and retry.'],
  ]) {
    const chat = conversation([
      { type: 'start', messageId: id(20) },
      { type: 'error', errorText },
    ]);
    await chat.initialize();
    chat.input('Analyse my training');
    await chat.send();
    assert.ok(chat.chat.error);
    assert.equal(coachError(chat.chat.error), expected);
    chat.dispose();
  }
});
