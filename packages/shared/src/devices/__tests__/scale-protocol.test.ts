import { describe, it, expect } from 'vitest'
import {
  isNewWeighInEvidence,
  isRepeatedStableFrame,
  parseStoredRecord,
  parseWeightPacket,
  STABLE_REPEAT_WINDOW_MS,
} from '../scale-protocol'

const hex = (s: string) => Uint8Array.from(s.split('-').map((b) => parseInt(b, 16)))

// The vectors are synthetic packets built to the documented layout, each with its checksum computed.
describe('parseWeightPacket', () => {
  it('reads the unsettled readings as weight only', () => {
    for (const [bytes, kg] of [
      ['10-0B-15-19-0A-00-00-00-00-00-53', 64.1],
      ['10-0B-15-19-1E-00-00-00-00-00-67', 64.3],
      ['10-0B-15-19-28-00-00-00-00-00-71', 64.4],
    ] as const) {
      const packet = parseWeightPacket(hex(bytes))!
      expect(packet.weightKg).toBeCloseTo(kg, 3)
      expect(packet.stable).toBe(false)
      expect(packet.impedanceOhmsA).toBe(0)
    }
  })

  it('reads the final reading with both impedances and keeps the raw frame', () => {
    const packet = parseWeightPacket(hex('10-0B-15-19-8C-01-01-E0-01-DE-96'))!
    expect(packet.weightKg).toBeCloseTo(65.4, 3)
    expect(packet.stable).toBe(true)
    expect(packet.impedanceOhmsA).toBe(480)
    expect(packet.impedanceOhmsB).toBe(478)
    expect(packet.rawHex).toBe('100b15198c0101e001de96')
  })

  it('refuses the handshake frame, a bad checksum and a short packet', () => {
    expect(parseWeightPacket(hex('12-0F-15-01-02-03-04-05-06-38-01-38-00-07-F3'))).toBeNull()
    expect(parseWeightPacket(hex('10-0B-15-19-8C-01-01-E0-01-DE-00'))).toBeNull()
    expect(parseWeightPacket(hex('10-0B-15'))).toBeNull()
    expect(parseWeightPacket(new Uint8Array())).toBeNull()
  })
})

describe('parseStoredRecord', () => {
  // Synthetic, as in the Kotlin test: no real stored-record capture exists yet.
  it('decodes the layout as documented', () => {
    const record = parseStoredRecord(hex('23-13-00-03-00-40-42-0F-00-19-8C-01-E0-01-DE-00-00-00-00'))!
    expect(record.weightKg).toBeCloseTo(65.4, 3)
    expect(record.resistance1Ohms).toBe(480)
    expect(record.resistance2Ohms).toBe(478)
    expect(record.count).toBe(3)
    expect(record.index).toBe(0)
    expect(record.measuredAtEpochSeconds).toBe(946_656_000 + 1_000_000)
  })

  it('keeps a timestamp past 2^31 unsigned', () => {
    const record = parseStoredRecord(hex('23-13-00-01-00-00-00-00-80-19-8C-01-E0-01-DE-00-00-00-00'))!
    expect(record.measuredAtEpochSeconds).toBe(946_656_000 + 2 ** 31)
  })

  it('refuses a live packet and a short one', () => {
    expect(parseStoredRecord(hex('10-13-00-03-00-40-42-0F-00-19-8C-01-E0-01-DE-00-00-00-00'))).toBeNull()
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
    expect(isNewWeighInEvidence(65, null)).toBe(true)
    expect(isNewWeighInEvidence(65, 65)).toBe(false)
    expect(isNewWeighInEvidence(65 + 1e-9, 65)).toBe(false)
    expect(isNewWeighInEvidence(65.1, 65)).toBe(true)
    expect(isNewWeighInEvidence(58.2, 65)).toBe(true)
  })
})
