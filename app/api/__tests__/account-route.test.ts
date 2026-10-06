// #2120 — `DELETE /api/account`, the gate in front of `repo.deleteAccount`. The repository is mocked
// here; what the deletion removes is `lib/data/postgres/__tests__/account-deletion.test.ts`.
//
// Each refusal case is built so that only the guard it names can refuse it: the cross-account case
// carries the correct phrase, so a missing `.strict()` would let it through rather than fail it for
// the phrase instead.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// A fresh id per case: the limiter is real and keyed by user, so a shared id would carry one case's
// attempts into the next.
let sessionUser = ''
const authMock = vi.fn(async () => (sessionUser ? { user: { id: sessionUser } } : null) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const deleteAccount = vi.fn()
const repo = { deleteAccount }
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const OTHER = '00000000-0000-4000-8000-00000000beef'
const DELETED = {
  deleted: true,
  anonymised: { aiCallLog: 2, errorEvents: 1, authoredExercises: 1 },
  purged: { dbQueryLog: 0, rateLimits: 1, invitedEmails: 1, emailPreimage: 0 },
}

async function del(body: unknown, cookies = '') {
  const { DELETE } = await import('@/app/api/account/route')
  return DELETE(new NextRequest('http://x/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...(cookies ? { cookie: cookies } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

vi.spyOn(console, 'error').mockImplementation(() => {})

describe('DELETE /api/account (#2120)', () => {
  beforeEach(() => {
    sessionUser = crypto.randomUUID()
    deleteAccount.mockReset().mockResolvedValue(DELETED)
    reportServerError.mockReset()
  })

  it('refuses a request with no session and deletes nothing', async () => {
    sessionUser = ''
    const res = await del({ confirm: 'DELETE' })
    expect(res.status).toBe(401)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the SESSION\'s account, and only that one', async () => {
    const res = await del({ confirm: 'DELETE' })
    expect(res.status).toBe(200)
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(deleteAccount).toHaveBeenCalledWith(sessionUser)
    expect(await res.json()).toMatchObject({ ok: true, deleted: true, anonymised: DELETED.anonymised })
  })

  it('refuses a body that names another account, even with the right phrase', async () => {
    for (const body of [{ confirm: 'DELETE', userId: OTHER }, { confirm: 'DELETE', id: OTHER }]) {
      const res = await del(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/only your own account/)
    }
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('refuses without the typed phrase, and says what to type', async () => {
    for (const body of [{}, { confirm: 'delete' }, { confirm: 'DELETE ' }, { confirm: true }]) {
      const res = await del(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toBe('Type DELETE to confirm.')
      sessionUser = crypto.randomUUID()
    }
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('refuses a malformed and an oversized body before parsing it', async () => {
    expect((await del('{not json')).status).toBe(400)
    sessionUser = crypto.randomUUID()
    expect((await del({ confirm: 'DELETE', pad: 'x'.repeat(2048) })).status).toBe(413)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('rate-limits a fourth attempt inside the hour without reaching the repository', async () => {
    for (let i = 0; i < 3; i++) expect((await del({ confirm: 'nope' })).status).toBe(400)
    const res = await del({ confirm: 'DELETE' })
    expect(res.status).toBe(429)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('ends the session on success: every session cookie the request carried is expired', async () => {
    const res = await del({ confirm: 'DELETE' }, 'authjs.session-token.0=a; authjs.session-token.1=b; theme=dark')
    const set = res.headers.getSetCookie()
    for (const name of ['authjs.session-token', 'authjs.session-token.0', 'authjs.session-token.1']) {
      const line = set.find(c => c.startsWith(`${name}=`))
      expect(line, name).toBeDefined()
      expect(line).toMatch(/Max-Age=0/i)
    }
    expect(set.some(c => c.startsWith('theme='))).toBe(false)
  })

  it('reports a failed deletion, keeps the session, and says nothing was removed', async () => {
    deleteAccount.mockRejectedValueOnce(new Error('food_logs_food_item_id_fkey'))
    const res = await del({ confirm: 'DELETE' }, 'authjs.session-token=a')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/nothing was removed/)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(reportServerError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ userId: sessionUser }))
  })

  it('answers 404, keeping the session, when no account matched', async () => {
    deleteAccount.mockResolvedValueOnce({ ...DELETED, deleted: false })
    const res = await del({ confirm: 'DELETE' }, 'authjs.session-token=a')
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})
