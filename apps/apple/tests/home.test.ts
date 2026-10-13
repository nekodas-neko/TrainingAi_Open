import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomeStore, type HomeChange } from '../src/features/home/data/HomeStore.ts';
import {
  greeting,
  homeSections,
  homeStreak,
  moveHomeSection,
  trainingDays,
  trainingWeek,
} from '../src/features/home/data/models.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  goalsReviewDue,
  localHour,
  recapHasData,
  shouldOfferMorning,
} from '../src/features/home/data/banner-data.ts';
import { HealthStore } from '../src/features/health/data/HealthStore.ts';
import { localTimeline } from '../src/features/home/data/timeline.ts';
import {
  timelineDestinationDate,
  timelineMetrics,
  timelineSummary,
  timelineTitle,
} from '../src/features/home/data/timeline-presentation.ts';
import { timelineEventSchema } from '../src/features/home/data/timeline.ts';
import { sleepSchema } from '../src/features/health/data/models.ts';
import { loggingFixture } from './logging-fixture.ts';
import { createWorkout } from '../src/features/workouts/logging/workout.ts';

const day = '2026-10-12';

test('timeline keeps zero measurements and leaves absent values unknown', () => {
  const event = timelineEventSchema.parse({
    type: 'meal',
    title: '🍳 Breakfast',
    time: '8:00 am',
    timeMs: 0,
    day: 'today',
    calories: 0,
  });
  assert.equal(timelineTitle(event), 'Breakfast');
  assert.equal(event.title, '🍳 Breakfast');
  assert.equal(timelineSummary(event), '0 kcal');
  assert.equal(timelineSummary({ ...event, calories: undefined }), '');
  assert.equal(timelineTitle({ ...event, type: 'workout' }), '🍳 Breakfast');
});

test('sleep duration appears once on the timeline but remains available in bedtime details', () => {
  const event = timelineEventSchema.parse({
    type: 'sleep',
    title: 'Fell asleep',
    time: '11:02 pm',
    timeMs: 0,
    day: 'yesterday',
    sleepDurationH: 7 + 1 / 6,
    subtitle: 'Apple Health',
  });
  assert.equal(timelineSummary(event), 'Apple Health');
  assert.equal(timelineSummary({ ...event, durationMin: 435 }), 'Apple Health');
  assert.equal(timelineSummary({ ...event, type: 'wakeup' }), '7h 10m · Apple Health');
  assert.equal(
    timelineMetrics(event).find((row) => row.label === 'Time asleep')?.value,
    '7h 10m',
  );
});

