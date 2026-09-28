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
   * Named with their reason rather than quietly skipped. All three take a `DataView` from the BLE
   * plugin and read `.buffer`, so all three carry this defect — but `lib/colmi-ble/**` and
   * `lib/live-hr/**` are **device pipelines, which §3 of the agents contract puts in Lane A**. They
   * are listed on the BF-216 entry for that lane, and this exemption is what keeps them visible
   * instead of looking clean.
   *
   * `lib/colmi-ble/ble.ts`'s WRITE path (`new DataView(bytes.buffer)`) is not in scope: it builds
   * its own array rather than receiving one, so it owns the buffer it reads.
   */
  const LANE_A_DEBT = ['lib/colmi-ble/ble.ts', 'lib/live-hr/chest-strap-source.ts']

  it('the pairing screen reads through the view', () => {
    const code = src('components/settings/chest-strap-pairing.tsx')
    expect(code, 'use getUint8/decode on the view').not.toMatch(/new Uint8Array\(\w+\.buffer\)/)
    expect(code).not.toMatch(/decode\(\w+\.buffer\)/)
    expect(code).toMatch(/\.getUint8\(0\)/)
  })

  it('and the debt this could not reach is still exactly where it was', () => {
    // If one of these is fixed, drop it from the list — the failure is the reminder to do so.
    const still = LANE_A_DEBT.filter(f => /new Uint8Array\(\w+\.buffer\)/.test(src(f)))
    expect(still, 'BF-216 names these for Lane A').toEqual(LANE_A_DEBT)
  })
})
