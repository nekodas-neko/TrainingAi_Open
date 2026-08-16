import { describe, it, expect } from 'vitest'
import { isPreRekey, OURA_CLOUD_REKEY_DATE } from '@/lib/oura/cloud-freshness'

describe('isPreRekey', () => {
  it('exports the re-key date', () => {
    expect(OURA_CLOUD_REKEY_DATE).toBe('2026-07-07')
  })
  it('treats days before the re-key as pre-re-key', () => {
    expect(isPreRekey('2026-07-06')).toBe(true)
    expect(isPreRekey('2026-01-01')).toBe(true)
  })
  it('treats the re-key day itself as pre-re-key (partial day, last Cloud data)', () => {
    expect(isPreRekey('2026-07-07')).toBe(true)
  })
  it('treats days after the re-key as live', () => {
    expect(isPreRekey('2026-07-08')).toBe(false)
    expect(isPreRekey('2027-01-01')).toBe(false)
  })
  it('fails closed on missing dates', () => {
    expect(isPreRekey(null)).toBe(true)
    expect(isPreRekey(undefined)).toBe(true)
    expect(isPreRekey('')).toBe(true)
  })
})
