/**
 * #4082 review 2: the routes of the writers that now take the lift-write lock answer a busy lock as a 409
 * refusal with nothing changed, never a 500, and never a failed save of something that was saved.
 *
 *  - the program editor's save voids the old plans inside the save (`voidPrescriptions`), and does not call
 *    `clearProgramPrescriptions` afterwards: a busy lock means nothing was saved, an ok means they are void;
 *  - the program delete, the baseline skip, and the exercise rename routes map a busy write to 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BusyError } from '@trainingai/shared/errors'

const SESSION_ID = '00000000-0000-4000-8000-00000000a001'
const PROGRAM_ID = '00000000-0000-4000-8000-00000000b001'

const saveProgram = vi.fn(async (_u: string, p: Record<string, unknown>, _o?: unknown) => ({ ...p, id: p.id || 'p-1' }))
const clearProgramPrescriptions = vi.fn(async () => undefined)
const deleteProgram = vi.fn(async () => undefined)
const setBaselineComplete = vi.fn(async () => ({}))
const renameExercise = vi.fn(async () => ({}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/admin', () => ({ requireAdmin: async () => undefined, adminErrorResponse: () => new Response(null, { status: 403 }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    saveProgram, clearProgramPrescriptions, deleteProgram, setBaselineComplete, renameExercise,
    phaseSetIdOwned: async () => true, progressionStyleIdsOwned: async () => true,
    listPrograms: async () => [], listVolumeTargets: async () => [{}], replaceVolumeTargets: async () => undefined,
    updateProgramPhaseSettings: async () => undefined, autoRecalibrateCycleAnchor: async () => undefined,
    linkPhaseSetOwnership: async () => undefined,
    getSessionPeriodization: async () => ({ baselineComplete: false }),
    listPersonalRecords: async () => new Map([['Bench Press', 100]]),
    getActiveProgram: async () => ({ id: PROGRAM_ID, sessions: [{ id: SESSION_ID, exercises: [{ id: 'e1', exerciseName: 'Bench Press' }] }] }),
    getExerciseEstimates: async () => [], ensureSessionPeriodization: async () => ({}),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { POST as postProgram, DELETE as deleteProgramRoute } from '@/app/api/workout-templates/route'
import { POST as completeBaseline } from '@/app/api/ai-periodization/baseline/complete/route'
import { POST as renameRoute } from '@/app/api/exercises/route'

const call = (handler: (req: never) => Promise<Response>, method: string, body: object) =>
  handler(Object.assign(new Request('http://localhost/x', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { nextUrl: new URL('http://localhost/x') }) as never)

const PROGRAM = {
  name: 'Split', isActive: true, phaseMode: 'manual', sessionsPerCycle: 1, trainingGoal: 'strength', autoApplyPrescriptions: false,
  sessions: [{
    id: SESSION_ID, programId: PROGRAM_ID, name: 'Upper A', position: 0, timeBudgetMinutes: 60,
    exercises: [{ id: '00000000-0000-4000-8000-00000000c001', exerciseName: 'Bench Press', styleId: null }],
  }],
}

beforeEach(() => vi.clearAllMocks())

describe('the program editor save (#4082 review 2)', () => {
  it('asks the save to void the old plans in the same transaction, and does not void them again afterwards', async () => {
    const res = await call(postProgram, 'POST', { program: { ...PROGRAM, id: PROGRAM_ID } })
    expect(res.status).toBe(200)
    expect(saveProgram).toHaveBeenCalledTimes(1)
    expect(saveProgram.mock.calls[0][2]).toEqual({ voidPrescriptions: true })
    expect(clearProgramPrescriptions).not.toHaveBeenCalled()
  })

  it('a busy save is a 409 with nothing saved: the answer is true because the plans are voided in the same write', async () => {
    saveProgram.mockRejectedValueOnce(new BusyError())
    const res = await call(postProgram, 'POST', { program: { ...PROGRAM, id: PROGRAM_ID } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('try again') })
    expect(reportServerError).not.toHaveBeenCalled()
    // The same save goes through once the other writer is done.
    expect((await call(postProgram, 'POST', { program: { ...PROGRAM, id: PROGRAM_ID } })).status).toBe(200)
  })
})

describe('the program delete (#4082 review 2)', () => {
  it('a busy delete is a 409 refusal, nothing deleted; an ordinary fault still propagates', async () => {
    deleteProgram.mockRejectedValueOnce(new BusyError())
    const busy = await call(deleteProgramRoute, 'DELETE', { id: PROGRAM_ID })
    expect(busy.status).toBe(409)
    deleteProgram.mockRejectedValueOnce(new Error('connection lost'))
    await expect(call(deleteProgramRoute, 'DELETE', { id: PROGRAM_ID })).rejects.toThrow('connection lost')
    expect((await call(deleteProgramRoute, 'DELETE', { id: PROGRAM_ID })).status).toBe(200)
  })
})

describe('the baseline skip route (#4082 review 2)', () => {
  it('a busy completion is 409 with busy: true and nothing written', async () => {
    setBaselineComplete.mockRejectedValueOnce(new BusyError())
    const res = await call(completeBaseline, 'POST', { sessionId: SESSION_ID })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ busy: true })
  })
})

describe('the exercise rename route (#4082 review 2)', () => {
  const lockError = (code: string) => Object.assign(new Error('lock'), { code })
  for (const code of ['55P03', '40P01', '57014']) {
    it(`${code} while renaming is the existing "busy" 409, nothing renamed`, async () => {
      renameExercise.mockRejectedValueOnce(lockError(code))
      const res = await call(renameRoute, 'POST', { mergeWithId: '00000000-0000-4000-8000-00000000d001', name: 'Renamed' })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('busy') })
    })
  }
})
