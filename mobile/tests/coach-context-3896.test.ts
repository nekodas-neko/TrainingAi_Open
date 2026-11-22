import test from 'node:test';
import assert from 'node:assert/strict';
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { CoachConversation } from '../src/features/coach/data/CoachConversation.ts';
import { CoachActions } from '../src/features/coach/data/CoachActions.ts';
import { aboutSpec, coachPaths } from '../src/features/coach/data/models.ts';
import { CoachPatchSchema } from '../src/features/coach/data/patch.ts';
import {
  REP_RANGE_OPTIONS,
  liftPreferencesSpec,
  repRangeDisplay,
  repRangePatch,
} from '../src/features/programs/rep-range.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import { ApiError } from '../src/features/account/api/client.ts';

// #3896 steps 6-7: the Coach carries what it was opened about, a button sends its own intent, and the
// editor's rep range writes through the Coach's apply path.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LIFT = id(7);
function reply() {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: id(20) },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Done.' },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: 'stop' },
  ];
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    }),
  });
}
/** A reply that ends on a choice list, as the swap button's first turn does. */
function choiceReply() {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: id(30) },
    { type: 'start-step' },
    {
      type: 'tool-input-available',
      toolName: 'renderChoiceList',
      toolCallId: 'pick',
      input: { kind: 'choice_list', prompt: 'Swap for which?', source: 'swap_candidates', sourceId: LIFT },
    },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'tool-calls' },
  ];
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    }),
  });
}
const settle = async (until: () => boolean) => {
  for (let attempt = 0; attempt < 50 && !until(); attempt++)
    await new Promise((resolve) => setImmediate(resolve));
};
function fixture() {
  const values = new Map<string, string>(),
    writes: { path: string; body: unknown }[] = [],
    requests: Record<string, unknown>[] = [];
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: id(1),
    timezone: 'Australia/Brisbane',
    get: async () => ({ threads: [], changes: [] }),
    coachStream: async (body) => {
      requests.push(body as Record<string, unknown>);
      return reply();
    },
    post: async (path, body) => {
      writes.push({ path, body });
      if (path === '/api/coach/threads') return { threadId: id(51) };
      if (path === '/api/coach/apply') return { changeId: id(90), summary: 'Cable Pulldown: 10–12 reps' };
      return {};
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
  return { resources, writes, requests, uuid: () => id(++next) };
}
const lift = { origin: 'exercise' as const, sessionExerciseId: LIFT };

test('opened from a lift: every request carries the context, and only a button turn its intent', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  assert.equal(await chat.prepare({ context: lift, chip: 'more_reps' }), true);
  assert.deepEqual(chat.getSnapshot().context, lift);
  assert.equal(chat.getSnapshot().pendingChip, 'more_reps');
  assert.equal(chat.takePendingChip(), 'more_reps');
  assert.equal(chat.takePendingChip(), null, 'a shortcut is tapped once');
  await chat.send('I want more reps and less weight on this lift.', 'lift_more_reps');
  await chat.send('Thanks');
  assert.deepEqual(f.requests[0].context, lift);
  assert.equal(f.requests[0].intent, 'lift_more_reps');
  assert.deepEqual(f.requests[1].context, lift);
  assert.equal('intent' in f.requests[1], false, 'a typed message carries no intent');
  assert.deepEqual(f.requests[0].patchDomains, ['lift_preference']);
  chat.dispose();
});

test('the context is kept with the conversation, and a typed message from the tab sends none', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.prepare({ context: lift });
  await chat.send('Hello');
  await chat.checkpoint();
  const reopened = new CoachConversation(f.resources, 'general', f.uuid);
  await reopened.initialize();
  assert.deepEqual(reopened.getSnapshot().context, lift);
  // Opening from the Coach button keeps a conversation under way as it is.
  await reopened.prepare();
  assert.deepEqual(reopened.getSnapshot().context, lift);
  chat.dispose();
  reopened.dispose();

  const g = fixture(),
    plain = new CoachConversation(g.resources, 'general', g.uuid);
  await plain.initialize();
  await plain.send('Hello');
  assert.equal('context' in g.requests[0], false);
  plain.dispose();
});

