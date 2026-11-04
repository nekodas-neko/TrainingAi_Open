import assert from 'node:assert/strict';
import test from 'node:test';
import { afterLoggingBarTone } from '../src/features/nutrition/data/budget-line.ts';

// #2160: the current app's assign step colours the "after logging" bar green within the day's
// budget and orange once this food would take the counted intake past it.
test('within or at the budget reads success; past it reads warning', () => {
  assert.equal(afterLoggingBarTone(1200, 1800), 'success');
  assert.equal(afterLoggingBarTone(1800, 1800), 'success');
  assert.equal(afterLoggingBarTone(1801, 1800), 'warning');
});
