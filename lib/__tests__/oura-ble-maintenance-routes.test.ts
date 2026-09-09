/**
 * PS-39 — the two admin levers that REMOVE data: `oura-ble/samples/pack` and
 * `oura-ble/samples/backfill-null-decoded`.
 *
 * Batched because they are the destructive pair, and because the app's hardest standing rule sits
 * directly behind them: **`oura_raw_samples.body_hex` is the archival source of truth on the
 * server**, the ring's history buffer is finite, and its sync cursor only moves forward — so a
 * decoder fixed later can only back-fill by re-decoding stored hex. Anything that could remove it
 * is a one-way door.
 *
 * What each decides:
 *
 *   · **`pack` is the only endpoint in the app that deletes archival frames.** It moves sealed
 *     buckets into one blob each and drops the hot rows only after re-reading the blob and proving
 *     the frames equal. Hence the bound: the delete side is 1.1M rows in production, and the owner
 *     presses again until `remaining` reaches 0, watching the footprint between presses.
 *   · **A failed run is a 500, never "packed 0".** *Nothing to do* and *it broke* are different
 *     answers, and the caller decides whether to press again from that difference.
 *   · **A refused bucket is a RESULT, not a throw** — a bucket whose frames did not match is
 *     reported and the run continues, because one mismatch must not abandon the rest.
 *   · **`backfill-null-decoded` clears the `decoded` JSONB and nothing else.** Every nulled row
 *     still decodes from `body_hex` on read, which is the only reason nulling is safe at all.
 *
 * Fixture discipline (the PS-39 note): every clamp fixture differs from the default, so a route
 * that ignored the body entirely could not pass by landing on the same number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const countPackableBuckets = vi.fn(async (_u: string) => ({ buckets: 0, sealBelowDs: null }) as Row)
const packOuraRawBuckets = vi.fn(async (..._a: unknown[]) => ({ packed: 0, buckets: [] }) as Row)
const nullHistoricalDecoded = vi.fn(async (..._a: unknown[]) => ({ nulled: 0, remaining: 0 }) as Row)
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // One repo for both accessors — `requireAdmin` reaches for `getRepository`, the routes for
  // `getRepositoryAsync`, and the gate is real here rather than stubbed.
  const repo = async () => ({ getUserById, countPackableBuckets, packOuraRawBuckets, nullHistoricalDecoded })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as packCount, POST as packRun } from '@/app/api/oura-ble/samples/pack/route'
import { POST as backfill } from '@/app/api/oura-ble/samples/backfill-null-decoded/route'

const post = (handler: (r: Request) => Promise<Response>, body: unknown, path: string) =>
  handler(new Request(`http://localhost${path}`, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const pack = (b?: unknown) => post(packRun, b, '/api/oura-ble/samples/pack')
const nullDecoded = (b?: unknown) => post(backfill, b, '/api/oura-ble/samples/backfill-null-decoded')

beforeEach(() => {
  for (const m of [getUserById, countPackableBuckets, packOuraRawBuckets, nullHistoricalDecoded, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  countPackableBuckets.mockResolvedValue({ buckets: 0, sealBelowDs: null })
  packOuraRawBuckets.mockResolvedValue({ packed: 0, buckets: [] })
  nullHistoricalDecoded.mockResolvedValue({ nulled: 0, remaining: 0 })
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the gate on the destructive levers', () => {
  const CALLS: [string, () => Promise<Response>][] = [
    ['pack GET', () => packCount()],
    ['pack POST', () => pack()],
    ['backfill POST', () => nullDecoded()],
  ]

  it('refuses each of them without a session', async () => {
    sessionUser = null
    for (const [name, call] of CALLS) expect((await call()).status, name).toBe(401)
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
    expect(nullHistoricalDecoded).not.toHaveBeenCalled()
  })

  it('ignores a stale isAdmin claim on a route that DELETES', async () => {
    // The claim says true, the row says false. With both false the route could read either and
    // still refuse — and the whole point of the DB round-trip is a revoked admin whose 30-day token
    // still says otherwise. On the one endpoint that drops archival frames, that matters most.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of CALLS) expect((await call()).status, name).toBe(403)
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
    expect(nullHistoricalDecoded).not.toHaveBeenCalled()
  })

  it('answers 503 when the admin check itself could not run (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of CALLS) expect((await call()).status, name).toBe(503)
    // The direction that matters: an outage must not let a destructive run through, and must not
    // read as a refusal either.
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
    expect(nullHistoricalDecoded).not.toHaveBeenCalled()
  })
})

describe('POST /api/oura-ble/samples/pack', () => {
  it('packs the default bucket count when the button sends no body at all', async () => {
    // The admin UI posts nothing. `readJsonLimited` answers `no_body`, which must fall through to
    // the default rather than being treated as a malformed request.
    const res = await pack()
    expect(res.status).toBe(200)
    expect(packOuraRawBuckets).toHaveBeenCalledWith('u-1', 25)
  })

  it('clamps the bucket count at both ends and floors a fraction', async () => {
    // Every value differs from the default 25, so a route that ignored the body could not pass any
    // of these by landing on the same number.
    for (const [maxBuckets, expected] of [
      [10, 10], [0, 1], [-4, 1], [500, 200], [30.9, 30],
      ['50', 25], [NaN, 25], [Infinity, 25], [null, 25],
    ] as [unknown, number][]) {
      packOuraRawBuckets.mockClear()
      await pack({ maxBuckets })
      expect(packOuraRawBuckets.mock.calls[0][1], String(maxBuckets)).toBe(expected)
    }
  })

  it('reports a failed RUN as a 500, never as "packed 0"', async () => {
    // The caller decides whether to press again from this. Collapsing a broken run into a zero
    // count reads as "nothing left to pack" and stops the owner mid-way through 1.1M rows.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    packOuraRawBuckets.mockRejectedValue(new Error('statement timeout'))
    const res = await pack()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'statement timeout' })
    log.mockRestore()
  })

  it('passes a refused bucket through as a result, because one mismatch must not abandon the rest', async () => {
    // A bucket whose re-read frames did not match is reported and the run continues — that is a
    // 200 carrying a refusal, not an error. The verification is what makes the delete safe, so its
    // failures have to be visible without stopping the pass.
    packOuraRawBuckets.mockResolvedValue({
      packed: 2, remaining: 7,
      buckets: [{ ds: 1, ok: true }, { ds: 2, ok: false, reason: 'frames did not match' }],
    })
    const res = await pack()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.packed).toBe(2)
    expect(body.buckets[1]).toEqual({ ds: 2, ok: false, reason: 'frames did not match' })
  })

  it('rate-limits the run, and checks admin BEFORE spending the bucket', async () => {
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await pack()).status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()

    getUserById.mockResolvedValue({ isAdmin: true })
    rateLimit.mockReturnValue(false)
    expect((await pack()).status).toBe(429)
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
  })

  it('413s an oversized body rather than reading it', async () => {
    expect((await pack({ maxBuckets: 10, pad: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
  })

  it('counts without touching anything, and is not rate-limited', async () => {
    // GET is the "how much is packable" read the owner watches between presses; limiting it would
    // make the destructive button harder to use safely, not easier.
    countPackableBuckets.mockResolvedValue({ buckets: 43, sealBelowDs: 900_000 })
    const res = await packCount()
    expect(await res.json()).toEqual({ buckets: 43, sealBelowDs: 900_000 })
    // Scoped to the caller. Asserting only the response body left this open — the mutation pass
    // swapped the id for another user's and the case still passed, because a mock returns the same
    // rows whoever asks. Every repository call in this file now asserts its user argument.
    expect(countPackableBuckets).toHaveBeenCalledWith('u-1')
    expect(rateLimit).not.toHaveBeenCalled()
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
  })
})

describe('POST /api/oura-ble/samples/backfill-null-decoded', () => {
  it('clears the whole backlog by default, letting the repository choose its own batch size', async () => {
    // `undefined`, not a number: the default lives in the repository, which batches at 500 rows per
    // UPDATE so no single statement risks the pool's statement_timeout. A default invented here
    // would silently override that.
    await nullDecoded()
    expect(nullHistoricalDecoded).toHaveBeenCalledWith('u-1', undefined)
  })

  it('accepts a positive row cap and refuses to invent one from anything else', async () => {
    for (const [maxRows, expected] of [
      [1000, 1000], [2_000_000, 1_000_000],
      [0, undefined], [-5, undefined], [NaN, undefined], ['500', undefined], [null, undefined],
    ] as [unknown, number | undefined][]) {
      nullHistoricalDecoded.mockClear()
      await nullDecoded({ maxRows })
      expect(nullHistoricalDecoded.mock.calls[0][1], String(maxRows)).toBe(expected)
    }
  })

  it('reports what it nulled and what is left', async () => {
    nullHistoricalDecoded.mockResolvedValue({ nulled: 500, remaining: 12_000 })
    expect(await (await nullDecoded()).json()).toEqual({ nulled: 500, remaining: 12_000 })
  })

  it('is limited more tightly than pack, because it is a full-table pass', async () => {
    await nullDecoded()
    expect(rateLimit).toHaveBeenCalledWith('oura-ble-backfill-null-decoded:u-1', 4, 60_000)

    nullHistoricalDecoded.mockClear()
    rateLimit.mockReturnValue(false)
    expect((await nullDecoded()).status).toBe(429)
    expect(nullHistoricalDecoded).not.toHaveBeenCalled()
  })

  it('reaches exactly one repository method — the one that leaves body_hex alone', async () => {
    // The strongest thing a mocked test can say about the archival rule: this route calls
    // `nullHistoricalDecoded` and nothing else. It cannot prove the SQL leaves `body_hex` alone —
    // that lives in the repository slice — but it does prove the route asks for nothing further,
    // so a future edit that added a delete beside it fails here.
    await nullDecoded({ maxRows: 100 })
    expect(nullHistoricalDecoded).toHaveBeenCalledTimes(1)
    expect(packOuraRawBuckets).not.toHaveBeenCalled()
    expect(countPackableBuckets).not.toHaveBeenCalled()
  })

  it('413s an oversized body rather than reading it', async () => {
    expect((await nullDecoded({ maxRows: 10, pad: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(nullHistoricalDecoded).not.toHaveBeenCalled()
  })
})
