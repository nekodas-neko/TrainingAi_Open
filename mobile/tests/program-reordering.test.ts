import assert from 'node:assert/strict';
import test from 'node:test';
import { programPayload, type ProgramDraft } from '../src/features/programs/editor-model.ts';
import {
  exerciseBlocks,
  identifyProgramDraft,
  reorderExerciseBlocks,
  reorderSessions,
} from '../src/features/programs/reorder-model.ts';
const draft: ProgramDraft = {
  name: 'Strength',
  schedule: { type: 'weekly', days: [{ dayOfWeek: 0, sessionId: 'upper' }] },
  sessions: [
    {
      id: 'upper',
      name: 'Upper',
      exercises: [
        {
          id: 'press',
          exerciseName: 'Press',
          supersetGroup: null,
          styleId: 'strength',
          exerciseRole: 'primary',
        },
        {
          id: 'row',
          exerciseName: 'Row',
          supersetGroup: 0,
          styleId: 'hypertrophy',
          muscleGroups: ['Back'],
        },
        {
          id: 'curl',
          exerciseName: 'Curl',
          supersetGroup: 0,
          styleId: 'hypertrophy',
        },
        { id: 'raise', exerciseName: 'Raise', supersetGroup: 0 },
        { id: 'plank', exerciseName: 'Plank', supersetGroup: 1 },
        { id: 'crunch', exerciseName: 'Crunch', supersetGroup: 1 },
      ],
    },
    {
      id: 'lower',
      name: 'Lower',
      exercises: [{ id: 'squat', exerciseName: 'Squat' }],
    },
  ],
};
test('dragging sessions preserves schedule identities and pending edits through save and reopen', () => {
  const edited = { ...draft, name: 'My edited programme' };
  const reordered = reorderSessions(edited, ['lower', 'upper']);
  assert.equal(reordered.name, edited.name);
  assert.deepEqual(reordered.schedule, draft.schedule);
  assert.deepEqual(
    reordered.sessions.map((session) => [session.id, session.position]),
    [
      ['lower', 0],
      ['upper', 1],
    ],
  );
  assert.deepEqual(reordered.sessions[1].exercises, draft.sessions[0].exercises);
  const saved = programPayload(JSON.parse(JSON.stringify(reordered))).program;
  assert.deepEqual(
    saved.sessions?.map((session) => session.id),
    ['lower', 'upper'],
  );
});
test('supersets including group zero and circuits move atomically with settings intact', () => {
  const exercises = draft.sessions[0].exercises;
  assert.deepEqual(
    exerciseBlocks(exercises).map((block) => block.id),
    ['press', 'superset:0', 'superset:1'],
  );
  const reordered = reorderExerciseBlocks(exercises, ['superset:1', 'press', 'superset:0']);
  assert.deepEqual(
    reordered.map((item) => item.id),
    ['plank', 'crunch', 'press', 'row', 'curl', 'raise'],
  );
  assert.deepEqual(
    reordered.map((item) => item.supersetGroup),
    [1, 1, null, 0, 0, 0],
  );
  reordered.forEach((item, position) => {
    assert.equal(item.position, position);
    assert.deepEqual(
      { ...item, position: undefined },
      {
        ...exercises.find((original) => original.id === item.id),
        position: undefined,
      },
    );
  });
  assert.deepEqual(
    reorderExerciseBlocks(reordered, ['press', 'superset:0', 'superset:1']).map((item) => item.id),
    exercises.map((item) => item.id),
  );
  assert.deepEqual(
    exercises.map((item) => item.position),
    Array(6).fill(undefined),
  );
});
test('stale, duplicate or incomplete drag orders never discard draft content', () => {
  assert.equal(reorderSessions(draft, ['lower', 'removed']), draft);
  assert.equal(reorderSessions(draft, ['upper', 'upper']), draft);
  const exercises = draft.sessions[0].exercises;
  assert.equal(reorderExerciseBlocks(exercises, ['press', 'superset:0']), exercises);
  assert.equal(reorderExerciseBlocks(exercises, ['press', 'press', 'superset:1']), exercises);
  assert.deepEqual(reorderExerciseBlocks([], []), []);
});
test('older drafts acquire persisted identities once without changing existing ids or superset membership', () => {
  let count = 0;
  const identified = identifyProgramDraft(
    {
      ...draft,
      sessions: [
        {
          name: 'Older',
          exercises: [
            { exerciseName: 'A', supersetGroup: 0 },
            { exerciseName: 'B', supersetGroup: 0 },
          ],
        },
      ],
    },
    () => `new-${++count}`,
  );
  assert.deepEqual(
    identified.sessions.map((session) => session.id),
    ['new-1'],
  );
  assert.deepEqual(
    identified.sessions[0].exercises.map((item) => item.id),
    ['new-2', 'new-3'],
  );
  assert.equal(
    identifyProgramDraft(identified, () => {
      throw Error('Should retain identities');
    }),
    identified,
  );
  assert.equal(
    identifyProgramDraft(draft, () => {
      throw Error('Should retain identities');
    }),
    draft,
  );
});

