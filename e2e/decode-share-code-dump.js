#!/usr/bin/env node
/**
 * Decode a canvas dump kept by `meal-label.spec.ts` when the share code refused to read (LB-38).
 *
 * The entry's open question: ZXing is handed a demonstrably correct image — two captured failures
 * measured 0.1735 and 0.1775 ink, inside the normal 0.172–0.179 band — and returns null. Capture is
 * eliminated; the fault is in the decode. **A passing canvas already decodes under all four
 * binarizer/`TRY_HARDER` combinations**, so a passing image proves nothing. This runs the same four
 * against the image that actually failed.
 *
 * If the failing buffer decodes here, the fault is in how the decode is invoked in-run rather than
 * in the image or the reader — which is the last mechanism the entry has not eliminated.
 *
 *   node e2e/decode-share-code-dump.js test-results/share-code-dumps/share-code-<ts>.bin
 *
 * Lives in `e2e/` rather than `scripts/` on purpose: it belongs to this spec, and a plain `.js`
 * there does not match Playwright's `testMatch`, so it is never collected as a test.
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-console -- a CommonJS diagnostic script
   whose entire output is `console.log`; it is run by hand, never imported. */
const fs = require('node:fs')
const { createRequire } = require('node:module')

// `@zxing/library` is a transitive dependency: only `@zxing/browser` is linked at the root, and
// under pnpm the library sits beside it inside the store rather than being hoisted. Resolving
// through the package that does depend on it is the honest way to reach it from a standalone
// script — `require('@zxing/library')` here fails with MODULE_NOT_FOUND, which is what sent this
// down a wrong path for a minute.
const zxing = createRequire(require.resolve('@zxing/browser'))('@zxing/library')
const {
  RGBLuminanceSource, BinaryBitmap, HybridBinarizer, GlobalHistogramBinarizer,
  MultiFormatReader, BarcodeFormat, DecodeHintType,
} = zxing

const binPath = process.argv[2]
if (!binPath) {
  console.error('usage: node e2e/decode-share-code-dump.js <dump.bin>')
  process.exit(2)
}
const meta = JSON.parse(fs.readFileSync(binPath.replace(/\.bin$/, '.json'), 'utf8'))
const lum = fs.readFileSync(binPath)
const { w, h } = meta

// One luminance byte per pixel — the spec stopped shipping RGBA over CDP when that transfer turned
// out to be 152 s of a 180 s test budget.
if (lum.length !== w * h) {
  console.error(`dump is ${lum.length} bytes; ${w}x${h} luminance should be ${w * h}`)
  process.exit(2)
}

// Exactly the packing the spec uses, so a difference here is the decode and never the conversion.
const luminances = new Int32Array(w * h)
for (let p = 0; p < luminances.length; p++) {
  const v = lum[p]
  luminances[p] = (v << 16) | (v << 8) | v
}

let dark = 0
for (let i = 0; i < lum.length; i++) if (lum[i] < 128) dark++
console.log(`dump ${w}x${h}, ink ${(dark / lum.length).toFixed(4)} (recorded ${meta.ink?.toFixed?.(4) ?? '—'})`)

let anyDecoded = false
for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
  for (const tryHarder of [false, true]) {
    const source = new RGBLuminanceSource(luminances, w, h)
    const reader = new MultiFormatReader()
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]])
    if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true)
    reader.setHints(hints)
    let result = null
    try {
      result = reader.decode(new BinaryBitmap(new Binarizer(source))).getText()
    } catch { /* a refusal is the datum, not an error */ }
    if (result) anyDecoded = true
    console.log(`  ${Binarizer.name.padEnd(24)} TRY_HARDER=${String(tryHarder).padEnd(5)} -> ${result ? `decoded (${result.length} chars)` : 'null'}`)
  }
}

console.log(
  anyDecoded
    ? '\nAt least one configuration decoded the image the run refused. The image and the reader are\n'
      + 'both fine, so the fault is in HOW the decode is invoked in-run — that is LB-38\'s answer.'
    : '\nNo configuration decoded it, so the fault is in what was drawn rather than in the decode.\n'
      + 'Do NOT read the ink above as normal or abnormal without knowing which STYLE this dump came\n'
      + 'from — it is per-style (Ingredients-centred 0.0800, Black band 0.1341, Plaque 0.0914, Big\n'
      + 'code 0.1732 on a passing run), and the filename carries the style. Comparing one style\'s\n'
      + 'ink against another\'s band is how a tornness theory got built and dropped (LB-38).',
)
