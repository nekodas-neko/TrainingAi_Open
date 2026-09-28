// RV-184 — the two open-time generations (workout-data's server-side one and the client's POST)
// can land on different replicas, where the per-process cooldown cannot see the first. A plain call
// must return a prescription stored under 30 s ago rather than reach the model, and must fall
// through for everything the stored plan cannot vouch for.
//
// The repository double answers only the reads the guard needs; any other method throws
// `reached generation`, which is how each case proves which side of the guard it landed on.
import { describe, it, expect } from 'vitest'
import { generatePrescriptionForSession } from '../generate-prescription'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'

const SESSION = 'ps-1'
let n = 0

function repoWith(state: Record<string, unknown>): WorkoutRepository {
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog-1', sessions: [{ id: SESSION, timeBudgetMinutes: 60 }] }),
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
  }
  return new Proxy({}, {
    get: (_t, prop: string) => known[prop] ?? (async () => { throw new Error(`reached generation (${prop})`) }),
  }) as WorkoutRepository
}

const plan = (over: Partial<AiPrescription> = {}) => ({ estimatedSessionDurationMin: 55, exercises: [], ...over }) as unknown as AiPrescription

const stateFor = (over: Record<string, unknown> = {}) => ({
  phase: 'accumulation', baselineComplete: true,
  prescription: plan(), prescriptionStatus: 'pending',
  prescriptionGeneratedAt: new Date(Date.now() - 5_000),
  ...over,
})

// A fresh user per call: the in-process dedup key starts with the user id, so no case can be
// answered by another's cached result.
const call = (state: Record<string, unknown>, exclude?: string, preset?: 'short') =>
  generatePrescriptionForSession(`user-${++n}`, SESSION, repoWith(state), 'Australia/Brisbane', exclude, preset)

describe('the just-generated guard (RV-184)', () => {
  it('returns a plan stored 5 s ago instead of generating again', async () => {
    const state = stateFor()
    const r = await call(state)
    expect(r).toEqual({ ok: true, prescription: state.prescription, prescriptionStatus: 'pending', estimatedSessionDurationMin: 55 })
  })

  it('also for an auto-applied plan', async () => {
    const r = await call(stateFor({ prescriptionStatus: 'auto_applied' }))
    expect(r).toMatchObject({ ok: true, prescriptionStatus: 'auto_applied' })
  })

  it('generates when the stored plan is older than 30 s', async () => {
    await expect(call(stateFor({ prescriptionGeneratedAt: new Date(Date.now() - 31_000) }))).rejects.toThrow(/reached generation/)
  })

  it('generates when the slot was consumed, as completion leaves it', async () => {
    await expect(call(stateFor({ prescriptionStatus: 'consumed' }))).rejects.toThrow(/reached generation/)
  })

  it('generates for a completion-path call, which must produce the NEXT plan', async () => {
    await expect(call(stateFor(), 'ws-9')).rejects.toThrow(/reached generation/)
  })

  it('generates for a preset request, and when the stored plan was built for another length', async () => {
    await expect(call(stateFor(), undefined, 'short')).rejects.toThrow(/reached generation/)
    await expect(call(stateFor({ prescription: plan({ durationPreset: 'short' } as Partial<AiPrescription>) }))).rejects.toThrow(/reached generation/)
  })

  it('generates when nothing is stored', async () => {
    await expect(call(stateFor({ prescription: null, prescriptionGeneratedAt: null }))).rejects.toThrow(/reached generation/)
  })
})
