import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import {
  V2_LADDERS,
  STEPS_UNITS_PER_T1,
  STEPS_DRAIN_PER_DAY,
  HEALTH_POINTS_PER_T1,
  HEALTH_DRAIN_PER_DAY,
  CARDIO_UNITS_PER_T1,
  CARDIO_DRAIN_PER_DAY,
  replayBankCollection,
  replayCollection,
  type CollectionState,
} from '@trainingai/shared/collection/ladder';
import { LADDER_CLASS } from '@trainingai/shared/collection/sprites';
import { FAUCET_ORDER } from '@trainingai/shared/collection/summary';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { withRewardState } from '../src/features/rewards/data/dependencies.ts';
import { achievementsSpec } from '../src/features/rewards/data/models.ts';
import {
  collectionSpec,
  type Collections,
} from '../src/features/collection/data/models.ts';
import {
  cardModel,
  ladderModel,
  ladderModels,
} from '../src/features/collection/data/view.ts';
import { catArt, catArtFor } from '../src/features/collection/art/index.ts';
import { buildModule, outFile, stripArt } from '../scripts/cat-art.mjs';
import { sqliteFixture } from './storage-fixture.ts';

const today = '2026-10-20';
const days = (count: number, end = today) =>
  Array.from({ length: count }, (_, i) => shiftDateStr(end, -(count - 1 - i)));
// The same four replays the server route runs, on made-up history: the shapes below are what it sends.
function serverCollections(history = { trained: 30, steps: 40, sleep: 20 }): Collections {
  const bank = (n: number, per: number) => new Map(days(n).map((d) => [d, per]));
  return {
    workout: replayCollection({
      days: days(history.trained),
      ladder: V2_LADDERS.workout,
      maxRestGap: 2,
      pausedDays: [],
      today,
    }),
    steps: replayBankCollection({
      gains: bank(history.steps, 9000),
      ladder: V2_LADDERS.steps,
      unitsPerT1: STEPS_UNITS_PER_T1,
      drainPerDay: STEPS_DRAIN_PER_DAY,
      today,
    }),
    health: replayBankCollection({
      gains: bank(history.sleep, 2),
      ladder: V2_LADDERS.health,
      unitsPerT1: HEALTH_POINTS_PER_T1,
      drainPerDay: HEALTH_DRAIN_PER_DAY,
      today,
    }),
    cardio: replayBankCollection({
      gains: bank(10, 5),
      ladder: V2_LADDERS.cardio,
      unitsPerT1: CARDIO_UNITS_PER_T1,
      drainPerDay: CARDIO_DRAIN_PER_DAY,
      today,
    }),
  };
}
const response = (collections = serverCollections()) =>
  JSON.parse(JSON.stringify({ today, v2: { rulesVersion: 2, collections } }));

test("the server's collection answer parses, and keeps the cats, names and decay the screen shows", () => {
  const parsed = collectionSpec.schema.parse(response());
  for (const faucet of FAUCET_ORDER) {
    const state = parsed.v2.collections[faucet];
    assert.ok(state.stock.length > 0, faucet);
    assert.equal(
      state.cats?.length,
      state.stock.reduce((a, b) => a + b, 0),
      `${faucet}: one named cat per held item`,
    );
  }
  assert.ok(
    (parsed.v2.collections.workout.cats ?? []).every((cat) => cat.name.length > 0),
  );
});

test('an answer with no v2 block, or a damaged ladder, is an error and never an empty collection', () => {
  assert.equal(
    collectionSpec.schema.safeParse({ today, collections: {} }).success,
    false,
  );
  const damaged = response();
  damaged.v2.collections.steps.stock = 'none';
  assert.equal(collectionSpec.schema.safeParse(damaged).success, false);
});

test("the Home card names the ladder nearest its next merge, in the current app's words", () => {
  const collections = serverCollections();
  const model = cardModel(collections);
  assert.equal(model.kind, 'merge');
  if (model.kind !== 'merge') return;
  assert.match(model.toward, /^[A-Z]/, 'first letter capitalised');
  assert.match(model.count, /^\d+ more /);
  assert.ok(model.need >= model.have);
  assert.equal(model.shown, Math.min(model.need, 7));
});

test('when every rung is already at its merge cost the card says how many are held', () => {
  const none: CollectionState = {
    stock: [0, 0, 0, 0, 0, 0],
    duplicateDays: 0,
    decayEvents: 0,
  };
  const full = Object.fromEntries(
    FAUCET_ORDER.map((faucet) => [
      faucet,
      {
        ...none,
        stock: V2_LADDERS[faucet].tiers.map(
          (_, i) => V2_LADDERS[faucet].tiers[i + 1]?.mergeCost ?? 0,
        ),
      },
    ]),
  ) as Collections;
  const held = FAUCET_ORDER.reduce(
    (sum, faucet) => sum + full[faucet].stock.reduce((a, b) => a + b, 0),
    0,
  );
  assert.deepEqual(cardModel(full), {
    kind: 'empty',
    restless: null,
    text: `${held} in your collection.`,
  });
});

