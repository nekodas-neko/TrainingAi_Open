import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UndoStore } from '../src/shared/ui/undo/UndoStore.ts';
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

test('undo restores only after the local write succeeds', async () => {
  const store = new UndoStore();
  const saving = deferred();
  let value = 1;
  const pending = store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: async () => {
      await saving.promise;
      value = 0;
    },
    revert: async () => {
      value = 1;
    },
  });
  assert.equal(store.getSnapshot()?.phase, 'saving');
  assert.equal(await store.undo(), false);
  saving.finish();
  await pending;
  assert.equal(value, 0);
  assert.equal(store.getSnapshot()?.phase, 'ready');
  assert.equal(await store.undo(), true);
  assert.equal(value, 1);
  assert.equal(store.getSnapshot(), null);
  store.cancel();
});
test('failed local writes do not offer a restoring action', async () => {
  const store = new UndoStore();
  let restored = false;
  assert.equal(
    await store.perform({
      key: 'entry',
      label: 'Deleted',
      apply: async () => {
        throw new Error('disk full');
      },
      revert: async () => {
        restored = true;
      },
    }),
    false,
  );
  assert.equal(store.getSnapshot()?.phase, 'error');
  assert.equal(await store.undo(), false);
  assert.equal(restored, false);
  store.cancel();
});
test('double-tapped undo runs the compensating write once', async () => {
  const store = new UndoStore();
  const restoring = deferred();
  let calls = 0;
  await store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: async () => {},
    revert: async () => {
      calls++;
      await restoring.promise;
    },
  });
  const undo = store.undo();
  assert.equal(await store.undo(), false);
  assert.equal(calls, 1);
  restoring.finish();
  assert.equal(await undo, true);
  store.cancel();
});
test('a failed undo remains available for retry', async () => {
  const store = new UndoStore();
  let failed = true;
  await store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: async () => {},
    revert: async () => {
      if (failed) throw new Error('disk full');
    },
  });
  assert.equal(await store.undo(), false);
  assert.equal(store.getSnapshot()?.phase, 'ready');
  assert.ok(store.getSnapshot()?.error);
  failed = false;
  assert.equal(await store.undo(), true);
  assert.equal(store.getSnapshot(), null);
  store.cancel();
});
test('late completion cannot overwrite the newer undo receipt', async () => {
  const store = new UndoStore();
  const older = deferred();
  const restored: string[] = [];
  const first = store.perform({
    key: 'a',
    label: 'A deleted',
    apply: () => older.promise,
    revert: async () => {
      restored.push('a');
    },
  });
  await store.perform({
    key: 'b',
    label: 'B deleted',
    apply: async () => {},
    revert: async () => {
      restored.push('b');
    },
  });
  older.finish();
  await first;
  assert.equal(store.getSnapshot()?.label, 'B deleted');
  await store.undo();
  assert.deepEqual(restored, ['b']);
  store.cancel();
});
test('a newer action remains visible while an older undo finishes', async () => {
  const store = new UndoStore();
  const older = deferred();
  await store.perform({
    key: 'a',
    label: 'A deleted',
    apply: async () => {},
    revert: () => older.promise,
  });
  const reverting = store.undo();
  await store.perform({
    key: 'b',
    label: 'B deleted',
    apply: async () => {},
    revert: async () => {},
  });
  older.finish();
  await reverting;
  assert.equal(store.getSnapshot()?.label, 'B deleted');
  store.cancel();
});
test('repeat actions on the same in-flight target are blocked', async () => {
  const store = new UndoStore();
  const saving = deferred();
  let writes = 0;
  const action = {
    key: 'entry',
    label: 'Deleted',
    apply: async () => {
      writes++;
      await saving.promise;
    },
    revert: async () => {},
  };
  const first = store.perform(action);
  assert.equal(await store.perform(action), false);
  assert.equal(writes, 1);
  saving.finish();
  await first;
  store.cancel();
});
test('expiration removes only the receipt and retains the saved deletion', async () => {
  const store = new UndoStore(5);
  let deleted = false;
  await store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: async () => {
      deleted = true;
    },
    revert: async () => {
      deleted = false;
    },
  });
  await tick();
  assert.equal(store.getSnapshot(), null);
  assert.equal(deleted, true);
  store.cancel();
});
test('VoiceOver preserves the undo opportunity until dismissed', async () => {
  const store = new UndoStore(5);
  store.setAccessible(true);
  await store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: async () => {},
    revert: async () => {},
  });
  await tick();
  assert.equal(store.getSnapshot()?.phase, 'ready');
  store.setAccessible(false);
  await tick();
  assert.equal(store.getSnapshot(), null);
  store.cancel();
});
test('account cancellation clears receipts and ignores late old-account completion', async () => {
  const store = new UndoStore();
  const saving = deferred();
  let restores = 0;
  const pending = store.perform({
    key: 'entry',
    label: 'Deleted',
    apply: () => saving.promise,
    revert: async () => {
      restores++;
    },
  });
  store.cancel();
  saving.finish();
  assert.equal(await pending, false);
  assert.equal(store.getSnapshot(), null);
  assert.equal(await store.undo(), false);
  assert.equal(restores, 0);
});
