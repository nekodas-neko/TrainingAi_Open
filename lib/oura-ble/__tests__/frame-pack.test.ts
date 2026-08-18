import { describe, it, expect } from 'vitest'
import {
  packFrames, unpackFrames, hexToBody, bodyToHex, FRAME_PACK_VERSION, type RawFrame,
} from '@/lib/oura-ble/frame-pack'

// Q-541. The archive rule in CLAUDE.md makes `body_hex` the server-side source of truth, so packing
// is only legitimate if it is byte-for-byte reversible. These are the tests that claim says.

/** Deterministic PRNG — `Math.random()` is banned in this repo's harness, and a seeded generator
 *  makes a failing case reproducible from its seed rather than "it went red once". */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x1_0000_0000 }
}

function arbitraryFrames(seed: number, n: number): RawFrame[] {
  const r = rng(seed)
  let ds = Math.floor(r() * 40_000_000)
  const frames: RawFrame[] = []
  for (let i = 0; i < n; i++) {
    // Gaps that span a varint boundary in both directions, plus the zero-gap case: two frames can
    // legally share a ds, because the dedup key is (user_id, ds, tag, body_hex) and includes body.
    ds += Math.floor(r() * (i % 7 === 0 ? 200_000 : 40))
    const len = Math.floor(r() * 15)
    const body = new Uint8Array(len)
    for (let b = 0; b < len; b++) body[b] = Math.floor(r() * 256)
    frames.push({ ds, body })
  }
  return frames
}

const same = (a: readonly RawFrame[], b: readonly RawFrame[]) =>
  a.length === b.length && a.every((f, i) => f.ds === b[i].ds && bodyToHex(f.body) === bodyToHex(b[i].body))

describe('frame-pack codec (Q-541)', () => {
  it('round-trips arbitrary frame lists, over many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const frames = arbitraryFrames(seed, 1 + (seed % 60))
      const back = unpackFrames(packFrames(frames))
      expect(same([...frames].sort((a, b) => a.ds - b.ds), back), `seed ${seed}`).toBe(true)
    }
  })

  it('round-trips the edges: empty list, empty body, max body, huge gap, duplicate ds', () => {
    expect(unpackFrames(packFrames([]))).toEqual([])

    const edges: RawFrame[] = [
      { ds: 0, body: new Uint8Array(0) },
      { ds: 0, body: Uint8Array.from([0xff]) },          // duplicate ds, zero delta
      { ds: 1, body: new Uint8Array(1024).fill(0x5a) },  // the Zod body ceiling
      { ds: 40_000_000, body: Uint8Array.from([0, 0, 0]) },
    ]
    expect(same(edges, unpackFrames(packFrames(edges)))).toBe(true)
  })

  it('sorts rather than trusting the caller — an unsorted list must not encode a negative delta', () => {
    const unsorted: RawFrame[] = [
      { ds: 500, body: Uint8Array.from([3]) },
      { ds: 100, body: Uint8Array.from([1]) },
      { ds: 300, body: Uint8Array.from([2]) },
    ]
    expect(unpackFrames(packFrames(unsorted)).map(f => f.ds)).toEqual([100, 300, 500])
  })

  // A pinned production vector, per the plan's Task 2. These are the owner's five oldest tag-0x76
  // frames, read from claude_ro on 2026-08-17. Bodies in production run 1–14 bytes.
  it('round-trips real production frames byte for byte', () => {
    const production = [
      { ds: 1_666_556, hex: 'd47e16008fac1600' },
      { ds: 2_329_363, hex: 'e9161d009e662100' },
      { ds: 2_845_957, hex: 'f38b2800b0ac2800' },
      { ds: 2_883_160, hex: 'acf72800053e2900' },
      { ds: 3_183_149, hex: '31ce2900207e2e00' },
    ]
    const blob = packFrames(production.map(p => ({ ds: p.ds, body: hexToBody(p.hex) })))
    const back = unpackFrames(blob)
    expect(back.map(f => ({ ds: f.ds, hex: bodyToHex(f.body) })))
      .toEqual(production.map(p => ({ ds: p.ds, hex: p.hex })))

    // The point of the whole exercise, asserted as a ratio rather than a constant so a legitimate
    // format change does not fail it: these 5 frames cost ~1,640 B as rows (~328 B/row measured in
    // production) and **63 B** packed — 26×, which is the 27× overhead the plan set out to remove.
    expect(blob.length).toBeLessThan((5 * 328) / 10)
  })

  it('refuses a blob it cannot vouch for, rather than returning partial frames', () => {
    const blob = packFrames(arbitraryFrames(7, 10))
    expect(() => unpackFrames(new Uint8Array(0))).toThrow(/empty blob/)
    expect(() => unpackFrames(Uint8Array.from([0x99, 0x00, 0x00]))).toThrow(/unsupported format version/)
    expect(() => unpackFrames(blob.slice(0, blob.length - 3))).toThrow()
    expect(() => unpackFrames(Uint8Array.from([...blob, 0x00]))).toThrow(/trailing bytes/)
  })

  it('stamps the version so a future format can be told apart', () => {
    expect(packFrames([{ ds: 1, body: Uint8Array.from([1]) }])[0]).toBe(FRAME_PACK_VERSION)
  })

  it('hex helpers reject malformed input instead of silently dropping a nibble', () => {
    expect(bodyToHex(hexToBody('00ff5a'))).toBe('00ff5a')
    expect(() => hexToBody('abc')).toThrow(/odd-length/)
    expect(() => hexToBody('zz')).toThrow(/non-hex/)
  })
})
