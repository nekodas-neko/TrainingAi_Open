import type { ZoneTarget } from '@trainingai/shared/running/zone-targets'
import type { HrZone } from '@trainingai/shared/health/hr-zones'

// Per-zone weekly quota = the framework's target minus what's already been accumulated.
// Pure: the caller supplies targets (weeklyZoneTargets) and actuals (getZoneMinutesRange).
//
// Zone 1 is deliberately EXCLUDED from the `training*` totals (spec D-10): it fills from
// ordinary daily movement, so counting it would imply the training week is done when it isn't.
// It is still returned per-zone so the UI can show it complete-but-excluded.

export type ZoneQuotaStatus = 'open' | 'complete' | 'not-required'

export interface ZoneQuotaRow {
  zoneId: HrZone['id']
  targetMin: number
  doneMin: number
  remainingMin: number
  /** 0-100, capped — never over 100 even when the target is exceeded. */
  pctComplete: number
  status: ZoneQuotaStatus
}

export interface ZoneQuota {
  zones: ZoneQuotaRow[]
  /** Totals across the deliberate-training zones only (Z2-Z5); Z1 excluded. */
  trainingTargetMin: number
  trainingDoneMin: number
  trainingRemainingMin: number
}

/** The zone below which time accrues from ordinary daily movement rather than training. */
const PASSIVE_ZONE_ID = 1

export function computeZoneQuota(
  targets: readonly ZoneTarget[],
  days: readonly { seconds: readonly [number, number, number, number, number] }[],
): ZoneQuota {
  const doneSec = [0, 0, 0, 0, 0]
  for (const d of days) {
    for (let i = 0; i < 5; i++) doneSec[i] += d.seconds[i] ?? 0
  }

  const zones: ZoneQuotaRow[] = targets.map((t) => {
    const targetMin = Math.round(t.minutes)
    const doneMin = Math.round(doneSec[t.zoneId - 1] / 60)
    const remainingMin = Math.max(0, targetMin - doneMin)
    const pctComplete = targetMin > 0 ? Math.min(100, Math.round((doneMin / targetMin) * 100)) : 0
    const status: ZoneQuotaStatus =
      targetMin === 0 ? 'not-required' : remainingMin === 0 ? 'complete' : 'open'
    return { zoneId: t.zoneId, targetMin, doneMin, remainingMin, pctComplete, status }
  })

  const training = zones.filter((z) => z.zoneId !== PASSIVE_ZONE_ID)
  return {
    zones,
    trainingTargetMin: training.reduce((s, z) => s + z.targetMin, 0),
    trainingDoneMin: training.reduce((s, z) => s + z.doneMin, 0),
    trainingRemainingMin: training.reduce((s, z) => s + z.remainingMin, 0),
  }
}

/** The inclusive local-date window for "this week so far". Callers pass `todayInTz(tz)` and
 *  `startOfWeekInTz(tz)` — this never derives dates itself, so there is no second timezone basis.
 *  A stale/future weekStart (weekStart after today) collapses the whole window to today rather
 *  than just clamping the end, since a week can't validly start after it's over. */
export function weekWindow(todayIso: string, weekStartIso: string): { from: string; to: string } {
  if (todayIso < weekStartIso) return { from: todayIso, to: todayIso }
  return { from: weekStartIso, to: todayIso }
}