test('bedtime opens the overnight record while meal navigation retains its event day', () => {
  const event = timelineEventSchema.parse({
    type: 'sleep',
    title: 'Fell asleep',
    time: '11:02 pm',
    timeMs: Date.parse('2026-10-12T23:02:00+10:00'),
    day: 'yesterday',
    date: '2026-10-12',
  });
  const night = sleepSchema.parse({
    date: '2026-10-13',
    sleepStart: '2026-10-12T23:02:00+10:00',
    sleepEnd: '2026-10-13T06:17:00+10:00',
  });
  assert.equal(timelineDestinationDate(event, '2026-10-13', [night]), '2026-10-13');
  assert.equal(
    timelineDestinationDate({ ...event, type: 'meal' }, '2026-10-13', [night]),
    '2026-10-12',
  );
  assert.equal(timelineDestinationDate(event, '2026-10-13', []), '2026-10-12');
  assert.equal(
    timelineDestinationDate({ ...event, sleepDate: '2026-10-11' }, '2026-10-13', [night]),
    '2026-10-11',
  );
});
function fixture() {
  const disk = new Map<string, string>();
  let sequence = 0;
  let online = true;
  let failDisk = false;
  let lost = false;
  let now = Date.parse(day + 'T02:00:00Z');
  const moods = new Map<string, Record<string, unknown>>();
  const rests = new Set<string>();
  const preferences: Record<string, unknown> = {};
  const sent: { id: string; domain: string; date: string; payload: Record<string, unknown> }[] =
    [];
  const reads: string[] = [];
  const changes: HomeChange[] = [];
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (failDisk) {
        throw new Error('disk full');
      }
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-a',
    timezone: 'Australia/Brisbane',
    get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
      reads.push(path);
      if (!online) {
        throw new TypeError('offline');
      }
      if (path === '/api/mood') {
        return moods.get(query!.date) ?? null;
      }
      if (path === '/api/log-rest-day') {
        return { dates: [...rests].filter((date) => date >= query!.from && date <= query!.to) };
      }
      return { ...preferences };
    },
    post: async (path: string, body: unknown) => {
      if (!online) {
        throw new TypeError('offline');
      }
      if (path === '/api/nutrition-goals/touch-review') {
        return { ok: true };
      }
      if (path === '/api/log-rest-day') {
        const value = body as { date: string; resting: boolean };
        if (value.resting) {
          rests.add(value.date);
        } else {
          rests.delete(value.date);
        }
        return { ok: true, ...value };
      }
      const value = (body as { mutations: typeof sent }).mutations[0];
      sent.push(value);
      moods.set(value.date, {
        ...value.payload,
        id: value.id,
        userId: 'account-a',
        logDate: value.date,
      });
      if (lost) {
        lost = false;
        throw new Error('reply lost');
      }
      return { processed: 1, errors: [] };
    },
    patch: async (_path: string, body: unknown) => {
      if (!online) {
        throw new TypeError('offline');
      }
      Object.assign(preferences, body);
      return { ...preferences };
    },
  };
  const make = (userId = 'account-a') =>
    new HomeStore(
      storage,
      { ...connection, userId },
      () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      (kind) => changes.push(kind),
      () => now,
    );
  return {
    disk,
    storage,
    connection,
    moods,
    rests,
    preferences,
    sent,
    reads,
    changes,
    make,
    online: (value: boolean) => {
      online = value;
    },
    failDisk: () => {
      failDisk = true;
    },
    lost: () => {
      lost = true;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('exercise readiness survives an offline reopen and syncs to its original day', async () => {
  const f = fixture();
  f.online(false);
  const store = f.make();
  await store.initialize();
  await store.saveMood(day, {
    energyLevel: 'good',
    soreMuscles: ['Quads'],
    bodyState: ['sore_muscles'],
    suggestedSoreMuscles: [],
  });
  await store.sync();
  const reopened = f.make();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().moods[day]?.energyLevel, 'good');
  assert.equal(reopened.getSnapshot().moods['2026-10-13'], undefined);
  f.online(true);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 0);
  assert.equal(f.sent[0].domain, 'mood_logs');
  assert.equal(f.sent[0].date, day);
});

test('a lost readiness reply retries one mutation identity and retains the local answer', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  f.lost();
  await store.saveMood(day, { energyLevel: 'low', soreMuscles: [], bodyState: [] });
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 1);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(f.sent[0].id, f.sent[1].id);
  assert.equal(f.moods.size, 1);
});

test('readiness readback cannot accept a different account or an unconfirmed write', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  f.connection.get = async () => ({
    id: 'other',
    userId: 'account-b',
    logDate: day,
    energyLevel: 'good',
    soreMuscles: [],
    bodyState: [],
  });
  // The store captures a scoped connection at construction.
  const scoped = new HomeStore(
    f.storage,
    f.connection,
    () => '10000000-0000-4000-8000-000000000099',
  );
  await scoped.initialize();
  await scoped.saveMood(day, { energyLevel: 'good' });
  await scoped.sync();
  assert.equal(scoped.getSnapshot().operations.length, 1);
  assert.equal(scoped.getSnapshot().moods[day]?.userId, 'account-a');
});

