import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #4143 item 2: the mark beside a muscle in today's session is drawn, spoken and explained.

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the sheet no longer builds the mark into the chip text', () => {
  const sheet = read('features/home/components/ExerciseReadinessSheet.tsx');
  assert.doesNotMatch(sheet, /' •'/);
  assert.match(sheet, /flagged: sessionMuscles\.some/);
  assert.match(sheet, /flagLabel="in today’s session"/);
});

test('the sheet prints one caption line saying what the mark means', () => {
  const sheet = read('features/home/components/ExerciseReadinessSheet.tsx');
  assert.match(sheet, /Marked: in today’s session/);
});

test('MultiChoice speaks the flag, and the suggestion beside it when both apply', () => {
  const choice = read('shared/ui/MultiChoice.tsx');
  assert.match(choice, /option\.flagged && flagLabel \? \[flagLabel\]/);
  assert.match(choice, /option\.marked \? \['suggested'\]/);
});
