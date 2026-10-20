import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { TITLE_CATALOGUE, trophySlots } from '@trainingai/shared/achievement-display';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { profileSpec } from '../src/features/health/data/models.ts';
import { seasonsSpec, type Achievement } from '../src/features/rewards/data/models.ts';
import {
  cachedTrophyCase,
  readTrophyCase,
  rememberTrophyCase,
  trophyCacheKey,
  writeTrophyCase,
} from '../src/features/rewards/data/trophy.ts';
import { equipTitle } from '../src/features/rewards/data/titles.ts';
import {
  seasonBadges,
  titleName,
  equippedTitleName,
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
    hold: null as Promise<void> | null,
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
      if (path === '/api/user/profile') {
        await state.hold;
        return { user: { name: 'One', equippedTitle: state.title } };
      }
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
    trophySlots<Achievement>([], []).map((s) => s?.id),
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
  assert.deepEqual(
    await readTrophyCase(one),
    ['b', 'c', 'd'],
    'the newest three, as pinning keeps',
  );
  await one.set('trophy-case.v1', JSON.stringify(['a', 'b', 'c', 'd', 'e']));
  assert.deepEqual(
    await readTrophyCase(one),
    ['c', 'd', 'e'],
    'an old longer record too',
  );
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
  // The profile re-read after the save is held back, so what the screen shows right after the
  // save can only be the update made from the save itself, not the server's answer.
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => (release = resolve));
  assert.equal(await equipTitle(resources, 'unbroken'), true);
  assert.deepEqual(state.patches, [
    { path: '/api/user/equipped-title', body: { titleId: 'unbroken' } },
  ]);
  assert.equal(
    (resources.state(profileSpec).data?.user as { equippedTitle?: string | null })
      .equippedTitle,
    'unbroken',
    'the profile shows it before the re-read has answered',
  );
  state.hold = null;
  release();
  await resources.refreshVisible();
  assert.equal(count('/api/user/profile'), profileBefore + 1, 'the profile re-reads');
  assert.equal(
    count('/api/friends/leaderboard'),
    boardBefore + 1,
    'so do the friends views',
  );
  assert.equal(
    (resources.state(profileSpec).data?.user as { equippedTitle?: string | null })
      .equippedTitle,
    'unbroken',
    'and the server agrees',
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

test('pins read once this session are known at once next time, per account', () => {
  const one = trophyCacheKey('https://example.com', 'one');
  const two = trophyCacheKey('https://example.com', 'two');
  const other = trophyCacheKey('https://other.example.com', 'one');
  assert.equal(cachedTrophyCase(one), undefined, 'nothing known before the first read');
  rememberTrophyCase(one, ['a', 'b']);
  assert.deepEqual(cachedTrophyCase(one), ['a', 'b']);
  assert.equal(cachedTrophyCase(two), undefined, 'another account has none');
  assert.equal(cachedTrophyCase(other), undefined, 'nor the same id on another server');
  rememberTrophyCase(one, ['b', 'c', 'd', 'e']);
  assert.deepEqual(cachedTrophyCase(one), ['c', 'd', 'e'], 'never more than three');
  rememberTrophyCase(one, []);
  assert.deepEqual(
    cachedTrophyCase(one),
    [],
    'an empty case is a known answer, not a missing one',
  );
});

test('the hero shows "Tap to set title" for no title and for an id the catalogue does not list', () => {
  assert.equal(equippedTitleName(null), null);
  assert.equal(equippedTitleName(undefined), null);
  assert.equal(equippedTitleName('some_new_title'), null);
  assert.equal(equippedTitleName('unbroken'), 'Unbroken');
});
