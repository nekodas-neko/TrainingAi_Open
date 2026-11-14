// The workout recap, written from the session's own numbers rather than asked for (#3748).
//
// The recap route used to hand the seven facts below to a model and ask for three sentences about
// them. The model could add nothing — the prompt forbade any number that was not in the facts — and
// it could not be made repeatable, so the same session read differently each time it was rebuilt.
// This is the same move RV-201 made for the health insight (`buildInsightText`).
//
// What `PROSE_GUARDS` asked of the model is a property of this function instead, and
// `__tests__/recap-text.test.ts` holds each one over every combination of fact patterns: only
// numbers from the facts, metric units, no superlatives, nothing diagnostic, at most three
// sentences, and the same text for the same facts.

import type { RecapFacts } from './session-recap'

/** A session this far from the usual length for its type, either way, is the thing to mention. */
export const RECAP_DURATION_OFF_USUAL_PCT = 20
/** Mean last-set-minus-first-set RPE within an exercise at which effort counts as climbing. */
export const RECAP_EFFORT_CLIMB_RPE = 1.5
/** Rest kept, as a percentage of the plan: at or above this the rests ran long. */
export const RECAP_REST_LONG_PCT = 125
/** Rest kept, as a percentage of the plan: at or below this the rests were cut short. */
export const RECAP_REST_SHORT_PCT = 75

export type RecapStandout = 'records' | 'duration' | 'effort' | 'rest' | 'neutral'

const n0 = (n: number) => Math.round(n).toLocaleString('en-US')

const durationOff = (f: RecapFacts) =>
  f.durationMin != null && f.durationVsMedianPct != null
  && Math.abs(f.durationVsMedianPct) >= RECAP_DURATION_OFF_USUAL_PCT
const durationLong = (f: RecapFacts) => durationOff(f) && f.durationVsMedianPct! > 0
const effortClimbing = (f: RecapFacts) => f.rpeDrift != null && f.rpeDrift >= RECAP_EFFORT_CLIMB_RPE
const restOff = (f: RecapFacts) =>
  f.restAdherencePct != null
  && (f.restAdherencePct >= RECAP_REST_LONG_PCT || f.restAdherencePct <= RECAP_REST_SHORT_PCT)

/** Which fact leads the recap. Fixed order, first match wins. */
export function recapStandout(f: RecapFacts): RecapStandout {
  if (f.prCount > 0) return 'records'
  if (durationOff(f)) return 'duration'
  if (effortClimbing(f)) return 'effort'
  if (restOff(f)) return 'rest'
  return 'neutral'
}

const longerOrShorter = (f: RecapFacts) =>
  `${Math.abs(f.durationVsMedianPct!)}% ${f.durationVsMedianPct! > 0 ? 'longer' : 'shorter'} than your usual for it`

const effortClause = (f: RecapFacts) =>
  `${f.rpeDrift} RPE on average from the first set of an exercise to the last`

/**
 * The session's plain figures: duration, volume and the effort rating, whichever exist. A volume of
 * zero is a session with no loaded sets, so it is left out rather than written as "moved 0 kg".
 */
function figures(f: RecapFacts, skipDuration: boolean): string | null {
  const dur = !skipDuration && f.durationMin != null ? `trained for ${f.durationMin} min` : null
  const vol = f.totalVolumeKg > 0 ? `moved ${n0(f.totalVolumeKg)} kg in total` : null
  const body = dur && vol ? `You ${dur} and ${vol}` : dur || vol ? `You ${dur ?? vol}` : null
  if (!body) return f.sessionRpe != null ? `You rated the session at RPE ${f.sessionRpe}.` : null
  return f.sessionRpe != null ? `${body}, at a session RPE of ${f.sessionRpe}.` : `${body}.`
}

function standoutSentence(f: RecapFacts, standout: RecapStandout): string | null {
  switch (standout) {
    case 'records':
      return `You set ${f.prCount} new personal ${f.prCount === 1 ? 'record' : 'records'} this session.`
    case 'duration':
      return `This session ran ${f.durationMin} min, ${longerOrShorter(f)}.`
    case 'effort':
      return `Your effort climbed across sets, by ${effortClause(f)}.`
    case 'rest':
      return f.restAdherencePct! >= RECAP_REST_LONG_PCT
        ? `You rested longer than planned, at ${f.restAdherencePct}% of the planned rest time.`
        : `You rested less than planned, at ${f.restAdherencePct}% of the planned rest time.`
    case 'neutral':
      return null
  }
}

/**
 * One thing to watch next session, or null. Effort first, then rest, then a long session. When the
 * fact already led the recap its number is not repeated; a short session gives nothing to watch.
 */
function watchSentence(f: RecapFacts, standout: RecapStandout): string | null {
  if (effortClimbing(f)) {
    return standout === 'effort'
      ? 'Next session, watch whether the last sets still feel that much harder than the first.'
      : `Next session, watch your effort across sets: it climbed by ${effortClause(f)}.`
  }
  if (restOff(f)) {
    return standout === 'rest'
      ? 'Next session, watch the rest timer between sets.'
      : `Next session, watch the rest timer: your rests ran at ${f.restAdherencePct}% of the planned time.`
  }
  if (durationLong(f)) {
    return standout === 'duration'
      ? 'Next session, watch where the extra time goes.'
      : `Next session, watch the clock: this one ran ${longerOrShorter(f)}.`
  }
  return null
}

/**
 * The recap for a finished session: what stood out, the session's figures, and one thing to watch.
 * At most three sentences, never empty.
 */
export function recapText(facts: RecapFacts): string {
  const standout = recapStandout(facts)
  const lead = standoutSentence(facts, standout)
  // The duration sentence has already stated the duration, so the figures do not say it twice.
  const plain = figures(facts, standout === 'duration')
  const watch = watchSentence(facts, standout)
  const parts = [lead, plain, watch].filter((p): p is string => p != null)
  return parts.length > 0 ? parts.join(' ') : 'This session has no duration or volume recorded.'
}
