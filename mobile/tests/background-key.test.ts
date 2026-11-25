import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backgroundKey } from '../src/features/weather/data/background.ts';

// #3758. The backdrop is rebuilt and cross-faded when its key changes. It used to include the
// current minute, so it was rebuilt every minute for nothing.

const same = { scene: 'sky', mode: 'dark', condition: 'clear', width: 384, height: 832 };

test('the key does not change from one minute to the next', () => {
  // backgroundKey takes no clock at all, so no time can reach it.
  assert.equal(backgroundKey(same), backgroundKey({ ...same }));
  assert.equal(backgroundKey.length, 1);
  assert.equal(backgroundKey(same).includes(String(Math.floor(Date.now() / 60000))), false);
});

for (const change of [
  { scene: 'health' },
  { mode: 'light' },
  { condition: 'rain' },
  { width: 412 },
  { height: 900 },
]) {
  test(`the key changes with ${Object.keys(change)[0]}`, () => {
    assert.notEqual(backgroundKey(same), backgroundKey({ ...same, ...change }));
  });
}
