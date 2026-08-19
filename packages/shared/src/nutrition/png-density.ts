/**
 * Declare a PNG's physical size, so a label prints at the size it was drawn (Q-400).
 *
 * The canvas renders a 50 mm label at 600 dpi — 1,179 px — and `canvas.toBlob` writes those pixels
 * with **no `pHYs` chunk**, because the canvas API has no way to set one. A PNG without `pHYs` has
 * no declared physical size, so every print path falls back to its own default, which is 96 dpi
 * almost everywhere: 1,179 ÷ 96 = 12.3 inches ≈ **312 mm**. A label drawn to be 50 mm arrives as a
 * third of a metre, and on a label printer with fixed media it does not fit at all.
 *
 * This is invisible to every check the repo runs. The PNG is valid, the pixels are right, the QR
 * decodes — the defect appears only on paper, which is why it survived the 300 → 600 dpi change
 * made specifically for print quality.
 *
 * Both the save path and the share path go through here. Two copies of this would drift and only
 * one of them would be easy to notice.
 */

/** `pHYs` unit specifier 1 = pixels per metre (0 = aspect ratio only, which declares no size). */
const UNIT_METRE = 1
const INCHES_PER_METRE = 39.3700787401575

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** CRC-32 over the chunk's type and data, per the PNG spec's Annex D. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writeU32(view: Uint8Array, offset: number, value: number): void {
  view[offset] = (value >>> 24) & 0xff
  view[offset + 1] = (value >>> 16) & 0xff
  view[offset + 2] = (value >>> 8) & 0xff
  view[offset + 3] = value & 0xff
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  )
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

/** Where the first chunk after `IHDR` starts, or -1 if this is not a PNG with an `IHDR`. */
function endOfIhdr(bytes: Uint8Array): number {
  if (!isPng(bytes)) return -1
  const start = PNG_SIGNATURE.length
  // length(4) + type(4) + data + crc(4)
  if (bytes.length < start + 12) return -1
  const type = String.fromCharCode(bytes[start + 4], bytes[start + 5], bytes[start + 6], bytes[start + 7])
  if (type !== 'IHDR') return -1
  const end = start + 12 + readU32(bytes, start)
  return end <= bytes.length ? end : -1
}

/** The `pHYs` chunk as it appears in the file: length, type, 9 bytes of data, CRC. */
function physChunk(pixelsPerMetre: number): Uint8Array {
  const chunk = new Uint8Array(21)
  writeU32(chunk, 0, 9)                       // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4)      // 'pHYs'
  writeU32(chunk, 8, pixelsPerMetre)          // x axis
  writeU32(chunk, 12, pixelsPerMetre)         // y axis
  chunk[16] = UNIT_METRE
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)))
  return chunk
}

/**
 * Return `bytes` with a `pHYs` chunk declaring `dpi`, spliced in immediately after `IHDR`.
 *
 * Returns the input **unchanged** if it is not a PNG, or if it already carries a `pHYs` — a second
 * one would be a spec violation, and an existing one was put there deliberately. That makes this
 * safe to apply on every path without tracking whether it has already run.
 *
 * Typed on `ArrayBuffer` rather than the wider `ArrayBufferLike`, so the result drops straight into
 * a `Blob` — `BlobPart` excludes a `SharedArrayBuffer`-backed view, and the alternative is a cast at
 * every call site.
 */
export function withPngDensity(bytes: Uint8Array<ArrayBuffer>, dpi: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(dpi) || dpi <= 0) return bytes
  const insertAt = endOfIhdr(bytes)
  if (insertAt < 0) return bytes
  if (findChunk(bytes, 'pHYs') >= 0) return bytes

  const chunk = physChunk(Math.round(dpi * INCHES_PER_METRE))
  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, insertAt), 0)
  out.set(chunk, insertAt)
  out.set(bytes.subarray(insertAt), insertAt + chunk.length)
  return out
}

/** Byte offset of the named chunk's length field, or -1. Exported for the test to read one back. */
export function findChunk(bytes: Uint8Array, type: string): number {
  if (!isPng(bytes)) return -1
  let at = PNG_SIGNATURE.length
  while (at + 12 <= bytes.length) {
    const length = readU32(bytes, at)
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    if (name === type) return at
    if (name === 'IEND') return -1
    at += 12 + length
  }
  return -1
}

/** The declared dpi of a PNG, or `null` when it declares none (which prints at the viewer's default). */
export function readPngDensity(bytes: Uint8Array): number | null {
  const at = findChunk(bytes, 'pHYs')
  if (at < 0) return null
  if (bytes[at + 16] !== UNIT_METRE) return null   // unit 0 is an aspect ratio, not a size
  return readU32(bytes, at + 8) / INCHES_PER_METRE
}
