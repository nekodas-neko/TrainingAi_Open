/**
 * The Polar H10's PMD (Polar Measurement Data) service: the accelerometer stream the interval
 * walk's cadence comes from, since the strap publishes no cadence of its own.
 *
 * Ported from the current app's `PolarProtocol.kt` (`android/app/.../polar/`), which is the
 * pinned source for these byte layouts; the `polar-h10-ble` skill (§3) corroborates them. Pure and
 * infallible: a malformed frame returns null and never throws, so one bad frame cannot end a stream.
 *
 * ⚠ Not yet checked against a real capture in Preview. The delta frame's group-header byte order
 * (`[bitWidth][count]`) is the one part open sources disagree on, and the Kotlin carries the same
 * caveat: a wrong order yields wrong sample counts rather than an error, so the device check must
 * compare decoded samples per second with the 50 Hz requested.
 */

export const PMD_SERVICE = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8'
export const PMD_CONTROL_POINT = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8'
export const PMD_DATA = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8'

/** Control Point op codes (byte 0) and the accelerometer's measurement type (byte 1). */
export const PMD_OP_START = 0x02
export const PMD_OP_STOP = 0x03
export const PMD_MEAS_ACC = 0x02

/**
 * 50 Hz clears Nyquist for the ~3.7 Hz top of the cadence band with wide margin, and the cadence
 * DSP's sub-sample interpolation removes the resolution cost of a low rate. A lower rate is less
 * radio time, which matters because this runs for a whole walk.
 */
export const ACC_SAMPLE_RATE_HZ = 50
/** ±8 G: foot-strike transients at the torso exceed ±4 G, and clipping would distort the peaks. */
export const ACC_RANGE_G = 8
export const ACC_RESOLUTION_BITS = 16
/** Bridge-batch size: about one second of samples, as `PolarStrapService.ACC_EMIT_AT_COUNT`. */
export const ACC_EMIT_AT_COUNT = 50

const PMD_HEADER_LEN = 10

/** Start ACC: `[op][type]` then settings TLVs `[type:1][len:1][value:2 LE]` (rate, resolution, range). */
export function buildAccStartCommand(
  rateHz: number = ACC_SAMPLE_RATE_HZ,
  rangeG: number = ACC_RANGE_G,
  resolutionBits: number = ACC_RESOLUTION_BITS,
): Uint8Array {
  return Uint8Array.of(
    PMD_OP_START,
    PMD_MEAS_ACC,
    0x00, 0x01, rateHz & 0xff, (rateHz >> 8) & 0xff,
    0x01, 0x01, resolutionBits & 0xff, (resolutionBits >> 8) & 0xff,
    0x02, 0x01, rangeG & 0xff, (rangeG >> 8) & 0xff,
  )
}

export function buildAccStopCommand(): Uint8Array {
  return Uint8Array.of(PMD_OP_STOP, PMD_MEAS_ACC)
}

/** One 3-axis accelerometer sample, in the units the strap reports (milli-g). */
export interface AccSample { x: number; y: number; z: number }

/**
 * A decoded PMD ACC data frame. `frameType` is carried through on purpose: which encoding the H10
 * emits is only knowable from a real capture, so it is surfaced rather than guessed silently.
 */
export interface AccFrame {
  frameType: number
  samples: AccSample[]
}

/** Euclidean norm: orientation-independent, so it does not matter how the pod sits on the chest. */
export function magnitude(s: AccSample): number {
  return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)
}

function int16LE(b: Uint8Array, i: number): number {
  const v = b[i] | (b[i + 1] << 8)
  return v > 0x7fff ? v - 0x10000 : v
}

function decodeRaw(frame: Uint8Array, start: number): AccSample[] {
  const out: AccSample[] = []
  for (let i = start; i + 6 <= frame.length; i += 6) {
    out.push({ x: int16LE(frame, i), y: int16LE(frame, i + 2), z: int16LE(frame, i + 4) })
  }
  return out
}

/** Reads `width` bits LSB-first from an absolute bit position, sign-extended. */
function readSignedBits(b: Uint8Array, bitPos: number, width: number): number {
  let v = 0
  for (let k = 0; k < width; k++) {
    const abs = bitPos + k
    const bit = (b[abs >>> 3] >> (abs & 7)) & 1
    // `*` rather than `<<`: a width of 32 would overflow a signed 32-bit shift.
    v += bit * 2 ** k
  }
  return v >= 2 ** (width - 1) ? v - 2 ** width : v
}

/**
 * Delta body: a full reference sample (3 x int16 LE) followed by repeated groups of
 * `[bitWidth:1][sampleCount:1][packed deltas]`, each delta LSB-first and sign-extended at
 * `bitWidth`, applied cumulatively per axis.
 */
function decodeDelta(frame: Uint8Array, start: number): AccSample[] | null {
  let off = start
  if (off + 6 > frame.length) return null
  let x = int16LE(frame, off)
  let y = int16LE(frame, off + 2)
  let z = int16LE(frame, off + 4)
  off += 6
  const out: AccSample[] = [{ x, y, z }]
  while (off + 2 <= frame.length) {
    const bitWidth = frame[off]
    const count = frame[off + 1]
    off += 2
    if (bitWidth === 0 || count === 0) break
    if (bitWidth > 32) return null
    const totalBytes = Math.ceil((bitWidth * 3 * count) / 8)
    if (off + totalBytes > frame.length) return null
    let bitPos = off * 8
    for (let s = 0; s < count; s++) {
      x += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      y += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      z += readSignedBits(frame, bitPos, bitWidth); bitPos += bitWidth
      out.push({ x, y, z })
    }
    off += totalBytes
  }
  return out
}

/**
 * Decodes a PMD ACC data frame. Layout: `[0]` measurement type, `[1..8]` uint64 LE timestamp,
 * `[9]` frame type, `[10..]` samples.
 *
 * The frame type picks the encoding, and the two conventions in circulation disagree, so BOTH are
 * accepted as delta: bit 7 set (the PMD spec's "compressed" flag) or the literal 0x02. Anything
 * else is raw int16 triplets. A raw body must be a whole number of 6-byte samples; if it is not,
 * the frame is read as delta rather than silently truncated, because a wrong branch here would
 * produce plausible-looking garbage cadence.
 */
export function parseAccFrame(frame: Uint8Array): AccFrame | null {
  if (frame.length < PMD_HEADER_LEN) return null
  if (frame[0] !== PMD_MEAS_ACC) return null
  // Bytes 1..8 are a uint64 device timestamp. Cadence uses arrival time, as the Kotlin bridge's
  // `at` does, and a uint64 does not fit a JS number, so it is not decoded.
  const frameType = frame[9]
  const bodyLen = frame.length - PMD_HEADER_LEN
  if (bodyLen <= 0) return null
  const compressed = (frameType & 0x80) !== 0 || frameType === 0x02 || bodyLen % 6 !== 0
  const samples = compressed ? decodeDelta(frame, PMD_HEADER_LEN) : decodeRaw(frame, PMD_HEADER_LEN)
  if (!samples || samples.length === 0) return null
  return { frameType, samples }
}

/** A frame's samples reduced to magnitudes, rounded to whole milli-g as the Kotlin bridge sends them. */
export function accMagnitudes(frame: AccFrame): number[] {
  return frame.samples.map((s) => Math.round(magnitude(s)))
}
