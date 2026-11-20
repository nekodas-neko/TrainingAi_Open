import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HealthConnectImportStore,
  IMPORT_NEEDS_PERMISSION,
} from '../src/features/health/data/HealthConnectImportStore.ts';
import { HealthConnectPersistence } from '../src/features/health/data/health-connect-persistence.ts';
import {
  importPermissionNote,
  importStatusError,
} from '../src/features/health/data/device-import.ts';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
import type { HealthConnectType } from '@trainingai/shared/validation/health-connect-import';

const start = Date.parse('2026-11-20T05:00:00Z');

function fixture() {
  const saved = new Map<string, string>();
  const storage = {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: string) => {
      saved.set(key, value);
    },
    remove: async (key: string) => {
      saved.delete(key);
    },
  };
  const calls = { permissions: 0, requests: 0, reads: 0 };
  let granted: HealthConnectType[] = [];
  let grantOnRequest: HealthConnectType[] = [];
  let clock = start;
  let endless = false;
  const reader: HealthConnectReader = {
    permissions: async () => {
      calls.permissions++;
      return granted;
    },
    request: async () => {
      calls.requests++;
      granted = grantOnRequest;
      return granted;
    },
    history: async () => {
      calls.reads++;
      return { records: [], pageToken: endless ? `page-${calls.reads}` : null, skipped: 0 };
    },
    changes: async () => {
      calls.reads++;
      return { records: [], deleted: [], token: 'cursor-1', expired: false, more: false, skipped: 0 };
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async () => ({ measurements: 0, nights: 0, days: 0, heartRate: 0, hrv: null, completedAt: new Date(clock).toISOString() }),
  };
  const store = new HealthConnectImportStore(storage, connection, reader, () => {}, () => clock);
  return {
    store,
    calls,
    disk: () => new HealthConnectPersistence(storage).read() as Promise<any>,
    grant: (types: HealthConnectType[]) => {
      granted = types;
    },
    grantOnRequest: (types: HealthConnectType[]) => {
      grantOnRequest = types;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    endlessHistory: () => {
      endless = true;
    },
  };
}

test('#3906: switched on with no permission is a needs-permission state, not a change waiting or an error', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  const state = f.store.getSnapshot();
  assert.equal(state.pending, 0, 'the "1 change waiting" is gone');
  assert.equal(state.needsPermission, true);
  assert.equal(state.error, null, 'Sync now has nothing to fail on');
  assert.equal(state.busy, false);
  assert.equal(f.calls.reads, 0);
  assert.equal(importStatusError(state), null);
  assert.match(importPermissionNote(state, 'Health Connect') ?? '', /Needs permission/);
});

test('#3906: turning the switch on asks for permission first, and reads once it is granted', async () => {
  const f = fixture();
  f.grantOnRequest(['Steps']);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.calls.requests, 1);
  assert.equal(f.store.getSnapshot().needsPermission, false);
  assert.ok(f.calls.reads > 0);
  assert.equal((await f.disk()).token, 'cursor-1');
});

test('#3906: Import history with no permission asks, and without one leaves the saved read alone', async () => {
  const f = fixture();
  f.grant(['Steps']);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal((await f.disk()).token, 'cursor-1');
  f.grant([]);
  const reads = f.calls.reads,
    requests = f.calls.requests;
  await assert.rejects(
    f.store.importHistory(new Date(start - 10 * 86_400_000).toISOString()),
    new Error(IMPORT_NEEDS_PERMISSION),
    'the tap says why nothing happened',
  );
  assert.equal(f.calls.requests, requests + 1, 'the tap asks for permission');
  const disk = await f.disk();
  assert.equal(disk.token, 'cursor-1', 'the token is not cleared for a read that cannot run');
  assert.equal(f.calls.reads, reads);
  assert.equal(f.store.getSnapshot().pending, 0);
  assert.equal(f.store.getSnapshot().needsPermission, true);
});

test('#3906: with nothing queued, the minute and foreground reruns keep the 5-minute throttle', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  const asked = f.calls.permissions;
  // What useDeviceHealthImport does every 60 s and on every return to the foreground.
  for (let minute = 1; minute <= 4; minute++) {
    f.advance(60_000);
    await f.store.run(f.store.owed());
  }
  assert.equal(f.store.owed(), false);
  assert.equal(f.calls.permissions, asked, 'no rerun every minute');
  f.advance(60_000);
  await f.store.run(f.store.owed());
  assert.equal(f.calls.permissions, asked + 1, 'the throttled run still happens');
});

test('#3906 review: a long import with nothing queued keeps its pace, not the 5-minute throttle', async () => {
  const f = fixture();
  f.grant(['Steps']);
  f.grantOnRequest(['Steps']);
  f.endlessHistory();
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.ok((await f.disk()).scan, 'the scan is still going');
  assert.equal((await f.disk()).queue.length, 0, 'with no batch waiting');
  assert.equal(f.store.owed(), true);
  const reads = f.calls.reads;
  f.advance(60_000);
  await f.store.run(f.store.owed());
  assert.ok(f.calls.reads > reads, 'the minute rerun reads the next pages at once');
});

test('#3906 review: a permission granted in Health Connect settings reads on the return, not 5 minutes later', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.store.getSnapshot().needsPermission, true);
  assert.equal(f.store.owed(), false);
  assert.equal(f.store.awaitingFirstRead(), true);
  f.grant(['Steps']);
  f.advance(30_000);
  // What useDeviceHealthImport does on a return to the foreground.
  await f.store.run(f.store.owed() || f.store.awaitingFirstRead());
  assert.ok(f.calls.reads > 0);
  assert.equal(f.store.getSnapshot().needsPermission, false);
  assert.equal(f.store.awaitingFirstRead(), false);
});

test('#3923 review: Import history with the switch off and no permission still answers the tap', async () => {
  const f = fixture();
  await f.store.initialize();
  assert.equal(f.store.getSnapshot().enabled, false);
  await assert.rejects(
    f.store.importHistory(new Date(start - 10 * 86_400_000).toISOString()),
    new Error(IMPORT_NEEDS_PERMISSION),
  );
  assert.equal(f.calls.requests, 1, 'the permission sheet was offered first');
  assert.equal(f.store.getSnapshot().enabled, false, 'the switch is left as it was');
});

test('#3906: switching off clears the status, and an off switch never shows the permission error', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  await f.store.setEnabled(false);
  const state = f.store.getSnapshot();
  assert.equal(state.enabled, false);
  assert.equal(state.needsPermission, false);
  assert.equal(state.error, null);
  assert.equal(state.pending, 0);
  assert.equal(
    importStatusError({ enabled: false, error: 'No Health Connect read permissions are granted.' }),
    null,
  );
  assert.equal(importStatusError({ enabled: true, error: 'Upload failed.' }), 'Upload failed.');
  assert.equal(importPermissionNote({ enabled: false, needsPermission: true }, 'Health Connect'), null);
});
