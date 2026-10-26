import { z } from 'zod';
import { toAestDay, daysBetweenDateStrs, formatDateDisplay } from '@trainingai/shared/date-utils';
import { ApiError } from '../../account/api/client';
import type { AccountConnection } from '../../account/session';

// Signed-in devices (#3280): the devices holding a sign-in to this account, and signing another
// one out. The server owns the list; this app shows it and asks for a revoke.
const deviceSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  signedInAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
});
const listSchema = z.object({ devices: z.array(deviceSchema) });
export type SignedInDevice = z.infer<typeof deviceSchema>;

export async function readSignedInDevices(connection: AccountConnection): Promise<SignedInDevice[]> {
  return listSchema.parse(await connection.get('/api/auth/native-session/devices')).devices;
}

/** Signs another device out on its next request. This device is refused by the server. */
export async function revokeSignedInDevice(connection: AccountConnection, id: string) {
  await connection.post('/api/auth/native-session/devices/revoke', { id });
}

const STATUSES: Record<number, string> = {
  401: 'Sign in again, then try once more.',
  404: 'That device is already signed out.',
  409: 'To sign out of this device, use Sign out in Account.',
  429: 'Too many attempts. Wait a minute and try again.',
};
export function devicesMessage(error: unknown) {
  if (error instanceof ApiError)
    return Object.hasOwn(STATUSES, error.status)
      ? STATUSES[error.status]
      : 'TrainingAi could not do that right now. Try again.';
  return 'TrainingAi could not be reached. Check your connection and try again.';
}

/** "Signed in 6 Oct" — the calendar day in the user's timezone. */
export function signedInLabel(iso: string, tz: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'Signed in' : `Signed in ${formatDateDisplay(toAestDay(at, tz))}`;
}

/** "Last used just now" · "2 days ago" · "3 weeks ago". Days are calendar days in `tz`. */
export function lastUsedLabel(iso: string, now: Date, tz: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Last used unknown';
  if (now.getTime() - at.getTime() < 10 * 60 * 1000) return 'Last used just now';
  const days = daysBetweenDateStrs(toAestDay(at, tz), toAestDay(now, tz));
  if (days <= 0) return 'Last used today';
  if (days === 1) return 'Last used yesterday';
  if (days < 14) return `Last used ${days} days ago`;
  if (days < 60) return `Last used ${Math.floor(days / 7)} weeks ago`;
  return `Last used ${formatDateDisplay(toAestDay(at, tz))}`;
}
