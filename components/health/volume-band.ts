import { volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'

/**
 * Where a week's set count sits against the muscle's own landmarks (Q-305).
 *
 * `MUSCLE_LANDMARKS` has carried MEV/MAV/MRV per muscle since the periodization work, and the card
 * that shows weekly sets never used them — it coloured every muscle against a hardcoded generic
 * **10–20** band. So the app has been computing the right thresholds and rendering the wrong ones.
 *
 * **The goal multiplier is the part that makes the difference material.** `volumeLandmarks` scales
 * the table by the program's training goal, and the owner's `powerbuilding` program scales it by
 * **×0.8**. Q-305's own first pass compared against the unscaled hypertrophy row and concluded lats
 * and upper back were below MEV; against the table the app actually uses, both are **in range** and
 * three other muscles are over MRV. Reading the wrong row inverted the finding, which is precisely
 * what a surface built on a generic 10–20 band does every week.
 *
 * **The band's word is returned with its colour on purpose.** A bar coloured red for "under" and
 * red for "over" is the colour-only-state failure the repo's rules name outright — and here the two
 * reds mean opposite things and need opposite responses.
 */

export type VolumeBand = 'under' | 'in' | 'high' | 'over'

export interface VolumeVerdict {
  band: VolumeBand
  /** Rendered beside the number, never colour alone. */
  label: string
  color: string
  mev: number
  mav: number
  mrv: number
}

const BANDS: Record<VolumeBand, { label: string; color: string }> = {
  under: { label: 'below MEV', color: '#ef4444' },
  in:    { label: 'in range',  color: '#22c55e' },
  high:  { label: 'above MAV', color: '#f59e0b' },
  over:  { label: 'above MRV', color: '#ef4444' },
}

export function volumeVerdict(trainingGoal: string, muscle: string, sets: number): VolumeVerdict {
  const { mev, mav, mrv } = volumeLandmarks(trainingGoal, muscle)
  // Ordered high-to-low so a landmark table where two thresholds coincide still resolves.
  const band: VolumeBand = sets > mrv ? 'over' : sets > mav ? 'high' : sets >= mev ? 'in' : 'under'
  return { band, ...BANDS[band], mev, mav, mrv }
}
