/**
 * Wording for a score that is missing, and for a contributor still learning its baseline.
 * The current app and Preview both print these; never retype them.
 *
 * Only `awaiting_baseline` is fixed by waiting. `no_input` is fixed by recording something.
 */
export type ScoreGap = 'no_input' | 'awaiting_baseline'

export interface ScoreAvailabilityEntry {
  metric: string
  state: string
  gap?: unknown
}

export const SCORE_GAP_TEXT: Record<ScoreGap, string> = {
  no_input: 'Nothing recorded for today',
  awaiting_baseline: 'Not enough history to score this yet',
}

/** Shown in place of a contributor's meaning while its personal baseline is still maturing. */
export const PROVISIONAL_BASELINE_NOTE =
  'Still learning your personal baseline — this factor stays neutral until enough nights of data accrue, then it scores against your own normal.'

/**
 * `null` when there is nothing honest to say: the payload predates `availability`, the metric is
 * not listed, or its score is present.
 */
export function scoreGapText(
  availability: readonly ScoreAvailabilityEntry[] | undefined,
  metric: string,
): string | null {
  const entry = availability?.find(a => a.metric === metric)
  if (!entry || entry.state !== 'absent') return null
  const gap = entry.gap
  return gap === 'no_input' || gap === 'awaiting_baseline' ? SCORE_GAP_TEXT[gap] : null
}
