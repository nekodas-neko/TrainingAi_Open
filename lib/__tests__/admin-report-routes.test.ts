/**
 * PS-39 — the four read-only admin reports: `admin/errors`, `admin/ai-usage`,
 * `admin/pending-count` and `admin/time-audit`.
 *
 * Batched because they share the admin gate and because two of them were carrying the exact defect
 * that gate's helper exists to prevent — see the Q-548 section below, which is a **product change**
 * in this PR rather than a test-only pin.
 *
 * What each decides:
 *
 *   · **A refusal is 403 and a check that could not run is 503.** The check hits the database, so
 *     collapsing the two makes an outage look like a permissions problem — and on the error-log
 *     viewer, which is what you open *during* an outage, that is as wrong as it gets.
 *   · **`ai-usage` validates its window parameters and refuses rather than clamping.** These feed
 *     an aggregate over `ai_call_log`; a silently-clamped 10-year window would answer with a
 *     different question than the one asked and look like a real reading.
 *   · **`time-audit` clamps instead**, because its `days` comes from a UI control rather than a
 *     hand-typed query. The two routes disagree deliberately and both are pinned.
 *
 * Fixture discipline (the PS-39 note): the stale-claim case sets the JWT to **true** while the row
 * says false, and every clamp fixture differs from the default, so a route that ignored its input
 * could not pass by landing on the same number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const listErrorEvents = vi.fn(async (_n: number) => [] as Row[])
const countInactiveUsers = vi.fn(async () => 0)
const countFeedback = vi.fn(async () => 0)
const getAiCallUsageSummary = vi.fn(async (..._a: unknown[]) => ({}) as Row)
const getTimingAuditData = vi.fn(async (..._a: unknown[]) => ({ sets: [], exercises: [], sessions: [] }) as Row)
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // One repo for both accessors — the admin gate is real here, not stubbed.
  const repo = async () => ({
    getUserById, listErrorEvents, countInactiveUsers, countFeedback,
    getAiCallUsageSummary, getTimingAuditData,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getErrors } from '@/app/api/admin/errors/route'
import { GET as getAiUsage } from '@/app/api/admin/ai-usage/route'
import { GET as getPending } from '@/app/api/admin/pending-count/route'
import { GET as getTimeAudit } from '@/app/api/admin/time-audit/route'

const aiUsage = (qs = '') => getAiUsage(new Request(`http://localhost/api/admin/ai-usage${qs}`))
const timeAudit = (qs = '') => getTimeAudit(new NextRequest(`http://localhost/api/admin/time-audit${qs}`))
const ALL: [string, () => Promise<Response>][] = [
  ['errors', () => getErrors()],
  ['ai-usage', () => aiUsage()],
  ['pending-count', () => getPending()],
  ['time-audit', () => timeAudit()],
]

beforeEach(() => {
  for (const m of [getUserById, listErrorEvents, countInactiveUsers, countFeedback,
                   getAiCallUsageSummary, getTimingAuditData, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  listErrorEvents.mockResolvedValue([])
  countInactiveUsers.mockResolvedValue(0)
  countFeedback.mockResolvedValue(0)
  getAiCallUsageSummary.mockResolvedValue({ sections: [] })
  getTimingAuditData.mockResolvedValue({ sets: [], exercises: [], sessions: [] })
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the admin gate on the reports', () => {
  it('refuses every one of them without a session, before reaching the database', async () => {
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('ignores a stale isAdmin claim and asks the database', async () => {
    // The claim says true and the row says false. With both false the route could read either and
    // still refuse, so the rule — a revoked admin keeps a 30-day token — would not be under test.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(listErrorEvents).not.toHaveBeenCalled()
    expect(getTimingAuditData).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run — including on the error viewer (Q-548)', async () => {
    // **This is the product change in this PR.** `admin/errors` and `admin/pending-count` used a
    // bare `catch` around the check AND the read, so a database outage answered `403 Forbidden`.
    // On the error-log viewer — the thing you open *during* an outage — that points the
    // investigation at credentials, which is what cost several minutes on 2026-08-18. Both now use
    // `adminErrorResponse`, as `ai-usage` and `time-audit` already did.
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('lets a failed READ surface as a fault rather than as a refusal', async () => {
    // The other half of the same change: the repository call now sits outside the try, so a broken
    // query throws to the framework and is recorded, instead of being flattened into a 403 that
    // says the admin lacks permission.
    getUserById.mockResolvedValue({ isAdmin: true })
    listErrorEvents.mockRejectedValue(new Error('statement timeout'))
    await expect(getErrors()).rejects.toThrow('statement timeout')

    countInactiveUsers.mockRejectedValue(new Error('statement timeout'))
    await expect(getPending()).rejects.toThrow('statement timeout')
  })
})

describe('GET /api/admin/errors', () => {
  it('returns the most recent hundred events', async () => {
    // 100, not "everything": this is the table read at the start of every session and it holds a
    // 30-day window of payloads.
    listErrorEvents.mockResolvedValue([{ id: 'e1', message: 'boom' }])
    const res = await getErrors()
    expect(listErrorEvents).toHaveBeenCalledWith(100)
    expect(await res.json()).toEqual([{ id: 'e1', message: 'boom' }])
  })
})

describe('GET /api/admin/pending-count', () => {
  it('reports both queues, and asks for them together', async () => {
    countInactiveUsers.mockResolvedValue(3)
    countFeedback.mockResolvedValue(7)
    // Different numbers on purpose: equal counts would let the two reads be swapped and the
    // response still look right.
    expect(await (await getPending()).json()).toEqual({ count: 3, feedbackCount: 7 })
  })
})

describe('GET /api/admin/ai-usage', () => {
  it('defaults to a week, a two-minute double-trip window and six-hour buckets', async () => {
    await aiUsage()
    expect(getAiCallUsageSummary).toHaveBeenCalledWith(168, 120, 6)
  })

  it('coerces the numbers out of the query string', async () => {
    // Each value differs from its default, so a route ignoring the query could not pass.
    await aiUsage('?sinceHours=24&windowSeconds=30&bucketHours=1')
    expect(getAiCallUsageSummary).toHaveBeenCalledWith(24, 30, 1)
  })

  it('REFUSES an out-of-range window rather than clamping it', async () => {
    // A silently-clamped ten-year window answers a different question than the one asked and looks
    // like a real reading. `time-audit` clamps instead, and the disagreement is deliberate — see
    // its own case below.
    for (const qs of [
      '?sinceHours=0', '?sinceHours=999999', '?sinceHours=1.5',
      '?windowSeconds=0', '?windowSeconds=99999',
      '?bucketHours=0', '?bucketHours=100',
      '?sinceHours=abc',
    ]) {
      getAiCallUsageSummary.mockClear()
      expect((await aiUsage(qs)).status, qs).toBe(400)
      expect(getAiCallUsageSummary, qs).not.toHaveBeenCalled()
    }
  })

  it('rate-limits, and checks admin BEFORE spending the bucket', async () => {
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await aiUsage()).status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()

    getUserById.mockResolvedValue({ isAdmin: true })
    rateLimit.mockReturnValue(false)
    expect((await aiUsage()).status).toBe(429)
    expect(getAiCallUsageSummary).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/time-audit', () => {
  it('CLAMPS its day window rather than refusing, because it comes from a control', async () => {
    for (const [qs, expected] of [
      ['', 90], ['?days=30', 30], ['?days=1', 7], ['?days=9999', 365],
      ['?days=30.6', 31],        // rounded, not truncated
      ['?days=abc', 90],         // Number('abc') is NaN, so the default stands
    ] as [string, number][]) {
      getTimingAuditData.mockClear()
      const res = await timeAudit(qs)
      expect(getTimingAuditData.mock.calls[0][1], qs).toBe(expected)
      // The window is echoed back, so the UI can show what it actually got rather than what it asked
      // for — the whole reason clamping is acceptable here.
      expect((await res.json()).days, qs).toBe(expected)
    }
  })

  it('scopes the audit to the caller and caps the session list at thirty', async () => {
    // Real session rows, not placeholders: `decomposeSessions` drops anything without a
    // `completedAt` or shorter than its minimum, so a fixture of bare objects decomposes to an
    // empty list and a missing `.slice(0, 30)` would go unnoticed. 45 in, 30 out.
    const start = Date.parse('2026-03-01T02:00:00Z')
    getTimingAuditData.mockResolvedValue({
      sets: [], exercises: [],
      sessions: Array.from({ length: 45 }, (_, i) => ({
        workoutSessionId: `s${i}`,
        startedAt: start + i * 86_400_000,
        completedAt: start + i * 86_400_000 + 3_600_000,   // an hour long, well over the minimum
        warmupEndedAt: null,
      })),
    })
    const body = await (await timeAudit()).json()
    expect(getTimingAuditData.mock.calls[0][0]).toBe('u-1')
    expect(body.sessions).toHaveLength(30)
  })

  it('ignores a query key it does not know, rather than refusing the request', async () => {
    // Unlike `ai-usage`'s `.strict()`, this route reads exactly one parameter by name, so an extra
    // one cannot reach a schema. Pinned because the two neighbours behave differently and a reader
    // comparing them should find the difference stated rather than inferred.
    await timeAudit('?days=30&unknown=1')
    expect(getTimingAuditData.mock.calls[0][1]).toBe(30)
  })
})
