import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  answersIncomplete,
  cardView,
  changeCount,
  changesLine,
  defaultAnswers,
  laterKey,
  resultRows,
  saveBody,
  weeklyCheckinSpec,
  type CheckinState,
} from '../src/features/home/data/weekly-checkin.ts';
import { OFFLINE_MESSAGE, WeeklyCheckinActions } from '../src/features/home/data/weekly-checkin-actions.ts';
import { ID, LONG_NAME, due, saveResponse, saved, savedWithNotApplied } from './fixtures/weekly-checkin-states.ts';

// #3890 step 3: the weekly check-in's card, its answers and its writes, against the engine's real
// response shapes (fixtures/weekly-checkin-states.ts). The API is a stand-in that records each call.
const TODAY = '2026-11-22';
const spec = weeklyCheckinSpec(TODAY);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function api(respond: (path: string, body: unknown) => unknown, offline = false) {
  const calls: { path: string; body: unknown }[] = [];
  const replaced: CheckinState[] = [];
  const reloads: unknown[] = [];
  let changed = 0;
  const resources = {
    write: async (_method: string, path: string, body: unknown) => {
      calls.push({ path, body });
      return respond(path, body);
    },
    replace: async (_spec: unknown, value: CheckinState) => {
      replaced.push(value);
    },
    load: async (s: unknown) => {
      reloads.push(s);
    },
    changes: { pendingFor: () => [] },
  };
  const actions = new WeeklyCheckinActions(resources as never, spec, () => changed++, () => offline);
  return { actions, calls, replaced, reloads, changes: () => changed };
}

