// Q-487: `pushMutations` catches per mutation — which is what makes the poison-pill rule work, and
// is also why the route's outer catch never fired for a push failure. So a dead database reached
// the server log and never `error_events`, the table the session-start ritual reads.
//
// The shape of the gap was an absence, which is why it survived: over the same retained window
// `/api/sync/pull` held 69 fault rows and `/api/sync/push` held zero, having never appeared once.
// Push is not less exposed — the sync provider runs it BEFORE pull in the same cycle.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the file's own consts, so the mocks have to be hoisted too.
const { pushMutations, reportServerError } = vi.hoisted(() => ({
  pushMutations: vi.fn(),
  reportServerError: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ pushMutations }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { NextRequest } from 'next/server'
import { POST } from '../route'

// A plain Request has no `nextUrl`, which the route reads for the reported url.
const req = (mutations: unknown[]) =>
  new NextRequest('http://localhost/api/sync/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  })

const mutation = (id: string) => ({ id, domain: 'body_metrics', date: '2026-08-09', payload: { weightKg: 81 } })

beforeEach(() => { pushMutations.mockReset(); reportServerError.mockReset() })

describe('POST /api/sync/push — reporting', () => {
  it('reports a retryable failure to error_events', async () => {
    pushMutations.mockResolvedValue({
      processed: 0,
      errors: [{ id: 'm1', domain: 'body_metrics', date: '2026-08-09', error: 'Error: Failed query: insert …', retryable: true }],
    })

    const res = await POST(req([mutation('m1')]))

    expect(res.status).toBe(200)
    expect(reportServerError).toHaveBeenCalledTimes(1)
    const [err, ctx] = reportServerError.mock.calls[0]
    expect((err as Error).message).toContain('1 of 1 mutation(s) failed with a retryable server error')
    expect((err as Error).message).toContain('body_metrics')
    expect(ctx).toEqual({ userId: 'u1', url: '/api/sync/push' })
  })

  it('does NOT report a validation rejection — that is the client, not a server fault', async () => {
    pushMutations.mockResolvedValue({
      processed: 0,
      errors: [{ id: 'm1', domain: 'body_metrics', date: '2026-08-09', error: 'implausible waterMlDelta 999999' }],
    })

    await POST(req([mutation('m1')]))

    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('reports ONCE for a whole batch, not once per mutation', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m${i}`)
    pushMutations.mockResolvedValue({
      processed: 0,
      errors: ids.map(id => ({ id, domain: 'food_logs', date: '2026-08-09', error: 'db down', retryable: true })),
    })

    await POST(req(ids.map(mutation)))

    // 100 near-identical rows per push is how a fault table becomes the disk problem it is meant to
    // warn about — error_events has already needed 49 MB reclaimed from it once.
    expect(reportServerError).toHaveBeenCalledTimes(1)
    expect((reportServerError.mock.calls[0][0] as Error).message).toContain('100 of 100')
  })

  it('names every affected domain once, deduped and ordered', async () => {
    pushMutations.mockResolvedValue({
      processed: 0,
      errors: [
        { id: 'a', domain: 'food_logs', date: '2026-08-09', error: 'db down', retryable: true },
        { id: 'b', domain: 'body_metrics', date: '2026-08-09', error: 'db down', retryable: true },
        { id: 'c', domain: 'food_logs', date: '2026-08-09', error: 'db down', retryable: true },
      ],
    })

    await POST(req([mutation('a'), mutation('b'), mutation('c')]))

    expect((reportServerError.mock.calls[0][0] as Error).message).toContain('[body_metrics, food_logs]')
  })

  it('stays silent on a clean push', async () => {
    pushMutations.mockResolvedValue({ processed: 1, errors: [] })

    await POST(req([mutation('m1')]))

    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('still reports when pushMutations itself throws — the pre-existing outer catch', async () => {
    pushMutations.mockRejectedValue(new Error('boom'))

    const res = await POST(req([mutation('m1')]))

    expect(res.status).toBe(500)
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/sync/push — a schema-rejected mutation is quarantined, not deleted (Q-476)', () => {
  // The defect, in the entry's own measurement: three mutations with a bad one in the middle came
  // back `{processed: 2, errors: []}`. An empty errors array is how the client is told everything
  // succeeded, so it deleted the row that was never written — no badge, no toast, no retry.
  it('returns an error entry for an unknown domain instead of silence', async () => {
    pushMutations.mockResolvedValue({ processed: 2, errors: [] })

    const res = await POST(req([
      mutation('m1'),
      { id: 'm2', domain: 'retired_domain', date: '2026-08-09', payload: {} },
      mutation('m3'),
    ]))
    const body = await res.json()

    expect(body.processed).toBe(2)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]).toMatchObject({ id: 'm2', domain: 'retired_domain', retryable: false })
    // Only the valid two reach the adapter — the rejection still cannot wedge the queue.
    expect(pushMutations.mock.calls[0][1].map((m: { id: string }) => m.id)).toEqual(['m1', 'm3'])
  })

  it('returns an error entry for a malformed date', async () => {
    pushMutations.mockResolvedValue({ processed: 0, errors: [] })

    const res = await POST(req([{ id: 'm1', domain: 'body_metrics', date: '06-08-2026', payload: {} }]))
    const body = await res.json()

    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].id).toBe('m1')
    expect(body.errors[0].error).toMatch(/date/)
  })

  // `retryable: true` means "the server could not write" (Q-475) and makes the client back off the
  // WHOLE queue and stop draining. A schema rejection can never succeed, so it must be the per-item
  // path: attempts++, backoff, dead-letter at MAX_MUTATION_ATTEMPTS.
  it('marks the rejection non-retryable, so it does not read as a server outage', async () => {
    pushMutations.mockResolvedValue({ processed: 0, errors: [] })
    const res = await POST(req([{ id: 'm1', domain: 'body_metrics', date: '2026-02-31', payload: {} }]))
    expect((await res.json()).errors[0].retryable).toBe(false)
  })

  it('still drops a rejection with no usable id — the client could not match it, and the domain:date fallback would fail its valid siblings', async () => {
    pushMutations.mockResolvedValue({ processed: 1, errors: [] })

    const res = await POST(req([
      mutation('m1'),
      { domain: 'body_metrics', date: 'not-a-date', payload: {} },
    ]))

    expect((await res.json()).errors).toEqual([])
  })

  it('keeps the adapter\'s own errors alongside the rejections', async () => {
    pushMutations.mockResolvedValue({
      processed: 0,
      errors: [{ id: 'm1', domain: 'body_metrics', date: '2026-08-09', error: 'boom', retryable: true }],
    })

    const res = await POST(req([
      mutation('m1'),
      { id: 'm2', domain: 'retired_domain', date: '2026-08-09', payload: {} },
    ]))
    const ids = (await res.json()).errors.map((e: { id: string }) => e.id)

    expect(ids).toEqual(['m2', 'm1'])
  })

  it('does not report a schema rejection to error_events — it is the client sending something wrong, not a server fault', async () => {
    pushMutations.mockResolvedValue({ processed: 0, errors: [] })
    await POST(req([{ id: 'm1', domain: 'retired_domain', date: '2026-08-09', payload: {} }]))
    expect(reportServerError).not.toHaveBeenCalled()
  })
})
