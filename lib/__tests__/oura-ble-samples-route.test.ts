/**
 * PS-39 — `POST /api/oura-ble/samples` is the ring's direct-BLE ingest, and the invariant that
 * matters here is not what it stores but what it **refuses to wait for**.
 *
 * The route's own comment traces the shape: the rollup got heavy (SleepNet ONNX inference, #722), a
 * >30s pass tripped the native client's 30s `readTimeout`, that reads as a non-2xx, the ring's
 * history cursor only advances on 2xx — so the same batch re-drains, re-runs the rollup and
 * saturates the DB pool. A self-sustaining retry storm that starved the outbox sync and stalled the
 * sleep-staging write (I19/I20, and the 2026-08-13 outage). **The response never awaits the
 * rollup**, and nothing else in the repo checks that it still doesn't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const insertOuraRawSamples = vi.fn(async (_userId: string, _rows: Array<Record<string, unknown>>) => 0)
/** Never resolves. If the handler ever awaits the rollup, the request hangs and the test times out. */
const runRollupOffLoop = vi.fn((_userId: string, _tz: string, _opts?: { sinceDs?: number }) =>
  new Promise<null>(() => {}))
const reportServerError = vi.fn()

let sessionUser: { id: string; timezone?: string; isAdmin?: boolean } | null =
  { id: 'u-1', timezone: 'Australia/Brisbane', isAdmin: true }
let adminAllowed = true

vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => { if (!adminAllowed) throw new Error('not admin') },
  adminErrorResponse: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ insertOuraRawSamples }),
  getRepository: async () => ({ insertOuraRawSamples }),
}))
vi.mock('@/lib/oura-ble/rollup-worker', () => ({
  runRollupOffLoop: (u: string, tz: string, o?: { sinceDs?: number }) => runRollupOffLoop(u, tz, o),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/oura-ble/report-step-errors', () => ({ reportRollupStepErrors: () => {} }))

/** The decoder has its own byte-exact tests against captured ring hex; what this file needs is
 *  control over which TAG a frame carries, since the tag decides whether a rollup is scheduled. */
const historyEventFromHex = vi.fn((_hex: string) => null as null | {
  timestampDs: number; tag: number; name: string; bodyHex: string; decoded: Record<string, unknown> | null
})
vi.mock('@/lib/oura-ble/decode', () => ({ historyEventFromHex: (h: string) => historyEventFromHex(h) }))
vi.mock('@/lib/oura-ble/raw-storage', () => ({ shouldDropRawEvent: () => false }))

import { POST } from '@/app/api/oura-ble/samples/route'

const SLEEP_TAG = 0x4b        // biometric — schedules a rollup
const DEBUG_TAG = 0x24        // battery debug — must not

const post = (frames: string[]) =>
  POST(new Request('http://localhost/api/oura-ble/samples', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames: frames.map(hex => ({ hex })) }),
  }) as never)

/** The module keeps its in-flight and pending-span maps at module scope, keyed by user — so a fresh
 *  user id per case isolates them without resetting modules. */
let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', isAdmin: true }; return sessionUser.id }

const event = (tag: number, timestampDs: number) => ({
  timestampDs, tag, name: `tag-${tag}`, bodyHex: 'aa', decoded: null,
})

beforeEach(() => {
  vi.useFakeTimers()
  insertOuraRawSamples.mockClear(); runRollupOffLoop.mockClear(); reportServerError.mockClear()
  insertOuraRawSamples.mockResolvedValue(1)
  runRollupOffLoop.mockImplementation(() => new Promise<null>(() => {}))
  adminAllowed = true
  freshUser()
})
afterEach(() => { vi.useRealTimers() })

