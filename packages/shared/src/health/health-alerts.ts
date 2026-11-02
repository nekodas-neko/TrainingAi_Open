// Health anomaly alerts (illness / high stress / low readiness): the decision half, shared by the
// Capacitor app and TrainingAi Preview so the thresholds and the once-per-type-per-day rule live
// once. No Capacitor, no Expo, no storage: each app supplies its own notifier and its own record
// of what already fired.
import { STRESS_HIGH_LEVEL } from './daytime-stress-thresholds'
import type { IllnessFlag } from './illness-radar'

export const HEALTH_ALERTS_CHANNEL = 'health-alerts'
export const HEALTH_ALERT_ROUTE = '/health/readiness'

// Fixed ids — one per anomaly type (fresh block, clear of the reminders' ranges).
export const HEALTH_ALERT_IDS = { illness: 9300, stress: 9301, readiness: 9302 } as const

export type HealthAlertType = 'illness' | 'stress' | 'readiness'

/** Plain inputs, read from /api/readiness-score + /api/body-battery. */
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

/** The slice of the two responses the alerts read; both apps' parsed responses satisfy it. */
export interface HealthAlertSources {
  readiness?: {
    illnessFlag?: string | null
    illnessAdvisory?: string | null
    label?: string | null
    hasSufficientData?: boolean | null
  } | null
  battery?: { stress?: { highMinutes?: number | null; current?: number | null } | null } | null
}

const ILLNESS_FLAGS: readonly string[] = ['learning', 'normal', 'watch', 'elevated', 'fever']
const READINESS_LABELS: readonly string[] = ['High', 'Moderate', 'Low']

/** Maps the two responses to the plain input. A value outside the known set reads as absent. */
export function healthAlertInput({ readiness, battery }: HealthAlertSources): HealthAlertInput {
  const flag = readiness?.illnessFlag
  const label = readiness?.label
  return {
    illnessFlag: flag != null && ILLNESS_FLAGS.includes(flag) ? (flag as IllnessFlag) : null,
    illnessAdvisory: readiness?.illnessAdvisory ?? null,
    readinessLabel: label != null && READINESS_LABELS.includes(label) ? (label as HealthAlertInput['readinessLabel']) : null,
    readinessHasData: readiness?.hasSufficientData ?? false,
    stressHighMinutes: battery?.stress?.highMinutes ?? null,
    stressCurrent: battery?.stress?.current ?? null,
  }
}

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

  // ── Stress: the CURRENT level only. ──
  // TN-34 unwired the daily `stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN` arm from the deload
  // recommendation; this was the same condition on the same input, so it is unwired here too — the
  // sibling-surface rule, and it matters more here than there. This path fires a PUSH NOTIFICATION
  // ("High stress day"), so at TN-34's measured 83% of days the owner was notified four days in five
  // off a number with a +0.072 correlation to readiness. Worse, a fired stress alert sets
  // `moreSpecificFired` and SUPPRESSES the readiness-low alert below — so the noise flag was also
  // masking the real one.
  //
  // `stressCurrent` is kept deliberately: TN-33 §8 measures strong episode structure in the SERIES
  // (lag-1 +0.637, residual +0.372 after removing day/night means). It is the daily aggregate that
  // carries no signal, not the instantaneous level.
  const stressTriggered = input.stressCurrent != null
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

/** type → local day it last fired. An app keeps this map wherever it keeps small local state. */
export type HealthAlertFiredMap = Partial<Record<HealthAlertType, string>>

const TYPES: readonly HealthAlertType[] = ['illness', 'stress', 'readiness']

/** The types already fired on `today` (the user's local day). Any other day's entry is stale. */
export function firedToday(map: Record<string, unknown> | null | undefined, today: string): Set<HealthAlertType> {
  return new Set(TYPES.filter(type => map?.[type] === today))
}

/** The map after `actions` fired on `today`. Other types keep their entry; nothing mutates `map`. */
export function recordFired(
  map: Record<string, unknown> | null | undefined,
  actions: HealthAlertAction[],
  today: string,
): HealthAlertFiredMap {
  const next: HealthAlertFiredMap = {}
  for (const type of TYPES) if (typeof map?.[type] === 'string') next[type] = map[type] as string
  for (const action of actions) if (action.type === 'fire') next[action.alertType] = today
  return next
}
