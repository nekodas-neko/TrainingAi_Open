import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharedMealFromSaved } from '@trainingai/shared/nutrition/label-payload';
import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload';
import type { SavedMeal as WireSavedMeal } from '@trainingai/shared/types/nutrition';
import { ApiError } from '../src/features/account/api/client.ts';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import {
  foodSchema,
  mealSchema,
  mealTypeSchema,
  scaledLog,
  type Food,
} from '../src/features/nutrition/data/models.ts';
import { recipeTotals } from '../src/features/nutrition/data/recipes.ts';
import { sharedMealCopy } from '../src/features/nutrition/data/shared-meal-copy.ts';
import { FriendMealLibraries } from '../src/features/social/data/FriendMealLibraries.ts';
import {
  addAllLabel,
  addAllResult,
  friendMealSchema,
  friendMealsSchema,
  friendMealSubtitle,
  friendshipWith,
  haveByName,
  newMeals,
  ownedNames,
  portionFigures,
} from '../src/features/social/data/friend-meals.ts';
import type { Friendship } from '../src/features/social/data/models.ts';

const date = '2026-11-20';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mealType = mealTypeSchema.parse({
  id: id(100),
  name: 'Dinner',
  emoji: '🍽️',
  sortOrder: 0,
  timeStartHour: 0,
  timeEndHour: 24,
  required: true,
  remindersEnabled: false,
});

