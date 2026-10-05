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

  // RV-197 — `connect-src` ended in `ws: wss:`, two schemes that allowed a WebSocket to ANY host.
  // Nothing in app/, components/, lib/ or packages/ constructs a WebSocket and there is no ws
  // client in package.json; the only consumer is the dev server's HMR socket.
  it('does not allow a WebSocket to any host in production', () => {
    const connect = directive(prod, 'connect-src')
    expect(connect).not.toMatch(/(^| )wss?:( |$)/)
    // Dev keeps them, which is why this is conditional rather than deleted.
    expect(directive(dev, 'connect-src')).toMatch(/(^| )ws:( |$)/)
  })

  // The AI SDK calls Gemini from the SERVER. The browser never connects to it, so the host was
  // widening connect-src for nothing.
  it('does not let the browser reach the Gemini endpoint', () => {
    expect(prod).not.toContain('generativelanguage.googleapis.com')
    expect(dev).not.toContain('generativelanguage.googleapis.com')
  })

  // The point of this one is that the differences are ENUMERATED: anything dev gains that is not
  // on this list is a production/dev divergence nobody decided on.
  it('dev and production differ only in the eval allowance and the HMR socket', () => {
    // The two ws schemes are stripped by pattern rather than as a literal pair: their ORDER
    // carries no meaning, and pinning it makes this fail on a change that changes nothing. What
    // it still catches is the thing worth catching — a THIRD difference nobody decided on.
    expect(dev.replace(" 'unsafe-eval'", '').replace(/ wss?:/g, '')).toBe(prod)
  })
})
