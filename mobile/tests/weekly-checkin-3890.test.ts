import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomeStore } from '../src/features/home/data/HomeStore.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  answersIncomplete,
  cardView,
  changeCount,
  changesLine,
  lenientCheckinStateSchema,
  isReviewWeek,
  LIFTS_CHANGED_MESSAGE,
  liftsChangedMessage,
  LATER_PREFIX,
  liftOf,
  prepareSave,
  reconcileAnswers,
  withoutNotesFor,
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
const spec = weeklyCheckinSpec();
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
  // The title is fixed and the count is the server's own first line; the phone composes none.
  assert.deepEqual(cardView(due, {}, TODAY), {
    kind: 'due',
    title: 'Your week in review',
    summary: '4 of 4 planned sessions done.',
  });
  const later = { [laterKey('2026-11-16', TODAY)]: true };
  assert.equal(cardView(due, later, TODAY), null);
  assert.equal(cardView(due, later, '2026-11-23')?.kind, 'due', 'back the next day');
  const over = { ...due, summary: { ...due.summary!, sessionsDone: 5, lines: ['5 sessions, one more than planned.', 'b', 'c'] as [string, string, string] } };
  assert.equal((cardView(over, {}, TODAY) as { summary: string }).summary, '5 sessions, one more than planned.');
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
  ] as const) {
    const { actions, replaced, reloads } = api(() => {
      throw new ApiError(status, undefined, undefined, '/api/weekly-checkin/save', true, sentence);
    });
    const result = await actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
    assert.deepEqual(result, { ok: false, message: sentence });
    assert.equal(replaced.length, 0);
    assert.deepEqual(reloads, [spec]);
  }
  // A 404 says it plainly, never the server's bare "Not found".
  const gone = api(() => {
    throw new ApiError(404, undefined, undefined, '/api/weekly-checkin/save', true, 'Not found');
  });
  assert.deepEqual(await gone.actions.save(saveBody(due.weekStart!, due, defaultAnswers(due))), {
    ok: false,
    message: 'This check-in is no longer available. Pull to refresh.',
  });
  assert.deepEqual(gone.reloads, [spec]);
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

// ── After review ───────────────────────────────────────────────────────────────────────────

const rawLift = (state: typeof saved, patch: Record<string, unknown>) =>
  ({ ...state, checkin: { ...state.checkin!, lifts: state.checkin!.lifts.map((l, i) => (i === 0 ? { ...l, ...patch } : l)) } });

test('a lift the engine calls "heavier" parses and the card shows', () => {
  const raw = { ...due, lifts: due.lifts.map((l, i) => (i === 0 ? { ...l, lastSession: 'heavier' } : l)) };
  const parsed = lenientCheckinStateSchema.parse(raw);
  assert.equal(parsed.lifts[0].lastSession, 'heavier');
  assert.equal(cardView(parsed, {}, TODAY)?.kind, 'due');
});

test('a value the server adds later never hides the card or states something untrue', () => {
  const lastSession = lenientCheckinStateSchema.parse({ ...due, lifts: due.lifts.map((l) => ({ ...l, lastSession: 'sandbagged' })) });
  assert.equal(lastSession.lifts[0].lastSession, null);
  assert.equal(cardView(lastSession, {}, TODAY)?.kind, 'due');
  const unknown = lenientCheckinStateSchema.parse(rawLift(saved, { effect: 'paused', holdLive: 'maybe' }));
  const row = resultRows(unknown.checkin!, null)[0];
  assert.equal(row.status, 'Saved');
  assert.equal(row.undo, undefined);
  assert.equal(cardView(unknown, {}, TODAY)?.kind, 'saved');
  assert.equal(changeCount(unknown.checkin!).changes, 2, 'the unknown effect counts as no change');
  // Unknown offer status, unknown offer kind, unknown due reason and check-in status.
  const odd = lenientCheckinStateSchema.parse({
    ...saved,
    why: 'eventually',
    checkin: {
      ...saved.checkin,
      status: 'archived',
      offers: [{ kind: 'mystery' }, { ...saved.checkin!.offers[0], status: 'pending' }],
    },
  });
  assert.equal(odd.why, null);
  assert.equal(odd.checkin!.offers.length, 1);
  assert.equal(cardView(odd, {}, TODAY), null, 'an unknown check-in status claims nothing');
  const status = resultRows({ ...odd.checkin!, status: 'saved' }, null).find((r) => r.key === `lift:${ID.rowLift}`)!;
  assert.equal(status.status, 'Saved');
  assert.equal(status.offer, undefined);
});

