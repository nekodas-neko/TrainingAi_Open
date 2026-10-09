import type { PacerBand, PacerSignal } from '@trainingai/shared/health/pacer-adherence'

/** One second of pacer display: what the walker was looking at. */
export interface PacerShown { signal: PacerSignal; band: PacerBand }

/**
 * Samples the reading the pacer bar is showing once a second and reports it (issue 2242).
 *
 * Sampling the DISPLAYED reading rather than the sensors is the point: the bar bands the tracker's
 * instantaneous ~1 Hz value, and that is what adherence has to measure. Running on its own timer
 * rather than in the bar's render means a re-render for an unrelated prop cannot add a tick, and a
 * sensor that reports twice in a second cannot add two. `getShown` is a ref read, so this causes no
 * React render at all.
 *
 * Returns the stop function. A null reading (no rung has a value) reports nothing.
 */
export function startPacerSampler(
  getShown: () => PacerShown | null,
  onTick: (shown: PacerShown, atMs: number) => void,
  intervalMs: number = 1000,
  now: () => number = Date.now,
): () => void {
  const id = setInterval(() => {
    const shown = getShown()
    if (shown) onTick(shown, now())
  }, intervalMs)
  return () => clearInterval(id)
}
