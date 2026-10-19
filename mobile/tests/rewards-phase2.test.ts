import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { TITLE_CATALOGUE } from '@trainingai/shared/achievement-display';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { profileSpec } from '../src/features/health/data/models.ts';
import { seasonsSpec, type Achievement } from '../src/features/rewards/data/models.ts';
import { readTrophyCase, writeTrophyCase } from '../src/features/rewards/data/trophy.ts';
import { equipTitle } from '../src/features/rewards/data/titles.ts';
import {
  seasonBadges,
  titleName,
  trophySlots,
} from '../src/features/rewards/data/view.ts';
import { titleIcons } from '../src/features/rewards/components/titleIcons.ts';
import { titleLabel } from '../src/features/social/data/models.ts';
import { sqliteFixture } from './storage-fixture.ts';

const row = (id: string, over: Partial<Achievement> = {}): Achievement => ({
  id,
  name: id,
  description: `${id} description`,
  icon: 'x',
  category: 'Workouts',
  xpReward: 10,
  unlocked: true,
  progress: 1,
  goal: 1,
  current: 1,
  ...over,
});
const season = (id: string, badge?: string) => ({
  id,
  label: `Season ${id}`,
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  ...(badge
    ? { result: { rank: 2, sessions: 30, volumeKg: 9000, badgeLabel: badge } }
    : {}),
});

