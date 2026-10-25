import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waterEntry } from '../src/features/health/data/water-entry.ts';

test('an empty or blank field is unfinished: nothing to log, and no error yet', () => {
  assert.deepEqual(waterEntry(''), { ml: null, error: null });
  assert.deepEqual(waterEntry('   '), { ml: null, error: null });
});

test('a whole-ml amount inside the limit can be logged', () => {
  assert.deepEqual(waterEntry('250'), { ml: 250, error: null });
  assert.deepEqual(waterEntry(' 5000 '), { ml: 5000, error: null });
  assert.equal(waterEntry('330.4').ml, 330);
});

test('zero, negative, tiny and over-limit amounts are refused with the range', () => {
  for (const raw of ['0', '-50', '0.4', '5001', '9000']) {
    const entry = waterEntry(raw);
    assert.equal(entry.ml, null, raw);
    assert.equal(entry.error, 'Enter a value between 1 and 5,000 ml', raw);
  }
});

test('text that is not a number is refused', () => {
  for (const raw of ['abc', '1.2.3', '12abc']) {
    assert.deepEqual(waterEntry(raw), { ml: null, error: 'Enter a number' }, raw);
  }
});