/** Every string id in a body, at any depth. */
function ids(value: unknown): string[] {
  if (typeof value === 'string') return UUID.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(ids);
  if (value && typeof value === 'object') return Object.values(value).flatMap(ids);
  return [];
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

test('the card is due with the server’s counts, and hides for today only after Later', () => {
  assert.deepEqual(cardView(due, {}, TODAY), { kind: 'due', title: 'Your week in review: 4 of 4 sessions' });
  const later = { [laterKey('2026-11-16', TODAY)]: true };
  assert.equal(cardView(due, later, TODAY), null);
  assert.equal(cardView(due, later, '2026-11-23')?.kind, 'due', 'back the next day');
  const noSchedule = { ...due, summary: { ...due.summary!, sessionsPlanned: null, sessionsDone: 2 } };
  assert.equal((cardView(noSchedule, {}, TODAY) as { title: string }).title, 'Your week in review: 2 sessions');
  assert.equal(cardView({ ...due, due: false }, {}, TODAY), null);
  assert.equal(cardView({ ...due, checkin: { ...due.checkin!, status: 'dismissed' } }, {}, TODAY), null);
  assert.equal(cardView(null, {}, TODAY), null);
});

test('a saved card counts only what the server reports applied; a hold not yet live is not a change', () => {
  // The lowering (with its change id) and the written days off and the shorter session: 3. The
  // Bench hold is noted, not live, and the three offers are still open.
  assert.deepEqual(changeCount(saved.checkin!), { changes: 3, openOffers: 3 });
  assert.deepEqual(cardView(saved, { [laterKey('2026-11-16', TODAY)]: true }, TODAY), {
    kind: 'saved',
    changes: 3,
    openOffers: 3,
  });
  assert.equal(changesLine(2, 0), '2 changes for next week');
  assert.equal(changesLine(1, 1), '1 change for next week · 1 to answer');
  assert.equal(changesLine(0, 0), 'No changes for next week');
});

test('one save with the default answers sends About right for every lift and nothing else', async () => {
  const { actions, calls, replaced, changes } = api(() => saveResponse);
  const answers = defaultAnswers(due);
  assert.equal(answersIncomplete(answers), null);
  const result = await actions.save(saveBody(due.weekStart!, due, answers));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/weekly-checkin/save');
  assert.deepEqual(calls[0].body, {
    weekStart: '2026-11-16',
    lifts: [ID.squat, ID.bench, ID.row, ID.long].map((sessionExerciseId) => ({
      sessionExerciseId,
      answer: 'about_right',
    })),
    pain: false,
    swap: null,
    daysOff: null,
    shorterSessionMin: null,
  });
  assert.deepEqual(replaced, [saveResponse.state], 're-rendered from the returned state');
  assert.equal(changes(), 1);
});

test('a save sends ids only, never a lift’s name', () => {
  const answers = {
    ...defaultAnswers(due),
    lifts: { [ID.squat]: 'heavy' as const, [ID.bench]: 'light' as const },
    pain: 'yes' as const,
    painLift: ID.squat,
    painWhere: '  left knee  ',
    swap: 'yes' as const,
    swapLift: ID.row,
    daysOff: [6, 3, 6],
    length: '30' as const,
  };
  const body = saveBody(due.weekStart!, due, answers);
  assert.deepEqual(body.pain, { sessionExerciseId: ID.squat, where: 'left knee' });
  assert.deepEqual(body.swap, { sessionExerciseId: ID.row });
  assert.deepEqual(body.daysOff, [3, 6]);
  assert.equal(body.shorterSessionMin, 30);
  const names = new Set(due.lifts.map((l) => l.exerciseName));
  assert.ok(!strings(body).some((s) => names.has(s) || s === LONG_NAME));
  assert.deepEqual(new Set(ids(body)), new Set([ID.squat, ID.bench, ID.row, ID.long]));
  // Yes without a lift is not sent.
  assert.equal(answersIncomplete({ ...answers, painLift: null }), 'Pick the lift that hurt.');
  assert.equal(answersIncomplete({ ...answers, swapLift: null }), 'Pick the lift to swap.');
  // "Where" is capped at the column's 200 characters.
  const long = saveBody(due.weekStart!, due, { ...answers, painWhere: 'x'.repeat(250) });
  assert.equal((long.pain as { where: string }).where.length, 200);
});

test('accept, decline and each Undo call their route with ids only and re-render from the response', async () => {
  const { actions, calls, replaced } = api(() => saved);
  const id = ID.checkin;
  await actions.offer(id, { kind: 'step_up', liftId: ID.rowLift }, 'accept');
  await actions.offer(id, { kind: 'step_up', liftId: ID.rowLift }, 'decline');
  await actions.offer(id, { kind: 'pain' }, 'accept');
  await actions.offer(id, { kind: 'swap', toExerciseId: ID.alt1 }, 'accept');
  await actions.offer(id, { kind: 'swap' }, 'decline');
  for (const target of [
    { kind: 'lift', liftId: ID.squatLift },
    { kind: 'pain' },
    { kind: 'swap' },
    { kind: 'days_off' },
    { kind: 'shorter_session' },
  ] as const) {
    await actions.undo(id, target);
  }
  assert.deepEqual(
    calls.map((c) => c.path),
    [...Array(5).fill('/api/weekly-checkin/offer'), ...Array(5).fill('/api/weekly-checkin/undo')],
  );
  assert.deepEqual(calls[0].body, { checkinId: id, decision: 'accept', offer: { kind: 'step_up', liftId: ID.rowLift } });
  assert.deepEqual(calls[2].body, { checkinId: id, decision: 'accept', offer: { kind: 'pain' } }, 'the server picks the muscle');
  assert.deepEqual(calls[3].body, { checkinId: id, decision: 'accept', offer: { kind: 'swap', toExerciseId: ID.alt1 } });
  assert.deepEqual(calls[5].body, { checkinId: id, target: { kind: 'lift', liftId: ID.squatLift } });
  for (const call of calls) {
    const names = new Set(saved.checkin!.lifts.map((l) => l.exerciseName));
    assert.ok(!strings(call.body).some((s) => names.has(s)), `no name in ${call.path}`);
  }
  assert.equal(replaced.length, 10);
});

test('a 409 or 404 shows the server’s sentence and reloads the state; nothing is replaced', async () => {
  for (const [status, sentence] of [
    [409, 'That week is not open for a check-in'],
    [409, 'Undo the swap first'],
    [404, 'Not found'],
  ] as const) {
    const { actions, replaced, reloads } = api(() => {
      throw new ApiError(status, undefined, undefined, '/api/weekly-checkin/save', true, sentence);
    });
    const result = await actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
    assert.deepEqual(result, { ok: false, message: sentence });
    assert.equal(replaced.length, 0);
    assert.deepEqual(reloads, [spec]);
  }
  // A refused undo (a workout started since) shows its reason.
  const refused = api(() => {
    throw new ApiError(409, undefined, undefined, '/api/weekly-checkin/undo', true, "You've trained since this change, so it stays.");
  });
  const result = await refused.actions.undo(ID.checkin, { kind: 'lift', liftId: ID.squatLift });
  assert.deepEqual(result, { ok: false, message: "You've trained since this change, so it stays." });
});

test('offline, Save sends nothing and says so; a dropped connection keeps the answers for a retry', async () => {
  const offline = api(() => saveResponse, true);
  assert.deepEqual(await offline.actions.save(saveBody(due.weekStart!, due, defaultAnswers(due))), {
    ok: false,
    message: OFFLINE_MESSAGE,
  });
  assert.equal(offline.calls.length, 0);
  const dropped = api(() => {
    throw new TypeError('Network request failed');
  });
  const result = await dropped.actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /may not have reached the server/);
  assert.equal(dropped.replaced.length, 0);
});

