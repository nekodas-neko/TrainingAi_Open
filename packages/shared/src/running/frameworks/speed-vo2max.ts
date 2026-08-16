import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

// Speed framework — improve 5K/3K time + VO₂max. Two quality sessions a week (one
// VO₂max interval, one threshold) plus a long run and easy fill, spaced so hard days
// never stack. Grounded in the training-science brief: VO₂max intervals at ~90–97%
// VO₂max / 90–95% HRmax in 3–5 min reps (Daniels I-pace ≈ vVO2max); threshold "T" work
// at ~88% for lactate clearance; VO₂max sessions need ~48 h recovery ("hard days hard,
// easy days easy"). ~2 quality/week is the evidence-backed minimum for VO₂max gains.
const KEY = 'speed-vo2max'
const WEEKLY_GROWTH = 1.10
const LONG_RUN_FRACTION = 0.28

function nextRun(ctx: FrameworkContext): Prescription {
  const weeklyMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * WEEKLY_GROWTH ** ctx.weekIndex)
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hardSoFar = ctx.runsThisWeek.filter((r) => r.type === 'interval' || r.type === 'tempo').length
  const hasInterval = ctx.runsThisWeek.some((r) => r.type === 'interval')
  const hasTempo = ctx.runsThisWeek.some((r) => r.type === 'tempo')
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')

  let type: RunType
  let durationMin: number
  let rationale: string

  // Require an easy day between every hard day (easySoFar must stay ahead of hardSoFar).
  const canGoHard = easySoFar > hardSoFar

  if (!hasInterval && canGoHard && easySoFar >= 1) {
    type = 'interval'
    durationMin = Math.max(24, Math.round(weeklyMinutes * 0.16))
    rationale = 'Your weekly VO₂max session — 3–5 min reps near 5K/3K effort in your top HR zones (≈ velocity at VO₂max). This is the single biggest driver of a faster 5K, and it needs ~48 h of easy running around it.'
  } else if (!hasTempo && hasInterval && canGoHard && easySoFar >= 2) {
    type = 'tempo'
    durationMin = Math.max(25, Math.round(weeklyMinutes * 0.15))
    rationale = 'Threshold ("comfortably hard") work — 20–40 min around your lactate threshold raises the pace you can hold before fatigue sets in, which lifts your whole race.'
  } else if (!hasLong && easySoFar >= 2 && hardSoFar >= 1) {
    type = 'long'
    durationMin = Math.round(weeklyMinutes * LONG_RUN_FRACTION)
    rationale = 'Your long easy run — aerobic base is what lets the hard sessions land and repeat. Keep it conversational (Zone 1–2).'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyMinutes * 0.18))
    rationale = 'An easy aerobic run — add a few 15–20 s strides at the end for turnover and economy. Most of your week is easy so the two quality days can be genuinely hard.'
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

export const speedVo2maxFramework: RunFramework = { key: KEY, label: 'Speed / VO₂max', nextRun }
