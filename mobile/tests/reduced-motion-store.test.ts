import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReducedMotionStore } from '../src/shared/ui/reducedMotionStore.ts';

// #3758. The phone's "Remove animations" setting is asked once and shared.

function source(answer: Promise<boolean>) {
  const calls = { reads: 0 };
  let change: (reduced: boolean) => void = () => undefined;
  return {
    calls,
    emit: (value: boolean) => change(value),
    source: {
      read: () => {
        calls.reads += 1;
        return answer;
      },
      watch: (onChange: (reduced: boolean) => void) => {
        change = onChange;
        return () => undefined;
      },
    },
  };
}

test('motion is allowed until the phone answers, so a first animation is not skipped', () => {
  const store = createReducedMotionStore(source(new Promise(() => undefined)).source);
  assert.equal(store.get(), false);
});

test('the setting is read once however many pieces ask', async () => {
  const fake = source(Promise.resolve(true));
  const store = createReducedMotionStore(fake.source);
  const seen: boolean[] = [];
  for (let i = 0; i < 5; i += 1) store.subscribe(() => seen.push(store.get()));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fake.calls.reads, 1);
  assert.equal(store.get(), true);
  assert.deepEqual(seen, [true, true, true, true, true]);
});

test('a change in Settings reaches everyone, and a same-value report is quiet', async () => {
  const fake = source(Promise.resolve(false));
  const store = createReducedMotionStore(fake.source);
  await Promise.resolve();
  let heard = 0;
  const stop = store.subscribe(() => (heard += 1));
  fake.emit(true);
  fake.emit(true);
  assert.equal(store.get(), true);
  assert.equal(heard, 1);
  stop();
  fake.emit(false);
  assert.equal(heard, 1);
});

test('a phone that cannot answer leaves motion allowed', async () => {
  const store = createReducedMotionStore(source(Promise.reject(new Error('no'))).source);
  await Promise.resolve();
  assert.equal(store.get(), false);
});

test('a setting that throws when asked leaves motion allowed, and the app still starts', () => {
  const watchThrows = createReducedMotionStore({
    read: () => Promise.resolve(true),
    watch: () => {
      throw new Error('no accessibility service');
    },
  });
  assert.equal(watchThrows.get(), false);
  const readThrows = createReducedMotionStore({
    read: () => {
      throw new Error('no accessibility service');
    },
    watch: () => () => undefined,
  });
  assert.equal(readThrows.get(), false);
});

test('a read that fails still lets a later change through', () => {
  let change: (reduced: boolean) => void = () => undefined;
  const store = createReducedMotionStore({
    read: () => {
      throw new Error('boom');
    },
    watch: (onChange) => {
      change = onChange;
      return () => undefined;
    },
  });
  change(true);
  assert.equal(store.get(), true);
});
