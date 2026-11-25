import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { injuriesSubtitle } from '../src/features/programs/delete-copy.ts';

// #4143 item 7: injuries are added in one place (Health › Body); Program has a row that opens it.

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the Program row says how many injuries are active and where they are managed', () => {
  assert.equal(injuriesSubtitle(undefined), 'Add or update them in Health › Body');
  assert.equal(injuriesSubtitle(0), 'No active injuries · Add or update them in Health › Body');
  assert.equal(injuriesSubtitle(1), '1 active injury · Add or update them in Health › Body');
  assert.equal(injuriesSubtitle(2), '2 active injuries · Add or update them in Health › Body');
});

test('Program has no second editor, and the row opens Health › Body', () => {
  const screen = read('features/programs/ProgramsScreen.tsx');
  assert.doesNotMatch(screen, /InjuryManager|Recorded injuries/);
  assert.match(screen, /title="Injuries"[\s\S]*onPress=\{openInjuries\}/);
  const app = read('app/App.tsx');
  assert.match(app, /openInjuries=\{\(\) => \{\s+selectTab\('Health'\);\s+setHealthPanel\('body'\);/);
});

test('the action is called "Add injury" on the button and on the sheet', () => {
  const card = read('features/health/components/MuscleStatusCard.tsx');
  assert.match(card, /title="Add injury"/);
  assert.match(card, /'Add injury' : 'Edit Injury'/);
  assert.doesNotMatch(card, /\+ Add injury|Record Injury/);
});
