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
  under: { label: 'below MEV', color: 'var(--destructive)' },
  in:    { label: 'in range',  color: 'var(--accent-green)' },
  high:  { label: 'above MAV', color: 'var(--accent-amber)' },
  over:  { label: 'above MRV', color: 'var(--destructive)' },
}

export function volumeVerdict(trainingGoal: string, muscle: string, sets: number): VolumeVerdict {
  const { mev, mav, mrv } = volumeLandmarks(trainingGoal, muscle)
  // Ordered high-to-low so a landmark table where two thresholds coincide still resolves.
  const band: VolumeBand = sets > mrv ? 'over' : sets > mav ? 'high' : sets >= mev ? 'in' : 'under'
  return { band, ...BANDS[band], mev, mav, mrv }
}

// ---- Weekly sets against a target: the one colour rule (#2554) ----
//
// The bars under "Muscle volume this week" and the body map above them used to run two rules for
// one number: the bars went green / amber / red by share of target, the map shaded every trained
// muscle green from dark to light. A muscle at 4 of 13 sets read red below and green above.
// Both now read this, so the map cannot disagree with the bars again.

/** The generic band's target when nothing supplies one — its 10-set minimum. */
export const GENERIC_TARGET = 10
/** Sets at which the generic band (no target, no goal) turns blue — well past the minimum. */
const GENERIC_HIGH = 15

export type TargetBand = 'untrained' | 'under' | 'approaching' | 'at'

/** Which side of its target a week's sets fall. Integer arithmetic (`sets * 5` vs `target * 3`) so
 *  exactly 60% is not at the mercy of `13 * 0.6` landing on 7.800000000000001. */
export function targetBand(sets: number, target: number): TargetBand {
  if (!(sets > 0)) return 'untrained'
  if (sets >= target) return 'at'
  if (sets * 5 >= target * 3) return 'approaching'
  return 'under'
}

const TARGET_BAND_COLOR: Record<TargetBand, string> = {
  at: 'var(--accent-green)',
  approaching: 'var(--accent-amber)',
  under: 'var(--destructive)',
  untrained: 'var(--muted-foreground)',
}

export function targetBandColor(sets: number, target: number): string {
  return TARGET_BAND_COLOR[targetBand(sets, target)]
}

/** The colour of one muscle's bar and its patch on the body map. A program target wins; then the
 *  goal-scaled landmark verdict; then the generic 10-set band. */
export function muscleVolumeColor(
  sets: number,
  target: number | null | undefined,
  verdict?: Pick<VolumeVerdict, 'color'> | null,
): string {
  if (!(sets > 0)) return TARGET_BAND_COLOR.untrained
  if (target != null) return targetBandColor(sets, target)
  if (verdict) return verdict.color
  if (sets >= GENERIC_HIGH) return 'var(--color-brand)'
  return targetBandColor(sets, GENERIC_TARGET)
}
