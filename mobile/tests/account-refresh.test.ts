import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import {
  programSpec,
  stylesSpec,
  phaseSetsSpec,
} from '../src/features/workouts/data/models.ts';
import { refreshAccountViews } from '../src/features/settings/data/refreshAccountViews.ts';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const program = (name: string) => ({
  id: id(1),
  userId: 'one',
  name,
  isActive: true,
  phaseMode: 'manual' as const,
  sessions: [
    {
      id: id(2),
      name: 'Upper',
      position: 0,
      exercises: [{ id: id(3), exerciseName: 'Bench press', position: 0 }],
    },
  ],
});
function fixture() {
  const disk = new Map<string, string>();
  let version = 1,
    sequence = 20,
    failPhases = false;
  const calls: string[] = [];
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => {
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string): Promise<unknown> => {
      calls.push(path);
      if (path === programSpec.path) return { programs: [program(`Server ${version}`)] };
      if (path === stylesSpec.path)
        return { styles: [{ id: id(4), name: `Style ${version}`, sets: [] }] };
      if (path === phaseSetsSpec.path) {
        if (failPhases) throw new Error('Offline');
        return { phaseSets: [{ id: id(5), name: `Phase ${version}`, phases: [] }] };
      }
      if (path === '/api/user/profile') return { user: { name: 'One' } };
      if (path === '/api/user/goals') return {};
      return { value: version };
    },
    post: async () => {
      throw new Error('Uploads are offline');
    },
  };
  const resources = new WorkoutResources(
    storage,
    connection,
    () => 1000,
    () => id(sequence++),
  );
  return {
    resources,
    calls,
    connection,
    version: (value: number) => {
      version = value;
    },
    failPhases: (value: boolean) => {
      failPhases = value;
    },
  };
}

test('manual Sync and Restore replace fresh programme/style/phase caches with current server records', async (t) => {
  for (const restore of [false, true])
    await t.test(restore ? 'Restore' : 'Sync', async () => {
      const f = fixture();
      const history = {
        path: '/api/workout-history',
        schema: z.object({ value: z.number() }),
        ttl: 86400000,
      };
      await Promise.all([
        f.resources.load(programSpec),
        f.resources.load(stylesSpec),
        f.resources.load(phaseSetsSpec),
      ]);
      await f.resources.load(history);
      f.version(2);
      await f.resources.refreshVisible();
      assert.equal(f.resources.state(stylesSpec).data?.styles[0].name, 'Style 1');
      await refreshAccountViews(f.resources, restore);
      assert.equal(f.resources.state(programSpec).data?.programs[0].name, 'Server 2');
      assert.equal(f.resources.state(stylesSpec).data?.styles[0].name, 'Style 2');
      assert.equal(f.resources.state(phaseSetsSpec).data?.phaseSets[0].name, 'Phase 2');
      for (const spec of [programSpec, stylesSpec, phaseSetsSpec])
        assert.equal(f.calls.filter((path) => path === spec.path).length, 2);
      assert.equal(f.resources.state(history).data?.value, restore ? 2 : 1);
      f.resources.cancel();
    });
});

test('a manual refresh keeps an unsent programme edit and the same queued mutation', async () => {
  const f = fixture();
  await f.resources.load(programSpec);
  await f.resources.changes.saveProgram(program('Phone edit'), { creating: false });
  await f.resources.changes.sync();
  const pending = f.resources.changes.getSnapshot().operations.map((row) => row.id);
  assert.equal(pending.length, 1);
  f.version(2);
  await refreshAccountViews(f.resources, true);
  assert.equal(f.resources.state(programSpec).data?.programs[0].name, 'Phone edit');
  assert.deepEqual(
    f.resources.changes.getSnapshot().operations.map((row) => row.id),
    pending,
  );
  f.resources.cancel();
});

test('failed required refreshes surface an error, retain saved data and permit immediate retry', async () => {
  const f = fixture();
  await f.resources.load(phaseSetsSpec);
  f.version(2);
  f.failPhases(true);
  await assert.rejects(refreshAccountViews(f.resources, true));
  assert.equal(f.resources.state(phaseSetsSpec).data?.phaseSets[0].name, 'Phase 1');
  f.failPhases(false);
  await refreshAccountViews(f.resources, true);
  assert.equal(f.resources.state(phaseSetsSpec).data?.phaseSets[0].name, 'Phase 2');
  assert.equal(f.resources.state(phaseSetsSpec).error, null);
  f.resources.cancel();
});

test('manual refresh waits for a new read when an older style request is already running', async () => {
  const f = fixture();
  const baseGet = f.connection.get;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  f.connection.get = async (path: string) => {
    const reply = await baseGet(path);
    if (path === stylesSpec.path && first) {
      first = false;
      entered();
      await waiting;
    }
    return reply;
  };
  const old = f.resources.load(stylesSpec);
  await started;
  f.version(2);
  const refresh = refreshAccountViews(f.resources);
  release();
  await Promise.all([old, refresh]);
  assert.equal(f.resources.state(stylesSpec).data?.styles[0].name, 'Style 2');
  assert.equal(f.calls.filter((path) => path === stylesSpec.path).length, 2);
  f.resources.cancel();
});
