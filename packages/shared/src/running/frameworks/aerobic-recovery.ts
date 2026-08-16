import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

// Recovery / HRR framework — raise parasympathetic (vagal) tone to lower resting HR and
// speed heart-rate recovery. All easy aerobic volume, alternating steady easy runs with
// very-light recovery runs, no hard work and no Zone-3 "grey zone" grind. Grounded in the
// brief: high easy aerobic volume + a polarized structure increases stroke volume and vagal
// reactivation, improving HRR1 and resting HR within weeks; chronic moderate-intensity work
// blunts that adaptation.
const KEY = 'aerobic-recovery'
const WEEKLY_GROWTH = 1.05
const LONG_RUN_FRACTION = 0.26

function nextRun(ctx: FrameworkContext): Prescription {
  const weeklyMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * WEEKLY_GROWTH ** ctx.weekIndex)
  const done = ctx.runsThisWeek.length
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')

  let type: RunType
  let durationMin: number
  let rationale: string

  if (!hasLong && easySoFar >= 3) {
    type = 'long'
    durationMin = Math.round(weeklyMinutes * LONG_RUN_FRACTION)
    rationale = 'A longer easy aerobic run — sustained low-intensity time is the strongest driver of vagal tone, which is what lowers your resting heart rate and speeds your recovery after exertion.'
  } else if (done % 2 === 1) {
    // Alternate a very-light recovery run in after each steady easy run.
    type = 'recovery'
    durationMin = Math.max(15, Math.round(weeklyMinutes * 0.12))
    rationale = 'A short, very easy recovery run (Zone 1) — deliberately gentle. This keeps blood flowing and reinforces the parasympathetic recovery response without adding fatigue.'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyMinutes * 0.18))
    rationale = 'A steady easy aerobic run (Zone 1–2), conversational throughout. Consistent easy volume is what improves your heart-rate recovery and resting heart rate over the coming weeks.'
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

export const aerobicRecoveryFramework: RunFramework = { key: KEY, label: 'Aerobic recovery', nextRun }
