/**
 * Reading a QR off a rendered canvas, tolerant of the orientation the reader happens to like.
 *
 * **This exists because of LB-38's root cause, and the flake was never in the app.**
 * `@zxing/library`'s detector cannot read certain *valid* QR symbols in their upright orientation.
 * Measured over **3,000** freshly generated meal tokens, encoded by the same `qrcode` call the label
 * renderer makes and rendered synthetically at the label's own 13 px per module — **no app code
 * involved at all**:
 *
 * | decode strategy | undecodable |
 * |---|---|
 * | upright, `HybridBinarizer` | **115 / 3000 (3.83%)** |
 * | any of four rotations | **4 / 3000 (0.13%)** |
 * | + `TRY_HARDER` and `GlobalHistogramBinarizer` | 4 / 3000 (0.13%) — no further help |
 *
 * **The symbols are valid**: seven of eight sampled failures decode once rotated, and rotation
 * changes nothing but the detector's traversal. It is independent of error-correction level (L/M/Q/H
 * all ~4%), of QR version (25 and 29 modules alike), of mask pattern, of module size at 3 px and
 * above, and of quiet-zone width.
 *
 * **It is deterministic per token, which is why it read as a flake.** Each run seeds one meal, so one
 * token, and every style draws that same symbol — a run fails on all of them or none. 3.83% is 1 in
 * 26, against the ~1 in 19 `meal-label.spec.ts` was measured at.
 *
 * So the four orientations are not a retry and not a workaround for a rendering fault: they are what
 * a real scanner does anyway, since nobody holds a phone square to a label. The residual **0.13% is
 * real and is not claimed as zero** — one token in that sample failed all four rotations under every
 * binarizer.
 */
export function decodeQrRotating({ w, h, lum }: { w: number; h: number; lum: Buffer | Uint8Array }): string | null {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const {
    RGBLuminanceSource, BinaryBitmap, HybridBinarizer, MultiFormatReader, BarcodeFormat, DecodeHintType,
  } = require('@zxing/library')
  const reader = new MultiFormatReader()
  reader.setHints(new Map<unknown, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]))

  let width = w
  let height = h
  let plane = Uint8Array.from(lum)
  for (let turn = 0; turn < 4; turn++) {
    if (turn > 0) {
      // 90° clockwise: (x, y) becomes (height-1-y, x) in the rotated frame.
      const out = new Uint8Array(plane.length)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) out[x * height + (height - 1 - y)] = plane[y * width + x]
      }
      plane = out
      const swap = width
      width = height
      height = swap
    }
    // `RGBLuminanceSource` packs RGB down to luminance itself, so a grey triple of the luminance the
    // page already computed reaches the same value without shipping the colour.
    const luminances = new Int32Array(width * height)
    for (let p = 0; p < luminances.length; p++) {
      const v = plane[p]
      luminances[p] = (v << 16) | (v << 8) | v
    }
    try {
      return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminances, width, height)))).getText()
    } catch {
      // Try the next orientation. Only all four failing is a finding.
    }
  }
  return null
}