test('reordered programme saves offline, reopens from SQLite and uploads unchanged settings', async (t) => {
  const { randomUUID } = await import('node:crypto');
  const { sqliteFixture } = await import('./storage-fixture.ts');
  const { createLocalStorage } = await import('../src/core/storage/LocalStorage.ts');
  const { TrainingStore } = await import('../src/features/workouts/data/TrainingStore.ts');
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let online = false;
  let uploaded: unknown;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ programs: [] }),
    post: async (_path: string, body: unknown) => {
      if (!online) throw Error('offline');
      uploaded = body;
      return { ok: true, program: { ...(body as { program: object }).program, userId: 'one' } };
    },
  };
  const scoped = storage.account(connection.origin, connection.userId);
  const valid = {
    ...draft,
    id: randomUUID(),
    sessions: draft.sessions.map((session) => ({
      ...session,
      id: randomUUID(),
      exercises: session.exercises.map((exercise) => ({ ...exercise, id: randomUUID() })),
    })),
  };
  let reordered = reorderSessions(valid, valid.sessions.map((session) => session.id!).reverse());
  reordered = {
    ...reordered,
    sessions: reordered.sessions.map((session) => ({
      ...session,
      exercises: reorderExerciseBlocks(
        session.exercises,
        exerciseBlocks(session.exercises)
          .map((block) => block.id)
          .reverse(),
      ),
    })),
  };
  const payload = {
    ...programPayload(reordered).program,
    sessions: programPayload(reordered).program.sessions!,
  };
  const store = new TrainingStore(scoped, connection, randomUUID, () => {});
  await store.initialize();
  await store.saveProgram(payload, { creating: false });
  store.cancel();
  const reopened = new TrainingStore(scoped, connection, randomUUID, () => {});
  await reopened.initialize();
  assert.deepEqual(
    reopened.getSnapshot().programs?.[0].sessions.map((session) => session.id),
    reordered.sessions.map((session) => session.id),
  );
  assert.deepEqual(reopened.getSnapshot().operations[0].kind, 'program_save');
  online = true;
  await reopened.sync();
  assert.deepEqual(
    (uploaded as { program: { sessions: unknown } }).program.sessions,
    payload.sessions,
  );
  assert.equal(reopened.getSnapshot().operations.length, 0);
});

test('superset members can reorder inside their group without moving unrelated exercises or breaking membership', async () => {
  const { reorderSupersetMembers } = await import('../src/features/programs/reorder-model.ts');
  const exercises = draft.sessions[0].exercises;
  const reordered = reorderSupersetMembers(exercises, 0, ['raise', 'row', 'curl']);
  assert.deepEqual(
    reordered.map((item) => item.id),
    ['press', 'raise', 'row', 'curl', 'plank', 'crunch'],
  );
  assert.deepEqual(
    reordered.map((item) => item.supersetGroup),
    [null, 0, 0, 0, 1, 1],
  );
  assert.equal(reordered[0], exercises[0]);
  assert.equal(reordered[4], exercises[4]);
  assert.equal(reordered[2].styleId, 'hypertrophy');
  assert.deepEqual(
    reordered.slice(1, 4).map((item) => item.position),
    [1, 2, 3],
  );
  assert.equal(reorderSupersetMembers(exercises, 0, ['row', 'curl']), exercises);
  assert.equal(reorderSupersetMembers(exercises, 0, ['row', 'curl', 'plank']), exercises);
});

test('repeated drags use the settled positions even before another layout event arrives', async () => {
  const { dragOrder, reorderBounds } = await import('../src/shared/ui/reorder.ts');
  const order = ['a', 'b'];
  const bounds = new Map([
    ['a', { y: 0, height: 44 }],
    ['b', { y: 56, height: 200 }],
  ]);
  const next = dragOrder(order, bounds, 'b', -120);
  assert.deepEqual(next, ['b', 'a']);
  const settled = reorderBounds(order, next, bounds, 12);
  assert.deepEqual(settled.get('b'), { y: 0, height: 200 });
  assert.deepEqual(settled.get('a'), { y: 212, height: 44 });
  assert.deepEqual(dragOrder(next, settled, 'a', -140), ['a', 'b']);
  assert.deepEqual(reorderBounds(next, order, settled, 12), bounds);
});
