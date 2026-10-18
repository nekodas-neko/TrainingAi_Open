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

/** The ring's own recovery reading, used as the input because there is no raw measurement to score. */
export const OURA_CONTRIBUTOR_NOTE =
  "From your ring's own recovery reading. There's no raw measurement behind this one for us to score ourselves."

/** A real score from an approximate curve (the overnight-HR recovery estimate), flagged provisional. */
export const APPROXIMATE_CURVE_NOTE =
  'Estimated from your overnight heart rate, so it can shift a little as more of the night comes in.'

/** The fields of a readiness contributor that decide which note it gets. */
export interface ContributorNoteInput {
  provisional?: boolean
  gap?: unknown
  scale?: unknown
}

/**
 * What to print in place of a contributor's meaning, or `null` when it is an ordinary scored
 * contributor and its meaning should show. `provisional` has three senses (see
 * `readiness-composite.ts`), so the note follows the case, never `provisional` alone.
 *
 * A payload from before `gap` existed has it `undefined`, not `null`; that keeps the old baseline
 * note rather than guessing a case.
 */
export function contributorNote(c: ContributorNoteInput): string | null {
  if (c.gap === 'no_input') return SCORE_GAP_TEXT.no_input
  if (c.gap === 'awaiting_baseline') return PROVISIONAL_BASELINE_NOTE
  if (c.scale === 'oura_contributor') return OURA_CONTRIBUTOR_NOTE
  if (!c.provisional) return null
  return c.gap === null ? APPROXIMATE_CURVE_NOTE : PROVISIONAL_BASELINE_NOTE
}

/**
 * True when a contributor has no score of its own to show: it is still learning its baseline, or
 * nothing was recorded. A provisional contributor with `gap: null` (Oura's recovery index, the
 * overnight-HR estimate) has a real score that counts in readiness, so it is not learning (#3029).
 *
 * `gap` is `undefined` on a payload from before it existed; there `provisional` keeps meaning what it
 * always did.
 */
export function isLearningContributor(c: ContributorNoteInput): boolean {
  if (c.gap === 'awaiting_baseline' || c.gap === 'no_input') return true
  return c.gap === undefined && !!c.provisional
}
