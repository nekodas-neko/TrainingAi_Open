import { describe, it, expect } from 'vitest'
import { fetchPublicUrl, isPublicAddress } from '../safe-fetch'

// Nothing here touches the network: DNS and fetch are both injected. The five cases the
// backlog entry names as acceptance criteria are the five `describe`s below.

function page(body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } })
}

const publicDns = async () => ['93.184.216.34']

describe('isPublicAddress', () => {
  it('rejects every private, loopback and link-local IPv4 range', () => {
    for (const addr of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
                        '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPublicAddress(addr), addr).toBe(false)
    }
  })

  it('accepts ordinary public IPv4', () => {
    for (const addr of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255']) {
      expect(isPublicAddress(addr), addr).toBe(true)
    }
  })

  it('rejects loopback, unique-local and link-local IPv6, including IPv4-mapped forms', () => {
    for (const addr of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
                        '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
      expect(isPublicAddress(addr), addr).toBe(false)
    }
    expect(isPublicAddress('2606:4700::1111')).toBe(true)
  })
})

describe('scheme', () => {
  it('rejects http://', async () => {
    const r = await fetchPublicUrl('http://example.com/recipe', {
      resolve: publicDns,
      fetchImpl: async () => page('<html></html>'),
    })
    expect(r).toEqual({ ok: false, reason: 'bad_scheme' })
  })

  it('rejects file:, gopher: and data:', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'data:text/html,<b>x</b>']) {
      const r = await fetchPublicUrl(url, { resolve: publicDns, fetchImpl: async () => page('') })
      expect(r.ok, url).toBe(false)
      if (!r.ok) expect(['bad_scheme', 'bad_url']).toContain(r.reason)
    }
  })

  it('rejects a non-443 port and embedded credentials', async () => {
    const port = await fetchPublicUrl('https://example.com:8080/x', { resolve: publicDns })
    expect(port).toEqual({ ok: false, reason: 'bad_port' })
    const creds = await fetchPublicUrl('https://user:pw@example.com/x', { resolve: publicDns })
    expect(creds).toEqual({ ok: false, reason: 'has_credentials' })
  })
})

describe('private addresses', () => {
  it('rejects a literal private host without consulting DNS', async () => {
    let resolved = false
    const r = await fetchPublicUrl('https://127.0.0.1/recipe', {
      resolve: async () => { resolved = true; return ['93.184.216.34'] },
      fetchImpl: async () => page(''),
    })
    expect(r).toEqual({ ok: false, reason: 'private_address' })
    expect(resolved).toBe(false)
  })

  it('rejects a public hostname that resolves to a private address', async () => {
    const r = await fetchPublicUrl('https://evil.example/recipe', {
      resolve: async () => ['169.254.169.254'],
      fetchImpl: async () => page(''),
    })
    expect(r).toEqual({ ok: false, reason: 'private_address' })
  })

  it('rejects when only one of several resolved addresses is private', async () => {
    const r = await fetchPublicUrl('https://evil.example/recipe', {
      resolve: async () => ['93.184.216.34', '10.0.0.5'],
      fetchImpl: async () => page(''),
    })
    expect(r).toEqual({ ok: false, reason: 'private_address' })
  })
})

describe('redirects', () => {
  it('re-validates each hop, so a redirect into the metadata service is rejected', async () => {
    const r = await fetchPublicUrl('https://recipes.example/r/1', {
      resolve: async (host) => (host === 'recipes.example' ? ['93.184.216.34'] : ['169.254.169.254']),
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('recipes.example')) {
          return new Response(null, { status: 302, headers: { location: 'https://metadata.example/latest' } })
        }
        return page('<html>secret</html>')
      },
    })
    expect(r).toEqual({ ok: false, reason: 'private_address' })
  })

  it('follows a permitted redirect and reports the final URL', async () => {
    const r = await fetchPublicUrl('https://recipes.example/r/1', {
      resolve: publicDns,
      fetchImpl: async (input) => String(input).endsWith('/r/1')
        ? new Response(null, { status: 301, headers: { location: '/r/1-final' } })
        : page('<html>ok</html>'),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.finalUrl).toBe('https://recipes.example/r/1-final')
  })

  it('gives up rather than looping forever', async () => {
    const r = await fetchPublicUrl('https://recipes.example/a', {
      resolve: publicDns,
      maxRedirects: 2,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://recipes.example/b' } }),
    })
    expect(r).toEqual({ ok: false, reason: 'too_many_redirects' })
  })
})

describe('response bounds', () => {
  it('rejects an oversized body even when content-length lies', async () => {
    const big = 'x'.repeat(4096)
    const r = await fetchPublicUrl('https://recipes.example/r', {
      resolve: publicDns,
      maxBytes: 1024,
      fetchImpl: async () => page(big),
    })
    expect(r).toEqual({ ok: false, reason: 'too_large' })
  })

  it('rejects an oversized declared content-length before reading', async () => {
    const r = await fetchPublicUrl('https://recipes.example/r', {
      resolve: publicDns,
      maxBytes: 1024,
      fetchImpl: async () => page('small', { 'content-length': '999999' }),
    })
    expect(r).toEqual({ ok: false, reason: 'too_large' })
  })

  it('rejects a non-HTML content type', async () => {
    const r = await fetchPublicUrl('https://recipes.example/r.pdf', {
      resolve: publicDns,
      fetchImpl: async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    })
    expect(r).toEqual({ ok: false, reason: 'bad_content_type' })
  })

  it('reports an HTTP error with its status rather than a body', async () => {
    const r = await fetchPublicUrl('https://recipes.example/gone', {
      resolve: publicDns,
      fetchImpl: async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }),
    })
    expect(r).toEqual({ ok: false, reason: 'http_error', status: 404 })
  })

  it('returns the page on the happy path', async () => {
    const r = await fetchPublicUrl('https://recipes.example/r', {
      resolve: publicDns,
      fetchImpl: async () => page('<html><body>Recipe</body></html>'),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain('Recipe')
      expect(r.contentType).toBe('text/html')
    }
  })

  it('surfaces a DNS failure as its own reason, not as a crash', async () => {
    const r = await fetchPublicUrl('https://nope.example/r', {
      resolve: async () => { throw new Error('ENOTFOUND') },
    })
    expect(r).toEqual({ ok: false, reason: 'dns_failed' })
  })
})
