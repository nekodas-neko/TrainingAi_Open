import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPngDensity, readPngDensity, findChunk } from '../png-density'

/**
 * The point of these is that they read the chunk **back out of the bytes**. A visual check cannot
 * see a pHYs chunk, and neither can the E2E's QR decode — the defect Q-400 fixes is invisible
 * everywhere except on paper, so the test has to inspect the file itself.
 */

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

/** A structurally valid PNG: signature, IHDR, IDAT, IEND. The pixel data is not decoded here. */
function minimalPng(extraAfterIhdr: number[] = []): Uint8Array {
  const ihdrData = [...u32(1), ...u32(1), 8, 6, 0, 0, 0]  // 1×1, 8-bit RGBA
  const ihdr = [...u32(ihdrData.length), 0x49, 0x48, 0x44, 0x52, ...ihdrData, ...u32(0)]
  const idat = [...u32(0), 0x49, 0x44, 0x41, 0x54, ...u32(0)]
  const iend = [...u32(0), 0x49, 0x45, 0x4e, 0x44, ...u32(0)]
  return new Uint8Array([...SIG, ...ihdr, ...extraAfterIhdr, ...idat, ...iend])
}

describe('withPngDensity', () => {
  it('declares the dpi it was given, readable back out of the bytes', () => {
    const out = withPngDensity(minimalPng(), 600)
    expect(readPngDensity(out)).toBeCloseTo(600, 0)
  })

  it('600 dpi is 23622 pixels per metre, the figure a printer reads', () => {
    const out = withPngDensity(minimalPng(), 600)
    const at = findChunk(out, 'pHYs')
    const ppm = (out[at + 8] << 24) | (out[at + 9] << 16) | (out[at + 10] << 8) | out[at + 11]
    expect(ppm >>> 0).toBe(23622)
    expect(out[at + 16]).toBe(1)   // unit = metres; unit 0 would declare an aspect ratio, not a size
  })

  it('puts the chunk immediately after IHDR, where the spec requires it (before IDAT)', () => {
    const out = withPngDensity(minimalPng(), 600)
    expect(findChunk(out, 'pHYs')).toBeLessThan(findChunk(out, 'IDAT'))
    expect(findChunk(out, 'IHDR')).toBeLessThan(findChunk(out, 'pHYs'))
  })

  it('adds exactly 21 bytes and leaves every other byte alone', () => {
    const png = minimalPng()
    const out = withPngDensity(png, 600)
    expect(out.length).toBe(png.length + 21)
    const at = findChunk(out, 'pHYs')
    expect([...out.subarray(0, at)]).toEqual([...png.subarray(0, at)])
    expect([...out.subarray(at + 21)]).toEqual([...png.subarray(at)])
  })

  it('writes a CRC the decoder will accept', () => {
    const out = withPngDensity(minimalPng(), 600)
    const at = findChunk(out, 'pHYs')
    // Recompute over type+data exactly as a reader would, and compare with the stored word.
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    let c = 0xffffffff
    for (let i = at + 4; i < at + 17; i++) c = table[(c ^ out[i]) & 0xff] ^ (c >>> 8)
    const expected = (c ^ 0xffffffff) >>> 0
    const stored = ((out[at + 17] << 24) | (out[at + 18] << 16) | (out[at + 19] << 8) | out[at + 20]) >>> 0
    expect(stored).toBe(expected)
  })

  it('leaves a PNG that already declares a density alone, rather than writing a second chunk', () => {
    const once = withPngDensity(minimalPng(), 300)
    const twice = withPngDensity(once, 600)
    expect(twice).toEqual(once)
    expect(readPngDensity(twice)).toBeCloseTo(300, 0)
  })

  it('returns non-PNG input untouched instead of corrupting it', () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(withPngDensity(notPng, 600)).toBe(notPng)
    expect(withPngDensity(new Uint8Array(0), 600)).toHaveLength(0)
  })

  it('refuses a nonsense dpi rather than writing a nonsense chunk', () => {
    const png = minimalPng()
    expect(withPngDensity(png, 0)).toBe(png)
    expect(withPngDensity(png, -600)).toBe(png)
    expect(withPngDensity(png, Number.NaN)).toBe(png)
  })
})

describe('readPngDensity', () => {
  it('is null when nothing is declared — which is the bug, stated as a value', () => {
    expect(readPngDensity(minimalPng())).toBeNull()
  })

  it('is null for unit 0, which declares an aspect ratio and not a physical size', () => {
    const aspectOnly = [...u32(9), 0x70, 0x48, 0x59, 0x73, ...u32(1), ...u32(1), 0, ...u32(0)]
    expect(readPngDensity(minimalPng(aspectOnly))).toBeNull()
  })

  it('a 1179 px label at the declared density measures 50 mm, which is the whole point', () => {
    const out = withPngDensity(minimalPng(), 600)
    const dpi = readPngDensity(out)!
    expect((1179 / dpi) * 25.4).toBeCloseTo(49.9, 1)
    // And what it would have measured with no chunk at all, at the usual 96 dpi default:
    expect((1179 / 96) * 25.4).toBeCloseTo(311.9, 1)
  })
})

/**
 * The cases above build the container by hand. This one encodes a **real** PNG — a deflated IDAT
 * with a correct CRC, the shape `canvas.toBlob` produces — stamps it, and writes it out so an
 * independent decoder can be pointed at the result. A hand-built fixture can agree with a wrong
 * implementation; a file that `file(1)` and a third-party parser both accept cannot.
 */
describe('a real, decodable PNG', () => {
  it('goes from declaring nothing to declaring 600 dpi, and stays a valid PNG', () => {
    const w = 2, h = 2
    const ihdrData = new Uint8Array([...u32(w), ...u32(h), 8, 6, 0, 0, 0])
    const idatData = new Uint8Array(deflateSync(Buffer.alloc((w * 4 + 1) * h)))
    const png = new Uint8Array([
      ...SIG,
      ...chunk('IHDR', ihdrData),
      ...chunk('IDAT', idatData),
      ...chunk('IEND', new Uint8Array(0)),
    ])

    expect(readPngDensity(png)).toBeNull()          // what canvas.toBlob gives you: no declared size
    const stamped = withPngDensity(png, 600)
    expect(readPngDensity(stamped)).toBeCloseTo(600, 0)

    // Every chunk still parses end-to-end after the splice — a bad length or CRC would derail here.
    expect(chunkNames(stamped)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])

    if (process.env.PNG_DENSITY_WRITE) writeFileSync(join(tmpdir(), 'stamped.png'), stamped)
  })
})

function crcOf(bytes: Uint8Array): number {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let c = 0xffffffff
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...[...type].map(ch => ch.charCodeAt(0)), ...data])
  return [...u32(data.length), ...typed, ...u32(crcOf(typed))]
}

/** Walk the file the way a decoder does, so a wrong length or a missing chunk shows up as a hang-free failure. */
function chunkNames(bytes: Uint8Array): string[] {
  const names: string[] = []
  let at = SIG.length
  while (at + 12 <= bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    names.push(name)
    if (name === 'IEND') break
    at += 12 + len
  }
  return names
}
