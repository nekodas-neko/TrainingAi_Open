import { describe, it, expect } from 'vitest'
import {
  buildPacket, checksum, isValidPacket, crc16Modbus, buildBigDataPacket,
  toBcd, fromBcd, u16, cmdBattery, cmdFindDevice, cmdPhoneName, cmdSetDateTime,
  cmdSyncHeartRate, cmdSyncSleep, cmdRawSensorEnable, cmdRawSensorDisable,
  cmdReadAutoPref, cmdWriteAutoPref, AUTO_METRICS, BIG_DATA_TYPE, CMD,
} from '@/lib/colmi-ble/protocol'
import { framesToPayload } from '@/lib/colmi-ble/ble'
import type { ColmiFrame } from '@/lib/colmi-ble/decode'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

describe('V1 framing', () => {
  it('builds the exact battery packet sent to the owner\'s ring on 2026-08-26', () => {
    expect(hex(cmdBattery())).toBe('03000000000000000000000000000003')
  })

  it('builds the exact find-device and phone-name packets', () => {
    expect(hex(cmdFindDevice())).toBe('50000000000000000000000000000050')
    // Gadgetbridge's own handshake packet: 0x04, major 0x02, minor 0x0a, then two name bytes.
    expect(hex(cmdPhoneName('GB'))).toBe('04020a47420000000000000000000099')
  })

  it('is always 16 bytes and always self-consistent', () => {
    for (const contents of [[], [CMD.BATTERY], [0xff, 0xff, 0xff], Array(20).fill(0x7f)]) {
      const p = buildPacket(contents)
      expect(p.length).toBe(16)
      expect(isValidPacket(p)).toBe(true)
    }
  })

  it('uses mod 256, not mod 255 — the case that distinguishes them', () => {
    // Both conventions agree below 255, which is why a battery probe cannot tell them apart.
    expect(checksum(buildPacket([CMD.BATTERY]))).toBe(3)
    // 0xff + 0xff = 510. mod 256 -> 254; mod 255 -> 0. Gadgetbridge and the Web Bluetooth client
    // both mask with 0xff, so 254 is correct.
    expect(buildPacket([0xff, 0xff])[15]).toBe(254)
    expect(buildPacket([0x80, 0x7f])[15]).toBe(255)
  })

  it('rejects malformed frames without throwing', () => {
    expect(isValidPacket(null)).toBe(false)
    expect(isValidPacket([])).toBe(false)
    expect(isValidPacket(new Uint8Array(15))).toBe(false)
    const bad = buildPacket([CMD.BATTERY]); bad[15] ^= 0xff
    expect(isValidPacket(bad)).toBe(false)
  })
})

describe('BCD date parts', () => {
  it('round-trips, encoding decimal digits as hex nibbles', () => {
    for (const n of [0, 1, 9, 10, 26, 59, 99]) expect(fromBcd(toBcd(n))).toBe(n)
    expect(toBcd(26)).toBe(0x26)   // the year 2026 encodes as 0x26, not 26
    expect(toBcd(8)).toBe(0x08)
  })

  it('clamps rather than emitting a value the ring cannot represent', () => {
    expect(toBcd(-5)).toBe(0)
    expect(toBcd(1000)).toBe(0x99)
  })

  it('encodes a set-time packet from caller-supplied parts', () => {
    // 2026-08-26 20:00:00 — parts resolved by the caller in the USER's timezone, never read from a
    // clock here, so this test has no hour-dependence and no rolling-window bomb.
    const p = cmdSetDateTime({ year: 2026, month: 8, day: 26, hour: 20, minute: 0, second: 0 })
    expect(hex(p)).toBe('01260826200000000000000000000075')
    expect(isValidPacket(p)).toBe(true)
  })
})

