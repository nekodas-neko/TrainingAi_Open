import assert from 'node:assert/strict';
import { test } from 'node:test';
import { todayInTz } from '@trainingai/shared/date-utils';
import { here, loadDom } from './fixtures/dom-harness.ts';

// #4144: the date and time fields, rendered. The real DateField, TimeField and Sheet run under
// react-native-web in jsdom; the calendar and wheels are buttons (fixtures/picker-field-stubs.ts).
const stubs = here('./picker-field-stubs.ts');
const sheetStubs = here('./sheet-dom-stubs.ts');
const dateField = here('../../src/shared/ui/DateField.tsx');
const timeField = here('../../src/shared/ui/TimeField.tsx');
const sheet = here('../../src/shared/ui/Sheet.tsx');
const own = ['./AppButton', './AppText', './Stack', './MonthCalendar', './NumberWheel', '../theme/ThemeProvider'];
const dom = await loadDom([
  { from: dateField, to: stubs, specifiers: own },
  { from: timeField, to: stubs, specifiers: own },
  {
    from: sheet,
    to: sheetStubs,
    specifiers: [
      './ReorderScrollView',
      './IconButton',
      './AppText',
      './Stack',
      './useReducedMotion',
      '../../integrations/feedback/haptics',
      '../theme/ThemeProvider',
      'react-native-safe-area-context',
    ],
  },
]);
const { DateField } = await import(dateField);
const { TimeField } = await import(timeField);
const { Sheet } = await import(sheet);
const react = 'react';
const { useState } = (await import(react)) as { useState: <T>(v: T) => [T, (v: T) => void] };
const { h, act, root, wait, click } = dom;
const TZ = 'Australia/Brisbane';

const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
const button = (text: string | RegExp) =>
  buttons().find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')));
const page = () => document.body.textContent ?? '';
const settle = () => act(async () => wait(400));

/** A field with its value held in state, so a pick feeds back as it does in a form. */
function mount(Field: unknown, props: Record<string, unknown>, initial: string) {
  const stored: string[] = [];
  const Host = () => {
    const [value, setValue] = useState(initial);
    return h(Field, {
      label: 'Started on',
      timezone: TZ,
      ...props,
      value,
      onChange: (next: string) => {
        stored.push(next);
        setValue(next);
      },
    });
  };
  return { stored, Host };
}
async function show(Field: unknown, props: Record<string, unknown>, initial: string) {
  const mounted = mount(Field, props, initial);
  await act(async () => root.render(h(mounted.Host)));
  await act(async () => {
    button(/^(?!.*(Set|Clear|Today)).*$/)!.click();
    await wait(0);
  });
  await settle();
  return mounted;
}
const close = async () => {
  await act(async () => root.render(h('div')));
  await settle();
};

test('a date field: Clear on an optional field empties it and closes the sheet', async () => {
  const { stored } = await show(DateField, { optional: true }, '2026-11-12');
  assert.ok(button('Clear'), 'Clear is offered');
  await click('Clear');
  await settle();
  assert.deepEqual(stored, ['']);
  assert.equal(button('Clear') === undefined, true, 'the sheet is closed');
  assert.match(page(), /Not set/, 'the field now reads as not set');
  await close();
});

test('a date field: Clear is disabled when an optional field is already empty', async () => {
  await show(DateField, { optional: true }, '');
  assert.equal(button('Clear')!.disabled, true);
  await close();
});

test('a date field: a required field has no Clear', async () => {
  await show(DateField, {}, '2026-11-12');
  assert.equal(button('Clear') === undefined, true);
  assert.ok(button('Today'));
  await close();
});

test('a date field: Set stays disabled until a day is chosen, then stores it as YYYY-MM-DD', async () => {
  const { stored } = await show(DateField, {}, '');
  assert.equal(button('Choose a day')!.disabled, true);
  await click(`day ${todayInTz(TZ).slice(0, 7)}-12`);
  const set = button(/^Set /)!;
  assert.equal(set.disabled, false);
  assert.deepEqual(stored, [], 'nothing is stored before Set');
  await click(set.textContent!);
  await settle();
  assert.deepEqual(stored, [`${todayInTz(TZ).slice(0, 7)}-12`]);
  await close();
});