// The friend's meal as the author's own library holds it: foods per 100 g, a multiplier per item.
function authorFood(name: string, calories: number, p: number, c: number, f: number) {
  return { id: `food-${name}`, name, servingSizeG: 100, calories, proteinG: p, carbsG: c, fatG: f, source: 'manual' };
}
function authorMeal(name: string, servings: number, ingredients: number): WireSavedMeal {
  return {
    id: `meal-${name}`,
    name,
    servings,
    items: Array.from({ length: ingredients }, (_, i) => ({
      quantityMultiplier: 0.5 + (i % 5) * 0.7,
      foodItem: authorFood(`${name} ingredient ${i + 1}`, 90 + i * 13, 4 + (i % 7), 9 + (i % 11), 1.5 + (i % 4)),
    })),
  } as unknown as WireSavedMeal;
}
/** What the route answers for a list of the author's meals, as JSON on the wire. */
function routeBody(meals: WireSavedMeal[]) {
  return JSON.parse(
    JSON.stringify({
      meals: meals.map((m) => ({
        mealId: m.id,
        savedAt: '2026-11-01T00:00:00.000Z',
        meal: sharedMealFromSaved(m),
      })),
    }),
  );
}
const sum = (meal: SharedMeal) =>
  meal.ingredients.reduce(
    (a, i) => ({
      calories: a.calories + i.calories,
      proteinG: a.proteinG + i.proteinG,
      carbsG: a.carbsG + i.carbsG,
      fatG: a.fatG + i.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

function fixture() {
  const disk = new Map<string, string>();
  let seq = 1;
  let online = true;
  const foods: Food[] = [];
  const meals: ReturnType<typeof mealSchema.parse>[] = [];
  const logs: ReturnType<typeof scaledLog>[] = [];
  const sent: { domain: string; payload: Record<string, unknown> }[] = [];
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
    userId: 'second-account',
    timezone: 'Australia/Brisbane',
    get: async (path: string): Promise<unknown> => {
      if (!online) throw new Error('offline');
      return path.endsWith('meal-types')
        ? [mealType]
        : path.endsWith('food-items')
          ? foods.slice()
          : path.endsWith('saved-meals')
            ? meals.slice()
            : path.endsWith('targets')
              ? {}
              : path.endsWith('food-logs')
                ? logs.slice()
                : path.endsWith('day-checkin')
                  ? null
                  : path.endsWith('/api/supplements')
                    ? []
                    : path.endsWith('plan-meal-answers')
                      ? { answers: [] }
                      : path.endsWith('meal-statuses')
                        ? { date, statuses: [] }
                        : [];
    },
    post: async (_path: string, body: unknown) => {
      if (!online) throw new Error('offline');
      const op = (
        body as { mutations: { domain: string; date: string; payload: Record<string, unknown> }[] }
      ).mutations[0];
      sent.push(op);
      if (op.domain === 'food_logs') {
        logs.push(
          scaledLog(foods.find((x) => x.id === op.payload.foodItemId)!, {
            ...op.payload,
            date: op.date,
          } as Parameters<typeof scaledLog>[1]),
        );
      }
      if (op.domain === 'food_items') {
        foods.push(foodSchema.parse(op.payload));
      }
      if (op.domain === 'saved_meals') {
        const p = op.payload as {
          id: string;
          name: string;
          servings: number;
          items: { foodItemId: string; quantityMultiplier: number }[];
        };
        meals.push(
          mealSchema.parse({
            ...p,
            items: p.items.map((i) => ({ ...i, foodItem: foods.find((x) => x.id === i.foodItemId)! })),
            totals: recipeTotals(p.items, foods),
          }),
        );
      }
      return { processed: 1, errors: [] };
    },
  };
  const make = () =>
    new NutritionStore(
      storage,
      connection,
      () => id(seq++),
      () => {},
      () => Date.parse(date + 'T03:00:00Z'),
    );
  return { disk, foods, meals, logs, sent, make, online: (v: boolean) => (online = v) };
}
async function ready(f: ReturnType<typeof fixture>) {
  const store = f.make();
  await store.initialize();
  await store.refresh('mealTypes', date);
  await store.refresh('logs', date);
  await store.refresh('foods', date);
  await store.refresh('meals', date);
  return store;
}
let copyIds = 1000;
const copyId = () => id(copyIds++);

test('the route body parses, and a body that is not a list of meals is refused', () => {
  const body = friendMealsSchema.parse(routeBody([authorMeal('Chilli', 4, 3)]));
  assert.equal(body.meals.length, 1);
  assert.equal(body.meals[0].meal.rolled, 0);
  assert.equal(body.meals[0].meal.ingredients.length, 3);
  assert.throws(() => friendMealsSchema.parse({ meals: [{ mealId: 'x' }] }));
  assert.throws(() => friendMealSchema.parse({ ...routeBody([authorMeal('Chilli', 4, 3)]).meals[0], meal: { name: 'x', servings: 0, ingredients: [] } }));
});

test('a copy keeps every ingredient, the portions and the totals of a meal with more than 12', () => {
  const shared = friendMealsSchema.parse(routeBody([authorMeal('Big stew', 6, 15)])).meals[0].meal;
  assert.equal(shared.ingredients.length, 15);
  const copy = sharedMealCopy(shared, copyId)!;
  assert.ok(copy);
  assert.equal(copy.foods.length, 15);
  assert.equal(copy.payload.items.length, 15);
  assert.equal(copy.payload.servings, 6);
  assert.equal(copy.payload.name, 'Big stew');
  // The copy's foods are the viewer's own, minted per 100 g, and the weight rides in the multiplier.
  const copied = recipeTotals(
    copy.payload.items.map((item, i) => ({
      ...item,
      food: foodSchema.parse({ id: copy.foods[i].id, ...copy.foods[i] }),
    })),
    [],
  );
  const original = sum(shared);
  assert.ok(Math.abs(copied.calories / original.calories - 1) < 0.01);
  for (const key of ['proteinG', 'carbsG', 'fatG'] as const) {
    assert.ok(Math.abs(copied[key] / original[key] - 1) < 0.01, key);
  }
});

test('a meal that cannot be a valid saved meal is not copied, and nothing is trimmed to fit', () => {
  const base = friendMealsSchema.parse(routeBody([authorMeal('Chilli', 4, 3)])).meals[0].meal;
  assert.equal(sharedMealCopy({ ...base, ingredients: [] }, copyId), null);
  assert.equal(sharedMealCopy({ ...base, servings: 80 }, copyId), null);
  assert.equal(sharedMealCopy({ ...base, name: '   ' }, copyId), null);
  // 20 kg of one ingredient is a multiplier past the cap of 100: refused, never rescaled.
  const heavy = { ...base, ingredients: [{ ...base.ingredients[0], weightG: 20000 }] };
  assert.equal(sharedMealCopy(heavy, copyId), null);
  // A very long name is kept to the saved-meal name limit.
  assert.equal(sharedMealCopy({ ...base, name: 'x'.repeat(300) }, copyId)!.payload.name.length, 120);
});

test('Add all writes every meal in one local write, offline, and the copies can be logged offline', async () => {
  const f = fixture();
  const store = await ready(f);
  const friend = friendMealsSchema.parse(
    routeBody([authorMeal('Big stew', 6, 15), authorMeal('Oats', 1, 4), authorMeal('Chilli', 4, 7)]),
  ).meals;
  f.online(false);
  const copies = friend.map((m) => sharedMealCopy(m.meal, copyId)!);
  const before = store.getSnapshot().operations.length;
  await store.saveMeals(copies, date);
  const after = store.getSnapshot().operations;
  // One food per ingredient (none match an existing food) and one meal each, all queued at once.
  assert.equal(after.length - before, 15 + 4 + 7 + 3);
  // Each meal's foods come before it, so the server never sees a meal naming a food it lacks.
  for (const op of after.filter((x) => x.domain === 'saved_meals')) {
    const at = after.indexOf(op);
    const items = op.payload.items as { foodItemId: string }[];
    for (const item of items) {
      assert.ok(
        after.slice(0, at).some((x) => x.domain === 'food_items' && x.payload.id === item.foodItemId),
        'a food is queued before the meal that names it',
      );
    }
  }
  const mine = store.view(date).meals;
  assert.deepEqual(
    mine.map((m) => m.name).sort(),
    ['Big stew', 'Chilli', 'Oats'],
  );
  const stew = mine.find((m) => m.name === 'Big stew')!;
  assert.equal(stew.items.length, 15);
  assert.equal(stew.servings, 6);
  const original = sum(friend[0].meal);
  assert.ok(Math.abs(stew.totals.calories / original.calories - 1) < 0.01);
  // Log one portion of the copy with no connection: the log stands.
  await store.logMeal(stew, date, mealType.id, 1);
  const logged = store.view(date).totals!;
  assert.equal(store.view(date).logs.length, 15);
  assert.ok(Math.abs(logged.calories - stew.totals.calories / 6) < 8);
  // It survives the phone restarting, still offline.
  store.cancel();
  const reopened = f.make();
  await reopened.initialize();
  assert.equal(reopened.view(date).meals.length, 3);
  assert.equal(reopened.view(date).logs.length, 15);
  // And it reaches the server, foods before meals, when the connection returns.
  f.online(true);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 0, reopened.getSnapshot().error ?? '');
  assert.equal(f.meals.length, 3);
  assert.equal(f.meals.find((m) => m.name === 'Big stew')!.items.length, 15);
  assert.equal(f.logs.length, 15);
  const firstMeal = f.sent.findIndex((x) => x.domain === 'saved_meals');
  assert.ok(f.sent.slice(0, firstMeal).every((x) => x.domain === 'food_items'));
});

test('a food already in the library, or shared by two copied meals, is reused rather than minted again', async () => {
  const f = fixture();
  const store = await ready(f);
  const a = authorMeal('Plain rice bowl', 2, 2);
  const b = authorMeal('Rice and beans', 2, 2);
  // Both meals use the same first ingredient, so the second copy must find the first's food.
  (b.items[0] as { foodItem: unknown }).foodItem = (a.items[0] as { foodItem: unknown }).foodItem;
  const friend = friendMealsSchema.parse(routeBody([a, b])).meals;
  await store.saveMeals(friend.map((m) => sharedMealCopy(m.meal, copyId)!), date);
  const foodOps = store.getSnapshot().operations.filter((x) => x.domain === 'food_items');
  assert.equal(foodOps.length, 3);
  const mealOps = store.getSnapshot().operations.filter((x) => x.domain === 'saved_meals');
  const shared = (mealOps[0].payload.items as { foodItemId: string }[])[0].foodItemId;
  assert.equal((mealOps[1].payload.items as { foodItemId: string }[])[0].foodItemId, shared);
  // Adding the same meal again reuses all of its foods: only the meal is new.
  await store.saveMeals([sharedMealCopy(friend[0].meal, copyId)!], date);
  assert.equal(store.getSnapshot().operations.filter((x) => x.domain === 'food_items').length, 3);
  assert.equal(store.view(date).meals.length, 3);
});

test('saveMeal still answers one id and writes the same operations as before', async () => {
  const f = fixture();
  const store = await ready(f);
  const food = { ...authorFood('Rice', 130, 2, 29, 1), id: id(501), quantityMultiplier: 1 };
  const meal = await store.saveMeal(
    { name: 'Rice', servings: 2, items: [{ foodItemId: id(501), quantityMultiplier: 3 }] },
    date,
    [food],
  );
  assert.equal(typeof meal, 'string');
  assert.deepEqual(
    store.getSnapshot().operations.map((x) => x.domain),
    ['food_items', 'saved_meals'],
  );
  assert.equal(store.view(date).meals[0].id, meal);
});

test('a failed batch queues nothing at all', async () => {
  const f = fixture();
  const store = await ready(f);
  const good = sharedMealCopy(
    friendMealsSchema.parse(routeBody([authorMeal('Oats', 1, 3)])).meals[0].meal,
    copyId,
  )!;
  const bad = { payload: { ...good.payload, servings: 500 }, foods: good.foods };
  await assert.rejects(store.saveMeals([good, bad], date));
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.view(date).meals.length, 0);
});

