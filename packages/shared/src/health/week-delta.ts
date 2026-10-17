// One metric's week against the week before, as the Week in review words it. Shared by the web
// WeekMetricCard and the native Week screen so the two cannot drift (#2935).

export type DeltaCue = 'good' | 'bad' | 'same' | null

export interface WeekDeltaOptions {
  /** Appended to the amount with no space: `2.0h`, `3m`. */
  unit?: string
  /** Digits after the point for both figures. */
  decimals?: number
  /** Whether a RISE is the good direction. Stress is the one that is not. */
  higherIsBetter?: boolean
}

/**
 * The caption under a metric's headline: an arrow and the amount, then the week before. Flat only
 * at an exact zero — a change that rounds to zero at `decimals` still prints its arrow, as the web
 * always has. `cue` is the direction as good or bad (null with nothing to compare, `same` when flat);
 * callers colour it, and the words and arrow carry the meaning on their own.
 */
export function weekDelta(
  week: number | null,
  priorWeek: number | null,
  { unit = '', decimals = 0, higherIsBetter = true }: WeekDeltaOptions = {},
): { text: string; cue: DeltaCue } {
  if (week == null || priorWeek == null) {
    return { text: priorWeek == null ? 'No week before this one' : 'Not measured this week', cue: null }
  }
  const change = week - priorWeek
  const rose = change > 0
  const against = priorWeek.toFixed(decimals)
  if (Math.abs(change) < Number.EPSILON) return { text: `Level with ${against}`, cue: 'same' }
  return {
    text: `${rose ? '↑' : '↓'} ${Math.abs(change).toFixed(decimals)}${unit} on ${against}`,
    cue: rose === higherIsBetter ? 'good' : 'bad',
  }
}
