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
/** "Mar 25" for the More tab's "Member since" tile, in the user's timezone: the current app's
 *  `formatInTimeZone(createdAt, tz, 'MMM yy')`, without pulling date-fns into the native app.
 *  `null` for a missing or unparseable timestamp, or a zone Intl rejects, so the tile shows "—". */
export function memberSinceLabel(createdAt: unknown, timeZone: string): string | null {
  if (typeof createdAt !== 'string' && typeof createdAt !== 'number') return null;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone,
    }).formatToParts(at);
  } catch {
    return null; // a stored zone Intl rejects ('', 'AEST') must not take the More tab down
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('month')} ${part('year')}`;
}
export type ProgramWeekSummary = {
  mode: 'cycle' | 'tenure' | null;
  weeksRunning?: number;
  cycleCurrent?: number;
  cycleTotal?: number;
  phaseName?: string | null;
  blockComplete?: boolean;
} | null;
/** The More tab's sixth stat tile, in the current app's order (`components/more/stats-grid.tsx`):
 *  a cycle shows where in the block you are, a tenure programme shows its weeks, and anything
 *  else (no programme, or it has not loaded) shows when the account was made. */
export function programTile(
  program: ProgramWeekSummary | undefined,
  memberSince: string | null,
): { label: string; value: string } {
  if (program?.mode === 'cycle') {
    return {
      label: program.blockComplete ? 'New block?' : (program.phaseName ?? 'Cycle'),
      value: `${program.cycleCurrent ?? '—'}/${program.cycleTotal ?? '—'}`,
    };
  }
  if (program?.mode === 'tenure' && program.weeksRunning != null) {
    return {
      label: program.weeksRunning >= 12 ? 'Review?' : 'On program',
      value: `${program.weeksRunning}w`,
    };
  }
  return { label: 'Member since', value: memberSince ?? '—' };
}