test('"in your meals" is a name match that ignores case and spacing, and Add all skips those', () => {
  const friend = friendMealsSchema.parse(
    routeBody([authorMeal('Protein ice cream', 2, 3), authorMeal('Overnight oats', 1, 3), authorMeal('Beef chilli', 4, 3)]),
  ).meals;
  const owned = ownedNames([{ name: ' protein  ICE cream ' }, { name: 'Something else' }]);
  assert.equal(haveByName(friend[0].meal, owned), true);
  assert.equal(haveByName(friend[1].meal, owned), false);
  assert.deepEqual(
    newMeals(friend, owned).map((m) => m.meal.name),
    ['Overnight oats', 'Beef chilli'],
  );
  // Two meals of one name in the friend's list are both new, since each is checked against yours.
  const twins = [friend[1], { ...friend[1], mealId: 'other' }];
  assert.equal(newMeals(twins, owned).length, 2);
  assert.equal(addAllLabel(3), 'Add all 3 new meals');
  assert.equal(addAllLabel(1), 'Add all 1 new meal');
  assert.equal(addAllLabel(0), 'You have all of these meals');
  assert.equal(addAllResult(3, 2, 0), 'Added 3 meals · skipped 2');
  assert.equal(addAllResult(1, 0, 1), 'Added 1 meal · skipped 0 · 1 could not be copied');
});

