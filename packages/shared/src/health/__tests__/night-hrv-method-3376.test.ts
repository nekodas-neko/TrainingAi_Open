import { describe, it, expect } from 'vitest'
import { chooseNightHrv, nightHrvMethodFromProvenance, hrvNightInNormal } from '../night-hrv-method'

describe('the night HRV method is source-agnostic (#3376)', () => {
  it('takes the series median when there is one', () => {
    expect(chooseNightHrv(49, 70)).toEqual({ hrvMs: 49, method: 'series_median' })
  })
  it("falls back to the source's own nightly average, so the night still counts", () => {
    expect(chooseNightHrv(null, 66)).toEqual({ hrvMs: 66, method: 'source_average' })
    expect(chooseNightHrv(undefined, 66)).toEqual({ hrvMs: 66, method: 'source_average' })
  })
  it('treats a non-positive or non-finite value as missing', () => {
    expect(chooseNightHrv(0, 66)).toEqual({ hrvMs: 66, method: 'source_average' })
    expect(chooseNightHrv(Number.NaN, 0)).toBeNull()
    expect(chooseNightHrv(null, null)).toBeNull()
  })

  it('reads a mark from any source while that source owns the field', () => {
    for (const source of ['oura_cloud', 'health_connect', 'some_future_band']) {
      expect(nightHrvMethodFromProvenance({ hrv_ms: source, 'hrv_ms:source_average': source })).toBe('source_average')
      expect(nightHrvMethodFromProvenance({ hrv_ms: source, 'hrv_ms:series_median': source })).toBe('series_median')
    }
  })
  it('ignores a stale mark once another source owns the field, and an unmarked row', () => {
    expect(nightHrvMethodFromProvenance({ hrv_ms: 'manual', 'hrv_ms:source_average': 'oura_cloud' })).toBeUndefined()
    expect(nightHrvMethodFromProvenance({ hrv_ms: 'oura_ble' })).toBeUndefined()
    expect(nightHrvMethodFromProvenance({})).toBeUndefined()
    expect(nightHrvMethodFromProvenance(null)).toBeUndefined()
  })

  it('every night joins the normal today, marked or not (owner, 3 Nov)', () => {
    expect(hrvNightInNormal('series_median')).toBe(true)
    expect(hrvNightInNormal('source_average')).toBe(true)
    expect(hrvNightInNormal(undefined)).toBe(true)
  })
})
