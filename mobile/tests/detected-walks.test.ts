import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANSWERED_WALK_MEMORY_MS,
  confirmDetectedWalk,
  detectedActivityPayload,
  initialChoice,
  offeredToday,
  recordedSpans,
  visibleWalks,
  walkCandidatesSpec,
} from '../src/features/home/data/detected-walks.ts';
import { HomeStore } from '../src/features/home/data/HomeStore.ts';
import { ActivityStore } from '../src/features/activities/data/ActivityStore.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const tz = 'Australia/Brisbane';
// 9:10–9:32 on 12 Oct 2026, Brisbane (UTC+10, no daylight saving).
const at = (hhmm: string) => Date.parse(`2026-10-12T${hhmm}:00+10:00`);
const walk = { startMs: at('09:10'), endMs: at('09:32'), durationMin: 22 };
const later = { startMs: at('14:00'), endMs: at('14:20'), durationMin: 20 };
const now = at('15:00');

function stores() {
  const values = new Map<string, string>();
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
  const posts: { payload: { id: string; title: string } }[] = [];
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: tz,
    get: async () => ({ activityLogs: [] }),
    post: async (_path, body) => {
      posts.push(...(body as { mutations: typeof posts }).mutations);
      return { processed: 1, errors: [] };
    },
  };
  let clock = now;
  let sequence = 0;
  const uuid = () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const home = (storageOverride = storage) =>
    new HomeStore(storageOverride, connection, uuid, () => {}, () => clock);
  const activity = new ActivityStore(storage, { ...connection, post: async () => { throw new Error('offline'); } }, uuid, () => {}, () => clock);
  return { home, activity, uuid, storage, posts, advance: (ms: number) => void (clock += ms) };
}

test('a detection with nothing recorded or answered shows, newest first', () => {
  assert.deepEqual(visibleWalks([walk, later], [], []), [later, walk]);
  assert.deepEqual(visibleWalks(undefined, [], []), []);
});

test('a detection is hidden once answered, and not before', () => {
  assert.deepEqual(visibleWalks([walk, later], [walk.startMs], []), [later]);
  assert.deepEqual(visibleWalks([walk], [later.startMs], []), [walk]);
});

test('a detection overlapping a recorded activity is not offered, even a partial overlap', () => {
  const rows = [
    { payload: { date: '2026-10-12', startTime: '09:20', endTime: '09:50' } },
    { payload: { date: '2026/10/12', startTime: '13:50', durationMin: 5 } },
  ];
  assert.deepEqual(visibleWalks([walk, later], [], recordedSpans(rows, tz)), [later]);
  // Recorded back to back is not an overlap.
  const adjacent = [{ payload: { date: '2026-10-12', startTime: '09:32', endTime: '10:00' } }];
  assert.deepEqual(visibleWalks([walk], [], recordedSpans(adjacent, tz)), [walk]);
  // A recording still in progress hides a detection inside it.
  assert.deepEqual(visibleWalks([walk], [], [{ startMs: at('09:00'), endMs: now }]), []);
});

test('recordedSpans places each stored activity by the shared window rule', () => {
  const span = (payload: Record<string, unknown>) =>
    recordedSpans([{ payload: { date: '2026/10/12', ...payload } }], tz);
  // Slash dates and HH:MM:SS both read.
  assert.deepEqual(span({ startTime: '09:10:00', endTime: '09:32:00' }), [{ startMs: at('09:10'), endMs: at('09:32') }]);
  // No end: start + duration. No start: nothing.
  assert.deepEqual(span({ startTime: '09:10', durationMin: 20 }), [{ startMs: at('09:10'), endMs: at('09:30') }]);
  assert.deepEqual(span({ durationMin: 20 }), []);
  // An overnight log is held as a span, ending the next local day.
  assert.deepEqual(span({ startTime: '23:30', endTime: '00:20' }), [
    { startMs: at('23:30'), endMs: Date.parse('2026-10-13T00:20:00+10:00') },
  ]);
  // End equal to start: nothing without a duration, start + duration with one.
  assert.deepEqual(span({ startTime: '15:50', endTime: '15:50' }), []);
  assert.deepEqual(span({ startTime: '15:50', endTime: '15:50', durationMin: 45 }), [
    { startMs: at('15:50'), endMs: at('16:35') },
  ]);
  // A typo (end 10 minutes before start) must not blank the phone's day: no duration, no span;
  // a duration that disagrees puts the window at start + duration, unless it is implausible.
  assert.deepEqual(span({ startTime: '15:50', endTime: '15:40' }), []);
  assert.deepEqual(span({ startTime: '15:50', endTime: '15:40', durationMin: 20 }), [
    { startMs: at('15:50'), endMs: at('16:10') },
  ]);
  assert.deepEqual(span({ startTime: '15:50', endTime: '15:40', durationMin: 5000 }), []);
});

