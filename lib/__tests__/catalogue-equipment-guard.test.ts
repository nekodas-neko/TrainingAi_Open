import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildEquipmentSet, equipmentEligible } from '@trainingai/shared/workout/equipment'

/**
 * BF-129 — an `exercise_library` row with no equipment passes EVERY equipment filter, because both
 * read `ex.equipment.length === 0 || ex.equipment.some(...)`. That is how a home gym with no
 * machines was offered Machine Chest Press.
 *
 * The root cause is a WRITE path, not the seed: production held 151 catalogue rows against a
 * freshly-migrated 141, so the drifted rows were created at runtime through POST /api/exercises,
 * whose `equipment` field defaults to `[]`. Migration 269 cleaned the existing rows; these cases
 * pin the parts that stop it happening again.
 *
 * The route handler is exercised directly rather than a copy of its schema — a re-declared schema
 * keeps passing after the route stops enforcing anything, which is the failure this guards.
 */
const createExercise = vi.fn(async () => ({ id: 'x-1', name: 'X' }))
const renameExercise = vi.fn(async () => ({ id: 'x-1', name: 'X' }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', isAdmin: true } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ createExercise, renameExercise }) }))
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => undefined,
  adminErrorResponse: () => new Response('forbidden', { status: 403 }),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { POST } from '@/app/api/exercises/route'

beforeEach(() => { createExercise.mockClear(); renameExercise.mockClear() })

const post = (body: object) =>
  POST(new Request('http://localhost/api/exercises', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)

describe('POST /api/exercises refuses an unlabelled catalogue row', () => {
  it('rejects a create with no equipment, and says what to do about it', async () => {
    const res = await post({ name: 'Machine Shrug', muscles: [], equipment: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/bodyweight/)
    expect(createExercise).not.toHaveBeenCalled()
  })

  it('rejects a create that omits equipment entirely — the default is the hole', async () => {
    const res = await post({ name: 'Machine Shrug', muscles: [] })
    expect(res.status).toBe(400)
    expect(createExercise).not.toHaveBeenCalled()
  })

  it('accepts bodyweight, which is the value an exercise needing no kit should carry', async () => {
    const res = await post({ name: 'Pike Push-Up', muscles: [], equipment: ['bodyweight'] })
    expect(res.status).toBe(201)
    expect(createExercise).toHaveBeenCalledTimes(1)
  })

  it('still accepts a MERGE, which sends no equipment and never reaches createExercise', async () => {
    const res = await post({ name: 'Dumbbell Lunge', mergeWithId: '00000000-0000-4000-8000-000000000001' })
    expect(res.status).toBe(200)
    expect(renameExercise).toHaveBeenCalledTimes(1)
    expect(createExercise).not.toHaveBeenCalled()
  })

  it('keeps every OTHER validation failure generic — only the equipment message is surfaced', async () => {
    const res = await post({ name: '', muscles: [], equipment: ['barbell'] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid body')
  })
})

/**
 * The generation filter's own half, through the SHARED predicate both routes now call — not a copy
 * of it. `buildEquipmentSet`/`equipmentEligible` were three byte-identical inline copies before
 * this; a test that re-declared the rule would keep passing after the routes stopped applying it.
 */
describe('equipmentEligible — the filter both generation routes use', () => {
  const homeGym = buildEquipmentSet(['barbell', 'dumbbell', 'cable'])

  it('excludes an unlabelled row instead of passing it', () => {
    expect(equipmentEligible([], homeGym)).toBe(false)
  })

  it('still excludes a machine exercise from a home gym — the reported symptom', () => {
    expect(equipmentEligible(['machine'], homeGym)).toBe(false)
  })

  it('keeps a row whose equipment the lifter owns, including one of several', () => {
    expect(equipmentEligible(['bodyweight'], homeGym)).toBe(true)
    expect(equipmentEligible(['bodyweight', 'machine'], homeGym)).toBe(true)
  })

  it('matches case-insensitively, as the routes did inline', () => {
    expect(equipmentEligible(['Barbell'], homeGym)).toBe(true)
  })
})

describe('buildEquipmentSet', () => {
  it('always grants bodyweight — it is the floor, not a choice', () => {
    expect(buildEquipmentSet([]).has('bodyweight')).toBe(true)
    expect(equipmentEligible(['bodyweight'], buildEquipmentSet([]))).toBe(true)
  })

  it('expands full_gym to the whole catalogue vocabulary', () => {
    const gym = buildEquipmentSet(['full_gym'])
    for (const e of ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight']) {
      expect(gym.has(e), e).toBe(true)
    }
  })

  it('grants only what was ticked, plus bodyweight', () => {
    expect([...buildEquipmentSet(['cable'])].sort()).toEqual(['bodyweight', 'cable'])
  })
})
