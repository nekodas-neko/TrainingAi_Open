/**
 * PS-39 — the four read-only Oura-BLE routes: `samples/summary`, `samples/raw`, `db-stats` and
 * `freshness`.
 *
 * Batched because they share one gate and differ from each other in exactly the ways that gate
 * matters. What each decides:
 *
 *   · **Three are admin-gated and one is not**, and the odd one out is deliberate: `freshness` is a
 *     cheap local read the app itself fires on open to decide whether to bother syncing, so it is
 *     user-gated only. The other three feed the admin tester UI. An accidental `requireAdmin` on
 *     `freshness` would break app start-up for a non-admin; its absence on the other three would
 *     expose a raw frame dump.
 *   · **The JWT's `isAdmin` claim is deliberately ignored.** It is stamped at login and can be 30
 *     days stale, so a revoked admin still carries a token saying otherwise. `requireAdmin` makes
 *     the DB round-trip on purpose.
 *   · **A failed admin CHECK is 503, not 403 (Q-548).** The check hits the database, so a bare
 *     catch turns an outage into `Forbidden` — the one status nobody retries or escalates. During
 *     the 2026-08-18 volume incident several minutes went into checking credentials while the
 *     dashboard already said the service was down.
 *   · **`samples/raw` parses hex tags from the query string**, and every malformed piece has to be
 *     dropped rather than reaching a query as `NaN`.
 *
 * Fixture discipline (the PS-39 note): the stale-claim case sets the JWT claim to **true** while the
 * database says false — with both false, nothing distinguishes reading the claim from reading the
 * row, and the rule this route exists to enforce would go untested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const getOuraRawSampleSummary = vi.fn(async (_u: string) => ({}) as Row)
const getOuraRawSamplesByTags = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraStorageStats = vi.fn(async () => ({}) as Row)
const getLatestOuraBleMeasuredAt = vi.fn(async (_u: string) => null as Date | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // One repo for both accessors: `requireAdmin` reaches for `getRepository` while the routes use
  // `getRepositoryAsync`, and the admin gate is the thing under test here, not a stub.
  const repo = async () => ({
    getUserById, getOuraRawSampleSummary, getOuraRawSamplesByTags,
    getOuraStorageStats, getLatestOuraBleMeasuredAt,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getSummary } from '@/app/api/oura-ble/samples/summary/route'
import { GET as getRaw } from '@/app/api/oura-ble/samples/raw/route'
import { GET as getDbStats } from '@/app/api/oura-ble/db-stats/route'
import { GET as getFreshness } from '@/app/api/oura-ble/freshness/route'

const raw = (qs = '') => getRaw(new Request(`http://localhost/api/oura-ble/samples/raw${qs}`))
const ADMIN_GATED: [string, () => Promise<Response>][] = [
  ['samples/summary', () => getSummary()],
  ['samples/raw', () => raw()],
  ['db-stats', () => getDbStats()],
]

beforeEach(() => {
  for (const m of [getUserById, getOuraRawSampleSummary, getOuraRawSamplesByTags,
                   getOuraStorageStats, getLatestOuraBleMeasuredAt, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getOuraRawSampleSummary.mockResolvedValue({ total: 0 })
  getOuraRawSamplesByTags.mockResolvedValue([])
  getOuraStorageStats.mockResolvedValue({ tables: [] })
  getLatestOuraBleMeasuredAt.mockResolvedValue(null)
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the admin gate on the Oura-BLE tester routes', () => {
  it('refuses every one of them without a session', async () => {
    sessionUser = null
    for (const [name, call] of ADMIN_GATED) {
      expect((await call()).status, name).toBe(401)
    }
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('ignores a stale isAdmin claim and asks the database instead', async () => {
    // **The claim says true and the row says false.** With both false the route could read either
    // and answer correctly, so the rule — a revoked admin keeps a token for up to 30 days — would
    // not be under test at all.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ADMIN_GATED) {
      const res = await call()
      expect(res.status, name).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    }
    expect(getUserById).toHaveBeenCalledWith('u-1')
    expect(getOuraRawSampleSummary).not.toHaveBeenCalled()
    expect(getOuraStorageStats).not.toHaveBeenCalled()
  })

  it('admits an admin whose token says nothing at all', async () => {
    // The other direction: the claim is absent, the row says admin, and the route proceeds. Without
    // this, "always 403" would pass the case above.
    sessionUser = { id: 'u-1' }
    getUserById.mockResolvedValue({ isAdmin: true })
    for (const [name, call] of ADMIN_GATED) {
      expect((await call()).status, name).toBe(200)
    }
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    // A database outage is not a refusal. 403 is the one status a caller will neither retry nor
    // escalate, and it points the investigation at credentials — which cost several minutes during
    // the 2026-08-18 incident while the dashboard already said the service was offline.
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ADMIN_GATED) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json()).toEqual({ error: 'Service unavailable' })
    }
  })
})

describe('GET /api/oura-ble/samples/raw', () => {
  it('defaults to the step/activity tag family and a 120-row page', async () => {
    await raw()
    expect(getOuraRawSamplesByTags).toHaveBeenCalledWith('u-1', [0x7e, 0x7f, 0x50, 0x51, 0x52], 120)
  })

  it('parses the tags as HEX, which is the whole point of the parameter', async () => {
    // `10` is sixteen, not ten. Decimal parsing would send the wrong frames back and the dump would
    // look empty for a tag that has plenty of rows.
    await raw('?tags=10,ff,7e')
    expect(getOuraRawSamplesByTags.mock.calls[0][1]).toEqual([16, 255, 126])
  })

  it('drops a tag it cannot parse or that cannot be a tag, rather than passing NaN down', async () => {
    // `zz` is not hex; `1ff` is 511, past a one-byte tag; `-1` is negative. Each is dropped and the
    // survivors still go through, so one bad entry does not discard a whole request.
    await raw('?tags=zz,7e,1ff,-1,50')
    expect(getOuraRawSamplesByTags.mock.calls[0][1]).toEqual([0x7e, 0x50])
  })

  it('sends an EMPTY tag list when every tag was malformed — pinned, not endorsed', async () => {
    // Current behaviour: the default only applies when the parameter is absent, so `?tags=zz`
    // becomes "no tags" rather than falling back or refusing. The dump then reads as "nothing
    // recorded", which is indistinguishable from a ring that is not syncing.
    await raw('?tags=zz,qq')
    expect(getOuraRawSamplesByTags.mock.calls[0][1]).toEqual([])
  })

  it('clamps the page size at both ends and ignores one it cannot read', async () => {
    for (const [qs, expected] of [
      ['?limit=5', 5],
      ['?limit=99999', 1000],   // capped — this scans an archival table
      ['?limit=-5', 1],         // floored
      ['?limit=abc', 120],      // unreadable falls back to the default
      ['?limit=0', 120],        // zero is falsy, so it takes the default rather than flooring to 1
    ] as [string, number][]) {
      getOuraRawSamplesByTags.mockClear()
      await raw(qs)
      expect(getOuraRawSamplesByTags.mock.calls[0][2], qs).toBe(expected)
    }
  })

  it('scopes the dump to the caller', async () => {
    getOuraRawSamplesByTags.mockResolvedValue([{ tag: 126, bodyHex: 'aabb' }])
    const res = await raw()
    expect(getOuraRawSamplesByTags.mock.calls[0][0]).toBe('u-1')
    expect(await res.json()).toEqual({ rows: [{ tag: 126, bodyHex: 'aabb' }] })
  })
})

describe('GET /api/oura-ble/db-stats', () => {
  it('rate-limits the scan, and checks admin BEFORE spending the bucket', async () => {
    // The raw-sample split scans an archival table, hence the limit. Checking admin first means a
    // non-admin cannot exhaust an admin's allowance.
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await getDbStats()).status).toBe(403)
    expect(rateLimit).not.toHaveBeenCalled()

    getUserById.mockResolvedValue({ isAdmin: true })
    rateLimit.mockReturnValue(false)
    expect((await getDbStats()).status).toBe(429)
    expect(getOuraStorageStats).not.toHaveBeenCalled()
  })

  it('returns the storage readout unchanged', async () => {
    getOuraStorageStats.mockResolvedValue({ tables: [{ name: 'oura_raw_samples', bytes: 52_000_000 }] })
    expect(await (await getDbStats()).json())
      .toEqual({ tables: [{ name: 'oura_raw_samples', bytes: 52_000_000 }] })
  })
})

describe('GET /api/oura-ble/freshness', () => {
  it('is NOT admin-gated, because the app itself calls it on open', async () => {
    // A `requireAdmin` here would break start-up for any non-admin. The asymmetry with its three
    // siblings is the design, not an oversight.
    sessionUser = { id: 'u-1', isAdmin: false }
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await getFreshness()).status).toBe(200)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('reports the last measurement as an ISO instant, or null when there is none', async () => {
    getLatestOuraBleMeasuredAt.mockResolvedValue(new Date('2026-03-01T22:15:00Z'))
    expect(await (await getFreshness()).json()).toEqual({ lastMeasuredAt: '2026-03-01T22:15:00.000Z' })

    getLatestOuraBleMeasuredAt.mockResolvedValue(null)
    // Null, not an empty string or the epoch: the caller decides whether to fire a sync from this,
    // and `new Date(0)` would read as a real measurement from 1970 rather than "never".
    expect(await (await getFreshness()).json()).toEqual({ lastMeasuredAt: null })
  })

  it('scopes the read to the caller, and refuses without a session', async () => {
    await getFreshness()
    expect(getLatestOuraBleMeasuredAt).toHaveBeenCalledWith('u-1')

    sessionUser = null
    expect((await getFreshness()).status).toBe(401)
  })
})
