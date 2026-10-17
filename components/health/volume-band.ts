import {
  GENERIC_TARGET,
  muscleVolumeColor as pickMuscleVolumeColor,
  targetBand,
  volumeVerdict as sharedVolumeVerdict,
  type TargetBand,
  type VolumeBand,
  type VolumeTone,
  type VolumeVerdict as SharedVolumeVerdict,
} from '@trainingai/shared/health/volume-band'

/**
 * Where a week's set count sits against the muscle's own landmarks (Q-305), coloured for the web.
 *
 * The thresholds, bands and the one colour rule live in `packages/shared/src/health/volume-band.ts`
 * (the native app reads the same file); this file only decides what colour each tone is here. The
 * band's word travels with its colour on purpose: two of the four bands are red and mean opposite
 * things (Q-305, #2554).
 *
 * Theme tokens, not hex, and never append a hex alpha to one: the palette is defined once in
 * `app/globals.css` and checked for contrast there.
 */

export { GENERIC_TARGET, targetBand }
export type { TargetBand, VolumeBand }

export interface VolumeVerdict extends SharedVolumeVerdict {
  color: string
}

// `scripts/check-contrast.js` reads this table to hold the three band colours at 3:1 against an
// untouched muscle in both themes (RV-101); the tones below are these same colours.
const TARGET_BAND_COLOR: Record<TargetBand, string> = {
  at: 'var(--accent-green)',
  approaching: 'var(--accent-amber)',
  under: 'var(--destructive)',
  untrained: 'var(--muted-foreground)',
}

const TONE_COLOR: Record<VolumeTone, string> = {
  good: TARGET_BAND_COLOR.at,
  warn: TARGET_BAND_COLOR.approaching,
  bad: TARGET_BAND_COLOR.under,
  none: TARGET_BAND_COLOR.untrained,
  brand: 'var(--color-brand)',
}

export function volumeVerdict(trainingGoal: string, muscle: string, sets: number): VolumeVerdict {
  const verdict = sharedVolumeVerdict(trainingGoal, muscle, sets)
  return { ...verdict, color: TONE_COLOR[verdict.tone] }
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
  return pickMuscleVolumeColor(sets, target, verdict?.color, TONE_COLOR)
}
