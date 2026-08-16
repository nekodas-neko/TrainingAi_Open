import { intensityZone } from '@trainingai/shared/ai-periodization/prompt'
import type { PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'

// Deterministic, evidence-cited rationale for an automatically applied phase transition.
//
// An auto-applied transition changes the load the lifter is about to put on the bar without
// them pressing anything, so it has to justify itself with the actual numbers that triggered
// it and the training-science reason those numbers mean what they mean. The model's own
// `reasoning` string is not sufficient: it is free text, it varies run to run, and it cannot
// be relied on to quote a threshold correctly. This is built in code from the same constants
// the engine gates on, so the explanation and the decision can never disagree.

export interface TransitionEvidence {
  sessionsInPhase: number
  rm1Trend: 'up' | 'flat' | 'down' | null
  rpeDelta: number | null
}

// Eligibility floors, mirroring the transition rules rendered into the system prompt
// (prompt.ts). Kept here as data so the rationale quotes the same numbers the engine gates on.
const FLOORS: Record<string, { minSessions: number; maxRpeDelta: number }> = {
  intensification: { minSessions: 4, maxRpeDelta: 0.3 },
  realisation: { minSessions: 3, maxRpeDelta: 0.5 },
}

// Why each transition is the right move physiologically. Phrased as mechanism, not slogan —
// the lifter is being asked to trust an automatic decision, so it states what the previous
// block bought and what the next one converts it into.
const MECHANISM: Record<string, string> = {
  intensification:
    'Accumulation builds work capacity and muscle cross-sectional area through volume at ' +
    'submaximal loads. Once strength is still climbing while perceived effort holds steady or ' +
    'falls, that stimulus has stopped being maximally productive — the tissue has adapted to it. ' +
    'Intensification raises load and cuts reps to convert accumulated size and work capacity ' +
    'into force production (neural drive, rate coding, intermuscular coordination), with volume ' +
    'reduced so the higher intensity does not outrun recovery.',
  realisation:
    'Intensification has built the ability to express force at heavy loads. Realisation drops ' +
    'volume further and pushes intensity to near-maximal singles and doubles, letting accumulated ' +
    'fatigue dissipate while the strength built underneath it surfaces — the peaking half of the ' +
    'fitness-fatigue model, where preparedness rises as fatigue falls faster than fitness.',
  accumulation:
    'The deload has dissipated accumulated fatigue while the strength built through the block ' +
    'remains. Returning to accumulation restarts the cycle at a higher baseline: volume at ' +
    'submaximal loads to drive the next round of hypertrophy and work capacity.',
}

function fmtDelta(d: number): string {
  return d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1)
}

/**
 * Build the explanation shown when a transition is applied automatically. Returns null for a
 * target with no documented mechanism (defensive — every phase in PeriodizationPhase that the
 * engine can transition into is covered above).
 */
export function buildTransitionRationale(
  fromPhase: PeriodizationPhase,
  toPhase: PeriodizationPhase,
  trainingGoal: string,
  evidence: TransitionEvidence,
): string | null {
  const mechanism = MECHANISM[toPhase]
  if (!mechanism) return null

  const floor = FLOORS[toPhase]
  const zone = intensityZone(trainingGoal, toPhase)
  const prevZone = intensityZone(trainingGoal, fromPhase)

  const facts: string[] = [
    floor
      ? `${evidence.sessionsInPhase} ${fromPhase} sessions logged (eligibility floor ${floor.minSessions})`
      : `${evidence.sessionsInPhase} ${fromPhase} sessions logged`,
  ]
  if (evidence.rm1Trend) facts.push(`estimated 1RM trending ${evidence.rm1Trend}`)
  if (evidence.rpeDelta != null) {
    facts.push(
      floor
        ? `RPE running ${fmtDelta(evidence.rpeDelta)} vs expected (threshold ≤ +${floor.maxRpeDelta})`
        : `RPE running ${fmtDelta(evidence.rpeDelta)} vs expected`,
    )
  }

  const loadShift =
    `Working load moves from ${prevZone.pctMin}–${prevZone.pctMax}% for ${prevZone.repMin}–${prevZone.repMax} reps ` +
    `to ${zone.pctMin}–${zone.pctMax}% for ${zone.repMin}–${zone.repMax} reps.`

  return `Applied automatically — you met every criterion for this transition: ${facts.join(', ')}. ${mechanism} ${loadShift}`
}
