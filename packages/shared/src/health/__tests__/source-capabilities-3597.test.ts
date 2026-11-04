// #3597: the source properties scoring used to read from source ids are declared as capabilities,
// and the declarations reproduce the old lists exactly, so no score moves.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SOURCE_CAPABILITIES, OURA_CLOUD_CONNECTOR, sourceCapabilities, sourcesWith,
} from '../source-connectors'
import { DENSITY_GATED_HR_SOURCES } from '../intraday-hr-contributors'

describe('source capabilities (#3597)', () => {
  it('the Oura connector declares all three', () => {
    expect(OURA_CLOUD_CONNECTOR.capabilities).toEqual({
      heartRateSpacing: 'dense_in_stretches', heartRateDecidesMovedHour: false, perMinuteMovement: true,
    })
    expect(sourceCapabilities(OURA_CLOUD_CONNECTOR.healthSource)).toBe(OURA_CLOUD_CONNECTOR.capabilities)
  })

  it('reproduces the density lists the scoring code used to hard-code', () => {
    // Before #3597: gated = Health Connect (both), Apple Health, Oura Cloud; judged by stretch = Oura Cloud.
    expect([...DENSITY_GATED_HR_SOURCES].sort()).toEqual(['apple_health', 'health_connect', 'health_connect_native', 'oura_cloud'])
    expect(sourcesWith(c => c.heartRateSpacing === 'dense_in_stretches')).toEqual(['oura_cloud'])
    expect(sourcesWith(c => c.heartRateSpacing === 'sparse_by_hour').sort()).toEqual(['apple_health', 'health_connect', 'health_connect_native'])
  })

  it('reproduces the old moved-hour rule: only Oura Cloud\'s heart rate is left out', () => {
    expect(sourcesWith(c => !c.heartRateDecidesMovedHour)).toEqual(['oura_cloud'])
  })

  it('a source with no declaration is a dense series that can decide a moved hour', () => {
    for (const s of ['oura', 'oura_ble', 'polar_h10', 'manual', 'scale_ble', 'anything_new', null, undefined]) {
      expect(sourceCapabilities(s)).toEqual(DEFAULT_SOURCE_CAPABILITIES)
    }
  })

  it('only the Oura connector supplies a per-minute movement series today', () => {
    expect(sourcesWith(c => c.perMinuteMovement)).toEqual(['oura_cloud'])
  })
})
