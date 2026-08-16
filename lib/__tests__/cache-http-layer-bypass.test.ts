import { describe, it, expect, vi, afterEach } from 'vitest'
import { cachedFetch, cachedFetchToday } from '../sqlite/cache'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The browser's HTTP cache is a second cache layer underneath this one, and it is the only cache
 * in the app that `invalidateCache()` cannot reach. Aggregate GET routes USED to ship
 * `Cache-Control: private, max-age=60`, so a read could be answered from it without a network trip.
 *
 * An unsafe method only invalidates its OWN url, so a write to a different url than the read —
 * `DELETE /api/supplements/<id>` vs `GET /api/supplements` — left the stale list cached. Measured
 * in a browser before the fix: the delete returned 200 and the list kept returning the deleted row
 * for a minute. Same-url writes were already self-healing, which is why this only showed up on
 * some screens.
 *
 * Q-166 then took the routes themselves to `private, no-store` (2026-08-10), so there are now two
 * independent guarantees. Both are tested here, and both stay: the client bypass is free, and it
 * is the half that holds for a response from a route that regains a header.
 */
describe('client reads bypass the browser HTTP cache', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('cachedFetch asks for no-store, so revalidation cannot be answered from the HTTP cache', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: 1 }) }))
    vi.stubGlobal('fetch', fetchSpy)

    await cachedFetch('http-bypass-key', '/api/anything', 60, () => {})

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1]).toEqual({ cache: 'no-store' })
  })

  it('the today-envelope variant goes through the same path, so it inherits the bypass', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: 1 }) }))
    vi.stubGlobal('fetch', fetchSpy)

    await cachedFetchToday('http-bypass-key-today', '/api/anything-today', 60, () => {})

    expect(fetchSpy.mock.calls[0][1]).toEqual({ cache: 'no-store' })
  })

  it('the service worker passes it through too, so a bare fetch is covered as well', () => {
    // The SW intercepts every /api/ request and its own `fetch(e.request)` re-consults the HTTP
    // cache, which made its "never cache other API calls" comment untrue. Source-text because a
    // service worker cannot be instantiated under `environment: 'node'`.
    const sw = readFileSync(join(__dirname, '..', '..', 'public', 'sw-template.js'), 'utf8')
    const branch = sw.slice(sw.indexOf('url.pathname.startsWith("/api/")'))
    expect(branch.slice(0, 200)).toContain('cache: "no-store"')
  })

  it('and the routes no longer ask to be cached — the other half of the guarantee (Q-166)', () => {
    // The two halves fail independently: a route regaining a header is invisible to the client
    // tests above, and a new fetch helper without the bypass is invisible to this one. Asserted
    // here as well as in `scripts/check-api-no-store.js`, so `vitest run` alone still catches it.
    const api = join(__dirname, '..', '..', 'app', 'api')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue }
        if (entry.name !== 'route.ts') continue
        if (full.endsWith(join('api', 'version', 'route.ts'))) continue  // public, deliberately cacheable
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          if (/Cache-Control/i.test(line) && /\b(max-age|s-maxage|stale-while-revalidate|stale-if-error|immutable)\b/.test(line)) {
            offenders.push(`${full}: ${line.trim()}`)
          }
        }
      }
    }
    walk(api)
    expect(offenders).toEqual([])
  })
})
