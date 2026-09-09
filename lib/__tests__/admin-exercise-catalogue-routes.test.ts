/**
 * PS-39 — `admin/exercises`, the last route [#1019] changed without a test of its own.
 *
 * One file, four verbs, and three documented past defects that are each a case here:
 *
 *   · **RV-45 — a delete that removed nothing answered `{ ok: true }`.** It deletes by NAME, so a
 *     stale or misspelled one silently did nothing while reporting success. Now 404.
 *   · **RV-47 — a malformed id 500'd and filed its own SELECT into `error_events`.** The same route
 *     answered 404 for a well-formed missing id and 500 for a malformed one: one payload, one
 *     field, differing only in format. `exercise_library.id` is a uuid, so the bad value reached
 *     the driver.
 *   · **Q-320 — every update error answered 409 with its own text as the body**, so a missing row
 *     read as a name clash and a driver failure published its statement. The status now comes from
 *     the thrown error, and only an *unmarked* one is reported as a fault.
 *
 * Fixture discipline (the PS-39 note): the GET join is keyed on a lowercased name, so the library
 * entry and the cache row differ in CASE — with matching case the join would work either way and
 * the rule would go untested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const listExerciseLibrary = vi.fn(async () => [] as Row[])
const upsertExercise = vi.fn(async (..._a: unknown[]) => ({ id: 'e-1', name: 'Squat' }) as Row)
const adminUpdateExercise = vi.fn(async (..._a: unknown[]) => ({ id: 'e-1', name: 'Squat' }) as Row)
const deleteExercise = vi.fn(async (_n: string) => true)
const invalidateExerciseMuscleMap = vi.fn(() => undefined)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

let gifRows: Row[] = []
const insertValues = vi.fn((..._a: unknown[]) => undefined)
const deleteWhere = vi.fn((..._a: unknown[]) => undefined)

/** A chainable stand-in for Drizzle — only the shapes this route builds. */
const db = {
  select: () => ({ from: async () => gifRows }),
  insert: () => ({
    values: (v: unknown) => { insertValues(v); return { onConflictDoUpdate: async () => undefined } },
  }),
  delete: () => ({ where: async (w: unknown) => { deleteWhere(w) } }),
}

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data/exercise-muscle-map-cache', () => ({
  invalidateExerciseMuscleMap: () => invalidateExerciseMuscleMap(),
}))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => db, ensureSchema: async () => undefined }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getUserById, listExerciseLibrary, upsertExercise, adminUpdateExercise, deleteExercise })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET, POST, PATCH, DELETE } from '@/app/api/admin/exercises/route'

const ID = '00000000-0000-4000-8000-0000000000e1'
const VALID = { name: 'Squat', equipment: ['barbell'], muscles: [{ muscle: 'quads', role: 'main' }] }
const send = (handler: (r: NextRequest) => Promise<Response>, method: string, b: unknown, qs = '') =>
  handler(new NextRequest(`http://localhost/api/admin/exercises${qs}`, b === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }))
const post = (b: unknown) => send(POST, 'POST', b)
const patch = (b: unknown) => send(PATCH, 'PATCH', b)
const del = (qs: string) => send(DELETE, 'DELETE', undefined, qs)

beforeEach(() => {
  for (const m of [getUserById, listExerciseLibrary, upsertExercise, adminUpdateExercise, deleteExercise,
                   invalidateExerciseMuscleMap, reportServerError, insertValues, deleteWhere]) m.mockClear()
  getUserById.mockResolvedValue({ isAdmin: true })
  listExerciseLibrary.mockResolvedValue([])
  upsertExercise.mockResolvedValue({ id: ID, name: 'Squat' })
  adminUpdateExercise.mockResolvedValue({ id: ID, name: 'Squat' })
  deleteExercise.mockResolvedValue(true)
  gifRows = []
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the admin gate on every verb', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['GET', () => GET()],
    ['POST', () => post(VALID)],
    ['PATCH', () => patch({ id: ID, ...VALID })],
    ['DELETE', () => del('?name=Squat')],
  ]

  it('refuses a non-admin whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(upsertExercise).not.toHaveBeenCalled()
    expect(deleteExercise).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run (Q-548, the #1019 fix)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })
})

describe('GET /api/admin/exercises', () => {
  it('joins the GIF cache case-insensitively', async () => {
    // **BOTH names are mixed-case, and neither is already normalised.** The join lowercases twice —
    // once building the map, once looking up — and a fixture where either side is already lowercase
    // leaves that side's call untested: the mutation pass proved it by surviving the removal of the
    // map-key normalisation against a `'barbell squat'` cache row. The library is human-entered and
    // the cache is filled by a matcher, so in practice they disagree on both sides.
    listExerciseLibrary.mockResolvedValue([{ id: ID, name: 'Barbell Squat' }])
    gifRows = [{ exerciseName: 'BARBELL squat', gifUrl: 'g.gif', imageUrl: 'i.png' }]
    const body = await (await GET()).json()
    expect(body.exercises[0]).toMatchObject({ name: 'Barbell Squat', gifUrl: 'g.gif', imageUrl: 'i.png' })
  })

  it('reports nulls for an exercise the cache has never seen', async () => {
    listExerciseLibrary.mockResolvedValue([{ id: ID, name: 'Zercher Squat' }])
    gifRows = [{ exerciseName: 'barbell squat', gifUrl: 'g.gif', imageUrl: 'i.png' }]
    expect((await (await GET()).json()).exercises[0]).toMatchObject({ gifUrl: null, imageUrl: null })
  })
})

describe('POST /api/admin/exercises', () => {
  it('creates, invalidates the muscle map, and answers 201', async () => {
    // The muscle map is a process-wide cache; a create that skipped the invalidation would show the
    // old assignments everywhere until a restart.
    const res = await post(VALID)
    expect(res.status).toBe(201)
    expect(upsertExercise).toHaveBeenCalledWith(expect.objectContaining({ name: 'Squat', exerciseType: 'weighted' }))
    expect(invalidateExerciseMuscleMap).toHaveBeenCalled()
    expect(await res.json()).toEqual({ exercise: { id: ID, name: 'Squat' } })
  })

  it('writes the GIF cache only when a URL was given', async () => {
    await post(VALID)
    expect(insertValues).not.toHaveBeenCalled()

    await post({ ...VALID, gifUrl: 'https://cdn.example/s.gif' })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      exerciseName: 'Squat', gifUrl: 'https://cdn.example/s.gif', imageUrl: null,
    }))
  })

  it('refuses a body it cannot trust, one rule at a time', async () => {
    for (const b of [
      { ...VALID, name: '' },                              // name required
      { ...VALID, muscles: [{ muscle: 'quads', role: 'tertiary' }] },  // role enum
      { ...VALID, exerciseType: 'cardio' },                // type enum
      { ...VALID, gifUrl: 'not-a-url' },                   // url shape
      { ...VALID, extra: 1 },                              // strict
      { ...VALID, instructions: 'x'.repeat(2001) },        // length cap
    ]) {
      upsertExercise.mockClear()
      expect((await post(b)).status, JSON.stringify(b).slice(0, 50)).toBe(400)
      expect(upsertExercise).not.toHaveBeenCalled()
    }
    expect((await post({ ...VALID, pad: 'x'.repeat(33 * 1024) })).status).toBe(413)
  })
})

