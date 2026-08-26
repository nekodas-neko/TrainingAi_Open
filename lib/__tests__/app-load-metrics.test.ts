// BF-19 — the client half of app-load measurement.
//
// Two properties matter more than the happy path, and both are here:
//
//  1. **It reports once per JS context, not once per route change.** `getEntriesByType('navigation')`
//     describes the *document* load, and a client-side route change does not create a new one. A
//     reporter firing on every route settle would post the same numbers repeatedly under whichever
//     route happened to be current — worse than not reporting, because it looks like data.
//  2. **It can never fail the page.** Telemetry that throws is strictly worse than the slowness it
//     is measuring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routePattern, readNavigationTiming, reportAppLoad, startAppLoadReporting, __resetAppLoadReporterForTests } from '../app-load-metrics'

function stubNavigation(entry: Partial<PerformanceNavigationTiming> | null) {
  vi.stubGlobal('performance', {
    getEntriesByType: (t: string) => (t === 'navigation' && entry ? [entry] : []),
  })
}

beforeEach(() => __resetAppLoadReporterForTests())
afterEach(() => vi.unstubAllGlobals())

describe('routePattern', () => {
  // Without this every row is its own group and no percentile can ever be computed.
  it('replaces a uuid segment', () => {
    expect(routePattern('/workout/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('/workout/:id')
  })

  it('replaces a numeric segment', () => {
    expect(routePattern('/health/day/20260826')).toBe('/health/day/:id')
  })

  it('leaves an ordinary route alone', () => {
    expect(routePattern('/health/readiness')).toBe('/health/readiness')
  })

  it('maps the root path to /', () => {
    expect(routePattern('/')).toBe('/')
  })
})

describe('readNavigationTiming', () => {
  it('rounds sub-millisecond floats', () => {
    stubNavigation({ loadEventEnd: 1234.7, responseStart: 88.2, domContentLoadedEventEnd: 900.4, transferSize: 5000 })
    expect(readNavigationTiming()).toMatchObject({ totalMs: 1235, responseStartMs: 88, domContentMs: 900 })
  })

  // A cached shell transfers no bytes. Treating an unknown transferSize as cold inflates the cold
  // bucket rather than quietly flattering the warm one.
  it('calls a zero-transfer load warm and a real download cold', () => {
    stubNavigation({ loadEventEnd: 500, transferSize: 0 })
    expect(readNavigationTiming()!.cold).toBe(false)
    stubNavigation({ loadEventEnd: 500, transferSize: 91_000 })
    expect(readNavigationTiming()!.cold).toBe(true)
  })

  it('treats an unknown transferSize as cold', () => {
    stubNavigation({ loadEventEnd: 500 })
    expect(readNavigationTiming()!.cold).toBe(true)
  })

  it('is null for a navigation that has not finished', () => {
    stubNavigation({ loadEventEnd: 0, domComplete: 0 })
    expect(readNavigationTiming()).toBeNull()
  })

  it('is null when there is no navigation entry, and when the API is absent', () => {
    stubNavigation(null)
    expect(readNavigationTiming()).toBeNull()
    vi.stubGlobal('performance', undefined)
    expect(readNavigationTiming()).toBeNull()
  })

  it('drops a negative timing rather than reporting it', () => {
    stubNavigation({ loadEventEnd: 500, responseStart: -1, transferSize: 0 })
    expect(readNavigationTiming()!.responseStartMs).toBeNull()
  })
})

describe('reportAppLoad', () => {
  const online = (beacon: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: beacon })
    vi.stubGlobal('window', { location: { pathname: '/health/readiness' } })
  }

  it('posts once and then never again in the same context', () => {
    const beacon = vi.fn(() => true)
    online(beacon)
    stubNavigation({ loadEventEnd: 900, transferSize: 0 })
    reportAppLoad('abc123')
    reportAppLoad('abc123')
    reportAppLoad('abc123')
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('/api/app-load')
  })

  it('sends the route pattern, the timing and the build id', async () => {
    const beacon = vi.fn(() => true)
    online(beacon)
    stubNavigation({ loadEventEnd: 900, responseStart: 120, domContentLoadedEventEnd: 700, transferSize: 44_000 })
    reportAppLoad('deadbeef')
    const body = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text())
    expect(body).toEqual({
      route: '/health/readiness', responseStartMs: 120, domContentMs: 700,
      totalMs: 900, cold: true, buildId: 'deadbeef',
    })
  })

  it('does not report while offline', () => {
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { onLine: false, sendBeacon: beacon })
    vi.stubGlobal('window', { location: { pathname: '/' } })
    stubNavigation({ loadEventEnd: 900, transferSize: 0 })
    reportAppLoad()
    expect(beacon).not.toHaveBeenCalled()
  })

  // Being offline must not burn the once-per-context guard, or the load is never recorded at all.
  it('an offline attempt does not consume the one report', () => {
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { onLine: false, sendBeacon: beacon })
    vi.stubGlobal('window', { location: { pathname: '/' } })
    stubNavigation({ loadEventEnd: 900, transferSize: 0 })
    reportAppLoad()
    online(beacon)
    reportAppLoad()
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('does not report a navigation it could not read', () => {
    const beacon = vi.fn(() => true)
    online(beacon)
    stubNavigation(null)
    reportAppLoad()
    expect(beacon).not.toHaveBeenCalled()
  })

  // The one that matters most: a reporting failure must never surface to the page.
  it('swallows a throwing sendBeacon', () => {
    const beacon = vi.fn(() => { throw new Error('blocked by extension') })
    online(beacon)
    stubNavigation({ loadEventEnd: 900, transferSize: 0 })
    expect(() => reportAppLoad()).not.toThrow()
  })
})

