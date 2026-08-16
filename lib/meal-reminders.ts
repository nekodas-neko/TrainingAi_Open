import { Capacitor } from '@capacitor/core'
import type { MealType, FoodLog } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'

export const MEAL_REMINDERS_CHANNEL = 'meal-reminders'
export const MEAL_REMINDER_ROUTE = '/nutrition'

const ID_BASE = 9200
const ID_RANGE = 800
const NOTIFIED_TODAY_KEY = 'ta_meal_reminder_notified_today'

export function mealReminderNotificationId(mealTypeId: string): number {
  let hash = 0
  for (let i = 0; i < mealTypeId.length; i++) {
    hash = (hash * 31 + mealTypeId.charCodeAt(i)) | 0
  }
  return ID_BASE + (Math.abs(hash) % ID_RANGE)
}

export type MealReminderAction =
  | { mealTypeId: string; type: 'cancel' }
  | { mealTypeId: string; type: 'skip' }
  | { mealTypeId: string; type: 'immediate'; emoji: string; name: string }
  | { mealTypeId: string; type: 'scheduled'; at: Date; emoji: string; name: string }

export function computeMealReminderActions(
  mealTypes: MealType[],
  foodLogs: Pick<FoodLog, 'mealTypeId'>[],
  now: Date = new Date(),
  notifiedToday: Set<string> = new Set(),
): MealReminderAction[] {
  const loggedIds = new Set(foodLogs.map(l => l.mealTypeId))

  return mealTypes.map((mt): MealReminderAction => {
    if (!mt.remindersEnabled || loggedIds.has(mt.id)) {
      return { mealTypeId: mt.id, type: 'cancel' }
    }

    const endHour = mt.timeEndHour >= 24 ? 23 : mt.timeEndHour
    const endMinute = mt.timeEndHour >= 24 ? 59 : 0
    const endTime = new Date(now)
    endTime.setHours(endHour, endMinute, 0, 0)

    if (now >= endTime) {
      // Already sent the one-time catch-up notification for this meal today —
      // don't keep rescheduling it on every app open/resume.
      if (notifiedToday.has(mt.id)) {
        return { mealTypeId: mt.id, type: 'skip' }
      }
      return { mealTypeId: mt.id, type: 'immediate', emoji: mt.emoji, name: mt.name }
    }
    return { mealTypeId: mt.id, type: 'scheduled', at: endTime, emoji: mt.emoji, name: mt.name }
  })
}

function reminderBody(emoji: string, name: string): string {
  return `Don't forget to log ${emoji} ${name}!`
}

function readNotifiedToday(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_TODAY_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeNotifiedToday(map: Record<string, string>): void {
  try {
    localStorage.setItem(NOTIFIED_TODAY_KEY, JSON.stringify(map))
  } catch {}
}

function clearNotifiedToday(mealTypeId: string): void {
  const map = readNotifiedToday()
  if (!(mealTypeId in map)) return
  delete map[mealTypeId]
  writeNotifiedToday(map)
}

export async function reconcileMealReminders(
  mealTypes: MealType[],
  foodLogs: Pick<FoodLog, 'mealTypeId'>[],
  now: Date = new Date(),
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedMap = readNotifiedToday()
    const notifiedToday = new Set(
      Object.entries(notifiedMap).filter(([, date]) => date === today).map(([mealTypeId]) => mealTypeId),
    )
    const actions = computeMealReminderActions(mealTypes, foodLogs, now, notifiedToday)

    for (const action of actions) {
      const id = mealReminderNotificationId(action.mealTypeId)
      if (action.type === 'skip') continue
      if (action.type === 'cancel') {
        await LocalNotifications.cancel({ notifications: [{ id }] })
        delete notifiedMap[action.mealTypeId]
        continue
      }
      const at = action.type === 'immediate' ? new Date(Date.now() + 2000) : action.at
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: 'Meal reminder',
          body: reminderBody(action.emoji, action.name),
          schedule: { at },
          channelId: MEAL_REMINDERS_CHANNEL,
          extra: { route: MEAL_REMINDER_ROUTE },
        }],
      })
      if (action.type === 'immediate') {
        notifiedMap[action.mealTypeId] = today
      }
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}

export async function cancelMealReminder(mealTypeId: string): Promise<void> {
  clearNotifiedToday(mealTypeId)
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: mealReminderNotificationId(mealTypeId) }] })
  } catch {}
}

const EOD_REMINDER_ID = 9100
const EOD_REMINDER_KEY = 'ta_eod_reminder_date'

export async function scheduleEndOfDayReminder(
  mealTypes: MealType[],
  foodLogs: Pick<FoodLog, 'mealTypeId'>[],
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const loggedIds = new Set(foodLogs.map(l => l.mealTypeId))
    const hasUnloggedRequired = mealTypes.some(mt => mt.required && !loggedIds.has(mt.id))

    if (!hasUnloggedRequired) {
      await LocalNotifications.cancel({ notifications: [{ id: EOD_REMINDER_ID }] })
      return
    }

    const today = todayInTz()
    const lastScheduled = localStorage.getItem(EOD_REMINDER_KEY)
    if (lastScheduled === today) return

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

    const at = new Date()
    at.setHours(bedtimeHour, bedtimeMinute, 0, 0)
    at.setMinutes(at.getMinutes() - 30)
    // If that time has already passed today, don't schedule
    if (at <= new Date()) return

    await LocalNotifications.schedule({
      notifications: [{
        id: EOD_REMINDER_ID,
        title: 'Log your meals before bed',
        body: "You have unlogged required meals today. Tap to backfill.",
        schedule: { at },
        channelId: MEAL_REMINDERS_CHANNEL,
        extra: { route: '/nutrition?chat=backfill' },
      }],
    })
    localStorage.setItem(EOD_REMINDER_KEY, today)
  } catch {}
}

export async function cancelAllMealReminders(mealTypeIds: string[]): Promise<void> {
  for (const mealTypeId of mealTypeIds) clearNotifiedToday(mealTypeId)
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({
      notifications: mealTypeIds.map(id => ({ id: mealReminderNotificationId(id) })),
    })
  } catch {}
}
