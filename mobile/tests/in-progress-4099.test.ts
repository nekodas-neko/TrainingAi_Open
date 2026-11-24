import assert from 'node:assert/strict';
import { test } from 'node:test';
import { here, loadDom } from './fixtures/dom-harness.ts';

// #4099 item 3: with an activity open, every start control on the Cardio Hub opens this one notice
// (InProgressSheet) instead of the chooser or a greyed button: "An activity is in progress", with
// Resume, and Discard behind a confirm step in the screen.
const component = here('../../src/features/activities/components/InProgressSheet.tsx');
const dom = await loadDom([
  { from: component, to: here('./in-progress-stubs.ts'), specifiers: ['../../../shared/ui'] },
]);
const { InProgressSheet } = await import(component);
const mount = async (props: Record<string, unknown>) =>
  dom.act(async () =>
    dom.root.render(dom.h(InProgressSheet, { visible: true, title: 'Treadmill', onClose() {}, ...props })),
  );

test('says an activity is in progress and offers Resume and Discard', async () => {
  let resumed = 0;
  await mount({ onResume: () => resumed++, onDiscard: async () => {} });
  assert.match(document.body.textContent!, /An activity is in progress/);
  assert.match(document.body.textContent!, /Treadmill is still open/);
  await dom.click('Resume');
  assert.equal(resumed, 1);
});

test('Discard asks first, then ends the activity and closes', async () => {
  let discarded = 0,
    closed = 0;
  await mount({
    onResume() {},
    onClose: () => closed++,
    onDiscard: async () => void discarded++,
  });
  await dom.click('Discard');
  assert.equal(discarded, 0, 'a confirm step comes first');
  assert.match(document.body.textContent!, /Keep activity/);
  await dom.click('Keep activity');
  assert.match(document.body.textContent!, /An activity is in progress/);
  await dom.click('Discard');
  await dom.click('Discard');
  assert.equal(discarded, 1);
  assert.equal(closed, 1);
});

test('a failed discard says so and stays open', async () => {
  let closed = 0;
  await mount({
    onResume() {},
    startConfirming: true,
    onClose: () => closed++,
    onDiscard: async () => {
      throw new Error('disk full');
    },
  });
  await dom.click('Discard');
  assert.match(document.body.textContent!, /Could not discard \/ disk full/);
  assert.equal(closed, 0);
});
