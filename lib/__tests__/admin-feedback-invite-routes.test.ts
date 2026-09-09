/**
 * PS-39 — the admin triage routes: `admin/feedback`, `admin/feedback/[id]` and `admin/invites`.
 *
 * Batched because they are the two admin queues (what people reported, who may sign in) and because
 * both carried a defect this PR fixes — see the two sections below. `admin/invites` was already
 * correct and is the reference the other two are brought onto.
 *
 * What the cases decide:
 *
 *   · **A refusal is 403; a check that could not run is 503 (Q-548).** `requireAdmin` makes a
 *     database round-trip, so a bare catch turns an outage into `Forbidden` — the one status nobody
 *     retries or escalates.
 *   · **A malformed id is 400, not 403.** The old catch on `feedback/[id]` swallowed the UUID guard
 *     too, so a mistyped id read as a permissions problem.
 *   · **Adding and removing an invite must agree on the key.** `removeInvite` is an exact-match
 *     delete on what `addInvite` stored, and POST lowercases and trims while DELETE did not — so a
 *     revoke could silently match nothing and still answer `{ ok: true }`.
 *
 * Fixture discipline (the PS-39 note): the invite fixture is deliberately mixed-case **with
 * surrounding whitespace**, because an already-normalised address makes the normalising and
 * non-normalising versions identical and tests neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const listFeedback = vi.fn(async () => [] as Row[])
const deleteFeedback = vi.fn(async (_id: string) => undefined)
const listInvites = vi.fn(async () => [] as string[])
const addInvite = vi.fn(async (_e: string) => undefined)
const removeInvite = vi.fn(async (_e: string) => undefined)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // One repo for both accessors — the admin gate runs for real rather than stubbed.
  const repo = async () => ({ getUserById, listFeedback, deleteFeedback, listInvites, addInvite, removeInvite })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as listFeedbackRoute } from '@/app/api/admin/feedback/route'
import { DELETE as deleteFeedbackRoute } from '@/app/api/admin/feedback/[id]/route'
import { GET as listInvitesRoute, POST as addInviteRoute, DELETE as removeInviteRoute } from '@/app/api/admin/invites/route'

const FEEDBACK_ID = '00000000-0000-4000-8000-0000000000d1'
const delFeedback = (id: string) =>
  deleteFeedbackRoute(new NextRequest('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id }) })
const body = (method: string, b: unknown) =>
  new NextRequest('http://localhost/api/admin/invites', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  })
const addInv = (b: unknown) => addInviteRoute(body('POST', b))
const rmInv = (b: unknown) => removeInviteRoute(body('DELETE', b))

beforeEach(() => {
  for (const m of [getUserById, listFeedback, deleteFeedback, listInvites, addInvite, removeInvite]) m.mockClear()
  getUserById.mockResolvedValue({ isAdmin: true })
  listFeedback.mockResolvedValue([])
  listInvites.mockResolvedValue([])
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the admin gate across both queues', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['feedback GET', () => listFeedbackRoute()],
    ['feedback DELETE', () => delFeedback(FEEDBACK_ID)],
    ['invites GET', () => listInvitesRoute()],
    ['invites POST', () => addInv({ email: 'a@b.com' })],
    ['invites DELETE', () => rmInv({ email: 'a@b.com' })],
  ]

  it('refuses each without a session, before touching the database', async () => {
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('ignores a stale isAdmin claim and asks the database', async () => {
    // Claim true, row false. With both false the route could read either and still refuse.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(deleteFeedback).not.toHaveBeenCalled()
    expect(addInvite).not.toHaveBeenCalled()
    expect(removeInvite).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run (Q-548)', async () => {
    // **The fix in this PR for the two feedback routes.** `admin/invites` already answered this way,
    // which is why it is the reference rather than another patient.
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })
})

describe('DELETE /api/admin/feedback/[id]', () => {
  it('answers 400 for a malformed id, not 403', async () => {
    // The old catch wrapped the UUID guard as well, so a mistyped id came back as `Forbidden` and
    // sent the reader looking for a permissions problem they did not have.
    const res = await delFeedback('not-a-uuid')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid id' })
    expect(deleteFeedback).not.toHaveBeenCalled()
  })

  it('deletes a well-formed id and confirms it', async () => {
    const res = await delFeedback(FEEDBACK_ID)
    expect(res.status).toBe(200)
    expect(deleteFeedback).toHaveBeenCalledWith(FEEDBACK_ID)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('lets a failed delete surface as a fault rather than as a refusal', async () => {
    deleteFeedback.mockRejectedValue(new Error('statement timeout'))
    await expect(delFeedback(FEEDBACK_ID)).rejects.toThrow('statement timeout')
  })
})

describe('/api/admin/invites', () => {
  it('adds and removes under the SAME normalised key', async () => {
    // **Mixed case with surrounding whitespace, deliberately.** An already-clean address makes the
    // normalising and non-normalising versions identical, so the rule would go untested — which is
    // exactly how DELETE came to be missing it. `removeInvite` is an exact-match delete on what
    // `addInvite` stored, so a raw string there revokes nothing and still answers `{ ok: true }`.
    const typed = '  Foo@Bar.COM  '
    await addInv({ email: typed })
    await rmInv({ email: typed })
    expect(addInvite).toHaveBeenCalledWith('foo@bar.com')
    expect(removeInvite).toHaveBeenCalledWith('foo@bar.com')
  })

  it('lists the invited addresses', async () => {
    listInvites.mockResolvedValue(['a@b.com', 'c@d.com'])
    expect(await (await listInvitesRoute()).json()).toEqual({ emails: ['a@b.com', 'c@d.com'] })
  })

  it('refuses a body with no usable email, on both verbs', async () => {
    for (const b of [{}, { email: '' }, { email: 42 }, { email: null }]) {
      addInvite.mockClear(); removeInvite.mockClear()
      expect((await addInv(b)).status, `POST ${JSON.stringify(b)}`).toBe(400)
      expect((await rmInv(b)).status, `DELETE ${JSON.stringify(b)}`).toBe(400)
      expect(addInvite).not.toHaveBeenCalled()
      expect(removeInvite).not.toHaveBeenCalled()
    }
  })

  it('413s an oversized body on both verbs rather than reading it', async () => {
    const huge = { email: 'a@b.com', pad: 'x'.repeat(5 * 1024) }
    expect((await addInv(huge)).status).toBe(413)
    expect((await rmInv(huge)).status).toBe(413)
    expect(addInvite).not.toHaveBeenCalled()
    expect(removeInvite).not.toHaveBeenCalled()
  })
})
