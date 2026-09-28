import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * BF-216 — a BLE characteristic read through `.buffer` ignores the view's offset.
 *
 * `BleClient.read` resolves a `DataView`. `.buffer` is the whole backing `ArrayBuffer`, so it
 * discards `byteOffset` and `byteLength`: a view into a pooled or offset buffer hands back a byte
 * belonging to something else. The pairing screen stored that as a battery percentage, in the same
 * store the Home chip reads — so a wrong value here presents as BF-215's symptom with a different
 * cause.
 *
 * **Latent, not live.** `@capacitor-community/bluetooth-le` builds each `DataView` on a fresh
 * buffer today, so the offset is 0 and the old read happened to be right. That is a property of the
 * plugin's implementation, not of the API contract, and one version bump from changing quietly.
 */
const repoRoot = join(__dirname, '..', '..', '..')
const src = (rel: string) => stripComments(readFileSync(join(repoRoot, rel), 'utf8')) as string

describe('BF-216 — the two reads differ, which is the whole point', () => {
  /** What the plugin could hand back: a view onto part of a larger buffer. */
  const pooled = () => {
    const backing = new Uint8Array([0xff, 0xff, 0x1e]).buffer // 0xff filler, then the real byte
    return new DataView(backing, 2, 1)
  }

  it('`.buffer` reads the wrong byte on an offset view', () => {
    const view = pooled()
    expect(new Uint8Array(view.buffer)[0], 'the filler, not the battery level').toBe(0xff)
    expect(view.getUint8(0), 'the byte the view actually points at').toBe(0x1e)
  })

  it('TextDecoder honours a view, and over-reads its buffer', () => {
    const backing = new TextEncoder().encode('XX3.1.1').buffer
    const view = new DataView(backing, 2, 5)
    expect(new TextDecoder().decode(view.buffer)).toBe('XX3.1.1')
    expect(new TextDecoder().decode(view)).toBe('3.1.1')
  })

  it('an empty view yields null rather than throwing, as the old read did', () => {
    // `getUint8(0)` throws RangeError on a zero-length view; `[0] ?? null` did not.
    const empty = new DataView(new ArrayBuffer(0))
    expect(empty.byteLength > 0 ? empty.getUint8(0) : null).toBeNull()
  })
})

describe('BF-216 — no BLE read goes through `.buffer`', () => {
  /**
   * The device pipelines, fixed by Lane A. Each receives a `DataView` from the BLE plugin and now
   * reads `new Uint8Array(v.buffer, v.byteOffset, v.byteLength)`. `lib/colmi-ble/ble.ts`'s WRITE path
   * (`new DataView(bytes.buffer)`) is not in scope: it builds its own array, so it owns the buffer.
   */
  const PIPELINES = ['lib/colmi-ble/ble.ts', 'lib/live-hr/chest-strap-source.ts']

  it('the pairing screen reads through the view', () => {
    const code = src('components/settings/chest-strap-pairing.tsx')
    expect(code, 'use getUint8/decode on the view').not.toMatch(/new Uint8Array\(\w+\.buffer\)/)
    expect(code).not.toMatch(/decode\(\w+\.buffer\)/)
    expect(code).toMatch(/\.getUint8\(0\)/)
  })

  it('and so do the device pipelines', () => {
    for (const f of PIPELINES) {
      expect(src(f), f).not.toMatch(/new Uint8Array\(\w+\.buffer\)/)
      expect(src(f), f).toMatch(/new Uint8Array\((\w+)\.buffer, \1\.byteOffset, \1\.byteLength\)/)
    }
  })
})
