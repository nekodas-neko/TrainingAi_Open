import { Capacitor } from '@capacitor/core'
import type { SupplementWithStatus } from '@trainingai/shared/types/supplement'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { localDayInTz } from '@/lib/reminders/local-instant'
import {
  supplementReminderAt,
  supplementReminderDue,
  supplementReminderText,
} from '@trainingai/shared/reminders/daily-reminders'

export const SUPPLEMENT_REMINDERS_CHANNEL = 'supplement-reminders'
export const SUPPLEMENT_REMINDER_ROUTE = '/nutrition'

const ID_BASE = 8500
const ID_RANGE = 200
const NOTIFIED_TODAY_KEY = 'ta_supplement_reminder_notified_today'

export function supplementReminderNotificationId(supplementId: string): number {
  let hash = 0
  for (let i = 0; i < supplementId.length; i++) {
    hash = (hash * 31 + supplementId.charCodeAt(i)) | 0
  }
  return ID_BASE + (Math.abs(hash) % ID_RANGE)
}

export type SupplementReminderAction =
  | { supplementId: string; type: 'cancel' }
  | { supplementId: string; type: 'skip' }
  | { supplementId: string; type: 'immediate'; name: string }
  | { supplementId: string; type: 'scheduled'; at: Date; name: string }

export function computeSupplementReminderActions(
  supplements: SupplementWithStatus[],
  now: Date = new Date(),
  notifiedToday: Set<string> = new Set(),
  tz: string = DEFAULT_TZ,
): SupplementReminderAction[] {
  return supplements.map((s): SupplementReminderAction => {
    const supplementId = s.id

    // The rule and the instant are shared with TrainingAi Preview (#3653); the instant is the
    // user's wall clock, not the phone's (LB-148).
    const reminderAt = supplementReminderDue(s)
      ? supplementReminderAt(localDayInTz(now, tz), s.reminderTime, tz)
      : null
    if (!reminderAt) {
      return { supplementId, type: 'cancel' }
    }

    if (now >= reminderAt) {
      if (notifiedToday.has(supplementId)) {
        return { supplementId, type: 'skip' }
      }
      return { supplementId, type: 'immediate', name: s.name }
    }

    return { supplementId, type: 'scheduled', at: reminderAt, name: s.name }
  })
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

export async function reconcileSupplementReminders(
  supplements: SupplementWithStatus[],
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = localDayInTz(now, tz)
    const notifiedMap = readNotifiedToday()
    const notifiedToday = new Set(
      Object.entries(notifiedMap).filter(([, date]) => date === today).map(([id]) => id),
    )
    const actions = computeSupplementReminderActions(supplements, now, notifiedToday, tz)

    for (const action of actions) {
      const id = supplementReminderNotificationId(action.supplementId)
      if (action.type === 'skip') continue
      if (action.type === 'cancel') {
        await LocalNotifications.cancel({ notifications: [{ id }] })
        delete notifiedMap[action.supplementId]
        continue
      }
      const at = action.type === 'immediate' ? new Date(Date.now() + 2000) : action.at
      await LocalNotifications.schedule({
        notifications: [{
          id,
          ...supplementReminderText(action.name),
          schedule: { at },
          channelId: SUPPLEMENT_REMINDERS_CHANNEL,
          extra: { route: SUPPLEMENT_REMINDER_ROUTE },
        }],
      })
      if (action.type === 'immediate') {
        notifiedMap[action.supplementId] = today
      }
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}

export async function cancelSupplementReminder(supplementId: string): Promise<void> {
  const map = readNotifiedToday()
  if (supplementId in map) {
    delete map[supplementId]
    writeNotifiedToday(map)
  }
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: supplementReminderNotificationId(supplementId) }] })
  } catch {}
}
