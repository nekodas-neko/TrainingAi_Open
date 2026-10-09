import { describe, it, expect } from 'vitest'
import { connectedSources, CONNECTED_SOURCE_WINDOW_DAYS, type ConnectedSourceFacts } from '../connected-sources'

const none: ConnectedSourceFacts = { ringSamples: false, strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: false }

describe('connectedSources (issue 2613)', () => {
  it('is all false with no facts', () => {
    expect(connectedSources(none)).toEqual({ ring: false, strap: false, healthConnect: false })
  })

  it('names exactly one source for each single fact', () => {
    expect(connectedSources({ ...none, ringSamples: true })).toEqual({ ring: true, strap: false, healthConnect: false })
    expect(connectedSources({ ...none, strapHeartRate: true })).toEqual({ ring: false, strap: true, healthConnect: false })
    expect(connectedSources({ ...none, healthConnectHeartRate: true })).toEqual({ ring: false, strap: false, healthConnect: true })
    expect(connectedSources({ ...none, healthConnectIntervals: true })).toEqual({ ring: false, strap: false, healthConnect: true })
  })

  it('reports two and all sources independently', () => {
    expect(connectedSources({ ...none, ringSamples: true, strapHeartRate: true })).toEqual({ ring: true, strap: true, healthConnect: false })
    expect(connectedSources({ ...none, strapHeartRate: true, healthConnectIntervals: true })).toEqual({ ring: false, strap: true, healthConnect: true })
    expect(connectedSources({ ringSamples: true, strapHeartRate: true, healthConnectHeartRate: true, healthConnectIntervals: true }))
      .toEqual({ ring: true, strap: true, healthConnect: true })
  })

  it('has a positive recency window', () => {
    expect(CONNECTED_SOURCE_WINDOW_DAYS).toBeGreaterThan(0)
  })
})
