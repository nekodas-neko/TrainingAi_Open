import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deleteProgramMessage } from '../src/features/programs/delete-copy.ts';

// #4143 item 6: Delete is inside the opened program row, and its confirmation says what goes and stays.

const read = (path: string) => readFileSync(new URL(`../src/features/programs/${path}`, import.meta.url), 'utf8');

test('the program confirmation names what is removed and that logged workouts stay', () => {
  const text = deleteProgramMessage();
  for (const gone of ['sessions and exercises', 'schedule', 'phase set made for it']) {
    assert.ok(text.includes(gone), gone);
  }
  assert.match(text, /Workouts you have already logged stay in your history\./);
});

test('the collapsed row has Set active and Edit only; Delete is a labelled button inside the row', () => {
  const card = read('ProgramCard.tsx');
  const trailing = card.slice(card.indexOf('trailing='), card.indexOf('<Stack style={{ padding'));
  assert.doesNotMatch(trailing, /icon="delete"/);
  assert.match(card, /title="Delete program"/);
});

test('ProgramsScreen uses the program message for a program only', () => {
  assert.match(
    read('ProgramsScreen.tsx'),
    /deleting\.kind === 'program' \? deleteProgramMessage\(\) : deleteItemMessage\(\)/,
  );
});
