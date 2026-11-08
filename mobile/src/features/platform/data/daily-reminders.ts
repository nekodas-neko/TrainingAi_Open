import { shiftDateStr } from '@trainingai/shared/date-utils';
import {
  DAY_REVIEW_TEXT,
  END_OF_DAY_MEAL_TEXT,
  FALLBACK_BEDTIME,
  WEEKLY_RECAP_TEXT,
  dayReviewReminderAt,
  endOfDayMealReminderAt,
  hasUnloggedRequiredMeal,
  mealReminderText,
  mealWindowEndAt,
  supplementReminderAt,
  supplementReminderDue,
  supplementReminderText,
  weeklyRecapReminderAt,
  type Bedtime,
  type MealTypeForReminder,
  type SupplementForReminder,
} from '@trainingai/shared/reminders/daily-reminders';
import type { Alert } from './models.ts';

/**
 * The current app's daily reminders, from the settings already stored on the account (#3653):
 * each supplement's own reminder time, the end of a meal group's window with nothing logged, the
 * "log your meals before bed" nudge when a required meal is missing, the day review's wind-down,
 * and the Sunday recap. The rules and the words are `@trainingai/shared/reminders/daily-reminders`,
 * which the current app schedules from too.
 *
 * Today's and tomorrow's are planned, so tomorrow's still fire if the app is not opened before
 * them. Tomorrow's assume nothing is logged yet, which is true until tomorrow comes; then they are
 * today's and follow what was logged. A reminder whose time has passed stays in the plan while it
 * still applies, so the scheduler keeps the one on screen, and leaves it the moment the supplement
 * is ticked or the meal logged, which takes the notification away with it.
 */
export type DailyReminderInput = {
  /** The user's local day and profile zone. */
  today: string;
  tz: string;
  supplements: readonly (SupplementForReminder & { id: string })[];
  mealTypes: readonly MealTypeForReminder[];
  /** Meal groups with food logged today. */
  loggedMealTypeIds: readonly string[];
  /**
   * Meal groups that already have today's plan-meal reminder (#2123). That one asks about the
   * planned meal at the same moment, so this one stands aside rather than sending a second.
   */
  estimateMealTypeIds: readonly string[];
  /** The account's estimated bedtime, or null while it is not known (22:00 then, as in the current app). */
  bedtime: Bedtime | null;
  /** The account's "Remind me to log meals" switch (`mealReminders`). Unset is on. */
  mealReminders: boolean;
  /** The account's "Day & week review reminders" switch (`dayReviewReminders`). Unset is on. */
  dayReviewReminders: boolean;
};

export function planDailyReminders(scope: string, input: DailyReminderInput): Alert[] {
  const { today, tz } = input;
  const tomorrow = shiftDateStr(today, 1);
  const bedtime = input.bedtime ?? FALLBACK_BEDTIME;
  const out: Alert[] = [];
  // A time already past stays in the plan, so a notification on screen is not taken away by the
  // next reconcile. The native layer never schedules a past time, so nothing is sent late: a
  // reminder first planned after its time (set at 10:00 for 08:00) waits for tomorrow's.
  const add = (alert: Omit<Alert, 'scope' | 'trigger'>, at: Date | null) => {
    if (at && Number.isFinite(at.getTime()))
      out.push({ ...alert, scope, trigger: { at: at.getTime() } });
  };
  for (const day of [today, tomorrow]) {
    const isToday = day === today;
    for (const s of input.supplements) {
      // Tomorrow's dose is not taken yet, whatever today's tick says.
      if (!supplementReminderDue({ ...s, loggedToday: isToday && s.loggedToday })) continue;
      add(
        {
          id: `${scope}:supplement:${day}:${s.id}`,
          ...supplementReminderText(s.name),
          target: 'nutrition',
          recordId: s.id,
        },
        supplementReminderAt(day, s.reminderTime, tz),
      );
    }
    if (!input.mealReminders) continue;
    const logged = new Set(isToday ? input.loggedMealTypeIds : []);
    const estimated = new Set(isToday ? input.estimateMealTypeIds : []);
    for (const mt of input.mealTypes) {
      if (!mt.remindersEnabled || logged.has(mt.id) || estimated.has(mt.id)) continue;
      add(
        {
          id: `${scope}:meal:${day}:${mt.id}`,
          ...mealReminderText(mt.emoji, mt.name),
          target: 'nutrition',
          recordId: mt.id,
        },
        mealWindowEndAt(day, mt.timeEndHour, tz),
      );
    }
    if (hasUnloggedRequiredMeal(input.mealTypes, logged))
      add(
        {
          id: `${scope}:meals-before-bed:${day}`,
          ...END_OF_DAY_MEAL_TEXT,
          // The current app opens the day review to backfill (`/nutrition?chat=backfill`).
          target: 'review',
        },
        endOfDayMealReminderAt(day, bedtime, tz),
      );
  }
  if (input.dayReviewReminders) {
    for (const day of [today, tomorrow])
      add(
        { id: `${scope}:day-review:${day}`, ...DAY_REVIEW_TEXT, target: 'review' },
        dayReviewReminderAt(day, bedtime, tz),
      );
    const recap = weeklyRecapReminderAt(today, tz);
    add(
      { id: `${scope}:week-recap:${recap.sunday}`, ...WEEKLY_RECAP_TEXT, target: 'week' },
      recap.at,
    );
  }
  return out;
}

/** True when any of the daily reminders is switched on, so refused notifications matter. */
export function wantsDailyReminders(input: Pick<
  DailyReminderInput,
  'supplements' | 'mealTypes' | 'mealReminders' | 'dayReviewReminders'
>) {
  return (
    input.dayReviewReminders ||
    input.supplements.some((s) => s.active && s.reminderEnabled && !!s.reminderTime) ||
    (input.mealReminders &&
      input.mealTypes.some((mt) => mt.remindersEnabled || mt.required))
  );
}
