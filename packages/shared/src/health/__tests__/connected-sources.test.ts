import { describe, it, expect } from 'vitest'
import { connectedSources, CONNECTED_SOURCE_WINDOW_DAYS, type ConnectedSourceFacts } from '../connected-sources'

const none: ConnectedSourceFacts = { ringSamples: false, strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: false, ouraCloudTypes: null }
const off = { ouraCloud: false, ouraCloudTypes: {} }

describe('connectedSources (issue 2613)', () => {
  it('is all false with no facts', () => {
    expect(connectedSources(none)).toEqual({ ring: false, strap: false, healthConnect: false, ...off })
  })

  it('names exactly one source for each single fact', () => {
    expect(connectedSources({ ...none, ringSamples: true })).toEqual({ ring: true, strap: false, healthConnect: false, ...off })
    expect(connectedSources({ ...none, strapHeartRate: true })).toEqual({ ring: false, strap: true, healthConnect: false, ...off })
    expect(connectedSources({ ...none, healthConnectHeartRate: true })).toEqual({ ring: false, strap: false, healthConnect: true, ...off })
    expect(connectedSources({ ...none, healthConnectIntervals: true })).toEqual({ ring: false, strap: false, healthConnect: true, ...off })
  })

  it('reports two and all sources independently', () => {
    expect(connectedSources({ ...none, ringSamples: true, strapHeartRate: true })).toEqual({ ring: true, strap: true, healthConnect: false, ...off })
    expect(connectedSources({ ...none, strapHeartRate: true, healthConnectIntervals: true })).toEqual({ ring: false, strap: true, healthConnect: true, ...off })
    expect(connectedSources({ ringSamples: true, strapHeartRate: true, healthConnectHeartRate: true, healthConnectIntervals: true, ouraCloudTypes: { SleepSession: true } }))
      .toEqual({ ring: true, strap: true, healthConnect: true, ouraCloud: true, ouraCloudTypes: { SleepSession: true } })
  })

  it('reports an Oura Cloud connection on its own (#3115)', () => {
    expect(connectedSources({ ...none, ouraCloudTypes: { SleepSession: true, HeartRate: true } }))
      .toEqual({ ring: false, strap: false, healthConnect: false, ouraCloud: true, ouraCloudTypes: { SleepSession: true, HeartRate: true } })
  })

  // #3204: the per-type answer, and the one boolean an APK from before it reads.
  it('reports Oura Cloud per type, and the old boolean true only while every type is delivered', () => {
    const partial = connectedSources({ ...none, ouraCloudTypes: { SleepSession: true, OxygenSaturation: false } })
    expect(partial.ouraCloudTypes).toEqual({ SleepSession: true, OxygenSaturation: false })
    expect(partial.ouraCloud).toBe(false)
    // A grant Oura refused reaches here as no types at all.
    expect(connectedSources({ ...none, ouraCloudTypes: null })).toMatchObject({ ouraCloud: false, ouraCloudTypes: {} })
  })

  it('always carries the boolean, so a phone on the old APK still reads one', () => {
    for (const ouraCloudTypes of [null, {}, { Steps: true }, { Steps: false }] as (Record<string, boolean> | null)[]) {
      expect(typeof connectedSources({ ...none, ouraCloudTypes }).ouraCloud).toBe('boolean')
    }
  })

  it('has a positive recency window', () => {
    expect(CONNECTED_SOURCE_WINDOW_DAYS).toBeGreaterThan(0)
  })
})