describe('PATCH /api/admin/exercises', () => {
  it('refuses a malformed id as 400 before it can reach the driver (RV-47)', async () => {
    // The defect: a well-formed missing id answered 404 while a malformed one 500'd and filed its
    // own SELECT into `error_events` — one payload, one field, differing only in format.
    const res = await patch({ id: 'not-a-uuid', ...VALID })
    expect(res.status).toBe(400)
    expect(adminUpdateExercise).not.toHaveBeenCalled()
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('names a MISSING id differently from a malformed one', async () => {
    // Both answer 400, so the status alone cannot tell the two guards apart — dropping the
    // missing-id check survives a status-only assertion, because an empty string then falls through
    // to the uuid guard. The message is what distinguishes "you sent no id" from "that is not an
    // id", and they are different things to fix.
    const missing = await patch({ ...VALID })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'Missing id' })

    const empty = await patch({ id: '', ...VALID })
    expect(await empty.json()).toEqual({ error: 'Missing id' })

    const malformed = await patch({ id: 'not-a-uuid', ...VALID })
    expect(await malformed.json()).toEqual({ error: 'Invalid id' })
    expect(adminUpdateExercise).not.toHaveBeenCalled()
  })

  it('takes the status from the thrown error, and reports only an unmarked one (Q-320)', async () => {
    // Three outcomes from one call site. The reporting half is the part that matters: a refusal is
    // the user being told no, and filing it into `error_events` buries the real faults in the table
    // every session reads at start-up.
    adminUpdateExercise.mockRejectedValue(new NotFoundError('Exercise'))
    let res = await patch({ id: ID, ...VALID })
    expect(res.status).toBe(404)
    expect(reportServerError).not.toHaveBeenCalled()

    adminUpdateExercise.mockRejectedValue(new UserFacingError('An exercise with that name exists', 409))
    res = await patch({ id: ID, ...VALID })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'An exercise with that name exists' })
    expect(reportServerError).not.toHaveBeenCalled()

    adminUpdateExercise.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'))
    res = await patch({ id: ID, ...VALID })
    expect(res.status).toBe(500)
    // The generic fallback, not the driver's text — the detail belongs in the log.
    expect(await res.json()).toEqual({ error: 'Update failed' })
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })

  it('CLEARS a cached GIF when the update carries none, so the matcher retries', async () => {
    // Not a no-op: leaving the old row means an exercise renamed or re-pointed keeps a GIF that no
    // longer matches it, and the auto-matcher never gets another go.
    await patch({ id: ID, ...VALID })
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(insertValues).not.toHaveBeenCalled()

    deleteWhere.mockClear()
    await patch({ id: ID, ...VALID, gifUrl: 'https://cdn.example/s.gif' })
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(deleteWhere).not.toHaveBeenCalled()
  })

  it('does not touch the cache or the muscle map when the update itself failed', async () => {
    adminUpdateExercise.mockRejectedValue(new NotFoundError('Exercise'))
    await patch({ id: ID, ...VALID })
    expect(invalidateExerciseMuscleMap).not.toHaveBeenCalled()
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/exercises', () => {
  it('404s a delete that matched nothing, instead of confirming it (RV-45)', async () => {
    // It deletes by NAME, so a stale or misspelled one removed nothing and still answered ok. The
    // admin screen does `if (!res.ok) throw`, so a false success leaves the row on screen until a
    // reload contradicts it.
    deleteExercise.mockResolvedValue(false)
    const res = await del('?name=Ghost')
    expect(res.status).toBe(404)
    expect(invalidateExerciseMuscleMap).not.toHaveBeenCalled()
    expect(deleteWhere).not.toHaveBeenCalled()
  })

  it('deletes, clears the cache and invalidates the map', async () => {
    const res = await del('?name=Squat')
    expect(res.status).toBe(200)
    expect(deleteExercise).toHaveBeenCalledWith('Squat')
    expect(invalidateExerciseMuscleMap).toHaveBeenCalled()
    expect(deleteWhere).toHaveBeenCalledTimes(1)
  })

  it('requires a name', async () => {
    expect((await del('')).status).toBe(400)
    expect(deleteExercise).not.toHaveBeenCalled()
  })
})