describe('CRC16/MODBUS (V2 big data)', () => {
  it('matches the standard check value', () => {
    const check = [...'123456789'].map(c => c.charCodeAt(0))
    expect(crc16Modbus(check)).toBe(0x4b37)
  })

  it('is a different scheme from the V1 byte-sum — the same device uses both', () => {
    expect(crc16Modbus([])).toBe(0xffff)
    expect(crc16Modbus([0x00])).not.toBe(checksum([0x00]))
  })

  it('frames a big-data packet with a little-endian length and CRC', () => {
    const payload = [0x00]
    const p = buildBigDataPacket(BIG_DATA_TYPE.SLEEP, payload)
    expect(p[0]).toBe(CMD.BIG_DATA)
    expect(p[1]).toBe(BIG_DATA_TYPE.SLEEP)
    expect(u16(p[2], p[3])).toBe(payload.length)
    expect(u16(p[4], p[5])).toBe(crc16Modbus(payload))
    expect(hex(cmdSyncSleep())).toBe(hex(p))
  })
})

describe('command bytes match the reference client', () => {
  it('uses Gadgetbridge\'s constants, not the Python client\'s where they differ', () => {
    expect(cmdSyncHeartRate(0)[0]).toBe(0x15)
    // 0x50 FIND_DEVICE is the blink command. The Python client's 0x10 has no counterpart here and
    // produced nothing on the real ring.
    expect(cmdFindDevice()[0]).toBe(0x50)
    expect(CMD.BIG_DATA).toBe(0xbc)
  })
})

describe('raw accelerometer streaming (0xa1)', () => {
  it('builds the enable/disable packets the Web Bluetooth client uses', () => {
    // 0xa1 + 0x04 + 0x04 = 169 = 0xa9
    expect(hex(cmdRawSensorEnable())).toBe('a10404000000000000000000000000a9')
    // 0xa1 + 0x02 = 163 = 0xa3
    expect(hex(cmdRawSensorDisable())).toBe('a10200000000000000000000000000a3')
    expect(isValidPacket(cmdRawSensorEnable())).toBe(true)
    expect(isValidPacket(cmdRawSensorDisable())).toBe(true)
  })

  it('is a command neither Java nor Python reference client documents', () => {
    expect(CMD.RAW_SENSOR).toBe(0xa1)
  })
})

describe('automatic-measurement preferences', () => {
  // These decide whether a night of wear produces anything: each metric has its own switch, and a
  // ring with them off records nothing while still syncing perfectly cleanly.
  it('builds a read and an enable for every metric', () => {
    expect(hex(cmdReadAutoPref('heart_rate'))).toBe('16010000000000000000000000000017')
    expect(hex(cmdReadAutoPref('spo2'))).toBe('2c01000000000000000000000000002d')
    expect(hex(cmdReadAutoPref('stress'))).toBe('36010000000000000000000000000037')
    expect(hex(cmdReadAutoPref('hrv'))).toBe('38010000000000000000000000000039')
    expect(hex(cmdWriteAutoPref('spo2', true))).toBe('2c02010000000000000000000000002f')
    for (const m of AUTO_METRICS) {
      expect(isValidPacket(cmdReadAutoPref(m))).toBe(true)
      expect(isValidPacket(cmdWriteAutoPref(m, true))).toBe(true)
    }
  })

  it('shifts temperature by its 0x03 sub-command — a different shape from the other four', () => {
    expect(hex(cmdReadAutoPref('temperature'))).toBe('3a03010000000000000000000000003e')
    expect(hex(cmdWriteAutoPref('temperature', true))).toBe('3a030201000000000000000000000040')
    // byte 1 is the sub-command, not the operation
    expect(cmdWriteAutoPref('temperature', true)[1]).toBe(0x03)
    expect(cmdWriteAutoPref('spo2', true)[1]).toBe(0x02)
  })

  it('encodes heart-rate OFF as 0x02, not 0x00', () => {
    // 0x00 is not a value this field takes; writing it does not disable anything.
    expect(cmdWriteAutoPref('heart_rate', true)[2]).toBe(0x01)
    expect(cmdWriteAutoPref('heart_rate', false)[2]).toBe(0x02)
    expect(hex(cmdWriteAutoPref('heart_rate', false))).toBe('1602020500000000000000000000001f')
  })

  it('rounds the heart-rate interval to 5 minutes and caps it at 60', () => {
    expect(cmdWriteAutoPref('heart_rate', true, 7)[3]).toBe(5)
    expect(cmdWriteAutoPref('heart_rate', true, 90)[3]).toBe(60)
    expect(cmdWriteAutoPref('heart_rate', true, 1)[3]).toBe(5)     // 5 is the finest it will do
    expect(cmdWriteAutoPref('heart_rate', true, 30)[3]).toBe(30)
  })
})

