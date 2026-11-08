import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localClockTimeToDate } from '@trainingai/shared/date-utils';
import { platformSchema, alertSignature, type Alert } from '../src/features/platform/data/models.ts';
import { planAlerts, notificationsBlocked } from '../src/features/platform/data/alert-plan.ts';
import { AlertScheduler } from '../src/features/platform/data/AlertScheduler.ts';
import {
  planDailyReminders,
  wantsDailyReminders,
  type DailyReminderInput,
} from '../src/features/platform/data/daily-reminders.ts';

// #3653: the current app's supplement, meal-group and end-of-day reminders, planned in Preview.
const TZ = 'Australia/Brisbane';
const TODAY = '2026-11-09'; // a Monday
// Fixtures anchor to local midday.
const MIDDAY = localClockTimeToDate(TODAY, '12:00', TZ)!.getTime();
function local(ms: number, tz = TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const creatine = {
  id: 'sup-1',
  name: 'Creatine',
  active: true,
  reminderEnabled: true,
  reminderTime: '08:00',
  loggedToday: false,
};
const breakfast = {
  id: 'mt-b',
  name: 'Breakfast',
  emoji: '🍳',
  remindersEnabled: true,
  timeEndHour: 10,
  required: true,
};
const snack = { ...breakfast, id: 'mt-s', name: 'Snack', emoji: '🍎', remindersEnabled: false, required: false, timeEndHour: 24 };
function input(patch: Partial<DailyReminderInput> = {}): DailyReminderInput {
  return {
    today: TODAY,
    tz: TZ,
    supplements: [creatine],
    mealTypes: [breakfast, snack],
    loggedMealTypeIds: [],
    estimateMealTypeIds: [],
    bedtime: { bedtimeHour: 22, bedtimeMinute: 30 },
    mealReminders: true,
    dayReviewReminders: false,
    ...patch,
  };
}
const ids = (alerts: Alert[]) => alerts.map((a) => a.id).sort();
const byId = (alerts: Alert[], id: string) => alerts.find((a) => a.id === id);

function fakeService() {
  const scheduled = new Map<string, Alert>();
  const log: string[] = [];
  return {
    scheduled,
    log,
    service: {
      list: async () => [...scheduled.values()].map((a) => ({ id: a.id, signature: alertSignature(a) })),
      schedule: async (a: Alert) => {
        scheduled.set(a.id, a);
        log.push(`schedule ${a.id}`);
      },
      cancel: async (id: string) => {
        scheduled.delete(id);
        log.push(`cancel ${id}`);
      },
    },
  };
}

test('a supplement reminder fires at its stored time in the user\'s zone, today and tomorrow, in the current app\'s words', () => {
  const alerts = planDailyReminders('u1', input({ mealTypes: [] }));
  assert.deepEqual(ids(alerts), ['u1:supplement:2026-11-09:sup-1', 'u1:supplement:2026-11-10:sup-1']);
  const [today, tomorrow] = alerts;
  assert.equal(today.title, 'Supplement reminder');
  assert.equal(today.body, "Don't forget to log Creatine!");
  assert.equal(today.target, 'nutrition');
  assert.ok('at' in today.trigger && 'at' in tomorrow.trigger);
  assert.equal(local(today.trigger.at), '2026-11-09 08:00');
  assert.equal(local(tomorrow.trigger.at), '2026-11-10 08:00');
  // 08:00 Brisbane, not 08:00 on whatever clock the phone has.
  assert.equal(new Date(today.trigger.at).toISOString(), '2026-11-08T22:00:00.000Z');
});

test('ticking a supplement takes today\'s reminder out of the plan and leaves tomorrow\'s', () => {
  const alerts = planDailyReminders('u1', input({ mealTypes: [], supplements: [{ ...creatine, loggedToday: true }] }));
  assert.deepEqual(ids(alerts), ['u1:supplement:2026-11-10:sup-1']);
});

test('turning a supplement\'s reminder off, stopping it or clearing its time plans nothing for it', () => {
  for (const patch of [{ reminderEnabled: false }, { active: false }, { reminderTime: null }, { reminderTime: '8am' }])
    assert.deepEqual(planDailyReminders('u1', input({ mealTypes: [], supplements: [{ ...creatine, ...patch }] })), []);
});

test('a meal group with reminders on is reminded at the end of its window until something is logged', () => {
  const alerts = planDailyReminders('u1', input({ supplements: [] }));
  const meal = byId(alerts, 'u1:meal:2026-11-09:mt-b')!;
  assert.equal(meal.title, 'Meal reminder');
  assert.equal(meal.body, "Don't forget to log 🍳 Breakfast!");
  assert.equal(meal.target, 'nutrition');
  assert.ok('at' in meal.trigger);
  assert.equal(local(meal.trigger.at), '2026-11-09 10:00');
  // The snack group has its switch off.
  assert.equal(alerts.filter((a) => a.id.includes('mt-s')).length, 0);
  const logged = planDailyReminders('u1', input({ supplements: [], loggedMealTypeIds: ['mt-b'] }));
  assert.equal(byId(logged, 'u1:meal:2026-11-09:mt-b'), undefined);
  assert.ok(byId(logged, 'u1:meal:2026-11-10:mt-b'));
});

test('a group asked about by today\'s plan-meal reminder gets no second reminder', () => {
  const alerts = planDailyReminders('u1', input({ supplements: [], estimateMealTypeIds: ['mt-b'] }));
  assert.equal(byId(alerts, 'u1:meal:2026-11-09:mt-b'), undefined);
  assert.ok(byId(alerts, 'u1:meal:2026-11-10:mt-b'));
});

test('the end-of-day reminder is 30 min before bedtime while a required meal is unlogged, opening the day review', () => {
  const alerts = planDailyReminders('u1', input({ supplements: [] }));
  const eod = byId(alerts, 'u1:meals-before-bed:2026-11-09')!;
  assert.equal(eod.title, 'Log your meals before bed');
  assert.equal(eod.body, 'You have unlogged required meals today. Tap to backfill.');
  assert.equal(eod.target, 'review');
  assert.ok('at' in eod.trigger);
  assert.equal(local(eod.trigger.at), '2026-11-09 22:00');
  const logged = planDailyReminders('u1', input({ supplements: [], loggedMealTypeIds: ['mt-b'] }));
  assert.equal(byId(logged, 'u1:meals-before-bed:2026-11-09'), undefined);
  // No estimate yet: 22:00, as the current app falls back to.
  const fallback = byId(planDailyReminders('u1', input({ bedtime: null })), 'u1:meals-before-bed:2026-11-09')!;
  assert.ok('at' in fallback.trigger);
  assert.equal(local(fallback.trigger.at), '2026-11-09 21:30');
});

test('the account\'s "Remind me to log meals" switch turns off the meal and end-of-day reminders, not supplements', () => {
  const alerts = planDailyReminders('u1', input({ mealReminders: false }));
  assert.deepEqual(ids(alerts), ['u1:supplement:2026-11-09:sup-1', 'u1:supplement:2026-11-10:sup-1']);
});

test('the day review switch plans the wind-down 50 min before bedtime and the Sunday recap', () => {
  const alerts = planDailyReminders('u1', input({ supplements: [], mealTypes: [], dayReviewReminders: true }));
  assert.deepEqual(ids(alerts), [
    'u1:day-review:2026-11-09',
    'u1:day-review:2026-11-10',
    'u1:week-recap:2026-11-15',
  ]);
  const review = byId(alerts, 'u1:day-review:2026-11-09')!;
  assert.equal(review.title, 'Bedtime approaching');
  assert.equal(review.target, 'review');
  assert.ok('at' in review.trigger);
  assert.equal(local(review.trigger.at), '2026-11-09 21:40');
  const recap = byId(alerts, 'u1:week-recap:2026-11-15')!;
  assert.equal(recap.title, 'Your week in review is ready');
  assert.equal(recap.target, 'week');
  assert.ok('at' in recap.trigger);
  assert.equal(local(recap.trigger.at), '2026-11-15 18:00');
});

test('across a DST change each reminder keeps its local time', () => {
  const tz = 'Australia/Sydney';
  // Sydney moves to daylight time early on Sunday 5 Oct 2025.
  const alerts = planDailyReminders('u1', input({ tz, today: '2025-10-04', mealTypes: [] }));
  const [sat, sun] = alerts.map((a) => ('at' in a.trigger ? a.trigger.at : 0));
  assert.equal(local(sat, tz), '2025-10-04 08:00');
  assert.equal(local(sun, tz), '2025-10-05 08:00');
  assert.equal(sun - sat, 23 * 3600_000);
});

test('a phone that has moved to another zone plans the same instants', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Australia/Brisbane';
    const home = planDailyReminders('u1', input({ dayReviewReminders: true }));
    process.env.TZ = 'America/Los_Angeles';
    assert.notEqual(new Date(MIDDAY).getHours(), 12); // the process really is elsewhere now
    assert.deepEqual(planDailyReminders('u1', input({ dayReviewReminders: true })), home);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('planAlerts adds the daily reminders and keeps them stable, so the scheduler leaves them alone', () => {
  const settings = platformSchema.parse({ scope: 'u1' });
  const first = planAlerts(settings, [], null, MIDDAY, [], input());
  const again = planAlerts(settings, [], null, MIDDAY + 3600_000, [], input());
  assert.ok(first.length > 0);
  assert.deepEqual(again.map(alertSignature), first.map(alertSignature));
  assert.deepEqual(planAlerts(settings, [], null, MIDDAY, [], null), []);
});

test('the scheduler schedules, reschedules on a time change, and cancels on a tick, a switch-off or a delete', async () => {
  const settings = platformSchema.parse({ scope: 'u1' });
  const fake = fakeService();
  const scheduler = new AlertScheduler(fake.service);
  const plan = (patch: Partial<DailyReminderInput>) =>
    planAlerts(settings, [], null, MIDDAY, [], input({ mealTypes: [], ...patch }));
  await scheduler.reconcile(plan({}));
  assert.deepEqual([...fake.scheduled.keys()].sort(), ['u1:supplement:2026-11-09:sup-1', 'u1:supplement:2026-11-10:sup-1']);

  // A new time replaces the scheduled notification.
  fake.log.length = 0;
  await scheduler.reconcile(plan({ supplements: [{ ...creatine, reminderTime: '09:30' }] }));
  const moved = fake.scheduled.get('u1:supplement:2026-11-10:sup-1')!;
  assert.ok('at' in moved.trigger);
  assert.equal(local(moved.trigger.at), '2026-11-10 09:30');
  assert.ok(fake.log.includes('cancel u1:supplement:2026-11-10:sup-1'));

  // Ticked today: today's goes, tomorrow's stays untouched.
  fake.log.length = 0;
  await scheduler.reconcile(plan({ supplements: [{ ...creatine, reminderTime: '09:30', loggedToday: true }] }));
  assert.deepEqual(fake.log, ['cancel u1:supplement:2026-11-09:sup-1']);

  // Reminder off: nothing left.
  await scheduler.reconcile(plan({ supplements: [{ ...creatine, reminderEnabled: false }] }));
  assert.equal(fake.scheduled.size, 0);

  // Deleted: the supplement leaves the list, and its notification with it.
  await scheduler.reconcile(plan({}));
  assert.equal(fake.scheduled.size, 2);
  await scheduler.reconcile(plan({ supplements: [] }));
  assert.equal(fake.scheduled.size, 0);
});

test('the scheduler does the same for a meal group and the end-of-day reminder', async () => {
  const settings = platformSchema.parse({ scope: 'u1' });
  const fake = fakeService();
  const scheduler = new AlertScheduler(fake.service);
  const plan = (patch: Partial<DailyReminderInput>) =>
    planAlerts(settings, [], null, MIDDAY, [], input({ supplements: [], ...patch }));
  await scheduler.reconcile(plan({}));
  assert.ok(fake.scheduled.has('u1:meal:2026-11-09:mt-b'));
  assert.ok(fake.scheduled.has('u1:meals-before-bed:2026-11-09'));
  // The window moves: rescheduled at the new end.
  await scheduler.reconcile(plan({ mealTypes: [{ ...breakfast, timeEndHour: 11 }, snack] }));
  const moved = fake.scheduled.get('u1:meal:2026-11-09:mt-b')!;
  assert.ok('at' in moved.trigger);
  assert.equal(local(moved.trigger.at), '2026-11-09 11:00');
  // Logged: today's meal and end-of-day reminders are cancelled.
  await scheduler.reconcile(plan({ loggedMealTypeIds: ['mt-b'] }));
  assert.equal(fake.scheduled.has('u1:meal:2026-11-09:mt-b'), false);
  assert.equal(fake.scheduled.has('u1:meals-before-bed:2026-11-09'), false);
  // The group's switch off, or the group deleted: none left for it.
  await scheduler.reconcile(plan({ mealTypes: [{ ...breakfast, remindersEnabled: false }, snack] }));
  assert.equal([...fake.scheduled.keys()].some((id) => id.startsWith('u1:meal:')), false);
  await scheduler.reconcile(plan({ mealTypes: [] }));
  assert.equal(fake.scheduled.size, 0);
});

test('refused notifications are flagged when only a daily reminder needs them', () => {
  const settings = platformSchema.parse({ scope: 'u1', walkCues: false });
  assert.equal(wantsDailyReminders(input()), true);
  assert.equal(
    wantsDailyReminders(input({ supplements: [], mealReminders: false, dayReviewReminders: false })),
    false,
  );
  assert.equal(notificationsBlocked(settings, false, false), false);
  assert.equal(notificationsBlocked(settings, false, false, true), true);
  assert.equal(notificationsBlocked(settings, false, true, true), false);
});

test('a dated reminder goes on the reminders channel; only a workout or walk cue is a timer', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/integrations/notifications/platform.native.ts', 'utf8');
  assert.match(
    src,
    /const timer =\s*'at' in alert\.trigger &&\s*!alert\.mealEstimate &&\s*\(alert\.target === 'workout' \|\| alert\.target === 'walk'\);/,
  );
  assert.match(src, /const channelId = timer \? 'training-timers' : 'training-reminders';/);
});
