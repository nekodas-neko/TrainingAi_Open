// Q-330: this route estimated a just-finished session's calories from `getBodyMetricsBaseline`,
// which orders `asc(date)` — the FIRST weight ever logged. On production that was 70.5 kg against a
// current 71.5 kg, and the gap widens with every kilogram gained or lost, so the estimate never
// converges. It must read the LATEST confirmed weight.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { estWorkoutKcal, metForActivity } from '@trainingai/shared/health/workout-energy'

const BASELINE_KG = 60
const CURRENT_KG = 100
// Elliptical — a real activity whose MET clears the formula's 1.5 floor under BOTH the real
// constants and the synthetic fixtures, so the estimate is non-zero and the assertions below
// actually compare something. The `met` precondition proves that rather than assuming it.
const ACTIVITY_ID = 7
const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const DURATION_MIN = 60
const AGE_DOB = '1993-06-15'

const getBodyMetricsBaseline = vi.fn(async () => ({ weightKg: BASELINE_KG, bodyFatPct: null }))
const getMostRecentConfirmedWeightKg = vi.fn(async () => CURRENT_KG as number | null)

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'q330-user', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: vi.fn(async () => ({
    getWorkoutSessionDetail: vi.fn(async () => ({
      startedAt: new Date('2026-08-20T01:00:00Z'),
      completedAt: new Date('2026-08-20T02:00:00Z'),
      sessionRpe: 6,
      exercises: [],
    })),
    getUserById: vi.fn(async () => ({ dateOfBirth: AGE_DOB, sex: 'male' })),
    getBodyMetricsBaseline,
    getMostRecentConfirmedWeightKg,
  })),
}))

import { GET } from '@/app/api/workout-sessions/[id]/energy/route'

const call = () =>
  GET(new Request(`http://x/api/workout-sessions/${SESSION_ID}/energy?activityId=${ACTIVITY_ID}`), {
    params: Promise.resolve({ id: SESSION_ID }),
  })

const ageYears = (Date.now() - new Date(AGE_DOB).getTime()) / (365.25 * 24 * 3600 * 1000)
const kcalAt = (weightKg: number) =>
  estWorkoutKcal({ durationMin: DURATION_MIN, ageYears, weightKg, sex: 'male', activityId: ACTIVITY_ID, intensity: 'moderate' })!

describe('session energy — which weight the estimate uses', () => {
  beforeEach(() => {
    getBodyMetricsBaseline.mockClear()
    getMostRecentConfirmedWeightKg.mockClear()
  })

  // Guards the whole file against passing vacuously: below the 1.5 MET floor every estimate is 0
  // and the two weights would agree at zero.
  it('uses an activity whose MET actually produces energy', () => {
    expect(metForActivity(ACTIVITY_ID, 'moderate')!).toBeGreaterThan(1.5)
    expect(kcalAt(CURRENT_KG)).toBeGreaterThan(0)
    expect(Math.round(kcalAt(CURRENT_KG))).not.toBe(Math.round(kcalAt(BASELINE_KG)))
  })

  it('estimates from the latest confirmed weight, not the earliest-ever baseline', async () => {
    const body = await (await call()).json()
    expect(body.kcal).toBe(Math.round(kcalAt(CURRENT_KG)))
    expect(body.kcal).not.toBe(Math.round(kcalAt(BASELINE_KG)))
    expect(getMostRecentConfirmedWeightKg).toHaveBeenCalledTimes(1)
    expect(getBodyMetricsBaseline).not.toHaveBeenCalled()
  })

  it('reports the profile gap instead of a number when no weight has ever been logged', async () => {
    getMostRecentConfirmedWeightKg.mockResolvedValueOnce(null)
    const body = await (await call()).json()
    expect(body.kcal).toBeNull()
    expect(body.reason).toContain('body weight')
  })
})
