import { describe, it, expect } from 'vitest'
import { asRpeSource, rpeSourcesPayload } from '../rpe-source'

// #2450: the payload half of set_logs.rpe_source.
describe('rpeSourcesPayload', () => {
  it('labels a tapped set rated and an untouched one expected, index-aligned with rpeValues', () => {
    expect(rpeSourcesPayload([8, 9, 8], [undefined, true])).toEqual(['expected', 'rated', 'expected'])
  })

  it('is null for a set with no RPE, never a source with nothing beside it', () => {
    expect(rpeSourcesPayload([8, undefined, null], [true, true, true])).toEqual(['rated', null, null])
  })

  it('omits the field when no set has an RPE', () => {
    expect(rpeSourcesPayload([], [])).toBeUndefined()
    expect(rpeSourcesPayload([undefined, null], [true])).toBeUndefined()
  })
})

describe('asRpeSource', () => {
  it('passes the two values through and reads anything else as unknown', () => {
    expect(asRpeSource('rated')).toBe('rated')
    expect(asRpeSource('expected')).toBe('expected')
    expect(asRpeSource(null)).toBeNull()
    expect(asRpeSource('RATED')).toBeNull()
    expect(asRpeSource(undefined)).toBeNull()
  })
})
