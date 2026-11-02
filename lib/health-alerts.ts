import { Capacitor } from '@capacitor/core'
import { todayInTz } from '@trainingai/shared/date-utils'
import {
  HEALTH_ALERTS_CHANNEL,
  HEALTH_ALERT_IDS,
  HEALTH_ALERT_ROUTE,
  computeHealthAlertActions,
  firedToday,
  recordFired,
  type HealthAlertInput,
} from '@trainingai/shared/health/health-alerts'

// The decision (thresholds, copy, once-per-type-per-day) lives in packages/shared so TrainingAi
// Preview uses the same copy. Re-exported so existing imports keep working.
export {
  HEALTH_ALERTS_CHANNEL,
  HEALTH_ALERT_IDS,
  HEALTH_ALERT_ROUTE,
  computeHealthAlertActions,
  type HealthAlertAction,
  type HealthAlertInput,
  type HealthAlertType,
} from '@trainingai/shared/health/health-alerts'

const NOTIFIED_TODAY_KEY = 'ta_health_alert_notified_today'

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

/** Native-only. Reads the dedup map, computes actions, fires immediate notifications, records fires. */
export async function reconcileHealthAlerts(input: HealthAlertInput): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedMap: Record<string, string> = { ...readNotifiedToday() }
    const actions = computeHealthAlertActions(input, firedToday(notifiedMap, today))

    for (const action of actions) {
      if (action.type === 'skip') continue
      await LocalNotifications.schedule({
        notifications: [{
          id: HEALTH_ALERT_IDS[action.alertType],
          title: action.title,
          body: action.body,
          schedule: { at: new Date(Date.now() + 2000) },
          channelId: HEALTH_ALERTS_CHANNEL,
          extra: { route: HEALTH_ALERT_ROUTE },
        }],
      })
      Object.assign(notifiedMap, recordFired(notifiedMap, [action], today))
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}
