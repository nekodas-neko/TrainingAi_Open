import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TN-51 — the server half. Ambient thinning now carries every dropped sample's RR intervals onto
 * the kept one, so a single 30-second sample legitimately holds ~30 beats at rest, where the schema
 * used to cap `rr` at 16. A cap below the carry would reject exactly the payload that fixes the bug,
 * and the client swallows a 400 and drops the batch — silent data loss, which is what TN-51 is.
 */
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
const upsertOuraHeartrate = vi.fn(async (_userId: string, _rows: unknown[]) => {})
const insertRrIntervals = vi.fn(async (_userId: string, _rows: { at: Date; rrMs: number }[]) => {})
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ upsertOuraHeartrate, insertRrIntervals })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

import { POST } from '@/app/api/hr-ingest/route'

const post = (body: unknown) => POST(new Request('http://x/api/hr-ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('TN-51 — a thinned sample carrying a whole window of beats', () => {
  const T = Date.now() - 60_000
  beforeEach(() => { upsertOuraHeartrate.mockClear(); insertRrIntervals.mockClear() })

  it('accepts 30 intervals on one sample — a resting 30-second window', async () => {
    const rr = Array.from({ length: 30 }, () => 1000)
    const res = await post({ samples: [{ at: T, bpm: 60, rr }] })
    expect(res.status).toBe(200)
    expect(insertRrIntervals).toHaveBeenCalledTimes(1)
    expect(insertRrIntervals.mock.calls[0][1]).toHaveLength(30)
  })

  it('places the carried beats BACK across the window, not all at the sample time', async () => {
    // This is why carrying forward is not an approximation: the route walks `rr` backwards from
    // `sample.at`, so the reconstructed times are the real ones. If they all landed on `at`, rMSSD
    // would be computed over a series that never happened.
    const rr = Array.from({ length: 30 }, () => 1000)
    await post({ samples: [{ at: T, bpm: 60, rr }] })
    const rows = insertRrIntervals.mock.calls[0][1]
    const times = rows.map(r => r.at.getTime()).sort((a, b) => a - b)
    expect(times[times.length - 1]).toBe(T)
    // 30 intervals of 1000 ms walk back ~29 s from the sample.
    expect(T - times[0]).toBeGreaterThanOrEqual(28_000)
    expect(T - times[0]).toBeLessThanOrEqual(30_000)
  })

  it('still rejects a batch above the cap, so the bound is real', async () => {
    const rr = Array.from({ length: 101 }, () => 1000)
    expect((await post({ samples: [{ at: T, bpm: 60, rr }] })).status).toBe(400)
  })

  it('accepts exactly the cap', async () => {
    const rr = Array.from({ length: 100 }, () => 1000)
    expect((await post({ samples: [{ at: T, bpm: 180, rr }] })).status).toBe(200)
  })
})

describe('TN-51 — the two caps are in different languages and must not drift', () => {
  it('the native splitter and the route schema agree on the per-sample limit', () => {
    // The Kotlin splits a window that exceeds its own cap into several samples. If the route's cap
    // were LOWER, those chunks would 400 and the batch would be dropped — the same silent loss.
    // Nothing else compares these two numbers, and they sit in different toolchains.
    const kt = readFileSync(join(__dirname,
      '../../../android/app/src/main/java/com/trainingai/app/polar/PolarAmbientThinner.kt'), 'utf8')
    const ts = readFileSync(join(__dirname, '../hr-ingest/route.ts'), 'utf8')
    const ktCap = Number(/const val MAX_RR_PER_SAMPLE = (\d+)/.exec(kt)?.[1])
    const tsCap = Number(/const MAX_RR_PER_SAMPLE = (\d+)/.exec(ts)?.[1])
    expect(ktCap, 'PolarAmbientThinner.MAX_RR_PER_SAMPLE not found — renamed?').toBeGreaterThan(0)
    expect(tsCap, 'hr-ingest MAX_RR_PER_SAMPLE not found — renamed?').toBeGreaterThan(0)
    expect(tsCap).toBe(ktCap)
  })
})
