import { toAestDay, formatDayShort } from '@trainingai/shared/date-utils'

/**
 * The APK's publish date, as a short label, or `null` when there isn't one to show.
 *
 * A version number alone cannot answer the question this card exists for — *"does this phone have
 * the native fix from 31 Aug?"* — without a lookup nobody performs. The date is what makes it
 * answerable, and `/api/version` has been returning it as `nativeBuiltAt` all along.
 *
 * Rendered in the USER's timezone, not the device's. `toLocaleDateString` without a `timeZone` is
 * the repo's recurring date bug wearing a different hat: invisible while the phone sits in the zone
 * the data came from, and off by one the moment it does not.
 */
export function formatBuildDate(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return formatDayShort(toAestDay(d, tz))
}
