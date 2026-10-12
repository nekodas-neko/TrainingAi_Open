import { z } from 'zod';
import { isCalendarDate } from '@trainingai/shared/date-utils';
import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@trainingai/shared/types/user';
export const profileFields = z.object({
  displayName: z.string().min(1).max(100).nullable(),
  heightCm: z.number().min(50).max(300).nullable(),
  dateOfBirth: z.string().refine(isCalendarDate, 'Enter a valid date of birth.').nullable(),
  sex: z.enum(['male', 'female', 'other']).nullable(),
  activityLevel: z.enum(ACTIVITY_LEVELS).nullable(),
  fitnessGoal: z.enum(FITNESS_GOALS).nullable(),
  timezone: z
    .string()
    .max(60)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Choose a valid timezone.')
    .nullable(),
});
export function profilePatch(fields: Record<string, string>, keys: string[]) {
  return profileFields
    .partial()
    .parse(
      Object.fromEntries(
        keys.map((key) => [
          key,
          fields[key]?.trim()
            ? key === 'heightCm'
              ? Number(fields[key])
              : fields[key].trim()
            : null,
        ]),
      ),
    );
}
export function timezoneOptions(current: string) {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return [
    ...new Set([
      current,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      'Australia/Brisbane',
      'UTC',
      ...(intl.supportedValuesOf?.('timeZone') ?? [
        'Australia/Sydney',
        'Australia/Melbourne',
        'Australia/Perth',
        'Pacific/Auckland',
        'Europe/London',
        'Europe/Paris',
        'America/New_York',
        'America/Los_Angeles',
        'Asia/Tokyo',
        'Asia/Singapore',
      ]),
    ]),
  ]
    .filter(Boolean)
    .sort()
    .map((value) => ({ value, label: value.replaceAll('_', ' ') }));
}
