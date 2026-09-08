/**
 * PS-39 — the supplement chain: `supplements`, `supplements/[id]/vials` and
 * `supplements/[id]/vials/[vialId]`.
 *
 * Batched because they are one nested-ownership chain — a vial exists only under a supplement, and
 * the child routes take BOTH ids from the client. That is the shape CLAUDE.md's write-path rules are
 * written about, and each rule has a fix in this chain's history:
 *
 *   · **(b) Never spread a request body into an update.** `userId` and `deletedAt` are settable
 *     column keys and the TypeScript `Omit` is compile-time only, so the vial PATCH whitelists field
 *     by field and `.strict()` refuses anything else.
 *   · **(c) A client-supplied child id must be ownership-verified through its parent.**
 *     `createSupplementVial` checks the parent belongs to the caller and throws; `withRouteErrors`
 *     makes that a 404 rather than an unhandled 500 (RV-46).
 *   · **A delete that matched no row is a 404, not a success** (RV-45) — otherwise a client
 *     deleting someone else's id gets `{ok: true}` and believes it worked.
 *
 * Two more that are numeric rather than structural: `POST /api/supplements` stored a
 * 300,002-character name in full while its own PATCH sibling capped the same field at 200 (Q-484),
 * and a vial's numbers are `positive()` rather than merely `finite()` because `strengthMg / 0` is
 * Infinity, which survives every later multiplication and renders as a plausible dose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@trainingai/shared/errors'

type Row = Record<string, unknown>

const listSupplements = vi.fn(async (_u: string, _d: string) => [] as Row[])
const createSupplement = vi.fn(async (_u: string, _d: Row) => ({ id: 'sup-1', name: 'Creatine' }) as Row)
const listSupplementVials = vi.fn(async (_u: string, _s: string) => [] as Row[])
const createSupplementVial = vi.fn(async (_u: string, _d: Row) => ({ id: 'vial-1' }) as Row)
const updateSupplementVial = vi.fn(async (_id: string, _u: string, _p: Row) => ({ id: 'vial-1' }) as Row)
const deleteSupplementVial = vi.fn(async (_id: string, _u: string) => true)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listSupplements, createSupplement, listSupplementVials, createSupplementVial,
    updateSupplementVial, deleteSupplementVial,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as listAll, POST as createOne } from '@/app/api/supplements/route'
import { GET as listVials, POST as addVial } from '@/app/api/supplements/[id]/vials/route'
import { PATCH as patchVial, DELETE as deleteVial } from '@/app/api/supplements/[id]/vials/[vialId]/route'

const SUP = '00000000-0000-4000-8000-0000000000a1'
const VIAL = '00000000-0000-4000-8000-0000000000b1'
const FOREIGN_SUP = '00000000-0000-4000-8000-0000000000ff'

const send = (
  handler: (req: never, ctx: never) => Promise<Response>,
  url: string, method: string, body: unknown, params?: Row,
) => handler(Object.assign(new Request(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), { nextUrl: new URL(`http://localhost${url}`) }) as never,
  (params ? { params: Promise.resolve(params) } : undefined) as never)

const createSup = (body: unknown) => send(createOne as never, '/api/supplements', 'POST', body)
const getVials = (id = SUP) =>
  send(listVials as never, `/api/supplements/${id}/vials`, 'GET', undefined, { id })
const postVial = (body: unknown, id = SUP) =>
  send(addVial as never, `/api/supplements/${id}/vials`, 'POST', body, { id })
const editVial = (body: unknown, vialId = VIAL) =>
  send(patchVial as never, `/api/supplements/${SUP}/vials/${vialId}`, 'PATCH', body, { id: SUP, vialId })
const removeVial = (vialId = VIAL) =>
  send(deleteVial as never, `/api/supplements/${SUP}/vials/${vialId}`, 'DELETE', undefined, { id: SUP, vialId })

const validVial = (over: Row = {}) => ({
  strengthMg: 5000, waterMl: 2, syringeUnitsPerMl: 100, openedOn: '2026-09-01', ...over,
})

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  listSupplements.mockResolvedValue([])
  createSupplement.mockResolvedValue({ id: 'sup-1', name: 'Creatine' })
  listSupplementVials.mockResolvedValue([])
  createSupplementVial.mockResolvedValue({ id: 'vial-1' })
  updateSupplementVial.mockResolvedValue({ id: 'vial-1' })
  deleteSupplementVial.mockResolvedValue(true)
})

describe('/api/supplements', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await listAll()).status).toBe(401)
    expect((await createSup({ name: 'Creatine' })).status).toBe(401)
  })

  it('lists the caller\'s own supplements for today in their timezone, uncacheable', async () => {
    sessionUser = { id: 'u-tz', timezone: 'Etc/GMT-14' }
    const res = await listAll()
    const [userId, date] = listSupplements.mock.calls[0]
    expect(userId).toBe('u-tz')
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')

    // A zone 26 hours away always disagrees with the default about what day it is.
    sessionUser = { id: 'u-tz2', timezone: 'Etc/GMT+12' }
    await listAll()
    expect(listSupplements.mock.calls[1][1]).not.toBe(date)
  })

  // Q-484: this route stored a 300,002-character name in full while its own PATCH sibling capped
  // the same field at 200. Both now come from one definition.
  it('bounds the fields the PATCH sibling already bounded', async () => {
    expect((await createSup({ name: 'x'.repeat(201) })).status).toBe(400)
    expect((await createSup({ name: 'Creatine', dose: 'y'.repeat(201) })).status).toBe(400)
    expect((await createSup({ name: 'Creatine', unit: 'z'.repeat(21) })).status).toBe(400)
    expect((await createSup({ name: 'Creatine', defaultAmount: 2_000_000 })).status).toBe(400)
    expect((await createSup({ name: '' })).status).toBe(400)
    expect(createSupplement).not.toHaveBeenCalled()
  })

  it('rejects an unknown key rather than storing it', async () => {
    // Against a body that would otherwise succeed, so `.strict()` is what refuses it.
    expect((await createSup({ name: 'Creatine', userId: 'someone-else' })).status).toBe(400)
    expect((await createSup({ name: 'Creatine', deletedAt: null })).status).toBe(400)
    expect(createSupplement).not.toHaveBeenCalled()
  })

  it('accepts a date in either separator and stores it with dashes', async () => {
    // The client's `localDateString()` emits YYYY/MM/DD; a dash-only regex would reject every
    // request from it, and a slash form reaching a `date` column is read under the session's
    // DateStyle.
    expect((await createSup({ name: 'Creatine', startedOn: '2026/09/01' })).status).toBe(201)
    expect((createSupplement.mock.calls[0][1] as Row).startedOn).toBe('2026-09-01')
  })

  it('trims, and turns an empty optional string into null rather than storing it', async () => {
    await createSup({ name: '  Creatine  ', dose: '   ', unit: ' mg ' })
    const stored = createSupplement.mock.calls[0][1] as Row
    expect(stored.name).toBe('Creatine')
    expect(stored.dose).toBeNull()
    expect(stored.unit).toBe('mg')
  })

  it('defaults every omitted field and writes for the session user', async () => {
    await createSup({ name: 'Creatine' })
    const [userId, stored] = createSupplement.mock.calls[0] as [string, Row]
    expect(userId).toBe(sessionUser!.id)
    expect(stored).toMatchObject({
      dose: null, defaultAmount: null, unit: null, startedOn: null, stoppedOn: null,
      dosePrompt: false, reminderEnabled: false, reminderTime: null, sortOrder: 0, active: true,
    })
  })

  it('refuses an oversized body', async () => {
    expect((await createSup({ name: 'Creatine', dose: 'x'.repeat(32 * 1024) })).status).toBe(413)
  })
})

describe('/api/supplements/[id]/vials', () => {
  it('refuses without a session and on a malformed parent id', async () => {
    sessionUser = null
    expect((await getVials()).status).toBe(401)
    expect((await postVial(validVial())).status).toBe(401)

    freshUser()
    expect((await getVials('not-a-uuid')).status).toBe(400)
    expect((await postVial(validVial(), 'not-a-uuid')).status).toBe(400)
    expect(listSupplementVials).not.toHaveBeenCalled()
    expect(createSupplementVial).not.toHaveBeenCalled()
  })

  it('scopes the listing to the caller and the parent from the path', async () => {
    const res = await getVials()
    expect(listSupplementVials).toHaveBeenCalledWith(sessionUser!.id, SUP)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  // A vial with no water is a typo, and `strengthMg / 0` is Infinity — which survives every later
  // multiplication and renders as a plausible dose.
  it('refuses a zero, negative or non-finite measurement', async () => {
    for (const bad of [
      { waterMl: 0 }, { waterMl: -2 }, { strengthMg: 0 }, { strengthMg: -1 },
      { syringeUnitsPerMl: 0 }, { strengthMg: 20_000 }, { waterMl: 5_000 },
    ]) {
      expect((await postVial(validVial(bad))).status).toBe(400)
    }
    expect(createSupplementVial).not.toHaveBeenCalled()
  })

  // `supplementId` belongs to the PATH. Accepting one from the body is how a vial gets attached to
  // a parent the caller does not own, so `.strict()` refusing it is the guard, not the assignment
  // below it.
  it('rejects an unknown key — a body-supplied parent id included — and a malformed date', async () => {
    expect((await postVial(validVial({ userId: 'someone-else' }))).status).toBe(400)
    expect((await postVial(validVial({ supplementId: FOREIGN_SUP }))).status).toBe(400)
    expect((await postVial(validVial({ openedOn: '01/09/2026' }))).status).toBe(400)
    expect(createSupplementVial).not.toHaveBeenCalled()
  })

  it('takes the parent id from the PATH, and normalises the date to dashes', async () => {
    const res = await postVial(validVial({ openedOn: '2026/09/01' }))
    expect(res.status).toBe(201)
    const [userId, data] = createSupplementVial.mock.calls[0] as [string, Row]
    expect(userId).toBe(sessionUser!.id)
    expect(data.supplementId).toBe(SUP)
    expect(data.openedOn).toBe('2026-09-01')
  })

  it('defaults the syringe scale when it is omitted', async () => {
    await postVial({ strengthMg: 5000, waterMl: 2, openedOn: '2026-09-01' })
    expect((createSupplementVial.mock.calls[0][1] as Row).syringeUnitsPerMl).toBe(100)
  })

  // RV-46 — the parent-ownership check lives in the repository and throws. Without the wrapper it
  // was an unhandled 500; a request naming someone else's supplement must read as "not found".
  it('answers 404, not 500, when the parent supplement is not the caller\'s', async () => {
    createSupplementVial.mockRejectedValue(new NotFoundError('Supplement'))
    const res = await postVial(validVial(), FOREIGN_SUP)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Supplement not found' })
  })

  it('refuses an oversized body', async () => {
    expect((await postVial(validVial({ openedOn: '2026-09-01', strengthMg: 1 }))).status).toBe(201)
    const huge = { ...validVial(), padding: 'x'.repeat(8 * 1024) }
    expect((await postVial(huge)).status).toBe(413)
  })
})

describe('/api/supplements/[id]/vials/[vialId]', () => {
  it('refuses both verbs without a session and on a malformed vial id', async () => {
    sessionUser = null
    expect((await editVial({ waterMl: 3 })).status).toBe(401)
    expect((await removeVial()).status).toBe(401)

    freshUser()
    expect((await editVial({ waterMl: 3 }, 'not-a-uuid')).status).toBe(400)
    expect((await removeVial('not-a-uuid')).status).toBe(400)
    expect(updateSupplementVial).not.toHaveBeenCalled()
    expect(deleteSupplementVial).not.toHaveBeenCalled()
  })

  // Write-path rule (b): `userId` and `deletedAt` are settable column keys and the TypeScript
  // `Omit` is compile-time only, so the patch is whitelisted field by field.
  it('refuses a body carrying a column the patch does not own', async () => {
    for (const bad of [
      { waterMl: 3, userId: 'someone-else' },
      { waterMl: 3, deletedAt: null },
      { waterMl: 3, supplementId: FOREIGN_SUP },
      { waterMl: 3, id: VIAL },
    ]) {
      expect((await editVial(bad)).status).toBe(400)
    }
    expect(updateSupplementVial).not.toHaveBeenCalled()
  })

  it('forwards only the fields sent, scoped to the caller', async () => {
    await editVial({ waterMl: 3 })
    const [vialId, userId, patch] = updateSupplementVial.mock.calls[0] as [string, string, Row]
    expect(vialId).toBe(VIAL)
    expect(userId).toBe(sessionUser!.id)
    expect(patch).toEqual({ waterMl: 3 })
  })

  it('normalises a slash date on edit, and leaves the field alone when omitted', async () => {
    await editVial({ openedOn: '2026/09/02' })
    expect((updateSupplementVial.mock.calls[0][2] as Row).openedOn).toBe('2026-09-02')

    updateSupplementVial.mockClear()
    await editVial({ waterMl: 3 })
    expect(updateSupplementVial.mock.calls[0][2]).not.toHaveProperty('openedOn')
  })

  it('applies the same numeric floors as the create', async () => {
    for (const bad of [{ waterMl: 0 }, { strengthMg: -1 }, { syringeUnitsPerMl: 0 }, { strengthMg: 20_000 }]) {
      expect((await editVial(bad)).status).toBe(400)
    }
    expect(updateSupplementVial).not.toHaveBeenCalled()
  })

  it('answers 404, not 500, when the vial is not the caller\'s', async () => {
    updateSupplementVial.mockRejectedValue(new NotFoundError('Vial'))
    const res = await editVial({ waterMl: 3 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Vial not found' })
  })

  // RV-45 — otherwise a client deleting an id that is not theirs gets `{ok: true}` and believes it.
  it('404s a delete that matched no row rather than reporting success', async () => {
    deleteSupplementVial.mockResolvedValue(false)
    const res = await removeVial()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Vial not found' })
  })

  it('deletes scoped to the caller and reports it once', async () => {
    const res = await removeVial()
    expect(res.status).toBe(200)
    expect(deleteSupplementVial).toHaveBeenCalledWith(VIAL, sessionUser!.id)
  })
})
