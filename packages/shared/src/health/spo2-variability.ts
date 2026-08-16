// SpO₂ micro-variability within a sleep epoch — a fourth REM/wake signal for the heuristic stager.
//
// Breathing irregularity in REM (and across wake transitions) shows up as small oscillations in
// blood-oxygen saturation: desaturation-resaturation cycles that a 5-minute *mean* SpO₂ hides
// entirely. Deep NREM breathing is metronome-regular, so its saturation is flat. This is the same
// family of signal as `breathVar` but measured on a different physiological channel — the ring's
// oximeter rather than the tachogram's respiratory oscillation — so the two can disagree, which is
// the point of adding it.
//
// Spread is reported as a plain standard deviation in percentage points rather than a coefficient
// of variation. SpO₂ sits in a narrow band (roughly 92–100%), so CV would be SD divided by an almost
// constant mean — the same number rescaled. SD is the interpretable one, and the stager z-scores it
// per night anyway, which makes any monotone rescaling irrelevant to the score.
//
// Honest limit: ring-worn SpO₂ variability during sleep is subtler and noisier than a daytime
// reading. Treat a weak or non-bimodal distribution in the admin debug dump as a valid negative
// result and leave `W_SPO2` low, exactly as `brVar` was handled.

/** Samples needed in one epoch before a spread is trustworthy. Matches the `hrVar` bar in the
 *  rollup: below this the SD is dominated by which handful of samples happened to land. */
export const MIN_SPO2_SAMPLES = 5

/** Physiologically implausible readings are dropped before the spread — one 40% artefact would
 *  otherwise dominate an epoch whose real spread is a fraction of a percentage point. */
const SPO2_MIN = 70
const SPO2_MAX = 100

/**
 * Within-epoch SpO₂ spread (SD, percentage points), or null when the epoch carries too few valid
 * samples to trust one. Null is the neutral value in the stager — it z-scores only over the epochs
 * that carry the term, so a night whose oximeter was sparse behaves exactly as it did before this
 * signal existed. Pure and deterministic; never throws.
 */
export function spo2VariabilityFromSamples(samples: number[]): number | null {
  const valid = samples.filter(v => Number.isFinite(v) && v >= SPO2_MIN && v <= SPO2_MAX)
  if (valid.length < MIN_SPO2_SAMPLES) return null
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length
  return Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length)
}