describe('the heart-rate log request carries a timestamp', () => {
  it('encodes the day as 4 little-endian bytes after the command', () => {
    // 2026-08-27 local midnight, as-if-UTC: Date.UTC(2026,7,27)/1000
    const t = Math.floor(Date.UTC(2026, 7, 27) / 1000)
    const p = cmdSyncHeartRate(t)
    expect(p[0]).toBe(0x15)
    expect(p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24)).toBe(t)
    expect(isValidPacket(p)).toBe(true)
  })

  it('is NOT a bare 0x15 — the bare form is what the ring silently ignored', () => {
    // Two syncs returned HRV, stress and temperature and never one heart-rate sample: those three
    // take no argument and this one does.
    expect(cmdSyncHeartRate(1000).length).toBe(16)
    expect(Array.from(cmdSyncHeartRate(1000).slice(1, 5)).some(b => b !== 0)).toBe(true)
  })

  it('clamps a negative or fractional day rather than emitting rubbish', () => {
    expect(Array.from(cmdSyncHeartRate(-5).slice(1, 5))).toEqual([0, 0, 0, 0])
    expect(cmdSyncHeartRate(1.9)[1]).toBe(1)
  })
})

/**
 * The heart-rate log arrives as a numbered series and only packet 1 names its clock. Dropping the
 * continuations left 9 samples covering 00:00–00:45 — a window in which the ring has never
 * recorded anything, so the log read as empty while 26 packets were arriving.
 */
describe('heart-rate log continuation packets', () => {
  const START = 1_800_000_000              // arbitrary fixed epoch; both sides derive from it
  const opts = { todayStr: '2026-08-27', timezone: 'Australia/Brisbane' }

  function header(intervalMinutes: number): ColmiFrame {
    return { kind: 'heartRateLog', subType: 0, packetTotal: 3, intervalMinutes,
             startedAtUnixSec: null, values: [], isFinal: false, isEmpty: false }
  }
  function packet(subType: number, values: number[], startedAtUnixSec: number | null = null): ColmiFrame {
    return { kind: 'heartRateLog', subType, packetTotal: null, intervalMinutes: null,
             startedAtUnixSec, values, isFinal: false, isEmpty: false }
  }

  it('places continuation samples after the anchor at the header interval', () => {
    const { readings } = framesToPayload([
      header(5),
      packet(1, [0, 0, 0, 0, 0, 0, 0, 0, 61], START),
      packet(2, [62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63]),
    ], opts)

    const hr = readings.filter(r => r.kind === 'heart_rate')
    expect(hr).toHaveLength(3)
    // Anchor slot 8, then continuation slots 9 and 21 — 9 anchor samples precede packet 2.
    expect(hr[0]).toMatchObject({ value: 61, at: (START + 8 * 300) * 1000 })
    expect(hr[1]).toMatchObject({ value: 62, at: (START + 9 * 300) * 1000 })
    expect(hr[2]).toMatchObject({ value: 63, at: (START + 21 * 300) * 1000 })
  })

  it('spaces samples by the interval the header declares, not a hardcoded five minutes', () => {
    const { readings } = framesToPayload([
      header(15),
      packet(1, [70, 71], START),
    ], opts)
    const hr = readings.filter(r => r.kind === 'heart_rate')
    expect(hr[1].at - hr[0].at).toBe(15 * 60_000)
  })

  it('drops a continuation that arrives with no anchor rather than guessing a clock', () => {
    const { readings } = framesToPayload([header(5), packet(4, [80, 81])], opts)
    expect(readings.filter(r => r.kind === 'heart_rate')).toHaveLength(0)
  })

  it('treats a zero as "not measured", so an all-zero anchor is not a reading of zero', () => {
    const { readings } = framesToPayload([
      header(5),
      packet(1, [0, 0, 0, 0, 0, 0, 0, 0, 0], START),
    ], opts)
    expect(readings.filter(r => r.kind === 'heart_rate')).toHaveLength(0)
  })
})
