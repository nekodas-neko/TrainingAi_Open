import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { sizes, spacing } from '../src/shared/theme/tokens.ts';
import { lenientCheckinStateSchema, defaultAnswers, type CheckinAnswers } from '../src/features/home/data/weekly-checkin.ts';
import { ID, LONG_NAME, due, saved, savedWithNotApplied } from './fixtures/weekly-checkin-states.ts';

// #3890 step 3: the weekly check-in card, sheet and result, rendered. The shared UI and the theme are
// the stand-ins in fixtures/weekly-checkin-stubs.ts; the components are the real ones.
const at = (path: string) => new URL(path, import.meta.url).href;
const card = at('../src/features/home/components/WeeklyCheckinCard.tsx');
const sheet = at('../src/features/home/components/WeeklyCheckinSheet.tsx');
const stubs = at('./fixtures/weekly-checkin-stubs.ts');
registerHooks({
  resolve(specifier, context, next) {
    if (
      (context.parentURL === card || context.parentURL === sheet) &&
      (specifier === '../../../shared/ui' || specifier === '../../../shared/theme/ThemeProvider')
    )
      return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { WeeklyCheckinCard } = await import(card);
const { WeeklyCheckinSheet } = await import(sheet);
const { controls, choices } = await import(stubs);

const PHONE = 384;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const press = (label: string) => {
  const run = controls.get(label);
  assert.ok(run, `no control "${label}" (have: ${[...controls.keys()].join(', ')})`);
  run();
};
const selected = (html: string, label: string) => {
  const set = html.match(new RegExp(`aria-label="${label}"[^>]*>(.*?)</fieldset>`))?.[1] ?? '';
  return [...set.matchAll(/data-selected="yes"[^>]*>([^<]*)</g)].map((m) => m[1]);
};
const noop = () => {};
function renderSheet(props: Record<string, unknown> = {}) {
  controls.clear();
  choices.clear();
  return renderToStaticMarkup(
    createElement(WeeklyCheckinSheet, {
      state: due,
      answers: defaultAnswers(due),
      onAnswers: noop,
      notes: null,
      offline: false,
      sending: null,
      message: null,
      notice: null,
      onSave: noop,
      onOffer: noop,
      onUndo: noop,
      onClose: noop,
      ...props,
    }),
  );
}

test('the due card: label, the server’s count, one line, Start review and Later', () => {
  controls.clear();
  const pressed: string[] = [];
  const html = renderToStaticMarkup(
    createElement(WeeklyCheckinCard, {
      view: { kind: 'due', title: 'Your week in review', summary: '4 of 4 planned sessions done.' },
      onStart: () => pressed.push('start'),
      onLater: () => pressed.push('later'),
      onSee: () => pressed.push('see'),
    }),
  );
  assert.equal(
    text(html),
    'Weekly check-in Your week in review 4 of 4 planned sessions done. 1 minute. Tell us how the lifts felt and plan next week. Start review Later',
  );
  assert.match(html, /data-tone="checkin"/);
  press('Start review');
  press('Remind me tomorrow');
  assert.deepEqual(pressed, ['start', 'later']);
});

test('after Later the card renders nothing; once saved it is one quiet row with See', () => {
  assert.equal(
    renderToStaticMarkup(createElement(WeeklyCheckinCard, { view: null, onStart: noop, onLater: noop, onSee: noop })),
    '',
  );
  controls.clear();
  let seen = 0;
  const html = renderToStaticMarkup(
    createElement(WeeklyCheckinCard, {
      view: { kind: 'saved', changes: 2, openOffers: 0 },
      onStart: noop,
      onLater: noop,
      onSee: () => seen++,
    }),
  );
  assert.equal(text(html), 'Week reviewed 2 changes for next week See');
  assert.doesNotMatch(html, /data-tone="(?!muted")/, "a quiet row: no tone but the muted one");
  press('See what changes next week');
  assert.equal(seen, 1);
});

test('the sheet: the server’s three lines verbatim, About right pre-selected for every lift, Save pinned', () => {
  const html = renderSheet();
  const body = text(html);
  assert.match(html, /<h2>Weekly check-in<\/h2>/);
  for (const line of due.summary!.lines) assert.ok(body.includes(line), line);
  for (const lift of due.lifts) {
    assert.deepEqual(selected(html, `How ${lift.exerciseName} felt`), ['About right']);
  }
  assert.deepEqual(selected(html, 'Anything that hurt or felt wrong'), ['No']);
  assert.deepEqual(selected(html, 'Anything to swap'), ['No']);
  assert.deepEqual(selected(html, 'Session length'), ['Usual']);
  // Save is in the footer, outside the scrolling content, so large text scrolls under nothing.
  const footer = html.slice(html.indexOf('data-ui="SheetFooter"'));
  const scroll = html.slice(0, html.indexOf('data-ui="SheetFooter"'));
  assert.match(footer, /Save review/);
  assert.doesNotMatch(scroll, /Save review/);
  assert.ok(controls.has('Save review'), 'enabled with the defaults: one scroll, one tap');
});

test('a long lift name wraps: no line limit on any lift name or result row', async () => {
  const html = renderSheet();
  assert.ok(text(html).includes(LONG_NAME));
  assert.doesNotMatch(html, /data-lines=/);
  const result = renderSheet({ state: saved });
  assert.ok(text(result).includes(LONG_NAME));
  assert.doesNotMatch(result, /data-lines=/);
  // And no fixed width anywhere in the card or the sheet.
  for (const file of ['WeeklyCheckinCard.tsx', 'WeeklyCheckinSheet.tsx']) {
    const source = await readFile(new URL(`../src/features/home/components/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bwidth:\s*\d/, file);
    assert.doesNotMatch(source, /['"`]#[0-9a-f]{3,8}['"`]/i, `${file}: theme tokens only`);
  }
});

test('seven weekday toggles, Mon to Sun, each a full touch target at 384 dp', () => {
  const html = renderSheet({ answers: { ...defaultAnswers(due), daysOff: [1, 7] } });
  const days = html.match(/data-ui="WeekdayPicker">(.*?)<\/fieldset>/)![1];
  assert.equal([...days.matchAll(/<label/g)].length, 7);
  // ISO 1 (Monday) and 7 (Sunday) are the first and last toggles.
  assert.deepEqual(
    [...days.matchAll(/data-selected="(yes|no)"/g)].map((m) => m[1]),
    ['yes', 'no', 'no', 'no', 'no', 'no', 'yes'],
  );
  // The sheet's side padding, six gaps and seven cells, plus WeekdayPicker's hitSlop on each side.
  const cell = (PHONE - spacing.lg * 2 - spacing.xs * 6) / 7;
  assert.ok(cell + spacing.xs * 2 >= 44, `${cell}`);
  assert.ok(sizes.touchTarget >= 44);
  // Three equal cells for Heavy · About right · Light leave room for "About right".
  assert.ok((PHONE - spacing.lg * 2 - spacing.xs * 2) / 3 >= 100);
});

test('toggling a day sends its ISO weekday back; Yes on pain asks for the lift and where', () => {
  let next: CheckinAnswers | null = null;
  renderSheet({ onAnswers: (a: CheckinAnswers) => (next = a) });
  choices.get('Days off')!(0);
  assert.deepEqual(next!.daysOff, [1]);
  const html = renderSheet({ answers: { ...defaultAnswers(due), pain: 'yes' } });
  assert.match(html, /aria-label="Which lift\?"/);
  assert.match(html, /maxLength="200"/);
  assert.ok(!controls.has('Save review'), 'Save waits for the lift');
  assert.ok(text(html).includes('Pick the lift that hurt.'));
});

test('offline, Save is blocked with a plain message; a refusal shows the server’s sentence', () => {
  const offline = renderSheet({ offline: true });
  assert.ok(!controls.has('Save review'));
  assert.ok(text(offline).includes('You’re offline. Save when you’re back online.'));
  const refused = renderSheet({ message: 'That week is not open for a check-in' });
  assert.ok(text(refused).includes('That week is not open for a check-in'));
});

test('the result: every kind of row, its offers and undos, each calling with ids only', () => {
  const offers: unknown[] = [];
  const undos: unknown[] = [];
  const html = renderSheet({
    state: saved,
    onOffer: (row: string, offer: unknown, decision: string) => offers.push([row, offer, decision]),
    onUndo: (row: string, target: unknown) => undos.push([row, target]),
  });
  const body = text(html);
  assert.match(html, /<h2>Review saved · What changes next week<\/h2>/);
  for (const line of [
    'Squat: Heavy One step lighter next time',
    'Bench Press: Heavy Noted. Your plan does not change for it yet',
    'Barbell Row: Light Offered, not changed yet',
    'Step up Barbell Row?',
    `${LONG_NAME}: About right No change`,
    'Hurt: Squat (left knee) Offered, not logged yet',
    'Log an injury to Quads?',
    'Swap: Barbell Row Pick one to swap it for, or keep it',
    'Days off: Wed, Sat Applied as you typed it',
    'Session length: 45 min Applied as you typed it',
  ]) {
    assert.ok(body.includes(line), line);
  }
  assert.doesNotMatch(body, /holding/i);
  press('Yes');
  press('Log injury');
  press('Swap for Chest-Supported Row · dumbbell');
  press('Keep it');
  press('Undo: Squat: Heavy');
  press('Undo: Days off: Wed, Sat');
  press('Undo: Session length: 45 min');
  assert.deepEqual(offers, [
    [`lift:${ID.rowLift}`, { kind: 'step_up', liftId: ID.rowLift }, 'accept'],
    ['pain', { kind: 'pain' }, 'accept'],
    ['swap', { kind: 'swap', toExerciseId: ID.alt1 }, 'accept'],
    ['swap', { kind: 'swap' }, 'decline'],
  ]);
  assert.deepEqual(undos, [
    [`lift:${ID.squatLift}`, { kind: 'lift', liftId: ID.squatLift }],
    ['days_off', { kind: 'days_off' }],
    ['shorter_session', { kind: 'shorter_session' }],
  ]);
  assert.ok(controls.has('Done'));
});

test('the result shows the server’s reason for a lift it did not apply', () => {
  const html = renderSheet({ state: savedWithNotApplied.state, notes: savedWithNotApplied });
  assert.ok(text(html).includes('You undid this lowering, so saving again does not redo it.'));
});

test('while one call is in flight, no other control can be tapped', () => {
  renderSheet({ state: saved, sending: 'pain' });
  assert.deepEqual([...controls.keys()], ['Done']);
});

test('an unknown effect and an unknown lastSession render safely in the result and the form', () => {
  const odd = lenientCheckinStateSchema.parse({
    ...saved,
    lifts: saved.lifts.map((l) => ({ ...l, lastSession: 'heavier' })),
    checkin: {
      ...saved.checkin,
      lifts: saved.checkin!.lifts.map((l, i) => (i === 0 ? { ...l, effect: 'paused', answer: 'huge' } : l)),
    },
  });
  const html = renderSheet({ state: odd });
  assert.ok(text(html).includes('Squat Saved'));
  assert.doesNotMatch(text(html), /lighter next time.*Squat/);
  assert.ok(renderSheet({ state: lenientCheckinStateSchema.parse({ ...due, lifts: due.lifts.map((l) => ({ ...l, lastSession: 'heavier' })) }) }));
});

test('both holdLive values render: Holding with Undo, or Noted', () => {
  const live = (holdLive: boolean) =>
    renderSheet({
      state: {
        ...saved,
        checkin: {
          ...saved.checkin!,
          lifts: saved.checkin!.lifts.map((l) => (l.liftId === ID.benchLift ? { ...l, holdLive } : l)),
        },
      },
    });
  const yes = live(true);
  assert.ok(text(yes).includes('Bench Press: Heavy Holding Bench Press next week'));
  assert.ok(controls.has('Undo: Bench Press: Heavy'));
  const no = live(false);
  assert.ok(text(no).includes('Noted. Your plan does not change for it yet'));
  assert.ok(!controls.has('Undo: Bench Press: Heavy'));
});

test('with nothing left under review the sheet stays up with the message and a Close button', () => {
  const closed = lenientCheckinStateSchema.parse({ ...due, due: false, weekStart: null, summary: null, lifts: [], checkin: null });
  const html = renderSheet({ state: closed, message: 'This check-in is no longer available. Pull to refresh.' });
  assert.ok(text(html).includes('This check-in is no longer available. Pull to refresh.'));
  assert.ok(controls.has('Close'));
  assert.ok(!controls.has('Save review'));
  assert.ok(text(renderSheet({ state: null })).includes('no longer available'));
});

test('a pain offer with no muscle shows no Log injury button, only Not now', () => {
  const state = {
    ...saved,
    checkin: { ...saved.checkin!, offers: saved.checkin!.offers.map((o) => (o.kind === 'pain' ? { ...o, muscles: [] } : o)) },
  };
  const html = renderSheet({ state });
  assert.ok(text(html).includes('could not tell which muscle'));
  assert.ok(!controls.has('Log injury'));
});

// ── #4043 ──────────────────────────────────────────────────────────────────────────────────

const NOTICE = 'That went through on the server, but its reply could not be read. The check-in is being reloaded.';
/** The tone of the text element that carries `words`, or null when the words are not on screen. */
function toneOf(html: string, words: string) {
  const at = html.indexOf(words);
  if (at < 0) return null;
  return html.slice(html.lastIndexOf('<span', at), at).match(/data-tone="([a-z]+)"/)?.[1] ?? 'none';
}

test('a save that went through but could not be read shows its notice in a neutral tone, never as an error', () => {
  // The form, still showing while the state reloads.
  const form = renderSheet({ notice: NOTICE });
  assert.ok(text(form).includes('went through on the server'));
  assert.equal(toneOf(form, NOTICE), 'muted');
  // The result, once the reload brought the saved state.
  const result = renderSheet({ state: saved, notice: NOTICE });
  assert.equal(toneOf(result, NOTICE), 'muted');
  // An error is still an error, and wins the line when both are set.
  const error = renderSheet({ message: 'The check-in changed. It has been refreshed.' });
  assert.equal(toneOf(error, 'The check-in changed. It has been refreshed.'), 'danger');
  const both = renderSheet({ state: saved, message: 'Not found', notice: NOTICE });
  assert.equal(toneOf(both, 'Not found'), 'danger');
  assert.equal(toneOf(both, NOTICE), 'muted');
});

test('the notice is the only text when nothing is left under review', () => {
  const closed = lenientCheckinStateSchema.parse({ ...due, due: false, weekStart: null, summary: null, lifts: [], checkin: null });
  assert.ok(text(renderSheet({ state: closed, notice: NOTICE })).includes('went through on the server'));
});