test("a new account's card still points at the first merge rather than saying it has nothing", () => {
  const none: CollectionState = {
    stock: [0, 0, 0, 0, 0, 0],
    duplicateDays: 0,
    decayEvents: 0,
  };
  const model = cardModel({ workout: none, steps: none, health: none, cardio: none });
  assert.equal(model.kind, 'merge');
});

test('a cat about to leave and one that already did are named on the card', () => {
  const base = serverCollections();
  const restless = {
    ...base,
    workout: { ...base.workout, restless: true },
  };
  const model = cardModel(restless);
  assert.match(model.restless ?? '', / is getting restless — /);
  // Leave only the Tank with a merge to make, so that is the ladder the card shows.
  const atCost = (faucet: keyof Collections): CollectionState => ({
    stock: V2_LADDERS[faucet].tiers.map(
      (_, i) => V2_LADDERS[faucet].tiers[i + 1]?.mergeCost ?? 0,
    ),
    duplicateDays: 0,
    decayEvents: 0,
  });
  const lost = {
    workout: {
      stock: [0, 0, 0, 0, 0, 0],
      duplicateDays: 0,
      decayEvents: 3,
      lastLost: { name: 'Pip', day: '2026-09-12' },
    },
    steps: atCost('steps'),
    health: atCost('health'),
    cardio: atCost('cardio'),
  } satisfies Collections;
  const after = cardModel(lost);
  assert.equal(after.kind, 'merge');
  if (after.kind === 'merge') {
    assert.equal(
      after.note,
      'Pip wandered off on 12 Sep — the days underneath still count.',
    );
  }
  // With no named cat, the lifetime count is said instead.
  const unnamed = cardModel({ ...lost, workout: { ...lost.workout, lastLost: null } });
  if (unnamed.kind === 'merge') {
    assert.equal(
      unnamed.note,
      '3 have wandered off over long gaps — the days underneath them still count.',
    );
  }
});

test('each ladder row lists its stock by tier, the provisional Rogue, the roster and the decay line', () => {
  const collections = serverCollections();
  const rows = ladderModels(collections);
  assert.deepEqual(
    rows.map((r) => r.faucet),
    ['workout', 'steps', 'health', 'cardio'],
  );
  assert.deepEqual(
    rows.map((r) => r.provisional),
    [false, false, false, true],
  );
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Workouts', 'Steps', 'Health logging', 'Cardio sessions'],
  );
  const workout = rows[0];
  assert.equal(workout.tiers.length, V2_LADDERS.workout.tiers.length);
  assert.ok(workout.tiers.every((t) => /^[A-Z]/.test(t.name)));
  assert.equal(
    workout.tiers.reduce((sum, t) => sum + t.count, 0),
    collections.workout.stock.reduce((a, b) => a + b, 0),
  );
  assert.ok(
    workout.roster.every((cat) => cat.detail.length > 0 && /^[A-Z]/.test(cat.tierName)),
  );
});

test('a long roster lists twenty and counts the rest; held and decay read singular and plural', () => {
  const cats = Array.from({ length: 27 }, (_, i) => ({
    id: `c${i}`,
    tier: 0,
    name: `Cat${i}`,
    born: '2026-09-01',
    from: [],
  }));
  const state: CollectionState = {
    stock: [27, 0, 0, 0, 0, 0],
    duplicateDays: 0,
    decayEvents: 1,
    cats,
  };
  const collections = { ...serverCollections(), workout: state };
  const row = ladderModel('workout', collections);
  assert.equal(row.roster.length, 20);
  assert.equal(row.more, 7);
  assert.equal(row.held, '27 held');
  assert.equal(row.decay, 'One has wandered off during long gaps.');
  const one = ladderModel('workout', {
    ...collections,
    workout: {
      ...state,
      stock: [1, 0, 0, 0, 0, 0],
      decayEvents: 4,
      cats: cats.slice(0, 1),
    },
  });
  assert.equal(one.held, '1 held');
  assert.equal(one.decay, '4 have wandered off during long gaps.');
  assert.equal(one.more, 0);
});

test('every ladder tier has still art, none of it carrying what the phone cannot draw', () => {
  for (const faucet of FAUCET_ORDER) {
    for (let tier = 0; tier < V2_LADDERS[faucet].tiers.length; tier++) {
      const xml = catArtFor(faucet, tier);
      assert.ok(xml, `${faucet} tier ${tier + 1} (${LADDER_CLASS[faucet]})`);
      assert.match(xml, /^<svg\b/);
      assert.match(xml, /<\/svg>$/);
      assert.doesNotMatch(
        xml,
        /<style|<filter|\sfilter=|\sclass=|\sstyle=|@keyframes|animation/,
      );
    }
  }
  assert.ok(catArt['scene-meadow'].startsWith('<svg'));
  assert.doesNotMatch(catArt['scene-meadow'], /<style|<filter|animation/);
});

test('the committed art is what the script builds from public/cats today', () => {
  assert.equal(readFileSync(outFile, 'utf8'), buildModule());
});