test('a save whose reply cannot be parsed reloads and does not say "could not reach"', async () => {
  const { actions, reloads, replaced } = api(() => ({ state: { nonsense: true } }));
  const result = await actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
  assert.equal(result.ok, true);
  assert.match((result as { notice: string }).notice, /went through on the server/);
  assert.doesNotMatch((result as { notice: string }).notice, /could not reach/i);
  assert.deepEqual(reloads, [spec]);
  assert.equal(replaced.length, 0);
});

test('an unreadable reply to an undo or an offer reloads the same way', async () => {
  const { actions, reloads } = api(() => 'not json');
  assert.equal((await actions.undo(ID.checkin, { kind: 'days_off' })).ok, true);
  assert.equal((await actions.offer(ID.checkin, { kind: 'step_up', liftId: ID.rowLift }, 'accept')).ok, true);
  assert.equal(reloads.length, 2);
});

test('a 400 shows the server’s own sentence, not the network message', async () => {
  const { actions } = api(() => {
    throw new ApiError(400, undefined, undefined, '/api/weekly-checkin/offer', true, 'That lift trains no main muscle');
  });
  assert.deepEqual(await actions.offer(ID.checkin, { kind: 'pain' }, 'accept'), {
    ok: false,
    message: 'That lift trains no main muscle',
  });
});

test('a pain offer for a lift with no main muscles offers only "Not now", with the reason', () => {
  const view = {
    ...saved.checkin!,
    offers: saved.checkin!.offers.map((o) => (o.kind === 'pain' ? { ...o, muscles: [] } : o)),
  };
  const pain = resultRows(view, null).find((r) => r.key === 'pain')!;
  assert.equal(pain.offer?.accept, undefined);
  assert.match(pain.offer!.question, /could not tell which muscle/);
  assert.match(pain.offer!.question, /injuries screen/);
  assert.deepEqual(pain.offer!.decline, { kind: 'pain' });
});

test('a lowering already in place says so, and the count agrees with the row', () => {
  const view = lenientCheckinStateSchema.parse(rawLift(saved, { appliedChangeId: null })).checkin!;
  const row = resultRows(view, null)[0];
  assert.equal(row.status, 'Already set one step lighter');
  assert.equal(row.undo, undefined);
  assert.equal(changeCount(view).changes, changeCount(saved.checkin!).changes - 1);
});

test('both values of holdLive are worded truthfully', () => {
  const held = (holdLive: boolean) =>
    resultRows(
      lenientCheckinStateSchema.parse(rawLift(saved, { effect: 'held', holdLive, appliedChangeId: null })).checkin!,
      null,
    )[0];
  assert.equal(held(true).status, 'Holding Squat next week');
  assert.deepEqual(held(true).undo, { kind: 'lift', liftId: ID.squatLift });
  assert.equal(held(false).status, 'Noted. Your plan does not change for it yet');
  assert.equal(held(false).undo, undefined);
  assert.doesNotMatch(held(false).status, /holding/i);
  const count = (holdLive: boolean) =>
    changeCount(lenientCheckinStateSchema.parse(rawLift(saved, { effect: 'held', holdLive, appliedChangeId: null })).checkin!).changes;
  assert.equal(count(true), count(false) + 1);
});

test('after a reload, answers for lifts that are gone are dropped and say so', () => {
  const answers = {
    ...defaultAnswers(due),
    lifts: { ...defaultAnswers(due).lifts, [ID.squat]: 'heavy' as const },
    pain: 'yes' as const,
    painLift: ID.squat,
    swap: 'yes' as const,
    swapLift: ID.bench,
  };
  const same = reconcileAnswers(answers, due);
  assert.equal(same.reset, false);
  assert.equal(same.answers, answers);
  const fewer = { ...due, lifts: due.lifts.filter((l) => l.sessionExerciseId !== ID.squat) };
  const next = reconcileAnswers(answers, fewer);
  assert.equal(next.reset, true);
  assert.equal(next.answers.lifts[ID.squat], undefined);
  assert.equal(next.answers.painLift, null);
  assert.equal(next.answers.swapLift, ID.bench, 'a pick that is still there stays');
  assert.equal(next.answers.lifts[ID.bench], 'about_right');
});

test('a lift’s reason is cleared when its row changes', () => {
  const notes = {
    kept: [{ exerciseName: 'Squat', detail: 'a' }],
    notApplied: [
      { exerciseName: 'Squat', detail: 'b', reason: 'undone' },
      { exerciseName: 'Bench Press', detail: 'c', reason: 'refused' },
    ],
  };
  assert.deepEqual(withoutNotesFor(notes, 'Squat'), {
    kept: [],
    notApplied: [{ exerciseName: 'Bench Press', detail: 'c', reason: 'refused' }],
  });
  assert.equal(withoutNotesFor(null, 'Squat'), null);
  assert.equal(liftOf(saved.checkin!, { kind: 'lift', liftId: ID.squatLift }), 'Squat');
  assert.equal(liftOf(saved.checkin!, { kind: 'step_up', liftId: ID.rowLift }), 'Barbell Row');
  assert.equal(liftOf(saved.checkin!, { kind: 'pain' }), null);
});

