import { formatInTimeZone } from 'date-fns-tz';

/**
 * Home's header greeting, in the user's timezone.
 *
 * `now` is injectable because the boundaries are the whole of the logic and a test that reads the
 * real clock can only exercise whichever period CI happens to run in — the trap CLAUDE.md's
 * date-arithmetic rule names: derive the fixture from the clock, or inject the clock.
 */
export function getGreeting(name: string, tz: string, now: Date = new Date()): string {
  const h = parseInt(formatInTimeZone(now, tz, 'H'), 10);
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  return `Good ${period}, ${name}.`;
}
