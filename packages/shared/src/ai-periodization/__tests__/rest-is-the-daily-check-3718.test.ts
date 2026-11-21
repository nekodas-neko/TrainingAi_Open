// #3718 — "rest today" is the app's own daily check, worked out on every open. The AI only plans
// training: its schema and prompt offer no rest-day answer, and a rest-day answer stored before the
// change is stale on every read, never the plan. No model is called here.
import { describe, it, expect } from 'vitest'
import { PrescriptionSchema } from '../prescription-schema'
import { buildSystemPrompt } from '../prompt'
import {
  hidePrescriptionAgedOutOnScreen,
  isOneDayPrescription,
  prescribedDeloadDefault,
  prescriptionAgedOut,
  prescriptionAgedOutOnScreen,
  servePrescriptionState,
} from '../prescription-expiry'
import { isAiPrescriptionPending } from '../prescription-pending'
import { computeAiDynamicNextSession, type AiDynamicInput } from '../ai-dynamic'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { ProgramSession } from '@trainingai/shared/types/program'

const answer = (phase_action: string) => ({
  phase: 'accumulation', phase_action, deload: false, confidence: 0.7, reasoning: 'r',
  exercises: [{ session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 5, pct: 75, rest_sec: 120 }],
})

describe('the AI only plans training', () => {
  it('the schema has no rest-day answer', () => {
    expect(PrescriptionSchema.safeParse(answer('rest_day_recommended')).success).toBe(false)
    for (const action of ['stay', 'transition_recommended', 'deload_recommended', 'session_swap_recommended']) {
      expect(PrescriptionSchema.safeParse(answer(action)).success).toBe(true)
    }
  })

  it('the prompt never offers one, and tells the model the app decides rest', () => {
    for (const goal of ['strength', 'hypertrophy', 'powerbuilding'] as const) {
      const p = buildSystemPrompt(goal)
      expect(p).not.toContain('rest_day_recommended')
      expect(p).not.toMatch(/skipping training entirely/)
      expect(p).toContain('Whether to rest today is not yours to decide')
    }
  })
})

describe('a stored rest-day answer is stale, never the plan', () => {
  const now = new Date('2026-11-21T00:00:00Z')
  const live = new Date(now.getTime() + 6 * 3_600_000)
  const restRow = (prescriptionStatus: 'pending' | 'accepted' | 'auto_applied') => ({
    prescription: { phaseAction: 'rest_day_recommended', deload: false } as AiPrescription,
    prescriptionStatus,
    prescriptionExpiresAt: live,
  })

  it('ages out before its expiry, whatever its status', () => {
    for (const status of ['pending', 'accepted', 'auto_applied'] as const) {
      expect(prescriptionAgedOut(restRow(status), now)).toBe(true)
    }
    // An unexpired training plan is still the plan.
    expect(prescriptionAgedOut({ ...restRow('pending'), prescription: { phaseAction: 'stay' } as AiPrescription }, now)).toBe(false)
  })

  it('every read hides it, so the open regenerates a training plan in its place', () => {
    const served = servePrescriptionState(restRow('pending'), now)
    expect(served.prescription).toBeNull()
    expect(served.prescriptionAgedOut).toBe(true)
    expect(isAiPrescriptionPending(restRow('pending'), { isAiDynamic: true, isBaselinePhase: false }, now)).toBe(true)
  })

  it('a screen holding one off the wire hides it too, with no expiry to go on', () => {
    const wire = { prescriptionStatus: 'pending', prescription: { phaseAction: 'rest_day_recommended', deload: false } }
    expect(prescriptionAgedOutOnScreen(wire, now)).toBe(true)
    expect(hidePrescriptionAgedOutOnScreen(wire, now).prescription).toBeNull()
    expect(prescribedDeloadDefault(wire, now)).toBe(false)
  })

  it('the one-day expiry rule no longer names it: nothing writes one now', () => {
    expect(isOneDayPrescription({ phaseAction: 'rest_day_recommended' })).toBe(false)
    expect(isOneDayPrescription({ phaseAction: 'session_swap_recommended' })).toBe(true)
  })

  it('`none` is still nothing to age out', () => {
    expect(prescriptionAgedOut({ ...restRow('pending'), prescriptionStatus: 'none' }, now)).toBe(false)
  })
})

describe('the daily check decides, fresh on each open', () => {
  const session: ProgramSession = {
    id: 's1', programId: 'p', name: 'Session A', position: 0, timeBudgetMinutes: 60,
    exercises: [{ id: 'e1', sessionId: 's1', exerciseName: 'Lift', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' }],
  }
  const base: AiDynamicInput = {
    sessions: [session], muscleAssignments: {}, muscleRecovery: [], history: [], soreMuscles: [],
    readinessScore: 85, readinessModelVersion: READINESS_MODEL_VERSION, temperatureDeviation: null,
    timezone: 'Australia/Brisbane', reminderEnabled: false, reminderTime: null, sleepTrend: null,
    energyLevel: null, hrvTrend: null,
  } as unknown as AiDynamicInput

  it('a mid-morning sick check-in changes the answer on the next open, with no plan involved', () => {
    expect(computeAiDynamicNextSession(base).deloadOrRestRecommended).toBe(false)
    const sick = computeAiDynamicNextSession({ ...base, selfReportedSick: true })
    expect(sick.deloadOrRestRecommended).toBe(true)
    expect(sick.deloadStrength).toBe('strong')
    // It still names a session to train: a suggested rest never removes the plan.
    expect(sick.session?.id).toBe('s1')
  })
})
