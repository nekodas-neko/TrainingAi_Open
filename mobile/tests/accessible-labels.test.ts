import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELETE_PROGRAM_TITLE,
  INJURIES_ROW_TITLE,
  deleteProgramLabel,
  injuriesRowLabel,
  injuriesSubtitle,
} from '../src/features/programs/delete-copy.ts';

// A voice command ("tap Delete program") matches a control whose spoken name contains its visible words.

test('the Delete program button is spoken starting with its visible words, then the name', () => {
  const label = deleteProgramLabel('Winter Block');
  assert.equal(label, 'Delete program Winter Block');
  assert.ok(label.startsWith(DELETE_PROGRAM_TITLE));
});

test('the Injuries row is spoken with its visible title and its count', () => {
  for (const active of [undefined, 0, 1, 2]) {
    const label = injuriesRowLabel(active);
    assert.ok(label.startsWith(INJURIES_ROW_TITLE), label);
    assert.ok(label.includes(injuriesSubtitle(active)), label);
  }
  assert.equal(injuriesRowLabel(2), 'Injuries, 2 active injuries · Add or update them in Health › Body');
});
