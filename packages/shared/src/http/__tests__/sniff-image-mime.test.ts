import { describe, it, expect } from 'vitest'
import { sniffImageMime, ALLOWED_IMAGE_MIME, isAllowedImageMime, parseImageDataUri } from '../request-guards'

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

/**
 * RV-191 — a data URI is validated by its bytes, because its declared type is written by whoever
 * sends it.
 *
 * The entry called this a HIGH-severity admin-RCE: the admin panel rendered the stored value as an
 * `<img src>` and opened it with `window.open`. **That path was executed on Chromium 2026-09-25 and
 * did not reproduce** — `window.open` to a `data:` URI does not navigate, and SVG inside `<img>`
 * is script-inert. So these cases pin boundary validation and data hygiene, not an exploit: what
 * reaches the column is an image, rather than 500 KB of anything at all.
 */
describe('parseImageDataUri (RV-191)', () => {
  const b64 = (...bytes: number[]) => Buffer.from(bytes).toString('base64')
  const PNG = b64(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)
  const JPEG = b64(0xff, 0xd8, 0xff, 0xe0, 0, 16)
  const WEBP = Buffer.concat([
    Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'),
  ]).toString('base64')
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x=1</script></svg>').toString('base64')
  const CAP = 500_000

  it('accepts each allowed type when the bytes agree with the declaration', () => {
    for (const [mime, payload] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP]] as const) {
      const r = parseImageDataUri(`data:${mime};base64,${payload}`, CAP)
      expect(r.ok, `${mime}: ${JSON.stringify(r)}`).toBe(true)
      if (r.ok) expect(r.mime).toBe(mime)
    }
  })

  // The case the whole function exists for, and the one a declared-MIME check passes.
  it('rejects SVG wearing an image/png label', () => {
    const r = parseImageDataUri(`data:image/png;base64,${SVG}`, CAP)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bytes_are_not_an_image')
  })

  // Both halves are individually allowed, and it is still a lie — the admin UI renders the
  // DECLARED type, so the two disagreeing is itself the defect.
  it('rejects a real JPEG declared as a PNG', () => {
    const r = parseImageDataUri(`data:image/png;base64,${JPEG}`, CAP)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('declared_type_does_not_match_bytes')
  })

  it('rejects a type outside the allowlist, and a non-data-uri, and a non-string', () => {
    expect(parseImageDataUri(`data:image/gif;base64,${PNG}`, CAP)).toMatchObject({ reason: 'declared_type_not_allowed' })
    expect(parseImageDataUri(`data:image/svg+xml;base64,${SVG}`, CAP)).toMatchObject({ reason: 'declared_type_not_allowed' })
    expect(parseImageDataUri('https://example.com/a.png', CAP)).toMatchObject({ reason: 'not_a_data_uri' })
    expect(parseImageDataUri(null, CAP)).toMatchObject({ reason: 'not_a_string' })
  })

  // `Buffer.from(…, 'base64')` does not throw on junk — it skips what it cannot decode — so an
  // empty decode is the only signal that nothing usable arrived.
  it('rejects a payload that decodes to nothing', () => {
    expect(parseImageDataUri('data:image/png;base64,!!!!', CAP)).toMatchObject({ reason: 'not_base64' })
    expect(parseImageDataUri('data:image/png;base64,', CAP)).toMatchObject({ reason: 'not_base64' })
  })

  it('rejects an oversized payload before it is decoded', () => {
    const big = `data:image/png;base64,${'A'.repeat(1_000_000)}`
    expect(parseImageDataUri(big, CAP)).toMatchObject({ reason: 'too_large' })
  })

  // The control: the cap is about size, not about the type, and a payload at the boundary passes.
  it('accepts a payload just under the cap', () => {
    const payload = PNG + 'A'.repeat(100)
    expect(parseImageDataUri(`data:image/png;base64,${payload}`, CAP).ok).toBe(true)
  })
})
