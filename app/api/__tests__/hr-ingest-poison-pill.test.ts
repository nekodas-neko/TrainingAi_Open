// Regression for G-2: one out-of-band strap sample (bpm=0 at strap-on, an RR artifact) must not
// Zod-reject the whole flush — the good samples/beats land and the route returns 200. The client
// swallows a 400 and drops the batch, so a batch reject = silent data loss.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
const upsertOuraHeartrate = vi.fn(async () => {})
const insertRrIntervals = vi.fn(async () => {})
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ upsertOuraHeartrate, insertRrIntervals })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

import { POST } from '@/app/api/hr-ingest/route'

const post = (body: unknown) => POST(new Request('http://x/api/hr-ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('POST /api/hr-ingest — per-sample tolerance (G-2)', () => {
  // Recent timestamps so the SEC-I1 window filter (now ± tolerance) keeps them —
  // the timestamp value is incidental to these bpm/RR filtering tests.
  const T = Date.now() - 60_000
  beforeEach(() => { upsertOuraHeartrate.mockClear(); insertRrIntervals.mockClear() })

  it('stores in-band samples and drops the bpm=0 acquisition sample, still 200', async () => {
    const res = await post({ samples: [
      { at: T, bpm: 0 },          // strap-on acquisition artifact
      { at: T + 1_000, bpm: 132 },
      { at: T + 2_000, bpm: 134 },
    ] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stored).toBe(2)
    const stored = upsertOuraHeartrate.mock.calls[0][1]
    expect(stored.map((s: { bpm: number }) => s.bpm)).toEqual([132, 134])
  })

  it('drops an RR artifact but keeps the plausible beats in the same sample', async () => {
    const res = await post({ samples: [
      { at: T, bpm: 60, rr: [900, 63999, 950] }, // middle beat is an artifact
    ] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rrStored).toBe(2)
    const rows = insertRrIntervals.mock.calls[0][1]
    expect(rows.map((r: { rrMs: number }) => r.rrMs).sort()).toEqual([900, 950])
  })

  it('still 400s on a structurally invalid payload', async () => {
    const res = await post({ samples: [{ at: 'nope', bpm: 120 }] })
    expect(res.status).toBe(400)
  })

  it('returns 200 with stored:0 when every sample is out of band (no batch reject)', async () => {
    const res = await post({ samples: [{ at: T, bpm: 0 }, { at: T, bpm: 300 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).stored).toBe(0)
    expect(upsertOuraHeartrate).not.toHaveBeenCalled()
  })

  it('SEC-I1: drops out-of-window timestamps per-sample (far past / far future), no batch reject', async () => {
    const res = await post({ samples: [
      { at: T, bpm: 120 },                    // in window → kept
      { at: 1_700_000_000_000, bpm: 121 },    // ~2023, > 7 days past → dropped
      { at: Date.now() + 10 * 60_000, bpm: 122 }, // 10 min future → dropped
    ] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stored).toBe(1)
    expect(upsertOuraHeartrate.mock.calls[0][1].map((s: { bpm: number }) => s.bpm)).toEqual([120])
  })

  it('SEC-I1: 400s on an absurd (Invalid-Date) epoch that would 500 the driver', async () => {
    const res = await post({ samples: [{ at: 1e16, bpm: 120 }] })
    expect(res.status).toBe(400)
  })
})
