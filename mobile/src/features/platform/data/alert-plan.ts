import { walkPlan } from '../../activities/data/guidance.ts';
import { getProtocol, phasesTotalSec } from '@trainingai/shared/fitness-tests/protocols';
import type { ActivitySession } from '../../activities/data/ActivityStore.ts';
import type { WorkoutRecord } from '../../workouts/logging/workout.ts';
import { reminderText, type MealEstimateReminder } from '../../meal-plans/data/estimated-meals.ts';
import type { Alert, PlatformSettings } from './models.ts';
import { planDailyReminders, type DailyReminderInput } from './daily-reminders.ts';
import { localClockTimeToDate, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils';

/** The user's local day and profile zone, which fixed-time reminders are planned in. */
export type AlertClock = { today: string; tz: string };

export function planAlerts(
  settings: PlatformSettings,
  workouts: WorkoutRecord[],
  activity: ActivitySession | null,
  now = Date.now(),
  mealReminders: MealEstimateReminder[] = [],
  daily: DailyReminderInput | null = null,
  clock: AlertClock | null = null,
): Alert[] {
  const scope = settings.scope;
  const result: Alert[] = [];
  for (const workout of workouts) {
    // The rest cue's alarm must survive backgrounding (#3062). The last set's rest on the
    // exercise summary alarms too (#3111).
    if (
      workout.timers.restCues &&
      workout.status === 'active' &&
      workout.pausedAt == null &&
      workout.rest &&
      workout.rest.endsAt > now
    ) {
      const exercise = workout.exercises.find(
        (row) => row.id === workout.rest!.exerciseId,
      );
      // The current app's wording: the number after the set just logged, so "Time for set N+1"
      // after an exercise's last set (lib/notifications.ts, #3142).
      const logged = exercise?.sets.findIndex((set) => set.id === workout.rest!.setId) ?? -1;
      result.push({
        id: `${scope}:rest:${workout.id}`,
        scope,
        title: 'Rest complete',
        body: logged >= 0 ? `Time for set ${logged + 2}` : 'Time for your next set',
        target: 'workout',
        recordId: workout.id,
        restCueId: `${workout.id}:${workout.rest.startedAt}:${workout.rest.endsAt}`,
        trigger: { at: workout.rest.endsAt },
      });
    }
  }
  if (
    settings.walkCues &&
    activity?.guidance?.kind === 'walk' &&
    activity.mode === 'active' &&
    activity.startMs !== null &&
    activity.pauseStartMs === null
  ) {
    const plan = walkPlan(activity.guidance.config);
    const base = activity.startMs + activity.pausedMs;
    for (const segment of plan.segments) {
      const at = base + segment.startSec * 1000;
      if (segment.index === 0 || at <= now) continue;
      const label =
        segment.kind === 'fast'
          ? 'Fast walking'
          : segment.kind === 'slow'
            ? 'Easy walking'
            : segment.kind === 'cooldown'
              ? 'Cool down'
              : 'Warm up';
      result.push({
        id: `${scope}:walk:${activity.id}:${segment.index}`,
        scope,
        title: label,
        body: `${Math.round((segment.endSec - segment.startSec) / 60)} min · interval walk`,
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
    }
    const at = base + plan.totalSec * 1000;
    if (at > now)
      result.push({
        id: `${scope}:walk:${activity.id}:done`,
        scope,
        title: 'Walk complete',
        body: 'Your planned intervals are finished. Open the app to review and save.',
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
  }
  if (
    settings.walkCues &&
    activity?.mode === 'active' &&
    activity.startMs !== null &&
    activity.pauseStartMs === null &&
    activity.guidance?.kind !== 'walk'
  ) {
    const base = activity.startMs + activity.pausedMs;
    const protocol =
      activity.guidance?.kind === 'test'
        ? getProtocol(activity.guidance.protocol)
        : undefined;
    let elapsed = 0;
    for (const [index, phase] of (protocol?.phases ?? []).entries()) {
      const at = base + elapsed * 1000;
      if (index > 0 && at > now)
        result.push({
          id: `${scope}:activity:${activity.id}:${phase.key}`,
          scope,
          title: phase.label,
          body: phase.instruction,
          target: 'walk',
          recordId: activity.id,
          trigger: { at },
        });
      elapsed += phase.durationSec;
    }
    const seconds = protocol
      ? (protocol.durationSec ?? phasesTotalSec(protocol.phases ?? []))
      : (activity.target?.minutes ?? 0) * 60;
    const at = base + seconds * 1000;
    if (seconds > 0 && at > now)
      result.push({
        id: `${scope}:activity:${activity.id}:done`,
        scope,
        title: protocol ? 'Test complete' : 'Planned time complete',
        body: 'Open the app to review your activity.',
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
  }
  // Fixed-time reminders are dated instants in the profile's zone, today's and tomorrow's, as the
  // daily reminders are (#3683). A native DAILY or WEEKLY trigger reads the phone's clock, so a
  // phone in another zone fired them at the wrong moment. Planning two days ahead means a reminder
  // stops if the app is not opened for two days, the same limit the daily reminders have. A time
  // already past stays in the plan, so the notification on screen is kept; the native layer never
  // schedules a past time.
  const zone = clock?.tz ?? daily?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = clock?.today ?? daily?.today ?? toAestDay(new Date(now), zone);
  const days = [today, shiftDateStr(today, 1)];
  for (const reminder of settings.reminders.filter((row) => row.enabled)) {
    const target =
      reminder.kind === 'meal' || reminder.kind === 'supplement'
        ? 'nutrition'
        : reminder.kind === 'workout'
          ? 'workout'
          : reminder.kind;
    for (const day of days) {
      // Reminder days are 0 = Sunday … 6 = Saturday, read off the calendar date itself.
      if (!reminder.days.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
      const at = localClockTimeToDate(day, reminder.time, zone)?.getTime();
      if (at === undefined || !Number.isFinite(at)) continue;
      result.push({
        id: `${scope}:reminder:${reminder.id}:${day}`,
        scope,
        title: reminder.title,
        body: 'Your TrainingAi reminder.',
        target,
        trigger: { at },
      });
    }
  }
  // Asked once the meal's slot is over. A reminder whose time has passed stays in the plan while it
  // is unanswered, so the scheduler keeps the one on screen instead of cancelling it.
  for (const reminder of mealReminders) {
    result.push({
      id: `${scope}:meal-estimate:${reminder.date}:${reminder.planMealId}`,
      scope,
      ...reminderText(reminder),
      target: 'nutrition',
      recordId: reminder.planMealId,
      mealEstimate: { planMealId: reminder.planMealId, date: reminder.date },
      trigger: { at: reminder.at },
    });
  }
  // The current app's supplement, meal-group and end-of-day reminders (#3653).
  if (daily) result.push(...planDailyReminders(scope, daily));
  return result;
}

/** Whether anything the user has switched on needs notification permission to work. */
export function wantsNotifications(
  settings: PlatformSettings,
  restCueOn: boolean,
  dailyRemindersOn = false,
) {
  return (
    restCueOn ||
    dailyRemindersOn ||
    settings.walkCues ||
    settings.reminders.some((row) => row.enabled)
  );
}

/** The Rest timer alarm row in Preview settings (#3083): the rest cue drives the alarm, there is no switch of its own. */
export const restAlarmRow = {
  title: 'Rest timer alarm',
  caption: "Follows each workout's rest cue. Turn the cue on in the workout to get the alarm.",
  blockedLabel: 'Blocked',
  blockedCaption:
    "Android has notifications turned off for this app, so the rest alarm can't sound with the screen off.",
} as const;

/** True when something switched on needs notification permission and Android has refused it. */
export function notificationsBlocked(
  settings: PlatformSettings,
  restCueOn: boolean,
  permission: boolean,
  dailyRemindersOn = false,
) {
  return !permission && wantsNotifications(settings, restCueOn, dailyRemindersOn);
}
