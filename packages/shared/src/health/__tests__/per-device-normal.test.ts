import { describe, it, expect } from 'vitest'
import { perDeviceNormal, currentDevice, currentDeviceReadings, normalOrCarriedOver, type DeviceReading } from '../per-device-normal'

const day = (i: number) => `2026-10-${String(i).padStart(2, '0')}`
const run = (from: number, n: number, value: number, source: string | null): DeviceReading[] =>
  Array.from({ length: n }, (_, i) => ({ date: day(from + i), value, source }))

describe('perDeviceNormal (#3001)', () => {
  it('is the plain mean of one device, as before the switch', () => {
    const n = perDeviceNormal(run(1, 10, 50, 'oura_ble'), { minNights: 7 })
    expect(n).toMatchObject({ source: 'oura_ble', nights: 10, value: 50, provisional: 50, carriedOver: null })
  })

  it('keeps the other device out while the one in use warms up', () => {
    const readings = [...run(1, 14, 50, 'oura_ble'), ...run(15, 3, 62, 'oura_cloud')]
    const n = perDeviceNormal(readings, { minNights: 7 })
    expect(n.source).toBe('oura_cloud')
    expect(n.value).toBeNull()                 // warming up: nothing to score against
    expect(n.provisional).toBe(62)             // never 52.x, the pooled mean
    expect(n.carriedOver).toEqual({ source: 'oura_ble', nights: 14, value: 50 })
    expect(normalOrCarriedOver(n)).toBe(50)    // a caller that needs a number holds the ring's
  })

  it('learns the new device’s own normal once it has the nights', () => {
    const n = perDeviceNormal([...run(1, 14, 50, 'oura_ble'), ...run(15, 7, 62, 'oura_cloud')], { minNights: 7 })
    expect(n).toMatchObject({ source: 'oura_cloud', nights: 7, value: 62 })
    expect(normalOrCarriedOver(n)).toBe(62)
  })

  it('does not carry over a device that is itself too young to trust', () => {
    const n = perDeviceNormal([...run(1, 3, 50, 'oura_ble'), ...run(4, 3, 62, 'oura_cloud')], { minNights: 7 })
    expect(n.carriedOver).toBeNull()
    expect(normalOrCarriedOver(n)).toBe(62)    // a first-time user still gets a number
  })

  it('treats readings with no source as one device, and a mix as two', () => {
    expect(perDeviceNormal(run(1, 8, 40, null), { minNights: 7 }).value).toBe(40)
    const n = perDeviceNormal([...run(1, 8, 40, null), ...run(9, 8, 60, 'oura_cloud')], { minNights: 7 })
    expect(n.source).toBe('oura_cloud')
    expect(n.value).toBe(60)
  })

  it('takes the median over only the newest window of the device', () => {
    const readings: DeviceReading[] = [1, 2, 3, 100, 100, 100, 100].map((v, i) => ({ date: day(i + 1), value: v, source: 'a' }))
    expect(perDeviceNormal(readings, { minNights: 3, aggregate: 'median', window: 4 }).value).toBe(100)
    expect(perDeviceNormal(readings, { minNights: 3, aggregate: 'median' }).value).toBe(100)
    expect(perDeviceNormal(readings.slice(0, 4), { minNights: 3, aggregate: 'median' }).value).toBe(2.5)
  })

  it('ignores nulls, zeros are the caller’s to drop, and is order-independent', () => {
    const rows = [...run(1, 8, 50, 'a'), { date: day(20), value: null, source: 'b' }]
    expect(perDeviceNormal(rows.reverse(), { minNights: 7 })).toMatchObject({ source: 'a', value: 50 })
    expect(perDeviceNormal([], { minNights: 7 })).toEqual({ source: null, nights: 0, value: null, provisional: null, carriedOver: null })
  })

  it('names the device in use and returns only its rows', () => {
    const rows = [...run(1, 3, 50, 'a'), ...run(4, 2, 60, 'b')]
    expect(currentDevice(rows)).toBe('b')
    expect(currentDeviceReadings(rows).map(r => r.date)).toEqual([day(4), day(5)])
  })
})
