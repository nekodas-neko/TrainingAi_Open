// Colmi R09 (Yawell-OEM ring) wire protocol: framing, checksums and command builders.
//
// PURE. No I/O, no clock, no Date construction — every function here is a byte transform, so the
// whole module is testable without a device and safe to run in the WebView.
//
// Sources, in precedence order (CLAUDE.md's external-field rule — read the pinned source, never
// memory). Where they disagree, Gadgetbridge wins: it ships a first-class `ColmiR09Coordinator`
// matching `R09_.*`, which is this ring.
//   1. Gadgetbridge `devices/yawell/ring/{YawellRingConstants,YawellRingPacketHandler}.java`
//      and `service/devices/yawell/ring/YawellRingDeviceSupport.java`
//   2. `KpG782/colmi-ring-webapp` (TypeScript/Web Bluetooth, names R02/R09) — agrees on framing
//   3. `tahnok/colmi_r02_client` — agrees on the commands it documents, but does NOT list the R09
//
// Measured against the owner's own ring on 2026-08-26 (plan §11): the services and characteristics
// below, and a real battery push (`73-0C-64-00-…-E3`) whose checksum validates under this module's
// arithmetic and whose charging byte tracked the charger. See
// docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md.
//
// ⚠️ LEARNING MODE. Nothing decoded here may reach a scoring input. See §2 of that plan and
// scripts/check-learning-mode-isolation.js, which fails CI if this directory names a scoring table,
// calls a shared writer, or is imported anywhere but the comparison adapters.

/** V1 — ordinary 16-byte commands. NOTE the characteristics are Nordic UART's own UUIDs under a
 *  DIFFERENT service UUID, which is why GATT explorers apply a text-only UART profile to them and
 *  cannot write binary here (plan §11e-d). Our BLE path writes raw buffers and is unaffected. */
export const V1_SERVICE = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'
export const V1_WRITE   = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
export const V1_NOTIFY  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

/** V2 — "big data": length-prefixed, CRC16-Modbus, multi-packet. Sleep, temperature and SpO2 only. */
export const V2_SERVICE = 'de5bf728-d711-4e47-af26-65e3012a5dc7'
export const V2_WRITE   = 'de5bf72a-d711-4e47-af26-65e3012a5dc7'
export const V2_NOTIFY  = 'de5bf729-d711-4e47-af26-65e3012a5dc7'

/** Advertised-name prefix. Pair by name, never by address: the ring's BLE address is a random
 *  non-resolvable type (plan §11a) and a stored device id can stop resolving. */
export const NAME_PREFIX = 'R09_'

export const PACKET_SIZE = 16

export const CMD = {
  SET_DATE_TIME:      0x01,
  BATTERY:            0x03,
  PHONE_NAME:         0x04,
  POWER_OFF:          0x08,
  PREFERENCES:        0x0a,
  SYNC_HEART_RATE:    0x15,
  REALTIME_HEART_RATE:0x1e,
  AUTO_SPO2_PREF:     0x2c,
  AUTO_STRESS_PREF:   0x36,
  SYNC_STRESS:        0x37,
  AUTO_HRV_PREF:      0x38,
  SYNC_HRV:           0x39,
  AUTO_TEMP_PREF:     0x3a,
  SYNC_ACTIVITY:      0x43,
  FIND_DEVICE:        0x50,
  MANUAL_HEART_RATE:  0x69,
  NOTIFICATION:       0x73,
  RAW_SENSOR:         0xa1,
  BIG_DATA:           0xbc,
  FACTORY_RESET:      0xff,
} as const

/** Sub-type in byte 1 of a `CMD.NOTIFICATION` push. */
export const PUSH = {
  NEW_HR_DATA:    0x01,
  NEW_SPO2_DATA:  0x03,
  NEW_STEPS_DATA: 0x04,
  BATTERY_LEVEL:  0x0c,
  LIVE_ACTIVITY:  0x12,
} as const

/** Sub-type in byte 1 of a `CMD.BIG_DATA` (V2) frame. */
export const BIG_DATA_TYPE = {
  TEMPERATURE: 0x25,
  SLEEP:       0x27,
  SPO2:        0x2a,
  ALARM:       0x2c,
} as const

export const SLEEP_STAGE = { LIGHT: 0x02, DEEP: 0x03, REM: 0x04, AWAKE: 0x05 } as const

// ── Framing ────────────────────────────────────────────────────────────────────────────────

/**
 * Checksum for a V1 packet: the sum of the first 15 bytes, **mod 256**.
 *
 * Mod 256, not 255. Gadgetbridge computes `(byte)(checksum + content) & 0xff` and the Web Bluetooth
 * client computes `(checksum & 255) === packet[15]`; the Python clients' prose says 255. The two
 * agree for any payload summing under 255 — which is every short command — and diverge above it, so
 * the wrong choice survives a battery probe and fails later. Two working implementations say 256.
 */
export function checksum(bytes: ArrayLike<number>, upTo = PACKET_SIZE - 1): number {
  let sum = 0
  for (let i = 0; i < upTo && i < bytes.length; i++) sum += bytes[i] & 0xff
  return sum & 0xff
}

/** Build a 16-byte V1 command: `contents` at offset 0, zero padding, checksum in byte 15. */
export function buildPacket(contents: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(PACKET_SIZE)
  const n = Math.min(contents.length, PACKET_SIZE - 1)
  for (let i = 0; i < n; i++) out[i] = contents[i] & 0xff
  out[PACKET_SIZE - 1] = checksum(out)
  return out
}

/** True when `packet` is a well-formed 16-byte V1 frame. Never throws — callers validate, they do
 *  not assume; a malformed frame is data, not an exception (the Oura decoder rule). */
