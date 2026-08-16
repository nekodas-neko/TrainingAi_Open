// Gait cadence classifier — idle/walk/run from the ring's decoded stride-frequency signal.
// Built for AD-2 (ring-cadence walk/run detection, superseding GPS-speed confirmation — see
// docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md and the domain overview
// docs/gait-movement-domain.md). This is the single source of gait-state truth — reuse here,
// don't re-derive cadence bands elsewhere (One-Formula-One-Place).
//
// PROVISIONAL BANDS — NOT yet confirmed on-device. Sub-plan D-2 (the exact units/column-order of
// `stride_frequency` vs a counted walk) is still open, shared with the step-counter accuracy work.
// The Hz bands below come from physiological priors (walk ≈ 90-130 steps/min, run ≈ 140-195
// steps/min), assuming stride_frequency ≈ steps/second — consistent with
// docs/gait-movement-domain.md's own "steps_motion_decoder gives stride_frequency in Hz directly
// (~1.5-3 Hz walking)" note for this exact signal. Revisit once the owner's counted-walk/run
// capture lands (see the plan's Calibration section) — do not hand-tune further without real data.

export type GaitState = 'idle' | 'walk' | 'run'

export interface GaitFeatures {
  /** Decoded stride frequency, Hz (steps_motion_decoder output column 4). */
  strideHz: number
  /** Decoded stride amplitude fraction (output column 5). */
  strideAmpFrac: number
  /** Decoded total accelerometer amplitude, mg (output column 3). */
  totalAmplitudeMg: number
}

export interface GaitClassification {
  state: GaitState
  strideHz: number
}

const WALK_HZ_MIN = 1.4 // ~84 steps/min
const WALK_HZ_MAX = 2.4 // ~144 steps/min (exclusive — run picks up here)
const RUN_HZ_MIN = 2.4  // ~144 steps/min
const RUN_HZ_MAX = 3.6  // ~216 steps/min

/**
 * Classify a single decoded gait window. `strideAmpFrac`/`totalAmplitudeMg` only gate out
 * clearly-degenerate readings (non-finite, zero, negative) — a precise amplitude motion floor is
 * itself pending the same on-device calibration as the Hz bands, so it is NOT hand-tuned here.
 * The real false-positive defense is the sustained-window requirement in gait-confirm.ts, not a
 * single-window amplitude threshold.
 */
/**
 * Whether a window carries any locomotor motion at all, independent of WHICH cadence band it
 * falls in.
 *
 * `classifyGait` returns 'idle' for two very different reasons — no motion, or motion outside
 * the walk/run Hz bands — and callers cannot tell them apart from the verdict alone. That
 * conflation matters: a genuine 64 spm walk (≈1.07 Hz) sits below WALK_HZ_MIN and so reads as
 * 'idle', which is right for AD-2's walk/run *detection* but wrong for anyone measuring
 * cadence, who would drop the real walk and keep nothing.
 */
export function hasGaitMotion(f: GaitFeatures): boolean {
  return (
    Number.isFinite(f.totalAmplitudeMg) && f.totalAmplitudeMg > 0 &&
    Number.isFinite(f.strideAmpFrac) && f.strideAmpFrac > 0 &&
    Number.isFinite(f.strideHz) && f.strideHz > 0
  )
}

export function classifyGait(f: GaitFeatures): GaitClassification {
  const hasMotion =
    Number.isFinite(f.totalAmplitudeMg) && f.totalAmplitudeMg > 0 &&
    Number.isFinite(f.strideAmpFrac) && f.strideAmpFrac > 0
  if (!hasMotion || !Number.isFinite(f.strideHz)) return { state: 'idle', strideHz: f.strideHz }

  if (f.strideHz >= WALK_HZ_MIN && f.strideHz < WALK_HZ_MAX) return { state: 'walk', strideHz: f.strideHz }
  if (f.strideHz >= RUN_HZ_MIN && f.strideHz <= RUN_HZ_MAX) return { state: 'run', strideHz: f.strideHz }
  return { state: 'idle', strideHz: f.strideHz }
}
