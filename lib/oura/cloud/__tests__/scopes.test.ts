// The scopes we ask Oura for, how a stored grant reads, and which scope each collection needs
// (#3026). The names come from the pinned spec, `openapi-v1.42.json`.
import { describe, expect, it } from 'vitest'
import { grantedOuraScopes, OURA_SCOPES } from '../config'
import { isOuraTypeShared, OURA_SCOPE_FOR } from '../documents'

describe('Oura scopes (#3026)', () => {
  it('asks for v1.42\'s names: spo2, not spo2Daily, and heart_health', () => {
    expect(OURA_SCOPES).toEqual(['personal', 'daily', 'heartrate', 'workout', 'session', 'spo2', 'heart_health'])
  })

  it('only maps collections to scopes we ask for', () => {
    for (const scope of Object.values(OURA_SCOPE_FOR)) expect(OURA_SCOPES).toContain(scope)
  })

  it('files SpO2 under spo2 and the heart-health scores under heart_health', () => {
    expect(OURA_SCOPE_FOR.daily_spo2).toBe('spo2')
    expect(OURA_SCOPE_FOR.daily_cardiovascular_age).toBe('heart_health')
    expect(OURA_SCOPE_FOR.vo2_max).toBe('heart_health')
    expect(OURA_SCOPE_FOR.daily_resilience).toBe('heart_health')
    expect(OURA_SCOPE_FOR.daily_stress).toBe('daily')
  })
})

describe('grantedOuraScopes', () => {
  it('strips Oura\'s extapi: prefix', () => {
    expect(grantedOuraScopes('extapi:personal extapi:daily extapi:spo2 extapi:heart_health'))
      .toEqual(new Set(['personal', 'daily', 'spo2', 'heart_health']))
  })

  it('reads a grant without the prefix the same way', () => {
    expect(grantedOuraScopes('  personal\tdaily  spo2 ')).toEqual(new Set(['personal', 'daily', 'spo2']))
  })

  it('reads an old grant\'s spo2Daily as spo2, prefixed or not', () => {
    expect(grantedOuraScopes('extapi:daily extapi:spo2Daily')).toEqual(new Set(['daily', 'spo2']))
    expect(grantedOuraScopes('spo2Daily')).toEqual(new Set(['spo2']))
  })

  it('is null when the grant carries no scope string', () => {
    expect(grantedOuraScopes(null)).toBeNull()
    expect(grantedOuraScopes(undefined)).toBeNull()
    expect(grantedOuraScopes('   ')).toBeNull()
  })

  it('covers SpO2 under either spelling, and the heart-health scores only with heart_health', () => {
    for (const grant of ['extapi:daily extapi:spo2', 'extapi:daily extapi:spo2Daily']) {
      const granted = grantedOuraScopes(grant)
      expect(isOuraTypeShared(granted, 'daily_spo2')).toBe(true)
      expect(isOuraTypeShared(granted, 'daily_stress')).toBe(true)
      expect(isOuraTypeShared(granted, 'vo2_max')).toBe(false)
      expect(isOuraTypeShared(granted, 'daily_resilience')).toBe(false)
      expect(isOuraTypeShared(granted, 'daily_cardiovascular_age')).toBe(false)
    }
    const withHeart = grantedOuraScopes('extapi:heart_health')
    expect(isOuraTypeShared(withHeart, 'vo2_max')).toBe(true)
    expect(isOuraTypeShared(withHeart, 'daily_resilience')).toBe(true)
    expect(isOuraTypeShared(withHeart, 'daily_cardiovascular_age')).toBe(true)
    expect(isOuraTypeShared(withHeart, 'daily_spo2')).toBe(false)
  })
})
