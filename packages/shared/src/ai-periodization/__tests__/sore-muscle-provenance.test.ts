import { describe, it, expect } from 'vitest'
import {
  computeAiDynamicNextSession,
  type AiDynamicInput,
} from '@trainingai/shared/ai-periodization/ai-dynamic'
import { RECOVERED_PCT } from '@trainingai/shared/checkin/suggested-soreness'
import type { ProgramSession } from '@trainingai/shared/types/program'

// BF-173. `suggestedSoreMuscles` pre-ticks any muscle trained within 48 h and under RECOVERED_PCT,
// reading the same recovery feed `sessionRecoveryScore` then scores — so clamping an accepted
// suggestion counts one fact twice. These pin the separation: a tick the model produced falls
// through to its own recovery pct, a tick the lifter added still clamps.

const session = (name: string, muscle: string, position: number): ProgramSession => ({
  id: `id-${name}`,
  programId: 'prog',
  name,
  position,
  timeBudgetMinutes: 60,
  exercises: [{
    id: `ex-${name}`, sessionId: `id-${name}`,
    exerciseName: `${name} exercise`,
    muscleGroups: [muscle],
    position: 0,
    exerciseRole: 'primary',
  }],
})

const lower = session('Lower', 'quadriceps', 0)
const upper = session('Upper', 'chest', 1)

// The owner's measured 2026-09-17 figures: quads 69 (47 h since Legs), chest 49 (23 h since Push).
// Both are under RECOVERED_PCT, so both are muscles `suggestedSoreMuscles` would itself pre-tick.
const QUADS_PCT = 69
const CHEST_PCT = 49

const base: AiDynamicInput = {
  sessions: [lower, upper],
  muscleAssignments: {},
  muscleRecovery: [
    { muscle: 'quadriceps', pct: QUADS_PCT, hoursAgo: 47 },
    { muscle: 'chest',      pct: CHEST_PCT, hoursAgo: 23 },
  ],
  history: [],
  soreMuscles: [],
  readinessScore: 80,
  temperatureDeviation: null,
  daySummary: null,
  timezone: 'Australia/Brisbane',
  reminderEnabled: false,
  reminderTime: null,
  sleepTrend: null,
  energyLevel: null,
  hrvTrend: null,
  illnessFlag: null,
  stressHighMinutes: null,
}

// `scoredSessions` carries every session's component scores, which is what makes the clamp
// observable per muscle rather than only through the winner.
const recoveryOf = (input: AiDynamicInput, name: string): number => {
  const scored = computeAiDynamicNextSession(input).scoredSessions
  const entry = scored?.find(s => s.session.name === name)
  expect(entry, `no scored entry for ${name}`).toBeTruthy()
  return entry!.recoveryScore
}

describe('BF-173 — a sore tick only penalises when the lifter put it there', () => {
  it('both figures are under the suggestion threshold, so the model would pre-tick both', () => {
    // If this ever stops holding, every case below is testing something else.
    expect(QUADS_PCT).toBeLessThan(RECOVERED_PCT)
    expect(CHEST_PCT).toBeLessThan(RECOVERED_PCT)
  })

  it('an accepted suggestion is NOT clamped — it keeps its own recovery pct', () => {
    const score = recoveryOf({
      ...base,
      soreMuscles: ['quadriceps'],
      suggestedSoreMuscles: ['quadriceps'],
    }, 'Lower')
    expect(score).toBe(QUADS_PCT)
  })

  it('a tick the lifter added IS clamped, even though its pct is already under the threshold', () => {
    // This is the property the rejected cheap option would have lost: suppressing the clamp
    // whenever pct < RECOVERED_PCT discards exactly the case where the lifter is telling the
    // model it is wrong. Provenance keeps it.
    const score = recoveryOf({
      ...base,
      soreMuscles: ['quadriceps'],
      suggestedSoreMuscles: [],
    }, 'Lower')
    expect(score).toBe(40)
  })

  it('null provenance is UNKNOWN, not "none" — every tick clamps, as before BF-173', () => {
    const score = recoveryOf({
      ...base,
      soreMuscles: ['quadriceps'],
      suggestedSoreMuscles: null,
    }, 'Lower')
    expect(score).toBe(40)
  })

  it('an absent field behaves the same as null', () => {
    const score = recoveryOf({ ...base, soreMuscles: ['quadriceps'] }, 'Lower')
    expect(score).toBe(40)
  })

  it('matching is case-insensitive on both sides', () => {
    const score = recoveryOf({
      ...base,
      soreMuscles: ['Quadriceps'],
      suggestedSoreMuscles: ['QUADRICEPS'],
    }, 'Lower')
    expect(score).toBe(QUADS_PCT)
  })

  it('the clamp no longer flattens the ordering the recovery model computed', () => {
    // The defect the owner reported: quads 69 and chest 49 both became exactly 40, deleting the
    // fact that his legs were fresher than his push muscles.
    const input = {
      ...base,
      soreMuscles: ['quadriceps', 'chest'],
      suggestedSoreMuscles: ['quadriceps', 'chest'],
    }
    const lowerScore = recoveryOf(input, 'Lower')
    const upperScore = recoveryOf(input, 'Upper')
    expect(lowerScore).toBe(QUADS_PCT)
    expect(upperScore).toBe(CHEST_PCT)
    expect(lowerScore).toBeGreaterThan(upperScore)
  })

  it('a mixed log clamps only the volunteered half', () => {
    const input = {
      ...base,
      soreMuscles: ['quadriceps', 'chest'],
      suggestedSoreMuscles: ['quadriceps'],   // chest was the lifter's own
    }
    expect(recoveryOf(input, 'Lower')).toBe(QUADS_PCT)
    expect(recoveryOf(input, 'Upper')).toBe(40)
  })

  it('provenance naming a muscle that was never ticked changes nothing', () => {
    const score = recoveryOf({
      ...base,
      soreMuscles: [],
      suggestedSoreMuscles: ['quadriceps'],
    }, 'Lower')
    expect(score).toBe(QUADS_PCT)
  })
})
