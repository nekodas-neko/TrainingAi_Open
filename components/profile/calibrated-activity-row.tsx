'use client'

import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'

/**
 * Issue 2203 — the "Calibrated" entry of the activity-level picker.
 *
 * It shows the factor the energy model is actually using, with its window, read straight from
 * `maintenance.activityFactor` (LB-50). Nothing is computed here. It is deliberately NOT a radio:
 * the calorie baseline is `bmr x 1.2` whatever band is chosen, and the bands only feed the step and
 * water goals, so picking "Calibrated" has nothing to set. Until the calibration clears its gates
 * the row says why instead of showing a guess.
 */
export function CalibratedActivityRow() {
  const data = useEnergyBalanceToday()
  const af = data?.maintenance?.activityFactor
  if (!af) return null

  const calibrated = af.calibrated
  const measured = af.measuredMovement

  return (
    <div
      data-testid="calibrated-activity"
      className="w-full rounded-xl border border-dashed border-border px-3 py-2 min-h-11"
    >
      {calibrated ? (
        <>
          <p className="text-sm font-semibold">Calibrated · {calibrated.factor.toFixed(2)}×</p>
          <p className="text-[10px] text-muted-foreground">
            From your last {calibrated.windowDays} days. The factor your calorie model is using.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Calibrated · not enough data yet</p>
          <p className="text-[10px] text-muted-foreground">
            {af.gapMessage ?? 'Keep logging food and weighing in to calibrate.'}
            {measured ? ` Measured movement so far: ${measured.factor.toFixed(2)}× over ${measured.windowDays} days.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
