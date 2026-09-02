import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { decodeQrRotating } from '@/e2e/qr-decode'

/**
 * LB-38's root cause, pinned with a token that reproduces it every time.
 *
 * **The e2e flake was never in the app.** `@zxing/library`'s detector cannot read certain *valid* QR
 * symbols upright. Over 3,000 freshly generated meal tokens, encoded by the same `qrcode` call the
 * label renderer makes and rendered at the label's own 13 px per module with no app code involved:
 * **115 (3.83%) fail upright**, and **4 (0.13%) still fail after four rotations**. That 3.83% is
 * 1 in 26, against the ~1 in 19 `meal-label.spec.ts` was measured at — and it is deterministic per
 * token, because each run seeds one meal and every style draws that same symbol.
 *
 * **This test exists because the fix is otherwise unguarded.** A good token decodes upright, so the
 * rotation loop never runs and a spec run proves nothing about it. `meal-label.spec.ts` cannot
 * choose its meal's id, so only a fixed token can exercise the path on demand.
 */

/** A real 22-character base64url meal token, measured to fail upright and to decode once rotated. */
const UPRIGHT_FAILS = 'Nfvwa4A5QCa0s-dqMPAm2w'
/** A token with nothing wrong with it, so the test also proves the decoder still reads ordinary ones. */
const ORDINARY = 'CYFq8UeLToCQabcdefghij'

/** The label's own geometry: 13 px per module, 4 modules of quiet zone. Measured off a real canvas. */
function renderToLuminance(text: string, pxPerModule = 13, quietModules = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const quiet = quietModules * pxPerModule
  const w = n * pxPerModule + quiet * 2
  const lum = new Uint8Array(w * w).fill(255)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.data[r * n + c]) continue
      for (let y = 0; y < pxPerModule; y++) {
        for (let x = 0; x < pxPerModule; x++) lum[(quiet + r * pxPerModule + y) * w + (quiet + c * pxPerModule + x)] = 0
      }
    }
  }
  return { w, h: w, lum }
}

describe('the rotation-tolerant decode', () => {
  it('reads a token the upright decoder refuses', () => {
    // The assertion that would fail if the rotation loop were removed. It does not also assert that
    // the upright read fails: that is true today and is the whole reason this exists, but pinning it
    // would turn an upstream zxing fix into a red suite for no reason.
    expect(decodeQrRotating(renderToLuminance(UPRIGHT_FAILS))).toBe(UPRIGHT_FAILS)
  })

  it('still reads an ordinary symbol', () => {
    expect(decodeQrRotating(renderToLuminance(ORDINARY))).toBe(ORDINARY)
  })

  it('reads the same symbol at every module size the label might draw', () => {
    // The failure is independent of scale, so the fix has to be too — 3.83% upright held at 6, 8, 13,
    // 16 and 20 px per module alike.
    for (const px of [8, 13, 20]) {
      expect(decodeQrRotating(renderToLuminance(UPRIGHT_FAILS, px)), `${px} px per module`).toBe(UPRIGHT_FAILS)
    }
  })

  it('rotates a NON-SQUARE canvas correctly', () => {
    // Without this every case is square, and square is exactly where the width/height swap after a
    // rotation is a no-op — so dropping the swap passed the rest of this file. The label canvas is
    // square today, but the function takes `w` and `h` separately and a caller that hands it an
    // oblong should not get silent garbage.
    const square = renderToLuminance(UPRIGHT_FAILS)
    const pad = 120
    const w = square.w + pad
    const lum = new Uint8Array(w * square.h).fill(255)
    for (let y = 0; y < square.h; y++) lum.set(square.lum.subarray(y * square.w, (y + 1) * square.w), y * w + pad)
    expect(decodeQrRotating({ w, h: square.h, lum })).toBe(UPRIGHT_FAILS)
  })

  it('returns null rather than throwing when there is no code at all', () => {
    // `dumpCanvas` and the assertion message both run on a null, so a throw here would replace a
    // useful failure with a stack trace.
    const blank = { w: 200, h: 200, lum: new Uint8Array(200 * 200).fill(255) }
    expect(decodeQrRotating(blank)).toBeNull()
  })
})