test('Home preferences keep pending local choices through remote refresh and reopen', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  f.online(false);
  await store.savePreferences({
    homeWidgets: ['steps'],
    homeCards: ['nutritionDonut'],
    homeHiddenSections: ['streak'],
  });
  await store.sync();
  f.online(true);
  Object.assign(f.preferences, {
    homeWidgets: ['weightKg'],
    homeCards: [],
    brandTheme: 'other-device',
  });
  await store.refresh('preferences', day, true);
  assert.deepEqual(store.getSnapshot().preferences.homeWidgets, ['steps']);
  const reopened = f.make();
  await reopened.initialize();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 0);
  assert.deepEqual(f.preferences.homeCards, ['nutritionDonut']);
  assert.equal(f.preferences.brandTheme, 'other-device');
});

test('failed disk saves cannot claim that a check-in or preference was saved', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  f.failDisk();
  await assert.rejects(store.saveMood(day, { energyLevel: 'good' }));
  await assert.rejects(store.savePreferences({ homeWidgets: ['steps'] }));
  assert.equal(store.getSnapshot().moods[day], undefined);
  assert.deepEqual(store.getSnapshot().preferences, {});
  assert.equal(f.sent.length, 0);
});

test('choosing and undoing rest survives reopening and confirms the exact date', async () => {
  const f = fixture();
  f.online(false);
  const store = f.make();
  await store.initialize();
  await store.chooseRestDay(day, true);
  await store.sync();
  const reopened = f.make();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().restDays[day], true);
  f.online(true);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 0);
  assert.equal(f.rests.has(day), true);
  await reopened.chooseRestDay(day, false);
  await reopened.sync();
  assert.equal(f.rests.has(day), false);
  assert.equal(reopened.getSnapshot().restDays[day], false);
});

test('cached Home reads skip fresh checks, back off on failures, and allow a manual retry', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  await store.refresh('mood', day);
  await Promise.all([store.refresh('mood', day), store.refresh('mood', day)]);
  assert.equal(f.reads.length, 1);
  f.advance(300001);
  f.online(false);
  await store.refresh('mood', day);
  await store.refresh('mood', day);
  assert.equal(f.reads.length, 2);
  f.online(true);
  await store.refresh('mood', day, true);
  assert.equal(f.reads.length, 3);
  assert.equal(store.getSnapshot().errors[`mood:${day}`], undefined);
});

test('authorization rejection prevents cached Home edits and preserves the disk for another account', async () => {
  const f = fixture();
  const store = new HomeStore(
    f.storage,
    {
      ...f.connection,
      get: async () => {
        throw new ApiError(403);
      },
    },
    () => '10000000-0000-4000-8000-000000000098',
  );
  await store.initialize();
  await store.refresh('mood', day);
  await assert.rejects(store.saveMood(day, { energyLevel: 'good' }));
  const wrong = f.make('account-b');
  await wrong.initialize();
  // An empty account has no cache to adopt; explicitly saved state must never cross scopes.
  const clean = f.make();
  await clean.initialize();
  await clean.savePreferences({ homeWidgets: ['steps'] });
  await clean.sync();
  const raw = f.disk.get('home.v1');
  const other = f.make('account-b');
  await other.initialize();
  assert.equal(other.getSnapshot().ready, false);
  assert.equal(f.disk.get('home.v1'), raw);
});

test('Home calendar normalizes separators and adds local completed workouts without duplicates', () => {
  const days = trainingDays(
    [{ '2026/10/12': ['Upper A'] }],
    [
      { id: 'one', date: day, sessionName: 'Upper A', status: 'completed' },
      { id: 'two', date: day, sessionName: 'Legs A', status: 'completed' },
      { id: 'three', date: day, sessionName: 'Active', status: 'active' },
    ],
  );
  assert.deepEqual(days[day], ['Upper A', 'Legs A']);
  const week = trainingWeek(days, '2026-11-01');
  assert.equal(week[0].date, '2026-10-26');
  assert.equal(week[6].date, '2026-11-01');
  assert.equal(week[6].isToday, true);
  assert.equal(week.filter((x) => x.future).length, 0);
  assert.ok(
    homeStreak({ '2026-10-09': ['Legs A'], [day]: ['Upper A'] }, day, {
      type: 'weekly',
      days: [
        { dayOfWeek: 1, sessionId: 'a' },
        { dayOfWeek: 5, sessionId: 'b' },
      ],
    }) > 0,
  );
});