test('a date field: a stored day outside the bounds shows the message and Set stays disabled', async () => {
  await show(DateField, { min: '2026-11-10', max: '2026-11-20' }, '2026-11-05');
  assert.match(page(), /Pick 10 Nov 2026 or later\./);
  assert.equal(button(/^Set /)!.disabled, true);
  await close();
  await show(DateField, { min: '2026-11-10', max: '2026-11-20' }, '2026-11-25');
  assert.match(page(), /Pick 20 Nov 2026 or earlier\./);
  assert.equal(button(/^Set /)!.disabled, true);
  await close();
});

test('a date field: a stored day in the "/" form is left as it was unless a different day is picked', async () => {
  const { stored } = await show(DateField, {}, '2026/11/24');
  assert.ok(button('Set 24 Nov 2026'), 'the same day is chosen when the sheet opens');
  await click('Set 24 Nov 2026');
  await settle();
  assert.deepEqual(stored, [], 'Set without a change writes nothing');
  assert.equal(button(/^Set /) === undefined, true, 'and the sheet closes');
  await act(async () => {
    button(/24 Nov 2026/)!.click();
    await wait(0);
  });
  await settle();
  await click('day 2026-11-12');
  await click('Set 12 Nov 2026');
  await settle();
  assert.deepEqual(stored, ['2026-11-12'], 'a different day is stored in the YYYY-MM-DD form');
  await close();
});

test('a date field: a stored date outside 2000 to 2100 shows formatted, not as raw text', async () => {
  const mounted = mount(DateField, {}, '1998-03-07');
  await act(async () => root.render(h(mounted.Host)));
  assert.ok(button('7 Mar 1998'));
  assert.doesNotMatch(page(), /1998-03-07/);
  await close();
});

test('a time field: Clear on an optional field empties it; a required field has none', async () => {
  const optional = await show(TimeField, { optional: true, label: 'Training time' }, '17:30');
  assert.ok(button('Clear'));
  await click('Clear');
  await settle();
  assert.deepEqual(optional.stored, ['']);
  assert.match(page(), /Not set/);
  await close();
  await show(TimeField, { label: 'Went to bed' }, '23:10');
  assert.equal(button('Clear') === undefined, true);
  await close();
});

test('a time field: "1 min later" reaches an exact minute and Set stores it as HH:MM', async () => {
  const { stored } = await show(TimeField, { label: 'Went to bed' }, '23:59');
  await click('1 min later');
  assert.ok(button('Set 12:00 am'), 'the sheet rolls past midnight');
  await click('Set 12:00 am');
  await settle();
  assert.deepEqual(stored, ['00:00']);
  await close();
});

test('a sheet opened from inside another sheet closes back to it', async () => {
  const stored: string[] = [];
  const Parent = () => {
    const [value, setValue] = useState('');
    return h(
      Sheet,
      { visible: true, title: 'Supplement', onClose() {} },
      h(DateField, {
        label: 'Started on',
        value,
        timezone: TZ,
        optional: true,
        onChange: (next: string) => {
          stored.push(next);
          setValue(next);
        },
      }),
    );
  };
  await act(async () => root.render(h(Parent)));
  await settle();
  assert.match(page(), /Supplement/);
  await act(async () => {
    button('Not set')!.click();
    await wait(0);
  });
  await settle();
  assert.match(page(), /Choose a day/, 'the picker is open');
  await click(`day ${todayInTz(TZ).slice(0, 7)}-05`);
  await click(button(/^Set /)!.textContent!);
  await settle();
  assert.equal(stored.length, 1);
  assert.equal(button(/^Set /) === undefined, true, 'the picker is closed');
  assert.match(page(), /Supplement/, 'the sheet it was opened from is still open');
  assert.match(page(), /Started on/);
  await close();
});
