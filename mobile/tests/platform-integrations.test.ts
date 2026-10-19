import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId } from './logging-fixture.ts';
import {
  createWorkout,
  endRest,
  finishWorkout,
} from '../src/features/workouts/logging/workout.ts';
import {
  platformSchema,
  alertSignature,
  type Alert,
} from '../src/features/platform/data/models.ts';
import { PlatformStore } from '../src/features/platform/data/PlatformStore.ts';
import { planAlerts } from '../src/features/platform/data/alert-plan.ts';
import { AlertScheduler } from '../src/features/platform/data/AlertScheduler.ts';
import {
  CalendarStore,
  type CalendarEvent,
} from '../src/features/platform/data/CalendarStore.ts';
import { defaultWalk } from '../src/features/activities/data/guidance.ts';
import type { ActivitySession } from '../src/features/activities/data/ActivityStore.ts';
import { createRequire } from 'node:module';

type Manifest = { manifest: { 'uses-permission'?: { $: Record<string, string> }[] } };
const exactAlarms = createRequire(import.meta.url)(
  '../src/integrations/notifications/exact-alarms.cjs',
) as { addExactAlarmPermissions: (manifest: Manifest) => Manifest };

const now = Date.UTC(2026, 9, 13, 0);
function workout() {
  const f = loggingFixture();
  return createWorkout(f.session, programId, 'Australia/Brisbane', false, now, f.uuid);
}
function completed() {
  const value = workout();
  value.exercises[0].sets[0] = {
    ...value.exercises[0].sets[0],
    weight: '20',
    reps: '5',
    startedAt: now + 1000,
    completedAt: now + 60000,
  };
  return finishWorkout(value, now + 120000);
}
function settings(extra = {}) {
  return platformSchema.parse({
    scope: 'account-one',
    restAlerts: true,
    walkCues: true,
    ...extra,
  });
}
function walk(): ActivitySession {
  return {
    id: 'walk-one',
    title: 'Walk',
    type: { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: true },
    mode: 'active',
    startMs: now,
    endMs: null,
    pausedMs: 0,
    pauseStartMs: null,
    distance: '',
    notes: '',
    guidance: {
      kind: 'walk',
      config: { ...defaultWalk, sets: 2, fastSec: 60, slowSec: 60 },
      saved: false,
    },
  };
}
function memory() {
  const data = new Map<string, string>();
  let fail = false;
  return {
    data,
    fail: (value: boolean) => {
      fail = value;
    },
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (fail) throw new Error('disk full');
      data.set(key, value);
    },
    remove: async (key: string) => {
      data.delete(key);
    },
  };
}
test('rest deadlines reschedule one stable alert, and finished/skipped rests leave none', () => {
  const value = workout();
  value.rest = {
    exerciseId: value.exercises[0].id,
    setId: value.exercises[0].sets[0].id,
    startedAt: now,
    endsAt: now + 60000,
  };
  const first = planAlerts(settings(), [value], null, now);
  assert.equal(
    planAlerts(settings({ restAlerts: false }), [value], null, now, true).length,
    1,
  );
  const background = planAlerts(
    settings({ restAlerts: false }),
    [value],
    null,
    now,
    false,
  );
  assert.equal(background.length, 1);
  assert.equal(alertSignature(background[0]), alertSignature(first[0]));
  value.timers.restCues = false;
  assert.deepEqual(
    planAlerts(settings({ restAlerts: false }), [value], null, now, false),
    [],
  );
  assert.deepEqual(planAlerts(settings(), [value], null, now, true), []);
  assert.equal(planAlerts(settings(), [value], null, now, false).length, 1);
  value.timers.restCues = true;
  value.rest.endsAt += 30000;
  const next = planAlerts(settings(), [value], null, now);
  assert.equal(first[0].id, next[0].id);
  assert.notEqual(alertSignature(first[0]), alertSignature(next[0]));
  assert.deepEqual(planAlerts(settings(), [value], null, now + 90000), []);
  value.rest = null;
  assert.deepEqual(planAlerts(settings(), [value], null, now), []);
});
test('a rest alarm fires at its end, follows length changes and is cleared by the next set or ending', () => {
  const resting = () => {
    const value = workout();
    value.exercises[0].sets[0] = {
      ...value.exercises[0].sets[0],
      weight: '20',
      reps: '5',
      startedAt: now - 30000,
      completedAt: now,
    };
    value.rest = {
      exerciseId: value.exercises[0].id,
      setId: value.exercises[0].sets[0].id,
      startedAt: now,
      endsAt: now + 90000,
    };
    return value;
  };
  for (const foreground of [true, false]) {
    const quiet = settings({ restAlerts: false });
    const [alert] = planAlerts(quiet, [resting()], null, now, foreground);
    assert.deepEqual(alert.trigger, { at: now + 90000 });
    assert.equal(alert.title, 'Rest complete');
  }
  const longer = resting();
  longer.rest!.endsAt += 30000;
  assert.deepEqual(planAlerts(settings(), [longer], null, now + 1000)[0].trigger, {
    at: now + 120000,
  });
  const later = now + 20000;
  assert.deepEqual(planAlerts(settings(), [endRest(resting(), later)], null, later), []);
  assert.deepEqual(planAlerts(settings(), [finishWorkout(resting(), later)], null, later), []);
  const discarded = { ...resting(), status: 'discarded' as const };
  assert.deepEqual(planAlerts(settings(), [discarded], null, now), []);
});
test('the manifest asks for exact alarms like the current app, once, with the pre-13 cap', () => {
  const manifest: Manifest = {
    manifest: {
      'uses-permission': [
        { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } },
        { $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM' } },
      ],
    },
  };
  exactAlarms.addExactAlarmPermissions(manifest);
  exactAlarms.addExactAlarmPermissions(manifest);
  assert.deepEqual(
    manifest.manifest['uses-permission']!.map((row) => row.$),
    [
      { 'android:name': 'android.permission.POST_NOTIFICATIONS' },
      { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM', 'android:maxSdkVersion': '32' },
      { 'android:name': 'android.permission.USE_EXACT_ALARM' },
    ],
  );
});
test('walk cues follow paused elapsed time, cancel while paused and stop after ending', () => {
  const value = walk();
  const first = planAlerts(settings(), [], value, now + 1000);
  assert.equal(first.length, 4);
  assert.equal((first[0].trigger as { at: number }).at, now + 60000);
  value.pauseStartMs = now + 30000;
  assert.deepEqual(planAlerts(settings(), [], value, now + 40000), []);
  value.pauseStartMs = null;
  value.pausedMs = 20000;
  const resumed = planAlerts(settings(), [], value, now + 50000);
  assert.equal((resumed[0].trigger as { at: number }).at, now + 80000);
  value.mode = 'done';
  assert.deepEqual(planAlerts(settings(), [], value, now), []);
});
test('fitness-test phases and prescribed activity targets use paused deadlines without changing recording', () => {
  const activity = walk();
  activity.guidance = {
    kind: 'test',
    protocol: 'resting_hrr',
    activityId: 'one',
    countdownUntil: now,
    restingHr: '',
    peakHr: '',
    recoveryHr: '',
    saved: false,
  };
  activity.pausedMs = 10000;
  const phases = planAlerts(settings(), [], activity, now);
  assert.deepEqual(
    phases.map((row) => row.title),
    ['Go hard', 'Recover', 'Test complete'],
  );
  assert.equal((phases[0].trigger as { at: number }).at, now + 70000);
  activity.guidance = undefined;
  activity.target = { label: 'Easy run', minutes: 10, hrLow: 90, hrHigh: 130 };
  const target = planAlerts(settings(), [], activity, now);
  assert.equal(target.length, 1);
  assert.equal((target[0].trigger as { at: number }).at, now + 610000);
});
test('daily reminders collapse weekdays, weekly reminders retain exact weekdays and disabled reminders disappear', () => {
  const reminder = {
    id: 'one',
    kind: 'meal',
    title: 'Lunch',
    time: '12:30',
    days: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
  };
  assert.equal(planAlerts(settings({ reminders: [reminder] }), [], null, now).length, 1);
  const weekly = planAlerts(
    settings({ reminders: [{ ...reminder, days: [0, 3] }] }),
    [],
    null,
    now,
  );
  assert.equal(weekly.length, 2);
  assert.deepEqual(
    weekly.map((row) => row.trigger),
    [
      { hour: 12, minute: 30, weekday: 0 },
      { hour: 12, minute: 30, weekday: 3 },
    ],
  );
  assert.deepEqual(
    planAlerts(settings({ reminders: [{ ...reminder, enabled: false }] }), [], null, now),
    [],
  );
  assert.equal(
    platformSchema.safeParse({
      scope: 'one',
      reminders: [{ ...reminder, time: '25:00' }],
    }).success,
    false,
  );
});
test('notification budget refuses excess repeat days instead of silently losing alerts', () => {
  const reminders = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    kind: 'workout',
    title: 'Workout',
    time: '12:00',
    days: [1, 2, 3, 4, 5, 6],
  }));
  assert.equal(platformSchema.safeParse({ scope: 'one', reminders }).success, false);
  const active = walk();
  active.guidance = {
    kind: 'walk',
    config: { ...defaultWalk, sets: 12, warmupSec: 60, cooldownSec: 60 },
    saved: false,
  };
  assert.ok(
    planAlerts(settings({ reminders: reminders.slice(0, 5) }), [], active, now).length <=
      60,
  );
});
test('scheduler keeps unchanged alerts and cancels old-account and changed timers', async () => {
  const saved = new Map<string, string>(),
    scheduled: string[] = [],
    cancelled: string[] = [];
  const scheduler = new AlertScheduler({
    list: async () => [...saved].map(([id, signature]) => ({ id, signature })),
    schedule: async (row) => {
      saved.set(row.id, alertSignature(row));
      scheduled.push(row.id);
    },
    cancel: async (id) => {
      saved.delete(id);
      cancelled.push(id);
    },
  });
  const alert: Alert = {
    id: 'one',
    scope: 'account-one',
    title: 'Rest',
    body: 'Done',
    target: 'workout',
    trigger: { at: now + 1000 },
  };
  await scheduler.reconcile([alert]);
  await scheduler.reconcile([alert]);
  assert.equal(scheduled.length, 1);
  await scheduler.reconcile([{ ...alert, trigger: { at: now + 2000 } }]);
  assert.equal(scheduled.length, 2);
  assert.deepEqual(cancelled, ['one']);
  await scheduler.reconcile([]);
  assert.equal(saved.size, 0);
});
test('account switch during native scheduling cancels the late old-account alert', async () => {
  let done!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const saved = new Set<string>();
  const scheduler = new AlertScheduler({
    list: async () => [...saved].map((id) => ({ id, signature: '' })),
    schedule: async (row) => {
      started();
      await new Promise<void>((resolve) => {
        done = resolve;
      });
      saved.add(row.id);
    },
    cancel: async (id) => {
      saved.delete(id);
    },
  });
  const first = scheduler.reconcile([
    {
      id: 'old',
      scope: 'old',
      title: 'Rest',
      body: 'Done',
      target: 'workout',
      trigger: { at: now + 1000 },
    },
  ]);
  await ready;
  const signedOut = scheduler.reconcile([]);
  done();
  await Promise.all([first, signedOut]);
  assert.equal(saved.size, 0);
});
test('integration preferences persist per account and disk failures preserve the accepted settings', async () => {
  const db = sqliteFixture(),
    storage = await createLocalStorage(db.database);
  const account = storage.account('https://example.com', 'one');
  const store = new PlatformStore(account, () => 'one-scope');
  await store.configure({ restAlerts: true, keepAwake: false });
  const restored = new PlatformStore(account, () => 'unused-scope');
  await restored.initialize();
  assert.equal(restored.getSnapshot().settings.scope, 'one-scope');
  assert.equal(restored.getSnapshot().settings.restAlerts, true);
  const other = new PlatformStore(
    storage.account('https://example.com', 'two'),
    () => 'two-scope',
  );
  await other.initialize();
  assert.equal(other.getSnapshot().settings.restAlerts, false);
  const disk = memory(),
    unsaved = new PlatformStore(disk, () => 'scope');
  await unsaved.initialize();
  disk.fail(true);
  await assert.rejects(unsaved.configure({ restAlerts: true }));
  assert.equal(unsaved.getSnapshot().settings.restAlerts, false);
  disk.fail(false);
  await unsaved.retry();
  assert.equal(unsaved.getSnapshot().error, null);
  assert.equal(unsaved.getSnapshot().settings.restAlerts, false);
  db.connection.close();
});
function calendarFixture() {
  const disk = memory(),
    events = new Map<string, CalendarEvent>();
  let creates = 0,
    updates = 0;
  const service = {
    find: async (_calendar: string, marker: string) =>
      [...events].find(([, row]) => row.notes.includes(marker))?.[0] ?? null,
    create: async (_calendar: string, row: CalendarEvent) => {
      const id = String(++creates);
      events.set(id, row);
      return id;
    },
    update: async (id: string, row: CalendarEvent) => {
      updates++;
      events.set(id, row);
    },
    remove: async (id: string) => {
      events.delete(id);
    },
  };
  return {
    disk,
    events,
    service,
    counts: () => ({ creates, updates }),
    store: new CalendarStore(disk, service),
  };
}
test('calendar creation is serialized and repeat calls or reopening cannot duplicate an event', async () => {
  const f = calendarFixture(),
    value = completed();
  await Promise.all([f.store.add(value, 'calendar'), f.store.add(value, 'calendar')]);
  assert.equal(f.counts().creates, 1);
  const restored = new CalendarStore(f.disk, f.service);
  await restored.add(value, 'calendar');
  assert.equal(f.counts().creates, 1);
  await restored.add({ ...value, sessionName: 'Changed name' }, 'calendar');
  assert.equal(f.counts().updates, 1);
  assert.equal(f.events.get('1')?.title, 'Changed name · TrainingAi');
});
test('calendar crash recovery finds the owned marker after a failed mapping save', async () => {
  const f = calendarFixture(),
    value = completed();
  await f.store.initialize();
  f.disk.fail(true);
  await assert.rejects(f.store.add(value, 'calendar'));
  assert.equal(f.counts().creates, 1);
  f.disk.fail(false);
  const restored = new CalendarStore(f.disk, f.service);
  await restored.add(value, 'calendar');
  assert.equal(f.counts().creates, 1);
  assert.equal(Object.keys(restored.getSnapshot().events).length, 1);
});
test('removing an owned calendar event suppresses automatic recreation, while manual add is allowed', async () => {
  const f = calendarFixture(),
    value = completed();
  await f.store.add(value, 'calendar');
  await f.store.remove(value.id);
  await f.store.sync(
    [value],
    settings({ calendarAuto: true, calendarId: 'calendar', calendarSince: 0 }),
  );
  assert.equal(f.events.size, 0);
  await f.store.add(value, 'calendar');
  assert.equal(f.events.size, 1);
  assert.equal(f.counts().creates, 2);
});
test('notification scheduling failures propagate and a subsequent retry succeeds', async () => {
  let fail = true,
    calls = 0;
  const scheduler = new AlertScheduler({
    list: async () => [],
    cancel: async () => {},
    schedule: async () => {
      calls++;
      if (fail) throw new Error('native scheduling failed');
    },
  });
  const alert: Alert = {
    id: 'one',
    scope: 'scope',
    title: 'Rest',
    body: 'Done',
    target: 'workout',
    trigger: { at: now + 1000 },
  };
  await assert.rejects(scheduler.reconcile([alert]), /native scheduling failed/);
  fail = false;
  await scheduler.reconcile([alert]);
  assert.equal(calls, 2);
});
test('concurrent reminder saves preserve both configured reminders', async () => {
  const store = new PlatformStore(memory(), () => 'scope');
  await store.initialize();
  const base = {
    kind: 'meal' as const,
    title: 'Meal',
    time: '12:00',
    days: [1],
    enabled: true,
  };
  await Promise.all([
    store.saveReminder({ ...base, id: 'one' }),
    store.saveReminder({ ...base, id: 'two' }),
  ]);
  assert.equal(store.getSnapshot().settings.reminders.length, 2);
});
test('automatic calendar sync starts at opt-in time and cancellation stops queued account work', async () => {
  const f = calendarFixture(),
    value = completed();
  await f.store.sync(
    [value],
    settings({
      calendarAuto: true,
      calendarId: 'calendar',
      calendarSince: value.completedAt! + 1,
    }),
  );
  assert.equal(f.events.size, 0);
  const pending = f.store.sync(
    [value],
    settings({ calendarAuto: true, calendarId: 'calendar', calendarSince: 0 }),
  );
  f.store.cancel();
  await pending;
  assert.equal(f.events.size, 0);
});
