import { describe, it, expect, vi, beforeEach } from 'vitest'

const getWorkoutSessionById         = vi.fn()
const completeWorkoutSession        = vi.fn(async () => {})
const getWorkoutSessionProgramSessionId = vi.fn()
const updatePrescriptionStatus      = vi.fn(async () => {})
const incrementSessionsInPhase      = vi.fn(async () => {})
const getSessionPeriodization       = vi.fn(async () => null)
const setLastSessionRanPrescription = vi.fn(async () => {})

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getWorkoutSessionById,
    completeWorkoutSession,
    getWorkoutSessionProgramSessionId,
    updatePrescriptionStatus,
    incrementSessionsInPhase,
    getSessionPeriodization,
    setLastSessionRanPrescription,
  }),
}))

import { completeWorkoutFromPayload, resolveCompletedAt } from '../complete-workout'

beforeEach(() => {
  getWorkoutSessionById.mockReset()
  completeWorkoutSession.mockClear()
  getWorkoutSessionProgramSessionId.mockReset()
  updatePrescriptionStatus.mockClear()
  incrementSessionsInPhase.mockClear()
  getSessionPeriodization.mockReset().mockResolvedValue(null)
  setLastSessionRanPrescription.mockClear()
})

describe('completeWorkoutFromPayload', () => {
  it('completes a fresh session and consumes the prescription + increments the phase counter exactly once', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    const result = await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

    expect(result).toEqual({ alreadyCompleted: false, programSessionId: 'ps-1' })
    expect(completeWorkoutSession).toHaveBeenCalledTimes(1)
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u1', 'ps-1', 'consumed')
    expect(incrementSessionsInPhase).toHaveBeenCalledWith('u1', 'ps-1')
  })

  it('is idempotent on replay: never double-consumes the prescription or double-increments the phase counter', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: new Date() })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    const result = await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

    expect(result).toEqual({ alreadyCompleted: true, programSessionId: 'ps-1' })
    // Re-stamping completed_at is harmless and still happens...
    expect(completeWorkoutSession).toHaveBeenCalledTimes(1)
    // ...but the one-shot side effects must not re-fire on a replay.
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
    expect(incrementSessionsInPhase).not.toHaveBeenCalled()
  })

  it('skips the phase-counter side effects for a session with no linked program session (AI-dynamic/freeform)', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
    getWorkoutSessionProgramSessionId.mockResolvedValue(null)

    const result = await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

    expect(result).toEqual({ alreadyCompleted: false, programSessionId: null })
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
    expect(incrementSessionsInPhase).not.toHaveBeenCalled()
  })

  it('throws for a session id not owned by the caller instead of silently no-op-ing', async () => {
    getWorkoutSessionById.mockResolvedValue(null)

    await expect(completeWorkoutFromPayload('attacker', { workoutSessionId: 'victim-ws' }))
      .rejects.toThrow(/not owned by user/)
    expect(completeWorkoutSession).not.toHaveBeenCalled()
  })

  it('uses the client-provided completedAtMs instead of server-receipt time when present', async () => {
    // An offline replay: the session started an hour before the timestamp it reports finishing at.
    // (The fixture used to start the session *now* and finish it a year earlier, which the
    // Q-24 §7 startedAt comparison correctly refuses.)
    const completedAtMs = Date.now() - 24 * 60 * 60_000
    getWorkoutSessionById.mockResolvedValue({
      id: 'ws-1', startedAt: new Date(completedAtMs - 60 * 60_000), completedAt: null,
    })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1', completedAtMs })

    expect(completeWorkoutSession).toHaveBeenCalledWith('ws-1', 'u1', new Date(completedAtMs))
  })

  it('falls back to server-receipt time when completedAtMs is absent (legacy client)', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    const before = Date.now()
    await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })
    const stampedDate = completeWorkoutSession.mock.calls[0][2] as Date

    expect(stampedDate.getTime()).toBeGreaterThanOrEqual(before)
  })

  describe('AI-1: setLastSessionRanPrescription (revives the rep-completion signal chain)', () => {
    it.each(['accepted', 'auto_applied'] as const)(
      'records ranPrescription=true when prescriptionStatus is %s',
      async (prescriptionStatus) => {
        getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
        getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')
        getSessionPeriodization.mockResolvedValue({ prescriptionStatus, prescription: { id: 'presc-1' } })

        await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

        expect(setLastSessionRanPrescription).toHaveBeenCalledWith('u1', 'ps-1', true)
      },
    )

    it('records ranPrescription=true when prescriptionStatus is pending with a stored prescription', async () => {
      getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
      getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')
      getSessionPeriodization.mockResolvedValue({ prescriptionStatus: 'pending', prescription: { id: 'presc-1' } })

      await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

      expect(setLastSessionRanPrescription).toHaveBeenCalledWith('u1', 'ps-1', true)
    })

    it('records ranPrescription=false when pending but no prescription is stored', async () => {
      getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
      getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')
      getSessionPeriodization.mockResolvedValue({ prescriptionStatus: 'pending', prescription: null })

      await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

      expect(setLastSessionRanPrescription).toHaveBeenCalledWith('u1', 'ps-1', false)
    })

    it.each(['none', 'dismissed', 'consumed'] as const)(
      'records ranPrescription=false when prescriptionStatus is %s',
      async (prescriptionStatus) => {
        getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
        getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')
        getSessionPeriodization.mockResolvedValue({ prescriptionStatus, prescription: null })

        await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

        expect(setLastSessionRanPrescription).toHaveBeenCalledWith('u1', 'ps-1', false)
      },
    )

    it('records ranPrescription=false when there is no periodization state at all (non-AI-dynamic program)', async () => {
      getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
      getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')
      getSessionPeriodization.mockResolvedValue(null)

      await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

      expect(setLastSessionRanPrescription).toHaveBeenCalledWith('u1', 'ps-1', false)
    })

    it('does not record on a replayed (already-completed) session', async () => {
      getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: new Date() })
      getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

      await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })

      expect(setLastSessionRanPrescription).not.toHaveBeenCalled()
    })
  })
})

