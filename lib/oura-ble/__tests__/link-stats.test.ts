// #2469. The WebView half: read the service's status, post its counters cumulative with the
// service-instance key, and never touch anything on the plugin but getStatus().
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const plugin = {
  getStatus: vi.fn(async (): Promise<unknown> => ({})),
}
const getOuraBle = vi.fn(async (): Promise<{ plugin: typeof plugin } | null> => ({ plugin }))
vi.mock('@/lib/oura-ble/plugin', () => ({ getOuraBle: () => getOuraBle() }))

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }))

const NOW = Date.UTC(2026, 9, 7, 9, 30, 0)
const status = {
  state: 'ready',
  battery: 64,
  connectCount: 9,
  dropCount: 8,
  lastTimeToConnectMs: 2_750,
  totalConnectedMs: 5_400_000,
  serviceUptimeMs: 7_000_000,
  consecutiveFailures: 2,
  draining: false,
}

beforeEach(async () => {
  const { resetLinkStatsThrottle } = await import('../link-stats')
  resetLinkStatsThrottle()
  plugin.getStatus.mockReset()
  plugin.getStatus.mockImplementation(async () => status)
  getOuraBle.mockReset()
  getOuraBle.mockImplementation(async () => ({ plugin }))
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('linkStatsPayload', () => {
  it('derives the service start from uptime and copies the counters', async () => {
    const { linkStatsPayload } = await import('../link-stats')
    expect(linkStatsPayload(status as never, NOW)).toEqual({
      serviceStartedAt: NOW - 7_000_000,
      serviceUptimeMs: 7_000_000,
      state: 'ready',
      connectCount: 9,
      dropCount: 8,
      totalConnectedMs: 5_400_000,
      lastTimeToConnectMs: 2_750,
      consecutiveFailures: 2,
    })
  })

  it('sends nothing for a stopped service — its counters are gone, and zeros would fake a restart', async () => {
    const { linkStatsPayload } = await import('../link-stats')
    expect(linkStatsPayload({ state: 'stopped' }, NOW)).toBeNull()
  })

  it('sends nothing when a counter is missing rather than inventing a zero', async () => {
    const { linkStatsPayload } = await import('../link-stats')
    const { dropCount: _d, ...noDrops } = status
    expect(linkStatsPayload(noDrops as never, NOW)).toBeNull()
    expect(linkStatsPayload({ ...status, totalConnectedMs: 'x' } as never, NOW)).toBeNull()
  })

  it('nulls the optional fields an older APK lacks, keeping the row', async () => {
    const { linkStatsPayload } = await import('../link-stats')
    const { lastTimeToConnectMs: _l, consecutiveFailures: _c, ...older } = status
    const p = linkStatsPayload(older as never, NOW)
    expect(p?.lastTimeToConnectMs).toBeNull()
    expect(p?.consecutiveFailures).toBeNull()
    expect(p?.dropCount).toBe(8)
  })

  it('never throws on junk', async () => {
    const { linkStatsPayload } = await import('../link-stats')
    expect(linkStatsPayload(null, NOW)).toBeNull()
    expect(linkStatsPayload(undefined, NOW)).toBeNull()
    expect(linkStatsPayload({ state: 42 } as never, NOW)).toBeNull()
  })
})

describe('reportRingLinkStats', () => {
  it('posts the payload to the link-stats route', async () => {
    const { reportRingLinkStats } = await import('../link-stats')
    await reportRingLinkStats(NOW)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/oura-ble/link-stats')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body)).serviceStartedAt).toBe(NOW - 7_000_000)
  })

  it('posts at most once per throttle window, then again after it', async () => {
    const { reportRingLinkStats, LINK_STATS_MIN_INTERVAL_MS } = await import('../link-stats')
    await reportRingLinkStats(NOW)
    await reportRingLinkStats(NOW + LINK_STATS_MIN_INTERVAL_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await reportRingLinkStats(NOW + LINK_STATS_MIN_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a stopped service does not use up the throttle window', async () => {
    const { reportRingLinkStats } = await import('../link-stats')
    plugin.getStatus.mockImplementationOnce(async () => ({ state: 'stopped' }))
    await reportRingLinkStats(NOW)
    expect(fetchMock).not.toHaveBeenCalled()
    await reportRingLinkStats(NOW + 1_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is a no-op off-device', async () => {
    const { reportRingLinkStats } = await import('../link-stats')
    getOuraBle.mockImplementation(async () => null)
    await reportRingLinkStats(NOW)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a bridge rejection and a network failure', async () => {
    const { reportRingLinkStats, resetLinkStatsThrottle } = await import('../link-stats')
    plugin.getStatus.mockImplementationOnce(async () => { throw new Error('not implemented') })
    await expect(reportRingLinkStats(NOW)).resolves.toBeUndefined()
    resetLinkStatsThrottle()
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline') })
    await expect(reportRingLinkStats(NOW)).resolves.toBeUndefined()
  })
})

describe('read-only against the link', () => {
  it('link-stats.ts calls nothing on the plugin but getStatus()', () => {
    const src = readFileSync(join(__dirname, '..', 'link-stats.ts'), 'utf8')
    const calls = [...src.matchAll(/plugin\.(\w+)\(/g)].map(m => m[1])
    expect(calls).toEqual(['getStatus'])
  })

  it('sync-provider reports on open, on resume and on an hourly timer', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'components', 'sync-provider.tsx'), 'utf8')
    expect(src).toMatch(/const report = \(\) => \{ void reportRingLinkStats\(\); \};[\s\S]{0,300}report\(\);[\s\S]{0,120}setInterval\(report, LINK_STATS_PERIOD_MS\)[\s\S]{0,160}App\.addListener\('resume', report\)/)
  })
})
