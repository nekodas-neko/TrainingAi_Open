import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * The date-stamped "already offered today" marker for the morning check-in.
 *
 * Extracted from `session-select-content.tsx` (BF-86) because that file is a
 * `check-component-size` hotspot whose rule is *extract, do not append* — and because these two
 * functions are the reason the check-in effect is safe to re-run on a day change. The marker holds
 * a `YYYY-MM-DD` in the **user's** timezone, so comparing it against `todayInTz(tz)` answers
 * "has today's prompt been dealt with" and nothing else. Set on save **or** dismiss, so a "not now"
 * does not re-nag all day.
 */
const MORNING_CHECKIN_KEY = 'ta_morning_checkin'

export function isMorningCheckinPromptDone(tz: string): boolean {
  if (typeof window === 'undefined') return true
  try { return localStorage.getItem(MORNING_CHECKIN_KEY) === todayInTz(tz) } catch { return true }
}

export function markMorningCheckinPromptDone(tz: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(MORNING_CHECKIN_KEY, todayInTz(tz)) } catch { /* ignore */ }
}