async function setup(t: { after: (fn: () => void) => void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const state = {
    title: null as string | null,
    offline: false,
    refuse: false,
    reads: [] as string[],
    patches: [] as { path: string; body: unknown }[],
  };
  const connect = (userId: string) => ({
    origin: 'https://example.com',
    userId,
    timezone: null,
    get: async (path: string) => {
      state.reads.push(path);
      if (state.offline) throw new Error('Offline');
      if (path === '/api/seasons')
        return { seasons: [season(userId, 'Gold'), season('open')] };
      if (path === '/api/user/profile')
        return { user: { name: 'One', equippedTitle: state.title } };
      return { rows: [] };
    },
    post: async () => ({}),
    patch: async (path: string, body: unknown) => {
      state.patches.push({ path, body });
      if (state.refuse) throw new Error('Title not unlocked');
      state.title = (body as { titleId: string | null }).titleId;
      return { equippedTitle: state.title };
    },
  });
  const open = (userId: string) =>
    new WorkoutResources(storage.account('https://example.com', userId), connect(userId));
  return { storage, state, open };
}

test('Season Badges lists only the seasons the player has a result in', () => {
  const parsed = seasonsSpec.schema.parse({
    seasons: [
      season('a', 'Gold'),
      season('b'),
      { ...season('c'), result: null },
      season('d', 'Silver'),
    ],
  });
  assert.deepEqual(
    seasonBadges(parsed.seasons).map((s) => [s.id, s.result.badgeLabel]),
    [
      ['a', 'Gold'],
      ['d', 'Silver'],
    ],
  );
  assert.deepEqual(seasonBadges([]), []);
});

test("seasons load from the server per account and a second account never sees the first's", async (t) => {
  const { open, state } = await setup(t);
  const one = open('one');
  await one.load(seasonsSpec);
  assert.equal(one.state(seasonsSpec).data?.seasons[0].id, 'one');
  one.cancel();
  state.offline = true;
  const again = open('one');
  await again.load(seasonsSpec);
  assert.equal(again.state(seasonsSpec).data?.seasons[0].id, 'one', 'saved copy offline');
  const other = open('two');
  await other.load(seasonsSpec);
  assert.equal(other.state(seasonsSpec).data, null, 'nothing saved for another account');
  again.cancel();
  other.cancel();
});

test('a malformed seasons answer is an error, not an empty list', async (t) => {
  const { storage } = await setup(t);
  const resources = new WorkoutResources(storage.account('https://example.com', 'one'), {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => ({ seasons: 'none' }),
    post: async () => ({}),
  });
  await resources.load(seasonsSpec);
  assert.equal(resources.state(seasonsSpec).data, null);
  assert.ok(resources.state(seasonsSpec).error);
  resources.cancel();
});

test('trophy slots show the pinned achievement in each place and Empty for the rest', () => {
  const list = [row('a'), row('b'), row('c')];
  const slots = trophySlots(list, ['c', 'a']);
  assert.deepEqual(
    slots.map((s) => s?.id),
    ['c', 'a', undefined],
  );
  assert.equal(slots.length, 3);
  assert.deepEqual(
    trophySlots(list, ['gone']).map((s) => s?.id),
    [undefined, undefined, undefined],
  );
  assert.deepEqual(
    trophySlots([], []).map((s) => s?.id),
    [undefined, undefined, undefined],
  );
});

test('the trophy case is kept per account on this phone and a damaged record reads as empty', async (t) => {
  const { storage } = await setup(t);
  const one = storage.account('https://example.com', 'one');
  const two = storage.account('https://example.com', 'two');
  assert.deepEqual(await readTrophyCase(one), []);
  await writeTrophyCase(one, ['a', 'b']);
  assert.deepEqual(await readTrophyCase(one), ['a', 'b']);
  assert.deepEqual(await readTrophyCase(two), []);
  await writeTrophyCase(one, ['a', 'b', 'c', 'd']);
  assert.deepEqual(await readTrophyCase(one), ['a', 'b', 'c'], 'never more than three');
  await two.set('trophy-case.v1', '{broken');
  assert.deepEqual(await readTrophyCase(two), []);
  await two.set('trophy-case.v1', JSON.stringify({ a: 1 }));
  assert.deepEqual(await readTrophyCase(two), []);
});

test('every title has an icon and a name in Preview, from the one shared catalogue', () => {
  assert.deepEqual(Object.keys(titleIcons).sort(), Object.keys(TITLE_CATALOGUE).sort());
  for (const [id, def] of Object.entries(TITLE_CATALOGUE)) {
    assert.equal(titleName(id), def.display);
    assert.equal(titleLabel(id), def.display);
  }
  assert.equal(titleName(null), null);
  assert.equal(titleName('some_new_title'), 'some new title');
});

test('equipping a title writes through the existing route and shows at once', async (t) => {
  const { open, state } = await setup(t);
  const resources = open('one');
  await resources.load(profileSpec);
  await resources.load({
    path: '/api/friends/leaderboard',
    schema: z.object({ rows: z.array(z.unknown()) }),
  });
  assert.equal(
    (resources.state(profileSpec).data?.user as { equippedTitle?: string | null })
      .equippedTitle,
    null,
  );
  const count = (path: string) => state.reads.filter((read) => read === path).length;
  const [profileBefore, boardBefore] = [
    count('/api/user/profile'),
    count('/api/friends/leaderboard'),
  ];
  assert.equal(await equipTitle(resources, 'unbroken'), true);
  assert.deepEqual(state.patches, [
    { path: '/api/user/equipped-title', body: { titleId: 'unbroken' } },
  ]);
  assert.equal(
    (resources.state(profileSpec).data?.user as { equippedTitle?: string | null })
      .equippedTitle,
    'unbroken',
    'the profile shows it before the re-read',
  );
  await resources.refreshVisible();
  assert.equal(count('/api/user/profile'), profileBefore + 1, 'the profile re-reads');
  assert.equal(
    count('/api/friends/leaderboard'),
    boardBefore + 1,
    'so do the friends views',
  );
  resources.cancel();
});

test('clearing a title sends null, and a refused or failed save changes nothing', async (t) => {
  const { open, state } = await setup(t);
  const resources = open('one');
  state.title = 'unbroken';
  await resources.load(profileSpec);
  const equipped = () =>
    (resources.state(profileSpec).data?.user as { equippedTitle?: string | null })
      .equippedTitle;
  assert.equal(equipped(), 'unbroken');
  state.refuse = true;
  assert.equal(
    await equipTitle(resources, 'iron_will'),
    false,
    'the server says it is not unlocked',
  );
  assert.equal(equipped(), 'unbroken');
  state.refuse = false;
  assert.equal(await equipTitle(resources, null), true);
  assert.deepEqual(state.patches.at(-1), {
    path: '/api/user/equipped-title',
    body: { titleId: null },
  });
  assert.equal(equipped(), null);
  resources.cancel();
});