// The timing is only complete once `loadEventEnd` is set, and a React effect runs well before that
// on a cold start — so a mount that called `reportAppLoad` directly would read nothing on exactly
// the loads that matter most. This is what makes the report happen.
describe('startAppLoadReporting', () => {
  const stubDoc = (readyState: string, listeners: Record<string, () => void>) => {
    vi.stubGlobal('document', { readyState })
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      addEventListener: (t: string, fn: () => void) => { listeners[t] = fn },
      removeEventListener: (t: string) => { delete listeners[t] },
    })
  }

  it('reports immediately when the document has already loaded', () => {
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: beacon })
    stubDoc('complete', {})
    stubNavigation({ loadEventEnd: 900, transferSize: 0 })
    startAppLoadReporting('b1')
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('waits for load when the document is still loading, then reports', () => {
    const beacon = vi.fn(() => true)
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: beacon })
    stubDoc('loading', listeners)
    stubNavigation({ loadEventEnd: 0 })          // nothing readable yet
    startAppLoadReporting('b1')
    expect(beacon).not.toHaveBeenCalled()

    stubNavigation({ loadEventEnd: 1500, transferSize: 0 })  // load finishes
    listeners.load()
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  // An early read must not burn the once-per-context guard, or the load is never recorded.
  it('a premature read leaves the one report available', () => {
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: beacon })
    vi.stubGlobal('window', { location: { pathname: '/' } })
    stubNavigation({ loadEventEnd: 0 })
    reportAppLoad()
    expect(beacon).not.toHaveBeenCalled()
    stubNavigation({ loadEventEnd: 800, transferSize: 0 })
    reportAppLoad()
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('its cleanup removes the load listener', () => {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: vi.fn(() => true) })
    stubDoc('loading', listeners)
    stubNavigation({ loadEventEnd: 0 })
    startAppLoadReporting()()
    expect(listeners.load).toBeUndefined()
  })

  it('is a no-op with no document, rather than throwing', () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('window', undefined)
    expect(() => startAppLoadReporting()()).not.toThrow()
  })
})
