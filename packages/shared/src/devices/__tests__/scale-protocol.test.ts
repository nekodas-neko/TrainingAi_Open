import { describe, it, expect } from 'vitest'
import {
  isNewWeighInEvidence,
  isRepeatedStableFrame,
  parseStoredRecord,
  parseWeightPacket,
  STABLE_REPEAT_WINDOW_MS,
} from '../scale-protocol'

const hex = (s: string) => Uint8Array.from(s.split('-').map((b) => parseInt(b, 16)))

// The vectors are the real packets captured against the owner's scale (2026-07-27), the same ones
// the Kotlin ScaleProtocolTest checks, so the two decoders are held to one set of bytes.
describe('parseWeightPacket', () => {
  it('reads the unsettled readings as weight only', () => {
    for (const [bytes, kg] of [
      ['10-0B-15-1B-9E-00-00-00-00-00-E9', 70.7],
      ['10-0B-15-1B-B2-00-00-00-00-00-FD', 70.9],
      ['10-0B-15-1B-B7-00-00-00-00-00-02', 70.95],
    ] as const) {
      const packet = parseWeightPacket(hex(bytes))!
      expect(packet.weightKg).toBeCloseTo(kg, 3)
      expect(packet.stable).toBe(false)
      expect(packet.impedanceOhmsA).toBe(0)
    }
  })

  it('reads the final reading with both impedances and keeps the raw frame', () => {
    const packet = parseWeightPacket(hex('10-0B-15-1B-B7-01-01-F9-01-F7-F5'))!
    expect(packet.weightKg).toBeCloseTo(70.95, 3)
    expect(packet.stable).toBe(true)
    expect(packet.impedanceOhmsA).toBe(505)
    expect(packet.impedanceOhmsB).toBe(503)
    expect(packet.rawHex).toBe('100b151bb70101f901f7f5')
  })

  it('refuses the handshake frame, a bad checksum and a short packet', () => {
    expect(parseWeightPacket(hex('12-0F-15-07-B4-ED-38-C1-A4-38-01-38-00-07-F3'))).toBeNull()
    expect(parseWeightPacket(hex('10-0B-15-1B-B7-01-01-F9-01-F7-00'))).toBeNull()
    expect(parseWeightPacket(hex('10-0B-15'))).toBeNull()
    expect(parseWeightPacket(new Uint8Array())).toBeNull()
  })
})

describe('parseStoredRecord', () => {
  // Synthetic, as in the Kotlin test: no real stored-record capture exists yet.
  it('decodes the layout as documented', () => {
    const record = parseStoredRecord(hex('23-13-00-03-00-40-42-0F-00-1B-B7-01-F9-01-F7-00-00-00-00'))!
    expect(record.weightKg).toBeCloseTo(70.95, 3)
    expect(record.resistance1Ohms).toBe(505)
    expect(record.resistance2Ohms).toBe(503)
    expect(record.count).toBe(3)
    expect(record.index).toBe(0)
    expect(record.measuredAtEpochSeconds).toBe(946_656_000 + 1_000_000)
  })

  it('keeps a timestamp past 2^31 unsigned', () => {
    const record = parseStoredRecord(hex('23-13-00-01-00-00-00-00-80-1B-B7-01-F9-01-F7-00-00-00-00'))!
    expect(record.measuredAtEpochSeconds).toBe(946_656_000 + 2 ** 31)
  })

  it('refuses a live packet and a short one', () => {
    expect(parseStoredRecord(hex('10-13-00-03-00-40-42-0F-00-1B-B7-01-F9-01-F7-00-00-00-00'))).toBeNull()
    expect(parseStoredRecord(hex('23-13-00-03-00'))).toBeNull()
  })
})

describe('repeat and replay guards', () => {
  it('counts a repeated stable frame inside the window as the same weigh-in', () => {
    const last = { rawHex: 'aa', at: 1_000 }
    expect(isRepeatedStableFrame('aa', last, 1_500)).toBe(true)
    expect(isRepeatedStableFrame('aa', last, 1_000 + STABLE_REPEAT_WINDOW_MS)).toBe(false)
    expect(isRepeatedStableFrame('bb', last, 1_500)).toBe(false)
    expect(isRepeatedStableFrame('aa', null, 1_500)).toBe(false)
  })

  it('treats an identical weight right after a capture as a replay, to the gram', () => {
    expect(isNewWeighInEvidence(71, null)).toBe(true)
    expect(isNewWeighInEvidence(71, 71)).toBe(false)
    expect(isNewWeighInEvidence(71 + 1e-9, 71)).toBe(false)
    expect(isNewWeighInEvidence(71.1, 71)).toBe(true)
    expect(isNewWeighInEvidence(64.2, 71)).toBe(true)
  })
})
