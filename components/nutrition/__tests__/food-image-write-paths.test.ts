import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * OR-108. Every capture path leaves the picture on the food.
 *
 * Owner: *"scanning barcodes still doesn't auto save an image for the food; or does taking a photo
 * of the food save the image either."* Everything under the capture screens already carried
 * `imageDataUri` — the route accepts it, `createFoodItem` stores it, the pull delta and the local
 * mirror keep it. The gap was at the top, in two payloads that are rebuilt field by field.
 *
 * **These are source assertions because the surfaces need a camera.** `BarcodeScanner` drives the
 * Capacitor plugin on the device and asks for `getUserMedia` on web; neither exists in the
 * Playwright harness, which is why the repo has no barcode e2e at all
 * (`builder-barcode-scan.spec.ts` says so in its own header). The camera half of OR-108 IS driven
 * end to end, through the web `<input>` that feeds the same handler —
 * `e2e/food-photo-saves-image.spec.ts` — so what is left here is the barcode payload and the guard
 * that the refine step does not undo either of them.
 */
describe('a captured food keeps its picture', () => {
  it('the builder barcode scan puts the looked-up image on the food it mints', () => {
    // `/api/nutrition/barcode` fetches Open Food Facts' thumbnail and caps it before answering, so
    // the image is present on `scan` and was simply not copied across. `capture-actions.tsx` hands
    // the whole response to `onScanResult` and so never had the bug; this path rebuilds the payload
    // field by field, which is how one field goes missing without anything failing.
    const picker = src('components/nutrition/ingredient-picker.tsx');
    const call = picker.slice(picker.indexOf('async function addScannedFood'));
    const body = call.slice(0, call.indexOf('}, userId))'));
    expect(body, 'the barcode payload does not reach createFoodItem').toMatch(/source: 'barcode'/);
    expect(body, 'the looked-up product image is dropped here').toMatch(/imageDataUri: scan\.imageDataUri/);
  });

  it('the photo scan attaches the captured thumbnail to the result it hands on', () => {
    const capture = src('components/nutrition/capture-actions.tsx');
    // The scan route answers with macros and no picture, so the photo has to be attached client
    // side — and from the SUBMIT path, which is the only place the captured image exists.
    expect(capture).toMatch(/await callScan\(body, await thumbFromPhoto\(pendingPhoto\.previewUrl\)\)/);
    // Through the shared thumbnail spec, not a fourth hand-rolled downscale.
    expect(capture).toMatch(/downscaleToThumbDataUrl\(dataUrlToBlob\(previewUrl\)\)/);
    // Capped against the contract before it is sent. **The second cap is gone (LA-105)** — a wire
    // budget and a quality ladder existed only while the route's body limit sat BELOW the image it
    // permitted; LB-101 derives it from `FOOD_ITEM_IMAGE_MAX_BYTES`, so one check is the whole rule
    // again. Asserted as an absence too, because a workaround that outlives its cause reads as
    // deliberate to the next reader.
    expect(capture).toMatch(/rejectMealImage\(thumb, FOOD_ITEM_IMAGE_MAX_BYTES\)/);
    expect(capture, 'the LB-101 workaround is back').not.toMatch(/THUMB_WIRE_BUDGET|tooBigForTheBody/);
  });

  it('refining a scan keeps the picture the capture step produced', () => {
    // A refine is a text-only re-scan, so its result never carries an image. Taking that absent
    // value over the one already on the form throws the photo away one step before the save.
    const sheet = src('components/nutrition/food-logger-sheet.tsx');
    const refine = sheet.slice(sheet.indexOf('function handleRefine'));
    const body = refine.slice(0, refine.indexOf('\n  }'));
    expect(body, 'a correction silently drops the photo').toMatch(
      /imageDataUri: result\.imageDataUri \?\? f\.imageDataUri/,
    );
  });

  it('the thumbnail spec has one definition, not one per caller', () => {
    // 128 px / 0.8 / WebP is three arguments and getting any of them wrong is silent — a JPEG at
    // the same box is roughly twice the bytes against a cap nothing checks loudly.
    const shared = src('lib/media/downscale-image.ts');
    expect(shared).toMatch(/export const THUMB_MAX_DIM = 128/);
    expect(shared).toMatch(/export function downscaleToThumbDataUrl/);
    for (const rel of ['components/nutrition/meal-photo-tile.tsx', 'components/nutrition/capture-actions.tsx']) {
      expect(src(rel), `${rel} re-declares the thumbnail spec`).not.toMatch(/const THUMB_(MAX_DIM|QUALITY) =/);
    }
  });
});