test('a second tap while a call is in flight sends nothing', async () => {
  let release = () => {};
  const { actions, calls } = api(() => new Promise((resolve) => (release = () => resolve(saveResponse))));
  const body = saveBody(due.weekStart!, due, defaultAnswers(due));
  const first = actions.save(body);
  assert.deepEqual(await actions.save(body), { ok: false, message: null });
  release();
  assert.equal((await first).ok, true);
  assert.equal(calls.length, 1);
});

test('a hold that is not live is never worded as holding', () => {
  const rows = resultRows(saved.checkin!, null);
  const bench = rows.find((r) => r.key === `lift:${ID.benchLift}`)!;
  assert.equal(bench.status, 'Noted. Your plan does not change for it yet');
  assert.equal(bench.undo, undefined);
  for (const row of rows) assert.doesNotMatch(`${row.title} ${row.status}`, /hold/i);
  // Only when the server says the hold is live.
  const live = {
    ...saved.checkin!,
    lifts: saved.checkin!.lifts.map((l) => (l.liftId === ID.benchLift ? { ...l, holdLive: true } : l)),
  };
  assert.equal(
    resultRows(live, null).find((r) => r.key === `lift:${ID.benchLift}`)!.status,
    'Holding Bench Press next week',
  );
});

test('the result has one row per answer, each from what the server reports', () => {
  const rows = resultRows(saved.checkin!, null);
  const by = (key: string) => rows.find((r) => r.key === key)!;
  assert.deepEqual(
    rows.map((r) => r.key),
    [`lift:${ID.squatLift}`, `lift:${ID.benchLift}`, `lift:${ID.rowLift}`, `lift:${ID.longLift}`, 'pain', 'swap', 'days_off', 'shorter_session'],
  );
  const squat = by(`lift:${ID.squatLift}`);
  assert.equal(squat.status, 'One step lighter next time');
  assert.deepEqual(squat.undo, { kind: 'lift', liftId: ID.squatLift });
  const row = by(`lift:${ID.rowLift}`);
  assert.equal(row.status, 'Offered, not changed yet');
  assert.equal(row.offer?.question, 'Step up Barbell Row?');
  assert.equal(by(`lift:${ID.longLift}`).status, 'No change');
  const pain = by('pain');
  assert.equal(pain.offer?.question, 'Log an injury to Quads?');
  assert.deepEqual(pain.offer?.accept, { kind: 'pain' });
  const swap = by('swap');
  assert.deepEqual(swap.alternatives?.map((a) => a.exerciseId), [ID.alt1, ID.alt2]);
  assert.equal(by('days_off').title, 'Days off: Wed, Sat');
  assert.equal(by('days_off').status, 'Applied as you typed it');
  assert.deepEqual(by('shorter_session').undo, { kind: 'shorter_session' });
  // Accepted and declined offers.
  const answered = {
    ...saved.checkin!,
    offers: saved.checkin!.offers.map((o, i) => ({ ...o, status: i === 1 ? 'declined' : 'accepted' }) as typeof o),
  };
  const after = resultRows(answered, null);
  assert.equal(after.find((r) => r.key === `lift:${ID.rowLift}`)!.status, 'Step up applied');
  assert.equal(after.find((r) => r.key === 'pain')!.status, 'No injury logged');
  assert.equal(after.find((r) => r.key === 'swap')!.status, 'Swap applied');
  assert.deepEqual(after.find((r) => r.key === 'swap')!.undo, { kind: 'swap' });
  // No rest day written: said plainly, not "applied".
  const none = resultRows({ ...saved.checkin!, daysOffWritten: null }, null);
  assert.equal(none.find((r) => r.key === 'days_off')!.status, 'No rest day was added');
});

test('a lift the save lists under notApplied or kept shows the server’s reason', () => {
  const rows = resultRows(savedWithNotApplied.state.checkin!, savedWithNotApplied);
  assert.equal(rows[0].note, 'You undid this lowering, so saving again does not redo it.');
  assert.equal(rows[0].status, 'Noted. Your plan does not change for it yet');
  const kept = resultRows(saved.checkin!, {
    kept: [{ exerciseName: 'Squat', detail: "You've trained since this change, so it stays." }],
    notApplied: [],
  });
  assert.equal(kept[0].note, "You've trained since this change, so it stays.");
});