test('two detections over the same minutes show once', () => {
  const twin = { startMs: at('09:15'), endMs: at('09:40'), durationMin: 25 };
  assert.equal(visibleWalks([walk, twin], [], []).length, 1);
});

test('the walks spec asks the same route the current app does', () => {
  assert.equal(walkCandidatesSpec('2026-10-12').path, '/api/activity-detection/walks');
  const parsed = walkCandidatesSpec('2026-10-12').schema.parse({
    date: '2026-10-12',
    walks: [{ ...walk, meanMet: 3.1 }],
  });
  assert.deepEqual(parsed.walks, [walk]);
});

test('confirm files the walk under its local day with the current app’s title and no distance', () => {
  const payload = detectedActivityPayload('10000000-0000-4000-8000-000000000001', walk, initialChoice(walk, tz), tz)!;
  assert.equal(payload.date, '2026-10-12');
  assert.equal(payload.activityType, 'walk');
  assert.equal(payload.title, 'Walk at 9:10 am');
  assert.equal(payload.durationMin, 22);
  assert.equal(payload.startTime, '09:10');
  assert.equal(payload.endTime, '09:32');
  assert.equal(payload.distanceKm, undefined);
});

test('an edit changes the type and the times, and a bad time saves nothing', () => {
  const edited = detectedActivityPayload(
    '10000000-0000-4000-8000-000000000001',
    walk,
    { type: 'run', start: '9:05', end: '09:35' },
    tz,
  )!;
  assert.equal(edited.activityType, 'run');
  assert.equal(edited.title, 'Run at 9:05 am');
  assert.equal(edited.durationMin, 30);
  assert.equal(edited.startTime, '09:05');
  for (const end of ['09:10', '08:00', 'soon', '25:00']) {
    assert.equal(
      detectedActivityPayload('10000000-0000-4000-8000-000000000001', walk, { type: 'walk', start: '09:10', end }, tz),
      null,
    );
  }
});

test('a walk across midnight saves unedited, filed under the day it started', () => {
  // 23:50–00:10 Brisbane: the end clock time is the next morning.
  const late = { startMs: Date.UTC(2026, 10, 4, 13, 50), endMs: Date.UTC(2026, 10, 4, 14, 10), durationMin: 20 };
  const payload = detectedActivityPayload(
    '10000000-0000-4000-8000-000000000002',
    late,
    initialChoice(late, tz),
    tz,
  )!;
  assert.ok(payload, 'an unedited midnight walk saves');
  assert.equal(payload.date, '2026-11-04');
  assert.equal(payload.durationMin, 20);
  // An end before the start that would make a walk of 12 hours or more is still a typo.
  assert.equal(
    detectedActivityPayload('10000000-0000-4000-8000-000000000002', late, { type: 'walk', start: '23:50', end: '11:50' }, tz),
    null,
  );
});

