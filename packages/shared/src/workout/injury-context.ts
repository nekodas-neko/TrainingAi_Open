// The one description of "what is currently injured" that goes into a prompt.
//
// BF-68: `injur` appeared zero times in the whole builder path, so generating a program could not
// know about a sore lower back and the owner had no field to type it into. `builder-chat` takes
// free text and would often produce a sensible-looking swap, but from luck rather than a rule — and
// the constraint died at save, because the daily prescription engine reads `injuries` and never
// heard about it.
//
// Exported from `packages/shared` rather than written into either route because BF-44 wants the
// same line on the Coach chat surface. Two hand-written injury summaries in two prompts is exactly
// the drift One Formula, One Place exists to stop — and worse here than usual, since the two would
// disagree about the same injury while both looked right.
//
// What this deliberately does NOT do is decide which exercises an injury rules out. That is
// `excludeInjuredExercises` in ./injury-substitution, which the mid-workout swap sheet already
// uses; a model asked to make that call would disagree with the swap sheet about the same injury.

import { daysBetweenDateStrs } from '../date-utils'
import type { Injury } from '../types/injury'

/** Unresolved injuries, newest first. `resolvedDate` is the only "is it over" signal — an injury
 *  has no expiry and does not lapse on its own. */
export function activeInjuries(injuries: Injury[]): Injury[] {
  return injuries
    .filter(i => !i.resolvedDate)
    .sort((a, b) => b.startedDate.localeCompare(a.startedDate))
}

/** The muscle names to keep out of a candidate list, de-duplicated and lowercased. */
export function activeInjuredMuscles(injuries: Injury[]): string[] {
  return [...new Set(activeInjuries(injuries).map(i => i.muscleName.toLowerCase()))]
}

/**
 * One line per active injury: muscle, severity, how long it has been going, and the user's own
 * note. Empty string when nothing is active, so a caller can append it unconditionally.
 *
 * `today` is passed in rather than read from the clock: the caller already knows the user's local
 * day, and deriving it here would key "days active" to whatever timezone the server happens to run
 * in — the mistake CLAUDE.md's timezone rule is about.
 */
export function formatInjuryContext(injuries: Injury[], today: string): string {
  const active = activeInjuries(injuries)
  if (active.length === 0) return ''
  return active
    .map(i => {
      const days = Math.max(0, daysBetweenDateStrs(i.startedDate, today))
      const since = days === 0 ? 'started today' : `active ${days} day${days === 1 ? '' : 's'}`
      const note = i.notes?.trim() ? ` — "${i.notes.trim()}"` : ''
      return `- ${i.muscleName} (${i.severity}, ${since})${note}`
    })
    .join('\n')
}
