import { lookup } from 'node:dns/promises'

export type SafeFetchFailure =
  | 'bad_url'
  | 'bad_scheme'
  | 'bad_port'
  | 'has_credentials'
  | 'private_address'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'bad_content_type'
  | 'too_large'
  | 'timeout'
  | 'unreachable'
  | 'http_error'

export type SafeFetchResult =
  | { ok: true; text: string; finalUrl: string; contentType: string }
  | { ok: false; reason: SafeFetchFailure; status?: number }

export interface SafeFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Lowercased content-type prefixes that are accepted. */
  allowedContentTypes?: readonly string[]
  /** Injectable for tests; defaults to the real resolver. */
  resolve?: (hostname: string) => Promise<string[]>
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

const DEFAULTS = {
  // Measured, not guessed: bbcgoodfood.com/recipes/easy-pancakes is 553 KB of markup, and it is
  // not an outlier. A 1 MB cap rejected ordinary recipe pages.
  maxBytes: 3 * 1024 * 1024,
  timeoutMs: 6_000,
  maxRedirects: 3,
  allowedContentTypes: ['text/html', 'application/xhtml+xml'] as const,
}

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d
}

function parseIpv4(addr: string): number | null {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    nums.push(n)
  }
  return ipv4ToInt(nums[0], nums[1], nums[2], nums[3])
}

// Everything that is not globally-routable unicast. 100.64/10 is carrier-grade NAT and
// 198.18/15 is the benchmarking range — both reach infrastructure rather than the internet,
// so they are rejected alongside the obvious RFC1918 blocks.
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // cloud instance metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
]

function isPublicIpv4(addr: string): boolean {
  const ip = parseIpv4(addr)
  if (ip === null) return false
  for (const [base, bits] of BLOCKED_V4) {
    const baseInt = parseIpv4(base)
    if (baseInt === null) continue
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((ip & mask) >>> 0 === (baseInt & mask) >>> 0) return false
  }
  return true
}

function isPublicIpv6(addr: string): boolean {
  const lower = addr.toLowerCase().split('%')[0]
  // An IPv4-mapped or IPv4-compatible address reaches an IPv4 destination, so it is judged
  // by the IPv4 rules — otherwise ::ffff:127.0.0.1 walks straight past them.
  const mapped = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPublicIpv4(mapped[1])
  if (lower === '::' || lower === '::1') return false
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return false // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return false // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return false // ff00::/8 multicast
  if (/^(2001:0?db8|64:ff9b|100::)/.test(lower)) return false
  return true
}

export function isPublicAddress(addr: string): boolean {
  return addr.includes(':') ? isPublicIpv6(addr) : isPublicIpv4(addr)
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true })
  return results.map((r) => r.address)
}

/**
 * Validate one hop: https only, no credentials, port 443, and every address the hostname
 * resolves to must be globally routable. Rejecting on the hostname alone is not enough —
 * a public name can resolve to 169.254.169.254.
 */
async function validateHop(
  raw: string,
  resolve: (h: string) => Promise<string[]>,
): Promise<{ ok: true; url: URL } | { ok: false; reason: SafeFetchFailure }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'bad_url' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'bad_scheme' }
  if (url.username || url.password) return { ok: false, reason: 'has_credentials' }
  if (url.port && url.port !== '443') return { ok: false, reason: 'bad_port' }

  // A literal IP in the URL never reaches the resolver, so check it directly first.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return isPublicAddress(host) ? { ok: true, url } : { ok: false, reason: 'private_address' }
  }

  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return { ok: false, reason: 'dns_failed' }
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns_failed' }
  if (!addresses.every(isPublicAddress)) return { ok: false, reason: 'private_address' }
  return { ok: true, url }
}

/**
 * Fetch a user-supplied URL with SSRF guards. The server sits on Railway's private network
 * with the database on it, so this fails closed at every step: scheme, port, resolved
 * address, each redirect hop, response size, and content type.
 *
 * Residual risk, stated rather than hidden: the address is validated and then the hostname is
 * connected to by name, so a resolver that returns a public address on the check and a private
 * one on the connect (DNS rebinding) is not closed out. Closing it needs connecting to the
 * pinned IP with the Host header preserved, which undici does not expose here.
 */
export async function fetchPublicUrl(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects
  const allowed = opts.allowedContentTypes ?? DEFAULTS.allowedContentTypes
  const resolve = opts.resolve ?? defaultResolve
  const doFetch = opts.fetchImpl ?? fetch

  const deadline = AbortSignal.timeout(timeoutMs)
  let current = raw

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await validateHop(current, resolve)
    if (!checked.ok) return { ok: false, reason: checked.reason }

    let res: Response
    try {
      res = await doFetch(checked.url.toString(), {
        redirect: 'manual',
        signal: deadline,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'TrainingAI-RecipeReader/1.0' },
      })
    } catch (err) {
      return { ok: false, reason: deadline.aborted || (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel().catch(() => {})
      if (!location) return { ok: false, reason: 'http_error', status: res.status }
      current = new URL(location, checked.url).toString()
      continue
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, reason: 'http_error', status: res.status }
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!allowed.some((t) => contentType.startsWith(t))) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, reason: 'bad_content_type' }
    }

    const declared = res.headers.get('content-length')
    if (declared && Number(declared) > maxBytes) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, reason: 'too_large' }
    }

    const reader = res.body?.getReader()
    if (!reader) return { ok: false, reason: 'unreachable' }
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          return { ok: false, reason: 'too_large' }
        }
        chunks.push(value)
      }
    } catch {
      return { ok: false, reason: deadline.aborted ? 'timeout' : 'unreachable' }
    }

    return {
      ok: true,
      text: Buffer.concat(chunks).toString('utf8'),
      finalUrl: checked.url.toString(),
      contentType,
    }
  }

  return { ok: false, reason: 'too_many_redirects' }
}
