import type { MetricAvailability, MetricGap } from '@/lib/health/score-availability'

/**
 * Q-278's surface half. Turn a metric's availability into the line that goes beside its em dash.
 *
 * The screens render `—` for a score that could not be computed, which reads identically whether
 * the ring recorded nothing or the personal baseline is simply not mature enough to judge what it
 * did record. The engine half made those two distinguishable; this is the sentence that tells them
 * apart, and the distinction is the whole point: **only `awaiting_baseline` is fixed by waiting.**
 */
const GAP_TEXT: Record<MetricGap, string> = {
  // There is no input at all. Recording something is what changes this — time alone will not.
  no_input: 'Nothing recorded for today',
  // There IS an input; the baseline is too cold to score it. Nothing to do but keep wearing it.
  awaiting_baseline: 'Not enough history to score this yet',
}

/**
 * `null` whenever there is nothing honest to say: the payload predates the field (a client can seed
 * this response from SQLite, so `availability` is genuinely optional), the metric is not listed, or
 * the score is present and needs no explanation.
 *
 * Deliberately says nothing about a *degraded* score — one that was computed from an incomplete
 * picture already has a treatment in `readiness-breakdown.tsx` via `limited`, and a second sentence
 * saying the same thing in different words next to the number would be worse than none.
 */
export function scoreGapText(
  availability: MetricAvailability[] | undefined,
  metric: string,
): string | null {
  const entry = availability?.find(a => a.metric === metric)
  if (!entry || entry.state !== 'absent' || entry.gap == null) return null
  return GAP_TEXT[entry.gap]
}
