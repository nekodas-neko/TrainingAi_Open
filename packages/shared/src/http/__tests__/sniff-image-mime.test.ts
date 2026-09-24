import { describe, it, expect } from 'vitest'
import { sniffImageMime, ALLOWED_IMAGE_MIME, isAllowedImageMime } from '../request-guards'

// Headers built from the format specs rather than captured from a file, so a wrong byte is a
// wrong byte rather than a blessed regression.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

describe('sniffImageMime', () => {
  it('reads each accepted format from its leading bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
  })

  it('rejects HEIC, which is what the phone camera actually produces (DV-18)', () => {
    // `ftypheic` at offset 4, the ISO-BMFF brand. It is not a lookalike of anything above, and the
    // point of the entry is that it was being stored as PNG.
    const heic = Uint8Array.from([
      0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    expect(sniffImageMime(heic)).toBeNull()
  })

  it('rejects a RIFF container that is not WebP', () => {
    // A WAV is RIFF too. Matching on the first four bytes alone would accept it, so this pins that
    // the form type at offset 8 is actually checked.
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    expect(sniffImageMime(wav)).toBeNull()
  })

  it('rejects a truncated header rather than reading past the end', () => {
    // Each format needs exactly as many bytes as its signature is long, and no more: 8 for PNG,
    // 3 for JPEG, 12 for WebP. Anything short of that is a rejection; anything at or over it is a
    // match. Both sides are pinned so a length guard cannot drift in either direction.
    for (const n of [0, 1, 2, 7]) {
      expect(sniffImageMime(PNG.slice(0, n)), `PNG at ${n} bytes`).toBeNull()
    }
    expect(sniffImageMime(PNG.slice(0, 8)), 'PNG at 8 bytes').toBe('image/png')

    for (const n of [0, 1, 2]) {
      expect(sniffImageMime(JPEG.slice(0, n)), `JPEG at ${n} bytes`).toBeNull()
    }
    expect(sniffImageMime(JPEG.slice(0, 3)), 'JPEG at 3 bytes').toBe('image/jpeg')

    expect(sniffImageMime(WEBP.slice(0, 11)), 'WebP at 11 bytes').toBeNull()
    expect(sniffImageMime(WEBP.slice(0, 12)), 'WebP at 12 bytes').toBe('image/webp')
  })

  it('rejects bytes that merely contain a signature further in', () => {
    const late = Uint8Array.from([0, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    expect(sniffImageMime(late)).toBeNull()
  })

  it('only ever returns a type the app already accepts', () => {
    // Ties the sniffer to ALLOWED_IMAGE_MIME rather than to three string literals, so adding a
    // format to one and not the other cannot pass.
    for (const bytes of [PNG, JPEG, WEBP]) {
      const got = sniffImageMime(bytes)
      expect(got).not.toBeNull()
      expect(isAllowedImageMime(got)).toBe(true)
      expect(ALLOWED_IMAGE_MIME).toContain(got)
    }
  })
})
