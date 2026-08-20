// The CSP had no test at all until Q-546, which is why a missing directive went unnoticed: the WASM
// parity test (`lib/oura-models/__tests__/wasm-parity.test.ts`) runs under Node, which enforces no
// CSP, so it proved the model matched its golden while nothing could have loaded it in a browser.
// These assertions are about the header the browser actually receives.
import { describe, it, expect } from 'vitest'
import { buildCsp } from '../csp'

const directive = (csp: string, name: string) =>
  csp.split('; ').find(d => d.startsWith(`${name} `)) ?? ''

describe('content security policy', () => {
  const prod = buildCsp(false)
  const dev = buildCsp(true)

  // Q-546: without this, no WebAssembly session can start in production, which blocks every
  // on-device model. `onnxruntime-web` is already a dependency.
  it('permits WebAssembly compilation in production', () => {
    expect(directive(prod, 'script-src')).toContain("'wasm-unsafe-eval'")
  })

  // The narrowness is the whole justification for allowing it: 'wasm-unsafe-eval' permits WASM
  // compilation only, and must never be read as licence to relax eval generally.
  it('does not relax eval generally in production', () => {
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'")
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'")
  })

  it('keeps the directives that are not about scripts closed', () => {
    expect(directive(prod, 'object-src')).toBe("object-src 'none'")
    expect(directive(prod, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(prod, 'base-uri')).toBe("base-uri 'self'")
    expect(prod).toContain("default-src 'self'")
  })

  // Two hosts have been added to img-src and forgotten in connect-src before: the service worker
  // re-issues every request through `fetch()`, which is governed by connect-src whatever the
  // resource type, so a tile or dataset image listed in only one of the two is silently blocked.
  it('lists every remote image host in connect-src as well, for the service worker refetch', () => {
    const imgHosts = directive(prod, 'img-src').split(' ').filter(t => t.startsWith('https://'))
    const connect = directive(prod, 'connect-src')
    expect(imgHosts.length).toBeGreaterThan(0)
    // Google's avatar CDNs are <img> loads the SW does not re-fetch; everything else must be in both.
    for (const host of imgHosts.filter(h => !h.includes('googleusercontent.com'))) {
      expect(connect, `${host} is in img-src but not connect-src`).toContain(host)
    }
  })

  it('dev and production differ only in the eval allowance', () => {
    expect(dev.replace(" 'unsafe-eval'", '')).toBe(prod)
  })
})
