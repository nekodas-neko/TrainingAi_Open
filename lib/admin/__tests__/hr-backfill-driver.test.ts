// Issue 2383 (item 6): the HR backfill loop stays under the route's 6-a-minute limit and resumes
// after a 429, instead of dying partway through a big backlog.
import { describe, it, expect } from 'vitest'
import { driveHrBackfill, type BackfillPassResult } from '@/lib/admin/hr-backfill-driver'

// A fake clock the injected sleep advances, and a fake route enforcing the real limit: 6 calls in a
// fixed 60 s window starting at its first call.
function fakeRoute(passesNeeded: number, limit = 6) {
  let clock = 0
  let windowStart = -1
  let inWindow = 0
  let served = 0
  let attempts = 0
  let tooMany = 0
  const runPass = async (): Promise<BackfillPassResult> => {
    attempts++
    if (windowStart < 0 || clock - windowStart >= 60_000) { windowStart = clock; inWindow = 0 }
    if (inWindow >= limit) { tooMany++; return { kind: 'rate-limited' } }
    inWindow++
    served++
    return { kind: 'ok', pass: { processed: 500, withData: 400, remaining: served < passesNeeded } }
  }
  return {
    runPass,
    sleep: async (ms: number) => { clock += ms },
    now: () => clock,
    stats: () => ({ served, attempts, tooMany, clock }),
  }
}

describe('driveHrBackfill', () => {
  it('drains a backlog far over 6 passes without ever hitting the limit', async () => {
    const r = fakeRoute(40)
    const out = await driveHrBackfill(r)
    expect(out).toEqual({ kind: 'done', processed: 40 * 500, withData: 40 * 400 })
    expect(r.stats().tooMany).toBe(0)
    // 40 passes at 5 a minute is 7 full windows of waiting, not a burst.
    expect(r.stats().clock).toBeGreaterThanOrEqual(7 * 60_000)
  })

  it('resumes the same pass after an unexpected 429 and finishes', async () => {
    // The server is already at its limit (another tab used it up): the first calls are refused.
    const r = fakeRoute(3)
    let burned = 0
    const real = r.runPass
    const out = await driveHrBackfill({
      ...r,
      runPass: async () => (burned++ < 2 ? { kind: 'rate-limited' } : real()),
    })
    expect(out).toEqual({ kind: 'done', processed: 1500, withData: 1200 })
  })

  it('stops with a clear message, keeping its count, when 429 never clears', async () => {
    const out = await driveHrBackfill({
      runPass: async () => ({ kind: 'rate-limited' }),
      sleep: async () => {},
      now: () => 0,
      callsPerWindow: 1000,
    })
    expect(out.kind).toBe('stopped')
    if (out.kind === 'stopped') expect(out.message).toContain('429')
  })

  it('stops at a non-429 failure and reports what it had done', async () => {
    let n = 0
    const r = fakeRoute(10)
    const out = await driveHrBackfill({
      ...r,
      runPass: async () => (++n <= 2 ? r.runPass() : { kind: 'failed', message: 'Backfill failed: HTTP 500' }),
    })
    expect(out).toEqual({ kind: 'stopped', processed: 1000, withData: 800, message: 'Backfill failed: HTTP 500' })
  })
})
