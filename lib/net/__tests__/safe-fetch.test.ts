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

  // #3673: the URL parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, and a guard that
  // only recognised the dotted spelling let every hex spelling of a private IPv4 through.
  it('judges every spelling of an IPv6 address that carries an IPv4 destination by that destination', () => {
    for (const addr of [
      '::ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '::ffff:c0a8:101', // mapped, hex
      '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:127.0.0.1', '::FFFF:7F00:1',
      '::7f00:1', '::127.0.0.1', '::a9fe:a9fe', '0:0:0:0:0:0:0:1', // compatible
      '::ffff:0:7f00:1', '::ffff:0:127.0.0.1', // SIIT
      '2002:7f00:1::', '2002:a9fe:a9fe::1', '2002:c0a8:101::', // 6to4
      '64:ff9b::7f00:1', '64:ff9b::8.8.8.8', '64:ff9b:1::1', '2001:0:4136:e378::1', // NAT64, Teredo
      '2001:db8::1', '100::1', 'fec0::1', '::2', '::1:0:0:0', // documentation, discard, site-local, rest of ::/64
    ]) {
      expect(isPublicAddress(addr), addr).toBe(false)
    }
  })

  it('still accepts a public IPv4 carried in a mapped or 6to4 address, and ordinary public IPv6', () => {
    for (const addr of ['::ffff:5db8:d822', '::ffff:93.184.216.34', '2002:5db8:d822::1',
                        '2606:4700:4700::1111', '2a00:1450:4001:82b::200e']) {
      expect(isPublicAddress(addr), addr).toBe(true)
    }
  })

  it('refuses anything that does not parse as an address', () => {
    for (const addr of ['::ffff:999.0.0.1', '1:2:3:4:5:6:7:8:9', '1::2::3', 'gggg::1', '::12345', '1:2:3:4:5:6:7']) {
      expect(isPublicAddress(addr), addr).toBe(false)
    }
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

  it('rejects an IPv4-mapped IPv6 literal after the URL parser has rewritten it to hex', async () => {
    for (const url of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:10.0.0.1]/x', 'https://[::ffff:169.254.169.254]/latest',
                       'https://[::127.0.0.1]/', 'https://[0:0:0:0:0:ffff:7f00:1]/', 'https://[2002:7f00:1::]/']) {
      let fetched = false
      const r = await fetchPublicUrl(url, {
        resolve: publicDns,
        fetchImpl: async () => { fetched = true; return page('') },
      })
      expect(r, url).toEqual({ ok: false, reason: 'private_address' })
      expect(fetched, url).toBe(false)
    }
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
