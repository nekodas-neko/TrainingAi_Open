import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

const KEY = 'norwegian-4x4'
// The interval workout is a fixed protocol structure — 10 min warm-up + 4 × 4 min work
// (Zone 4-5, 85-95% max HR) + 3 × 3 min active recovery between reps + 5 min cool-down
// = 40 min total. It does not grow with training age the way easy-run volume does;
// growing it would depart from the published protocol (Helgerud et al. 2007, J Strength
// Cond Res; Wisløff et al. 2007, Circulation).
const INTERVAL_DURATION_MIN = 40
// Standard recreational-athlete cap — the near-maximal-HR demand of this protocol
// doesn't tolerate more without overreaching.
const MAX_HARD_PER_WEEK = 2
const FILL_GROWTH = 1.05

function nextRun(ctx: FrameworkContext): Prescription {
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hardSoFar = ctx.runsThisWeek.filter((r) => r.type === 'interval').length
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')
  const weeklyFillMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * FILL_GROWTH ** ctx.weekIndex)

  // An easy day must separate every interval day — the protocol's recovery demand is
  // high (16 total minutes of near-maximal-HR work per session).
  const canGoHard = easySoFar > hardSoFar

  let type: RunType
  let durationMin: number
  let rationale: string

  if (hardSoFar < MAX_HARD_PER_WEEK && canGoHard) {
    type = 'interval'
    durationMin = INTERVAL_DURATION_MIN
    rationale = 'Norwegian 4×4 — 4 × 4 minutes at 85–95% max HR (Zone 4–5), each followed by 3 minutes of easy active recovery, bracketed by a 10-minute warm-up and 5-minute cool-down. One of the most time-efficient, evidence-backed protocols for raising VO₂max.'
  } else if (!hasLong && easySoFar >= 1) {
    type = 'long'
    durationMin = Math.max(30, Math.round(weeklyFillMinutes * 0.35))
    rationale = 'Your weekly long easy run — aerobic base work that supports the interval sessions and speeds recovery between them.'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyFillMinutes * 0.2))
    rationale = "An easy recovery run — keep it conversational (Zone 1). This protocol's intensity lives entirely in the interval days; every other run should feel easy."
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

export const norwegian4x4Framework: RunFramework = { key: KEY, label: 'Norwegian 4×4 intervals', nextRun }
