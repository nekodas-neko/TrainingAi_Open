# 2026-08-24 — the meal photo has somewhere to be picked (Q-327)

**PR:** `feat/saved-meal-thumbnail-ui` · **Lane B**

## What shipped

A 64 px tile beside the meal-name field in Edit Meal. Tapping it opens the camera or gallery;
tapping the corner removes the picture. The tile is the preview as well as the picker, so there is no
separate "current photo" row, and the image rides the save that already exists rather than needing a
write of its own.

- `components/nutrition/meal-photo-tile.tsx` — the tile.
- `lib/media/downscale-image.ts` — `downscaleToDataUrl(source, {maxDim, quality, mimeType})`.
  `downscaleToJpegDataUrl` now delegates to it, so its three existing callers are unchanged.
- `packages/shared/src/nutrition/meal-image.ts` — `mealImageBytes`, which `rejectMealImage` now uses
  as well, so the number on the tile is the same arithmetic the server rejects on.
- `components/nutrition/saved-meals-sheet.tsx` — one `mealImage` state, threaded into the local
  upsert, the outbox payload and the API body.

The storage half was already done and merged (Q-396): the column, both routes, the `pushMutations`
replay and the local mirror. Nothing here re-does any of it.

## Decisions worth not re-litigating

**WebP is requested, not assumed.** `canvas.toDataURL` answers an unsupported type with a **PNG**,
without erroring — and a PNG of the same picture is several times the bytes the 16 KB cap was sized
against, so an unnoticed fallback is exactly how a thumbnail sails past it. `downscaleToDataUrl`
checks the prefix of what came back and re-encodes as JPEG when the request was ignored.

**The byte figure on the tile is the tripwire, not decoration.** Nothing fails loudly when the cap
slips: the server rejects the image and the outbox just carries a heavier row. A number the user can
see is the cheapest signal available, which is the same reasoning that put `image_bytes` in the audit
view.

**`imageDataUri` is always sent, never omitted.** Both write paths read `undefined` as "leave a
stored photo alone" and `null` as "remove it". This screen always knows which it means, because
`openBuild` seeds the state from the meal being edited — and both list paths return the column, so
that seed is real rather than an accidental `null` that would delete the photo on every rename.
Omitting instead would be the same save with one more state to get wrong.

**The camera call uses `width`/`height`, not `targetWidth`/`targetHeight`** — the latter belong to
the sibling `takePhoto(TakePhotoOptions)` and are silently ignored, which `capture-step.tsx` already
records against the same pinned plugin. It is a first pass only; the canvas re-encode after it is
what actually reaches the cap.

## Verification

`e2e/meal-photo-picker.spec.ts`. The picture is built in the page — a 1,200 × 900 gradient with
deterministic noise, so the JPEG encoder cannot collapse it and make the downscale look unnecessary —
and the spec asserts the source is more than four times the cap before asserting the **stored** row
is a WebP under it. Mutation-checked: raising `maxDim` to 4000 fails the first test.

The second test covers the two ways an edit screen loses a photo: saving without touching the tile
must keep it, and Remove must actually clear it.

Full local gate: 53 of 53 Custom Rules, lint clean, the spec green.

**Not exercised:** the native path. `Capacitor.isNativePlatform()` is false in a browser, so every
run took the `<input type=file>` branch — the camera/gallery prompt, the tile's 48dp target on the
S25, and the local-store mirror of the image column are all owed an on-device check.
