import { formatInTimeZone } from 'date-fns-tz';

/**
 * Home's header greeting, in the user's timezone. Shared by the current app and Preview so the two
 * cannot drift (#2904: Preview greeted by the sign-in name and cut it to a first word).
 *
 * `now` is injectable because the boundaries are the whole of the logic and a test that reads the
 * real clock can only exercise whichever period CI happens to run in.
 */
export function getGreeting(name: string, tz: string, now: Date = new Date()): string {
  const h = parseInt(formatInTimeZone(now, tz, 'H'), 10);
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  return `Good ${period}, ${name}.`;
}

/** The name to show for a profile user: the one edited in Profile, else the sign-in name. */
export function profileDisplayName(
  user: { displayName?: string | null; name?: string | null } | null | undefined,
): string | null {
  return user?.displayName ?? user?.name ?? null;
}

/** The Home heading for a profile user; the app name until a profile has loaded. */
export function homeGreeting(
  user: { displayName?: string | null; name?: string | null } | null | undefined,
  tz: string,
  now: Date = new Date(),
): string {
  const name = profileDisplayName(user)?.trim();
  return name ? getGreeting(name, tz, now) : 'TrainingAI';
}