test('layout moves stored keys across hidden slots, and greetings follow the account timezone', () => {
  const prefs = {
    homeCards: ['sleepWidget'],
    homeSectionOrder: [
      'streak',
      'recommendation',
      'weekStrip',
      'card_sleepWidget',
      'metricTiles',
    ],
  };
  const order = homeSections(prefs);
  assert.deepEqual(moveHomeSection(order, 'card_sleepWidget', -1), [
    'streak',
    'recommendation',
    'card_sleepWidget',
    'weekStrip',
    'metricTiles',
  ]);
  assert.equal(moveHomeSection(order, 'unknown', 1), order);
  assert.equal(
    greeting('Alex', 'Australia/Brisbane', new Date('2026-10-11T22:00:00Z')),
    'Good morning, Alex.',
  );
  assert.equal(
    greeting('Alex', 'America/Los_Angeles', new Date('2026-10-11T22:00:00Z')),
    'Good afternoon, Alex.',
  );
  assert.equal(
    greeting(
      '  Joshua Boissevain-Giuliany  ',
      'Australia/Brisbane',
      new Date('2026-10-12T04:00:00Z'),
    ),
    'Good afternoon, Joshua.',
  );
});
test('dismissals survive reopening per day/week and offline goal postponement retains its upload', async () => {
  const f = fixture();
  f.online(false);
  const store = f.make();
  await store.initialize();
  await store.mark(`morning:${day}`);
  await store.mark('week:2026-10-05');
  await store.postponeGoals(day);
  await store.sync();
  const next = f.make();
  await next.initialize();
  assert.equal(next.getSnapshot().markers[`morning:${day}`], true);
  assert.equal(next.getSnapshot().markers['morning:2026-10-13'], undefined);
  assert.equal(next.getSnapshot().operations[0].kind, 'goal-review');
  f.online(true);
  await next.sync();
  assert.equal(next.getSnapshot().operations.length, 0);
});
test('banner eligibility uses the recap week and the profile review timestamp', () => {
  const now = Date.parse(day + 'T04:00:00Z');
  assert.equal(
    goalsReviewDue(
      {
        activityLevel: 'moderate',
        fitnessGoal: 'maintenance',
        lastGoalReviewAt: '2026-10-01T00:00:00Z',
      },
      now,
    ),
    false,
  );
  assert.equal(
    goalsReviewDue(
      { activityLevel: 'moderate', fitnessGoal: 'maintenance', lastGoalReviewAt: null },
      now,
    ),
    true,
  );
  assert.equal(
    goalsReviewDue(
      { activityLevel: null, fitnessGoal: 'maintenance', lastGoalReviewAt: null },
      now,
    ),
    false,
  );
  assert.equal(
    recapHasData({
      training: { sessions: 0 },
      prs: [],
      muscleSets: [],
      hrv: { week: null, priorWeek: 55 },
      weightChangeKg: 2,
    }),
    false,
  );
  assert.equal(recapHasData({ training: { sessions: 1 } }), true);
  assert.equal(localHour('Australia/Brisbane', new Date(day + 'T08:00:00Z')), 18);
});
test('morning prompts inspect the row after a successful read and respect pending local answers', async () => {
  const f = fixture();
  let reads = 0;
  const store = new HealthStore(
    f.storage,
    {
      ...f.connection,
      get: async () => {
        reads++;
        return null;
      },
    },
    () => '30000000-0000-4000-8000-000000000001',
  );
  await store.initialize();
  assert.equal(await shouldOfferMorning(store, day), true);
  assert.equal(store.getSnapshot().checkins[day], null);
  await store.saveCheckin(day, {
    phase: 'morning',
    vsNormal: 'same',
    vsNormalTouched: true,
    soreMuscles: [],
  });
  assert.equal(await shouldOfferMorning(store, day), false);
  assert.equal(reads, 1);
  const canceled = new HealthStore(
    f.storage,
    {
      ...f.connection,
      userId: 'new',
      get: async () => {
        canceled.cancel();
        return null;
      },
    },
    () => '30000000-0000-4000-8000-000000000002',
  );
  await canceled.initialize();
  assert.equal(await shouldOfferMorning(canceled, day), null);
});
test('an unsynced completed workout enters Home timeline and a lost-reply server event does not duplicate it', () => {
  const f = loggingFixture();
  let sequence = 0;
  const at = Date.parse(day + 'T00:00:00Z');
  const created = createWorkout(
    f.catalog.program!.sessions[0],
    f.catalog.program!.id,
    'Australia/Brisbane',
    false,
    at,
    () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  );
  const pending = {
    ...created,
    status: 'completed' as const,
    completedAt: at + 30 * 60_000,
    pending: [{ id: 'pending', domain: 'complete_workout' as const }],
  };
  const events = localTimeline([], [pending], [], day, 'Australia/Brisbane');
  assert.equal(events.length, 1);
  assert.equal(events[0].durationMin, 30);
  assert.equal(localTimeline(events, [pending], [], day, 'Australia/Brisbane').length, 1);
});

