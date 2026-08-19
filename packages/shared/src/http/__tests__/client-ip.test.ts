import { describe, it, expect } from 'vitest'
import { clientIpFromForwardedFor, trustedProxyCount } from '../client-ip'

describe('clientIpFromForwardedFor (Q-493)', () => {
  // The measured bypass: 30 wrong-secret attempts with a rotating X-Forwarded-For produced 30
  // distinct rate_limits keys at count 1 each, so every attempt reached the secret compare. With
  // the rightmost hop it is one key, and the gate engages.
  it('a caller rotating the leftmost hop cannot rotate its own rate-limit key', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 30; i++) {
      keys.add(clientIpFromForwardedFor(`10.0.0.${i}, 203.0.113.7`, 1))
    }
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('203.0.113.7')
  })

  it('the old leftmost read is what it replaces — pinned so the difference stays visible', () => {
    const header = '10.0.0.99, 203.0.113.7'
    const leftmost = header.split(',')[0]!.trim()
    expect(leftmost).toBe('10.0.0.99')                                  // caller-supplied
    expect(clientIpFromForwardedFor(header, 1)).toBe('203.0.113.7')     // proxy-supplied
  })

  it('an unspoofed single-proxy request keys on the real client', () => {
    expect(clientIpFromForwardedFor('203.0.113.7', 1)).toBe('203.0.113.7')
  })

  it('counts in from the right for a deeper proxy chain', () => {
    // Two of our own hops in front: the client is two from the right, and everything left of it is
    // forgeable.
    expect(clientIpFromForwardedFor('9.9.9.9, 203.0.113.7, 10.1.1.1', 2)).toBe('203.0.113.7')
    expect(clientIpFromForwardedFor('203.0.113.7, 10.1.1.1', 2)).toBe('203.0.113.7')
  })

  it('clamps rather than throwing when fewer hops arrive than configured', () => {
    expect(clientIpFromForwardedFor('203.0.113.7', 3)).toBe('203.0.113.7')
  })

  it('falls back to the previous behaviour when there is no usable header', () => {
    expect(clientIpFromForwardedFor(null)).toBe('unknown')
    expect(clientIpFromForwardedFor('')).toBe('unknown')
    expect(clientIpFromForwardedFor('   ')).toBe('unknown')
    expect(clientIpFromForwardedFor(',,')).toBe('unknown')
  })

  it('tolerates the whitespace real proxies emit', () => {
    expect(clientIpFromForwardedFor('  10.0.0.1 ,  203.0.113.7  ', 1)).toBe('203.0.113.7')
  })
})

describe('trustedProxyCount', () => {
  it('defaults to one hop — the Railway shape', () => {
    expect(trustedProxyCount({})).toBe(1)
    expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: '' })).toBe(1)
  })

  it('reads a configured depth', () => {
    expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: '2' })).toBe(2)
  })

  // Zero would mean "trust the leftmost hop", which is precisely the bypass. A typo in an env var
  // must not reopen it, so a malformed value falls back to the default rather than to 0.
  it('refuses to fall open on a malformed or zero value', () => {
    for (const raw of ['0', '-1', 'abc', '1.5', 'NaN']) {
      expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: raw })).toBe(1)
    }
  })
})