test('a cached state is shown only for this week or last week, so a repeat visit never pops in', () => {
  assert.equal(isReviewWeek('2026-11-16', '2026-11-22'), true);
  assert.equal(isReviewWeek('2026-11-16', '2026-11-23'), true, 'Monday grace: last week');
  assert.equal(isReviewWeek('2026-11-16', '2026-11-30'), false, 'two weeks on');
  assert.equal(isReviewWeek(null, TODAY), false);
  // The same key on every day of the week; the spec carries no date.
  assert.equal(JSON.stringify(weeklyCheckinSpec()), JSON.stringify(weeklyCheckinSpec()));
  assert.equal(cardView(due, {}, '2026-12-14'), null);
  assert.equal(cardView(due, {}, '2026-11-23')?.kind, 'due');
});

test('"Later" markers do not pile up: writing one removes the earlier days’ and weeks’', async () => {
  const values = new Map<string, string>();
  const storage = {
    get: async (k: string) => values.get(k) ?? null,
    set: async (k: string, v: string) => void values.set(k, v),
    remove: async (k: string) => void values.delete(k),
  };
  const connection = { origin: 'https://example.com', userId: 'one', timezone: 'Australia/Brisbane', get: async () => ({}), post: async () => ({ processed: 0, errors: [] }) };
  const store = new HomeStore(storage as never, connection as never, () => '10000000-0000-4000-8000-000000000001', () => {}, () => 0);
  await store.initialize();
  await store.mark('morning:2026-11-22');
  await store.markOnly(LATER_PREFIX, laterKey('2026-11-09', '2026-11-17'));
  await store.markOnly(LATER_PREFIX, laterKey('2026-11-16', '2026-11-22'));
  const keys = () => Object.keys(store.getSnapshot().markers).filter((k) => k.startsWith(LATER_PREFIX));
  assert.deepEqual(keys(), [laterKey('2026-11-16', '2026-11-22')]);
  assert.equal(store.getSnapshot().markers['morning:2026-11-22'], true, 'other markers stay');
  await store.markOnly(LATER_PREFIX, laterKey('2026-11-16', '2026-11-22'), false);
  assert.deepEqual(keys(), []);
});

// ── #4043: four leftovers, and the lowered row's wording ──────────────────────────────────

test('#4043 (1): a save that went through but could not be read answers with a notice, not an error message', async () => {
  const { actions } = api(() => ({ state: { nonsense: true } }));
  const result = await actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
  assert.equal(result.ok, true);
  assert.equal('message' in result, false, 'an error message is what the sheet shows in red');
  assert.match((result as { notice: string }).notice, /went through on the server/);
  // A refusal is still a message, never a notice.
  const refused = await api(() => {
    throw new ApiError(409, 'Conflict', 'That week is not open for a check-in');
  }).actions.save(saveBody(due.weekStart!, due, defaultAnswers(due)));
  assert.equal(refused.ok, false);
  assert.equal('notice' in refused, false);
});

test('#4043 (2): "the lifts changed" is told only while the sheet is open, and only when something was reset', () => {
  assert.equal(liftsChangedMessage(true, true), LIFTS_CHANGED_MESSAGE);
  assert.equal(liftsChangedMessage(true, false), null, 'a closed sheet is not told: it would show on the next open');
  assert.equal(liftsChangedMessage(false, true), null);
  assert.equal(liftsChangedMessage(false, false), null);
});

test('#4043 (3): a pain or swap pick whose lift is no longer listed is never sent', () => {
  const answers = { ...defaultAnswers(due), pain: 'yes' as const, painLift: ID.squat, painWhere: 'knee', swap: 'yes' as const, swapLift: ID.bench };
  const fewer = { ...due, lifts: due.lifts.filter((l) => l.sessionExerciseId !== ID.squat && l.sessionExerciseId !== ID.bench) };
  const body = saveBody(fewer.weekStart!, fewer, answers);
  // Not answered, not "nothing hurt": the person did not say that.
  assert.equal(body.pain, null);
  assert.equal(body.swap, null);
  assert.deepEqual(body.lifts.map((l) => l.sessionExerciseId), [ID.row, ID.long]);
  assert.ok(!ids(body).includes(ID.squat) && !ids(body).includes(ID.bench), 'no stale id anywhere in the body');
  // Picks that are still listed are sent as before.
  const kept = saveBody(due.weekStart!, due, answers);
  assert.deepEqual(kept.pain, { sessionExerciseId: ID.squat, where: 'knee' });
  assert.deepEqual(kept.swap, { sessionExerciseId: ID.bench });
  // "No" is still "nothing hurt".
  assert.equal(saveBody(due.weekStart!, due, defaultAnswers(due)).pain, false);
});

