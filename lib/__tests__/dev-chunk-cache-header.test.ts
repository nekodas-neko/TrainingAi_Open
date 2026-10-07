import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * #2608: `next.config.ts` sent `Cache-Control: public, max-age=31536000, immutable` for every
 * `/_next/static/*` response in every mode. That is true of a production chunk, whose name is a hash
 * of its contents. It is false under `next dev`: Turbopack keeps a chunk's name while its contents
 * change with every edit, branch switch and restart, so the Dev app's WebView kept the first
 * version of each chunk it saw and a device sitting ran a mixture of old and new code (measured on
 * the laptop: a full reload after an edit ran the old caller of a changed function and crashed).
 */
type HeaderRule = { source: string; headers: { key: string; value: string }[] }

async function staticRules(nodeEnv: string): Promise<HeaderRule[]> {
  vi.stubEnv('NODE_ENV', nodeEnv)
  vi.resetModules()
  const config = (await import('../../next.config')).default as { headers: () => Promise<HeaderRule[]> }
  return (await config.headers()).filter((r) => r.source.startsWith('/_next/static'))
}

describe('#2608: immutable caching of _next/static is production-only', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('production keeps the year-long immutable header on hashed chunks', async () => {
    const rules = await staticRules('production')
    expect(rules).toHaveLength(1)
    expect(rules[0].headers).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' })
  })

  it('next dev sends no caching header of ours, leaving Next’s no-store in place', async () => {
    expect(await staticRules('development')).toEqual([])
  })
})
