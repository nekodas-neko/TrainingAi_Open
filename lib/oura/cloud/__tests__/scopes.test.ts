// The scopes we ask Oura for, how a stored grant reads, and which scope each collection needs
// (#3026). The names come from the pinned spec, `openapi-v1.42.json`.
import { describe, expect, it } from 'vitest'
import { grantedOuraScopes, OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE, OURA_SCOPES, ouraCloudDeliveredTypes } from '../config'
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

// #3204: "connected" per Health Connect record type, for the phones' first-hand filter.
describe('ouraCloudDeliveredTypes', () => {
  const row = (scope: string | null, reauthRequiredAt: Date | null = null) => ({ accessToken: 'ciphertext', scope, reauthRequiredAt })

  it('takes each type\'s scope from the collection the server reads it from', () => {
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.SleepSession).toBe(OURA_SCOPE_FOR.sleep)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.RestingHeartRate).toBe(OURA_SCOPE_FOR.sleep)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.HeartRateVariabilityRmssd).toBe(OURA_SCOPE_FOR.sleep)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.Steps).toBe(OURA_SCOPE_FOR.daily_activity)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.ActiveCaloriesBurned).toBe(OURA_SCOPE_FOR.daily_activity)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.OxygenSaturation).toBe(OURA_SCOPE_FOR.daily_spo2)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.HeartRate).toBe(OURA_SCOPE_FOR.heartrate)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.HeartRateSeries).toBe(OURA_SCOPE_FOR.heartrate)
    expect(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE.ActivitySession).toBe(OURA_SCOPE_FOR.workout)
    for (const scope of Object.values(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE)) expect(OURA_SCOPES).toContain(scope)
  })

  it('is true for every type under a full grant', () => {
    const all = ouraCloudDeliveredTypes(row('extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session extapi:spo2 extapi:heart_health'))!
    expect(Object.keys(all).sort()).toEqual(Object.keys(OURA_SCOPE_FOR_HEALTH_CONNECT_TYPE).sort())
    expect(Object.values(all).every(Boolean)).toBe(true)
  })

  it('is false for a type whose scope the user unticked', () => {
    const partial = ouraCloudDeliveredTypes(row('extapi:personal extapi:daily extapi:workout'))!
    expect(partial).toMatchObject({ SleepSession: true, Steps: true, ActivitySession: true, OxygenSaturation: false, HeartRate: false, HeartRateSeries: false })
    // A legacy grant name still counts (#3026).
    expect(ouraCloudDeliveredTypes(row('extapi:personal extapi:spo2Daily'))!.OxygenSaturation).toBe(true)
  })

  it('covers every type for a grant with no scope string, as the reads do', () => {
    expect(Object.values(ouraCloudDeliveredTypes(row(null))!).every(Boolean)).toBe(true)
  })

  it('is null once Oura refused the grant, and without tokens', () => {
    expect(ouraCloudDeliveredTypes(row('extapi:daily', new Date('2026-10-21T00:00:00Z')))).toBeNull()
    expect(ouraCloudDeliveredTypes({ accessToken: null, scope: 'extapi:daily', reauthRequiredAt: null })).toBeNull()
    expect(ouraCloudDeliveredTypes(null)).toBeNull()
  })
})
