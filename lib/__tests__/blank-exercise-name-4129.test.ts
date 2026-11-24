// #4129: the routes that create or rename an exercise, or save a program, answer a name with no
// visible character with a plain 400 (never a 500) and write nothing; real names pass untouched.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const createExercise = vi.fn(async (e: { name: string }) => ({ id: 'x-1', name: e.name }))
const renameExercise = vi.fn(async (_u: string, _id: string, name: string) => ({ id: 'x-1', name }))
const saveProgram = vi.fn(async (_u: string, p: Record<string, unknown>) => ({ ...p, id: 'prog-1' }))
const repo = {
  createExercise, renameExercise, saveProgram,
  upsertExercise: vi.fn(async (e: { name: string }) => ({ id: 'x-2', name: e.name })),
  adminUpdateExercise: vi.fn(async (e: { name: string }) => ({ id: 'x-2', name: e.name })),
  getUserById: vi.fn(async () => ({ isActive: true, isAdmin: true })),
  phaseSetIdOwned: vi.fn(async () => true), progressionStyleIdsOwned: vi.fn(async () => true),
  listPrograms: vi.fn(async () => []), updateProgramPhaseSettings: vi.fn(), autoRecalibrateCycleAnchor: vi.fn(),
  linkPhaseSetOwnership: vi.fn(), listVolumeTargets: vi.fn(async () => []), replaceVolumeTargets: vi.fn(),
}

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', isAdmin: true } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/admin', () => ({ requireAdmin: async () => undefined, adminErrorResponse: () => new Response('forbidden', { status: 403 }) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/data/exercise-muscle-map-cache', () => ({ invalidateExerciseMuscleMap: () => undefined }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => undefined }))

import { POST as createRoute } from '@/app/api/exercises/route'
import { POST as adminPost, PATCH as adminPatch } from '@/app/api/admin/exercises/route'
import { POST as templatesPost } from '@/app/api/workout-templates/route'

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const MERGE_ID = '00000000-0000-4000-8000-000000000001'
const BLANK = ['​', 'ㅤ', '⠀', '​‍﻿']
const REAL = ['می‌رود', '💪', '벤치 프레스', '卧推', 'پرس سینه', 'a'.repeat(120)]

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/exercises (#4129)', () => {
  it.each(BLANK)('refuses a create named %j with a 400 and a plain message, and creates nothing', async n => {
    const res = await createRoute(json('/api/exercises', 'POST', { name: n, equipment: ['Cable'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give the exercise a name')
    expect(createExercise).not.toHaveBeenCalled()
  })
  it('refuses an empty name with the same plain message, not "Invalid body"', async () => {
    const res = await createRoute(json('/api/exercises', 'POST', { name: '', equipment: ['Cable'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give the exercise a name')
    expect(createExercise).not.toHaveBeenCalled()
  })
  it.each(BLANK)('refuses a rename to %j too', async n => {
    const res = await createRoute(json('/api/exercises', 'POST', { name: n, mergeWithId: MERGE_ID }))
    expect(res.status).toBe(400)
    expect(renameExercise).not.toHaveBeenCalled()
  })
  it.each(REAL)('creates %j untouched', async n => {
    const res = await createRoute(json('/api/exercises', 'POST', { name: n, equipment: ['Cable'] }))
    expect(res.status).toBe(201)
    expect(createExercise.mock.calls[0][0].name).toBe(n)
  })
  it('still says what to do about equipment', async () => {
    const res = await createRoute(json('/api/exercises', 'POST', { name: 'Machine Shrug' }))
    expect((await res.json()).error).toMatch(/bodyweight/)
  })
})

describe('the admin exercise routes (#4129)', () => {
  const ID = '00000000-0000-4000-8000-0000000000e1'
  it.each(BLANK)('POST refuses %j', async n => {
    const res = await adminPost(json('/api/admin/exercises', 'POST', { name: n, equipment: ['barbell'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give the exercise a name')
    expect(repo.upsertExercise).not.toHaveBeenCalled()
  })
  it.each(BLANK)('PATCH refuses %j', async n => {
    const res = await adminPatch(json('/api/admin/exercises', 'PATCH', { id: ID, name: n, equipment: ['barbell'] }))
    expect(res.status).toBe(400)
    expect(repo.adminUpdateExercise).not.toHaveBeenCalled()
  })
  it('accepts a real name', async () => {
    expect((await adminPost(json('/api/admin/exercises', 'POST', { name: 'Squat', equipment: ['barbell'] }))).status).toBe(201)
  })
})

describe('POST /api/workout-templates (#4129)', () => {
  const program = (...names: string[]) => ({
    program: { name: 'Push', sessions: [{ id: 's1', name: 'Day', exercises: names.map((n, i) => ({ id: `e${i}`, exerciseName: n })) }] },
  })
  it.each(BLANK)('refuses a program with one lift named %j, saving nothing', async n => {
    const res = await templatesPost(json('/api/workout-templates', 'POST', program('Bench Press', n)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give the exercise a name')
    expect(saveProgram).not.toHaveBeenCalled()
  })
  it('saves a program of real names, and a lift renamed from a blank one or deleted', async () => {
    for (const body of [program('Bench Press', ...REAL), program('Cable Row'), program()]) {
      expect((await templatesPost(json('/api/workout-templates', 'POST', body))).status).toBe(200)
    }
    expect(saveProgram).toHaveBeenCalledTimes(3)
  })
})
