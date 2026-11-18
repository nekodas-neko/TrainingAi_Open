// @vitest-environment jsdom
// Issue 3854: beacons are not `fetch`, so the sign-out fence cannot refuse them, and a beacon's
// response re-issues the session cookie. Measured on `pnpm dev`: the native sign-in page's app-load
// beacon, sent mid-sign-out, signed the browser back in. No beacon goes out while a sign-out runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSignOutFenceForTests, beginSignOut, endSignOut } from '@/lib/sign-out-fence'
import { __resetAppLoadReporterForTests, reportAppLoad } from '@/lib/app-load-metrics'
import { reportClientError } from '@/lib/client-error'

const beacon = vi.fn((_url: string, _body?: BodyInit) => true)

beforeEach(() => {
  __resetSignOutFenceForTests()
  __resetAppLoadReporterForTests()
  beacon.mockClear()
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{
    entryType: 'navigation', startTime: 0, responseStart: 10, domContentLoadedEventEnd: 20, loadEventEnd: 30,
    domInteractive: 15, type: 'navigate', transferSize: 100, toJSON: () => ({}),
  } as unknown as PerformanceEntry])
})
afterEach(() => {
  vi.restoreAllMocks()
  __resetSignOutFenceForTests()
})

describe('Issue 3854: no beacon while a sign-out runs', () => {
  it('the app-load report waits, and still goes out once the sign-out ends', () => {
    beginSignOut()
    reportAppLoad()
    expect(beacon).not.toHaveBeenCalled()
    endSignOut()
    reportAppLoad()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('/api/app-load')
  })

  it('a client error report is dropped during a sign-out and sent outside one', () => {
    beginSignOut()
    reportClientError({ message: 'x' })
    expect(beacon).not.toHaveBeenCalled()
    endSignOut()
    reportClientError({ message: 'x' })
    expect(beacon).toHaveBeenCalledWith('/api/client-error', expect.any(Blob))
  })
})
