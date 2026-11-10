import { formatInTimeZone } from 'date-fns-tz'
import { todayInTz } from '@trainingai/shared/date-utils'

/** The hour, local to the user, from which Home offers the Day in review (an end-of-day summary). */
export const DAY_REVIEW_FROM_HOUR = 17

/** Today's dismiss key for the Day in review strip on Home. */
export function dayReviewDismissKey(tz: string): string {
  return `ta_day_review_dismissed_${todayInTz(tz)}`
}

/**
 * Whether Home hides the Day in review: before 17:00 local, or once it was dismissed today. Home
 * calls this on mount and again whenever the app returns to the foreground (#3710), so a Home left
 * resident overnight stops counting yesterday's review in the morning.
 */
export function dayReviewHidden(tz: string, getItem: (key: string) => string | null): boolean {
  const hour = parseInt(formatInTimeZone(new Date(), tz, 'H'), 10)
  return hour < DAY_REVIEW_FROM_HOUR || getItem(dayReviewDismissKey(tz)) === '1'
}