test('per-portion figures and the subtitle come from the whole recipe', () => {
  const meal: SharedMeal = {
    name: 'Bowl',
    servings: 2,
    rolled: 0,
    ingredients: [
      { name: 'Chicken', weightG: 300, calories: 600, proteinG: 90, carbsG: 0, fatG: 12 },
      { name: 'Rice', weightG: 300, calories: 680, proteinG: 14, carbsG: 150, fatG: 2 },
    ],
  };
  assert.deepEqual(portionFigures(meal), { calories: 640, proteinG: 52, carbsG: 75, fatG: 7 });
  assert.equal(friendMealSubtitle(meal), '2 portions · 640 kcal · P 52 C 75 F 7 per portion');
  assert.equal(friendMealSubtitle({ ...meal, servings: 1 }), '1,280 kcal · P 104 C 150 F 14 per portion');
});

test('only an accepted friendship leads to a friend\'s library', () => {
  const row = (status: 'pending' | 'accepted', other: string): Friendship => ({
    id: id(900 + other.length),
    requesterId: 'me',
    addresseeId: other,
    status,
    createdAt: '',
    updatedAt: '',
    otherUser: { id: other, displayName: null, name: null, avatar: null, friendCode: null, equippedTitle: null },
  });
  const rows = [row('pending', 'a'), row('accepted', 'bb')];
  assert.equal(friendshipWith(rows, 'a'), undefined);
  assert.equal(friendshipWith(rows, 'bb')?.status, 'accepted');
  assert.equal(friendshipWith(undefined, 'bb'), undefined);
});