test('a lift opened over a conversation under way starts a fresh one and keeps the old in history', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.send('Earlier question');
  await chat.prepare({ context: lift });
  assert.equal(chat.chat.messages.length, 0);
  assert.deepEqual(chat.getSnapshot().context, lift);
  assert.equal(chat.getSnapshot().localThreads[0].title, 'Earlier question');
  assert.equal(chat.getSnapshot().localThreads[0].frame.context ?? null, null);
  // Back on the tab with the lift's conversation still empty: the lift is dropped, the four show.
  await chat.prepare();
  assert.equal(chat.getSnapshot().context, null);
  chat.dispose();
});

test('a saved context that no longer reads is dropped, not the conversation', async () => {
  const f = fixture();
  await f.resources.saveDraft('coach-conversation.v1:general', {
    input: 'kept',
    threadId: null,
    messages: [],
    context: { origin: 'exercise' },
  });
  const chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  assert.equal(chat.getSnapshot().input, 'kept');
  assert.equal(chat.getSnapshot().context, null);
  chat.dispose();
});

test('the buttons are asked of the server with ids only, and an applied change refreshes them', () => {
  const spec = aboutSpec('general', lift, ['lift_preference']);
  assert.equal(spec.path, '/api/coach/about');
  assert.deepEqual(spec.query, {
    scope: 'general',
    patchDomains: 'lift_preference',
    origin: 'exercise',
    sessionExerciseId: LIFT,
  });
  assert.deepEqual(aboutSpec('general', null, ['lift_preference']).query, {
    scope: 'general',
    patchDomains: 'lift_preference',
  });
  for (const path of ['/api/coach/about', '/api/coach/lift-preferences', '/api/next-session/prescription'])
    assert.ok(coachPaths.includes(path), path);
});

test('the rep range row: four ranges and the default, read by name, written through the Coach apply', async () => {
  assert.deepEqual(
    REP_RANGE_OPTIONS.map((o) => o.label),
    ['5 to 8', '8 to 10', '10 to 12', '12 to 15', 'Use the program’s default'],
  );
  assert.equal(repRangeDisplay('10-12'), '10 to 12');
  assert.equal(repRangeDisplay(null), 'Program’s default');
  assert.deepEqual(liftPreferencesSpec(['Row', 'Cable Pulldown', 'Row']).query, {
    names: JSON.stringify(['Cable Pulldown', 'Row']),
  });
  assert.equal(repRangePatch(LIFT, '10-12', '10-12', 'c'), null, 'the same range is no write');
  assert.equal(repRangePatch(LIFT, null, 'program_default', 'c'), null, 'no range to clear');

  const f = fixture(),
    actions = new CoachActions(f.resources, () => {});
  const set = repRangePatch(LIFT, null, '10-12', 'c1')!;
  const clear = repRangePatch(LIFT, '10-12', 'program_default', 'c2')!;
  assert.ok(CoachPatchSchema.safeParse(set).success);
  assert.ok(CoachPatchSchema.safeParse(clear).success);
  await actions.apply(set, ['c1']);
  await actions.apply(clear, ['c2']);
  assert.deepEqual(
    f.writes.map((w) => w.path),
    ['/api/coach/apply', '/api/coach/apply'],
  );
  assert.deepEqual((f.writes[1].body as { patch: unknown }).patch, {
    domain: 'lift_preference',
    targetId: LIFT,
    changes: [{ id: 'c2', field: 'repRange', from: '10-12', to: 'program_default' }],
  });
  // An out-of-range value is refused by the same schema before anything is sent.
  assert.equal(
    CoachPatchSchema.safeParse({ ...set, changes: [{ id: 'x', field: 'repRange', from: null, to: '100-200' }] })
      .success,
    false,
  );
});

