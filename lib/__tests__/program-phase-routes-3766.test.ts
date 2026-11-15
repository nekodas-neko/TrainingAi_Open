/**
 * #3766: the transition route moves the PROGRAM once its session types share one phase, and only
 * the one session type while the program still waits for its switch-over.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
type Row = Record<string, unknown>

const UPPER = '00000000-0000-4000-8000-0000000037aa'
const LOWER = '00000000-0000-4000-8000-0000000037bb'
const start = new Date('2026-11-23T00:00:00+10:00')

const state = (over: Row = {}) => ({
  id: 'st', userId: 'u', programSessionId: UPPER, phase: 'accumulation', phaseStartedAt: start,
  sessionsInPhase: 3, baselineComplete: true, baseline1rm: {}, prescription: null,
  prescriptionGeneratedAt: null, prescriptionExpiresAt: null, prescriptionStatus: 'pending',
  lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null,
  updatedAt: new Date(), ...over,
})

const rows = vi.fn(async () => [state(), state({ programSessionId: LOWER })] as Row[])
const advancePhase = vi.fn(async () => state())
const advanceProgramPhase = vi.fn(async () => state())
const updatePrescriptionStatus = vi.fn(async () => undefined)

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getActiveProgram: async () => ({ id: 'p', sessions: [{ id: UPPER }, { id: LOWER }] }),
    getSessionPeriodization: async () => state(),
    reconcileSessionsInPhase: async () => undefined,
    listSessionPeriodizationForProgram: rows,
    listProgramCompletions: async () => [],
    setProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    advancePhase, advanceProgramPhase, updatePrescriptionStatus,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as transition } from '@/app/api/ai-periodization/session/[sessionId]/transition/route'

const post = (body: unknown) => transition(Object.assign(new Request(`http://localhost/x`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), { nextUrl: new URL('http://localhost/x') }) as never, { params: Promise.resolve({ sessionId: UPPER }) } as never)

beforeEach(() => vi.clearAllMocks())

describe('POST …/transition (#3766)', () => {
  it('moves every session type when the program shares one phase', async () => {
    expect((await post({ newPhase: 'intensification' })).status).toBe(200)
    expect(advanceProgramPhase).toHaveBeenCalledWith('u', UPPER, 'intensification')
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u', UPPER, 'consumed')
  })

  it('moves only this session type while the program waits for its switch-over', async () => {
    // Lower is still in a deload it has not finished, so the switch-over has not happened yet.
    rows.mockResolvedValueOnce([state(), state({ programSessionId: LOWER, phase: 'deload', sessionsInPhase: 1 })])
    expect((await post({ newPhase: 'intensification' })).status).toBe(200)
    expect(advancePhase).toHaveBeenCalledWith('u', UPPER, 'intensification')
    expect(advanceProgramPhase).not.toHaveBeenCalled()
  })
})
