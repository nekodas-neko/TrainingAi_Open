import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

// Heart-health framework — general cardiovascular fitness. Almost all Zone-2 aerobic
// work with a weekly slightly-longer aerobic run, no intervals. Grounded in the brief:
// Zone-2 emphasis (60–70% HRmax) builds the aerobic/mitochondrial base at low injury and
// overtraining risk; the target is simply meeting the ACSM/WHO/AHA 150 min/week
// moderate-activity guideline consistently. Slow, sustainable progression.
const KEY = 'zone2-base'
const WEEKLY_GROWTH = 1.05           // gentle — health, not performance
const GUIDELINE_MIN = 150
const LONG_RUN_FRACTION = 0.30

function nextRun(ctx: FrameworkContext): Prescription {
  const weeklyMinutes = Math.max(GUIDELINE_MIN, Math.round(ctx.fitness.weeklyBaseMinutes * WEEKLY_GROWTH ** ctx.weekIndex))
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')

  let type: RunType
  let durationMin: number
  let rationale: string

  if (!hasLong && easySoFar >= 3) {
    type = 'long'
    durationMin = Math.round(weeklyMinutes * LONG_RUN_FRACTION)
    rationale = 'A slightly longer aerobic run — still easy (Zone 2), just more time on feet to deepen the aerobic base. Nothing about this should feel hard.'
  } else {
    type = 'easy'
    durationMin = Math.max(25, Math.round(weeklyMinutes / 5))
    rationale = 'A steady Zone-2 aerobic session — you should be able to hold a conversation. Consistent easy volume like this is what meets the 150 min/week heart-health guideline and lowers resting heart rate over time.'
  }

  return {
    type,
    durationMin,
    distanceKm: null,
    targets: targetsForRunType(type, ctx.fitness),
    rationale,
    frameworkKey: KEY,
  }
}

export const zone2BaseFramework: RunFramework = { key: KEY, label: 'Zone 2 heart health', nextRun }
