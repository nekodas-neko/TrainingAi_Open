import { storedOrderLabels } from '@trainingai/shared/types/day-checkin'

export interface MorningSleepFeel {
  /** The stored 1–5, where **1 is the best night**. Kept as stored so nothing re-derives it. */
  stored: number
  /** 1–5 with 5 best — the screen's direction, `6 − stored`, and what the dots count. */
  position: number
  /** 'Great' … 'Terrible', taken from the check-in's own labels rather than reworded here. */
  label: string
}

/**
 * The stored 1–5 → what the line shows. Exported and pure so the inversion can be tested by CALLING
 * it: this is the one place a mistake turns a great night into "Terrible" on his Home screen, and a
 * source-matching guard cannot tell the two directions apart.
 *
 * ⚠ **The stored scale is INVERTED and the label array is not.** `sleepQualityFeel` is stored
 * 1 = slept great … 5 = terrible, while `MORNING_SCALES.labels` is `['Terrible' … 'Great']` in
 * *screen* order because the selector maps position `p` to `6 − p`. `storedOrderLabels` is the repo's
 * own reverse of that, indexed by stored value. Do not re-derive either direction here.
 */
export function sleepFeelFromStored(stored: number | null | undefined): MorningSleepFeel | null {
  if (stored == null || !Number.isInteger(stored) || stored < 1 || stored > 5) return null
  return {
    stored,
    position: 6 - stored,
    label: storedOrderLabels('sleepQualityFeel')[stored - 1],
  }
}