test('dragging variable-height sections displaces neighbours and preserves hidden sections', async () => {
  const { dragOrder, displacedItems, preserveHiddenOrder } =
    await import('../src/shared/ui/reorder.ts');
  const order = ['recommendation', 'streak', 'metricTiles'];
  const bounds = new Map([
    ['recommendation', { y: 0, height: 220 }],
    ['streak', { y: 232, height: 100 }],
    ['metricTiles', { y: 344, height: 140 }],
  ]);
  assert.deepEqual(dragOrder(order, bounds, 'recommendation', 20), order);
  const next = dragOrder(order, bounds, 'recommendation', 310);
  assert.deepEqual(next, ['streak', 'metricTiles', 'recommendation']);
  const shifts = displacedItems(order, next, bounds, 12);
  assert.equal(shifts.get('streak'), -232);
  assert.equal(shifts.get('metricTiles'), -232);
  assert.deepEqual(
    preserveHiddenOrder(['recommendation', 'hidden', 'streak', 'metricTiles'], next),
    ['streak', 'hidden', 'metricTiles', 'recommendation'],
  );
  assert.deepEqual(dragOrder(order, new Map(), 'recommendation', 400), order);
  assert.deepEqual(dragOrder(order, bounds, 'metricTiles', -1000), [
    'metricTiles',
    'recommendation',
    'streak',
  ]);
});

test('layout sync reports a preference change while health writes retain data refresh notifications', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  await store.savePreferences({
    homeSectionOrder: ['metricTiles', 'streak', 'recommendation', 'weekStrip'],
  });
  await store.sync();
  assert.deepEqual(f.changes, ['preferences']);
  assert.deepEqual(
    f.preferences.homeSectionOrder,
    store.getSnapshot().preferences.homeSectionOrder,
  );
  assert.equal(store.getSnapshot().operations.length, 0);
  await store.saveMood(day, {
    energyLevel: 'good',
    soreMuscles: [],
    bodyState: [],
    suggestedSoreMuscles: [],
  });
  await store.sync();
  assert.deepEqual(f.changes, ['preferences', 'mood', 'mood']);
  await store.chooseRestDay(day, true);
  await store.sync();
  assert.deepEqual(f.changes.slice(-2), ['rest', 'rest']);
});
