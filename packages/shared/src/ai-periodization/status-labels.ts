/**
 * The words the AI Periodization status rows use, shared by the web card and the
 * native app so a phase and a "last trained" label read the same on both (#2900).
 */

import type { PeriodizationPhase } from '../types/ai-periodization'

export const PHASE_LABELS: Record<PeriodizationPhase, string> = {
  baseline: 'Baseline',
  accumulation: 'Accum.',
  intensification: 'Intens.',
  realisation: 'Realise',
  deload: 'Deload',
}

/** A phase's label; a value the type does not know (an older stored row) reads as itself. */
export function phaseLabel(phase: string): string {
  return (PHASE_LABELS as Record<string, string>)[phase] ?? phase
}

/** The right-hand recency label of a session row: "Never trained", "Trained today", "Yesterday",
 *  "3d ago". Never "1 days ago". */
export function lastTrainedLabel(daysAgo: number | null | undefined): string {
  if (daysAgo == null) return 'Never trained'
  if (daysAgo <= 0) return 'Trained today'
  if (daysAgo === 1) return 'Yesterday'
  return `${daysAgo}d ago`
}