test('confirming queues the activity once, however many times it is tapped', async () => {
  const f = stores();
  const home = f.home();
  await home.initialize();
  await f.activity.initialize();
  const deps = {
    saveRecord: (payload: unknown) => f.activity.saveRecord(payload),
    answer: (startMs: number) => home.answerWalk(startMs),
    uuid: f.uuid,
    timezone: tz,
  };
  const results = await Promise.all([
    confirmDetectedWalk(deps, walk, initialChoice(walk, tz)),
    confirmDetectedWalk(deps, walk, initialChoice(walk, tz)),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  const rows = f.activity.getSnapshot().rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pending, true);
  assert.equal(rows[0].payload.title, 'Walk at 9:10 am');
  // The saved row alone hides the detection, before the server has confirmed anything.
  assert.deepEqual(visibleWalks([walk], [], recordedSpans(rows, tz)), []);
  assert.deepEqual(home.getSnapshot().answeredWalks, [walk.startMs]);
});

test('a dismissal is remembered across a reopen and expires after three days', async () => {
  const f = stores();
  const home = f.home();
  await home.initialize();
  await home.answerWalk(walk.startMs);
  const reopened = f.home();
  await reopened.initialize();
  assert.deepEqual(visibleWalks([walk], reopened.getSnapshot().answeredWalks, []), []);
  f.advance(ANSWERED_WALK_MEMORY_MS + 60_000);
  await reopened.answerWalk(later.startMs);
  assert.deepEqual(reopened.getSnapshot().answeredWalks, [later.startMs]);
});

test('undoing a dismissal offers the walk again', async () => {
  const f = stores();
  const home = f.home();
  await home.initialize();
  await home.answerWalk(walk.startMs);
  await home.answerWalk(walk.startMs, false);
  assert.deepEqual(visibleWalks([walk], home.getSnapshot().answeredWalks, []), [walk]);
});

// #3625: shaped like the route's answer (`WalkCandidatesResponse`, app/api/activity-detection/walks).
const answer = (walks: typeof walk[], covered: { startMs: number; endMs: number }[] = []) =>
  walkCandidatesSpec('2026-10-12').schema.parse({
    date: '2026-10-12',
    walks: walks.map((w) => ({ ...w, meanMet: 3.1 })),
    covered,
  });

test('a walk offered earlier today stays on offer when a later answer no longer lists it', () => {
  // 20 Nov: the current app's card kept a walk that Preview, reading only the latest answer, dropped.
  const held = offeredToday(answer([walk]), [], '2026-10-12', tz);
  assert.deepEqual(held, [walk]);
  assert.deepEqual(offeredToday(answer([later]), held, '2026-10-12', tz), [later, walk]);
  // A refresh that failed, or has not landed yet, takes nothing off either.
  assert.deepEqual(offeredToday(null, held, '2026-10-12', tz), [walk]);
  assert.deepEqual(visibleWalks(offeredToday(answer([]), held, '2026-10-12', tz), [], []), [walk]);
});

test('a held walk goes once something logged covers it, and the newer version of it wins', () => {
  // Logged in the other app, or recorded by the source itself: offering it again would duplicate it.
  assert.deepEqual(offeredToday(answer([], [{ startMs: at('09:20'), endMs: at('09:40') }]), [walk], '2026-10-12', tz), []);
  const revised = { startMs: at('09:12'), endMs: at('09:30'), durationMin: 18 };
  assert.deepEqual(offeredToday(answer([revised]), [walk], '2026-10-12', tz), [revised]);
  // A server from before the covered list still answers; its walks are read as before.
  const old = walkCandidatesSpec('2026-10-12').schema.parse({ date: '2026-10-12', walks: [walk] });
  assert.deepEqual(old.covered, []);
});

test('a walk held from another day is not offered: the card shows a time with no date', () => {
  assert.deepEqual(offeredToday(answer([]), [walk], '2026-10-13', tz), []);
  assert.deepEqual(offeredToday(null, [walk], '2026-10-13', tz), []);
});

test('the held walks survive a restart and an unchanged answer writes nothing', async () => {
  const f = stores();
  const home = f.home();
  await home.initialize();
  await home.holdWalks([walk]);
  const raw = await f.storage.get('home.v1');
  await home.holdWalks([{ ...walk }]);
  assert.equal(await f.storage.get('home.v1'), raw);
  const reopened = f.home();
  await reopened.initialize();
  assert.deepEqual(reopened.getSnapshot().offeredWalks, [walk]);
  // Answered, it stays held for the day but is not shown.
  await reopened.answerWalk(walk.startMs);
  const state = reopened.getSnapshot();
  assert.deepEqual(visibleWalks(offeredToday(null, state.offeredWalks, '2026-10-12', tz), state.answeredWalks, []), []);
});
