/**
 * A guided walk's plan segments cut off at the seconds actually walked (#3132): the blocks never
 * reached are dropped and the block the walk stopped in ends at the stop. Left whole, an early
 * "Save walk" gave that block distance over its entire planned time and saved the unreached blocks
 * with their planned `endSec`.
 *
 * `activeSec` is ACTIVE time, the seconds the walk's duration counts, so a pause is already out of
 * it (#3092, #3109). A walk finished normally has `activeSec >= totalSec` and comes back unchanged.
 * One rule for the current app's walk summary and TrainingAi Preview.
 */
export function clipSegmentsAt<T extends { startSec: number; endSec: number }>(
  segments: T[],
  activeSec: number,
): T[] {
  return segments
    .filter(segment => segment.startSec < activeSec)
    .map(segment => (segment.endSec <= activeSec ? segment : { ...segment, endSec: activeSec }))
}