test('stripping removes the animation, the rim filter and the hooks, and leaves the drawing', () => {
  const svg =
    '<svg viewBox="0 0 8 8" style="--d:0s"><defs><filter id="r"><feFlood/></filter><radialGradient id="g"/></defs>' +
    '<style>.a{animation:x 1s}</style><g filter="url(#r)" class="a"><path d="M0 0" fill="#fff"/></g></svg>';
  assert.equal(
    stripArt(svg),
    '<svg viewBox="0 0 8 8"><defs><radialGradient id="g"/></defs><g><path d="M0 0" fill="#fff"/></g></svg>',
  );
  assert.equal(stripArt(stripArt(svg)), stripArt(svg), 'stripping twice changes nothing');
});

// The data layer: the real WorkoutResources over real (in-memory) account storage.
async function setup(t: { after: (fn: () => void) => void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const state = {
    now: 1_000_000,
    offline: false,
    gate: null as Promise<void> | null,
    reads: [] as string[],
  };
  const open = (userId: string) =>
    new WorkoutResources(
      storage.account('https://example.com', userId),
      {
        origin: 'https://example.com',
        userId,
        timezone: null,
        get: async (path: string) => {
          state.reads.push(path);
          await state.gate;
          if (state.offline) throw new Error('Offline');
          return userId === 'one'
            ? response()
            : response(serverCollections({ trained: 2, steps: 1, sleep: 1 }));
        },
        post: async () => ({}),
      },
      () => state.now,
    );
  return { state, open };
}
const reads = (state: { reads: string[] }) =>
  state.reads.filter((path) => path === '/api/collection').length;

test("the collection loads per account, and a second account never sees the first's saved copy", async (t) => {
  const { open, state } = await setup(t);
  const one = open('one');
  await one.load(collectionSpec);
  const held = one.state(collectionSpec).data?.v2.collections.workout.stock;
  assert.ok(held && held.some((n) => n > 0));
  one.cancel();
  state.offline = true;
  const again = open('one');
  await again.load(collectionSpec);
  assert.deepEqual(again.state(collectionSpec).data?.v2.collections.workout.stock, held);
  const other = open('two');
  await other.load(collectionSpec);
  assert.equal(other.state(collectionSpec).data, null);
  assert.ok(other.state(collectionSpec).error, 'offline with nothing saved says so');
  again.cancel();
  other.cancel();
});

test('a repeat visit paints the saved collection before the network has answered', async (t) => {
  const { open, state } = await setup(t);
  const first = open('one');
  await first.load(collectionSpec);
  first.cancel();
  // Next launch: the network is slow. The saved answer must show without waiting for it.
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => (release = resolve));
  state.now += 10 * 60_000;
  const second = open('one');
  const loading = second.load(collectionSpec);
  for (let i = 0; i < 50 && !second.state(collectionSpec).data; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(second.state(collectionSpec).data, 'shown from the saved copy');
  assert.equal(second.state(collectionSpec).loading, false, 'not a skeleton');
  state.gate = null;
  release();
  await loading;
  second.cancel();
});

test('a workout or a day-log edit expires the collection with the achievements, and an import does not', async (t) => {
  assert.deepEqual(withRewardState(['/api/streak-data']), [
    '/api/streak-data',
    '/api/achievements',
    '/api/collection',
  ]);
  assert.deepEqual(withRewardState(['/api/phase-sets']), [
    '/api/phase-sets',
    '/api/collection',
  ]);
  assert.deepEqual(withRewardState(['/api/workout-templates']), [
    '/api/workout-templates',
    '/api/collection',
  ]);
  assert.deepEqual(withRewardState(['/api/streak-data', '/api/collection']), [
    '/api/streak-data',
    '/api/collection',
    '/api/achievements',
  ]);
  assert.deepEqual(withRewardState(['/api/sleep-sessions', '/api/day-log']), [
    '/api/sleep-sessions',
    '/api/day-log',
  ]);

  const { open, state } = await setup(t);
  const resources = open('one');
  await resources.load(collectionSpec);
  await resources.load(achievementsSpec as never).catch(() => {});
  const before = reads(state);
  for (let minute = 1; minute <= 4; minute++) {
    state.now += 60_000;
    resources.invalidate(['/api/sleep-sessions', '/api/day-log', '/api/body-metadata']);
    await resources.refreshVisible();
  }
  assert.equal(reads(state), before, 'imports leave the collection to its five minutes');
  resources.invalidate(['/api/streak-data', '/api/exercise-history']);
  await resources.refreshVisible();
  assert.equal(reads(state), before + 1, 'a finished workout re-reads it at once');
  resources.invalidate(['/api/phase-sets']);
  await resources.refreshVisible();
  assert.equal(reads(state), before + 2, 'so does an edit to the programme');
  resources.cancel();
});

test('the collection screen is the same shape as the answer: z.object with the four ladders', () => {
  const shape = (collectionSpec.schema as z.ZodObject).shape.v2 as z.ZodObject;
  assert.deepEqual(Object.keys((shape.shape.collections as z.ZodObject).shape), [
    'workout',
    'steps',
    'health',
    'cardio',
  ]);
});