describe('POST /api/oura-ble/samples', () => {
  it('refuses without a session, and refuses a non-admin', async () => {
    sessionUser = null
    expect((await post(['aa'])).status).toBe(401)
    freshUser(); adminAllowed = false
    expect((await post(['aa'])).status).toBe(403)
    expect(insertOuraRawSamples).not.toHaveBeenCalled()
  })

  it('RETURNS WITHOUT AWAITING THE ROLLUP — the invariant behind the 2026-08-13 outage', async () => {
    // `runRollupOffLoop` here returns a promise that never settles. If the handler awaited it — or
    // awaited anything chained off it — this request could not complete, which is exactly the >30s
    // hang that trips the native 30s readTimeout, holds the ring's 2xx-only history cursor and
    // re-drains the same batch forever.
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 1000))

    const res = await post(['aa'])
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stored).toBe(1)
    expect(json.aggregateCoalesced).toBe(true)

    // And the rollup really does start afterwards — otherwise this passes for the wrong reason.
    await vi.advanceTimersByTimeAsync(4000)
    expect(runRollupOffLoop).toHaveBeenCalledTimes(1)
  })

  it('stores the raw rows before any rollup is scheduled', async () => {
    // Durability first: the rollup is derived and re-runnable, the raw rows are not.
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 1000))
    await post(['aa'])
    expect(insertOuraRawSamples).toHaveBeenCalledTimes(1)
    expect(runRollupOffLoop).not.toHaveBeenCalled()      // still inside the debounce window
    await vi.advanceTimersByTimeAsync(4000)
    expect(runRollupOffLoop).toHaveBeenCalledTimes(1)
  })

  it('does not schedule a rollup for a debug-only batch', async () => {
    historyEventFromHex.mockReturnValue(event(DEBUG_TAG, 1000))
    const json = await (await post(['aa'])).json()
    expect(json.stored).toBe(1)
    expect(json.aggregateCoalesced).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runRollupOffLoop).not.toHaveBeenCalled()
  })

  it('skips a frame that is not a history event rather than failing the batch', async () => {
    // Decoders are infallible by rule: unknown or malformed returns null and the batch continues.
    // Valid hex on every frame — the schema rejects anything else before the decoder is reached,
    // which would test the regex rather than the skip.
    historyEventFromHex.mockImplementation((hex: string) => (hex === 'aabb' ? event(SLEEP_TAG, 1000) : null))
    const json = await (await post(['ccdd', 'aabb', 'eeff'])).json()
    expect(json.received).toBe(3)
    expect(json.decoded).toBe(1)
  })

  it('coalesces a burst of batches into ONE rollup, over the whole span', async () => {
    // The plugin drains history in ~255-event batches, one POST each. Re-rolling per batch is the
    // waste the debounce exists to remove — and the span must still cover the earliest batch.
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 500))
    await post(['aa'])
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 900))
    await post(['aa'])

    await vi.advanceTimersByTimeAsync(4000)
    expect(runRollupOffLoop).toHaveBeenCalledTimes(1)
    expect(runRollupOffLoop.mock.calls[0][2]).toEqual({ sinceDs: 500 })
  })

  it('puts the span back when a rollup fails, so the next run still covers it', async () => {
    // The subtle one. A failed run must not leave its batch marked done — the next run has to
    // re-derive from the earliest un-rolled sample, not from the newest batch's.
    runRollupOffLoop.mockImplementation(() => Promise.reject(new Error('rollup blew up')))
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 500))
    await post(['aa'])
    await vi.advanceTimersByTimeAsync(4000)
    expect(runRollupOffLoop.mock.calls[0][2]).toEqual({ sinceDs: 500 })
    expect(reportServerError).toHaveBeenCalled()          // and it is surfaced, not swallowed (K6)

    // A later batch covering only newer data must still re-derive from 500.
    runRollupOffLoop.mockImplementation(() => new Promise<null>(() => {}))
    historyEventFromHex.mockReturnValue(event(SLEEP_TAG, 9000))
    await post(['aa'])
    await vi.advanceTimersByTimeAsync(4000)
    expect(runRollupOffLoop).toHaveBeenCalledTimes(2)
    expect(runRollupOffLoop.mock.calls[1][2]).toEqual({ sinceDs: 500 })
  })
})