export function isValidPacket(packet: ArrayLike<number> | null | undefined): boolean {
  if (!packet || packet.length !== PACKET_SIZE) return false
  return checksum(packet) === (packet[PACKET_SIZE - 1] & 0xff)
}

/** CRC16/MODBUS — the V2 big-data integrity check. A second, unrelated scheme to `checksum()`
 *  above; the same device uses both. Standard check value: CRC of "123456789" is 0x4b37. */
export function crc16Modbus(data: ArrayLike<number>): number {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] & 0xff
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc & 0xffff
}

/** Build a V2 big-data frame: `0xbc`, type, u16 length (LE), u16 CRC16-Modbus (LE), payload. */
export function buildBigDataPacket(type: number, payload: ArrayLike<number> = []): Uint8Array {
  const out = new Uint8Array(6 + payload.length)
  const crc = crc16Modbus(payload)
  out[0] = CMD.BIG_DATA
  out[1] = type & 0xff
  out[2] = payload.length & 0xff
  out[3] = (payload.length >> 8) & 0xff
  out[4] = crc & 0xff
  out[5] = (crc >> 8) & 0xff
  for (let i = 0; i < payload.length; i++) out[6 + i] = payload[i] & 0xff
  return out
}

// ── Encoding helpers ───────────────────────────────────────────────────────────────────────

/**
 * The ring encodes date parts as BCD: the decimal digits are read as hex. Gadgetbridge writes
 * `Byte.parseByte(String.valueOf(n), 16)` and reads back `Integer.valueOf(String.format("%02x", b))`.
 * So 26 encodes as 0x26. Values above 99 are not representable and are clamped by the caller.
 */
export function toBcd(n: number): number {
  const v = Math.max(0, Math.min(99, Math.trunc(n)))
  return ((v / 10) << 4) | (v % 10)
}

/** Inverse of {@link toBcd}. A non-BCD nibble (a–f) yields a value the ring never meant; callers
 *  treat an out-of-range result as absent rather than throwing. */
export function fromBcd(b: number): number {
  return ((b >> 4) & 0x0f) * 10 + (b & 0x0f)
}

/** Little-endian u16 from two bytes. */
export function u16(lo: number, hi: number): number {
  return (lo & 0xff) | ((hi & 0xff) << 8)
}

// ── Command builders ───────────────────────────────────────────────────────────────────────

export const cmdBattery = () => buildPacket([CMD.BATTERY])
export const cmdFindDevice = () => buildPacket([CMD.FIND_DEVICE])
export const cmdSyncHeartRate = () => buildPacket([CMD.SYNC_HEART_RATE])
export const cmdSyncStress = () => buildPacket([CMD.SYNC_STRESS])
export const cmdSyncHrv = () => buildPacket([CMD.SYNC_HRV])

/** `dayOffset` counts back from the ring's own clock: 0 = today. */
export const cmdSyncActivity = (dayOffset = 0) =>
  buildPacket([CMD.SYNC_ACTIVITY, Math.max(0, Math.trunc(dayOffset)) & 0xff, 0x0f, 0x00, 0x5f, 0x01])

export const cmdRealtimeHeartRate = (start: boolean) =>
  buildPacket([CMD.REALTIME_HEART_RATE, start ? 0x01 : 0x00])

/**
 * Set the ring's clock. Callers pass the parts **already resolved in the user's timezone** — this
 * module never reads a clock, because a helper that calls `new Date()` here would key the ring to
 * whatever zone the device happens to be in (CLAUDE.md's timezone rule).
 */
export function cmdSetDateTime(p: {
  year: number; month: number; day: number; hour: number; minute: number; second: number
}): Uint8Array {
  return buildPacket([
    CMD.SET_DATE_TIME,
    toBcd(p.year % 2000), toBcd(p.month), toBcd(p.day),
    toBcd(p.hour), toBcd(p.minute), toBcd(p.second),
  ])
}

/** Identifies the client to the ring. Gadgetbridge sends major/minor then two name bytes. */
export function cmdPhoneName(name = 'TA'): Uint8Array {
  const a = name.charCodeAt(0) || 0x54
  const b = name.charCodeAt(1) || 0x41
  return buildPacket([CMD.PHONE_NAME, 0x02, 0x0a, a, b])
}

/**
 * Raw accelerometer streaming, ~20 Hz on STOCK firmware.
 *
 * `0xa1` appears in neither Gadgetbridge's constant set nor `colmi_r02_client`; it comes from the
 * Web Bluetooth client's `createRawDataEnablePacket`, and the owner has driven it on this ring.
 * That matters beyond one more command: raw accelerometer makes the R09 a **raw-capable** source in
 * `docs/device-agnostic-source-architecture.md`'s split — a device we derive metrics from — rather
 * than a computed one that only hands us finished numbers. The circulating mod firmware is for a
 * HIGHER rate; it is not needed to get a stream at all (plan §8 still says do not flash it).
 *
 * Streaming is battery-costly on a ring this size and must be bounded to an activity, never left
 * on. No decoder for its payload ships yet — see the backlog entry before building one.
 */
export const cmdRawSensorEnable  = () => buildPacket([CMD.RAW_SENSOR, 0x04, 0x04])
export const cmdRawSensorDisable = () => buildPacket([CMD.RAW_SENSOR, 0x02])

export const cmdSyncSleep       = () => buildBigDataPacket(BIG_DATA_TYPE.SLEEP, [0x00])
export const cmdSyncTemperature = () => buildBigDataPacket(BIG_DATA_TYPE.TEMPERATURE, [0x00])
export const cmdSyncSpo2        = () => buildBigDataPacket(BIG_DATA_TYPE.SPO2, [0x00])
