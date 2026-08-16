// lib/live-hr/__tests__/hr-measurement.test.ts
import { describe, it, expect } from 'vitest'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'

// 0x2A37 layout: [flags][hr:1|2][energy:2]?[rr:2]*. Flags bit0: 16-bit HR; bit1:
// sensor contact status; bit2: contact detection supported; bit3: energy present;
// bit4: RR intervals present (uint16 LE, 1/1024 s units).
function bytes(...b: number[]) { return new Uint8Array(b) }

describe('parseHeartRateMeasurement', () => {
  it('parses 8-bit HR, no contact support (flags=0x00)', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 72))).toEqual({ bpm: 72, rr: [], contact: null })
  })

  it('parses 16-bit HR (flags bit0 set)', () => {
    // flags=0x01, HR=300 (0x012C LE)
    expect(parseHeartRateMeasurement(bytes(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, rr: [], contact: null })
  })

  it('reports contact=true when supported and detected (bits 2+1)', () => {
    expect(parseHeartRateMeasurement(bytes(0x06, 80))).toEqual({ bpm: 80, rr: [], contact: true })
  })

  it('reports contact=false when supported but not detected (bit 2 only)', () => {
    expect(parseHeartRateMeasurement(bytes(0x04, 80))).toEqual({ bpm: 80, rr: [], contact: false })
  })

  it('parses RR intervals (flags bit4) in ms', () => {
    // flags=0x10, HR=60, RR raw 1024 → 1000 ms
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04))).toEqual({ bpm: 60, rr: [1000], contact: null })
  })

  it('parses multiple RR values in one packet', () => {
    // Two RRs: 1024 → 1000 ms, 512 → 500 ms
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04, 0x00, 0x02)))
      .toEqual({ bpm: 60, rr: [1000, 500], contact: null })
  })

  it('skips the energy-expended field when bit3 is set before RR', () => {
    // flags=0x18 (energy + RR), HR=60, energy=0x0000, RR=512 → 500 ms
    expect(parseHeartRateMeasurement(bytes(0x18, 60, 0x00, 0x00, 0x00, 0x02)))
      .toEqual({ bpm: 60, rr: [500], contact: null })
  })

  it('returns null for too-short buffers', () => {
    expect(parseHeartRateMeasurement(bytes(0x00))).toBeNull()
    expect(parseHeartRateMeasurement(bytes(0x01, 0x2c))).toBeNull()
  })
})
