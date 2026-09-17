import { describe, it, expect } from 'vitest'
import {
  computeAiDynamicNextSession,
  type AiDynamicInput,
} from '@trainingai/shared/ai-periodization/ai-dynamic'
import type { ProgramSession, MuscleAssignment } from '@trainingai/shared/types/program'

// BF-171. `sessionRecoveryScore` was the only soreness/recovery consumer in the repo matching raw
// names; the other six go through `moodMuscleMatches`. Two limbs, and they cancelled in one place,
// which is why the entry insists the fix be measured in BOTH directions before shipping.

const session = (name: string, muscles: string[], position: number): ProgramSession => ({
  id: `id-${name}`,
  programId: 'prog',
  name,
  position,
  timeBudgetMinutes: 60,
  exercises: [{
    id: `ex-${name}`, sessionId: `id-${name}`,
    exerciseName: `${name} exercise`,
    muscleGroups: muscles,
    position: 0,
    exerciseRole: 'primary',
  }],
})

const pull = session('Pull', ['lats', 'upper back'], 0)
const legs = session('Legs', ['core'], 1)

const base: AiDynamicInput = {
  sessions: [pull, legs],
  muscleAssignments: {},
  muscleRecovery: [
    { muscle: 'lats',       pct: 90, hoursAgo: 60 },
    { muscle: 'upper back', pct: 90, hoursAgo: 60 },
    // computeMuscleRecovery keys its output through normalizeMuscle, so `core` is emitted as `abs`.
    // That is the whole of limb 2: the assignment says `core` and the feed says `abs`.
    { muscle: 'abs',        pct: 86, hoursAgo: 40 },
  ],
  history: [],
  soreMuscles: [],
  suggestedSoreMuscles: [],   // everything below is a LIFTER-ADDED tick, so BF-173 lets it clamp
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

const recoveryOf = (input: AiDynamicInput, name: string): number => {
  const entry = computeAiDynamicNextSession(input).scoredSessions?.find(s => s.session.name === name)
  expect(entry, `no scored entry for ${name}`).toBeTruthy()
  return entry!.recoveryScore
}

describe('BF-171 — the session picker matches muscle names through the shared helpers', () => {
  it('a sore "Back" pill lowers a session whose muscles are lats and upper back', () => {
    // The owner-facing defect: the picker offers Back as a pill, the exercise library has no muscle
    // called `back`, and exact equality therefore matched none of lats/upper back/traps. Measured
    // before the fix: adding Back moved every score by ZERO.
    const without = recoveryOf(base, 'Pull')
    const with_ = recoveryOf({ ...base, soreMuscles: ['Back'] }, 'Pull')
    expect(without).toBe(90)
    expect(with_).toBeLessThan(without)
    expect(with_).toBe(40)
  })

  it('an assignment naming `core` reads the `abs` recovery entry rather than falling back to 100', () => {
    // A miss returns 100, so a synonym mismatch is indistinguishable from a fully rested muscle.
    expect(recoveryOf(base, 'Legs')).toBe(86)
  })

  it('a sore "Core" pill still clamps the `core` assignment', () => {
    expect(recoveryOf({ ...base, soreMuscles: ['Core'] }, 'Legs')).toBe(40)
  })

  it('a sore "Abs" pill clamps a `core` assignment too — the synonym works in both directions', () => {
    expect(recoveryOf({ ...base, soreMuscles: ['Abs'] }, 'Legs')).toBe(40)
  })

  it('the two limbs no longer cancel: a Back pill and a core assignment in one fixture', () => {
    // The entry's own stopping condition — it is not done until measured against a fixture
    // carrying both together, because normalising only the recovery side RAISES Legs while
    // normalising only the sore side lowers Pull.
    const both = { ...base, soreMuscles: ['Back', 'Core'] }
    expect(recoveryOf(both, 'Pull')).toBe(40)   // limb 1: Back now reaches lats/upper back
    expect(recoveryOf(both, 'Legs')).toBe(40)   // limb 2 still clamps when genuinely sore
  })

  it('an unrelated sore pill does not clamp anything — matching stayed specific', () => {
    // moodMuscleMatches falls back to a SUBSTRING test, so the risk of broadening is real: this
    // pins that a leg pill does not reach a back session.
    expect(recoveryOf({ ...base, soreMuscles: ['Quads'] }, 'Pull')).toBe(90)
  })

  it('BF-173 still holds: a SUGGESTED Back tick does not clamp', () => {
    // The two fixes compose — provenance decides whether a tick counts, then name matching decides
    // which muscles it reaches. A suggestion that now matches more muscles must still not penalise.
    const score = recoveryOf({
      ...base,
      soreMuscles: ['Back'],
      suggestedSoreMuscles: ['Back'],
    }, 'Pull')
    expect(score).toBe(90)
  })

  it('RAISES a score where a suggestion and a tick are the same muscle under two names', () => {
    // The entry requires the fix be measured in BOTH directions. Every other case here lowers a
    // score or leaves it; this is the one that raises, and it comes from normalising the BF-173
    // provenance filter rather than from the name matching itself.
    //
    // Stored provenance says "Core", the tick says "Abs". Under the old lowercased comparison those
    // are different strings, so the tick read as lifter-added and clamped to 40. They are one
    // muscle, so it is an accepted suggestion and falls through to its real 86.
    const score = recoveryOf({
      ...base,
      soreMuscles: ['Abs'],
      suggestedSoreMuscles: ['Core'],
    }, 'Legs')
    expect(score).toBe(86)
  })

  it('a secondary-role sore muscle takes the 0.75 multiplier, not the clamp', () => {
    const assignments: Record<string, MuscleAssignment[]> = {
      'Pull exercise': [{ muscle: 'lats', role: 'secondary' }],
    }
    const score = recoveryOf({ ...base, muscleAssignments: assignments, soreMuscles: ['Back'] }, 'Pull')
    // `scoredSessions` rounds, so 90 × 0.75 = 67.5 surfaces as 68. Asserted on the rounded value
    // because that is what every caller reads; the point of the case is the multiplier rather than
    // the clamp, and 40 would be the clamp.
    expect(score).toBe(Math.round(90 * 0.75))
    expect(score).not.toBe(40)
  })
})
