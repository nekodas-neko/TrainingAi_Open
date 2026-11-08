import { Capacitor } from '@capacitor/core'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import {
  DAY_REVIEW_TEXT,
  FALLBACK_BEDTIME,
  WEEKLY_RECAP_TEXT,
  dayReviewReminderAt,
  weeklyRecapReminderAt,
} from '@trainingai/shared/reminders/daily-reminders'
import { localDayInTz } from '@/lib/reminders/local-instant'

export const DAY_REVIEW_CHANNEL = 'day-review-reminders'

const EVENING_REMINDER_ID = 9300
const EVENING_REMINDER_KEY = 'ta_evening_reminder_date'
const WEEKLY_RECAP_REMINDER_ID = 9301
const WEEKLY_RECAP_REMINDER_KEY = 'ta_weekly_recap_reminder_sunday'

export type ReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date }

/**
 * The wind-down reminder, 50 minutes before bedtime on `today`. The instant and the words are
 * shared with TrainingAi Preview (#3653), and it is the user's wall clock in `tz`, not the phone's
 * (LB-148): this was the last reminder still built with `setHours`.
 */
export function computeEveningReminderAction(
  bedtimeHour: number,
  bedtimeMinute: number,
  now: Date,
  today: string,
  lastScheduledDate: string | null,
  tz: string = DEFAULT_TZ,
): ReminderAction {
  if (lastScheduledDate === today) return { type: 'skip' }
  const at = dayReviewReminderAt(today, { bedtimeHour, bedtimeMinute }, tz)
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at }
}

export type WeeklyRecapReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date; sundayIso: string }

/** Sunday 18:00 in `tz`, this week's (today's, if today is Sunday and it is not yet 18:00). */
export function computeWeeklyRecapReminderAction(
  now: Date,
  lastScheduledSunday: string | null,
  tz: string = DEFAULT_TZ,
): WeeklyRecapReminderAction {
  const { sunday: sundayIso, at } = weeklyRecapReminderAt(localDayInTz(now, tz), tz)
  if (lastScheduledSunday === sundayIso) return { type: 'skip' }
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at, sundayIso }
}

export async function scheduleEveningReminder(tz: string = DEFAULT_TZ): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz(tz)
    const lastScheduled = localStorage.getItem(EVENING_REMINDER_KEY)

    let { bedtimeHour, bedtimeMinute } = FALLBACK_BEDTIME
    try {
      const res = await fetch('/api/user/bedtime-estimate')
      if (res.ok) {
        const data = await res.json()
        if (typeof data.bedtimeHour === 'number') bedtimeHour = data.bedtimeHour
        if (typeof data.bedtimeMinute === 'number') bedtimeMinute = data.bedtimeMinute
      }
    } catch { /* use fallback */ }

    const action = computeEveningReminderAction(bedtimeHour, bedtimeMinute, new Date(), today, lastScheduled, tz)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: EVENING_REMINDER_ID,
        ...DAY_REVIEW_TEXT,
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        // Q-112a: the review itself, not the screen that used to hold a banner linking to it.
        extra: { route: '/nutrition?review=day' },
      }],
    })
    localStorage.setItem(EVENING_REMINDER_KEY, today)
  } catch {}
}

export async function scheduleWeeklyRecapReminder(tz: string = DEFAULT_TZ): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const lastScheduled = localStorage.getItem(WEEKLY_RECAP_REMINDER_KEY)
    const action = computeWeeklyRecapReminderAction(new Date(), lastScheduled, tz)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: WEEKLY_RECAP_REMINDER_ID,
        ...WEEKLY_RECAP_TEXT,
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        // The recap is its own page now (BF-5), so the notification lands ON it rather than on Home
        // with a param that opens a banner. No query: `/api/weekly-digest` computes the recap week
        // itself and takes no week, so there is nothing for one to say.
        extra: { route: '/health/week' },
      }],
    })
    localStorage.setItem(WEEKLY_RECAP_REMINDER_KEY, action.sundayIso)
  } catch {}
}
