import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

const KEY = 'polarized-80-20'
const WEEKLY_GROWTH = 1.10           // ≤10% weekly volume progression
const QUALITY_AFTER_EASY = 4         // ~1 quality session per ~5 runs → ~20% hard
const LONG_RUN_FRACTION = 0.35       // the week's long run ≈ 35% of weekly minutes

// Polarized/pyramidal distribution (Seiler & Kjerland 2006; Stöggl & Sperlich 2014):
// ~80% easy aerobic volume, ~20% high-intensity quality. Deterministic — no randomness,
// no LLM. Progression is a simple capped week-over-week volume increase.
function nextRun(ctx: FrameworkContext): Prescription {
  const weeklyMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * WEEKLY_GROWTH ** ctx.weekIndex)
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hardSoFar = ctx.runsThisWeek.filter((r) => r.type === 'interval' || r.type === 'tempo').length
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')

  let type: RunType
  let durationMin: number
  let rationale: string

  if (hardSoFar === 0 && easySoFar >= QUALITY_AFTER_EASY) {
    type = 'interval'
    durationMin = Math.max(25, Math.round(weeklyMinutes * 0.2))
    rationale = 'This is your weekly quality session — short, hard intervals in your top HR zones are what actually push VO₂max up. It is the ~20% of "hard" in the 80/20 model.'
  } else if (!hasLong && easySoFar >= 2) {
    type = 'long'
    durationMin = Math.round(weeklyMinutes * LONG_RUN_FRACTION)
    rationale = 'Your weekly long easy run — time on feet at a conversational pace builds the aerobic base that most of your fitness comes from.'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyMinutes * 0.22))
    rationale = 'An easy aerobic run — keep it conversational (Zone 1–2). ~80% of your running should feel this comfortable; that is what makes the hard days work.'
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

export const polarizedFramework: RunFramework = { key: KEY, label: 'Polarized 80/20', nextRun }
