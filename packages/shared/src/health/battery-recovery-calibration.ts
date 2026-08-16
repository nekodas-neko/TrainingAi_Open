// Body Battery vs how recovered the owner said they felt — a model check, not a user insight.
//
// Q-79, from the 2026-08-05 data-analysis review §2 F3. Measured over production: end-of-day Body
// Battery → perceived recovery r|t = **−0.414, p = 0.010, n = 39**. The sign is correct and worth
// stating, because it looks wrong: `perceivedRecovery` stores **1 = fully recovered … 5 = wrecked**,
// so a higher battery pairing with a LOWER number is agreement.
//
// **Scope: this is a regression check on the model, not a card telling the owner something they
// said themselves.** Bucketed, the gradient the review measured is modest — 3.00 / 3.00 / 2.65 mean
// perceived recovery across battery bands < 40 / 40–60 / > 60. What matters is whether that
// relationship *survives* as the model changes, which is why it lives on the admin surface next to
// the Sleep Score calibration and shares its engine.
import {
  buildModelReportCalibration,
  MIN_PAIRED_FOR_CORRELATION,
  type ModelReportCalibration,
} from '@trainingai/shared/health/model-report-calibration'
import { storedOrderLabels } from '@trainingai/shared/types/day-checkin'

export { MIN_PAIRED_FOR_CORRELATION }

/** Stored 1 = fully recovered … 5 = wrecked. Index 0 holds stored value 1. */
export const RECOVERY_LABELS = storedOrderLabels('perceivedRecovery')

export type BatteryRecoveryCalibration = ModelReportCalibration

export interface BuildBatteryRecoveryCalibrationInput {
  from: string
  to: string
  /** `body_battery_daily.end_value` per date — the persisted model output, never recomputed here. */
  batteryByDate: Map<string, number | null>
  /** Stored `perceived_recovery` (1–5) per morning check-in date. */
  recoveryByDate: Map<string, number | null>
}

/**
 * Join each day's end-of-day Body Battery to that SAME day's morning recovery rating.
 *
 * ⚠ Same date, deliberately, and it is not the pairing that sounds right. The causally appealing
 * version — a day drains you, you report it the next morning — was measured against production and
 * found **nothing**:
 *
 * | pairing | n | r | p |
 * |---|---|---|---|
 * | **same date** | 33 | **−0.390** | **0.018** |
 * | rating the next morning | 33 | +0.115 | 0.52 |
 * | battery of the previous day | 32 | −0.000 | 1.00 |
 *
 * Only same-date reproduces the review's r = −0.400. The likely reason is that both are downstream
 * of the same night: the battery day starts from an overnight-recovery anchor, and the morning
 * rating describes that same night. Do not "fix" this into a lag without re-measuring.
 */
export function buildBatteryRecoveryCalibration(
  { from, to, batteryByDate, recoveryByDate }: BuildBatteryRecoveryCalibrationInput,
): BatteryRecoveryCalibration {
  return buildModelReportCalibration({
    from,
    to,
    modelByDate: batteryByDate,
    ratingByDate: recoveryByDate,
    labels: RECOVERY_LABELS,
    copy: { unit: 'day', unitPlural: 'days' },
  })
}
