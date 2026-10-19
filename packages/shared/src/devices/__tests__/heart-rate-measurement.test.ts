import { describe, it, expect } from 'vitest'
import { parseBatteryLevel, parseHeartRateMeasurement, parseRevisionString } from '../heart-rate-measurement'

const bytes = (...b: number[]) => new Uint8Array(b)

// The full 0x2A37 cases live in lib/live-hr/__tests__/hr-measurement.test.ts, through the re-export.
describe('parseHeartRateMeasurement', () => {
  it('reads a Polar H10 frame: contact detected, two RR intervals', () => {
    // flags 0x16 = RR present + contact supported + contact detected; 8-bit HR 142.
    // RR 0x01AF = 431 → 421 ms, 0x01B5 = 437 → 427 ms.
    expect(parseHeartRateMeasurement(bytes(0x16, 142, 0xaf, 0x01, 0xb5, 0x01)))
      .toEqual({ bpm: 142, rr: [421, 427], contact: true })
  })

  it('ignores a dangling odd byte after the RR list instead of throwing', () => {
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04, 0x07)))
      .toEqual({ bpm: 60, rr: [1000], contact: null })
  })

  it('reads an energy field with no RR list', () => {
    expect(parseHeartRateMeasurement(bytes(0x09, 0x50, 0x00, 0x10, 0x00)))
      .toEqual({ bpm: 80, rr: [], contact: null })
  })

  it('returns null for an empty buffer', () => {
    expect(parseHeartRateMeasurement(bytes())).toBeNull()
  })
})

describe('parseBatteryLevel', () => {
  it('reads the uint8 percentage', () => {
    expect(parseBatteryLevel(bytes(87))).toBe(87)
    expect(parseBatteryLevel(bytes(0))).toBe(0)
    expect(parseBatteryLevel(bytes(100))).toBe(100)
  })

  it('returns null for an empty or out-of-range value', () => {
    expect(parseBatteryLevel(bytes())).toBeNull()
    expect(parseBatteryLevel(bytes(101))).toBeNull()
    expect(parseBatteryLevel(bytes(0xff))).toBeNull()
  })
})

describe('parseRevisionString', () => {
  const ascii = (text: string, ...tail: number[]) => new Uint8Array([...text].map(c => c.charCodeAt(0)).concat(tail))

  it('reads a NUL-padded firmware revision', () => {
    expect(parseRevisionString(ascii('3.0.35', 0, 0, 0))).toBe('3.0.35')
  })

  it('returns null for an empty or unprintable value', () => {
    expect(parseRevisionString(new Uint8Array())).toBeNull()
    expect(parseRevisionString(new Uint8Array([0, 0x41]))).toBeNull()
    expect(parseRevisionString(new Uint8Array([0x07, 0x20]))).toBeNull()
  })
})