test('a Save tap with a stale pain or swap pick sends nothing, resets the pick and says the lifts changed', () => {
  const without = (id: string) => ({ ...due, lifts: due.lifts.filter((l) => l.sessionExerciseId !== id) });
  const pain = { ...defaultAnswers(due), pain: 'yes' as const, painLift: ID.squat, painWhere: 'knee' };
  const stalePain = prepareSave(due.weekStart!, without(ID.squat), pain);
  assert.equal(stalePain.send, false);
  if (!stalePain.send) {
    assert.equal(stalePain.message, LIFTS_CHANGED_MESSAGE);
    assert.equal(stalePain.answers.painLift, null);
  }
  const swap = { ...defaultAnswers(due), swap: 'yes' as const, swapLift: ID.bench };
  const staleSwap = prepareSave(due.weekStart!, without(ID.bench), swap);
  assert.equal(staleSwap.send, false);
  if (!staleSwap.send) {
    assert.equal(staleSwap.message, LIFTS_CHANGED_MESSAGE);
    assert.equal(staleSwap.answers.swapLift, null);
  }
  // Nothing stale: one tap, one body, the same one saveBody builds.
  const fresh = { ...pain, swap: 'yes' as const, swapLift: ID.bench };
  const ok = prepareSave(due.weekStart!, due, fresh);
  assert.equal(ok.send, true);
  if (ok.send) assert.deepEqual(ok.body, saveBody(due.weekStart!, due, fresh));
});

test('#4043 (4): a cached state for last week is accepted only on the Monday after', () => {
  const thisMonday = '2026-11-23';
  const lastWeek = '2026-11-16';
  assert.equal(isReviewWeek(lastWeek, thisMonday), true, 'the grace Monday');
  for (const day of ['2026-11-24', '2026-11-25', '2026-11-28', '2026-11-29']) {
    assert.equal(isReviewWeek(lastWeek, day), false, `${day}: last week's card is not shown`);
  }
  // This week's is accepted on every day of it.
  for (const day of ['2026-11-23', '2026-11-24', '2026-11-29']) assert.equal(isReviewWeek(thisMonday, day), true);
  assert.equal(cardView(due, {}, '2026-11-23')?.kind, 'due');
  assert.equal(cardView(due, {}, '2026-11-24'), null, 'Tuesday: nothing paints before the answer');
  assert.equal(cardView(saved, {}, '2026-11-26'), null, 'offline on Thursday: a saved card for last week stays hidden');
});

test('wording: a lowered lift says it is also no heavier than last time only when the server says capped', () => {
  const lowered = (patch: Record<string, unknown>) =>
    resultRows(lenientCheckinStateSchema.parse(rawLift(saved, { effect: 'lowered_one_step', ...patch })).checkin!, null)[0];
  const capped = lowered({ capped: true });
  assert.equal(capped.status, 'One step lighter, and no heavier than last time');
  assert.deepEqual(capped.undo, { kind: 'lift', liftId: ID.squatLift }, 'undo is unchanged');
  for (const value of [false, null]) {
    const row = lowered({ capped: value });
    assert.equal(row.status, 'One step lighter next time');
    assert.deepEqual(row.undo, { kind: 'lift', liftId: ID.squatLift });
  }
  // A state cached before the field existed has none: nothing is claimed.
  const old = rawLift(saved, { effect: 'lowered_one_step' });
  delete (old.checkin!.lifts[0] as Record<string, unknown>).capped;
  assert.equal(resultRows(lenientCheckinStateSchema.parse(old).checkin!, null)[0].status, 'One step lighter next time');
  // A lowering already in place keeps its own sentence, with the same truthful addition.
  const already = lowered({ capped: true, appliedChangeId: null });
  assert.equal(already.status, 'Already set one step lighter, and no heavier than last time');
  assert.equal(already.undo, undefined);
  assert.equal(lowered({ capped: false, appliedChangeId: null }).status, 'Already set one step lighter');
  // `capped` on a lift that is not lowered changes nothing; any non-boolean reads as not capped.
  assert.equal(lowered({ capped: 'yes' }).status, 'One step lighter next time');
  const held = resultRows(lenientCheckinStateSchema.parse(rawLift(saved, { effect: 'held', holdLive: true, capped: true })).checkin!, null)[0];
  assert.equal(held.status, 'Holding Squat next week');
});
