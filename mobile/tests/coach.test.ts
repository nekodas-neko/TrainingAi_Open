import test from 'node:test';
import assert from 'node:assert/strict';
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import { z } from 'zod';
import { createApiClient, ApiError } from '../src/features/account/api/client.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { CoachConversation } from '../src/features/coach/data/CoachConversation.ts';
import { CoachActions } from '../src/features/coach/data/CoachActions.ts';
import { coachError, stripToolCitations } from '../src/features/coach/data/models.ts';
import { CoachPatchSchema } from '../src/features/coach/data/patch.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function response(text = 'Here is your answer.') {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: id(20) },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text.slice(0, 5) },
    { type: 'text-delta', id: 'text', delta: text.slice(5) },
    { type: 'text-end', id: 'text' },
    { type: 'finish', finishReason: 'stop' },
  ];
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    }),
  });
}
function fixture() {
  const values = new Map<string, string>(),
    writes: { path: string; body: unknown }[] = [],
    requests: Record<string, unknown>[] = [];
  let fail = false,
    created = 0;
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: id(1),
    timezone: 'Australia/Brisbane',
    get: async () => {
      if (fail) throw Error('offline');
      return { threads: [], changes: [] };
    },
    coachStream: async (body) => {
      requests.push(body as Record<string, unknown>);
      if (fail) throw new ApiError(502);
      return response();
    },
    post: async (path, body) => {
      writes.push({ path, body });
      if (fail) throw new ApiError(502);
      if (path === '/api/coach/threads') {
        const previous = (body as { threadId: string | null }).threadId;
        if (!previous) created++;
        return { threadId: previous ?? id(50 + created) };
      }
      if (path === '/api/coach/apply')
        return { changeId: id(90), summary: 'Steps goal updated' };
      return { consequences: [], drift: [], target: { id: null, label: 'Goals' } };
    },
  };
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
  return {
    resources,
    values,
    writes,
    requests,
    fail: () => {
      fail = true;
    },
    created: () => created,
    uuid: () => id(++next),
  };
}
test('native chat reads the actual backend stream protocol and saves one thread across turns', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  chat.input('Analyse my training');
  await chat.send();
  await chat.saveHistory();
  await chat.checkpoint();
  assert.equal(chat.chat.messages[1].parts[0].type, 'text');
  assert.equal(
    (chat.chat.messages[1].parts[0] as { text: string }).text,
    'Here is your answer.',
  );
  await chat.send('What next?');
  await chat.saveHistory();
  await chat.checkpoint();
  assert.equal(f.created(), 1);
  assert.equal(chat.getSnapshot().threadId, id(51));
  assert.equal(f.requests[0].scope, 'general');
  assert.equal(chat.getSnapshot().input, '');
  assert.equal(chat.getSnapshot().stopped, false);
  chat.dispose();
});
test('drafts and messages survive reopening; general and nutrition are separate', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.send('Training question');
  await chat.saveHistory();
  chat.input('Unsent draft');
  await chat.checkpoint();
  const reopened = new CoachConversation(f.resources, 'general', f.uuid);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().input, 'Unsent draft');
  assert.equal(reopened.chat.messages.length, 2);
  const nutrition = new CoachConversation(f.resources, 'nutrition', f.uuid);
  await nutrition.initialize();
  assert.equal(nutrition.chat.messages.length, 0);
  chat.dispose();
  reopened.dispose();
  nutrition.dispose();
});
test('answering a widget resumes one assistant turn without duplicating its previous content', async () => {
  const f = fixture();
  const normal = f.resources.connection.coachStream!;
  let first = true;
  f.resources.connection.coachStream = async (body, signal) => {
    if (!first) return normal(body, signal);
    first = false;
    const chunks: UIMessageChunk[] = [
      { type: 'start', messageId: id(40) },
      { type: 'start-step' },
      { type: 'text-start', id: 'before' },
      { type: 'text-delta', id: 'before', delta: 'Choose a session.' },
      { type: 'text-end', id: 'before' },
      {
        type: 'tool-input-available',
        toolName: 'renderChoiceList',
        toolCallId: 'choice',
        input: { kind: 'choice_list', prompt: 'Which session?', source: 'sessions' },
      },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'tool-calls' },
    ];
    return createUIMessageStreamResponse({
      stream: new ReadableStream({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(c));
          controller.close();
        },
      }),
    });
  };
  const chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.send('Change my session');
  chat.resolve('choice', { status: 'chose', id: id(6), label: 'Upper A' });
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (f.requests.length && !chat.busy) break;
  }
  assert.equal(f.requests.length, 1);
  assert.equal(chat.chat.messages.filter((m) => m.role === 'assistant').length, 1);
  assert.equal(chat.chat.messages[1].id, id(40));
  assert.equal(chat.chat.messages[1].parts.filter((p) => p.type === 'text').length, 2);
  chat.dispose();
});
test('failed replies keep the user message for explicit retry and never apply a change', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'nutrition', f.uuid);
  await chat.initialize();
  f.fail();
  await chat.send('Make a meal plan');
  await chat.checkpoint();
  assert.equal(chat.chat.messages.length, 1);
  assert.ok(chat.chat.error);
  assert.equal(f.requests.length, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(
    coachError(chat.chat.error),
    'Could not get a reply. Check your connection and retry.',
  );
  chat.dispose();
});
test('starting another conversation offline preserves the previous one in local history', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  f.fail();
  await chat.send('Question saved offline');
  await chat.checkpoint();
  assert.equal(await chat.newConversation(), true);
  await chat.checkpoint();
  const archived = chat.getSnapshot().localThreads[0];
  assert.equal(archived.title, 'Question saved offline');
  const reopened = new CoachConversation(f.resources, 'general', f.uuid);
  await reopened.initialize();
  assert.equal(await reopened.open(archived.id), true);
  assert.equal(
    (reopened.chat.messages[0].parts[0] as { text: string }).text,
    'Question saved offline',
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.writes.length, 0);
  chat.dispose();
  reopened.dispose();
});
test('stopping a streamed reply cancels the request and retains its partial text', async () => {
  const f = fixture();
  let stopped = false;
  f.resources.connection.coachStream = async (_body, signal) =>
    createUIMessageStreamResponse({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'start', messageId: id(45) });
          controller.enqueue({ type: 'text-start', id: 'text' });
          controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Partial answer' });
          signal?.addEventListener(
            'abort',
            () => {
              stopped = true;
              controller.error(new DOMException('Stopped', 'AbortError'));
            },
            { once: true },
          );
        },
      }),
    });
  const chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  const sending = chat.send('Explain this');
  await new Promise((resolve) => setImmediate(resolve));
  chat.stop();
  await sending;
  await chat.checkpoint();
  assert.equal(stopped, true);
  assert.equal(chat.getSnapshot().stopped, true);
  const reopened = new CoachConversation(f.resources, 'general', f.uuid);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().stopped, true);
  assert.equal((reopened.chat.messages[1].parts[0] as { text: string }).text, 'Partial answer');
  chat.dispose();
  reopened.dispose();
});
test('history saves are serialized so fast consecutive writes cannot create duplicate threads', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  chat.chat.messages = [{ id: id(5), role: 'user', parts: [{ type: 'text', text: 'Hello' }] }];
  await Promise.all([chat.saveHistory(), chat.saveHistory()]);
  assert.equal(f.created(), 1);
  assert.equal(f.writes.length, 1);
  chat.dispose();
});
test('change writes reject mixed domains and unknown accepted IDs before contacting the backend', async () => {
  const f = fixture(),
    changes: string[][] = [];
  f.resources.subscribeInvalidation((paths) => changes.push(paths));
  const actions = new CoachActions(f.resources, () => {});
  const patch = CoachPatchSchema.parse({
    domain: 'user_goals',
    targetId: null,
    changes: [{ id: 'steps', field: 'stepsGoal', from: 8000, to: 10000 }],
  });
  await assert.rejects(() => actions.apply(patch, ['missing']));
  await assert.rejects(() => actions.apply({ ...patch, domain: 'injury' }, ['steps']));
  assert.equal(f.writes.length, 0);
  assert.equal((await actions.apply(patch, ['steps']))?.summary, 'Steps goal updated');
  assert.ok(changes.flat().includes('/api/user/goals'));
});
test('pending local target changes block a coach write without misreporting a network error', async () => {
  const f = fixture(),
    actions = new CoachActions(
      f.resources,
      () => {},
      () => true,
    );
  const patch = CoachPatchSchema.parse({
    domain: 'nutrition_targets',
    targetId: null,
    changes: [{ id: 'calories', field: 'calories', from: 2000, to: 2200 }],
  });
  await assert.rejects(
    () => actions.apply(patch, ['calories']),
    (error) => {
      assert.equal(
        coachError(error),
        'Finish uploading your saved changes before applying this suggestion.',
      );
      return true;
    },
  );
  assert.equal(f.writes.length, 0);
});
test('authenticated coach streaming uses only the backend and respects caller cancellation', async () => {
  let captured: RequestInit | undefined;
  const client = createApiClient(
    'https://example.com',
    async () => 'synthetic-token',
    async (url, init) => {
      assert.equal(String(url), 'https://example.com/api/coach');
      captured = init;
      return response();
    },
  );
  const controller = new AbortController();
  await client.coachStream({ messages: [] }, controller.signal);
  assert.equal(
    (captured?.headers as Record<string, string>).Authorization,
    'Bearer synthetic-token',
  );
  assert.equal(captured?.credentials, 'omit');
  assert.equal(captured?.signal, controller.signal);
  const signedOut = createApiClient(
    'https://example.com',
    async () => null,
    async () => {
      throw Error('Must not fetch');
    },
  );
  await assert.rejects(() => signedOut.coachStream({}), /Sign in/);
});
test('only provider tool citations are removed; ordinary brackets and Markdown links survive', () => {
  assert.equal(
    stripToolCitations('Useful answer [default_api:getProgramStructure].'),
    'Useful answer',
  );
  assert.equal(
    stripToolCitations('Read [the study](https://example.com) [training notes]'),
    'Read [the study](https://example.com) [training notes]',
  );
});