test('a button\'s intent goes with every request of its exchange, the tool-result turn too, until a typed message (#3896 review)', async () => {
  const f = fixture(),
    normal = f.resources.connection.coachStream!;
  let first = true;
  f.resources.connection.coachStream = async (body, signal) => {
    if (!first) return normal(body, signal);
    first = false;
    f.requests.push(body as Record<string, unknown>);
    return choiceReply();
  };
  const chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.prepare({ context: lift });
  await chat.send('I want to swap this lift for another.', 'lift_swap');
  assert.equal(chat.getSnapshot().intent, 'lift_swap');
  // The pick is sent by the SDK (`addToolResult` → `sendAutomaticallyWhen`), with no body of its own.
  chat.resolve('pick', { status: 'chose', id: id(8), label: 'Seated row' });
  await settle(() => f.requests.length === 2 && !chat.busy);
  assert.equal(f.requests.length, 2, 'the pick was sent');
  assert.equal(f.requests[0].intent, 'lift_swap');
  assert.equal(f.requests[1].intent, 'lift_swap', 'the second request of the exchange still carries it');
  assert.deepEqual(f.requests[1].context, lift);
  // Kept with the conversation, so a reopened Coach finishes the exchange the same way.
  await chat.checkpoint();
  const reopened = new CoachConversation(f.resources, 'general', f.uuid);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().intent, 'lift_swap');
  reopened.dispose();
  // A typed message ends it.
  await chat.send('Actually, never mind');
  assert.equal(chat.getSnapshot().intent, null);
  assert.equal('intent' in f.requests[2], false);
  chat.dispose();
});

test('another button replaces the intent, and a new conversation or another lift clears it', async () => {
  const f = fixture(),
    chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.send('I want to change an exercise.', 'change_exercise');
  await chat.send('Something hurts.', 'something_hurts');
  assert.equal(f.requests[1].intent, 'something_hurts');
  await chat.prepare({ context: lift });
  assert.equal(chat.getSnapshot().intent, null);
  await chat.send('Hello');
  assert.equal('intent' in f.requests[2], false);
  chat.dispose();
});

test('an old recap\'s lift that no longer reads: the context is dropped, later sends carry none, and the screen says why (#3896 review)', async () => {
  const f = fixture();
  // The server's own 404 for the about read, as the client sees it.
  f.resources.connection.get = async (path) => {
    if (path === '/api/coach/about') throw new ApiError(404, undefined, undefined, path, true, 'Not found');
    return { threads: [], changes: [] };
  };
  const chat = new CoachConversation(f.resources, 'general', f.uuid);
  await chat.initialize();
  await chat.prepare({ context: lift });
  const spec = aboutSpec('general', lift, ['lift_preference']);
  await f.resources.load(spec, true);
  assert.equal(f.resources.state(spec).notFound, true, 'a 404 from our server is told apart from other failures');
  chat.dropContext();
  assert.equal(chat.getSnapshot().context, null);
  assert.equal(chat.getSnapshot().contextGone, true);
  // The general buttons are what the screen now asks for.
  assert.deepEqual(aboutSpec('general', chat.getSnapshot().context, ['lift_preference']).query, {
    scope: 'general',
    patchDomains: 'lift_preference',
  });
  await chat.send('Can I still ask about my training?');
  assert.equal('context' in f.requests[0], false, 'the chat no longer 404s on the old id');
  // Opening the Coach about something else clears the notice.
  await chat.prepare({ context: { origin: 'session', programSessionId: id(9) } });
  assert.equal(chat.getSnapshot().contextGone, false);
  chat.dispose();

  // A 404 that is not our server's (a gateway page) is not taken as "gone".
  f.resources.connection.get = async (path) => {
    throw new ApiError(404, undefined, undefined, path, false);
  };
  const other = aboutSpec('general', { origin: 'exercise', sessionExerciseId: id(10) }, ['lift_preference']);
  await f.resources.load(other, true);
  assert.equal(f.resources.state(other).notFound, false);
});