// Q-24 §7: `completedAtMs` was accepted unbounded and never compared to the session's own start.
describe('resolveCompletedAt', () => {
  const now = new Date('2026-07-29T10:00:00Z')
  const startedAt = new Date('2026-07-29T09:00:00Z')

  it('keeps a client timestamp that sits after the start and is not in the future', () => {
    const t = new Date('2026-07-29T09:52:00Z')
    expect(resolveCompletedAt(t.getTime(), startedAt, now)).toEqual(t)
  })

  it('keeps an offline replay from days ago — nothing about it is unusable', () => {
    const oldStart = new Date('2026-07-20T09:00:00Z')
    const t = new Date('2026-07-20T10:05:00Z')
    expect(resolveCompletedAt(t.getTime(), oldStart, now)).toEqual(t)
  })

  it('falls back to server time when the client says it finished before it started', () => {
    expect(resolveCompletedAt(startedAt.getTime() - 1, startedAt, now)).toEqual(now)
  })

  it('falls back to server time for a clock far in the future', () => {
    expect(resolveCompletedAt(now.getTime() + 4 * 60 * 60_000, startedAt, now)).toEqual(now)
  })

  it('tolerates an hour of ordinary clock skew rather than discarding it', () => {
    const skewed = now.getTime() + 30 * 60_000
    expect(resolveCompletedAt(skewed, startedAt, now)).toEqual(new Date(skewed))
  })

  it('falls back to server time for a non-finite or out-of-Date-range value', () => {
    // 1e20 ms is outside the Date range; `new Date(1e20)` is Invalid and 500s the driver.
    expect(resolveCompletedAt(Infinity, startedAt, now)).toEqual(now)
    expect(resolveCompletedAt(1e20, startedAt, now)).toEqual(now)
    expect(resolveCompletedAt(-1, startedAt, now)).toEqual(now)
  })

  it('falls back to server time when absent, as before', () => {
    expect(resolveCompletedAt(undefined, startedAt, now)).toEqual(now)
  })
})
