import { useMemo, useRef } from 'react';
import { z } from 'zod';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { useHomeState } from '../home/data/HomeProvider';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import type { MealEstimateReminder } from '../meal-plans/data/estimated-meals';
import { wantsDailyReminders, type DailyReminderInput } from './data/daily-reminders';

/** The account's estimated bedtime, which the end-of-day and day-review reminders count back from. */
export const bedtimeSpec = {
  path: '/api/user/bedtime-estimate',
  ttl: 6 * 3600_000,
  schema: z.object({ bedtimeHour: z.number().int().min(0).max(23), bedtimeMinute: z.number().int().min(0).max(59) }),
};

/**
 * What the current app's daily reminders are planned from (#3653), out of what Preview already
 * holds: the supplements and today's ticks, the meal groups and today's food, the two reminder
 * switches on the account, and the estimated bedtime.
 *
 * Null until nutrition has loaded once. After that the last answer stands while a refresh is in
 * flight, so an app start that has not read its data yet does not cancel reminders already set.
 */
export function useDailyReminders(estimates: readonly MealEstimateReminder[]) {
  const n = useNutrition();
  const { preferences } = useHomeState();
  const mealReminders = preferences.mealReminders !== false;
  const dayReviewReminders = preferences.dayReviewReminders !== false;
  const { supplements, mealTypes, logs } = n.view;
  const needsBedtime =
    dayReviewReminders || (mealReminders && mealTypes.some((type) => type.required));
  const bedtime = useWorkoutResource(bedtimeSpec, needsBedtime).data;
  const last = useRef<DailyReminderInput | null>(null);
  const input = useMemo<DailyReminderInput | null>(() => {
    if (!n.ready) return null;
    return {
      today: n.today,
      tz: n.timezone,
      supplements,
      mealTypes,
      loggedMealTypeIds: [...new Set(logs.map((log) => log.mealTypeId))],
      estimateMealTypeIds: [
        ...new Set(estimates.filter((row) => row.date === n.today).map((row) => row.mealTypeId)),
      ],
      bedtime: bedtime ?? null,
      mealReminders,
      dayReviewReminders,
    };
  }, [
    n.ready,
    n.today,
    n.timezone,
    supplements,
    mealTypes,
    logs,
    estimates,
    bedtime,
    mealReminders,
    dayReviewReminders,
  ]);
  if (input) last.current = input;
  const current = last.current;
  // The profile's local day and zone, known before nutrition loads, for the fixed-time reminders.
  const clock = useMemo(() => ({ today: n.today, tz: n.timezone }), [n.today, n.timezone]);
  return { input: current, on: !!current && wantsDailyReminders(current), clock };
}