function library(responder: (path: string) => Promise<unknown>, start = 1_000_000) {
  let clock = start;
  const asked: string[] = [];
  const store = new FriendMealLibraries(
    {
      get: async (path: string) => {
        asked.push(path);
        return responder(path);
      },
    },
    () => clock,
    60_000,
  );
  return { store, asked, tick: (ms: number) => (clock += ms) };
}
const friendship = id(700);
const body = routeBody([authorMeal('Chilli', 4, 3), authorMeal('Oats', 1, 2)]);

test('a friend\'s library is read from the friendship route and held in memory', async () => {
  const { store, asked } = library(async () => body);
  assert.equal(store.state(friendship).meals, null);
  await store.load(friendship);
  assert.deepEqual(asked, [`/api/friends/${friendship}/saved-meals`]);
  assert.equal(store.state(friendship).meals?.length, 2);
  assert.equal(store.state(friendship).unavailable, false);
});

test('reading is shared and skipped while fresh, and repeated on request or when stale', async () => {
  const { store, asked, tick } = library(async () => body);
  await Promise.all([store.load(friendship), store.load(friendship)]);
  assert.equal(asked.length, 1);
  await store.load(friendship);
  assert.equal(asked.length, 1);
  await store.load(friendship, true);
  assert.equal(asked.length, 2);
  tick(61_000);
  await store.load(friendship);
  assert.equal(asked.length, 3);
});

test('a 404 clears a list already held, so a friend who turns sharing off is not offered', async () => {
  let answer: () => Promise<unknown> = async () => body;
  const { store } = library(() => answer());
  await store.load(friendship);
  assert.equal(store.state(friendship).meals?.length, 2);
  answer = async () => {
    throw new ApiError(404);
  };
  await store.load(friendship, true);
  const state = store.state(friendship);
  assert.equal(state.unavailable, true);
  assert.equal(state.meals, null);
  assert.equal(state.error, null);
  // And it comes back when they turn it on again.
  answer = async () => body;
  await store.load(friendship, true);
  assert.equal(store.state(friendship).unavailable, false);
  assert.equal(store.state(friendship).meals?.length, 2);
});

test('any other failure keeps the list already held, so a copy still works offline', async () => {
  let answer: () => Promise<unknown> = async () => body;
  const { store } = library(() => answer());
  await store.load(friendship);
  const failures: [Error, RegExp][] = [
    [new Error('offline'), /connection/],
    [new ApiError(429), /Too many requests/],
    [new ApiError(500), /connection/],
  ];
  for (const [failure, message] of failures) {
    answer = async () => {
      throw failure;
    };
    await store.load(friendship, true);
    const state = store.state(friendship);
    assert.equal(state.meals?.length, 2);
    assert.equal(state.unavailable, false);
    assert.match(state.error ?? '', message);
    assert.equal(state.loading, false);
  }
});

test('with nothing held, a failed read is an error and an unreadable body is refused, not shown', async () => {
  const offline = library(async () => {
    throw new Error('offline');
  });
  await offline.store.load(friendship);
  assert.equal(offline.store.state(friendship).meals, null);
  assert.equal(offline.store.state(friendship).unavailable, false);
  assert.match(offline.store.state(friendship).error ?? '', /connection/);
  const garbled = library(async () => ({ meals: [{ mealId: 1 }] }));
  await garbled.store.load(friendship);
  assert.equal(garbled.store.state(friendship).meals, null);
  assert.match(garbled.store.state(friendship).error ?? '', /could not be read/);
});

test('forgetting a friend drops their list, and a bad id never reaches the network', async () => {
  const { store, asked } = library(async () => body);
  await store.load(friendship);
  store.forget(friendship);
  assert.equal(store.state(friendship).meals, null);
  await store.load('../../admin');
  await store.load('not-a-uuid');
  assert.deepEqual(asked, [`/api/friends/${friendship}/saved-meals`]);
});

test('a subscriber hears each change and the state object is stable between them', async () => {
  const { store } = library(async () => body);
  let heard = 0;
  const stop = store.subscribe(() => heard++);
  const idle = store.state(friendship);
  assert.equal(store.state(friendship), idle);
  await store.load(friendship);
  assert.ok(heard >= 2);
  const held = store.state(friendship);
  assert.equal(store.state(friendship), held);
  stop();
  const before = heard;
  store.forget(friendship);
  assert.equal(heard, before);
});
