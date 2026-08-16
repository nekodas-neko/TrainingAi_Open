import { Capacitor } from '@capacitor/core'
import { todayInTz } from '@trainingai/shared/date-utils'

export const DAY_REVIEW_CHANNEL = 'day-review-reminders'

const EVENING_REMINDER_ID = 9300
const EVENING_REMINDER_KEY = 'ta_evening_reminder_date'
const WEEKLY_RECAP_REMINDER_ID = 9301
const WEEKLY_RECAP_REMINDER_KEY = 'ta_weekly_recap_reminder_sunday'
const MINUTES_BEFORE_BEDTIME = 50

export type ReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date }

export function computeEveningReminderAction(
  bedtimeHour: number,
  bedtimeMinute: number,
  now: Date,
  today: string,
  lastScheduledDate: string | null,
): ReminderAction {
  if (lastScheduledDate === today) return { type: 'skip' }
  const at = new Date(now)
  at.setHours(bedtimeHour, bedtimeMinute, 0, 0)
  at.setMinutes(at.getMinutes() - MINUTES_BEFORE_BEDTIME)
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at }
}

export type WeeklyRecapReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date; sundayIso: string }

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function computeWeeklyRecapReminderAction(
  now: Date,
  lastScheduledSunday: string | null,
): WeeklyRecapReminderAction {
  const at = new Date(now)
  const daysUntilSunday = (7 - at.getDay()) % 7 // Date#getDay(): 0=Sun..6=Sat
  at.setDate(at.getDate() + daysUntilSunday)
  at.setHours(18, 0, 0, 0)
  const sundayIso = formatLocalDate(at)
  if (lastScheduledSunday === sundayIso) return { type: 'skip' }
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at, sundayIso }
}

export async function scheduleEveningReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const lastScheduled = localStorage.getItem(EVENING_REMINDER_KEY)

    let bedtimeHour = 22
    let bedtimeMinute = 0
    try {
      const res = await fetch('/api/user/bedtime-estimate')
      if (res.ok) {
        const data = await res.json()
        if (typeof data.bedtimeHour === 'number') bedtimeHour = data.bedtimeHour
        if (typeof data.bedtimeMinute === 'number') bedtimeMinute = data.bedtimeMinute
      }
    } catch { /* use fallback */ }

    const action = computeEveningReminderAction(bedtimeHour, bedtimeMinute, new Date(), today, lastScheduled)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: EVENING_REMINDER_ID,
        title: 'Bedtime approaching',
        body: 'Begin your wind-down and complete your end-of-day review.',
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        extra: { route: '/' },
      }],
    })
    localStorage.setItem(EVENING_REMINDER_KEY, today)
  } catch {}
}

export async function scheduleWeeklyRecapReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const lastScheduled = localStorage.getItem(WEEKLY_RECAP_REMINDER_KEY)
    const action = computeWeeklyRecapReminderAction(new Date(), lastScheduled)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: WEEKLY_RECAP_REMINDER_ID,
        title: 'Your week in review is ready',
        body: 'See how your week went and what to focus on next.',
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        extra: { route: '/' },
      }],
    })
    localStorage.setItem(WEEKLY_RECAP_REMINDER_KEY, action.sundayIso)
  } catch {}
}
