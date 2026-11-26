import assert from 'node:assert/strict';
import { test } from 'node:test';
import { here, loadDom } from './fixtures/dom-harness.ts';

// #4100 D1: a start that fails says why on every step of the Start sheet, once. Before, only the
// Treadmill and Something-else steps drew the error, so a failed Run, Walk or Guided walk start
// showed nothing.
const component = here('../../src/features/activities/components/StartActivitySheet.tsx');
const stubs = here('./start-sheet-stubs.ts');
const dom = await loadDom([
  { from: component, to: stubs, specifiers: ['../../../shared/ui', './ActivityPicker'] },
]);
const { StartActivitySheet } = await import(component);
const noop = () => {};
const mount = (error: string | null) =>
  dom.act(async () =>
    dom.root.render(
      dom.h(StartActivitySheet, {
        visible: true,
        busy: false,
        error,
        onClose: noop,
        onDismiss: noop,
        onKind: noop,
        onTreadmillNow: noop,
        onTreadmillLog: noop,
        onType: noop,
      }),
    ),
  );
const occurrences = () => (document.body.textContent!.match(/Storage is full/g) ?? []).length;

test('the start error shows once on the first step, Walk or run, Treadmill and Something else', async () => {
  await mount('Storage is full');
  assert.equal(occurrences(), 1, 'first step');
  await dom.click('Walk or run');
  assert.equal(occurrences(), 1, 'Walk or run');
  await dom.click('Treadmill');
  assert.equal(occurrences(), 1, 'Treadmill');
  await dom.click('Back');
  await dom.click('Back');
  await dom.click('Something else');
  assert.equal(occurrences(), 1, 'Something else');
});

test('no error draws nothing', async () => {
  await mount(null);
  assert.doesNotMatch(document.body.textContent!, /Could not start/);
});

test('opened at the Treadmill step it shows that step, not the first one (the walking card\'s Treadmill)', async () => {
  await dom.act(async () =>
    dom.root.render(
      dom.h(StartActivitySheet, {
        visible: true, initialStep: 'treadmill', busy: false, error: null,
        onClose: noop, onDismiss: noop, onKind: noop, onTreadmillNow: noop, onTreadmillLog: noop, onType: noop,
      }),
    ),
  );
  assert.match(document.body.textContent!, /Already done\? Log it/);
  assert.doesNotMatch(document.body.textContent!, /Something else/);
});
