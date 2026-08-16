import { Capacitor } from '@capacitor/core'
import { todayInTz } from '@trainingai/shared/date-utils'

export const WORKOUT_REMINDERS_CHANNEL = 'workout-reminders'
export const WORKOUT_REMINDER_ROUTE = '/workout'
export const WORKOUT_REMINDER_ID = 8000

const NOTIFIED_TODAY_KEY = 'ta_workout_reminder_notified_today'

export type WorkoutReminderAction =
  | { type: 'cancel' }
  | { type: 'skip' }
  | { type: 'schedule'; at: Date; sessionName: string }
  | { type: 'immediate'; sessionName: string }

export function computeWorkoutReminderAction(
  isTrainingDay: boolean,
  sessionName: string | undefined,
  reminderEnabled: boolean,
  reminderTime: string | null | undefined,
  now: Date = new Date(),
  alreadyNotifiedToday = false,
): WorkoutReminderAction {
  if (!isTrainingDay || !reminderEnabled || !reminderTime || !sessionName) {
    return { type: 'cancel' }
  }

  const [hours, minutes] = reminderTime.split(':').map(Number)
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)

  if (now >= at) {
    if (alreadyNotifiedToday) return { type: 'skip' }
    return { type: 'immediate', sessionName }
  }
  return { type: 'schedule', at, sessionName }
}

function readNotifiedDate(): string | null {
  try {
    return localStorage.getItem(NOTIFIED_TODAY_KEY)
  } catch {
    return null
  }
}

function writeNotifiedDate(date: string): void {
  try {
    localStorage.setItem(NOTIFIED_TODAY_KEY, date)
  } catch {}
}

function clearNotifiedDate(): void {
  try {
    localStorage.removeItem(NOTIFIED_TODAY_KEY)
  } catch {}
}

export async function reconcileWorkoutReminder(
  isTrainingDay: boolean,
  sessionName: string | undefined,
  reminderEnabled: boolean,
  reminderTime: string | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedDate = readNotifiedDate()
    const alreadyNotifiedToday = notifiedDate === today

    const action = computeWorkoutReminderAction(
      isTrainingDay, sessionName, reminderEnabled, reminderTime, now, alreadyNotifiedToday,
    )

    if (action.type === 'cancel') {
      await LocalNotifications.cancel({ notifications: [{ id: WORKOUT_REMINDER_ID }] })
      return
    }
    if (action.type === 'skip') return

    const at = action.type === 'immediate' ? new Date(Date.now() + 2000) : action.at
    await LocalNotifications.schedule({
      notifications: [{
        id: WORKOUT_REMINDER_ID,
        title: "Time to train 💪",
        body: `${action.sessionName} is scheduled for today`,
        schedule: { at },
        channelId: WORKOUT_REMINDERS_CHANNEL,
        extra: { route: WORKOUT_REMINDER_ROUTE },
      }],
    })
    if (action.type === 'immediate') {
      writeNotifiedDate(today)
    }
  } catch {}
}

export async function cancelWorkoutReminder(): Promise<void> {
  clearNotifiedDate()
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: WORKOUT_REMINDER_ID }] })
  } catch {}
}
