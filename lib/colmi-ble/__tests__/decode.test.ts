import { describe, it, expect } from 'vitest'
import { decodeV1, decodeBigData, bigDataPayloadLength, isBigDataComplete } from '@/lib/colmi-ble/decode'
import { buildPacket, buildBigDataPacket, isValidPacket, BIG_DATA_TYPE, CMD, SLEEP_STAGE } from '@/lib/colmi-ble/protocol'

const parse = (s: string) => s.trim().split(/[\s-]+/).map(h => parseInt(h, 16))

describe('the packet actually captured from the owner\'s R09 (2026-08-26)', () => {
  // Read off the nRF Connect transport log. This is the only vector here that came from real
  // hardware rather than from a reference implementation, so it is the anchor for the rest.
  const CAPTURED_IDLE     = '73-0C-64-00-00-00-00-00-00-00-00-00-00-00-00-E3'
  const CAPTURED_CHARGING = '73-0C-64-01-00-00-00-00-00-00-00-00-00-00-00-E4'

  it('decodes as a battery push at 100%, not charging', () => {
    expect(decodeV1(parse(CAPTURED_IDLE))).toEqual({ kind: 'battery', percent: 100, charging: false })
  })

  it('decodes the charging variant — the byte that flipped when the ring went on the charger', () => {
    expect(decodeV1(parse(CAPTURED_CHARGING))).toEqual({ kind: 'battery', percent: 100, charging: true })
  })

  it('validates under this module\'s checksum arithmetic', () => {
    // 0x73 + 0x0C + 0x64 = 227 = 0xE3. Real-hardware confirmation that the mod-256 sum is right.
    expect(isValidPacket(parse(CAPTURED_IDLE))).toBe(true)
    expect(isValidPacket(parse(CAPTURED_CHARGING))).toBe(true)
  })

  it('still decodes with checksum validation switched on', () => {
    expect(decodeV1(parse(CAPTURED_IDLE), true)).toMatchObject({ kind: 'battery' })
  })
})

describe('V1 responses', () => {
  it('decodes a direct battery reply', () => {
    expect(decodeV1(buildPacket([CMD.BATTERY, 87, 1]))).toEqual({ kind: 'battery', percent: 87, charging: true })
  })

  it('decodes realtime heart rate', () => {
    expect(decodeV1(buildPacket([CMD.REALTIME_HEART_RATE, 62]))).toEqual({ kind: 'realtimeHeartRate', bpm: 62 })
  })

  it('decodes an activity bucket with BCD date parts and a quarter-of-day index', () => {
    // 2026-08-26, quarter 82 -> 20:30. calories 300, steps 1234, distance 890 m.
    const v = buildPacket([CMD.SYNC_ACTIVITY, 0x26, 0x08, 0x26, 82, 3, 8,
                           300 & 0xff, 300 >> 8, 1234 & 0xff, 1234 >> 8, 890 & 0xff, 890 >> 8])
    expect(decodeV1(v)).toMatchObject({
      kind: 'activity', year: 2026, month: 8, day: 26, quarterHour: 82,
      calories: 300, steps: 1234, distanceMetres: 890,
      packetIndex: 3, packetTotal: 8, isFinal: false,
    })
  })

  it('flags the last activity packet so a sweep knows to stop', () => {
    const v = buildPacket([CMD.SYNC_ACTIVITY, 0x26, 0x08, 0x26, 0, 7, 8, 0, 0, 0, 0, 0, 0])
    expect(decodeV1(v)).toMatchObject({ isFinal: true })
  })

  it('reports an empty activity history rather than inventing a bucket', () => {
    expect(decodeV1(buildPacket([CMD.SYNC_ACTIVITY, 0xff]))).toMatchObject({ kind: 'unknown' })
  })

  it('decodes an HRV packet into 30-minute slots, skipping zero-as-absent', () => {
    // Packet 1: data starts at byte 3, one value per half hour.
    const v = buildPacket([CMD.SYNC_HRV, 1, 0x00, 40, 0, 45])
    const out = decodeV1(v)
    expect(out).toMatchObject({ kind: 'hrv', packetIndex: 1, isEmpty: false })
    // byte 3 -> 00:00, byte 4 is zero (no sample), byte 5 -> 01:00
    expect((out as { points: unknown }).points).toEqual([
      { minuteOfDay: 0, value: 40 },
      { minuteOfDay: 60, value: 45 },
    ])
  })

  it('offsets later HRV packets past the slots the earlier ones covered', () => {
    // Packet 2 starts at byte 2 and follows packet 1's 12 slots -> 360 minutes in.
    const out = decodeV1(buildPacket([CMD.SYNC_HRV, 2, 55]))
    expect((out as { points: { minuteOfDay: number }[] }).points[0].minuteOfDay).toBe(360)
  })

  it('reports an empty HRV history without throwing', () => {
    expect(decodeV1(buildPacket([CMD.SYNC_HRV, 0xff]))).toMatchObject({ kind: 'hrv', isEmpty: true })
  })

  it('decodes the heart-rate log header and its timestamped first packet', () => {
    expect(decodeV1(buildPacket([CMD.SYNC_HEART_RATE, 0, 24, 5])))
      .toMatchObject({ kind: 'heartRateLog', packetTotal: 24, intervalMinutes: 5 })
    const ts = 1_700_000_000
    const v = buildPacket([CMD.SYNC_HEART_RATE, 1, ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >> 24) & 0xff, 60, 61])
    expect(decodeV1(v)).toMatchObject({ startedAtUnixSec: ts })
  })
})

