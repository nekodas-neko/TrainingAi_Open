import { Capacitor } from '@capacitor/core'
import { todayInTz } from '@trainingai/shared/date-utils'
// Import from the dependency-free thresholds leaf, NOT './health/daytime-stress' — the latter
// pulls in ONNX-backed dHRV imputation, which must not enter the client bundle.
import { STRESS_HIGH_DAY_THRESHOLD_MIN, STRESS_HIGH_LEVEL } from '@trainingai/shared/health/daytime-stress-thresholds'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'

export const HEALTH_ALERTS_CHANNEL = 'health-alerts'
export const HEALTH_ALERT_ROUTE = '/health/readiness'
const NOTIFIED_TODAY_KEY = 'ta_health_alert_notified_today'

// Fixed ids — one per anomaly type (fresh block, clear of the reminders' ranges).
export const HEALTH_ALERT_IDS = { illness: 9300, stress: 9301, readiness: 9302 } as const

export type HealthAlertType = 'illness' | 'stress' | 'readiness'

/** Plain inputs, read from /api/readiness-score + /api/body-battery. No repo, no Capacitor here. */
export interface HealthAlertInput {
  illnessFlag: IllnessFlag | null
  illnessAdvisory: string | null       // reuse the radar's own copy for the body
  readinessLabel: 'High' | 'Moderate' | 'Low' | null
  readinessHasData: boolean            // false → the chip hides itself; don't alert on it
  stressHighMinutes: number | null     // preferred (daytime-stress-wiring); null pre-merge
  stressCurrent: number | null         // fallback: latest bucket level, [-1,+1], neg = stressed
}

export type HealthAlertAction =
  | { alertType: HealthAlertType; type: 'skip' }
  | { alertType: HealthAlertType; type: 'fire'; title: string; body: string }

function illnessCopy(flag: IllnessFlag, advisory: string | null): { title: string; body: string } {
  if (flag === 'fever') {
    return { title: 'Possible fever', body: advisory ?? 'Your skin temperature is well above your baseline. Readiness is lowered — rest and hydrate today.' }
  }
  return { title: 'Recovery signals are off', body: advisory ?? 'Temperature, resting HR and HRV are drifting together against your baseline — your body may be fighting something. Take it easy today.' }
}

/**
 * Decide, per anomaly type, whether to fire a local notification. Pure. `notifiedToday` is the set
 * of types already fired today (dedup). Precedence: readiness-low is suppressed when a more specific
 * illness or stress alert fires the same pass (design decision 5).
 */
export function computeHealthAlertActions(
  input: HealthAlertInput,
  notifiedToday: Set<HealthAlertType> = new Set(),
): HealthAlertAction[] {
  const skip = (alertType: HealthAlertType): HealthAlertAction => ({ alertType, type: 'skip' })
  const fire = (alertType: HealthAlertType, title: string, body: string): HealthAlertAction =>
    notifiedToday.has(alertType) ? skip(alertType) : { alertType, type: 'fire', title, body }

  // ── Illness: elevated/fever only (watch is advisory-only) ──
  const illnessTriggered = input.illnessFlag === 'elevated' || input.illnessFlag === 'fever'
  const illness = illnessTriggered
    ? (() => { const c = illnessCopy(input.illnessFlag as IllnessFlag, input.illnessAdvisory); return fire('illness', c.title, c.body) })()
    : skip('illness')

  // ── Stress: prefer highMinutes vs the shared deload threshold, else fall back to current level ──
  const stressTriggered = input.stressHighMinutes != null
    ? input.stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN
    : input.stressCurrent != null
      ? input.stressCurrent <= STRESS_HIGH_LEVEL
      : false
  const stress = stressTriggered
    ? fire('stress', 'High stress day', 'Daytime stress has run high today. A lighter session or some recovery time may help.')
    : skip('stress')

  // ── Readiness-low: standalone only — suppressed if illness or stress fired this pass ──
  const moreSpecificFired = illness.type === 'fire' || stress.type === 'fire'
  const readinessTriggered = input.readinessHasData && input.readinessLabel === 'Low' && !moreSpecificFired
  const readiness = readinessTriggered
    ? fire('readiness', 'Readiness is low', 'Your readiness is Low today. Consider a lighter session, a deload, or a rest day.')
    : skip('readiness')

  return [illness, stress, readiness]
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

/** Native-only. Reads the dedup map, computes actions, fires immediate notifications, records fires. */
export async function reconcileHealthAlerts(input: HealthAlertInput): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedMap = readNotifiedToday()
    const notifiedToday = new Set(
      Object.entries(notifiedMap).filter(([, date]) => date === today).map(([type]) => type as HealthAlertType),
    )
    const actions = computeHealthAlertActions(input, notifiedToday)

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
      notifiedMap[action.alertType] = today
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}
