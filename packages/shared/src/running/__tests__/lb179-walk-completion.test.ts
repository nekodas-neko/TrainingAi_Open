// LB-179 — a walk that satisfied a run prescription must not feed the run planner.
//
// RV-166 lets a walk complete a prescribed run. The planner reads completion in two places inside
// `assembleInputs`: the hard-run gate (`hoursSinceLastHardRun`) and the week's 80/20 sequence
// (`runsThisWeek`). Both now ask `completedAsRun`, so a walk counts for neither.
import { describe, it, expect } from 'vitest'
import { completedAsRun } from '../run-completion'
import { assembleInputs } from '../assemble-plan-context'
import { todayInTz } from '../../date-utils'

const TZ = 'Australia/Brisbane'

describe('completedAsRun', () => {
  it('is a run when completed as one, or completed before completion was tracked', () => {
    expect(completedAsRun({ status: 'completed', completedAs: 'run' })).toBe(true)
    expect(completedAsRun({ status: 'completed', completedAs: null })).toBe(true)
    expect(completedAsRun({ status: 'completed' })).toBe(true)
  })
  it('is not a run when a walk completed it, or when it was not completed', () => {
    expect(completedAsRun({ status: 'completed', completedAs: 'walk' })).toBe(false)
    expect(completedAsRun({ status: 'pending' })).toBe(false)
    expect(completedAsRun({ status: 'skipped', completedAs: 'run' })).toBe(false)
  })
})

describe('assembleInputs ignores a walk-completed prescription (LB-179)', () => {
  const today = todayInTz(TZ)
  const repoWith = (runs: unknown[]) => ({
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    getSessionLoadsFrom: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listSleepSessions: async () => [],
    getPrescribedRuns: async () => runs,
  }) as never
  const plan = {
    id: 'p', userId: 'u', goalKind: 'general', targetDistanceKm: null, targetDate: null,
    frameworkKey: 'polarized', fitnessSnapshot: null, timePerSessionMinutes: null,
    isActive: true, createdAt: new Date(Date.now() - 20 * 86_400_000), updatedAt: new Date(),
  } as never
  const run = (completedAs: 'run' | 'walk' | null) => ({
    id: 'r', planId: 'p', date: today, runType: 'tempo', durationMin: 30, status: 'completed', completedAs,
  })

  it('a tempo completed as a RUN trips the hard-run gate and counts toward the week', async () => {
    const { ctx, gate } = await assembleInputs(repoWith([run('run')]), 'u', TZ, {} as never, plan)
    expect(gate.hoursSinceLastHardRun).not.toBeNull()
    expect(ctx.runsThisWeek).toHaveLength(1)
  })

  it('the same tempo completed as a WALK does neither', async () => {
    const { ctx, gate } = await assembleInputs(repoWith([run('walk')]), 'u', TZ, {} as never, plan)
    expect(gate.hoursSinceLastHardRun).toBeNull()
    expect(ctx.runsThisWeek).toHaveLength(0)
  })
})
