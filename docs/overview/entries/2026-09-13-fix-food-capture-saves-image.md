# 2026-09-13 — a photographed or scanned food keeps its picture (OR-108)

**Branch:** `fix/food-capture-saves-image` · **Agent:** Implementation Lane B

Owner, from the nutrition device pass: *"images are working fine on my end; but scanning barcodes
still doesn't auto save an image for the food; or does taking a photo of the food save the image
either."*

## What was actually wrong

Nothing beneath the capture screens. `/api/nutrition/barcode` already fetches and caps Open Food
Facts' thumbnail, the food-items route already accepts `imageDataUri`, `createFoodItem` stores it,
and the outbox, pull delta and on-device mirror all carry it. **Three callers at the top dropped it**,
each by rebuilding a payload field by field:

| surface | what it did |
|---|---|
| `ingredient-picker.tsx` barcode scan | copied twelve fields off the lookup and not the thirteenth |
| `capture-actions.tsx` photo scan | the scan route returns no picture, and the user's own photo was discarded with `pendingPhoto` |
| `food-logger-sheet.tsx` refine | a correction is a text-only re-scan, so its absent image overwrote the one on the form |

`capture-actions`' **barcode** path never had the bug — it hands the whole response to
`onScanResult`. That contrast is the point: the paths that pass the object through were fine, the
paths that rebuild it were not.

## The 8 KB body cap — found by the test, not by reading

The camera half 413'd the first time it ran end to end. `POST /api/nutrition/food-items` caps its
whole body at **8 KB** — a constant written for *"a name, a brand and a dozen macro numbers"*, before
BF-35 gave the route a **16 KB** image field. Base64 costs a third more than the bytes it carries, so
an image at its own permitted cap is ~21 KB on the wire and the request is refused **before**
`rejectMealImage` runs: the user loses the food, not the picture.

Measured in the harness: a 128 px WebP of a detailed 600 × 400 source at q0.8 is **6,612 bytes =
8,816 base64 characters** — over. A smooth photo-like source is 1,410 and fits, which is why nobody
had hit it.

The route is Lane A's file, so it is filed as **LB-101** and the client works around it: the shared
thumbnail helper now walks a quality ladder (0.8 → 0.6 → 0.45) down to a wire budget, and
`thumbFromPhoto` drops the image rather than send a body that would 413. **Dropping the picture is
always the better failure than losing the food.** The workaround, and the two assertions pinning it,
come out when LB-101 lands.

## Also in the diff

- `THUMB_MAX_DIM` / `THUMB_QUALITY` / WebP moved out of `meal-photo-tile.tsx` into
  `lib/media/downscale-image.ts` as `downscaleToThumbDataUrl`. Three arguments, all silent when
  wrong — a JPEG at the same box is roughly twice the bytes against a cap nothing checks loudly.
- The two capture file inputs are named (`food-photo`, `food-gallery`), for the reason BF-46 ①a
  records: a bare `input[type="file"]` reaches whichever comes first in the DOM.

## Verification

- `e2e/food-photo-saves-image.spec.ts` — drives the real flow (pick → scan → review → assign →
  save) and reads the stored `image_data_uri` **back out of Postgres**, asserting it is WebP, inside
  the cap and inside the wire budget. Mutation-proven: reverting the one-line writer fails it.
- `components/nutrition/__tests__/food-image-write-paths.test.ts` — source guards for the barcode
  payload and the refine, which need a camera to reach and so have no e2e (the same reason
  `builder-barcode-scan.spec.ts` gives). Mutation-proven on the barcode assertion.
- Custom Rules **74 of 74**, `tsc` clean, eslint clean, `pnpm test` clean against the local database
  (the 11 `backlog-verify-field` failures seen mid-session were `main`'s, fixed upstream by #1137).

## Not verified

- **Not on the device.** The web `<input>` feeds the same `handlePhoto` and the same canvas
  re-encode the S25 runs, but the Capacitor camera's own capture — permissions, `CameraResultType`,
  the plugin's `width`/`height` hints — is not exercised here.
- **The picture will not appear on a food row on the device yet.** `LA-36` is still open: all three
  local-store read paths omit `image_data_uri`, so the canonical runtime reads the column back as
  null even now that it is written. The web path (`GET /api/nutrition/food-items`) does return it.
- **The barcode path is not driven end to end** — `BarcodeScanner` needs a camera in both runtimes.
