import assert from 'node:assert/strict';
import test from 'node:test';

// #4143 item 2: the mark beside a muscle in today's session is drawn, spoken and explained.

import { choiceSpokenLabel } from '../src/shared/ui/choice-label.ts';
import { readinessChips, readinessMarkCaption } from '../src/features/home/data/readiness-chips.ts';


test('a chip is the muscle name alone; the mark and the flag travel as fields', () => {
  const chips = readinessChips(['Chest', 'Quads'], ['Quads'], ['Chest']);
  assert.deepEqual(chips, [
    { value: 'Chest', marked: false, flagged: true, label: 'Chest' },
    { value: 'Quads', marked: true, flagged: false, label: 'Quads' },
  ]);
  assert.ok(chips.every((chip) => !chip.label.includes('•')));
});

test('the caption shows only when a chip carries the mark', () => {
  const marked = readinessChips(['Chest', 'Quads'], [], ['Chest']);
  assert.equal(readinessMarkCaption(marked), 'Marked: in today’s session');
  // A session that works muscles with no chip (e.g. Calves is not offered): nothing is marked.
  const none = readinessChips(['Chest', 'Quads'], ['Quads'], ['Calves']);
  assert.equal(readinessMarkCaption(none), null);
  assert.equal(readinessMarkCaption(readinessChips(['Chest'], [], [])), null);
});

test('a screen reader hears the flag, and the suggestion beside it when both apply', () => {
  const words = 'in today’s session';
  assert.equal(choiceSpokenLabel({ label: 'Chest' }, words), undefined);
  assert.equal(choiceSpokenLabel({ label: 'Chest', flagged: true }, words), 'Chest, in today’s session');
  assert.equal(choiceSpokenLabel({ label: 'Chest', marked: true }, words), 'Chest, suggested');
  assert.equal(
    choiceSpokenLabel({ label: 'Chest', flagged: true, marked: true }, words),
    'Chest, in today’s session, suggested',
  );
});
