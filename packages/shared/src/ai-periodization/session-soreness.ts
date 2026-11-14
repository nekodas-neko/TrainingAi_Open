import { moodMuscleMatches } from '@trainingai/shared/muscles'
import { soreTickProvenance } from '@trainingai/shared/checkin/suggested-soreness'

export interface SessionSoreness {
  /** Lifter-reported sore regions this session trains. The only list that may change a load. */
  soreMusclesInSession: string[]
  /** Lifter-reported sore regions this session does not train. */
  soreMusclesOutOfSession: string[]
  /** Untouched suggestions this session trains: recently trained, not reported sore (#3764). */
  recentlyTrainedMusclesInSession: string[]
}

/**
 * #3764. The one place a check-in's sore list is turned into the session's soreness signals, for
 * the full aggregation (`aggregateSignals`) and the consumption-day re-check (`/api/workout-data`)
 * alike, so the two cannot disagree about which ticks lighten a load.
 */
export function sessionSoreness(
  moodLog: { bodyState: string[]; soreMuscles: string[]; suggestedSoreMuscles?: string[] | null } | null | undefined,
  sessionMuscleGroups: string[],
): SessionSoreness {
  const out: SessionSoreness = { soreMusclesInSession: [], soreMusclesOutOfSession: [], recentlyTrainedMusclesInSession: [] }
  if (!moodLog || !moodLog.bodyState.includes('sore_muscles') || moodLog.soreMuscles.length === 0) return out
  const inSession = (label: string) => sessionMuscleGroups.some(mg => moodMuscleMatches(mg, label))
  const { lifterReported, untouchedSuggestions } = soreTickProvenance(moodLog.soreMuscles, moodLog.suggestedSoreMuscles)
  for (const m of lifterReported) (inSession(m) ? out.soreMusclesInSession : out.soreMusclesOutOfSession).push(m)
  out.recentlyTrainedMusclesInSession = untouchedSuggestions.filter(inSession)
  return out
}
