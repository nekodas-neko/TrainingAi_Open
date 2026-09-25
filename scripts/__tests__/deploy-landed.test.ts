// OR-168 — the deploy check's logic, tested where the workflow's shell could not be.
//
// The three properties below are the ones that make the difference between a check that catches a
// failed deploy and a check that reports success against the previous one.
import { describe, it, expect, vi } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { shaMatches, diagnose, waitForDeploy, MIN_PREFIX } =
  require('../check-deploy-landed.js') as typeof import('../check-deploy-landed.js')

const FULL = 'cdbc613d25961f0a9b3c4d5e6f7a8b9c0d1e2f30'

describe('shaMatches (OR-168)', () => {
  it('matches a full sha against the 12 characters sw.js truncates to', () => {
    expect(shaMatches(FULL, FULL.slice(0, 12))).toBe(true)
    expect(shaMatches(FULL.slice(0, 12), FULL)).toBe(true)
  })

  it('matches a sha against itself, and is case-insensitive', () => {
    expect(shaMatches(FULL, FULL)).toBe(true)
    expect(shaMatches(FULL.toUpperCase(), FULL)).toBe(true)
  })

  // Two FULL shas that merely share a prefix are different commits, and neither is a truncation of
  // the other — so this is a mismatch, not a match. The only prefix that counts is one where one
  // string really is the head of the other, which is the sw.js-truncation case above.
  it('refuses a different commit that shares a prefix but is not a truncation', () => {
    expect(shaMatches(FULL, 'cdbc613d2596ffffffffffffffffffffffffffff')).toBe(false)
    expect(shaMatches(FULL, 'cdbc61affffffffffffffffffffffffffffffff0')).toBe(false)
  })

  // The unavoidable corner, stated so it is a decision rather than an accident: a 12-character
  // report that collides with this commit's first 12 does match. That is a 2^48 collision, and the
  // alternative — refusing every truncated report — would fail against sw.js's own format.
  it('accepts a truncation, which is what makes a 12-character report usable at all', () => {
    expect(shaMatches(FULL, FULL.slice(0, 12))).toBe(true)
  })

  // Without a floor, a one- or two-character "sha" prefix-matches everything, and the check would
  // pass against any deploy at all.
  it('refuses a prefix too short to identify anything', () => {
    expect(MIN_PREFIX).toBe(7)
    expect(shaMatches(FULL, 'cdbc6')).toBe(false)
    expect(shaMatches(FULL, '')).toBe(false)
  })

  it('refuses a non-string, which is what a missing field arrives as', () => {
    expect(shaMatches(FULL, null as unknown as string)).toBe(false)
    expect(shaMatches(FULL, undefined as unknown as string)).toBe(false)
  })
})

describe('diagnose (OR-168)', () => {
  // Three genuinely different faults. Collapsing them into "deploy failed" would send someone
  // looking at Railway when the answer is an unset environment variable.
  it('names an unreachable app', () => {
    expect(diagnose({ want: FULL, got: null, body: null, elapsedMs: 60_000 }))
      .toContain('did not answer at all')
  })

  it('names a missing webBuildSha, and points at the variable', () => {
    const m = diagnose({ want: FULL, got: null, body: { version: '1.0.0' }, elapsedMs: 60_000 })
    expect(m).toContain('no webBuildSha')
    expect(m).toContain('RAILWAY_GIT_COMMIT_SHA')
  })

  it('names the commit still being served', () => {
    expect(diagnose({ want: FULL, got: 'aaaaaaaaaaaa', body: {}, elapsedMs: 60_000 }))
      .toContain('aaaaaaaaaaaa')
  })
})

describe('waitForDeploy (OR-168)', () => {
  const ok = (sha: string | null) => ({
    ok: true, json: async () => (sha == null ? { version: '1' } : { version: '1', webBuildSha: sha }),
  })

  it('succeeds once production reports the commit, and reports how long it took', async () => {
    let t = 0
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok('aaaaaaaaaaaa'))
      .mockResolvedValueOnce(ok(FULL))
    const r = await waitForDeploy({
      want: FULL, deadlineMs: 600_000, pollMs: 20_000, fetchImpl,
      sleep: async (ms: number) => { t += ms }, now: () => t,
    })
    expect(r.ok).toBe(true)
    expect(r.elapsedMs).toBe(40_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  // The cache-bust is the whole reason this poll is trustworthy: `/api/version` is
  // `public, max-age=300`, so a repeated identical URL can answer from five minutes ago.
  it('sends a different url every poll', async () => {
    let t = 0
    const fetchImpl = vi.fn().mockResolvedValue(ok('aaaaaaaaaaaa'))
    await waitForDeploy({
      want: FULL, deadlineMs: 40_000, pollMs: 20_000, fetchImpl,
      sleep: async (ms: number) => { t += ms }, now: () => t,
    })
    const urls = fetchImpl.mock.calls.map(c => c[0] as string)
    expect(urls.length).toBeGreaterThan(1)
    expect(new Set(urls).size).toBe(urls.length)
    for (const u of urls) expect(u).toContain('/api/version?cb=')
  })

  it('fails at the deadline with the diagnosis, rather than waiting forever', async () => {
    let t = 0
    const fetchImpl = vi.fn().mockResolvedValue(ok('aaaaaaaaaaaa'))
    const r = await waitForDeploy({
      want: FULL, deadlineMs: 60_000, pollMs: 20_000, fetchImpl,
      sleep: async (ms: number) => { t += ms }, now: () => t,
    })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('still serving aaaaaaaaaaaa')
  })

  // A deploy that takes the app down is exactly the case this check exists for, so a throwing or
  // non-ok fetch must keep polling rather than crash the job.
  it('keeps polling through an unreachable app and reports it at the deadline', async () => {
    let t = 0
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await waitForDeploy({
      want: FULL, deadlineMs: 60_000, pollMs: 20_000, fetchImpl,
      sleep: async (ms: number) => { t += ms }, now: () => t,
    })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('did not answer at all')
  })
})
