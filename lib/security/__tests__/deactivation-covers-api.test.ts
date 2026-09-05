import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA-58. The deactivation gate lived in middleware and `api` was the FIRST exclusion in its matcher,
// so it ran on pages and on none of the 219 API routes — a deactivated or still-pending user kept
// full API access to their own data while their cookie was valid.
//
// Two things can go wrong with the fix, and both are silent:
//   1. `api` creeps back into the exclusion (or the pattern is "tidied"), and the gate stops running
//      again with nothing failing; or
//   2. the exclusion is widened too far and swallows `/api/auth/*` — the routes that CREATE a
//      session — which locks sign-in out of the app entirely.
//
// Read as source rather than imported: `middleware.ts` pulls in next-auth, which does not resolve
// under vitest. Same approach as the Sentry tunnel test beside this one.
describe('the deactivation gate reaches API routes (LA-58)', () => {
  const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')
  const matchers = [...src.matchAll(/matcher:\s*\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(q => q[1]))

  it('the matcher was actually found, so the assertions below mean something', () => {
    expect(matchers.length).toBe(1)
  })

  // The matcher is already regex-shaped, which is what lets this run the real pattern rather than a
  // paraphrase of it. A test that restated the intent in its own regex would pass while the shipped
  // one did something else.
  const covers = (path: string) => new RegExp(`^${matchers[0]}$`).test(path)

  it('reaches API routes — the whole point of the entry', () => {
    for (const p of [
      '/api/readiness-score',
      '/api/day-review/week-window',
      '/api/training-stress',
      '/api/admin/db-query',
      '/api/oura-ble/samples',
    ]) {
      expect(covers(p), `${p} must reach the gate`).toBe(true)
    }
  })

  it('does NOT reach the routes that create a session — this is the lockout case', () => {
    // NextAuth's own handler, the mobile PKCE exchange and registration. Gating these on having a
    // session is circular: it would make signing in impossible, including on a fresh APK install.
    for (const p of [
      '/api/auth/signin',
      '/api/auth/callback/google',
      '/api/auth/session',
      '/api/auth/exchange-mobile-token',
      '/api/auth/register',
    ]) {
      expect(covers(p), `${p} must stay outside the gate`).toBe(false)
    }
  })

  it('still reaches pages, and still skips static assets and the service worker', () => {
    expect(covers('/')).toBe(true)
    expect(covers('/health/day')).toBe(true)
    // BF-92 decided the Sentry tunnel stays behind the gate; that decision is not this entry's to move.
    expect(covers('/monitoring')).toBe(true)
    for (const p of ['/_next/static/chunk.js', '/sw.js', '/favicon.ico', '/manifest.webmanifest']) {
      expect(covers(p), `${p} must stay excluded`).toBe(false)
    }
  })

  it('answers an API request with a 403 rather than redirecting it', () => {
    // A 307 to /sign-in or /pending hands an API caller an HTML page, which no client reads as an
    // auth failure — the browser would follow it and a native client would parse markup as JSON.
    const apiBranch = src.slice(src.indexOf('pathname.startsWith("/api")'))
    expect(apiBranch).toContain('status: 403')
    expect(apiBranch.slice(0, apiBranch.indexOf('return\n'))).not.toContain('redirect')
  })

  it('leaves a session-less API request alone, so signature-authenticated routes still work', () => {
    // Ingest and webhook routes authenticate by signature and never carry a session. The gate must
    // key on an ACTIVE-false session, not on the absence of one, or they all start failing.
    const apiBranch = src.slice(src.indexOf('pathname.startsWith("/api")'))
    expect(apiBranch).toContain('req.auth && req.auth.isActive === false')
  })
})
