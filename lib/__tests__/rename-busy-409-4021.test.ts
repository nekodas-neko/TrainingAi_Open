// #4021: a rename cancelled by Postgres's statement timeout (57014) while waiting on a lock answers
// 409 "busy, try again" from both rename routes, not a generic 500. The real cancel against a held
// lock is in `lib/data/postgres/__tests__/exercise-rename-leftovers-4021.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const renameExercise = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: 'e1', name: 'X' }))
const adminUpdateExercise = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: 'e1', name: 'X' }))
const reportServerError = vi.fn((..._a: unknown[]) => undefined)
const dbInsert = vi.fn()

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', isAdmin: true } }) }))
vi.mock('@/lib/admin', () => ({ requireAdmin: async () => undefined, adminErrorResponse: () => new Response(null, { status: 403 }) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data/exercise-muscle-map-cache', () => ({ invalidateExerciseMuscleMap: () => undefined }))
vi.mock('@/lib/data/postgres/client', () => ({
  getDb: () => ({ insert: dbInsert, delete: () => ({ where: async () => undefined }) }),
  ensureSchema: async () => undefined,
}))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ renameExercise, adminUpdateExercise })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST } from '@/app/api/exercises/route'
import { PATCH } from '@/app/api/admin/exercises/route'

const ID = '00000000-0000-4000-8000-0000000000e1'
// What the driver raises, and how Drizzle wraps it.
const cancel = () => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) })
const send = (handler: (r: NextRequest) => Promise<Response>, method: string, body: unknown) =>
  handler(new NextRequest('http://localhost/api/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => { for (const m of [renameExercise, adminUpdateExercise, reportServerError, dbInsert]) m.mockClear() })

describe('a rename cancelled by the statement timeout', () => {
  it('POST /api/exercises (mergeWithId) answers 409 busy, and still files the timeout', async () => {
    renameExercise.mockRejectedValueOnce(cancel())
    const res = await send(POST, 'POST', { name: 'New', mergeWithId: ID })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/busy/i)
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })

  it('PATCH /api/admin/exercises answers 409 busy, writes no gif row, and still files the timeout', async () => {
    adminUpdateExercise.mockRejectedValueOnce(cancel())
    const res = await send(PATCH, 'PATCH', { id: ID, name: 'New', equipment: ['barbell'], muscles: [] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/busy/i)
    expect(dbInsert).not.toHaveBeenCalled()
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })

  it('any other failure is still a 500 and is still reported', async () => {
    renameExercise.mockRejectedValueOnce(new Error('boom'))
    const res = await send(POST, 'POST', { name: 'New', mergeWithId: ID })
    expect(res.status).toBe(500)
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })
})
