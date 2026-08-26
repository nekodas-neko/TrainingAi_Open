import { describe, it, expect } from 'vitest'
import {
  buildPacket, checksum, isValidPacket, crc16Modbus, buildBigDataPacket,
  toBcd, fromBcd, u16, cmdBattery, cmdFindDevice, cmdPhoneName, cmdSetDateTime,
  cmdSyncHeartRate, cmdSyncSleep, cmdRawSensorEnable, cmdRawSensorDisable, BIG_DATA_TYPE, CMD,
} from '@/lib/colmi-ble/protocol'

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
    expect(cmdSyncHeartRate()[0]).toBe(0x15)
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