describe('V2 big data', () => {
  it('reports the declared payload length and completeness for reassembly', () => {
    const frame = buildBigDataPacket(BIG_DATA_TYPE.SLEEP, [1, 2, 3])
    expect(bigDataPayloadLength(frame)).toBe(3)
    expect(isBigDataComplete(frame)).toBe(true)
    expect(isBigDataComplete(frame.slice(0, 7))).toBe(false)
    expect(bigDataPayloadLength([0x01, 0x02])).toBeNull()
  })

  it('decodes a sleep session with its stage spans, in RELATIVE time', () => {
    // 1 day, daysAgo=1, dayBytes=8 (4 header + 2 spans x 2), start 22:30 (1350), end 07:00 (420).
    const payload = [1, 1, 8, 1350 & 0xff, 1350 >> 8, 420 & 0xff, 420 >> 8,
                     SLEEP_STAGE.LIGHT, 60, SLEEP_STAGE.DEEP, 90]
    const out = decodeBigData(buildBigDataPacket(BIG_DATA_TYPE.SLEEP, payload))
    expect(out).toEqual({
      kind: 'sleep',
      sessions: [{
        daysAgo: 1, startMinute: 1350, endMinute: 420,
        stages: [{ stage: SLEEP_STAGE.LIGHT, minutes: 60 }, { stage: SLEEP_STAGE.DEEP, minutes: 90 }],
      }],
    })
    // startMinute > endMinute means the session began before that midnight. The parser reports it
    // rather than resolving it — the caller anchors the day in the USER's timezone.
    const s = (out as { sessions: { startMinute: number; endMinute: number }[] }).sessions[0]
    expect(s.startMinute).toBeGreaterThan(s.endMinute)
  })

  it('answers an empty sleep history with no sessions', () => {
    expect(decodeBigData(buildBigDataPacket(BIG_DATA_TYPE.SLEEP, [0]))).toEqual({ kind: 'sleep', sessions: [] })
  })

  it('decodes half-hourly skin temperature, scaled and zero-as-absent', () => {
    const payload = [0, 0x1e, ...new Array(48).fill(0)]
    payload[2] = 120   // 00:00 -> 32.0 C
    payload[3] = 125   // 00:30 -> 32.5 C
    expect(decodeBigData(buildBigDataPacket(BIG_DATA_TYPE.TEMPERATURE, payload))).toEqual({
      kind: 'temperature',
      readings: [
        { daysAgo: 0, minuteOfDay: 0, celsius: 32 },
        { daysAgo: 0, minuteOfDay: 30, celsius: 32.5 },
      ],
    })
  })

  it('decodes hourly SpO2 min/max', () => {
    const payload = [0, ...new Array(48).fill(0)]
    payload[1] = 95; payload[2] = 99
    expect(decodeBigData(buildBigDataPacket(BIG_DATA_TYPE.SPO2, payload))).toEqual({
      kind: 'spo2', readings: [{ daysAgo: 0, hour: 0, min: 95, max: 99 }],
    })
  })

  it('does not decode an incomplete frame as if it were whole', () => {
    const frame = buildBigDataPacket(BIG_DATA_TYPE.SLEEP, [1, 1, 8, 0, 0, 0, 0, 2, 60])
    expect(decodeBigData(frame.slice(0, 9))).toMatchObject({ kind: 'unknown' })
  })
})

describe('decoders are infallible', () => {
  it('never throws, whatever arrives', () => {
    const inputs: (ArrayLike<number> | null | undefined)[] = [
      null, undefined, [], [0x00], new Uint8Array(16), new Uint8Array(200),
      parse('bc 27 ff ff 00 00'), parse('ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff'),
    ]
    for (let seed = 0; seed < 300; seed++) {
      const len = seed % 24
      inputs.push(Array.from({ length: len }, (_, i) => (seed * 31 + i * 17) & 0xff))
    }
    for (const input of inputs) {
      expect(() => decodeV1(input)).not.toThrow()
      expect(() => decodeV1(input, true)).not.toThrow()
      expect(() => decodeBigData(input)).not.toThrow()
      expect(decodeV1(input)).toHaveProperty('kind')
      expect(decodeBigData(input)).toHaveProperty('kind')
    }
  })
})
