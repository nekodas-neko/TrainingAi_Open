import { describe, it, expect } from 'vitest'
import { staleDataEpoch, parseDeviceEpoch, cookieValue, DATA_EPOCH_COOKIE } from '../data-epoch-gate'

const U = '00000000-0000-4000-8000-0000000000aa'
const V = '00000000-0000-4000-8000-0000000000bb'
const base = { method: 'POST', pathname: '/api/sync/push', userId: U, accountEpoch: 1000, header: null, cookieHeader: null }

describe('staleDataEpoch (#3369): a write from a device that has not wiped for a reset is refused', () => {
  it('refuses a write that names no epoch once the account has been reset', () => {
    expect(staleDataEpoch(base)).toBe(1000)
  })
  it('refuses an older epoch, and one recorded for another account', () => {
    expect(staleDataEpoch({ ...base, header: `${U}:999` })).toBe(1000)
    expect(staleDataEpoch({ ...base, header: `${V}:5000` })).toBe(1000)
    expect(staleDataEpoch({ ...base, header: 'garbage' })).toBe(1000)
  })
  it('lets through an equal or newer epoch, from the header or the cookie', () => {
    expect(staleDataEpoch({ ...base, header: `${U}:1000` })).toBeNull()
    expect(staleDataEpoch({ ...base, header: `${U}:2000` })).toBeNull()
    expect(staleDataEpoch({ ...base, cookieHeader: `a=b; ${DATA_EPOCH_COOKIE}=${encodeURIComponent(`${U}:1000`)}; c=d` })).toBeNull()
    expect(staleDataEpoch({ ...base, cookieHeader: `${DATA_EPOCH_COOKIE}=${U}:10` })).toBe(1000)
  })
  it('never gates a read', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(staleDataEpoch({ ...base, method })).toBeNull()
  })
  it('gates every write method and every write path, ring and sensor uploads included', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(staleDataEpoch({ ...base, method })).toBe(1000)
    for (const pathname of ['/api/oura-ble/samples', '/api/oura-ble/accel-chunks', '/api/oura-ble/live-steps', '/api/colmi/sync', '/api/health-connect/sync']) {
      expect(staleDataEpoch({ ...base, pathname })).toBe(1000)
    }
  })
  it('asks nothing of an account that was never reset, or a request with no signed-in user', () => {
    expect(staleDataEpoch({ ...base, accountEpoch: 0 })).toBeNull()
    expect(staleDataEpoch({ ...base, accountEpoch: undefined })).toBeNull()
    expect(staleDataEpoch({ ...base, userId: undefined })).toBeNull()
  })
  it('leaves sign-in, sign-out and deleting your own account open', () => {
    expect(staleDataEpoch({ ...base, pathname: '/api/auth/native-session/refresh' })).toBeNull()
    expect(staleDataEpoch({ ...base, method: 'DELETE', pathname: '/api/account' })).toBeNull()
    expect(staleDataEpoch({ ...base, method: 'POST', pathname: '/api/account' })).toBe(1000)
  })
})

describe('parsing', () => {
  it('reads the user id and epoch from the last colon', () => {
    expect(parseDeviceEpoch(`${U}:42`, U)).toBe(42)
    expect(parseDeviceEpoch(`${U}:-1`, U)).toBeNull()
    expect(parseDeviceEpoch(`${U}:1.5`, U)).toBeNull()
    expect(parseDeviceEpoch(null, U)).toBeNull()
  })
  it('finds a cookie by exact name', () => {
    expect(cookieValue('x_ta_data_epoch=1; ta_data_epoch=2', 'ta_data_epoch')).toBe('2')
    expect(cookieValue(null, 'a')).toBeNull()
  })
})
