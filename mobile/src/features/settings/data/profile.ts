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
/** The year part of a stored date of birth, for the "Birth year" field. */
export function birthYearOf(dateOfBirth: unknown): string {
  return typeof dateOfBirth === 'string' && /^\d{4}/.test(dateOfBirth)
    ? dateOfBirth.slice(0, 4)
    : '';
}

/**
 * The date of birth to store for a typed birth year. The current app asks for the year only and
 * writes `YYYY-01-01`; this keeps the month and day already on the account when there are some, so
 * correcting the year never throws away a full date that was entered earlier. An empty year clears
 * it. Throws for anything but a four-digit year between 1920 and ten years ago (the web field's
 * limits).
 */
export function dateOfBirthForYear(
  year: string,
  existing: unknown,
  thisYear = new Date().getFullYear(),
): string | null {
  const text = year.trim();
  if (!text) return null;
  const value = Number(text);
  if (!/^\d{4}$/.test(text) || value < 1920 || value > thisYear - 10)
    throw new Error('Enter a four-digit birth year.');
  const kept =
    typeof existing === 'string' && /^\d{4}-\d{2}-\d{2}/.test(existing)
      ? `${text}${existing.slice(4, 10)}`
      : null;
  return kept && isCalendarDate(kept) ? kept : `${text}-01-01`;
}

/** The profile screen's text value for one field of the stored user. */
export function profileFieldValue(user: Record<string, unknown>, key: string): string {
  if (key === 'birthYear') return birthYearOf(user.dateOfBirth);
  return user[key] == null ? '' : String(user[key]);
}

/**
 * The draft's fields with every key that was not edited here refilled from the server. Walks
 * `keys`, not the draft's own keys: a draft saved before a field existed (Birth year, replacing
 * the full date of birth) has no entry for it, and it must fill rather than stay missing.
 */
export function fillFromServer(
  fields: Record<string, string>,
  dirty: string[],
  user: Record<string, unknown>,
  keys: string[],
): Record<string, string> {
  const next = { ...fields };
  for (const key of keys) if (!dirty.includes(key)) next[key] = profileFieldValue(user, key);
  return next;
}

export function profilePatch(
  fields: Record<string, string>,
  keys: string[],
  existingDateOfBirth?: unknown,
) {
  return profileFields.partial().parse(
    Object.fromEntries(
      // A draft with no `birthYear` key never touched it: leave the stored date of birth alone.
      keys
        .filter((key) => key !== 'birthYear' || 'birthYear' in fields)
        .map((key) =>
        key === 'birthYear'
          ? ['dateOfBirth', dateOfBirthForYear(fields.birthYear ?? '', existingDateOfBirth)]
          : [
              key,
              fields[key]?.trim()
                ? key === 'heightCm'
                  ? Number(fields[key])
                  : fields[key].trim()
                : null,
            ],
      ),
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
