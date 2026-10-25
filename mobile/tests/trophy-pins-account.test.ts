import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import {
  carryOverTrophyCase,
  readTrophyCase,
  saveTrophyPins,
  trophyPinsSpec,
  writeTrophyCase,
} from '../src/features/rewards/data/trophy.ts';
import { sqliteFixture } from './storage-fixture.ts';

async function setup(t: { after: (fn: () => void) => void }, saved: string[] | null = null) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const server = { pins: saved, refuse: false, puts: [] as unknown[] };
  const resources = new WorkoutResources(storage.account('https://example.com', 'one'), {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => ({ pins: server.pins }),
    post: async () => ({}),
    put: async (_path: string, body: unknown) => {
      server.puts.push(body);
      if (server.refuse) throw new Error('Trophy not unlocked');
      server.pins = (body as { pins: string[] }).pins;
      return {};
    },
  });
  t.after(() => resources.cancel());
  return { server, resources, local: storage.account('https://example.com', 'one') };
}

test('saving pins writes them to the account and shows them at once', async (t) => {
  const { resources, server } = await setup(t);
  await resources.load(trophyPinsSpec);
  assert.equal(await saveTrophyPins(resources, ['a', 'b']), true);
  assert.deepEqual(server.puts, [{ pins: ['a', 'b'] }]);
  assert.deepEqual(resources.state(trophyPinsSpec).data, { pins: ['a', 'b'] });
});

test('clearing every pin saves an empty list and the account reads as unpinned', async (t) => {
  const { resources, server } = await setup(t, ['a']);
  await resources.load(trophyPinsSpec);
  assert.equal(await saveTrophyPins(resources, []), true);
  assert.deepEqual(server.puts, [{ pins: [] }]);
  assert.deepEqual(resources.state(trophyPinsSpec).data, { pins: null });
});

test('a refused save puts the view back to what the account holds', async (t) => {
  const { resources, server } = await setup(t, ['a']);
  await resources.load(trophyPinsSpec);
  server.refuse = true;
  assert.equal(await saveTrophyPins(resources, ['a', 'locked']), false);
  assert.deepEqual(resources.state(trophyPinsSpec).data, { pins: ['a'] });
});

test('pins kept on this phone move to an account that has none, once', async (t) => {
  const { resources, server, local } = await setup(t);
  await writeTrophyCase(local, ['x', 'y']);
  await resources.load(trophyPinsSpec);
  await carryOverTrophyCase(resources, local);
  assert.deepEqual(server.puts, [{ pins: ['x', 'y'] }]);
  assert.deepEqual(await readTrophyCase(local), [], 'the old list is gone');
  await carryOverTrophyCase(resources, local);
  assert.equal(server.puts.length, 1, 'a second load saves nothing');
});

test('an account that already has pins keeps them and the phone list is dropped', async (t) => {
  const { resources, server, local } = await setup(t, ['acct']);
  await writeTrophyCase(local, ['x']);
  await resources.load(trophyPinsSpec);
  await carryOverTrophyCase(resources, local);
  assert.deepEqual(server.puts, []);
  assert.deepEqual(resources.state(trophyPinsSpec).data, { pins: ['acct'] });
  assert.deepEqual(await readTrophyCase(local), []);
});

test('if the carry-over is refused the phone list stays for the next load', async (t) => {
  const { resources, server, local } = await setup(t);
  await writeTrophyCase(local, ['x']);
  await resources.load(trophyPinsSpec);
  server.refuse = true;
  await carryOverTrophyCase(resources, local);
  assert.deepEqual(await readTrophyCase(local), ['x']);
  assert.deepEqual(resources.state(trophyPinsSpec).data, { pins: null });
});

test('nothing is carried over before the account pins have been read', async (t) => {
  const { resources, server, local } = await setup(t);
  await writeTrophyCase(local, ['x']);
  await carryOverTrophyCase(resources, local);
  assert.deepEqual(server.puts, []);
  assert.deepEqual(await readTrophyCase(local), ['x']);
});
