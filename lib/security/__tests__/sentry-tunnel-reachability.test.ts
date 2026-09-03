import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCsp } from '@/lib/security/csp'

// BF-92. Sentry was correctly wired and heard nothing from the browser for 13 days, because
// `connect-src` never named the ingest host. `instrumentation-client.ts` predicted that exact
// failure in a comment, and the comment stopped nothing — which is the lesson this file exists to
// act on rather than restate. The fix (tunnelling same-origin through `/monitoring`) has two
// silent-failure modes of its own, and both are checked here:
//
//   1. the tunnel route falls back under the auth gate, so an unauthenticated report 307s to
//      /sign-in and vanishes; and
//   2. somebody "tidies" the tunnel away and re-opens `connect-src` to a vendor host instead.
describe('the Sentry tunnel stays reachable', () => {
  // Read as source rather than imported: `middleware.ts` pulls in next-auth, which does not resolve
  // under vitest. The matcher is a string literal either way, and it is the string Next compiles.
  const middlewareSrc = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')
  const matchers = [...middlewareSrc.matchAll(/matcher:\s*\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(q => q[1]))

  it('the matcher was actually found, so the assertions below mean something', () => {
    expect(matchers.length).toBeGreaterThan(0)
  })

  // The tunnel sits BEHIND the auth gate, deliberately (BF-92, owner decision 2026-09-03). A
  // signed-in request falls through the middleware without a redirect, so the tunnel works for every
  // session — which is the defect that was reported. Excluding the path would additionally capture
  // errors from the sign-in screen, and would make it an unauthenticated relay to any Sentry
  // project; that trade was declined.
  //
  // Pinned so the exclusion cannot be reintroduced casually: putting it back is a real decision with
  // a security cost, not a tidy-up.
  it('the middleware matcher DOES capture /monitoring — it is gated on purpose', () => {
    expect(matchers.some(m => new RegExp(`^${m}$`).test('/monitoring'))).toBe(true)
  })

  // Without this the test above passes against a matcher that captures nothing at all.
  it('…while still capturing an ordinary page', () => {
    expect(matchers.some(m => new RegExp(`^${m}$`).test('/health'))).toBe(true)
  })

  it('next.config.ts routes Sentry through that same path', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
    expect(cfg).toMatch(/tunnelRoute:\s*'\/monitoring'/)
  })

  // The service worker's catch-all branch caches any ok response, and the Cache API rejects a POST
  // Request — so without an early return every successful error report raises an unhandled
  // rejection inside the worker. Found by reading the worker, not by running it: the SW does not
  // run in the sandbox at all, which is the general shape of what this app's device gate is for.
  it('the service worker hands the tunnel path to the browser untouched', () => {
    const sw = readFileSync(join(process.cwd(), 'public/sw-template.js'), 'utf8')
    const branch = sw.indexOf('url.pathname === "/monitoring"')
    expect(branch, 'the service worker must special-case the tunnel path').toBeGreaterThan(-1)
    // …and it must be an early return, not a respondWith that re-enters the caching path.
    expect(sw.slice(branch, branch + 120)).toMatch(/\{\s*return;\s*\}/)
    // Before the catch-all, or the early return is unreachable.
    expect(branch).toBeLessThan(sw.indexOf('e.respondWith(\n    fetch(e.request)'))
  })

  // The tunnel exists so this stays true. A vendor host reappearing in connect-src means somebody
  // has reverted to the shape that broke, and the tunnel is now dead weight defended by a comment.
  it('and no Sentry host is opened in connect-src, because none is needed', () => {
    const connectSrc = buildCsp(false).split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'))
    expect(connectSrc, 'connect-src must exist for this rule to mean anything').toBeTruthy()
    expect(connectSrc).not.toMatch(/sentry/i)
  })
})
