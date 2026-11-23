/**
 * #4082 review: a program-phase write that gave up waiting for the person's other writer (a check-in, a Coach
 * apply) throws `BusyError` and wrote nothing. The transition route answers it as a 409 "busy, try again"
 * (not a 500), and the sync that runs on reads carries on without that write instead of failing the read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BusyError } from '@trainingai/shared/errors'
type Row = Record<string, unknown>

const UPPER = '00000000-0000-4000-8000-0000000040a1'
const LOWER = '00000000-0000-4000-8000-0000000040a2'
const start = new Date('2026-11-23T00:00:00+10:00')

const state = (over: Row = {}) => ({
  id: 'st', userId: 'u', programSessionId: UPPER, phase: 'accumulation', phaseStartedAt: start,
  sessionsInPhase: 3, baselineComplete: true, baseline1rm: {}, prescription: null,
  prescriptionGeneratedAt: null, prescriptionExpiresAt: null, prescriptionStatus: 'pending',
  lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null,
  updatedAt: new Date(), ...over,
})

const offer = { phase: 'intensification', phaseAction: 'transition_recommended', exercises: [] }
const rows = vi.fn(async () => [state(), state({ programSessionId: LOWER })] as Row[])
const current = vi.fn(async () => state({ prescription: offer }) as Row)
const advanceProgramPhase = vi.fn(async () => state())
const setProgramPendingTransition = vi.fn(async () => undefined)

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getActiveProgram: async () => ({ id: 'p', sessions: [{ id: UPPER }, { id: LOWER }] }),
    getSessionPeriodization: current,
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: rows,
    listProgramCompletions: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    advancePhase: async () => state(), advanceProgramPhase, updatePrescriptionStatus: async () => undefined,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as transition } from '@/app/api/ai-periodization/session/[sessionId]/transition/route'

const post = (body: unknown) => transition(Object.assign(new Request(`http://localhost/x`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), { nextUrl: new URL('http://localhost/x') }) as never, { params: Promise.resolve({ sessionId: UPPER }) } as never)

beforeEach(() => vi.clearAllMocks())

describe('a busy program write (#4082 review)', () => {
  it('the transition route answers a busy move as 409 with busy: true, not a 500', async () => {
    advanceProgramPhase.mockRejectedValueOnce(new BusyError())
    const res = await post({ newPhase: 'intensification' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ busy: true, error: expect.stringContaining('try again') })
    // And the same tap goes through once the other writer is done.
    expect((await post({ newPhase: 'intensification' })).status).toBe(200)
  })

  it('a fault that is not a busy refusal still propagates', async () => {
    advanceProgramPhase.mockRejectedValueOnce(new Error('boom'))
    await expect(post({ newPhase: 'intensification' })).rejects.toThrow('boom')
  })

  it('the read-time sync carries on when its write is busy, and still throws anything else', async () => {
    const { syncProgramPhase } = await import('@trainingai/shared/ai-periodization/program-phase')
    const repo = (await (await import('@/lib/data')).getRepository()) as never
    setProgramPendingTransition.mockRejectedValue(new BusyError())
    // The first read of an unmarked aligned program tries a write; a busy one is skipped.
    await expect(syncProgramPhase(repo, 'u', 'p', 'Australia/Brisbane')).resolves.toBeTruthy()
    expect(setProgramPendingTransition).toHaveBeenCalled()
    setProgramPendingTransition.mockRejectedValue(new Error('boom'))
    await expect(syncProgramPhase(repo, 'u', 'p', 'Australia/Brisbane')).rejects.toThrow('boom')
  })
})
