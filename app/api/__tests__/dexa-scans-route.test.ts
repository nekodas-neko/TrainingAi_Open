// BF-41 / BF-2 — the validation gate in front of `saveDexaScan`, tested for the three ways this
// repo has historically shipped one broken.
//
//  * a **dash-only date regex** rejects every real request, because the client's `localDateString()`
//    emits `YYYY/MM/DD` — CLAUDE.md records this costing `ai-chat` a full release;
//  * a **`min(0)` on a T-score** rejects every osteopenic result, which is most of the ones worth
//    storing at all (the owner's is −1.6);
//  * a **duplicate region** would be swallowed by the `(scan_id, region)` unique index, so a
//    mis-parsed printout would store a scan quietly missing a leg.
//
// The repository is mocked: this is the gate, not the storage. `dexa-scans.test.ts` covers the
// storage against a real Postgres.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const saveDexaScan = vi.fn(async () => {})
const listDexaScans = vi.fn(async () => [])
const repo = { saveDexaScan, listDexaScans }
vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/dexa-scans/route')
  return POST(new NextRequest('http://x/api/dexa-scans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const MINIMAL = { scannedOn: '2026-08-27' }

describe('POST /api/dexa-scans', () => {
  beforeEach(() => { saveDexaScan.mockClear(); listDexaScans.mockClear(); authMock.mockClear() })

  it('accepts the minimum: a date and nothing else', async () => {
    expect((await post(MINIMAL)).status).toBe(200)
    expect(saveDexaScan).toHaveBeenCalledWith('u1', expect.objectContaining({ scannedOn: '2026-08-27' }))
  })

  // The regex accepts both separators and the handler normalises; a date reaching the repository
  // with slashes would land as a text date the `date` column rejects.
  it('accepts the slashed form the client actually sends, and stores it dashed', async () => {
    expect((await post({ scannedOn: '2026/08/27' })).status).toBe(200)
    expect(saveDexaScan.mock.calls[0][1]).toMatchObject({ scannedOn: '2026-08-27' })
  })

  it('rejects a malformed date without reaching the repository', async () => {
    for (const scannedOn of ['not-a-date', '26-08-27', '2026-8-27', '', '2026-08-27T00:00:00Z']) {
      const res = await post({ scannedOn })
      expect(res.status, JSON.stringify(scannedOn)).toBe(400)
    }
    expect(saveDexaScan).not.toHaveBeenCalled()
  })

  it('stores a negative T and Z score rather than refusing them', async () => {
    expect((await post({ ...MINIMAL, tScore: -1.6, zScore: -1.6 })).status).toBe(200)
    expect(saveDexaScan.mock.calls[0][1]).toMatchObject({ tScore: -1.6, zScore: -1.6 })
  })

  it('refuses a duplicate region instead of silently dropping one at the unique index', async () => {
    const res = await post({
      ...MINIMAL,
      regions: [{ region: 'L Leg', bmd: 1.15 }, { region: 'l leg', bmd: 1.16 }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Duplicate region in scan')
    expect(saveDexaScan).not.toHaveBeenCalled()
  })

  it('allows the aggregates the printout prints beside the regions', async () => {
    const regions = [{ region: 'L Leg' }, { region: 'Subtotal' }, { region: 'Head' }, { region: 'Total' }]
    expect((await post({ ...MINIMAL, regions })).status).toBe(200)
    expect(saveDexaScan.mock.calls[0][1]).toMatchObject({ regions })
  })

  // `.strict()` is what stops a renamed client field arriving, being ignored, and reading as a save
  // that worked — the "save doesn't persist" shape CLAUDE.md names.
  it('rejects an unknown field rather than dropping it', async () => {
    expect((await post({ ...MINIMAL, bodyFatPct: 28.5 })).status).toBe(400)
    expect(saveDexaScan).not.toHaveBeenCalled()
  })

  it('rejects a value outside plausibility — grams entered as kilograms', async () => {
    expect((await post({ ...MINIMAL, weightKg: 72007.6 })).status).toBe(400)
    expect((await post({ ...MINIMAL, pctFat: 285 })).status).toBe(400)
    expect(saveDexaScan).not.toHaveBeenCalled()
  })

  // There is no third `source` value: nothing unconfirmed reaches this table.
  it('takes only manual or extracted as a source', async () => {
    expect((await post({ ...MINIMAL, source: 'extracted' })).status).toBe(200)
    expect((await post({ ...MINIMAL, source: 'ai' })).status).toBe(400)
  })

  it('is 401 with no session, before any parse', async () => {
    authMock.mockResolvedValueOnce(null)
    expect((await post(MINIMAL)).status).toBe(401)
    expect(saveDexaScan).not.toHaveBeenCalled()
  })
})

describe('GET /api/dexa-scans', () => {
  beforeEach(() => { listDexaScans.mockClear(); authMock.mockClear() })

  it('returns the series, not just the latest — one pair cannot tell an offset from a ratio', async () => {
    const { GET } = await import('@/app/api/dexa-scans/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scans: [] })
    expect(listDexaScans).toHaveBeenCalledWith('u1')
  })

  it('is never HTTP-cached — the layer invalidateCache() cannot reach', async () => {
    const { GET } = await import('@/app/api/dexa-scans/route')
    expect((await GET()).headers.get('cache-control')).toBe('private, no-store')
  })

  it('is 401 with no session', async () => {
    authMock.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/dexa-scans/route')
    expect((await GET()).status).toBe(401)
    expect(listDexaScans).not.toHaveBeenCalled()
  })
})
