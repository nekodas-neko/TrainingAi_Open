/**
 * #3779 — the walking plan through the existing running-plan routes, and the route for the two
 * choices it leaves to the person. The settle is mocked: its own tests are
 * `lib/health/__tests__/walking-plan-service-3779.test.ts`; these assert on what each ROUTE decides.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initialWalkingState } from '@trainingai/shared/running/walking-plan'

type Row = Record<string, unknown>

const state = () => initialWalkingState({
  startDate: '2026-11-02', ownStepsGoal: null, recentDailySteps: [8000], recentWeeklyMinutes: [90, 90, 90, 90], fallbackStepGoal: 8000,
})
let plan: Row | null = null
const getActiveRunningPlan = vi.fn(async () => plan)
const saveRunningPlan = vi.fn(async (_u: string, p: Row) => ({ id: 'plan-w', createdAt: new Date(), ...p }) as Row)
const getPrescribedRuns = vi.fn(async () => [{ id: 'r-1', planId: 'plan-w', date: 'x', status: 'pending' }] as Row[])
const updateRunningPlanSnapshot = vi.fn(async (_u: string, _id: string, snap: Row) => ({ ...plan, fitnessSnapshot: snap }) as Row)
const resolveSnapshot = vi.fn(async () => ({}))
const settleWalkingPlan = vi.fn(async (..._a: unknown[]) => ({ kind: 'walking', targets: { stepsPerDay: 8000 } }) as Row)

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getActiveRunningPlan, saveRunningPlan, getPrescribedRuns, updateRunningPlanSnapshot })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/health/walking-plan-service', async (orig) => ({
  ...(await orig() as object),
  settleWalkingPlan: (...a: unknown[]) => settleWalkingPlan(...a),
}))
vi.mock('@trainingai/shared/running/assemble-plan-context', () => ({
  assembleInputs: vi.fn(), resolveSnapshot: (...a: unknown[]) => resolveSnapshot(...(a as [])), resolvePushContext: vi.fn(),
}))

import { GET as readPlan, POST as createPlan } from '@/app/api/running-plan/route'
import { POST as overrideRun } from '@/app/api/running-plan/override/route'
import { POST as walkingChoice } from '@/app/api/running-plan/walking/route'

const json = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const walkingPlan = (snap: Row = { walkingPlan: state() }) => ({
  id: 'plan-w', userId: 'u-1', goalKind: 'walking', frameworkKey: 'walking-heart-health', fitnessSnapshot: snap, isActive: true, createdAt: new Date(),
})

beforeEach(() => { vi.clearAllMocks(); plan = walkingPlan() })

describe('GET /api/running-plan for a walking plan', () => {
  it('keeps the running plan\'s shape, prescribes no run, and puts the walking week under `walking`', async () => {
    const res = await readPlan()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.prescription).toBeNull()
    expect(body.heartHealth).toEqual({ days: [] })
    expect(body.zoneTargets).toBeUndefined()
    expect(body.goal.key).toBe('walking')
    expect(body.run.id).toBe('r-1')
    expect(body.walking).toEqual({ kind: 'walking', targets: { stepsPerDay: 8000 } })
    expect(settleWalkingPlan).toHaveBeenCalledTimes(1)
    expect(resolveSnapshot).not.toHaveBeenCalled()
  })
})

describe('POST /api/running-plan with the walking goal', () => {
  it('saves a walking plan with no run framework and no fitness snapshot, then settles it', async () => {
    const res = await createPlan(json({ goalKind: 'walking' }))
    expect(res.status).toBe(200)
    expect(saveRunningPlan).toHaveBeenCalledWith('u-1', expect.objectContaining({ goalKind: 'walking', frameworkKey: 'walking-heart-health', fitnessSnapshot: {} }))
    expect(resolveSnapshot).not.toHaveBeenCalled()
    expect((await res.json()).walking.kind).toBe('walking')
  })
})

describe('POST /api/running-plan/override for a walking plan', () => {
  it('refuses: there is no run to override', async () => {
    const res = await overrideRun(json({ runType: 'easy', durationMin: 30 }))
    expect(res.status).toBe(409)
  })
})

describe('POST /api/running-plan/walking', () => {
  it('refuses a body that names no known choice', async () => {
    expect((await walkingChoice(json({ action: 'minutes-ceiling', ceiling: 200 }))).status).toBe(400)
    expect((await walkingChoice(json({ action: 'step-back', target: 'steps', extra: 1 }))).status).toBe(400)
  })
  it('404s without a walking plan', async () => {
    plan = { ...walkingPlan(), goalKind: 'heart_health', frameworkKey: 'zone2-base' }
    expect((await walkingChoice(json({ action: 'minutes-ceiling', ceiling: 300 }))).status).toBe(404)
  })
  it('sets the "heart health plus" ceiling from the plan\'s own state', async () => {
    const res = await walkingChoice(json({ action: 'minutes-ceiling', ceiling: 300 }))
    expect(res.status).toBe(200)
    const snap = updateRunningPlanSnapshot.mock.calls[0][2] as { walkingPlan: { minutesCeiling: number; stepsTarget: number } }
    expect(snap.walkingPlan.minutesCeiling).toBe(300)
    expect(snap.walkingPlan.stepsTarget).toBe(state().stepsTarget)
  })
  it('409s a step back that is not on offer, and writes nothing', async () => {
    expect((await walkingChoice(json({ action: 'step-back', target: 'minutes' }))).status).toBe(409)
    expect(updateRunningPlanSnapshot).not.toHaveBeenCalled()
  })
  it('applies an offered step back', async () => {
    plan = walkingPlan({ walkingPlan: { ...state(), minutesTarget: 120, minutesLastMet: 105, minutesMissStreak: 2 } })
    expect((await walkingChoice(json({ action: 'step-back', target: 'minutes' }))).status).toBe(200)
    const snap = updateRunningPlanSnapshot.mock.calls[0][2] as { walkingPlan: { minutesTarget: number } }
    expect(snap.walkingPlan.minutesTarget).toBe(105)
  })
})
