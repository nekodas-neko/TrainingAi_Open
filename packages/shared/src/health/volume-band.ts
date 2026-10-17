import { volumeLandmarks } from '../ai-periodization/volume-targets'

/**
 * Where a week's set count sits against a muscle's target or landmarks, and which tone that earns.
 *
 * The rule lives here once; each app maps a tone to its own colour (CSS tokens on the web, theme
 * colours in the native app), so the bars and the body map cannot disagree and neither app grows a
 * second copy (#2554, #2900). The colour a tone gets is the app's business, never this file's.
 */

export type VolumeBand = 'under' | 'in' | 'high' | 'over'

/** good / warn / bad are the app's green / amber / red; `none` is an untrained muscle; `brand` is
 *  the generic band's "well past the minimum". */
export type VolumeTone = 'good' | 'warn' | 'bad' | 'none' | 'brand'

export interface VolumeVerdict {
  band: VolumeBand
  /** Rendered beside the number, never colour alone: two bands are red and mean opposites. */
  label: string
  tone: VolumeTone
  mev: number
  mav: number
  mrv: number
}

const BANDS: Record<VolumeBand, { label: string; tone: VolumeTone }> = {
  under: { label: 'below MEV', tone: 'bad' },
  in: { label: 'in range', tone: 'good' },
  high: { label: 'above MAV', tone: 'warn' },
  over: { label: 'above MRV', tone: 'bad' },
}

/** The band of `sets` against the muscle's goal-scaled landmarks (Q-305). */
export function volumeVerdict(trainingGoal: string, muscle: string, sets: number): VolumeVerdict {
  const { mev, mav, mrv } = volumeLandmarks(trainingGoal, muscle)
  // Ordered high-to-low so a landmark table where two thresholds coincide still resolves.
  const band: VolumeBand = sets > mrv ? 'over' : sets > mav ? 'high' : sets >= mev ? 'in' : 'under'
  return { band, ...BANDS[band], mev, mav, mrv }
}

/** The generic band's target when nothing supplies one: its 10-set minimum. */
export const GENERIC_TARGET = 10
/** Sets at which the generic band (no target, no goal) turns `brand`. */
export const GENERIC_HIGH = 15
/** The top of the generic band's printed range, and the least a muscle bar's scale reaches. */
export const MAX_TARGET = 20

/** Sets from which `targetBand` calls a week "approaching" the generic target (60%, rounded up). */
const GENERIC_APPROACHING = Math.ceil((GENERIC_TARGET * 3) / 5)

/**
 * The generic band's legend, top to bottom, in words. Derived from the same constants the colours
 * use so a retuned threshold cannot leave a caption describing the old one.
 */
export const GENERIC_LEGEND: readonly { tone: VolumeTone; label: string }[] = [
  { tone: 'brand', label: `${GENERIC_HIGH}+ sets` },
  { tone: 'good', label: `${GENERIC_TARGET}–${GENERIC_HIGH - 1} sets` },
  { tone: 'warn', label: `${GENERIC_APPROACHING}–${GENERIC_TARGET - 1} sets` },
  { tone: 'bad', label: `Under ${GENERIC_APPROACHING}` },
]

export type TargetBand = 'untrained' | 'under' | 'approaching' | 'at'

/** Which side of its target a week's sets fall. Integer arithmetic (`sets * 5` vs `target * 3`) so
 *  exactly 60% is not at the mercy of `13 * 0.6` landing on 7.800000000000001. */
export function targetBand(sets: number, target: number): TargetBand {
  if (!(sets > 0)) return 'untrained'
  if (sets >= target) return 'at'
  if (sets * 5 >= target * 3) return 'approaching'
  return 'under'
}

const TARGET_TONE: Record<TargetBand, VolumeTone> = {
  at: 'good',
  approaching: 'warn',
  under: 'bad',
  untrained: 'none',
}

export function targetTone(sets: number, target: number): VolumeTone {
  return TARGET_TONE[targetBand(sets, target)]
}

/**
 * The colour of one muscle's bar and its patch on the body map, in whatever colour type the caller
 * uses. A program target wins; then the goal-scaled verdict's own colour; then the generic 10-set
 * band. `palette` maps each tone to the caller's colour.
 */
export function muscleVolumeColor<C>(
  sets: number,
  target: number | null | undefined,
  verdictColor: C | null | undefined,
  palette: Record<VolumeTone, C>,
): C {
  if (!(sets > 0)) return palette.none
  if (target != null) return palette[targetTone(sets, target)]
  if (verdictColor != null) return verdictColor
  if (sets >= GENERIC_HIGH) return palette.brand
  return palette[targetTone(sets, GENERIC_TARGET)]
}
